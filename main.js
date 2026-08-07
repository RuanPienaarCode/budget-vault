"use strict";
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);

// src/constants.js
var require_constants = __commonJS((exports2, module2) => {
  var VIEW_TYPE = "budget-app-view";
  var PALETTE_PRESETS = {
    "vault-green": "Vault Green",
    ocean: "Ocean",
    plum: "Plum",
    slate: "Slate"
  };
  var DEFAULT_PALETTE = "vault-green";
  var DEFAULT_SETTINGS = {
    budgetFolder: "Finances/Budget",
    theme: "auto",
    palette: DEFAULT_PALETTE,
    openOnStartup: false,
    onboarded: false,
    privacyLock: true,
    exportFolder: "Exports",
    chartTrendRange: "6m",
    chartDebtRange: "5y"
  };
  var FEEDBACK_URL = "https://forms.gle/EVJKCuZxNQ9vJhTz6";
  var SUPPORT_URL = "https://paypal.me/ruanpienaar86";
  var PERIOD_PRESETS = { 0: "Monthly (payday month)", 7: "Every week", 14: "Every 2 weeks", 28: "Every 4 weeks" };
  function periodLengthOptions(current) {
    const o = { ...PERIOD_PRESETS };
    if (current && !o[current])
      o[current] = `Every ${current} days (set in Settings.md)`;
    return o;
  }
  var TYPE_ORDER = ["income", "expense", "debt", "services", "insurance", "giving", "savings", "investment", "luxuries", "transfer"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  module2.exports = { VIEW_TYPE, DEFAULT_SETTINGS, FEEDBACK_URL, SUPPORT_URL, TYPE_ORDER, MONTHS, PERIOD_PRESETS, PALETTE_PRESETS, DEFAULT_PALETTE, periodLengthOptions };
});

// src/markdown.js
var require_markdown = __commonJS((exports2, module2) => {
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
  var yamlStr = (v) => `"${String(v ?? "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
  module2.exports = { escMd, unescMd, parseFrontmatter, parseMdTable, patchFrontmatter, yamlStr };
});

// src/lang/en.js
var require_en = __commonJS((exports2, module2) => {
  module2.exports = {
    "splash.sub": "Your private budget, kept safely inside your vault.",
    "splash.enter": "Enter budget",
    "nav.menu": "Menu",
    "nav.close": "Close menu",
    "nav.section.budget": "Budget",
    "nav.section.accounts": "Accounts",
    "nav.section.tools": "Tools",
    "nav.dashboard": "Dashboard",
    "nav.transactions": "Transactions",
    "nav.budgets": "Budget",
    "nav.savings": "Savings & Investments",
    "nav.accounts": "Accounts",
    "nav.assets": "Assets",
    "nav.debts": "Debt",
    "nav.owed": "Owed Money",
    "nav.services": "Services",
    "nav.tax": "Tax",
    "nav.loans": "Loan Calculators",
    "nav.import": "Import CSV",
    "nav.reload": "Reload from disk",
    "nav.pluginSettings": "Plugin settings",
    "topbar.nav": "Budget navigation",
    "topbar.mainMenu": "Main menu",
    "topbar.openMenu": "Open navigation menu",
    "topbar.home": "Go to Dashboard",
    "topbar.brandSub": "Obsidian vault budget",
    "topbar.periodNav": "Period navigation",
    "topbar.prevPeriod": "Previous period",
    "topbar.currentPeriod": "Jump to current period",
    "topbar.nextPeriod": "Next period",
    "topbar.import": "Import CSV",
    "topbar.importTitle": "Import a bank statement CSV",
    "topbar.settings": "Open budget settings",
    "settings.folder.name": "Budget folder",
    "settings.folder.desc": "Vault path of the folder holding Categories/, Accounts/, Budgets/, Transactions/, Settings.md, etc.",
    "settings.theme.name": "Theme",
    "settings.theme.desc": "Follow Obsidian's light/dark mode, or force the Airy Glass dark or light palette.",
    "settings.theme.auto": "Follow Obsidian",
    "settings.theme.dark": "Always dark",
    "settings.theme.light": "Always light",
    "settings.palette.name": "Colour palette",
    "settings.palette.desc": "Which colours the budget is drawn in. Each palette has its own light and dark version, so this is independent of the Theme setting above.",
    "settings.wizard.name": "Setup wizard",
    "settings.wizard.desc": "Re-run the first-run wizard — folder, name, budget period, currency, starter files.",
    "settings.wizard.button": "Run setup wizard",
    "settings.startup.name": "Open on startup",
    "settings.startup.desc": "Open the budget view automatically when Obsidian starts.",
    "settings.privacy.name": "Privacy splash screen",
    "settings.privacy.desc": 'Cover the budget with a splash screen until you tap "Enter budget" — on open, and again whenever Obsidian goes to the background. Nothing is read from the vault until you tap.',
    "settings.feedback.name": "Send feedback",
    "settings.feedback.desc": "Report a bug, flag an issue or request a feature. Opens a Google Form in your browser — nothing from your budget is attached or sent.",
    "settings.feedback.button": "Open feedback form",
    "settings.support.name": "Support Budget Vault",
    "settings.support.desc": "Budget Vault is free and always will be. If you'd like to say thanks, this opens PayPal in your browser — entirely optional, and nothing in the plugin changes either way.",
    "settings.support.button": "Send a thank you",
    "settings.data.name": "Budget data",
    "settings.data.desc": "Stored in Settings.md inside the budget folder, so they apply on every device.",
    "settings.household.name": "Name / household",
    "settings.household.desc": "Shown in the dashboard greeting and top bar. Leave blank for none.",
    "settings.household.placeholder": "Leave blank for none",
    "settings.monthStart.name": "Month start day",
    "settings.monthStart.desc": "Day of the month each financial period begins on — usually your payday. Choose 1 for an ordinary calendar month. 1–28.",
    "settings.monthStart.invalid": "Pick a day between 1 and 28.",
    "settings.periodLength.name": "Period length",
    "settings.periodLength.desc": "How long each budget period runs. Monthly uses the month start day above. The other options line periods up with a pay cycle instead, counting from the date below.",
    "settings.anchor.name": "Last payday",
    "settings.anchor.desc": "When were you last paid? Any recent payday works — only the day it falls on within the cycle matters, so an earlier or later one gives the same result. Ignored when the period length is monthly.",
    "settings.anchor.invalid": "Use a real date as YYYY-MM-DD, e.g. 2026-08-07.",
    "settings.country.name": "Country",
    "settings.country.desc": "Drives amount formatting, bank-statement date order and the Tax view's checklist (tailored to your country's tax authority). Existing tax years keep their data — only labels and new-year seeds change. Independent of the interface language below.",
    "settings.language.name": "Language",
    "settings.language.desc": "The language the interface is written in. Independent of Country above — living somewhere does not decide what you want to read. Defaults to Obsidian's own display language, falling back to English. Your own budget text — category names, notes, account names — is never translated.",
    "settings.currency.name": "Currency symbol",
    "settings.currency.desc": "Shown before every amount, e.g. R.",
    "settings.currency.invalid": "Enter a currency symbol.",
    "settings.budgetsKept": {
      one: "Budget: your {count} existing budget file stays in the vault. It can't be shown at this period length, and it comes straight back if you change it back.",
      other: "Budget: your {count} existing budget files stay in the vault. They can't be shown at this period length, and they come straight back if you change it back."
    },
    "settings.anchorReslices": {
      one: "Budget: this shifts every period boundary. {count} budget file named by date will stop matching — it stays in your vault, and setting this date back to {prev} brings it straight back.",
      other: "Budget: this shifts every period boundary. {count} budget files named by date will stop matching — they stay in your vault, and setting this date back to {prev} brings them straight back."
    },
    "settings.dateNotReal": 'Budget: "{value}" is not a date — use the picker, or type YYYY-MM-DD.',
    "wiz.title": "Set up Budget Vault",
    "wiz.stepOf": "Step {n} of {total}",
    "wiz.cancel": "Cancel",
    "wiz.back": "Back",
    "wiz.next": "Next",
    "wiz.letsGo": "Let's go!",
    "wiz.connectBtn": "Connect budget",
    "wiz.createBtn": "Create my budget",
    "wiz.skipped": "Setup skipped — you can run it again from Settings → Budget Vault → Run setup wizard, or the command palette.",
    "wiz.step.folder": "Where your budget lives",
    "wiz.step.name": "What should we call you?",
    "wiz.step.country": "Language, country & currency",
    "wiz.step.period": "Your budget period",
    "wiz.step.categories": "Your budget categories",
    "wiz.step.account": "Your first account",
    "wiz.step.finish": "Ready to go",
    "wiz.err.folder": "Enter a folder path for the budget — for example Finances/Budget.",
    "wiz.err.monthStart": "The month start day must be from 1 to 28. Not every month has a 29th, 30th or 31st, so if you are paid on the last day of the month, use 28.",
    "wiz.err.anchor": "Enter the date you were last paid — every pay cycle is counted from it, so without it the budget falls back to monthly periods.",
    "wiz.err.currency": "Enter a currency symbol, or pick one from the list above.",
    "wiz.welcome.title": "Welcome to Budget Vault!",
    "wiz.welcome.intro": "Your whole budget, living right here in your vault as plain markdown — no accounts, no cloud, no one else's server. If your vault syncs to your phone, your budget rides along for free.",
    "wiz.welcome.planLead": "Here's the plan — this wizard sets you up:",
    "wiz.welcome.plan1": "Choose your budget folder — we scaffold the whole structure for you",
    "wiz.welcome.plan2": "Pick your language, country & currency — so the app reads right and amounts, dates and tax stuff look right",
    "wiz.welcome.plan3": "Tell us when you get paid — your budget periods run from payday, if you like",
    "wiz.welcome.plan4": "Choose your budget categories — tick the ones that fit your life",
    "wiz.welcome.plan5": "Add your first account — and what's in it right now",
    "wiz.welcome.thenLead": "Then the fun starts in the app:",
    "wiz.welcome.app1": "Set your budget — give every category a number to aim for",
    "wiz.welcome.app2": "Import your bank's CSV — transactions sort themselves as you teach it",
    "wiz.welcome.app3": "Add new categories anytime — your budget grows with you",
    "wiz.welcome.app4": "Review as you go — the dashboard shows exactly where the money went",
    "wiz.welcome.close": "About two minutes of setup. You can change any of it later. Ready?",
    "wiz.folder.hint": "Everything lives as plain markdown files inside one folder of your vault.",
    "wiz.folder.blank": "Enter a folder path — for example Finances/Budget.",
    "wiz.folder.found": 'Found an existing budget in "{folder}" — the wizard will connect to it rather than create new files.',
    "wiz.folder.exists": '"{folder}" already exists — the budget files will be added inside it.',
    "wiz.folder.willCreate": `"{folder}" doesn't exist yet — it will be created for you.`,
    "wiz.folder.name": "Budget folder",
    "wiz.folder.desc": "Where the categories, accounts, budgets and transactions are kept.",
    "wiz.folder.connected": 'Found an existing budget in "{folder}" — connecting to it instead of creating new files. Your categories, accounts and transactions are left exactly as they are; the remaining steps only confirm the settings kept in its Settings.md.',
    "wiz.name.name": "Your name or nickname",
    "wiz.name.desc": "Shown in the dashboard greeting and the top bar. Leave blank to skip.",
    "wiz.name.placeholder": "e.g. Alex, or The Smiths",
    "wiz.language.desc": "The language the app is written in. Independent of the country below — where you live does not decide what you want to read. Your own budget text is never translated.",
    "wiz.country.desc": "Sets amount formatting, the date order used when reading bank statements, and the Tax view's return checklist for your country's tax authority.",
    "wiz.currency.desc": "Shown before every amount. Starts from your country — change it if you budget in something else.",
    "wiz.currency.custom": "Custom symbol",
    "wiz.currency.customPlaceholder": "e.g. CHF",
    "wiz.ccy.rand": "R — South African Rand",
    "wiz.ccy.dollar": "$ — Dollar",
    "wiz.ccy.euro": "€ — Euro",
    "wiz.ccy.pound": "£ — Pound",
    "wiz.ccy.other": "Other…",
    "wiz.period.howOften": "How often are you paid?",
    "wiz.period.howOftenDesc": "Monthly periods are named by month and start on the day you choose below. The others line up with a pay cycle instead, counted from your last payday.",
    "wiz.period.startDay": "Which day does your budget month start?",
    "wiz.period.startDayDesc": "Usually your payday. Choose 1 for an ordinary calendar month. (1–28)",
    "wiz.period.badDay": "Pick a day from 1 to 28. Not every month has a 29th, 30th or 31st, so if you are paid on the last day of the month, use 28.",
    "wiz.period.calendarEg": "An ordinary calendar month: each period runs from the {first} to the end of the month, and is named after that month. Right now you are in {month}.",
    "wiz.period.paydayEg": "Each period runs from the {start} to the {end} of the next month, and is named after the month it ends in. Right now you are in {month}.",
    "wiz.period.anchorBlank": "Enter the date you were last paid and the periods are worked out from there.",
    "wiz.period.anchorEg": "Counting from there, the period you are in right now started on {date}. Budget files are named by that start date.",
    "wiz.period.anchorName": "When were you last paid?",
    "wiz.period.anchorDesc": "Any recent payday will do — only where it falls within the cycle matters, so an earlier or later one gives the same periods.",
    "wiz.cats.intro": "Start with a set of budget categories — untick any you don't want. You can add, rename or recolour them later, so nothing here is final.",
    "wiz.cats.selected": "{count} of {total} selected",
    "wiz.cats.selectAll": "Select all",
    "wiz.cats.selectNone": "Select none",
    "wiz.type.income": "Income",
    "wiz.type.expense": "Everyday expenses",
    "wiz.type.debt": "Debt repayments",
    "wiz.type.services": "Services & subscriptions",
    "wiz.type.insurance": "Insurance",
    "wiz.type.giving": "Giving",
    "wiz.type.savings": "Savings",
    "wiz.type.investment": "Investments",
    "wiz.type.luxuries": "Nice-to-haves",
    "wiz.type.transfer": "Transfers",
    "wiz.acct.intro": "Transactions are stored per account. Add your main account now, or leave the name blank to skip — you can add accounts any time.",
    "wiz.acct.name": "Account name",
    "wiz.acct.namePlaceholder": "e.g. Cheque account",
    "wiz.acct.type": "Type",
    "wiz.acct.balance": "Current balance",
    "wiz.acct.balanceDesc": "Optional — what's in the account right now.",
    "wiz.acct.balanceHint": "Use your latest statement's closing balance, or whatever your banking app shows. The balance is a snapshot you keep up to date yourself — importing only recent transactions never throws it off — and you can change it any time by tapping the balance on the Accounts page.",
    "wiz.acctType.checking": "Cheque / current account",
    "wiz.acctType.savings": "Savings account",
    "wiz.acctType.credit_card": "Credit card",
    "wiz.acctType.cash": "Cash",
    "wiz.acctType.investment": "Investment",
    "wiz.sum.folder": "Folder",
    "wiz.sum.name": "Name",
    "wiz.sum.language": "Language",
    "wiz.sum.country": "Country",
    "wiz.sum.period": "Budget period",
    "wiz.sum.currency": "Currency",
    "wiz.sum.categories": "Categories",
    "wiz.sum.account": "First account",
    "wiz.sum.opening": "Opening balance",
    "wiz.sum.catCount": {
      one: "{count} starter category",
      other: "{count} starter categories"
    },
    "wiz.sum.monthlyCalendar": "Monthly (calendar month)",
    "wiz.sum.monthlyOn": "Monthly, starting on the {day}",
    "wiz.sum.cycleFrom": "{preset}, counted from {date}",
    "wiz.finish.connectLead": "Connecting to the existing budget folder and saving these settings into its Settings.md:",
    "wiz.finish.createLead": "This will create the budget folder with Settings.md, your categories, the first budget file and empty Owed Money / Services files:",
    "wiz.finish.nextLead": "What to do next: ",
    "wiz.finish.nextBody": "give your categories an amount on the Budgets page, then import your bank's CSV on the Transactions page.",
    "wiz.finish.privacy": "Your budget opens behind a tap-to-enter privacy screen, so nothing is on show if someone glances at your vault. Turn it off in Settings → Budget Vault → Privacy splash screen.",
    "wiz.done.connected": "Connected to your budget folder.",
    "wiz.done.created": "Budget folder created — welcome!",
    "wiz.failed": "Setup failed: {error}",
    "bud.shape.title": "Your other budgets are still here",
    "bud.shape.body": {
      one: "{count} budget file is saved under a different period length — it is Budgets/{newest}.md. It stays in your vault, and it comes back as soon as you set the period length back. Amounts start blank here because this period isn't the same length as that one was.",
      other: "{count} budget files are saved under a different period length — the most recent is Budgets/{newest}.md. They stay in your vault, and they come back as soon as you set the period length back. Amounts start blank here because this period isn't the same length as those were."
    },
    "bud.shape.bring": "Bring over the categories and notes from {newest}",
    "bud.shape.empty": "That budget is empty",
    "bud.shape.brought": {
      one: "Brought over {count} category — set the amount for this period",
      other: "Brought over {count} categories — set the amounts for this period"
    },
    "bud.shape.allHere": "Every category from that budget is already here",
    "bud.total.income": "Total income",
    "bud.total.incomeNote": "{amount} received so far",
    "bud.total.budgeted": "Total budgeted",
    "bud.total.budgetedNote": "{pct}% of budgeted income",
    "bud.total.over": "Over-budgeted",
    "bud.total.overNote": "budgeted beyond income",
    "bud.total.left": "Left to budget",
    "bud.total.leftNote": "income not yet allocated",
    "bud.total.spent": "Total spent",
    "bud.total.spentNote": "{pct}% of budget used",
    "bud.col.category": "Category",
    "bud.col.type": "Type",
    "bud.col.amount": "Amount",
    "bud.col.actual": "Actual so far",
    "bud.col.notes": "Notes",
    "bud.remaining.over": "{amount} over",
    "bud.remaining.left": "{amount} left",
    "bud.aria.amount": "Budget amount for {category}",
    "bud.aria.notes": "Notes for {category}",
    "bud.aria.clear": "Clear budget for {category}",
    "bud.title.clear": "Clear this category from the period file",
    "bud.aria.delete": "Delete category {category}",
    "bud.title.delete": "Delete this category everywhere",
    "bud.saved": "Budget saved to Budgets/{period}.md",
    "bud.copy.none": "No budget found for the previous period",
    "bud.copy.done": {
      one: "Copied {count} category from the previous period",
      other: "Copied {count} categories from the previous period"
    },
    "bud.copy.nothing": "Nothing to copy — every category already has a value"
  };
});

// src/lang/af.js
var require_af = __commonJS((exports2, module2) => {
  module2.exports = {
    "splash.sub": "Jou private begroting, veilig bewaar binne-in jou kluis.",
    "splash.enter": "Gaan na begroting",
    "nav.menu": "Kieslys",
    "nav.close": "Maak kieslys toe",
    "nav.section.budget": "Begroting",
    "nav.section.accounts": "Rekeninge",
    "nav.section.tools": "Gereedskap",
    "nav.dashboard": "Paneelbord",
    "nav.transactions": "Transaksies",
    "nav.budgets": "Begroting",
    "nav.savings": "Spaargeld en Beleggings",
    "nav.accounts": "Rekeninge",
    "nav.assets": "Bates",
    "nav.debts": "Skuld",
    "nav.owed": "Geld Verskuldig",
    "nav.services": "Dienste",
    "nav.tax": "Belasting",
    "nav.loans": "Leningsberekenaars",
    "nav.import": "Voer CSV in",
    "nav.reload": "Herlaai vanaf skyf",
    "nav.pluginSettings": "Inpropinstellings",
    "topbar.nav": "Begrotingsnavigasie",
    "topbar.mainMenu": "Hoofkieslys",
    "topbar.openMenu": "Maak navigasiekieslys oop",
    "topbar.home": "Gaan na Paneelbord",
    "topbar.brandSub": "Obsidian-kluisbegroting",
    "topbar.periodNav": "Tydperknavigasie",
    "topbar.prevPeriod": "Vorige tydperk",
    "topbar.currentPeriod": "Spring na huidige tydperk",
    "topbar.nextPeriod": "Volgende tydperk",
    "topbar.import": "Voer CSV in",
    "topbar.importTitle": "Voer 'n bankstaat-CSV in",
    "topbar.settings": "Maak begrotingsinstellings oop",
    "settings.folder.name": "Begrotingsvouer",
    "settings.folder.desc": "Kluispad van die vouer wat Categories/, Accounts/, Budgets/, Transactions/, Settings.md, ens. hou.",
    "settings.theme.name": "Tema",
    "settings.theme.desc": "Volg Obsidian se lig/donker-modus, of dwing die Airy Glass donker of ligte palet af.",
    "settings.theme.auto": "Volg Obsidian",
    "settings.theme.dark": "Altyd donker",
    "settings.theme.light": "Altyd lig",
    "settings.palette.name": "Kleurpalet",
    "settings.palette.desc": "Watter kleure die begroting in geteken word. Elke palet het sy eie ligte en donker weergawe, dus is dit onafhanklik van die Tema-instelling hierbo.",
    "settings.wizard.name": "Opstelassistent",
    "settings.wizard.desc": "Hardloop die eerste-keer-assistent weer — vouer, naam, begrotingstydperk, geldeenheid, beginlêers.",
    "settings.wizard.button": "Hardloop opstelassistent",
    "settings.startup.name": "Maak oop met begin",
    "settings.startup.desc": "Maak die begrotingsaansig outomaties oop wanneer Obsidian begin.",
    "settings.privacy.name": "Privaatheidskerm",
    "settings.privacy.desc": `Bedek die begroting met 'n skerm totdat jy "Gaan na begroting" tik — met oopmaak, en weer elke keer wanneer Obsidian na die agtergrond gaan. Niks word uit die kluis gelees voordat jy tik nie.`,
    "settings.feedback.name": "Stuur terugvoer",
    "settings.feedback.desc": "Rapporteer 'n fout, meld 'n probleem aan of vra 'n kenmerk aan. Maak 'n Google-vorm in jou blaaier oop — niks uit jou begroting word aangeheg of gestuur nie.",
    "settings.feedback.button": "Maak terugvoervorm oop",
    "settings.support.name": "Ondersteun Budget Vault",
    "settings.support.desc": "Budget Vault is gratis en sal altyd wees. As jy dankie wil sê, maak dit PayPal in jou blaaier oop — heeltemal opsioneel, en niks in die inprop verander so of so nie.",
    "settings.support.button": "Stuur 'n dankie",
    "settings.data.name": "Begrotingsdata",
    "settings.data.desc": "Gestoor in Settings.md binne die begrotingsvouer, sodat dit op elke toestel geld.",
    "settings.household.name": "Naam / huishouding",
    "settings.household.desc": "Word in die paneelbord se groet en die boonste balk gewys. Los leeg vir geen.",
    "settings.household.placeholder": "Los leeg vir geen",
    "settings.monthStart.name": "Maand se begindag",
    "settings.monthStart.desc": "Dag van die maand waarop elke finansiële tydperk begin — gewoonlik jou betaaldag. Kies 1 vir 'n gewone kalendermaand. 1–28.",
    "settings.monthStart.invalid": "Kies 'n dag tussen 1 en 28.",
    "settings.periodLength.name": "Tydperklengte",
    "settings.periodLength.desc": "Hoe lank elke begrotingstydperk loop. Maandeliks gebruik die maand se begindag hierbo. Die ander opsies belyn tydperke eerder met 'n betaalsiklus, getel vanaf die datum hieronder.",
    "settings.anchor.name": "Laaste betaaldag",
    "settings.anchor.desc": "Wanneer is jy laas betaal? Enige onlangse betaaldag werk — net die dag waarop dit binne die siklus val, maak saak, dus gee 'n vroeër of later een dieselfde uitkoms. Word geïgnoreer wanneer die tydperklengte maandeliks is.",
    "settings.anchor.invalid": "Gebruik 'n werklike datum as JJJJ-MM-DD, bv. 2026-08-07.",
    "settings.country.name": "Land",
    "settings.country.desc": "Dryf bedragformatering, die datumvolgorde van bankstate en die Belasting-aansig se kontrolelys (toegespits op jou land se belastingowerheid). Bestaande belastingjare behou hul data — net etikette en nuwejaarsaanvangswaardes verander. Onafhanklik van die koppelvlaktaal hieronder.",
    "settings.language.name": "Taal",
    "settings.language.desc": "Die taal waarin die koppelvlak geskryf is. Onafhanklik van Land hierbo — waar jy woon, bepaal nie wat jy wil lees nie. Volg by verstek Obsidian se eie vertoontaal, met Engels as terugval. Jou eie begrotingsteks — kategoriename, notas, rekeningname — word nooit vertaal nie.",
    "settings.currency.name": "Geldeenheidsimbool",
    "settings.currency.desc": "Word voor elke bedrag gewys, bv. R.",
    "settings.currency.invalid": "Voer 'n geldeenheidsimbool in.",
    "settings.budgetsKept": {
      one: "Begroting: jou {count} bestaande begrotingslêer bly in die kluis. Dit kan nie by hierdie tydperklengte gewys word nie, en dit kom dadelik terug as jy dit terugverander.",
      other: "Begroting: jou {count} bestaande begrotingslêers bly in die kluis. Hulle kan nie by hierdie tydperklengte gewys word nie, en hulle kom dadelik terug as jy dit terugverander."
    },
    "settings.anchorReslices": {
      one: "Begroting: dit skuif elke tydperkgrens. {count} begrotingslêer wat volgens datum benoem is, sal ophou pas — dit bly in jou kluis, en om hierdie datum terug te stel na {prev} bring dit dadelik terug.",
      other: "Begroting: dit skuif elke tydperkgrens. {count} begrotingslêers wat volgens datum benoem is, sal ophou pas — hulle bly in jou kluis, en om hierdie datum terug te stel na {prev} bring hulle dadelik terug."
    },
    "settings.dateNotReal": `Begroting: "{value}" is nie 'n datum nie — gebruik die kieser, of tik JJJJ-MM-DD.`,
    "wiz.title": "Stel Budget Vault op",
    "wiz.stepOf": "Stap {n} van {total}",
    "wiz.cancel": "Kanselleer",
    "wiz.back": "Terug",
    "wiz.next": "Volgende",
    "wiz.letsGo": "Kom ons gaan!",
    "wiz.connectBtn": "Koppel begroting",
    "wiz.createBtn": "Skep my begroting",
    "wiz.skipped": "Opstelling oorgeslaan — jy kan dit weer hardloop vanaf Instellings → Budget Vault → Hardloop opstelassistent, of die bevelpalet.",
    "wiz.step.folder": "Waar jou begroting bly",
    "wiz.step.name": "Wat moet ons jou noem?",
    "wiz.step.country": "Taal, land en geldeenheid",
    "wiz.step.period": "Jou begrotingstydperk",
    "wiz.step.categories": "Jou begrotingskategorieë",
    "wiz.step.account": "Jou eerste rekening",
    "wiz.step.finish": "Gereed om te begin",
    "wiz.err.folder": "Voer 'n vouerpad vir die begroting in — byvoorbeeld Finances/Budget.",
    "wiz.err.monthStart": "Die maand se begindag moet van 1 tot 28 wees. Nie elke maand het 'n 29ste, 30ste of 31ste nie, so as jy op die laaste dag van die maand betaal word, gebruik 28.",
    "wiz.err.anchor": "Voer die datum in waarop jy laas betaal is — elke betaalsiklus word daarvandaan getel, dus val die begroting daarsonder terug op maandelikse tydperke.",
    "wiz.err.currency": "Voer 'n geldeenheidsimbool in, of kies een uit die lys hierbo.",
    "wiz.welcome.title": "Welkom by Budget Vault!",
    "wiz.welcome.intro": "Jou hele begroting, wat reg hier in jou kluis as gewone markdown leef — geen rekeninge, geen wolk, niemand anders se bediener nie. As jou kluis na jou foon sinkroniseer, ry jou begroting gratis saam.",
    "wiz.welcome.planLead": "Hier is die plan — hierdie assistent stel jou op:",
    "wiz.welcome.plan1": "Kies jou begrotingsvouer — ons stel die hele struktuur vir jou op",
    "wiz.welcome.plan2": "Kies jou taal, land en geldeenheid — sodat die program reg lees en bedrae, datums en belastinggoed reg lyk",
    "wiz.welcome.plan3": "Sê vir ons wanneer jy betaal word — jou begrotingstydperke loop vanaf betaaldag, as jy wil",
    "wiz.welcome.plan4": "Kies jou begrotingskategorieë — merk dié wat by jou lewe pas",
    "wiz.welcome.plan5": "Voeg jou eerste rekening by — en wat tans daarin is",
    "wiz.welcome.thenLead": "Dan begin die pret in die program:",
    "wiz.welcome.app1": "Stel jou begroting — gee elke kategorie 'n bedrag om na te mik",
    "wiz.welcome.app2": "Voer jou bank se CSV in — transaksies sorteer hulself soos jy dit leer",
    "wiz.welcome.app3": "Voeg enige tyd nuwe kategorieë by — jou begroting groei saam met jou",
    "wiz.welcome.app4": "Kyk terug soos jy gaan — die paneelbord wys presies waarheen die geld is",
    "wiz.welcome.close": "Omtrent twee minute se opstelling. Jy kan enigiets daarvan later verander. Gereed?",
    "wiz.folder.hint": "Alles leef as gewone markdown-lêers binne een vouer van jou kluis.",
    "wiz.folder.blank": "Voer 'n vouerpad in — byvoorbeeld Finances/Budget.",
    "wiz.folder.found": `'n Bestaande begroting is in "{folder}" gevind — die assistent sal daaraan koppel eerder as om nuwe lêers te skep.`,
    "wiz.folder.exists": '"{folder}" bestaan reeds — die begrotingslêers sal daarbinne bygevoeg word.',
    "wiz.folder.willCreate": '"{folder}" bestaan nog nie — dit sal vir jou geskep word.',
    "wiz.folder.name": "Begrotingsvouer",
    "wiz.folder.desc": "Waar die kategorieë, rekeninge, begrotings en transaksies gehou word.",
    "wiz.folder.connected": `'n Bestaande begroting is in "{folder}" gevind — ons koppel daaraan eerder as om nuwe lêers te skep. Jou kategorieë, rekeninge en transaksies bly presies soos hulle is; die oorblywende stappe bevestig net die instellings wat in sy Settings.md gehou word.`,
    "wiz.name.name": "Jou naam of bynaam",
    "wiz.name.desc": "Word in die paneelbord se groet en die boonste balk gewys. Los leeg om oor te slaan.",
    "wiz.name.placeholder": "bv. Alex, of Die Smiths",
    "wiz.language.desc": "Die taal waarin die program geskryf is. Onafhanklik van die land hieronder — waar jy woon, bepaal nie wat jy wil lees nie. Jou eie begrotingsteks word nooit vertaal nie.",
    "wiz.country.desc": "Stel bedragformatering, die datumvolgorde wat gebruik word om bankstate te lees, en die Belasting-aansig se opgawekontrolelys vir jou land se belastingowerheid.",
    "wiz.currency.desc": "Word voor elke bedrag gewys. Begin by jou land — verander dit as jy in iets anders begroot.",
    "wiz.currency.custom": "Pasgemaakte simbool",
    "wiz.currency.customPlaceholder": "bv. CHF",
    "wiz.ccy.rand": "R — Suid-Afrikaanse rand",
    "wiz.ccy.dollar": "$ — Dollar",
    "wiz.ccy.euro": "€ — Euro",
    "wiz.ccy.pound": "£ — Pond",
    "wiz.ccy.other": "Ander…",
    "wiz.period.howOften": "Hoe gereeld word jy betaal?",
    "wiz.period.howOftenDesc": "Maandelikse tydperke word volgens maand benoem en begin op die dag wat jy hieronder kies. Die ander belyn eerder met 'n betaalsiklus, getel vanaf jou laaste betaaldag.",
    "wiz.period.startDay": "Op watter dag begin jou begrotingsmaand?",
    "wiz.period.startDayDesc": "Gewoonlik jou betaaldag. Kies 1 vir 'n gewone kalendermaand. (1–28)",
    "wiz.period.badDay": "Kies 'n dag van 1 tot 28. Nie elke maand het 'n 29ste, 30ste of 31ste nie, so as jy op die laaste dag van die maand betaal word, gebruik 28.",
    "wiz.period.calendarEg": "'n Gewone kalendermaand: elke tydperk loop van die {first} tot die einde van die maand, en word na daardie maand vernoem. Jy is nou in {month}.",
    "wiz.period.paydayEg": "Elke tydperk loop van die {start} tot die {end} van die volgende maand, en word vernoem na die maand waarin dit eindig. Jy is nou in {month}.",
    "wiz.period.anchorBlank": "Voer die datum in waarop jy laas betaal is, en die tydperke word daarvandaan uitgewerk.",
    "wiz.period.anchorEg": "Van daar af getel, het die tydperk waarin jy nou is op {date} begin. Begrotingslêers word volgens daardie begindatum benoem.",
    "wiz.period.anchorName": "Wanneer is jy laas betaal?",
    "wiz.period.anchorDesc": "Enige onlangse betaaldag sal deug — net waar dit binne die siklus val, maak saak, dus gee 'n vroeër of later een dieselfde tydperke.",
    "wiz.cats.intro": "Begin met 'n stel begrotingskategorieë — ontmerk enige wat jy nie wil hê nie. Jy kan hulle later byvoeg, hernoem of herkleur, dus is niks hier finaal nie.",
    "wiz.cats.selected": "{count} van {total} gekies",
    "wiz.cats.selectAll": "Kies almal",
    "wiz.cats.selectNone": "Kies geen",
    "wiz.type.income": "Inkomste",
    "wiz.type.expense": "Daaglikse uitgawes",
    "wiz.type.debt": "Skuldafbetalings",
    "wiz.type.services": "Dienste en intekeninge",
    "wiz.type.insurance": "Versekering",
    "wiz.type.giving": "Gee",
    "wiz.type.savings": "Spaargeld",
    "wiz.type.investment": "Beleggings",
    "wiz.type.luxuries": "Lekker-om-te-hê",
    "wiz.type.transfer": "Oorplasings",
    "wiz.acct.intro": "Transaksies word per rekening gestoor. Voeg nou jou hoofrekening by, of los die naam leeg om oor te slaan — jy kan enige tyd rekeninge byvoeg.",
    "wiz.acct.name": "Rekeningnaam",
    "wiz.acct.namePlaceholder": "bv. Tjekrekening",
    "wiz.acct.type": "Tipe",
    "wiz.acct.balance": "Huidige saldo",
    "wiz.acct.balanceDesc": "Opsioneel — wat tans in die rekening is.",
    "wiz.acct.balanceHint": "Gebruik jou jongste staat se sluitingsaldo, of wat ook al jou bankprogram wys. Die saldo is 'n momentopname wat jy self op datum hou — om net onlangse transaksies in te voer, gooi dit nooit uit nie — en jy kan dit enige tyd verander deur op die saldo op die Rekeninge-bladsy te tik.",
    "wiz.acctType.checking": "Tjek-/lopende rekening",
    "wiz.acctType.savings": "Spaarrekening",
    "wiz.acctType.credit_card": "Kredietkaart",
    "wiz.acctType.cash": "Kontant",
    "wiz.acctType.investment": "Belegging",
    "wiz.sum.folder": "Vouer",
    "wiz.sum.name": "Naam",
    "wiz.sum.language": "Taal",
    "wiz.sum.country": "Land",
    "wiz.sum.period": "Begrotingstydperk",
    "wiz.sum.currency": "Geldeenheid",
    "wiz.sum.categories": "Kategorieë",
    "wiz.sum.account": "Eerste rekening",
    "wiz.sum.opening": "Aanvangsaldo",
    "wiz.sum.catCount": {
      one: "{count} beginkategorie",
      other: "{count} beginkategorieë"
    },
    "wiz.sum.monthlyCalendar": "Maandeliks (kalendermaand)",
    "wiz.sum.monthlyOn": "Maandeliks, begin op die {day}",
    "wiz.sum.cycleFrom": "{preset}, getel vanaf {date}",
    "wiz.finish.connectLead": "Ons koppel aan die bestaande begrotingsvouer en stoor hierdie instellings in sy Settings.md:",
    "wiz.finish.createLead": "Dit sal die begrotingsvouer skep met Settings.md, jou kategorieë, die eerste begrotingslêer en leë Owed Money-/Services-lêers:",
    "wiz.finish.nextLead": "Wat om volgende te doen: ",
    "wiz.finish.nextBody": "gee jou kategorieë 'n bedrag op die Begrotings-bladsy, en voer dan jou bank se CSV op die Transaksies-bladsy in.",
    "wiz.finish.privacy": "Jou begroting maak agter 'n tik-om-in-te-gaan privaatheidskerm oop, sodat niks sigbaar is as iemand vlugtig na jou kluis kyk nie. Skakel dit af by Instellings → Budget Vault → Privaatheidskerm.",
    "wiz.done.connected": "Gekoppel aan jou begrotingsvouer.",
    "wiz.done.created": "Begrotingsvouer geskep — welkom!",
    "wiz.failed": "Opstelling het misluk: {error}",
    "bud.shape.title": "Jou ander begrotings is steeds hier",
    "bud.shape.body": {
      one: "{count} begrotingslêer is onder 'n ander tydperklengte gestoor — dit is Budgets/{newest}.md. Dit bly in jou kluis, en dit kom terug sodra jy die tydperklengte terugstel. Bedrae begin hier leeg omdat hierdie tydperk nie dieselfde lengte is as daardie een nie.",
      other: "{count} begrotingslêers is onder 'n ander tydperklengte gestoor — die jongste is Budgets/{newest}.md. Hulle bly in jou kluis, en hulle kom terug sodra jy die tydperklengte terugstel. Bedrae begin hier leeg omdat hierdie tydperk nie dieselfde lengte is as daardie een nie."
    },
    "bud.shape.bring": "Bring die kategorieë en notas van {newest} oor",
    "bud.shape.empty": "Daardie begroting is leeg",
    "bud.shape.brought": {
      one: "{count} kategorie oorgebring — stel die bedrag vir hierdie tydperk",
      other: "{count} kategorieë oorgebring — stel die bedrae vir hierdie tydperk"
    },
    "bud.shape.allHere": "Elke kategorie uit daardie begroting is reeds hier",
    "bud.total.income": "Totale inkomste",
    "bud.total.incomeNote": "{amount} tot dusver ontvang",
    "bud.total.budgeted": "Totaal begroot",
    "bud.total.budgetedNote": "{pct}% van begrote inkomste",
    "bud.total.over": "Oorbegroot",
    "bud.total.overNote": "meer begroot as inkomste",
    "bud.total.left": "Nog te begroot",
    "bud.total.leftNote": "inkomste nog nie toegewys nie",
    "bud.total.spent": "Totaal bestee",
    "bud.total.spentNote": "{pct}% van begroting gebruik",
    "bud.col.category": "Kategorie",
    "bud.col.type": "Tipe",
    "bud.col.amount": "Bedrag",
    "bud.col.actual": "Werklik tot dusver",
    "bud.col.notes": "Notas",
    "bud.remaining.over": "{amount} oor die begroting",
    "bud.remaining.left": "{amount} oor",
    "bud.aria.amount": "Begrotingsbedrag vir {category}",
    "bud.aria.notes": "Notas vir {category}",
    "bud.aria.clear": "Maak begroting vir {category} skoon",
    "bud.title.clear": "Verwyder hierdie kategorie uit die tydperklêer",
    "bud.aria.delete": "Skrap kategorie {category}",
    "bud.title.delete": "Skrap hierdie kategorie oral",
    "bud.saved": "Begroting gestoor na Budgets/{period}.md",
    "bud.copy.none": "Geen begroting vir die vorige tydperk gevind nie",
    "bud.copy.done": {
      one: "{count} kategorie uit die vorige tydperk gekopieer",
      other: "{count} kategorieë uit die vorige tydperk gekopieer"
    },
    "bud.copy.nothing": "Niks om te kopieer nie — elke kategorie het reeds 'n waarde"
  };
});

