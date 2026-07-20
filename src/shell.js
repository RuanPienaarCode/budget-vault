'use strict';
/* Static view markup — same shell as Budget App.html, minus the folder-picker
   connect screen (replaced by a settings pointer) and the theme toggle (now a
   setting). Icons are lucide slots (span[data-ico]) resolved after mount. */

const SHELL_HTML = `
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
      <span class="brand-logo" aria-hidden="true"></span>
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
          <div class="sub-note" id="taxSubNote">SARS return tracking · saved to <code>Tax/&lt;year&gt;.md</code></div>
        </div>

        <div class="card hidden" id="taxEmptyCard">
          <div class="card-h" style="justify-content:center"><h2>No tax year yet</h2></div>
          <div class="body-pad">
            <p>Track a SARS return season here — progress steps, the documents you need
              (IRP5, IT3(b), medical certificate, …) and the files themselves, stored in the vault.</p>
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
          <div class="sub-note">Bank statement exports — Discovery, FNB, Capitec, Nedbank, Standard Bank, Absa — or your own CSV</div>
        </div>
        <div class="card mb-4">
          <div class="body-pad" style="padding-top:34px">
            <button type="button" class="upload-area" id="drop" aria-controls="fileInput">
              <span class="ico" data-ico="cloud-upload|upload-cloud"></span>
              <span class="ua-line">Drop a bank statement CSV here, or click to choose a file.</span>
              <span class="hint">Discovery filenames like <code>DiscoveryBank_10123456789_…​.csv</code> auto-select the account.</span>
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

module.exports = { SHELL_HTML };
