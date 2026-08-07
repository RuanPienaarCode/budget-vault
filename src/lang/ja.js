'use strict';
/* 日本語 (Japanese).

   Checked against src/lang/en.js at build time — same key set, no more, no
   fewer. Add a string to en.js first, then translate it here.

   Conventions used throughout:
     - "Budget Vault" is the product name and stays untranslated. 保管庫 is the
       vault, matching Obsidian's own Japanese locale.
     - Polite ですます form throughout — the register Japanese software uses.
     - Japanese has ONE noun form: a count never changes the wording. So plural
       entries carry only `other`, and i18n.js never asks this language for
       `one` (see ONE_FORM). Writing a 1-vs-many split here would produce text a
       native reader finds wrong, not merely clumsy.
     - Counters matter: files are 件 here rather than a bare number.
     - YYYY-MM-DD is left as-is; it is the form Japanese interfaces show for an
       ISO date, unlike the localised JJJJ-MM-TT of German. */

module.exports = {
  /* ------------------------------- splash -------------------------------- */
  'splash.sub': 'あなただけの予算を、保管庫の中に安全に保管します。',
  'splash.enter': '予算を開く',

  /* -------------------------------- drawer -------------------------------- */
  'nav.menu': 'メニュー',
  'nav.close': 'メニューを閉じる',
  'nav.section.budget': '予算',
  'nav.section.accounts': '口座',
  'nav.section.tools': 'ツール',

  'nav.dashboard': 'ダッシュボード',
  'nav.transactions': '取引',
  'nav.budgets': '予算',
  'nav.savings': '貯蓄と投資',
  'nav.accounts': '口座',
  'nav.assets': '資産',
  'nav.debts': '負債',
  'nav.owed': '貸したお金',
  'nav.services': 'サービス',
  'nav.tax': '税金',
  'nav.loans': 'ローン計算機',
  'nav.import': 'CSV を取り込む',
  'nav.reload': 'ディスクから再読み込み',
  'nav.pluginSettings': 'プラグイン設定',

  /* -------------------------------- topbar -------------------------------- */
  'topbar.nav': '予算ナビゲーション',
  'topbar.mainMenu': 'メインメニュー',
  'topbar.openMenu': 'ナビゲーションメニューを開く',
  'topbar.home': 'ダッシュボードへ移動',
  'topbar.brandSub': 'Obsidian 保管庫の予算',
  'topbar.periodNav': '期間ナビゲーション',
  'topbar.prevPeriod': '前の期間',
  'topbar.currentPeriod': '現在の期間へ移動',
  'topbar.nextPeriod': '次の期間',
  'topbar.import': 'CSV を取り込む',
  'topbar.importTitle': '銀行明細の CSV を取り込む',
  'topbar.settings': '予算の設定を開く',

  /* ------------------------------- settings -------------------------------- */
  'settings.folder.name': '予算フォルダ',
  'settings.folder.desc': 'Categories/、Accounts/、Budgets/、Transactions/、Settings.md などを格納しているフォルダの保管庫内パス。',

  'settings.theme.name': 'テーマ',
  'settings.theme.desc': 'Obsidian のライト/ダークモードに従うか、Airy Glass のダークまたはライトのパレットを固定します。',
  'settings.theme.auto': 'Obsidian に従う',
  'settings.theme.dark': '常にダーク',
  'settings.theme.light': '常にライト',

  'settings.palette.name': 'カラーパレット',
  'settings.palette.desc': '予算を描画する色。各パレットはライト版とダーク版の両方を持つため、上のテーマ設定とは独立しています。',

  'settings.wizard.name': 'セットアップウィザード',
  'settings.wizard.desc': '初回起動時のウィザードをもう一度実行します — フォルダ、名前、予算期間、通貨、初期ファイル。',
  'settings.wizard.button': 'セットアップウィザードを実行',

  'settings.startup.name': '起動時に開く',
  'settings.startup.desc': 'Obsidian の起動時に予算ビューを自動的に開きます。',

  'settings.privacy.name': 'プライバシー画面',
  'settings.privacy.desc': '「予算を開く」をタップするまで予算を覆い隠します — 開いたとき、および Obsidian がバックグラウンドに移るたびに表示されます。タップするまで保管庫からは何も読み込まれません。',

  'settings.feedback.name': 'フィードバックを送る',
  'settings.feedback.desc': '不具合の報告、問題の指摘、機能の要望。ブラウザで Google フォームを開きます — 予算の内容が添付されたり送信されたりすることはありません。',
  'settings.feedback.button': 'フィードバックフォームを開く',

  'settings.support.name': 'Budget Vault を支援する',
  'settings.support.desc': 'Budget Vault は無料で、これからもずっと無料です。お礼を伝えたい場合は、ブラウザで PayPal を開きます — 完全に任意で、どちらの場合もプラグインの動作は変わりません。',
  'settings.support.button': 'お礼を送る',

  'settings.data.name': '予算データ',
  'settings.data.desc': '予算フォルダ内の Settings.md に保存され、すべてのデバイスに適用されます。',

  'settings.household.name': '名前 / 世帯',
  'settings.household.desc': 'ダッシュボードの挨拶と上部バーに表示されます。不要な場合は空欄にしてください。',
  'settings.household.placeholder': '不要な場合は空欄に',

  'settings.monthStart.name': '月の開始日',
  'settings.monthStart.desc': '各会計期間が始まる日 — 通常は給料日です。通常の暦月にする場合は 1 を選びます。1〜28。',
  'settings.monthStart.invalid': '1 から 28 の間の日を選んでください。',

  'settings.periodLength.name': '期間の長さ',
  'settings.periodLength.desc': '各予算期間の長さ。「毎月」は上の月の開始日を使います。その他の選択肢では、下の日付から数えて給与サイクルに合わせて期間を区切ります。',

  'settings.anchor.name': '最後の給料日',
  'settings.anchor.desc': '最後に給与を受け取ったのはいつですか。最近の給料日であればどれでも構いません — サイクル内のどの日に当たるかだけが重要なので、それより前でも後でも同じ結果になります。期間の長さが毎月の場合は無視されます。',
  'settings.anchor.invalid': 'YYYY-MM-DD 形式の実在する日付を入力してください（例: 2026-08-07）。',

  'settings.country.name': '国',
  'settings.country.desc': '金額の表示形式、銀行明細の日付順、税金ビューのチェックリスト（お住まいの国の税務当局に合わせたもの）を決めます。既存の税年度のデータはそのまま残り、変わるのはラベルと新しい年度の初期値だけです。下のインターフェース言語とは独立しています。',

  'settings.language.name': '言語',
  'settings.language.desc': 'インターフェースを表示する言語。上の「国」とは独立しています — どこに住んでいるかが、何を読みたいかを決めるわけではありません。既定では Obsidian の表示言語に従い、対応がなければ英語になります。カテゴリ名、メモ、口座名など、あなた自身が書いた予算のテキストが翻訳されることはありません。',

  'settings.currency.name': '通貨記号',
  'settings.currency.desc': 'すべての金額の前に表示されます（例: R）。',
  'settings.currency.invalid': '通貨記号を入力してください。',

  /* ------------------------- settings notices ------------------------------ */
  /* One form only — see the header. */
  'settings.budgetsKept': {
    other: '予算: 既存の予算ファイル {count} 件は保管庫に残ります。この期間の長さでは表示できませんが、設定を元に戻せばすぐに再び表示されます。',
  },
  'settings.anchorReslices': {
    other: '予算: これによりすべての期間の区切りがずれます。日付で名付けられた予算ファイル {count} 件が一致しなくなります — ファイルは保管庫に残り、この日付を {prev} に戻せばすぐに元どおりになります。',
  },
  'settings.dateNotReal': '予算: 「{value}」は日付ではありません — 日付選択を使うか、YYYY-MM-DD 形式で入力してください。',

  /* ============================ setup wizard ============================== */
  'wiz.title': 'Budget Vault をセットアップ',
  'wiz.stepOf': 'ステップ {n} / {total}',
  'wiz.cancel': 'キャンセル',
  'wiz.back': '戻る',
  'wiz.next': '次へ',
  'wiz.letsGo': 'はじめる',
  'wiz.connectBtn': '予算に接続',
  'wiz.createBtn': '予算を作成',
  'wiz.skipped': 'セットアップをスキップしました — 設定 → Budget Vault → セットアップウィザードを実行、またはコマンドパレットからいつでも実行できます。',

  'wiz.step.folder': '予算を置く場所',
  'wiz.step.name': 'お名前は？',
  'wiz.step.country': '言語・国・通貨',
  'wiz.step.period': '予算期間',
  'wiz.step.categories': '予算のカテゴリ',
  'wiz.step.account': '最初の口座',
  'wiz.step.finish': '準備完了',

  'wiz.err.folder': '予算のフォルダパスを入力してください — 例: Finances/Budget。',
  'wiz.err.monthStart': '月の開始日は 1 から 28 の間で指定してください。29 日、30 日、31 日がない月もあるため、月末に給与を受け取る場合は 28 を使ってください。',
  'wiz.err.anchor': '最後に給与を受け取った日付を入力してください — 給与サイクルはそこから数えるため、入力がないと予算は毎月の期間に戻ります。',
  'wiz.err.currency': '通貨記号を入力するか、上のリストから選んでください。',

  /* ---- welcome ---- */
  'wiz.welcome.title': 'Budget Vault へようこそ',
  'wiz.welcome.intro': '予算のすべてが、ただのマークダウンとしてこの保管庫の中に置かれます — アカウントもクラウドも、誰か他人のサーバーも不要です。保管庫がスマートフォンと同期していれば、予算もそのまま一緒に持ち歩けます。',
  'wiz.welcome.planLead': '流れはこうです — このウィザードで準備が整います:',
  'wiz.welcome.plan1': '予算フォルダを選ぶ — 構成一式はこちらで用意します',
  'wiz.welcome.plan2': '言語・国・通貨を選ぶ — 表示が読みやすくなり、金額・日付・税金の扱いも正しくなります',
  'wiz.welcome.plan3': '給料日を教える — お望みなら予算期間を給料日始まりにできます',
  'wiz.welcome.plan4': '予算のカテゴリを選ぶ — 自分の生活に合うものにチェックを入れてください',
  'wiz.welcome.plan5': '最初の口座を追加する — 今の残高もあわせて',
  'wiz.welcome.thenLead': 'そのあとはアプリでの楽しい部分です:',
  'wiz.welcome.app1': '予算を決める — カテゴリごとに目標額を入れます',
  'wiz.welcome.app2': '銀行の CSV を取り込む — 使いながら教えるほど、取引が自動で仕分けされます',
  'wiz.welcome.app3': 'いつでもカテゴリを追加できます — 予算はあなたに合わせて育ちます',
  'wiz.welcome.app4': '折にふれて振り返る — ダッシュボードがお金の行き先をそのまま示します',
  'wiz.welcome.close': 'セットアップは 2 分ほどです。あとからいつでも変更できます。よろしいですか。',

  /* ---- folder ---- */
  'wiz.folder.hint': 'すべては保管庫内の 1 つのフォルダに、ただのマークダウンファイルとして置かれます。',
  'wiz.folder.blank': 'フォルダパスを入力してください — 例: Finances/Budget。',
  'wiz.folder.found': '「{folder}」に既存の予算が見つかりました — 新しくファイルを作らず、そちらに接続します。',
  'wiz.folder.exists': '「{folder}」はすでに存在します — 予算ファイルはその中に追加されます。',
  'wiz.folder.willCreate': '「{folder}」はまだ存在しません — こちらで作成します。',
  'wiz.folder.name': '予算フォルダ',
  'wiz.folder.desc': 'カテゴリ、口座、予算、取引を保管する場所です。',
  'wiz.folder.connected': '「{folder}」に既存の予算が見つかりました — 新しくファイルを作らず、そちらに接続します。カテゴリ、口座、取引はそのまま残ります。残りのステップでは、その Settings.md に保存されている設定を確認するだけです。',

  /* ---- name ---- */
  'wiz.name.name': 'お名前またはニックネーム',
  'wiz.name.desc': 'ダッシュボードの挨拶と上部バーに表示されます。空欄のままにすればスキップできます。',
  'wiz.name.placeholder': '例: アレックス、田中家',

  /* ---- language / country / currency ---- */
  'wiz.language.desc': 'アプリを表示する言語です。下の「国」とは独立しています — どこに住んでいるかが、何を読みたいかを決めるわけではありません。あなた自身が書いた予算のテキストが翻訳されることはありません。',
  'wiz.country.desc': '金額の表示形式、銀行明細を読むときの日付順、そしてお住まいの国の税務当局に合わせた税金ビューの申告チェックリストを決めます。',
  'wiz.currency.desc': 'すべての金額の前に表示されます。国に応じた既定値から始まります — 別の通貨で予算を組む場合は変更してください。',
  'wiz.currency.custom': 'カスタム記号',
  'wiz.currency.customPlaceholder': '例: CHF',

  /* Currency NAMES for the wizard dropdown; the stored value is the symbol. */
  'wiz.ccy.rand': 'R — 南アフリカランド',
  'wiz.ccy.dollar': '$ — ドル',
  'wiz.ccy.euro': '€ — ユーロ',
  'wiz.ccy.pound': '£ — ポンド',
  'wiz.ccy.other': 'その他…',

  /* ---- period ---- */
  'wiz.period.howOften': '給与の頻度は？',
  'wiz.period.howOftenDesc': '毎月の期間は月名で呼ばれ、下で選んだ日から始まります。その他は、最後の給料日から数えて給与サイクルに合わせます。',
  'wiz.period.startDay': '予算上の月は何日から始まりますか？',
  'wiz.period.startDayDesc': '通常は給料日です。普通の暦月にする場合は 1 を選びます。(1〜28)',
  'wiz.period.badDay': '1 から 28 の間で日を選んでください。29 日、30 日、31 日がない月もあるため、月末に給与を受け取る場合は 28 を使ってください。',
  'wiz.period.calendarEg': '普通の暦月です: 各期間は{first}から月末までで、その月の名前が付きます。現在は {month} です。',
  'wiz.period.paydayEg': '各期間は{start}から翌月の{end}までで、終わる月の名前が付きます。現在は {month} です。',
  'wiz.period.anchorBlank': '最後に給与を受け取った日付を入力すると、そこから期間が計算されます。',
  'wiz.period.anchorEg': 'そこから数えると、現在の期間は {date} に始まりました。予算ファイルはその開始日で名前が付きます。',
  'wiz.period.anchorName': '最後に給与を受け取ったのはいつですか？',
  'wiz.period.anchorDesc': '最近の給料日ならどれでも構いません — サイクル内のどこに当たるかだけが重要なので、それより前でも後でも同じ期間になります。',

  /* ---- categories ---- */
  'wiz.cats.intro': 'まずは予算カテゴリの一式から始めます — 不要なものはチェックを外してください。あとから追加・名前の変更・色の変更ができるので、ここで決めたことは最終ではありません。',
  'wiz.cats.selected': '{total} 件中 {count} 件を選択',
  'wiz.cats.selectAll': 'すべて選択',
  'wiz.cats.selectNone': '選択を解除',

  'wiz.type.income': '収入',
  'wiz.type.expense': '日常の支出',
  'wiz.type.debt': '借入の返済',
  'wiz.type.services': 'サービスとサブスクリプション',
  'wiz.type.insurance': '保険',
  'wiz.type.giving': '寄付',
  'wiz.type.savings': '貯蓄',
  'wiz.type.investment': '投資',
  'wiz.type.luxuries': 'あると嬉しいもの',
  'wiz.type.transfer': '振替',

  /* ---- first account ---- */
  'wiz.acct.intro': '取引は口座ごとに保存されます。主に使う口座を今追加するか、名前を空欄のままにしてスキップしてください — 口座はいつでも追加できます。',
  'wiz.acct.name': '口座名',
  'wiz.acct.namePlaceholder': '例: 普通預金口座',
  'wiz.acct.type': '種類',
  'wiz.acct.balance': '現在の残高',
  'wiz.acct.balanceDesc': '任意 — 現在その口座にある金額です。',
  'wiz.acct.balanceHint': '直近の明細の期末残高か、銀行アプリに表示されている金額を使ってください。残高はご自身で最新に保つスナップショットです — 最近の取引だけを取り込んでもずれることはありません — 口座ページで残高をタップすればいつでも変更できます。',

  'acctType.checking': '普通預金・当座預金口座',
  'acctType.savings': '貯蓄口座',
  'acctType.credit_card': 'クレジットカード',
  'acctType.cash': '現金',
  'acctType.investment': '投資',
  'acctType.other': 'その他',

  /* ---- finish ---- */
  'wiz.sum.folder': 'フォルダ',
  'wiz.sum.name': '名前',
  'wiz.sum.language': '言語',
  'wiz.sum.country': '国',
  'wiz.sum.period': '予算期間',
  'wiz.sum.currency': '通貨',
  'wiz.sum.categories': 'カテゴリ',
  'wiz.sum.account': '最初の口座',
  'wiz.sum.opening': '開始残高',
  'wiz.sum.catCount': {
    other: '初期カテゴリ {count} 件',
  },
  'wiz.sum.monthlyCalendar': '毎月（暦月）',
  'wiz.sum.monthlyOn': '毎月、{day}から開始',
  'wiz.sum.cycleFrom': '{preset}、{date} から起算',
  'wiz.finish.connectLead': '既存の予算フォルダに接続し、以下の設定をその Settings.md に保存します:',
  'wiz.finish.createLead': '予算フォルダを作成し、Settings.md、カテゴリ、最初の予算ファイル、空の Owed Money / Services ファイルを用意します:',
  'wiz.finish.nextLead': '次にすること: ',
  'wiz.finish.nextBody': '予算ページでカテゴリに金額を設定し、取引ページで銀行の CSV を取り込んでください。',
  'wiz.finish.privacy': '予算はタップして入るプライバシー画面の後ろで開くので、誰かが保管庫をちらりと見ても中身は表示されません。設定 → Budget Vault → プライバシー画面 でオフにできます。',

  'wiz.done.connected': '予算フォルダに接続しました。',
  'wiz.done.created': '予算フォルダを作成しました — ようこそ！',
  'wiz.failed': 'セットアップに失敗しました: {error}',

  /* ============================== Budget page ============================= */
  'bud.shape.title': '他の予算はそのまま残っています',
  'bud.shape.body': {
    other: '別の期間の長さで保存された予算ファイルが {count} 件あります — 最新のものは Budgets/{newest}.md です。保管庫にはそのまま残っており、期間の長さを元に戻せばまた表示されます。この期間はそれらとは長さが違うため、金額は空の状態から始まります。',
  },
  'bud.shape.bring': '{newest} からカテゴリとメモを引き継ぐ',
  'bud.shape.empty': 'その予算は空です',
  'bud.shape.brought': {
    other: 'カテゴリを {count} 件引き継ぎました — この期間の金額を設定してください',
  },
  'bud.shape.allHere': 'その予算のカテゴリはすべてすでにここにあります',

  'bud.total.income': '収入合計',
  'bud.total.incomeNote': 'これまでに {amount} を受け取りました',
  'bud.total.budgeted': '予算合計',
  'bud.total.budgetedNote': '予算収入の {pct}%',
  'bud.total.over': '予算超過',
  'bud.total.overNote': '収入を超えて予算を組んでいます',
  'bud.total.left': '未配分',
  'bud.total.leftNote': 'まだ配分していない収入',
  'bud.total.spent': '支出合計',
  'bud.total.spentNote': '予算の {pct}% を使用',

  'bud.col.category': 'カテゴリ',
  'bud.col.type': '種類',
  'bud.col.amount': '金額',
  'bud.col.actual': '実績',
  'bud.col.notes': 'メモ',

  'bud.remaining.over': '{amount} 超過',
  'bud.remaining.left': '残り {amount}',

  'bud.aria.amount': '{category} の予算額',
  'bud.aria.notes': '{category} のメモ',
  'bud.aria.clear': '{category} の予算を消去',
  'bud.title.clear': 'この期間のファイルからこのカテゴリを外す',
  'bud.aria.delete': 'カテゴリ {category} を削除',
  'bud.title.delete': 'このカテゴリをすべての場所から削除',

  'bud.saved': '予算を Budgets/{period}.md に保存しました',
  'bud.copy.none': '前の期間の予算が見つかりません',
  'bud.copy.done': {
    other: '前の期間から {count} 件のカテゴリをコピーしました',
  },
  'bud.copy.nothing': 'コピーするものがありません — すべてのカテゴリにすでに値があります',


  /* =========================== Transactions page ========================== */
  'tx.wholeHistory': '全期間',
  'tx.allAccounts': 'すべての口座',
  'tx.allCategories': 'すべてのカテゴリ',
  'tx.uncategorised': 'カテゴリなし',
  'tx.count.window': '{total} 行中 {shown} 行',
  'tx.count.all': { other: '{count} 行' },

  'tx.col.date': '日付',
  'tx.col.desc': '摘要',
  'tx.col.account': '口座',
  'tx.col.category': 'カテゴリ',
  'tx.col.amount': '金額',
  'tx.col.excl': '除外',
  'tx.col.note': 'メモ',
  'tx.col.split': '分割',

  'tx.aria.category': '{date} {desc} のカテゴリ',
  'tx.aria.exclude': '{desc} を予算の合計から除外',
  'tx.aria.note': '{date} {desc} のメモ',
  'tx.aria.split': '{date} {desc} をカテゴリに分割',
  'tx.title.split': 'カテゴリに分割',

  'tx.none': '該当する取引はありません。',
  'tx.showMore': '残り {remaining} 件のうち {n} 件を表示',

  'tx.split.zero': '金額が 0 の行には分割するものがありません',
  'tx.split.excluded': 'この行はすでに除外されています — まずチェックを外してください',
  'tx.split.marker': '{n} 件に分割',
  'tx.split.done': '{n} 件に分割しました — 確認してから変更を保存してください',

  'tx.add.noAccount': '先に口座を追加してください — 取引は必ずいずれかの口座に属します',
  'tx.add.title': '取引を追加',
  'tx.field.date': '日付',
  'tx.field.desc': '摘要',
  'tx.field.descPlaceholder': '例: 現金 — 市場で野菜',
  'tx.field.account': '口座',
  'tx.field.direction': '入出金',
  'tx.dir.out': '出金',
  'tx.dir.in': '入金',
  'tx.field.amount': '金額',
  'tx.field.amountDesc': '常に正の数で — 符号は入出金の向きで決まります',
  'tx.field.category': 'カテゴリ',
  'tx.field.none': '— なし —',
  'tx.field.note': 'メモ',
  'tx.field.notePlaceholder': '任意',

  'tx.err.date': '日付は YYYY-MM-DD 形式で入力してください',
  'tx.err.desc': '摘要は必須です',
  'tx.err.account': '口座名が正しくありません',
  'tx.err.amount': '金額は 0 以外の数値にしてください',
  'tx.err.save': '取引を保存できませんでした（{error}）',

  'tx.saved': { other: '{count} 件のファイルを保存しました' },
  'tx.savedLearned': { other: ' · 新しいルールを {count} 件学習しました' },

  'tx.export.dirty': '先に変更を保存してください — 未保存の編集を書き出すと保管庫の内容と一致しません',
  'tx.export.empty': '書き出すものがありません — 現在の絞り込みに該当する行がありません',
  'tx.export.title': '取引を書き出す',
  'tx.export.folder': '保存先フォルダ',
  'tx.export.desc': {
    other: '書き出し先の保管庫内フォルダ。{count} 行（{range}）とカテゴリ {cats} 件を、CSV とマークダウンで書き出します。',
  },
  'tx.export.failed': '書き出しに失敗しました — フォルダ名を確認してください',
  'tx.export.done': {
    other: '{count} 行とカテゴリ {cats} 件を {path}/ に書き出しました',
  },

};