// src/lang/de.js
var require_de = __commonJS((exports2, module2) => {
  module2.exports = {
    "splash.sub": "Dein privates Budget, sicher in deinem Vault aufbewahrt.",
    "splash.enter": "Budget öffnen",
    "nav.menu": "Menü",
    "nav.close": "Menü schließen",
    "nav.section.budget": "Budget",
    "nav.section.accounts": "Konten",
    "nav.section.tools": "Werkzeuge",
    "nav.dashboard": "Übersicht",
    "nav.transactions": "Transaktionen",
    "nav.budgets": "Budget",
    "nav.savings": "Sparen und Anlagen",
    "nav.accounts": "Konten",
    "nav.assets": "Vermögenswerte",
    "nav.debts": "Schulden",
    "nav.owed": "Ausstehende Beträge",
    "nav.services": "Dienste",
    "nav.tax": "Steuern",
    "nav.loans": "Kreditrechner",
    "nav.import": "CSV importieren",
    "nav.reload": "Vom Datenträger neu laden",
    "nav.pluginSettings": "Plugin-Einstellungen",
    "topbar.nav": "Budget-Navigation",
    "topbar.mainMenu": "Hauptmenü",
    "topbar.openMenu": "Navigationsmenü öffnen",
    "topbar.home": "Zur Übersicht",
    "topbar.brandSub": "Budget im Obsidian-Vault",
    "topbar.periodNav": "Zeitraum-Navigation",
    "topbar.prevPeriod": "Vorheriger Zeitraum",
    "topbar.currentPeriod": "Zum aktuellen Zeitraum springen",
    "topbar.nextPeriod": "Nächster Zeitraum",
    "topbar.import": "CSV importieren",
    "topbar.importTitle": "Einen Kontoauszug als CSV importieren",
    "topbar.settings": "Budget-Einstellungen öffnen",
    "settings.folder.name": "Budget-Ordner",
    "settings.folder.desc": "Vault-Pfad des Ordners mit Categories/, Accounts/, Budgets/, Transactions/, Settings.md usw.",
    "settings.theme.name": "Design",
    "settings.theme.desc": "Dem Hell-/Dunkelmodus von Obsidian folgen oder die helle bzw. dunkle Airy-Glass-Palette erzwingen.",
    "settings.theme.auto": "Obsidian folgen",
    "settings.theme.dark": "Immer dunkel",
    "settings.theme.light": "Immer hell",
    "settings.palette.name": "Farbpalette",
    "settings.palette.desc": "In welchen Farben das Budget gezeichnet wird. Jede Palette hat ihre eigene helle und dunkle Fassung und ist daher unabhängig von der Design-Einstellung oben.",
    "settings.wizard.name": "Einrichtungsassistent",
    "settings.wizard.desc": "Den Assistenten für den ersten Start erneut ausführen — Ordner, Name, Budgetzeitraum, Währung, Startdateien.",
    "settings.wizard.button": "Einrichtungsassistent starten",
    "settings.startup.name": "Beim Start öffnen",
    "settings.startup.desc": "Die Budget-Ansicht automatisch öffnen, wenn Obsidian startet.",
    "settings.privacy.name": "Datenschutz-Startbildschirm",
    "settings.privacy.desc": "Das Budget mit einem Startbildschirm verdecken, bis du auf „Budget öffnen“ tippst — beim Öffnen und jedes Mal, wenn Obsidian in den Hintergrund wechselt. Vor dem Tippen wird nichts aus dem Vault gelesen.",
    "settings.feedback.name": "Feedback senden",
    "settings.feedback.desc": "Einen Fehler melden, auf ein Problem hinweisen oder eine Funktion wünschen. Öffnet ein Google-Formular in deinem Browser — nichts aus deinem Budget wird angehängt oder gesendet.",
    "settings.feedback.button": "Feedback-Formular öffnen",
    "settings.support.name": "Budget Vault unterstützen",
    "settings.support.desc": "Budget Vault ist kostenlos und bleibt es. Wenn du danke sagen möchtest, öffnet dies PayPal in deinem Browser — völlig freiwillig, und am Plugin ändert sich so oder so nichts.",
    "settings.support.button": "Ein Dankeschön senden",
    "settings.data.name": "Budget-Daten",
    "settings.data.desc": "In Settings.md im Budget-Ordner gespeichert, damit sie auf jedem Gerät gelten.",
    "settings.household.name": "Name / Haushalt",
    "settings.household.desc": "Wird in der Begrüßung der Übersicht und in der Kopfzeile angezeigt. Für keinen leer lassen.",
    "settings.household.placeholder": "Für keinen leer lassen",
    "settings.monthStart.name": "Monatsbeginn",
    "settings.monthStart.desc": "Tag des Monats, an dem jeder Finanzzeitraum beginnt — üblicherweise dein Zahltag. Wähle 1 für einen gewöhnlichen Kalendermonat. 1–28.",
    "settings.monthStart.invalid": "Wähle einen Tag zwischen 1 und 28.",
    "settings.periodLength.name": "Zeitraumlänge",
    "settings.periodLength.desc": "Wie lange jeder Budgetzeitraum läuft. „Monatlich“ nutzt den Monatsbeginn oben. Die anderen Optionen richten die Zeiträume stattdessen an einem Zahlungszyklus aus, gezählt ab dem Datum unten.",
    "settings.anchor.name": "Letzter Zahltag",
    "settings.anchor.desc": "Wann wurdest du zuletzt bezahlt? Jeder kürzliche Zahltag funktioniert — es zählt nur, auf welchen Tag im Zyklus er fällt, ein früherer oder späterer ergibt also dasselbe. Wird ignoriert, wenn die Zeitraumlänge monatlich ist.",
    "settings.anchor.invalid": "Nutze ein echtes Datum im Format JJJJ-MM-TT, z. B. 2026-08-07.",
    "settings.country.name": "Land",
    "settings.country.desc": "Steuert die Betragsformatierung, die Datumsreihenfolge von Kontoauszügen und die Checkliste der Steuer-Ansicht (auf die Steuerbehörde deines Landes zugeschnitten). Bestehende Steuerjahre behalten ihre Daten — nur Beschriftungen und Startwerte für neue Jahre ändern sich. Unabhängig von der Oberflächensprache unten.",
    "settings.language.name": "Sprache",
    "settings.language.desc": "Die Sprache, in der die Oberfläche geschrieben ist. Unabhängig vom Land oben — wo du lebst, entscheidet nicht darüber, was du lesen möchtest. Folgt standardmäßig der Anzeigesprache von Obsidian, mit Englisch als Rückfall. Dein eigener Budgettext — Kategorienamen, Notizen, Kontonamen — wird nie übersetzt.",
    "settings.currency.name": "Währungssymbol",
    "settings.currency.desc": "Wird vor jedem Betrag angezeigt, z. B. R.",
    "settings.currency.invalid": "Gib ein Währungssymbol ein.",
    "settings.budgetsKept": {
      one: "Budget: deine {count} vorhandene Budgetdatei bleibt im Vault. Sie kann bei dieser Zeitraumlänge nicht angezeigt werden und ist sofort wieder da, wenn du die Länge zurückstellst.",
      other: "Budget: deine {count} vorhandenen Budgetdateien bleiben im Vault. Sie können bei dieser Zeitraumlänge nicht angezeigt werden und sind sofort wieder da, wenn du die Länge zurückstellst."
    },
    "settings.anchorReslices": {
      one: "Budget: das verschiebt jede Zeitraumgrenze. {count} nach Datum benannte Budgetdatei passt dann nicht mehr — sie bleibt in deinem Vault, und dieses Datum zurück auf {prev} zu setzen bringt sie sofort wieder.",
      other: "Budget: das verschiebt jede Zeitraumgrenze. {count} nach Datum benannte Budgetdateien passen dann nicht mehr — sie bleiben in deinem Vault, und dieses Datum zurück auf {prev} zu setzen bringt sie sofort wieder."
    },
    "settings.dateNotReal": "Budget: „{value}“ ist kein Datum — nutze die Auswahl oder tippe JJJJ-MM-TT.",
    "wiz.title": "Budget Vault einrichten",
    "wiz.stepOf": "Schritt {n} von {total}",
    "wiz.cancel": "Abbrechen",
    "wiz.back": "Zurück",
    "wiz.next": "Weiter",
    "wiz.letsGo": "Los geht's!",
    "wiz.connectBtn": "Budget verbinden",
    "wiz.createBtn": "Mein Budget erstellen",
    "wiz.skipped": "Einrichtung übersprungen — du kannst sie jederzeit erneut starten über Einstellungen → Budget Vault → Einrichtungsassistent starten, oder über die Befehlspalette.",
    "wiz.step.folder": "Wo dein Budget liegt",
    "wiz.step.name": "Wie sollen wir dich nennen?",
    "wiz.step.country": "Sprache, Land & Währung",
    "wiz.step.period": "Dein Budgetzeitraum",
    "wiz.step.categories": "Deine Budgetkategorien",
    "wiz.step.account": "Dein erstes Konto",
    "wiz.step.finish": "Bereit",
    "wiz.err.folder": "Gib einen Ordnerpfad für das Budget ein — zum Beispiel Finances/Budget.",
    "wiz.err.monthStart": "Der Monatsbeginn muss zwischen 1 und 28 liegen. Nicht jeder Monat hat einen 29., 30. oder 31., wenn du also am letzten Tag des Monats bezahlt wirst, nimm 28.",
    "wiz.err.anchor": "Gib das Datum ein, an dem du zuletzt bezahlt wurdest — jeder Zahlungszyklus wird davon aus gezählt, ohne es fällt das Budget auf monatliche Zeiträume zurück.",
    "wiz.err.currency": "Gib ein Währungssymbol ein oder wähle eines aus der Liste oben.",
    "wiz.welcome.title": "Willkommen bei Budget Vault!",
    "wiz.welcome.intro": "Dein ganzes Budget, direkt hier in deinem Vault als einfaches Markdown — keine Konten, keine Cloud, kein fremder Server. Wenn dein Vault mit deinem Handy synchronisiert, kommt dein Budget gratis mit.",
    "wiz.welcome.planLead": "So ist der Plan — dieser Assistent richtet dich ein:",
    "wiz.welcome.plan1": "Wähle deinen Budget-Ordner — wir legen die ganze Struktur für dich an",
    "wiz.welcome.plan2": "Wähle Sprache, Land & Währung — damit die App richtig liest und Beträge, Daten und Steuerliches richtig aussehen",
    "wiz.welcome.plan3": "Sag uns, wann du bezahlt wirst — deine Budgetzeiträume laufen ab Zahltag, wenn du magst",
    "wiz.welcome.plan4": "Wähle deine Budgetkategorien — hake die an, die zu deinem Leben passen",
    "wiz.welcome.plan5": "Füge dein erstes Konto hinzu — und was gerade darauf ist",
    "wiz.welcome.thenLead": "Dann fängt der spaßige Teil in der App an:",
    "wiz.welcome.app1": "Setze dein Budget — gib jeder Kategorie eine Zahl als Ziel",
    "wiz.welcome.app2": "Importiere die CSV deiner Bank — Transaktionen sortieren sich selbst, während du es ihnen beibringst",
    "wiz.welcome.app3": "Füge jederzeit neue Kategorien hinzu — dein Budget wächst mit dir",
    "wiz.welcome.app4": "Schau unterwegs nach — die Übersicht zeigt genau, wohin das Geld gegangen ist",
    "wiz.welcome.close": "Etwa zwei Minuten Einrichtung. Du kannst alles später ändern. Bereit?",
    "wiz.folder.hint": "Alles liegt als einfache Markdown-Dateien in einem Ordner deines Vaults.",
    "wiz.folder.blank": "Gib einen Ordnerpfad ein — zum Beispiel Finances/Budget.",
    "wiz.folder.found": "In „{folder}“ wurde ein vorhandenes Budget gefunden — der Assistent verbindet sich damit, statt neue Dateien anzulegen.",
    "wiz.folder.exists": "„{folder}“ existiert bereits — die Budgetdateien werden darin angelegt.",
    "wiz.folder.willCreate": "„{folder}“ existiert noch nicht — der Ordner wird für dich angelegt.",
    "wiz.folder.name": "Budget-Ordner",
    "wiz.folder.desc": "Wo die Kategorien, Konten, Budgets und Transaktionen liegen.",
    "wiz.folder.connected": "In „{folder}“ wurde ein vorhandenes Budget gefunden — wir verbinden uns damit, statt neue Dateien anzulegen. Deine Kategorien, Konten und Transaktionen bleiben genau so, wie sie sind; die restlichen Schritte bestätigen nur die Einstellungen aus der dortigen Settings.md.",
    "wiz.name.name": "Dein Name oder Spitzname",
    "wiz.name.desc": "Wird in der Begrüßung der Übersicht und in der Kopfzeile angezeigt. Leer lassen zum Überspringen.",
    "wiz.name.placeholder": "z. B. Alex, oder Familie Schmidt",
    "wiz.language.desc": "Die Sprache, in der die App geschrieben ist. Unabhängig vom Land unten — wo du lebst, entscheidet nicht darüber, was du lesen möchtest. Dein eigener Budgettext wird nie übersetzt.",
    "wiz.country.desc": "Legt die Betragsformatierung fest, die Datumsreihenfolge beim Lesen von Kontoauszügen und die Checkliste der Steuer-Ansicht für die Steuerbehörde deines Landes.",
    "wiz.currency.desc": "Wird vor jedem Betrag angezeigt. Startet bei deinem Land — ändere es, wenn du in etwas anderem budgetierst.",
    "wiz.currency.custom": "Eigenes Symbol",
    "wiz.currency.customPlaceholder": "z. B. CHF",
    "wiz.ccy.rand": "R — Südafrikanischer Rand",
    "wiz.ccy.dollar": "$ — Dollar",
    "wiz.ccy.euro": "€ — Euro",
    "wiz.ccy.pound": "£ — Pfund",
    "wiz.ccy.other": "Andere…",
    "wiz.period.howOften": "Wie oft wirst du bezahlt?",
    "wiz.period.howOftenDesc": "Monatliche Zeiträume werden nach dem Monat benannt und beginnen an dem Tag, den du unten wählst. Die anderen richten sich stattdessen nach einem Zahlungszyklus, gezählt ab deinem letzten Zahltag.",
    "wiz.period.startDay": "An welchem Tag beginnt dein Budgetmonat?",
    "wiz.period.startDayDesc": "Üblicherweise dein Zahltag. Wähle 1 für einen gewöhnlichen Kalendermonat. (1–28)",
    "wiz.period.badDay": "Wähle einen Tag von 1 bis 28. Nicht jeder Monat hat einen 29., 30. oder 31., wenn du also am letzten Tag des Monats bezahlt wirst, nimm 28.",
    "wiz.period.calendarEg": "Ein gewöhnlicher Kalendermonat: jeder Zeitraum läuft vom {first} bis zum Monatsende und ist nach diesem Monat benannt. Gerade bist du in {month}.",
    "wiz.period.paydayEg": "Jeder Zeitraum läuft vom {start} bis zum {end} des Folgemonats und ist nach dem Monat benannt, in dem er endet. Gerade bist du in {month}.",
    "wiz.period.anchorBlank": "Gib das Datum ein, an dem du zuletzt bezahlt wurdest, dann werden die Zeiträume davon aus berechnet.",
    "wiz.period.anchorEg": "Von dort gezählt hat der Zeitraum, in dem du gerade bist, am {date} begonnen. Budgetdateien werden nach diesem Startdatum benannt.",
    "wiz.period.anchorName": "Wann wurdest du zuletzt bezahlt?",
    "wiz.period.anchorDesc": "Jeder kürzliche Zahltag genügt — es zählt nur, wo er im Zyklus liegt, ein früherer oder späterer ergibt also dieselben Zeiträume.",
    "wiz.cats.intro": "Beginne mit einem Satz Budgetkategorien — hake ab, was du nicht willst. Du kannst sie später hinzufügen, umbenennen oder umfärben, hier ist also nichts endgültig.",
    "wiz.cats.selected": "{count} von {total} ausgewählt",
    "wiz.cats.selectAll": "Alle auswählen",
    "wiz.cats.selectNone": "Keine auswählen",
    "wiz.type.income": "Einnahmen",
    "wiz.type.expense": "Alltägliche Ausgaben",
    "wiz.type.debt": "Schuldentilgung",
    "wiz.type.services": "Dienste & Abos",
    "wiz.type.insurance": "Versicherung",
    "wiz.type.giving": "Spenden",
    "wiz.type.savings": "Sparen",
    "wiz.type.investment": "Anlagen",
    "wiz.type.luxuries": "Nice-to-have",
    "wiz.type.transfer": "Umbuchungen",
    "wiz.acct.intro": "Transaktionen werden pro Konto gespeichert. Füge jetzt dein Hauptkonto hinzu, oder lass den Namen leer zum Überspringen — du kannst jederzeit Konten hinzufügen.",
    "wiz.acct.name": "Kontoname",
    "wiz.acct.namePlaceholder": "z. B. Girokonto",
    "wiz.acct.type": "Art",
    "wiz.acct.balance": "Aktueller Kontostand",
    "wiz.acct.balanceDesc": "Optional — was gerade auf dem Konto ist.",
    "wiz.acct.balanceHint": "Nimm den Schlusssaldo deines letzten Auszugs, oder was deine Banking-App anzeigt. Der Kontostand ist eine Momentaufnahme, die du selbst aktuell hältst — nur die neuesten Transaktionen zu importieren bringt ihn nie durcheinander — und du kannst ihn jederzeit ändern, indem du auf der Konten-Seite auf den Kontostand tippst.",
    "wiz.acctType.checking": "Girokonto",
    "wiz.acctType.savings": "Sparkonto",
    "wiz.acctType.credit_card": "Kreditkarte",
    "wiz.acctType.cash": "Bargeld",
    "wiz.acctType.investment": "Anlage",
    "wiz.sum.folder": "Ordner",
    "wiz.sum.name": "Name",
    "wiz.sum.language": "Sprache",
    "wiz.sum.country": "Land",
    "wiz.sum.period": "Budgetzeitraum",
    "wiz.sum.currency": "Währung",
    "wiz.sum.categories": "Kategorien",
    "wiz.sum.account": "Erstes Konto",
    "wiz.sum.opening": "Anfangssaldo",
    "wiz.sum.catCount": {
      one: "{count} Startkategorie",
      other: "{count} Startkategorien"
    },
    "wiz.sum.monthlyCalendar": "Monatlich (Kalendermonat)",
    "wiz.sum.monthlyOn": "Monatlich, beginnend am {day}",
    "wiz.sum.cycleFrom": "{preset}, gezählt ab {date}",
    "wiz.finish.connectLead": "Wir verbinden uns mit dem vorhandenen Budget-Ordner und speichern diese Einstellungen in dessen Settings.md:",
    "wiz.finish.createLead": "Damit werden der Budget-Ordner mit Settings.md, deine Kategorien, die erste Budgetdatei und leere Owed-Money-/Services-Dateien angelegt:",
    "wiz.finish.nextLead": "Was als Nächstes zu tun ist: ",
    "wiz.finish.nextBody": "gib deinen Kategorien auf der Budgets-Seite einen Betrag, und importiere dann die CSV deiner Bank auf der Transaktionen-Seite.",
    "wiz.finish.privacy": "Dein Budget öffnet sich hinter einem Datenschutz-Startbildschirm zum Antippen, damit nichts zu sehen ist, wenn jemand kurz auf deinen Vault schaut. Abschalten unter Einstellungen → Budget Vault → Datenschutz-Startbildschirm.",
    "wiz.done.connected": "Mit deinem Budget-Ordner verbunden.",
    "wiz.done.created": "Budget-Ordner angelegt — willkommen!",
    "wiz.failed": "Einrichtung fehlgeschlagen: {error}",
    "bud.shape.title": "Deine anderen Budgets sind noch da",
    "bud.shape.body": {
      one: "{count} Budgetdatei ist unter einer anderen Zeitraumlänge gespeichert — es ist Budgets/{newest}.md. Sie bleibt in deinem Vault und ist wieder da, sobald du die Zeitraumlänge zurückstellst. Die Beträge beginnen hier leer, weil dieser Zeitraum nicht dieselbe Länge hat wie jener.",
      other: "{count} Budgetdateien sind unter einer anderen Zeitraumlänge gespeichert — die neueste ist Budgets/{newest}.md. Sie bleiben in deinem Vault und sind wieder da, sobald du die Zeitraumlänge zurückstellst. Die Beträge beginnen hier leer, weil dieser Zeitraum nicht dieselbe Länge hat wie jene."
    },
    "bud.shape.bring": "Kategorien und Notizen aus {newest} übernehmen",
    "bud.shape.empty": "Dieses Budget ist leer",
    "bud.shape.brought": {
      one: "{count} Kategorie übernommen — setze den Betrag für diesen Zeitraum",
      other: "{count} Kategorien übernommen — setze die Beträge für diesen Zeitraum"
    },
    "bud.shape.allHere": "Jede Kategorie aus diesem Budget ist bereits hier",
    "bud.total.income": "Einnahmen gesamt",
    "bud.total.incomeNote": "{amount} bisher erhalten",
    "bud.total.budgeted": "Budgetiert gesamt",
    "bud.total.budgetedNote": "{pct}% der budgetierten Einnahmen",
    "bud.total.over": "Überbudgetiert",
    "bud.total.overNote": "mehr budgetiert als eingenommen",
    "bud.total.left": "Noch zu budgetieren",
    "bud.total.leftNote": "Einnahmen noch nicht zugeteilt",
    "bud.total.spent": "Ausgegeben gesamt",
    "bud.total.spentNote": "{pct}% des Budgets verbraucht",
    "bud.col.category": "Kategorie",
    "bud.col.type": "Art",
    "bud.col.amount": "Betrag",
    "bud.col.actual": "Tatsächlich bisher",
    "bud.col.notes": "Notizen",
    "bud.remaining.over": "{amount} darüber",
    "bud.remaining.left": "{amount} übrig",
    "bud.aria.amount": "Budgetbetrag für {category}",
    "bud.aria.notes": "Notizen zu {category}",
    "bud.aria.clear": "Budget für {category} leeren",
    "bud.title.clear": "Diese Kategorie aus der Zeitraumdatei entfernen",
    "bud.aria.delete": "Kategorie {category} löschen",
    "bud.title.delete": "Diese Kategorie überall löschen",
    "bud.saved": "Budget gespeichert unter Budgets/{period}.md",
    "bud.copy.none": "Kein Budget für den vorherigen Zeitraum gefunden",
    "bud.copy.done": {
      one: "{count} Kategorie aus dem vorherigen Zeitraum kopiert",
      other: "{count} Kategorien aus dem vorherigen Zeitraum kopiert"
    },
    "bud.copy.nothing": "Nichts zu kopieren — jede Kategorie hat bereits einen Wert"
  };
});

// src/lang/es.js
var require_es = __commonJS((exports2, module2) => {
  module2.exports = {
    "splash.sub": "Tu presupuesto privado, guardado de forma segura dentro de tu bóveda.",
    "splash.enter": "Abrir presupuesto",
    "nav.menu": "Menú",
    "nav.close": "Cerrar menú",
    "nav.section.budget": "Presupuesto",
    "nav.section.accounts": "Cuentas",
    "nav.section.tools": "Herramientas",
    "nav.dashboard": "Panel",
    "nav.transactions": "Transacciones",
    "nav.budgets": "Presupuesto",
    "nav.savings": "Ahorros e Inversiones",
    "nav.accounts": "Cuentas",
    "nav.assets": "Activos",
    "nav.debts": "Deudas",
    "nav.owed": "Dinero Adeudado",
    "nav.services": "Servicios",
    "nav.tax": "Impuestos",
    "nav.loans": "Calculadoras de Préstamos",
    "nav.import": "Importar CSV",
    "nav.reload": "Recargar desde el disco",
    "nav.pluginSettings": "Ajustes del plugin",
    "topbar.nav": "Navegación del presupuesto",
    "topbar.mainMenu": "Menú principal",
    "topbar.openMenu": "Abrir el menú de navegación",
    "topbar.home": "Ir al Panel",
    "topbar.brandSub": "Presupuesto en la bóveda de Obsidian",
    "topbar.periodNav": "Navegación por periodos",
    "topbar.prevPeriod": "Periodo anterior",
    "topbar.currentPeriod": "Ir al periodo actual",
    "topbar.nextPeriod": "Periodo siguiente",
    "topbar.import": "Importar CSV",
    "topbar.importTitle": "Importar un extracto bancario en CSV",
    "topbar.settings": "Abrir los ajustes del presupuesto",
    "settings.folder.name": "Carpeta del presupuesto",
    "settings.folder.desc": "Ruta en la bóveda de la carpeta que contiene Categories/, Accounts/, Budgets/, Transactions/, Settings.md, etc.",
    "settings.theme.name": "Tema",
    "settings.theme.desc": "Seguir el modo claro/oscuro de Obsidian, o forzar la paleta Airy Glass clara u oscura.",
    "settings.theme.auto": "Seguir a Obsidian",
    "settings.theme.dark": "Siempre oscuro",
    "settings.theme.light": "Siempre claro",
    "settings.palette.name": "Paleta de colores",
    "settings.palette.desc": "Con qué colores se dibuja el presupuesto. Cada paleta tiene su propia versión clara y oscura, así que es independiente del ajuste Tema de arriba.",
    "settings.wizard.name": "Asistente de configuración",
    "settings.wizard.desc": "Volver a ejecutar el asistente de primer uso — carpeta, nombre, periodo del presupuesto, moneda, archivos iniciales.",
    "settings.wizard.button": "Ejecutar el asistente",
    "settings.startup.name": "Abrir al iniciar",
    "settings.startup.desc": "Abrir la vista del presupuesto automáticamente cuando Obsidian arranca.",
    "settings.privacy.name": "Pantalla de privacidad",
    "settings.privacy.desc": "Cubrir el presupuesto con una pantalla hasta que toques «Abrir presupuesto» — al abrirlo, y de nuevo cada vez que Obsidian pase a segundo plano. No se lee nada de la bóveda hasta que toques.",
    "settings.feedback.name": "Enviar comentarios",
    "settings.feedback.desc": "Informar de un error, señalar un problema o pedir una función. Abre un formulario de Google en tu navegador — no se adjunta ni se envía nada de tu presupuesto.",
    "settings.feedback.button": "Abrir el formulario",
    "settings.support.name": "Apoyar a Budget Vault",
    "settings.support.desc": "Budget Vault es gratuito y siempre lo será. Si quieres dar las gracias, esto abre PayPal en tu navegador — totalmente opcional, y en el plugin no cambia nada de una forma u otra.",
    "settings.support.button": "Enviar un agradecimiento",
    "settings.data.name": "Datos del presupuesto",
    "settings.data.desc": "Guardados en Settings.md dentro de la carpeta del presupuesto, para que se apliquen en todos los dispositivos.",
    "settings.household.name": "Nombre / hogar",
    "settings.household.desc": "Se muestra en el saludo del panel y en la barra superior. Déjalo en blanco para ninguno.",
    "settings.household.placeholder": "Déjalo en blanco para ninguno",
    "settings.monthStart.name": "Día de inicio del mes",
    "settings.monthStart.desc": "Día del mes en que empieza cada periodo financiero — normalmente tu día de pago. Elige 1 para un mes natural corriente. 1–28.",
    "settings.monthStart.invalid": "Elige un día entre 1 y 28.",
    "settings.periodLength.name": "Duración del periodo",
    "settings.periodLength.desc": "Cuánto dura cada periodo del presupuesto. «Mensual» usa el día de inicio del mes de arriba. Las demás opciones alinean los periodos con un ciclo de pago, contando desde la fecha de abajo.",
    "settings.anchor.name": "Último día de pago",
    "settings.anchor.desc": "¿Cuándo te pagaron por última vez? Sirve cualquier día de pago reciente — solo importa el día en que cae dentro del ciclo, así que uno anterior o posterior da el mismo resultado. Se ignora cuando la duración del periodo es mensual.",
    "settings.anchor.invalid": "Usa una fecha real con el formato AAAA-MM-DD, p. ej. 2026-08-07.",
    "settings.country.name": "País",
    "settings.country.desc": "Determina el formato de los importes, el orden de las fechas en los extractos bancarios y la lista de comprobación de la vista Impuestos (adaptada a la agencia tributaria de tu país). Los años fiscales existentes conservan sus datos — solo cambian las etiquetas y los valores iniciales de los años nuevos. Independiente del idioma de la interfaz de abajo.",
    "settings.language.name": "Idioma",
    "settings.language.desc": "El idioma en que está escrita la interfaz. Independiente del País de arriba — vivir en un sitio no decide qué quieres leer. Por defecto sigue el idioma de Obsidian, con el inglés como alternativa. Tu propio texto del presupuesto — nombres de categorías, notas, nombres de cuentas — nunca se traduce.",
    "settings.currency.name": "Símbolo de moneda",
    "settings.currency.desc": "Se muestra delante de cada importe, p. ej. R.",
    "settings.currency.invalid": "Introduce un símbolo de moneda.",
    "settings.budgetsKept": {
      one: "Presupuesto: tu {count} archivo de presupuesto existente permanece en la bóveda. No puede mostrarse con esta duración de periodo, y vuelve enseguida si la cambias de nuevo.",
      other: "Presupuesto: tus {count} archivos de presupuesto existentes permanecen en la bóveda. No pueden mostrarse con esta duración de periodo, y vuelven enseguida si la cambias de nuevo."
    },
    "settings.anchorReslices": {
      one: "Presupuesto: esto desplaza cada límite de periodo. {count} archivo de presupuesto con nombre de fecha dejará de coincidir — permanece en tu bóveda, y volver a poner esta fecha en {prev} lo trae enseguida de vuelta.",
      other: "Presupuesto: esto desplaza cada límite de periodo. {count} archivos de presupuesto con nombre de fecha dejarán de coincidir — permanecen en tu bóveda, y volver a poner esta fecha en {prev} los trae enseguida de vuelta."
    },
    "settings.dateNotReal": "Presupuesto: «{value}» no es una fecha — usa el selector, o escribe AAAA-MM-DD.",
    "wiz.title": "Configurar Budget Vault",
    "wiz.stepOf": "Paso {n} de {total}",
    "wiz.cancel": "Cancelar",
    "wiz.back": "Atrás",
    "wiz.next": "Siguiente",
    "wiz.letsGo": "¡Vamos!",
    "wiz.connectBtn": "Conectar presupuesto",
    "wiz.createBtn": "Crear mi presupuesto",
    "wiz.skipped": "Configuración omitida — puedes volver a ejecutarla desde Ajustes → Budget Vault → Ejecutar el asistente, o desde la paleta de comandos.",
    "wiz.step.folder": "Dónde vive tu presupuesto",
    "wiz.step.name": "¿Cómo te llamamos?",
    "wiz.step.country": "Idioma, país y moneda",
    "wiz.step.period": "Tu periodo de presupuesto",
    "wiz.step.categories": "Tus categorías de presupuesto",
    "wiz.step.account": "Tu primera cuenta",
    "wiz.step.finish": "Todo listo",
    "wiz.err.folder": "Introduce una ruta de carpeta para el presupuesto — por ejemplo Finances/Budget.",
    "wiz.err.monthStart": "El día de inicio del mes debe estar entre 1 y 28. No todos los meses tienen 29, 30 o 31, así que si te pagan el último día del mes, usa 28.",
    "wiz.err.anchor": "Introduce la fecha en que te pagaron por última vez — cada ciclo de pago se cuenta desde ahí, así que sin ella el presupuesto vuelve a periodos mensuales.",
    "wiz.err.currency": "Introduce un símbolo de moneda, o elige uno de la lista de arriba.",
    "wiz.welcome.title": "¡Bienvenido a Budget Vault!",
    "wiz.welcome.intro": "Todo tu presupuesto, viviendo aquí mismo en tu bóveda como markdown simple — sin cuentas, sin nube, sin el servidor de nadie más. Si tu bóveda se sincroniza con tu móvil, tu presupuesto viaja con ella gratis.",
    "wiz.welcome.planLead": "Este es el plan — este asistente te deja listo:",
    "wiz.welcome.plan1": "Elige tu carpeta de presupuesto — montamos toda la estructura por ti",
    "wiz.welcome.plan2": "Elige idioma, país y moneda — para que la app se lea bien y los importes, fechas e impuestos tengan buen aspecto",
    "wiz.welcome.plan3": "Dinos cuándo cobras — tus periodos pueden ir de día de pago a día de pago",
    "wiz.welcome.plan4": "Elige tus categorías — marca las que encajen con tu vida",
    "wiz.welcome.plan5": "Añade tu primera cuenta — y lo que hay en ella ahora mismo",
    "wiz.welcome.thenLead": "Y entonces empieza lo bueno dentro de la app:",
    "wiz.welcome.app1": "Fija tu presupuesto — dale a cada categoría una cifra a la que apuntar",
    "wiz.welcome.app2": "Importa el CSV de tu banco — las transacciones se ordenan solas a medida que le enseñas",
    "wiz.welcome.app3": "Añade categorías nuevas cuando quieras — tu presupuesto crece contigo",
    "wiz.welcome.app4": "Revisa sobre la marcha — el panel muestra exactamente adónde fue el dinero",
    "wiz.welcome.close": "Unos dos minutos de configuración. Puedes cambiar cualquier cosa más tarde. ¿Listo?",
    "wiz.folder.hint": "Todo vive como archivos markdown simples dentro de una carpeta de tu bóveda.",
    "wiz.folder.blank": "Introduce una ruta de carpeta — por ejemplo Finances/Budget.",
    "wiz.folder.found": "Se encontró un presupuesto existente en «{folder}» — el asistente se conectará a él en vez de crear archivos nuevos.",
    "wiz.folder.exists": "«{folder}» ya existe — los archivos del presupuesto se añadirán dentro.",
    "wiz.folder.willCreate": "«{folder}» aún no existe — se creará por ti.",
    "wiz.folder.name": "Carpeta del presupuesto",
    "wiz.folder.desc": "Donde se guardan las categorías, cuentas, presupuestos y transacciones.",
    "wiz.folder.connected": "Se encontró un presupuesto existente en «{folder}» — nos conectamos a él en vez de crear archivos nuevos. Tus categorías, cuentas y transacciones se quedan exactamente como están; los pasos restantes solo confirman los ajustes guardados en su Settings.md.",
    "wiz.name.name": "Tu nombre o apodo",
    "wiz.name.desc": "Se muestra en el saludo del panel y en la barra superior. Déjalo en blanco para omitirlo.",
    "wiz.name.placeholder": "p. ej. Alex, o Los García",
    "wiz.language.desc": "El idioma en que está escrita la app. Independiente del país de abajo — dónde vives no decide qué quieres leer. Tu propio texto del presupuesto nunca se traduce.",
    "wiz.country.desc": "Fija el formato de los importes, el orden de las fechas al leer extractos bancarios y la lista de comprobación de la vista Impuestos para la agencia tributaria de tu país.",
    "wiz.currency.desc": "Se muestra delante de cada importe. Parte de tu país — cámbialo si presupuestas en otra cosa.",
    "wiz.currency.custom": "Símbolo personalizado",
    "wiz.currency.customPlaceholder": "p. ej. CHF",
    "wiz.ccy.rand": "R — Rand sudafricano",
    "wiz.ccy.dollar": "$ — Dólar",
    "wiz.ccy.euro": "€ — Euro",
    "wiz.ccy.pound": "£ — Libra",
    "wiz.ccy.other": "Otro…",
    "wiz.period.howOften": "¿Cada cuánto cobras?",
    "wiz.period.howOftenDesc": "Los periodos mensuales se nombran por mes y empiezan el día que elijas abajo. Los demás se alinean con un ciclo de pago, contando desde tu último día de pago.",
    "wiz.period.startDay": "¿Qué día empieza tu mes de presupuesto?",
    "wiz.period.startDayDesc": "Normalmente tu día de pago. Elige 1 para un mes natural corriente. (1–28)",
    "wiz.period.badDay": "Elige un día del 1 al 28. No todos los meses tienen 29, 30 o 31, así que si te pagan el último día del mes, usa 28.",
    "wiz.period.calendarEg": "Un mes natural corriente: cada periodo va del {first} al final del mes, y lleva el nombre de ese mes. Ahora mismo estás en {month}.",
    "wiz.period.paydayEg": "Cada periodo va del {start} al {end} del mes siguiente, y lleva el nombre del mes en que termina. Ahora mismo estás en {month}.",
    "wiz.period.anchorBlank": "Introduce la fecha en que te pagaron por última vez y los periodos se calculan a partir de ahí.",
    "wiz.period.anchorEg": "Contando desde ahí, el periodo en el que estás ahora empezó el {date}. Los archivos de presupuesto se nombran por esa fecha de inicio.",
    "wiz.period.anchorName": "¿Cuándo te pagaron por última vez?",
    "wiz.period.anchorDesc": "Vale cualquier día de pago reciente — solo importa dónde cae dentro del ciclo, así que uno anterior o posterior da los mismos periodos.",
    "wiz.cats.intro": "Empieza con un conjunto de categorías — desmarca las que no quieras. Puedes añadirlas, renombrarlas o cambiarles el color más tarde, así que aquí nada es definitivo.",
    "wiz.cats.selected": "{count} de {total} seleccionadas",
    "wiz.cats.selectAll": "Seleccionar todas",
    "wiz.cats.selectNone": "No seleccionar ninguna",
    "wiz.type.income": "Ingresos",
    "wiz.type.expense": "Gastos del día a día",
    "wiz.type.debt": "Pago de deudas",
    "wiz.type.services": "Servicios y suscripciones",
    "wiz.type.insurance": "Seguros",
    "wiz.type.giving": "Donaciones",
    "wiz.type.savings": "Ahorros",
    "wiz.type.investment": "Inversiones",
    "wiz.type.luxuries": "Caprichos",
    "wiz.type.transfer": "Transferencias",
    "wiz.acct.intro": "Las transacciones se guardan por cuenta. Añade ahora tu cuenta principal, o deja el nombre en blanco para omitirlo — puedes añadir cuentas en cualquier momento.",
    "wiz.acct.name": "Nombre de la cuenta",
    "wiz.acct.namePlaceholder": "p. ej. Cuenta corriente",
    "wiz.acct.type": "Tipo",
    "wiz.acct.balance": "Saldo actual",
    "wiz.acct.balanceDesc": "Opcional — lo que hay en la cuenta ahora mismo.",
    "wiz.acct.balanceHint": "Usa el saldo de cierre de tu último extracto, o lo que muestre la app de tu banco. El saldo es una instantánea que mantienes al día tú mismo — importar solo transacciones recientes nunca lo descuadra — y puedes cambiarlo cuando quieras tocando el saldo en la página Cuentas.",
    "wiz.acctType.checking": "Cuenta corriente",
    "wiz.acctType.savings": "Cuenta de ahorro",
    "wiz.acctType.credit_card": "Tarjeta de crédito",
    "wiz.acctType.cash": "Efectivo",
    "wiz.acctType.investment": "Inversión",
    "wiz.sum.folder": "Carpeta",
    "wiz.sum.name": "Nombre",
    "wiz.sum.language": "Idioma",
    "wiz.sum.country": "País",
    "wiz.sum.period": "Periodo del presupuesto",
    "wiz.sum.currency": "Moneda",
    "wiz.sum.categories": "Categorías",
    "wiz.sum.account": "Primera cuenta",
    "wiz.sum.opening": "Saldo inicial",
    "wiz.sum.catCount": {
      one: "{count} categoría inicial",
      other: "{count} categorías iniciales"
    },
    "wiz.sum.monthlyCalendar": "Mensual (mes natural)",
    "wiz.sum.monthlyOn": "Mensual, empezando el {day}",
    "wiz.sum.cycleFrom": "{preset}, contando desde {date}",
    "wiz.finish.connectLead": "Conectando con la carpeta de presupuesto existente y guardando estos ajustes en su Settings.md:",
    "wiz.finish.createLead": "Esto creará la carpeta del presupuesto con Settings.md, tus categorías, el primer archivo de presupuesto y archivos vacíos de Owed Money / Services:",
    "wiz.finish.nextLead": "Qué hacer ahora: ",
    "wiz.finish.nextBody": "dale un importe a tus categorías en la página Presupuestos, y luego importa el CSV de tu banco en la página Transacciones.",
    "wiz.finish.privacy": "Tu presupuesto se abre tras una pantalla de privacidad que requiere un toque, así que no queda nada a la vista si alguien echa un vistazo a tu bóveda. Desactívala en Ajustes → Budget Vault → Pantalla de privacidad.",
    "wiz.done.connected": "Conectado a tu carpeta de presupuesto.",
    "wiz.done.created": "Carpeta de presupuesto creada — ¡bienvenido!",
    "wiz.failed": "La configuración falló: {error}",
    "bud.shape.title": "Tus otros presupuestos siguen aquí",
    "bud.shape.body": {
      one: "{count} archivo de presupuesto está guardado con otra duración de periodo — es Budgets/{newest}.md. Permanece en tu bóveda y vuelve en cuanto restablezcas la duración. Los importes empiezan en blanco aquí porque este periodo no tiene la misma duración que aquel.",
      other: "{count} archivos de presupuesto están guardados con otra duración de periodo — el más reciente es Budgets/{newest}.md. Permanecen en tu bóveda y vuelven en cuanto restablezcas la duración. Los importes empiezan en blanco aquí porque este periodo no tiene la misma duración que aquellos."
    },
    "bud.shape.bring": "Traer las categorías y notas de {newest}",
    "bud.shape.empty": "Ese presupuesto está vacío",
    "bud.shape.brought": {
      one: "Se trajo {count} categoría — pon el importe para este periodo",
      other: "Se trajeron {count} categorías — pon los importes para este periodo"
    },
    "bud.shape.allHere": "Todas las categorías de ese presupuesto ya están aquí",
    "bud.total.income": "Ingresos totales",
    "bud.total.incomeNote": "{amount} recibido hasta ahora",
    "bud.total.budgeted": "Total presupuestado",
    "bud.total.budgetedNote": "{pct}% de los ingresos presupuestados",
    "bud.total.over": "Presupuestado de más",
    "bud.total.overNote": "presupuestado por encima de los ingresos",
    "bud.total.left": "Por presupuestar",
    "bud.total.leftNote": "ingresos aún sin asignar",
    "bud.total.spent": "Total gastado",
    "bud.total.spentNote": "{pct}% del presupuesto usado",
    "bud.col.category": "Categoría",
    "bud.col.type": "Tipo",
    "bud.col.amount": "Importe",
    "bud.col.actual": "Real hasta ahora",
    "bud.col.notes": "Notas",
    "bud.remaining.over": "{amount} de más",
    "bud.remaining.left": "{amount} restante",
    "bud.aria.amount": "Importe presupuestado para {category}",
    "bud.aria.notes": "Notas de {category}",
    "bud.aria.clear": "Vaciar el presupuesto de {category}",
    "bud.title.clear": "Quitar esta categoría del archivo del periodo",
    "bud.aria.delete": "Eliminar la categoría {category}",
    "bud.title.delete": "Eliminar esta categoría en todas partes",
    "bud.saved": "Presupuesto guardado en Budgets/{period}.md",
    "bud.copy.none": "No se encontró presupuesto del periodo anterior",
    "bud.copy.done": {
      one: "Copiada {count} categoría del periodo anterior",
      other: "Copiadas {count} categorías del periodo anterior"
    },
    "bud.copy.nothing": "Nada que copiar — todas las categorías ya tienen un valor"
  };
});

