"use strict";
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

// src/constants.js
var require_constants = __commonJS((exports2, module2) => {
  var VIEW_TYPE = "budget-app-view";
  var DEFAULT_SETTINGS = {
    budgetFolder: "Finances/Budget",
    theme: "auto",
    openOnStartup: false,
    onboarded: false
  };
  var TYPE_ORDER = ["income", "expense", "debt", "services", "insurance", "giving", "savings", "investment", "luxuries", "transfer"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  module2.exports = { VIEW_TYPE, DEFAULT_SETTINGS, TYPE_ORDER, MONTHS };
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
      if (!t.startsWith("|") || /^\|[\s:|-]+\|$/.test(t))
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
    return { ok: false, value: parseFloat(t) || 0, raw: t };
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
    const s = (raw ?? "").toString().trim();
    if (!s)
      return null;
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
    m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3,})[ -](\d{4})$/);
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
  function safeSeg(s) {
    return (s ?? "").toString().replace(/[\\/:*?"<>|]/g, "-").replace(/\.{2,}/g, "-").replace(/^\.+/, "").trim();
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
  module2.exports = { el, setIco, icoEl, escMd, unescMd, parseFrontmatter, parseMdTable, parseCsv, parseStatementDate, normalizeAmount, parseNum, patchFrontmatter, safeSeg, collapsePath };
});

// src/shell.js
var require_shell = __commonJS((exports2, module2) => {
  var SHELL_HTML = `
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
    <button class="drawer-link" data-view="owed">
      <span class="di"><span class="ico" data-ico="users"></span></span>Owed Money
    </button>
    <button class="drawer-link" data-view="services">
      <span class="di"><span class="ico" data-ico="layers"></span></span>Services
    </button>

    <div class="drawer-divider"></div>

    <div class="drawer-section-label">Tools</div>
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

    <span class="brand">
      <span class="brand-logo" aria-hidden="true"><span class="ico" data-ico="wallet|banknote|coins"></span></span>
      <span class="brand-text">
        <b>Budget Vault</b>
        <span class="brand-sub" id="brandSub">Obsidian vault budget</span>
      </span>
    </span>

    <div class="header-period-pill hidden" id="periodPill" role="group" aria-label="Period navigation">
      <button class="pnav-btn" id="prevPeriod" aria-label="Previous period"><span class="ico" data-ico="chevron-left"></span></button>
      <span class="pnav-dot" aria-hidden="true"></span>
      <span class="pnav-label" id="periodLabel"></span>
      <button class="pnav-btn" id="currentPeriod" aria-label="Jump to current period"><span class="ico" data-ico="refresh-cw|rotate-cw"></span></button>
      <button class="pnav-btn" id="nextPeriod" aria-label="Next period"><span class="ico" data-ico="chevron-right"></span></button>
    </div>

    <div class="ml-auto">
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
          <div class="body-pad" style="padding-left:20px;padding-right:20px">
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
              <button class="btn-gradient" id="txSave" disabled>Save changes</button>
            </div>
          </div>
          <div class="body-pad" style="padding-left:20px;padding-right:20px;padding-top:14px">
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
          <div class="body-pad" style="padding-left:20px;padding-right:20px;padding-top:14px">
            <div class="table-responsive"><table class="table" id="budTable"></table></div>
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
            <p style="margin-top:1.2rem"><button class="btn-gradient" id="taxStart" style="padding:0.55rem 1.5rem"></button></p>
          </div>
        </div>

        <div id="taxContent">
          <div class="mini-grid mini-kpis-4 mb-4" id="taxKpis"></div>

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
            <div class="body-pad" style="padding-left:20px;padding-right:20px;padding-top:14px">
              <div class="table-responsive"><table class="table table-hover" id="taxStepsTable"></table></div>
            </div>
          </div>

          <div class="card">
            <div class="card-h" style="align-items:center">
              <div><h2>Documents</h2><div class="sub" id="taxDocsSub"></div></div>
              <div class="row">
                <button class="btn-ghost" id="taxAddDoc"><span class="ico" data-ico="plus"></span> Add document</button>
              </div>
            </div>
            <div class="body-pad" style="padding-top:14px">
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
          <div class="card-h"><div><h2>Goals</h2><div class="sub">Progress toward each target</div></div></div>
          <div class="body-pad" id="savingsGoals"></div>
        </div>
        <div id="savingsSections"></div>
      </section>

      <section id="view-accounts" class="hidden">
        <div class="financial-period-banner">
          <h1 class="financial-period-banner-title">Accounts</h1>
          <div class="sub-note">Click a balance to update it — the account's markdown file is rewritten.</div>
        </div>
        <div id="acctSections"></div>
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
          <div class="body-pad" style="padding-left:20px;padding-right:20px;padding-top:14px">
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
          <div class="body-pad" style="padding-left:20px;padding-right:20px;padding-top:14px">
            <div class="table-responsive"><table class="table table-hover" id="svcTable"></table></div>
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
              <p>Columns are matched by header name, so any CSV with a header row of
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
        <div class="card hidden" id="importReview">
          <div class="card-h" style="align-items:center">
            <div>
              <h2>Review import</h2>
              <div class="sub" id="impStats"></div>
              <div class="sub imp-legend" id="impLegend"></div>
            </div>
            <div class="row">
              <select id="impAccount" class="form-select form-select-sm"></select>
              <label class="text-muted" style="font-size:13px;display:inline-flex;align-items:center;gap:6px">
                <input type="checkbox" id="impRemember" checked> remember new categorisations
              </label>
              <button class="btn-gradient" id="impCommit">Import rows</button>
            </div>
          </div>
          <div class="body-pad" style="padding-left:20px;padding-right:20px;padding-top:14px">
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
              d.addOption(o, o.label ?? o);
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
  module2.exports = { FieldModal, askFields, ConfirmModal, confirmModal };
});

// src/locale.js
var require_locale = __commonJS((exports2, module2) => {
  var genericTax = (authority) => ({
    authority,
    taxIntro: `Track a ${authority === "Tax" ? "tax" : authority} return season here — progress steps, the documents you need and where each one comes from, with the files themselves stored in your vault.`,
    yearHint: "Tax year (calendar year)",
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
      ["unknown", "Not checked yet"]
    ],
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
      banks: "Discovery, FNB, Capitec, Nedbank, Standard Bank, Absa",
      importHint: null,
      authority: "SARS",
      taxIntro: "Track a SARS return season here — progress steps, the documents you need (IRP5, IT3(b), medical certificate, …) and the files themselves, stored in the vault.",
      yearHint: "Tax year (ends Feb of this year)",
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
        ["unknown", "Not checked yet"]
      ],
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
        { step: "Respond to SARS verification requests", notes: "Within the timeframe SARS gives" },
        { step: `IRP6 provisional return ${year + 1} — period 1`, due: `${year}-08-31`, notes: "Provisional taxpayers only — mark N/A if standard" },
        { step: `IRP6 provisional return ${year + 1} — period 2`, due: `${year + 1}-02-28`, notes: "Provisional taxpayers only — mark N/A if standard" }
      ],
      seedDocs: () => [
        { name: "IRP5 / IT3(a) employee certificate", source: "Employer", notes: "Usually pre-populated" },
        { name: "IT3(b) interest certificate", source: "Your bank", notes: "One per bank you hold accounts with" },
        { name: "IT3(b) interest certificate", source: "Your second bank", notes: "Remove if not applicable" },
        { name: "IT3(b) / IT3(c) investment certificates", source: "Investment provider", notes: "Interest, dividends, capital gains" },
        { name: "TFSA contribution certificate", source: "Investment provider", notes: "Growth is exempt; contributions still declared" },
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
        ["unknown", "Not checked yet"]
      ],
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
        ["unknown", "Not checked yet"]
      ],
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
        ["unknown", "Not checked yet"]
      ],
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
        ["unknown", "Not checked yet"]
      ],
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
  var COUNTRY_ORDER = ["za", "us", "uk", "eu", "au", "ca", "other"];
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
      const f = vault.getAbstractFileByPath(relPath(rel));
      return f instanceof TFile ? await vault.cachedRead(f) : null;
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
      const f = vault.getAbstractFileByPath(path);
      if (f instanceof TFile) {
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
      const f = vault.getAbstractFileByPath(path);
      if (f instanceof TFile) {
        await vault.modifyBinary(f, data);
      } else {
        await ensureFolder(path.split("/").slice(0, -1).join("/"));
        await vault.createBinary(path, data);
      }
      stampWrite();
    }
    function fileAt(rel) {
      const f = vault.getAbstractFileByPath(relPath(rel));
      return f instanceof TFile ? f : null;
    }
    function mdFilesIn(rel) {
      const f = vault.getAbstractFileByPath(relPath(rel));
      if (!(f instanceof TFolder))
        return [];
      return f.children.filter((c) => c instanceof TFile && c.extension === "md");
    }
    function subfoldersIn(rel) {
      const f = vault.getAbstractFileByPath(relPath(rel));
      if (!(f instanceof TFolder))
        return [];
      return f.children.filter((c) => c instanceof TFolder);
    }
    Object.assign(ctx, {
      basePath,
      relPath,
      readFile,
      writeFile,
      writeBinary,
      fileAt,
      mdFilesIn,
      subfoldersIn,
      lastWriteAt: () => plugin._lastWrite || 0
    });
  };
});

// src/period.js
var require_period = __commonJS((exports2, module2) => {
  var { MONTHS } = require_constants();
  module2.exports = function registerPeriod(ctx) {
    const { S } = ctx;
    function periodRange(p) {
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
      const [y, m] = p.split("-").map(Number);
      return `${MONTH_FULL[m - 1]} ${y}`;
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
    function catType(name) {
      return S.categories.find((c) => c.name === name)?.type || null;
    }
    function periodSummary(p) {
      const tx = txInPeriod(p).filter((t) => !t.excluded);
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
    Object.assign(ctx, {
      periodRange,
      currentPeriod,
      shiftPeriod,
      periodTitle,
      periodMonthName,
      txInPeriod,
      catType,
      periodSummary,
      budgetTotals
    });
  };
});

// src/load.js
var require_load = __commonJS((exports2, module2) => {
  var { TFile } = require("obsidian");
  var { TYPE_ORDER } = require_constants();
  var { parseFrontmatter, parseMdTable, parseCsv, unescMd, parseNum } = require_util();
  module2.exports = function registerLoad(ctx) {
    const { S, vault, readFile, mdFilesIn, subfoldersIn, currentPeriod } = ctx;
    async function loadVault() {
      const settingsTxt = await readFile("Settings.md");
      if (settingsTxt) {
        const { fm } = parseFrontmatter(settingsTxt);
        if (fm.month_start_day) {
          const n = parseInt(fm.month_start_day, 10) || 23;
          S.settings.month_start_day = Math.min(28, Math.max(1, n));
        }
        if (fm.currency)
          S.settings.currency = fm.currency;
        S.settings.country = (fm.country || "za").toString().trim().toLowerCase();
        S.settings.household = fm.household || "";
      }
      S.categories = [];
      for (const f of mdFilesIn("Categories")) {
        const { fm } = parseFrontmatter(await vault.cachedRead(f));
        S.categories.push({ name: fm.name || f.basename, type: fm.type || "expense", color: fm.color || "#888" });
      }
      S.categories.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.name.localeCompare(b.name));
      S.accounts = [];
      for (const f of mdFilesIn("Accounts")) {
        const { fm, body, raw } = parseFrontmatter(await vault.cachedRead(f));
        S.accounts.push({
          name: f.basename,
          fmRaw: raw,
          type: fm.type || "other",
          institution: fm.institution || "",
          account_number: fm.account_number || "",
          tx_label: fm.tx_label || "",
          balance: parseFloat(fm.balance || "0") || 0,
          balance_updated: fm.balance_updated || "",
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
      for (const f of mdFilesIn("Budgets")) {
        if (!/^\d{4}-\d{2}$/.test(f.basename))
          continue;
        const period = f.basename;
        const text = await vault.cachedRead(f);
        const { raw } = parseFrontmatter(text);
        S.budgetMeta[period] = { raw };
        const rows = parseMdTable(text);
        S.budgets[period] = rows.slice(1).map((c) => {
          const amt = parseNum(c[2]);
          return { category: unescMd(c[0]), type: c[1] || "", amount: amt.value, amountRaw: amt.ok ? null : amt.raw, notes: unescMd(c[3] || "") };
        });
      }
      S.txFiles = {};
      for (const acct of subfoldersIn("Transactions")) {
        for (const f of acct.children) {
          if (!(f instanceof TFile) || f.extension !== "md" || !/^\d{4}-\d{2}$/.test(f.basename))
            continue;
          const month = f.basename;
          const text = await vault.cachedRead(f);
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
        }
      }
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
      for (const f of mdFilesIn("Tax")) {
        if (!/^\d{4}$/.test(f.basename))
          continue;
        const text = await vault.cachedRead(f);
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
        S.tax[f.basename] = {
          fmRaw: raw,
          taxpayer_type: ["provisional", "standard"].includes(fm.taxpayer_type) ? fm.taxpayer_type : "unknown",
          assessment: ["auto-assessed", "submit-requested"].includes(fm.assessment) ? fm.assessment : "unknown",
          deadline_standard: fm.deadline_standard || "",
          deadline_provisional: fm.deadline_provisional || "",
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
          }))
        };
      }
      if (!S.taxYear || !S.tax[S.taxYear])
        S.taxYear = Object.keys(S.tax).sort().pop() || null;
      if (!S.period)
        S.period = currentPeriod();
    }
    Object.assign(ctx, { loadVault });
  };
});

// src/categories.js
var require_categories = __commonJS((exports2, module2) => {
  var { el, parseFrontmatter } = require_util();
  var { TYPE_ORDER } = require_constants();
  var { askFields, confirmModal } = require_modal();
  module2.exports = function registerCategories(ctx) {
    const { S, app, vault, toast, writeFile, fileAt, mdFilesIn } = ctx;
    let catsVersion = 1;
    function fillCatOptions(sel, current) {
      sel.innerHTML = "";
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
      const safe = realName.replace(/[\\/:*?"<>|]/g, "-").trim();
      const nameLine = safe !== realName ? `name: "${realName}"
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
    function catSelect(current, onchange) {
      const sel = el("select", { class: "category-select" });
      fillCatOptions(sel, current);
      let builtVersion = catsVersion;
      refreshOnOpen(sel, () => builtVersion, (v) => builtVersion = v);
      wireCatChange(sel, current, onchange);
      return sel;
    }
    function lazyCatSelect(current, onchange) {
      const sel = el("select", { class: "category-select" });
      sel.append(el("option", { value: current, selected: "" }, current || "— none —"));
      let builtVersion = 0;
      refreshOnOpen(sel, () => builtVersion, (v) => builtVersion = v);
      wireCatChange(sel, current, onchange);
      return sel;
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
      const safe = name.replace(/[\\/:*?"<>|]/g, "-").trim();
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
    Object.assign(ctx, { fillCatOptions, promptCreateCategory, promptDeleteCategory, catSelect, lazyCatSelect });
  };
});

// src/views/dashboard.js
var require_dashboard = __commonJS((exports2, module2) => {
  var { el } = require_util();
  var { TYPE_ORDER, MONTHS } = require_constants();
  module2.exports = function registerDashboard(ctx) {
    const { S, $, root, money, periodSummary, budgetTotals, periodTitle, periodMonthName, shiftPeriod, catType } = ctx;
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
      hero.innerHTML = "";
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
      t.innerHTML = "";
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
      wrap.innerHTML = "";
      const periods = [];
      for (let i = 5;i >= 0; i--)
        periods.push(shiftPeriod(S.period, -i));
      const data = periods.map((p) => ({
        p,
        spent: periodSummary(p).spend,
        budget: budgetTotals(p).spend,
        label: `${MONTHS[parseInt(p.slice(5), 10) - 1]} ${p.slice(2, 4)}`
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
    Object.assign(ctx, { renderDashboard, renderTrend });
  };
});

// src/views/transactions.js
var require_transactions = __commonJS((exports2, module2) => {
  var { el, escMd, patchFrontmatter } = require_util();
  module2.exports = function registerTransactions(ctx) {
    const { S, $, money, toast, writeFile, periodTitle, periodMonthName, txInPeriod, lazyCatSelect } = ctx;
    function renderTransactions() {
      $("#txSubNote").textContent = $("#txWholeHistory").checked ? "Whole history" : `${periodMonthName(S.period)} · ${periodTitle(S.period)}`;
      const accSel = $("#txAccount");
      const labels = [...new Set(Object.values(S.txFiles).map((f) => f.label))].sort();
      if (accSel.options.length !== labels.length + 1) {
        accSel.innerHTML = '<option value="">All accounts</option>';
        for (const l of labels)
          accSel.append(el("option", { value: l }, l));
      }
      const catSel = $("#txCategory");
      if (catSel.options.length !== S.categories.length + 2) {
        catSel.innerHTML = '<option value="">All categories</option><option value="__none__">Uncategorised</option>';
        for (const c of S.categories)
          catSel.append(el("option", { value: c.name }, c.name));
      }
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
      list = list.filter((t2) => (!acc || t2.label === acc) && (!cat || (cat === "__none__" ? !t2.cat : t2.cat === cat)) && (!q || t2.desc.toLowerCase().includes(q)));
      if (list.length > 800)
        list = list.slice(0, 800);
      $("#txCount").textContent = `${list.length} rows`;
      const t = $("#txTable");
      t.innerHTML = "";
      t.append(el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Date"), el("th", { scope: "col" }, "Description"), el("th", { scope: "col" }, "Account"), el("th", { scope: "col" }, "Category"), el("th", { scope: "col", class: "num" }, "Amount"), el("th", { scope: "col" }, "Excl."), el("th", { scope: "col" }, "Note"))));
      const body = el("tbody", {});
      for (const item of list) {
        const r = item._row;
        const mark = () => {
          item._file.dirty = true;
          $("#txSave").disabled = false;
        };
        body.append(el("tr", {}, el("td", { class: "text-muted", style: "white-space:nowrap" }, r.date), el("td", {}, r.desc), el("td", { class: "text-muted" }, item.label), el("td", {}, lazyCatSelect(r.cat, (v) => {
          r.cat = v;
          mark();
        })), el("td", { class: `num${r.amount >= 0 ? " text-success" : ""}`, style: "white-space:nowrap;font-weight:600" }, money(r.amount)), el("td", {}, el("input", { type: "checkbox", ...r.excluded ? { checked: "" } : {}, onchange: (e) => {
          r.excluded = e.target.checked;
          mark();
        } })), el("td", {}, el("input", { type: "text", class: "form-control form-control-sm", value: r.note, style: "width:130px", onchange: (e) => {
          r.note = e.target.value;
          mark();
        } }))));
      }
      if (!list.length)
        body.append(el("tr", {}, el("td", { colspan: "7", class: "text-muted" }, "No transactions match.")));
      t.append(body);
    }
    function serializeTxFile(f) {
      const fm = patchFrontmatter(f.fmRaw || "", { account: `"${f.label}"`, month: f.month });
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
    async function saveTransactions() {
      let n = 0;
      for (const f of Object.values(S.txFiles)) {
        if (!f.dirty)
          continue;
        await writeFile(`Transactions/${f.label}/${f.month}.md`, serializeTxFile(f));
        f.dirty = false;
        n++;
      }
      $("#txSave").disabled = true;
      toast(`Saved ${n} file${n === 1 ? "" : "s"}`);
    }
    Object.assign(ctx, { renderTransactions, serializeTxFile, saveTransactions });
  };
});

// src/views/budgets.js
var require_budgets = __commonJS((exports2, module2) => {
  var { el, escMd, icoEl, patchFrontmatter } = require_util();
  var { TYPE_ORDER } = require_constants();
  module2.exports = function registerBudgets(ctx) {
    const { S, $, money, toast, typeBadge, writeFile, periodTitle, periodMonthName, periodSummary, shiftPeriod, promptCreateCategory, promptDeleteCategory } = ctx;
    let budDraft = null, budDraftPeriod = null;
    function budgetDraft() {
      if (budDraftPeriod !== S.period || !budDraft) {
        budDraft = (S.budgets[S.period] || []).map((r) => ({ ...r, inFile: true }));
        const have = new Set(budDraft.map((d) => d.category));
        for (const c of S.categories) {
          if (!have.has(c.name))
            budDraft.push({ category: c.name, type: c.type, amount: 0, notes: "", inFile: false });
        }
        budDraftPeriod = S.period;
        $("#budSave").disabled = true;
      }
      return budDraft;
    }
    function invalidateBudgetDraft() {
      budDraft = null;
      budDraftPeriod = null;
    }
    function budgetDirty() {
      const b = $("#budSave");
      return !!b && !b.disabled;
    }
    function renderBudgets() {
      $("#budPeriodLabel").textContent = `${periodMonthName(S.period)} · ${periodTitle(S.period)}`;
      const draft = budgetDraft();
      const sum = periodSummary(S.period);
      const t = $("#budTable");
      t.innerHTML = "";
      t.append(el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Category"), el("th", { scope: "col" }, "Type"), el("th", { scope: "col", class: "num" }, "Amount"), el("th", { scope: "col", class: "num" }, "Actual so far"), el("th", { scope: "col" }, "Notes"), el("th", { scope: "col" }, ""))));
      const body = el("tbody", {});
      const mark = () => $("#budSave").disabled = false;
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
        body.append(el("tr", {}, el("td", {}, d.category), el("td", {}, typeBadge(d.type)), el("td", { class: "num" }, el("div", { class: "bud-amt-wrap" }, el("input", { type: "number", step: "0.01", class: "form-control form-control-sm", value: d.amount || "", onchange: (e) => {
          d.amount = parseFloat(e.target.value) || 0;
          d.amountRaw = null;
          mark();
          updateRemaining();
        } }), remainingEl)), el("td", { class: `num${overActual ? " text-danger" : " text-muted"}`, style: "white-space:nowrap" }, money(actual)), el("td", {}, el("input", { type: "text", class: "form-control form-control-sm", value: d.notes, style: "width:230px", onchange: (e) => {
          d.notes = e.target.value;
          mark();
        } })), el("td", { style: "white-space:nowrap" }, d.inFile ? el("button", { class: "btn-ghost", style: "padding:0.2rem 0.6rem;font-size:0.78rem", "aria-label": `Clear budget for ${d.category}`, title: "Clear this category from the period file", onclick: () => {
          d.amount = 0;
          d.amountRaw = null;
          d.notes = "";
          d.inFile = false;
          mark();
          renderBudgets();
        } }, "✕") : "", el("button", { class: "btn-ghost", style: "padding:0.2rem 0.6rem;font-size:0.78rem", "aria-label": `Delete category ${d.category}`, title: "Delete this category everywhere", onclick: async () => {
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
    }
    async function saveBudget() {
      const draft = budgetDraft().filter((d) => d.category && (d.inFile || d.amount || d.notes && d.notes.trim()));
      for (const d of draft)
        d.inFile = true;
      S.budgets[S.period] = draft.map((d) => ({ ...d }));
      const [y, m] = S.period.split("-");
      const n = S.settings.month_start_day;
      const meta = S.budgetMeta[S.period];
      const fm = patchFrontmatter(meta && meta.raw || "", { period: S.period });
      const lines = [
        "---",
        fm,
        "---",
        "",
        `# Budget — ${S.period}`,
        "",
        "With `month_start_day: " + n + "`, this period runs from the " + n + "rd of the previous month to the " + (n - 1) + "nd of this month.",
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
      await writeFile(`Budgets/${y}-${m}.md`, lines.join(`
`));
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
    Object.assign(ctx, { renderBudgets, saveBudget, copyPreviousBudget, addNewCategory, invalidateBudgetDraft, budgetDirty });
  };
});

// src/views/accounts.js
var require_accounts = __commonJS((exports2, module2) => {
  var { el, patchFrontmatter } = require_util();
  var { askFields } = require_modal();
  module2.exports = function registerAccounts(ctx) {
    const { S, $, app, money, toast, writeFile } = ctx;
    const ACCT_GROUPS = [
      ["Bank accounts", ["checking", "credit_card", "cash"]],
      ["Savings", ["savings"]],
      ["Investments", ["investment"]]
    ];
    function renderAccounts() {
      const wrap = $("#acctSections");
      wrap.innerHTML = "";
      for (const [title, types] of ACCT_GROUPS) {
        const accounts = S.accounts.filter((a) => types.includes(a.type));
        if (!accounts.length)
          continue;
        const grid = el("div", { class: "mini-grid" });
        const total = accounts.reduce((a, b) => a + b.balance, 0);
        for (const a of accounts) {
          const v = el("button", { type: "button", class: `v num${a.balance < 0 ? " text-danger" : ""}`, "aria-label": `Balance for ${a.name}, ${money(a.balance)} — click to update` }, money(a.balance));
          v.addEventListener("click", async () => {
            const r = await askFields(app, `Update balance — ${a.name}`, [
              { key: "balance", label: "New balance", type: "number", value: a.balance.toFixed(2) }
            ]);
            if (!r)
              return;
            const num = parseFloat(String(r.balance).replace(",", ".").replace(/[^\d.-]/g, ""));
            if (isNaN(num))
              return toast("Not a number", true);
            a.balance = num;
            a.balance_updated = new Date().toISOString().slice(0, 10);
            await saveAccount(a);
            renderAccounts();
            toast(`${a.name} balance updated`);
          });
          grid.append(el("div", { class: "mini" }, el("div", { class: "l" }, a.name), v, el("div", { class: "s" }, [a.type.replace("_", " "), a.institution].filter(Boolean).join(" · "), a.credit_limit ? ` · limit ${money(a.credit_limit, 0)}` : "", a.monthly_contribution ? ` · ${money(a.monthly_contribution, 0)}/m` : ""), el("div", { class: "s2" }, a.balance_updated ? `updated ${a.balance_updated}` : "")));
        }
        wrap.append(el("div", { class: "card mb-4" }, el("div", { class: "card-h" }, el("div", {}, el("h2", {}, title), el("div", { class: "sub" }, `${accounts.length} accounts`)), el("div", { class: "legend" }, el("span", {}, el("b", { class: "num", style: "font-size:15px;color:var(--text-primary)" }, money(total))))), el("div", { class: "body-pad" }, grid)));
      }
    }
    async function saveAccount(a) {
      if (a.fmRaw) {
        const fm = patchFrontmatter(a.fmRaw, {
          balance: a.balance.toFixed(2),
          balance_updated: a.balance_updated || null
        });
        await writeFile(`Accounts/${a.name}.md`, `---
${fm}
---` + (a.body || `

# ${a.name}
`));
        return;
      }
      const lines = ["---", `type: ${a.type}`];
      if (a.institution)
        lines.push(`institution: ${a.institution}`);
      if (a.account_number)
        lines.push(`account_number: "${a.account_number}"`);
      lines.push(`balance: ${a.balance.toFixed(2)}`);
      if (a.balance_updated)
        lines.push(`balance_updated: ${a.balance_updated}`);
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
        lines.push(`tx_label: "${a.tx_label}"`);
      if (a.tags)
        lines.push(`tags: ${a.tags}`);
      lines.push("---");
      await writeFile(`Accounts/${a.name}.md`, lines.join(`
`) + (a.body || `

# ${a.name}
`));
    }
    Object.assign(ctx, { renderAccounts, saveAccount });
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
      kpis.innerHTML = "";
      const tile = (l, v, cls) => kpis.append(el("div", { class: "mini" }, el("div", { class: "l" }, l), el("div", { class: `v num ${cls || ""}` }, v)));
      tile("Net worth", money(netWorth), netWorth >= 0 ? "grad-txt" : "text-danger");
      tile("Savings", money(totalSavings));
      tile("Investments", money(totalInvest));
      tile("Credit debt", money(creditDebt), "text-danger");
      const withGoals = S.accounts.filter((a) => a.goal_amount);
      const goalsWrap = $("#savingsGoals");
      goalsWrap.innerHTML = "";
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
      wrap.innerHTML = "";
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
          if (a.total_invested) {
            const growth = a.balance - a.total_invested;
            card.append(el("div", { class: `s2 num ${growth >= 0 ? "text-success" : "text-danger"}` }, `${growth >= 0 ? "▲" : "▼"} ${money(Math.abs(growth), 0)} vs ${money(a.total_invested, 0)} in`));
          } else if (a.inception_date) {
            card.append(el("div", { class: "s2" }, `since ${a.inception_date}`));
          }
          grid.append(card);
        }
        wrap.append(el("div", { class: "card mb-4" }, el("div", { class: "card-h" }, el("div", {}, el("h2", {}, title), el("div", { class: "sub" }, `${list.length} accounts`)), el("div", { class: "legend" }, el("span", {}, el("b", { class: "num", style: "font-size:15px;color:var(--text-primary)" }, money(total))))), el("div", { class: "body-pad" }, grid)));
      }
    }
    Object.assign(ctx, { renderSavings });
  };
});

// src/views/owed.js
var require_owed = __commonJS((exports2, module2) => {
  var { el, escMd, icoEl } = require_util();
  var { askFields } = require_modal();
  module2.exports = function registerOwed(ctx) {
    const { S, $, app, money, toast, writeFile } = ctx;
    function renderOwed() {
      const outstanding = S.owed.filter((o) => o.status !== "paid").reduce((s, o) => s + o.amount, 0);
      const paid = S.owed.filter((o) => o.status === "paid").reduce((s, o) => s + o.amount, 0);
      const kpis = $("#owedKpis");
      kpis.innerHTML = "";
      const tile = (l, v, cls) => kpis.append(el("div", { class: "mini" }, el("div", { class: "l" }, l), el("div", { class: `v num ${cls || ""}` }, v)));
      tile("Outstanding", money(outstanding), outstanding > 0 ? "text-warning" : "");
      tile("Paid", money(paid), "text-success");
      tile("Entries", String(S.owed.length));
      const mark = () => {
        S.owedDirty = true;
        $("#owedSave").disabled = false;
      };
      const t = $("#owedTable");
      t.innerHTML = "";
      t.append(el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Person"), el("th", { scope: "col" }, "Description"), el("th", { scope: "col", class: "num" }, "Amount"), el("th", { scope: "col" }, "Due date"), el("th", { scope: "col" }, "Status"), el("th", { scope: "col" }, ""))));
      const body = el("tbody", {});
      for (const o of S.owed) {
        const pill = el("button", { class: `status-pill status-${o.status}` }, icoEl(o.status === "paid" ? ["circle-check", "check-circle"] : ["hourglass"]), o.status === "paid" ? "Paid" : "Outstanding");
        pill.addEventListener("click", () => {
          o.status = o.status === "paid" ? "outstanding" : "paid";
          mark();
          renderOwed();
        });
        body.append(el("tr", {}, el("td", { style: "font-weight:600" }, o.person), el("td", {}, el("input", {
          type: "text",
          class: "form-control form-control-sm",
          value: o.description,
          style: "width:220px",
          onchange: (e) => {
            o.description = e.target.value;
            mark();
          }
        })), el("td", { class: "num" }, el("input", {
          type: "number",
          step: "0.01",
          class: "form-control form-control-sm",
          value: o.amount || "",
          onchange: (e) => {
            o.amount = parseFloat(e.target.value) || 0;
            mark();
            renderOwed();
          }
        })), el("td", {}, el("input", {
          type: "text",
          class: "form-control form-control-sm",
          value: o.due,
          placeholder: "YYYY-MM-DD",
          style: "width:120px",
          onchange: (e) => {
            o.due = e.target.value.trim();
            mark();
          }
        })), el("td", {}, pill), el("td", {}, el("button", {
          class: "btn-ghost",
          style: "padding:0.2rem 0.6rem;font-size:0.78rem",
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
    Object.assign(ctx, { renderOwed, saveOwed, addOwed });
  };
});

// src/views/services.js
var require_services = __commonJS((exports2, module2) => {
  var { el, escMd } = require_util();
  var { askFields } = require_modal();
  module2.exports = function registerServices(ctx) {
    const { S, $, app, money, toast, writeFile } = ctx;
    function monthlyEquiv(s) {
      return s.cycle === "annual" ? s.amount / 12 : s.amount;
    }
    function renderServices() {
      const active = S.services.filter((s) => s.active);
      const perMonth = active.reduce((sum, s) => sum + monthlyEquiv(s), 0);
      const kpis = $("#servicesKpis");
      kpis.innerHTML = "";
      const tile = (l, v) => kpis.append(el("div", { class: "mini" }, el("div", { class: "l" }, l), el("div", { class: "v num" }, v)));
      tile("Per month", money(perMonth));
      tile("Per year", money(perMonth * 12));
      tile("Active", String(active.length));
      tile("Total services", String(S.services.length));
      const mark = () => {
        S.servicesDirty = true;
        $("#svcSave").disabled = false;
      };
      const t = $("#svcTable");
      t.innerHTML = "";
      t.append(el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Service"), el("th", { scope: "col" }, "Provider"), el("th", { scope: "col", class: "num" }, "Amount"), el("th", { scope: "col" }, "Cycle"), el("th", { scope: "col" }, "Next billing"), el("th", { scope: "col" }, "Active"), el("th", { scope: "col" }, ""))));
      const body = el("tbody", {});
      const groups = Object.create(null);
      for (const s of S.services)
        (groups[s.category || "Uncategorised"] ??= []).push(s);
      for (const cat of Object.keys(groups).sort()) {
        const gMonthly = groups[cat].filter((s) => s.active).reduce((sum, s) => sum + monthlyEquiv(s), 0);
        body.append(el("tr", { class: "type-row" }, el("td", { colspan: "6" }, cat), el("td", { class: "num" }, `${money(gMonthly, 0)}/mo`)));
        for (const s of groups[cat]) {
          body.append(el("tr", { class: s.active ? "" : "svc-inactive" }, el("td", { style: "font-weight:600" }, s.name), el("td", { class: "text-muted" }, s.provider), el("td", { class: "num" }, el("input", {
            type: "number",
            step: "0.01",
            class: "form-control form-control-sm",
            value: s.amount || "",
            onchange: (e) => {
              s.amount = parseFloat(e.target.value) || 0;
              mark();
              renderServices();
            }
          })), el("td", { class: "text-muted" }, s.cycle), el("td", { class: "text-muted" }, s.next || "—"), el("td", {}, el("input", {
            type: "checkbox",
            ...s.active ? { checked: "" } : {},
            onchange: (e) => {
              s.active = e.target.checked;
              mark();
              renderServices();
            }
          })), el("td", {}, el("button", {
            class: "btn-ghost",
            style: "padding:0.2rem 0.6rem;font-size:0.78rem",
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
        { key: "amount", label: "Monthly amount", type: "number", value: "0" },
        { key: "category", label: "Budget category", type: "select", options: ["", ...S.categories.map((c) => c.name)], value: "" }
      ]);
      if (!r || !r.name.trim())
        return;
      const amount = parseFloat(String(r.amount).replace(",", "."));
      if (isNaN(amount))
        return toast("Not a number", true);
      S.services.push({ name: r.name.trim(), provider: (r.provider || "").trim(), amount, cycle: "monthly", next: "", category: (r.category || "").trim(), active: true, notes: "" });
      S.servicesDirty = true;
      $("#svcSave").disabled = false;
      renderServices();
    }
    Object.assign(ctx, { renderServices, saveServices, addService });
  };
});

// src/views/tax.js
var require_tax = __commonJS((exports2, module2) => {
  var { el, escMd, icoEl, safeSeg, patchFrontmatter } = require_util();
  var { askFields, confirmModal } = require_modal();
  module2.exports = function registerTax(ctx) {
    const { S, $, app, toast, writeFile, writeBinary, fileAt, locale } = ctx;
    function currentTaxYear() {
      return locale().currentTaxYear(new Date);
    }
    const T = () => S.tax[S.taxYear];
    const mark = () => {
      S.taxDirty = true;
      $("#taxSave").disabled = false;
    };
    function renderTax() {
      const loc = locale();
      const years = Object.keys(S.tax).sort();
      $("#taxEmptyCard").classList.toggle("hidden", years.length > 0);
      $("#taxContent").classList.toggle("hidden", !years.length);
      if (!years.length) {
        $("#taxEmptyIntro").textContent = loc.taxIntro;
        $("#taxStart").textContent = `Start tracking the ${currentTaxYear()} tax year`;
        return;
      }
      const t = T();
      $("#taxSubNote").innerHTML = "";
      $("#taxSubNote").append(`Tax year ${S.taxYear} (${loc.yearSpan(+S.taxYear)}) · saved to `, el("code", {}, `Tax/${S.taxYear}.md`));
      const sel = $("#taxYearSel");
      sel.innerHTML = "";
      for (const y of years)
        sel.append(el("option", { value: y, ...y === S.taxYear ? { selected: "" } : {} }, y));
      renderTaxKpis(t);
      renderSeason(t);
      renderSteps(t);
      renderDocs(t);
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
      kpis.innerHTML = "";
      const tile = (l, v, cls) => kpis.append(el("div", { class: "mini" }, el("div", { class: "l" }, l), el("div", { class: `v num ${cls || ""}` }, v)));
      const d = daysTo(activeDeadline(t));
      tile("Deadline", d === null ? "—" : d < 0 ? `${-d} d overdue` : `${d} days`, d !== null && d < 0 ? "text-danger" : d !== null && d <= 30 ? "text-warning" : "");
      const steps = t.steps.filter((s) => s.status !== "n/a");
      tile("Steps done", `${steps.filter((s) => s.status === "done").length} / ${steps.length}`);
      const docs = t.docs.filter((x) => x.status !== "n/a");
      const ready = docs.filter((x) => x.status === "uploaded").length;
      tile("Documents in", `${ready} / ${docs.length}`, ready === docs.length && docs.length ? "text-success" : "");
      const typeLabel = (locale().taxpayerTypes.find(([v]) => v === t.taxpayer_type) || [])[1];
      tile("Taxpayer", typeLabel || "Unknown");
    }
    function renderSeason(t) {
      const loc = locale();
      const b = $("#taxSeasonBody");
      b.innerHTML = "";
      const field = (label, control) => el("label", { class: "tax-field" }, el("span", { class: "l" }, label), control);
      b.append(el("div", { class: "row tax-season-row" }, field("Taxpayer type", el("select", {
        class: "form-select form-select-sm",
        onchange: (e) => {
          t.taxpayer_type = e.target.value;
          mark();
          renderTax();
        }
      }, ...loc.taxpayerTypes.map(([v, l]) => el("option", { value: v, ...t.taxpayer_type === v ? { selected: "" } : {} }, l)))), field("Assessment", el("select", {
        class: "form-select form-select-sm",
        onchange: (e) => {
          t.assessment = e.target.value;
          mark();
          renderTax();
        }
      }, ...loc.assessments.map(([v, l]) => el("option", { value: v, ...t.assessment === v ? { selected: "" } : {} }, l)))), field(loc.deadlineLabels[0], el("input", {
        type: "text",
        class: "form-control form-control-sm",
        value: t.deadline_standard,
        placeholder: "YYYY-MM-DD",
        onchange: (e) => {
          t.deadline_standard = e.target.value.trim();
          mark();
          renderTax();
        }
      })), field(loc.deadlineLabels[1], el("input", {
        type: "text",
        class: "form-control form-control-sm",
        value: t.deadline_provisional,
        placeholder: "YYYY-MM-DD",
        onchange: (e) => {
          t.deadline_provisional = e.target.value.trim();
          mark();
          renderTax();
        }
      }))));
      b.append(el("p", { class: "tax-season-msg" }, loc.seasonMsgs(t).join(" ")));
      b.append(el("p", { class: "text-muted", style: "font-size:12.5px;margin:0" }, loc.safetyNote));
    }
    const STEP_CYCLE = { todo: "busy", busy: "done", done: "n/a", "n/a": "todo" };
    const STEP_LABEL = { todo: "To do", busy: "Busy", done: "Done", "n/a": "N/A" };
    const STEP_ICO = { todo: ["circle"], busy: ["hourglass"], done: ["circle-check", "check-circle"], "n/a": ["circle-slash", "slash"] };
    function renderSteps(t) {
      const tbl = $("#taxStepsTable");
      tbl.innerHTML = "";
      tbl.append(el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Step"), el("th", { scope: "col" }, "Status"), el("th", { scope: "col" }, "Due"), el("th", { scope: "col" }, "Notes"), el("th", { scope: "col" }, ""))));
      const body = el("tbody", {});
      for (const s of t.steps) {
        const overdue = s.status !== "done" && s.status !== "n/a" && daysTo(s.due) !== null && daysTo(s.due) < 0;
        const pill = el("button", {
          class: `status-pill tax-${s.status.replace("/", "")}`,
          "aria-label": `Status: ${STEP_LABEL[s.status]} — click to change`
        }, icoEl(STEP_ICO[s.status]), STEP_LABEL[s.status]);
        pill.addEventListener("click", () => {
          s.status = STEP_CYCLE[s.status];
          mark();
          renderTax();
        });
        body.append(el("tr", { class: s.status === "n/a" ? "svc-inactive" : "" }, el("td", { style: "font-weight:600" }, s.step), el("td", {}, pill), el("td", {}, el("input", {
          type: "text",
          class: `form-control form-control-sm ${overdue ? "tax-overdue" : ""}`,
          value: s.due,
          placeholder: "YYYY-MM-DD",
          style: "width:120px",
          onchange: (e) => {
            s.due = e.target.value.trim();
            mark();
            renderTax();
          }
        })), el("td", {}, el("input", {
          type: "text",
          class: "form-control form-control-sm",
          value: s.notes,
          style: "min-width:220px",
          onchange: (e) => {
            s.notes = e.target.value;
            mark();
          }
        })), el("td", {}, el("button", {
          class: "btn-ghost",
          style: "padding:0.2rem 0.6rem;font-size:0.78rem",
          "aria-label": `Remove step ${s.step}`,
          onclick: () => {
            t.steps.splice(t.steps.indexOf(s), 1);
            mark();
            renderTax();
          }
        }, "✕"))));
      }
      if (!t.steps.length)
        body.append(el("tr", {}, el("td", { colspan: "5", class: "text-muted" }, "No steps yet.")));
      tbl.append(body);
    }
    const DOC_CYCLE = { needed: "n/a", uploaded: "needed", "n/a": "needed" };
    const DOC_LABEL = { needed: "Needed", uploaded: "Uploaded", "n/a": "N/A" };
    const DOC_ICO = { needed: ["hourglass"], uploaded: ["circle-check", "check-circle"], "n/a": ["circle-slash", "slash"] };
    function renderDocs(t) {
      $("#taxDocsSub").innerHTML = "";
      $("#taxDocsSub").append("Certificates & records for the return · files stored in ", el("code", {}, `Tax/${S.taxYear}/`));
      const tbl = $("#taxDocsTable");
      tbl.innerHTML = "";
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
          renderTax();
        });
        let fileCell;
        if (d.file) {
          fileCell = el("button", { class: "btn-ghost tax-doc-link", "aria-label": `Open ${d.file}` }, icoEl(["paperclip"]), d.file);
          fileCell.addEventListener("click", () => openDoc(d.file));
        } else {
          fileCell = el("button", {
            class: "btn-ghost",
            style: "padding:0.2rem 0.6rem;font-size:0.78rem",
            "aria-label": `Upload file for ${d.name}`
          }, icoEl(["cloud-upload", "upload-cloud"]), " Upload");
          fileCell.addEventListener("click", () => {
            pendingDocTarget = d;
            $("#taxFileInput").click();
          });
        }
        body.append(el("tr", { class: d.status === "n/a" ? "svc-inactive" : "" }, el("td", { style: "font-weight:600" }, d.name), el("td", { class: "text-muted" }, d.source), el("td", {}, pill), el("td", {}, fileCell), el("td", {}, el("input", {
          type: "text",
          class: "form-control form-control-sm",
          value: d.notes,
          style: "min-width:180px",
          onchange: (e) => {
            d.notes = e.target.value;
            mark();
          }
        })), el("td", {}, el("button", {
          class: "btn-ghost",
          style: "padding:0.2rem 0.6rem;font-size:0.78rem",
          "aria-label": `Remove document ${d.name}`,
          onclick: async () => {
            const go = !d.file || await confirmModal(app, {
              title: "Remove document row",
              message: `Remove "${d.name}" from the list? The uploaded file ${d.file} stays in Tax/${S.taxYear}/ — delete it from the vault yourself if you want it gone.`,
              confirmText: "Remove row"
            });
            if (!go)
              return;
            t.docs.splice(t.docs.indexOf(d), 1);
            mark();
            renderTax();
          }
        }, "✕"))));
      }
      if (!t.docs.length)
        body.append(el("tr", {}, el("td", { colspan: "6", class: "text-muted" }, "No documents yet.")));
      tbl.append(body);
    }
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
      if (!target) {
        const NEW = "＋ New document row";
        const open = t.docs.filter((d) => !d.file).map((d) => `${d.name} — ${d.source}`);
        const r = await askFields(app, `Attach "${file.name}"`, [
          { key: "to", label: "Attach to", type: "select", options: [...open, NEW], value: open[0] ?? NEW }
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
        } else {
          target = t.docs.filter((d) => !d.file)[open.indexOf(r.to)];
        }
      }
      let name = safeSeg(file.name) || "document";
      if (fileAt(`Tax/${S.taxYear}/${name}`)) {
        const dot = name.lastIndexOf(".");
        const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
        let i = 2;
        while (fileAt(`Tax/${S.taxYear}/${stem} (${i})${ext}`))
          i++;
        name = `${stem} (${i})${ext}`;
      }
      try {
        await writeBinary(`Tax/${S.taxYear}/${name}`, await file.arrayBuffer());
      } catch (e) {
        return toast(e.message || String(e), true);
      }
      target.file = name;
      target.status = "uploaded";
      await saveTax();
      toast(`Uploaded ${name}`);
    }
    function serializeTax(year) {
      const t = S.tax[year];
      const fm = patchFrontmatter(t.fmRaw || "", {
        kind: "tax",
        tax_year: year,
        taxpayer_type: t.taxpayer_type,
        assessment: t.assessment,
        deadline_standard: t.deadline_standard || null,
        deadline_provisional: t.deadline_provisional || null
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
    function seedTaxYear(year) {
      const loc = locale();
      S.tax[String(year)] = {
        fmRaw: "",
        taxpayer_type: loc.defaultTaxpayerType,
        assessment: loc.defaultAssessment,
        ...loc.seedDeadlines(year),
        steps: loc.seedSteps(year).map((s) => ({ status: "todo", due: "", notes: "", ...s })),
        docs: loc.seedDocs().map((d) => ({ status: "needed", file: "", notes: "", ...d }))
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
      if (S.tax[String(year)]) {
        S.taxYear = String(year);
        return renderTax();
      }
      seedTaxYear(year);
      S.taxYear = String(year);
      await saveTax();
      renderTax();
    }
    async function changeTaxYear(year) {
      if (S.taxDirty) {
        const go = await confirmModal(app, {
          title: "Unsaved tax changes",
          message: "Switching tax year will discard your unsaved edits. Continue?",
          confirmText: "Discard & switch"
        });
        if (!go) {
          renderTax();
          return;
        }
        await ctx.loadVault();
        $("#taxSave").disabled = true;
      }
      S.taxYear = year;
      renderTax();
    }
    Object.assign(ctx, { renderTax, saveTax, addTaxStep, addTaxDoc, newTaxYear, startTax, changeTaxYear, handleTaxFile });
  };
});

// src/views/import.js
var require_import = __commonJS((exports2, module2) => {
  var { el, parseCsv, parseStatementDate, normalizeAmount, safeSeg } = require_util();
  var DATE_COLS = ["value date", "date", "transaction date", "posting date", "trans date"];
  var DESC_COLS = ["description", "title", "narrative", "details", "transaction description", "reference", "payee", "memo"];
  var AMOUNT_COLS = ["amount", "transaction amount", "amount (zar)", "value"];
  var DEBIT_COLS = ["debit", "debits", "debit amount", "money out", "amount out", "withdrawal", "withdrawals", "paid out"];
  var CREDIT_COLS = ["credit", "credits", "credit amount", "money in", "amount in", "deposit", "deposits", "paid in"];
  module2.exports = function registerImport(ctx) {
    const { S, $, money, toast, writeFile, currentPeriod, periodRange, periodTitle, lazyCatSelect, serializeTxFile, locale } = ctx;
    function renderImport() {
      const loc = locale();
      $("#importSubNote").textContent = loc.banks ? `Bank statement exports — ${loc.banks} — or your own CSV` : "Bank statement CSV exports — or any CSV with Date / Description / Amount columns";
      if (loc.importHint)
        $("#importDropHint").textContent = loc.importHint;
    }
    function autoCategorise(desc) {
      const d = desc.trim().toLowerCase();
      let best = "", bestLen = 0;
      for (const r of S.rules) {
        const p = r.pattern.trim().toLowerCase();
        if (!p)
          continue;
        if (p === d)
          return r.category;
        if (d.includes(p) && p.length > bestLen) {
          best = r.category;
          bestLen = p.length;
        }
      }
      return best;
    }
    function dedupSet() {
      const set = new Set;
      for (const f of Object.values(S.txFiles)) {
        for (const r of f.rows)
          set.add(`${r.date}|${r.desc.trim().toLowerCase()}|${r.amount.toFixed(2)}|${f.label.trim().toLowerCase()}`);
      }
      return set;
    }
    function detectAccountLabel(filename) {
      const m = filename.match(/^[A-Za-z][A-Za-z0-9]*_(\d{4,})(?:_|\.)/) || filename.match(/^(\d{6,})\D/);
      if (m) {
        const acc = S.accounts.find((a) => a.account_number === m[1]);
        if (acc)
          return acc.tx_label || acc.name;
      }
      return "";
    }
    async function handleCsvFile(file) {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length)
        return toast("Empty CSV", true);
      let headerIdx = rows.findIndex((r) => {
        const low2 = r.map((c) => c.trim().toLowerCase());
        const has = (names) => names.some((n) => low2.includes(n));
        return (has(DATE_COLS) || low2.some((c) => c.includes("date"))) && (has(AMOUNT_COLS) || has(DEBIT_COLS) && has(CREDIT_COLS));
      });
      if (headerIdx === -1)
        return toast("Could not find a header row with Date + Amount (or Debit/Credit) columns", true);
      const header = rows[headerIdx].map((c) => c.trim());
      const low = header.map((c) => c.toLowerCase());
      const col = (names) => {
        for (const n of names) {
          const i = low.indexOf(n);
          if (i !== -1)
            return i;
        }
        return -1;
      };
      const iDate = col(DATE_COLS);
      let iDesc = col(DESC_COLS);
      if (iDesc === -1)
        iDesc = low.findIndex((c) => c.includes("desc"));
      const iAmount = col(AMOUNT_COLS);
      const iDebit = col(DEBIT_COLS), iCredit = col(CREDIT_COLS);
      if (iDate === -1 || iDesc === -1 || iAmount === -1 && (iDebit === -1 || iCredit === -1))
        return toast("Missing columns — need Date, Title/Description, and Amount (or Debit + Credit)", true);
      const seen = dedupSet();
      const items = [];
      let skipped = 0;
      const label0 = detectAccountLabel(file.name);
      const dataRows = rows.slice(headerIdx + 1);
      const loc = locale();
      const showBar = dataRows.length > 400;
      if (showBar)
        importProgress("start", "Categorising transactions…");
      const CHUNK = Math.max(250, Math.ceil(dataRows.length / 15));
      for (let i = 0;i < dataRows.length; i++) {
        const r = dataRows[i];
        const rawDate = (r[iDate] || "").trim();
        let desc = (r[iDesc] || "").trim();
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
        if (rawDate && desc && amount != null && amount !== 0) {
          const date = parseStatementDate(rawDate, loc.dayFirst);
          if (!date) {
            skipped++;
          } else {
            items.push({ date, desc, amount: parseFloat(amount.toFixed(2)), cat: autoCategorise(desc), include: true, excluded: false });
          }
        } else if (rawDate || desc) {
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
      S.pendingImport = { items, label: label0, seen, skipped, filename: file.name };
      renderImportReview();
      if (showBar)
        importProgress("done");
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
    function renderImportReview() {
      const p = S.pendingImport;
      if (!p)
        return;
      $("#importReview").classList.remove("hidden");
      const accSel = $("#impAccount");
      accSel.innerHTML = "";
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
      const lab = (p.label || "").trim().toLowerCase();
      let dupes = 0;
      for (const it of p.items) {
        it.dup = p.seen.has(`${it.date}|${it.desc.trim().toLowerCase()}|${it.amount.toFixed(2)}|${lab}`);
        if (it.dup) {
          it.include = false;
          it.autoExcluded = true;
          dupes++;
        } else if (it.autoExcluded) {
          it.include = true;
          it.autoExcluded = false;
        }
      }
      const newOnes = p.items.filter((i) => !i.dup);
      const auto = newOnes.filter((i) => i.cat).length;
      const cur = currentPeriod();
      const curRange = periodRange(cur);
      const inCurrent = (it) => it.date >= curRange.start && it.date <= curRange.end;
      const curCount = p.items.filter(inCurrent).length;
      $("#impStats").textContent = `${p.filename} — ${p.items.length} rows · ${newOnes.length} new · ${dupes} duplicates skipped · ${auto} auto-categorised` + (p.skipped ? ` · ${p.skipped} unparseable` : "");
      $("#impLegend").innerHTML = "";
      $("#impLegend").append(el("span", { class: "imp-legend-swatch" }), el("span", {}, `${curCount} in the current period — ${periodTitle(cur)}`));
      const t = $("#impTable");
      t.innerHTML = "";
      t.append(el("thead", {}, el("tr", {}, el("th", { scope: "col" }, ""), el("th", { scope: "col" }, "Date"), el("th", { scope: "col" }, "Description"), el("th", { scope: "col", class: "num" }, "Amount"), el("th", { scope: "col" }, "Category"), el("th", { scope: "col" }, "Excl."))));
      const body = el("tbody", {});
      for (const it of p.items) {
        const cls = (it.dup ? "imp-dup" : "") + (inCurrent(it) ? " imp-current" : "");
        body.append(el("tr", { class: cls.trim() }, el("td", {}, it.dup ? el("span", { class: "category-badge badge-dup" }, "dup") : el("input", { type: "checkbox", ...it.include ? { checked: "" } : {}, onchange: (e) => it.include = e.target.checked })), el("td", { class: "text-muted", style: "white-space:nowrap" }, it.date), el("td", {}, it.desc), el("td", { class: `num${it.amount >= 0 ? " text-success" : ""}`, style: "white-space:nowrap;font-weight:600" }, money(it.amount)), el("td", {}, it.dup ? it.cat || "" : lazyCatSelect(it.cat, (v) => {
          it.cat = v;
          it.manual = true;
        })), el("td", {}, it.dup ? "" : el("input", { type: "checkbox", onchange: (e) => it.excluded = e.target.checked }))));
      }
      t.append(body);
    }
    async function commitImport() {
      const p = S.pendingImport;
      if (!p || !p.label)
        return toast("Pick an account first", true);
      const label = safeSeg(p.label);
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
          additions.set(key, { month, rows: [] });
        additions.get(key).rows.push({ date: it.date, desc: it.desc, cat: it.cat, amount: it.amount, excluded: it.excluded, note: it.excluded ? "Excluded during import" : "" });
      }
      const TX_FM = "tags: [finance, finance/budget, finance/budget/transactions]";
      for (const [key, { month, rows }] of additions) {
        const existing = S.txFiles[key];
        const fileModel = existing ? { ...existing, rows: existing.rows.concat(rows) } : { label, month, rows, dirty: false, fmRaw: TX_FM };
        await writeFile(`Transactions/${label}/${month}.md`, serializeTxFile(fileModel));
      }
      for (const [key, { month, rows }] of additions) {
        if (!S.txFiles[key])
          S.txFiles[key] = { label, month, rows: [], dirty: false, fmRaw: TX_FM };
        S.txFiles[key].rows.push(...rows);
      }
      const touched = additions;
      let newRules = 0;
      if ($("#impRemember").checked) {
        const have = new Set(S.rules.map((r) => r.pattern.trim().toLowerCase()));
        for (const it of toAdd) {
          if (it.manual && it.cat && !have.has(it.desc.trim().toLowerCase())) {
            S.rules.push({ pattern: it.desc.trim(), category: it.cat });
            have.add(it.desc.trim().toLowerCase());
            newRules++;
          }
        }
        if (newRules) {
          S.rules.sort((a, b) => a.pattern.localeCompare(b.pattern, undefined, { sensitivity: "base" }));
          const csv = `pattern,category
` + S.rules.map((r) => [r.pattern, r.category].map((v) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(",")).join(`
`) + `
`;
          await writeFile("Data/Categorisation Rules.csv", csv);
        }
      }
      S.pendingImport = null;
      $("#importReview").classList.add("hidden");
      toast(`Imported ${toAdd.length} transactions into ${touched.size} file${touched.size === 1 ? "" : "s"}` + (newRules ? `, saved ${newRules} new rules` : ""));
      ctx.switchView("transactions");
    }
    Object.assign(ctx, { handleCsvFile, commitImport, renderImport });
  };
});

// src/controller.js
var require_controller = __commonJS((exports2, module2) => {
  var { Notice } = require("obsidian");
  var { el, setIco } = require_util();
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
  var registerOwed = require_owed();
  var registerServices = require_services();
  var registerTax = require_tax();
  var registerImport = require_import();
  function mountApp(view) {
    const plugin = view.plugin;
    const app = view.app;
    const vault = app.vault;
    const root = view.contentEl;
    root.classList.add("budget-app-root");
    root.innerHTML = SHELL_HTML;
    root.querySelectorAll("span[data-ico]").forEach((sp) => setIco(sp, sp.getAttribute("data-ico").split("|")));
    const $ = (s) => root.querySelector(s);
    const $$ = (s) => root.querySelectorAll(s);
    const S = {
      loaded: false,
      settings: { month_start_day: 23, currency: "R", country: "za" },
      categories: [],
      accounts: [],
      budgets: {},
      budgetMeta: {},
      txFiles: {},
      rules: [],
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
    registerIo(ctx);
    registerPeriod(ctx);
    registerLoad(ctx);
    registerCategories(ctx);
    registerDashboard(ctx);
    registerTransactions(ctx);
    registerBudgets(ctx);
    registerAccounts(ctx);
    registerSavings(ctx);
    registerOwed(ctx);
    registerServices(ctx);
    registerTax(ctx);
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
        owed: ctx.renderOwed,
        services: ctx.renderServices,
        tax: ctx.renderTax,
        import: ctx.renderImport,
        connect: () => {}
      })[S.view]();
    }
    ctx.switchView = switchView;
    ctx.render = render;
    function openDrawer() {
      const d = $("#appDrawer");
      d.classList.add("open");
      d.removeAttribute("inert");
      $("#drawerOverlay").classList.add("open");
      $("#menuBtn").setAttribute("aria-expanded", "true");
      $("#drawerClose").focus();
    }
    function closeDrawer() {
      const d = $("#appDrawer");
      const wasOpen = d.classList.contains("open");
      d.classList.remove("open");
      d.setAttribute("inert", "");
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
    function hasDirty() {
      return Object.values(S.txFiles).some((f) => f.dirty) || $("#budSave") && !$("#budSave").disabled || S.owedDirty || S.servicesDirty || S.taxDirty || !!S.pendingImport;
    }
    async function connectVault() {
      ctx.invalidateBudgetDraft();
      try {
        await ctx.loadVault();
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
        $("#connectPathNote").innerHTML = "";
        $("#connectPathNote").append("Looked in ", el("code", {}, ctx.basePath()), " but found no Categories/ or Transactions/ inside it. Point the plugin at the Budget folder itself.");
        return;
      }
      S.loaded = true;
      applyIdentity();
      $("#view-connect").classList.add("hidden");
      $("#periodPill").classList.remove("hidden");
      switchView(S.view === "connect" ? "dashboard" : S.view);
      toast(`Loaded ${Object.values(S.txFiles).reduce((a, f) => a + f.rows.length, 0)} transactions`);
    }
    let reloadTimer = null;
    const onFsChange = (file) => {
      const path = file?.path || "";
      const bp = ctx.basePath();
      if (path !== bp && !path.startsWith(bp + "/"))
        return;
      if (Date.now() - ctx.lastWriteAt() < 2000)
        return;
      if (hasDirty())
        return;
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(async () => {
        if (hasDirty() || Date.now() - ctx.lastWriteAt() < 2000)
          return;
        await connectVault();
        if (S.loaded)
          toast("Reloaded — files changed in the vault");
      }, 800);
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
    $("#topbarAvatar").addEventListener("click", () => {
      app.setting.open();
      app.setting.openTabById("budget-app");
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
      ctx.invalidateBudgetDraft();
      await ctx.loadVault();
      closeDrawer();
      render();
      toast("Reloaded from disk");
    });
    $("#txSave").addEventListener("click", ctx.saveTransactions);
    for (const id of ["txAccount", "txCategory", "txWholeHistory"])
      $("#" + id).addEventListener("change", ctx.renderTransactions);
    $("#txSearch").addEventListener("input", () => {
      clearTimeout(S._q);
      S._q = setTimeout(ctx.renderTransactions, 200);
    });
    $("#budSave").addEventListener("click", ctx.saveBudget);
    $("#budCopyPrev").addEventListener("click", ctx.copyPreviousBudget);
    $("#budAddCat").addEventListener("click", ctx.addNewCategory);
    $("#owedSave").addEventListener("click", ctx.saveOwed);
    $("#owedAdd").addEventListener("click", ctx.addOwed);
    $("#svcSave").addEventListener("click", ctx.saveServices);
    $("#svcAdd").addEventListener("click", ctx.addService);
    $("#taxSave").addEventListener("click", ctx.saveTax);
    $("#taxAddStep").addEventListener("click", ctx.addTaxStep);
    $("#taxAddDoc").addEventListener("click", ctx.addTaxDoc);
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
        await connectVault();
      },
      reload: async () => {
        if (hasDirty()) {
          new Notice('Budget: unsaved changes — reload skipped. Save (or "Reload from disk" to discard), then retry.', 7000);
          return;
        }
        await connectVault();
      },
      applyTheme,
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
    }
    async onClose() {
      if (this.appCtl && this.appCtl.hasDirty()) {
        new Notice("Budget: the view closed with unsaved changes — they were not written to disk.", 8000);
      }
      this.appCtl = null;
      this.contentEl.empty();
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
      return v.getAbstractFileByPath(normalizePath(folder + "/Settings.md")) instanceof TFile || v.getAbstractFileByPath(normalizePath(folder + "/Categories")) instanceof TFolder;
    }
    async prefillFromSettingsMd() {
      const f = this.app.vault.getAbstractFileByPath(normalizePath(this.data.folder + "/Settings.md"));
      if (!(f instanceof TFile))
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
      new Setting(c).setName("Country").setDesc("Sets the default currency, amount formatting, bank-statement date order and the Tax view's return checklist (SARS, IRS, HMRC, …). You can still override the currency on the next steps.").addDropdown((d) => {
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
` + `- **country** — drives amount formatting, statement date order and the Tax view (za, us, uk, eu, au, ca, other).
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
  var { PluginSettingTab, Setting, normalizePath } = require("obsidian");
  var { DEFAULT_SETTINGS } = require_constants();
  var { OnboardingWizard } = require_onboarding();
  var { PROFILES, COUNTRY_ORDER } = require_locale();

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
      new Setting(containerEl).setName("Budget data").setHeading().setDesc("Stored in Settings.md inside the budget folder, so they apply on every device.");
      const fmSection = containerEl.createDiv();
      this.renderMdSettings(fmSection);
    }
    async renderMdSettings(containerEl) {
      const md = await this.plugin.readBudgetSettingsMd();
      new Setting(containerEl).setName("Name / household").setDesc("Shown in the dashboard greeting and top bar. Leave blank for none.").addText((t) => {
        t.setValue(md.household ?? "");
        t.onChange((v) => {
          clearTimeout(this._hhTimer);
          this._hhTimer = setTimeout(async () => {
            await this.plugin.updateBudgetSettingsMd("household", `"${v.trim().replace(/"/g, "")}"`);
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
            if (!n || n < 1 || n > 28)
              return;
            await this.plugin.updateBudgetSettingsMd("month_start_day", String(n));
            this.plugin.reloadViews();
          }, 800);
        });
      });
      new Setting(containerEl).setName("Country").setDesc("Drives amount formatting, bank-statement date order and the Tax view's checklist (SARS, IRS, HMRC, …). Existing tax years keep their data — only labels and new-year seeds change.").addDropdown((d) => {
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
            await this.plugin.updateBudgetSettingsMd("currency", v.trim());
            this.plugin.reloadViews();
          }, 800);
        });
      });
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
    return v.getAbstractFileByPath(this.settingsMdPath()) instanceof TFile || v.getAbstractFileByPath(normalizePath(this.settings.budgetFolder + "/Categories")) instanceof TFolder;
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
    const f = this.app.vault.getAbstractFileByPath(this.settingsMdPath());
    if (!(f instanceof TFile))
      return {};
    const { fm } = parseFrontmatter(await this.app.vault.cachedRead(f));
    return fm;
  }
  async updateBudgetSettingsMd(key, value) {
    const path = this.settingsMdPath();
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) {
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
