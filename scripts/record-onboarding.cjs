'use strict';
/* Records docs/onboarding/onboarding-motion.html into the animated images the
   README shows. It steps the page frame by frame through window.bvSeek rather
   than filming it in real time, so a slow machine gives the same file as a
   fast one and no frame is ever dropped.

     npm i --no-save playwright-core@1.63.0
     node scripts/record-onboarding.cjs          # docs/onboarding/onboarding-{light,dark}.webp
     node scripts/record-onboarding.cjs --mp4    # also 16:9 and 9:16 MP4s (gitignored)

   Needs img2webp (brew install webp), ffmpeg for --mp4, and a Chromium that
   Playwright can drive: `npx playwright-core install chromium-headless-shell`,
   or point CHROME at any Chrome or headless-shell binary. Not part of npm test. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs/onboarding');
const MP4 = process.argv.includes('--mp4');

const JOBS = [
  { file: 'onboarding-light.webp', width: 960, height: 540, scale: 1, scheme: 'light', format: 'landscape', fps: 20 },
  { file: 'onboarding-dark.webp', width: 960, height: 540, scale: 1, scheme: 'dark', format: 'landscape', fps: 20 },
  ...(MP4 ? [
    { file: 'onboarding-16x9.mp4', width: 1280, height: 720, scale: 1.5, scheme: 'light', format: 'landscape', fps: 30 },
    { file: 'onboarding-9x16.mp4', width: 720, height: 1280, scale: 1.5, scheme: 'light', format: 'portrait', fps: 30 },
  ] : []),
];
const TAIL_MS = 600; // the last scene fades to the empty stage, so the loop restarts cleanly

const TYPES = { '.html': 'text/html', '.woff2': 'font/woff2', '.css': 'text/css', '.js': 'text/javascript' };
function serve() {
  // Fonts refuse to load from file:// URLs, so the page is served over loopback.
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function cachedHeadlessShell() {
  const cache = path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
  if (!fs.existsSync(cache)) return null;
  const dirs = fs.readdirSync(cache).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse();
  for (const d of dirs) {
    for (const sub of fs.readdirSync(path.join(cache, d))) {
      const bin = path.join(cache, d, sub, 'chrome-headless-shell');
      if (fs.existsSync(bin)) return bin;
    }
  }
  return null;
}

async function launch(chromium) {
  if (process.env.CHROME) return chromium.launch({ executablePath: process.env.CHROME });
  try { return await chromium.launch(); } catch (e) {
    const bin = cachedHeadlessShell();
    if (!bin) throw e;
    return chromium.launch({ executablePath: bin });
  }
}

async function record(browser, base, job) {
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'bv-onboarding-'));
  const page = await browser.newPage({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: job.scale, colorScheme: job.scheme });
  await page.goto(`${base}/docs/onboarding/onboarding-motion.html?record&format=${job.format}`);
  await page.evaluate(() => document.fonts.ready);
  const durations = await page.evaluate(() => [...document.querySelectorAll('.scene')].map(s => +s.dataset.dur));
  const step = 1000 / job.fps;
  const plan = [];
  let glow = 0;
  durations.forEach((dur, i) => {
    for (let ms = 0; ms < dur; ms += step, glow += step) plan.push([i, ms, glow, 1]);
  });
  const last = durations.length - 1;
  for (let ms = 0; ms <= TAIL_MS; ms += step, glow += step) plan.push([last, durations[last] + ms, glow, 1 - ms / TAIL_MS]);

  for (let n = 0; n < plan.length; n++) {
    await page.evaluate(([i, ms, g, fade]) => new Promise(resolve => {
      window.bvSeek(i, ms, g, fade);
      // Two frames: one for the number tweens to write their text, one to paint it.
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }), plan[n]);
    await page.screenshot({ path: path.join(frames, `f${String(n).padStart(5, '0')}.png`) });
    if (n % 100 === 0) process.stdout.write(`  ${job.file}: frame ${n}/${plan.length}\r`);
  }
  await page.close();

  const out = path.join(OUT, job.file);
  if (job.file.endsWith('.webp')) {
    const list = fs.readdirSync(frames).sort().map(f => path.join(frames, f));
    execFileSync('img2webp', ['-loop', '0', '-min_size', '-lossy', '-q', '70', '-m', '6', '-d', String(Math.round(step)), ...list, '-o', out], { stdio: 'ignore' });
  } else {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(job.fps), '-i', path.join(frames, 'f%05d.png'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', out]);
  }
  fs.rmSync(frames, { recursive: true, force: true });
  console.log(`  ${job.file}: ${plan.length} frames, ${(fs.statSync(out).size / 1048576).toFixed(1)} MB`);
}

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright-core')); } catch {
    console.error('playwright-core is not installed: npm i --no-save playwright-core@1.63.0');
    process.exit(1);
  }
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launch(chromium);
  try {
    for (const job of JOBS) await record(browser, base, job);
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