// src/lang/fr.js
var require_fr = __commonJS((exports2, module2) => {
  module2.exports = {
    "splash.sub": "Votre budget privé, conservé en sécurité dans votre coffre.",
    "splash.enter": "Ouvrir le budget",
    "nav.menu": "Menu",
    "nav.close": "Fermer le menu",
    "nav.section.budget": "Budget",
    "nav.section.accounts": "Comptes",
    "nav.section.tools": "Outils",
    "nav.dashboard": "Tableau de bord",
    "nav.transactions": "Transactions",
    "nav.budgets": "Budget",
    "nav.savings": "Épargne et Placements",
    "nav.accounts": "Comptes",
    "nav.assets": "Actifs",
    "nav.debts": "Dettes",
    "nav.owed": "Sommes Dues",
    "nav.services": "Services",
    "nav.tax": "Impôts",
    "nav.loans": "Calculateurs de Prêt",
    "nav.import": "Importer un CSV",
    "nav.reload": "Recharger depuis le disque",
    "nav.pluginSettings": "Paramètres du plugin",
    "topbar.nav": "Navigation du budget",
    "topbar.mainMenu": "Menu principal",
    "topbar.openMenu": "Ouvrir le menu de navigation",
    "topbar.home": "Aller au tableau de bord",
    "topbar.brandSub": "Budget dans le coffre Obsidian",
    "topbar.periodNav": "Navigation par période",
    "topbar.prevPeriod": "Période précédente",
    "topbar.currentPeriod": "Aller à la période actuelle",
    "topbar.nextPeriod": "Période suivante",
    "topbar.import": "Importer un CSV",
    "topbar.importTitle": "Importer un relevé bancaire au format CSV",
    "topbar.settings": "Ouvrir les paramètres du budget",
    "settings.folder.name": "Dossier du budget",
    "settings.folder.desc": "Chemin dans le coffre du dossier contenant Categories/, Accounts/, Budgets/, Transactions/, Settings.md, etc.",
    "settings.theme.name": "Thème",
    "settings.theme.desc": "Suivre le mode clair/sombre d'Obsidian, ou forcer la palette Airy Glass claire ou sombre.",
    "settings.theme.auto": "Suivre Obsidian",
    "settings.theme.dark": "Toujours sombre",
    "settings.theme.light": "Toujours clair",
    "settings.palette.name": "Palette de couleurs",
    "settings.palette.desc": "Les couleurs dans lesquelles le budget est dessiné. Chaque palette a sa propre version claire et sombre, elle est donc indépendante du paramètre Thème ci-dessus.",
    "settings.wizard.name": "Assistant de configuration",
    "settings.wizard.desc": "Relancer l'assistant de première utilisation — dossier, nom, période budgétaire, devise, fichiers de départ.",
    "settings.wizard.button": "Lancer l'assistant",
    "settings.startup.name": "Ouvrir au démarrage",
    "settings.startup.desc": "Ouvrir la vue budget automatiquement au démarrage d'Obsidian.",
    "settings.privacy.name": "Écran de confidentialité",
    "settings.privacy.desc": "Couvrir le budget d'un écran jusqu'à ce que vous touchiez « Ouvrir le budget » — à l'ouverture, et de nouveau chaque fois qu'Obsidian passe en arrière-plan. Rien n'est lu depuis le coffre avant que vous ne touchiez.",
    "settings.feedback.name": "Envoyer un retour",
    "settings.feedback.desc": "Signaler un bug, remonter un problème ou demander une fonctionnalité. Ouvre un formulaire Google dans votre navigateur — rien de votre budget n'est joint ni envoyé.",
    "settings.feedback.button": "Ouvrir le formulaire",
    "settings.support.name": "Soutenir Budget Vault",
    "settings.support.desc": "Budget Vault est gratuit et le restera. Si vous souhaitez dire merci, ceci ouvre PayPal dans votre navigateur — entièrement facultatif, et rien ne change dans le plugin dans un cas comme dans l'autre.",
    "settings.support.button": "Envoyer un merci",
    "settings.data.name": "Données du budget",
    "settings.data.desc": "Stockées dans Settings.md à l'intérieur du dossier du budget, afin de s'appliquer sur chaque appareil.",
    "settings.household.name": "Nom / foyer",
    "settings.household.desc": "Affiché dans le message d'accueil du tableau de bord et la barre supérieure. Laissez vide pour aucun.",
    "settings.household.placeholder": "Laissez vide pour aucun",
    "settings.monthStart.name": "Jour de début du mois",
    "settings.monthStart.desc": "Jour du mois où commence chaque période financière — généralement votre jour de paie. Choisissez 1 pour un mois calendaire ordinaire. 1–28.",
    "settings.monthStart.invalid": "Choisissez un jour entre 1 et 28.",
    "settings.periodLength.name": "Durée de la période",
    "settings.periodLength.desc": "La durée de chaque période budgétaire. « Mensuel » utilise le jour de début du mois ci-dessus. Les autres options alignent plutôt les périodes sur un cycle de paie, comptées à partir de la date ci-dessous.",
    "settings.anchor.name": "Dernier jour de paie",
    "settings.anchor.desc": "Quand avez-vous été payé pour la dernière fois ? N'importe quel jour de paie récent convient — seul compte le jour où il tombe dans le cycle, un plus tôt ou un plus tard donne donc le même résultat. Ignoré lorsque la durée de la période est mensuelle.",
    "settings.anchor.invalid": "Utilisez une date réelle au format AAAA-MM-JJ, par ex. 2026-08-07.",
    "settings.country.name": "Pays",
    "settings.country.desc": "Détermine le formatage des montants, l'ordre des dates des relevés bancaires et la liste de contrôle de la vue Impôts (adaptée à l'administration fiscale de votre pays). Les années fiscales existantes conservent leurs données — seuls les libellés et les valeurs initiales des nouvelles années changent. Indépendant de la langue de l'interface ci-dessous.",
    "settings.language.name": "Langue",
    "settings.language.desc": "La langue dans laquelle l'interface est écrite. Indépendante du Pays ci-dessus — vivre quelque part ne décide pas de ce que vous voulez lire. Suit par défaut la langue d'affichage d'Obsidian, avec l'anglais en repli. Votre propre texte de budget — noms de catégories, notes, noms de comptes — n'est jamais traduit.",
    "settings.currency.name": "Symbole monétaire",
    "settings.currency.desc": "Affiché devant chaque montant, par ex. R.",
    "settings.currency.invalid": "Saisissez un symbole monétaire.",
    "settings.budgetsKept": {
      one: "Budget : votre {count} fichier de budget existant reste dans le coffre. Il ne peut pas être affiché avec cette durée de période, et il revient aussitôt si vous la remettez comme avant.",
      other: "Budget : vos {count} fichiers de budget existants restent dans le coffre. Ils ne peuvent pas être affichés avec cette durée de période, et ils reviennent aussitôt si vous la remettez comme avant."
    },
    "settings.anchorReslices": {
      one: "Budget : ceci décale chaque limite de période. {count} fichier de budget nommé par date ne correspondra plus — il reste dans votre coffre, et remettre cette date à {prev} le ramène aussitôt.",
      other: "Budget : ceci décale chaque limite de période. {count} fichiers de budget nommés par date ne correspondront plus — ils restent dans votre coffre, et remettre cette date à {prev} les ramène aussitôt."
    },
    "settings.dateNotReal": "Budget : « {value} » n'est pas une date — utilisez le sélecteur, ou saisissez AAAA-MM-JJ.",
    "wiz.title": "Configurer Budget Vault",
    "wiz.stepOf": "Étape {n} sur {total}",
    "wiz.cancel": "Annuler",
    "wiz.back": "Retour",
    "wiz.next": "Suivant",
    "wiz.letsGo": "C'est parti !",
    "wiz.connectBtn": "Connecter le budget",
    "wiz.createBtn": "Créer mon budget",
    "wiz.skipped": "Configuration ignorée — vous pouvez la relancer depuis Paramètres → Budget Vault → Lancer l'assistant, ou la palette de commandes.",
    "wiz.step.folder": "Où vit votre budget",
    "wiz.step.name": "Comment vous appeler ?",
    "wiz.step.country": "Langue, pays et devise",
    "wiz.step.period": "Votre période budgétaire",
    "wiz.step.categories": "Vos catégories budgétaires",
    "wiz.step.account": "Votre premier compte",
    "wiz.step.finish": "Prêt à démarrer",
    "wiz.err.folder": "Saisissez un chemin de dossier pour le budget — par exemple Finances/Budget.",
    "wiz.err.monthStart": "Le jour de début du mois doit être compris entre 1 et 28. Tous les mois n'ont pas de 29, 30 ou 31, donc si vous êtes payé le dernier jour du mois, prenez 28.",
    "wiz.err.anchor": "Saisissez la date de votre dernière paie — chaque cycle est compté à partir d'elle, sans quoi le budget revient à des périodes mensuelles.",
    "wiz.err.currency": "Saisissez un symbole monétaire, ou choisissez-en un dans la liste ci-dessus.",
    "wiz.welcome.title": "Bienvenue dans Budget Vault !",
    "wiz.welcome.intro": "Tout votre budget, ici même dans votre coffre, en markdown brut — pas de comptes, pas de cloud, pas le serveur de quelqu'un d'autre. Si votre coffre se synchronise avec votre téléphone, votre budget suit gratuitement.",
    "wiz.welcome.planLead": "Voici le plan — cet assistant vous met en place :",
    "wiz.welcome.plan1": "Choisissez votre dossier de budget — nous créons toute la structure pour vous",
    "wiz.welcome.plan2": "Choisissez langue, pays et devise — pour que l'application se lise bien et que montants, dates et fiscalité soient corrects",
    "wiz.welcome.plan3": "Dites-nous quand vous êtes payé — vos périodes peuvent partir du jour de paie",
    "wiz.welcome.plan4": "Choisissez vos catégories — cochez celles qui correspondent à votre vie",
    "wiz.welcome.plan5": "Ajoutez votre premier compte — et ce qu'il contient maintenant",
    "wiz.welcome.thenLead": "Ensuite, les choses sérieuses commencent dans l'application :",
    "wiz.welcome.app1": "Fixez votre budget — donnez à chaque catégorie un montant à viser",
    "wiz.welcome.app2": "Importez le CSV de votre banque — les transactions se rangent seules à mesure que vous lui apprenez",
    "wiz.welcome.app3": "Ajoutez de nouvelles catégories quand vous voulez — votre budget grandit avec vous",
    "wiz.welcome.app4": "Faites le point au fil de l'eau — le tableau de bord montre exactement où est passé l'argent",
    "wiz.welcome.close": "Environ deux minutes de configuration. Vous pourrez tout changer plus tard. Prêt ?",
    "wiz.folder.hint": "Tout vit sous forme de fichiers markdown bruts dans un dossier de votre coffre.",
    "wiz.folder.blank": "Saisissez un chemin de dossier — par exemple Finances/Budget.",
    "wiz.folder.found": "Un budget existant a été trouvé dans « {folder} » — l'assistant s'y connectera plutôt que de créer de nouveaux fichiers.",
    "wiz.folder.exists": "« {folder} » existe déjà — les fichiers du budget y seront ajoutés.",
    "wiz.folder.willCreate": "« {folder} » n'existe pas encore — il sera créé pour vous.",
    "wiz.folder.name": "Dossier du budget",
    "wiz.folder.desc": "Où sont conservés les catégories, comptes, budgets et transactions.",
    "wiz.folder.connected": "Un budget existant a été trouvé dans « {folder} » — nous nous y connectons plutôt que de créer de nouveaux fichiers. Vos catégories, comptes et transactions restent exactement tels quels ; les étapes restantes ne font que confirmer les paramètres conservés dans son Settings.md.",
    "wiz.name.name": "Votre nom ou surnom",
    "wiz.name.desc": "Affiché dans le message d'accueil du tableau de bord et la barre supérieure. Laissez vide pour passer.",
    "wiz.name.placeholder": "par ex. Alex, ou Famille Dupont",
    "wiz.language.desc": "La langue dans laquelle l'application est écrite. Indépendante du pays ci-dessous — l'endroit où vous vivez ne décide pas de ce que vous voulez lire. Votre propre texte de budget n'est jamais traduit.",
    "wiz.country.desc": "Détermine le formatage des montants, l'ordre des dates à la lecture des relevés bancaires et la liste de contrôle de la vue Impôts pour l'administration fiscale de votre pays.",
    "wiz.currency.desc": "Affiché devant chaque montant. Part de votre pays — changez-le si vous budgétez dans autre chose.",
    "wiz.currency.custom": "Symbole personnalisé",
    "wiz.currency.customPlaceholder": "par ex. CHF",
    "wiz.ccy.rand": "R — Rand sud-africain",
    "wiz.ccy.dollar": "$ — Dollar",
    "wiz.ccy.euro": "€ — Euro",
    "wiz.ccy.pound": "£ — Livre",
    "wiz.ccy.other": "Autre…",
    "wiz.period.howOften": "À quelle fréquence êtes-vous payé ?",
    "wiz.period.howOftenDesc": "Les périodes mensuelles portent le nom du mois et commencent le jour choisi ci-dessous. Les autres s'alignent plutôt sur un cycle de paie, compté depuis votre dernier jour de paie.",
    "wiz.period.startDay": "Quel jour commence votre mois budgétaire ?",
    "wiz.period.startDayDesc": "Généralement votre jour de paie. Choisissez 1 pour un mois calendaire ordinaire. (1–28)",
    "wiz.period.badDay": "Choisissez un jour de 1 à 28. Tous les mois n'ont pas de 29, 30 ou 31, donc si vous êtes payé le dernier jour du mois, prenez 28.",
    "wiz.period.calendarEg": "Un mois calendaire ordinaire : chaque période va du {first} à la fin du mois, et porte le nom de ce mois. Vous êtes actuellement en {month}.",
    "wiz.period.paydayEg": "Chaque période va du {start} au {end} du mois suivant, et porte le nom du mois où elle se termine. Vous êtes actuellement en {month}.",
    "wiz.period.anchorBlank": "Saisissez la date de votre dernière paie et les périodes en découleront.",
    "wiz.period.anchorEg": "À partir de là, la période dans laquelle vous êtes actuellement a commencé le {date}. Les fichiers de budget portent le nom de cette date de début.",
    "wiz.period.anchorName": "Quand avez-vous été payé pour la dernière fois ?",
    "wiz.period.anchorDesc": "N'importe quel jour de paie récent convient — seule compte sa place dans le cycle, un plus tôt ou un plus tard donne donc les mêmes périodes.",
    "wiz.cats.intro": "Commencez avec un jeu de catégories — décochez celles dont vous ne voulez pas. Vous pourrez en ajouter, les renommer ou les recolorer plus tard, rien n'est définitif ici.",
    "wiz.cats.selected": "{count} sur {total} sélectionnées",
    "wiz.cats.selectAll": "Tout sélectionner",
    "wiz.cats.selectNone": "Tout désélectionner",
    "wiz.type.income": "Revenus",
    "wiz.type.expense": "Dépenses courantes",
    "wiz.type.debt": "Remboursements de dettes",
    "wiz.type.services": "Services et abonnements",
    "wiz.type.insurance": "Assurance",
    "wiz.type.giving": "Dons",
    "wiz.type.savings": "Épargne",
    "wiz.type.investment": "Placements",
    "wiz.type.luxuries": "Petits plaisirs",
    "wiz.type.transfer": "Virements",
    "wiz.acct.intro": "Les transactions sont stockées par compte. Ajoutez votre compte principal maintenant, ou laissez le nom vide pour passer — vous pourrez ajouter des comptes à tout moment.",
    "wiz.acct.name": "Nom du compte",
    "wiz.acct.namePlaceholder": "par ex. Compte courant",
    "wiz.acct.type": "Type",
    "wiz.acct.balance": "Solde actuel",
    "wiz.acct.balanceDesc": "Facultatif — ce qu'il y a sur le compte en ce moment.",
    "wiz.acct.balanceHint": "Utilisez le solde de clôture de votre dernier relevé, ou ce qu'affiche l'application de votre banque. Le solde est un instantané que vous tenez à jour vous-même — n'importer que les transactions récentes ne le fausse jamais — et vous pouvez le changer à tout moment en touchant le solde sur la page Comptes.",
    "wiz.acctType.checking": "Compte courant",
    "wiz.acctType.savings": "Compte d'épargne",
    "wiz.acctType.credit_card": "Carte de crédit",
    "wiz.acctType.cash": "Espèces",
    "wiz.acctType.investment": "Placement",
    "wiz.sum.folder": "Dossier",
    "wiz.sum.name": "Nom",
    "wiz.sum.language": "Langue",
    "wiz.sum.country": "Pays",
    "wiz.sum.period": "Période budgétaire",
    "wiz.sum.currency": "Devise",
    "wiz.sum.categories": "Catégories",
    "wiz.sum.account": "Premier compte",
    "wiz.sum.opening": "Solde d'ouverture",
    "wiz.sum.catCount": {
      one: "{count} catégorie de départ",
      other: "{count} catégories de départ"
    },
    "wiz.sum.monthlyCalendar": "Mensuel (mois calendaire)",
    "wiz.sum.monthlyOn": "Mensuel, à partir du {day}",
    "wiz.sum.cycleFrom": "{preset}, compté depuis le {date}",
    "wiz.finish.connectLead": "Connexion au dossier de budget existant et enregistrement de ces paramètres dans son Settings.md :",
    "wiz.finish.createLead": "Ceci créera le dossier du budget avec Settings.md, vos catégories, le premier fichier de budget et des fichiers Owed Money / Services vides :",
    "wiz.finish.nextLead": "Que faire ensuite : ",
    "wiz.finish.nextBody": "donnez un montant à vos catégories sur la page Budgets, puis importez le CSV de votre banque sur la page Transactions.",
    "wiz.finish.privacy": "Votre budget s'ouvre derrière un écran de confidentialité à toucher, ainsi rien n'est visible si quelqu'un jette un œil à votre coffre. Désactivez-le dans Paramètres → Budget Vault → Écran de confidentialité.",
    "wiz.done.connected": "Connecté à votre dossier de budget.",
    "wiz.done.created": "Dossier de budget créé — bienvenue !",
    "wiz.failed": "Échec de la configuration : {error}",
    "bud.shape.title": "Vos autres budgets sont toujours là",
    "bud.shape.body": {
      one: "{count} fichier de budget est enregistré sous une autre durée de période — il s'agit de Budgets/{newest}.md. Il reste dans votre coffre et revient dès que vous rétablissez la durée. Les montants partent vides ici parce que cette période n'a pas la même durée que celle-là.",
      other: "{count} fichiers de budget sont enregistrés sous une autre durée de période — le plus récent est Budgets/{newest}.md. Ils restent dans votre coffre et reviennent dès que vous rétablissez la durée. Les montants partent vides ici parce que cette période n'a pas la même durée que celles-là."
    },
    "bud.shape.bring": "Reprendre les catégories et les notes de {newest}",
    "bud.shape.empty": "Ce budget est vide",
    "bud.shape.brought": {
      one: "{count} catégorie reprise — indiquez le montant pour cette période",
      other: "{count} catégories reprises — indiquez les montants pour cette période"
    },
    "bud.shape.allHere": "Toutes les catégories de ce budget sont déjà ici",
    "bud.total.income": "Revenus totaux",
    "bud.total.incomeNote": "{amount} reçu jusqu'ici",
    "bud.total.budgeted": "Total budgété",
    "bud.total.budgetedNote": "{pct}% des revenus budgétés",
    "bud.total.over": "Sur-budgété",
    "bud.total.overNote": "budgété au-delà des revenus",
    "bud.total.left": "Reste à budgéter",
    "bud.total.leftNote": "revenus pas encore affectés",
    "bud.total.spent": "Total dépensé",
    "bud.total.spentNote": "{pct}% du budget utilisé",
    "bud.col.category": "Catégorie",
    "bud.col.type": "Type",
    "bud.col.amount": "Montant",
    "bud.col.actual": "Réel à ce jour",
    "bud.col.notes": "Notes",
    "bud.remaining.over": "{amount} de dépassement",
    "bud.remaining.left": "{amount} restant",
    "bud.aria.amount": "Montant budgété pour {category}",
    "bud.aria.notes": "Notes de {category}",
    "bud.aria.clear": "Vider le budget de {category}",
    "bud.title.clear": "Retirer cette catégorie du fichier de la période",
    "bud.aria.delete": "Supprimer la catégorie {category}",
    "bud.title.delete": "Supprimer cette catégorie partout",
    "bud.saved": "Budget enregistré dans Budgets/{period}.md",
    "bud.copy.none": "Aucun budget trouvé pour la période précédente",
    "bud.copy.done": {
      one: "{count} catégorie copiée depuis la période précédente",
      other: "{count} catégories copiées depuis la période précédente"
    },
    "bud.copy.nothing": "Rien à copier — chaque catégorie a déjà une valeur"
  };
});

// src/lang/ja.js
var require_ja = __commonJS((exports2, module2) => {
  module2.exports = {
    "splash.sub": "あなただけの予算を、保管庫の中に安全に保管します。",
    "splash.enter": "予算を開く",
    "nav.menu": "メニュー",
    "nav.close": "メニューを閉じる",
    "nav.section.budget": "予算",
    "nav.section.accounts": "口座",
    "nav.section.tools": "ツール",
    "nav.dashboard": "ダッシュボード",
    "nav.transactions": "取引",
    "nav.budgets": "予算",
    "nav.savings": "貯蓄と投資",
    "nav.accounts": "口座",
    "nav.assets": "資産",
    "nav.debts": "負債",
    "nav.owed": "貸したお金",
    "nav.services": "サービス",
    "nav.tax": "税金",
    "nav.loans": "ローン計算機",
    "nav.import": "CSV を取り込む",
    "nav.reload": "ディスクから再読み込み",
    "nav.pluginSettings": "プラグイン設定",
    "topbar.nav": "予算ナビゲーション",
    "topbar.mainMenu": "メインメニュー",
    "topbar.openMenu": "ナビゲーションメニューを開く",
    "topbar.home": "ダッシュボードへ移動",
    "topbar.brandSub": "Obsidian 保管庫の予算",
    "topbar.periodNav": "期間ナビゲーション",
    "topbar.prevPeriod": "前の期間",
    "topbar.currentPeriod": "現在の期間へ移動",
    "topbar.nextPeriod": "次の期間",
    "topbar.import": "CSV を取り込む",
    "topbar.importTitle": "銀行明細の CSV を取り込む",
    "topbar.settings": "予算の設定を開く",
    "settings.folder.name": "予算フォルダ",
    "settings.folder.desc": "Categories/、Accounts/、Budgets/、Transactions/、Settings.md などを格納しているフォルダの保管庫内パス。",
    "settings.theme.name": "テーマ",
    "settings.theme.desc": "Obsidian のライト/ダークモードに従うか、Airy Glass のダークまたはライトのパレットを固定します。",
    "settings.theme.auto": "Obsidian に従う",
    "settings.theme.dark": "常にダーク",
    "settings.theme.light": "常にライト",
    "settings.palette.name": "カラーパレット",
    "settings.palette.desc": "予算を描画する色。各パレットはライト版とダーク版の両方を持つため、上のテーマ設定とは独立しています。",
    "settings.wizard.name": "セットアップウィザード",
    "settings.wizard.desc": "初回起動時のウィザードをもう一度実行します — フォルダ、名前、予算期間、通貨、初期ファイル。",
    "settings.wizard.button": "セットアップウィザードを実行",
    "settings.startup.name": "起動時に開く",
    "settings.startup.desc": "Obsidian の起動時に予算ビューを自動的に開きます。",
    "settings.privacy.name": "プライバシー画面",
    "settings.privacy.desc": "「予算を開く」をタップするまで予算を覆い隠します — 開いたとき、および Obsidian がバックグラウンドに移るたびに表示されます。タップするまで保管庫からは何も読み込まれません。",
    "settings.feedback.name": "フィードバックを送る",
    "settings.feedback.desc": "不具合の報告、問題の指摘、機能の要望。ブラウザで Google フォームを開きます — 予算の内容が添付されたり送信されたりすることはありません。",
    "settings.feedback.button": "フィードバックフォームを開く",
    "settings.support.name": "Budget Vault を支援する",
    "settings.support.desc": "Budget Vault は無料で、これからもずっと無料です。お礼を伝えたい場合は、ブラウザで PayPal を開きます — 完全に任意で、どちらの場合もプラグインの動作は変わりません。",
    "settings.support.button": "お礼を送る",
    "settings.data.name": "予算データ",
    "settings.data.desc": "予算フォルダ内の Settings.md に保存され、すべてのデバイスに適用されます。",
    "settings.household.name": "名前 / 世帯",
    "settings.household.desc": "ダッシュボードの挨拶と上部バーに表示されます。不要な場合は空欄にしてください。",
    "settings.household.placeholder": "不要な場合は空欄に",
    "settings.monthStart.name": "月の開始日",
    "settings.monthStart.desc": "各会計期間が始まる日 — 通常は給料日です。通常の暦月にする場合は 1 を選びます。1〜28。",
    "settings.monthStart.invalid": "1 から 28 の間の日を選んでください。",
    "settings.periodLength.name": "期間の長さ",
    "settings.periodLength.desc": "各予算期間の長さ。「毎月」は上の月の開始日を使います。その他の選択肢では、下の日付から数えて給与サイクルに合わせて期間を区切ります。",
    "settings.anchor.name": "最後の給料日",
    "settings.anchor.desc": "最後に給与を受け取ったのはいつですか。最近の給料日であればどれでも構いません — サイクル内のどの日に当たるかだけが重要なので、それより前でも後でも同じ結果になります。期間の長さが毎月の場合は無視されます。",
    "settings.anchor.invalid": "YYYY-MM-DD 形式の実在する日付を入力してください（例: 2026-08-07）。",
    "settings.country.name": "国",
    "settings.country.desc": "金額の表示形式、銀行明細の日付順、税金ビューのチェックリスト（お住まいの国の税務当局に合わせたもの）を決めます。既存の税年度のデータはそのまま残り、変わるのはラベルと新しい年度の初期値だけです。下のインターフェース言語とは独立しています。",
    "settings.language.name": "言語",
    "settings.language.desc": "インターフェースを表示する言語。上の「国」とは独立しています — どこに住んでいるかが、何を読みたいかを決めるわけではありません。既定では Obsidian の表示言語に従い、対応がなければ英語になります。カテゴリ名、メモ、口座名など、あなた自身が書いた予算のテキストが翻訳されることはありません。",
    "settings.currency.name": "通貨記号",
    "settings.currency.desc": "すべての金額の前に表示されます（例: R）。",
    "settings.currency.invalid": "通貨記号を入力してください。",
    "settings.budgetsKept": {
      other: "予算: 既存の予算ファイル {count} 件は保管庫に残ります。この期間の長さでは表示できませんが、設定を元に戻せばすぐに再び表示されます。"
    },
    "settings.anchorReslices": {
      other: "予算: これによりすべての期間の区切りがずれます。日付で名付けられた予算ファイル {count} 件が一致しなくなります — ファイルは保管庫に残り、この日付を {prev} に戻せばすぐに元どおりになります。"
    },
    "settings.dateNotReal": "予算: 「{value}」は日付ではありません — 日付選択を使うか、YYYY-MM-DD 形式で入力してください。",
    "wiz.title": "Budget Vault をセットアップ",
    "wiz.stepOf": "ステップ {n} / {total}",
    "wiz.cancel": "キャンセル",
    "wiz.back": "戻る",
    "wiz.next": "次へ",
    "wiz.letsGo": "はじめる",
    "wiz.connectBtn": "予算に接続",
    "wiz.createBtn": "予算を作成",
    "wiz.skipped": "セットアップをスキップしました — 設定 → Budget Vault → セットアップウィザードを実行、またはコマンドパレットからいつでも実行できます。",
    "wiz.step.folder": "予算を置く場所",
    "wiz.step.name": "お名前は？",
    "wiz.step.country": "言語・国・通貨",
    "wiz.step.period": "予算期間",
    "wiz.step.categories": "予算のカテゴリ",
    "wiz.step.account": "最初の口座",
    "wiz.step.finish": "準備完了",
    "wiz.err.folder": "予算のフォルダパスを入力してください — 例: Finances/Budget。",
    "wiz.err.monthStart": "月の開始日は 1 から 28 の間で指定してください。29 日、30 日、31 日がない月もあるため、月末に給与を受け取る場合は 28 を使ってください。",
    "wiz.err.anchor": "最後に給与を受け取った日付を入力してください — 給与サイクルはそこから数えるため、入力がないと予算は毎月の期間に戻ります。",
    "wiz.err.currency": "通貨記号を入力するか、上のリストから選んでください。",
    "wiz.welcome.title": "Budget Vault へようこそ",
    "wiz.welcome.intro": "予算のすべてが、ただのマークダウンとしてこの保管庫の中に置かれます — アカウントもクラウドも、誰か他人のサーバーも不要です。保管庫がスマートフォンと同期していれば、予算もそのまま一緒に持ち歩けます。",
    "wiz.welcome.planLead": "流れはこうです — このウィザードで準備が整います:",
    "wiz.welcome.plan1": "予算フォルダを選ぶ — 構成一式はこちらで用意します",
    "wiz.welcome.plan2": "言語・国・通貨を選ぶ — 表示が読みやすくなり、金額・日付・税金の扱いも正しくなります",
    "wiz.welcome.plan3": "給料日を教える — お望みなら予算期間を給料日始まりにできます",
    "wiz.welcome.plan4": "予算のカテゴリを選ぶ — 自分の生活に合うものにチェックを入れてください",
    "wiz.welcome.plan5": "最初の口座を追加する — 今の残高もあわせて",
    "wiz.welcome.thenLead": "そのあとはアプリでの楽しい部分です:",
    "wiz.welcome.app1": "予算を決める — カテゴリごとに目標額を入れます",
    "wiz.welcome.app2": "銀行の CSV を取り込む — 使いながら教えるほど、取引が自動で仕分けされます",
    "wiz.welcome.app3": "いつでもカテゴリを追加できます — 予算はあなたに合わせて育ちます",
    "wiz.welcome.app4": "折にふれて振り返る — ダッシュボードがお金の行き先をそのまま示します",
    "wiz.welcome.close": "セットアップは 2 分ほどです。あとからいつでも変更できます。よろしいですか。",
    "wiz.folder.hint": "すべては保管庫内の 1 つのフォルダに、ただのマークダウンファイルとして置かれます。",
    "wiz.folder.blank": "フォルダパスを入力してください — 例: Finances/Budget。",
    "wiz.folder.found": "「{folder}」に既存の予算が見つかりました — 新しくファイルを作らず、そちらに接続します。",
    "wiz.folder.exists": "「{folder}」はすでに存在します — 予算ファイルはその中に追加されます。",
    "wiz.folder.willCreate": "「{folder}」はまだ存在しません — こちらで作成します。",
    "wiz.folder.name": "予算フォルダ",
    "wiz.folder.desc": "カテゴリ、口座、予算、取引を保管する場所です。",
    "wiz.folder.connected": "「{folder}」に既存の予算が見つかりました — 新しくファイルを作らず、そちらに接続します。カテゴリ、口座、取引はそのまま残ります。残りのステップでは、その Settings.md に保存されている設定を確認するだけです。",
    "wiz.name.name": "お名前またはニックネーム",
    "wiz.name.desc": "ダッシュボードの挨拶と上部バーに表示されます。空欄のままにすればスキップできます。",
    "wiz.name.placeholder": "例: アレックス、田中家",
    "wiz.language.desc": "アプリを表示する言語です。下の「国」とは独立しています — どこに住んでいるかが、何を読みたいかを決めるわけではありません。あなた自身が書いた予算のテキストが翻訳されることはありません。",
    "wiz.country.desc": "金額の表示形式、銀行明細を読むときの日付順、そしてお住まいの国の税務当局に合わせた税金ビューの申告チェックリストを決めます。",
    "wiz.currency.desc": "すべての金額の前に表示されます。国に応じた既定値から始まります — 別の通貨で予算を組む場合は変更してください。",
    "wiz.currency.custom": "カスタム記号",
    "wiz.currency.customPlaceholder": "例: CHF",
    "wiz.ccy.rand": "R — 南アフリカランド",
    "wiz.ccy.dollar": "$ — ドル",
    "wiz.ccy.euro": "€ — ユーロ",
    "wiz.ccy.pound": "£ — ポンド",
    "wiz.ccy.other": "その他…",
    "wiz.period.howOften": "給与の頻度は？",
    "wiz.period.howOftenDesc": "毎月の期間は月名で呼ばれ、下で選んだ日から始まります。その他は、最後の給料日から数えて給与サイクルに合わせます。",
    "wiz.period.startDay": "予算上の月は何日から始まりますか？",
    "wiz.period.startDayDesc": "通常は給料日です。普通の暦月にする場合は 1 を選びます。(1〜28)",
    "wiz.period.badDay": "1 から 28 の間で日を選んでください。29 日、30 日、31 日がない月もあるため、月末に給与を受け取る場合は 28 を使ってください。",
    "wiz.period.calendarEg": "普通の暦月です: 各期間は{first}から月末までで、その月の名前が付きます。現在は {month} です。",
    "wiz.period.paydayEg": "各期間は{start}から翌月の{end}までで、終わる月の名前が付きます。現在は {month} です。",
    "wiz.period.anchorBlank": "最後に給与を受け取った日付を入力すると、そこから期間が計算されます。",
    "wiz.period.anchorEg": "そこから数えると、現在の期間は {date} に始まりました。予算ファイルはその開始日で名前が付きます。",
    "wiz.period.anchorName": "最後に給与を受け取ったのはいつですか？",
    "wiz.period.anchorDesc": "最近の給料日ならどれでも構いません — サイクル内のどこに当たるかだけが重要なので、それより前でも後でも同じ期間になります。",
    "wiz.cats.intro": "まずは予算カテゴリの一式から始めます — 不要なものはチェックを外してください。あとから追加・名前の変更・色の変更ができるので、ここで決めたことは最終ではありません。",
    "wiz.cats.selected": "{total} 件中 {count} 件を選択",
    "wiz.cats.selectAll": "すべて選択",
    "wiz.cats.selectNone": "選択を解除",
    "wiz.type.income": "収入",
    "wiz.type.expense": "日常の支出",
    "wiz.type.debt": "借入の返済",
    "wiz.type.services": "サービスとサブスクリプション",
    "wiz.type.insurance": "保険",
    "wiz.type.giving": "寄付",
    "wiz.type.savings": "貯蓄",
    "wiz.type.investment": "投資",
    "wiz.type.luxuries": "あると嬉しいもの",
    "wiz.type.transfer": "振替",
    "wiz.acct.intro": "取引は口座ごとに保存されます。主に使う口座を今追加するか、名前を空欄のままにしてスキップしてください — 口座はいつでも追加できます。",
    "wiz.acct.name": "口座名",
    "wiz.acct.namePlaceholder": "例: 普通預金口座",
    "wiz.acct.type": "種類",
    "wiz.acct.balance": "現在の残高",
    "wiz.acct.balanceDesc": "任意 — 現在その口座にある金額です。",
    "wiz.acct.balanceHint": "直近の明細の期末残高か、銀行アプリに表示されている金額を使ってください。残高はご自身で最新に保つスナップショットです — 最近の取引だけを取り込んでもずれることはありません — 口座ページで残高をタップすればいつでも変更できます。",
    "wiz.acctType.checking": "普通預金・当座預金口座",
    "wiz.acctType.savings": "貯蓄口座",
    "wiz.acctType.credit_card": "クレジットカード",
    "wiz.acctType.cash": "現金",
    "wiz.acctType.investment": "投資",
    "wiz.sum.folder": "フォルダ",
    "wiz.sum.name": "名前",
    "wiz.sum.language": "言語",
    "wiz.sum.country": "国",
    "wiz.sum.period": "予算期間",
    "wiz.sum.currency": "通貨",
    "wiz.sum.categories": "カテゴリ",
    "wiz.sum.account": "最初の口座",
    "wiz.sum.opening": "開始残高",
    "wiz.sum.catCount": {
      other: "初期カテゴリ {count} 件"
    },
    "wiz.sum.monthlyCalendar": "毎月（暦月）",
    "wiz.sum.monthlyOn": "毎月、{day}から開始",
    "wiz.sum.cycleFrom": "{preset}、{date} から起算",
    "wiz.finish.connectLead": "既存の予算フォルダに接続し、以下の設定をその Settings.md に保存します:",
    "wiz.finish.createLead": "予算フォルダを作成し、Settings.md、カテゴリ、最初の予算ファイル、空の Owed Money / Services ファイルを用意します:",
    "wiz.finish.nextLead": "次にすること: ",
    "wiz.finish.nextBody": "予算ページでカテゴリに金額を設定し、取引ページで銀行の CSV を取り込んでください。",
    "wiz.finish.privacy": "予算はタップして入るプライバシー画面の後ろで開くので、誰かが保管庫をちらりと見ても中身は表示されません。設定 → Budget Vault → プライバシー画面 でオフにできます。",
    "wiz.done.connected": "予算フォルダに接続しました。",
    "wiz.done.created": "予算フォルダを作成しました — ようこそ！",
    "wiz.failed": "セットアップに失敗しました: {error}",
    "bud.shape.title": "他の予算はそのまま残っています",
    "bud.shape.body": {
      other: "別の期間の長さで保存された予算ファイルが {count} 件あります — 最新のものは Budgets/{newest}.md です。保管庫にはそのまま残っており、期間の長さを元に戻せばまた表示されます。この期間はそれらとは長さが違うため、金額は空の状態から始まります。"
    },
    "bud.shape.bring": "{newest} からカテゴリとメモを引き継ぐ",
    "bud.shape.empty": "その予算は空です",
    "bud.shape.brought": {
      other: "カテゴリを {count} 件引き継ぎました — この期間の金額を設定してください"
    },
    "bud.shape.allHere": "その予算のカテゴリはすべてすでにここにあります",
    "bud.total.income": "収入合計",
    "bud.total.incomeNote": "これまでに {amount} を受け取りました",
    "bud.total.budgeted": "予算合計",
    "bud.total.budgetedNote": "予算収入の {pct}%",
    "bud.total.over": "予算超過",
    "bud.total.overNote": "収入を超えて予算を組んでいます",
    "bud.total.left": "未配分",
    "bud.total.leftNote": "まだ配分していない収入",
    "bud.total.spent": "支出合計",
    "bud.total.spentNote": "予算の {pct}% を使用",
    "bud.col.category": "カテゴリ",
    "bud.col.type": "種類",
    "bud.col.amount": "金額",
    "bud.col.actual": "実績",
    "bud.col.notes": "メモ",
    "bud.remaining.over": "{amount} 超過",
    "bud.remaining.left": "残り {amount}",
    "bud.aria.amount": "{category} の予算額",
    "bud.aria.notes": "{category} のメモ",
    "bud.aria.clear": "{category} の予算を消去",
    "bud.title.clear": "この期間のファイルからこのカテゴリを外す",
    "bud.aria.delete": "カテゴリ {category} を削除",
    "bud.title.delete": "このカテゴリをすべての場所から削除",
    "bud.saved": "予算を Budgets/{period}.md に保存しました",
    "bud.copy.none": "前の期間の予算が見つかりません",
    "bud.copy.done": {
      other: "前の期間から {count} 件のカテゴリをコピーしました"
    },
    "bud.copy.nothing": "コピーするものがありません — すべてのカテゴリにすでに値があります"
  };
});

