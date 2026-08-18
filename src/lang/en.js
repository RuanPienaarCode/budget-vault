'use strict';
/* English — the fallback table, and the source of truth for what keys exist.

   Every other language is checked against this file at build time
   (tests/i18n.test.cjs): a table missing a key English has, or carrying a key
   English does not, fails the build. So a string is added HERE first, then
   translated outward.

   A value is either a plain string, or a plural entry — an object keyed by
   category (`one` / `other`) selected by `count`. Whole sentences per form, not
   fragments concatenated around a number: languages disagree about where the
   number goes and which words around it change, and a translator handed
   "file" / "files" has no way to fix a sentence that reads wrong.

   `{name}` placeholders are interpolated from the params object. An unknown
   one is left standing, so it shows up in the interface rather than silently
   becoming "undefined". */

module.exports = {
  /* ------------------------------- splash -------------------------------- */
  'splash.sub': 'Your private budget, kept safely inside your vault.',
  'splash.enter': 'Enter budget',

  /* -------------------------------- drawer -------------------------------- */
  'nav.menu': 'Menu',
  'nav.close': 'Close menu',
  'nav.section.budget': 'Budget',
  'nav.section.accounts': 'Accounts',
  'nav.section.tools': 'Tools',

  'nav.dashboard': 'Dashboard',
  'nav.transactions': 'Transactions',
  'nav.budgets': 'Budget',
  'nav.plan': 'Plan',
  'nav.notes': 'Notes',
  'nav.savings': 'Savings & Investments',
  'nav.accounts': 'Accounts',
  'nav.assets': 'Assets',
  'nav.debts': 'Debt',
  'nav.owed': 'Owed Money',
  'nav.services': 'Services',
  'nav.tax': 'Tax',
  'nav.loans': 'Loan Calculators',
  'nav.import': 'Import CSV',
  'nav.reload': 'Reload from disk',
  'nav.pluginSettings': 'Plugin settings',

  /* -------------------------------- topbar -------------------------------- */
  'topbar.nav': 'Budget navigation',
  'topbar.mainMenu': 'Main menu',
  'topbar.openMenu': 'Open navigation menu',
  'topbar.home': 'Go to Dashboard',
  'topbar.brandSub': 'Obsidian vault budget',
  'topbar.periodNav': 'Period navigation',
  'topbar.prevPeriod': 'Previous period',
  'topbar.currentPeriod': 'Jump to current period',
  'topbar.nextPeriod': 'Next period',
  'topbar.import': 'Import CSV',
  'topbar.importTitle': 'Import a bank statement CSV',
  'topbar.settings': 'Open budget settings',

  /* ------------------------------- settings -------------------------------- */
  'settings.folder.name': 'Budget folder',
  'settings.folder.desc': 'Vault path of the folder holding Categories/, Accounts/, Budgets/, Transactions/, Settings.md, etc.',

  'settings.theme.name': 'Theme',
  'settings.theme.desc': 'Follow Obsidian\'s light/dark mode, or force the Airy Glass dark or light palette.',
  'settings.theme.auto': 'Follow Obsidian',
  'settings.theme.dark': 'Always dark',
  'settings.theme.light': 'Always light',

  'settings.palette.name': 'Colour palette',
  'settings.palette.desc': 'Which colours the budget is drawn in. Each palette has its own light and dark version, so this is independent of the Theme setting above.',

  'settings.wizard.name': 'Setup wizard',
  'settings.wizard.desc': 'Re-run the first-run wizard — folder, name, budget period, currency, starter files.',
  'settings.wizard.button': 'Run setup wizard',

  'settings.startup.name': 'Open on startup',
  'settings.startup.desc': 'Open the budget view automatically when Obsidian starts.',

  'settings.privacy.name': 'Privacy splash screen',
  'settings.privacy.desc': 'Cover the budget with a splash screen until you tap "Enter budget" — on open, and again whenever Obsidian goes to the background. Nothing is read from the vault until you tap.',

  'settings.feedback.name': 'Send feedback',
  'settings.feedback.desc': 'Report a bug, flag an issue or request a feature. Opens a Google Form in your browser — nothing from your budget is attached or sent.',
  'settings.feedback.button': 'Open feedback form',

  'settings.support.name': 'Support Budget Vault',
  'settings.support.desc': 'Budget Vault is free and always will be. If you\'d like to say thanks, this opens PayPal in your browser — entirely optional, and nothing in the plugin changes either way.',
  'settings.support.button': 'Send a thank you',

  'settings.data.name': 'Budget data',
  'settings.data.desc': 'Stored in Settings.md inside the budget folder, so they apply on every device.',

  'settings.household.name': 'Name / household',
  'settings.household.desc': 'Shown in the dashboard greeting and top bar. Leave blank for none.',
  'settings.household.placeholder': 'Leave blank for none',

  'settings.monthStart.name': 'Month start day',
  'settings.monthStart.desc': 'Day of the month each financial period begins on — usually your payday. Choose 1 for an ordinary calendar month. 1–28.',
  'settings.monthStart.invalid': 'Pick a day between 1 and 28.',

  'settings.periodLength.name': 'Period length',
  'settings.periodLength.desc': 'How long each budget period runs. Monthly uses the month start day above. The other options line periods up with a pay cycle instead, counting from the date below.',

  'settings.anchor.name': 'Last payday',
  'settings.anchor.desc': 'When were you last paid? Any recent payday works — only the day it falls on within the cycle matters, so an earlier or later one gives the same result. Ignored when the period length is monthly.',
  'settings.anchor.invalid': 'Use a real date as YYYY-MM-DD, e.g. 2026-08-07.',

  'settings.country.name': 'Country',
  'settings.country.desc': 'Drives amount formatting, bank-statement date order and the Tax view\'s checklist (tailored to your country\'s tax authority). Existing tax years keep their data — only labels and new-year seeds change. Independent of the interface language below.',

  'settings.language.name': 'Language',
  'settings.language.desc': 'The language the interface is written in. Independent of Country above — living somewhere does not decide what you want to read. Defaults to Obsidian\'s own display language, falling back to English. Your own budget text — category names, notes, account names — is never translated.',

  'settings.currency.name': 'Currency symbol',
  'settings.currency.desc': 'Shown before every amount, e.g. R.',
  'settings.currency.invalid': 'Enter a currency symbol.',

  /* ------------------------- settings notices ------------------------------ */
  /* Whole sentences per plural form: the count sits in a different place in
     different languages, and so does the verb that agrees with it. */
  'settings.budgetsKept': {
    one: 'Budget: your {count} existing budget file stays in the vault. It can\'t be shown at this period length, and it comes straight back if you change it back.',
    other: 'Budget: your {count} existing budget files stay in the vault. They can\'t be shown at this period length, and they come straight back if you change it back.',
  },
  'settings.anchorReslices': {
    one: 'Budget: this shifts every period boundary. {count} budget file named by date will stop matching — it stays in your vault, and setting this date back to {prev} brings it straight back.',
    other: 'Budget: this shifts every period boundary. {count} budget files named by date will stop matching — they stay in your vault, and setting this date back to {prev} brings them straight back.',
  },
  'settings.dateNotReal': 'Budget: "{value}" is not a date — use the picker, or type YYYY-MM-DD.',
  // Shared by every plugin-data setting that saves through plugin.saveSettings()
  // outside controller.js (which keeps its own un-i18n'd copy of this same
  // wording, since controller.js has no i18n import at all) — the settings
  // tab's folder/theme/palette/startup/privacy toggles, the dashboard's chart
  // range pills, the export-folder setting and the wizard's skip-and-remember.
  'settings.err.save': 'Could not save that setting ({error})',
  'settings.monthStartReslices': {
    one: 'Budget: this moves the window each monthly budget file is measured against, without renaming the file — budget vs actual for {count} past period will change. Nothing is deleted, and setting the day back restores it.',
    other: 'Budget: this moves the window each monthly budget file is measured against, without renaming the file — budget vs actual for {count} past periods will change. Nothing is deleted, and setting the day back restores it.',
  },

  /* ============================ setup wizard ============================== */
  /* Day numbers reach these sentences through i18n.day(), never as a bare
     "25th" — see ORDINAL_DAY in i18n.js. Each language formats its own. */

  'wiz.title': 'Set up Budget Vault',
  'wiz.stepOf': 'Step {n} of {total}',
  'wiz.cancel': 'Cancel',
  'wiz.back': 'Back',
  'wiz.next': 'Next',
  'wiz.letsGo': 'Let\'s go!',
  'wiz.connectBtn': 'Connect budget',
  'wiz.createBtn': 'Create my budget',
  'wiz.skipped': 'Setup skipped — you can run it again from Settings → Budget Vault → Run setup wizard, or the command palette.',

  'wiz.step.folder': 'Where your budget lives',
  'wiz.step.name': 'What should we call you?',
  'wiz.step.country': 'Language, country & currency',
  'wiz.step.period': 'Your budget period',
  'wiz.step.categories': 'Your budget categories',
  'wiz.step.account': 'Your first account',
  'wiz.step.finish': 'Ready to go',

  'wiz.err.folder': 'Enter a folder path for the budget — for example Finances/Budget.',
  'wiz.err.monthStart': 'The month start day must be from 1 to 28. Not every month has a 29th, 30th or 31st, so if you are paid on the last day of the month, use 28.',
  'wiz.err.anchor': 'Enter the date you were last paid — every pay cycle is counted from it, so without it the budget falls back to monthly periods.',
  'wiz.err.currency': 'Enter a currency symbol, or pick one from the list above.',

  /* ---- welcome ---- */
  'wiz.welcome.title': 'Welcome to Budget Vault!',
  'wiz.welcome.intro': 'Your whole budget, living right here in your vault as plain markdown — no accounts, no cloud, no one else\'s server. If your vault syncs to your phone, your budget rides along for free.',
  'wiz.welcome.planLead': 'Here\'s the plan — this wizard sets you up:',
  'wiz.welcome.plan1': 'Choose your budget folder — we scaffold the whole structure for you',
  'wiz.welcome.plan2': 'Pick your language, country & currency — so the app reads right and amounts, dates and tax stuff look right',
  'wiz.welcome.plan3': 'Tell us when you get paid — your budget periods run from payday, if you like',
  'wiz.welcome.plan4': 'Choose your budget categories — tick the ones that fit your life',
  'wiz.welcome.plan5': 'Add your first account — and what\'s in it right now',
  'wiz.welcome.thenLead': 'Then the fun starts in the app:',
  'wiz.welcome.app1': 'Set your budget — give every category a number to aim for',
  'wiz.welcome.app2': 'Import your bank\'s CSV — transactions sort themselves as you teach it',
  'wiz.welcome.app3': 'Add new categories anytime — your budget grows with you',
  'wiz.welcome.app4': 'Review as you go — the dashboard shows exactly where the money went',
  'wiz.welcome.close': 'About two minutes of setup. You can change any of it later. Ready?',

  /* ---- folder ---- */
  'wiz.folder.hint': 'Everything lives as plain markdown files inside one folder of your vault.',
  'wiz.folder.blank': 'Enter a folder path — for example Finances/Budget.',
  'wiz.folder.found': 'Found an existing budget in "{folder}" — the wizard will connect to it rather than create new files.',
  'wiz.folder.exists': '"{folder}" already exists — the budget files will be added inside it.',
  'wiz.folder.willCreate': '"{folder}" doesn\'t exist yet — it will be created for you.',
  'wiz.folder.name': 'Budget folder',
  'wiz.folder.desc': 'Where the categories, accounts, budgets and transactions are kept.',
  'wiz.folder.connected': 'Found an existing budget in "{folder}" — connecting to it instead of creating new files. Your categories, accounts and transactions are left exactly as they are; the remaining steps only confirm the settings kept in its Settings.md.',

  /* ---- name ---- */
  'wiz.name.name': 'Your name or nickname',
  'wiz.name.desc': 'Shown in the dashboard greeting and the top bar. Leave blank to skip.',
  'wiz.name.placeholder': 'e.g. Alex, or The Smiths',

  /* ---- language / country / currency ---- */
  'wiz.language.desc': 'The language the app is written in. Independent of the country below — where you live does not decide what you want to read. Your own budget text is never translated.',
  'wiz.country.desc': 'Sets amount formatting, the date order used when reading bank statements, and the Tax view\'s return checklist for your country\'s tax authority.',
  'wiz.currency.desc': 'Shown before every amount. Starts from your country — change it if you budget in something else.',
  'wiz.currency.custom': 'Custom symbol',
  'wiz.currency.customPlaceholder': 'e.g. CHF',

  /* Currency NAMES for the wizard dropdown; the stored value is the symbol. */
  'wiz.ccy.rand': 'R — South African Rand',
  'wiz.ccy.dollar': '$ — Dollar',
  'wiz.ccy.euro': '€ — Euro',
  'wiz.ccy.pound': '£ — Pound',
  'wiz.ccy.other': 'Other…',

  /* ---- period ---- */
  'wiz.period.howOften': 'How often are you paid?',
  'wiz.period.howOftenDesc': 'Monthly periods are named by month and start on the day you choose below. The others line up with a pay cycle instead, counted from your last payday.',
  'wiz.period.startDay': 'Which day does your budget month start?',
  'wiz.period.startDayDesc': 'Usually your payday. Choose 1 for an ordinary calendar month. (1–28)',
  'wiz.period.badDay': 'Pick a day from 1 to 28. Not every month has a 29th, 30th or 31st, so if you are paid on the last day of the month, use 28.',
  'wiz.period.calendarEg': 'An ordinary calendar month: each period runs from the {first} to the end of the month, and is named after that month. Right now you are in {month}.',
  'wiz.period.paydayEg': 'Each period runs from the {start} to the {end} of the next month, and is named after the month it ends in. Right now you are in {month}.',
  'wiz.period.anchorBlank': 'Enter the date you were last paid and the periods are worked out from there.',
  'wiz.period.anchorEg': 'Counting from there, the period you are in right now started on {date}. Budget files are named by that start date.',
  'wiz.period.anchorName': 'When were you last paid?',
  'wiz.period.anchorDesc': 'Any recent payday will do — only where it falls within the cycle matters, so an earlier or later one gives the same periods.',

  /* ---- categories ---- */
  'wiz.cats.intro': 'Start with a set of budget categories — untick any you don\'t want. You can add, rename or recolour them later, so nothing here is final.',
  'wiz.cats.selected': '{count} of {total} selected',
  'wiz.cats.selectAll': 'Select all',
  'wiz.cats.selectNone': 'Select none',

  'wiz.type.income': 'Income',
  'wiz.type.expense': 'Everyday expenses',
  'wiz.type.debt': 'Debt repayments',
  'wiz.type.services': 'Services & subscriptions',
  'wiz.type.insurance': 'Insurance',
  'wiz.type.giving': 'Giving',
  'wiz.type.savings': 'Savings',
  'wiz.type.investment': 'Investments',
  'wiz.type.luxuries': 'Nice-to-haves',
  'wiz.type.transfer': 'Transfers',

  /* ---- first account ---- */
  'wiz.acct.intro': 'Transactions are stored per account. Add your main account now, or leave the name blank to skip — you can add accounts any time.',
  'wiz.acct.name': 'Account name',
  'wiz.acct.namePlaceholder': 'e.g. Cheque account',
  'wiz.acct.type': 'Type',
  'wiz.acct.balance': 'Current balance',
  'wiz.acct.balanceDesc': 'Optional — what\'s in the account right now.',
  'wiz.acct.balanceHint': 'Use your latest statement\'s closing balance, or whatever your banking app shows. The balance is a snapshot you keep up to date yourself — importing only recent transactions never throws it off — and you can change it any time by tapping the balance on the Accounts page.',

  'acctType.checking': 'Cheque / current account',
  'acctType.savings': 'Savings account',
  'acctType.credit_card': 'Credit card',
  'acctType.cash': 'Cash',
  'acctType.investment': 'Investment',
  'acctType.other': 'Other',

  /* ---- finish ---- */
  'wiz.sum.folder': 'Folder',
  'wiz.sum.name': 'Name',
  'wiz.sum.language': 'Language',
  'wiz.sum.country': 'Country',
  'wiz.sum.period': 'Budget period',
  'wiz.sum.currency': 'Currency',
  'wiz.sum.categories': 'Categories',
  'wiz.sum.account': 'First account',
  'wiz.sum.opening': 'Opening balance',
  'wiz.sum.catCount': {
    one: '{count} starter category',
    other: '{count} starter categories',
  },
  'wiz.sum.monthlyCalendar': 'Monthly (calendar month)',
  'wiz.sum.monthlyOn': 'Monthly, starting on the {day}',
  'wiz.sum.cycleFrom': '{preset}, counted from {date}',
  'wiz.finish.connectLead': 'Connecting to the existing budget folder and saving these settings into its Settings.md:',
  'wiz.finish.createLead': 'This will create the budget folder with Settings.md, your categories, the first budget file and empty Owed Money / Services files:',
  'wiz.finish.nextLead': 'What to do next: ',
  'wiz.finish.nextBody': 'give your categories an amount on the Budgets page, then import your bank\'s CSV on the Transactions page.',
  'wiz.finish.privacy': 'Your budget opens behind a tap-to-enter privacy screen, so nothing is on show if someone glances at your vault. Turn it off in Settings → Budget Vault → Privacy splash screen.',

  'wiz.done.connected': 'Connected to your budget folder.',
  'wiz.done.created': 'Budget folder created — welcome!',
  'wiz.failed': 'Setup failed: {error}',

  /* ============================== Budget page ============================= */
  /* NOT here: the markdown Budgets/<period>.md is written with. That is vault
     file content, not interface copy — same rule the wizard follows. */

  'bud.shape.title': 'Your other budgets are still here',
  'bud.shape.body': {
    one: '{count} budget file is saved under a different period length — it is Budgets/{newest}.md. It stays in your vault, and it comes back as soon as you set the period length back. Amounts start blank here because this period isn\'t the same length as that one was.',
    other: '{count} budget files are saved under a different period length — the most recent is Budgets/{newest}.md. They stay in your vault, and they come back as soon as you set the period length back. Amounts start blank here because this period isn\'t the same length as those were.',
  },
  'bud.shape.bring': 'Bring over the categories and notes from {newest}',
  'bud.shape.empty': 'That budget is empty',
  'bud.shape.brought': {
    one: 'Brought over {count} category — set the amount for this period',
    other: 'Brought over {count} categories — set the amounts for this period',
  },
  'bud.shape.allHere': 'Every category from that budget is already here',
  'bud.shape.bringAmounts': 'Bring the amounts across too…',
  'bud.shape.broughtAmounts': {
    one: 'Brought {count} amount across — check it, then save',
    other: 'Brought {count} amounts across — check them, then save',
  },

  'bud.total.income': 'Total income',
  'bud.total.incomeNote': '{amount} received so far',
  'bud.total.budgeted': 'Total budgeted',
  'bud.total.budgetedNote': '{pct}% of budgeted income',
  'bud.total.over': 'Over-budgeted',
  'bud.total.overNote': 'budgeted beyond income',
  'bud.total.left': 'Left to budget',
  'bud.total.leftNote': 'income not yet allocated',
  'bud.total.spent': 'Total spent',
  'bud.total.spentNote': '{pct}% of budget used',
  'bud.total.spentNoteAssumed': '{pct}% of budget used · includes {amount} already spent',

  'bud.col.category': 'Category',
  'bud.col.type': 'Type',
  'bud.col.amount': 'Amount',
  'bud.col.actual': 'Actual so far',
  'bud.col.notes': 'Notes',

  'bud.remaining.over': '{amount} over',
  'bud.remaining.left': '{amount} left',
  'bud.remaining.assumed': 'already spent',

  /* Assume-spent: a category whose budgeted amount IS its actual spend,
     because the money left in an earlier period. */
  'bud.assumed.tag': 'already spent',
  'bud.assumed.note': 'no transaction expected',
  'bud.assumed.on': '{category} now counts its budget as already spent',
  'bud.assumed.off': '{category} counts actual transactions again',
  'bud.assumed.missing': 'No category called {category}',
  'bud.assumed.noFile': 'Could not read the note for {category}',

  'bud.pull.label': 'Pull overspend',
  'bud.pull.title': 'Fill this in from the overspend {lag} period(s) back',
  'bud.pull.none': '{period} did not overspend — it ended {amount} up',
  'bud.pull.confirmTitle': 'Pull previous overspend',
  'bud.pull.confirmBody': '{period} spent {amount} more than it received. Set {category} to {amount}? It currently reads {current}.',
  'bud.pull.confirmOk': 'Set the amount',
  'bud.pull.confirmCancel': 'Leave it',
  'bud.pull.done': 'Set to {amount} from {period} — save the budget to keep it',

  'bud.aria.amount': 'Budget amount for {category}',
  'bud.aria.notes': 'Notes for {category}',
  'bud.aria.clear': 'Clear budget for {category}',
  'bud.title.clear': 'Clear this category from the period file',
  'bud.aria.assume': 'Count the budget for {category} as already spent',
  'bud.title.assumeOn': 'Count this budget as already spent — no transaction will arrive for it',
  'bud.title.assumeOff': 'Go back to measuring this category against actual transactions',
  'bud.aria.delete': 'Delete category {category}',
  'bud.title.delete': 'Delete this category everywhere',

  'bud.saved': 'Budget saved to Budgets/{period}.md',
  'bud.err.save': 'Could not save the budget ({error})',
  'bud.copy.none': 'No budget found for the previous period',
  'bud.copy.done': {
    one: 'Copied {count} category from the previous period',
    other: 'Copied {count} categories from the previous period',
  },
  'bud.copy.nothing': 'Nothing to copy — every category already has a value',

  /* =========================== Transactions page ========================== */
  'tx.wholeHistory': 'Whole history',
  'tx.allAccounts': 'All accounts',
  'tx.allCategories': 'All categories',
  'tx.uncategorised': 'Uncategorised',
  'tx.count.window': {
    one: '{shown} of {total} row',
    other: '{shown} of {total} rows',
  },
  'tx.count.all': { one: '{count} row', other: '{count} rows' },

  'tx.col.date': 'Date',
  'tx.col.desc': 'Description',
  'tx.col.account': 'Account',
  'tx.col.category': 'Category',
  'tx.col.amount': 'Amount',
  'tx.col.excl': 'Excl.',
  'tx.col.note': 'Note',
  'tx.col.split': 'Split',
  'tx.col.actions': 'Row actions',

  'tx.aria.category': 'Category for {date} {desc}',
  'tx.aria.exclude': 'Exclude {desc} from budget totals',
  'tx.aria.note': 'Note for {date} {desc}',
  'tx.aria.split': 'Split {date} {desc} into categories',
  'tx.title.split': 'Split into categories',
  'tx.aria.delete': 'Delete the {desc} transaction on {date}',
  'tx.title.delete': 'Delete this row',
  'tx.delete.title': 'Delete transaction',
  'tx.delete.msg': '{date} · {desc} · {amount} — removed from {file} when you save.',
  'tx.delete.reimport': 'This row carries the key that stops a re-import of the same statement adding it twice, so importing that statement again later will re-add the line.',
  'tx.delete.parent': {
    one: 'Its split part goes with it.',
    other: 'Its {count} split parts go with it.',
  },
  'tx.delete.part': 'This is one part of a split: the parts will no longer add up to the original line, and the difference leaves your account totals. Untick Excluded on the original to put it back.',
  'tx.delete.confirm': 'Delete row',
  'tx.deleted': {
    one: 'Row removed — Save changes to write it to the file',
    other: '{count} rows removed — Save changes to write them to the file',
  },

  'tx.undo.what': {
    one: 'Imported 1 row into {label} at {at}.',
    other: 'Imported {count} rows into {label} at {at}.',
  },
  'tx.undo.session': 'Undo stays available until the vault is re-read.',
  'tx.undo.do': 'Undo import',
  'tx.undo.dismiss': 'Dismiss the undo offer',

  'tx.bulk.dirty': 'Save your changes first — deleting rows rewrites the same files',
  'tx.bulk.needFilter': 'Pick an account, a category or a search first — this deletes what the filters select, and no filter selects everything',
  'tx.bulk.none': 'No rows match the current filters',
  'tx.bulk.title': 'Delete the rows on screen',
  'tx.bulk.msg': {
    one: 'Delete the 1 row matching {filters} in {range}?',
    other: 'Delete all {count} rows matching {filters} in {range}?',
  },
  'tx.bulk.backup': 'They are written to {path} first, so they can be brought back — the vault trash cannot undo this on its own, because the monthly files are edited rather than deleted.',
  'tx.bulk.splits': {
    one: '1 of them belongs to a split, whose other rows the filters may not have selected.',
    other: '{count} of them belong to splits, whose other rows the filters may not have selected.',
  },
  'tx.bulk.confirm': {
    one: 'Delete 1 row',
    other: 'Delete {count} rows',
  },
  'tx.bulk.backupFailed': 'Could not write the backup, so nothing was deleted ({error})',
  'tx.bulk.failed': {
    one: 'Stopped after 1 file ({error}) — the rest are unchanged',
    other: 'Stopped after {count} files ({error}) — the rest are unchanged',
  },
  'tx.bulk.done': {
    one: 'Deleted 1 row · a copy is in {path}',
    other: 'Deleted {count} rows from {files} files · a copy is in {path}',
  },

  'tx.none': 'No transactions match.',
  'tx.showMore': {
    one: 'Show {n} more of {remaining} remaining',
    other: 'Show {n} more of {remaining} remaining',
  },

  'tx.split.zero': 'A zero-amount line has nothing to split',
  'tx.split.excluded': 'This line is already excluded — untick it first',
  'tx.split.part': 'This line is already part of a split — undo that split first',
  'tx.split.marker': 'Split into {n}',
  'tx.split.done': 'Split into {n} — review, then Save changes',

  'tx.add.noAccount': 'Add an account first — every transaction belongs to one',
  'tx.add.title': 'Add transaction',
  'tx.field.date': 'Date',
  'tx.field.desc': 'Description',
  'tx.field.descPlaceholder': 'e.g. Cash — vegetables at the market',
  'tx.field.account': 'Account',
  'tx.field.direction': 'Direction',
  'tx.dir.out': 'Money out',
  'tx.dir.in': 'Money in',
  'tx.field.amount': 'Amount',
  'tx.field.amountDesc': 'Always positive — direction sets the sign',
  'tx.field.category': 'Category',
  'tx.field.none': '— none —',
  'tx.field.note': 'Note',
  'tx.field.notePlaceholder': 'optional',

  'tx.err.date': 'Date must be YYYY-MM-DD',
  'tx.err.desc': 'Description is required',
  'tx.err.account': 'Invalid account name',
  'tx.err.amount': 'Amount must be a number other than 0',
  'tx.err.save': 'Could not save the transaction ({error})',
  'tx.err.saveMany': {
    one: 'Saved 1 file, then failed ({error}) — the rest are still marked unsaved',
    other: 'Saved {count} files, then failed ({error}) — the rest are still marked unsaved',
  },
  // Reached when the very first write failed — the common case, since a
  // dirty batch is usually saved in order and the earliest file is the one
  // most likely to still be locked or mid-sync. No count to state at all,
  // so no plural form and no language-specific zero handling to get wrong.
  'tx.err.saveNone': 'Save failed ({error}) — nothing landed, all files are still marked unsaved',

  'tx.saved': { one: 'Saved {count} file', other: 'Saved {count} files' },
  'tx.savedLearned': { one: ' · learned {count} new rule', other: ' · learned {count} new rules' },

  'tx.export.dirty': 'Save your changes first — an export of unsaved edits would not match the vault',
  'tx.export.empty': 'Nothing to export — no rows match the current filters',
  'tx.export.title': 'Export transactions',
  'tx.export.folder': 'Save to folder',
  'tx.export.desc': {
    one: 'Vault folder for the export. {count} row ({range}) plus {cats} categories, as CSV and markdown.',
    other: 'Vault folder for the export. {count} rows ({range}) plus {cats} categories, as CSV and markdown.',
  },
  'tx.export.failed': 'Could not write the export — check the folder name',
  'tx.export.done': {
    one: 'Exported {count} row and {cats} categories to {path}/',
    other: 'Exported {count} rows and {cats} categories to {path}/',
  },


  /* ============================= Accounts page ============================ */
  'acct.group.bank': 'Bank accounts',
  'acct.group.savings': 'Savings',
  'acct.group.investments': 'Investments',
  'acct.group.other': 'Other',
  'acct.group.count': { one: '{count} account', other: '{count} accounts' },

  'acct.noteMissing': 'Accounts/{name}.md not found',
  'acct.balance.title': 'Update balance — {name}',
  'acct.balance.field': 'New balance',
  'acct.balance.inCurrency': 'Entered in {symbol}.',
  'acct.balance.updated': '{name} balance updated',
  'acct.reconciled': '{name} reconciled to {amount}',
  'acct.err.nan': 'Not a number',
  'acct.err.type': 'Invalid type',
  'acct.err.notNumber': '{field} is not a number',
  'acct.err.nameRequired': 'Account name required',
  'acct.err.exists': 'Account already exists',
  'acct.err.save': 'Could not save {name} ({error})',

  'acct.edit.title': 'Edit account — {name}',
  'acct.new.title': 'New account',
  'acct.field.name': 'Account name',
  'acct.field.type': 'Type',
  'acct.field.institution': 'Institution',
  'acct.field.number': 'Account number',
  'acct.field.numberDesc': 'Used to match a downloaded statement to this account on import.',
  'acct.field.folder': 'Transactions folder',
  'acct.field.folderDesc': 'Leave blank to use "{name}". Set it only when the folder under Transactions/ has a different name.',
  'acct.field.currency': 'Currency',
  'acct.field.currencyDesc': 'Leave blank to use the household currency ({symbol}). Set it only for an account held in another currency — the symbol changes, nothing is converted.',
  'acct.field.mute': 'Warnings to ignore',
  'acct.field.muteDesc': 'Switch one on to stop this account being listed under "Needs a look" for that reason. The row still shows what the balance is — this quietens the nag, it does not change the fact.',
  'acct.mute.drift': 'Balance drifted from the transactions',
  'acct.mute.stale': 'Balance not confirmed recently',
  'acct.mute.nodate': 'Balance never confirmed',
  'acct.mute.notx': 'Nothing imported yet',
  'acct.mute.nofolder': 'No transactions folder linked',
  'acct.field.counts': 'Counts toward the budget',
  'acct.counts.yes': 'Yes — normal spending account',
  'acct.counts.no': 'No — investment or savings wrapper',
  'acct.field.countsDesc': 'Choose No for an account whose interest is not household income and whose contributions are not household spending. Its transactions still import and show in Transactions.',
  'acct.field.emergency': 'Emergency fund',
  'acct.field.emergencyDesc': 'Counts this account toward the emergency-fund cover on the Dashboard\'s Financial health card. Set the months you are aiming for in Settings → Budget Vault.',
  'acct.emergency.no': 'Not the emergency fund',
  'acct.emergency.all': 'All of this account',
  'acct.emergency.part': 'Keep the {amount} earmark',
  'acct.field.limit': 'Credit limit',
  'acct.field.limitDesc': 'Shows a utilisation bar on credit cards.',
  'acct.field.balance': 'Current balance',
  'acct.field.goal': 'Savings goal',
  'acct.field.goalOpt': 'Savings goal (optional)',
  'acct.field.goalOptDesc': 'Shows a progress bar on Savings & Investments.',
  'acct.field.goalDate': 'Goal target date',
  'acct.field.monthly': 'Monthly contribution',
  'acct.field.invested': 'Total invested',
  'acct.field.investedOpt': 'Total invested (optional)',
  'acct.field.investedDesc': 'What you have put in, so growth can be shown against it.',
  'acct.field.starting': 'Starting amount',
  'acct.field.opened': 'Opened on',

  'acct.budget.on': '{name} counts toward the budget again',
  'acct.budget.off': '{name} no longer counts toward budget totals',

  'acct.creditUsed': 'Credit used',
  'acct.creditOf': '{used} of {limit}',
  'acct.overLimit': 'Over limit by {amount}',
  'acct.utilised': '{pct}% used · {available} available',

  'acct.kpi.inCredit': 'In credit',
  'acct.kpi.overdrawn': 'Overdrawn',
  'acct.kpi.netWorth': 'Net worth',
  'acct.kpi.netWorthNote': 'across these accounts only',
  'acct.kpi.attention': 'Needs attention',
  'acct.kpi.attentionNote': 'unverified or drifting balances',
  'acct.kpi.allGood': 'every balance checks out',

  'acct.aria.showTx': 'Show {name} transactions',
  'acct.aria.balance': 'Balance for {name}, {amount} — click to update',
  'acct.limitSuffix': ' · limit {amount}',
  'acct.monthlySuffix': ' · {amount}/m',

  'acct.badge.notInBudget': 'not in budget',
  'acct.badge.noTx': 'no transactions',
  'acct.badge.asOf': 'as of {date}',
  'acct.badge.neverConfirmed': 'never confirmed',
  'acct.badge.unconfirmed': { one: 'unconfirmed {count} day', other: 'unconfirmed {count} days' },

  'acct.act.in': ' in · ',
  'acct.act.out': ' out · ',
  'acct.act.count': { one: '{count} transaction in {month}', other: '{count} transactions in {month}' },

  'acct.recon.since': { one: '{count} transaction since · implies ', other: '{count} transactions since · implies ' },
  'acct.recon.pending': {
    one: ' · {count} dated ahead, not counted yet',
    other: ' · {count} dated ahead, not counted yet',
  },
  'acct.recon.useThis': 'Use this',
  'acct.aria.useThis': 'Set {name} balance to {amount}',
  'acct.recon.matches': 'Matches your transactions',
  'acct.recon.upToDate': { one: 'Up to date · {count} transaction dated ahead', other: 'Up to date · {count} transactions dated ahead' },
  'acct.recon.setDate': 'Set a balance date to check this against your transactions',

  'acct.foot.updated': 'updated {date}',
  'acct.foot.noDate': 'no balance date',
  'acct.aria.exclude': 'Stop counting {name} toward budget totals',
  'acct.aria.include': 'Count {name} toward budget totals again',
  'acct.btn.exclude': 'Exclude from budget',
  'acct.btn.include': 'Include in budget',
  'acct.aria.edit': 'Edit {name}',
  'acct.btn.edit': 'Edit',
  'acct.aria.openNote': 'Open the {name} note',
  'acct.btn.openNote': 'Open note',
  'acct.btn.delete': 'Delete',
  'acct.aria.delete': 'Delete the account {name}',
  'acct.delete.title': 'Delete {name}',
  'acct.delete.gone': 'Accounts/{name}.md is no longer in the vault',
  'acct.delete.folderField': 'Transactions/{label}/',
  'acct.delete.folderDesc': {
    one: 'That folder holds {count} transaction in {months} monthly file.',
    other: 'That folder holds {count} transactions in {months} monthly files.',
  },
  'acct.delete.keep': 'Keep the folder — the rows stay in your totals',
  'acct.delete.drop': 'Delete the folder too — the rows go with it',
  'acct.delete.msg': 'Move Accounts/{name}.md to your vault trash?',
  'acct.delete.noFolder': 'It has no transactions folder, so nothing else changes.',
  'acct.delete.willKeep': {
    one: 'Transactions/{label}/ is kept, so its {count} row still counts toward every period total — under a folder no account claims.',
    other: 'Transactions/{label}/ is kept, so its {count} rows still count toward every period total — under a folder no account claims.',
  },
  'acct.delete.willDrop': {
    one: 'Transactions/{label}/ goes to the trash with it, and its {count} row leaves your totals.',
    other: 'Transactions/{label}/ goes to the trash with it, and its {count} rows leave your totals.',
  },
  'acct.delete.notes': 'Notes you wrote about it stay in Notes/ and will read as unmatched. Everything goes to the vault trash, recoverable from inside Obsidian.',
  'acct.delete.confirm': 'Delete account',
  'acct.delete.failed': 'Could not delete that account ({error}) — the vault was re-read',
  'acct.deleted': 'Deleted {name}',
  'acct.deleted.withRows': {
    one: 'Deleted {name} and {count} transaction',
    other: 'Deleted {name} and {count} transactions',
  },
  'acct.empty': 'No accounts yet. Use "New account" above to add a bank account, savings pot or investment.',

  /* ---- the page header: one figure, and what it is made of ---- */
  'acct.hero.label': 'Net across your accounts',
  'acct.hero.sub': '{assets} in credit against {liabilities} overdrawn.',
  'acct.hero.elsewhere': ' Assets and debts recorded on their own pages are not counted here.',
  'acct.hero.mixed': ' This total adds accounts held in more than one currency ({symbols}) without converting them.',
  'acct.hero.muted': 'Warnings ignored',
  'acct.mixedTitle': 'Adds accounts held in more than one currency, without converting them.',
  'acct.hero.count': 'Accounts',
  'acct.hero.oldest': 'Oldest figure',
  'acct.hero.oldestDays': { one: '{count} day', other: '{count} days' },
  'acct.hero.oldestNone': 'none',
  'acct.where.title': 'Where it sits',
  'acct.where.sub': 'Share of what these accounts hold',
  'acct.where.aria': 'Share of what these accounts hold: {parts}',
  'acct.where.part': '{group} {pct}%',
  /* A group whose card debt exceeds its cash cannot be drawn as a wedge. Said
     out loud rather than dropped, so the ring and the total still agree. */
  'acct.where.negative': { one: '{count} group is net negative and is not drawn: {names}', other: '{count} groups are net negative and are not drawn: {names}' },

  /* ---- the queue: the accounts that actually want a decision ---- */
  'acct.deck.title': { one: 'One account wants a decision', other: '{count} accounts want a decision' },
  'acct.deck.sub': 'Everything else on this page agrees with your transactions.',
  'acct.deck.clear': 'Everything agrees with your transactions',
  'acct.deck.clearSub': 'Nothing on this page needs a decision today.',
  'acct.deck.review': 'Review',
  'acct.deck.ariaReview': 'Open the {name} row below',
  'acct.deck.more': { one: '{count} more account — show them all in the table', other: '{count} more accounts — show them all in the table' },
  'acct.deck.why.drift': { one: '{count} transaction since you last confirmed implies {implied}, not {stated}', other: '{count} transactions since you last confirmed imply {implied}, not {stated}' },
  'acct.deck.why.stale': { one: 'Unconfirmed for {count} day — last checked {date}', other: 'Unconfirmed for {count} days — last checked {date}' },
  'acct.deck.why.nodate': 'No date on this figure, so nothing can check it',
  'acct.deck.why.notx': 'A folder is linked, but nothing has imported into it yet',
  'acct.deck.why.nofolder': 'Nothing imports into this account, so nothing can check the figure',
  'acct.deck.do.drift': 'Use {amount}',
  'acct.deck.do.stale': 'Confirm balance',
  'acct.deck.do.nodate': 'Set the date',
  'acct.deck.do.notx': 'Import transactions',
  'acct.deck.do.nofolder': 'Link a folder',

  /* ---- who an account belongs to ---- */
  'acct.field.owner': 'Owner',
  'acct.field.ownerDesc': 'Who this account belongs to. The names come from "Household members" in the plugin settings.',
  'acct.owner.none': 'Not set',
  'acct.owner.joint': 'Joint',
  'acct.owner.all': 'Everyone',
  'acct.owner.title': 'Whose it is',
  'acct.owner.sub': 'The same net figure, split by who each account belongs to',
  'acct.owner.aria': '{owner}: {amount}. Show only these accounts',

  /* ---- the ledger ---- */
  'acct.filter.all': 'All',
  'acct.filter.flag': 'Needs a look',
  'acct.search': 'Find an account…',
  'acct.groupBy': 'Group by kind',
  'acct.table.title': 'All accounts',
  'acct.table.subAll': { one: '{count} account', other: 'All {count} accounts' },
  'acct.table.subSome': '{shown} of {total} accounts',
  'acct.table.grouped': ' · grouped by kind',
  'acct.table.flat': ' · flat',
  'acct.table.sortedBy': ' · sorted by {column}',
  'acct.col.account': 'Account',
  'acct.col.balance': 'Balance',
  'acct.col.month': 'Month',
  'acct.col.goal': 'Goal / limit',
  'acct.col.confirmed': 'Confirmed',
  'acct.col.state': 'State',
  'acct.col.notes': 'Notes',
  'acct.sort.name': 'name',
  'acct.sort.balance': 'balance',
  'acct.sort.flow': 'this period',
  'acct.sort.stale': 'how stale',
  'acct.aria.sortBy': 'Sort by {column}',
  'acct.aria.row': 'Show detail for {name}',
  'acct.state.ok': 'agrees',
  'acct.state.drift': 'drifted',
  'acct.state.stale': { one: '{count} day old', other: '{count} days old' },
  'acct.state.nodate': 'never confirmed',
  'acct.state.notx': 'nothing imported',
  'acct.state.nofolder': 'no folder linked',
  'acct.state.muted': 'ignored',
  'acct.mutedTitle': 'Ignored on this account, so it is not listed under "Needs a look".',
  'acct.emptySearch': 'No account matches that.',
  'acct.noDate': 'no date',
  'acct.growthOn': '{pct}% on {amount}',
  'acct.goalOf': '{pct}% of {amount}',
  'acct.limitOf': '{pct}% of {amount}',
  'acct.drawer.recon.ok': 'This figure matches your transactions — nothing outstanding.',
  'acct.drawer.recon.stale': 'Last confirmed {date}. Confirming it restarts the reconciliation window.',
  'acct.drawer.recon.nodate': 'No confirmed date yet — the reconciler needs one before it can check this account.',
  'acct.drawer.recon.notx': 'A transactions folder is linked, but nothing has imported into it yet. Import a statement and the figure becomes checkable.',
  'acct.drawer.recon.nofolder': 'Nothing imports into this account. Link a transactions folder and the figure becomes checkable.',
  'acct.drawer.drift': { one: '{count} transaction since {date} implies {implied} — {diff} {dir} than the figure on file.', other: '{count} transactions since {date} imply {implied} — {diff} {dir} than the figure on file.' },
  'acct.drawer.lower': 'lower',
  'acct.drawer.higher': 'higher',
  'acct.drawer.limit': 'Credit limit',
  'acct.drawer.available': 'Available',
  'acct.drawer.goal': 'Savings goal',
  'acct.drawer.toGo': 'To go',
  'acct.drawer.invested': 'Total invested',
  'acct.drawer.growth': 'Growth',
  'acct.drawer.monthly': 'Monthly',
  'acct.drawer.flow': 'This period',
  'acct.drawer.rows': { one: '{count} transaction', other: '{count} transactions' },
  'acct.drawer.folder': 'Transactions folder',
  'acct.drawer.noFolder': 'none linked',
  'acct.drawer.inBudget': 'Counts toward the budget',
  'acct.drawer.yes': 'Yes',
  'acct.drawer.no': 'No',
  'acct.btn.seeTx': 'See transactions',
  'acct.btn.editBalance': 'Edit balance',


  /* ===================== shell chrome + Dashboard page ==================== */
  'shell.connect.title': 'Budget folder not found',
  'shell.connect.btn': 'Open plugin settings…',
  'shell.saveChanges': 'Save changes',
  'shell.dash.trend': 'Spending Trend',
  'shell.dash.trendSub': 'Spent vs budget',
  'shell.dash.split': 'Where it went',
  'shell.dash.vsActual': 'Budget vs Actual',
  'shell.dash.position': 'Where you stand',
  'shell.legend.spent': 'Spent',
  'shell.legend.over': 'Over budget',
  'shell.legend.income': 'Income',
  'shell.legend.budget': 'Budget',
  'shell.tx.search': 'Search description…',
  'shell.tx.wholeHistory': 'whole history',
  'shell.tx.export': 'Export',
  'shell.tx.deleteFiltered': 'Delete these rows',
  'shell.tx.add': 'Add transaction',
  'shell.bud.title': 'Category budgets',
  'shell.bud.copyPrev': 'Copy previous period',
  'shell.bud.save': 'Save budget',

  'dash.greet.morning': 'Good morning',
  'dash.greet.afternoon': 'Good afternoon',
  'dash.greet.evening': 'Good evening',
  'dash.greet.line': '{greeting}, {name}',
  'dash.hero.remaining': 'Remaining this period',
  'dash.hero.overspent': 'Overspent this period',
  'dash.hero.sub': '{spent} spent of {budgeted} budgeted',
  'dash.stat.income': 'Total Income',
  'dash.stat.budgeted': 'Budgeted',
  'dash.stat.spent': 'Total Spent',
  'dash.stat.uncategorised': 'Uncategorised',
  'dash.stat.allocated': '{pct}% allocated',
  'dash.stat.used': '{pct}% used',
  'dash.stat.review': 'review in Transactions',
  'dash.stat.notIncome': '{amount} in, not counted',
  'dash.stat.missing': 'Missing categories',
  'dash.stat.missingSub': { one: '{count} transaction — recategorise', other: '{count} transactions — recategorise' },
  'dash.stat.missingNames': '{names} +{count} more',

  'dash.col.category': 'Category',
  'dash.col.budget': 'Budget',
  'dash.col.spent': 'Spent',
  'dash.col.remaining': 'Remaining',
  'dash.table.empty': 'No budget or transactions in this period yet.',

  'dash.pos.sub': 'As things stand today — these do not move with the period above',
  'dash.pos.netWorth': 'Net worth',
  'dash.pos.netWorthSub': '{owned} owned · {owed} owed',
  'dash.pos.netWorthSay': 'Net worth {net} — {owned} owned against {owed} owed. Open Savings and Investments.',
  'dash.pos.debt': 'Debt',
  'dash.pos.debtSplit': '{accounts} on accounts · {debts} on the debt page',
  'dash.pos.debtActive': { one: '{count} active', other: '{count} active' },
  /* Everything owed sits on ACCOUNTS — an overdrawn cheque account, a card in
     the red — and nothing on the Debt page. Says which ledger the figure came
     from, because quoting a count of debt-page rows here printed "0 active"
     under a real amount. */
  'dash.pos.debtAccounts': { one: 'all on {count} account', other: 'all on {count} accounts' },
  'dash.pos.debtNone': 'nothing owed',
  'dash.pos.debtSay': 'Debt {amount} owed. Open the Debt page.',
  'dash.pos.debtSayNone': 'No debt owed. Open the Debt page.',
  'dash.pos.owed': 'Owed to you',
  'dash.pos.owedOpen': {
    one: '{count} outstanding',
    other: '{count} outstanding',
  },
  'dash.pos.owedOldest': {
    one: ' · oldest out {days} day',
    other: ' · oldest out {days} days',
  },
  'dash.pos.owedRecovered': '{amount} recovered',
  'dash.pos.owedNone': 'nothing lent out',
  'dash.pos.owedSay': {
    one: '{amount} owed to you across {count} entry. Open Owed Money.',
    other: '{amount} owed to you across {count} entries. Open Owed Money.',
  },
  'dash.pos.owedSayNone': 'Nothing outstanding. Open Owed Money.',
  'dash.pos.savings': 'Savings & investments',
  'dash.pos.savingsSub': '{savings} savings · {invested} invested',
  'dash.pos.savingsSay': '{amount} in savings and investments. Open Savings and Investments.',

  'dash.overlap': 'Credit-card accounts tracked: {accounts} · card debts tracked: {debts} — if any card is in both, it is counted twice above.',
  'dash.overlap.btn': 'Review debts',
  'dash.overlap.aria': 'Review tracked debts on the Debt page',
  'dash.stale.noDate': 'none of them carry a date',
  'dash.stale.oldest': {
    one: 'the oldest {days} day ago',
    other: 'the oldest {days} days ago',
  },
  'dash.stale.all': { one: 'Built from a balance nobody has confirmed recently', other: 'Built from {count} balances nobody has confirmed recently' },
  'dash.stale.some': 'Built from {stale} of {total} balances nobody has confirmed recently',
  'dash.stale.line': '{line} — {age}.',
  /* Appended to the line above. How far the imported transactions have already
     moved those balances, so "old" carries a size rather than only an age. */
  'dash.stale.driftUp': ' Transactions since then imply {amount} more.',
  'dash.stale.driftDown': ' Transactions since then imply {amount} less.',
  'dash.stale.btn': 'Review balances',
  'dash.stale.aria': 'Review account balances on the Accounts page',

  /* The pill for "every period this vault holds". Sits beside 3M/6M/1Y/5Y, so
     it has to stay about that short in every language. */
  'dash.range.all': 'All',
  'dash.trend.range': 'Spending trend range',
  'dash.trend.sub': { one: 'Spent vs budget · {count} period', other: 'Spent vs budget · {count} periods' },
  'dash.trend.clamped': ' · all the history imported so far',
  'dash.trend.empty': 'Import a second period of transactions and the trend line starts here.',
  'dash.trend.aria': {
    one: 'Spent, budgeted and income over the last {count} period',
    other: 'Spent, budgeted and income over the last {count} periods',
  },
  /* The trend chart is history: every point but the last is a closed period, so
     these read as a verdict on it rather than as the Budgets page's "left",
     which is about a period still being spent. */
  'dash.trend.tip.over': '{amount} over budget',
  'dash.trend.tip.under': '{amount} under budget',

  'dash.split.uncatNote': ' · {amount} uncategorised, not shown',
  /* The other half of the difference between this donut and "Total Spent":
     refunds and credits that shrank a slice instead of drawing one. */
  'dash.split.nettedNote': ' · {amount} in refunds netted off',
  'dash.split.onlyUncat': '{amount} went out this period, but none of it is categorised yet — set categories in Transactions and the split appears here.',
  'dash.split.empty': 'Nothing categorised as spending in this period yet.',
  'dash.split.aria': 'Spending split for {month}: ',
  'dash.split.sliceAria': '{cat}: {amount}, {pct}% of spending — show transactions',
  'dash.split.noteAria': 'Open the {cat} category note',
  'dash.split.noteMissing': 'No category note found for "{cat}"',
  /* The donut's centre figure, NOT "Total spent" — that's the hero tile's
     gross figure above it. This one is categorised spend with refunds netted
     off inside their category, which the subtitle already discloses. */
  'dash.split.centerLabel': 'Categorised spend',

  /* -------------------------- financial health ---------------------- */
  'shell.dash.health': 'Financial health',
  'dash.health.sub': {
    one: 'Averaged over your last completed period',
    other: 'Averaged over your last {count} completed periods',
  },
  'dash.health.subNone': 'No completed periods to average yet',
  'dash.health.monthsUnit': 'months',
  'dash.health.months': 'of essential spending covered',
  'dash.health.meterTip': {
    one: '{earmarked} of the {goal} that covers {count} month',
    other: '{earmarked} of the {goal} that covers {count} months',
  },
  'dash.health.monthsMeta': {
    one: 'Goal {count} month · {amount} earmarked',
    other: 'Goal {count} months · {amount} earmarked',
  },
  /* The setup hint doubles as the only documentation most readers will meet, so
     it names the CONTROL rather than the frontmatter key it writes: the key is
     still hand-editable, but sending a reader to YAML when a dropdown exists
     reads as the app admitting it has no UI for its own feature. */
  'dash.health.setup': 'Mark a savings account as your Emergency fund on the Accounts page to start tracking this',
  'dash.health.needHistory': 'needs income history',
  'dash.health.over': '{name} earmarks more than it holds',
  'dash.health.savings': 'of income saved',
  'dash.health.perMonth': '{amount} / month',
  'dash.health.debt': 'of income to debt interest',
  'dash.health.debtNone': 'no debts recorded',
  'dash.health.debtFree': 'debt-free',
  'dash.health.score': 'financial score',
  'dash.health.strong': 'strong',
  'dash.health.steady': 'steady',
  'dash.health.attention': 'needs attention',
  /* The explanation popup. It answers three questions in order — what the score
     is, where this household's points went, and what to do next — because a
     reader who opens it is asking the third one and will not find it under a
     wall of methodology. */
  'dash.health.why.title': 'How this score works',
  'dash.health.why.intro': 'A score out of 100, from five parts of your money. Each part is worth a share of the total. Anything your files cannot answer is left out, not marked zero.',
  'dash.health.why.bands': '{strong}+ is strong · {steady}–{strongLess} is steady · under {steady} needs attention',
  'dash.health.why.name.reserves': 'Emergency cover',
  'dash.health.why.name.saving': 'Saving',
  'dash.health.why.name.debt': 'Debt',
  'dash.health.why.name.spending': 'Spending',
  'dash.health.why.name.wealth': 'What you own',
  'dash.health.why.fullReserves': 'Aim for {target} months of essential spending saved.',
  'dash.health.why.fullSaving': 'Aim to save {pct}% of what you earn.',
  'dash.health.why.fullDebt': 'Aim for no interest and no repayments.',
  'dash.health.why.fullSpending': 'Aim for fixed bills under {fixed}% of income, living costs under {living}%, and spending inside your budget.',
  'dash.health.why.fullWealth': 'Aim for what you own, less what you owe, to reach {times}× a year of income.',
  'dash.health.why.fixTrim': 'Cut living costs by {amount} a month to get under {pct}% of income.',
  'dash.health.why.fixBuild': 'Grow what you own by {amount} to reach {times}× a year of income.',
  'dash.health.why.points': '{points} of {max}',
  'dash.health.why.dragLabel': 'Biggest gap: {name}, {points} points.',
  'dash.health.why.fixFund': 'Put {amount} more into an earmarked account to reach {target} months.',
  'dash.health.why.fixMonthly': 'Save {amount} more a month to reach {pct}%.',
  'dash.health.why.fixInterest': 'That is {amount} a month buying you nothing — clearing it wins the points back.',
  'dash.health.why.allFull': 'Everything we can measure is at full marks. Nothing is holding you back.',
  'dash.health.why.aria': 'Financial score — how it is worked out and what would improve it',

  /* ------------------------------ score page ----------------------------- */
  'nav.score': 'Score',
  'score.subNote': 'How your score is worked out, what is going well, and what would move it',
  'score.outOf': '/ 100',
  'score.meterAria': 'Financial score {score} out of 100',
  'score.hero.sub': {
    one: 'Averaged over your last completed period',
    other: 'Averaged over your last {count} completed periods',
  },
  'score.say.strong': 'This is a strong position. The habits behind it are the ones worth protecting when something changes — a move, a new job, a rate rise.',
  'score.say.steady': 'A solid base with room to build on. The list below is in order: the first one moves the number most.',
  'score.say.attention': 'There is ground to make up, and the good news is that it is specific. Start at the top of the list below — one thing, not five.',
  'score.good.title': 'What is going well',
  'score.good.sub': {
    one: '{count} part of your money is at or near full marks',
    other: '{count} parts of your money are at or near full marks',
  },
  'score.work.title': 'What would move it most',
  'score.work.sub': 'Biggest gap first — each shows where you are, what to aim for, and how to get there',
  'score.gap.points': '{points} points to gain',
  'score.win.fullMarks': 'Full marks',
  'score.win.reserves': 'You could cover months of essentials with nothing coming in. That is the difference between a setback and a crisis.',
  'score.win.saving': 'You put real money aside every month, not just what happens to be left over.',
  'score.win.debtNone': 'Nothing is going to interest — though no debts are recorded, so this reflects what your files say rather than a check of them.',
  'score.win.debt': 'Nothing is lost to interest. Every rand you earn is still yours to use.',
  'score.win.spending': 'Your outgoings leave room to breathe — you are not living at the edge of what comes in.',
  'score.win.wealth': 'What you own has grown well past what you owe. That is the part that compounds quietly.',
  'score.now.reserves': 'Now: {months} months covered · {amount} set aside · goal {target} months',
  'score.now.saving': 'Now: {pct} of income saved · {amount} a month',
  'score.now.debt': 'Now: {pct} of income going to interest',
  'score.now.fixed': 'fixed bills {pct} of income',
  'score.now.living': 'living costs {pct}',
  'score.now.budget': 'budget used {pct}',
  'score.now.wealth': 'Now: {amount} net worth · {times}× a year of income',
  'score.how.title': 'How the score is built',
  'score.how.sub': 'Five parts, each worth a share of 100',
  'score.how.worth': 'worth {points}',
  'score.how.reserves': 'Money set aside that could carry the household with no income, counted in months of essential spending.',
  'score.how.saving': 'What reaches your savings and investments each month, as a share of what you earn.',
  'score.how.debt': 'What debt costs you — interest, and the repayments you are committed to.',
  'score.how.spending': 'How much of your income is promised before you decide anything, what living costs, and whether you stay inside your own budget.',
  'score.how.wealth': 'Everything you own, less everything you owe, against a year of income.',
  'score.how.foot': 'A part your files cannot answer yet is left out and the rest share its weight — so the score is always out of 100, and never marks you down for a question you have not been asked.',
  'score.guide.reserves': 'Mark the account holding this money as your emergency fund on the Accounts page, then feed it whatever is comfortable each month. Consistency beats size — a standing transfer on payday beats whatever is left at month end.',
  'score.guide.saving': 'Move the transfer to the day you are paid rather than the day before the next one. Saving what is left over means saving what nothing else wanted; saving first means the rest of the month adjusts around it.',
  'score.guide.debt': 'Put every spare rand at the debt with the highest rate, not the biggest balance — that is the one quietly costing the most. Keep the minimums on the rest so nothing slips while you clear it.',
  'score.guide.spending': 'Look first at what is committed before you decide anything: the debit orders, the policies, the subscriptions that renewed without asking. One cancelled contract lowers this every month from now on, where a careful week lowers it once.',
  'score.guide.wealth': 'This moves slowly, and that is normal. It grows out of the other four — money kept rather than spent, debt cleared rather than carried — so working the list above is what moves it.',
  'score.empty.title': 'Not enough history yet',
  'score.empty.body': 'The score averages your last six completed periods, so it appears once there are transactions to average. Import a statement, or add a few periods, and it fills in on its own.',


  /* --------------------- what's left + comparison ------------------- */
  'shell.dash.left': 'What\'s left this period',
  'dash.left.sub': 'Before this period ends on {date}',
  'dash.left.nowSub': 'Money you have right now',
  'dash.left.notNow': 'This card measures the money you have right now, so it only reads true for the period you are in. Switch to {period} to see it.',
  'dash.left.cash': 'in your accounts',
  'dash.left.committed': 'still committed',
  'dash.left.free': 'actually free',
  'dash.left.short': 'short',
  'dash.left.counted': {
    one: '{count} account',
    other: '{count} accounts',
  },
  'dash.left.unconfirmed': '{count} unconfirmed',
  'dash.left.undated': '{count} with no balance date',
  'dash.left.orders': {
    one: '{count} debit order',
    other: '{count} debit orders',
  },
  'dash.left.instalments': {
    one: '{count} debt instalment',
    other: '{count} debt instalments',
  },
  'dash.left.cards': {
    one: '{count} card settlement',
    other: '{count} card settlements',
  },
  'dash.left.none': 'nothing scheduled',
  'dash.left.cardDue': 'card to settle',
  'dash.left.cycle': '{spend} on the card this cycle, of the {settling} that settles it',
  'dash.left.cycleAria': 'Card spending {spend} against {settling} of settling income, {pct} percent',
  'dash.left.cycleUnder': '{amount} of headroom before the {date} settlement.',
  'dash.left.cycleOver': '{amount} MORE than the income that settles it on {date}.',
  'dash.left.incoming': '{amount} lands on {date}',
  'dash.left.incomingCovers': 'That covers everything above and leaves about {amount}.',
  'dash.left.incomingShort': 'Even after that you are {amount} short.',
  'dash.left.days': {
    one: '{count} day',
    other: '{count} days',
  },
  'dash.left.perDay': '{amount}/day',
  'dash.left.barAria': 'Of {cash}, {committed} is committed and {free} is free',
  /* The same bar when the commitments exceed the cash. The sighted reader sees
     a fully-amber bar and the figure above it labelled "short"; the neutral
     wording announced "{free} is free" for money that is not there, which is
     the one sentence a screen-reader user has no second cue to correct. */
  'dash.left.barAriaShort': 'Of {cash}, {committed} is committed — {short} more than you have',
  'dash.left.owedCard': '{amount} is owed on {name} — already spent, and not taken off any figure above.',
  'dash.left.owedCards': '{amount} is owed across {count} credit cards — already spent, and not taken off any figure above.',
  'dash.left.whatsCounted': 'What\'s counted as committed',
  'dash.left.expected': 'expected {date}',
  'dash.left.thisPeriod': 'due this period',
  'dash.left.lastCharged': 'last charged {amount}',
  'dash.left.asListed': 'as listed, no charge history',
  'dash.left.contracted': 'contracted instalment',
  'dash.left.settledInFull': 'settled in full, current balance',
  'dash.left.source': 'Amounts are what was last actually charged, not the figure typed on the Services page. Read from your Services list and Debt page only — a recurring charge on neither is not counted here.',
  'dash.split.colCat': 'Category',
  'dash.split.colSpent': 'Spent',
  'dash.split.colChange': 'Change',
  'dash.split.new': 'new',
  'dash.split.r1m': 'Last month',
  'dash.split.rPrev': 'Prev',
  'dash.split.rangeAria': 'Comparison range',
  'dash.split.likeForLike': {
    one: 'This period is {count} day old, so the {range} column counts only the first day of each earlier period. Like-for-like — it is not a full-period average.',
    other: 'This period is {count} days old, so the {range} column counts only the first {count} days of each earlier period. Like-for-like — it is not a full-period average.',
  },

  'dash.err.render': 'Could not draw the {label} — {error}',

};
