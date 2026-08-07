'use strict';
/* Static view markup — same shell as Budget App.html, minus the folder-picker
   connect screen (replaced by a settings pointer) and the theme toggle (now a
   setting). Icons are lucide slots (span[data-ico]) resolved after mount. */

const SHELL_HTML = `
  <div class="splash-gate hidden" id="splashGate" role="group" aria-labelledby="gateTitle">
    <div class="splash-inner">
      <div class="splash-logo" aria-hidden="true"><span class="ico" data-ico="wallet|banknote|coins"></span></div>
      <h1 class="splash-title" id="gateTitle">Budget Vault</h1>
      <p class="splash-sub">Your private budget, kept safely inside your vault.</p>
      <button type="button" class="btn-gradient splash-btn" id="gateEnter">Enter budget</button>
    </div>
  </div>

  <div class="drawer-overlay" id="drawerOverlay"></div>

  <nav class="app-drawer" id="appDrawer" aria-label="Main menu" inert>
    <div class="drawer-head">
      <b>Menu</b>
      <button type="button" class="drawer-close" aria-label="Close menu" id="drawerClose"><span class="ico" data-ico="x"></span></button>
    </div>

    <div class="drawer-section-label">Budget</div>
    <button class="drawer-link" data-view="dashboard" aria-current="page">
      <span class="di"><span class="ico" data-ico="layout-dashboard"></span></span>Dashboard
    </button>
    <button class="drawer-link" data-view="transactions">
      <span class="di"><span class="ico" data-ico="arrow-left-right"></span></span>Transactions
    </button>
    <button class="drawer-link" data-view="budgets">
      <span class="di"><span class="ico" data-ico="bookmark"></span></span>Budget
    </button>

    <div class="drawer-divider"></div>

    <div class="drawer-section-label">Accounts</div>
    <button class="drawer-link" data-view="savings">
      <span class="di"><span class="ico" data-ico="piggy-bank"></span></span>Savings &amp; Investments
    </button>
    <button class="drawer-link" data-view="accounts">
      <span class="di"><span class="ico" data-ico="landmark"></span></span>Accounts
    </button>
    <button class="drawer-link" data-view="assets">
      <span class="di"><span class="ico" data-ico="gem|diamond"></span></span>Assets
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
    <button class="drawer-link" data-view="tax">
      <span class="di"><span class="ico" data-ico="receipt-text|receipt|file-check"></span></span>Tax
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
              <div class="sub" id="trendSub">Spent vs budget</div>
            </div>
            <div class="card-h-controls">
              <div class="legend">
                <span><i style="background:var(--color-success)"></i>Spent</span>
                <span><i style="background:var(--color-danger)"></i>Over budget</span>
                <span><i style="background:var(--color-info)"></i>Income</span>
                <span><i class="legend-dash"></i>Budget</span>
              </div>
              <div id="trendRange"></div>
            </div>
          </div>
          <div class="body-pad"><div class="trend-svg-wrap" id="trendChart"></div></div>
        </div>
        <div class="card mb-4" id="dashSplitCard">
          <div class="card-h">
            <div>
              <h2>Where it went</h2>
              <div class="sub" id="dashSplitSub"></div>
            </div>
          </div>
          <div class="body-pad"><div class="donut-wrap" id="dashSplit"></div></div>
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
        <!-- Position, not flow. Everything above this band moves when the period
             changes; nothing in it does, which is why the subtitle says so — a
             card that ignores the control above it reads as broken otherwise.

             Deliberately NOT wrapped in a .card. Its tiles are .mini cards with
             borders of their own, and every other mini-grid in the app (Savings,
             Accounts, Debt, Owed, Assets, Services) sits bare on the page
             background for exactly that reason. The heading it does need comes
             from .section-h, which carries the card header's type scale without
             the card's chrome or its 44px gutters. -->
        <div class="mb-4" id="dashPositionCard">
          <div class="section-h">
            <h2>Where you stand</h2>
            <div class="sub" id="dashPositionSub"></div>
          </div>
          <div class="mini-grid mini-kpis-4 mini-grid--linked" id="dashPositionKpis"></div>
          <div class="kpi-caveat" id="dashPositionNote"></div>
          <div class="kpi-caveat" id="dashStale"></div>
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
              <button class="btn-ghost" id="txExport"><span class="ico" data-ico="download|file-down"></span> Export</button>
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
        <div id="budShapeNote" class="bud-shape-note hidden"></div>
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
        <!-- Tiles and the caveat that qualifies them are ONE block, and the
             block owns the gap to whatever follows — the same shape as the
             dashboard's position band. The caveat is not rendered when nothing
             is stale, so a gap hung on it is a gap that exists only while
             something is wrong. -->
        <div class="mb-4">
          <div class="mini-grid mini-kpis-4" id="savingsKpis"></div>
          <div class="kpi-caveat" id="savingsStale"></div>
        </div>
        <div class="card mb-4" id="savingsWorthCard">
          <div class="card-h">
            <div>
              <h2>What net worth is made of</h2>
              <div class="sub" id="savingsWorthSub"></div>
            </div>
          </div>
          <div class="body-pad"><div class="stack-wrap" id="savingsWorth"></div></div>
        </div>
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

      <section id="view-assets" class="hidden">
        <div class="financial-period-banner">
          <h1 class="financial-period-banner-title">Assets</h1>
          <div class="sub-note">What the household owns outside its accounts · saved to <code>Assets.md</code></div>
        </div>
        <!-- One block, owning its own gap — see the note on Savings above. -->
        <div class="mb-4">
          <div class="mini-grid mini-kpis-4" id="assetKpis"></div>
          <div class="kpi-caveat" id="assetStale"></div>
        </div>
        <div class="card">
          <div class="card-h" style="align-items:center">
            <div><h2>What you own</h2><div class="sub">Edit a value or a valuation date, then save</div></div>
            <div class="row">
              <button class="btn-ghost" id="assetAdd"><span class="ico" data-ico="plus"></span> New asset</button>
              <button class="btn-gradient" id="assetSave" disabled>Save changes</button>
            </div>
          </div>
          <div class="body-pad body-pad-tight">
            <div class="table-responsive"><table class="table table-hover" id="assetTable"></table></div>
          </div>
        </div>
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
              <select id="debtRange" class="form-select form-select-sm" aria-label="Payoff chart range"></select>
            </div>
          </div>
          <div class="body-pad"><div class="trend-svg-wrap" id="debtCurve"></div></div>
          <div class="body-pad" style="padding-top:0" id="debtPlan"></div>
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
              <span class="ua-line">Drop a bank statement here, or click to choose a file.</span>
              <span class="hint" id="importDropHint">Discovery filenames like <code>DiscoveryBank_10123456789_…​.csv</code> auto-select the account.</span>
            </button>
            <!-- Tab- and semicolon-separated exports are read too (the delimiter
                 is sniffed from the file), and banks hand those out as .txt and
                 .tsv as often as .csv — so the picker must offer them. -->
            <input type="file" id="fileInput" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" class="hidden">
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

module.exports = { SHELL_HTML };