// src/lang/zh.js
var require_zh = __commonJS((exports2, module2) => {
  module2.exports = {
    "splash.sub": "你的私人预算，安全地保存在你的仓库中。",
    "splash.enter": "进入预算",
    "nav.menu": "菜单",
    "nav.close": "关闭菜单",
    "nav.section.budget": "预算",
    "nav.section.accounts": "账户",
    "nav.section.tools": "工具",
    "nav.dashboard": "仪表板",
    "nav.transactions": "交易",
    "nav.budgets": "预算",
    "nav.savings": "储蓄与投资",
    "nav.accounts": "账户",
    "nav.assets": "资产",
    "nav.debts": "债务",
    "nav.owed": "应收款项",
    "nav.services": "服务",
    "nav.tax": "税务",
    "nav.loans": "贷款计算器",
    "nav.import": "导入 CSV",
    "nav.reload": "从磁盘重新加载",
    "nav.pluginSettings": "插件设置",
    "topbar.nav": "预算导航",
    "topbar.mainMenu": "主菜单",
    "topbar.openMenu": "打开导航菜单",
    "topbar.home": "前往仪表板",
    "topbar.brandSub": "Obsidian 仓库预算",
    "topbar.periodNav": "周期导航",
    "topbar.prevPeriod": "上一周期",
    "topbar.currentPeriod": "跳到当前周期",
    "topbar.nextPeriod": "下一周期",
    "topbar.import": "导入 CSV",
    "topbar.importTitle": "导入银行对账单 CSV",
    "topbar.settings": "打开预算设置",
    "settings.folder.name": "预算文件夹",
    "settings.folder.desc": "存放 Categories/、Accounts/、Budgets/、Transactions/、Settings.md 等内容的文件夹在仓库中的路径。",
    "settings.theme.name": "主题",
    "settings.theme.desc": "跟随 Obsidian 的浅色/深色模式，或强制使用 Airy Glass 的深色或浅色配色。",
    "settings.theme.auto": "跟随 Obsidian",
    "settings.theme.dark": "始终深色",
    "settings.theme.light": "始终浅色",
    "settings.palette.name": "配色方案",
    "settings.palette.desc": "预算界面使用的颜色。每套配色都有各自的浅色和深色版本，因此与上面的主题设置相互独立。",
    "settings.wizard.name": "设置向导",
    "settings.wizard.desc": "重新运行首次启动向导 — 文件夹、名称、预算周期、货币、初始文件。",
    "settings.wizard.button": "运行设置向导",
    "settings.startup.name": "启动时打开",
    "settings.startup.desc": "Obsidian 启动时自动打开预算视图。",
    "settings.privacy.name": "隐私启动屏",
    "settings.privacy.desc": "在你点击「进入预算」之前用启动屏遮住预算 — 打开时如此，Obsidian 每次切到后台后也是如此。在你点击之前不会从仓库读取任何内容。",
    "settings.feedback.name": "发送反馈",
    "settings.feedback.desc": "报告缺陷、反映问题或提出功能建议。会在浏览器中打开一个 Google 表单 — 不会附带或发送你预算中的任何内容。",
    "settings.feedback.button": "打开反馈表单",
    "settings.support.name": "支持 Budget Vault",
    "settings.support.desc": "Budget Vault 是免费的，并且会一直免费。如果你想表达谢意，这会在浏览器中打开 PayPal — 完全自愿，无论如何插件都不会有任何变化。",
    "settings.support.button": "送上一份谢意",
    "settings.data.name": "预算数据",
    "settings.data.desc": "保存在预算文件夹内的 Settings.md 中，因此在每台设备上都生效。",
    "settings.household.name": "名称 / 家庭",
    "settings.household.desc": "显示在仪表板的问候语和顶部栏中。留空则不显示。",
    "settings.household.placeholder": "留空则不显示",
    "settings.monthStart.name": "每月起始日",
    "settings.monthStart.desc": "每个财务周期开始的日期 — 通常是你的发薪日。选择 1 表示普通的自然月。1–28。",
    "settings.monthStart.invalid": "请选择 1 到 28 之间的某一天。",
    "settings.periodLength.name": "周期长度",
    "settings.periodLength.desc": "每个预算周期的长度。「每月」使用上面的每月起始日。其他选项则从下面的日期开始计算，把周期与发薪周期对齐。",
    "settings.anchor.name": "上次发薪日",
    "settings.anchor.desc": "你上一次领薪是什么时候？任何近期的发薪日都可以 — 只有它落在周期中的哪一天才有影响，因此早一些或晚一些结果相同。当周期长度为每月时会被忽略。",
    "settings.anchor.invalid": "请使用真实日期，格式为 YYYY-MM-DD，例如 2026-08-07。",
    "settings.country.name": "国家/地区",
    "settings.country.desc": "决定金额格式、银行对账单的日期顺序，以及税务视图的清单（针对你所在国家/地区的税务机关）。已有的纳税年度会保留其数据 — 只有标签和新年度的初始值会变化。与下面的界面语言相互独立。",
    "settings.language.name": "语言",
    "settings.language.desc": "界面所使用的语言。与上面的国家/地区相互独立 — 住在哪里并不决定你想读什么。默认跟随 Obsidian 自身的显示语言，没有对应语言时回退到英语。你自己写的预算内容 — 分类名称、备注、账户名称 — 永远不会被翻译。",
    "settings.currency.name": "货币符号",
    "settings.currency.desc": "显示在每个金额之前，例如 R。",
    "settings.currency.invalid": "请输入货币符号。",
    "settings.budgetsKept": {
      other: "预算：你现有的 {count} 个预算文件仍保留在仓库中。它们无法在当前的周期长度下显示，但只要改回原来的设置就会立即恢复。"
    },
    "settings.anchorReslices": {
      other: "预算：这会移动每一个周期的边界。以日期命名的 {count} 个预算文件将不再匹配 — 它们仍保留在你的仓库中，把这个日期改回 {prev} 就会立即恢复。"
    },
    "settings.dateNotReal": "预算：「{value}」不是日期 — 请使用日期选择器，或输入 YYYY-MM-DD。",
    "wiz.title": "设置 Budget Vault",
    "wiz.stepOf": "第 {n} 步，共 {total} 步",
    "wiz.cancel": "取消",
    "wiz.back": "上一步",
    "wiz.next": "下一步",
    "wiz.letsGo": "开始吧！",
    "wiz.connectBtn": "连接预算",
    "wiz.createBtn": "创建我的预算",
    "wiz.skipped": "已跳过设置 — 你可以随时从「设置 → Budget Vault → 运行设置向导」或命令面板重新运行。",
    "wiz.step.folder": "预算存放的位置",
    "wiz.step.name": "我们怎么称呼你？",
    "wiz.step.country": "语言、国家/地区与货币",
    "wiz.step.period": "你的预算周期",
    "wiz.step.categories": "你的预算分类",
    "wiz.step.account": "你的第一个账户",
    "wiz.step.finish": "准备就绪",
    "wiz.err.folder": "请输入预算的文件夹路径 — 例如 Finances/Budget。",
    "wiz.err.monthStart": "每月起始日必须在 1 到 28 之间。并非每个月都有 29、30 或 31 日，因此如果你在月末发薪，请使用 28。",
    "wiz.err.anchor": "请输入你上次领薪的日期 — 每个发薪周期都从这里开始计算，缺少它预算就会退回到按月周期。",
    "wiz.err.currency": "请输入货币符号，或从上面的列表中选择一个。",
    "wiz.welcome.title": "欢迎使用 Budget Vault！",
    "wiz.welcome.intro": "你的整份预算，就以纯 markdown 的形式存放在这个仓库里 — 无需账号、不上云、也不经过别人的服务器。如果你的仓库会同步到手机，预算也会一并带上。",
    "wiz.welcome.planLead": "计划是这样的 — 这个向导会帮你准备好:",
    "wiz.welcome.plan1": "选择预算文件夹 — 整个结构由我们为你搭建",
    "wiz.welcome.plan2": "选择语言、国家/地区与货币 — 让界面读起来顺畅，金额、日期和税务也都正确",
    "wiz.welcome.plan3": "告诉我们你的发薪时间 — 如果你愿意，预算周期可以从发薪日开始",
    "wiz.welcome.plan4": "选择预算分类 — 勾选适合你生活的那些",
    "wiz.welcome.plan5": "添加第一个账户 — 以及它当前的余额",
    "wiz.welcome.thenLead": "接下来就是应用里有意思的部分了:",
    "wiz.welcome.app1": "设定预算 — 给每个分类一个努力的目标金额",
    "wiz.welcome.app2": "导入银行 CSV — 你教得越多，交易就越会自动归类",
    "wiz.welcome.app3": "随时添加新分类 — 预算会跟着你一起成长",
    "wiz.welcome.app4": "边走边回顾 — 仪表板会清楚地显示钱花到哪里去了",
    "wiz.welcome.close": "大约两分钟即可设置完成。之后随时都能修改。准备好了吗？",
    "wiz.folder.hint": "所有内容都以纯 markdown 文件的形式存放在仓库的一个文件夹里。",
    "wiz.folder.blank": "请输入文件夹路径 — 例如 Finances/Budget。",
    "wiz.folder.found": "在「{folder}」中找到了已有的预算 — 向导会连接到它，而不是创建新文件。",
    "wiz.folder.exists": "「{folder}」已存在 — 预算文件将添加到其中。",
    "wiz.folder.willCreate": "「{folder}」尚不存在 — 我们会为你创建。",
    "wiz.folder.name": "预算文件夹",
    "wiz.folder.desc": "存放分类、账户、预算和交易的位置。",
    "wiz.folder.connected": "在「{folder}」中找到了已有的预算 — 我们会连接到它，而不是创建新文件。你的分类、账户和交易都会原样保留；接下来的步骤只是确认其 Settings.md 中保存的设置。",
    "wiz.name.name": "你的名字或昵称",
    "wiz.name.desc": "显示在仪表板的问候语和顶部栏中。留空即可跳过。",
    "wiz.name.placeholder": "例如：小明，或者「张家」",
    "wiz.language.desc": "应用界面使用的语言。与下面的国家/地区相互独立 — 住在哪里并不决定你想读什么。你自己写的预算内容永远不会被翻译。",
    "wiz.country.desc": "决定金额格式、读取银行对账单时的日期顺序，以及税务视图中针对你所在国家/地区税务机关的申报清单。",
    "wiz.currency.desc": "显示在每个金额之前。默认取自你的国家/地区 — 如果你用其他货币记账，请自行更改。",
    "wiz.currency.custom": "自定义符号",
    "wiz.currency.customPlaceholder": "例如：CHF",
    "wiz.ccy.rand": "R — 南非兰特",
    "wiz.ccy.dollar": "$ — 美元",
    "wiz.ccy.euro": "€ — 欧元",
    "wiz.ccy.pound": "£ — 英镑",
    "wiz.ccy.other": "其他…",
    "wiz.period.howOften": "你多久领一次薪？",
    "wiz.period.howOftenDesc": "按月的周期以月份命名，并从你在下面选择的日期开始。其他选项则从上次发薪日算起，与发薪周期对齐。",
    "wiz.period.startDay": "你的预算月从哪一天开始？",
    "wiz.period.startDayDesc": "通常是你的发薪日。选择 1 表示普通的自然月。(1–28)",
    "wiz.period.badDay": "请选择 1 到 28 之间的某一天。并非每个月都有 29、30 或 31 日，因此如果你在月末发薪，请使用 28。",
    "wiz.period.calendarEg": "普通的自然月：每个周期从 {first} 到月末，并以该月份命名。你现在处于 {month}。",
    "wiz.period.paydayEg": "每个周期从 {start} 到次月 {end}，并以结束所在的月份命名。你现在处于 {month}。",
    "wiz.period.anchorBlank": "输入你上次领薪的日期，周期就会据此推算出来。",
    "wiz.period.anchorEg": "从那天算起，你当前所处的周期开始于 {date}。预算文件会以该起始日期命名。",
    "wiz.period.anchorName": "你上一次领薪是什么时候？",
    "wiz.period.anchorDesc": "任何近期的发薪日都可以 — 只有它落在周期中的位置才有影响，因此早一些或晚一些得到的周期相同。",
    "wiz.cats.intro": "先从一组预算分类开始 — 不需要的可以取消勾选。之后还能添加、重命名或改颜色，所以这里没有什么是定死的。",
    "wiz.cats.selected": "已选择 {count} / {total}",
    "wiz.cats.selectAll": "全选",
    "wiz.cats.selectNone": "全不选",
    "wiz.type.income": "收入",
    "wiz.type.expense": "日常开支",
    "wiz.type.debt": "偿还债务",
    "wiz.type.services": "服务与订阅",
    "wiz.type.insurance": "保险",
    "wiz.type.giving": "捐赠",
    "wiz.type.savings": "储蓄",
    "wiz.type.investment": "投资",
    "wiz.type.luxuries": "锦上添花",
    "wiz.type.transfer": "转账",
    "wiz.acct.intro": "交易按账户分别存放。现在添加你的主要账户，或把名称留空以跳过 — 你随时都可以添加账户。",
    "wiz.acct.name": "账户名称",
    "wiz.acct.namePlaceholder": "例如：活期账户",
    "wiz.acct.type": "类型",
    "wiz.acct.balance": "当前余额",
    "wiz.acct.balanceDesc": "可选 — 该账户当前的金额。",
    "wiz.acct.balanceHint": "可以使用最近一期对账单的期末余额，或银行 App 上显示的金额。余额是一份由你自己保持更新的快照 — 只导入最近的交易并不会让它出错 — 你随时可以在账户页面点击余额来修改它。",
    "wiz.acctType.checking": "活期/支票账户",
    "wiz.acctType.savings": "储蓄账户",
    "wiz.acctType.credit_card": "信用卡",
    "wiz.acctType.cash": "现金",
    "wiz.acctType.investment": "投资",
    "wiz.sum.folder": "文件夹",
    "wiz.sum.name": "名称",
    "wiz.sum.language": "语言",
    "wiz.sum.country": "国家/地区",
    "wiz.sum.period": "预算周期",
    "wiz.sum.currency": "货币",
    "wiz.sum.categories": "分类",
    "wiz.sum.account": "第一个账户",
    "wiz.sum.opening": "期初余额",
    "wiz.sum.catCount": {
      other: "{count} 个初始分类"
    },
    "wiz.sum.monthlyCalendar": "按月（自然月）",
    "wiz.sum.monthlyOn": "按月，从 {day} 开始",
    "wiz.sum.cycleFrom": "{preset}，自 {date} 起算",
    "wiz.finish.connectLead": "将连接到已有的预算文件夹，并把这些设置保存到它的 Settings.md 中:",
    "wiz.finish.createLead": "这会创建预算文件夹，并生成 Settings.md、你的分类、第一个预算文件，以及空的 Owed Money / Services 文件:",
    "wiz.finish.nextLead": "接下来该做什么: ",
    "wiz.finish.nextBody": "先在预算页面为各个分类填上金额，然后在交易页面导入银行的 CSV。",
    "wiz.finish.privacy": "你的预算会在一个需要点击进入的隐私屏后面打开，这样别人瞥一眼你的仓库也看不到任何内容。可在「设置 → Budget Vault → 隐私启动屏」中关闭。",
    "wiz.done.connected": "已连接到你的预算文件夹。",
    "wiz.done.created": "预算文件夹已创建 — 欢迎！",
    "wiz.failed": "设置失败: {error}",
    "bud.shape.title": "你的其他预算都还在",
    "bud.shape.body": {
      other: "有 {count} 个预算文件保存在另一种周期长度下 — 最新的是 Budgets/{newest}.md。它们仍保留在你的仓库中，只要把周期长度改回去就会重新出现。这里的金额从空白开始，因为本周期与那些周期的长度不同。"
    },
    "bud.shape.bring": "从 {newest} 带入分类和备注",
    "bud.shape.empty": "那份预算是空的",
    "bud.shape.brought": {
      other: "已带入 {count} 个分类 — 请为本周期填上金额"
    },
    "bud.shape.allHere": "那份预算中的分类都已经在这里了",
    "bud.total.income": "收入合计",
    "bud.total.incomeNote": "目前已收到 {amount}",
    "bud.total.budgeted": "预算合计",
    "bud.total.budgetedNote": "占预算收入的 {pct}%",
    "bud.total.over": "超出预算",
    "bud.total.overNote": "预算超过了收入",
    "bud.total.left": "待分配",
    "bud.total.leftNote": "尚未分配的收入",
    "bud.total.spent": "支出合计",
    "bud.total.spentNote": "已用预算的 {pct}%",
    "bud.col.category": "分类",
    "bud.col.type": "类型",
    "bud.col.amount": "金额",
    "bud.col.actual": "实际已发生",
    "bud.col.notes": "备注",
    "bud.remaining.over": "超出 {amount}",
    "bud.remaining.left": "剩余 {amount}",
    "bud.aria.amount": "{category} 的预算金额",
    "bud.aria.notes": "{category} 的备注",
    "bud.aria.clear": "清除 {category} 的预算",
    "bud.title.clear": "把这个分类从本周期的文件中移除",
    "bud.aria.delete": "删除分类 {category}",
    "bud.title.delete": "在所有位置删除这个分类",
    "bud.saved": "预算已保存到 Budgets/{period}.md",
    "bud.copy.none": "找不到上一周期的预算",
    "bud.copy.done": {
      other: "已从上一周期复制 {count} 个分类"
    },
    "bud.copy.nothing": "没有可复制的内容 — 每个分类都已有数值"
  };
});

// src/i18n.js
var require_i18n = __commonJS((exports2, module2) => {
  var en = require_en();
  var af = require_af();
  var de = require_de();
  var es = require_es();
  var fr = require_fr();
  var ja = require_ja();
  var zh = require_zh();
  var TABLES = { en, af, de, es, fr, ja, zh };
  var LANGUAGE_NAMES = {
    en: "English",
    af: "Afrikaans",
    de: "Deutsch",
    es: "Español",
    fr: "Français",
    ja: "日本語",
    zh: "中文"
  };
  var LANGUAGE_ORDER = ["en", "af", "de", "es", "fr", "ja", "zh"].filter((id) => TABLES[id]);
  var ONE_FORM = new Set(["zh", "ja"]);
  var ZERO_IS_SINGULAR = new Set(["fr"]);
  function pluralCategory(lang, n) {
    const count = Math.abs(Number(n) || 0);
    if (ONE_FORM.has(lang))
      return "other";
    if (ZERO_IS_SINGULAR.has(lang))
      return count < 2 ? "one" : "other";
    return count === 1 ? "one" : "other";
  }
  var ORDINAL_DAY = {
    en: (n) => {
      const s = ["th", "st", "nd", "rd"];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    },
    af: (n) => n + (n === 1 || n === 8 || n >= 20 ? "ste" : "de"),
    de: (n) => n + ".",
    es: (n) => String(n),
    fr: (n) => n + (n === 1 ? "er" : ""),
    ja: (n) => n + "日",
    zh: (n) => n + " 日"
  };
  function ordinalDay(lang, n) {
    const fn = ORDINAL_DAY[lang] || ORDINAL_DAY.en;
    return fn(Number(n));
  }
  function day(n) {
    return ordinalDay(current, n);
  }
  var current = defaultLanguage();
  function resolveLanguage(code) {
    const id = (code || "").toString().trim().toLowerCase();
    return TABLES[id] ? id : "en";
  }
  function setLanguage(code) {
    current = resolveLanguage(code);
    return current;
  }
  function currentLanguage() {
    return current;
  }
  function defaultLanguage() {
    const base = (v) => (v || "").toString().trim().toLowerCase().split(/[-_]/)[0];
    try {
      const obsidian = base(window.localStorage.getItem("language"));
      if (TABLES[obsidian])
        return obsidian;
    } catch (e) {}
    try {
      const nav = base(navigator.language);
      if (TABLES[nav])
        return nav;
    } catch (e) {}
    return "en";
  }
  var PLACEHOLDER = /\{(\w+)\}/g;
  function interpolate(s, params) {
    if (!params || typeof s !== "string")
      return s;
    return s.replace(PLACEHOLDER, (whole, name) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole);
  }
  function lookup(lang, key, count) {
    const table = TABLES[lang];
    if (!table)
      return;
    const v = table[key];
    if (v === undefined || v === null)
      return;
    if (typeof v === "string")
      return v;
    const cat = pluralCategory(lang, count);
    return v[cat] !== undefined ? v[cat] : v.other;
  }
  function t(key, params) {
    const count = params && params.count;
    let s = lookup(current, key, count);
    if (s === undefined && current !== "en")
      s = lookup("en", key, count);
    if (s === undefined)
      return key;
    return interpolate(s, params);
  }
  var DOM_BINDINGS = [
    ["data-i18n", null],
    ["data-i18n-aria", "aria-label"],
    ["data-i18n-title", "title"],
    ["data-i18n-placeholder", "placeholder"]
  ];
  function applyDom(root) {
    if (!root || !root.querySelectorAll)
      return;
    for (const [attr, target] of DOM_BINDINGS) {
      root.querySelectorAll("[" + attr + "]").forEach((node) => {
        const s = t(node.getAttribute(attr));
        if (target)
          node.setAttribute(target, s);
        else
          node.textContent = s;
      });
    }
  }
  module2.exports = {
    t,
    setLanguage,
    currentLanguage,
    resolveLanguage,
    defaultLanguage,
    pluralCategory,
    ordinalDay,
    day,
    applyDom,
    TABLES,
    LANGUAGE_NAMES,
    LANGUAGE_ORDER
  };
});

