'use strict';
/* 中文 (Simplified Chinese).

   Checked against src/lang/en.js at build time — same key set, no more, no
   fewer. Add a string to en.js first, then translate it here.

   Conventions used throughout:
     - "Budget Vault" is the product name and stays untranslated. 仓库 is the
       vault, matching Obsidian's own Chinese locale.
     - Chinese has ONE noun form: a count never changes the wording. So plural
       entries carry only `other`, and i18n.js never asks this language for
       `one` (see ONE_FORM). A 1-vs-many split would produce text a native
       reader finds wrong, not merely clumsy.
     - Measure words matter: files are 个 here rather than a bare number.
     - Corner brackets 「」 are used for in-sentence quoting.
     - YYYY-MM-DD is left as-is; it is the form Chinese interfaces show for an
       ISO date, unlike the localised JJJJ-MM-TT of German. */

module.exports = {
  /* ------------------------------- splash -------------------------------- */
  'splash.sub': '你的私人预算，安全地保存在你的仓库中。',
  'splash.enter': '进入预算',

  /* -------------------------------- drawer -------------------------------- */
  'nav.menu': '菜单',
  'nav.close': '关闭菜单',
  'nav.section.budget': '预算',
  'nav.section.accounts': '账户',
  'nav.section.tools': '工具',

  'nav.dashboard': '仪表板',
  'nav.transactions': '交易',
  'nav.budgets': '预算',
  'nav.savings': '储蓄与投资',
  'nav.accounts': '账户',
  'nav.assets': '资产',
  'nav.debts': '债务',
  'nav.owed': '应收款项',
  'nav.services': '服务',
  'nav.tax': '税务',
  'nav.loans': '贷款计算器',
  'nav.import': '导入 CSV',
  'nav.reload': '从磁盘重新加载',
  'nav.pluginSettings': '插件设置',

  /* -------------------------------- topbar -------------------------------- */
  'topbar.nav': '预算导航',
  'topbar.mainMenu': '主菜单',
  'topbar.openMenu': '打开导航菜单',
  'topbar.home': '前往仪表板',
  'topbar.brandSub': 'Obsidian 仓库预算',
  'topbar.periodNav': '周期导航',
  'topbar.prevPeriod': '上一周期',
  'topbar.currentPeriod': '跳到当前周期',
  'topbar.nextPeriod': '下一周期',
  'topbar.import': '导入 CSV',
  'topbar.importTitle': '导入银行对账单 CSV',
  'topbar.settings': '打开预算设置',

  /* ------------------------------- settings -------------------------------- */
  'settings.folder.name': '预算文件夹',
  'settings.folder.desc': '存放 Categories/、Accounts/、Budgets/、Transactions/、Settings.md 等内容的文件夹在仓库中的路径。',

  'settings.theme.name': '主题',
  'settings.theme.desc': '跟随 Obsidian 的浅色/深色模式，或强制使用 Airy Glass 的深色或浅色配色。',
  'settings.theme.auto': '跟随 Obsidian',
  'settings.theme.dark': '始终深色',
  'settings.theme.light': '始终浅色',

  'settings.palette.name': '配色方案',
  'settings.palette.desc': '预算界面使用的颜色。每套配色都有各自的浅色和深色版本，因此与上面的主题设置相互独立。',

  'settings.wizard.name': '设置向导',
  'settings.wizard.desc': '重新运行首次启动向导 — 文件夹、名称、预算周期、货币、初始文件。',
  'settings.wizard.button': '运行设置向导',

  'settings.startup.name': '启动时打开',
  'settings.startup.desc': 'Obsidian 启动时自动打开预算视图。',

  'settings.privacy.name': '隐私启动屏',
  'settings.privacy.desc': '在你点击「进入预算」之前用启动屏遮住预算 — 打开时如此，Obsidian 每次切到后台后也是如此。在你点击之前不会从仓库读取任何内容。',

  'settings.feedback.name': '发送反馈',
  'settings.feedback.desc': '报告缺陷、反映问题或提出功能建议。会在浏览器中打开一个 Google 表单 — 不会附带或发送你预算中的任何内容。',
  'settings.feedback.button': '打开反馈表单',

  'settings.support.name': '支持 Budget Vault',
  'settings.support.desc': 'Budget Vault 是免费的，并且会一直免费。如果你想表达谢意，这会在浏览器中打开 PayPal — 完全自愿，无论如何插件都不会有任何变化。',
  'settings.support.button': '送上一份谢意',

  'settings.data.name': '预算数据',
  'settings.data.desc': '保存在预算文件夹内的 Settings.md 中，因此在每台设备上都生效。',

  'settings.household.name': '名称 / 家庭',
  'settings.household.desc': '显示在仪表板的问候语和顶部栏中。留空则不显示。',
  'settings.household.placeholder': '留空则不显示',

  'settings.monthStart.name': '每月起始日',
  'settings.monthStart.desc': '每个财务周期开始的日期 — 通常是你的发薪日。选择 1 表示普通的自然月。1–28。',
  'settings.monthStart.invalid': '请选择 1 到 28 之间的某一天。',

  'settings.periodLength.name': '周期长度',
  'settings.periodLength.desc': '每个预算周期的长度。「每月」使用上面的每月起始日。其他选项则从下面的日期开始计算，把周期与发薪周期对齐。',

  'settings.anchor.name': '上次发薪日',
  'settings.anchor.desc': '你上一次领薪是什么时候？任何近期的发薪日都可以 — 只有它落在周期中的哪一天才有影响，因此早一些或晚一些结果相同。当周期长度为每月时会被忽略。',
  'settings.anchor.invalid': '请使用真实日期，格式为 YYYY-MM-DD，例如 2026-08-07。',

  'settings.country.name': '国家/地区',
  'settings.country.desc': '决定金额格式、银行对账单的日期顺序，以及税务视图的清单（针对你所在国家/地区的税务机关）。已有的纳税年度会保留其数据 — 只有标签和新年度的初始值会变化。与下面的界面语言相互独立。',

  'settings.language.name': '语言',
  'settings.language.desc': '界面所使用的语言。与上面的国家/地区相互独立 — 住在哪里并不决定你想读什么。默认跟随 Obsidian 自身的显示语言，没有对应语言时回退到英语。你自己写的预算内容 — 分类名称、备注、账户名称 — 永远不会被翻译。',

  'settings.currency.name': '货币符号',
  'settings.currency.desc': '显示在每个金额之前，例如 R。',
  'settings.currency.invalid': '请输入货币符号。',

  /* ------------------------- settings notices ------------------------------ */
  /* One form only — see the header. */
  'settings.budgetsKept': {
    other: '预算：你现有的 {count} 个预算文件仍保留在仓库中。它们无法在当前的周期长度下显示，但只要改回原来的设置就会立即恢复。',
  },
  'settings.anchorReslices': {
    other: '预算：这会移动每一个周期的边界。以日期命名的 {count} 个预算文件将不再匹配 — 它们仍保留在你的仓库中，把这个日期改回 {prev} 就会立即恢复。',
  },
  'settings.dateNotReal': '预算：「{value}」不是日期 — 请使用日期选择器，或输入 YYYY-MM-DD。',

  /* ============================ setup wizard ============================== */
  'wiz.title': '设置 Budget Vault',
  'wiz.stepOf': '第 {n} 步，共 {total} 步',
  'wiz.cancel': '取消',
  'wiz.back': '上一步',
  'wiz.next': '下一步',
  'wiz.letsGo': '开始吧！',
  'wiz.connectBtn': '连接预算',
  'wiz.createBtn': '创建我的预算',
  'wiz.skipped': '已跳过设置 — 你可以随时从「设置 → Budget Vault → 运行设置向导」或命令面板重新运行。',

  'wiz.step.folder': '预算存放的位置',
  'wiz.step.name': '我们怎么称呼你？',
  'wiz.step.country': '语言、国家/地区与货币',
  'wiz.step.period': '你的预算周期',
  'wiz.step.categories': '你的预算分类',
  'wiz.step.account': '你的第一个账户',
  'wiz.step.finish': '准备就绪',

  'wiz.err.folder': '请输入预算的文件夹路径 — 例如 Finances/Budget。',
  'wiz.err.monthStart': '每月起始日必须在 1 到 28 之间。并非每个月都有 29、30 或 31 日，因此如果你在月末发薪，请使用 28。',
  'wiz.err.anchor': '请输入你上次领薪的日期 — 每个发薪周期都从这里开始计算，缺少它预算就会退回到按月周期。',
  'wiz.err.currency': '请输入货币符号，或从上面的列表中选择一个。',

  /* ---- welcome ---- */
  'wiz.welcome.title': '欢迎使用 Budget Vault！',
  'wiz.welcome.intro': '你的整份预算，就以纯 markdown 的形式存放在这个仓库里 — 无需账号、不上云、也不经过别人的服务器。如果你的仓库会同步到手机，预算也会一并带上。',
  'wiz.welcome.planLead': '计划是这样的 — 这个向导会帮你准备好:',
  'wiz.welcome.plan1': '选择预算文件夹 — 整个结构由我们为你搭建',
  'wiz.welcome.plan2': '选择语言、国家/地区与货币 — 让界面读起来顺畅，金额、日期和税务也都正确',
  'wiz.welcome.plan3': '告诉我们你的发薪时间 — 如果你愿意，预算周期可以从发薪日开始',
  'wiz.welcome.plan4': '选择预算分类 — 勾选适合你生活的那些',
  'wiz.welcome.plan5': '添加第一个账户 — 以及它当前的余额',
  'wiz.welcome.thenLead': '接下来就是应用里有意思的部分了:',
  'wiz.welcome.app1': '设定预算 — 给每个分类一个努力的目标金额',
  'wiz.welcome.app2': '导入银行 CSV — 你教得越多，交易就越会自动归类',
  'wiz.welcome.app3': '随时添加新分类 — 预算会跟着你一起成长',
  'wiz.welcome.app4': '边走边回顾 — 仪表板会清楚地显示钱花到哪里去了',
  'wiz.welcome.close': '大约两分钟即可设置完成。之后随时都能修改。准备好了吗？',

  /* ---- folder ---- */
  'wiz.folder.hint': '所有内容都以纯 markdown 文件的形式存放在仓库的一个文件夹里。',
  'wiz.folder.blank': '请输入文件夹路径 — 例如 Finances/Budget。',
  'wiz.folder.found': '在「{folder}」中找到了已有的预算 — 向导会连接到它，而不是创建新文件。',
  'wiz.folder.exists': '「{folder}」已存在 — 预算文件将添加到其中。',
  'wiz.folder.willCreate': '「{folder}」尚不存在 — 我们会为你创建。',
  'wiz.folder.name': '预算文件夹',
  'wiz.folder.desc': '存放分类、账户、预算和交易的位置。',
  'wiz.folder.connected': '在「{folder}」中找到了已有的预算 — 我们会连接到它，而不是创建新文件。你的分类、账户和交易都会原样保留；接下来的步骤只是确认其 Settings.md 中保存的设置。',

  /* ---- name ---- */
  'wiz.name.name': '你的名字或昵称',
  'wiz.name.desc': '显示在仪表板的问候语和顶部栏中。留空即可跳过。',
  'wiz.name.placeholder': '例如：小明，或者「张家」',

  /* ---- language / country / currency ---- */
  'wiz.language.desc': '应用界面使用的语言。与下面的国家/地区相互独立 — 住在哪里并不决定你想读什么。你自己写的预算内容永远不会被翻译。',
  'wiz.country.desc': '决定金额格式、读取银行对账单时的日期顺序，以及税务视图中针对你所在国家/地区税务机关的申报清单。',
  'wiz.currency.desc': '显示在每个金额之前。默认取自你的国家/地区 — 如果你用其他货币记账，请自行更改。',
  'wiz.currency.custom': '自定义符号',
  'wiz.currency.customPlaceholder': '例如：CHF',

  /* Currency NAMES for the wizard dropdown; the stored value is the symbol. */
  'wiz.ccy.rand': 'R — 南非兰特',
  'wiz.ccy.dollar': '$ — 美元',
  'wiz.ccy.euro': '€ — 欧元',
  'wiz.ccy.pound': '£ — 英镑',
  'wiz.ccy.other': '其他…',

  /* ---- period ---- */
  'wiz.period.howOften': '你多久领一次薪？',
  'wiz.period.howOftenDesc': '按月的周期以月份命名，并从你在下面选择的日期开始。其他选项则从上次发薪日算起，与发薪周期对齐。',
  'wiz.period.startDay': '你的预算月从哪一天开始？',
  'wiz.period.startDayDesc': '通常是你的发薪日。选择 1 表示普通的自然月。(1–28)',
  'wiz.period.badDay': '请选择 1 到 28 之间的某一天。并非每个月都有 29、30 或 31 日，因此如果你在月末发薪，请使用 28。',
  'wiz.period.calendarEg': '普通的自然月：每个周期从 {first} 到月末，并以该月份命名。你现在处于 {month}。',
  'wiz.period.paydayEg': '每个周期从 {start} 到次月 {end}，并以结束所在的月份命名。你现在处于 {month}。',
  'wiz.period.anchorBlank': '输入你上次领薪的日期，周期就会据此推算出来。',
  'wiz.period.anchorEg': '从那天算起，你当前所处的周期开始于 {date}。预算文件会以该起始日期命名。',
  'wiz.period.anchorName': '你上一次领薪是什么时候？',
  'wiz.period.anchorDesc': '任何近期的发薪日都可以 — 只有它落在周期中的位置才有影响，因此早一些或晚一些得到的周期相同。',

  /* ---- categories ---- */
  'wiz.cats.intro': '先从一组预算分类开始 — 不需要的可以取消勾选。之后还能添加、重命名或改颜色，所以这里没有什么是定死的。',
  'wiz.cats.selected': '已选择 {count} / {total}',
  'wiz.cats.selectAll': '全选',
  'wiz.cats.selectNone': '全不选',

  'wiz.type.income': '收入',
  'wiz.type.expense': '日常开支',
  'wiz.type.debt': '偿还债务',
  'wiz.type.services': '服务与订阅',
  'wiz.type.insurance': '保险',
  'wiz.type.giving': '捐赠',
  'wiz.type.savings': '储蓄',
  'wiz.type.investment': '投资',
  'wiz.type.luxuries': '锦上添花',
  'wiz.type.transfer': '转账',

  /* ---- first account ---- */
  'wiz.acct.intro': '交易按账户分别存放。现在添加你的主要账户，或把名称留空以跳过 — 你随时都可以添加账户。',
  'wiz.acct.name': '账户名称',
  'wiz.acct.namePlaceholder': '例如：活期账户',
  'wiz.acct.type': '类型',
  'wiz.acct.balance': '当前余额',
  'wiz.acct.balanceDesc': '可选 — 该账户当前的金额。',
  'wiz.acct.balanceHint': '可以使用最近一期对账单的期末余额，或银行 App 上显示的金额。余额是一份由你自己保持更新的快照 — 只导入最近的交易并不会让它出错 — 你随时可以在账户页面点击余额来修改它。',

  'wiz.acctType.checking': '活期/支票账户',
  'wiz.acctType.savings': '储蓄账户',
  'wiz.acctType.credit_card': '信用卡',
  'wiz.acctType.cash': '现金',
  'wiz.acctType.investment': '投资',

  /* ---- finish ---- */
  'wiz.sum.folder': '文件夹',
  'wiz.sum.name': '名称',
  'wiz.sum.language': '语言',
  'wiz.sum.country': '国家/地区',
  'wiz.sum.period': '预算周期',
  'wiz.sum.currency': '货币',
  'wiz.sum.categories': '分类',
  'wiz.sum.account': '第一个账户',
  'wiz.sum.opening': '期初余额',
  'wiz.sum.catCount': {
    other: '{count} 个初始分类',
  },
  'wiz.sum.monthlyCalendar': '按月（自然月）',
  'wiz.sum.monthlyOn': '按月，从 {day} 开始',
  'wiz.sum.cycleFrom': '{preset}，自 {date} 起算',
  'wiz.finish.connectLead': '将连接到已有的预算文件夹，并把这些设置保存到它的 Settings.md 中:',
  'wiz.finish.createLead': '这会创建预算文件夹，并生成 Settings.md、你的分类、第一个预算文件，以及空的 Owed Money / Services 文件:',
  'wiz.finish.nextLead': '接下来该做什么: ',
  'wiz.finish.nextBody': '先在预算页面为各个分类填上金额，然后在交易页面导入银行的 CSV。',
  'wiz.finish.privacy': '你的预算会在一个需要点击进入的隐私屏后面打开，这样别人瞥一眼你的仓库也看不到任何内容。可在「设置 → Budget Vault → 隐私启动屏」中关闭。',

  'wiz.done.connected': '已连接到你的预算文件夹。',
  'wiz.done.created': '预算文件夹已创建 — 欢迎！',
  'wiz.failed': '设置失败: {error}',
};
