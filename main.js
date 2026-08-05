"use strict";
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

// src/constants.js
var require_constants = __commonJS((exports2, module2) => {
  var VIEW_TYPE = "budget-app-view";
  var DEFAULT_SETTINGS = {
    budgetFolder: "Finances/Budget",
    theme: "auto",
    openOnStartup: false,
    onboarded: false,
    privacyLock: true
  };
  var FEEDBACK_URL = "https://forms.gle/EVJKCuZxNQ9vJhTz6";
  var SUPPORT_URL = "https://paypal.me/ruanpienaar86";
  var TYPE_ORDER = ["income", "expense", "debt", "services", "insurance", "giving", "savings", "investment", "luxuries", "transfer"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  module2.exports = { VIEW_TYPE, DEFAULT_SETTINGS, FEEDBACK_URL, SUPPORT_URL, TYPE_ORDER, MONTHS };
});

// src/util.js
var require_util = __commonJS((exports2, module2) => {
  var { setIcon } = require("obsidian");
  var el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class")
        n.className = v;
      else if (k.startsWith("on"))
        n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined)
        n.setAttribute(k, v);
    }
    for (const kid of kids.flat())
      n.append(kid?.nodeType ? kid : document.createTextNode(kid ?? ""));
    return n;
  };
  var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  function dateInput(value, attrs, commit) {
    const v = (value ?? "").toString().trim();
    const picker = v === "" || ISO_DATE.test(v);
    return el("input", {
      type: picker ? "date" : "text",
      value: v,
      ...picker ? {} : {
        placeholder: "YYYY-MM-DD",
        inputmode: "numeric",
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        spellcheck: "false"
      },
      ...attrs,
      onchange: (e) => commit(e.target.value.trim(), e)
    });
  }
  function keepScroll(elm, rebuild) {
    const box = elm.parentElement;
    const left = box ? box.scrollLeft : 0;
    rebuild();
    if (box)
      box.scrollLeft = left;
  }
  function setIco(elm, names) {
    for (const n of Array.isArray(names) ? names : [names]) {
      try {
        setIcon(elm, n);
      } catch (e) {}
      if (elm.firstElementChild)
        return;
    }
  }
  function icoEl(names, cls) {
    const s = document.createElement("span");
    s.className = "ico" + (cls ? " " + cls : "");
    s.setAttribute("aria-hidden", "true");
    setIco(s, names);
    return s;
  }
  var escMd = (s) => (s ?? "").toString().replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>").trim();
  var unescMd = (s) => (s ?? "").replace(/<br>/g, `
`).replace(/\\\|/g, "|").trim();
  function parseFrontmatter(text) {
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const fm = {};
    if (m)
      for (const line of m[1].split(/\r?\n/)) {
        const i = line.indexOf(":");
        if (i > 0) {
          const key = line.slice(0, i).trim();
          let val = line.slice(i + 1).trim();
          if (/^".*"$/.test(val))
            val = val.slice(1, -1);
          fm[key] = val;
        }
      }
    return { fm, raw: m ? m[1] : "", body: m ? text.slice(m[0].length) : text };
  }
  var endsWithBarePipe = (s) => s.endsWith("|") && s[s.length - 2] !== "\\";
  function splitBarePipes(s) {
    const cells = [];
    let cur = "";
    for (let i = 0;i < s.length; i++) {
      const ch = s[i];
      if (ch === "|" && s[i - 1] !== "\\") {
        cells.push(cur);
        cur = "";
      } else
        cur += ch;
    }
    cells.push(cur);
    return cells;
  }
  function parseMdTable(text) {
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t.startsWith("|")) {
        if (rows.length)
          break;
        continue;
      }
      if (/^\|[\s:|-]+\|$/.test(t))
        continue;
      let inner = t.slice(1);
      if (endsWithBarePipe(inner))
        inner = inner.slice(0, -1);
      const cells = splitBarePipes(inner).map((c) => c.trim());
      rows.push(cells);
    }
    return rows;
  }
  function parseNum(s) {
    const t = (s ?? "").toString().trim();
    if (/^-?\d+(\.\d+)?$/.test(t))
      return { ok: true, value: parseFloat(t) };
    return { ok: false, value: normalizeAmount(t) ?? 0, raw: t };
  }
  function patchFrontmatter(raw, updates) {
    const has = (k) => Object.prototype.hasOwnProperty.call(updates, k);
    if (!raw || !raw.trim()) {
      return Object.keys(updates).filter((k) => updates[k] != null).map((k) => `${k}: ${updates[k]}`).join(`
`);
    }
    const isTopKey = (l) => /^[^\s#][^:]*:(\s.*)?$/.test(l);
    const entries = [];
    let cur = null;
    for (const line of raw.split(/\r?\n/)) {
      if (isTopKey(line)) {
        cur = { key: line.slice(0, line.indexOf(":")).trim(), lines: [line] };
        entries.push(cur);
      } else if (cur)
        cur.lines.push(line);
      else
        entries.push({ key: null, lines: [line] });
    }
    const seen = new Set;
    const out = [];
    for (const e of entries) {
      if (e.key != null && has(e.key)) {
        seen.add(e.key);
        if (updates[e.key] != null)
          out.push(`${e.key}: ${updates[e.key]}`);
      } else {
        out.push(...e.lines);
      }
    }
    for (const k of Object.keys(updates)) {
      if (!seen.has(k) && updates[k] != null)
        out.push(`${k}: ${updates[k]}`);
    }
    return out.join(`
`);
  }
  function parseCsv(text) {
    const rows = [];
    let row = [], field = "", inQ = false;
    for (let i = 0;i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else
            inQ = false;
        } else
          field += ch;
      } else if (ch === '"')
        inQ = true;
      else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === `
` || ch === "\r") {
        if (ch === "\r" && text[i + 1] === `
`)
          i++;
        row.push(field);
        field = "";
        if (row.length > 1 || row[0] !== "")
          rows.push(row);
        row = [];
      } else
        field += ch;
    }
    if (field !== "" || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }
  function isoParts(y, mo, d) {
    if (!y || y < 1000 || mo < 1 || mo > 12 || d < 1 || d > 31)
      return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function parseStatementDate(raw, dayFirst = true) {
    let s = (raw ?? "").toString().trim();
    if (!s)
      return null;
    s = s.replace(/[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(am|pm|z|[+-]\d{2}:?\d{2})?$/i, "").trim();
    let m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
    if (m)
      return isoParts(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    if (m) {
      let d = dayFirst ? +m[1] : +m[2], mo = dayFirst ? +m[2] : +m[1];
      if (mo > 12 && d <= 12) {
        const t = d;
        d = mo;
        mo = t;
      }
      return isoParts(+m[3], mo, d);
    }
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m)
      return isoParts(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[ -]?([A-Za-z]{3,})[ -]?(\d{4})$/);
    if (m) {
      const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
      if (mo)
        return isoParts(+m[3], mo, +m[1]);
    }
    const dt = new Date(s);
    if (!isNaN(dt.getTime()))
      return isoParts(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    return null;
  }
  function normalizeAmount(raw) {
    let s = (raw ?? "").toString().trim();
    if (!s)
      return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) {
      neg = true;
      s = s.slice(1, -1).trim();
    }
    const marker = s.match(/(cr|dr)\.?\s*$/i);
    if (marker) {
      if (marker[1].toLowerCase() === "dr")
        neg = true;
      s = s.slice(0, marker.index).trim();
    }
    if (s.endsWith("-")) {
      neg = true;
      s = s.slice(0, -1).trim();
    }
    if (s.startsWith("-")) {
      neg = true;
      s = s.slice(1).trim();
    }
    if (s.startsWith("+"))
      s = s.slice(1).trim();
    s = s.replace(/^(zar|usd|gbp|eur|aud|cad|us\$|a\$|c\$|nz\$|r|[$\u00A3\u20AC])\s*/i, "").replace(/[\s\u00A0\u202F']/g, "");
    if (/^\d+(\.\d{3})*,\d{1,2}$/.test(s))
      s = s.replace(/\./g, "").replace(",", ".");
    else
      s = s.replace(/,/g, "");
    if (!/^\d+(\.\d+)?$/.test(s))
      return null;
    const n = Number(s);
    return neg ? -n : n;
  }
  function reconcileAmounts(rows) {
    const c = (v) => Math.round(v * 100);
    const pts = (rows || []).filter((r) => r && r.amount != null && r.balance != null);
    if (pts.length < 4)
      return { verified: false, flip: false, order: null, pairs: Math.max(0, pts.length - 1), agreement: 0 };
    let best = { verified: false, flip: false, order: null, pairs: pts.length - 1, agreement: 0 };
    for (const order of ["fwd", "rev"]) {
      for (const sign of [1, -1]) {
        let agree = 0;
        for (let i = 1;i < pts.length; i++) {
          const prev = c(pts[i - 1].balance), bal = c(pts[i].balance);
          const step = order === "fwd" ? sign * c(pts[i].amount) : -sign * c(pts[i - 1].amount);
          if (bal - prev === step)
            agree++;
        }
        if (agree > best.agreement)
          best = { verified: false, flip: sign === -1, order, pairs: pts.length - 1, agreement: agree };
      }
    }
    best.verified = best.agreement >= Math.ceil(best.pairs * 0.8);
    return best;
  }
  function detectHeaderlessColumns(rows, dayFirst = true) {
    const isDate = (v) => !!parseStatementDate(v, dayFirst);
    const num = (v) => normalizeAmount(v);
    const dataStart = (rows || []).findIndex((r) => r.length >= 3 && isDate(r[0]) && r.slice(1).some((c) => num(c) != null));
    if (dataStart === -1)
      return null;
    const width = rows[dataStart].length;
    const data = rows.slice(dataStart).filter((r) => r.length === width && isDate(r[0]));
    if (data.length < 2)
      return null;
    let firstNum = width;
    while (firstNum > 1 && data.every((r) => num(r[firstNum - 1]) != null))
      firstNum--;
    if (firstNum >= width)
      return null;
    let iAmount = width - 1, iBalance = -1;
    if (width - firstNum >= 2) {
      const bal = reconcileAmounts(data.map((r) => ({ amount: num(r[width - 2]), balance: num(r[width - 1]) })));
      if (bal.verified) {
        iAmount = width - 2;
        iBalance = width - 1;
      } else if (bal.pairs < 3 && data.some((r) => num(r[width - 2]) !== 0))
        return null;
    }
    let iDesc = -1;
    for (let c = iAmount - 1;c >= 1; c--) {
      const vals = data.map((r) => (r[c] ?? "").toString().trim()).filter(Boolean);
      if (!vals.length)
        continue;
      const text = vals.filter((v) => num(v) == null && !isDate(v)).length;
      if (text > vals.length / 2) {
        iDesc = c;
        break;
      }
    }
    if (iDesc === -1)
      return null;
    return { dataStart, iDate: 0, iDesc, iAmount, iBalance };
  }
  var DATE_COLS = [
    "value date",
    "date",
    "posting date",
    "post date",
    "date posted",
    "effective date",
    "transaction date",
    "trans date",
    "txn date",
    "process date",
    "action date"
  ];
  var DESC_COLS = [
    "description",
    "title",
    "narrative",
    "narration",
    "details",
    "detail",
    "particulars",
    "transaction description",
    "statement description",
    "transaction detail",
    "reference",
    "payee",
    "memo"
  ];
  var AMOUNT_COLS = ["amount", "transaction amount", "amount (zar)", "signed amount", "value"];
  var DEBIT_COLS = ["debit", "debits", "debit amount", "money out", "amount out", "withdrawal", "withdrawals", "paid out"];
  var CREDIT_COLS = ["credit", "credits", "credit amount", "money in", "amount in", "deposit", "deposits", "paid in"];
  var BALANCE_COLS = ["balance", "running balance", "closing balance", "account balance", "balance (zar)"];
  function detectStatementColumns(rows, dayFirst = true) {
    const headerIdx = (rows || []).findIndex((r) => {
      const low = r.map((c) => c.trim().toLowerCase());
      const has = (names) => names.some((n) => low.includes(n));
      return (has(DATE_COLS) || low.some((c) => c.includes("date"))) && (has(AMOUNT_COLS) || has(DEBIT_COLS) && has(CREDIT_COLS));
    });
    if (headerIdx !== -1) {
      const low = rows[headerIdx].map((c) => c.trim().toLowerCase());
      const col = (names) => {
        for (const n of names) {
          const i = low.indexOf(n);
          if (i !== -1)
            return i;
        }
        return -1;
      };
      let iDate = col(DATE_COLS);
      if (iDate === -1)
        iDate = low.findIndex((c) => c.includes("date"));
      let iDesc = col(DESC_COLS);
      if (iDesc === -1)
        iDesc = low.findIndex((c) => c.includes("desc"));
      let iBalance = col(BALANCE_COLS);
      if (iBalance === -1)
        iBalance = low.findIndex((c) => c.includes("balance"));
      const iAmount = col(AMOUNT_COLS), iDebit = col(DEBIT_COLS), iCredit = col(CREDIT_COLS);
      if (iDate === -1 || iDesc === -1 || iAmount === -1 && (iDebit === -1 || iCredit === -1))
        return null;
      return { iDate, iDesc, iAmount, iDebit, iCredit, iBalance, iExtra: -1, headerIdx, dataStart: headerIdx + 1 };
    }
    const shape = detectHeaderlessColumns(rows, dayFirst);
    if (!shape)
      return null;
    return { ...shape, iDebit: -1, iCredit: -1, iExtra: -1, headerIdx: -1 };
  }
  function learnPattern(desc) {
    let s = (desc ?? "").toString().trim();
    for (;; ) {
      const m = s.match(/^(.*\S)[ \t]+(\S+)$/);
      if (!m)
        break;
      const w = m[2];
      const digits = (w.match(/\d/g) || []).length;
      const noise = /\*{2,}/.test(w) || /\d{4,}/.test(w) || digits > 0 && digits / w.length >= 0.4 || digits > 0 && w.length >= 8 && /^[A-Z0-9]+$/.test(w);
      if (!noise)
        break;
      s = m[1];
    }
    return s.length >= 4 ? s : (desc ?? "").toString().trim();
  }
  var WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  function safeSeg(s) {
    const out = (s ?? "").toString().normalize("NFC").replace(/[\u00A0\u202F]/g, " ").replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "").replace(/[\x00-\x1F\x7F]/g, "").replace(/[\\/:*?"<>|]/g, "-").replace(/\.{2,}/g, "-").replace(/^\.+/, "").trim().replace(/[. ]+$/, "");
    return WIN_RESERVED.test(out) ? `${out}-` : out;
  }
  var yamlStr = (v) => `"${String(v ?? "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
  function csvCell(v) {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s))
      s = `'${s}`;
    return /["',\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  var INERT_SUPPORTED = typeof HTMLElement !== "undefined" && "inert" in HTMLElement.prototype;
  var FOCUSABLE_SEL = "a[href],button,input,select,textarea,summary,[tabindex]";
  function setInert(elm, on) {
    if (!elm)
      return;
    if (on)
      elm.setAttribute("inert", "");
    else
      elm.removeAttribute("inert");
    if (INERT_SUPPORTED)
      return;
    if (on) {
      elm.setAttribute("aria-hidden", "true");
      for (const f of elm.querySelectorAll(FOCUSABLE_SEL)) {
        if (!f.hasAttribute("data-bud-ti"))
          f.setAttribute("data-bud-ti", f.getAttribute("tabindex") ?? "");
        f.setAttribute("tabindex", "-1");
      }
      if (elm.contains(document.activeElement) && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
    } else {
      elm.removeAttribute("aria-hidden");
      for (const f of elm.querySelectorAll("[data-bud-ti]")) {
        const prev = f.getAttribute("data-bud-ti");
        if (prev === "")
          f.removeAttribute("tabindex");
        else
          f.setAttribute("tabindex", prev);
        f.removeAttribute("data-bud-ti");
      }
    }
  }
  function collapsePath(p) {
    const out = [];
    for (const seg of (p || "").split("/")) {
      if (seg === "" || seg === ".")
        continue;
      if (seg === "..") {
        if (!out.length)
          return null;
        out.pop();
      } else
        out.push(seg);
    }
    return out.join("/");
  }
  var MIN_PERIOD_DAYS = 7;
  var MAX_PERIOD_DAYS = 31;
  function periodDaysOrZero(v) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < MIN_PERIOD_DAYS || n > MAX_PERIOD_DAYS)
      return 0;
    return n;
  }
  function isoDayNumber(iso) {
    const [y, m, d] = String(iso).split("-").map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
  }
  module2.exports = { el, dateInput, keepScroll, setIco, icoEl, escMd, unescMd, parseFrontmatter, parseMdTable, parseCsv, parseStatementDate, normalizeAmount, detectHeaderlessColumns, detectStatementColumns, reconcileAmounts, parseNum, patchFrontmatter, learnPattern, safeSeg, collapsePath, yamlStr, csvCell, setInert, periodDaysOrZero, isoDayNumber };
});

// src/shell.js
var require_shell = __commonJS((exports2, module2) => {
  var SHELL_HTML = `
  <div class="splash-gate hidden" id="splashGate" role="group" aria-labelledby="gateTitle">
    <div class="splash-inner">
      <div class="splash-logo" aria-hidden="true"><span class="ico" data-ico="wallet|banknote|coins"></span></div>
      <h1 class="splash-title" id="gateTitle">Budget Vault</h1>
      <p class="splash-sub">Welcome back to Budget Vault, your private budget tool.</p>
      <button type="button" class="btn-gradient splash-btn" id="gateEnter">Enter budget</button>
    </div>
  </div>

  <div class="drawer-overlay" id="drawerOverlay"></div>

  <nav class="app-drawer" id="appDrawer" aria-label="Main menu" inert>
    <div class="drawer-head">
      <b>Menu</b>
      <button type="button" class="drawer-close" aria-label="Close menu" id="drawerClose"><span class="ico" data-ico="x"></span></button>
    </div>

    <div class="drawer-section-label">Menu</div>
    <button class="drawer-link" data-view="dashboard" aria-current="page">
      <span class="di"><span class="ico" data-ico="layout-dashboard"></span></span>Dashboard
    </button>
    <button class="drawer-link" data-view="transactions">
      <span class="di"><span class="ico" data-ico="arrow-left-right"></span></span>Transactions
    </button>
    <button class="drawer-link" data-view="budgets">
      <span class="di"><span class="ico" data-ico="bookmark"></span></span>Budget
    </button>
    <button class="drawer-link" data-view="tax">
      <span class="di"><span class="ico" data-ico="receipt-text|receipt|file-check"></span></span>Tax
    </button>

    <div class="drawer-divider"></div>

    <div class="drawer-section-label">Accounts</div>
    <button class="drawer-link" data-view="savings">
      <span class="di"><span class="ico" data-ico="piggy-bank"></span></span>Savings &amp; Investments
    </button>
    <button class="drawer-link" data-view="accounts">
      <span class="di"><span class="ico" data-ico="landmark"></span></span>Accounts
    </button>
    <button class="drawer-link" data-view="debts">
      <span class="di"><span class="ico" data-ico="credit-card"></span></span>Debt
    </button>
    <button class="drawer-link" data-view="owed">
      <span class="di"><span class="ico" data-ico="users"></span></span>Owed Money
    </button>
    <button class="drawer-link" data-view="services">
      <span class="di"><span class="ico" data-ico="layers"></span></span>Services
    </button>

    <div class="drawer-divider"></div>

    <div class="drawer-section-label">Tools</div>
    <button class="drawer-link" data-view="loans">
      <span class="di"><span class="ico" data-ico="calculator"></span></span>Loan Calculators
    </button>
    <button class="drawer-link" data-view="import">
      <span class="di"><span class="ico" data-ico="cloud-upload|upload-cloud"></span></span>Import CSV
    </button>
    <button class="drawer-link" id="reloadLink">
      <span class="di"><span class="ico" data-ico="refresh-cw|rotate-cw"></span></span>Reload from disk
    </button>
    <button class="drawer-link" id="pluginSettingsLink">
      <span class="di"><span class="ico" data-ico="settings"></span></span>Plugin settings
    </button>
  </nav>

  <header class="topbar" aria-label="Budget navigation">
    <button type="button" class="menu-btn" id="menuBtn" aria-expanded="false" aria-controls="appDrawer" aria-label="Open navigation menu">
      <span></span><span></span><span></span>
    </button>

    <button type="button" class="brand" id="brandHome" aria-label="Go to Dashboard">
      <span class="brand-logo" aria-hidden="true"><span class="ico" data-ico="wallet|banknote|coins"></span></span>
      <span class="brand-text">
        <b>Budget Vault</b>
        <span class="brand-sub" id="brandSub">Obsidian vault budget</span>
      </span>
    </button>

    <div class="header-period-pill hidden" id="periodPill" role="group" aria-label="Period navigation">
      <button class="pnav-btn" id="prevPeriod" aria-label="Previous period"><span class="ico" data-ico="chevron-left"></span></button>
      <span class="pnav-dot" aria-hidden="true"></span>
      <span class="pnav-label" id="periodLabel"></span>
      <button class="pnav-btn" id="currentPeriod" aria-label="Jump to current period"><span class="ico" data-ico="refresh-cw|rotate-cw"></span></button>
      <button class="pnav-btn" id="nextPeriod" aria-label="Next period"><span class="ico" data-ico="chevron-right"></span></button>
    </div>

    <div class="ml-auto">
      <button type="button" class="topbar-icon-btn hidden" id="topbarImport" aria-label="Import CSV" title="Import a bank statement CSV">
        <span class="ico" data-ico="import|file-input|cloud-upload|upload-cloud"></span>
      </button>
      <button type="button" class="topbar-avatar" id="topbarAvatar" aria-label="Open budget settings">BV</button>
    </div>
  </header>

  <div class="bud-scroll">
    <main class="main-content">

      <section id="view-connect">
        <div class="card" id="connect-card">
          <div class="card-h" style="justify-content:center"><h2>Budget folder not found</h2></div>
          <div class="body-pad">
            <p>This plugin reads and writes the markdown files in your budget folder —
              accounts, categories, budgets and transactions all live as plain files in the vault.</p>
            <p class="text-muted" id="connectPathNote"></p>
            <p style="margin-top:1.4rem"><button class="btn-gradient" id="openSettingsBtn" style="padding:0.55rem 1.5rem">Open plugin settings…</button></p>
            <p id="connectErr" class="text-danger"></p>
          </div>
        </div>
      </section>

      <section id="view-dashboard" class="hidden">
        <div class="financial-period-banner">
          <h1 class="financial-period-banner-title">Dashboard</h1>
        </div>
        <div class="card hero mb-4" id="heroCard"></div>
        <div class="card mb-4">
          <div class="card-h">
            <div>
              <h2>Spending Trend</h2>
              <div class="sub">Spent vs budget · last 6 periods</div>
            </div>
            <div class="legend">
              <span><i style="background:var(--color-success)"></i>Spent</span>
              <span><i style="background:var(--color-danger)"></i>Over budget</span>
              <span><i class="legend-dash"></i>Budget</span>
            </div>
          </div>
          <div class="body-pad"><div class="trend-svg-wrap" id="trendChart"></div></div>
        </div>
        <div class="card mb-4">
          <div class="card-h">
            <div>
              <h2>Budget vs Actual</h2>
              <div class="sub" id="dashBudgetSub"></div>
            </div>
          </div>
          <div class="body-pad body-pad-tight">
            <div class="table-responsive"><table class="table" id="dashBudget"></table></div>
          </div>
        </div>
      </section>

      <section id="view-transactions" class="hidden">
        <div class="financial-period-banner">
          <h1 class="financial-period-banner-title">Transactions</h1>
          <div class="sub-note" id="txSubNote"></div>
        </div>
        <div class="card">
          <div class="card-h" style="align-items:center">
            <div class="row" style="flex:1">
              <select id="txAccount" class="form-select form-select-sm"><option value="">All accounts</option></select>
              <select id="txCategory" class="form-select form-select-sm"><option value="">All categories</option><option value="__none__">Uncategorised</option></select>
              <input type="search" id="txSearch" class="form-control form-control-sm" placeholder="Search description…">
              <label class="text-muted" style="font-size:13px;display:inline-flex;align-items:center;gap:6px">
                <input type="checkbox" id="txWholeHistory"> whole history
              </label>
            </div>
            <div class="row">
              <span id="txCount" class="count-note"></span>
              <button class="btn-ghost" id="txAdd"><span class="ico" data-ico="plus"></span> Add transaction</button>
              <button class="btn-gradient" id="txSave" disabled>Save changes</button>
            </div>
          </div>
          <div class="body-pad body-pad-tight">
            <div class="table-responsive"><table class="table table-hover" id="txTable"></table></div>
          </div>
        </div>
      </section>

      <section id="view-budgets" class="hidden">
        <div class="financial-period-banner">
          <h1 class="financial-period-banner-title">Budget</h1>
          <div class="sub-note" id="budPeriodLabel"></div>
        </div>
        <div class="card">
          <div class="card-h" style="align-items:center">
            <div>
              <h2>Category budgets</h2>
              <div class="sub">Amounts are per financial period · saved to <code>Budgets/&lt;period&gt;.md</code></div>
            </div>
            <div class="row">
              <button class="btn-ghost" id="budCopyPrev">Copy previous period</button>
              <button class="btn-ghost" id="budAddCat"><span class="ico" data-ico="plus"></span> New category</button>
              <button class="btn-gradient" id="budSave" disabled>Save budget</button>
            </div>
          </div>
          <div class="body-pad body-pad-tight">
            <div class="bud-totals" id="budTotalsTop"></div>
            <div class="table-responsive"><table class="table" id="budTable"></table></div>
            <div class="bud-totals bud-totals-bottom" id="budTotalsBottom"></div>
          </div>
        </div>
      </section>

      <section id="view-tax" class="hidden">
        <div class="financial-period-banner">
          <h1 class="financial-period-banner-title">Tax</h1>
          <div class="sub-note" id="taxSubNote">Tax return tracking · saved to <code>Tax/&lt;year&gt;.md</code></div>
        </div>

        <div class="card hidden" id="taxEmptyCard">
          <div class="card-h" style="justify-content:center"><h2>No tax year yet</h2></div>
          <div class="body-pad">
            <p id="taxEmptyIntro">Track a tax return season here — progress steps, the documents
              you need and the files themselves, stored in the vault.</p>
            <p class="text-muted" id="taxEmptyHint" style="font-size:12.5px"></p>
            <p style="margin-top:1.2rem"><button class="btn-gradient" id="taxStart" style="padding:0.55rem 1.5rem"></button></p>
          </div>
        </div>

        <div id="taxContent">
          <div class="mini-grid mini-kpis-5 mb-4" id="taxKpis"></div>

          <div class="card mb-4">
            <div class="card-h" style="align-items:center">
              <div><h2>Season</h2><div class="sub">Taxpayer status, assessment &amp; deadlines</div></div>
              <div class="row">
                <select id="taxYearSel" class="form-select form-select-sm" aria-label="Tax year"></select>
                <button class="btn-ghost" id="taxNewYear"><span class="ico" data-ico="plus"></span> New tax year</button>
              </div>
            </div>
            <div class="body-pad" id="taxSeasonBody"></div>
          </div>

          <div class="card mb-4">
            <div class="card-h" style="align-items:center">
              <div><h2>Progress</h2><div class="sub">Steps to a filed return · tap a status to advance it</div></div>
              <div class="row">
                <button class="btn-ghost" id="taxAddStep"><span class="ico" data-ico="plus"></span> Add step</button>
                <button class="btn-gradient" id="taxSave" disabled>Save changes</button>
              </div>
            </div>
            <div class="body-pad body-pad-tight">
              <div class="table-responsive"><table class="table table-hover" id="taxStepsTable"></table></div>
            </div>
          </div>

          <div class="card mb-4">
            <div class="card-h" style="align-items:center">
              <div><h2>Figures</h2><div class="sub" id="taxFiguresSub"></div></div>
              <div class="row">
                <button class="btn-ghost" id="taxAddFigure"><span class="ico" data-ico="plus"></span> Add figure</button>
              </div>
            </div>
            <div class="body-pad body-pad-tight">
              <div class="table-responsive"><table class="table table-hover" id="taxFiguresTable"></table></div>
            </div>
          </div>

          <div class="card">
            <div class="card-h" style="align-items:center">
              <div><h2>Documents</h2><div class="sub" id="taxDocsSub"></div></div>
              <div class="row">
                <button class="btn-ghost" id="taxAddDoc"><span class="ico" data-ico="plus"></span> Add document</button>
              </div>
            </div>
            <div class="body-pad body-pad-tight">
              <button type="button" class="upload-area" id="taxDrop" aria-controls="taxFileInput">
                <span class="ico" data-ico="cloud-upload|upload-cloud"></span>
                <span class="ua-line">Drop a tax document here, or click to choose a file.</span>
                <span class="hint">PDFs and images are stored in the vault next to this year's tax file.</span>
              </button>
              <input type="file" id="taxFileInput" accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx,application/pdf,image/*" class="hidden">
              <div class="table-responsive" style="margin-top:14px"><table class="table table-hover" id="taxDocsTable"></table></div>
            </div>
          </div>
        </div>
      </section>

      <section id="view-savings" class="hidden">
        <div class="financial-period-banner">
          <h1 class="financial-period-banner-title">Savings &amp; Investments</h1>
          <div class="sub-note">Growth, allocation, and goals across every account</div>
        </div>
        <div class="mini-grid mini-kpis-4 mb-4" id="savingsKpis"></div>
        <div class="card mb-4" id="savingsGoalsCard">
          <div class="card-h" style="align-items:center">
            <div><h2>Goals</h2><div class="sub">Progress toward each target</div></div>
            <div class="row">
              <button class="btn-ghost" id="savAdd"><span class="ico" data-ico="plus"></span> New account</button>
            </div>
          </div>
          <div class="body-pad" id="savingsGoals"></div>
        </div>
        <div id="savingsSections"></div>
      </section>

      <section id="view-accounts" class="hidden">
        <div class="financial-period-banner">
          <h1 class="financial-period-banner-title">Accounts</h1>
          <div class="sub-note">Click a balance to update it, or a name to see that account's transactions — the account's markdown file is rewritten.</div>
        </div>
        <div class="mini-grid mini-kpis-4 mb-4" id="acctKpis"></div>
        <div class="row mb-4" style="justify-content:flex-end">
          <button class="btn-ghost" id="acctAdd"><span class="ico" data-ico="plus"></span> New account</button>
        </div>
        <div id="acctSections"></div>
      </section>

      <section id="view-debts" class="hidden">
        <div class="financial-period-banner">
          <h1 class="financial-period-banner-title">Debt</h1>
          <div class="sub-note">Balances, what the interest costs, and how fast you can be free of it · saved to <code>Debts.md</code></div>
        </div>

        <div class="mini-grid mini-kpis-4 mb-4" id="debtKpis"></div>

        <div class="card mb-4">
          <div class="card-h" style="align-items:center">
            <div><h2>Payoff plan</h2><div class="sub">Same debts, three ways of attacking them</div></div>
            <div class="row">
              <label class="text-muted" style="font-size:13px;display:inline-flex;align-items:center;gap:6px" for="debtExtra">
                Extra per month
                <input type="number" step="1" min="0" id="debtExtra" class="form-control form-control-sm" value="0" style="width:110px">
              </label>
              <select id="debtStrategy" class="form-select form-select-sm" aria-label="Payoff method">
                <option value="avalanche">Avalanche — highest rate first</option>
                <option value="snowball">Snowball — smallest balance first</option>
              </select>
            </div>
          </div>
          <div class="body-pad" id="debtPlan"></div>
          <div class="body-pad" style="padding-top:0" id="debtOrder"></div>
        </div>

        <div class="card mb-4">
          <div class="card-h" style="align-items:center">
            <div><h2>Payments this period</h2><div class="sub">Read from your transactions, matched by category</div></div>
          </div>
          <div class="body-pad" id="debtPayments"></div>
        </div>

        <div class="card">
          <div class="card-h" style="align-items:center">
            <div><h2>Debts</h2><div class="sub">Edit a balance, rate or payment and every figure above follows</div></div>
            <div class="row">
              <button class="btn-ghost" id="debtAdd"><span class="ico" data-ico="plus"></span> New debt</button>
              <button class="btn-gradient" id="debtSave" disabled>Save changes</button>
            </div>
          </div>
          <div class="body-pad body-pad-tight">
            <div class="table-responsive"><table class="table table-hover" id="debtTable"></table></div>
          </div>
        </div>
      </section>

      <section id="view-owed" class="hidden">
        <div class="financial-period-banner">
          <h1 class="financial-period-banner-title">Owed Money</h1>
          <div class="sub-note">Money owed to the household · saved to <code>Owed Money.md</code></div>
        </div>
        <div class="mini-grid mini-kpis-3 mb-4" id="owedKpis"></div>
        <div class="card">
          <div class="card-h" style="align-items:center">
            <div><h2>People</h2><div class="sub">Toggle a status or edit an amount, then save</div></div>
            <div class="row">
              <button class="btn-ghost" id="owedAdd"><span class="ico" data-ico="plus"></span> New entry</button>
              <button class="btn-gradient" id="owedSave" disabled>Save changes</button>
            </div>
          </div>
          <div class="body-pad body-pad-tight">
            <div class="table-responsive"><table class="table table-hover" id="owedTable"></table></div>
          </div>
        </div>
      </section>

      <section id="view-services" class="hidden">
        <div class="financial-period-banner">
          <h1 class="financial-period-banner-title">Services</h1>
          <div class="sub-note">Recurring services &amp; subscriptions · saved to <code>Services.md</code></div>
        </div>
        <div class="mini-grid mini-kpis-4 mb-4" id="servicesKpis"></div>
        <div class="card">
          <div class="card-h" style="align-items:center">
            <div><h2>Subscriptions</h2><div class="sub">Grouped by budget category</div></div>
            <div class="row">
              <button class="btn-ghost" id="svcAdd"><span class="ico" data-ico="plus"></span> New service</button>
              <button class="btn-gradient" id="svcSave" disabled>Save changes</button>
            </div>
          </div>
          <div class="body-pad body-pad-tight">
            <div class="table-responsive"><table class="table table-hover" id="svcTable"></table></div>
          </div>
        </div>
      </section>

      <section id="view-loans" class="hidden">
        <div class="financial-period-banner">
          <h1 class="financial-period-banner-title">Loan Calculators</h1>
          <div class="sub-note" id="loansSubNote"></div>
        </div>

        <div class="loan-tabs" id="loanTabs" role="group" aria-label="Choose a calculator">
          <button type="button" class="loan-tab is-on" id="loanTabHome" aria-pressed="true">
            <span class="ico" data-ico="house|home"></span> Home loan
          </button>
          <button type="button" class="loan-tab" id="loanTabCar" aria-pressed="false">
            <span class="ico" data-ico="car"></span> Vehicle finance
          </button>
        </div>

        <div id="loanHome">
          <div class="loan-grid mb-4">
            <div class="card">
              <div class="card-h"><div><h2>Loan details</h2><div class="sub">What you are buying and how you are paying for it</div></div></div>
              <div class="body-pad" id="loanHomeForm"></div>
            </div>
            <div class="card">
              <div class="card-h"><div><h2>Monthly repayment</h2><div class="sub">And what the loan costs over its life</div></div></div>
              <div class="body-pad" id="loanHomeOut"></div>
            </div>
          </div>

          <div class="card mb-4" id="loanHomeCostsCard">
            <div class="card-h"><div><h2>Once-off buying costs</h2><div class="sub" id="loanHomeCostsSub"></div></div></div>
            <div class="body-pad" id="loanHomeCosts"></div>
          </div>

          <div class="card">
            <div class="body-pad body-pad-tight">
              <details class="loan-amort">
                <summary>Year-by-year amortisation</summary>
                <div class="table-responsive"><table class="table" id="loanHomeAmort"></table></div>
              </details>
            </div>
          </div>
        </div>

        <div id="loanCar" class="hidden">
          <div class="loan-grid mb-4">
            <div class="card">
              <div class="card-h"><div><h2>Vehicle finance details</h2><div class="sub">Price, deposit, term and any balloon</div></div></div>
              <div class="body-pad" id="loanCarForm"></div>
            </div>
            <div class="card">
              <div class="card-h"><div><h2>Monthly repayment</h2><div class="sub">Instalment, fees and the total cost of the car</div></div></div>
              <div class="body-pad" id="loanCarOut"></div>
            </div>
          </div>

          <div class="card mb-4" id="loanCarFeesCard">
            <div class="card-h"><div><h2>Finance fees</h2><div class="sub" id="loanCarFeesSub"></div></div></div>
            <div class="body-pad" id="loanCarFees"></div>
          </div>

          <div class="card">
            <div class="body-pad body-pad-tight">
              <details class="loan-amort">
                <summary>Year-by-year amortisation</summary>
                <div class="table-responsive"><table class="table" id="loanCarAmort"></table></div>
              </details>
            </div>
          </div>
        </div>
      </section>

      <section id="view-import" class="hidden">
        <div class="financial-period-banner">
          <h1 class="financial-period-banner-title">Import CSV</h1>
          <div class="sub-note" id="importSubNote">Bank statement CSV exports — or your own CSV</div>
        </div>
        <div class="card mb-4">
          <div class="body-pad" style="padding-top:34px">
            <button type="button" class="upload-area" id="drop" aria-controls="fileInput">
              <span class="ico" data-ico="cloud-upload|upload-cloud"></span>
              <span class="ua-line">Drop a bank statement CSV here, or click to choose a file.</span>
              <span class="hint" id="importDropHint">Discovery filenames like <code>DiscoveryBank_10123456789_…​.csv</code> auto-select the account.</span>
            </button>
            <input type="file" id="fileInput" accept=".csv,text/csv" class="hidden">
            <details class="import-help">
              <summary>Not one of the supported banks? Build your own CSV</summary>
              <p>Most banks import as-is — columns are matched by header name, the layout is read
                from the rows when there's no header, and if neither works you'll be asked which
                column is which. To build your own, any CSV with a header row of
                <code>Date,Title,Amount</code> imports fine. In Google Sheets or Excel, make three columns:</p>
              <ul>
                <li><strong>Date</strong> — <code>2026-07-01</code> or <code>01/07/2026</code></li>
                <li><strong>Title</strong> — the transaction description, e.g. <code>Woolworths</code></li>
                <li><strong>Amount</strong> — negative for money out, positive for money in, e.g. <code>-249.99</code></li>
              </ul>
              <p>Then <em>File → Download → Comma-separated values (.csv)</em> in Sheets, or
                <em>File → Save As → CSV UTF-8</em> in Excel, and drop the file above.
                Separate <code>Debit</code>/<code>Credit</code> (or <code>Money Out</code>/<code>Money In</code>)
                columns also work — debits import as negative amounts.</p>
            </details>
            <div class="import-progress hidden" id="importProgress" role="status" aria-live="polite">
              <div class="ip-label"><span id="ipText">Reading statement…</span><span id="ipPct" class="num"></span></div>
              <div class="cat-bar" style="min-width:0"><i class="cat-bar-fill" id="ipBar" style="width:0%"></i></div>
            </div>
          </div>
        </div>
        <div class="card hidden" id="importMap">
          <div class="card-h" style="align-items:center">
            <div>
              <h2>Which column is which?</h2>
              <div class="sub" id="impMapNote"></div>
            </div>
            <div class="row">
              <button class="btn-ghost" id="impMapCancel">Cancel</button>
              <button class="btn-gradient" id="impMapApply">Use these columns</button>
            </div>
          </div>
          <div class="body-pad body-pad-tight">
            <div class="imp-map-fields" id="impMapFields"></div>
            <div class="table-responsive"><table class="table imp-map-preview" id="impMapPreview"></table></div>
            <div class="sub" id="impMapWarn"></div>
          </div>
        </div>
        <div class="card hidden" id="importReview">
          <div class="card-h" style="align-items:center">
            <div>
              <h2>Review import</h2>
              <div class="sub" id="impStats"></div>
              <div class="sub imp-legend" id="impLegend"></div>
              <div class="sub imp-reconcile hidden" id="impReconcile"></div>
              <div class="sub imp-nonbudget hidden" id="impNonBudget"></div>
            </div>
            <div class="row">
              <button class="btn-ghost" id="impRemap" title="Set which column is the date, description and amount">Columns wrong?</button>
              <select id="impAccount" class="form-select form-select-sm"></select>
              <label class="text-muted" style="font-size:13px;display:inline-flex;align-items:center;gap:6px">
                <input type="checkbox" id="impRemember" checked> remember new categorisations
              </label>
              <button class="btn-gradient" id="impCommit">Import rows</button>
            </div>
          </div>
          <div class="body-pad body-pad-tight">
            <div class="table-responsive"><table class="table table-hover" id="impTable"></table></div>
          </div>
        </div>
      </section>

    </main>
  </div>

  <div id="toast" role="status" aria-live="polite"></div>
`;
  module2.exports = { SHELL_HTML };
});

// src/modal.js
var require_modal = __commonJS((exports2, module2) => {
  var { Modal, Setting } = require("obsidian");
  var { el, normalizeAmount } = require_util();

  class FieldModal extends Modal {
    constructor(app, title, fields, resolve) {
      super(app);
      this.fieldDefs = fields;
      this.modalTitle = title;
      this.resolve = resolve;
      this.submitted = false;
      this.values = {};
    }
    onOpen() {
      this.titleEl.setText(this.modalTitle);
      const firstInputs = [];
      for (const f of this.fieldDefs) {
        const s = new Setting(this.contentEl).setName(f.label);
        if (f.desc)
          s.setDesc(f.desc);
        if (f.type === "select") {
          this.values[f.key] = f.value ?? f.options[0];
          s.addDropdown((d) => {
            for (const o of f.options)
              d.addOption(o.value ?? o, o.label ?? o);
            d.setValue(this.values[f.key]);
            d.onChange((v) => {
              this.values[f.key] = v;
            });
          });
        } else {
          this.values[f.key] = String(f.value ?? "");
          s.addText((t) => {
            t.setValue(this.values[f.key]);
            if (f.placeholder)
              t.setPlaceholder(f.placeholder);
            if (f.type === "number") {
              t.inputEl.type = "number";
              t.inputEl.step = "0.01";
            }
            if (f.type === "date")
              t.inputEl.type = "date";
            t.onChange((v) => {
              this.values[f.key] = v;
            });
            firstInputs.push(t.inputEl);
          });
        }
      }
      new Setting(this.contentEl).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close())).addButton((b) => b.setButtonText("OK").setCta().onClick(() => this.submit()));
      this.scope.register([], "Enter", (evt) => {
        evt.preventDefault();
        this.submit();
      });
      if (firstInputs[0])
        window.setTimeout(() => firstInputs[0].focus(), 10);
    }
    submit() {
      this.submitted = true;
      this.close();
    }
    onClose() {
      this.contentEl.empty();
      this.resolve(this.submitted ? this.values : null);
    }
  }
  function askFields(app, title, fields) {
    return new Promise((res) => new FieldModal(app, title, fields, res).open());
  }

  class ConfirmModal extends Modal {
    constructor(app, opts, resolve) {
      super(app);
      this.opts = opts;
      this.resolve = resolve;
      this.answer = false;
    }
    onOpen() {
      const { title, message, confirmText = "Discard", cancelText = "Cancel" } = this.opts;
      if (title)
        this.titleEl.setText(title);
      this.contentEl.createEl("p", { text: message });
      new Setting(this.contentEl).addButton((b) => b.setButtonText(cancelText).onClick(() => this.close())).addButton((b) => b.setButtonText(confirmText).setWarning().onClick(() => {
        this.answer = true;
        this.close();
      }));
    }
    onClose() {
      this.contentEl.empty();
      this.resolve(this.answer);
    }
  }
  function confirmModal(app, opts) {
    return new Promise((res) => new ConfirmModal(app, opts, res).open());
  }

  class SplitModal extends Modal {
    constructor(app, opts, resolve) {
      super(app);
      this.opts = opts;
      this.resolve = resolve;
      this.result = null;
      this.sign = opts.tx.amount < 0 ? -1 : 1;
      this.total = Math.abs(opts.tx.amount);
      this.parts = [
        { mag: this.total, cat: opts.tx.cat || "", note: "" },
        { mag: 0, cat: "", note: "" }
      ];
    }
    onOpen() {
      const { tx, money } = this.opts;
      this.titleEl.setText("Split transaction");
      const c = this.contentEl;
      c.append(el("div", { class: "budget-split-head" }, el("div", { class: "budget-split-desc" }, tx.desc), el("div", { class: "budget-split-meta" }, [tx.date, tx.label, money(tx.amount)].filter(Boolean).join(" · "))));
      this.partsEl = el("div", { class: "budget-split-parts" });
      c.append(this.partsEl);
      const addBtn = el("button", { type: "button", class: "budget-split-add" }, "＋ Add part");
      addBtn.addEventListener("click", () => {
        this.parts.push({ mag: Math.max(0, this.remainder()), cat: "", note: "" });
        this.renderParts();
        this.refresh();
      });
      c.append(addBtn);
      this.footEl = el("div", { class: "budget-split-foot", role: "status" });
      c.append(this.footEl);
      c.append(el("div", { class: "budget-split-hint" }, "Amounts are entered as positive — the split keeps the original’s direction. " + "The original line stays in the file marked Excluded, so the totals are unchanged " + "and re-importing this statement will not duplicate it."));
      const foot = new Setting(c);
      foot.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
      foot.addButton((b) => {
        this.okBtn = b;
        b.setButtonText("Split").setCta().onClick(() => this.submit());
      });
      this.renderParts();
      this.refresh();
    }
    allocated() {
      return Math.round(this.parts.reduce((a, p) => a + (p.mag || 0), 0) * 100) / 100;
    }
    remainder() {
      return Math.round((this.total - this.allocated()) * 100) / 100;
    }
    renderParts() {
      this.partsEl.replaceChildren();
      this.parts.forEach((p, i) => {
        const amt = el("input", {
          type: "text",
          class: "budget-split-amt",
          inputmode: "decimal",
          autocomplete: "off",
          autocorrect: "off",
          spellcheck: "false",
          value: p.mag ? p.mag.toFixed(2) : "",
          placeholder: "0.00",
          "aria-label": `Amount for part ${i + 1}`
        });
        amt.addEventListener("input", () => {
          p.mag = Math.abs(normalizeAmount(amt.value) ?? 0);
          this.refresh();
        });
        const cat = el("select", { class: "budget-split-cat", "aria-label": `Category for part ${i + 1}` });
        cat.append(el("option", { value: "" }, "— none —"));
        for (const name of this.opts.categories)
          cat.append(el("option", { value: name }, name));
        cat.value = p.cat;
        cat.addEventListener("change", () => {
          p.cat = cat.value;
        });
        const note = el("input", {
          type: "text",
          class: "budget-split-note",
          value: p.note,
          placeholder: "Note (optional)",
          "aria-label": `Note for part ${i + 1}`
        });
        note.addEventListener("input", () => {
          p.note = note.value;
        });
        const row = el("div", { class: "budget-split-part" }, amt, cat, note);
        if (this.parts.length > 2) {
          const del = el("button", {
            type: "button",
            class: "budget-split-del",
            "aria-label": `Remove part ${i + 1}`
          }, "✕");
          del.addEventListener("click", () => {
            this.parts.splice(i, 1);
            this.renderParts();
            this.refresh();
          });
          row.append(del);
        }
        this.partsEl.append(row);
      });
    }
    refresh() {
      const { money } = this.opts;
      const rem = this.remainder();
      const balanced = rem === 0;
      const allPositive = this.parts.every((p) => p.mag > 0);
      this.footEl.textContent = !balanced ? `Unallocated: ${money(this.sign * rem)}` : allPositive ? `Allocated ${money(this.sign * this.total)} — balanced` : "Every part needs an amount";
      this.footEl.classList.toggle("is-balanced", balanced && allPositive);
      this.footEl.classList.toggle("is-off", !(balanced && allPositive));
      if (this.okBtn)
        this.okBtn.setDisabled(!(balanced && allPositive));
    }
    submit() {
      if (this.remainder() !== 0 || !this.parts.every((p) => p.mag > 0))
        return;
      this.result = this.parts.map((p) => ({
        amount: parseFloat((this.sign * p.mag).toFixed(2)),
        cat: p.cat,
        note: p.note.trim()
      }));
      this.close();
    }
    onClose() {
      this.contentEl.empty();
      this.resolve(this.result);
    }
  }
  function askSplit(app, opts) {
    return new Promise((res) => new SplitModal(app, opts, res).open());
  }
  module2.exports = { FieldModal, askFields, ConfirmModal, confirmModal, SplitModal, askSplit };
});

// src/locale.js
var require_locale = __commonJS((exports2, module2) => {
  var fmtAmt = (p, v) => {
    const parts = Math.abs(v).toFixed(2).split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, p.thousands);
    return (v < 0 ? "-" : "") + p.currency + parts.join(p.decimal);
  };
  var sumCodes = (figures, ...codes) => (figures || []).filter((f) => codes.includes((f.code || "").trim())).reduce((a, f) => a + (f.amount || 0), 0);
  var ZA_INCOME_CODES = [
    "3601",
    "3605",
    "3606",
    "3610",
    "3615",
    "3616",
    "3617",
    "3699",
    "3701",
    "3702",
    "3707",
    "3713",
    "3718",
    "3801",
    "3802",
    "3805",
    "3806",
    "3808",
    "3810"
  ];
  var reconcileAssessed = (p, figures, t, employmentCodes) => {
    if (!t || t.assessment !== "assessed" || typeof t.assessment_income !== "number")
      return [];
    if (!employmentCodes || !employmentCodes.length)
      return [];
    const fmt = (v) => fmtAmt(p, v);
    const rows = (figures || []).filter((f) => (f.amount || 0) > 0);
    if (!rows.length)
      return [];
    const employment = sumCodes(figures, ...employmentCodes);
    const others = rows.filter((f) => !employmentCodes.includes((f.code || "").trim()));
    const msgs = [];
    if (employment > 0 && t.assessment_income < employment - 1) {
      msgs.push({ ok: false, text: `Assessed taxable income ${fmt(t.assessment_income)} is below your captured employment income ${fmt(employment)} — check the assessment against your certificates.` });
    } else if (employment > 0 && Math.abs(t.assessment_income - employment) <= 1 && others.length) {
      msgs.push({ ok: false, text: `Assessed taxable income ${fmt(t.assessment_income)} matches your employment income exactly, so none of the other ${others.length} captured figure${others.length === 1 ? "" : "s"} reached it. Confirm each was exempt rather than omitted — if any was trade income, a correction is due before the deadline.` });
    } else if (employment > 0) {
      msgs.push({ ok: true, text: `Assessed taxable income ${fmt(t.assessment_income)} is consistent with the ${fmt(employment)} of employment income captured.` });
    }
    return msgs;
  };
  var genericTax = (authority) => ({
    authority,
    taxIntro: `Track a ${authority === "Tax" ? "tax" : authority} return season here — progress steps, the documents you need and where each one comes from, with the files themselves stored in your vault.`,
    yearHint: "Tax year (calendar year)",
    figureCodeLabel: "Code",
    yearSpan: (y) => `Jan – Dec ${y}`,
    currentTaxYear: (now) => now.getMonth() + 1 <= 4 ? now.getFullYear() - 1 : now.getFullYear(),
    seedDeadlines: () => ({ deadline_standard: "", deadline_provisional: "" }),
    deadlineLabels: ["Deadline", "Alternative deadline"],
    activeDeadline: (t) => t.deadline_standard || t.deadline_provisional,
    defaultTaxpayerType: "unknown",
    defaultAssessment: "unknown",
    taxpayerTypes: [
      ["provisional", "Self-employed / files a return"],
      ["standard", "Tax withheld by employer"],
      ["unknown", "Unknown"]
    ],
    assessments: [
      ["submit-requested", "Return required"],
      ["auto-assessed", "No return required this year"],
      ["assessed", "Assessed — notice received"],
      ["unknown", "Not checked yet"]
    ],
    figureChecks() {
      return [];
    },
    seasonMsgs(t) {
      const msgs = [];
      if (t.assessment === "submit-requested")
        msgs.push("A return is required — work through the steps below.");
      else if (t.assessment === "auto-assessed")
        msgs.push("Marked as no return required this year — keep the documents anyway in case that changes.");
      else
        msgs.push("Check with your tax authority whether you need to file a return this year.");
      if (t.taxpayer_type === "provisional")
        msgs.push("Self-employment or untaxed income usually means extra payments during the year — check your authority's schedule.");
      return msgs;
    },
    safetyNote: "Always type your tax authority's web address into the browser yourself — tax authorities never ask for passwords or OTPs by email, SMS or phone.",
    seedSteps: () => [
      { step: "Confirm whether you must file a return", notes: "" },
      { step: "Gather income statements", notes: "Employer certificates, bank interest, investment statements" },
      { step: "Gather deduction records", notes: "Receipts for anything claimable — medical, donations, work expenses" },
      { step: "Complete the return", notes: "" },
      { step: "Submit before the deadline", notes: "" },
      { step: "Pay any balance due", notes: "" },
      { step: "Respond to tax authority queries", notes: "" }
    ],
    seedDocs: () => [
      { name: "Employment income statement", source: "Employer", notes: "" },
      { name: "Bank interest statement", source: "Your bank", notes: "One per bank" },
      { name: "Investment income statements", source: "Investment provider", notes: "" },
      { name: "Deduction receipts", source: "Own records", notes: "" },
      { name: "Letters & notices", source: "Tax authority", notes: "" }
    ]
  });
  var PROFILES = {
    za: {
      label: "South Africa",
      currency: "R",
      thousands: " ",
      decimal: ",",
      dayFirst: true,
      stripDescSuffix: " ZA",
      banks: "Discovery, FNB, Capitec, Nedbank",
      importHint: null,
      authority: "SARS",
      taxIntro: "Track a SARS return season here — progress steps, the documents you need (IRP5, IT3(b), medical certificate, …) and the files themselves, stored in the vault.",
      yearHint: "Tax year (ends Feb of this year)",
      figureCodeLabel: "Source code",
      yearSpan: (y) => `1 Mar ${y - 1} – end Feb ${y}`,
      currentTaxYear: (now) => now.getMonth() + 1 >= 3 ? now.getFullYear() : now.getFullYear() - 1,
      seedDeadlines: (y) => ({ deadline_standard: `${y}-10-23`, deadline_provisional: `${y + 1}-01-22` }),
      deadlineLabels: ["Deadline (standard)", "Deadline (provisional)"],
      activeDeadline: (t) => t.taxpayer_type === "standard" ? t.deadline_standard : t.deadline_provisional,
      defaultTaxpayerType: "provisional",
      defaultAssessment: "submit-requested",
      taxpayerTypes: [
        ["provisional", "Provisional"],
        ["standard", "Standard"],
        ["unknown", "Unknown — confirm on eFiling"]
      ],
      assessments: [
        ["submit-requested", "SARS asked me to submit"],
        ["auto-assessed", "Auto-assessed"],
        ["assessed", "Assessed — ITA34 received"],
        ["unknown", "Not checked yet"]
      ],
      figureChecks(figures, year, t) {
        const fmt = (v) => fmtAmt(this, v);
        const msgs = [];
        const localInterest = sumCodes(figures, "4201");
        if (localInterest > 0) {
          const exempt = 23800;
          msgs.push(localInterest <= exempt ? { ok: true, text: `Local interest ${fmt(localInterest)} is under the ${fmt(exempt)} under-65 exemption — ${fmt(exempt - localInterest)} of headroom.` } : { ok: false, text: `Local interest ${fmt(localInterest)} exceeds the ${fmt(exempt)} under-65 exemption — ${fmt(localInterest - exempt)} is taxable.` });
        }
        const foreignInterest = sumCodes(figures, "4218");
        if (foreignInterest > 0) {
          msgs.push({ ok: true, text: `Foreign interest ${fmt(foreignInterest)} gets no exemption — declare it separately from local interest.` });
        }
        const tfsa = sumCodes(figures, "4219");
        if (tfsa > 36000) {
          msgs.push({ ok: false, text: `TFSA contributions ${fmt(tfsa)} exceed the ${fmt(36000)} annual limit — 40% penalty on the ${fmt(tfsa - 36000)} excess.` });
        } else if (tfsa > 0) {
          msgs.push({ ok: true, text: `TFSA ${fmt(tfsa)} of ${fmt(36000)} used — ${fmt(36000 - tfsa)} of headroom before the year closes.` });
        }
        const gains = sumCodes(figures, "4250");
        if (gains > 40000) {
          msgs.push({ ok: false, text: `Capital gains ${fmt(gains)} exceed the ${fmt(40000)} annual exclusion — ${fmt(gains - 40000)} feeds into taxable income.` });
        } else if (gains > 0) {
          msgs.push({ ok: true, text: `Capital gains ${fmt(gains)} are under the ${fmt(40000)} annual exclusion.` });
        }
        return msgs.concat(reconcileAssessed(this, figures, t, ZA_INCOME_CODES));
      },
      seasonMsgs(t) {
        const msgs = [];
        if (t.assessment === "submit-requested") {
          msgs.push("SARS has asked for a return — you were not auto-assessed. Work through the steps below and file the ITR12 on eFiling.");
        } else if (t.assessment === "auto-assessed") {
          msgs.push("SARS auto-assessed this year. Check the assessment on eFiling — if income is missing or you disagree, file an ITR12 before the deadline; otherwise nothing more may be needed.");
        } else {
          msgs.push("Check your auto-assessment status on the eFiling dashboard — SARS either auto-calculates or asks you to submit, depending on your income mix.");
        }
        if (t.taxpayer_type === "provisional") {
          msgs.push("As a provisional taxpayer you also file IRP6 returns twice a year — they are in the steps below.");
        } else if (t.taxpayer_type === "unknown") {
          msgs.push('Salary plus freelance income usually means provisional taxpayer — confirm under "Maintain Registered Particulars" on eFiling.');
        }
        return msgs;
      },
      safetyNote: "Always type sars.gov.za into the browser yourself — SARS never asks for passwords or OTPs by email, SMS or phone.",
      seedSteps: (year) => [
        { step: "Confirm taxpayer status on eFiling", notes: "Maintain Registered Particulars — provisional vs standard" },
        { step: "Check auto-assessment status on the eFiling dashboard", notes: "" },
        { step: "Gather documents", notes: "See the Documents list below" },
        { step: "Open the ITR12 return on eFiling", notes: "sars.gov.za or the SARS MobiApp" },
        { step: "Review pre-populated data", notes: "IRP5, medical certificate, bank IT3(b)s — check both banks reflect" },
        { step: "Add freelance income & deductible expenses", notes: "Invoiced total; home office %, software, equipment, internet/phone portion, accounting fees" },
        { step: "Declare investment income", notes: "IT3(b)/IT3(c) from your investment provider: interest, dividends, capital gains on sales" },
        { step: "Declare TFSA contributions", notes: "Contribution certificate; check R36 000/yr & R500 000 lifetime limits" },
        { step: "Claim out-of-pocket medical expenses", notes: "Qualifying expenses not covered by the aid" },
        { step: "Submit the ITR12", notes: "" },
        { step: "Check the ITA34 against your own figures", notes: "Assessed taxable income should account for every income figure you captured — anything missing was either exempt or omitted" },
        { step: "Decide on a Request for Correction", due: `${year}-10-23`, notes: "Only if something was left out — undeclared trade income is the one with real consequence" },
        { step: "Respond to SARS verification requests", notes: "Within the timeframe SARS gives" },
        { step: `IRP6 provisional return ${year + 1} — period 1`, due: `${year}-08-31`, notes: "Provisional taxpayers only — mark N/A if standard" },
        { step: `IRP6 provisional return ${year + 1} — period 2`, due: `${year + 1}-02-28`, notes: "Provisional taxpayers only — mark N/A if standard" }
      ],
      seedDocs: () => [
        { name: "IRP5 / IT3(a) employee certificate", source: "Employer", notes: "Usually pre-populated" },
        { name: "IT3(b) interest certificate", source: "Your bank", notes: "One per bank you hold accounts with" },
        { name: "IT3(b) interest certificate", source: "Your second bank", notes: "Remove if not applicable" },
        { name: "IT3(b) investment income certificate", source: "Investment provider", notes: "Interest, dividends, REIT distributions" },
        { name: "IT3(c) capital gains statement", source: "Investment provider", notes: "Disposals during the year — remove if nothing was sold" },
        { name: "IT3(s) TFSA contribution certificate", source: "Investment provider", notes: "Growth is exempt; contributions still declared" },
        { name: "Medical aid tax certificate", source: "Medical aid scheme", notes: "Usually pre-populated" },
        { name: "Out-of-pocket medical expenses summary", source: "Own records", notes: "" },
        { name: "Invoiced income summary", source: "Freelance business", notes: "Total invoiced for the tax year" },
        { name: "Business expense records", source: "Freelance business", notes: "Home office, software, equipment, internet/phone, accounting" },
        { name: "SARS letters & notices", source: "SARS", notes: "" }
      ]
    },
    us: {
      label: "United States",
      currency: "$",
      thousands: ",",
      decimal: ".",
      dayFirst: false,
      banks: "Chase, Bank of America, Wells Fargo, Citi, Capital One",
      importHint: "Any CSV with a Date, Description and Amount (or Debit/Credit) header row works.",
      authority: "IRS",
      taxIntro: "Track an IRS filing season here — progress steps, the documents you need (W-2, 1099s, 1098, …) and the files themselves, stored in the vault.",
      yearHint: "Tax year (calendar year)",
      figureCodeLabel: "Form line",
      yearSpan: (y) => `Jan – Dec ${y}`,
      currentTaxYear: (now) => now.getMonth() + 1 <= 4 ? now.getFullYear() - 1 : now.getFullYear(),
      seedDeadlines: (y) => ({ deadline_standard: `${y + 1}-04-15`, deadline_provisional: `${y + 1}-10-15` }),
      deadlineLabels: ["Filing deadline", "Extension deadline"],
      activeDeadline: (t) => t.deadline_standard,
      defaultTaxpayerType: "unknown",
      defaultAssessment: "submit-requested",
      taxpayerTypes: [
        ["provisional", "Pays estimated tax (1040-ES)"],
        ["standard", "Withholding only (W-2)"],
        ["unknown", "Unknown"]
      ],
      assessments: [
        ["submit-requested", "Return required"],
        ["auto-assessed", "Not required to file this year"],
        ["assessed", "Assessed — IRS notice received"],
        ["unknown", "Not checked yet"]
      ],
      figureChecks() {
        return [];
      },
      seasonMsgs(t) {
        const msgs = [];
        if (t.assessment === "auto-assessed")
          msgs.push("Marked as not required to file — most people with income above the standard deduction still are, so keep the documents in case that changes.");
        else
          msgs.push("Work through the steps below and file Form 1040 by the April deadline. An extension (Form 4868) extends filing to October, but any balance is still due in April.");
        if (t.taxpayer_type === "provisional")
          msgs.push("You also make quarterly estimated payments — the 1040-ES steps are below.");
        else if (t.taxpayer_type === "unknown")
          msgs.push("Freelance or side income with no withholding usually means quarterly estimated payments (Form 1040-ES).");
        return msgs;
      },
      safetyNote: "Always type irs.gov into the browser yourself — the IRS never initiates contact by email, SMS or phone to ask for personal or payment details.",
      seedSteps: (year) => [
        { step: "Gather income documents", notes: "W-2s and 1099s — most arrive by end of January" },
        { step: "Decide standard vs itemized deduction", notes: "Itemize only if mortgage interest + SALT + charity beat the standard deduction" },
        { step: "Report freelance / self-employment income", notes: "Schedule C income minus business expenses; Schedule SE for self-employment tax" },
        { step: "Report investment income", notes: "1099-INT, 1099-DIV, 1099-B — interest, dividends, capital gains" },
        { step: "Check IRA / HSA contributions", notes: "Prior-year contributions allowed until the filing deadline" },
        { step: "File Form 1040", notes: "IRS Free File, tax software, or a preparer — e-file with direct deposit is fastest" },
        { step: "Pay any balance due", notes: "Due by the April deadline even if you file an extension" },
        { step: "Respond to IRS notices", notes: "Within the timeframe on the letter" },
        { step: `1040-ES estimated payment ${year + 1} — Q1`, due: `${year + 1}-04-15`, notes: "Estimated-tax payers only — mark N/A if withholding covers you" },
        { step: `1040-ES estimated payment ${year + 1} — Q2`, due: `${year + 1}-06-15`, notes: "Estimated-tax payers only — mark N/A if withholding covers you" }
      ],
      seedDocs: () => [
        { name: "W-2 wage statement", source: "Employer", notes: "One per employer" },
        { name: "1099-NEC / 1099-K freelance income", source: "Clients / platforms", notes: "" },
        { name: "1099-INT interest statement", source: "Your bank", notes: "One per bank" },
        { name: "1099-DIV / 1099-B investment statements", source: "Broker", notes: "Dividends, sales, capital gains" },
        { name: "1098 mortgage interest statement", source: "Mortgage lender", notes: "If itemizing" },
        { name: "HSA forms (5498-SA / 1099-SA)", source: "HSA custodian", notes: "" },
        { name: "Charitable donation receipts", source: "Own records", notes: "If itemizing" },
        { name: "Business expense records", source: "Own records", notes: "Home office, software, equipment, mileage" },
        { name: "Prior-year return", source: "Own records", notes: "For AGI and carryovers" },
        { name: "IRS letters & notices", source: "IRS", notes: "" }
      ]
    },
    uk: {
      label: "United Kingdom",
      currency: "£",
      thousands: ",",
      decimal: ".",
      dayFirst: true,
      banks: "Barclays, HSBC, Lloyds, NatWest, Monzo, Starling",
      importHint: "Any CSV with a Date, Description and Amount (or Debit/Credit) header row works.",
      authority: "HMRC",
      taxIntro: "Track an HMRC Self Assessment season here — progress steps, the documents you need (P60, P11D, interest statements, …) and the files themselves, stored in the vault.",
      yearHint: "Tax year (ends 5 Apr of this year)",
      figureCodeLabel: "Box",
      yearSpan: (y) => `6 Apr ${y - 1} – 5 Apr ${y}`,
      currentTaxYear: (now) => now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1,
      seedDeadlines: (y) => ({ deadline_standard: `${y + 1}-01-31`, deadline_provisional: `${y}-10-31` }),
      deadlineLabels: ["Online filing deadline", "Paper filing deadline"],
      activeDeadline: (t) => t.deadline_standard,
      defaultTaxpayerType: "unknown",
      defaultAssessment: "unknown",
      taxpayerTypes: [
        ["provisional", "Self Assessment"],
        ["standard", "PAYE only"],
        ["unknown", "Unknown — check on gov.uk"]
      ],
      assessments: [
        ["submit-requested", "Notice to file received"],
        ["auto-assessed", "Not required (PAYE settles it)"],
        ["assessed", "Assessed — SA302 / calculation received"],
        ["unknown", "Not checked yet"]
      ],
      figureChecks() {
        return [];
      },
      seasonMsgs(t) {
        const msgs = [];
        if (t.assessment === "submit-requested")
          msgs.push("HMRC expects a Self Assessment return — file the SA100 online by 31 January and pay what's due the same day.");
        else if (t.assessment === "auto-assessed")
          msgs.push("PAYE should settle your tax this year. Keep the documents anyway — untaxed income over the allowances would mean registering for Self Assessment.");
        else
          msgs.push('Use the "Check if you need to send a Self Assessment tax return" tool on gov.uk — register by 5 October if you do.');
        if (t.taxpayer_type === "provisional")
          msgs.push("Payments on account may be due on 31 January and 31 July if your last bill was over £1,000.");
        return msgs;
      },
      safetyNote: "Always type gov.uk into the browser yourself — HMRC never asks for passwords or bank details by email or SMS.",
      seedSteps: () => [
        { step: "Check if you need to file / register for Self Assessment", notes: "gov.uk tool; register by 5 Oct if new — you need your UTR" },
        { step: "Gather employment documents", notes: "P60 (or P45 if you changed jobs), P11D for benefits" },
        { step: "Gather bank interest & dividend statements", notes: "Interest over the savings allowance and dividends over the allowance are taxable" },
        { step: "Total self-employment income & expenses", notes: "Invoiced total minus allowable expenses; check the £1,000 trading allowance" },
        { step: "Claim reliefs", notes: "Pension contributions, Gift Aid donations, marriage allowance" },
        { step: "File the SA100 online", notes: "gov.uk — sign in with your Government Gateway ID" },
        { step: "Pay the balance (and first payment on account)", due: "", notes: "Both due 31 January" },
        { step: "Second payment on account", notes: "Due 31 July, if payments on account apply" },
        { step: "Respond to HMRC queries", notes: "" }
      ],
      seedDocs: () => [
        { name: "P60 end-of-year certificate", source: "Employer", notes: "" },
        { name: "P45 (if you changed jobs)", source: "Previous employer", notes: "Remove if not applicable" },
        { name: "P11D benefits statement", source: "Employer", notes: "Remove if not applicable" },
        { name: "Bank interest statements", source: "Your bank", notes: "One per bank" },
        { name: "Dividend vouchers", source: "Broker / companies", notes: "" },
        { name: "Self-employment income & expense records", source: "Own records", notes: "" },
        { name: "Pension contribution statement", source: "Pension provider", notes: "" },
        { name: "Gift Aid donation summary", source: "Own records", notes: "" },
        { name: "HMRC letters & notices", source: "HMRC", notes: "" }
      ]
    },
    eu: {
      label: "Eurozone (generic)",
      currency: "€",
      thousands: ".",
      decimal: ",",
      dayFirst: true,
      banks: null,
      importHint: "Any CSV with a Date, Description and Amount (or Debit/Credit) header row works.",
      ...genericTax("Tax")
    },
    au: {
      label: "Australia",
      currency: "$",
      thousands: ",",
      decimal: ".",
      dayFirst: true,
      banks: "CommBank, Westpac, ANZ, NAB",
      importHint: "Any CSV with a Date, Description and Amount (or Debit/Credit) header row works.",
      authority: "ATO",
      taxIntro: "Track an ATO tax-return season here — progress steps, the documents you need (income statement, dividend statements, deduction receipts, …) and the files themselves, stored in the vault.",
      yearHint: "Tax year (ends 30 Jun of this year)",
      figureCodeLabel: "Label",
      yearSpan: (y) => `1 Jul ${y - 1} – 30 Jun ${y}`,
      currentTaxYear: (now) => now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1,
      seedDeadlines: (y) => ({ deadline_standard: `${y}-10-31`, deadline_provisional: `${y + 1}-05-15` }),
      deadlineLabels: ["Self-lodgement deadline", "Tax agent deadline (typical)"],
      activeDeadline: (t) => t.deadline_standard,
      defaultTaxpayerType: "unknown",
      defaultAssessment: "submit-requested",
      taxpayerTypes: [
        ["provisional", "PAYG instalments"],
        ["standard", "PAYG withholding only"],
        ["unknown", "Unknown"]
      ],
      assessments: [
        ["submit-requested", "Return required"],
        ["auto-assessed", "Non-lodgment advice (no return needed)"],
        ["assessed", "Assessed — notice of assessment received"],
        ["unknown", "Not checked yet"]
      ],
      figureChecks() {
        return [];
      },
      seasonMsgs(t) {
        const msgs = [];
        if (t.assessment === "auto-assessed")
          msgs.push("Lodge a non-lodgment advice on myGov so the ATO knows no return is coming.");
        else
          msgs.push("Wait for pre-fill to complete (usually late July) before lodging through myTax on myGov — lodge by 31 October, or engage a tax agent before then for a later deadline.");
        if (t.taxpayer_type === "provisional")
          msgs.push("PAYG instalments are usually paid quarterly through the year — the ATO issues the activity statements.");
        return msgs;
      },
      safetyNote: "Always type ato.gov.au or my.gov.au into the browser yourself — the ATO never asks for passwords or payment by email, SMS or phone.",
      seedSteps: () => [
        { step: "Confirm your income statement is tax-ready", notes: "Employers finalise Single Touch Payroll by mid-July" },
        { step: "Wait for pre-fill to complete", notes: "Bank interest, dividends and health-fund data flow in by late July" },
        { step: "Gather deduction records", notes: "Work-related expenses, working-from-home diary/logbook, donations" },
        { step: "Declare investment income", notes: "Interest, dividends (with franking credits), capital gains on sales" },
        { step: "Add private health insurance details", notes: "Statement pre-fills; affects the Medicare levy surcharge" },
        { step: "Lodge through myTax on myGov", notes: "Or via a registered tax agent" },
        { step: "Check the notice of assessment & pay any balance", notes: "" },
        { step: "Respond to ATO queries", notes: "" }
      ],
      seedDocs: () => [
        { name: "Income statement (STP)", source: "Employer via myGov", notes: "Wait until marked tax-ready" },
        { name: "Bank interest summary", source: "Your bank", notes: "One per bank" },
        { name: "Dividend statements", source: "Broker / registries", notes: "Include franking credits" },
        { name: "Private health insurance statement", source: "Health fund", notes: "" },
        { name: "Work-related deduction receipts", source: "Own records", notes: "Including working-from-home records" },
        { name: "Capital gains records", source: "Broker / own records", notes: "For any assets sold" },
        { name: "ATO letters & notices", source: "ATO", notes: "" }
      ]
    },
    ca: {
      label: "Canada",
      currency: "$",
      thousands: ",",
      decimal: ".",
      dayFirst: false,
      banks: "RBC, TD, Scotiabank, BMO, CIBC",
      importHint: "Any CSV with a Date, Description and Amount (or Debit/Credit) header row works.",
      authority: "CRA",
      taxIntro: "Track a CRA tax-filing season here — progress steps, the documents you need (T4, T5, RRSP receipts, …) and the files themselves, stored in the vault.",
      yearHint: "Tax year (calendar year)",
      figureCodeLabel: "Line",
      yearSpan: (y) => `Jan – Dec ${y}`,
      currentTaxYear: (now) => now.getMonth() + 1 <= 4 ? now.getFullYear() - 1 : now.getFullYear(),
      seedDeadlines: (y) => ({ deadline_standard: `${y + 1}-04-30`, deadline_provisional: `${y + 1}-06-15` }),
      deadlineLabels: ["Filing deadline", "Self-employed deadline"],
      activeDeadline: (t) => t.taxpayer_type === "provisional" ? t.deadline_provisional : t.deadline_standard,
      defaultTaxpayerType: "unknown",
      defaultAssessment: "submit-requested",
      taxpayerTypes: [
        ["provisional", "Self-employed / pays instalments"],
        ["standard", "Employee (T4 only)"],
        ["unknown", "Unknown"]
      ],
      assessments: [
        ["submit-requested", "Return required"],
        ["auto-assessed", "No return needed this year"],
        ["assessed", "Assessed — notice of assessment received"],
        ["unknown", "Not checked yet"]
      ],
      figureChecks() {
        return [];
      },
      seasonMsgs(t) {
        const msgs = [];
        if (t.assessment === "auto-assessed")
          msgs.push("Even with no tax owing, filing keeps benefit and credit payments (GST/HST credit, CCB) flowing — consider filing anyway.");
        else
          msgs.push("Work through the steps below and file by 30 April. Self-employed filers have until 15 June, but any balance is still due 30 April.");
        if (t.taxpayer_type === "provisional")
          msgs.push("The CRA may require quarterly instalments if you owe more than $3,000 in two consecutive years.");
        return msgs;
      },
      safetyNote: "Always type canada.ca into the browser yourself — the CRA never demands payment or asks for credentials by email, SMS or phone.",
      seedSteps: () => [
        { step: "Gather tax slips", notes: "T4, T5, T3, T4A — most arrive by end of February; also in CRA My Account" },
        { step: "Total RRSP contributions", notes: "Including first-60-days contributions; check your deduction limit" },
        { step: "Gather receipts", notes: "Medical, donations, childcare, tuition" },
        { step: "Total self-employment income & expenses", notes: "Form T2125 — income minus business expenses" },
        { step: "File via NETFILE-certified software", notes: "Auto-fill my return pulls slips from CRA My Account" },
        { step: "Pay any balance due", notes: "Due 30 April even if filing by the self-employed deadline" },
        { step: "Check the notice of assessment", notes: "Confirms refund/balance and next year's RRSP room" },
        { step: "Respond to CRA review requests", notes: "" }
      ],
      seedDocs: () => [
        { name: "T4 employment income slip", source: "Employer", notes: "One per employer" },
        { name: "T5 investment income slip", source: "Your bank / broker", notes: "" },
        { name: "T3 trust income slip", source: "Fund provider", notes: "Remove if not applicable" },
        { name: "T4A pension / self-employment slip", source: "Payer", notes: "Remove if not applicable" },
        { name: "RRSP contribution receipts", source: "Financial institution", notes: "Including first-60-days" },
        { name: "Medical expense receipts", source: "Own records", notes: "" },
        { name: "Donation receipts", source: "Own records", notes: "" },
        { name: "Business income & expense records", source: "Own records", notes: "If self-employed" },
        { name: "CRA letters & notices", source: "CRA", notes: "" }
      ]
    },
    cn: {
      label: "China (mainland)",
      currency: "¥",
      thousands: ",",
      decimal: ".",
      dayFirst: false,
      banks: "ICBC, China Construction Bank, Agricultural Bank of China, Bank of China, China Merchants Bank",
      importHint: "Any CSV with a Date, Description and Amount (or Debit/Credit) header row works.",
      authority: "STA",
      taxIntro: "Track a China Individual Income Tax (IIT) annual reconciliation here — progress steps, the documents you need and the files themselves, stored in the vault. Filing is through the 个人所得税 app or etax.chinatax.gov.cn.",
      yearHint: "Tax year (calendar year)",
      figureCodeLabel: "Item",
      yearSpan: (y) => `Jan – Dec ${y}`,
      currentTaxYear: (now) => now.getMonth() + 1 <= 6 ? now.getFullYear() - 1 : now.getFullYear(),
      seedDeadlines: (y) => ({ deadline_standard: `${y + 1}-06-30`, deadline_provisional: `${y + 1}-03-01` }),
      deadlineLabels: ["Reconciliation deadline", "Reconciliation window opens"],
      activeDeadline: (t) => t.deadline_standard,
      defaultTaxpayerType: "unknown",
      defaultAssessment: "unknown",
      taxpayerTypes: [
        ["provisional", "Business / freelance income (prepaid, trued up annually)"],
        ["standard", "Employer withholds monthly"],
        ["unknown", "Unknown — check in the 个人所得税 app"]
      ],
      assessments: [
        ["submit-requested", "Annual reconciliation required"],
        ["auto-assessed", "Exempt from reconciliation"],
        ["assessed", "Settled — reconciliation result received"],
        ["unknown", "Not checked yet"]
      ],
      figureChecks() {
        return [];
      },
      seasonMsgs(t) {
        const msgs = [];
        if (t.assessment === "submit-requested")
          msgs.push("The annual IIT reconciliation (汇算清缴) is required — complete it in the 个人所得税 app between 1 March and 30 June of the following year.");
        else if (t.assessment === "auto-assessed")
          msgs.push("You appear exempt from the annual reconciliation (single employer, income within the threshold, or tax already settled monthly). Keep records anyway — a second income source can change that.");
        else
          msgs.push("Check in the 个人所得税 app whether you need the annual reconciliation — multiple income sources or under-withheld tax usually mean yes.");
        if (t.taxpayer_type === "provisional")
          msgs.push("Business or labour-service income is usually prepaid monthly or quarterly and trued up in the annual reconciliation.");
        return msgs;
      },
      safetyNote: "Always type chinatax.gov.cn or open the official 个人所得税 app yourself — the STA never asks for passwords or verification codes by SMS, email or phone.",
      seedSteps: (year) => [
        { step: "Confirm whether you must do the annual reconciliation", notes: "个人所得税 app → 办税 → 综合所得年度汇算" },
        { step: "Check pre-filled comprehensive income", notes: "Wages, labour remuneration, author's remuneration and royalties pre-fill" },
        { step: "Confirm special additional deductions", notes: "Children's education, housing loan interest or rent, elderly care, continuing education, infant care under 3, serious-illness medical" },
        { step: "Declare other comprehensive income", notes: "Freelance / labour-service income from other payers not already withheld" },
        { step: "Declare investment or overseas income", notes: "Interest, dividends and any taxable foreign income — remove if not applicable" },
        { step: "Submit the annual reconciliation", due: `${year + 1}-06-30`, notes: "1 Mar – 30 Jun, in the app or on etax.chinatax.gov.cn" },
        { step: "Claim the refund or pay the balance due", notes: "Refunds pay to your linked bank card; balances due by 30 June" },
        { step: "Respond to STA queries", notes: "" }
      ],
      seedDocs: () => [
        { name: "Comprehensive-income withholding records", source: "Employer / payers", notes: "Pre-fills in the 个人所得税 app" },
        { name: "Labour-service / author-remuneration / royalty records", source: "Other payers", notes: "Remove if not applicable" },
        { name: "Special additional deduction records", source: "Own records", notes: "Education, housing, elderly/infant care, medical" },
        { name: "Housing loan interest or rent records", source: "Bank / landlord", notes: "" },
        { name: "Investment income records", source: "Bank / broker", notes: "If applicable" },
        { name: "Overseas income records", source: "Own records", notes: "Remove if not applicable" },
        { name: "STA letters & notices", source: "STA", notes: "" }
      ]
    },
    other: {
      label: "Other / not listed",
      currency: "$",
      thousands: ",",
      decimal: ".",
      dayFirst: true,
      banks: null,
      importHint: "Any CSV with a Date, Description and Amount (or Debit/Credit) header row works.",
      ...genericTax("Tax")
    }
  };
  var COUNTRY_ORDER = ["za", "us", "uk", "eu", "au", "ca", "cn", "other"];
  function localeFor(code) {
    return PROFILES[(code || "za").toString().trim().toLowerCase()] || PROFILES.za;
  }
  module2.exports = { PROFILES, COUNTRY_ORDER, localeFor };
});

// src/io.js
var require_io = __commonJS((exports2, module2) => {
  var { normalizePath, TFile, TFolder } = require("obsidian");
  var { collapsePath } = require_util();
  module2.exports = function registerIo(ctx) {
    const { vault, plugin } = ctx;
    const stampWrite = () => {
      plugin._lastWrite = Date.now();
    };
    const basePath = () => normalizePath(plugin.settings.budgetFolder);
    const relPath = (p) => normalizePath(basePath() + "/" + p);
    async function ensureFolder(path) {
      if (!path || path === "/")
        return;
      if (vault.getAbstractFileByPath(path))
        return;
      await ensureFolder(path.split("/").slice(0, -1).join("/"));
      try {
        await vault.createFolder(path);
      } catch (e) {}
    }
    async function readFile(rel) {
      const f = vault.getFileByPath(relPath(rel));
      return f ? await vault.cachedRead(f) : null;
    }
    function guardedPath(rel) {
      const path = relPath(rel);
      const resolved = collapsePath(path);
      const base = collapsePath(basePath());
      if (resolved === null || resolved !== base && !resolved.startsWith(base + "/")) {
        throw new Error(`Refused write outside the budget folder: ${rel}`);
      }
      return path;
    }
    async function writeFile(rel, content) {
      const path = guardedPath(rel);
      stampWrite();
      const f = vault.getFileByPath(path);
      if (f) {
        await vault.modify(f, content);
      } else {
        await ensureFolder(path.split("/").slice(0, -1).join("/"));
        await vault.create(path, content);
      }
      stampWrite();
    }
    async function writeBinary(rel, data) {
      const path = guardedPath(rel);
      stampWrite();
      const f = vault.getFileByPath(path);
      if (f) {
        await vault.modifyBinary(f, data);
      } else {
        await ensureFolder(path.split("/").slice(0, -1).join("/"));
        await vault.createBinary(path, data);
      }
      stampWrite();
    }
    function fileAt(rel) {
      return vault.getFileByPath(relPath(rel));
    }
    function mdFilesIn(rel) {
      const f = vault.getFolderByPath(relPath(rel));
      if (!f)
        return [];
      return f.children.filter((c) => c instanceof TFile && c.extension === "md");
    }
    function subfoldersIn(rel) {
      const f = vault.getFolderByPath(relPath(rel));
      if (!f)
        return [];
      return f.children.filter((c) => c instanceof TFolder);
    }
    ctx.provide({
      basePath,
      relPath,
      readFile,
      writeFile,
      writeBinary,
      fileAt,
      mdFilesIn,
      subfoldersIn,
      ensureFolder,
      lastWriteAt: () => plugin._lastWrite || 0
    });
  };
});

// src/period.js
var require_period = __commonJS((exports2, module2) => {
  var { MONTHS } = require_constants();
  var { safeSeg, periodDaysOrZero, isoDayNumber: dayNum } = require_util();
  var MONTH_KEY = /^\d{4}-\d{2}$/;
  var DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
  var DAY = 86400000;
  function isoFromDayNum(n) {
    const d = new Date(n * DAY);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  module2.exports = function registerPeriod(ctx) {
    const { S } = ctx;
    function intervalDays() {
      return S.settings.period_anchor ? periodDaysOrZero(S.settings.period_days) : 0;
    }
    function periodStartOnOrBefore(day, iv) {
      const a = dayNum(S.settings.period_anchor);
      return a + Math.floor((day - a) / iv) * iv;
    }
    function periodKeyValid(p) {
      if (typeof p !== "string")
        return false;
      return intervalDays() ? DATE_KEY.test(p) : MONTH_KEY.test(p);
    }
    function periodRange(p) {
      const iv = intervalDays();
      if (iv && DATE_KEY.test(p)) {
        return { start: p, end: isoFromDayNum(dayNum(p) + iv - 1) };
      }
      const [y, m] = p.split("-").map(Number);
      const n = S.settings.month_start_day;
      if (n === 1) {
        return { start: `${p}-01`, end: `${p}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}` };
      }
      const sd = new Date(y, m - 2, n);
      const ed = new Date(y, m - 1, n - 1);
      const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return { start: f(sd), end: f(ed) };
    }
    function currentPeriod() {
      const now = new Date;
      const iv = intervalDays();
      if (iv) {
        const today = dayNum(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
        return isoFromDayNum(periodStartOnOrBefore(today, iv));
      }
      let y = now.getFullYear(), m = now.getMonth() + 1;
      if (S.settings.month_start_day > 1 && now.getDate() >= S.settings.month_start_day) {
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
      }
      return `${y}-${String(m).padStart(2, "0")}`;
    }
    function shiftPeriod(p, delta) {
      const iv = intervalDays();
      if (iv && DATE_KEY.test(p))
        return isoFromDayNum(dayNum(p) + delta * iv);
      let [y, m] = p.split("-").map(Number);
      m += delta;
      while (m > 12) {
        m -= 12;
        y += 1;
      }
      while (m < 1) {
        m += 12;
        y -= 1;
      }
      return `${y}-${String(m).padStart(2, "0")}`;
    }
    const MONTH_FULL = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December"
    ];
    function periodMonthName(p) {
      const iv = intervalDays();
      if (iv && DATE_KEY.test(p)) {
        const { start, end } = periodRange(p);
        const [sy, sm] = start.split("-").map(Number);
        const [ey, em] = end.split("-").map(Number);
        if (sy === ey && sm === em)
          return `${MONTH_FULL[sm - 1]} ${sy}`;
        if (sy === ey)
          return `${MONTHS[sm - 1]} – ${MONTHS[em - 1]} ${ey}`;
        return `${MONTHS[sm - 1]} ${sy} – ${MONTHS[em - 1]} ${ey}`;
      }
      const [y, m] = p.split("-").map(Number);
      return `${MONTH_FULL[m - 1]} ${y}`;
    }
    function periodShortLabel(p) {
      if (intervalDays() && DATE_KEY.test(p)) {
        const [, m, d] = p.split("-").map(Number);
        return `${d} ${MONTHS[m - 1]}`;
      }
      return `${MONTHS[parseInt(p.slice(5), 10) - 1]} ${p.slice(2, 4)}`;
    }
    function periodTitle(p) {
      const { start, end } = periodRange(p);
      const f = (d) => `${MONTHS[parseInt(d.slice(5, 7), 10) - 1]} ${parseInt(d.slice(8), 10)}`;
      const sy = start.slice(0, 4), ey = end.slice(0, 4);
      if (sy === ey)
        return `${f(start)} – ${f(end)}, ${ey}`;
      return `${f(start)}, ${sy} – ${f(end)}, ${ey}`;
    }
    function txInPeriod(p) {
      const { start, end } = periodRange(p);
      const out = [];
      for (const f of Object.values(S.txFiles)) {
        if (f.month < start.slice(0, 7) || f.month > end.slice(0, 7))
          continue;
        for (const r of f.rows)
          if (r.date >= start && r.date <= end)
            out.push({ ...r, label: f.label, _file: f, _row: r });
      }
      out.sort((a, b) => a.date.localeCompare(b.date) || a.desc.localeCompare(b.desc));
      return out;
    }
    function accountForLabel(label) {
      const want = safeSeg(label);
      return S.accounts.find((a) => a.tx_label === label || a.name === label || safeSeg(a.name) === want) || null;
    }
    function nonBudgetLabels() {
      const out = new Set;
      for (const f of Object.values(S.txFiles)) {
        const a = accountForLabel(f.label);
        if (a && !a.in_budget)
          out.add(f.label);
      }
      return out;
    }
    function catType(name) {
      return S.categories.find((c) => c.name === name)?.type || null;
    }
    function periodSummary(p) {
      const skip = nonBudgetLabels();
      const tx = txInPeriod(p).filter((t) => !t.excluded && !skip.has(t.label));
      let income = 0, spend = 0, uncategorised = 0;
      const byCat = {};
      for (const t of tx) {
        const type = catType(t.cat);
        if (!t.cat)
          uncategorised++;
        if (type === "transfer")
          continue;
        byCat[t.cat || ""] = (byCat[t.cat || ""] || 0) + t.amount;
        if (type === "income")
          income += t.amount;
        else if (t.amount < 0)
          spend += -t.amount;
      }
      return { income, spend, uncategorised, byCat, count: tx.length };
    }
    function budgetTotals(p) {
      const budget = S.budgets[p] || [];
      return {
        income: budget.filter((b) => b.type === "income").reduce((a, b) => a + b.amount, 0),
        spend: budget.filter((b) => b.type !== "income" && b.type !== "transfer").reduce((a, b) => a + b.amount, 0)
      };
    }
    ctx.provide({
      periodRange,
      currentPeriod,
      shiftPeriod,
      periodTitle,
      periodMonthName,
      periodShortLabel,
      txInPeriod,
      catType,
      periodSummary,
      budgetTotals,
      accountForLabel,
      nonBudgetLabels,
      intervalDays,
      periodKeyValid
    });
  };
});

// src/load.js
var require_load = __commonJS((exports2, module2) => {
  var { TFile } = require("obsidian");
  var { TYPE_ORDER } = require_constants();
  var { parseFrontmatter, parseMdTable, parseCsv, unescMd, parseNum, safeSeg, periodDaysOrZero } = require_util();
  module2.exports = function registerLoad(ctx) {
    const { S, vault, readFile, mdFilesIn, subfoldersIn, currentPeriod, periodKeyValid } = ctx;
    async function loadVault() {
      const settingsTxt = await readFile("Settings.md");
      if (settingsTxt) {
        const { fm } = parseFrontmatter(settingsTxt);
        if (fm.month_start_day) {
          const n = parseInt(fm.month_start_day, 10) || 23;
          S.settings.month_start_day = Math.min(28, Math.max(1, n));
        }
        const anchor = (fm.period_anchor || "").toString().trim();
        const anchorOk = /^\d{4}-\d{2}-\d{2}$/.test(anchor);
        S.settings.period_days = anchorOk ? periodDaysOrZero(fm.period_days) : 0;
        S.settings.period_anchor = anchorOk ? anchor : "";
        if (fm.currency)
          S.settings.currency = fm.currency;
        S.settings.country = (fm.country || "za").toString().trim().toLowerCase();
        S.settings.household = fm.household || "";
      }
      const read = async (files) => {
        const texts = await Promise.all(files.map((f) => vault.cachedRead(f)));
        return files.map((file, i) => ({ file, text: texts[i] }));
      };
      S.categories = [];
      for (const { file, text } of await read(mdFilesIn("Categories"))) {
        const { fm } = parseFrontmatter(text);
        S.categories.push({ name: fm.name || file.basename, type: fm.type || "expense", color: fm.color || "#888" });
      }
      S.categories.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.name.localeCompare(b.name));
      S.accounts = [];
      for (const { file: f, text: acctText } of await read(mdFilesIn("Accounts"))) {
        const { fm, body, raw } = parseFrontmatter(acctText);
        S.accounts.push({
          name: f.basename,
          fmRaw: raw,
          type: fm.type || "other",
          institution: fm.institution || "",
          account_number: fm.account_number || "",
          tx_label: fm.tx_label || "",
          ...((bal) => ({ balance: bal.value, balanceRaw: bal.ok ? null : bal.raw }))(parseNum(fm.balance || "0")),
          balance_updated: fm.balance_updated || "",
          in_budget: !/^(false|no|off|0)$/i.test(String(fm.budget ?? "").trim()),
          credit_limit: fm.credit_limit ? parseFloat(fm.credit_limit) : null,
          goal_amount: fm.goal_amount ? parseFloat(fm.goal_amount) : null,
          target_date: fm.target_date || "",
          monthly_contribution: fm.monthly_contribution ? parseFloat(fm.monthly_contribution) : null,
          total_invested: fm.total_invested ? parseFloat(fm.total_invested) : null,
          starting_amount: fm.starting_amount ? parseFloat(fm.starting_amount) : null,
          inception_date: fm.inception_date || "",
          tags: fm.tags || "",
          body
        });
      }
      S.accounts.sort((a, b) => a.name.localeCompare(b.name));
      S.budgets = {};
      S.budgetMeta = {};
      for (const { file: f, text } of await read(mdFilesIn("Budgets").filter((f2) => /^\d{4}-\d{2}(-\d{2})?$/.test(f2.basename)))) {
        const period = f.basename;
        const { raw } = parseFrontmatter(text);
        S.budgetMeta[period] = { raw };
        const rows = parseMdTable(text);
        S.budgets[period] = rows.slice(1).map((c) => {
          const amt = parseNum(c[2]);
          return { category: unescMd(c[0]), type: c[1] || "", amount: amt.value, amountRaw: amt.ok ? null : amt.raw, notes: unescMd(c[3] || "") };
        });
      }
      S.txFiles = {};
      const txFiles = [];
      for (const acct of subfoldersIn("Transactions")) {
        for (const f of acct.children) {
          if (!(f instanceof TFile) || f.extension !== "md" || !/^\d{4}-\d{2}$/.test(f.basename))
            continue;
          txFiles.push({ acct, f });
        }
      }
      const txTexts = await Promise.all(txFiles.map(({ f }) => vault.cachedRead(f)));
      txFiles.forEach(({ acct, f }, i) => {
        const month = f.basename;
        const text = txTexts[i];
        const { raw } = parseFrontmatter(text);
        const rows = parseMdTable(text);
        S.txFiles[`${acct.name}/${month}`] = {
          label: acct.name,
          month,
          dirty: false,
          fmRaw: raw,
          rows: rows.slice(1).map((c) => {
            const amt = parseNum(c[3]);
            return {
              date: c[0],
              desc: unescMd(c[1]),
              cat: unescMd(c[2]),
              amount: amt.value,
              amountRaw: amt.ok ? null : amt.raw,
              excluded: (c[4] || "").toLowerCase() === "yes",
              note: unescMd(c[5] || "")
            };
          })
        };
      });
      S.rules = [];
      const rulesCsv = await readFile("Data/Categorisation Rules.csv");
      if (rulesCsv)
        for (const row of parseCsv(rulesCsv).slice(1)) {
          if (row.length >= 2 && row[0])
            S.rules.push({ pattern: row[0], category: row[1] });
        }
      S.owed = [];
      S.owedDirty = false;
      const owedTxt = await readFile("Owed Money.md");
      S.owedFm = owedTxt && parseFrontmatter(owedTxt).raw || "kind: owed";
      if (owedTxt)
        for (const c of parseMdTable(owedTxt).slice(1)) {
          if (!c[0])
            continue;
          S.owed.push({
            person: unescMd(c[0]),
            amount: parseFloat(c[1]) || 0,
            description: unescMd(c[2] || ""),
            due: (c[3] || "").trim(),
            status: (c[4] || "outstanding").trim().toLowerCase() === "paid" ? "paid" : "outstanding"
          });
        }
      S.debts = [];
      S.debtsDirty = false;
      const debtTxt = await readFile("Debts.md");
      S.debtsFm = debtTxt && parseFrontmatter(debtTxt).raw || "kind: debts";
      if (debtTxt)
        for (const c of parseMdTable(debtTxt).slice(1)) {
          if (!c[0])
            continue;
          const num = (v, min = 0) => Math.max(min, parseNum(v || "0").value || 0);
          const balance = num(c[3]);
          S.debts.push({
            name: unescMd(c[0]),
            lender: unescMd(c[1] || ""),
            type: unescMd(c[2] || "other"),
            balance,
            original: c[4] !== undefined && c[4] !== "" ? num(c[4]) : balance,
            rate: num(c[5]),
            payment: num(c[6]),
            extra: num(c[7]),
            start: (c[8] || "").trim(),
            category: unescMd(c[9] || ""),
            status: (c[10] || "active").trim().toLowerCase() === "paid" ? "paid" : "active",
            notes: unescMd(c[11] || "")
          });
        }
      S.services = [];
      S.servicesDirty = false;
      const svcTxt = await readFile("Services.md");
      S.servicesFm = svcTxt && parseFrontmatter(svcTxt).raw || "kind: services";
      if (svcTxt)
        for (const c of parseMdTable(svcTxt).slice(1)) {
          if (!c[0])
            continue;
          S.services.push({
            name: unescMd(c[0]),
            provider: unescMd(c[1] || ""),
            amount: parseFloat(c[2]) || 0,
            cycle: (c[3] || "monthly").trim().toLowerCase() === "annual" ? "annual" : "monthly",
            next: (c[4] || "").trim(),
            category: unescMd(c[5] || ""),
            active: (c[6] || "yes").trim().toLowerCase() !== "no",
            notes: unescMd(c[7] || "")
          });
        }
      S.tax = {};
      S.taxDirty = false;
      for (const { file: f, text } of await read(mdFilesIn("Tax").filter((f2) => /^\d{4}$/.test(f2.basename)))) {
        const { fm, raw, body } = parseFrontmatter(text);
        const section = (name) => {
          for (const chunk of body.split(/\r?\n##\s+/).slice(1)) {
            if (chunk.trim().toLowerCase().startsWith(name))
              return chunk;
          }
          return "";
        };
        const stepStatus = (s) => {
          const t = (s || "").trim().toLowerCase().replace(/[-\s]/g, "");
          return ["todo", "busy", "done", "n/a", "na"].includes(t) ? t === "na" ? "n/a" : t : "todo";
        };
        const docStatus = (s) => {
          const t = (s || "").trim().toLowerCase().replace(/[-\s]/g, "");
          return t === "uploaded" ? "uploaded" : t === "n/a" || t === "na" ? "n/a" : "needed";
        };
        const figAmount = (s) => {
          const t = (s || "").toString().replace(/[^\d.,-]/g, "");
          if (!t)
            return 0;
          const norm = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
          const n = Number(norm);
          return Number.isFinite(n) ? n : 0;
        };
        const signedNum = (v) => {
          if (v === undefined || v === null || v === "")
            return null;
          const n = Number(String(v).replace(/[^\d.-]/g, ""));
          return Number.isFinite(n) ? n : null;
        };
        S.tax[f.basename] = {
          fmRaw: raw,
          taxpayer_type: ["provisional", "standard"].includes(fm.taxpayer_type) ? fm.taxpayer_type : "unknown",
          assessment: ["auto-assessed", "submit-requested", "assessed"].includes(fm.assessment) ? fm.assessment : "unknown",
          deadline_standard: fm.deadline_standard || "",
          deadline_provisional: fm.deadline_provisional || "",
          assessment_date: fm.assessment_date || "",
          assessment_ref: fm.assessment_ref || "",
          assessment_result: signedNum(fm.assessment_result),
          assessment_income: signedNum(fm.assessment_income),
          steps: parseMdTable(section("progress")).slice(1).filter((c) => c[0]).map((c) => ({
            step: unescMd(c[0]),
            status: stepStatus(c[1]),
            due: (c[2] || "").trim(),
            notes: unescMd(c[3] || "")
          })),
          docs: parseMdTable(section("documents")).slice(1).filter((c) => c[0]).map((c) => ({
            name: unescMd(c[0]),
            source: unescMd(c[1] || ""),
            status: docStatus(c[2]),
            file: unescMd(c[3] || ""),
            notes: unescMd(c[4] || "")
          })),
          figures: parseMdTable(section("figures")).slice(1).filter((c) => c[0]).map((c) => ({
            code: unescMd(c[0]),
            description: unescMd(c[1] || ""),
            source: unescMd(c[2] || ""),
            amount: figAmount(c[3])
          }))
        };
      }
      if (!S.taxYear || !S.tax[S.taxYear])
        S.taxYear = Object.keys(S.tax).sort().pop() || null;
      S.taxOrphanYears = subfoldersIn("Tax").map((f) => f.name).filter((n) => /^\d{4}$/.test(n) && !S.tax[n]).sort();
      if (!S.period || !periodKeyValid(S.period))
        S.period = currentPeriod();
    }
    function txSegment(label) {
      const want = safeSeg(label);
      for (const f of Object.values(S.txFiles)) {
        if (f.label === label || safeSeg(f.label) === want)
          return f.label;
      }
      return want;
    }
    ctx.provide({ loadVault, txSegment });
  };
});

// src/categories.js
var require_categories = __commonJS((exports2, module2) => {
  var { el, parseFrontmatter, learnPattern, safeSeg, yamlStr, csvCell } = require_util();
  var { TYPE_ORDER } = require_constants();
  var { askFields, confirmModal } = require_modal();
  module2.exports = function registerCategories(ctx) {
    const { S, app, vault, toast, writeFile, fileAt, mdFilesIn } = ctx;
    let catsVersion = 1;
    function fillCatOptions(sel, current) {
      sel.empty();
      sel.append(el("option", { value: "" }, "— none —"));
      let lastType = null, group = null;
      for (const c of S.categories) {
        if (c.type !== lastType) {
          lastType = c.type;
          group = el("optgroup", { label: c.type });
          sel.append(group);
        }
        const o = el("option", { value: c.name }, c.name);
        if (c.name === current)
          o.selected = true;
        group.append(o);
      }
      if (current && !S.categories.some((c) => c.name === current)) {
        const o = el("option", { value: current }, `${current} (missing)`);
        o.selected = true;
        sel.append(o);
      }
      sel.append(el("option", { value: "__new__" }, "＋ Add new category…"));
    }
    async function promptCreateCategory() {
      const r = await askFields(app, "New category", [
        { key: "name", label: "Name", type: "text", placeholder: "e.g. Coffee budget" },
        { key: "type", label: "Type", type: "select", options: TYPE_ORDER, value: "expense" }
      ]);
      if (!r || !r.name.trim())
        return null;
      const realName = r.name.trim();
      if (S.categories.some((c) => c.name.toLowerCase() === realName.toLowerCase())) {
        toast("Category already exists", true);
        return null;
      }
      const type = r.type;
      if (!TYPE_ORDER.includes(type)) {
        toast("Invalid type", true);
        return null;
      }
      const safe = safeSeg(realName);
      if (!safe) {
        toast("That name has no usable characters for a filename", true);
        return null;
      }
      if (fileAt(`Categories/${safe}.md`)) {
        toast(`Categories/${safe}.md already exists`, true);
        return null;
      }
      const nameLine = safe !== realName ? `name: ${yamlStr(realName)}
` : "";
      await writeFile(`Categories/${safe}.md`, `---
${nameLine}type: ${type}
color: "#888888"
tags: [finance, finance/budget, finance/budget/categories]
---

# ${realName}

Budget category of type **${type}**.
`);
      const cat = { name: realName, type, color: "#888888" };
      S.categories.push(cat);
      S.categories.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.name.localeCompare(b.name));
      catsVersion++;
      toast(`Created Categories/${safe}.md`);
      return cat;
    }
    function wireCatChange(sel, current, onchange) {
      let cur = current;
      sel.addEventListener("change", async () => {
        if (sel.value === "__new__") {
          const cat = await promptCreateCategory();
          if (cat) {
            fillCatOptions(sel, cat.name);
            sel.value = cat.name;
            cur = cat.name;
            onchange(cat.name);
          } else {
            sel.value = cur;
          }
          return;
        }
        cur = sel.value;
        onchange(cur);
      });
    }
    function refreshOnOpen(sel, getVersion, setVersion) {
      const refresh = () => {
        if (getVersion() === catsVersion)
          return;
        setVersion(catsVersion);
        const val = sel.value;
        fillCatOptions(sel, val);
        sel.value = val;
      };
      sel.addEventListener("mousedown", refresh);
      sel.addEventListener("focus", refresh);
      sel.addEventListener("keydown", refresh);
    }
    function catSelect(current, onchange, label) {
      const sel = el("select", { class: "category-select", ...label ? { "aria-label": label } : {} });
      fillCatOptions(sel, current);
      let builtVersion = catsVersion;
      refreshOnOpen(sel, () => builtVersion, (v) => builtVersion = v);
      wireCatChange(sel, current, onchange);
      return sel;
    }
    function lazyCatSelect(current, onchange, label) {
      const sel = el("select", { class: "category-select", ...label ? { "aria-label": label } : {} });
      sel.append(el("option", { value: current, selected: "" }, current || "— none —"));
      let builtVersion = 0;
      refreshOnOpen(sel, () => builtVersion, (v) => builtVersion = v);
      wireCatChange(sel, current, onchange);
      return sel;
    }
    function deferredCatSelect(current, onchange, label) {
      const wrap = el("span", { class: "cat-cell" });
      let value = current;
      const btn = el("button", {
        type: "button",
        class: `cat-cell-btn${value ? "" : " cat-cell-empty"}`,
        "aria-label": label ? `${label} — currently ${value || "uncategorised"}` : undefined
      }, value || "— none —");
      let swapped = false;
      const swap = () => {
        if (swapped)
          return;
        swapped = true;
        const sel = lazyCatSelect(value, (v) => {
          value = v;
          onchange(v);
        }, label);
        wrap.replaceChildren(sel);
        sel.focus();
        if (typeof sel.showPicker === "function") {
          try {
            sel.showPicker();
          } catch (e) {}
        }
      };
      btn.addEventListener("click", swap);
      btn.addEventListener("focus", swap);
      wrap.append(btn);
      return wrap;
    }
    async function promptDeleteCategory(name) {
      if (!S.categories.some((c) => c.name === name))
        return false;
      let used = 0;
      for (const f of Object.values(S.txFiles)) {
        for (const r of f.rows)
          if (r.cat === name)
            used++;
      }
      const ok = await confirmModal(app, {
        title: "Delete category",
        message: `Delete "${name}"? ` + (used ? `${used} existing transaction${used === 1 ? "" : "s"} keep the name and will show it as "(missing)" until re-categorised. ` : "") + "Past budget files are not changed, and the category file goes to your vault trash.",
        confirmText: "Delete"
      });
      if (!ok)
        return false;
      const safe = safeSeg(name);
      let file = fileAt(`Categories/${safe}.md`);
      if (!file) {
        for (const f of mdFilesIn("Categories")) {
          const { fm } = parseFrontmatter(await vault.cachedRead(f));
          if ((fm.name || f.basename) === name) {
            file = f;
            break;
          }
        }
      }
      if (file)
        await vault.trash(file, false);
      S.categories = S.categories.filter((c) => c.name !== name);
      catsVersion++;
      toast(`Deleted category "${name}"`);
      return true;
    }
    async function learnRules(pairs) {
      const have = new Set(S.rules.map((r) => r.pattern.trim().toLowerCase()));
      let added = 0;
      for (const { desc, cat } of pairs) {
        if (!cat)
          continue;
        const pattern = learnPattern(desc);
        const key = pattern.trim().toLowerCase();
        if (!key || have.has(key))
          continue;
        S.rules.push({ pattern, category: cat });
        have.add(key);
        added++;
      }
      if (added) {
        S.rules.sort((a, b) => a.pattern.localeCompare(b.pattern, undefined, { sensitivity: "base" }));
        const csv = `pattern,category
` + S.rules.map((r) => [r.pattern, r.category].map(csvCell).join(",")).join(`
`) + `
`;
        await writeFile("Data/Categorisation Rules.csv", csv);
      }
      return added;
    }
    ctx.provide({ fillCatOptions, promptCreateCategory, promptDeleteCategory, catSelect, lazyCatSelect, deferredCatSelect, learnRules });
  };
});

// src/views/dashboard.js
var require_dashboard = __commonJS((exports2, module2) => {
  var { el } = require_util();
  var { TYPE_ORDER } = require_constants();
  module2.exports = function registerDashboard(ctx) {
    const { S, $, root, money, periodSummary, budgetTotals, periodTitle, periodMonthName, periodShortLabel, shiftPeriod, catType } = ctx;
    function renderDashboard() {
      const sum = periodSummary(S.period);
      const bud = budgetTotals(S.period);
      const available = bud.spend - sum.spend;
      const heroNegative = available < 0;
      const meterMax = Math.max(sum.spend, bud.spend, 1);
      const fillPct = Math.min(100, sum.spend / meterMax * 100).toFixed(2);
      const markPct = bud.spend > 0 ? (bud.spend / meterMax * 100).toFixed(2) : null;
      const budgetedPct = sum.income > 0 ? Math.round(bud.spend / sum.income * 100) : null;
      const usedPct = bud.spend > 0 ? Math.round(sum.spend / bud.spend * 100) : null;
      const hero = $("#heroCard");
      hero.empty();
      const cur = S.settings.currency;
      const heroNum = el("div", { class: `hero-num${heroNegative ? " hero-num--negative" : ""}` }, el("small", {}, cur), money(Math.abs(available), 0).slice(cur.length + 1));
      const meter = el("div", { class: `hero-meter${heroNegative ? " over" : ""}` }, el("i", { style: `width:${fillPct}%` }));
      if (markPct !== null)
        meter.append(el("span", { class: "hero-mark", style: `left:${markPct}%`, "aria-hidden": "true" }));
      const statCol = el("div", { class: "stat-col" }, el("div", { class: "stat" }, el("div", {}, el("div", { class: "sl" }, "Total Income")), el("div", {}, el("div", { class: "sv grad-txt" }, money(sum.income)))), el("div", { class: "stat" }, el("div", {}, el("div", { class: "sl" }, "Budgeted")), el("div", {}, el("div", { class: "sv" }, money(bud.spend)), budgetedPct !== null ? el("div", { class: "st" }, `${budgetedPct}% allocated`) : "")), el("div", { class: "stat" }, el("div", {}, el("div", { class: "sl" }, "Total Spent")), el("div", {}, el("div", { class: "sv" }, money(sum.spend)), usedPct !== null ? el("div", { class: "st" }, el("span", { class: "tag warn" }, `${usedPct}% used`)) : "")));
      if (sum.uncategorised > 0)
        statCol.append(el("div", { class: "stat" }, el("div", {}, el("div", { class: "sl" }, "Uncategorised")), el("div", {}, el("div", { class: "sv", style: "color: var(--color-warning)" }, String(sum.uncategorised)), el("div", { class: "st" }, "review in Transactions"))));
      const hour = new Date().getHours();
      const greeting = hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
      hero.append(el("div", { class: "hero-grid" }, el("div", {}, S.settings.household ? el("div", { class: "hero-greet" }, `${greeting}, ${S.settings.household}`) : "", el("div", { class: "hero-lbl" }, heroNegative ? "Overspent this period" : "Remaining this period"), heroNum, el("div", { class: "hero-sub" }, el("b", {}, money(sum.spend)), " spent of ", el("b", {}, money(bud.spend)), " budgeted"), meter), statCol));
      renderTrend();
      const t = $("#dashBudget");
      t.empty();
      $("#dashBudgetSub").textContent = `${periodMonthName(S.period)} · ${periodTitle(S.period)}`;
      t.append(el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Category"), el("th", { scope: "col", class: "num" }, "Budget"), el("th", { scope: "col", class: "num" }, "Spent"), el("th", { scope: "col", style: "width:26%" }, ""), el("th", { scope: "col", class: "num" }, "Remaining"))));
      const body = el("tbody", {});
      const budget = S.budgets[S.period] || [];
      const rows = new Map;
      for (const b of budget)
        rows.set(b.category, { budget: b.amount, type: b.type, actual: 0, notes: b.notes });
      for (const [cat, amt] of Object.entries(sum.byCat)) {
        if (!cat)
          continue;
        const type = catType(cat);
        if (type === "transfer")
          continue;
        const r = rows.get(cat) || rows.set(cat, { budget: 0, type: type || "expense", actual: 0, notes: "" }).get(cat);
        r.actual += type === "income" ? amt : -amt;
      }
      const sorted = [...rows.entries()].sort((a, b) => TYPE_ORDER.indexOf(a[1].type) - TYPE_ORDER.indexOf(b[1].type) || a[0].localeCompare(b[0]));
      let lastType = null;
      for (const [cat, r] of sorted) {
        if (r.type !== lastType) {
          lastType = r.type;
          body.append(el("tr", { class: "type-row" }, el("td", { colspan: "5" }, r.type)));
        }
        const pct = r.budget > 0 ? Math.min(100, r.actual / r.budget * 100) : r.actual > 0 ? 100 : 0;
        const over = r.budget > 0 && r.actual > r.budget;
        const near = !over && r.budget > 0 && r.actual / r.budget >= 0.85;
        const barCls = r.type === "income" ? "" : over ? " bg-danger" : near ? " bg-warning" : "";
        const remaining = r.budget - r.actual;
        const bar = el("div", { class: "cat-bar" }, el("i", { class: `cat-bar-fill${barCls}`, style: `width:${pct}%` }));
        body.append(el("tr", {}, el("td", {}, cat, r.notes ? el("div", { class: "text-muted", style: "font-size:11.5px;margin-top:2px" }, r.notes.split(`
`)[0]) : ""), el("td", { class: "num" }, r.budget ? money(r.budget) : "—"), el("td", { class: "num" }, money(r.actual)), el("td", {}, bar), el("td", { class: `num${over ? " text-danger" : ""}` }, r.budget ? money(remaining) : "")));
      }
      if (!sorted.length)
        body.append(el("tr", {}, el("td", { colspan: "5", class: "text-muted" }, "No budget or transactions in this period yet.")));
      t.append(body);
    }
    function renderTrend() {
      const wrap = $("#trendChart");
      wrap.empty();
      const periods = [];
      for (let i = 5;i >= 0; i--)
        periods.push(shiftPeriod(S.period, -i));
      const data = periods.map((p) => ({
        p,
        spent: periodSummary(p).spend,
        budget: budgetTotals(p).spend,
        label: periodShortLabel(p)
      }));
      const W = 1000, H = 300, padL = 24, padR = 24, padT = 24, padB = 40;
      const max = Math.max(1, ...data.flatMap((d) => [d.spent, d.budget])) * 1.12;
      const x = (i) => padL + i * ((W - padL - padR) / (data.length - 1));
      const y = (v) => padT + (1 - v / max) * (H - padT - padB);
      const over = (d) => d.budget > 0 && d.spent > d.budget;
      const css = getComputedStyle(root);
      const cSuccess = css.getPropertyValue("--color-success").trim() || "#22c55e";
      const cDanger = css.getPropertyValue("--color-danger").trim() || "#f43f5e";
      const NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "Spent vs budget over the last 6 periods");
      const add = (tag, attrs, parent = svg) => {
        const n = document.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(attrs))
          n.setAttribute(k, v);
        parent.append(n);
        return n;
      };
      const defs = add("defs", {});
      const grad = add("linearGradient", { id: "spentArea", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
      add("stop", { offset: "0%", "stop-color": cSuccess, "stop-opacity": "0.22" }, grad);
      add("stop", { offset: "100%", "stop-color": cSuccess, "stop-opacity": "0" }, grad);
      for (let g = 1;g <= 3; g++) {
        const gy = padT + g * ((H - padT - padB) / 4);
        add("line", { x1: padL, x2: W - padR, y1: gy, y2: gy, stroke: "currentColor", "stroke-opacity": "0.06" });
      }
      add("path", {
        d: "M" + data.map((d, i) => `${x(i)},${y(d.spent)}`).join(" L ") + ` L ${x(data.length - 1)},${H - padB} L ${x(0)},${H - padB} Z`,
        fill: "url(#spentArea)"
      });
      add("polyline", {
        points: data.map((d, i) => `${x(i)},${y(d.budget)}`).join(" "),
        fill: "none",
        stroke: "currentColor",
        "stroke-opacity": "0.28",
        "stroke-width": "1.5",
        "stroke-dasharray": "5 6",
        "stroke-linecap": "round"
      });
      for (let i = 1;i < data.length; i++) {
        add("line", {
          x1: x(i - 1),
          y1: y(data[i - 1].spent),
          x2: x(i),
          y2: y(data[i].spent),
          stroke: over(data[i - 1]) || over(data[i]) ? cDanger : cSuccess,
          "stroke-width": "2.5",
          "stroke-linecap": "round"
        });
      }
      const holeCss = root.classList.contains("bud-dark") ? "#0a0f1e" : "#ffffff";
      data.forEach((d, i) => {
        const dot = add("circle", {
          cx: x(i),
          cy: y(d.spent),
          r: "5",
          fill: holeCss,
          stroke: over(d) ? cDanger : cSuccess,
          "stroke-width": "2.5"
        });
        add("title", {}, dot).textContent = `${d.label}: ${money(d.spent)} spent · ${money(d.budget)} budgeted`;
        add("text", {
          x: x(i),
          y: H - 12,
          "text-anchor": "middle",
          "font-size": "13",
          fill: "currentColor",
          "fill-opacity": "0.45",
          "font-family": "inherit"
        }).textContent = d.label;
      });
      svg.style.color = "var(--text-primary)";
      wrap.append(svg);
    }
    ctx.provide({ renderDashboard, renderTrend });
  };
});

// src/views/transactions.js
var require_transactions = __commonJS((exports2, module2) => {
  var { el, escMd, icoEl, patchFrontmatter, normalizeAmount, yamlStr } = require_util();
  var { askFields, askSplit } = require_modal();
  module2.exports = function registerTransactions(ctx) {
    const { S, $, app, money, toast, writeFile, periodTitle, periodMonthName, txInPeriod, deferredCatSelect, learnRules, txSegment } = ctx;
    const pendingLearns = new Map;
    const PAGE = 100;
    let shown = PAGE, shownFor = null;
    function renderTransactions() {
      $("#txSubNote").textContent = $("#txWholeHistory").checked ? "Whole history" : `${periodMonthName(S.period)} · ${periodTitle(S.period)}`;
      const syncOptions = (sel, values, fixed) => {
        const current = [...sel.options].slice(fixed.length).map((o) => o.value);
        if (current.length === values.length && current.every((v, i) => v === values[i]))
          return;
        const keep = sel.value;
        sel.empty();
        for (const [value, label] of fixed)
          sel.append(el("option", { value }, label));
        for (const v of values)
          sel.append(el("option", { value: v }, v));
        sel.value = [...sel.options].some((o) => o.value === keep) ? keep : "";
      };
      syncOptions($("#txAccount"), [...new Set(Object.values(S.txFiles).map((f) => f.label))].sort(), [["", "All accounts"]]);
      syncOptions($("#txCategory"), S.categories.map((c) => c.name), [["", "All categories"], ["__none__", "Uncategorised"]]);
      const accSel = $("#txAccount"), catSel = $("#txCategory");
      let list;
      if ($("#txWholeHistory").checked) {
        list = [];
        for (const f of Object.values(S.txFiles))
          for (const r of f.rows)
            list.push({ ...r, label: f.label, _file: f, _row: r });
        list.sort((a, b) => b.date.localeCompare(a.date));
      } else {
        list = txInPeriod(S.period).reverse();
      }
      const acc = accSel.value, cat = catSel.value, q = $("#txSearch").value.trim().toLowerCase();
      const renderToken = `${acc}|${cat}|${q}|${$("#txWholeHistory").checked}|${S.period}`;
      list = list.filter((t2) => (!acc || t2.label === acc) && (!cat || (cat === "__none__" ? !t2.cat : t2.cat === cat)) && (!q || t2.desc.toLowerCase().includes(q)));
      const total = list.length;
      if (shownFor !== renderToken) {
        shown = PAGE;
        shownFor = renderToken;
      }
      const visible = list.slice(0, shown);
      $("#txCount").textContent = total > visible.length ? `${visible.length} of ${total} rows` : `${total} rows`;
      list = visible;
      const t = $("#txTable");
      t.empty();
      t.append(el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Date"), el("th", { scope: "col" }, "Description"), el("th", { scope: "col" }, "Account"), el("th", { scope: "col" }, "Category"), el("th", { scope: "col", class: "num" }, "Amount"), el("th", { scope: "col" }, "Excl."), el("th", { scope: "col" }, "Note"), el("th", { scope: "col" }, el("span", { class: "sr-only" }, "Split")))));
      const body = el("tbody", {});
      for (const item of list) {
        const r = item._row;
        const mark = () => {
          item._file.dirty = true;
          $("#txSave").disabled = false;
        };
        body.append(el("tr", {}, el("td", { class: "text-muted", style: "white-space:nowrap" }, r.date), el("td", {}, r.desc), el("td", { class: "text-muted" }, item.label), el("td", {}, deferredCatSelect(r.cat, (v) => {
          r.cat = v;
          if (v)
            pendingLearns.set(r.desc, v);
          else
            pendingLearns.delete(r.desc);
          mark();
        }, `Category for ${r.date} ${r.desc}`)), el("td", { class: `num${r.amount >= 0 ? " text-success" : ""}`, style: "white-space:nowrap;font-weight:600" }, money(r.amount)), el("td", {}, el("input", {
          type: "checkbox",
          "aria-label": `Exclude ${r.desc} from budget totals`,
          ...r.excluded ? { checked: "" } : {},
          onchange: (e) => {
            r.excluded = e.target.checked;
            mark();
          }
        })), el("td", {}, el("input", {
          type: "text",
          class: "form-control form-control-sm",
          value: r.note,
          style: "width:130px",
          "aria-label": `Note for ${r.date} ${r.desc}`,
          onchange: (e) => {
            r.note = e.target.value;
            mark();
          }
        })), el("td", {}, splitButton(item))));
      }
      if (!list.length)
        body.append(el("tr", {}, el("td", { colspan: "8", class: "text-muted" }, "No transactions match.")));
      if (total > list.length) {
        const more = el("button", { class: "btn-ghost", style: "width:100%;padding:0.6rem" }, `Show ${Math.min(PAGE, total - list.length)} more of ${total - list.length} remaining`);
        more.addEventListener("click", () => {
          shown += PAGE;
          renderTransactions();
        });
        body.append(el("tr", {}, el("td", { colspan: "8", style: "padding:0" }, more)));
      }
      t.append(body);
    }
    function splitButton(item) {
      const r = item._row;
      const b = el("button", {
        type: "button",
        class: "btn-ghost btn-ghost-sm",
        "aria-label": `Split ${r.date} ${r.desc} into categories`,
        title: "Split into categories"
      }, icoEl(["split", "git-fork", "scissors"]));
      b.addEventListener("click", () => splitTransaction(item));
      return b;
    }
    async function splitTransaction(item) {
      const r = item._row;
      if (!r.amount)
        return toast("A zero-amount line has nothing to split", true);
      if (r.excluded)
        return toast("This line is already excluded — untick it first", true);
      const parts = await askSplit(app, {
        tx: { date: r.date, desc: r.desc, label: item.label, amount: r.amount, cat: r.cat },
        categories: S.categories.map((c) => c.name),
        money
      });
      if (!parts)
        return;
      const rows = parts.map((p) => ({
        date: r.date,
        desc: r.desc,
        cat: p.cat,
        amount: p.amount,
        excluded: false,
        note: p.note
      }));
      r.excluded = true;
      const marker = `Split into ${rows.length}`;
      r.note = r.note ? `${r.note} · ${marker}` : marker;
      item._file.rows.push(...rows);
      item._file.dirty = true;
      $("#txSave").disabled = false;
      renderTransactions();
      toast(`Split into ${rows.length} — review, then Save changes`);
    }
    function serializeTxFile(f) {
      const fm = patchFrontmatter(f.fmRaw || "", { account: yamlStr(f.label), month: f.month });
      const lines = [
        "---",
        fm,
        "---",
        "",
        "| Date | Description | Category | Amount | Excluded | Note |",
        "|------|-------------|----------|-------:|----------|------|"
      ];
      f.rows.sort((a, b) => a.date.localeCompare(b.date));
      for (const r of f.rows) {
        const amt = r.amountRaw != null ? r.amountRaw : r.amount.toFixed(2);
        lines.push(`| ${r.date} | ${escMd(r.desc)} | ${escMd(r.cat)} | ${amt} | ${r.excluded ? "yes" : ""} | ${escMd(r.note)} |`);
      }
      lines.push("");
      return lines.join(`
`);
    }
    async function addTransaction() {
      const labels = [...new Set([
        ...S.accounts.map((a) => a.tx_label || a.name),
        ...Object.values(S.txFiles).map((f) => f.label)
      ])].sort();
      if (!labels.length)
        return toast("Add an account first — every transaction belongs to one", true);
      const now = new Date;
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const r = await askFields(app, "Add transaction", [
        { key: "date", label: "Date", type: "date", value: today },
        { key: "desc", label: "Description", type: "text", placeholder: "e.g. Cash — vegetables at the market" },
        { key: "label", label: "Account", type: "select", options: labels, value: $("#txAccount").value || labels[0] },
        { key: "dir", label: "Direction", type: "select", value: "out", options: [
          { value: "out", label: "Money out" },
          { value: "in", label: "Money in" }
        ] },
        { key: "amount", label: "Amount", type: "number", placeholder: "0.00", desc: "Always positive — direction sets the sign" },
        { key: "cat", label: "Category", type: "select", options: [
          { value: "", label: "— none —" },
          ...S.categories.map((c) => ({ value: c.name, label: c.name }))
        ], value: "" },
        { key: "note", label: "Note", type: "text", placeholder: "optional" }
      ]);
      if (!r)
        return;
      const date = r.date.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        return toast("Date must be YYYY-MM-DD", true);
      const desc = r.desc.trim();
      if (!desc)
        return toast("Description is required", true);
      const label = txSegment(r.label);
      if (!label)
        return toast("Invalid account name", true);
      let amount = normalizeAmount(r.amount);
      if (amount == null || amount === 0)
        return toast("Amount must be a number other than 0", true);
      amount = parseFloat((r.dir === "in" ? Math.abs(amount) : -Math.abs(amount)).toFixed(2));
      const month = date.slice(0, 7);
      const key = `${label}/${month}`;
      const row = { date, desc, cat: r.cat, amount, excluded: false, note: (r.note || "").trim() };
      const TX_FM = "tags: [finance, finance/budget, finance/budget/transactions]";
      const existing = S.txFiles[key];
      const fileModel = existing ? { ...existing, rows: existing.rows.concat([row]) } : { label, month, rows: [row], dirty: false, fmRaw: TX_FM };
      try {
        await writeFile(`Transactions/${label}/${month}.md`, serializeTxFile(fileModel));
      } catch (err) {
        return toast(`Could not save the transaction (${err.message || err})`, true);
      }
      if (!S.txFiles[key])
        S.txFiles[key] = { label, month, rows: [], dirty: false, fmRaw: TX_FM };
      S.txFiles[key].rows.push(row);
      renderTransactions();
      toast(`Added ${money(amount)} · ${label} · ${month}`);
    }
    async function saveTransactions() {
      let n = 0;
      for (const f of Object.values(S.txFiles)) {
        if (!f.dirty)
          continue;
        await writeFile(`Transactions/${f.label}/${f.month}.md`, serializeTxFile(f));
        f.dirty = false;
        n++;
      }
      let learned = 0;
      if (pendingLearns.size) {
        learned = await learnRules([...pendingLearns].map(([desc, cat]) => ({ desc, cat })));
        pendingLearns.clear();
      }
      $("#txSave").disabled = true;
      toast(`Saved ${n} file${n === 1 ? "" : "s"}` + (learned ? ` · learned ${learned} new rule${learned === 1 ? "" : "s"}` : ""));
    }
    ctx.provide({ renderTransactions, serializeTxFile, saveTransactions, addTransaction, splitTransaction });
  };
});

// src/views/budgets.js
var require_budgets = __commonJS((exports2, module2) => {
  var { el, escMd, icoEl, patchFrontmatter } = require_util();
  var { TYPE_ORDER } = require_constants();
  module2.exports = function registerBudgets(ctx) {
    const { S, $, money, toast, typeBadge, writeFile, periodTitle, periodMonthName, periodSummary, periodRange, shiftPeriod, promptCreateCategory, promptDeleteCategory } = ctx;
    let budDraft = null, budDraftPeriod = null;
    let budDirty = false;
    function budgetDraft() {
      if (budDraftPeriod !== S.period || !budDraft) {
        budDraft = (S.budgets[S.period] || []).map((r) => ({ ...r, inFile: true }));
        const have = new Set(budDraft.map((d) => d.category));
        for (const c of S.categories) {
          if (!have.has(c.name))
            budDraft.push({ category: c.name, type: c.type, amount: 0, notes: "", inFile: false });
        }
        budDraftPeriod = S.period;
        budDirty = false;
        $("#budSave").disabled = true;
      }
      return budDraft;
    }
    function invalidateBudgetDraft() {
      budDraft = null;
      budDraftPeriod = null;
      budDirty = false;
    }
    function budgetDirty() {
      const b = $("#budSave");
      return budDirty || !!b && !b.disabled;
    }
    ctx.registerDirty(budgetDirty);
    function budgetTotalsStrip() {
      const draft = budgetDraft();
      const sum = periodSummary(S.period);
      let income = 0, budgeted = 0;
      for (const d of draft) {
        if (d.type === "income")
          income += d.amount || 0;
        else if (d.type !== "transfer")
          budgeted += d.amount || 0;
      }
      const allocPct = income > 0 ? Math.round(budgeted / income * 100) : null;
      const usedPct = budgeted > 0 ? Math.round(sum.spend / budgeted * 100) : null;
      const unallocated = income - budgeted;
      return [
        { label: "Total income", value: money(income), grad: true, note: `${money(sum.income)} received so far` },
        { label: "Total budgeted", value: money(budgeted), note: allocPct !== null ? `${allocPct}% of budgeted income` : "" },
        {
          label: unallocated < 0 ? "Over-budgeted" : "Left to budget",
          value: money(Math.abs(unallocated)),
          over: unallocated < 0,
          note: unallocated < 0 ? "budgeted beyond income" : income > 0 ? "income not yet allocated" : ""
        },
        {
          label: "Total spent",
          value: money(sum.spend),
          over: budgeted > 0 && sum.spend > budgeted,
          note: usedPct !== null ? `${usedPct}% of budget used` : ""
        }
      ];
    }
    function renderBudgetTotals() {
      const tiles = budgetTotalsStrip();
      for (const id of ["#budTotalsTop", "#budTotalsBottom"]) {
        const host = $(id);
        if (!host)
          continue;
        host.empty();
        for (const t of tiles) {
          host.append(el("div", { class: "bud-total" }, el("div", { class: "bud-total-l" }, t.label), el("div", { class: `bud-total-v${t.grad ? " grad-txt" : ""}${t.over ? " over" : ""}` }, t.value), t.note ? el("div", { class: "bud-total-n" }, t.note) : ""));
        }
      }
    }
    function renderBudgets() {
      $("#budPeriodLabel").textContent = `${periodMonthName(S.period)} · ${periodTitle(S.period)}`;
      const draft = budgetDraft();
      const sum = periodSummary(S.period);
      const t = $("#budTable");
      t.empty();
      t.append(el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Category"), el("th", { scope: "col" }, "Type"), el("th", { scope: "col", class: "num" }, "Amount"), el("th", { scope: "col", class: "num" }, "Actual so far"), el("th", { scope: "col" }, "Notes"), el("th", { scope: "col" }, ""))));
      const body = el("tbody", {});
      const mark = () => {
        budDirty = true;
        $("#budSave").disabled = false;
      };
      const rows = [...draft].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.category.localeCompare(b.category));
      let lastType = null;
      for (const d of rows) {
        if (d.type !== lastType) {
          lastType = d.type;
          body.append(el("tr", { class: "type-row" }, el("td", { colspan: "6" }, d.type)));
        }
        const raw = sum.byCat[d.category] || 0;
        const actual = d.type === "income" ? raw : -raw;
        const overActual = actual > d.amount && d.amount > 0 && d.type !== "income";
        const remainingEl = el("div", { class: "bud-remaining" });
        const updateRemaining = () => {
          if (!d.amount) {
            remainingEl.textContent = "";
            remainingEl.className = "bud-remaining";
            return;
          }
          const rem = d.amount - actual;
          const over = rem < 0 && d.type !== "income";
          remainingEl.textContent = over ? `${money(-rem)} over` : `${money(rem)} left`;
          remainingEl.className = "bud-remaining" + (over ? " over" : "");
        };
        updateRemaining();
        body.append(el("tr", {}, el("td", {}, d.category), el("td", {}, typeBadge(d.type)), el("td", { class: "num" }, el("div", { class: "bud-amt-wrap" }, el("input", {
          type: "number",
          step: "0.01",
          class: "form-control form-control-sm",
          value: d.amount || "",
          "aria-label": `Budget amount for ${d.category}`,
          onchange: (e) => {
            d.amount = parseFloat(e.target.value) || 0;
            d.amountRaw = null;
            mark();
            updateRemaining();
            renderBudgetTotals();
          }
        }), remainingEl)), el("td", { class: `num${overActual ? " text-danger" : " text-muted"}`, style: "white-space:nowrap" }, money(actual)), el("td", {}, el("input", {
          type: "text",
          class: "form-control form-control-sm",
          value: d.notes,
          style: "width:230px",
          "aria-label": `Notes for ${d.category}`,
          onchange: (e) => {
            d.notes = e.target.value;
            mark();
          }
        })), el("td", { style: "white-space:nowrap" }, d.inFile ? el("button", { class: "btn-ghost btn-ghost-sm", "aria-label": `Clear budget for ${d.category}`, title: "Clear this category from the period file", onclick: () => {
          d.amount = 0;
          d.amountRaw = null;
          d.notes = "";
          d.inFile = false;
          mark();
          renderBudgets();
        } }, "✕") : "", el("button", { class: "btn-ghost btn-ghost-sm", "aria-label": `Delete category ${d.category}`, title: "Delete this category everywhere", onclick: async () => {
          if (await promptDeleteCategory(d.category)) {
            const draft2 = budgetDraft();
            const i = draft2.indexOf(d);
            if (i !== -1 && !d.inFile)
              draft2.splice(i, 1);
            renderBudgets();
          }
        } }, icoEl(["trash-2", "trash"])))));
      }
      t.append(body);
      renderBudgetTotals();
    }
    async function saveBudget() {
      const draft = budgetDraft().filter((d) => d.category && (d.inFile || d.amount || d.notes && d.notes.trim()));
      for (const d of draft)
        d.inFile = true;
      S.budgets[S.period] = draft.map((d) => ({ ...d }));
      const n = S.settings.month_start_day;
      const meta = S.budgetMeta[S.period];
      const fm = patchFrontmatter(meta && meta.raw || "", { period: S.period });
      const ordinal = (d) => {
        const v = d % 100;
        return d + (["th", "st", "nd", "rd"][(v - 20) % 10] || ["th", "st", "nd", "rd"][v] || "th");
      };
      const iv = ctx.intervalDays();
      const rangeNote = iv ? "With `period_days: " + iv + "`, this period runs for " + iv + " days from " + periodRange(S.period).start + ", counted from `period_anchor: " + S.settings.period_anchor + "`." : n === 1 ? "With `month_start_day: 1`, this period is the calendar month — the 1st to the last day of the month." : "With `month_start_day: " + n + "`, this period runs from the " + ordinal(n) + " of the previous month to the " + ordinal(n - 1) + " of this month.";
      const lines = [
        "---",
        fm,
        "---",
        "",
        `# Budget — ${S.period}`,
        "",
        rangeNote,
        "",
        "| Category | Type | Amount | Notes |",
        "|----------|------|-------:|-------|"
      ];
      const rows = [...draft].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.category.localeCompare(b.category));
      for (const d of rows) {
        const amt = d.amountRaw != null ? d.amountRaw : d.amount.toFixed(2);
        lines.push(`| ${escMd(d.category)} | ${d.type} | ${amt} | ${escMd(d.notes)} |`);
      }
      lines.push("");
      await writeFile(`Budgets/${S.period}.md`, lines.join(`
`));
      budDirty = false;
      $("#budSave").disabled = true;
      toast(`Budget saved to Budgets/${S.period}.md`);
    }
    function copyPreviousBudget() {
      const prev = S.budgets[shiftPeriod(S.period, -1)];
      if (!prev || !prev.length)
        return toast("No budget found for the previous period", true);
      const draft = budgetDraft();
      let copied = 0;
      for (const r of prev) {
        const d = draft.find((x) => x.category === r.category);
        if (d) {
          if (!d.inFile && !d.amount && !(d.notes && d.notes.trim())) {
            d.amount = r.amount;
            d.amountRaw = r.amountRaw ?? null;
            d.notes = r.notes;
            d.inFile = true;
            copied++;
          }
        } else {
          draft.push({ ...r, inFile: true });
          copied++;
        }
      }
      if (copied)
        $("#budSave").disabled = false;
      renderBudgets();
      toast(copied ? `Copied ${copied} categories from the previous period` : "Nothing to copy — every category already has a value");
    }
    async function addNewCategory() {
      const cat = await promptCreateCategory();
      if (!cat)
        return;
      budgetDraft().push({ category: cat.name, type: cat.type, amount: 0, notes: "", inFile: false });
      renderBudgets();
    }
    ctx.provide({ renderBudgets, saveBudget, copyPreviousBudget, addNewCategory, invalidateBudgetDraft, budgetDirty });
  };
});

// src/views/accounts.js
var require_accounts = __commonJS((exports2, module2) => {
  var { el, icoEl, patchFrontmatter, safeSeg, yamlStr } = require_util();
  var { askFields } = require_modal();
  var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  var STALE_DAYS = 30;
  module2.exports = function registerAccounts(ctx) {
    const {
      S,
      $,
      app,
      money,
      toast,
      writeFile,
      ensureFolder,
      relPath,
      fileAt,
      txInPeriod,
      accountForLabel,
      periodMonthName
    } = ctx;
    const ACCT_GROUPS = [
      ["Bank accounts", ["checking", "credit_card", "cash"]],
      ["Savings", ["savings"]],
      ["Investments", ["investment"]],
      ["Other", ["other"]]
    ];
    const ACCT_TYPES = ACCT_GROUPS.flatMap(([, types]) => types);
    const ACCT_TYPE_LABELS = {
      checking: "Cheque / current account",
      savings: "Savings account",
      credit_card: "Credit card",
      cash: "Cash",
      investment: "Investment",
      other: "Other"
    };
    const ACCT_TYPE_OPTIONS = ACCT_TYPES.map((v) => ({ value: v, label: ACCT_TYPE_LABELS[v] }));
    const FM_WRITERS = {
      type: (a) => a.type,
      institution: (a) => a.institution ? yamlStr(a.institution) : null,
      account_number: (a) => a.account_number ? yamlStr(a.account_number) : null,
      tx_label: (a) => a.tx_label ? yamlStr(a.tx_label) : null,
      credit_limit: (a) => a.credit_limit ? a.credit_limit.toFixed(2) : null,
      goal_amount: (a) => a.goal_amount ? a.goal_amount.toFixed(2) : null,
      target_date: (a) => a.target_date || null,
      monthly_contribution: (a) => a.monthly_contribution ? a.monthly_contribution.toFixed(2) : null,
      total_invested: (a) => a.total_invested ? a.total_invested.toFixed(2) : null,
      starting_amount: (a) => a.starting_amount ? a.starting_amount.toFixed(2) : null,
      inception_date: (a) => a.inception_date || null
    };
    const EDITABLE_KEYS = Object.keys(FM_WRITERS);
    function parseAmount(v) {
      const s = String(v ?? "").trim();
      if (!s)
        return null;
      return parseFloat(s.replace(",", ".").replace(/[^\d.-]/g, ""));
    }
    function todayIso() {
      const d = new Date;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    function daysSince(iso) {
      if (!ISO_DATE.test(iso || ""))
        return null;
      const then = new Date(`${iso}T00:00:00`);
      if (isNaN(then.getTime()))
        return null;
      const today = new Date;
      today.setHours(0, 0, 0, 0);
      return Math.round((today.getTime() - then.getTime()) / 86400000);
    }
    function accountIndex() {
      const idx = new Map;
      for (const f of Object.values(S.txFiles)) {
        const a = accountForLabel(f.label);
        if (!a)
          continue;
        let e = idx.get(a);
        if (!e) {
          e = { rows: [], labels: new Set };
          idx.set(a, e);
        }
        e.labels.add(f.label);
        for (const r of f.rows)
          e.rows.push(r);
      }
      return idx;
    }
    function reconcile(a, rows) {
      if (!rows || !rows.length)
        return { state: "no-tx" };
      if (!ISO_DATE.test(a.balance_updated || ""))
        return { state: "no-date" };
      const today = todayIso();
      const since = [], ahead = [];
      for (const r of rows) {
        if (r.date <= a.balance_updated)
          continue;
        (r.date > today ? ahead : since).push(r);
      }
      const delta = since.reduce((s, r) => s + r.amount, 0);
      if (!since.length) {
        return ahead.length ? { state: "pending", ahead: ahead.length } : { state: "clean" };
      }
      return { state: "drift", count: since.length, ahead: ahead.length, delta, implied: a.balance + delta };
    }
    function periodActivity(labels) {
      let inAmt = 0, outAmt = 0, count = 0;
      for (const t of txInPeriod(S.period)) {
        if (!labels.has(t.label))
          continue;
        count++;
        if (t.amount >= 0)
          inAmt += t.amount;
        else
          outAmt += -t.amount;
      }
      return { inAmt, outAmt, count };
    }
    function openTransactions(label) {
      ctx.switchView("transactions");
      const sel = $("#txAccount");
      if ([...sel.options].some((o) => o.value === label))
        sel.value = label;
      $("#txCategory").value = "";
      $("#txSearch").value = "";
      ctx.renderTransactions();
    }
    async function openAccountFile(a) {
      const f = fileAt(`Accounts/${a.name}.md`);
      if (!f)
        return toast(`Accounts/${a.name}.md not found`, true);
      await app.workspace.getLeaf("tab").openFile(f);
    }
    async function editBalance(a) {
      const r = await askFields(app, `Update balance — ${a.name}`, [
        { key: "balance", label: "New balance", type: "number", value: a.balance.toFixed(2) }
      ]);
      if (!r)
        return;
      const num = parseAmount(r.balance);
      if (num === null || isNaN(num))
        return toast("Not a number", true);
      a.balance = num;
      a.balanceRaw = null;
      a.balance_updated = todayIso();
      await saveAccount(a);
      renderAccounts();
      toast(`${a.name} balance updated`);
    }
    async function acceptImplied(a, implied) {
      a.balance = implied;
      a.balanceRaw = null;
      a.balance_updated = todayIso();
      await saveAccount(a);
      renderAccounts();
      toast(`${a.name} reconciled to ${money(implied)}`);
    }
    async function editAccount(a) {
      const r = await askFields(app, `Edit account — ${a.name}`, [
        { key: "type", label: "Type", type: "select", options: ACCT_TYPE_OPTIONS, value: a.type },
        { key: "institution", label: "Institution", type: "text", value: a.institution },
        {
          key: "account_number",
          label: "Account number",
          type: "text",
          value: a.account_number,
          desc: "Used to match a downloaded statement to this account on import."
        },
        {
          key: "tx_label",
          label: "Transactions folder",
          type: "text",
          value: a.tx_label,
          desc: `Leave blank to use “${a.name}”. Set it only when the folder under Transactions/ has a different name.`
        },
        {
          key: "budget",
          label: "Counts toward the budget",
          type: "select",
          value: a.in_budget ? "yes" : "no",
          options: [
            { value: "yes", label: "Yes — normal spending account" },
            { value: "no", label: "No — investment or savings wrapper" }
          ]
        },
        {
          key: "credit_limit",
          label: "Credit limit",
          type: "number",
          value: a.credit_limit != null ? String(a.credit_limit) : "",
          desc: "Shows a utilisation bar on credit cards."
        },
        {
          key: "goal_amount",
          label: "Savings goal",
          type: "number",
          value: a.goal_amount != null ? String(a.goal_amount) : ""
        },
        { key: "target_date", label: "Goal target date", type: "date", value: a.target_date },
        {
          key: "monthly_contribution",
          label: "Monthly contribution",
          type: "number",
          value: a.monthly_contribution != null ? String(a.monthly_contribution) : ""
        },
        {
          key: "total_invested",
          label: "Total invested",
          type: "number",
          value: a.total_invested != null ? String(a.total_invested) : "",
          desc: "What you have put in, so growth can be shown against it."
        },
        {
          key: "starting_amount",
          label: "Starting amount",
          type: "number",
          value: a.starting_amount != null ? String(a.starting_amount) : ""
        },
        { key: "inception_date", label: "Opened on", type: "date", value: a.inception_date }
      ]);
      if (!r)
        return;
      if (!ACCT_TYPES.includes(r.type))
        return toast("Invalid type", true);
      const nums = {};
      for (const k of ["credit_limit", "goal_amount", "monthly_contribution", "total_invested", "starting_amount"]) {
        const n = parseAmount(r[k]);
        if (n !== null && isNaN(n))
          return toast(`${k.replace(/_/g, " ")} is not a number`, true);
        nums[k] = n;
      }
      a.type = r.type;
      a.institution = (r.institution || "").trim();
      a.account_number = (r.account_number || "").trim();
      a.tx_label = (r.tx_label || "").trim();
      a.in_budget = r.budget !== "no";
      Object.assign(a, nums);
      a.target_date = (r.target_date || "").trim();
      a.inception_date = (r.inception_date || "").trim();
      await saveAccount(a, EDITABLE_KEYS);
      ctx.render();
      toast(`${a.name} updated`);
    }
    async function toggleBudget(a) {
      a.in_budget = !a.in_budget;
      await saveAccount(a);
      renderAccounts();
      toast(a.in_budget ? `${a.name} counts toward the budget again` : `${a.name} no longer counts toward budget totals`);
    }
    function badge(text, cls) {
      return el("span", { class: `acct-badge${cls ? " " + cls : ""}` }, text);
    }
    function utilisationOf(a) {
      if (a.type !== "credit_card" || !a.credit_limit || a.credit_limit <= 0)
        return null;
      const used = Math.max(0, -a.balance);
      const pct = used / a.credit_limit * 100;
      const over = used > a.credit_limit;
      return { used, pct, over, near: !over && pct >= 85, available: a.credit_limit - used };
    }
    function utilisation(a) {
      const u = utilisationOf(a);
      if (!u)
        return null;
      const { used, pct, over, near, available } = u;
      return el("div", { class: "acct-util" }, el("div", { class: "acct-util-top" }, el("span", {}, "Credit used"), el("span", { class: "num" }, `${money(used, 0)} of ${money(a.credit_limit, 0)}`)), el("div", { class: "cat-bar" }, el("i", {
        class: `cat-bar-fill${over ? " bg-danger" : near ? " bg-warning" : ""}`,
        style: `width:${Math.min(100, pct).toFixed(1)}%`
      })), el("div", { class: `acct-util-sub${over ? " text-danger" : near ? " text-warning" : ""}` }, over ? `Over limit by ${money(-available, 0)}` : `${Math.round(pct)}% used · ${money(available, 0)} available`));
    }
    function renderKpis() {
      const wrap = $("#acctKpis");
      if (!wrap)
        return;
      wrap.empty();
      let assets = 0, liabilities = 0;
      for (const a of S.accounts) {
        if (a.balance >= 0)
          assets += a.balance;
        else
          liabilities += -a.balance;
      }
      const idx = accountIndex();
      const attention = S.accounts.filter((a) => {
        const e = idx.get(a);
        if (!e)
          return true;
        const d = daysSince(a.balance_updated);
        if (d === null || d > STALE_DAYS)
          return true;
        return reconcile(a, e.rows).state === "drift";
      }).length;
      const tile = (l, v, cls, sub) => {
        const t = el("div", { class: "mini" }, el("div", { class: "l" }, l), el("div", { class: `v num ${cls || ""}` }, v));
        if (sub)
          t.append(el("div", { class: "s" }, sub));
        wrap.append(t);
      };
      tile("Assets", money(assets), "text-success");
      tile("Liabilities", money(liabilities), liabilities > 0 ? "text-danger" : "");
      tile("Net worth", money(assets - liabilities), assets - liabilities >= 0 ? "grad-txt" : "text-danger");
      tile("Needs attention", String(attention), attention > 0 ? "text-warning" : "", attention > 0 ? "unverified or drifting balances" : "every balance checks out");
    }
    function accountTile(a, entry) {
      const labels = entry ? entry.labels : new Set;
      const rows = entry ? entry.rows : [];
      const card = el("div", { class: "mini" });
      const primary = [...labels][0];
      if (primary) {
        const nameBtn = el("button", {
          type: "button",
          class: "l acct-name-btn",
          "aria-label": `Show ${a.name} transactions`
        }, a.name);
        nameBtn.addEventListener("click", () => openTransactions(primary));
        card.append(nameBtn);
      } else {
        card.append(el("div", { class: "l" }, a.name));
      }
      const v = el("button", {
        type: "button",
        class: `v num${a.balance < 0 ? " text-danger" : ""}`,
        "aria-label": `Balance for ${a.name}, ${money(a.balance)} — click to update`
      }, money(a.balance));
      v.addEventListener("click", () => editBalance(a));
      card.append(v);
      const util = utilisation(a);
      card.append(el("div", { class: "s" }, [a.type.replace("_", " "), a.institution].filter(Boolean).join(" · "), !util && a.credit_limit ? ` · limit ${money(a.credit_limit, 0)}` : "", a.monthly_contribution ? ` · ${money(a.monthly_contribution, 0)}/m` : ""));
      if (util)
        card.append(util);
      const days = daysSince(a.balance_updated);
      const badges = el("div", { class: "acct-badges" });
      if (!a.in_budget)
        badges.append(badge("not in budget", "muted"));
      if (!rows.length)
        badges.append(badge("no transactions", "warn"));
      if (a.balance_updated && days === null)
        badges.append(badge(`as of ${a.balance_updated}`, "muted"));
      else if (days === null)
        badges.append(badge("never confirmed", "warn"));
      else if (days > STALE_DAYS)
        badges.append(badge(`unconfirmed ${days} days`, "warn"));
      if (badges.childElementCount)
        card.append(badges);
      const act = periodActivity(labels);
      if (act.count) {
        card.append(el("div", { class: "acct-act" }, el("span", { class: "text-success" }, `+${money(act.inAmt, 0)}`), " in · ", el("span", { class: "text-danger" }, `-${money(act.outAmt, 0)}`), " out · ", `${act.count} ${act.count === 1 ? "transaction" : "transactions"} in ${periodMonthName(S.period)}`));
      }
      const rec = reconcile(a, rows);
      const pending = (n) => n ? ` · ${n} dated ahead, not counted yet` : "";
      if (rec.state === "drift") {
        const line = el("div", { class: "acct-recon" }, el("div", { class: "acct-recon-txt" }, `${rec.count} ${rec.count === 1 ? "transaction" : "transactions"} since · implies `, el("b", { class: "num" }, money(rec.implied)), pending(rec.ahead)));
        const btn = el("button", {
          type: "button",
          class: "acct-recon-btn",
          "aria-label": `Set ${a.name} balance to ${money(rec.implied)}`
        }, icoEl(["check"]), "Use this");
        btn.addEventListener("click", () => acceptImplied(a, rec.implied));
        line.append(btn);
        card.append(line);
      } else if (rec.state === "clean") {
        card.append(el("div", { class: "acct-recon" }, el("div", { class: "acct-recon-txt text-success" }, "Matches your transactions")));
      } else if (rec.state === "pending") {
        card.append(el("div", { class: "acct-recon" }, el("div", { class: "acct-recon-txt text-muted" }, `Up to date · ${rec.ahead} ${rec.ahead === 1 ? "transaction" : "transactions"} dated ahead`)));
      } else if (rec.state === "no-date" && rows.length) {
        card.append(el("div", { class: "acct-recon" }, el("div", { class: "acct-recon-txt text-muted" }, "Set a balance date to check this against your transactions")));
      }
      const foot = el("div", { class: "acct-foot" });
      const updated = a.balance_updated ? `updated ${a.balance_updated}` : "no balance date";
      foot.append(el("span", { class: "s2" }, updated));
      const acts = el("span", { class: "acct-foot-acts" });
      const budgetBtn = el("button", {
        type: "button",
        class: "acct-link",
        "aria-label": a.in_budget ? `Stop counting ${a.name} toward budget totals` : `Count ${a.name} toward budget totals again`
      }, a.in_budget ? "Exclude from budget" : "Include in budget");
      budgetBtn.addEventListener("click", () => toggleBudget(a));
      const editBtn = el("button", {
        type: "button",
        class: "acct-link",
        "aria-label": `Edit ${a.name}`
      }, "Edit");
      editBtn.addEventListener("click", () => editAccount(a));
      const openBtn = el("button", {
        type: "button",
        class: "acct-link",
        "aria-label": `Open the ${a.name} note`
      }, "Open note");
      openBtn.addEventListener("click", () => openAccountFile(a));
      acts.append(editBtn, budgetBtn, openBtn);
      foot.append(acts);
      card.append(foot);
      return card;
    }
    function renderAccounts() {
      renderKpis();
      const idx = accountIndex();
      const wrap = $("#acctSections");
      wrap.empty();
      for (const [title, types] of ACCT_GROUPS) {
        const accounts = S.accounts.filter((a) => types.includes(a.type));
        if (!accounts.length)
          continue;
        const grid = el("div", { class: "mini-grid" });
        const total = accounts.reduce((a, b) => a + b.balance, 0);
        for (const a of accounts)
          grid.append(accountTile(a, idx.get(a)));
        wrap.append(el("div", { class: "card mb-4" }, el("div", { class: "card-h" }, el("div", {}, el("h2", {}, title), el("div", { class: "sub" }, `${accounts.length} accounts`)), el("div", { class: "legend" }, el("span", {}, el("b", { class: "num", style: "font-size:15px;color:var(--text-primary)" }, money(total))))), el("div", { class: "body-pad" }, grid)));
      }
      if (!S.accounts.length) {
        wrap.append(el("div", { class: "card" }, el("div", { class: "body-pad" }, el("p", { class: "text-muted", style: "margin:0" }, "No accounts yet. Use “New account” above to add a bank account, savings pot or investment."))));
      }
    }
    async function saveAccount(a, keys = []) {
      if (a.fmRaw) {
        const updates = {
          balance: a.balanceRaw != null ? a.balanceRaw : a.balance.toFixed(2),
          balance_updated: a.balance_updated || null,
          budget: a.in_budget ? null : "false"
        };
        for (const k of keys)
          updates[k] = FM_WRITERS[k](a);
        const fm = patchFrontmatter(a.fmRaw, updates);
        await writeFile(`Accounts/${a.name}.md`, `---
${fm}
---` + (a.body || `

# ${a.name}
`));
        a.fmRaw = fm;
        return;
      }
      const lines = ["---", `type: ${a.type}`];
      if (a.institution)
        lines.push(`institution: ${yamlStr(a.institution)}`);
      if (a.account_number)
        lines.push(`account_number: ${yamlStr(a.account_number)}`);
      lines.push(`balance: ${a.balance.toFixed(2)}`);
      if (a.balance_updated)
        lines.push(`balance_updated: ${a.balance_updated}`);
      if (!a.in_budget)
        lines.push("budget: false");
      if (a.credit_limit)
        lines.push(`credit_limit: ${a.credit_limit.toFixed(2)}`);
      if (a.goal_amount)
        lines.push(`goal_amount: ${a.goal_amount.toFixed(2)}`);
      if (a.target_date)
        lines.push(`target_date: ${a.target_date}`);
      if (a.monthly_contribution)
        lines.push(`monthly_contribution: ${a.monthly_contribution.toFixed(2)}`);
      if (a.total_invested)
        lines.push(`total_invested: ${a.total_invested.toFixed(2)}`);
      if (a.starting_amount)
        lines.push(`starting_amount: ${a.starting_amount.toFixed(2)}`);
      if (a.inception_date)
        lines.push(`inception_date: ${a.inception_date}`);
      if (a.tx_label)
        lines.push(`tx_label: ${yamlStr(a.tx_label)}`);
      if (a.tags)
        lines.push(`tags: ${a.tags}`);
      lines.push("---");
      await writeFile(`Accounts/${a.name}.md`, lines.join(`
`) + (a.body || `

# ${a.name}
`));
      a.fmRaw = lines.slice(1, -1).join(`
`);
    }
    async function addAccount() {
      const r = await askFields(app, "New account", [
        { key: "name", label: "Account name", type: "text", placeholder: "e.g. Easy Equities TFSA" },
        { key: "type", label: "Type", type: "select", options: ACCT_TYPE_OPTIONS, value: "savings" },
        { key: "institution", label: "Institution", type: "text", placeholder: "e.g. Easy Equities" },
        { key: "balance", label: "Current balance", type: "number", value: "0" },
        {
          key: "goal_amount",
          label: "Savings goal (optional)",
          type: "number",
          desc: "Shows a progress bar on Savings & Investments."
        },
        {
          key: "total_invested",
          label: "Total invested (optional)",
          type: "number",
          desc: "What you have put in, so growth can be shown against it."
        },
        {
          key: "budget",
          label: "Counts toward the budget",
          type: "select",
          value: "yes",
          options: [
            { value: "yes", label: "Yes — normal spending account" },
            { value: "no", label: "No — investment or savings wrapper" }
          ],
          desc: "Choose No for an account whose interest is not household income and whose contributions are not household spending. Its transactions still import and show in Transactions."
        }
      ]);
      if (!r)
        return;
      const name = safeSeg(r.name);
      if (!name)
        return toast("Account name required", true);
      if (S.accounts.some((a) => a.name.toLowerCase() === name.toLowerCase()))
        return toast("Account already exists", true);
      if (!ACCT_TYPES.includes(r.type))
        return toast("Invalid type", true);
      const balance = parseAmount(r.balance) ?? 0;
      const goal = parseAmount(r.goal_amount);
      const invested = parseAmount(r.total_invested);
      if ([balance, goal, invested].some((n) => n !== null && isNaN(n)))
        return toast("Not a number", true);
      const acct = {
        name,
        type: r.type,
        institution: (r.institution || "").trim(),
        account_number: "",
        tx_label: "",
        balance,
        balance_updated: todayIso(),
        in_budget: r.budget !== "no",
        credit_limit: null,
        goal_amount: goal,
        target_date: "",
        monthly_contribution: null,
        total_invested: invested,
        starting_amount: null,
        inception_date: "",
        tags: "[finance, finance/budget, finance/budget/accounts]",
        body: `

# ${name}

Transactions are stored under \`Transactions/${name}/\` as monthly files.
`
      };
      await saveAccount(acct);
      await ensureFolder(relPath(`Transactions/${name}`));
      S.accounts.push(acct);
      S.accounts.sort((a, b) => a.name.localeCompare(b.name));
      ctx.render();
      toast(`Created Accounts/${name}.md`);
    }
    ctx.provide({
      renderAccounts,
      saveAccount,
      addAccount,
      editAccount,
      accountIndex,
      accountReconcile: reconcile,
      accountUtilisation: utilisationOf,
      ACCOUNT_FM_KEYS: EDITABLE_KEYS
    });
  };
});

// src/views/savings.js
var require_savings = __commonJS((exports2, module2) => {
  var { el } = require_util();
  module2.exports = function registerSavings(ctx) {
    const { S, $, money } = ctx;
    function renderSavings() {
      const savings = S.accounts.filter((a) => a.type === "savings");
      const investments = S.accounts.filter((a) => a.type === "investment");
      const totalSavings = savings.reduce((s, a) => s + a.balance, 0);
      const totalInvest = investments.reduce((s, a) => s + a.balance, 0);
      const netWorth = S.accounts.reduce((s, a) => s + a.balance, 0);
      const creditDebt = S.accounts.filter((a) => a.type === "credit_card").reduce((s, a) => s + Math.min(0, a.balance), 0);
      const kpis = $("#savingsKpis");
      kpis.empty();
      const tile = (l, v, cls) => kpis.append(el("div", { class: "mini" }, el("div", { class: "l" }, l), el("div", { class: `v num ${cls || ""}` }, v)));
      tile("Net worth", money(netWorth), netWorth >= 0 ? "grad-txt" : "text-danger");
      tile("Savings", money(totalSavings));
      tile("Investments", money(totalInvest));
      tile("Credit debt", money(creditDebt), "text-danger");
      const withGoals = S.accounts.filter((a) => a.goal_amount);
      const goalsWrap = $("#savingsGoals");
      goalsWrap.empty();
      if (!withGoals.length) {
        goalsWrap.append(el("p", { class: "text-muted", style: "margin:0" }, "No goals set yet. Add a goal_amount (and optional target_date) to any account file to track progress here."));
      } else {
        const g = el("div", { class: "goals" });
        for (const a of withGoals) {
          const pct = Math.min(100, Math.max(0, a.balance / a.goal_amount * 100));
          const reached = a.balance >= a.goal_amount;
          g.append(el("div", {}, el("div", { class: "goal-h" }, el("div", { class: "gn" }, a.name), el("div", { class: "gv" }, el("b", {}, money(a.balance)), " / ", money(a.goal_amount))), el("div", { class: "cat-bar" }, el("i", { class: "cat-bar-fill", style: `width:${pct}%` })), el("div", { class: "goal-pct" }, reached ? "Goal reached!" : `${Math.round(pct)}%${a.target_date ? " · target " + a.target_date : ""}`)));
        }
        goalsWrap.append(g);
      }
      const wrap = $("#savingsSections");
      wrap.empty();
      for (const [title, list] of [["Savings", savings], ["Investments", investments]]) {
        if (!list.length)
          continue;
        const grid = el("div", { class: "mini-grid" });
        const total = list.reduce((s, a) => s + a.balance, 0);
        for (const a of list) {
          const parts = [[a.type.replace("_", " "), a.institution].filter(Boolean).join(" · ")];
          if (a.monthly_contribution)
            parts.push(`${money(a.monthly_contribution, 0)}/m`);
          const card = el("div", { class: "mini" }, el("div", { class: "l" }, a.name), el("div", { class: "v num" }, money(a.balance)), el("div", { class: "s" }, parts.filter(Boolean).join(" · ")));
          const baseline = a.total_invested || a.starting_amount;
          if (baseline) {
            const growth = a.balance - baseline;
            card.append(el("div", { class: `s2 num ${growth >= 0 ? "text-success" : "text-danger"}` }, `${growth >= 0 ? "▲" : "▼"} ${money(Math.abs(growth), 0)} vs ${money(baseline, 0)} in`));
          } else if (a.inception_date) {
            card.append(el("div", { class: "s2" }, `since ${a.inception_date}`));
          }
          grid.append(card);
        }
        wrap.append(el("div", { class: "card mb-4" }, el("div", { class: "card-h" }, el("div", {}, el("h2", {}, title), el("div", { class: "sub" }, `${list.length} accounts`)), el("div", { class: "legend" }, el("span", {}, el("b", { class: "num", style: "font-size:15px;color:var(--text-primary)" }, money(total))))), el("div", { class: "body-pad" }, grid)));
      }
    }
    ctx.provide({ renderSavings });
  };
});

// src/debt-math.js
var require_debt_math = __commonJS((exports2, module2) => {
  var EPS = 0.005;
  var MAX_MONTHS = 600;
  var monthlyRate = (rate) => (Number(rate) || 0) / 100 / 12;
  function amortise(balance, rate, payment, maxMonths = MAX_MONTHS) {
    let b = Number(balance) || 0;
    const r = monthlyRate(rate);
    const pay = Number(payment) || 0;
    if (b <= EPS)
      return { months: 0, interest: 0, settled: true };
    if (pay <= 0)
      return { months: maxMonths, interest: 0, settled: false };
    let interest = 0, m = 0;
    while (b > EPS && m < maxMonths) {
      m++;
      const i = b * r;
      b += i;
      interest += i;
      b -= Math.min(pay, b);
    }
    return { months: m, interest, settled: b <= EPS };
  }
  var monthlyInterest = (balance, rate) => Math.max(0, Number(balance) || 0) * monthlyRate(rate);
  function priorityOrder(debts, strategy) {
    const open = debts.filter((d) => d.balance > EPS);
    const tie = (a, b) => a.name.localeCompare(b.name) || (a.key ?? 0) - (b.key ?? 0);
    if (strategy === "snowball") {
      return open.sort((a, b) => a.balance - b.balance || tie(a, b));
    }
    return open.sort((a, b) => b.rate - a.rate || a.balance - b.balance || tie(a, b));
  }
  function simulate(debts, { extra = 0, strategy = "avalanche", maxMonths = MAX_MONTHS } = {}) {
    const list = (debts || []).map((d, idx) => ({
      key: d.key ?? idx,
      name: d.name,
      balance: Number(d.balance) || 0,
      rate: Number(d.rate) || 0,
      payment: Math.max(0, (Number(d.payment) || 0) + (Number(d.extra) || 0))
    })).filter((d) => d.balance > EPS);
    if (!list.length)
      return { months: 0, interest: 0, payoff: {}, settled: true, stalled: [] };
    const roll = strategy !== "minimum";
    const pool = roll ? Math.max(0, Number(extra) || 0) : 0;
    const payoff = Object.create(null);
    let interest = 0, m = 0;
    while (m < maxMonths && list.some((d) => d.balance > EPS)) {
      m++;
      let free = pool;
      for (const d of list) {
        if (d.balance <= EPS) {
          if (roll)
            free += d.payment;
          continue;
        }
        const i = d.balance * monthlyRate(d.rate);
        d.balance += i;
        interest += i;
        const paid = Math.min(d.payment, d.balance);
        d.balance -= paid;
        if (roll)
          free += d.payment - paid;
        if (d.balance <= EPS) {
          d.balance = 0;
          payoff[d.key] = m;
        }
      }
      if (roll && free > EPS) {
        for (const d of priorityOrder(list, strategy)) {
          if (free <= EPS)
            break;
          const paid = Math.min(free, d.balance);
          d.balance -= paid;
          free -= paid;
          if (d.balance <= EPS) {
            d.balance = 0;
            payoff[d.key] = m;
          }
        }
      }
    }
    const stalled = list.filter((d) => d.balance > EPS).map((d) => d.name);
    return { months: m, interest, payoff, settled: !stalled.length, stalled };
  }
  function addMonths(n, from = new Date) {
    const d = new Date(from.getFullYear(), from.getMonth() + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  function humanMonths(n) {
    if (!Number.isFinite(n) || n <= 0)
      return "—";
    if (n < 12)
      return `${n} month${n === 1 ? "" : "s"}`;
    const y = Math.floor(n / 12), r = n % 12;
    return r ? `${y} yr ${r} mo` : `${y} year${y === 1 ? "" : "s"}`;
  }
  module2.exports = { amortise, monthlyInterest, simulate, priorityOrder, addMonths, humanMonths, MAX_MONTHS, EPS };
});

// src/views/debts.js
var require_debts = __commonJS((exports2, module2) => {
  var { el, keepScroll, escMd, icoEl } = require_util();
  var { askFields } = require_modal();
  var { MONTHS } = require_constants();
  var { amortise, monthlyInterest, simulate, priorityOrder, addMonths, humanMonths } = require_debt_math();
  var DEBT_TYPES = ["credit card", "personal loan", "vehicle", "home loan", "student", "store account", "overdraft", "other"];
  module2.exports = function registerDebts(ctx) {
    const { S, $, app, money, toast, writeFile, txInPeriod, periodSummary } = ctx;
    const mark = () => {
      S.debtsDirty = true;
      $("#debtSave").disabled = false;
    };
    ctx.registerDirty(() => S.debtsDirty);
    const active = () => S.debts.filter((d) => d.status !== "paid").map((d, i) => ({ ...d, key: i }));
    const committed = (d) => (d.payment || 0) + (d.extra || 0);
    const planExtra = () => Math.max(0, parseFloat($("#debtExtra").value) || 0);
    const planStrategy = () => $("#debtStrategy").value === "snowball" ? "snowball" : "avalanche";
    function monthLabel(ym) {
      const [y, m] = ym.split("-").map(Number);
      return `${MONTHS[m - 1]} ${y}`;
    }
    function renderDebtKpis() {
      const list = active();
      const total = list.reduce((s, d) => s + d.balance, 0);
      const perMonth = list.reduce((s, d) => s + committed(d), 0);
      const interest = list.reduce((s, d) => s + monthlyInterest(d.balance, d.rate), 0);
      const plan = simulate(list, { extra: planExtra(), strategy: planStrategy() });
      const kpis = $("#debtKpis");
      kpis.empty();
      const tile = (l, v, cls, sub) => {
        const t = el("div", { class: "mini" }, el("div", { class: "l" }, l), el("div", { class: `v num ${cls || ""}` }, v));
        if (sub)
          t.append(el("div", { class: "s" }, sub));
        kpis.append(t);
      };
      tile("Total debt", money(total), total > 0 ? "text-danger" : "text-success", `${list.length} active · ${S.debts.length} tracked`);
      tile("Paying per month", money(perMonth), "", perMonth ? `${money(perMonth * 12, 0)} a year` : "nothing budgeted");
      tile("Interest this month", money(interest), interest > 0 ? "text-warning" : "", perMonth > 0 ? `${Math.round(interest / perMonth * 100)}% of your payments` : "");
      tile("Debt-free", plan.settled && plan.months ? monthLabel(addMonths(plan.months)) : total > 0 ? "never" : "—", plan.settled && plan.months ? "grad-txt" : total > 0 ? "text-danger" : "", plan.settled && plan.months ? humanMonths(plan.months) : total > 0 ? "payments too low" : "no debt tracked");
    }
    function renderDebtPlan() {
      const list = active();
      const wrap = $("#debtPlan");
      wrap.empty();
      const order = $("#debtOrder");
      order.empty();
      if (!list.length) {
        wrap.append(el("p", { class: "text-muted", style: "margin:0" }, "Add a debt below and this becomes a payoff plan — how long each method takes, and what it saves."));
        return;
      }
      const extra = planExtra();
      const chosen = planStrategy();
      const base = simulate(list, { strategy: "minimum" });
      const runs = [
        { key: "minimum", label: "Minimum only", note: "Contracted payments, nothing extra", res: base },
        { key: "snowball", label: "Snowball", note: "Smallest balance first", res: simulate(list, { extra, strategy: "snowball" }) },
        { key: "avalanche", label: "Avalanche", note: "Highest rate first", res: simulate(list, { extra, strategy: "avalanche" }) }
      ];
      const grid = el("div", { class: "debt-plans" });
      for (const r of runs) {
        const saved = base.settled && r.res.settled ? base.interest - r.res.interest : 0;
        const sooner = base.settled && r.res.settled ? base.months - r.res.months : 0;
        const card = el("div", { class: `debt-plan${r.key === chosen ? " is-chosen" : ""}` }, el("div", { class: "dp-h" }, el("b", {}, r.label), r.key === chosen ? el("span", { class: "dp-tag" }, "selected") : ""), el("div", { class: "dp-note" }, r.note), el("div", { class: "dp-date num" }, r.res.settled && r.res.months ? monthLabel(addMonths(r.res.months)) : "never"), el("div", { class: "dp-sub" }, r.res.settled && r.res.months ? humanMonths(r.res.months) : "payments never clear the interest"), el("div", { class: "dp-row" }, el("span", {}, "Interest"), el("b", { class: "num" }, r.res.settled ? money(r.res.interest, 0) : "—")));
        if (r.key !== "minimum" && saved > 1) {
          card.append(el("div", { class: "dp-save num" }, `Saves ${money(saved, 0)}${sooner > 0 ? ` · ${humanMonths(sooner)} sooner` : ""}`));
          if (extra > 0)
            card.append(el("div", { class: "dp-src" }, `includes your ${money(extra, 0)}/mo extra`));
        }
        grid.append(card);
      }
      wrap.append(grid);
      if (!base.settled) {
        wrap.append(el("p", { class: "text-danger", style: "margin:14px 0 0;font-size:12.5px" }, `On the contracted payments alone, ${base.stalled.join(", ")} never clears — the interest is at or above the payment. ` + "Raise the payment or add extra above."));
      }
      const plan = runs.find((r) => r.key === chosen).res;
      const seq = priorityOrder(list.map((d) => ({ ...d })), chosen);
      order.append(el("div", { class: "sub", style: "margin-bottom:10px" }, `Put every spare rand at these in order${extra ? ` — ${money(extra, 0)} extra a month` : ""}. ` + "As each one closes, its payment rolls into the next."));
      const ol = el("ol", { class: "debt-order" });
      for (const d of seq) {
        const at = plan.payoff[d.key];
        ol.append(el("li", {}, el("span", { class: "do-n" }, d.name), el("span", { class: "do-m num" }, `${(d.rate || 0).toFixed(2)}% · ${money(d.balance, 0)}`), el("span", { class: "do-d" }, at ? `clear ${monthLabel(addMonths(at))}` : "not clearing")));
      }
      order.append(ol);
    }
    function renderDebtPayments() {
      const wrap = $("#debtPayments");
      wrap.empty();
      const list = active();
      if (!list.length)
        return;
      const tx = txInPeriod(S.period).filter((t) => !t.excluded);
      const linked = list.filter((d) => d.category);
      const unlinked = list.filter((d) => !d.category);
      const committedAll = list.reduce((s, d) => s + committed(d), 0);
      let linkedPlanned = 0, linkedPaid = 0;
      if (!linked.length) {
        wrap.append(el("p", { class: "text-muted", style: "margin:0" }, "Set a category on a debt below and its real payments show up here, read straight from your transactions."));
      } else {
        const byCat = Object.create(null);
        for (const d of linked)
          (byCat[d.category] ??= []).push(d);
        const rows = el("div", { class: "goals" });
        for (const cat of Object.keys(byCat).sort()) {
          const group = byCat[cat];
          const paid = tx.filter((t) => t.cat === cat && t.amount < 0).reduce((s, t) => s - t.amount, 0);
          const planned = group.reduce((s, d) => s + committed(d), 0);
          linkedPlanned += planned;
          linkedPaid += paid;
          const pct = planned > 0 ? Math.min(100, paid / planned * 100) : paid > 0 ? 100 : 0;
          const short = planned - paid;
          rows.append(el("div", {}, el("div", { class: "goal-h" }, el("div", { class: "gn" }, cat, el("span", { class: "text-muted", style: "font-weight:400" }, ` · ${group.map((d) => d.name).join(", ")}`)), el("div", { class: "gv" }, el("b", {}, money(paid)), " / ", money(planned))), el("div", { class: "cat-bar" }, el("i", { class: `cat-bar-fill${paid >= planned && planned > 0 ? "" : " bg-warning"}`, style: `width:${pct}%` })), el("div", { class: "goal-pct" }, planned <= 0 ? "No payment budgeted against this category" : short > 0.5 ? `${money(short)} short this period` : `Paid in full${paid - planned > 0.5 ? ` · ${money(paid - planned)} extra` : ""}`)));
        }
        wrap.append(rows);
      }
      const iv = ctx.intervalDays();
      const rawIncome = periodSummary(S.period).income;
      const income = iv ? rawIncome * (365.25 / 12) / iv : rawIncome;
      const scaleNote = iv ? " monthly income, scaled from this period’s," : " income";
      const note = el("div", { class: "debt-dti" });
      if (income > 0) {
        const ratio = committedAll / income * 100;
        note.append(el("b", { class: `num ${ratio > 36 ? "text-danger" : ratio > 20 ? "text-warning" : "text-success"}` }, `${ratio.toFixed(1)}%`), ` of your${scaleNote} goes to debt payments — ${money(committedAll)} across ` + `${list.length} debt${list.length === 1 ? "" : "s"}`, el("span", { class: "text-muted" }, ratio > 36 ? ". Lenders treat above 36% as stretched." : "."));
      } else {
        note.append(el("span", { class: "text-muted" }, `${money(committedAll)} a month across ${list.length} debt${list.length === 1 ? "" : "s"}. ` + "No income recorded this period, so there is no ratio to show yet."));
      }
      if (linked.length) {
        note.append(el("div", { class: "text-muted", style: "margin-top:4px" }, `${money(linkedPaid)} paid of the ${money(linkedPlanned)} you track by category this period.`));
      }
      if (unlinked.length) {
        const off = unlinked.reduce((s, d) => s + committed(d), 0);
        const one = unlinked.length === 1;
        note.append(el("div", { class: "text-muted", style: "margin-top:4px" }, `${unlinked.length} debt${one ? "" : "s"} (${money(off)} a month) ` + `${one ? "has" : "have"} no category linked, so ${one ? "its" : "their"} payments are not tracked above.`));
      }
      wrap.append(note);
    }
    function renderDebts(focusRow) {
      renderDebtKpis();
      renderDebtPlan();
      renderDebtPayments();
      const t = $("#debtTable");
      keepScroll(t, () => {
        t.empty();
        t.append(el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Debt"), el("th", { scope: "col", class: "num" }, "Balance"), el("th", { scope: "col", class: "num" }, "Rate %"), el("th", { scope: "col", class: "num" }, "Payment"), el("th", { scope: "col", class: "num" }, "Extra"), el("th", { scope: "col" }, "Category"), el("th", { scope: "col" }, "Paid off"), el("th", { scope: "col" }, "Clear by"), el("th", { scope: "col", class: "num" }, "Interest left"), el("th", { scope: "col" }, "Status"), el("th", { scope: "col" }, ""))));
        const body = el("tbody", {});
        for (const d of S.debts) {
          let refreshRow = function() {
            const paidOff = d.original > 0 ? Math.min(100, Math.max(0, (d.original - d.balance) / d.original * 100)) : 0;
            barFill.style.width = `${paidOff}%`;
            payoffCell.empty();
            payoffCell.append(d.original > 0 ? el("div", { class: "debt-prog" }, el("div", { class: "cat-bar" }, barFill), el("span", { class: "num" }, `${Math.round(paidOff)}%`)) : el("span", { class: "text-muted" }, "—"));
            const a = amortise(d.balance, d.rate, committed(d));
            clearCell.empty();
            interestCell.empty();
            if (d.status === "paid") {
              clearCell.append(el("span", { class: "text-success" }, "settled"));
              interestCell.append(el("span", { class: "text-muted" }, "—"));
            } else if (!a.settled) {
              clearCell.append(el("span", { class: "text-danger" }, committed(d) > 0 ? "never" : "no payment"));
              interestCell.append(el("span", { class: "text-danger num" }, `+${money(monthlyInterest(d.balance, d.rate), 0)}/mo`));
            } else {
              clearCell.append(el("span", {}, monthLabel(addMonths(a.months))), el("div", { class: "text-muted", style: "font-size:11.5px" }, humanMonths(a.months)));
              interestCell.append(money(a.interest, 0));
            }
          };
          const payoffCell = el("td", { class: "num" });
          const clearCell = el("td", {});
          const interestCell = el("td", { class: "num" });
          const barFill = el("i", { class: "cat-bar-fill" });
          const paidPill = d.status === "paid";
          const pill = el("button", {
            class: `status-pill status-${paidPill ? "paid" : "outstanding"}`,
            "aria-label": `${d.name}: ${paidPill ? "Settled" : "Active"} — click to change`
          }, icoEl(paidPill ? ["circle-check", "check-circle"] : ["hourglass"]), paidPill ? "Settled" : "Active");
          pill.addEventListener("click", () => {
            const row = S.debts.indexOf(d);
            d.status = paidPill ? "active" : "paid";
            mark();
            renderDebts(row);
          });
          const refreshAll = () => {
            mark();
            refreshRow();
            renderDebtKpis();
            renderDebtPlan();
            renderDebtPayments();
          };
          body.append(el("tr", { class: paidPill ? "debt-settled" : "" }, el("td", {}, el("div", { style: "font-weight:600" }, d.name), el("div", { class: "text-muted", style: "font-size:11.5px" }, [d.lender, d.type].filter(Boolean).join(" · ") || "—")), el("td", { class: "num" }, el("input", {
            type: "number",
            step: "0.01",
            class: "form-control form-control-sm",
            value: d.balance || "",
            style: "width:120px",
            "aria-label": `Balance owed on ${d.name}`,
            onchange: (e) => {
              d.balance = Math.max(0, parseFloat(e.target.value) || 0);
              refreshAll();
            }
          })), el("td", { class: "num" }, el("input", {
            type: "number",
            step: "0.01",
            class: "form-control form-control-sm",
            value: d.rate || "",
            style: "width:84px",
            "aria-label": `Annual interest rate on ${d.name}`,
            onchange: (e) => {
              d.rate = Math.max(0, parseFloat(e.target.value) || 0);
              refreshAll();
            }
          })), el("td", { class: "num" }, el("input", {
            type: "number",
            step: "0.01",
            class: "form-control form-control-sm",
            value: d.payment || "",
            style: "width:110px",
            "aria-label": `Monthly payment on ${d.name}`,
            onchange: (e) => {
              d.payment = Math.max(0, parseFloat(e.target.value) || 0);
              refreshAll();
            }
          })), el("td", { class: "num" }, el("input", {
            type: "number",
            step: "0.01",
            class: "form-control form-control-sm",
            value: d.extra || "",
            style: "width:100px",
            "aria-label": `Extra paid each month on ${d.name}`,
            onchange: (e) => {
              d.extra = Math.max(0, parseFloat(e.target.value) || 0);
              refreshAll();
            }
          })), el("td", {}, el("select", {
            class: "form-select form-select-sm",
            "aria-label": `Budget category for ${d.name}`,
            onchange: (e) => {
              d.category = e.target.value;
              mark();
              renderDebtPayments();
            }
          }, el("option", { value: "", ...d.category ? {} : { selected: "" } }, "— none —"), ...d.category && !S.categories.some((c) => c.name === d.category) ? [el("option", { value: d.category, selected: "" }, `${d.category} (missing)`)] : [], ...S.categories.map((c) => el("option", { value: c.name, ...c.name === d.category ? { selected: "" } : {} }, c.name)))), payoffCell, clearCell, interestCell, el("td", {}, pill), el("td", {}, el("button", {
            class: "btn-ghost btn-ghost-sm",
            "aria-label": `Remove ${d.name}`,
            onclick: () => {
              S.debts.splice(S.debts.indexOf(d), 1);
              mark();
              renderDebts();
            }
          }, "✕"))));
          refreshRow();
        }
        if (!S.debts.length) {
          body.append(el("tr", {}, el("td", { colspan: "11", class: "text-muted" }, "No debts tracked. Add one above — you only need the balance, the rate and what you pay each month.")));
        }
        t.append(body);
      });
      if (focusRow !== undefined && focusRow >= 0) {
        const pill = t.querySelectorAll(".status-pill")[focusRow];
        if (pill)
          pill.focus();
      }
    }
    function serializeDebts() {
      const lines = [
        "---",
        ...(S.debtsFm || "kind: debts").split(`
`),
        "---",
        "",
        "# Debts",
        "",
        "Money the household owes. `rate` is the annual interest rate as a percentage,",
        "`payment` the contracted monthly amount and `extra` anything paid on top of it.",
        "`status` is `active` or `paid`.",
        "",
        "| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |",
        "|------|--------|------|--------:|---------:|-----:|--------:|------:|------------|----------|--------|-------|"
      ];
      for (const d of S.debts) {
        lines.push(`| ${escMd(d.name)} | ${escMd(d.lender)} | ${escMd(d.type)} | ${d.balance.toFixed(2)} | ` + `${d.original.toFixed(2)} | ${d.rate.toFixed(2)} | ${d.payment.toFixed(2)} | ${d.extra.toFixed(2)} | ` + `${escMd(d.start)} | ${escMd(d.category)} | ${d.status} | ${escMd(d.notes)} |`);
      }
      lines.push("");
      return lines.join(`
`);
    }
    async function saveDebts() {
      await writeFile("Debts.md", serializeDebts());
      S.debtsDirty = false;
      $("#debtSave").disabled = true;
      toast("Saved Debts.md");
    }
    async function addDebt() {
      const r = await askFields(app, "New debt", [
        { key: "name", label: "What is it?", type: "text" },
        { key: "lender", label: "Lender", type: "text" },
        { key: "type", label: "Kind of debt", type: "select", value: "credit card", options: DEBT_TYPES },
        { key: "balance", label: "Balance still owed", type: "number", value: "0" },
        { key: "rate", label: "Interest rate (% a year)", type: "number", value: "0" },
        { key: "payment", label: "Monthly payment", type: "number", value: "0" },
        { key: "category", label: "Budget category (links its transactions)", type: "select", options: ["", ...S.categories.map((c) => c.name)], value: "" }
      ]);
      if (!r || !r.name.trim())
        return;
      const name = r.name.trim();
      const num = (v) => parseFloat(String(v ?? "").replace(",", "."));
      const balance = num(r.balance), rate = num(r.rate), payment = num(r.payment);
      if ([balance, rate, payment].some(isNaN))
        return toast("Balance, rate and payment must be numbers", true);
      const today = new Date;
      S.debts.push({
        name,
        lender: (r.lender || "").trim(),
        type: r.type || "other",
        balance: Math.max(0, balance),
        original: Math.max(0, balance),
        rate: Math.max(0, rate),
        payment: Math.max(0, payment),
        extra: 0,
        start: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
        category: (r.category || "").trim(),
        status: "active",
        notes: ""
      });
      S.debtsDirty = true;
      $("#debtSave").disabled = false;
      renderDebts();
    }
    function replan() {
      renderDebtKpis();
      renderDebtPlan();
    }
    ctx.provide({ renderDebts, saveDebts, addDebt, serializeDebts, replan, DEBT_TYPES });
  };
});

// src/views/owed.js
var require_owed = __commonJS((exports2, module2) => {
  var { el, dateInput, keepScroll, escMd, icoEl } = require_util();
  var { askFields } = require_modal();
  module2.exports = function registerOwed(ctx) {
    const { S, $, app, money, toast, writeFile } = ctx;
    const mark = () => {
      S.owedDirty = true;
      $("#owedSave").disabled = false;
    };
    ctx.registerDirty(() => S.owedDirty);
    function renderOwedKpis() {
      const outstanding = S.owed.filter((o) => o.status !== "paid").reduce((s, o) => s + o.amount, 0);
      const paid = S.owed.filter((o) => o.status === "paid").reduce((s, o) => s + o.amount, 0);
      const kpis = $("#owedKpis");
      kpis.empty();
      const tile = (l, v, cls) => kpis.append(el("div", { class: "mini" }, el("div", { class: "l" }, l), el("div", { class: `v num ${cls || ""}` }, v)));
      tile("Outstanding", money(outstanding), outstanding > 0 ? "text-warning" : "");
      tile("Paid", money(paid), "text-success");
      tile("Entries", String(S.owed.length));
    }
    function renderOwed(focusPerson) {
      renderOwedKpis();
      const t = $("#owedTable");
      keepScroll(t, () => {
        t.empty();
        t.append(el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Person"), el("th", { scope: "col" }, "Description"), el("th", { scope: "col", class: "num" }, "Amount"), el("th", { scope: "col" }, "Due date"), el("th", { scope: "col" }, "Status"), el("th", { scope: "col" }, ""))));
        const body = el("tbody", {});
        for (const o of S.owed) {
          const pill = el("button", {
            class: `status-pill status-${o.status}`,
            "aria-label": `${o.person}: ${o.status === "paid" ? "Paid" : "Outstanding"} — click to change`
          }, icoEl(o.status === "paid" ? ["circle-check", "check-circle"] : ["hourglass"]), o.status === "paid" ? "Paid" : "Outstanding");
          pill.addEventListener("click", () => {
            o.status = o.status === "paid" ? "outstanding" : "paid";
            mark();
            renderOwed(o.person);
          });
          body.append(el("tr", {}, el("td", { style: "font-weight:600" }, o.person), el("td", {}, el("input", {
            type: "text",
            class: "form-control form-control-sm",
            value: o.description,
            style: "width:220px",
            "aria-label": `Description for ${o.person}`,
            onchange: (e) => {
              o.description = e.target.value;
              mark();
            }
          })), el("td", { class: "num" }, el("input", {
            type: "number",
            step: "0.01",
            class: "form-control form-control-sm",
            value: o.amount || "",
            "aria-label": `Amount for ${o.person}`,
            onchange: (e) => {
              o.amount = parseFloat(e.target.value) || 0;
              mark();
              renderOwedKpis();
            }
          })), el("td", {}, dateInput(o.due, { class: "form-control form-control-sm", style: "width:120px", "aria-label": `Due date for ${o.person}` }, (v) => {
            o.due = v;
            mark();
          })), el("td", {}, pill), el("td", {}, el("button", {
            class: "btn-ghost btn-ghost-sm",
            "aria-label": `Remove ${o.person}`,
            onclick: () => {
              S.owed.splice(S.owed.indexOf(o), 1);
              mark();
              renderOwed();
            }
          }, "✕"))));
        }
        if (!S.owed.length)
          body.append(el("tr", {}, el("td", { colspan: "6", class: "text-muted" }, "No entries yet.")));
        t.append(body);
      });
      if (focusPerson) {
        const i = S.owed.findIndex((o) => o.person === focusPerson);
        const pill = t.querySelectorAll(".status-pill")[i];
        if (pill)
          pill.focus();
      }
    }
    function serializeOwed() {
      const lines = [
        "---",
        ...(S.owedFm || "kind: owed").split(`
`),
        "---",
        "",
        "# Owed Money",
        "",
        "Money owed to the household. `status` is `outstanding` or `paid`.",
        "",
        "| Person | Amount | Description | Due date | Status |",
        "|--------|-------:|-------------|----------|--------|"
      ];
      for (const o of S.owed) {
        lines.push(`| ${escMd(o.person)} | ${o.amount.toFixed(2)} | ${escMd(o.description)} | ${escMd(o.due)} | ${o.status} |`);
      }
      lines.push("");
      return lines.join(`
`);
    }
    async function saveOwed() {
      await writeFile("Owed Money.md", serializeOwed());
      S.owedDirty = false;
      $("#owedSave").disabled = true;
      toast("Saved Owed Money.md");
    }
    async function addOwed() {
      const r = await askFields(app, "New owed entry", [
        { key: "person", label: "Who owes / is owed?", type: "text" },
        { key: "amount", label: "Amount", type: "number", value: "0" }
      ]);
      if (!r || !r.person.trim())
        return;
      const amount = parseFloat(String(r.amount).replace(",", "."));
      if (isNaN(amount))
        return toast("Not a number", true);
      S.owed.push({ person: r.person.trim(), amount, description: "", due: "", status: "outstanding" });
      S.owedDirty = true;
      $("#owedSave").disabled = false;
      renderOwed();
    }
    ctx.provide({ renderOwed, saveOwed, addOwed, serializeOwed });
  };
});

// src/views/services.js
var require_services = __commonJS((exports2, module2) => {
  var { el, dateInput, keepScroll, escMd } = require_util();
  var { askFields } = require_modal();
  module2.exports = function registerServices(ctx) {
    const { S, $, app, money, toast, writeFile } = ctx;
    function monthlyEquiv(s) {
      return s.cycle === "annual" ? s.amount / 12 : s.amount;
    }
    const mark = () => {
      S.servicesDirty = true;
      $("#svcSave").disabled = false;
    };
    ctx.registerDirty(() => S.servicesDirty);
    function renderServicesKpis() {
      const active = S.services.filter((s) => s.active);
      const perMonth = active.reduce((sum, s) => sum + monthlyEquiv(s), 0);
      const kpis = $("#servicesKpis");
      kpis.empty();
      const tile = (l, v) => kpis.append(el("div", { class: "mini" }, el("div", { class: "l" }, l), el("div", { class: "v num" }, v)));
      tile("Per month", money(perMonth));
      tile("Per year", money(perMonth * 12));
      tile("Active", String(active.length));
      tile("Total services", String(S.services.length));
    }
    function renderServiceSubtotals() {
      const groups = Object.create(null);
      for (const s of S.services)
        (groups[s.category || "Uncategorised"] ??= []).push(s);
      for (const row of $("#svcTable").querySelectorAll("tr.type-row")) {
        const cat = row.dataset.cat;
        const list = groups[cat] || [];
        const gMonthly = list.filter((s) => s.active).reduce((sum, s) => sum + monthlyEquiv(s), 0);
        row.lastElementChild.textContent = `${money(gMonthly, 0)}/mo`;
      }
    }
    function renderServices() {
      renderServicesKpis();
      const t = $("#svcTable");
      keepScroll(t, () => {
        t.empty();
        t.append(el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Service"), el("th", { scope: "col" }, "Provider"), el("th", { scope: "col", class: "num" }, "Amount"), el("th", { scope: "col" }, "Cycle"), el("th", { scope: "col" }, "Next billing"), el("th", { scope: "col" }, "Active"), el("th", { scope: "col" }, ""))));
        const body = el("tbody", {});
        const groups = Object.create(null);
        for (const s of S.services)
          (groups[s.category || "Uncategorised"] ??= []).push(s);
        for (const cat of Object.keys(groups).sort()) {
          const gMonthly = groups[cat].filter((s) => s.active).reduce((sum, s) => sum + monthlyEquiv(s), 0);
          body.append(el("tr", { class: "type-row", "data-cat": cat }, el("td", { colspan: "6" }, cat), el("td", { class: "num" }, `${money(gMonthly, 0)}/mo`)));
          for (const s of groups[cat]) {
            const refresh = () => {
              mark();
              renderServicesKpis();
              renderServiceSubtotals();
            };
            body.append(el("tr", { class: s.active ? "" : "svc-inactive" }, el("td", { style: "font-weight:600" }, s.name), el("td", { class: "text-muted" }, s.provider), el("td", { class: "num" }, el("input", {
              type: "number",
              step: "0.01",
              class: "form-control form-control-sm",
              value: s.amount || "",
              "aria-label": `Amount for ${s.name}`,
              onchange: (e) => {
                s.amount = parseFloat(e.target.value) || 0;
                refresh();
              }
            })), el("td", {}, el("select", {
              class: "form-select form-select-sm",
              "aria-label": `Billing cycle for ${s.name}`,
              onchange: (e) => {
                s.cycle = e.target.value === "annual" ? "annual" : "monthly";
                refresh();
              }
            }, el("option", { value: "monthly", ...s.cycle === "monthly" ? { selected: "" } : {} }, "monthly"), el("option", { value: "annual", ...s.cycle === "annual" ? { selected: "" } : {} }, "annual"))), el("td", {}, dateInput(s.next, {
              class: "form-control form-control-sm",
              style: "width:140px",
              "aria-label": `Next billing date for ${s.name}`
            }, (v) => {
              s.next = v;
              mark();
            })), el("td", {}, el("input", {
              type: "checkbox",
              "aria-label": `${s.name} is active`,
              ...s.active ? { checked: "" } : {},
              onchange: (e) => {
                s.active = e.target.checked;
                mark();
                renderServices();
              }
            })), el("td", {}, el("button", {
              class: "btn-ghost btn-ghost-sm",
              "aria-label": `Remove ${s.name}`,
              onclick: () => {
                S.services.splice(S.services.indexOf(s), 1);
                mark();
                renderServices();
              }
            }, "✕"))));
          }
        }
        if (!S.services.length)
          body.append(el("tr", {}, el("td", { colspan: "7", class: "text-muted" }, "No services yet.")));
        t.append(body);
      });
    }
    function serializeServices() {
      const lines = [
        "---",
        ...(S.servicesFm || "kind: services").split(`
`),
        "---",
        "",
        "# Services & Subscriptions",
        "",
        "Recurring services and subscriptions. `cycle` is `monthly` or `annual`.",
        "",
        "| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes |",
        "|------|----------|-------:|-------|--------------|----------|--------|-------|"
      ];
      for (const s of S.services) {
        lines.push(`| ${escMd(s.name)} | ${escMd(s.provider)} | ${s.amount.toFixed(2)} | ${s.cycle} | ${escMd(s.next)} | ${escMd(s.category)} | ${s.active ? "yes" : "no"} | ${escMd(s.notes)} |`);
      }
      lines.push("");
      return lines.join(`
`);
    }
    async function saveServices() {
      await writeFile("Services.md", serializeServices());
      S.servicesDirty = false;
      $("#svcSave").disabled = true;
      toast("Saved Services.md");
    }
    async function addService() {
      const r = await askFields(app, "New service", [
        { key: "name", label: "Service name", type: "text" },
        { key: "provider", label: "Provider", type: "text" },
        { key: "amount", label: "Amount per billing cycle", type: "number", value: "0" },
        { key: "cycle", label: "Billing cycle", type: "select", value: "monthly", options: [
          { value: "monthly", label: "Monthly" },
          { value: "annual", label: "Annual" }
        ] },
        { key: "next", label: "Next billing (optional)", type: "date" },
        { key: "category", label: "Budget category", type: "select", options: ["", ...S.categories.map((c) => c.name)], value: "" }
      ]);
      if (!r || !r.name.trim())
        return;
      const amount = parseFloat(String(r.amount).replace(",", "."));
      if (isNaN(amount))
        return toast("Not a number", true);
      const next = /^\d{4}-\d{2}-\d{2}$/.test((r.next || "").trim()) ? r.next.trim() : "";
      S.services.push({
        name: r.name.trim(),
        provider: (r.provider || "").trim(),
        amount,
        cycle: r.cycle === "annual" ? "annual" : "monthly",
        next,
        category: (r.category || "").trim(),
        active: true,
        notes: ""
      });
      S.servicesDirty = true;
      $("#svcSave").disabled = false;
      renderServices();
    }
    ctx.provide({ renderServices, saveServices, addService, serializeServices });
  };
});

// src/views/tax.js
var require_tax = __commonJS((exports2, module2) => {
  var { el, dateInput, keepScroll, escMd, icoEl, safeSeg, patchFrontmatter, yamlStr } = require_util();
  var { askFields, confirmModal } = require_modal();
  module2.exports = function registerTax(ctx) {
    const { S, $, app, toast, writeFile, writeBinary, fileAt, locale, money } = ctx;
    function currentTaxYear() {
      return locale().currentTaxYear(new Date);
    }
    const T = () => S.tax[S.taxYear];
    const mark = () => {
      S.taxDirty = true;
      $("#taxSave").disabled = false;
    };
    ctx.registerDirty(() => S.taxDirty);
    function disclaimer() {
      const a = locale().authority;
      return "This tracker is a personal checklist, not tax advice. Seeded steps, documents and " + `deadline dates are editable starting points that change from year to year — confirm anything ` + `important with ${a === "Tax" ? "your tax authority" : a} or a registered tax professional.`;
    }
    function renderTax() {
      const loc = locale();
      const years = Object.keys(S.tax).sort();
      $("#taxEmptyCard").classList.toggle("hidden", years.length > 0);
      $("#taxContent").classList.toggle("hidden", !years.length);
      if (!years.length) {
        $("#taxEmptyIntro").textContent = loc.taxIntro;
        $("#taxEmptyHint").textContent = `Labels, tax-year dates and the starter checklist follow your country — currently ${loc.label}, ` + "changeable in the plugin settings. " + disclaimer();
        $("#taxStart").textContent = `Start tracking the ${currentTaxYear()} tax year`;
        return;
      }
      const t = T();
      $("#taxSubNote").empty();
      $("#taxSubNote").append(`Tax year ${S.taxYear} (${loc.yearSpan(+S.taxYear)}) · saved to `, el("code", {}, `Tax/${S.taxYear}.md`));
      const sel = $("#taxYearSel");
      sel.empty();
      for (const y of years)
        sel.append(el("option", { value: y, ...y === S.taxYear ? { selected: "" } : {} }, y));
      renderTaxKpis(t);
      renderSeason(t);
      renderSteps(t);
      renderFigures(t);
      renderDocs(t);
      renderOrphanYears();
    }
    function renderOrphanYears() {
      const box = $("#taxSubNote");
      const orphans = (S.taxOrphanYears || []).filter((y) => !S.tax[y]);
      if (!orphans.length)
        return;
      box.append(" · ");
      for (const y of orphans) {
        const b = el("button", {
          class: "btn-ghost",
          style: "padding:0.1rem 0.5rem;font-size:0.78rem",
          "aria-label": `Create a tax page for ${y}, which already has documents`
        }, `Tax/${y}/ has files — add ${y}`);
        b.addEventListener("click", async () => {
          if (!await confirmDiscard())
            return;
          seedTaxYear(+y);
          S.taxYear = y;
          await saveTax();
          renderTax();
        });
        box.append(b);
      }
    }
    function activeDeadline(t) {
      return locale().activeDeadline(t);
    }
    function daysTo(iso) {
      const m = (iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m)
        return null;
      const now = new Date;
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return Math.round((new Date(+m[1], +m[2] - 1, +m[3]) - today) / 86400000);
    }
    function renderTaxKpis(t) {
      const kpis = $("#taxKpis");
      kpis.empty();
      const tile = (l, v, cls) => kpis.append(el("div", { class: "mini" }, el("div", { class: "l" }, l), el("div", { class: `v num ${cls || ""}` }, v)));
      const d = daysTo(activeDeadline(t));
      tile("Deadline", d === null ? "—" : d < 0 ? `${-d} d overdue` : `${d} days`, d !== null && d < 0 ? "text-danger" : d !== null && d <= 30 ? "text-warning" : "");
      const steps = t.steps.filter((s) => s.status !== "n/a");
      tile("Steps done", `${steps.filter((s) => s.status === "done").length} / ${steps.length}`);
      const docs = t.docs.filter((x) => x.status !== "n/a");
      const ready = docs.filter((x) => x.status === "uploaded").length;
      tile("Documents in", `${ready} / ${docs.length}`, ready === docs.length && docs.length ? "text-success" : "");
      tile("Figures", String((t.figures || []).length));
      const typeLabel = (locale().taxpayerTypes.find(([v]) => v === t.taxpayer_type) || [])[1];
      tile("Taxpayer", typeLabel || "Unknown");
    }
    let checksBox = null;
    const refreshDerived = (t) => {
      renderTaxKpis(t);
      renderChecks(t);
      renderFigureTotals(t);
    };
    function renderSeason(t) {
      const loc = locale();
      const b = $("#taxSeasonBody");
      b.empty();
      const field = (label, control) => el("label", { class: "tax-field" }, el("span", { class: "l" }, label), control);
      b.append(el("div", { class: "row tax-season-row" }, field("Taxpayer type", el("select", {
        class: "form-select form-select-sm",
        onchange: (e) => {
          t.taxpayer_type = e.target.value;
          mark();
          renderSeason(t);
          refreshDerived(t);
        }
      }, ...loc.taxpayerTypes.map(([v, l]) => el("option", { value: v, ...t.taxpayer_type === v ? { selected: "" } : {} }, l)))), field("Assessment", el("select", {
        class: "form-select form-select-sm",
        onchange: (e) => {
          t.assessment = e.target.value;
          mark();
          renderSeason(t);
          refreshDerived(t);
        }
      }, ...loc.assessments.map(([v, l]) => el("option", { value: v, ...t.assessment === v ? { selected: "" } : {} }, l)))), field(loc.deadlineLabels[0], dateInput(t.deadline_standard, { class: "form-control form-control-sm" }, (v) => {
        t.deadline_standard = v;
        mark();
        refreshDerived(t);
      })), field(loc.deadlineLabels[1], dateInput(t.deadline_provisional, { class: "form-control form-control-sm" }, (v) => {
        t.deadline_provisional = v;
        mark();
        refreshDerived(t);
      }))));
      if (t.assessment === "assessed") {
        const num = (label, key, placeholder) => field(label, el("input", {
          type: "text",
          inputmode: "decimal",
          class: "form-control form-control-sm",
          value: t[key] === null || t[key] === undefined ? "" : String(t[key]),
          placeholder,
          onchange: (e) => {
            const raw = e.target.value.trim();
            const n = Number(raw.replace(/[^\d.-]/g, ""));
            t[key] = raw === "" ? null : Number.isFinite(n) ? n : null;
            mark();
            refreshDerived(t);
          }
        }));
        b.append(el("div", { class: "row tax-season-row" }, field("Assessment date", dateInput(t.assessment_date, { class: "form-control form-control-sm" }, (v) => {
          t.assessment_date = v;
          mark();
          refreshDerived(t);
        })), field("Reference", el("input", {
          type: "text",
          class: "form-control form-control-sm",
          value: t.assessment_ref,
          placeholder: "Notice / document no.",
          onchange: (e) => {
            t.assessment_ref = e.target.value.trim();
            mark();
          }
        })), num("Result (− = refund)", "assessment_result", "-1250.00"), num("Taxable income assessed", "assessment_income", "0.00")));
      }
      b.append(el("p", { class: "tax-season-msg" }, loc.seasonMsgs(t).join(" ")));
      checksBox = el("div", {});
      b.append(checksBox);
      renderChecks(t);
      b.append(el("p", { class: "text-muted", style: "font-size:12.5px;margin:0 0 6px" }, loc.safetyNote));
      b.append(el("p", { class: "text-muted", style: "font-size:12.5px;margin:0" }, disclaimer()));
    }
    function renderChecks(t) {
      if (!checksBox)
        return;
      checksBox.empty();
      for (const m of locale().figureChecks(t.figures || [], +S.taxYear, t) || []) {
        checksBox.append(el("p", { class: `tax-check ${m.ok ? "tax-check-ok" : "tax-check-warn"}` }, icoEl(m.ok ? ["circle-check", "check-circle"] : ["alert-triangle", "triangle-alert"]), " ", m.text));
      }
    }
    function renderFigures(t) {
      const loc = locale();
      const figures = t.figures || (t.figures = []);
      $("#taxFiguresSub").textContent = "Amounts from your certificates, by source code — what the documents actually say, so the checks above have something to read.";
      const tbl = $("#taxFiguresTable");
      keepScroll(tbl, () => {
        tbl.empty();
        tbl.append(el("thead", {}, el("tr", {}, el("th", { scope: "col" }, loc.figureCodeLabel), el("th", { scope: "col" }, "Description"), el("th", { scope: "col" }, "Source"), el("th", { scope: "col", class: "num" }, "Amount"), el("th", { scope: "col" }, ""))));
        const body = el("tbody", {});
        const txt = (obj, key, width) => el("input", {
          type: "text",
          class: "form-control form-control-sm",
          value: obj[key],
          style: `min-width:${width}`,
          "aria-label": `${key} for figure ${obj.code || ""}`.trim(),
          onchange: (e) => {
            obj[key] = e.target.value;
            mark();
          }
        });
        const refresh = () => {
          mark();
          refreshDerived(t);
        };
        for (const f of figures) {
          body.append(el("tr", {}, el("td", {}, el("input", {
            type: "text",
            class: "form-control form-control-sm",
            value: f.code,
            style: "width:90px",
            "aria-label": `${loc.figureCodeLabel} for ${f.description || "this figure"}`,
            onchange: (e) => {
              f.code = e.target.value.trim();
              refresh();
            }
          })), el("td", {}, txt(f, "description", "180px")), el("td", {}, txt(f, "source", "140px")), el("td", { class: "num" }, el("input", {
            type: "text",
            inputmode: "decimal",
            class: "form-control form-control-sm num",
            style: "width:130px",
            value: f.amount === 0 ? "" : String(f.amount),
            placeholder: "0.00",
            "aria-label": `Amount for ${f.code || "this figure"}`,
            onchange: (e) => {
              const n = Number(e.target.value.replace(/[^\d.-]/g, ""));
              f.amount = Number.isFinite(n) ? n : 0;
              refresh();
            }
          })), el("td", {}, el("button", {
            class: "btn-ghost btn-ghost-sm",
            "aria-label": `Remove figure ${f.code}`,
            onclick: () => {
              figures.splice(figures.indexOf(f), 1);
              mark();
              renderFigures(t);
              refreshDerived(t);
            }
          }, "✕"))));
        }
        if (!figures.length) {
          body.append(el("tr", {}, el("td", { colspan: "5", class: "text-muted" }, "No figures yet — add the amounts off your certificates to unlock the checks.")));
        }
        tbl.append(body);
        renderFigureTotals(t);
      });
    }
    function renderFigureTotals(t) {
      const tbl = $("#taxFiguresTable");
      const old = tbl.querySelector("tfoot");
      if (old)
        old.remove();
      const figures = t.figures || [];
      if (!figures.length)
        return;
      const byCode = new Map;
      for (const f of figures) {
        const k = (f.code || "").trim() || "—";
        byCode.set(k, (byCode.get(k) || 0) + (f.amount || 0));
      }
      const foot = el("tfoot", {});
      for (const [code, total] of [...byCode].sort((a, b) => a[0].localeCompare(b[0]))) {
        foot.append(el("tr", { class: "tax-fig-total" }, el("td", { style: "font-weight:600" }, code), el("td", { colspan: "2", class: "text-muted" }, `Total for ${code}`), el("td", { class: "num", style: "font-weight:600" }, money(total)), el("td", {})));
      }
      tbl.append(foot);
    }
    const STEP_CYCLE = { todo: "busy", busy: "done", done: "n/a", "n/a": "todo" };
    const STEP_LABEL = { todo: "To do", busy: "Busy", done: "Done", "n/a": "N/A" };
    const STEP_ICO = { todo: ["circle"], busy: ["hourglass"], done: ["circle-check", "check-circle"], "n/a": ["circle-slash", "slash"] };
    const stepOverdue = (s) => s.status !== "done" && s.status !== "n/a" && daysTo(s.due) !== null && daysTo(s.due) < 0;
    function renderSteps(t, focusStep) {
      const tbl = $("#taxStepsTable");
      keepScroll(tbl, () => {
        tbl.empty();
        tbl.append(el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Step"), el("th", { scope: "col" }, "Status"), el("th", { scope: "col" }, "Due"), el("th", { scope: "col" }, "Notes"), el("th", { scope: "col" }, ""))));
        const body = el("tbody", {});
        for (const s of t.steps) {
          const pill = el("button", {
            class: `status-pill tax-${s.status.replace("/", "")}`,
            "aria-label": `Status: ${STEP_LABEL[s.status]} — click to change`
          }, icoEl(STEP_ICO[s.status]), STEP_LABEL[s.status]);
          pill.addEventListener("click", () => {
            s.status = STEP_CYCLE[s.status];
            mark();
            renderSteps(t, s.step);
            renderTaxKpis(t);
          });
          body.append(el("tr", { class: s.status === "n/a" ? "svc-inactive" : "" }, el("td", { style: "font-weight:600" }, s.step), el("td", {}, pill), el("td", {}, dateInput(s.due, {
            class: `form-control form-control-sm ${stepOverdue(s) ? "tax-overdue" : ""}`,
            style: "width:120px",
            "aria-label": `Due date for ${s.step}`
          }, (v, e) => {
            s.due = v;
            mark();
            e.target.classList.toggle("tax-overdue", stepOverdue(s));
          })), el("td", {}, el("input", {
            type: "text",
            class: "form-control form-control-sm",
            value: s.notes,
            style: "min-width:220px",
            "aria-label": `Notes for ${s.step}`,
            onchange: (e) => {
              s.notes = e.target.value;
              mark();
            }
          })), el("td", {}, el("button", {
            class: "btn-ghost btn-ghost-sm",
            "aria-label": `Remove step ${s.step}`,
            onclick: () => {
              t.steps.splice(t.steps.indexOf(s), 1);
              mark();
              renderSteps(t);
              renderTaxKpis(t);
            }
          }, "✕"))));
        }
        if (!t.steps.length)
          body.append(el("tr", {}, el("td", { colspan: "5", class: "text-muted" }, "No steps yet.")));
        tbl.append(body);
      });
      if (focusStep) {
        const i = t.steps.findIndex((s) => s.step === focusStep);
        const pill = tbl.querySelectorAll(".status-pill")[i];
        if (pill)
          pill.focus();
      }
    }
    const DOC_CYCLE = { needed: "n/a", uploaded: "needed", "n/a": "needed" };
    const DOC_LABEL = { needed: "Needed", uploaded: "Uploaded", "n/a": "N/A" };
    const DOC_ICO = { needed: ["hourglass"], uploaded: ["circle-check", "check-circle"], "n/a": ["circle-slash", "slash"] };
    function renderDocs(t, focusDoc) {
      $("#taxDocsSub").empty();
      $("#taxDocsSub").append("Certificates & records for the return · files stored in ", el("code", {}, `Tax/${S.taxYear}/`));
      const tbl = $("#taxDocsTable");
      keepScroll(tbl, () => {
        tbl.empty();
        tbl.append(el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Document"), el("th", { scope: "col" }, "Source"), el("th", { scope: "col" }, "Status"), el("th", { scope: "col" }, "File"), el("th", { scope: "col" }, "Notes"), el("th", { scope: "col" }, ""))));
        const body = el("tbody", {});
        for (const d of t.docs) {
          const pill = el("button", {
            class: `status-pill tax-${d.status.replace("/", "")}`,
            "aria-label": `Status: ${DOC_LABEL[d.status]} — click to change`
          }, icoEl(DOC_ICO[d.status]), DOC_LABEL[d.status]);
          pill.addEventListener("click", () => {
            d.status = DOC_CYCLE[d.status];
            mark();
            renderDocs(t, d.name);
            renderTaxKpis(t);
          });
          const fileCell = el("div", { class: "tax-doc-files" });
          for (const name of fileList(d)) {
            const link = el("button", { class: "btn-ghost tax-doc-link", "aria-label": `Open ${name}` }, icoEl(["paperclip"]), name);
            link.addEventListener("click", () => openDoc(name));
            fileCell.append(link);
          }
          const addBtn = el("button", {
            class: "btn-ghost btn-ghost-sm",
            "aria-label": `${d.file ? "Add another file to" : "Upload file for"} ${d.name}`
          }, icoEl(["cloud-upload", "upload-cloud"]), d.file ? " Add" : " Upload");
          addBtn.addEventListener("click", () => {
            pendingDocTarget = d;
            $("#taxFileInput").click();
          });
          fileCell.append(addBtn);
          body.append(el("tr", { class: d.status === "n/a" ? "svc-inactive" : "" }, el("td", { style: "font-weight:600" }, d.name), el("td", { class: "text-muted" }, d.source), el("td", {}, pill), el("td", {}, fileCell), el("td", {}, el("input", {
            type: "text",
            class: "form-control form-control-sm",
            value: d.notes,
            style: "min-width:180px",
            "aria-label": `Notes for ${d.name}`,
            onchange: (e) => {
              d.notes = e.target.value;
              mark();
            }
          })), el("td", {}, el("button", {
            class: "btn-ghost btn-ghost-sm",
            "aria-label": `Remove document ${d.name}`,
            onclick: async () => {
              const kept = fileList(d);
              const go = !kept.length || await confirmModal(app, {
                title: "Remove document row",
                message: `Remove "${d.name}" from the list? ${kept.length === 1 ? `The uploaded file ${kept[0]} stays` : `The ${kept.length} uploaded files stay`} in Tax/${S.taxYear}/ — delete them from the vault yourself if you want them gone.`,
                confirmText: "Remove row"
              });
              if (!go)
                return;
              t.docs.splice(t.docs.indexOf(d), 1);
              mark();
              renderDocs(t);
              renderTaxKpis(t);
            }
          }, "✕"))));
        }
        if (!t.docs.length)
          body.append(el("tr", {}, el("td", { colspan: "6", class: "text-muted" }, "No documents yet.")));
        tbl.append(body);
      });
      if (focusDoc) {
        const i = t.docs.findIndex((d) => d.name === focusDoc);
        const pill = tbl.querySelectorAll(".status-pill")[i];
        if (pill)
          pill.focus();
      }
    }
    const FILE_SEP = ";";
    const taxSeg = (s) => safeSeg(s).replace(/;/g, "-");
    const fileList = (d) => (d.file || "").split(FILE_SEP).map((s) => s.trim()).filter(Boolean);
    const setFileList = (d, names) => {
      d.file = names.join(`${FILE_SEP} `);
    };
    function openDoc(name) {
      const f = fileAt(`Tax/${S.taxYear}/${name}`);
      if (!f)
        return toast(`File not found: Tax/${S.taxYear}/${name}`, true);
      app.workspace.getLeaf("tab").openFile(f);
    }
    let pendingDocTarget = null;
    async function handleTaxFile(file) {
      if (!S.taxYear)
        return;
      const t = T();
      let target = pendingDocTarget && t.docs.includes(pendingDocTarget) ? pendingDocTarget : null;
      pendingDocTarget = null;
      let created = false;
      const buf = await file.arrayBuffer();
      const dupe = await findDuplicate(buf);
      if (dupe) {
        const reuse = await confirmModal(app, {
          title: "Already in this tax year",
          message: `"${file.name}" is byte-identical to ${dupe}, already stored in Tax/${S.taxYear}/. Point the row at the existing file instead of saving a second copy?`,
          confirmText: "Use the existing file"
        });
        if (reuse)
          return attachExisting(t, dupe);
      }
      if (!target) {
        const NEW = "＋ New document row";
        const openRows = t.docs.filter((d) => !d.file);
        const options = openRows.map((d, i) => ({ value: String(i), label: `${d.name} — ${d.source}` }));
        const r = await askFields(app, `Attach "${file.name}"`, [
          {
            key: "to",
            label: "Attach to",
            type: "select",
            options: [...options, { value: NEW, label: NEW }],
            value: options.length ? "0" : NEW
          }
        ]);
        if (!r)
          return;
        if (r.to === NEW) {
          const n = await askFields(app, "New document", [
            { key: "name", label: "Document name", type: "text", value: file.name.replace(/\.[^.]+$/, "") },
            { key: "source", label: "Source", type: "text" }
          ]);
          if (!n || !n.name.trim())
            return;
          target = { name: n.name.trim(), source: (n.source || "").trim(), status: "needed", file: "", notes: "" };
          t.docs.push(target);
          created = true;
        } else {
          target = openRows[Number(r.to)];
          if (!target)
            return;
        }
      }
      let name = taxSeg(file.name) || "document";
      if (fileAt(`Tax/${S.taxYear}/${name}`)) {
        const dot = name.lastIndexOf(".");
        const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
        let i = 2;
        while (fileAt(`Tax/${S.taxYear}/${stem} (${i})${ext}`))
          i++;
        name = `${stem} (${i})${ext}`;
      }
      try {
        await writeBinary(`Tax/${S.taxYear}/${name}`, buf);
      } catch (e) {
        if (created)
          t.docs.splice(t.docs.indexOf(target), 1);
        return toast(e.message || String(e), true);
      }
      setFileList(target, [...fileList(target), name]);
      target.status = "uploaded";
      if (isEncryptedPdf(buf)) {
        const hint = "Password-protected — open outside Obsidian.";
        if (!target.notes.includes(hint))
          target.notes = target.notes ? `${target.notes} ${hint}` : hint;
        toast(`Uploaded ${name} — password-protected, so it won't preview in Obsidian.`);
      } else {
        toast(`Uploaded ${name}`);
      }
      renderDocs(t);
      renderTaxKpis(t);
      await saveTax();
    }
    async function findDuplicate(buf) {
      const digest = async (b) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b))).map((x) => x.toString(16).padStart(2, "0")).join("");
      let mine;
      try {
        mine = await digest(buf);
      } catch {
        return null;
      }
      const seen = new Set;
      for (const d of T().docs)
        for (const n of fileList(d))
          seen.add(n);
      for (const n of seen) {
        const f = fileAt(`Tax/${S.taxYear}/${n}`);
        if (!f)
          continue;
        try {
          if (await digest(await app.vault.readBinary(f)) === mine)
            return n;
        } catch {}
      }
      return null;
    }
    async function attachExisting(t, name) {
      const NEW = "＋ New document row";
      const options = t.docs.map((d, i) => ({ value: String(i), label: `${d.name} — ${d.source}` }));
      const r = await askFields(app, `Point a row at "${name}"`, [
        {
          key: "to",
          label: "Attach to",
          type: "select",
          options: [...options, { value: NEW, label: NEW }],
          value: options.length ? "0" : NEW
        }
      ]);
      if (!r)
        return;
      let target;
      if (r.to === NEW) {
        const n = await askFields(app, "New document", [
          { key: "name", label: "Document name", type: "text", value: name.replace(/\.[^.]+$/, "") },
          { key: "source", label: "Source", type: "text" }
        ]);
        if (!n || !n.name.trim())
          return;
        target = { name: n.name.trim(), source: (n.source || "").trim(), status: "needed", file: "", notes: "" };
        t.docs.push(target);
      } else {
        target = t.docs[Number(r.to)];
        if (!target)
          return;
      }
      if (!fileList(target).includes(name))
        setFileList(target, [...fileList(target), name]);
      target.status = "uploaded";
      await saveTax();
      renderTax();
      toast(`Linked ${name} — no second copy written.`);
    }
    function isEncryptedPdf(buf) {
      const bytes = new Uint8Array(buf);
      if (bytes.length < 5 || bytes[0] !== 37 || bytes[1] !== 80)
        return false;
      const tail = bytes.subarray(Math.max(0, bytes.length - 4096));
      const s = Array.from(tail).map((b) => String.fromCharCode(b)).join("");
      return s.includes("/Encrypt");
    }
    function serializeTax(year) {
      const t = S.tax[year];
      const fm = patchFrontmatter(t.fmRaw || "", {
        kind: "tax",
        tax_year: year,
        taxpayer_type: t.taxpayer_type,
        assessment: t.assessment,
        deadline_standard: t.deadline_standard ? yamlStr(t.deadline_standard) : null,
        deadline_provisional: t.deadline_provisional ? yamlStr(t.deadline_provisional) : null,
        assessment_date: t.assessment_date ? yamlStr(t.assessment_date) : null,
        assessment_ref: t.assessment_ref ? yamlStr(t.assessment_ref) : null,
        assessment_result: typeof t.assessment_result === "number" ? t.assessment_result : null,
        assessment_income: typeof t.assessment_income === "number" ? t.assessment_income : null
      });
      const loc = locale();
      const lines = [
        "---",
        ...fm.split(`
`),
        "---",
        "",
        `# Tax Year ${year}`,
        "",
        `${loc.authority === "Tax" ? "Tax" : loc.authority} return tracking for the ${year} tax year (${loc.yearSpan(+year)}).`,
        "Step `status` is `todo`, `busy`, `done` or `n/a`; document `status` is `needed`, `uploaded` or `n/a`.",
        `Uploaded files live in \`Tax/${year}/\`.`,
        "",
        "## Progress",
        "",
        "| Step | Status | Due | Notes |",
        "|------|--------|-----|-------|"
      ];
      for (const s of t.steps)
        lines.push(`| ${escMd(s.step)} | ${s.status} | ${escMd(s.due)} | ${escMd(s.notes)} |`);
      lines.push("", "## Documents", "", "| Document | Source | Status | File | Notes |", "|----------|--------|--------|------|-------|");
      for (const d of t.docs)
        lines.push(`| ${escMd(d.name)} | ${escMd(d.source)} | ${d.status} | ${escMd(d.file)} | ${escMd(d.notes)} |`);
      lines.push("", "## Figures", "", `| ${loc.figureCodeLabel} | Description | Source | Amount |`, "|------|-------------|--------|--------|");
      for (const f of t.figures || []) {
        lines.push(`| ${escMd(f.code)} | ${escMd(f.description)} | ${escMd(f.source)} | ${Number(f.amount || 0).toFixed(2)} |`);
      }
      lines.push("");
      return lines.join(`
`);
    }
    async function saveTax() {
      if (!S.taxYear)
        return;
      await writeFile(`Tax/${S.taxYear}.md`, serializeTax(S.taxYear));
      S.taxDirty = false;
      $("#taxSave").disabled = true;
      toast(`Saved Tax/${S.taxYear}.md`);
    }
    async function addTaxStep() {
      const r = await askFields(app, "New step", [
        { key: "step", label: "Step", type: "text" },
        { key: "due", label: "Due (optional)", type: "text", placeholder: "YYYY-MM-DD" }
      ]);
      if (!r || !r.step.trim())
        return;
      T().steps.push({ step: r.step.trim(), status: "todo", due: (r.due || "").trim(), notes: "" });
      mark();
      renderTax();
    }
    async function addTaxDoc() {
      const r = await askFields(app, "New document", [
        { key: "name", label: "Document name", type: "text" },
        { key: "source", label: "Source (who issues it)", type: "text" }
      ]);
      if (!r || !r.name.trim())
        return;
      T().docs.push({ name: r.name.trim(), source: (r.source || "").trim(), status: "needed", file: "", notes: "" });
      mark();
      renderTax();
    }
    async function addTaxFigure() {
      if (!S.taxYear)
        return;
      const r = await askFields(app, "New figure", [
        { key: "code", label: locale().figureCodeLabel, type: "text" },
        { key: "description", label: "Description", type: "text" },
        { key: "source", label: "Source (which certificate)", type: "text" },
        { key: "amount", label: "Amount", type: "text", placeholder: "0.00" }
      ]);
      if (!r || !r.code.trim())
        return;
      const n = Number((r.amount || "").replace(/[^\d.-]/g, ""));
      T().figures.push({
        code: r.code.trim(),
        description: (r.description || "").trim(),
        source: (r.source || "").trim(),
        amount: Number.isFinite(n) ? n : 0
      });
      mark();
      renderTax();
    }
    function seedTaxYear(year) {
      const loc = locale();
      S.tax[String(year)] = {
        fmRaw: "",
        taxpayer_type: loc.defaultTaxpayerType,
        assessment: loc.defaultAssessment,
        assessment_date: "",
        assessment_ref: "",
        assessment_result: null,
        assessment_income: null,
        ...loc.seedDeadlines(year),
        steps: loc.seedSteps(year).map((s) => ({ status: "todo", due: "", notes: "", ...s })),
        docs: loc.seedDocs().map((d) => ({ status: "needed", file: "", notes: "", ...d })),
        figures: []
      };
    }
    async function startTax() {
      const year = currentTaxYear();
      seedTaxYear(year);
      S.taxYear = String(year);
      await saveTax();
      renderTax();
    }
    async function newTaxYear() {
      const years = Object.keys(S.tax).map(Number);
      const suggested = years.length ? Math.max(...years) + 1 : currentTaxYear();
      const r = await askFields(app, "New tax year", [
        { key: "year", label: locale().yearHint, type: "number", value: String(suggested) }
      ]);
      if (!r)
        return;
      const year = parseInt(r.year, 10);
      if (!year || year < 2000 || year > 2100)
        return toast("Not a valid year", true);
      if (S.tax[String(year)])
        return changeTaxYear(String(year));
      if (!await confirmDiscard())
        return;
      seedTaxYear(year);
      S.taxYear = String(year);
      await saveTax();
      renderTax();
    }
    async function confirmDiscard() {
      if (!S.taxDirty)
        return true;
      const go = await confirmModal(app, {
        title: "Unsaved tax changes",
        message: "Switching tax year will discard your unsaved edits. Continue?",
        confirmText: "Discard & switch"
      });
      if (!go)
        return false;
      await ctx.reloadFromDisk();
      return true;
    }
    async function changeTaxYear(year) {
      if (!await confirmDiscard()) {
        renderTax();
        return;
      }
      S.taxYear = S.tax[year] ? year : S.taxYear;
      renderTax();
    }
    ctx.provide({ renderTax, saveTax, addTaxStep, addTaxDoc, addTaxFigure, newTaxYear, startTax, changeTaxYear, handleTaxFile, serializeTax });
  };
});

// src/loan-math.js
var require_loan_math = __commonJS((exports2, module2) => {
  function monthlyPayment(principal, annualRatePct, months, balloon = 0) {
    const p = Number(principal) || 0;
    const n = Math.round(Number(months) || 0);
    const b = Math.min(Math.max(Number(balloon) || 0, 0), p);
    if (p <= 0 || n <= 0)
      return 0;
    const i = (Number(annualRatePct) || 0) / 100 / 12;
    if (i <= 0)
      return (p - b) / n;
    const f = Math.pow(1 + i, -n);
    return Math.max(0, (p - b * f) * i / (1 - f));
  }
  function amortise(principal, annualRatePct, months, payment, balloon = 0) {
    const i = (Number(annualRatePct) || 0) / 100 / 12;
    const n = Math.round(Number(months) || 0);
    const b = Math.min(Math.max(Number(balloon) || 0, 0), principal);
    const rows = [];
    let bal = Number(principal) || 0;
    for (let m = 1;m <= n; m++) {
      const interest = bal * i;
      let capital = payment - interest;
      let closing = bal - capital;
      if (m === n) {
        capital = bal - b;
        closing = b;
      }
      rows.push({ month: m, opening: bal, interest, capital, closing });
      bal = closing;
    }
    return rows;
  }
  function byYear(rows) {
    const years = [];
    for (const r of rows) {
      const y = Math.ceil(r.month / 12);
      let e = years[y - 1];
      if (!e)
        e = years[y - 1] = { year: y, opening: r.opening, interest: 0, capital: 0, closing: r.closing };
      e.interest += r.interest;
      e.capital += r.capital;
      e.closing = r.closing;
    }
    return years;
  }
  function totalsFor(principal, annualRatePct, months, balloon = 0) {
    const exact = monthlyPayment(principal, annualRatePct, months, balloon);
    const payment = Math.round(exact);
    const n = Math.round(Number(months) || 0);
    const b = Math.min(Math.max(Number(balloon) || 0, 0), principal);
    const totalRepaid = payment * n + b;
    return {
      payment,
      exact,
      months: n,
      balloon: b,
      totalRepaid,
      totalInterest: totalRepaid - (Number(principal) || 0)
    };
  }
  var ZA_TRANSFER_DUTY = [
    [0, 1210000, 0, 0],
    [1210000, 1663800, 0, 0.03],
    [1663800, 2329300, 13614, 0.06],
    [2329300, 3149000, 53544, 0.08],
    [3149000, 12100500, 119120, 0.11],
    [12100500, Infinity, 1103783, 0.13]
  ];
  function zaTransferDuty(price) {
    const v = Number(price) || 0;
    if (v <= 0)
      return 0;
    for (const [from, to, base, rate] of ZA_TRANSFER_DUTY) {
      if (v <= to)
        return base + (v - from) * rate;
    }
    return 0;
  }
  var ZA_VAT = 1.15;
  var ZA_INIT_CAP_EX_VAT = 5707;
  var ZA_INIT_CAP = ZA_INIT_CAP_EX_VAT * ZA_VAT;
  function zaMortgageInitiationFee(loanAmount) {
    const a = Number(loanAmount) || 0;
    if (a <= 0)
      return 0;
    const exVat = Math.min(1207 + Math.max(0, a - 1e4) * 0.1, ZA_INIT_CAP_EX_VAT);
    return Math.round(exVat * ZA_VAT);
  }
  function zaVehicleInitiationFee(financeAmount) {
    const a = Number(financeAmount) || 0;
    if (a <= 0)
      return 0;
    return Math.round(Math.min(a * 0.01, ZA_INIT_CAP));
  }
  var ZA_SERVICE_FEE = 74.5;
  var ZA_TRANSFER_COST = [
    [0, 0],
    [500000, 12500],
    [750000, 15000],
    [1e6, 18000],
    [1500000, 23000],
    [2000000, 29500],
    [3000000, 41000],
    [5000000, 62000],
    [1e7, 105000]
  ];
  var ZA_BOND_COST = [
    [0, 0],
    [500000, 13500],
    [750000, 16500],
    [1e6, 19500],
    [1350000, 23550],
    [2000000, 30500],
    [3000000, 41500],
    [5000000, 63000],
    [1e7, 108000]
  ];
  function interpolate(table, x) {
    const v = Number(x) || 0;
    if (v <= 0)
      return 0;
    for (let k = 1;k < table.length; k++) {
      const [x02, y02] = table[k - 1];
      const [x12, y12] = table[k];
      if (v <= x12)
        return y02 + (v - x02) * (y12 - y02) / (x12 - x02);
    }
    const [x0, y0] = table[table.length - 2];
    const [x1, y1] = table[table.length - 1];
    return y1 + (v - x1) * (y1 - y0) / (x1 - x0);
  }
  var round50 = (v) => Math.round(v / 50) * 50;
  var LOAN_PROFILES = {
    za: {
      hasBuyingCosts: true,
      defaultRate: 11,
      rateNote: "South Africa's prime rate was 11.00% (repo + 3.50%) when this default was set — confirm the current rate and what your bank actually offered you.",
      costsNote: "Estimates only. Transfer duty is exact arithmetic on the SARS 2025/26 table (effective 1 April 2025); bond registration and transfer costs are interpolated from the guideline conveyancing tariff and will differ from your attorney's quote. Fees follow the National Credit Act caps (initiation R5 707 + VAT, monthly service fee R74.50).",
      feesNote: "Fees follow the National Credit Act maximums — initiation capped at R5 707 + VAT (R6 563), monthly service fee R74.50. Lenders set their own within those caps, so use your quote when you have one.",
      serviceFee: ZA_SERVICE_FEE,
      transferDuty: zaTransferDuty,
      transferCost: (price) => round50(interpolate(ZA_TRANSFER_COST, price)),
      bondCost: (bond) => round50(interpolate(ZA_BOND_COST, bond)),
      mortgageInitiationFee: zaMortgageInitiationFee,
      vehicleInitiationFee: zaVehicleInitiationFee
    }
  };
  var GENERIC_LOAN_PROFILE = {
    hasBuyingCosts: false,
    defaultRate: 8,
    rateNote: "Enter the annual interest rate your lender quoted.",
    costsNote: "",
    feesNote: "",
    serviceFee: 0,
    transferDuty: () => 0,
    transferCost: () => 0,
    bondCost: () => 0,
    mortgageInitiationFee: () => 0,
    vehicleInitiationFee: () => 0
  };
  function loanProfileFor(code) {
    return LOAN_PROFILES[(code || "za").toString().trim().toLowerCase()] || GENERIC_LOAN_PROFILE;
  }
  module2.exports = {
    monthlyPayment,
    amortise,
    byYear,
    totalsFor,
    zaTransferDuty,
    zaMortgageInitiationFee,
    zaVehicleInitiationFee,
    ZA_TRANSFER_DUTY,
    ZA_SERVICE_FEE,
    ZA_INIT_CAP,
    LOAN_PROFILES,
    GENERIC_LOAN_PROFILE,
    loanProfileFor
  };
});

// src/views/loans.js
var require_loans = __commonJS((exports2, module2) => {
  var { el } = require_util();
  var { totalsFor, amortise, byYear, loanProfileFor } = require_loan_math();
  module2.exports = function registerLoans(ctx) {
    const { S, $, money } = ctx;
    const P = () => loanProfileFor(S.settings.country);
    const home = { price: 1500000, deposit: 150000, depositPct: 10, rate: null, years: 20 };
    const car = { price: 350000, deposit: 35000, depositPct: 10, rate: null, months: 60, balloonPct: 0, insurance: false };
    const syncs = [];
    const INSURANCE_RATE = 0.0035;
    const insuranceEstimate = (price) => Math.max(450, Math.round(price * INSURANCE_RATE));
    function numField(label, hint, value, attrs, commit) {
      const input = el("input", {
        type: "number",
        inputmode: "decimal",
        class: "form-control form-control-sm",
        value: String(value),
        ...attrs
      });
      input.addEventListener("input", () => commit(input.value));
      const hintEl = el("span", { class: "lf-h" }, hint || "");
      const wrap = el("label", { class: "loan-field" }, el("span", { class: "lf-l" }, label), input, hintEl);
      return { wrap, input, hintEl };
    }
    function rateField(state, recalc) {
      const f = numField("Interest rate (% a year)", P().rateNote, state.rate ?? P().defaultRate, { min: "0", max: "40", step: "0.25" }, (v) => {
        const raw = String(v).trim();
        state.rate = raw === "" ? null : Math.max(0, parseFloat(raw) || 0);
        recalc();
      });
      syncs.push(() => {
        const p = P();
        f.hintEl.textContent = p.rateNote;
        if (state.rate === null)
          f.input.value = String(p.defaultRate);
      });
      return f.wrap;
    }
    function depositField(state, recalc) {
      const lab = el("span", { class: "lf-l" });
      const amt = el("input", {
        type: "number",
        inputmode: "decimal",
        class: "form-control form-control-sm",
        min: "0",
        step: "5000",
        "aria-label": "Deposit amount"
      });
      const slider = el("input", {
        type: "range",
        class: "loan-range",
        min: "0",
        max: "100",
        step: "1",
        "aria-label": "Deposit as a percentage of the price"
      });
      const pct = () => state.price > 0 ? state.deposit / state.price * 100 : state.depositPct;
      const show = () => {
        const v = pct();
        lab.textContent = `Deposit — ${Math.round(v * 10) % 10 ? v.toFixed(1) : Math.round(v)}%`;
        if (document.activeElement !== slider)
          slider.value = String(Math.min(100, Math.round(v)));
        if (document.activeElement !== amt)
          amt.value = String(Math.round(state.deposit));
      };
      amt.addEventListener("input", () => {
        const v = parseFloat(amt.value);
        state.deposit = Math.min(Math.max(0, Number.isFinite(v) ? v : 0), state.price);
        if (state.price > 0)
          state.depositPct = pct();
        show();
        recalc();
      });
      slider.addEventListener("input", () => {
        state.depositPct = Number(slider.value);
        state.deposit = state.price * state.depositPct / 100;
        show();
        recalc();
      });
      show();
      syncs.push(show);
      return { wrap: el("label", { class: "loan-field" }, lab, amt, slider), sync: show };
    }
    function rangeField(labelFor, attrs, value, commit) {
      const lab = el("span", { class: "lf-l" });
      const input = el("input", { type: "range", class: "loan-range", value: String(value), ...attrs });
      const sync = () => {
        lab.textContent = labelFor(Number(input.value));
      };
      input.addEventListener("input", () => {
        sync();
        commit(Number(input.value));
      });
      sync();
      syncs.push(sync);
      return { wrap: el("label", { class: "loan-field" }, lab, input), sync };
    }
    function selectField(label, options, value, commit) {
      const sel = el("select", { class: "form-select form-select-sm" }, ...options.map(([v, l]) => el("option", { value: String(v), ...String(v) === String(value) ? { selected: "" } : {} }, l)));
      sel.addEventListener("change", () => commit(sel.value));
      return el("label", { class: "loan-field" }, el("span", { class: "lf-l" }, label), sel);
    }
    function checkField(label, hint, value, commit) {
      const box = el("input", { type: "checkbox", ...value ? { checked: "" } : {} });
      box.addEventListener("change", () => commit(box.checked));
      const wrap = el("label", { class: "loan-field loan-check" }, box, el("span", { class: "lf-l" }, label));
      if (hint)
        wrap.append(el("span", { class: "lf-h" }, hint));
      return wrap;
    }
    const row = (label, value, cls) => el("div", { class: "lo-row" }, el("span", { class: "lo-l" }, label), el("b", { class: `lo-v num ${cls || ""}` }, value));
    const DISCLAIMER = "Estimates only — this is not financial advice. Every figure here is a default to check, " + "not a quote: rates, attorney fees and lender charges all vary. Confirm the numbers with your bank, " + "your attorney and a qualified adviser before committing to anything.";
    function amortTable(tbl, rows, termLabel) {
      tbl.empty();
      tbl.append(el("thead", {}, el("tr", {}, el("th", { scope: "col" }, termLabel), el("th", { scope: "col", class: "num" }, "Opening"), el("th", { scope: "col", class: "num" }, "Interest"), el("th", { scope: "col", class: "num" }, "Capital"), el("th", { scope: "col", class: "num" }, "Closing"))));
      const body = el("tbody", {});
      if (!rows.length) {
        body.append(el("tr", {}, el("td", { colspan: "5", class: "text-muted" }, "Enter a price and a deposit below the price to see the schedule.")));
      }
      for (const y of rows) {
        body.append(el("tr", {}, el("td", {}, String(y.year)), el("td", { class: "num" }, money(y.opening, 0)), el("td", { class: "num text-warning" }, money(y.interest, 0)), el("td", { class: "num" }, money(y.capital, 0)), el("td", { class: "num" }, money(y.closing, 0))));
      }
      tbl.append(body);
    }
    let homeBuilt = false;
    let homeDepositSync = null;
    function buildHome() {
      const box = $("#loanHomeForm");
      box.empty();
      const form = el("div", { class: "loan-form" });
      form.append(numField("Purchase price", null, home.price, { min: "0", step: "10000" }, (v) => {
        home.price = Math.max(0, parseFloat(v) || 0);
        home.deposit = Math.min(home.price * home.depositPct / 100, home.price);
        homeDepositSync();
        recalcHome();
      }).wrap);
      const dep = depositField(home, recalcHome);
      homeDepositSync = dep.sync;
      form.append(dep.wrap);
      form.append(rateField(home, recalcHome));
      const term = rangeField((y) => `Loan term — ${y} years`, { min: "5", max: "30", step: "1" }, home.years, (y) => {
        home.years = y;
        recalcHome();
      });
      form.append(term.wrap);
      box.append(form);
      homeBuilt = true;
    }
    function recalcHome() {
      const p = P();
      const deposit = Math.min(home.deposit, home.price);
      const loan = Math.max(0, home.price - deposit);
      const rate = home.rate ?? p.defaultRate;
      const t = totalsFor(loan, rate, home.years * 12);
      const duty = p.transferDuty(home.price);
      const bond = p.bondCost(loan);
      const transfer = p.transferCost(home.price);
      const init = p.mortgageInitiationFee(loan);
      const onceOff = duty + bond + transfer + init;
      const out = $("#loanHomeOut");
      out.empty();
      const block = el("div", { class: "loan-out" }, row("Monthly repayment", money(t.payment, 0), "lo-big grad-txt"), row("Loan amount", money(loan, 0)), row("Total interest", money(t.totalInterest, 0), "text-warning"), row("Total repaid", money(t.totalRepaid, 0)));
      block.append(el("div", { class: "lo-sep" }));
      block.append(row("Deposit", money(deposit, 0)));
      if (p.hasBuyingCosts)
        block.append(row("Once-off costs", money(onceOff, 0)));
      block.append(row("Cash needed upfront", money(deposit + (p.hasBuyingCosts ? onceOff : 0), 0), "text-danger"));
      block.append(el("div", { class: "lo-note" }, DISCLAIMER));
      out.append(block);
      $("#loanHomeCostsCard").classList.toggle("hidden", !p.hasBuyingCosts);
      if (p.hasBuyingCosts) {
        $("#loanHomeCostsSub").textContent = p.costsNote;
        const costs = $("#loanHomeCosts");
        costs.empty();
        costs.append(el("div", { class: "loan-out" }, row("Transfer duty", money(duty, 0)), row("Bond registration (est.)", money(bond, 0)), row("Transfer costs (est.)", money(transfer, 0)), row("Initiation fee", money(init, 0)), el("div", { class: "lo-sep" }), row("Total once-off costs", money(onceOff, 0), "lo-big")));
      }
      amortTable($("#loanHomeAmort"), loan > 0 ? byYear(amortise(loan, rate, home.years * 12, t.payment)) : [], "Year");
    }
    let carBuilt = false;
    let carDepositSync = null;
    let carBalloonSync = null;
    const TERMS = [
      [12, "12 months (1 year)"],
      [24, "24 months (2 years)"],
      [36, "36 months (3 years)"],
      [48, "48 months (4 years)"],
      [54, "54 months"],
      [60, "60 months (5 years)"],
      [66, "66 months"],
      [72, "72 months (6 years)"]
    ];
    function buildCar() {
      const box = $("#loanCarForm");
      box.empty();
      const form = el("div", { class: "loan-form" });
      form.append(numField("Vehicle price", null, car.price, { min: "0", step: "5000" }, (v) => {
        car.price = Math.max(0, parseFloat(v) || 0);
        car.deposit = Math.min(car.price * car.depositPct / 100, car.price);
        carDepositSync();
        carBalloonSync();
        recalcCar();
      }).wrap);
      const dep = depositField(car, recalcCar);
      carDepositSync = dep.sync;
      form.append(dep.wrap);
      form.append(rateField(car, recalcCar));
      form.append(selectField("Loan term", TERMS, car.months, (v) => {
        car.months = Number(v);
        recalcCar();
      }));
      const bal = rangeField((pct) => `Balloon / residual — ${pct}% (${money(car.price * pct / 100, 0)})`, { min: "0", max: "40", step: "5" }, car.balloonPct, (pct) => {
        car.balloonPct = pct;
        recalcCar();
      });
      carBalloonSync = bal.sync;
      form.append(bal.wrap);
      form.append(checkField("Include estimated insurance", "A rough placeholder so the monthly total is not mistaken for the cost of running the car. Get a real quote.", car.insurance, (v) => {
        car.insurance = v;
        recalcCar();
      }));
      box.append(form);
      carBuilt = true;
    }
    function recalcCar() {
      const p = P();
      const deposit = Math.min(car.deposit, car.price);
      const finance = Math.max(0, car.price - deposit);
      const balloon = Math.min(car.price * car.balloonPct / 100, finance);
      const rate = car.rate ?? p.defaultRate;
      const t = totalsFor(finance, rate, car.months, balloon);
      const init = p.vehicleInitiationFee(finance);
      const service = p.serviceFee;
      const serviceTotal = service * car.months;
      const insurance = car.insurance ? insuranceEstimate(car.price) : 0;
      const out = $("#loanCarOut");
      out.empty();
      const block = el("div", { class: "loan-out" }, row("Monthly instalment", money(t.payment, 0), "lo-big grad-txt"));
      if (service > 0)
        block.append(row("Monthly service fee", money(service, 0)));
      if (insurance)
        block.append(row("Insurance (rough estimate)", money(insurance, 0)));
      if (service > 0 || insurance) {
        block.append(row("Total per month", money(t.payment + service + insurance, 0), "text-danger"));
      }
      block.append(el("div", { class: "lo-sep" }), row("Finance amount", money(finance, 0)), row("Total interest", money(t.totalInterest, 0), "text-warning"), row("Total repaid", money(t.totalRepaid, 0)));
      if (balloon > 0) {
        block.append(row("Balloon due at the end", money(balloon, 0), "text-danger"));
        block.append(el("div", { class: "lo-note" }, "The balloon is not paid off by the instalments — at the end of the term you settle it, " + "refinance it, or trade the car in and hope it is worth more than the balloon. That is why " + "the total interest above rises as you raise it."));
      }
      block.append(el("div", { class: "lo-sep" }), row("Deposit", money(deposit, 0)));
      if (init > 0)
        block.append(row("Initiation fee", money(init, 0)));
      if (serviceTotal > 0)
        block.append(row("Service fees over the term", money(serviceTotal, 0)));
      block.append(row("Total cost of ownership", money(deposit + t.totalRepaid + init + serviceTotal, 0), "lo-big"));
      block.append(el("div", { class: "lo-note" }, DISCLAIMER));
      out.append(block);
      $("#loanCarFeesCard").classList.toggle("hidden", !p.hasBuyingCosts);
      if (p.hasBuyingCosts) {
        $("#loanCarFeesSub").textContent = p.feesNote;
        const fees = $("#loanCarFees");
        fees.empty();
        fees.append(el("div", { class: "loan-out" }, row("Initiation fee (once-off)", money(init, 0)), row("Monthly service fee", money(service, 0)), el("div", { class: "lo-sep" }), row("Total service fees over the term", money(serviceTotal, 0), "lo-big")));
      }
      amortTable($("#loanCarAmort"), finance > 0 ? byYear(amortise(finance, rate, car.months, t.payment, balloon)) : [], "Year");
    }
    function showTab(which) {
      const isHome = which === "home";
      $("#loanHome").classList.toggle("hidden", !isHome);
      $("#loanCar").classList.toggle("hidden", isHome);
      for (const [id, on] of [["#loanTabHome", isHome], ["#loanTabCar", !isHome]]) {
        const b = $(id);
        b.setAttribute("aria-pressed", on ? "true" : "false");
        b.classList.toggle("is-on", on);
      }
      renderLoans();
    }
    $("#loanTabHome").addEventListener("click", () => showTab("home"));
    $("#loanTabCar").addEventListener("click", () => showTab("car"));
    function renderLoans() {
      const p = P();
      $("#loansSubNote").textContent = p.hasBuyingCosts ? "Nothing here is saved — change anything and the numbers follow. Costs and fees follow South African rules." : "Nothing here is saved — change anything and the numbers follow. Purchase taxes and lender fees are not modelled for your country.";
      if (!homeBuilt)
        buildHome();
      if (!carBuilt)
        buildCar();
      for (const sync of syncs)
        sync();
      recalcHome();
      recalcCar();
    }
    ctx.provide({ renderLoans });
  };
});

// src/dedupe.js
var require_dedupe = __commonJS((exports2, module2) => {
  var NEAR_DAYS = 4;
  var MIN_PREFIX = 8;
  function txKey(date, desc, amount, label) {
    return `${date}|${String(desc).trim().toLowerCase()}|${Number(amount).toFixed(2)}|${String(label).trim().toLowerCase()}`;
  }
  function normDesc(s) {
    return String(s).toUpperCase().replace(/[^A-Z0-9]+/g, "");
  }
  function commonPrefixLen(a, b) {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a[i] === b[i])
      i++;
    return i;
  }
  function descsLikelySame(a, b) {
    const x = normDesc(a), y = normDesc(b);
    if (!x || !y)
      return false;
    if (x === y)
      return true;
    return commonPrefixLen(x, y) >= MIN_PREFIX;
  }
  function daysApart(a, b) {
    const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
    return Number.isNaN(ms) ? Infinity : Math.abs(ms) / 86400000;
  }
  function buildIndex(txFiles) {
    const exact = new Map;
    const byAmount = new Map;
    const index = { exact, byAmount, seq: 0 };
    for (const f of Object.values(txFiles || {})) {
      for (const r of f.rows || [])
        addToIndex(index, r.date, r.desc, r.amount, f.label);
    }
    return index;
  }
  function addToIndex(index, date, desc, amount, label) {
    const key = txKey(date, desc, amount, label);
    index.exact.set(key, (index.exact.get(key) || 0) + 1);
    const bucket = `${String(label).trim().toLowerCase()}|${Number(amount).toFixed(2)}`;
    if (!index.byAmount.has(bucket))
      index.byAmount.set(bucket, []);
    index.byAmount.get(bucket).push({ id: index.seq++, date, desc, key });
    return key;
  }
  function findNearDuplicate(item, index, label, incomingKeys, consumed, range) {
    const lab = String(label || "").trim().toLowerCase();
    const bucket = index.byAmount.get(`${lab}|${Number(item.amount).toFixed(2)}`);
    if (!bucket)
      return null;
    let best = null, bestGap = Infinity;
    for (const cand of bucket) {
      if (consumed.has(cand.id))
        continue;
      if (incomingKeys.has(cand.key))
        continue;
      if (range && (cand.date < range.min || cand.date > range.max))
        continue;
      const gap = daysApart(item.date, cand.date);
      if (gap > NEAR_DAYS)
        continue;
      if (!descsLikelySame(item.desc, cand.desc))
        continue;
      if (gap < bestGap) {
        best = cand;
        bestGap = gap;
      }
    }
    return best;
  }
  function flagItems(items, index, label, range) {
    const lab = String(label || "").trim().toLowerCase();
    const incomingKeys = new Set(items.map((it) => txKey(it.date, it.desc, it.amount, lab)));
    let dupes = 0, nears = 0;
    const usedExact = new Map;
    for (const it of items) {
      const key = txKey(it.date, it.desc, it.amount, lab);
      const have = index.exact.get(key) || 0;
      const used = usedExact.get(key) || 0;
      it.dup = used < have;
      if (it.dup) {
        usedExact.set(key, used + 1);
        it.include = false;
        it.autoExcluded = true;
        dupes++;
      } else if (it.autoExcluded) {
        it.include = true;
        it.autoExcluded = false;
      }
    }
    const consumed = new Set;
    for (const it of items) {
      const hit = it.dup ? null : findNearDuplicate(it, index, lab, incomingKeys, consumed, range);
      if (hit) {
        consumed.add(hit.id);
        it.near = hit;
        nears++;
        if (!it.nearAuto) {
          it.include = false;
          it.nearAuto = true;
        }
      } else if (it.near && !it.dup) {
        it.near = null;
        if (it.nearAuto) {
          it.include = true;
          it.nearAuto = false;
        }
      }
    }
    return { dupes, nears };
  }
  module2.exports = {
    txKey,
    buildIndex,
    addToIndex,
    findNearDuplicate,
    flagItems,
    descsLikelySame,
    normDesc,
    NEAR_DAYS,
    MIN_PREFIX
  };
});

// src/views/import.js
var require_import = __commonJS((exports2, module2) => {
  var { el, parseCsv, parseStatementDate, normalizeAmount, detectStatementColumns, reconcileAmounts } = require_util();
  var { buildIndex, addToIndex, flagItems } = require_dedupe();
  module2.exports = function registerImport(ctx) {
    const { S, $, money, toast, writeFile, currentPeriod, periodRange, periodTitle, deferredCatSelect, serializeTxFile, locale, learnRules, txSegment, accountForLabel } = ctx;
    function renderImport() {
      const loc = locale();
      $("#importSubNote").textContent = loc.banks ? `Bank statement exports — tested with ${loc.banks}, other banks usually work too — or your own CSV` : "Bank statement CSV exports — or any CSV with Date / Description / Amount columns";
      if (loc.importHint)
        $("#importDropHint").textContent = loc.importHint;
    }
    function prepareRules() {
      return S.rules.map((r) => ({ p: r.pattern.trim().toLowerCase(), category: r.category })).filter((r) => r.p);
    }
    function autoCategorise(desc, rules) {
      const d = desc.trim().toLowerCase();
      let best = "", bestLen = 0;
      for (const r of rules) {
        if (r.p === d)
          return r.category;
        if (r.p.length > bestLen && d.includes(r.p)) {
          best = r.category;
          bestLen = r.p.length;
        }
      }
      return best;
    }
    function dedupIndex() {
      return buildIndex(S.txFiles);
    }
    function detectAccountLabel(filename, rows) {
      const m = filename.match(/^[A-Za-z][A-Za-z0-9]*_(\d{4,})(?:_|\.)/) || filename.match(/^(\d{6,})\D/);
      const byNumber = (n) => {
        const acc = S.accounts.find((a) => a.account_number === n);
        return acc ? acc.tx_label || acc.name : "";
      };
      if (m) {
        const l = byNumber(m[1]);
        if (l)
          return l;
      }
      for (const r of (rows || []).slice(0, 10)) {
        const i = r.findIndex((c) => /account\s*number/i.test(c || ""));
        if (i === -1)
          continue;
        const digits = ((r[i + 1] || r[i]).match(/\d{4,}/) || [])[0];
        if (digits) {
          const l = byNumber(digits);
          if (l)
            return l;
        }
      }
      return "";
    }
    async function handleCsvFile(file) {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length)
        return toast("Empty CSV", true);
      const loc = locale();
      const map = detectStatementColumns(rows, loc.dayFirst);
      if (!map)
        return showColumnMapper(rows, file, null);
      await runImport(rows, map, file);
    }
    async function runImport(rows, map, file) {
      const loc = locale();
      const { iDate, iDesc, iAmount, iDebit, iCredit, iBalance, iExtra } = map;
      const dataRows = rows.slice(map.dataStart);
      const index = dedupIndex();
      const items = [];
      let skipped = 0;
      const label0 = detectAccountLabel(file.name, rows);
      const rules = prepareRules();
      const ledger = [];
      const showBar = dataRows.length > 1500;
      if (showBar)
        importProgress("start", "Categorising transactions…");
      const CHUNK = Math.max(250, Math.ceil(dataRows.length / 15));
      for (let i = 0;i < dataRows.length; i++) {
        const r = dataRows[i];
        const rawDate = (r[iDate] || "").trim();
        let desc = (r[iDesc] || "").trim();
        if (iExtra !== -1 && iExtra !== iDesc) {
          const extra = (r[iExtra] || "").trim();
          if (extra && extra !== desc)
            desc = desc ? `${desc} — ${extra}` : extra;
        }
        if (loc.stripDescSuffix && desc.endsWith(loc.stripDescSuffix))
          desc = desc.slice(0, -loc.stripDescSuffix.length);
        let amount = iAmount !== -1 ? normalizeAmount(r[iAmount]) : null;
        if (amount == null && iCredit !== -1) {
          const c = normalizeAmount(r[iCredit]);
          if (c != null && c !== 0)
            amount = Math.abs(c);
        }
        if (amount == null && iDebit !== -1) {
          const d = normalizeAmount(r[iDebit]);
          if (d != null && d !== 0)
            amount = -Math.abs(d);
        }
        if (iBalance !== -1 && amount != null)
          ledger.push({ amount, balance: normalizeAmount(r[iBalance]) });
        const date = rawDate ? parseStatementDate(rawDate, loc.dayFirst) : null;
        if (date && desc && amount != null && amount !== 0) {
          items.push({ date, desc, amount: parseFloat(amount.toFixed(2)), cat: autoCategorise(desc, rules), include: true, excluded: false });
        } else if (date || amount != null) {
          skipped++;
        }
        if (showBar && i % CHUNK === CHUNK - 1) {
          importProgress("set", null, (i + 1) / dataRows.length * 0.9);
          await new Promise((res) => setTimeout(res, 0));
        }
      }
      if (showBar) {
        importProgress("set", "Preparing review…", 0.95);
        await new Promise((res) => setTimeout(res, 0));
      }
      const rec = iBalance !== -1 ? reconcileAmounts(ledger) : null;
      if (rec && rec.verified && rec.flip && iAmount !== -1)
        for (const it of items)
          it.amount = -it.amount;
      let range = null;
      for (const it of items) {
        if (!range)
          range = { min: it.date, max: it.date };
        else {
          if (it.date < range.min)
            range.min = it.date;
          if (it.date > range.max)
            range.max = it.date;
        }
      }
      S.pendingImport = {
        items,
        label: label0,
        index,
        range,
        skipped,
        filename: file.name,
        reconcile: rec ? { ...rec, flipped: rec.verified && rec.flip && iAmount !== -1 } : null,
        rows,
        map,
        file
      };
      $("#importMap").classList.add("hidden");
      importShown = IMPORT_PAGE;
      renderImportReview();
      if (showBar)
        importProgress("done");
    }
    const MAP_FIELDS = [
      { key: "iDate", label: "Date", required: true, hint: "When the transaction happened" },
      { key: "iDesc", label: "Description", required: true, hint: "The payee or reference" },
      { key: "iExtra", label: "Extra detail", required: false, hint: "Optional second text column — added to the description" },
      { key: "iAmount", label: "Amount", required: false, hint: "One signed column: negative is money out" },
      { key: "iDebit", label: "Money out", required: false, hint: "Use instead of Amount when out and in are separate columns" },
      { key: "iCredit", label: "Money in", required: false, hint: "The partner column to Money out" },
      { key: "iBalance", label: "Balance", required: false, hint: "Optional — lets the amounts be checked against the running balance" }
    ];
    function showColumnMapper(rows, file, detected) {
      const loc = locale();
      const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
      if (!width)
        return toast("Empty CSV", true);
      const headerIdx = detected && detected.headerIdx >= 0 ? detected.headerIdx : -1;
      const header = headerIdx >= 0 ? rows[headerIdx] : null;
      let start = detected ? detected.dataStart : rows.findIndex((r) => r.length >= 3 && r.some((c) => parseStatementDate(c, loc.dayFirst)) && r.some((c) => normalizeAmount(c) != null));
      if (start == null || start < 0)
        start = 0;
      $("#importReview").classList.add("hidden");
      $("#importMap").classList.remove("hidden");
      $("#impMapNote").textContent = detected ? `${file.name} — change any column the importer got wrong, then re-read the file.` : `${file.name} — this export isn't one the importer recognises. Point it at the right columns and it will import like any other.`;
      $("#impMapWarn").textContent = "";
      const colLabel = (i) => {
        const name = header && (header[i] || "").trim();
        const sample2 = rows[start] && (rows[start][i] || "").trim() || "";
        return `${i + 1}${name ? ` — ${name}` : ""}${!name && sample2 ? ` — e.g. ${sample2.slice(0, 22)}` : ""}`;
      };
      const sample = rows[start] || [];
      const looksDate = (i) => !!parseStatementDate((sample[i] || "").trim(), loc.dayFirst);
      const looksText = (i) => {
        const v = (sample[i] || "").trim();
        return !!v && normalizeAmount(v) == null && !looksDate(i);
      };
      const firstOr = (pred, fallback) => {
        for (let i = 0;i < width; i++)
          if (pred(i))
            return i;
        return fallback;
      };
      const defDate = firstOr(looksDate, 0);
      const defDesc = firstOr((i) => i !== defDate && looksText(i), defDate === 0 ? 1 : 0);
      const fallbackFor = (key) => key === "iDate" ? defDate : key === "iDesc" ? defDesc : -1;
      const fields = $("#impMapFields");
      fields.empty();
      const selects = {};
      for (const f of MAP_FIELDS) {
        const sel = el("select", { class: "form-select form-select-sm", id: `impMap_${f.key}`, "aria-label": f.label });
        if (!f.required)
          sel.append(el("option", { value: "-1" }, "(none)"));
        for (let i = 0;i < width; i++)
          sel.append(el("option", { value: String(i) }, colLabel(i)));
        const cur = detected ? detected[f.key] : -1;
        sel.value = String(cur != null && cur >= 0 ? cur : fallbackFor(f.key));
        selects[f.key] = sel;
        fields.append(el("label", { class: "imp-map-field" }, el("span", { class: "imp-map-label" }, f.label + (f.required ? "" : " (optional)")), sel, el("span", { class: "imp-map-hint" }, f.hint)));
      }
      const prev = $("#impMapPreview");
      prev.empty();
      prev.append(el("thead", {}, el("tr", {}, ...Array.from({ length: width }, (_, i) => el("th", { scope: "col" }, colLabel(i))))));
      prev.append(el("tbody", {}, ...rows.slice(start, start + 5).map((r) => el("tr", {}, ...Array.from({ length: width }, (_, i) => el("td", {}, (r[i] || "").trim()))))));
      $("#impMapCancel").onclick = () => {
        $("#importMap").classList.add("hidden");
        if (S.pendingImport)
          $("#importReview").classList.remove("hidden");
      };
      $("#impMapApply").onclick = async () => {
        $("#impMapWarn").textContent = "";
        const map = { headerIdx, dataStart: start, iExtra: -1 };
        for (const f of MAP_FIELDS)
          map[f.key] = parseInt(selects[f.key].value, 10);
        if (map.iDate === map.iDesc)
          return $("#impMapWarn").textContent = "Date and Description are the same column — pick different ones.";
        if (map.iAmount === -1 && (map.iDebit === -1 || map.iCredit === -1))
          return $("#impMapWarn").textContent = "Pick an Amount column, or both Money out and Money in.";
        await runImport(rows, map, file);
        if (!S.pendingImport || !S.pendingImport.items.length) {
          $("#importMap").classList.remove("hidden");
          $("#impMapWarn").textContent = "That mapping produced no transactions — check the Date column especially.";
        }
      };
    }
    function importProgress(phase, text, frac) {
      const wrap = $("#importProgress"), bar = $("#ipBar"), pct = $("#ipPct"), lbl = $("#ipText");
      if (phase === "done") {
        wrap.classList.add("hidden");
        return;
      }
      if (phase === "start") {
        wrap.classList.remove("hidden");
        bar.style.width = "0%";
      }
      if (text)
        lbl.textContent = text;
      if (frac != null) {
        const p = Math.round(frac * 100);
        bar.style.width = p + "%";
        pct.textContent = p + "%";
      }
    }
    const IMPORT_PAGE = 200;
    let importShown = IMPORT_PAGE;
    function renderImportReview() {
      const p = S.pendingImport;
      if (!p)
        return;
      $("#importReview").classList.remove("hidden");
      const accSel = $("#impAccount");
      accSel.empty();
      const labels = [...new Set([
        ...S.accounts.map((a) => a.tx_label || a.name),
        ...Object.values(S.txFiles).map((f) => f.label)
      ])].sort();
      for (const l of labels)
        accSel.append(el("option", { value: l, ...l === p.label ? { selected: "" } : {} }, l));
      if (!p.label && labels.length)
        p.label = accSel.value;
      accSel.onchange = () => {
        p.label = accSel.value;
        renderImportReview();
      };
      const lab = txSegment(p.label || "").trim().toLowerCase();
      const { dupes, nears } = flagItems(p.items, p.index, lab, p.range);
      const newOnes = p.items.filter((i) => !i.dup);
      const auto = newOnes.filter((i) => i.cat).length;
      const cur = currentPeriod();
      const curRange = periodRange(cur);
      const inCurrent = (it) => it.date >= curRange.start && it.date <= curRange.end;
      const curCount = p.items.filter(inCurrent).length;
      $("#impStats").textContent = `${p.filename} — ${p.items.length} rows · ${newOnes.length} new · ${dupes} duplicates skipped` + (nears ? ` · ${nears} likely re-dated/re-worded (unticked)` : "") + ` · ${auto} auto-categorised` + (p.skipped ? ` · ${p.skipped} unparseable` : "");
      $("#impLegend").empty();
      $("#impLegend").append(el("span", { class: "imp-legend-swatch" }), el("span", {}, `${curCount} in the current period — ${periodTitle(cur)}`));
      const rec = p.reconcile;
      const recEl = $("#impReconcile");
      recEl.empty();
      recEl.classList.toggle("hidden", !rec);
      recEl.classList.toggle("imp-reconcile-warn", !!rec && !rec.verified);
      if (rec)
        recEl.textContent = rec.flipped ? "This statement lists money out as positive. Checked against its balance column and corrected — money out shows as negative below." : rec.verified ? "Amounts check out against this statement’s own balance column." : "Could not check these amounts against the balance column — the balances don’t line up. Spot-check a few rows below before importing, especially the + and − signs.";
      const target = accountForLabel(p.label || "");
      const nbEl = $("#impNonBudget");
      const nonBudget = !!target && !target.in_budget;
      nbEl.classList.toggle("hidden", !nonBudget);
      if (nonBudget)
        nbEl.textContent = `${target.name} is excluded from the budget — these rows will import and show in Transactions, but won’t count toward income or spending totals.`;
      const t = $("#impTable");
      t.empty();
      t.append(el("thead", {}, el("tr", {}, el("th", { scope: "col" }, el("span", { class: "sr-only" }, "Import")), el("th", { scope: "col" }, "Date"), el("th", { scope: "col" }, "Description"), el("th", { scope: "col", class: "num" }, "Amount"), el("th", { scope: "col" }, "Category"), el("th", { scope: "col" }, "Excl."))));
      const body = el("tbody", {});
      const visible = p.items.slice(0, importShown);
      for (const it of visible) {
        const cls = (it.dup ? "imp-dup" : it.near ? "imp-near" : "") + (inCurrent(it) ? " imp-current" : "");
        const nearWhy = it.near ? `Looks like the already-imported "${it.near.desc}" on ${it.near.date} — the bank re-dates and re-words a charge when it settles. Tick to import anyway.` : "";
        body.append(el("tr", { class: cls.trim() }, el("td", {}, it.dup ? el("span", { class: "category-badge badge-dup" }, "dup") : el("input", {
          type: "checkbox",
          "aria-label": `Import ${it.date} ${it.desc}, ${money(it.amount)}${it.near ? ". " + nearWhy : ""}`,
          ...it.include ? { checked: "" } : {},
          onchange: (e) => it.include = e.target.checked
        })), el("td", { class: "text-muted", style: "white-space:nowrap" }, it.date), el("td", {}, it.desc, ...it.near ? [
          el("span", { class: "category-badge badge-near", title: nearWhy }, "likely dup"),
          el("div", { class: "imp-near-why" }, nearWhy)
        ] : []), el("td", { class: `num${it.amount >= 0 ? " text-success" : ""}`, style: "white-space:nowrap;font-weight:600" }, money(it.amount)), el("td", {}, it.dup ? it.cat || "" : deferredCatSelect(it.cat, (v) => {
          it.cat = v;
          it.manual = true;
        }, `Category for ${it.desc}`)), el("td", {}, it.dup ? "" : el("input", {
          type: "checkbox",
          "aria-label": `Exclude ${it.desc} from budget totals`,
          ...it.excluded ? { checked: "" } : {},
          onchange: (e) => it.excluded = e.target.checked
        }))));
      }
      if (p.items.length > visible.length) {
        const rest = p.items.length - visible.length;
        const more = el("button", { class: "btn-ghost", style: "width:100%;padding:0.6rem" }, `Show ${Math.min(IMPORT_PAGE, rest)} more of ${rest} remaining`);
        more.addEventListener("click", () => {
          importShown += IMPORT_PAGE;
          renderImportReview();
        });
        body.append(el("tr", {}, el("td", { colspan: "6", style: "padding:0" }, more)));
        $("#impStats").textContent += ` · showing ${visible.length}, all ${p.items.length} will import`;
      }
      t.append(body);
    }
    async function commitImport() {
      const p = S.pendingImport;
      if (!p || !p.label)
        return toast("Pick an account first", true);
      const label = txSegment(p.label);
      if (!label)
        return toast("Invalid account name for import", true);
      const toAdd = p.items.filter((i) => i.include && !i.dup);
      if (!toAdd.length)
        return toast("Nothing selected to import", true);
      const additions = new Map;
      for (const it of toAdd) {
        const month = it.date.slice(0, 7);
        const key = `${label}/${month}`;
        if (!additions.has(key))
          additions.set(key, { month, entries: [] });
        additions.get(key).entries.push({
          row: { date: it.date, desc: it.desc, cat: it.cat, amount: it.amount, excluded: it.excluded, note: it.excluded ? "Excluded during import" : "" },
          src: it
        });
      }
      const TX_FM = "tags: [finance, finance/budget, finance/budget/transactions]";
      const lab = label.trim().toLowerCase();
      let done = 0;
      try {
        for (const [key, { month, entries }] of additions) {
          const rows = entries.map((e) => e.row);
          const existing = S.txFiles[key];
          const fileModel = existing ? { ...existing, rows: existing.rows.concat(rows) } : { label, month, rows, dirty: false, fmRaw: TX_FM };
          await writeFile(`Transactions/${label}/${month}.md`, serializeTxFile(fileModel));
          if (!S.txFiles[key])
            S.txFiles[key] = { label, month, rows: [], dirty: false, fmRaw: TX_FM };
          S.txFiles[key].rows.push(...rows);
          for (const e of entries) {
            e.src.include = false;
            addToIndex(p.index, e.src.date, e.src.desc, e.src.amount, lab);
          }
          done += rows.length;
        }
      } catch (err) {
        renderImportReview();
        return toast(`Import stopped after ${done} row${done === 1 ? "" : "s"} (${err.message || err}). Saved rows kept — click Import rows again to retry the rest.`, true);
      }
      const touched = additions;
      let newRules = 0;
      if ($("#impRemember").checked) {
        newRules = await learnRules(toAdd.filter((it) => it.manual && it.cat).map((it) => ({ desc: it.desc, cat: it.cat })));
      }
      S.pendingImport = null;
      $("#importReview").classList.add("hidden");
      toast(`Imported ${toAdd.length} transactions into ${touched.size} file${touched.size === 1 ? "" : "s"}` + (newRules ? `, saved ${newRules} new rules` : ""));
      ctx.switchView("transactions");
    }
    function remapImport() {
      const p = S.pendingImport;
      if (!p || !p.rows)
        return toast("Drop a statement first", true);
      showColumnMapper(p.rows, p.file, p.map);
    }
    ctx.provide({ handleCsvFile, commitImport, renderImport, remapImport });
  };
});

// src/controller.js
var require_controller = __commonJS((exports2, module2) => {
  var { Notice } = require("obsidian");
  var { el, setIco, setInert } = require_util();
  var { SHELL_HTML } = require_shell();
  var { confirmModal } = require_modal();
  var { localeFor } = require_locale();
  var registerIo = require_io();
  var registerPeriod = require_period();
  var registerLoad = require_load();
  var registerCategories = require_categories();
  var registerDashboard = require_dashboard();
  var registerTransactions = require_transactions();
  var registerBudgets = require_budgets();
  var registerAccounts = require_accounts();
  var registerSavings = require_savings();
  var registerDebts = require_debts();
  var registerOwed = require_owed();
  var registerServices = require_services();
  var registerTax = require_tax();
  var registerLoans = require_loans();
  var registerImport = require_import();
  function mountApp(view) {
    const plugin = view.plugin;
    const app = view.app;
    const vault = app.vault;
    const root = view.contentEl;
    root.classList.add("budget-app-root");
    root.empty();
    const parsed = new DOMParser().parseFromString(SHELL_HTML, "text/html");
    while (parsed.body.firstChild)
      root.appendChild(parsed.body.firstChild);
    root.querySelectorAll("span[data-ico]").forEach((sp) => setIco(sp, sp.getAttribute("data-ico").split("|")));
    const $ = (s) => root.querySelector(s);
    const $$ = (s) => root.querySelectorAll(s);
    const S = {
      loaded: false,
      settings: { month_start_day: 23, currency: "R", country: "za", period_days: 0, period_anchor: "" },
      categories: [],
      accounts: [],
      budgets: {},
      budgetMeta: {},
      txFiles: {},
      rules: [],
      debts: [],
      debtsDirty: false,
      owed: [],
      owedDirty: false,
      services: [],
      servicesDirty: false,
      tax: {},
      taxYear: null,
      taxDirty: false,
      period: null,
      view: "dashboard",
      pendingImport: null
    };
    function toast(msg, bad = false) {
      const t = $("#toast");
      if (!t)
        return;
      t.textContent = msg;
      t.className = bad ? "bad" : "good";
      t.classList.add("show");
      clearTimeout(t._h);
      t._h = setTimeout(() => t.classList.remove("show"), 2600);
    }
    const locale = () => localeFor(S.settings.country);
    function money(v, decimals = 2) {
      const loc = locale();
      const sign = v < 0 ? "-" : "";
      const parts = Math.abs(v).toFixed(decimals).split(".");
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, loc.thousands);
      return `${S.settings.currency} ${sign}${parts[0]}${decimals > 0 ? loc.decimal + parts[1] : ""}`;
    }
    const typeBadge = (type) => el("span", { class: `category-badge badge-${type}` }, type);
    const ctx = { plugin, app, vault, view, root, $, $$, S, toast, money, typeBadge, locale };
    ctx.provide = (obj) => {
      for (const k of Object.keys(obj)) {
        if (k in ctx)
          throw new Error(`Budget: ctx.${k} is already defined — two modules are publishing the same name.`);
      }
      Object.assign(ctx, obj);
    };
    const dirtyChecks = [];
    ctx.registerDirty = (fn) => dirtyChecks.push(fn);
    ctx.switchView = (v) => switchView(v);
    ctx.render = () => render();
    registerIo(ctx);
    registerPeriod(ctx);
    registerLoad(ctx);
    registerCategories(ctx);
    registerDashboard(ctx);
    registerTransactions(ctx);
    registerBudgets(ctx);
    registerAccounts(ctx);
    registerSavings(ctx);
    registerDebts(ctx);
    registerOwed(ctx);
    registerServices(ctx);
    registerTax(ctx);
    registerLoans(ctx);
    registerImport(ctx);
    function switchView(v) {
      S.view = v;
      for (const b of $$(".drawer-link[data-view]")) {
        if (b.dataset.view === v)
          b.setAttribute("aria-current", "page");
        else
          b.removeAttribute("aria-current");
      }
      for (const sec of $$("main > section"))
        sec.classList.add("hidden");
      $(`#view-${v}`).classList.remove("hidden");
      closeDrawer();
      render();
      const h = $(`#view-${v} h1`);
      if (h) {
        h.setAttribute("tabindex", "-1");
        h.focus();
      }
    }
    function render() {
      if (!S.loaded)
        return;
      $("#periodLabel").textContent = ctx.periodTitle(S.period);
      ({
        dashboard: ctx.renderDashboard,
        transactions: ctx.renderTransactions,
        budgets: ctx.renderBudgets,
        savings: ctx.renderSavings,
        accounts: ctx.renderAccounts,
        debts: ctx.renderDebts,
        owed: ctx.renderOwed,
        services: ctx.renderServices,
        tax: ctx.renderTax,
        loans: ctx.renderLoans,
        import: ctx.renderImport,
        connect: () => {}
      })[S.view]();
      if (locked)
        setInert($(".bud-scroll"), true);
    }
    function openDrawer() {
      const d = $("#appDrawer");
      d.classList.add("open");
      setInert(d, false);
      $("#drawerOverlay").classList.add("open");
      $("#menuBtn").setAttribute("aria-expanded", "true");
      $("#drawerClose").focus();
    }
    function closeDrawer() {
      const d = $("#appDrawer");
      const wasOpen = d.classList.contains("open");
      d.classList.remove("open");
      setInert(d, true);
      $("#drawerOverlay").classList.remove("open");
      $("#menuBtn").setAttribute("aria-expanded", "false");
      if (wasOpen)
        $("#menuBtn").focus();
    }
    function applyIdentity() {
      const name = (S.settings.household || "").trim();
      $("#brandSub").textContent = name ? `${name} · Obsidian` : "Obsidian vault budget";
      const words = name.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
      const initials = words.length ? (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase() : "BV";
      const av = $("#topbarAvatar");
      av.textContent = initials;
      av.setAttribute("aria-label", name ? `Budget settings — ${name}` : "Open budget settings");
      av.setAttribute("title", name ? `${name} · budget settings` : "Budget settings");
    }
    function applyTheme() {
      const pref = plugin.settings.theme;
      const dark = pref === "dark" || pref === "auto" && document.body.classList.contains("theme-dark");
      root.classList.toggle("bud-dark", dark);
      if (S.loaded && S.view === "dashboard")
        ctx.renderTrend();
    }
    ctx.registerDirty(() => Object.values(S.txFiles).some((f) => f.dirty));
    ctx.registerDirty(() => !!S.pendingImport);
    function hasDirty() {
      return dirtyChecks.some((fn) => fn());
    }
    async function reloadFromDisk() {
      ctx.invalidateBudgetDraft();
      S.pendingImport = null;
      $("#importReview").classList.add("hidden");
      await ctx.loadVault();
      for (const id of ["#budSave", "#debtSave", "#owedSave", "#svcSave", "#taxSave"]) {
        const b = $(id);
        if (b)
          b.disabled = true;
      }
    }
    ctx.reloadFromDisk = reloadFromDisk;
    async function connectVault() {
      try {
        await reloadFromDisk();
      } catch (e) {
        S.loaded = false;
        $("#connectErr").textContent = e.message || String(e);
        return;
      }
      if (!S.categories.length && !Object.keys(S.txFiles).length) {
        S.loaded = false;
        for (const sec of $$("main > section"))
          sec.classList.add("hidden");
        $("#view-connect").classList.remove("hidden");
        $("#periodPill").classList.add("hidden");
        $("#topbarImport").classList.add("hidden");
        $("#connectPathNote").empty();
        $("#connectPathNote").append("Looked in ", el("code", {}, ctx.basePath()), " but found no Categories/ or Transactions/ inside it. Point the plugin at the Budget folder itself.");
        return;
      }
      S.loaded = true;
      applyIdentity();
      $("#view-connect").classList.add("hidden");
      $("#periodPill").classList.remove("hidden");
      $("#topbarImport").classList.remove("hidden");
      switchView(S.view === "connect" ? "dashboard" : S.view);
      toast(`Loaded ${Object.values(S.txFiles).reduce((a, f) => a + f.rows.length, 0)} transactions`);
    }
    let locked = false;
    function focusEnter() {
      const g = $("#splashGate");
      $("#gateEnter").focus({ preventScroll: true });
      g.scrollTop = 0;
    }
    function lockGate() {
      if (locked)
        return;
      locked = true;
      closeDrawer();
      $("#splashGate").classList.remove("hidden");
      setInert($(".topbar"), true);
      setInert($(".bud-scroll"), true);
      focusEnter();
    }
    async function unlockGate() {
      if (!locked)
        return;
      locked = false;
      $("#splashGate").classList.add("hidden");
      setInert($(".topbar"), false);
      setInert($(".bud-scroll"), false);
      if (!S.loaded)
        await connectVault();
      const h = $(`#view-${S.view} h1`);
      if (h) {
        h.setAttribute("tabindex", "-1");
        h.focus();
      }
    }
    $("#gateEnter").addEventListener("click", () => {
      unlockGate();
    });
    view.registerDomEvent(document, "visibilitychange", () => {
      if (document.hidden && plugin.settings.privacyLock)
        lockGate();
    });
    let lastInputAt = 0;
    view.registerDomEvent(root, "input", () => {
      lastInputAt = Date.now();
    });
    function isEditing() {
      const a = document.activeElement;
      if (a && root.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName))
        return true;
      return Date.now() - lastInputAt < 3000;
    }
    let reloadTimer = null;
    function scheduleReload(delay) {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(async () => {
        if (Date.now() - ctx.lastWriteAt() < 2000)
          return;
        if (hasDirty())
          return;
        if (isEditing())
          return scheduleReload(1500);
        await connectVault();
        if (S.loaded)
          toast("Reloaded — files changed in the vault");
      }, delay);
    }
    const onFsChange = (file) => {
      const path = file?.path || "";
      const bp = ctx.basePath();
      if (path !== bp && !path.startsWith(bp + "/"))
        return;
      if (Date.now() - ctx.lastWriteAt() < 2000)
        return;
      if (hasDirty())
        return;
      scheduleReload(800);
    };
    view.registerEvent(vault.on("modify", onFsChange));
    view.registerEvent(vault.on("create", onFsChange));
    view.registerEvent(vault.on("delete", onFsChange));
    view.registerEvent(vault.on("rename", onFsChange));
    view.registerEvent(app.workspace.on("css-change", applyTheme));
    $("#openSettingsBtn").addEventListener("click", () => {
      app.setting.open();
      app.setting.openTabById("budget-app");
    });
    $("#brandHome").addEventListener("click", () => {
      if (S.loaded)
        switchView("dashboard");
    });
    $("#topbarAvatar").addEventListener("click", () => {
      app.setting.open();
      app.setting.openTabById("budget-app");
    });
    $("#topbarImport").addEventListener("click", () => {
      if (!S.loaded)
        return;
      switchView("import");
      if (!S.pendingImport)
        $("#fileInput").click();
    });
    $("#pluginSettingsLink").addEventListener("click", () => {
      closeDrawer();
      app.setting.open();
      app.setting.openTabById("budget-app");
    });
    async function changePeriod(next) {
      if (S.view === "budgets" && ctx.budgetDirty()) {
        const go = await confirmModal(app, {
          title: "Unsaved budget changes",
          message: "Switching period will discard your unsaved budget edits. Continue?",
          confirmText: "Discard & switch"
        });
        if (!go)
          return;
        ctx.invalidateBudgetDraft();
      }
      S.period = next;
      render();
    }
    $("#prevPeriod").addEventListener("click", () => changePeriod(ctx.shiftPeriod(S.period, -1)));
    $("#nextPeriod").addEventListener("click", () => changePeriod(ctx.shiftPeriod(S.period, 1)));
    $("#currentPeriod").addEventListener("click", () => changePeriod(ctx.currentPeriod()));
    $("#menuBtn").addEventListener("click", () => $("#appDrawer").classList.contains("open") ? closeDrawer() : openDrawer());
    $("#drawerClose").addEventListener("click", closeDrawer);
    $("#drawerOverlay").addEventListener("click", closeDrawer);
    view.registerDomEvent(document, "keydown", (e) => {
      if (e.key === "Escape" && root.isConnected && $("#appDrawer")?.classList.contains("open"))
        closeDrawer();
    });
    for (const b of $$(".drawer-link[data-view]")) {
      b.addEventListener("click", () => {
        if (S.loaded)
          switchView(b.dataset.view);
        else
          closeDrawer();
      });
    }
    $("#reloadLink").addEventListener("click", async () => {
      if (!S.loaded)
        return closeDrawer();
      await reloadFromDisk();
      closeDrawer();
      render();
      toast("Reloaded from disk");
    });
    $("#txSave").addEventListener("click", ctx.saveTransactions);
    $("#txAdd").addEventListener("click", ctx.addTransaction);
    for (const id of ["txAccount", "txCategory", "txWholeHistory"])
      $("#" + id).addEventListener("change", ctx.renderTransactions);
    $("#txSearch").addEventListener("input", () => {
      clearTimeout(S._q);
      S._q = setTimeout(ctx.renderTransactions, 200);
    });
    $("#budSave").addEventListener("click", ctx.saveBudget);
    $("#budCopyPrev").addEventListener("click", ctx.copyPreviousBudget);
    $("#budAddCat").addEventListener("click", ctx.addNewCategory);
    $("#acctAdd").addEventListener("click", ctx.addAccount);
    $("#savAdd").addEventListener("click", ctx.addAccount);
    $("#debtSave").addEventListener("click", ctx.saveDebts);
    $("#debtAdd").addEventListener("click", ctx.addDebt);
    $("#debtExtra").addEventListener("input", ctx.replan);
    $("#debtStrategy").addEventListener("change", ctx.replan);
    $("#owedSave").addEventListener("click", ctx.saveOwed);
    $("#owedAdd").addEventListener("click", ctx.addOwed);
    $("#svcSave").addEventListener("click", ctx.saveServices);
    $("#svcAdd").addEventListener("click", ctx.addService);
    $("#taxSave").addEventListener("click", ctx.saveTax);
    $("#taxAddStep").addEventListener("click", ctx.addTaxStep);
    $("#taxAddDoc").addEventListener("click", ctx.addTaxDoc);
    $("#taxAddFigure").addEventListener("click", ctx.addTaxFigure);
    $("#taxNewYear").addEventListener("click", ctx.newTaxYear);
    $("#taxStart").addEventListener("click", ctx.startTax);
    $("#taxYearSel").addEventListener("change", (e) => ctx.changeTaxYear(e.target.value));
    const taxDrop = $("#taxDrop");
    taxDrop.addEventListener("click", () => $("#taxFileInput").click());
    $("#taxFileInput").addEventListener("change", (e) => {
      if (e.target.files[0])
        ctx.handleTaxFile(e.target.files[0]);
      e.target.value = "";
    });
    taxDrop.addEventListener("dragover", (e) => {
      e.preventDefault();
      taxDrop.classList.add("dragover");
    });
    taxDrop.addEventListener("dragleave", () => taxDrop.classList.remove("dragover"));
    taxDrop.addEventListener("drop", (e) => {
      e.preventDefault();
      taxDrop.classList.remove("dragover");
      if (e.dataTransfer.files[0])
        ctx.handleTaxFile(e.dataTransfer.files[0]);
    });
    $("#impCommit").addEventListener("click", ctx.commitImport);
    $("#impRemap").addEventListener("click", ctx.remapImport);
    const drop = $("#drop");
    drop.addEventListener("click", () => $("#fileInput").click());
    $("#fileInput").addEventListener("change", (e) => {
      if (e.target.files[0])
        ctx.handleCsvFile(e.target.files[0]);
      e.target.value = "";
    });
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("dragover");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("dragover");
      if (e.dataTransfer.files[0])
        ctx.handleCsvFile(e.dataTransfer.files[0]);
    });
    return {
      start: async () => {
        applyTheme();
        if (plugin.settings.privacyLock) {
          lockGate();
          return;
        }
        await connectVault();
      },
      destroy: () => {
        clearTimeout(reloadTimer);
        clearTimeout(S._q);
        const t = $("#toast");
        if (t)
          clearTimeout(t._h);
      },
      reload: async () => {
        if (hasDirty()) {
          new Notice('Budget: unsaved changes — reload skipped. Save (or "Reload from disk" to discard), then retry.', 7000);
          return;
        }
        await connectVault();
      },
      applyTheme,
      applyPrivacyLock: () => {
        if (plugin.settings.privacyLock)
          lockGate();
        else
          unlockGate();
      },
      hasDirty
    };
  }
  module2.exports = { mountApp };
});

// src/view.js
var require_view = __commonJS((exports2, module2) => {
  var { ItemView, Notice } = require("obsidian");
  var { VIEW_TYPE } = require_constants();
  var { mountApp } = require_controller();

  class BudgetView extends ItemView {
    constructor(leaf, plugin) {
      super(leaf);
      this.plugin = plugin;
    }
    getViewType() {
      return VIEW_TYPE;
    }
    getDisplayText() {
      return "Budget";
    }
    getIcon() {
      return "wallet";
    }
    async onOpen() {
      this.appCtl = mountApp(this);
      await this.appCtl.start();
      this.setupKeyboardViewport();
    }
    setupKeyboardViewport() {
      const vv = window.visualViewport;
      if (!vv)
        return;
      const root = this.contentEl;
      const KB_MIN = 120;
      const adjust = () => {
        const keyboard = window.innerHeight - (vv.height + vv.offsetTop);
        if (keyboard > KB_MIN) {
          const top = root.getBoundingClientRect().top;
          const h = vv.offsetTop + vv.height - top;
          if (h > 120)
            root.style.height = `${h}px`;
          window.setTimeout(() => {
            const a = document.activeElement;
            if (a && root.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) {
              a.scrollIntoView({ block: "center" });
            }
          }, 60);
        } else {
          root.style.height = "";
        }
      };
      this.registerDomEvent(vv, "resize", adjust);
      this.registerDomEvent(vv, "scroll", adjust);
    }
    async onClose() {
      if (this.appCtl && this.appCtl.hasDirty()) {
        new Notice("Budget: the view closed with unsaved changes — they were not written to disk.", 8000);
      }
      if (this.appCtl)
        this.appCtl.destroy();
      this.appCtl = null;
      this.contentEl.empty();
      this.contentEl.style.height = "";
      this.contentEl.classList.remove("budget-app-root", "bud-dark");
    }
  }
  module2.exports = { BudgetView };
});

// src/onboarding.js
var require_onboarding = __commonJS((exports2, module2) => {
  var { Modal, Setting, Notice, normalizePath, TFile, TFolder } = require("obsidian");
  var { PROFILES, COUNTRY_ORDER, localeFor } = require_locale();
  var STARTER_CATEGORIES = [
    { name: "Salary", type: "income", color: "#22c55e" },
    { name: "Other income", type: "income", color: "#4ade80" },
    { name: "Groceries", type: "expense", color: "#f59e0b" },
    { name: "Rent / Bond", type: "expense", color: "#dc3545" },
    { name: "Electricity & water", type: "expense", color: "#fbbf24" },
    { name: "Transport & fuel", type: "expense", color: "#60a5fa" },
    { name: "Cellphone & internet", type: "expense", color: "#38bdf8" },
    { name: "Medical", type: "expense", color: "#f87171" },
    { name: "Clothing", type: "expense", color: "#c084fc" },
    { name: "Bank fees", type: "expense", color: "#94a3b8" },
    { name: "Home loan / bond repayment", type: "debt", color: "#fb923c" },
    { name: "Car repayment", type: "debt", color: "#f97316" },
    { name: "Credit card & other debt", type: "debt", color: "#ea580c" },
    { name: "Subscriptions", type: "services", color: "#818cf8" },
    { name: "Insurance", type: "insurance", color: "#2dd4bf" },
    { name: "Giving", type: "giving", color: "#fb923c" },
    { name: "Savings", type: "savings", color: "#34d399" },
    { name: "Eating out", type: "luxuries", color: "#f472b6" },
    { name: "Entertainment", type: "luxuries", color: "#a78bfa" },
    { name: "Transfer between accounts", type: "transfer", color: "#888888" }
  ];
  var ACCOUNT_TYPES = [
    ["checking", "Cheque / current account"],
    ["savings", "Savings account"],
    ["credit_card", "Credit card"],
    ["cash", "Cash"],
    ["investment", "Investment"]
  ];
  var CURRENCIES = [
    ["R", "R — South African Rand"],
    ["$", "$ — Dollar"],
    ["€", "€ — Euro"],
    ["£", "£ — Pound"],
    ["__custom__", "Other…"]
  ];
  function currentPeriodFor(day) {
    const now = new Date;
    let y = now.getFullYear(), m = now.getMonth() + 1;
    if (day > 1 && now.getDate() >= day) {
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return `${y}-${String(m).padStart(2, "0")}`;
  }
  var safeFileName = (s) => s.replace(/[\\/:*?"<>|]/g, "-").trim();

  class OnboardingWizard extends Modal {
    constructor(app, plugin) {
      super(app);
      this.plugin = plugin;
      this.finished = false;
      this.stepIdx = 0;
      this.mode = "create";
      this.data = {
        folder: plugin.settings.budgetFolder || "Finances/Budget",
        name: "",
        country: "za",
        periodMode: "payday",
        payday: 25,
        currency: "R",
        customCurrency: "",
        cats: new Set(STARTER_CATEGORIES.map((c) => c.name)),
        acctName: "",
        acctType: "checking",
        acctInstitution: "",
        acctBalance: ""
      };
    }
    steps() {
      return this.mode === "connect" ? ["welcome", "folder", "existing", "name", "country", "period", "currency", "finish"] : ["welcome", "folder", "name", "country", "period", "currency", "categories", "account", "finish"];
    }
    onOpen() {
      this.titleEl.setText("Set up Budget Vault");
      this.renderStep();
    }
    onClose() {
      this.contentEl.empty();
      if (!this.finished) {
        new Notice('Setup skipped — run "Budget Vault: Set up budget" from the command palette anytime.', 6000);
        this.plugin.settings.onboarded = true;
        this.plugin.saveSettings();
      }
    }
    renderStep() {
      const c = this.contentEl;
      c.empty();
      const steps = this.steps();
      const step = steps[this.stepIdx];
      if (step !== "welcome")
        c.createDiv({ cls: "budget-onb-step", text: `Step ${this.stepIdx} of ${steps.length - 1}` });
      this["render_" + step](c);
      const nav = new Setting(c);
      if (this.stepIdx > 0)
        nav.addButton((b) => b.setButtonText("Back").onClick(() => {
          this.stepIdx--;
          this.renderStep();
        }));
      nav.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()));
      nav.addButton((b) => b.setButtonText(step === "finish" ? this.mode === "connect" ? "Connect budget" : "Create my budget" : step === "welcome" ? "Let's go!" : "Next").setCta().onClick(() => this.next()));
    }
    async next() {
      const step = this.steps()[this.stepIdx];
      if (step === "folder") {
        const folder = normalizePath((this.data.folder || "").trim());
        if (!folder || folder === "/") {
          new Notice("Enter a folder path for the budget.");
          return;
        }
        this.data.folder = folder;
        const wasConnect = this.mode === "connect";
        this.mode = this.detectExisting(folder) ? "connect" : "create";
        if (this.mode === "connect" && !wasConnect)
          await this.prefillFromSettingsMd();
      }
      if (step === "period" && this.data.periodMode === "payday") {
        const d = Number(this.data.payday);
        if (!Number.isInteger(d) || d < 1 || d > 28) {
          new Notice("Payday must be a day from 1 to 28.");
          return;
        }
      }
      if (step === "currency" && this.data.currency === "__custom__" && !this.data.customCurrency.trim()) {
        new Notice("Enter a currency symbol.");
        return;
      }
      if (step === "finish") {
        await this.apply();
        return;
      }
      this.stepIdx++;
      this.renderStep();
    }
    detectExisting(folder) {
      const v = this.app.vault;
      return !!v.getFileByPath(normalizePath(folder + "/Settings.md")) || !!v.getFolderByPath(normalizePath(folder + "/Categories"));
    }
    async prefillFromSettingsMd() {
      const f = this.app.vault.getFileByPath(normalizePath(this.data.folder + "/Settings.md"));
      if (!f)
        return;
      const { parseFrontmatter } = require_util();
      const { fm } = parseFrontmatter(await this.app.vault.cachedRead(f));
      const day = parseInt(fm.month_start_day, 10);
      if (day >= 1 && day <= 28) {
        this.data.payday = day;
        this.data.periodMode = day === 1 ? "calendar" : "payday";
      }
      if (fm.country && PROFILES[fm.country.toString().trim().toLowerCase()]) {
        this.data.country = fm.country.toString().trim().toLowerCase();
      }
      if (fm.currency) {
        if (CURRENCIES.some(([v]) => v === fm.currency))
          this.data.currency = fm.currency;
        else {
          this.data.currency = "__custom__";
          this.data.customCurrency = fm.currency;
        }
      }
      if (fm.household)
        this.data.name = fm.household;
    }
    render_welcome(c) {
      c.createEl("h2", { text: "Welcome to Budget Vault!" });
      c.createEl("p", { text: "Your whole budget, living right here in your vault as plain markdown — no accounts, no cloud, no one else's server. If your vault syncs to your phone, your budget rides along for free." });
      const intro = c.createEl("p");
      intro.createEl("b", { text: "Here's the plan — this wizard sets you up:" });
      const setup = c.createEl("ol", { cls: "budget-onb-journey" });
      for (const t of [
        "Create your budget folder — we scaffold the whole structure for you",
        "Pick your country & currency — so amounts, dates and tax stuff look right",
        "Choose your budget categories — tick the ones that fit your life",
        "Add your first account — and what's in it right now"
      ])
        setup.createEl("li", { text: t });
      const then = c.createEl("p");
      then.createEl("b", { text: "Then the fun starts in the app:" });
      const inApp = c.createEl("ol", { cls: "budget-onb-journey" });
      for (const t of [
        "Set your budget — give every category a number to aim for",
        "Import your bank's CSV — transactions sort themselves as you teach it",
        "Add new categories anytime — your budget grows with you",
        "Review as you go — the dashboard shows exactly where the money went"
      ])
        inApp.createEl("li", { text: t });
      c.createEl("p", { text: "About two minutes of setup. Ready?" });
    }
    render_folder(c) {
      c.createEl("p", { text: "Budget Vault stores everything — categories, accounts, budgets and transactions — as plain markdown files in your vault, so your data syncs with the vault and stays yours." });
      new Setting(c).setName("Budget folder").setDesc("Vault path where the budget files live (created if it doesn't exist).").addText((t) => t.setPlaceholder("Finances/Budget").setValue(this.data.folder).onChange((v) => {
        this.data.folder = v;
      }));
    }
    render_existing(c) {
      c.createEl("p", { text: `Found an existing budget in "${this.data.folder}" — connecting to it instead of creating new files. The next steps just confirm your settings; nothing else is touched.` });
    }
    render_name(c) {
      new Setting(c).setName("Your name or nickname").setDesc("Shown in the dashboard greeting and the top bar. Leave blank to skip.").addText((t) => t.setPlaceholder("e.g. Alex, or The Smiths").setValue(this.data.name).onChange((v) => {
        this.data.name = v;
      }));
    }
    render_country(c) {
      new Setting(c).setName("Country").setDesc("Sets the default currency, amount formatting, bank-statement date order and the Tax view's return checklist (tailored to your country's tax authority). You can still override the currency on the next steps.").addDropdown((d) => {
        for (const code of COUNTRY_ORDER)
          d.addOption(code, PROFILES[code].label);
        d.setValue(this.data.country);
        d.onChange((v) => {
          this.data.country = v;
          this.data.currency = CURRENCIES.some(([cv]) => cv === PROFILES[v].currency) ? PROFILES[v].currency : "__custom__";
          if (this.data.currency === "__custom__")
            this.data.customCurrency = PROFILES[v].currency;
        });
      });
    }
    render_period(c) {
      new Setting(c).setName("Budget month").setDesc("Calendar runs 1st → end of month. Payday runs from your payday to the day before the next one.").addDropdown((d) => d.addOption("calendar", "Calendar month (1st to end of month)").addOption("payday", "Payday to payday").setValue(this.data.periodMode).onChange((v) => {
        this.data.periodMode = v;
        this.renderStep();
      }));
      if (this.data.periodMode === "payday") {
        new Setting(c).setName("Payday").setDesc("Day of the month you get paid (1–28).").addText((t) => {
          t.inputEl.type = "number";
          t.setValue(String(this.data.payday));
          t.onChange((v) => {
            this.data.payday = v;
          });
        });
      }
    }
    render_currency(c) {
      new Setting(c).setName("Currency symbol").setDesc("Shown before every amount.").addDropdown((d) => {
        for (const [v, label] of CURRENCIES)
          d.addOption(v, label);
        d.setValue(this.data.currency);
        d.onChange((v) => {
          this.data.currency = v;
          this.renderStep();
        });
      });
      if (this.data.currency === "__custom__") {
        new Setting(c).setName("Custom symbol").addText((t) => t.setPlaceholder("e.g. CHF").setValue(this.data.customCurrency).onChange((v) => {
          this.data.customCurrency = v;
        }));
      }
    }
    render_categories(c) {
      c.createEl("p", { text: "Start with a set of budget categories — untick any you don't want. You can add, rename or recolour categories later." });
      const grid = c.createDiv({ cls: "budget-onb-cats" });
      for (const cat of STARTER_CATEGORIES) {
        const label = grid.createEl("label");
        const cb = label.createEl("input", { type: "checkbox" });
        cb.checked = this.data.cats.has(cat.name);
        cb.addEventListener("change", () => {
          if (cb.checked)
            this.data.cats.add(cat.name);
          else
            this.data.cats.delete(cat.name);
        });
        label.appendText(` ${cat.name}`);
        label.createEl("span", { cls: "budget-onb-cat-type", text: cat.type });
      }
    }
    render_account(c) {
      c.createEl("p", { text: "Transactions are stored per account. Add your main account now, or leave the name blank to skip." });
      new Setting(c).setName("Account name").addText((t) => t.setPlaceholder("e.g. Cheque account").setValue(this.data.acctName).onChange((v) => {
        this.data.acctName = v;
      }));
      new Setting(c).setName("Type").addDropdown((d) => {
        for (const [v, label] of ACCOUNT_TYPES)
          d.addOption(v, label);
        d.setValue(this.data.acctType);
        d.onChange((v) => {
          this.data.acctType = v;
        });
      });
      new Setting(c).setName("Bank / institution").setDesc("Optional.").addText((t) => t.setValue(this.data.acctInstitution).onChange((v) => {
        this.data.acctInstitution = v;
      }));
      new Setting(c).setName("Current balance").setDesc("Optional — what's in the account right now (your latest bank statement's closing balance, or check your banking app). Balances are a snapshot you keep up to date yourself, so importing only recent transactions never throws this off. You can update it any time by clicking the balance on the Accounts page.").addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.step = "0.01";
        t.setPlaceholder("0.00").setValue(this.data.acctBalance).onChange((v) => {
          this.data.acctBalance = v;
        });
      });
    }
    render_finish(c) {
      const day = this.monthStartDay();
      const rows = [
        ["Folder", this.data.folder],
        ["Name", this.data.name.trim() || "—"],
        ["Country", localeFor(this.data.country).label],
        ["Budget month", day === 1 ? "Calendar month" : `Payday to payday (day ${day})`],
        ["Currency", this.currencySymbol()]
      ];
      if (this.mode === "create") {
        rows.push(["Categories", `${this.data.cats.size} starter categories`]);
        rows.push(["First account", this.data.acctName.trim() || "—"]);
        const bal = parseFloat(String(this.data.acctBalance).replace(",", ".").replace(/[^\d.-]/g, ""));
        if (this.data.acctName.trim() && !isNaN(bal) && bal !== 0)
          rows.push(["Opening balance", `${this.currencySymbol()} ${bal.toFixed(2)}`]);
      }
      c.createEl("p", {
        text: this.mode === "connect" ? "Connecting to the existing budget folder and saving these settings into its Settings.md:" : "This will create the budget folder with Settings.md, your categories, the first budget file and empty Owed Money / Services files:"
      });
      const ul = c.createEl("ul");
      for (const [k, v] of rows) {
        const li = ul.createEl("li");
        li.createEl("b", { text: k + ": " });
        li.appendText(v);
      }
    }
    monthStartDay() {
      return this.data.periodMode === "calendar" ? 1 : Math.min(28, Math.max(1, parseInt(this.data.payday, 10) || 25));
    }
    currencySymbol() {
      return (this.data.currency === "__custom__" ? this.data.customCurrency.trim() : this.data.currency) || "R";
    }
    async writeIfAbsent(path, content) {
      const vault = this.app.vault;
      if (vault.getAbstractFileByPath(path))
        return;
      const parent = path.split("/").slice(0, -1).join("/");
      await this.ensureFolder(parent);
      this.plugin._lastWrite = Date.now();
      try {
        await vault.create(path, content);
      } catch (e) {}
      this.plugin._lastWrite = Date.now();
    }
    async ensureFolder(path) {
      if (!path || path === "/")
        return;
      if (this.app.vault.getAbstractFileByPath(path))
        return;
      await this.ensureFolder(path.split("/").slice(0, -1).join("/"));
      try {
        await this.app.vault.createFolder(path);
      } catch (e) {}
    }
    async apply() {
      const p = this.plugin;
      const folder = this.data.folder;
      const day = this.monthStartDay();
      const cur = this.currencySymbol();
      const name = this.data.name.trim();
      try {
        p.settings.budgetFolder = folder;
        if (this.mode === "connect") {
          await p.saveSettings();
          await p.updateBudgetSettingsMd("month_start_day", String(day));
          await p.updateBudgetSettingsMd("currency", `"${cur.replace(/"/g, "")}"`);
          await p.updateBudgetSettingsMd("country", this.data.country);
          if (name)
            await p.updateBudgetSettingsMd("household", `"${name.replace(/"/g, "")}"`);
        } else {
          for (const sub of ["Categories", "Accounts", "Budgets", "Transactions", "Tax", "Data"]) {
            await this.ensureFolder(normalizePath(`${folder}/${sub}`));
          }
          await this.writeIfAbsent(normalizePath(`${folder}/Settings.md`), `---
month_start_day: ${day}
currency: "${cur.replace(/"/g, "")}"
country: ${this.data.country}
` + (name ? `household: "${name.replace(/"/g, "")}"
` : "") + `tags: [finance, finance/budget, vault-meta]
---

# Budget Settings

` + `- **month_start_day** — the financial period starts on this day of the month.
` + `- **currency** — symbol shown before every amount in the Budget Vault plugin.
` + `- **country** — drives amount formatting, statement date order and the Tax view (za, us, uk, eu, au, ca, cn, other).
` + `- **household** — name shown in the dashboard greeting.

` + `Edit the values above directly, or change them in **Settings → Budget Vault** —
` + `the plugin writes them back to this file, so they sync to every device with the vault.
`);
          for (const cat of STARTER_CATEGORIES) {
            if (!this.data.cats.has(cat.name))
              continue;
            const safe = safeFileName(cat.name);
            const nameLine = safe !== cat.name ? `name: "${cat.name}"
` : "";
            await this.writeIfAbsent(normalizePath(`${folder}/Categories/${safe}.md`), `---
${nameLine}type: ${cat.type}
color: "${cat.color}"
tags: [finance, finance/budget, finance/budget/categories]
---

# ${cat.name}

Budget category of type **${cat.type}**.
`);
          }
          const acct = this.data.acctName.trim();
          if (acct) {
            const safe = safeFileName(acct);
            const today = new Date;
            const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
            const bal = parseFloat(String(this.data.acctBalance).replace(",", ".").replace(/[^\d.-]/g, ""));
            await this.writeIfAbsent(normalizePath(`${folder}/Accounts/${safe}.md`), `---
type: ${this.data.acctType}
` + (this.data.acctInstitution.trim() ? `institution: ${this.data.acctInstitution.trim()}
` : "") + `balance: ${(isNaN(bal) ? 0 : bal).toFixed(2)}
balance_updated: ${ymd}
tags: [finance, finance/budget, finance/budget/accounts]
---

# ${acct}

Transactions are stored under \`Transactions/${safe}/\` as monthly files.
`);
            await this.ensureFolder(normalizePath(`${folder}/Transactions/${safe}`));
          }
          const period = currentPeriodFor(day);
          await this.writeIfAbsent(normalizePath(`${folder}/Budgets/${period}.md`), `---
period: ${period}
tags: [finance, finance/budget, finance/budget/budgets]
---

# Budget — ${period}

` + `| Category | Type | Amount | Notes |
|----------|------|-------:|-------|
`);
          await this.writeIfAbsent(normalizePath(`${folder}/Owed Money.md`), `---
kind: owed
tags: [finance, finance/budget, finance/budget/owed-money]
---

# Owed Money

` + `Money owed to the household. \`status\` is \`outstanding\` or \`paid\`.

` + `| Person | Amount | Description | Due date | Status |
|--------|-------:|-------------|----------|--------|
`);
          await this.writeIfAbsent(normalizePath(`${folder}/Debts.md`), `---
kind: debts
tags: [finance, finance/budget, finance/budget/debts]
---

# Debts

` + `Money the household owes. \`rate\` is the annual interest rate as a percentage,
` + `\`payment\` the contracted monthly amount and \`extra\` anything paid on top of it.
` + `\`status\` is \`active\` or \`paid\`.

` + `| Name | Lender | Type | Balance | Original | Rate | Payment | Extra | Start date | Category | Status | Notes |
` + `|------|--------|------|--------:|---------:|-----:|--------:|------:|------------|----------|--------|-------|
`);
          await this.writeIfAbsent(normalizePath(`${folder}/Services.md`), `---
kind: services
tags: [finance, finance/budget, finance/budget/services]
---

# Services & Subscriptions

` + `Recurring services and subscriptions. \`cycle\` is \`monthly\` or \`annual\`.

` + `| Name | Provider | Amount | Cycle | Next billing | Category | Active | Notes |
|------|----------|-------:|-------|--------------|----------|--------|-------|
`);
          await this.writeIfAbsent(normalizePath(`${folder}/Data/Categorisation Rules.csv`), `pattern,category
`);
        }
        p.settings.onboarded = true;
        await p.saveSettings();
        this.finished = true;
        this.close();
        new Notice(this.mode === "connect" ? "Connected to your budget folder." : "Budget folder created — welcome!");
        p.reloadViews();
        await p.activateView();
      } catch (e) {
        new Notice("Setup failed: " + (e.message || e), 8000);
      }
    }
  }
  module2.exports = { OnboardingWizard, STARTER_CATEGORIES };
});

// src/settings-tab.js
var require_settings_tab = __commonJS((exports2, module2) => {
  var { PluginSettingTab, Setting, TFile, Notice, normalizePath } = require("obsidian");
  var { DEFAULT_SETTINGS, FEEDBACK_URL, SUPPORT_URL } = require_constants();
  var { OnboardingWizard } = require_onboarding();
  var { PROFILES, COUNTRY_ORDER } = require_locale();
  var { yamlStr, periodDaysOrZero, isoDayNumber } = require_util();
  var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  var MD_KEYS = new Set(["household", "month_start_day", "country", "currency", "period_days", "period_anchor"]);
  var PERIOD_PRESETS = { 0: "Monthly (payday month)", 7: "Every week", 14: "Every 2 weeks", 28: "Every 4 weeks" };
  function periodLengthOptions(current) {
    const o = { ...PERIOD_PRESETS };
    if (current && !o[current])
      o[current] = `Every ${current} days (set in Settings.md)`;
    return o;
  }
  var PERIOD_LENGTH_DESC = "How long each budget period runs. Monthly uses the month start day above. The other options line periods up with a pay cycle instead, counting from the date below.";
  var PERIOD_ANCHOR_DESC = "When were you last paid? Any recent payday works — only the day it falls on within the cycle matters, so an earlier or later one gives the same result. Ignored when the period length is monthly.";
  var FEEDBACK_DESC = "Report a bug, flag an issue or request a feature. Opens a Google Form in your browser — nothing from your budget is attached or sent.";
  var SUPPORT_DESC = "Budget Vault is free and always will be. If you'd like to say thanks, this opens PayPal in your browser — entirely optional, and nothing in the plugin changes either way.";

  class BudgetSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
      super(app, plugin);
      this.plugin = plugin;
    }
    display() {
      const { containerEl } = this;
      containerEl.empty();
      new Setting(containerEl).setName("Budget folder").setDesc("Vault path of the folder holding Categories/, Accounts/, Budgets/, Transactions/, Settings.md, etc.").addText((t) => t.setPlaceholder(DEFAULT_SETTINGS.budgetFolder).setValue(this.plugin.settings.budgetFolder).onChange(async (v) => {
        this.plugin.settings.budgetFolder = normalizePath(v.trim() || DEFAULT_SETTINGS.budgetFolder);
        await this.plugin.saveSettings();
        this.plugin.reloadViews();
      }));
      new Setting(containerEl).setName("Theme").setDesc("Follow Obsidian's light/dark mode, or force the Airy Glass dark or light palette.").addDropdown((d) => d.addOption("auto", "Follow Obsidian").addOption("dark", "Always dark").addOption("light", "Always light").setValue(this.plugin.settings.theme).onChange(async (v) => {
        this.plugin.settings.theme = v;
        await this.plugin.saveSettings();
        this.plugin.forEachView((ctl) => ctl.applyTheme());
      }));
      new Setting(containerEl).setName("Setup wizard").setDesc("Re-run the first-run wizard — folder, name, budget period, currency, starter files.").addButton((b) => b.setButtonText("Run setup wizard").onClick(() => new OnboardingWizard(this.app, this.plugin).open()));
      new Setting(containerEl).setName("Open on startup").setDesc("Open the budget view automatically when Obsidian starts.").addToggle((t) => t.setValue(this.plugin.settings.openOnStartup).onChange(async (v) => {
        this.plugin.settings.openOnStartup = v;
        await this.plugin.saveSettings();
      }));
      new Setting(containerEl).setName("Privacy splash screen").setDesc('Cover the budget with a splash screen until you tap "Enter budget" — on open, and again whenever Obsidian goes to the background. Nothing is read from the vault until you tap.').addToggle((t) => t.setValue(this.plugin.settings.privacyLock).onChange(async (v) => {
        this.plugin.settings.privacyLock = v;
        await this.plugin.saveSettings();
        this.plugin.forEachView((ctl) => ctl.applyPrivacyLock());
      }));
      new Setting(containerEl).setName("Send feedback").setDesc(FEEDBACK_DESC).addButton((b) => b.setButtonText("Open feedback form").onClick(() => window.open(FEEDBACK_URL, "_blank")));
      new Setting(containerEl).setName("Support Budget Vault").setDesc(SUPPORT_DESC).addButton((b) => b.setButtonText("Send a thank you").onClick(() => window.open(SUPPORT_URL, "_blank")));
      new Setting(containerEl).setName("Budget data").setHeading().setDesc("Stored in Settings.md inside the budget folder, so they apply on every device.");
      const fmSection = containerEl.createDiv();
      this.renderMdSettings(fmSection);
    }
    hide() {
      clearTimeout(this._hhTimer);
      clearTimeout(this._msdTimer);
      clearTimeout(this._curTimer);
    }
    async renderMdSettings(containerEl) {
      const md = await this.plugin.readBudgetSettingsMd();
      new Setting(containerEl).setName("Name / household").setDesc("Shown in the dashboard greeting and top bar. Leave blank for none.").addText((t) => {
        t.setValue(md.household ?? "");
        t.onChange((v) => {
          clearTimeout(this._hhTimer);
          this._hhTimer = setTimeout(async () => {
            await this.plugin.updateBudgetSettingsMd("household", yamlStr(v.trim()));
            this.plugin.reloadViews();
          }, 800);
        });
      });
      new Setting(containerEl).setName("Month start day").setDesc("Day of the month each financial period begins on (payday). 1–28.").addText((t) => {
        t.inputEl.type = "number";
        t.setValue(String(md.month_start_day ?? 23));
        t.onChange((v) => {
          clearTimeout(this._msdTimer);
          this._msdTimer = setTimeout(async () => {
            const n = parseInt(v, 10);
            if (!n || n < 1 || n > 28) {
              new Notice(`Budget: "${v}" is not a valid month start day — enter a number from 1 to 28.`, 6000);
              return;
            }
            await this.plugin.updateBudgetSettingsMd("month_start_day", String(n));
            this.plugin.reloadViews();
          }, 800);
        });
      });
      new Setting(containerEl).setName("Period length").setDesc(PERIOD_LENGTH_DESC).addDropdown((d) => {
        const cur = periodDaysOrZero(md.period_days);
        for (const [days, label] of Object.entries(periodLengthOptions(cur)))
          d.addOption(days, label);
        d.setValue(String(cur));
        d.onChange(async (v) => {
          const n = periodDaysOrZero(v);
          await this.plugin.updateBudgetSettingsMd("period_days", String(n));
          if (n && !ISO_DATE.test((md.period_anchor ?? "").toString().trim())) {
            new Notice('Budget: set "Last payday" below so periods know where to start — until then they stay monthly.', 8000);
          }
          this.plugin.reloadViews();
          this.display();
        });
      });
      new Setting(containerEl).setName("Last payday").setDesc(PERIOD_ANCHOR_DESC).addText((t) => {
        t.inputEl.type = "date";
        t.setValue((md.period_anchor ?? "").toString().trim());
        t.onChange((v) => {
          clearTimeout(this._anchorTimer);
          this._anchorTimer = setTimeout(async () => {
            const next = v.trim();
            if (next && !ISO_DATE.test(next)) {
              new Notice(`Budget: "${next}" is not a date — use the picker, or type YYYY-MM-DD.`, 6000);
              return;
            }
            await this.warnIfAnchorReslices(md, next);
            await this.plugin.updateBudgetSettingsMd("period_anchor", next);
            this.plugin.reloadViews();
          }, 800);
        });
      });
      new Setting(containerEl).setName("Country").setDesc("Drives amount formatting, bank-statement date order and the Tax view's checklist (tailored to your country's tax authority). Existing tax years keep their data — only labels and new-year seeds change.").addDropdown((d) => {
        for (const code of COUNTRY_ORDER)
          d.addOption(code, PROFILES[code].label);
        const cur = (md.country ?? "za").toString().trim().toLowerCase();
        d.setValue(PROFILES[cur] ? cur : "za");
        d.onChange(async (v) => {
          await this.plugin.updateBudgetSettingsMd("country", v);
          this.plugin.reloadViews();
        });
      });
      new Setting(containerEl).setName("Currency symbol").setDesc("Shown before every amount, e.g. R.").addText((t) => {
        t.setValue(md.currency ?? "R");
        t.onChange((v) => {
          clearTimeout(this._curTimer);
          this._curTimer = setTimeout(async () => {
            if (!v.trim())
              return;
            await this.plugin.updateBudgetSettingsMd("currency", yamlStr(v.trim()));
            this.plugin.reloadViews();
          }, 800);
        });
      });
    }
    mdSettings() {
      const f = this.app.vault.getAbstractFileByPath(this.plugin.settingsMdPath());
      if (!(f instanceof TFile))
        return {};
      const cache = this.app.metadataCache.getFileCache(f);
      return cache && cache.frontmatter || {};
    }
    datedBudgetCount() {
      const base = `${this.plugin.settings.budgetFolder}/Budgets/`;
      return this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(base) && ISO_DATE.test(f.basename)).length;
    }
    async warnIfAnchorReslices(md, next) {
      const days = periodDaysOrZero(md.period_days);
      const prev = (md.period_anchor ?? "").toString().trim();
      if (!days || !ISO_DATE.test(prev) || !ISO_DATE.test(next))
        return;
      if ((isoDayNumber(next) - isoDayNumber(prev)) % days === 0)
        return;
      const n = this.datedBudgetCount();
      if (!n)
        return;
      new Notice(`Budget: this shifts every period boundary. ${n} budget ${n === 1 ? "file" : "files"} ` + `named by date will stop matching — they stay in your vault, and setting this date ` + `back to ${prev} brings them straight back.`, 12000);
    }
    getControlValue(key) {
      if (!MD_KEYS.has(key))
        return super.getControlValue(key);
      const md = this.mdSettings();
      if (key === "household")
        return md.household ?? "";
      if (key === "month_start_day")
        return Number(md.month_start_day ?? 23);
      if (key === "period_days")
        return String(periodDaysOrZero(md.period_days));
      if (key === "period_anchor")
        return (md.period_anchor ?? "").toString().trim();
      if (key === "currency")
        return md.currency ?? "R";
      if (key === "country") {
        const c = (md.country ?? "za").toString().trim().toLowerCase();
        return PROFILES[c] ? c : "za";
      }
      return;
    }
    async setControlValue(key, value) {
      if (!MD_KEYS.has(key)) {
        if (key === "budgetFolder")
          value = normalizePath(String(value).trim() || DEFAULT_SETTINGS.budgetFolder);
        await super.setControlValue(key, value);
        if (key === "theme")
          this.plugin.forEachView((ctl) => ctl.applyTheme());
        else if (key === "privacyLock")
          this.plugin.forEachView((ctl) => ctl.applyPrivacyLock());
        else if (key === "budgetFolder")
          this.plugin.reloadViews();
        return;
      }
      if (key === "period_anchor") {
        const next = String(value).trim();
        if (next && !ISO_DATE.test(next))
          return;
        await this.warnIfAnchorReslices(this.mdSettings(), next);
      }
      const raw = key === "household" || key === "currency" ? yamlStr(String(value).trim()) : key === "month_start_day" ? String(parseInt(value, 10)) : key === "period_days" ? String(periodDaysOrZero(value)) : key === "period_anchor" ? String(value).trim() : key === "country" ? String(value) : null;
      if (raw === null)
        return;
      await this.plugin.updateBudgetSettingsMd(key, raw);
      this.plugin.reloadViews();
    }
    getSettingDefinitions() {
      return [
        {
          name: "Budget folder",
          desc: "Vault path of the folder holding Categories/, Accounts/, Budgets/, Transactions/, Settings.md, etc.",
          control: { type: "folder", key: "budgetFolder", placeholder: DEFAULT_SETTINGS.budgetFolder }
        },
        {
          name: "Theme",
          desc: "Follow Obsidian's light/dark mode, or force the Airy Glass dark or light palette.",
          control: {
            type: "dropdown",
            key: "theme",
            defaultValue: DEFAULT_SETTINGS.theme,
            options: { auto: "Follow Obsidian", dark: "Always dark", light: "Always light" }
          }
        },
        {
          name: "Setup wizard",
          desc: "Re-run the first-run wizard — folder, name, budget period, currency, starter files.",
          render: (setting) => {
            setting.addButton((b) => b.setButtonText("Run setup wizard").onClick(() => new OnboardingWizard(this.app, this.plugin).open()));
          }
        },
        {
          name: "Open on startup",
          desc: "Open the budget view automatically when Obsidian starts.",
          control: { type: "toggle", key: "openOnStartup", defaultValue: DEFAULT_SETTINGS.openOnStartup }
        },
        {
          name: "Privacy splash screen",
          desc: 'Cover the budget with a splash screen until you tap "Enter budget" — on open, and again whenever Obsidian goes to the background. Nothing is read from the vault until you tap.',
          control: { type: "toggle", key: "privacyLock", defaultValue: DEFAULT_SETTINGS.privacyLock }
        },
        {
          name: "Send feedback",
          desc: FEEDBACK_DESC,
          render: (setting) => {
            setting.addButton((b) => b.setButtonText("Open feedback form").onClick(() => window.open(FEEDBACK_URL, "_blank")));
          }
        },
        {
          name: "Support Budget Vault",
          desc: SUPPORT_DESC,
          render: (setting) => {
            setting.addButton((b) => b.setButtonText("Send a thank you").onClick(() => window.open(SUPPORT_URL, "_blank")));
          }
        },
        {
          name: "Budget data",
          desc: "Stored in Settings.md inside the budget folder, so they apply on every device.",
          render: (setting) => {
            setting.setHeading();
          }
        },
        {
          name: "Name / household",
          desc: "Shown in the dashboard greeting and top bar. Leave blank for none.",
          control: { type: "text", key: "household", placeholder: "Leave blank for none" }
        },
        {
          name: "Month start day",
          desc: "Day of the month each financial period begins on (payday). 1–28.",
          control: {
            type: "number",
            key: "month_start_day",
            defaultValue: 23,
            min: 1,
            max: 28,
            validate: (v) => {
              const n = parseInt(v, 10);
              return n >= 1 && n <= 28 ? undefined : "Pick a day between 1 and 28.";
            }
          }
        },
        {
          name: "Period length",
          desc: PERIOD_LENGTH_DESC,
          control: {
            type: "dropdown",
            key: "period_days",
            defaultValue: "0",
            options: periodLengthOptions(periodDaysOrZero(this.mdSettings().period_days))
          }
        },
        {
          name: "Last payday",
          desc: PERIOD_ANCHOR_DESC,
          control: {
            type: "text",
            key: "period_anchor",
            placeholder: "YYYY-MM-DD",
            validate: (v) => {
              const s = String(v).trim();
              return !s || ISO_DATE.test(s) ? undefined : "Use YYYY-MM-DD, e.g. 2026-08-07.";
            }
          }
        },
        {
          name: "Country",
          desc: "Drives amount formatting, bank-statement date order and the Tax view's checklist (tailored to your country's tax authority). Existing tax years keep their data — only labels and new-year seeds change.",
          control: {
            type: "dropdown",
            key: "country",
            defaultValue: "za",
            options: Object.fromEntries(COUNTRY_ORDER.map((code) => [code, PROFILES[code].label]))
          }
        },
        {
          name: "Currency symbol",
          desc: "Shown before every amount, e.g. R.",
          control: {
            type: "text",
            key: "currency",
            placeholder: "R",
            validate: (v) => String(v).trim() ? undefined : "Enter a currency symbol."
          }
        }
      ];
    }
  }
  module2.exports = { BudgetSettingTab };
});

// src/main.js
var { Plugin, TFile, TFolder, normalizePath } = require("obsidian");
var { VIEW_TYPE, DEFAULT_SETTINGS } = require_constants();
var { parseFrontmatter } = require_util();
var { BudgetView } = require_view();
var { BudgetSettingTab } = require_settings_tab();
var { OnboardingWizard } = require_onboarding();

class BudgetPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this._lastWrite = 0;
    this.registerView(VIEW_TYPE, (leaf) => new BudgetView(leaf, this));
    this.addRibbonIcon("wallet", "Open budget", () => this.activateView());
    this.addCommand({ id: "open-budget", name: "Open budget", callback: () => this.activateView() });
    this.addCommand({ id: "setup-wizard", name: "Set up budget (onboarding wizard)", callback: () => new OnboardingWizard(this.app, this).open() });
    this.addSettingTab(new BudgetSettingTab(this.app, this));
    if (this.settings.openOnStartup) {
      this.app.workspace.onLayoutReady(() => {
        if (!this.app.workspace.getLeavesOfType(VIEW_TYPE).length)
          this.activateView();
      });
    }
    if (!this.settings.onboarded) {
      this.app.workspace.onLayoutReady(async () => {
        if (this.hasBudgetData()) {
          this.settings.onboarded = true;
          await this.saveSettings();
          return;
        }
        new OnboardingWizard(this.app, this).open();
      });
    }
  }
  hasBudgetData() {
    const v = this.app.vault;
    return !!v.getFileByPath(this.settingsMdPath()) || !!v.getFolderByPath(normalizePath(this.settings.budgetFolder + "/Categories"));
  }
  async activateView() {
    const ws = this.app.workspace;
    const existing = ws.getLeavesOfType(VIEW_TYPE)[0];
    if (existing) {
      ws.revealLeaf(existing);
      return;
    }
    const leaf = ws.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    ws.revealLeaf(leaf);
  }
  forEachView(fn) {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof BudgetView && leaf.view.appCtl)
        fn(leaf.view.appCtl);
    }
  }
  reloadViews() {
    this.forEachView((ctl) => ctl.reload());
  }
  settingsMdPath() {
    return normalizePath(this.settings.budgetFolder + "/Settings.md");
  }
  async readBudgetSettingsMd() {
    const f = this.app.vault.getFileByPath(this.settingsMdPath());
    if (!f)
      return {};
    const { fm } = parseFrontmatter(await this.app.vault.cachedRead(f));
    return fm;
  }
  async updateBudgetSettingsMd(key, value) {
    const path = this.settingsMdPath();
    const f = this.app.vault.getFileByPath(path);
    if (f) {
      let text = await this.app.vault.read(f);
      const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (m) {
        let block = m[1];
        const re = new RegExp("^(" + key + "\\s*:).*$", "m");
        if (re.test(block))
          block = block.replace(re, (whole, g1) => `${g1} ${value}`);
        else
          block += `
${key}: ${value}`;
        text = `---
${block}
---` + text.slice(m[0].length);
      } else {
        text = `---
${key}: ${value}
---

` + text;
      }
      this._lastWrite = Date.now();
      await this.app.vault.modify(f, text);
      this._lastWrite = Date.now();
    } else {
      const defaults = { month_start_day: "23", currency: "R", country: "za" };
      defaults[key] = value;
      this._lastWrite = Date.now();
      await this.app.vault.create(path, `---
` + Object.entries(defaults).map(([k, v]) => `${k}: ${v}`).join(`
`) + `
---

# Budget Settings
`);
      this._lastWrite = Date.now();
    }
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
}
module.exports = BudgetPlugin;