// src/dates.js
var require_dates = __commonJS((exports2, module2) => {
  var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  function isoOf(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function todayIso() {
    return isoOf(new Date);
  }
  function isoDayNumber(iso) {
    const [y, m, d] = String(iso).split("-").map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
  }
  function isoFromDayNumber(n) {
    const d = new Date(n * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  function isRealIsoDate(s) {
    if (typeof s !== "string" || !ISO_DATE.test(s))
      return false;
    const [y, m, d] = s.split("-").map(Number);
    const t = Date.UTC(y, m - 1, d);
    if (!Number.isFinite(t))
      return false;
    const back = new Date(t);
    return back.getUTCFullYear() === y && back.getUTCMonth() + 1 === m && back.getUTCDate() === d;
  }
  var MIN_PERIOD_DAYS = 7;
  var MAX_PERIOD_DAYS = 31;
  function periodDaysOrZero(v) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n < MIN_PERIOD_DAYS || n > MAX_PERIOD_DAYS)
      return 0;
    return n;
  }
  module2.exports = { ISO_DATE, isoOf, todayIso, isoDayNumber, isoFromDayNumber, isRealIsoDate, periodDaysOrZero };
});

// src/dom.js
var require_dom = __commonJS((exports2, module2) => {
  var { setIcon } = require("obsidian");
  var { ISO_DATE } = require_dates();
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
  function kpiTiles(container) {
    container.empty();
    return (label, value, cls, sub) => {
      const t = el("div", { class: "mini" }, el("div", { class: "l" }, label), el("div", { class: `v num ${cls || ""}` }, value));
      if (sub)
        t.append(el("div", { class: "s" }, sub));
      container.append(t);
      return t;
    };
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
  module2.exports = { el, dateInput, keepScroll, setIco, icoEl, kpiTiles, setInert };
});

// src/shell.js
var require_shell = __commonJS((exports2, module2) => {
  var SHELL_HTML = `
  <div class="splash-gate hidden" id="splashGate" role="group" aria-labelledby="gateTitle">
    <div class="splash-inner">
      <div class="splash-logo" aria-hidden="true"><span class="ico" data-ico="wallet|banknote|coins"></span></div>
      <h1 class="splash-title" id="gateTitle">Budget Vault</h1>
      <p class="splash-sub" data-i18n="splash.sub">Your private budget, kept safely inside your vault.</p>
      <button type="button" class="btn-gradient splash-btn" id="gateEnter" data-i18n="splash.enter">Enter budget</button>
    </div>
  </div>

  <div class="drawer-overlay" id="drawerOverlay"></div>

  <nav class="app-drawer" id="appDrawer" aria-label="Main menu" data-i18n-aria="topbar.mainMenu" inert>
    <div class="drawer-head">
      <b data-i18n="nav.menu">Menu</b>
      <button type="button" class="drawer-close" aria-label="Close menu" data-i18n-aria="nav.close" id="drawerClose"><span class="ico" data-ico="x"></span></button>
    </div>

    <div class="drawer-section-label" data-i18n="nav.section.budget">Budget</div>
    <button class="drawer-link" data-view="dashboard" aria-current="page">
      <span class="di"><span class="ico" data-ico="layout-dashboard"></span></span><span data-i18n="nav.dashboard">Dashboard</span>
    </button>
    <button class="drawer-link" data-view="transactions">
      <span class="di"><span class="ico" data-ico="arrow-left-right"></span></span><span data-i18n="nav.transactions">Transactions</span>
    </button>
    <button class="drawer-link" data-view="budgets">
      <span class="di"><span class="ico" data-ico="bookmark"></span></span><span data-i18n="nav.budgets">Budget</span>
    </button>

    <div class="drawer-divider"></div>

    <div class="drawer-section-label" data-i18n="nav.section.accounts">Accounts</div>
    <button class="drawer-link" data-view="savings">
      <span class="di"><span class="ico" data-ico="piggy-bank"></span></span><span data-i18n="nav.savings">Savings &amp; Investments</span>
    </button>
    <button class="drawer-link" data-view="accounts">
      <span class="di"><span class="ico" data-ico="landmark"></span></span><span data-i18n="nav.accounts">Accounts</span>
    </button>
    <button class="drawer-link" data-view="assets">
      <span class="di"><span class="ico" data-ico="gem|diamond"></span></span><span data-i18n="nav.assets">Assets</span>
    </button>
    <button class="drawer-link" data-view="debts">
      <span class="di"><span class="ico" data-ico="credit-card"></span></span><span data-i18n="nav.debts">Debt</span>
    </button>
    <button class="drawer-link" data-view="owed">
      <span class="di"><span class="ico" data-ico="users"></span></span><span data-i18n="nav.owed">Owed Money</span>
    </button>
    <button class="drawer-link" data-view="services">
      <span class="di"><span class="ico" data-ico="layers"></span></span><span data-i18n="nav.services">Services</span>
    </button>
    <button class="drawer-link" data-view="tax">
      <span class="di"><span class="ico" data-ico="receipt-text|receipt|file-check"></span></span><span data-i18n="nav.tax">Tax</span>
    </button>

    <div class="drawer-divider"></div>

    <div class="drawer-section-label" data-i18n="nav.section.tools">Tools</div>
    <button class="drawer-link" data-view="loans">
      <span class="di"><span class="ico" data-ico="calculator"></span></span><span data-i18n="nav.loans">Loan Calculators</span>
    </button>
    <button class="drawer-link" data-view="import">
      <span class="di"><span class="ico" data-ico="cloud-upload|upload-cloud"></span></span><span data-i18n="nav.import">Import CSV</span>
    </button>
    <button class="drawer-link" id="reloadLink">
      <span class="di"><span class="ico" data-ico="refresh-cw|rotate-cw"></span></span><span data-i18n="nav.reload">Reload from disk</span>
    </button>
    <button class="drawer-link" id="pluginSettingsLink">
      <span class="di"><span class="ico" data-ico="settings"></span></span><span data-i18n="nav.pluginSettings">Plugin settings</span>
    </button>
  </nav>

  <header class="topbar" aria-label="Budget navigation" data-i18n-aria="topbar.nav">
    <button type="button" class="menu-btn" id="menuBtn" aria-expanded="false" aria-controls="appDrawer" aria-label="Open navigation menu" data-i18n-aria="topbar.openMenu">
      <span></span><span></span><span></span>
    </button>

    <button type="button" class="brand" id="brandHome" aria-label="Go to Dashboard" data-i18n-aria="topbar.home">
      <span class="brand-logo" aria-hidden="true"><span class="ico" data-ico="wallet|banknote|coins"></span></span>
      <span class="brand-text">
        <b>Budget Vault</b>
        <span class="brand-sub" id="brandSub" data-i18n="topbar.brandSub">Obsidian vault budget</span>
      </span>
    </button>

    <div class="header-period-pill hidden" id="periodPill" role="group" aria-label="Period navigation" data-i18n-aria="topbar.periodNav">
      <button class="pnav-btn" id="prevPeriod" aria-label="Previous period" data-i18n-aria="topbar.prevPeriod"><span class="ico" data-ico="chevron-left"></span></button>
      <span class="pnav-dot" aria-hidden="true"></span>
      <span class="pnav-label" id="periodLabel"></span>
      <button class="pnav-btn" id="currentPeriod" aria-label="Jump to current period" data-i18n-aria="topbar.currentPeriod"><span class="ico" data-ico="refresh-cw|rotate-cw"></span></button>
      <button class="pnav-btn" id="nextPeriod" aria-label="Next period" data-i18n-aria="topbar.nextPeriod"><span class="ico" data-ico="chevron-right"></span></button>
    </div>

    <div class="ml-auto">
      <button type="button" class="topbar-icon-btn hidden" id="topbarImport" aria-label="Import CSV" data-i18n-aria="topbar.import" title="Import a bank statement CSV" data-i18n-title="topbar.importTitle">
        <span class="ico" data-ico="import|file-input|cloud-upload|upload-cloud"></span>
      </button>
      <button type="button" class="topbar-avatar" id="topbarAvatar" aria-label="Open budget settings" data-i18n-aria="topbar.settings">BV</button>
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
          <h1 class="financial-period-banner-title" data-i18n="nav.dashboard">Dashboard</h1>
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
          <h1 class="financial-period-banner-title" data-i18n="nav.transactions">Transactions</h1>
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
          <h1 class="financial-period-banner-title" data-i18n="nav.budgets">Budget</h1>
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
          <h1 class="financial-period-banner-title" data-i18n="nav.tax">Tax</h1>
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
          <h1 class="financial-period-banner-title" data-i18n="nav.savings">Savings &amp; Investments</h1>
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
          <h1 class="financial-period-banner-title" data-i18n="nav.accounts">Accounts</h1>
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
          <h1 class="financial-period-banner-title" data-i18n="nav.assets">Assets</h1>
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
          <h1 class="financial-period-banner-title" data-i18n="nav.debts">Debt</h1>
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
          <h1 class="financial-period-banner-title" data-i18n="nav.owed">Owed Money</h1>
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
          <h1 class="financial-period-banner-title" data-i18n="nav.services">Services</h1>
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
          <h1 class="financial-period-banner-title" data-i18n="nav.loans">Loan Calculators</h1>
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
          <h1 class="financial-period-banner-title" data-i18n="nav.import">Import CSV</h1>
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
  module2.exports = { SHELL_HTML };
});

// src/amount.js
var require_amount = __commonJS((exports2, module2) => {
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
  function parseNum(s) {
    const t = (s ?? "").toString().trim();
    if (/^-?\d+(\.\d+)?$/.test(t))
      return { ok: true, value: parseFloat(t) };
    return { ok: false, value: normalizeAmount(t) ?? 0, raw: t };
  }
  module2.exports = { normalizeAmount, parseNum };
});

// src/modal.js
var require_modal = __commonJS((exports2, module2) => {
  var { Modal, Setting } = require("obsidian");
  var { el } = require_dom();
  var { normalizeAmount } = require_amount();

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

  class RulesCleanupModal extends Modal {
    constructor(app, report, resolve) {
      super(app);
      this.report = report;
      this.resolve = resolve;
      this.answer = false;
    }
    onOpen() {
      const { remove, redundant, blank, dormant, kept, checked, total } = this.report;
      this.titleEl.setText("Tidy categorisation rules");
      const c = this.contentEl;
      if (!remove.length) {
        c.append(el("p", { class: "budget-tidy-lead" }, total === 0 ? "There are no categorisation rules yet. They get written as you categorise imported transactions." : `Nothing to remove — all ${total} rules earn their place against the ${checked} descriptions in your vault.`));
        new Setting(c).addButton((b) => b.setButtonText("Close").setCta().onClick(() => this.close()));
        return;
      }
      c.append(el("p", { class: "budget-tidy-lead" }, `${remove.length} of ${total} rules can go, leaving ${kept}. ` + `Every one was removed and re-checked against all ${checked} transaction descriptions ` + "in your vault: each still came out with exactly the category it has now. " + "Each rule below is a longer version of one that stays, so future statements " + "match it the same way too."));
      const list = el("div", { class: "budget-tidy-list" });
      for (const r of redundant) {
        list.append(el("div", { class: "budget-tidy-row" }, el("div", { class: "budget-tidy-pattern" }, r.pattern), el("div", { class: "budget-tidy-why" }, `→ ${r.category || "(no category)"} · already covered by “${r.coveredBy}”`)));
      }
      for (const r of blank) {
        list.append(el("div", { class: "budget-tidy-row" }, el("div", { class: "budget-tidy-pattern budget-tidy-empty" }, "(blank pattern)"), el("div", { class: "budget-tidy-why" }, `→ ${r.category || "(no category)"} · matches nothing, already ignored on import`)));
      }
      c.append(list);
      if (dormant.length) {
        c.append(el("p", { class: "budget-tidy-hint" }, `${dormant.length} other ${dormant.length === 1 ? "rule matches" : "rules match"} nothing in your history yet. ` + "Those are being kept — a rule with no transactions behind it may simply be waiting " + "for one, and this cannot tell that apart from a rule you have finished with."));
      }
      new Setting(c).addButton((b) => b.setButtonText("Cancel").onClick(() => this.close())).addButton((b) => b.setButtonText(`Remove ${remove.length} ${remove.length === 1 ? "rule" : "rules"}`).setWarning().onClick(() => {
        this.answer = true;
        this.close();
      }));
    }
    onClose() {
      this.contentEl.empty();
      this.resolve(this.answer);
    }
  }
  function askRulesCleanup(app, report) {
    return new Promise((res) => new RulesCleanupModal(app, report, res).open());
  }
  module2.exports = { askFields, confirmModal, SplitModal, askSplit, RulesCleanupModal, askRulesCleanup };
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

// src/vault-path.js
var require_vault_path = __commonJS((exports2, module2) => {
  var WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  function safeSeg(s) {
    const out = (s ?? "").toString().normalize("NFC").replace(/[\u00A0\u202F]/g, " ").replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "").replace(/[\x00-\x1F\x7F]/g, "").replace(/[\\/:*?"<>|]/g, "-").replace(/\.{2,}/g, "-").replace(/^\.+/, "").trim().replace(/[. ]+$/, "");
    return WIN_RESERVED.test(out) ? `${out}-` : out;
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
  module2.exports = { safeSeg, collapsePath };
});

// src/io.js
var require_io = __commonJS((exports2, module2) => {
  var { normalizePath, TFile, TFolder } = require("obsidian");
  var { collapsePath } = require_vault_path();
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
    function guardedVaultPath(rel) {
      const collapsed = collapsePath(normalizePath(String(rel || "")));
      if (!collapsed)
        throw new Error(`Refused write outside the vault: ${rel}`);
      return collapsed;
    }
    async function writeVaultFile(rel, content) {
      const path = guardedVaultPath(rel);
      stampWrite();
      const f = vault.getFileByPath(path);
      if (f) {
        await vault.modify(f, content);
      } else {
        await ensureFolder(path.split("/").slice(0, -1).join("/"));
        await vault.create(path, content);
      }
      stampWrite();
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
      writeVaultFile,
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
  var { periodDaysOrZero } = require_dates();
  var { safeSeg } = require_vault_path();
  var { ISO_DATE: DATE_KEY, isoOf, isoDayNumber: dayNum, isoFromDayNumber: isoFromDayNum, isRealIsoDate } = require_dates();
  var MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
  module2.exports = function registerPeriod(ctx) {
    const { S } = ctx;
    function anchorDay() {
      return isRealIsoDate(S.settings.period_anchor) ? dayNum(S.settings.period_anchor) : null;
    }
    function intervalDays() {
      return anchorDay() === null ? 0 : periodDaysOrZero(S.settings.period_days);
    }
    function periodStartOnOrBefore(day, iv) {
      const a = anchorDay();
      return a + Math.floor((day - a) / iv) * iv;
    }
    function periodKeyValid(p) {
      if (typeof p !== "string")
        return false;
      const iv = intervalDays();
      if (!iv)
        return MONTH_KEY.test(p);
      if (!isRealIsoDate(p))
        return false;
      return (dayNum(p) - anchorDay()) % iv === 0;
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
      return { start: isoOf(new Date(y, m - 2, n)), end: isoOf(new Date(y, m - 1, n - 1)) };
    }
    function currentPeriod() {
      const now = new Date;
      const iv = intervalDays();
      if (iv) {
        return isoFromDayNum(periodStartOnOrBefore(dayNum(isoOf(now)), iv));
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
    const MONTH_DAYS = 365.25 / 12;
    function averagingPeriods(iv) {
      const lo = Math.max(1, Math.ceil(2 * MONTH_DAYS / iv));
      const hi = Math.max(lo, Math.floor(4 * MONTH_DAYS / iv));
      let best = lo, bestErr = Infinity;
      for (let n = lo;n <= hi; n++) {
        const months = n * iv / MONTH_DAYS;
        const err = Math.abs(months - Math.round(months));
        if (err < bestErr) {
          best = n;
          bestErr = err;
        }
      }
      return best;
    }
    function monthlyIncome(p) {
      const iv = intervalDays();
      if (!iv)
        return { income: periodSummary(p).income, periods: 1, complete: true };
      const need = averagingPeriods(iv);
      function windowEndingBefore(back) {
        const sums = [];
        for (let i = need - 1 + back;i >= back; i--)
          sums.push(periodSummary(shiftPeriod(p, -i)));
        let from = 0;
        while (from < sums.length - 1 && sums[from].count === 0)
          from++;
        return sums.slice(from);
      }
      const running = p === currentPeriod();
      let used = windowEndingBefore(running ? 1 : 0);
      const complete = !running || used.some((s) => s.count > 0);
      if (!complete)
        used = windowEndingBefore(0);
      const total = used.reduce((s, x) => s + x.income, 0);
      return { income: total / (used.length * iv) * MONTH_DAYS, periods: used.length, complete };
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
      monthlyIncome,
      budgetTotals,
      accountForLabel,
      accountIndex,
      nonBudgetLabels,
      intervalDays,
      periodKeyValid
    });
  };
});

// src/csv.js
var require_csv = __commonJS((exports2, module2) => {
  function parseDelimited(text, delim) {
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
      else if (ch === delim) {
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
  var parseCsv = (text) => parseDelimited(text, ",");
  var DELIMS = [",", ";", "\t", "|"];
  function sniffDelimiter(text) {
    const sample = text.slice(0, 65536);
    let best = ",", bestScore = 0;
    for (const d of DELIMS) {
      const counts = parseDelimited(sample, d).map((r) => r.length).filter((n) => n > 1);
      if (!counts.length)
        continue;
      const freq = new Map;
      for (const n of counts)
        freq.set(n, (freq.get(n) || 0) + 1);
      let mode = 0, agree = 0;
      for (const [n, c] of freq)
        if (c > agree) {
          mode = n;
          agree = c;
        }
      const score = agree * (mode - 1);
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    return best;
  }
  function csvCell(v) {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s))
      s = `'${s}`;
    return /["',\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  module2.exports = { parseDelimited, parseCsv, sniffDelimiter, csvCell };
});

// src/load.js
var require_load = __commonJS((exports2, module2) => {
  var { TFile } = require("obsidian");
  var { TYPE_ORDER } = require_constants();
  var { periodDaysOrZero } = require_dates();
  var { parseNum, normalizeAmount } = require_amount();
  var { parseFrontmatter, parseMdTable, unescMd } = require_markdown();
  var { parseCsv } = require_csv();
  var { setLanguage, defaultLanguage } = require_i18n();
  var { safeSeg } = require_vault_path();
  var { isRealIsoDate } = require_dates();
  function fmNum(v) {
    const s = (v ?? "").toString().trim();
    return s ? normalizeAmount(s) : null;
  }
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
        const anchorOk = isRealIsoDate(anchor);
        S.settings.period_days = anchorOk ? periodDaysOrZero(fm.period_days) : 0;
        S.settings.period_anchor = anchorOk ? anchor : "";
        if (fm.currency)
          S.settings.currency = fm.currency;
        S.settings.country = (fm.country || "za").toString().trim().toLowerCase();
        S.settings.language = setLanguage(fm.language || defaultLanguage());
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
          credit_limit: fmNum(fm.credit_limit),
          goal_amount: fmNum(fm.goal_amount),
          target_date: fm.target_date || "",
          monthly_contribution: fmNum(fm.monthly_contribution),
          total_invested: fmNum(fm.total_invested),
          starting_amount: fmNum(fm.starting_amount),
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
            status: (c[4] || "outstanding").trim().toLowerCase() === "paid" ? "paid" : "outstanding",
            repaid: parseFloat(c[5]) || 0,
            lent: (c[6] || "").trim()
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
      S.assets = [];
      S.assetsDirty = false;
      const assetTxt = await readFile("Assets.md");
      S.assetsFm = assetTxt && parseFrontmatter(assetTxt).raw || "kind: assets";
      if (assetTxt)
        for (const c of parseMdTable(assetTxt).slice(1)) {
          if (!c[0])
            continue;
          S.assets.push({
            name: unescMd(c[0]),
            type: unescMd(c[1] || "other"),
            value: Math.max(0, parseNum(c[2] || "0").value || 0),
            valued: (c[3] || "").trim(),
            notes: unescMd(c[4] || "")
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
        const figAmount = (s) => normalizeAmount(s) ?? 0;
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

// src/rules.js
var require_rules = __commonJS((exports2, module2) => {
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
  function prepareRules(rules) {
    return (rules || []).map((r) => ({ p: (r.pattern ?? "").trim().toLowerCase(), category: r.category })).filter((r) => r.p);
  }
  function matchRule(desc, rules) {
    const d = (desc ?? "").toString().trim().toLowerCase();
    let best = null, bestLen = 0;
    for (const r of rules) {
      if (r.p === d)
        return r;
      if (r.p.length > bestLen && d.includes(r.p)) {
        best = r;
        bestLen = r.p.length;
      }
    }
    return best;
  }
  function autoCategorise(desc, rules) {
    const r = matchRule(desc, rules);
    return r ? r.category : "";
  }
  module2.exports = { learnPattern, prepareRules, matchRule, autoCategorise };
});

// src/rule-cleanup.js
var require_rule_cleanup = __commonJS((exports2, module2) => {
  var { matchRule, autoCategorise } = require_rules();
  function analyseRules(rules, descriptions) {
    const all = rules || [];
    const prepared = [];
    const blank = [];
    all.forEach((r, i) => {
      const p = (r.pattern ?? "").toString().trim().toLowerCase();
      if (p)
        prepared.push({ p, category: r.category, i });
      else
        blank.push({ index: i, pattern: r.pattern ?? "", category: r.category, reason: "blank" });
    });
    const seen = new Set;
    const descs = [];
    for (const d of descriptions || []) {
      const k = (d ?? "").toString().trim().toLowerCase();
      if (!k || seen.has(k))
        continue;
      seen.add(k);
      descs.push(k);
    }
    const base = descs.map((d) => autoCategorise(d, prepared));
    const touches = prepared.map((r) => {
      const hits = [];
      descs.forEach((d, di) => {
        if (d === r.p || d.includes(r.p))
          hits.push(di);
      });
      return hits;
    });
    const order = prepared.map((_, pi) => pi).sort((a, b) => prepared[b].p.length - prepared[a].p.length || a - b);
    const working = prepared.slice();
    const redundant = [];
    const dormant = [];
    for (const pi of order) {
      const rule = prepared[pi];
      const hits = touches[pi];
      if (!hits.length) {
        dormant.push({ index: rule.i, pattern: all[rule.i].pattern, category: rule.category });
        continue;
      }
      const at = working.indexOf(rule);
      if (at === -1)
        continue;
      working.splice(at, 1);
      if (!hits.every((di) => autoCategorise(descs[di], working) === base[di])) {
        working.splice(at, 0, rule);
        continue;
      }
      const cover = matchRule(descs[hits[0]], working);
      if (!cover || !rule.p.includes(cover.p)) {
        working.splice(at, 0, rule);
        continue;
      }
      redundant.push({
        index: rule.i,
        pattern: all[rule.i].pattern,
        category: rule.category,
        coveredBy: cover ? cover.p : "",
        hits: hits.length
      });
    }
    redundant.sort((a, b) => a.index - b.index);
    dormant.sort((a, b) => a.index - b.index);
    const remove = [...blank, ...redundant].sort((a, b) => a.index - b.index);
    return {
      remove,
      redundant,
      dormant,
      blank,
      kept: all.length - remove.length,
      checked: descs.length,
      total: all.length
    };
  }
  module2.exports = { analyseRules };
});

// src/categories.js
var require_categories = __commonJS((exports2, module2) => {
  var { el } = require_dom();
  var { parseFrontmatter, yamlStr } = require_markdown();
  var { csvCell } = require_csv();
  var { learnPattern, prepareRules, autoCategorise } = require_rules();
  var { safeSeg } = require_vault_path();
  var { TYPE_ORDER } = require_constants();
  var { todayIso } = require_dates();
  var { askFields, confirmModal, askRulesCleanup } = require_modal();
  var { analyseRules } = require_rule_cleanup();
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
      const matcher = prepareRules(S.rules);
      let added = 0;
      for (const { desc, cat } of pairs) {
        if (!cat)
          continue;
        const pattern = learnPattern(desc);
        const key = pattern.trim().toLowerCase();
        if (!key || have.has(key))
          continue;
        if (autoCategorise(pattern, matcher) === cat) {
          have.add(key);
          continue;
        }
        S.rules.push({ pattern, category: cat });
        matcher.push({ p: key, category: cat });
        have.add(key);
        added++;
      }
      if (added) {
        S.rules.sort((a, b) => a.pattern.localeCompare(b.pattern, undefined, { sensitivity: "base" }));
        await writeRulesCsv();
      }
      return added;
    }
    function rulesCsv(rules) {
      const body = rules.length ? rules.map((r) => [r.pattern, r.category].map(csvCell).join(",")).join(`
`) + `
` : "";
      return `pattern,category
` + body;
    }
    function writeRulesCsv() {
      return writeFile("Data/Categorisation Rules.csv", rulesCsv(S.rules));
    }
    async function cleanupRules() {
      const descs = [];
      for (const f of Object.values(S.txFiles || {})) {
        for (const row of f.rows || [])
          if (row.desc)
            descs.push(row.desc);
      }
      if (!S.rules.length && !descs.length) {
        toast("No budget data loaded yet.", true);
        return 0;
      }
      const report = analyseRules(S.rules, descs);
      if (!await askRulesCleanup(app, report))
        return 0;
      const backup = `Data/Categorisation Rules.pre-tidy-${todayIso()}.csv`;
      if (!fileAt(backup)) {
        try {
          await writeFile(backup, rulesCsv(S.rules));
        } catch (err) {
          toast(`Could not write the backup — nothing was deleted. ${err && err.message ? err.message : err}`, true);
          return 0;
        }
      }
      const drop = new Set(report.remove.map((r) => r.index));
      S.rules = S.rules.filter((_, i) => !drop.has(i));
      await writeRulesCsv();
      toast(`Removed ${drop.size} categorisation ${drop.size === 1 ? "rule" : "rules"} — ${S.rules.length} left. Previous set saved to ${backup.split("/").pop()}`);
      return drop.size;
    }
    ctx.provide({ fillCatOptions, promptCreateCategory, promptDeleteCategory, catSelect, lazyCatSelect, deferredCatSelect, learnRules, cleanupRules });
  };
});

// src/reconcile.js
var require_reconcile = __commonJS((exports2, module2) => {
  var { ISO_DATE, todayIso } = require_dates();
  var STALE_DAYS = 30;
  function daysSince(iso, today) {
    if (!ISO_DATE.test(iso || ""))
      return null;
    const then = new Date(`${iso}T00:00:00`);
    if (isNaN(then.getTime()))
      return null;
    const now = ISO_DATE.test(today || "") ? new Date(`${today}T00:00:00`) : new Date;
    now.setHours(0, 0, 0, 0);
    return Math.round((now.getTime() - then.getTime()) / 86400000);
  }
  function isStale(iso, today) {
    const d = daysSince(iso, today);
    return d === null || d > STALE_DAYS;
  }
  function reconcile(a, rows, today) {
    if (!rows || !rows.length)
      return { state: "no-tx" };
    if (!ISO_DATE.test(a.balance_updated || ""))
      return { state: "no-date" };
    const now = ISO_DATE.test(today || "") ? today : todayIso();
    const since = [], ahead = [];
    for (const r of rows) {
      if (r.date <= a.balance_updated)
        continue;
      (r.date > now ? ahead : since).push(r);
    }
    const delta = since.reduce((s, r) => s + r.amount, 0);
    if (!since.length) {
      return ahead.length ? { state: "pending", ahead: ahead.length } : { state: "clean" };
    }
    return { state: "drift", count: since.length, ahead: ahead.length, delta, implied: a.balance + delta };
  }
  function stalenessSummary(accounts, today) {
    let stale = 0, oldest = null, dated = 0;
    for (const a of accounts || []) {
      const d = daysSince(a.balance_updated, today);
      if (d !== null)
        dated++;
      if (isStale(a.balance_updated, today))
        stale++;
      if (d !== null && (oldest === null || d > oldest))
        oldest = d;
    }
    return { total: (accounts || []).length, stale, dated, oldestDays: oldest };
  }
  module2.exports = { STALE_DAYS, daysSince, isStale, reconcile, stalenessSummary };
});

// src/worth.js
var require_worth = __commonJS((exports2, module2) => {
  function activeDebts(debts) {
    return (debts || []).filter((d) => d && d.status !== "paid");
  }
  function assetTotal(assets) {
    return (assets || []).reduce((t, a) => t + Math.max(0, a.value || 0), 0);
  }
  function worth(accounts, debts, assets) {
    const list = accounts || [];
    const ownedAccounts = list.reduce((t, a) => t + Math.max(0, a.balance || 0), 0);
    const ownedAssets = assetTotal(assets);
    const owned = ownedAccounts + ownedAssets;
    const fromAccounts = -list.reduce((t, a) => t + Math.min(0, a.balance || 0), 0) || 0;
    const active = activeDebts(debts);
    const fromDebts = active.reduce((t, d) => t + Math.max(0, d.balance || 0), 0);
    const liabilities = fromAccounts + fromDebts;
    return {
      assets: owned,
      ownedAccounts,
      ownedAssets,
      liabilities,
      fromAccounts,
      fromDebts,
      net: owned - liabilities,
      active
    };
  }
  function cardOverlap(accounts, debts) {
    const cardAccounts = (accounts || []).filter((a) => a.type === "credit_card" && (a.balance || 0) < 0);
    const cardDebts = activeDebts(debts).filter((d) => /credit\s*card/i.test(d.type || ""));
    return cardAccounts.length && cardDebts.length ? { cardAccounts: cardAccounts.length, cardDebts: cardDebts.length } : null;
  }
  function debtsByType(debts) {
    const byType = new Map;
    for (const d of activeDebts(debts)) {
      if (!(d.balance > 0))
        continue;
      const k = (d.type || "").trim() || "other";
      byType.set(k, (byType.get(k) || 0) + d.balance);
    }
    return [...byType].sort((a, b) => b[1] - a[1]).map(([type, amount]) => ({ type, amount }));
  }
  function assetsByType(assets) {
    const byType = new Map;
    for (const a of assets || []) {
      if (!(a.value > 0))
        continue;
      const k = (a.type || "").trim() || "other";
      byType.set(k, (byType.get(k) || 0) + a.value);
    }
    return [...byType].sort((a, b) => b[1] - a[1]).map(([type, amount]) => ({ type, amount }));
  }
  module2.exports = { worth, activeDebts, assetTotal, cardOverlap, debtsByType, assetsByType };
});

// src/owed-math.js
var require_owed_math = __commonJS((exports2, module2) => {
  var { daysSince } = require_reconcile();
  function outstandingOf(o) {
    return Math.max(0, (o.amount || 0) - (o.repaid || 0));
  }
  function isSettled(o) {
    return o.status === "paid" || outstandingOf(o) === 0;
  }
  function owedSummary(owed, today) {
    const list = owed || [];
    let outstanding = 0, recovered = 0, open = 0, oldestDays = null;
    for (const o of list) {
      const settled = isSettled(o);
      if (settled) {
        recovered += o.repaid > 0 ? Math.min(o.repaid, o.amount || 0) : o.amount || 0;
        continue;
      }
      open++;
      outstanding += outstandingOf(o);
      recovered += Math.min(o.repaid || 0, o.amount || 0);
      const age = daysSince(o.lent, today);
      if (age !== null && (oldestDays === null || age > oldestDays))
        oldestDays = age;
    }
    return { outstanding, recovered, open, entries: list.length, oldestDays };
  }
  module2.exports = { outstandingOf, isSettled, owedSummary };
});

// src/chart.js
var require_chart = __commonJS((exports2, module2) => {
  var { el } = require_dom();
  var NS = "http://www.w3.org/2000/svg";
  function themeColors(root) {
    const css = getComputedStyle(root);
    const v = (name, fallback) => (css.getPropertyValue(name) || "").trim() || fallback;
    return {
      success: v("--color-success", "#22c55e"),
      danger: v("--color-danger", "#f43f5e"),
      warning: v("--color-warning", "#f59e0b"),
      info: v("--color-info", "#0ea5e9"),
      accent: v("--color-accent", "#0d9488"),
      primary: v("--color-primary", "#065f46"),
      investment: v("--color-investment", "#6f42c1"),
      muted: v("--ink-faint", "#5f6779"),
      hole: root.classList.contains("bud-dark") ? "#0a0f1e" : "#ffffff"
    };
  }
  var SLICE_PALETTE = [
    "#fb923c",
    "#0ea5e9",
    "#a16207",
    "#0369a1",
    "#84cc16",
    "#6366f1",
    "#15803d",
    "#e879f9",
    "#34d399",
    "#a21caf"
  ];
  var SLICE_MIN_DISTANCE = 130;
  var PLACEHOLDER_COLORS = ["#888", "#888888"];
  function parseColor(value) {
    const raw = (value || "").trim();
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
    if (hex) {
      const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    }
    const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(raw);
    return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
  }
  function colorDistance(a, b) {
    const rmean = (a[0] + b[0]) / 2;
    const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt((2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db);
  }
  function distinctColors(wanted, {
    reserved = [],
    palette = SLICE_PALETTE,
    minDistance = SLICE_MIN_DISTANCE
  } = {}) {
    const taken = reserved.map(parseColor).filter(Boolean);
    const clashes = (rgb) => taken.some((t) => colorDistance(rgb, t) < minDistance);
    const out = [];
    for (const raw of wanted) {
      const placeholder = PLACEHOLDER_COLORS.includes((raw || "").trim().toLowerCase());
      const own = placeholder ? null : parseColor(raw);
      if (own && !clashes(own)) {
        taken.push(own);
        out.push(raw);
        continue;
      }
      const pick = palette.find((p) => !clashes(parseColor(p))) || palette[out.length % palette.length];
      taken.push(parseColor(pick));
      out.push(pick);
    }
    return out;
  }
  function createChart({ w, h, label, cls }) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
    if (cls)
      svg.setAttribute("class", cls);
    svg.style.color = "var(--text-primary)";
    const add = (tag, attrs = {}, parent = svg) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, val] of Object.entries(attrs)) {
        if (val !== null && val !== undefined)
          n.setAttribute(k, val);
      }
      parent.append(n);
      return n;
    };
    return { svg, add };
  }
  function scales({ w, h, padL = 24, padR = 24, padT = 24, padB = 40, count, max, min = 0 }) {
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const span = max - min || 1;
    const slots = Math.max(1, count);
    return {
      padL,
      padR,
      padT,
      padB,
      innerW,
      innerH,
      count,
      x: (i) => count <= 1 ? padL + innerW / 2 : padL + i * (innerW / (count - 1)),
      band: (i) => padL + (i + 0.5) * (innerW / slots),
      bandWidth: innerW / slots,
      y: (v) => padT + (1 - (v - min) / span) * innerH,
      baseline: padT + innerH
    };
  }
  function gridlines(add, s, w, rows = 4) {
    for (let g = 1;g < rows; g++) {
      const gy = s.padT + g * (s.innerH / rows);
      add("line", {
        x1: s.padL,
        x2: w - s.padR,
        y1: gy,
        y2: gy,
        stroke: "currentColor",
        "stroke-opacity": "0.06"
      });
    }
  }
  function axisLabels(add, s, labels, h, { maxLabels = 8, band = false } = {}) {
    const n = labels.length;
    const stride = Math.max(1, Math.ceil(n / maxLabels));
    labels.forEach((text, i) => {
      const last = i === n - 1;
      if (!last && (i % stride !== 0 || n - 1 - i < stride / 2))
        return;
      add("text", {
        x: band ? s.band(i) : s.x(i),
        y: h - 12,
        "text-anchor": i === 0 && !band ? "start" : last && !band ? "end" : "middle",
        "font-size": "13",
        fill: "currentColor",
        "fill-opacity": "0.45",
        "font-family": "inherit"
      }).textContent = text;
    });
  }
  var linePath = (pts) => "M" + pts.map((p) => `${p[0]},${p[1]}`).join(" L ");
  var areaPath = (pts, baseline) => linePath(pts) + ` L ${pts[pts.length - 1][0]},${baseline} L ${pts[0][0]},${baseline} Z`;
  function areaGradient(add, id, color, opacity = 0.22) {
    const defs = add("defs", {});
    const grad = add("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    add("stop", { offset: "0%", "stop-color": color, "stop-opacity": String(opacity) }, grad);
    add("stop", { offset: "100%", "stop-color": color, "stop-opacity": "0" }, grad);
    return `url(#${id})`;
  }
  function arcPath(cx, cy, rOut, rIn, a0, a1) {
    const end = Math.min(a1, a0 + Math.PI * 2 - 0.0001);
    const p = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const large = end - a0 > Math.PI ? 1 : 0;
    const [x0, y0] = p(rOut, a0), [x1, y1] = p(rOut, end);
    const [x2, y2] = p(rIn, end), [x3, y3] = p(rIn, a0);
    return `M ${x0} ${y0} A ${rOut} ${rOut} 0 ${large} 1 ${x1} ${y1} ` + `L ${x2} ${y2} A ${rIn} ${rIn} 0 ${large} 0 ${x3} ${y3} Z`;
  }
  function tip(add, node, text) {
    add("title", {}, node).textContent = text;
  }
  var RANGES = [
    { key: "3m", label: "3M", months: 3, historical: true },
    { key: "6m", label: "6M", months: 6, historical: true },
    { key: "1y", label: "1Y", months: 12, historical: true },
    { key: "5y", label: "5Y", months: 60, historical: false },
    { key: "10y", label: "10Y", months: 120, historical: false }
  ];
  var historicalRanges = () => RANGES.filter((r) => r.historical);
  var rangeFor = (key) => RANGES.find((r) => r.key === key);
  function rangePills({ ranges, value, onPick, label }) {
    const wrap = el("div", { class: "chart-range", role: "group", "aria-label": label });
    for (const r of ranges) {
      const active = r.key === value;
      wrap.append(el("button", {
        type: "button",
        class: `chart-range-btn${active ? " is-active" : ""}`,
        "aria-pressed": active ? "true" : "false",
        onclick: () => {
          if (!active)
            onPick(r.key);
        }
      }, r.label));
    }
    return wrap;
  }
  module2.exports = {
    themeColors,
    createChart,
    scales,
    gridlines,
    axisLabels,
    linePath,
    areaPath,
    areaGradient,
    arcPath,
    tip,
    SLICE_PALETTE,
    parseColor,
    colorDistance,
    distinctColors,
    RANGES,
    historicalRanges,
    rangeFor,
    rangePills
  };
});

// src/views/dashboard.js
var require_dashboard = __commonJS((exports2, module2) => {
  var { el, icoEl } = require_dom();
  var { safeSeg } = require_vault_path();
  var { TYPE_ORDER } = require_constants();
  var { stalenessSummary } = require_reconcile();
  var { worth, cardOverlap } = require_worth();
  var { owedSummary } = require_owed_math();
  var {
    themeColors,
    createChart,
    scales,
    gridlines,
    axisLabels,
    linePath,
    areaPath,
    areaGradient,
    arcPath,
    tip,
    distinctColors,
    historicalRanges,
    rangeFor,
    rangePills
  } = require_chart();
  module2.exports = function registerDashboard(ctx) {
    const { S, $, app, root, plugin, money, toast, fileAt, periodSummary, budgetTotals, periodTitle, periodMonthName, periodShortLabel, periodRange, shiftPeriod, catType } = ctx;
    function guard(sel, label, fn) {
      try {
        fn();
      } catch (e) {
        console.error(`Budget: the ${label} card failed to render`, e);
        try {
          const box = $(sel);
          if (!box)
            return;
          box.empty();
          const msg = `Could not draw the ${label} — ${e?.message || e}`;
          box.append(box.tagName === "TABLE" ? el("tbody", {}, el("tr", {}, el("td", { class: "text-danger", colspan: "5" }, msg))) : el("p", { class: "text-danger", style: "margin:0" }, msg));
        } catch (inner) {
          console.error(`Budget: the ${label} card could not report its own failure`, inner);
        }
      }
    }
    const guardedTrend = () => guard("#trendChart", "spending trend", renderTrend);
    const guardedSplit = () => guard("#dashSplit", "spending split", renderSplit);
    function renderDashboard() {
      guard("#heroCard", "summary", renderHero);
      guardedTrend();
      guardedSplit();
      guard("#dashBudget", "budget table", renderBudgetTable);
      guard("#dashPositionKpis", "position summary", renderPosition);
      guard("#dashPositionNote", "double-count note", renderOverlapNote);
      guard("#dashStale", "balance staleness", renderStale);
    }
    const balanceOf = (type) => S.accounts.filter((a) => a.type === type).reduce((t, a) => t + (a.balance || 0), 0);
    function posTile(grid, { label, value, cls, sub, view, say }) {
      const btn = el("button", {
        type: "button",
        class: `v num ${cls || ""}`,
        "aria-label": say,
        onclick: () => ctx.switchView(view)
      }, value);
      const t = el("div", { class: "mini" }, el("div", { class: "l" }, label), btn);
      if (sub)
        t.append(el("div", { class: "s" }, sub));
      grid.append(t);
      return t;
    }
    function renderPosition() {
      const grid = $("#dashPositionKpis");
      grid.empty();
      const card = $("#dashPositionCard");
      const w = worth(S.accounts, S.debts, S.assets);
      const owed = owedSummary(S.owed);
      const savings = balanceOf("savings");
      const invest = balanceOf("investment");
      const hasLedger = w.assets > 0 || w.liabilities > 0 || owed.entries > 0 || savings > 0 || invest > 0;
      const hasCaveat = stalenessSummary(S.accounts).stale > 0;
      if (card)
        card.classList.toggle("hidden", !hasLedger && !hasCaveat);
      $("#dashPositionSub").textContent = hasLedger ? "As things stand today — these do not move with the period above" : "";
      if (!hasLedger)
        return;
      posTile(grid, {
        label: "Net worth",
        value: money(w.net, 0),
        cls: w.net >= 0 ? "grad-txt" : "text-danger",
        sub: `${money(w.assets, 0)} owned · ${money(w.liabilities, 0)} owed`,
        view: "savings",
        say: `Net worth ${money(w.net)} — ${money(w.assets)} owned against ${money(w.liabilities)} owed. Open Savings and Investments.`
      });
      posTile(grid, {
        label: "Debt",
        value: money(-w.liabilities, 0),
        cls: w.liabilities > 0 ? "text-danger" : "",
        sub: w.fromDebts && w.fromAccounts ? `${money(w.fromAccounts, 0)} accounts · ${money(w.fromDebts, 0)} debt page` : w.liabilities > 0 ? `${w.active.length} active` : "nothing owed",
        view: "debts",
        say: w.liabilities > 0 ? `Debt ${money(w.liabilities)} owed. Open the Debt page.` : "No debt owed. Open the Debt page."
      });
      posTile(grid, {
        label: "Owed to you",
        value: money(owed.outstanding, 0),
        cls: owed.outstanding > 0 ? "text-warning" : "",
        sub: owed.outstanding > 0 ? `${owed.open} outstanding${owed.oldestDays !== null ? ` · oldest out ${owed.oldestDays} days` : ""}` : owed.entries ? `${money(owed.recovered, 0)} recovered` : "nothing lent out",
        view: "owed",
        say: owed.outstanding > 0 ? `${money(owed.outstanding)} owed to you across ${owed.open} ${owed.open === 1 ? "entry" : "entries"}. Open Owed Money.` : "Nothing outstanding. Open Owed Money."
      });
      posTile(grid, {
        label: "Savings & investments",
        value: money(savings + invest, 0),
        sub: `${money(savings, 0)} savings · ${money(invest, 0)} invested`,
        view: "savings",
        say: `${money(savings + invest)} in savings and investments. Open Savings and Investments.`
      });
    }
    function renderOverlapNote() {
      const wrap = $("#dashPositionNote");
      wrap.empty();
      const o = cardOverlap(S.accounts, S.debts);
      if (!o)
        return;
      wrap.append(el("div", { class: "kpi-caveat-txt" }, icoEl(["info", "alert-circle"]), `${o.cardAccounts} credit-card ${o.cardAccounts === 1 ? "account" : "accounts"} and ` + `${o.cardDebts} card ${o.cardDebts === 1 ? "debt" : "debts"} are tracked — if any card is in both, it is counted twice above.`));
      const btn = el("button", {
        type: "button",
        class: "kpi-caveat-btn",
        "aria-label": "Review tracked debts on the Debt page"
      }, "Review debts");
      btn.addEventListener("click", () => ctx.switchView("debts"));
      wrap.append(btn);
    }
    function renderStale() {
      const wrap = $("#dashStale");
      wrap.empty();
      const s = stalenessSummary(S.accounts);
      if (!s.stale)
        return;
      const age = s.oldestDays === null ? "none of them carry a date" : `the oldest ${s.oldestDays} days ago`;
      const all = s.stale === s.total;
      const line = all ? `Built from ${s.total === 1 ? "a balance" : `${s.total} balances`} nobody has confirmed recently` : `Built from ${s.stale} of ${s.total} balances nobody has confirmed recently`;
      wrap.append(el("div", { class: "kpi-caveat-txt" }, icoEl(["info", "alert-circle"]), `${line} — ${age}.`));
      const btn = el("button", {
        type: "button",
        class: "kpi-caveat-btn",
        "aria-label": "Review account balances on the Accounts page"
      }, "Review balances");
      btn.addEventListener("click", () => ctx.switchView("accounts"));
      wrap.append(btn);
    }
    function renderHero() {
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
    }
    function renderBudgetTable() {
      const sum = periodSummary(S.period);
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
    function periodsForMonths(months) {
      const days = Number(S.settings.period_days) || 0;
      if (!days)
        return months;
      return Math.max(2, Math.round(months * 30.44 / days));
    }
    function earliestDataMonth() {
      let min = null;
      for (const f of Object.values(S.txFiles)) {
        if (!f.rows || !f.rows.length)
          continue;
        if (min === null || f.month < min)
          min = f.month;
      }
      return min;
    }
    function trendPeriods(want) {
      const earliest = earliestDataMonth();
      const out = [];
      for (let i = 0;i < want; i++) {
        const p = shiftPeriod(S.period, -i);
        if (earliest && i > 0 && periodRange(p).end.slice(0, 7) < earliest)
          break;
        out.push(p);
      }
      return out.reverse();
    }
    const trendRange = () => rangeFor(plugin.settings.chartTrendRange) || rangeFor("6m");
    function renderTrend() {
      const wrap = $("#trendChart");
      wrap.empty();
      const range = trendRange();
      const want = periodsForMonths(range.months);
      const periods = trendPeriods(want);
      const data = periods.map((p) => {
        const sum = periodSummary(p);
        return { p, spent: sum.spend, income: sum.income, budget: budgetTotals(p).spend, label: periodShortLabel(p) };
      });
      const pills = $("#trendRange");
      pills.empty();
      pills.append(rangePills({
        ranges: historicalRanges(),
        value: range.key,
        label: "Spending trend range",
        onPick: async (key) => {
          plugin.settings.chartTrendRange = key;
          await plugin.saveSettings();
          renderTrend();
        }
      }));
      const clamped = periods.length < want;
      $("#trendSub").textContent = `Spent vs budget · ${periods.length} period${periods.length === 1 ? "" : "s"}` + (clamped ? ` · all the history imported so far` : "");
      if (data.length < 2) {
        wrap.append(el("p", { class: "text-muted", style: "margin:0" }, "Import a second period of transactions and the trend line starts here."));
        return;
      }
      const W = 1000, H = 300;
      const c = themeColors(root);
      const max = Math.max(1, ...data.flatMap((d) => [d.spent, d.budget, d.income])) * 1.12;
      const s = scales({ w: W, h: H, count: data.length, max });
      const over = (d) => d.budget > 0 && d.spent > d.budget;
      const { svg, add } = createChart({
        w: W,
        h: H,
        label: `Spent, budgeted and income over the last ${data.length} periods`
      });
      const fill = areaGradient(add, "trendSpentArea", c.success);
      gridlines(add, s, W);
      const spentPts = data.map((d, i) => [s.x(i), s.y(d.spent)]);
      add("path", { d: areaPath(spentPts, s.baseline), fill });
      add("polyline", {
        points: data.map((d, i) => `${s.x(i)},${s.y(d.budget)}`).join(" "),
        fill: "none",
        stroke: "currentColor",
        "stroke-opacity": "0.28",
        "stroke-width": "1.5",
        "stroke-dasharray": "5 6",
        "stroke-linecap": "round"
      });
      add("path", {
        d: linePath(data.map((d, i) => [s.x(i), s.y(d.income)])),
        fill: "none",
        stroke: c.info,
        "stroke-opacity": "0.85",
        "stroke-width": "2",
        "stroke-linecap": "round",
        "stroke-linejoin": "round"
      });
      for (let i = 1;i < data.length; i++) {
        add("line", {
          x1: s.x(i - 1),
          y1: s.y(data[i - 1].spent),
          x2: s.x(i),
          y2: s.y(data[i].spent),
          stroke: over(data[i - 1]) || over(data[i]) ? c.danger : c.success,
          "stroke-width": "2.5",
          "stroke-linecap": "round"
        });
      }
      const dots = data.length <= 12;
      data.forEach((d, i) => {
        const node = dots ? add("circle", {
          cx: s.x(i),
          cy: s.y(d.spent),
          r: "5",
          fill: c.hole,
          stroke: over(d) ? c.danger : c.success,
          "stroke-width": "2.5"
        }) : add("rect", {
          x: s.x(i) - s.innerW / (data.length * 2),
          y: s.padT,
          width: s.innerW / data.length,
          height: s.innerH,
          fill: "transparent"
        });
        tip(add, node, `${d.label}: ${money(d.spent)} spent · ${money(d.budget)} budgeted · ${money(d.income)} in`);
      });
      axisLabels(add, s, data.map((d) => d.label), H);
      wrap.append(svg);
    }
    const SPLIT_SLICES = 8;
    function catColor(name) {
      return S.categories.find((c) => c.name === name)?.color || "#888";
    }
    function renderSplit() {
      const wrap = $("#dashSplit");
      wrap.empty();
      const sum = periodSummary(S.period);
      const spend = [];
      for (const [cat, amt] of Object.entries(sum.byCat)) {
        const type = catType(cat);
        if (!cat || type === "income" || type === "transfer")
          continue;
        if (amt >= 0)
          continue;
        spend.push({ cat, amount: -amt, color: catColor(cat) });
      }
      spend.sort((a2, b) => b.amount - a2.amount);
      const uncat = -Math.min(0, sum.byCat[""] || 0);
      const uncatNote = uncat > 0 ? ` · ${money(uncat)} uncategorised, not shown` : "";
      const total = spend.reduce((t, x) => t + x.amount, 0);
      $("#dashSplitSub").textContent = (total > 0 ? `${money(total)} across ${spend.length} categor${spend.length === 1 ? "y" : "ies"} · ${periodMonthName(S.period)}` : periodMonthName(S.period)) + uncatNote;
      if (!total) {
        wrap.append(el("p", { class: "text-muted", style: "margin:0" }, uncat > 0 ? `${money(uncat)} went out this period, but none of it is categorised yet — set categories in Transactions and the split appears here.` : "Nothing categorised as spending in this period yet."));
        return;
      }
      const shown = spend.slice(0, SPLIT_SLICES);
      const rest = spend.slice(SPLIT_SLICES);
      const otherColor = themeColors(root).muted;
      const resolved = distinctColors(shown.map((x) => x.color), { reserved: [otherColor] });
      shown.forEach((x, i) => {
        x.color = resolved[i];
      });
      if (rest.length) {
        shown.push({
          cat: `Other (${rest.length})`,
          amount: rest.reduce((t, x) => t + x.amount, 0),
          color: otherColor,
          other: true
        });
      }
      const W = 320, H = 320, cx = W / 2, cy = H / 2, rOut = 140, rIn = 88;
      const { svg, add } = createChart({
        w: W,
        h: H,
        cls: "donut",
        label: `Spending split for ${periodMonthName(S.period)}: ` + shown.map((x) => `${x.cat} ${Math.round(x.amount / total * 100)}%`).join(", ")
      });
      let a = -Math.PI / 2;
      for (const x of shown) {
        const sweep = x.amount / total * Math.PI * 2;
        const seg = add("path", {
          d: arcPath(cx, cy, rOut, rIn, a, a + sweep),
          fill: x.color,
          stroke: themeColors(root).hole,
          "stroke-width": "2",
          class: x.other ? null : "donut-slice"
        });
        tip(add, seg, `${x.cat}: ${money(x.amount)} · ${Math.round(x.amount / total * 100)}%`);
        if (!x.other)
          seg.addEventListener("click", () => openCategory(x.cat));
        a += sweep;
      }
      add("text", {
        x: cx,
        y: cy - 6,
        "text-anchor": "middle",
        "font-size": "13",
        fill: "currentColor",
        "fill-opacity": "0.5",
        "font-family": "inherit"
      }).textContent = "Total spent";
      add("text", {
        x: cx,
        y: cy + 22,
        "text-anchor": "middle",
        "font-size": "26",
        "font-weight": "700",
        fill: "currentColor",
        "font-family": "inherit"
      }).textContent = money(total, 0);
      const legend = el("ul", { class: "donut-legend donut-legend--linked" });
      for (const x of shown) {
        const pct = Math.round(x.amount / total * 100);
        const face = () => [
          el("i", { style: `background:${x.color}` }),
          el("span", { class: "dl-name" }, x.cat),
          el("span", { class: "dl-val num" }, money(x.amount, 0)),
          el("span", { class: "dl-pct num" }, `${pct}%`)
        ];
        if (x.other) {
          legend.append(el("li", {}, face()));
          continue;
        }
        legend.append(el("li", {}, el("button", {
          type: "button",
          class: "dl-link",
          "aria-label": `${x.cat}: ${money(x.amount)}, ${pct}% of spending — show transactions`,
          onclick: () => openCategory(x.cat)
        }, face()), el("button", {
          type: "button",
          class: "dl-note",
          "aria-label": `Open the ${x.cat} category note`,
          title: "Open category note",
          onclick: () => openCategoryFile(x.cat)
        }, icoEl(["file-text", "file"]))));
      }
      wrap.append(svg, legend);
    }
    function openCategory(cat) {
      ctx.switchView("transactions");
      const sel = $("#txCategory");
      if ([...sel.options].some((o) => o.value === cat))
        sel.value = cat;
      $("#txAccount").value = "";
      $("#txSearch").value = "";
      $("#txWholeHistory").checked = false;
      ctx.renderTransactions();
    }
    async function openCategoryFile(cat) {
      const file = fileAt(`Categories/${safeSeg(cat)}.md`) || fileAt(`Categories/${cat}.md`);
      if (!file)
        return toast(`No category note found for "${cat}"`, true);
      await app.workspace.getLeaf("tab").openFile(file);
    }
    ctx.provide({ renderDashboard, renderTrend: guardedTrend, renderSplit: guardedSplit });
  };
});

// src/exporter.js
var require_exporter = __commonJS((exports2, module2) => {
  var { csvCell } = require_csv();
  var EXPORT_DIR = "Exports";
  function safeName(s) {
    const cleaned = String(s ?? "").replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/\s+/g, " ").trim();
    return /^\.+$/.test(cleaned) ? "export" : cleaned || "export";
  }
  function amountCell(row) {
    const v = row.amountRaw != null ? row.amountRaw : Number(row.amount || 0).toFixed(2);
    return /^-?\d+(\.\d+)?$/.test(String(v)) ? String(v) : csvCell(v);
  }
  function transactionsCsv(rows) {
    const head = ["Date", "Description", "Account", "Category", "Amount", "Excluded", "Note"];
    const body = rows.map((r) => [
      csvCell(r.date),
      csvCell(r.desc),
      csvCell(r.label),
      csvCell(r.cat || ""),
      amountCell(r),
      csvCell(r.excluded ? "yes" : ""),
      csvCell(r.note || "")
    ].join(","));
    return [head.map(csvCell).join(","), ...body].join(`
`) + `
`;
  }
  function categoriesCsv(categories) {
    const head = ["Name", "Type", "Colour"];
    const body = (categories || []).map((c) => [c.name, c.type || "", c.color || ""].map(csvCell).join(","));
    return [head.map(csvCell).join(","), ...body].join(`
`) + `
`;
  }
  function escMd(s) {
    return String(s ?? "").replace(/\|/g, "\\|");
  }
  function transactionsMarkdown(rows, meta, money) {
    const { range, filters, generated } = meta;
    const included = rows.filter((r) => !r.excluded);
    const inTotal = included.filter((r) => r.amount > 0).reduce((t, r) => t + r.amount, 0);
    const outTotal = included.filter((r) => r.amount < 0).reduce((t, r) => t + r.amount, 0);
    const out = [
      "---",
      "generated: " + generated,
      "range: " + JSON.stringify(String(range)),
      "---",
      "",
      "# Transactions",
      "",
      `**${range}** · ${rows.length} row${rows.length === 1 ? "" : "s"}`
    ];
    if (filters.length)
      out.push("", "Filtered by: " + filters.join(" · "));
    out.push("", `Money in **${money(inTotal)}** · money out **${money(outTotal)}** · net **${money(inTotal + outTotal)}**`, "", ...rows.length !== included.length ? [`Totals cover ${included.length} of ${rows.length} rows — excluded rows are listed but not counted.`, ""] : [], "| Date | Description | Account | Category | Amount | Excluded | Note |", "|------|-------------|---------|----------|-------:|----------|------|");
    for (const r of rows) {
      out.push(`| ${r.date} | ${escMd(r.desc)} | ${escMd(r.label)} | ${escMd(r.cat)} | ${money(r.amount)} | ${r.excluded ? "yes" : ""} | ${escMd(r.note)} |`);
    }
    return out.join(`
`) + `
`;
  }
  function categoriesMarkdown(categories, generated) {
    const list = categories || [];
    const byType = new Map;
    for (const c of list) {
      const k = (c.type || "").trim() || "other";
      if (!byType.has(k))
        byType.set(k, []);
      byType.get(k).push(c);
    }
    const out = [
      "---",
      "generated: " + generated,
      "---",
      "",
      "# Categories",
      "",
      `${list.length} categor${list.length === 1 ? "y" : "ies"}`,
      ""
    ];
    for (const [type, cats] of [...byType].sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push(`## ${type}`, "", "| Name | Colour |", "|------|--------|");
      for (const c of cats.sort((a, b) => a.name.localeCompare(b.name))) {
        out.push(`| ${escMd(c.name)} | ${escMd(c.color)} |`);
      }
      out.push("");
    }
    return out.join(`
`) + `
`;
  }
  function exportPaths(range, folder) {
    const dir = String(folder || EXPORT_DIR).split("/").filter((seg) => seg.trim() && !/^\.+$/.test(seg.trim())).map(safeName).join("/") || EXPORT_DIR;
    const base = `${dir}/Transactions ${safeName(range)}`;
    return {
      dir,
      txCsv: `${base}.csv`,
      txMd: `${base}.md`,
      catCsv: `${dir}/Categories.csv`,
      catMd: `${dir}/Categories.md`
    };
  }
  module2.exports = {
    EXPORT_DIR,
    safeName,
    escMd,
    transactionsCsv,
    categoriesCsv,
    transactionsMarkdown,
    categoriesMarkdown,
    exportPaths
  };
});

// src/views/transactions.js
var require_transactions = __commonJS((exports2, module2) => {
  var { el, icoEl } = require_dom();
  var { normalizeAmount } = require_amount();
  var { escMd, patchFrontmatter, yamlStr } = require_markdown();
  var { csvCell } = require_csv();
  var { askFields, askSplit } = require_modal();
  var { transactionsCsv, categoriesCsv, transactionsMarkdown, categoriesMarkdown, exportPaths } = require_exporter();
  var { ISO_DATE, todayIso } = require_dates();
  module2.exports = function registerTransactions(ctx) {
    const { S, $, app, plugin, money, toast, writeFile, writeVaultFile, periodTitle, periodMonthName, txInPeriod, deferredCatSelect, learnRules, txSegment } = ctx;
    const pendingLearns = new Map;
    const clearSaveButton = ctx.registerSaveButton("#txSave");
    const PAGE = 100;
    let shown = PAGE, shownFor = null;
    function filteredRows() {
      let list;
      const whole = $("#txWholeHistory").checked;
      if (whole) {
        list = [];
        for (const f of Object.values(S.txFiles))
          for (const r of f.rows)
            list.push({ ...r, label: f.label, _file: f, _row: r });
        list.sort((a, b) => b.date.localeCompare(a.date));
      } else {
        list = txInPeriod(S.period).reverse();
      }
      const acc = $("#txAccount").value, cat = $("#txCategory").value, q = $("#txSearch").value.trim().toLowerCase();
      const rows = list.filter((t) => (!acc || t.label === acc) && (!cat || (cat === "__none__" ? !t.cat : t.cat === cat)) && (!q || t.desc.toLowerCase().includes(q)));
      const filters = [];
      if (acc)
        filters.push(`account: ${acc}`);
      if (cat)
        filters.push(`category: ${cat === "__none__" ? "Uncategorised" : cat}`);
      if (q)
        filters.push(`search: "${$("#txSearch").value.trim()}"`);
      return {
        rows,
        token: `${acc}|${cat}|${q}|${whole}|${S.period}`,
        range: whole ? "Whole history" : `${periodMonthName(S.period)} ${periodTitle(S.period)}`,
        filters
      };
    }
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
      const { rows: filtered, token: renderToken } = filteredRows();
      let list = filtered;
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
      const r = await askFields(app, "Add transaction", [
        { key: "date", label: "Date", type: "date", value: todayIso() },
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
      if (!ISO_DATE.test(date))
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
      clearSaveButton();
      toast(`Saved ${n} file${n === 1 ? "" : "s"}` + (learned ? ` · learned ${learned} new rule${learned === 1 ? "" : "s"}` : ""));
    }
    async function exportTransactions() {
      if (Object.values(S.txFiles).some((f) => f.dirty)) {
        return toast("Save your changes first — an export of unsaved edits would not match the vault", true);
      }
      const { rows, range, filters } = filteredRows();
      if (!rows.length)
        return toast("Nothing to export — no rows match the current filters", true);
      const answer = await askFields(app, "Export transactions", [{
        key: "folder",
        label: "Save to folder",
        desc: `Vault folder for the export. ${rows.length} row${rows.length === 1 ? "" : "s"} (${range}) plus ${S.categories.length} categories, as CSV and markdown.`,
        value: plugin.settings.exportFolder || "Exports",
        placeholder: "Exports"
      }]);
      if (!answer)
        return;
      const paths = exportPaths(range, answer.folder);
      const generated = new Date().toISOString().slice(0, 16).replace("T", " ");
      let written;
      try {
        written = await writeVaultFile(paths.txCsv, transactionsCsv(rows));
        await writeVaultFile(paths.txMd, transactionsMarkdown(rows, { range, filters, generated }, money));
        await writeVaultFile(paths.catCsv, categoriesCsv(S.categories));
        await writeVaultFile(paths.catMd, categoriesMarkdown(S.categories, generated));
      } catch (e) {
        console.error("Budget: export failed", e);
        return toast("Could not write the export — check the folder name", true);
      }
      if (plugin.settings.exportFolder !== paths.dir) {
        plugin.settings.exportFolder = paths.dir;
        await plugin.saveSettings();
      }
      toast(`Exported ${rows.length} row${rows.length === 1 ? "" : "s"} and ${S.categories.length} categories to ${written.split("/").slice(0, -1).join("/")}/`);
    }
    ctx.provide({ renderTransactions, serializeTxFile, saveTransactions, addTransaction, splitTransaction, exportTransactions });
  };
});

// src/views/budgets.js
var require_budgets = __commonJS((exports2, module2) => {
  var { el, icoEl } = require_dom();
  var { escMd, patchFrontmatter } = require_markdown();
  var { TYPE_ORDER } = require_constants();
  var i18n = require_i18n();
  module2.exports = function registerBudgets(ctx) {
    const { S, $, money, toast, typeBadge, writeFile, periodTitle, periodMonthName, periodSummary, periodRange, shiftPeriod, periodKeyValid, promptCreateCategory, promptDeleteCategory } = ctx;
    function otherShapeBudgets() {
      return Object.keys(S.budgets).filter((k) => !periodKeyValid(k) && (S.budgets[k] || []).length).sort();
    }
    function renderShapeNote() {
      const box = $("#budShapeNote");
      box.empty();
      const others = otherShapeBudgets();
      const thisOne = S.budgets[S.period] || [];
      if (thisOne.length || !others.length) {
        box.classList.add("hidden");
        return;
      }
      box.classList.remove("hidden");
      const newest = others[others.length - 1];
      const n = others.length;
      box.append(el("div", { class: "bud-shape-note-t" }, i18n.t("bud.shape.title")));
      box.append(el("p", {}, i18n.t("bud.shape.body", { count: n, newest })));
      box.append(el("button", {
        class: "btn btn-ghost",
        type: "button",
        onclick: () => bringOverFrom(newest)
      }, i18n.t("bud.shape.bring", { newest })));
    }
    function carryStructure(src, draft) {
      let brought = 0;
      for (const r of src) {
        const d = draft.find((x) => x.category === r.category);
        if (d) {
          if (!d.inFile && !d.amount && !(d.notes && d.notes.trim()) && r.notes) {
            d.notes = r.notes;
            d.inFile = true;
            brought++;
          }
        } else {
          draft.push({ ...r, amount: 0, amountRaw: null, inFile: true });
          brought++;
        }
      }
      return brought;
    }
    function bringOverFrom(key) {
      const src = S.budgets[key] || [];
      if (!src.length)
        return toast(i18n.t("bud.shape.empty"), true);
      const brought = carryStructure(src, budgetDraft());
      if (brought) {
        budDirty = true;
        $("#budSave").disabled = false;
      }
      renderBudgets();
      toast(brought ? i18n.t("bud.shape.brought", { count: brought }) : i18n.t("bud.shape.allHere"));
    }
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
    ctx.registerSaveButton("#budSave");
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
        {
          label: i18n.t("bud.total.income"),
          value: money(income),
          grad: true,
          note: i18n.t("bud.total.incomeNote", { amount: money(sum.income) })
        },
        {
          label: i18n.t("bud.total.budgeted"),
          value: money(budgeted),
          note: allocPct !== null ? i18n.t("bud.total.budgetedNote", { pct: allocPct }) : ""
        },
        {
          label: i18n.t(unallocated < 0 ? "bud.total.over" : "bud.total.left"),
          value: money(Math.abs(unallocated)),
          over: unallocated < 0,
          note: unallocated < 0 ? i18n.t("bud.total.overNote") : income > 0 ? i18n.t("bud.total.leftNote") : ""
        },
        {
          label: i18n.t("bud.total.spent"),
          value: money(sum.spend),
          over: budgeted > 0 && sum.spend > budgeted,
          note: usedPct !== null ? i18n.t("bud.total.spentNote", { pct: usedPct }) : ""
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
      renderShapeNote();
      const draft = budgetDraft();
      const sum = periodSummary(S.period);
      const t = $("#budTable");
      t.empty();
      t.append(el("thead", {}, el("tr", {}, el("th", { scope: "col" }, i18n.t("bud.col.category")), el("th", { scope: "col" }, i18n.t("bud.col.type")), el("th", { scope: "col", class: "num" }, i18n.t("bud.col.amount")), el("th", { scope: "col", class: "num" }, i18n.t("bud.col.actual")), el("th", { scope: "col" }, i18n.t("bud.col.notes")), el("th", { scope: "col" }, ""))));
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
          remainingEl.textContent = over ? i18n.t("bud.remaining.over", { amount: money(-rem) }) : i18n.t("bud.remaining.left", { amount: money(rem) });
          remainingEl.className = "bud-remaining" + (over ? " over" : "");
        };
        updateRemaining();
        body.append(el("tr", {}, el("td", {}, d.category), el("td", {}, typeBadge(d.type)), el("td", { class: "num" }, el("div", { class: "bud-amt-wrap" }, el("input", {
          type: "number",
          step: "0.01",
          class: "form-control form-control-sm",
          value: d.amount || "",
          "aria-label": i18n.t("bud.aria.amount", { category: d.category }),
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
          "aria-label": i18n.t("bud.aria.notes", { category: d.category }),
          onchange: (e) => {
            d.notes = e.target.value;
            mark();
          }
        })), el("td", { style: "white-space:nowrap" }, d.inFile ? el("button", { class: "btn-ghost btn-ghost-sm", "aria-label": i18n.t("bud.aria.clear", { category: d.category }), title: i18n.t("bud.title.clear"), onclick: () => {
          d.amount = 0;
          d.amountRaw = null;
          d.notes = "";
          d.inFile = false;
          mark();
          renderBudgets();
        } }, "✕") : "", el("button", { class: "btn-ghost btn-ghost-sm", "aria-label": i18n.t("bud.aria.delete", { category: d.category }), title: i18n.t("bud.title.delete"), onclick: async () => {
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
      toast(i18n.t("bud.saved", { period: S.period }));
    }
    function copyPreviousBudget() {
      const prev = S.budgets[shiftPeriod(S.period, -1)];
      if (!prev || !prev.length)
        return toast(i18n.t("bud.copy.none"), true);
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
      toast(copied ? i18n.t("bud.copy.done", { count: copied }) : i18n.t("bud.copy.nothing"));
    }
    async function addNewCategory() {
      const cat = await promptCreateCategory();
      if (!cat)
        return;
      budgetDraft().push({ category: cat.name, type: cat.type, amount: 0, notes: "", inFile: false });
      renderBudgets();
    }
    ctx.provide({
      renderBudgets,
      saveBudget,
      copyPreviousBudget,
      addNewCategory,
      invalidateBudgetDraft,
      budgetDirty,
      otherShapeBudgets,
      carryStructure
    });
  };
});

// src/views/accounts.js
var require_accounts = __commonJS((exports2, module2) => {
  var { el, kpiTiles, icoEl } = require_dom();
  var { normalizeAmount } = require_amount();
  var { patchFrontmatter, yamlStr } = require_markdown();
  var { safeSeg } = require_vault_path();
  var { askFields } = require_modal();
  var { STALE_DAYS, daysSince, isStale, reconcile } = require_reconcile();
  var { ISO_DATE, todayIso } = require_dates();
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
      accountIndex,
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
      const n = normalizeAmount(s);
      return n === null ? NaN : n;
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
        if (isStale(a.balance_updated))
          return true;
        return reconcile(a, e.rows).state === "drift";
      }).length;
      const elsewhere = (S.assets || []).some((a) => a.value > 0) || (S.debts || []).some((d) => d.status !== "paid" && d.balance > 0);
      const tile = kpiTiles(wrap);
      tile("In credit", money(assets), "text-success");
      tile("Overdrawn", money(liabilities), liabilities > 0 ? "text-danger" : "");
      tile("Net worth", money(assets - liabilities), assets - liabilities >= 0 ? "grad-txt" : "text-danger", elsewhere ? "across these accounts only" : null);
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
      accountReconcile: reconcile,
      accountUtilisation: utilisationOf,
      ACCOUNT_FM_KEYS: EDITABLE_KEYS
    });
  };
});

// src/savings-math.js
var require_savings_math = __commonJS((exports2, module2) => {
  var { ISO_DATE } = require_dates();
  function splitFlows(rows, typeOf, opts) {
    const from = opts && opts.from || "";
    const to = opts && opts.to || "";
    let contributions = 0, growth = 0, withdrawals = 0, count = 0;
    const growthCategories = new Map;
    for (const r of rows || []) {
      if (!r || typeof r.amount !== "number" || !r.amount)
        continue;
      if (from && r.date < from)
        continue;
      if (to && r.date > to)
        continue;
      count++;
      if (r.amount < 0) {
        withdrawals += -r.amount;
        continue;
      }
      const t = typeOf ? typeOf(r.cat) : null;
      if (t === "income") {
        growth += r.amount;
        const k = r.cat || "(uncategorised)";
        growthCategories.set(k, (growthCategories.get(k) || 0) + r.amount);
      } else {
        contributions += r.amount;
      }
    }
    return {
      contributions,
      growth,
      withdrawals,
      count,
      net: contributions + growth - withdrawals,
      growthCategories: [...growthCategories].sort((a, b) => b[1] - a[1]).map(([cat, amount]) => ({ cat, amount }))
    };
  }
  function accountFlows(account, rows, typeOf, opts) {
    const a = account || {};
    const balance = typeof a.balance === "number" ? a.balance : 0;
    const has = (rows || []).length > 0;
    if (has) {
      const f = splitFlows(rows, typeOf, opts);
      return {
        basis: "derived",
        opening: balance - f.net,
        contributions: f.contributions,
        growth: f.growth,
        withdrawals: f.withdrawals,
        closing: balance,
        count: f.count,
        growthCategories: f.growthCategories
      };
    }
    const baseline = a.total_invested || a.starting_amount || 0;
    if (baseline) {
      return {
        basis: "stated",
        opening: baseline,
        contributions: 0,
        growth: balance - baseline,
        withdrawals: 0,
        closing: balance,
        count: 0,
        growthCategories: []
      };
    }
    return {
      basis: "none",
      opening: balance,
      contributions: 0,
      growth: 0,
      withdrawals: 0,
      closing: balance,
      count: 0,
      growthCategories: []
    };
  }
  function contributionRate(rows, typeOf, months, today) {
    if (!months || months < 1)
      return null;
    const now = today && ISO_DATE.test(today) ? today : null;
    if (!now)
      return null;
    const [y, m] = now.split("-").map(Number);
    const endY = m === 1 ? y - 1 : y, endM = m === 1 ? 12 : m - 1;
    const startTotal = endY * 12 + (endM - 1) - (months - 1);
    const sY = Math.floor(startTotal / 12), sM = startTotal % 12 + 1;
    const from = `${String(sY).padStart(4, "0")}-${String(sM).padStart(2, "0")}-01`;
    const to = `${String(endY).padStart(4, "0")}-${String(endM).padStart(2, "0")}-31`;
    const f = splitFlows(rows, typeOf, { from, to });
    if (!f.count)
      return null;
    return { perMonth: f.contributions / months, months, from, to, total: f.contributions };
  }
  module2.exports = { splitFlows, accountFlows, contributionRate };
});

// src/views/savings.js
var require_savings = __commonJS((exports2, module2) => {
  var { el, kpiTiles, icoEl } = require_dom();
  var { themeColors, createChart, tip, parseColor } = require_chart();
  var { isStale, stalenessSummary, reconcile } = require_reconcile();
  var { todayIso } = require_dates();
  var { accountFlows } = require_savings_math();
  var { worth, activeDebts, cardOverlap, debtsByType, assetsByType } = require_worth();
  var { daysSince } = require_reconcile();
  var worthSeq = 0;
  module2.exports = function registerSavings(ctx) {
    const { S, $, root, money, toast, accountIndex, catType, saveAccount } = ctx;
    function renderSavings() {
      const savings = S.accounts.filter((a) => a.type === "savings");
      const investments = S.accounts.filter((a) => a.type === "investment");
      const totalSavings = savings.reduce((s, a) => s + a.balance, 0);
      const totalInvest = investments.reduce((s, a) => s + a.balance, 0);
      const w = worth(S.accounts, S.debts, S.assets);
      const netWorth = w.net;
      const tile = kpiTiles($("#savingsKpis"));
      tile("Net worth", money(netWorth), netWorth >= 0 ? "grad-txt" : "text-danger");
      tile("Savings", money(totalSavings));
      tile("Investments", money(totalInvest));
      tile("Debt", money(-w.liabilities), "text-danger", w.fromDebts && w.fromAccounts ? `${money(w.fromAccounts, 0)} accounts · ${money(w.fromDebts, 0)} debt page` : null);
      renderStaleNote();
      renderWorth();
      renderGoals();
      renderSections(savings, investments, accountIndex());
    }
    async function acceptImplied(a, implied) {
      a.balance = implied;
      a.balanceRaw = null;
      a.balance_updated = todayIso();
      await saveAccount(a);
      renderSavings();
      toast(`${a.name} reconciled to ${money(implied)}`);
    }
    const ASSET_STALE_DAYS = 365;
    function staleAssets() {
      return (S.assets || []).filter((a) => {
        const d = daysSince(a.valued);
        return (d === null || d > ASSET_STALE_DAYS) && a.value > 0;
      });
    }
    function renderStaleNote() {
      const wrap = $("#savingsStale");
      wrap.empty();
      renderAssetCaveat(wrap);
      const s = stalenessSummary(S.accounts);
      if (!s.stale)
        return;
      const all = s.stale === s.total;
      const line = all ? `Built from ${s.total === 1 ? "a balance" : `${s.total} balances`} nobody has confirmed recently` : `Built from ${s.stale} of ${s.total} balances nobody has confirmed recently`;
      const age = s.oldestDays === null ? "none of them carry a date" : `the oldest ${s.oldestDays} days ago`;
      const note = el("div", { class: "kpi-caveat-txt" }, icoEl(["info", "alert-circle"]), `${line} — ${age}.`);
      const btn = el("button", {
        type: "button",
        class: "kpi-caveat-btn",
        "aria-label": "Review account balances on the Accounts page"
      }, "Review balances");
      btn.addEventListener("click", () => ctx.switchView("accounts"));
      wrap.append(note, btn);
    }
    function renderAssetCaveat(wrap) {
      const stale = staleAssets();
      if (!stale.length)
        return;
      const owned = stale.reduce((t, a) => t + a.value, 0);
      wrap.append(el("div", { class: "kpi-caveat-txt" }, icoEl(["info", "alert-circle"]), `${money(owned, 0)} of what you own was last valued over a year ago.`));
      const btn = el("button", {
        type: "button",
        class: "kpi-caveat-btn",
        "aria-label": "Review asset valuations on the Assets page"
      }, "Review valuations");
      btn.addEventListener("click", () => ctx.switchView("assets"));
      wrap.append(btn);
    }
    function renderGoals() {
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
          const stale = isStale(a.balance_updated);
          const pctLine = reached ? "Goal reached!" : `${Math.round(pct)}%${a.target_date ? " · target " + a.target_date : ""}`;
          g.append(el("div", {}, el("div", { class: "goal-h" }, el("div", { class: "gn" }, a.name), el("div", { class: "gv" }, el("b", {}, money(a.balance)), " / ", money(a.goal_amount))), el("div", { class: `cat-bar${stale ? " cat-bar-stale" : ""}` }, el("i", { class: "cat-bar-fill", style: `width:${pct}%` })), el("div", { class: "goal-pct" }, pctLine, ...stale ? [el("span", { class: "goal-stale" }, " · balance unconfirmed")] : [])));
        }
        goalsWrap.append(g);
      }
    }
    function renderSections(savings, investments, idx) {
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
          const rows = (idx.get(a) || {}).rows || [];
          const flows = accountFlows(a, rows, catType);
          if (flows.basis === "derived") {
            const g = flows.growth;
            const line = el("div", { class: "s2" }, `in ${money(flows.contributions, 0)} · `, el("span", { class: `num ${g >= 0 ? "text-success" : "text-danger"}` }, `${g >= 0 ? "▲" : "▼"} ${money(Math.abs(g), 0)}`));
            if (flows.withdrawals)
              line.append(` · out ${money(flows.withdrawals, 0)}`);
            card.append(line);
            if (flows.growthCategories.length > 1) {
              card.append(el("div", {
                class: "s2 s2-caveat",
                title: "Anything here that is not interest or dividends is really a contribution. " + "Recategorise the rows, or change the category's type, and this figure corrects itself."
              }, "growth from " + flows.growthCategories.map((c) => `${c.cat} ${money(c.amount, 0)}`).join(", ")));
            }
          } else if (flows.basis === "stated") {
            const over = flows.growth;
            card.append(el("div", { class: `s2 num ${over >= 0 ? "text-success" : "text-danger"}` }, `${over >= 0 ? "▲" : "▼"} ${money(Math.abs(over), 0)} vs ${money(flows.opening, 0)} in`));
            card.append(el("div", {
              class: "s2 s2-caveat",
              title: "No transactions in the vault for this account, so this is the balance less what the " + "account file records as put in. Import its statements and the split becomes real."
            }, "from the account file"));
          } else if (a.inception_date) {
            card.append(el("div", { class: "s2" }, `since ${a.inception_date}`));
          }
          const rec = reconcile(a, rows);
          if (rec.state === "drift") {
            const line = el("div", { class: "acct-recon" }, el("div", { class: "acct-recon-txt" }, `${rec.count} since · implies `, el("b", { class: "num" }, money(rec.implied)), rec.ahead ? ` · ${rec.ahead} dated ahead` : ""));
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
          }
          grid.append(card);
        }
        wrap.append(el("div", { class: "card mb-4" }, el("div", { class: "card-h" }, el("div", {}, el("h2", {}, title), el("div", { class: "sub" }, `${list.length} accounts`)), el("div", { class: "legend" }, el("span", {}, el("b", { class: "num", style: "font-size:15px;color:var(--text-primary)" }, money(total))))), el("div", { class: "body-pad" }, grid)));
      }
    }
    const WORTH_TYPES = [
      ["investment", "Investments", "--color-investment", "#6f42c1"],
      ["savings", "Savings", "--color-success", "#22c55e"],
      ["checking", "Cheque", "--color-info", "#0ea5e9"],
      ["cash", "Cash", "--color-accent", "#0d9488"],
      ["credit_card", "Credit cards", "--color-danger", "#f43f5e"],
      ["other", "Other", "--ink-faint", "#5f6779"]
    ];
    function renderWorth() {
      const wrap = $("#savingsWorth");
      wrap.empty();
      const css = getComputedStyle(root);
      const c = themeColors(root);
      const assets = [], debts = [];
      for (const [type, label, varName, fallback] of WORTH_TYPES) {
        const color = (css.getPropertyValue(varName) || "").trim() || fallback;
        const inType = S.accounts.filter((a) => a.type === type);
        const pos = inType.reduce((t, a) => t + Math.max(0, a.balance), 0);
        const neg = inType.reduce((t, a) => t + Math.min(0, a.balance), 0);
        if (pos > 0)
          assets.push({ label, amount: pos, color });
        if (neg < 0)
          debts.push({ label, amount: -neg, color });
      }
      const ASSET_VARS = ["--color-accent", "--color-investment", "--color-info", "--ink-faint"];
      const ASSET_FALLBACKS = ["#0d9488", "#6f42c1", "#0ea5e9", "#5f6779"];
      assetsByType(S.assets).forEach((a, i) => {
        const color = (css.getPropertyValue(ASSET_VARS[i % ASSET_VARS.length]) || "").trim() || ASSET_FALLBACKS[i % ASSET_FALLBACKS.length];
        assets.push({ label: a.type, amount: a.amount, color, fromAssetPage: true });
      });
      const DEBT_VARS = ["--color-warning", "--color-danger", "--color-investment", "--ink-faint"];
      const DEBT_FALLBACKS = ["#f5a524", "#f43f5e", "#6f42c1", "#5f6779"];
      debtsByType(S.debts).forEach((d, i) => {
        const color = (css.getPropertyValue(DEBT_VARS[i % DEBT_VARS.length]) || "").trim() || DEBT_FALLBACKS[i % DEBT_FALLBACKS.length];
        debts.push({ label: d.type, amount: d.amount, color, fromDebtPage: true });
      });
      const totalAssets = assets.reduce((t, x) => t + x.amount, 0);
      const totalDebts = debts.reduce((t, x) => t + x.amount, 0);
      const net = totalAssets - totalDebts;
      const active = activeDebts(S.debts);
      const overlap = cardOverlap(S.accounts, S.debts);
      const ledgers = [
        "your accounts",
        ...S.assets && S.assets.some((a) => a.value > 0) ? ["the Assets page"] : [],
        ...active.length ? ["the Debt page"] : []
      ];
      const across = ledgers.length > 1 ? `Across ${ledgers.slice(0, -1).join(", ")} and ${ledgers[ledgers.length - 1]}` : "Across your accounts";
      $("#savingsWorthSub").textContent = overlap ? `${across} · a credit card appears on two of them, so it may be counted twice` : across;
      if (!totalAssets && !totalDebts) {
        wrap.append(el("p", { class: "text-muted", style: "margin:0" }, "Add a balance to any account and the split appears here."));
        return;
      }
      const W = 1000, H = 210, padL = 8, padR = 8, barH = 46;
      const scale = Math.max(totalAssets, totalDebts, 1);
      const innerW = W - padL - padR;
      const uid = `bud-worth-${++worthSeq}`;
      const listFor = (segs) => segs.map((s) => `${s.label} ${money(s.amount, 0)}`).join(", ");
      const { svg, add } = createChart({
        w: W,
        h: H,
        cls: "worth-svg",
        label: `Net worth ${money(net)}: assets ${money(totalAssets)} against debts ${money(totalDebts)}` + (assets.length ? `. Owned: ${listFor(assets)}` : "") + (debts.length ? `. Owed: ${listFor(debts)}` : "")
      });
      const defs = add("defs", {});
      const sheen = add("linearGradient", { id: `${uid}-sheen`, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
      add("stop", { offset: "0%", "stop-color": "#ffffff", "stop-opacity": "0.22" }, sheen);
      add("stop", { offset: "48%", "stop-color": "#ffffff", "stop-opacity": "0.05" }, sheen);
      add("stop", { offset: "100%", "stop-color": "#000000", "stop-opacity": "0.08" }, sheen);
      const hoverable = typeof window.matchMedia === "function" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
      const tipBox = el("div", { class: "worth-tip", "aria-hidden": "true" });
      const tipName = el("div", { class: "worth-tip-name" });
      const tipVal = el("div", { class: "worth-tip-val num" });
      tipBox.append(tipName, tipVal);
      const clearHover = () => {
        svg.classList.remove("is-hover");
        for (const n of svg.querySelectorAll(".worth-seg.is-on"))
          n.classList.remove("is-on");
        tipBox.classList.remove("is-on");
      };
      const row = (y, segs, total, heading, idx) => {
        add("text", {
          x: padL,
          y: y - 10,
          "font-size": "13",
          "font-weight": "600",
          fill: "currentColor",
          "fill-opacity": "0.55",
          "font-family": "inherit"
        }).textContent = heading;
        add("text", {
          x: W - padR,
          y: y - 10,
          "text-anchor": "end",
          "font-size": "13",
          "font-weight": "700",
          fill: "currentColor",
          "fill-opacity": "0.8",
          "font-family": "inherit"
        }).textContent = money(total, 0);
        add("rect", {
          x: padL,
          y,
          width: innerW,
          height: barH,
          rx: 10,
          fill: "currentColor",
          "fill-opacity": "0.05"
        });
        if (!total)
          return;
        const clip = add("clipPath", { id: `${uid}-wipe-${idx}` }, defs);
        add("rect", {
          class: `worth-wipe${idx ? " worth-wipe--b" : ""}`,
          x: padL,
          y,
          width: innerW,
          height: barH
        }, clip);
        const band = add("g", { "clip-path": `url(#${uid}-wipe-${idx})` });
        let x = padL;
        for (const seg of segs) {
          const w = seg.amount / scale * innerW;
          const share = Math.round(seg.amount / total * 100);
          const rgb = parseColor(seg.color);
          const g = add("g", {
            class: "worth-seg",
            style: rgb ? `--seg-soft:rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.28);` + `--seg-glow:rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.6)` : null
          }, band);
          const node = add("rect", {
            x,
            y,
            width: Math.max(2, w),
            height: barH,
            fill: seg.color,
            rx: w > 20 ? 10 : 2
          }, g);
          if (hoverable) {
            g.addEventListener("pointerenter", () => {
              svg.classList.add("is-hover");
              for (const n of svg.querySelectorAll(".worth-seg.is-on"))
                n.classList.remove("is-on");
              g.classList.add("is-on");
              tipName.textContent = seg.label;
              tipVal.textContent = `${money(seg.amount)} · ${share}% of ${heading.toLowerCase()}`;
              tipBox.classList.add("is-on");
            });
          } else {
            tip(add, node, `${seg.label}: ${money(seg.amount)} · ${share}% of ${heading.toLowerCase()}`);
          }
          if (w > 96) {
            add("text", {
              x: x + w / 2,
              y: y + barH / 2 + 5,
              "text-anchor": "middle",
              "font-size": "13",
              "font-weight": "600",
              fill: c.hole,
              "font-family": "inherit"
            }, g).textContent = seg.label;
          }
          x += w;
        }
        add("rect", {
          x: padL,
          y,
          width: total / scale * innerW,
          height: barH,
          rx: 10,
          fill: `url(#${uid}-sheen)`,
          "pointer-events": "none"
        }, band);
      };
      row(34, assets, totalAssets, "What you own", 0);
      row(132, debts, totalDebts, "What you owe", 1);
      if (hoverable) {
        svg.addEventListener("pointermove", (e) => {
          if (!tipBox.classList.contains("is-on"))
            return;
          const r = svg.getBoundingClientRect();
          const pad = Math.min(60, r.width / 2);
          tipBox.style.left = `${Math.max(pad, Math.min(e.clientX - r.left, r.width - pad))}px`;
          tipBox.style.top = `${e.clientY - r.top}px`;
        });
        svg.addEventListener("pointerleave", clearHover);
      }
      wrap.append(svg, tipBox);
      const legend = el("ul", { class: "donut-legend donut-legend--inline" });
      for (const seg of [...assets, ...debts.map((d) => ({ ...d, label: `${d.label} (owed)` }))]) {
        legend.append(el("li", {}, el("i", { style: `background:${seg.color}` }), el("span", { class: "dl-name" }, seg.label), el("span", { class: "dl-val num" }, money(seg.amount, 0))));
      }
      wrap.append(legend);
    }
    ctx.provide({ renderSavings, renderWorth });
  };
});

// src/views/assets.js
var require_assets = __commonJS((exports2, module2) => {
  var { el, kpiTiles, dateInput, keepScroll, icoEl } = require_dom();
  var { normalizeAmount } = require_amount();
  var { escMd } = require_markdown();
  var { askFields } = require_modal();
  var { daysSince } = require_reconcile();
  var { todayIso } = require_dates();
  var { assetTotal } = require_worth();
  var ASSET_TYPES = [
    "property",
    "vehicle",
    "household contents",
    "jewellery",
    "precious metals",
    "electronics",
    "collectibles",
    "equipment",
    "other"
  ];
  var VALUED_STALE_DAYS = 365;
  module2.exports = function registerAssets(ctx) {
    const { S, $, app, money, toast, writeFile } = ctx;
    const { mark, clear: clearDirty } = ctx.dirtyFlag("assetsDirty", "#assetSave");
    const isUnvalued = (a) => {
      const d = daysSince(a.valued);
      return d === null || d > VALUED_STALE_DAYS;
    };
    function valuedAge(a) {
      const d = daysSince(a.valued);
      if (d === null)
        return a.valued ? null : "never valued";
      if (d < 0)
        return "valued ahead of today";
      if (d < 31)
        return d <= 1 ? "valued today" : `valued ${d} days ago`;
      const months = Math.round(d / 30.44);
      if (months < 18)
        return `valued ${months} month${months === 1 ? "" : "s"} ago`;
      const years = Math.round(d / 365.25);
      return `valued ${years} year${years === 1 ? "" : "s"} ago`;
    }
    function renderAssetKpis() {
      const total = assetTotal(S.assets);
      const biggest = S.assets.length ? S.assets.reduce((b, a) => a.value > b.value ? a : b) : null;
      const unvalued = S.assets.filter(isUnvalued).length;
      const tile = kpiTiles($("#assetKpis"));
      tile("Total value", money(total), total > 0 ? "text-success" : "");
      tile("Items", String(S.assets.length));
      tile("Largest", biggest ? money(biggest.value, 0) : "—", "", biggest ? biggest.name : null);
      tile("Unvalued", String(unvalued), unvalued > 0 ? "text-warning" : "", unvalued > 0 ? "not valued in the last year" : "every value is current");
    }
    function renderAssetStale() {
      const wrap = $("#assetStale");
      wrap.empty();
      const stale = S.assets.filter(isUnvalued);
      if (!stale.length)
        return;
      const all = stale.length === S.assets.length;
      const share = assetTotal(stale) / (assetTotal(S.assets) || 1);
      const subject = all ? S.assets.length === 1 ? "This value is" : "Every value here is" : `${stale.length} of ${S.assets.length} values are`;
      wrap.append(el("div", { class: "kpi-caveat-txt" }, icoEl(["info", "alert-circle"]), `${subject} over a year old` + (share > 0.5 ? ` — and that is ${Math.round(share * 100)}% of the total.` : ".")));
    }
    function renderAssets(focusRow) {
      renderAssetKpis();
      renderAssetStale();
      const t = $("#assetTable");
      keepScroll(t, () => {
        t.empty();
        t.append(el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Item"), el("th", { scope: "col" }, "Kind"), el("th", { scope: "col", class: "num" }, "Value"), el("th", { scope: "col" }, "Valued"), el("th", { scope: "col" }, "Notes"), el("th", { scope: "col" }, ""))));
        const body = el("tbody", {});
        for (const a of S.assets) {
          const age = valuedAge(a);
          body.append(el("tr", {}, el("td", { style: "font-weight:600" }, a.name, ...age ? [el("div", { class: `asset-age${isUnvalued(a) ? " asset-age-old" : ""}` }, age)] : []), el("td", {}, el("select", {
            class: "form-select form-select-sm",
            "aria-label": `Kind of ${a.name}`,
            onchange: (e) => {
              a.type = e.target.value;
              mark();
              renderAssets();
            }
          }, ...a.type && !ASSET_TYPES.includes(a.type) ? [el("option", { value: a.type, selected: "" }, a.type)] : [], ...ASSET_TYPES.map((k) => el("option", { value: k, ...k === a.type ? { selected: "" } : {} }, k)))), el("td", { class: "num" }, el("input", {
            type: "number",
            step: "0.01",
            min: "0",
            class: "form-control form-control-sm",
            value: a.value || "",
            "aria-label": `Value of ${a.name}`,
            onchange: (e) => {
              a.value = Math.max(0, parseFloat(e.target.value) || 0);
              mark();
              renderAssetKpis();
            }
          })), el("td", {}, dateInput(a.valued, {
            class: "form-control form-control-sm",
            "aria-label": `Date ${a.name} was valued`
          }, (v) => {
            a.valued = v;
            mark();
            renderAssets();
          })), el("td", {}, el("input", {
            type: "text",
            class: "form-control form-control-sm",
            value: a.notes,
            "aria-label": `Notes for ${a.name}`,
            onchange: (e) => {
              a.notes = e.target.value;
              mark();
            }
          })), el("td", {}, el("button", {
            class: "btn-ghost btn-ghost-sm",
            "aria-label": `Remove ${a.name}`,
            onclick: () => {
              S.assets.splice(S.assets.indexOf(a), 1);
              mark();
              renderAssets();
            }
          }, "✕"))));
        }
        if (!S.assets.length) {
          body.append(el("tr", {}, el("td", { colspan: "6", class: "text-muted" }, "Nothing listed yet. Add the house, the car, the contents, anything with a " + "resale value — net worth counts what you owe on them either way.")));
        }
        t.append(body);
      });
      if (focusRow !== undefined && focusRow >= 0) {
        const sel = t.querySelectorAll("tbody select")[focusRow];
        if (sel)
          sel.focus();
      }
    }
    function serializeAssets() {
      const lines = [
        "---",
        ...(S.assetsFm || "kind: assets").split(`
`),
        "---",
        "",
        "# Assets",
        "",
        "What the household owns that is not an account — property, vehicles, contents,",
        "jewellery, metals. `Value` is what it would sell for today and `Valued` is when",
        "that was last worked out. Money owed against any of these lives on the Debt page.",
        "",
        "| Item | Kind | Value | Valued | Notes |",
        "|------|------|------:|--------|-------|"
      ];
      for (const a of S.assets) {
        lines.push(`| ${escMd(a.name)} | ${escMd(a.type)} | ${a.value.toFixed(2)} | ${escMd(a.valued)} | ${escMd(a.notes)} |`);
      }
      lines.push("");
      return lines.join(`
`);
    }
    async function saveAssets() {
      await writeFile("Assets.md", serializeAssets());
      clearDirty();
      toast("Saved Assets.md");
    }
    async function addAsset() {
      const r = await askFields(app, "New asset", [
        { key: "name", label: "What is it?", type: "text", placeholder: "e.g. The house" },
        { key: "type", label: "Kind", type: "select", value: "property", options: ASSET_TYPES },
        { key: "value", label: "What would it sell for?", type: "number", value: "0" },
        {
          key: "valued",
          label: "When was that worked out?",
          type: "date",
          value: todayIso(),
          desc: "Left as today if you are typing a figure you already know."
        }
      ]);
      if (!r || !r.name.trim())
        return;
      const value = normalizeAmount(r.value);
      if (value === null)
        return toast("Value must be a number", true);
      S.assets.push({
        name: r.name.trim(),
        type: r.type || "other",
        value: Math.max(0, value),
        valued: (r.valued || "").trim(),
        notes: ""
      });
      mark();
      renderAssets();
    }
    ctx.provide({ renderAssets, saveAssets, addAsset, serializeAssets, VALUED_STALE_DAYS });
  };
});

// src/debt-math.js
var require_debt_math = __commonJS((exports2, module2) => {
  var { ISO_DATE } = require_dates();
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
      return { months: 0, interest: 0, payoff: {}, settled: true, stalled: [], series: [0] };
    const roll = strategy !== "minimum";
    const pool = roll ? Math.max(0, Number(extra) || 0) : 0;
    const payoff = Object.create(null);
    const owed = () => list.reduce((t, d) => t + d.balance, 0);
    const series = [owed()];
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
      series.push(owed());
    }
    const stalled = list.filter((d) => d.balance > EPS).map((d) => d.name);
    return { months: m, interest, payoff, settled: !stalled.length, stalled, series };
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
  function expectedBalance(debt, today) {
    const d = debt || {};
    const original = Number(d.original) || 0;
    const pay = (Number(d.payment) || 0) + (Number(d.extra) || 0);
    if (!original || pay <= 0)
      return null;
    if (!ISO_DATE.test(d.start || "") || !ISO_DATE.test(today || ""))
      return null;
    const [sy, sm] = d.start.split("-").map(Number);
    const [ty, tm] = today.split("-").map(Number);
    const months = (ty - sy) * 12 + (tm - sm);
    if (months <= 0)
      return null;
    const r = monthlyRate(d.rate);
    let b = original;
    let paid = 0, interest = 0;
    for (let m = 0;m < months && b > EPS; m++) {
      const i = b * r;
      b += i;
      interest += i;
      const step = Math.min(pay, b);
      b -= step;
      paid += step;
    }
    return { expected: b, months, paid, interest, settled: b <= EPS };
  }
  module2.exports = { amortise, monthlyInterest, simulate, priorityOrder, addMonths, humanMonths, expectedBalance };
});

// src/views/debts.js
var require_debts = __commonJS((exports2, module2) => {
  var { el, kpiTiles, keepScroll, icoEl } = require_dom();
  var { normalizeAmount } = require_amount();
  var { escMd } = require_markdown();
  var { askFields } = require_modal();
  var { MONTHS } = require_constants();
  var { amortise, monthlyInterest, simulate, priorityOrder, addMonths, humanMonths, expectedBalance } = require_debt_math();
  var { todayIso } = require_dates();
  var {
    themeColors,
    createChart,
    scales,
    gridlines,
    axisLabels,
    linePath,
    areaPath,
    areaGradient,
    tip,
    RANGES,
    rangeFor
  } = require_chart();
  var DEBT_TYPES = ["credit card", "personal loan", "vehicle", "home loan", "student", "store account", "overdraft", "other"];
  module2.exports = function registerDebts(ctx) {
    const { S, $, root, app, plugin, money, toast, writeFile, txInPeriod } = ctx;
    const { mark, clear: clearDirty } = ctx.dirtyFlag("debtsDirty", "#debtSave");
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
      const tile = kpiTiles($("#debtKpis"));
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
        $("#debtCurve").empty();
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
      renderDebtCurve(runs);
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
      const { income, periods: nPeriods, complete } = ctx.monthlyIncome(S.period);
      const avgWindow = !complete ? "this period so far" : nPeriods === 1 ? "the last complete period" : `the last ${nPeriods} complete periods`;
      const scaleNote = iv ? ` monthly income, averaged over ${avgWindow},` : " income";
      const note = el("div", { class: "debt-dti" });
      if (income > 0) {
        const ratio = committedAll / income * 100;
        note.append(el("b", { class: `num ${ratio > 36 ? "text-danger" : ratio > 20 ? "text-warning" : "text-success"}` }, `${ratio.toFixed(1)}%`), ` of your${scaleNote} goes to debt payments — ${money(committedAll)} across ` + `${list.length} debt${list.length === 1 ? "" : "s"}`, el("span", { class: "text-muted" }, ratio > 36 ? ". Lenders treat above 36% as stretched." : "."));
      } else {
        note.append(el("span", { class: "text-muted" }, `${money(committedAll)} a month across ${list.length} debt${list.length === 1 ? "" : "s"}. ` + `No income recorded in ${iv ? avgWindow : "this period"}, so there is no ratio to show yet.`));
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
            const prog = d.original > 0 ? el("div", { class: "debt-prog" }, el("div", { class: "cat-bar" }, barFill), el("span", { class: "num" }, `${Math.round(paidOff)}%`)) : el("span", { class: "text-muted" }, "—");
            payoffCell.append(prog);
            if (d.status !== "paid") {
              const exp = expectedBalance(d, todayIso());
              if (exp) {
                const gap = d.balance - exp.expected;
                const material = Math.abs(gap) > Math.max(50, d.original * 0.02);
                if (material) {
                  payoffCell.append(el("div", {
                    class: "debt-implied",
                    title: `From ${money(d.original)} at ${d.rate}% paying ${money(committed(d))} a month since ${d.start}, ` + `the schedule puts this at ${money(exp.expected)} after ${exp.months} months. ` + `Your figure is ${money(Math.abs(gap))} ${gap > 0 ? "higher" : "lower"} — a missed payment, a rate change or a fee would explain it, and so would a stale balance.`
                  }, `schedule says ${money(exp.expected, 0)}`));
                }
              }
            }
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
      clearDirty();
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
      const balance = normalizeAmount(r.balance), rate = normalizeAmount(r.rate), payment = normalizeAmount(r.payment);
      if ([balance, rate, payment].some((v) => v === null))
        return toast("Balance, rate and payment must be numbers", true);
      S.debts.push({
        name,
        lender: (r.lender || "").trim(),
        type: r.type || "other",
        balance: Math.max(0, balance),
        original: Math.max(0, balance),
        rate: Math.max(0, rate),
        payment: Math.max(0, payment),
        extra: 0,
        start: todayIso(),
        category: (r.category || "").trim(),
        status: "active",
        notes: ""
      });
      mark();
      renderDebts();
    }
    const PLAN_LINES = [
      { key: "minimum", label: "Minimum only", dash: "5 6" },
      { key: "snowball", label: "Snowball" },
      { key: "avalanche", label: "Avalanche" }
    ];
    const debtRange = () => rangeFor(plugin.settings.chartDebtRange) || rangeFor("5y");
    function syncRangeSelect() {
      const sel = $("#debtRange");
      if (sel.options.length !== RANGES.length) {
        sel.empty();
        for (const r of RANGES)
          sel.append(el("option", { value: r.key }, `${r.label} view`));
      }
      sel.value = debtRange().key;
    }
    function renderDebtCurve(runs) {
      const wrap = $("#debtCurve");
      wrap.empty();
      syncRangeSelect();
      const months = debtRange().months;
      const chosen = planStrategy();
      const c = themeColors(root);
      const colorFor = (key) => key === "minimum" ? c.muted : key === chosen ? c.success : c.info;
      const lines = PLAN_LINES.map((l) => ({ ...l, series: (runs.find((r) => r.key === l.key) || {}).res?.series || [] })).filter((l) => l.series.length > 1);
      if (!lines.length)
        return;
      const longest = Math.max(...lines.map((l) => l.series.length - 1));
      const span = Math.max(2, Math.min(months, longest));
      const W = 1000, H = 260;
      const at = (series, m) => series[Math.min(m, series.length - 1)] ?? 0;
      const max = Math.max(1, ...lines.map((l) => l.series[0])) * 1.08;
      const s = scales({ w: W, h: H, count: span + 1, max, padB: 34 });
      const { svg, add } = createChart({
        w: W,
        h: H,
        label: `Total owed over the next ${humanMonths(span)} under each payoff plan`
      });
      const fill = areaGradient(add, "debtCurveArea", colorFor(chosen), 0.18);
      gridlines(add, s, W);
      const pts = (l) => Array.from({ length: span + 1 }, (_, m) => [s.x(m), s.y(at(l.series, m))]);
      const sel = lines.find((l) => l.key === chosen);
      if (sel)
        add("path", { d: areaPath(pts(sel), s.baseline), fill });
      for (const l of lines) {
        add("path", {
          d: linePath(pts(l)),
          fill: "none",
          stroke: colorFor(l.key),
          "stroke-opacity": l.key === chosen ? "1" : "0.7",
          "stroke-width": l.key === chosen ? "2.75" : "1.75",
          "stroke-dasharray": l.dash || null,
          "stroke-linecap": "round",
          "stroke-linejoin": "round"
        });
      }
      const step = Math.max(1, Math.ceil(span / 24));
      for (let m = 0;m <= span; m += step) {
        const hit = add("rect", {
          x: s.x(m) - s.innerW / (span * 2),
          y: s.padT,
          width: s.innerW / span,
          height: s.innerH,
          fill: "transparent"
        });
        tip(add, hit, `${monthLabel(addMonths(m))} — ` + lines.map((l) => `${l.label} ${money(at(l.series, m), 0)}`).join(" · "));
      }
      axisLabels(add, s, Array.from({ length: span + 1 }, (_, m) => monthLabel(addMonths(m))), H);
      wrap.append(svg);
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
  var { el, kpiTiles, dateInput, keepScroll, icoEl } = require_dom();
  var { normalizeAmount } = require_amount();
  var { escMd } = require_markdown();
  var { askFields } = require_modal();
  var { daysSince } = require_reconcile();
  var { outstandingOf, isSettled, owedSummary } = require_owed_math();
  module2.exports = function registerOwed(ctx) {
    const { S, $, app, money, toast, writeFile } = ctx;
    const { mark, clear: clearDirty } = ctx.dirtyFlag("owedDirty", "#owedSave");
    function renderOwedKpis() {
      const s = owedSummary(S.owed);
      const tile = kpiTiles($("#owedKpis"));
      tile("Outstanding", money(s.outstanding), s.outstanding > 0 ? "text-warning" : "");
      tile("Recovered", money(s.recovered), "text-success");
      tile("Entries", String(s.entries));
    }
    function renderOwed(focusPerson) {
      renderOwedKpis();
      const t = $("#owedTable");
      keepScroll(t, () => {
        t.empty();
        t.append(el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Person"), el("th", { scope: "col" }, "Description"), el("th", { scope: "col", class: "num" }, "Amount"), el("th", { scope: "col" }, "Due date"), el("th", { scope: "col" }, "Status"), el("th", { scope: "col" }, ""))));
        const body = el("tbody", {});
        for (const o of S.owed) {
          const settled = isSettled(o);
          const left = outstandingOf(o);
          const label = settled ? "Paid" : o.repaid > 0 ? `${money(left, 0)} left` : "Outstanding";
          const pill = el("button", {
            class: `status-pill status-${settled ? "paid" : "outstanding"}`,
            title: o.repaid > 0 ? `${money(o.amount)} lent · ${money(o.repaid)} back · ${money(left)} outstanding` : "",
            "aria-label": `${o.person}: ${label} — click to change`
          }, icoEl(settled ? ["circle-check", "check-circle"] : ["hourglass"]), label);
          pill.addEventListener("click", () => {
            o.status = settled ? "outstanding" : "paid";
            mark();
            renderOwed(o.person);
          });
          const age = daysSince(o.lent);
          body.append(el("tr", {}, el("td", { style: "font-weight:600" }, o.person, ...age !== null && !settled ? [el("div", { class: "owed-age" }, `out ${age} day${age === 1 ? "" : "s"}`)] : []), el("td", {}, el("input", {
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
          })), el("td", {}, pill), el("td", {}, el("div", { class: "owed-acts" }, el("button", {
            class: "btn-ghost btn-ghost-sm",
            "aria-label": `Record a repayment from ${o.person}`,
            title: "Record money that came back",
            onclick: () => recordRepayment(o)
          }, icoEl(["plus"])), el("button", {
            class: "btn-ghost btn-ghost-sm",
            "aria-label": `Remove ${o.person}`,
            onclick: () => {
              S.owed.splice(S.owed.indexOf(o), 1);
              mark();
              renderOwed();
            }
          }, "✕")))));
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
    async function recordRepayment(o) {
      const left = outstandingOf(o);
      const r = await askFields(app, `Repayment from ${o.person}`, [
        {
          key: "amount",
          label: "Amount that came back",
          type: "number",
          value: left ? left.toFixed(2) : "",
          desc: `${money(o.amount)} lent · ${money(o.repaid || 0)} back so far.`
        }
      ]);
      if (!r)
        return;
      const amount = normalizeAmount(r.amount);
      if (amount === null || amount <= 0)
        return toast("Not a number", true);
      o.repaid = (o.repaid || 0) + amount;
      if (outstandingOf(o) === 0)
        o.status = "paid";
      mark();
      renderOwed(o.person);
      toast(`${money(amount)} back from ${o.person}`);
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
        "`Repaid` is how much has come back; `Lent` is when it went out.",
        "",
        "| Person | Amount | Description | Due date | Status | Repaid | Lent |",
        "|--------|-------:|-------------|----------|--------|-------:|------|"
      ];
      for (const o of S.owed) {
        lines.push(`| ${escMd(o.person)} | ${o.amount.toFixed(2)} | ${escMd(o.description)} | ${escMd(o.due)} | ${o.status} | ${(o.repaid || 0).toFixed(2)} | ${escMd(o.lent || "")} |`);
      }
      lines.push("");
      return lines.join(`
`);
    }
    async function saveOwed() {
      await writeFile("Owed Money.md", serializeOwed());
      clearDirty();
      toast("Saved Owed Money.md");
    }
    async function addOwed() {
      const r = await askFields(app, "New owed entry", [
        { key: "person", label: "Who owes / is owed?", type: "text" },
        { key: "amount", label: "Amount", type: "number", value: "0" }
      ]);
      if (!r || !r.person.trim())
        return;
      const amount = normalizeAmount(r.amount);
      if (amount === null)
        return toast("Not a number", true);
      S.owed.push({ person: r.person.trim(), amount, description: "", due: "", status: "outstanding", repaid: 0, lent: "" });
      mark();
      renderOwed();
    }
    ctx.provide({ renderOwed, saveOwed, addOwed, serializeOwed });
  };
});

// src/recurring.js
var require_recurring = __commonJS((exports2, module2) => {
  var { ISO_DATE, isoDayNumber } = require_dates();
  var STOP = new Set([
    "the",
    "and",
    "for",
    "with",
    "plan",
    "plus",
    "pro",
    "premium",
    "couple",
    "family",
    "monthly",
    "annual",
    "yearly",
    "subscription",
    "account",
    "service",
    "services",
    "fee",
    "fees",
    "payment",
    "debit",
    "order",
    "card",
    "bank",
    "insurance",
    "data"
  ]);
  function normDesc(s) {
    return String(s || "").toLowerCase().replace(/\d+/g, " ").replace(/[^a-z]+/g, " ").replace(/\s+/g, " ").trim();
  }
  function serviceTokens(service) {
    const s = service || {};
    const words = normDesc(`${s.provider || ""} ${s.name || ""}`).split(" ");
    return [...new Set(words.filter((w) => w.length >= 4 && !STOP.has(w)))];
  }
  var median = (arr) => {
    if (!arr.length)
      return 0;
    const a = [...arr].sort((x, y) => x - y);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  function chargeStats(charges) {
    if (!charges || !charges.length)
      return null;
    const sorted = [...charges].sort((a, b) => a.date.localeCompare(b.date));
    const amounts = sorted.map((c) => Math.abs(c.amount));
    const months = [...new Set(sorted.map((c) => c.date.slice(0, 7)))];
    const days = sorted.map((c) => Number(c.date.slice(8, 10)));
    const W = Math.min(6, Math.floor(sorted.length / 2));
    const early = W >= 2 ? median(amounts.slice(0, W)) : null;
    const late = W >= 2 ? median(amounts.slice(-W)) : null;
    const recentAmounts = amounts.slice(-3);
    const recent = median(recentAmounts);
    const spread = recent ? (Math.max(...recentAmounts) - Math.min(...recentAmounts)) / recent : 0;
    return {
      count: sorted.length,
      months: months.length,
      median: median(amounts),
      recent,
      varies: spread > 0.15,
      first: sorted[0].date,
      last: sorted[sorted.length - 1].date,
      lastAmount: Math.abs(sorted[sorted.length - 1].amount),
      day: median(days),
      early,
      late,
      drift: early && late ? (late - early) / early : null
    };
  }
  function matchCharges(service, rows, tokens) {
    const toks = tokens || serviceTokens(service);
    if (!toks.length)
      return { charges: [], related: [], tokens: toks };
    const groups = new Map;
    for (const r of rows || []) {
      if (!r || typeof r.amount !== "number" || r.amount >= 0)
        continue;
      const n = normDesc(r.desc);
      if (!n)
        continue;
      if (!toks.some((t) => n.includes(t)))
        continue;
      if (!groups.has(n))
        groups.set(n, []);
      groups.get(n).push(r);
    }
    if (!groups.size)
      return { charges: [], related: [], tokens: toks };
    const scored = [...groups].map(([key, list]) => ({
      key,
      list,
      total: list.reduce((s, r) => s + Math.abs(r.amount), 0)
    })).sort((a, b) => b.total - a.total);
    return {
      charges: scored[0].list,
      related: scored.slice(1).map((g) => ({ key: g.key, count: g.list.length, total: g.total })),
      all: [...groups.values()].flat().sort((a, b) => a.date.localeCompare(b.date)),
      tokens: toks
    };
  }
  function nextExpected(stats, cycle) {
    if (!stats || !stats.last)
      return null;
    if (cycle === "annual") {
      const [y2, m2, d2] = stats.last.split("-").map(Number);
      return `${y2 + 1}-${String(m2).padStart(2, "0")}-${String(d2).padStart(2, "0")}`;
    }
    const [y, m, d] = stats.last.split("-").map(Number);
    const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
    const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
  }
  function chargeStatus(stats, cycle, today) {
    if (!stats)
      return { state: "unseen", daysSince: null };
    if (!ISO_DATE.test(today || ""))
      return { state: "active", daysSince: null };
    const gap = isoDayNumber(today) - isoDayNumber(stats.last);
    const cycleDays = cycle === "annual" ? 365 : 31;
    return { state: gap > cycleDays * 2 ? "overdue" : "active", daysSince: gap };
  }
  function comparePrice(service, stats) {
    const stated = Math.abs(Number((service || {}).amount) || 0);
    if (!stats || !stated)
      return null;
    if (stats.varies)
      return { stated, actual: null, varies: true, diff: null, pct: null, agrees: null };
    const actual = stats.recent;
    const diff = actual - stated;
    return {
      stated,
      actual,
      diff,
      varies: false,
      pct: stated ? diff / stated : null,
      agrees: Math.abs(diff) <= Math.max(2, stated * 0.04)
    };
  }
  module2.exports = {
    normDesc,
    serviceTokens,
    matchCharges,
    chargeStats,
    nextExpected,
    chargeStatus,
    comparePrice
  };
});

// src/views/services.js
var require_services = __commonJS((exports2, module2) => {
  var { el, kpiTiles, dateInput, keepScroll, icoEl } = require_dom();
  var { normalizeAmount } = require_amount();
  var { escMd } = require_markdown();
  var { askFields } = require_modal();
  var { ISO_DATE, todayIso } = require_dates();
  var { matchCharges, chargeStats, nextExpected, chargeStatus, comparePrice } = require_recurring();
  module2.exports = function registerServices(ctx) {
    const { S, $, app, money, toast, writeFile } = ctx;
    function monthlyEquiv(s) {
      return s.cycle === "annual" ? s.amount / 12 : s.amount;
    }
    function chargeIndex() {
      const rows = [];
      for (const f of Object.values(S.txFiles))
        for (const r of f.rows)
          rows.push(r);
      const today = todayIso();
      const out = new Map;
      for (const s of S.services) {
        const m = matchCharges(s, rows);
        const stats = chargeStats(m.charges);
        out.set(s, {
          stats,
          status: chargeStatus(chargeStats(m.all), s.cycle, today),
          price: comparePrice(s, stats),
          next: nextExpected(stats, s.cycle),
          related: m.related
        });
      }
      return out;
    }
    const { mark, clear: clearDirty } = ctx.dirtyFlag("servicesDirty", "#svcSave");
    function renderServicesKpis() {
      const active = S.services.filter((s) => s.active);
      const perMonth = active.reduce((sum, s) => sum + monthlyEquiv(s), 0);
      const tile = kpiTiles($("#servicesKpis"));
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
    function svcFlags(s, c) {
      const out = [];
      if (!c.stats) {
        out.push(el("span", {
          class: "category-badge badge-dup",
          title: `No charge in your transactions matches "${s.provider || s.name}". Either it is paid from an account you have not imported, or the name here does not match what your bank prints.`
        }, "not seen"));
        return out;
      }
      if (s.active && c.status && c.status.state === "overdue") {
        const months = Math.round(c.status.daysSince / 30);
        out.push(el("span", {
          class: "category-badge badge-transfer",
          title: `Last charged ${c.stats.last}. Still marked active — has it been cancelled?`
        }, `last charged ${months}mo ago`));
      }
      if (c.price && c.price.varies) {
        out.push(el("span", {
          class: "category-badge badge-dup",
          title: "The recent charges for this merchant differ too much from each other to call any of them the price — top-ups, or several products billed under one name."
        }, "varies"));
      } else if (c.price && !c.price.agrees) {
        const d = c.price.diff;
        out.push(el("span", {
          class: `category-badge ${d > 0 ? "badge-debt" : "badge-savings"}`,
          title: `Your bank is charging ${money(c.price.actual)}, not ${money(c.price.stated)}. Based on the last few charges, so a price rise shows up here rather than an old average.`
        }, `really ${money(c.price.actual, 0)}`));
      }
      return out;
    }
    function svcNextHint(s, c) {
      const stale = !s.next || s.next < todayIso();
      const btn = el("button", {
        type: "button",
        class: "svc-next-hint",
        title: `Billed around day ${c.stats.day} each ${s.cycle === "annual" ? "year" : "month"}; last charged ${c.stats.last}.`,
        "aria-label": `Set next billing for ${s.name} to ${c.next}`
      }, icoEl(["calendar-check", "calendar"]), stale ? `due ${c.next}` : c.next);
      btn.addEventListener("click", () => {
        s.next = c.next;
        mark();
        renderServices();
      });
      return btn;
    }
    function renderServices() {
      renderServicesKpis();
      const charged = chargeIndex();
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
            const c = charged.get(s) || {};
            body.append(el("tr", { class: s.active ? "" : "svc-inactive" }, el("td", { style: "font-weight:600" }, s.name, ...svcFlags(s, c)), el("td", { class: "text-muted" }, s.provider), el("td", { class: "num" }, el("input", {
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
            }), ...c.next && c.next !== s.next ? [svcNextHint(s, c)] : []), el("td", {}, el("input", {
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
      clearDirty();
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
      const amount = normalizeAmount(r.amount);
      if (amount === null)
        return toast("Not a number", true);
      const next = ISO_DATE.test((r.next || "").trim()) ? r.next.trim() : "";
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
      mark();
      renderServices();
    }
    ctx.provide({ renderServices, saveServices, addService, serializeServices });
  };
});

// src/views/tax.js
var require_tax = __commonJS((exports2, module2) => {
  var { el, kpiTiles, dateInput, keepScroll, icoEl } = require_dom();
  var { escMd, patchFrontmatter, yamlStr } = require_markdown();
  var { safeSeg } = require_vault_path();
  var { askFields, confirmModal } = require_modal();
  module2.exports = function registerTax(ctx) {
    const { S, $, app, toast, writeFile, writeBinary, fileAt, locale, money } = ctx;
    function currentTaxYear() {
      return locale().currentTaxYear(new Date);
    }
    const T = () => S.tax[S.taxYear];
    const { mark, clear: clearDirty } = ctx.dirtyFlag("taxDirty", "#taxSave");
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
      const tile = kpiTiles($("#taxKpis"));
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
      clearDirty();
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
    LOAN_PROFILES,
    GENERIC_LOAN_PROFILE,
    loanProfileFor
  };
});

// src/views/loans.js
var require_loans = __commonJS((exports2, module2) => {
  var { el } = require_dom();
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

// src/statement.js
var require_statement = __commonJS((exports2, module2) => {
  var { normalizeAmount } = require_amount();
  var { parseDelimited, sniffDelimiter } = require_csv();
  var parseStatement = (text) => parseDelimited(text, sniffDelimiter(text));
  function decodeStatement(bytes) {
    const b = bytes;
    if (b.length >= 2 && b[0] === 255 && b[1] === 254)
      return new TextDecoder("utf-16le").decode(b.subarray(2));
    if (b.length >= 2 && b[0] === 254 && b[1] === 255)
      return new TextDecoder("utf-16be").decode(b.subarray(2));
    if (b.length >= 3 && b[0] === 239 && b[1] === 187 && b[2] === 191)
      return new TextDecoder("utf-8").decode(b.subarray(3));
    const head = b.subarray(0, 256);
    let evenNul = 0, oddNul = 0;
    for (let i = 0;i < head.length; i++)
      if (head[i] === 0) {
        if (i % 2)
          oddNul++;
        else
          evenNul++;
      }
    if (head.length >= 8) {
      if (oddNul > head.length / 4 && evenNul === 0)
        return new TextDecoder("utf-16le").decode(b);
      if (evenNul > head.length / 4 && oddNul === 0)
        return new TextDecoder("utf-16be").decode(b);
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(b);
    } catch (e) {
      return new TextDecoder("windows-1252").decode(b);
    }
  }
  function isoParts(y, mo, d) {
    if (!y || y < 1000 || mo < 1 || mo > 12 || d < 1 || d > 31)
      return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  var MONTH_NUM = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
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
      const mo = MONTH_NUM[m[2].slice(0, 3).toLowerCase()];
      if (mo)
        return isoParts(+m[3], mo, +m[1]);
    }
    const dt = new Date(s);
    if (!isNaN(dt.getTime()))
      return isoParts(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    return null;
  }
  function counterpartyAccount(desc, accounts, selfLabel) {
    const runs = String(desc || "").match(/\d{4,}/g);
    if (!runs)
      return null;
    for (const n of runs) {
      for (const a of accounts || []) {
        const num = String(a.account_number || "").trim();
        if (!num || num !== n)
          continue;
        const label = a.tx_label || a.name;
        if (selfLabel && label === selfLabel)
          continue;
        return a;
      }
    }
    return null;
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
  module2.exports = {
    parseStatement,
    decodeStatement,
    parseStatementDate,
    counterpartyAccount,
    reconcileAmounts,
    detectHeaderlessColumns,
    detectStatementColumns
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
    NEAR_DAYS
  };
});

// src/views/import.js
var require_import = __commonJS((exports2, module2) => {
  var { el } = require_dom();
  var { normalizeAmount } = require_amount();
  var { parseStatement, decodeStatement, parseStatementDate, detectStatementColumns, reconcileAmounts, counterpartyAccount } = require_statement();
  var { prepareRules, autoCategorise } = require_rules();
  var { buildIndex, addToIndex, flagItems } = require_dedupe();
  module2.exports = function registerImport(ctx) {
    const { S, $, money, toast, writeFile, currentPeriod, periodRange, periodTitle, deferredCatSelect, serializeTxFile, locale, learnRules, txSegment, accountForLabel } = ctx;
    function renderImport() {
      const loc = locale();
      $("#importSubNote").textContent = loc.banks ? `Bank statement exports — tested with ${loc.banks}, other banks usually work too — or your own CSV` : "Bank statement exports — or any CSV / TSV with Date / Description / Amount columns";
      if (loc.importHint)
        $("#importDropHint").textContent = loc.importHint;
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
    async function handleStatementFile(file) {
      const text = decodeStatement(new Uint8Array(await file.arrayBuffer()));
      const rows = parseStatement(text);
      if (!rows.length)
        return toast("Empty statement file", true);
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
      const rules = prepareRules(S.rules);
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
          const other = counterpartyAccount(desc, S.accounts, label0);
          items.push({
            date,
            desc,
            amount: parseFloat(amount.toFixed(2)),
            cat: autoCategorise(desc, rules),
            include: true,
            excluded: !!other,
            transferTo: other ? other.tx_label || other.name : ""
          });
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
        return toast("Empty statement file", true);
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
        ] : [], ...it.transferTo ? [
          el("span", {
            class: "category-badge badge-transfer",
            title: `The description names your ${it.transferTo} account, so this looks like money moved between your own accounts rather than income or spend. Untick Exclude to count it.`
          }, "transfer")
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
    ctx.provide({ handleStatementFile, commitImport, renderImport, remapImport });
  };
});

// src/controller.js
var require_controller = __commonJS((exports2, module2) => {
  var { Notice } = require("obsidian");
  var { el, setIco, setInert } = require_dom();
  var { SHELL_HTML } = require_shell();
  var { confirmModal } = require_modal();
  var { localeFor } = require_locale();
  var { applyDom } = require_i18n();
  var { PALETTE_PRESETS, DEFAULT_PALETTE } = require_constants();
  var registerIo = require_io();
  var registerPeriod = require_period();
  var registerLoad = require_load();
  var registerCategories = require_categories();
  var registerDashboard = require_dashboard();
  var registerTransactions = require_transactions();
  var registerBudgets = require_budgets();
  var registerAccounts = require_accounts();
  var registerSavings = require_savings();
  var registerAssets = require_assets();
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
    applyDom(root);
    root.querySelectorAll("span[data-ico]").forEach((sp) => setIco(sp, sp.getAttribute("data-ico").split("|")));
    const $ = (s) => root.querySelector(s);
    const $$ = (s) => root.querySelectorAll(s);
    const S = {
      loaded: false,
      settings: { month_start_day: 23, currency: "R", country: "za", language: "en", period_days: 0, period_anchor: "" },
      categories: [],
      accounts: [],
      budgets: {},
      budgetMeta: {},
      txFiles: {},
      rules: [],
      assets: [],
      assetsDirty: false,
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
    const saveButtons = [];
    ctx.registerSaveButton = (sel) => {
      saveButtons.push(sel);
      return () => {
        const b = $(sel);
        if (b)
          b.disabled = true;
      };
    };
    function disableSaveButtons() {
      for (const sel of saveButtons) {
        const b = $(sel);
        if (b)
          b.disabled = true;
      }
    }
    ctx.dirtyFlag = (stateKey, saveSel) => {
      const disable = ctx.registerSaveButton(saveSel);
      ctx.registerDirty(() => !!S[stateKey]);
      return {
        mark: () => {
          S[stateKey] = true;
          const b = $(saveSel);
          if (b)
            b.disabled = false;
        },
        clear: () => {
          S[stateKey] = false;
          disable();
        }
      };
    };
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
    registerAssets(ctx);
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
        assets: ctx.renderAssets,
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
      for (const c of [...root.classList]) {
        if (c.startsWith("bud-palette-"))
          root.classList.remove(c);
      }
      const id = PALETTE_PRESETS[plugin.settings.palette] ? plugin.settings.palette : DEFAULT_PALETTE;
      root.classList.add(`bud-palette-${id}`);
      if (!S.loaded)
        return;
      if (S.view === "dashboard") {
        ctx.renderTrend();
        ctx.renderSplit();
      } else if (S.view === "savings")
        ctx.renderWorth();
      else if (S.view === "debts")
        ctx.replan();
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
      disableSaveButtons();
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
    const RELOAD_RETRY_MAX = 30000;
    let reloadTimer = null;
    function scheduleReload(delay) {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(async () => {
        if (Date.now() - ctx.lastWriteAt() < 2000)
          return;
        if (hasDirty())
          return scheduleReload(Math.min(delay * 2, RELOAD_RETRY_MAX));
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
      scheduleReload(800);
    };
    view.registerEvent(vault.on("modify", onFsChange));
    view.registerEvent(vault.on("create", onFsChange));
    view.registerEvent(vault.on("delete", onFsChange));
    view.registerEvent(vault.on("rename", onFsChange));
    view.registerEvent(app.workspace.on("css-change", applyTheme));
    function openPluginSettings() {
      app.setting.open();
      app.setting.openTabById("budget-app");
    }
    function wireDropZone(zoneSel, inputSel, handle) {
      const zone = $(zoneSel);
      const input = $(inputSel);
      zone.addEventListener("click", () => input.click());
      input.addEventListener("change", (e) => {
        if (e.target.files[0])
          handle(e.target.files[0]);
        e.target.value = "";
      });
      zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        zone.classList.add("dragover");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
      zone.addEventListener("drop", (e) => {
        e.preventDefault();
        zone.classList.remove("dragover");
        if (e.dataTransfer.files[0])
          handle(e.dataTransfer.files[0]);
      });
    }
    $("#openSettingsBtn").addEventListener("click", openPluginSettings);
    $("#brandHome").addEventListener("click", () => {
      if (S.loaded)
        switchView("dashboard");
    });
    $("#topbarAvatar").addEventListener("click", openPluginSettings);
    $("#topbarImport").addEventListener("click", () => {
      if (!S.loaded)
        return;
      switchView("import");
      if (!S.pendingImport)
        $("#fileInput").click();
    });
    $("#pluginSettingsLink").addEventListener("click", () => {
      closeDrawer();
      openPluginSettings();
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
    $("#txExport").addEventListener("click", ctx.exportTransactions);
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
    $("#assetSave").addEventListener("click", ctx.saveAssets);
    $("#assetAdd").addEventListener("click", ctx.addAsset);
    $("#debtSave").addEventListener("click", ctx.saveDebts);
    $("#debtAdd").addEventListener("click", ctx.addDebt);
    $("#debtExtra").addEventListener("input", ctx.replan);
    $("#debtStrategy").addEventListener("change", ctx.replan);
    $("#debtRange").addEventListener("change", async (e) => {
      plugin.settings.chartDebtRange = e.target.value;
      await plugin.saveSettings();
      ctx.replan();
    });
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
    wireDropZone("#taxDrop", "#taxFileInput", (f) => ctx.handleTaxFile(f));
    $("#impCommit").addEventListener("click", ctx.commitImport);
    $("#impRemap").addEventListener("click", ctx.remapImport);
    wireDropZone("#drop", "#fileInput", (f) => ctx.handleStatementFile(f));
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
      applyLanguage: () => {
        applyDom(root);
        render();
      },
      applyPrivacyLock: () => {
        if (plugin.settings.privacyLock)
          lockGate();
        else
          unlockGate();
      },
      cleanupRules: () => ctx.cleanupRules(),
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
  var i18n = require_i18n();
  var { setLanguage, LANGUAGE_NAMES, LANGUAGE_ORDER } = i18n;
  var { PERIOD_PRESETS, periodLengthOptions, TYPE_ORDER, MONTHS } = require_constants();
  var { periodDaysOrZero } = require_dates();
  var { normalizeAmount } = require_amount();
  var { todayIso, isoDayNumber, isoFromDayNumber, isRealIsoDate } = require_dates();
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
  var ACCOUNT_TYPE_KEYS = ["checking", "savings", "credit_card", "cash", "investment"];
  var accountTypes = () => ACCOUNT_TYPE_KEYS.map((k) => [k, i18n.t("wiz.acctType." + k)]);
  var CURRENCY_KEYS = [["R", "rand"], ["$", "dollar"], ["€", "euro"], ["£", "pound"], ["__custom__", "other"]];
  var currencies = () => CURRENCY_KEYS.map(([sym, k]) => [sym, i18n.t("wiz.ccy." + k)]);
  var typeLabel = (type) => i18n.t("wiz.type." + type);
  var stepTitle = (step) => i18n.t("wiz.step." + step);
  var monthLabel = (period) => {
    const [y, m] = period.split("-");
    return `${MONTHS[Number(m) - 1]} ${y}`;
  };
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
  function currentPeriodForCycle(days, anchor) {
    const today = isoDayNumber(todayIso());
    const a = isoDayNumber(anchor);
    return isoFromDayNumber(a + Math.floor((today - a) / days) * days);
  }
  var safeFileName = (s) => s.replace(/[\\/:*?"<>|]/g, "-").trim();

  class OnboardingWizard extends Modal {
    constructor(app, plugin) {
      super(app);
      this.plugin = plugin;
      this.finished = false;
      this.stepIdx = 0;
      this.mode = "create";
      this.error = "";
      this.data = {
        folder: plugin.settings.budgetFolder || "Finances/Budget",
        name: "",
        country: "za",
        language: i18n.defaultLanguage(),
        periodDays: 0,
        payday: 25,
        periodAnchor: "",
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
      return this.mode === "connect" ? ["welcome", "folder", "name", "country", "period", "finish"] : ["welcome", "folder", "name", "country", "period", "categories", "account", "finish"];
    }
    onOpen() {
      setLanguage(this.data.language);
      this.titleEl.setText(i18n.t("wiz.title"));
      this.renderStep();
    }
    onClose() {
      this.contentEl.empty();
      if (this.finished)
        return;
      if (this.stepIdx === 0)
        return;
      new Notice(i18n.t("wiz.skipped"), 8000);
      this.plugin.settings.onboarded = true;
      this.plugin.saveSettings();
    }
    renderStep() {
      const c = this.contentEl;
      const err = this.error;
      this.error = "";
      c.empty();
      const steps = this.steps();
      const step = steps[this.stepIdx];
      if (step !== "welcome") {
        c.createDiv({ cls: "budget-onb-step", text: i18n.t("wiz.stepOf", { n: this.stepIdx, total: steps.length - 1 }) });
        c.createEl("h3", { cls: "budget-onb-title", text: stepTitle(step) });
      }
      this["render_" + step](c);
      if (err)
        c.createDiv({ cls: "budget-onb-error", text: err });
      const nav = new Setting(c);
      nav.settingEl.addClass("budget-onb-nav");
      nav.addButton((b) => b.setButtonText(i18n.t("wiz.cancel")).onClick(() => this.close()));
      if (this.stepIdx > 0)
        nav.addButton((b) => b.setButtonText(i18n.t("wiz.back")).onClick(() => {
          this.stepIdx--;
          this.renderStep();
        }));
      nav.addButton((b) => b.setButtonText(step === "finish" ? i18n.t(this.mode === "connect" ? "wiz.connectBtn" : "wiz.createBtn") : step === "welcome" ? i18n.t("wiz.letsGo") : i18n.t("wiz.next")).setCta().onClick(() => this.next()));
    }
    fail(msg) {
      this.error = msg;
      this.renderStep();
    }
    async next() {
      const step = this.steps()[this.stepIdx];
      if (step === "folder") {
        const folder = normalizePath((this.data.folder || "").trim());
        if (!folder || folder === "/") {
          this.fail(i18n.t("wiz.err.folder"));
          return;
        }
        this.data.folder = folder;
        const wasConnect = this.mode === "connect";
        this.mode = this.detectExisting(folder) ? "connect" : "create";
        if (this.mode === "connect" && !wasConnect)
          await this.prefillFromSettingsMd();
      }
      if (step === "period") {
        if (!periodDaysOrZero(this.data.periodDays)) {
          const d = Number(this.data.payday);
          if (!Number.isInteger(d) || d < 1 || d > 28) {
            this.fail(i18n.t("wiz.err.monthStart"));
            return;
          }
        } else if (!isRealIsoDate(this.data.periodAnchor)) {
          this.fail(i18n.t("wiz.err.anchor"));
          return;
        }
      }
      if (step === "country" && this.data.currency === "__custom__" && !this.data.customCurrency.trim()) {
        this.fail(i18n.t("wiz.err.currency"));
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
      const { parseFrontmatter } = require_markdown();
      const { fm } = parseFrontmatter(await this.app.vault.cachedRead(f));
      const day = parseInt(fm.month_start_day, 10);
      if (day >= 1 && day <= 28)
        this.data.payday = day;
      const cycleDays = periodDaysOrZero(fm.period_days);
      const cycleAnchor = (fm.period_anchor || "").toString().trim();
      if (cycleDays && isRealIsoDate(cycleAnchor)) {
        this.data.periodDays = cycleDays;
        this.data.periodAnchor = cycleAnchor;
      }
      if (fm.country && PROFILES[fm.country.toString().trim().toLowerCase()]) {
        this.data.country = fm.country.toString().trim().toLowerCase();
      }
      if (fm.language)
        this.data.language = i18n.resolveLanguage(fm.language);
      setLanguage(this.data.language);
      if (fm.currency) {
        if (CURRENCY_KEYS.some(([v]) => v === fm.currency))
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
      c.createEl("h2", { text: i18n.t("wiz.welcome.title") });
      c.createEl("p", { text: i18n.t("wiz.welcome.intro") });
      const intro = c.createEl("p");
      intro.createEl("b", { text: i18n.t("wiz.welcome.planLead") });
      const setup = c.createEl("ol", { cls: "budget-onb-journey" });
      for (const t of [
        i18n.t("wiz.welcome.plan1"),
        i18n.t("wiz.welcome.plan2"),
        i18n.t("wiz.welcome.plan3"),
        i18n.t("wiz.welcome.plan4"),
        i18n.t("wiz.welcome.plan5")
      ])
        setup.createEl("li", { text: t });
      const then = c.createEl("p");
      then.createEl("b", { text: i18n.t("wiz.welcome.thenLead") });
      const inApp = c.createEl("ol", { cls: "budget-onb-journey" });
      for (const t of [
        i18n.t("wiz.welcome.app1"),
        i18n.t("wiz.welcome.app2"),
        i18n.t("wiz.welcome.app3"),
        i18n.t("wiz.welcome.app4")
      ])
        inApp.createEl("li", { text: t });
      c.createEl("p", { text: i18n.t("wiz.welcome.close") });
    }
    render_folder(c) {
      c.createEl("p", { text: i18n.t("wiz.folder.hint") });
      const hint = document.createElement("div");
      hint.className = "budget-onb-hint";
      const paint = () => {
        const raw = (this.data.folder || "").trim();
        if (!raw || raw === "/") {
          hint.textContent = i18n.t("wiz.folder.blank");
          return;
        }
        const f = normalizePath(raw);
        if (this.detectExisting(f))
          hint.textContent = i18n.t("wiz.folder.found", { folder: f });
        else if (this.app.vault.getFolderByPath(f))
          hint.textContent = i18n.t("wiz.folder.exists", { folder: f });
        else
          hint.textContent = i18n.t("wiz.folder.willCreate", { folder: f });
      };
      new Setting(c).setName(i18n.t("wiz.folder.name")).setDesc(i18n.t("wiz.folder.desc")).addText((t) => t.setPlaceholder("Finances/Budget").setValue(this.data.folder).onChange((v) => {
        this.data.folder = v;
        paint();
      }));
      c.appendChild(hint);
      paint();
    }
    render_name(c) {
      if (this.mode === "connect") {
        c.createDiv({
          cls: "budget-onb-callout",
          text: i18n.t("wiz.folder.connected", { folder: this.data.folder })
        });
      }
      new Setting(c).setName(i18n.t("wiz.name.name")).setDesc(i18n.t("wiz.name.desc")).addText((t) => t.setPlaceholder(i18n.t("wiz.name.placeholder")).setValue(this.data.name).onChange((v) => {
        this.data.name = v;
      }));
    }
    render_country(c) {
      new Setting(c).setName(i18n.t("settings.language.name")).setDesc(i18n.t("wiz.language.desc")).addDropdown((d) => {
        for (const id of LANGUAGE_ORDER)
          d.addOption(id, LANGUAGE_NAMES[id]);
        d.setValue(i18n.resolveLanguage(this.data.language));
        d.onChange((v) => {
          this.data.language = v;
          setLanguage(v);
          this.renderStep();
        });
      });
      new Setting(c).setName(i18n.t("settings.country.name")).setDesc(i18n.t("wiz.country.desc")).addDropdown((d) => {
        for (const code of COUNTRY_ORDER)
          d.addOption(code, PROFILES[code].label);
        d.setValue(this.data.country);
        d.onChange((v) => {
          this.data.country = v;
          this.data.currency = CURRENCY_KEYS.some(([cv]) => cv === PROFILES[v].currency) ? PROFILES[v].currency : "__custom__";
          if (this.data.currency === "__custom__")
            this.data.customCurrency = PROFILES[v].currency;
          this.renderStep();
        });
      });
      new Setting(c).setName(i18n.t("settings.currency.name")).setDesc(i18n.t("wiz.currency.desc")).addDropdown((d) => {
        for (const [v, label] of currencies())
          d.addOption(v, label);
        d.setValue(this.data.currency);
        d.onChange((v) => {
          this.data.currency = v;
          this.renderStep();
        });
      });
      if (this.data.currency === "__custom__") {
        new Setting(c).setName(i18n.t("wiz.currency.custom")).addText((t) => t.setPlaceholder(i18n.t("wiz.currency.customPlaceholder")).setValue(this.data.customCurrency).onChange((v) => {
          this.data.customCurrency = v;
        }));
      }
    }
    render_period(c) {
      const days = periodDaysOrZero(this.data.periodDays);
      new Setting(c).setName(i18n.t("wiz.period.howOften")).setDesc(i18n.t("wiz.period.howOftenDesc")).addDropdown((d) => {
        for (const [v, label] of Object.entries(periodLengthOptions(days)))
          d.addOption(v, label);
        d.setValue(String(days));
        d.onChange((v) => {
          this.data.periodDays = periodDaysOrZero(v);
          this.renderStep();
        });
      });
      if (!days) {
        const hint = document.createElement("div");
        hint.className = "budget-onb-hint";
        const paint = () => {
          const d = parseInt(this.data.payday, 10);
          if (!(d >= 1 && d <= 28)) {
            hint.textContent = i18n.t("wiz.period.badDay");
            return;
          }
          hint.textContent = d === 1 ? i18n.t("wiz.period.calendarEg", { first: i18n.day(1), month: monthLabel(currentPeriodFor(1)) }) : i18n.t("wiz.period.paydayEg", {
            start: i18n.day(d),
            end: i18n.day(d - 1),
            month: monthLabel(currentPeriodFor(d))
          });
        };
        new Setting(c).setName(i18n.t("wiz.period.startDay")).setDesc(i18n.t("wiz.period.startDayDesc")).addText((t) => {
          t.inputEl.type = "number";
          t.inputEl.min = "1";
          t.inputEl.max = "28";
          t.inputEl.step = "1";
          t.inputEl.inputMode = "numeric";
          t.setValue(String(this.data.payday));
          t.onChange((v) => {
            this.data.payday = v;
            paint();
          });
        });
        c.appendChild(hint);
        paint();
      }
      if (days) {
        const hint = document.createElement("div");
        hint.className = "budget-onb-hint";
        const paint = () => {
          if (!isRealIsoDate(this.data.periodAnchor)) {
            hint.textContent = i18n.t("wiz.period.anchorBlank");
            return;
          }
          hint.textContent = i18n.t("wiz.period.anchorEg", { date: currentPeriodForCycle(days, this.data.periodAnchor) });
        };
        new Setting(c).setName(i18n.t("wiz.period.anchorName")).setDesc(i18n.t("wiz.period.anchorDesc")).addText((t) => {
          t.inputEl.type = "date";
          t.setValue(this.data.periodAnchor);
          t.onChange((v) => {
            this.data.periodAnchor = v.trim();
            paint();
          });
        });
        c.appendChild(hint);
        paint();
      }
    }
    render_categories(c) {
      c.createEl("p", { text: i18n.t("wiz.cats.intro") });
      const boxes = [];
      const bar = c.createDiv({ cls: "budget-onb-catbar" });
      const count = bar.createEl("span", { cls: "budget-onb-catcount" });
      const paintCount = () => {
        count.textContent = i18n.t("wiz.cats.selected", { count: this.data.cats.size, total: STARTER_CATEGORIES.length });
      };
      const setAll = (on) => {
        for (const { cb, cat } of boxes) {
          cb.checked = on;
          if (on)
            this.data.cats.add(cat.name);
          else
            this.data.cats.delete(cat.name);
        }
        paintCount();
      };
      bar.createEl("button", { text: i18n.t("wiz.cats.selectAll"), cls: "budget-onb-catbtn", attr: { type: "button" } }).addEventListener("click", () => setAll(true));
      bar.createEl("button", { text: i18n.t("wiz.cats.selectNone"), cls: "budget-onb-catbtn", attr: { type: "button" } }).addEventListener("click", () => setAll(false));
      for (const type of TYPE_ORDER) {
        const inType = STARTER_CATEGORIES.filter((x) => x.type === type);
        if (!inType.length)
          continue;
        c.createDiv({ cls: "budget-onb-cat-group", text: typeLabel(type) });
        const grid = c.createDiv({ cls: "budget-onb-cats" });
        for (const cat of inType) {
          const label = grid.createEl("label");
          const cb = label.createEl("input", { type: "checkbox" });
          cb.checked = this.data.cats.has(cat.name);
          cb.addEventListener("change", () => {
            if (cb.checked)
              this.data.cats.add(cat.name);
            else
              this.data.cats.delete(cat.name);
            paintCount();
          });
          label.createEl("span", { cls: "budget-onb-swatch" }).style.background = cat.color;
          label.appendText(` ${cat.name}`);
          boxes.push({ cb, cat });
        }
      }
      paintCount();
    }
    render_account(c) {
      c.createEl("p", { text: i18n.t("wiz.acct.intro") });
      new Setting(c).setName(i18n.t("wiz.acct.name")).addText((t) => t.setPlaceholder(i18n.t("wiz.acct.namePlaceholder")).setValue(this.data.acctName).onChange((v) => {
        this.data.acctName = v;
      }));
      new Setting(c).setName(i18n.t("wiz.acct.type")).addDropdown((d) => {
        for (const [v, label] of accountTypes())
          d.addOption(v, label);
        d.setValue(this.data.acctType);
        d.onChange((v) => {
          this.data.acctType = v;
        });
      });
      new Setting(c).setName("Bank / institution").setDesc("Optional.").addText((t) => t.setValue(this.data.acctInstitution).onChange((v) => {
        this.data.acctInstitution = v;
      }));
      new Setting(c).setName(i18n.t("wiz.acct.balance")).setDesc(i18n.t("wiz.acct.balanceDesc")).addText((t) => {
        t.inputEl.type = "number";
        t.inputEl.step = "0.01";
        t.setPlaceholder("0.00").setValue(this.data.acctBalance).onChange((v) => {
          this.data.acctBalance = v;
        });
      });
      c.createDiv({ cls: "budget-onb-hint", text: i18n.t("wiz.acct.balanceHint") });
    }
    render_finish(c) {
      const day = this.monthStartDay();
      const cd = this.cycleDays();
      const rows = [
        [i18n.t("wiz.sum.folder"), this.data.folder],
        [i18n.t("wiz.sum.name"), this.data.name.trim() || "—"],
        [i18n.t("wiz.sum.language"), LANGUAGE_NAMES[i18n.resolveLanguage(this.data.language)]],
        [i18n.t("wiz.sum.country"), localeFor(this.data.country).label],
        [i18n.t("wiz.sum.period"), cd ? i18n.t("wiz.sum.cycleFrom", {
          preset: PERIOD_PRESETS[cd] || `Every ${cd} days`,
          date: this.data.periodAnchor
        }) : day === 1 ? i18n.t("wiz.sum.monthlyCalendar") : i18n.t("wiz.sum.monthlyOn", { day: i18n.day(day) })],
        [i18n.t("wiz.sum.currency"), this.currencySymbol()]
      ];
      if (this.mode === "create") {
        rows.push([i18n.t("wiz.sum.categories"), i18n.t("wiz.sum.catCount", { count: this.data.cats.size })]);
        rows.push([i18n.t("wiz.sum.account"), this.data.acctName.trim() || "—"]);
        const bal = this.openingBalance();
        if (this.data.acctName.trim() && bal !== 0)
          rows.push([i18n.t("wiz.sum.opening"), `${this.currencySymbol()} ${bal.toFixed(2)}`]);
      }
      c.createEl("p", {
        text: i18n.t(this.mode === "connect" ? "wiz.finish.connectLead" : "wiz.finish.createLead")
      });
      const ul = c.createEl("ul");
      for (const [k, v] of rows) {
        const li = ul.createEl("li");
        li.createEl("b", { text: k + ": " });
        li.appendText(v);
      }
      const next = c.createEl("p");
      next.createEl("b", { text: i18n.t("wiz.finish.nextLead") });
      next.appendText(i18n.t("wiz.finish.nextBody"));
      c.createDiv({ cls: "budget-onb-hint", text: i18n.t("wiz.finish.privacy") });
    }
    monthStartDay() {
      return Math.min(28, Math.max(1, parseInt(this.data.payday, 10) || 25));
    }
    cycleDays() {
      return isRealIsoDate(this.data.periodAnchor) ? periodDaysOrZero(this.data.periodDays) : 0;
    }
    cycleAnchor() {
      return this.cycleDays() ? this.data.periodAnchor : "";
    }
    firstPeriod() {
      const d = this.cycleDays();
      return d ? currentPeriodForCycle(d, this.cycleAnchor()) : currentPeriodFor(this.monthStartDay());
    }
    currencySymbol() {
      return (this.data.currency === "__custom__" ? this.data.customCurrency.trim() : this.data.currency) || "R";
    }
    openingBalance() {
      return normalizeAmount(this.data.acctBalance) ?? 0;
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
          await p.updateBudgetSettingsMd("period_days", String(this.cycleDays()));
          await p.updateBudgetSettingsMd("period_anchor", this.cycleAnchor());
          await p.updateBudgetSettingsMd("currency", `"${cur.replace(/"/g, "")}"`);
          await p.updateBudgetSettingsMd("country", this.data.country);
          await p.updateBudgetSettingsMd("language", i18n.resolveLanguage(this.data.language));
          if (name)
            await p.updateBudgetSettingsMd("household", `"${name.replace(/"/g, "")}"`);
        } else {
          for (const sub of ["Categories", "Accounts", "Budgets", "Transactions", "Tax", "Data"]) {
            await this.ensureFolder(normalizePath(`${folder}/${sub}`));
          }
          await this.writeIfAbsent(normalizePath(`${folder}/Settings.md`), `---
month_start_day: ${day}
` + (this.cycleDays() ? `period_days: ${this.cycleDays()}
period_anchor: ${this.cycleAnchor()}
` : "") + `currency: "${cur.replace(/"/g, "")}"
country: ${this.data.country}
` + `language: ${i18n.resolveLanguage(this.data.language)}
` + (name ? `household: "${name.replace(/"/g, "")}"
` : "") + `tags: [finance, finance/budget, vault-meta]
---

# Budget Settings

` + `- **month_start_day** — the financial period starts on this day of the month.
` + (this.cycleDays() ? `- **period_days** — periods run this many days instead of a month. Remove it to go back to monthly.
` + `- **period_anchor** — a payday every period is counted from. Only where it falls within the cycle matters.
` : "") + `- **currency** — symbol shown before every amount in the Budget Vault plugin.
` + `- **country** — drives amount formatting, statement date order and the Tax view (za, us, uk, eu, au, ca, cn, other).
` + `- **language** — the language the app is written in (${LANGUAGE_ORDER.join(", ")}). Separate from country: neither decides the other.
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
            const ymd = todayIso();
            const bal = this.openingBalance();
            await this.writeIfAbsent(normalizePath(`${folder}/Accounts/${safe}.md`), `---
type: ${this.data.acctType}
` + (this.data.acctInstitution.trim() ? `institution: ${this.data.acctInstitution.trim()}
` : "") + `balance: ${bal.toFixed(2)}
balance_updated: ${ymd}
tags: [finance, finance/budget, finance/budget/accounts]
---

# ${acct}

Transactions are stored under \`Transactions/${safe}/\` as monthly files.
`);
            await this.ensureFolder(normalizePath(`${folder}/Transactions/${safe}`));
          }
          const period = this.firstPeriod();
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
        new Notice(i18n.t(this.mode === "connect" ? "wiz.done.connected" : "wiz.done.created"));
        p.reloadViews();
        await p.activateView();
      } catch (e) {
        new Notice(i18n.t("wiz.failed", { error: e.message || e }), 8000);
      }
    }
  }
  module2.exports = { OnboardingWizard, STARTER_CATEGORIES };
});

// src/settings-tab.js
var require_settings_tab = __commonJS((exports2, module2) => {
  var { PluginSettingTab, Setting, TFile, Notice, normalizePath } = require("obsidian");
  var { DEFAULT_SETTINGS, FEEDBACK_URL, SUPPORT_URL, PALETTE_PRESETS, periodLengthOptions } = require_constants();
  var { OnboardingWizard } = require_onboarding();
  var { PROFILES, COUNTRY_ORDER } = require_locale();
  var i18n = require_i18n();
  var { setLanguage, LANGUAGE_NAMES, LANGUAGE_ORDER } = i18n;
  var { periodDaysOrZero } = require_dates();
  var { yamlStr } = require_markdown();
  var { ISO_DATE, isoDayNumber, isRealIsoDate } = require_dates();
  var MD_KEYS = new Set(["household", "month_start_day", "country", "language", "currency", "period_days", "period_anchor"]);
  var languageOptions = () => Object.fromEntries(LANGUAGE_ORDER.map((id) => [id, LANGUAGE_NAMES[id]]));
  var PALETTE_DESC = "Which colours the budget is drawn in. Each palette has its own light and dark version, so this is independent of the Theme setting above.";
  var MONTH_START_DESC = "Day of the month each financial period begins on — usually your payday. Choose 1 for an ordinary calendar month. 1–28.";
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
      new Setting(containerEl).setName("Colour palette").setDesc(PALETTE_DESC).addDropdown((d) => {
        for (const [id, label] of Object.entries(PALETTE_PRESETS))
          d.addOption(id, label);
        d.setValue(this.plugin.settings.palette).onChange(async (v) => {
          this.plugin.settings.palette = v;
          await this.plugin.saveSettings();
          this.plugin.forEachView((ctl) => ctl.applyTheme());
        });
      });
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
      setLanguage(md.language || i18n.defaultLanguage());
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
      new Setting(containerEl).setName("Month start day").setDesc(MONTH_START_DESC).addText((t) => {
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
          if (n && !isRealIsoDate((md.period_anchor ?? "").toString().trim())) {
            new Notice('Budget: set "Last payday" below so periods know where to start — until then they stay monthly.', 8000);
          }
          this.noticeBudgetsKept(periodDaysOrZero(md.period_days), n);
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
            if (next && !isRealIsoDate(next)) {
              new Notice(i18n.t("settings.dateNotReal", { value: next }), 6000);
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
      new Setting(containerEl).setName(i18n.t("settings.language.name")).setDesc(i18n.t("settings.language.desc")).addDropdown((d) => {
        for (const [id, label] of Object.entries(languageOptions()))
          d.addOption(id, label);
        d.setValue(i18n.resolveLanguage(md.language ?? i18n.defaultLanguage()));
        d.onChange(async (v) => {
          setLanguage(v);
          await this.plugin.updateBudgetSettingsMd("language", v);
          this.plugin.forEachView((ctl) => ctl.applyLanguage());
          this.plugin.reloadViews();
          this.display();
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
    offPhaseBudgetCount(days) {
      const anchor = (this.mdSettings().period_anchor ?? "").toString().trim();
      if (!days || !isRealIsoDate(anchor))
        return 0;
      const a = isoDayNumber(anchor);
      const base = `${this.plugin.settings.budgetFolder}/Budgets/`;
      return this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(base) && ISO_DATE.test(f.basename) && (isoDayNumber(f.basename) - a) % days !== 0).length;
    }
    strandedBudgetCount(before, after) {
      if (!before && after)
        return this.monthBudgetCount();
      if (before && !after)
        return this.datedBudgetCount();
      if (before && after)
        return this.offPhaseBudgetCount(after);
      return 0;
    }
    noticeBudgetsKept(before, after) {
      const n = this.strandedBudgetCount(before, after);
      if (!n)
        return;
      new Notice(i18n.t("settings.budgetsKept", { count: n }), 1e4);
    }
    monthBudgetCount() {
      const base = `${this.plugin.settings.budgetFolder}/Budgets/`;
      return this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(base) && /^\d{4}-\d{2}$/.test(f.basename)).length;
    }
    async warnIfAnchorReslices(md, next) {
      const days = periodDaysOrZero(md.period_days);
      const prev = (md.period_anchor ?? "").toString().trim();
      if (!days || !isRealIsoDate(prev) || !isRealIsoDate(next))
        return;
      if ((isoDayNumber(next) - isoDayNumber(prev)) % days === 0)
        return;
      const n = this.datedBudgetCount();
      if (!n)
        return;
      new Notice(i18n.t("settings.anchorReslices", { count: n, prev }), 12000);
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
      if (key === "language")
        return i18n.resolveLanguage(md.language ?? i18n.defaultLanguage());
      return;
    }
    async setControlValue(key, value) {
      if (!MD_KEYS.has(key)) {
        if (key === "budgetFolder")
          value = normalizePath(String(value).trim() || DEFAULT_SETTINGS.budgetFolder);
        await super.setControlValue(key, value);
        if (key === "theme" || key === "palette")
          this.plugin.forEachView((ctl) => ctl.applyTheme());
        else if (key === "privacyLock")
          this.plugin.forEachView((ctl) => ctl.applyPrivacyLock());
        else if (key === "budgetFolder")
          this.plugin.reloadViews();
        return;
      }
      if (key === "period_anchor") {
        const next = String(value).trim();
        if (next && !isRealIsoDate(next))
          return;
        await this.warnIfAnchorReslices(this.mdSettings(), next);
      }
      if (key === "period_days") {
        this.noticeBudgetsKept(periodDaysOrZero(this.mdSettings().period_days), periodDaysOrZero(value));
      }
      const raw = key === "household" || key === "currency" ? yamlStr(String(value).trim()) : key === "month_start_day" ? String(parseInt(value, 10)) : key === "period_days" ? String(periodDaysOrZero(value)) : key === "period_anchor" ? String(value).trim() : key === "country" ? String(value) : key === "language" ? i18n.resolveLanguage(value) : null;
      if (raw === null)
        return;
      if (key === "language")
        setLanguage(raw);
      await this.plugin.updateBudgetSettingsMd(key, raw);
      if (key === "language")
        this.plugin.forEachView((ctl) => ctl.applyLanguage());
      this.plugin.reloadViews();
    }
    getSettingDefinitions() {
      setLanguage(this.mdSettings().language || i18n.defaultLanguage());
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
          name: "Colour palette",
          desc: PALETTE_DESC,
          control: {
            type: "dropdown",
            key: "palette",
            defaultValue: DEFAULT_SETTINGS.palette,
            options: PALETTE_PRESETS
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
          desc: MONTH_START_DESC,
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
              return !s || isRealIsoDate(s) ? undefined : "Use a real date as YYYY-MM-DD, e.g. 2026-08-07.";
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
          name: i18n.t("settings.language.name"),
          desc: i18n.t("settings.language.desc"),
          control: {
            type: "dropdown",
            key: "language",
            defaultValue: i18n.defaultLanguage(),
            options: languageOptions()
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
var { Plugin, TFile, TFolder, Notice, normalizePath } = require("obsidian");
var { VIEW_TYPE, DEFAULT_SETTINGS } = require_constants();
var { parseFrontmatter } = require_markdown();
var { defaultLanguage } = require_i18n();
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
    this.addCommand({
      id: "tidy-categorisation-rules",
      name: "Tidy categorisation rules",
      callback: () => {
        let ran = false;
        this.forEachView((ctl) => {
          if (!ran) {
            ran = true;
            ctl.cleanupRules();
          }
        });
        if (!ran)
          new Notice("Budget: open the budget first, then run this again.", 5000);
      }
    });
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
      const defaults = { month_start_day: "23", currency: "R", country: "za", language: defaultLanguage() };
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
