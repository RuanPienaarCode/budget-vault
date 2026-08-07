'use strict';
/* Deutsch.

   Checked against src/lang/en.js at build time — same key set, no more, no
   fewer. Add a string to en.js first, then translate it here.

   Conventions used throughout:
     - "Budget Vault" is the product name and stays untranslated. "Vault" alone
       is Obsidian's own German term for the folder and stays as well.
     - Informal "du", matching Obsidian's German locale and this plugin's
       conversational English — not the "Sie" of business software.
     - German takes the plural at 0, same as English, so plural entries use the
       ordinary one/other split.
     - Date placeholders are localised: JJJJ-MM-TT, not YYYY-MM-DD. */

module.exports = {
  /* ------------------------------- splash -------------------------------- */
  'splash.sub': 'Dein privates Budget, sicher in deinem Vault aufbewahrt.',
  'splash.enter': 'Budget öffnen',

  /* -------------------------------- drawer -------------------------------- */
  'nav.menu': 'Menü',
  'nav.close': 'Menü schließen',
  'nav.section.budget': 'Budget',
  'nav.section.accounts': 'Konten',
  'nav.section.tools': 'Werkzeuge',

  'nav.dashboard': 'Übersicht',
  'nav.transactions': 'Transaktionen',
  'nav.budgets': 'Budget',
  'nav.savings': 'Sparen und Anlagen',
  'nav.accounts': 'Konten',
  'nav.assets': 'Vermögenswerte',
  'nav.debts': 'Schulden',
  'nav.owed': 'Ausstehende Beträge',
  'nav.services': 'Dienste',
  'nav.tax': 'Steuern',
  'nav.loans': 'Kreditrechner',
  'nav.import': 'CSV importieren',
  'nav.reload': 'Vom Datenträger neu laden',
  'nav.pluginSettings': 'Plugin-Einstellungen',

  /* -------------------------------- topbar -------------------------------- */
  'topbar.nav': 'Budget-Navigation',
  'topbar.mainMenu': 'Hauptmenü',
  'topbar.openMenu': 'Navigationsmenü öffnen',
  'topbar.home': 'Zur Übersicht',
  'topbar.brandSub': 'Budget im Obsidian-Vault',
  'topbar.periodNav': 'Zeitraum-Navigation',
  'topbar.prevPeriod': 'Vorheriger Zeitraum',
  'topbar.currentPeriod': 'Zum aktuellen Zeitraum springen',
  'topbar.nextPeriod': 'Nächster Zeitraum',
  'topbar.import': 'CSV importieren',
  'topbar.importTitle': 'Einen Kontoauszug als CSV importieren',
  'topbar.settings': 'Budget-Einstellungen öffnen',

  /* ------------------------------- settings -------------------------------- */
  'settings.folder.name': 'Budget-Ordner',
  'settings.folder.desc': 'Vault-Pfad des Ordners mit Categories/, Accounts/, Budgets/, Transactions/, Settings.md usw.',

  'settings.theme.name': 'Design',
  'settings.theme.desc': 'Dem Hell-/Dunkelmodus von Obsidian folgen oder die helle bzw. dunkle Airy-Glass-Palette erzwingen.',
  'settings.theme.auto': 'Obsidian folgen',
  'settings.theme.dark': 'Immer dunkel',
  'settings.theme.light': 'Immer hell',

  'settings.palette.name': 'Farbpalette',
  'settings.palette.desc': 'In welchen Farben das Budget gezeichnet wird. Jede Palette hat ihre eigene helle und dunkle Fassung und ist daher unabhängig von der Design-Einstellung oben.',

  'settings.wizard.name': 'Einrichtungsassistent',
  'settings.wizard.desc': 'Den Assistenten für den ersten Start erneut ausführen — Ordner, Name, Budgetzeitraum, Währung, Startdateien.',
  'settings.wizard.button': 'Einrichtungsassistent starten',

  'settings.startup.name': 'Beim Start öffnen',
  'settings.startup.desc': 'Die Budget-Ansicht automatisch öffnen, wenn Obsidian startet.',

  'settings.privacy.name': 'Datenschutz-Startbildschirm',
  'settings.privacy.desc': 'Das Budget mit einem Startbildschirm verdecken, bis du auf „Budget öffnen“ tippst — beim Öffnen und jedes Mal, wenn Obsidian in den Hintergrund wechselt. Vor dem Tippen wird nichts aus dem Vault gelesen.',

  'settings.feedback.name': 'Feedback senden',
  'settings.feedback.desc': 'Einen Fehler melden, auf ein Problem hinweisen oder eine Funktion wünschen. Öffnet ein Google-Formular in deinem Browser — nichts aus deinem Budget wird angehängt oder gesendet.',
  'settings.feedback.button': 'Feedback-Formular öffnen',

  'settings.support.name': 'Budget Vault unterstützen',
  'settings.support.desc': 'Budget Vault ist kostenlos und bleibt es. Wenn du danke sagen möchtest, öffnet dies PayPal in deinem Browser — völlig freiwillig, und am Plugin ändert sich so oder so nichts.',
  'settings.support.button': 'Ein Dankeschön senden',

  'settings.data.name': 'Budget-Daten',
  'settings.data.desc': 'In Settings.md im Budget-Ordner gespeichert, damit sie auf jedem Gerät gelten.',

  'settings.household.name': 'Name / Haushalt',
  'settings.household.desc': 'Wird in der Begrüßung der Übersicht und in der Kopfzeile angezeigt. Für keinen leer lassen.',
  'settings.household.placeholder': 'Für keinen leer lassen',

  'settings.monthStart.name': 'Monatsbeginn',
  'settings.monthStart.desc': 'Tag des Monats, an dem jeder Finanzzeitraum beginnt — üblicherweise dein Zahltag. Wähle 1 für einen gewöhnlichen Kalendermonat. 1–28.',
  'settings.monthStart.invalid': 'Wähle einen Tag zwischen 1 und 28.',

  'settings.periodLength.name': 'Zeitraumlänge',
  'settings.periodLength.desc': 'Wie lange jeder Budgetzeitraum läuft. „Monatlich“ nutzt den Monatsbeginn oben. Die anderen Optionen richten die Zeiträume stattdessen an einem Zahlungszyklus aus, gezählt ab dem Datum unten.',

  'settings.anchor.name': 'Letzter Zahltag',
  'settings.anchor.desc': 'Wann wurdest du zuletzt bezahlt? Jeder kürzliche Zahltag funktioniert — es zählt nur, auf welchen Tag im Zyklus er fällt, ein früherer oder späterer ergibt also dasselbe. Wird ignoriert, wenn die Zeitraumlänge monatlich ist.',
  'settings.anchor.invalid': 'Nutze ein echtes Datum im Format JJJJ-MM-TT, z. B. 2026-08-07.',

  'settings.country.name': 'Land',
  'settings.country.desc': 'Steuert die Betragsformatierung, die Datumsreihenfolge von Kontoauszügen und die Checkliste der Steuer-Ansicht (auf die Steuerbehörde deines Landes zugeschnitten). Bestehende Steuerjahre behalten ihre Daten — nur Beschriftungen und Startwerte für neue Jahre ändern sich. Unabhängig von der Oberflächensprache unten.',

  'settings.language.name': 'Sprache',
  'settings.language.desc': 'Die Sprache, in der die Oberfläche geschrieben ist. Unabhängig vom Land oben — wo du lebst, entscheidet nicht darüber, was du lesen möchtest. Folgt standardmäßig der Anzeigesprache von Obsidian, mit Englisch als Rückfall. Dein eigener Budgettext — Kategorienamen, Notizen, Kontonamen — wird nie übersetzt.',

  'settings.currency.name': 'Währungssymbol',
  'settings.currency.desc': 'Wird vor jedem Betrag angezeigt, z. B. R.',
  'settings.currency.invalid': 'Gib ein Währungssymbol ein.',

  /* ------------------------- settings notices ------------------------------ */
  'settings.budgetsKept': {
    one: 'Budget: deine {count} vorhandene Budgetdatei bleibt im Vault. Sie kann bei dieser Zeitraumlänge nicht angezeigt werden und ist sofort wieder da, wenn du die Länge zurückstellst.',
    other: 'Budget: deine {count} vorhandenen Budgetdateien bleiben im Vault. Sie können bei dieser Zeitraumlänge nicht angezeigt werden und sind sofort wieder da, wenn du die Länge zurückstellst.',
  },
  'settings.anchorReslices': {
    one: 'Budget: das verschiebt jede Zeitraumgrenze. {count} nach Datum benannte Budgetdatei passt dann nicht mehr — sie bleibt in deinem Vault, und dieses Datum zurück auf {prev} zu setzen bringt sie sofort wieder.',
    other: 'Budget: das verschiebt jede Zeitraumgrenze. {count} nach Datum benannte Budgetdateien passen dann nicht mehr — sie bleiben in deinem Vault, und dieses Datum zurück auf {prev} zu setzen bringt sie sofort wieder.',
  },
  'settings.dateNotReal': 'Budget: „{value}“ ist kein Datum — nutze die Auswahl oder tippe JJJJ-MM-TT.',

  /* ============================ setup wizard ============================== */
  'wiz.title': 'Budget Vault einrichten',
  'wiz.stepOf': 'Schritt {n} von {total}',
  'wiz.cancel': 'Abbrechen',
  'wiz.back': 'Zurück',
  'wiz.next': 'Weiter',
  'wiz.letsGo': 'Los geht\'s!',
  'wiz.connectBtn': 'Budget verbinden',
  'wiz.createBtn': 'Mein Budget erstellen',
  'wiz.skipped': 'Einrichtung übersprungen — du kannst sie jederzeit erneut starten über Einstellungen → Budget Vault → Einrichtungsassistent starten, oder über die Befehlspalette.',

  'wiz.step.folder': 'Wo dein Budget liegt',
  'wiz.step.name': 'Wie sollen wir dich nennen?',
  'wiz.step.country': 'Sprache, Land & Währung',
  'wiz.step.period': 'Dein Budgetzeitraum',
  'wiz.step.categories': 'Deine Budgetkategorien',
  'wiz.step.account': 'Dein erstes Konto',
  'wiz.step.finish': 'Bereit',

  'wiz.err.folder': 'Gib einen Ordnerpfad für das Budget ein — zum Beispiel Finances/Budget.',
  'wiz.err.monthStart': 'Der Monatsbeginn muss zwischen 1 und 28 liegen. Nicht jeder Monat hat einen 29., 30. oder 31., wenn du also am letzten Tag des Monats bezahlt wirst, nimm 28.',
  'wiz.err.anchor': 'Gib das Datum ein, an dem du zuletzt bezahlt wurdest — jeder Zahlungszyklus wird davon aus gezählt, ohne es fällt das Budget auf monatliche Zeiträume zurück.',
  'wiz.err.currency': 'Gib ein Währungssymbol ein oder wähle eines aus der Liste oben.',

  /* ---- welcome ---- */
  'wiz.welcome.title': 'Willkommen bei Budget Vault!',
  'wiz.welcome.intro': 'Dein ganzes Budget, direkt hier in deinem Vault als einfaches Markdown — keine Konten, keine Cloud, kein fremder Server. Wenn dein Vault mit deinem Handy synchronisiert, kommt dein Budget gratis mit.',
  'wiz.welcome.planLead': 'So ist der Plan — dieser Assistent richtet dich ein:',
  'wiz.welcome.plan1': 'Wähle deinen Budget-Ordner — wir legen die ganze Struktur für dich an',
  'wiz.welcome.plan2': 'Wähle Sprache, Land & Währung — damit die App richtig liest und Beträge, Daten und Steuerliches richtig aussehen',
  'wiz.welcome.plan3': 'Sag uns, wann du bezahlt wirst — deine Budgetzeiträume laufen ab Zahltag, wenn du magst',
  'wiz.welcome.plan4': 'Wähle deine Budgetkategorien — hake die an, die zu deinem Leben passen',
  'wiz.welcome.plan5': 'Füge dein erstes Konto hinzu — und was gerade darauf ist',
  'wiz.welcome.thenLead': 'Dann fängt der spaßige Teil in der App an:',
  'wiz.welcome.app1': 'Setze dein Budget — gib jeder Kategorie eine Zahl als Ziel',
  'wiz.welcome.app2': 'Importiere die CSV deiner Bank — Transaktionen sortieren sich selbst, während du es ihnen beibringst',
  'wiz.welcome.app3': 'Füge jederzeit neue Kategorien hinzu — dein Budget wächst mit dir',
  'wiz.welcome.app4': 'Schau unterwegs nach — die Übersicht zeigt genau, wohin das Geld gegangen ist',
  'wiz.welcome.close': 'Etwa zwei Minuten Einrichtung. Du kannst alles später ändern. Bereit?',

  /* ---- folder ---- */
  'wiz.folder.hint': 'Alles liegt als einfache Markdown-Dateien in einem Ordner deines Vaults.',
  'wiz.folder.blank': 'Gib einen Ordnerpfad ein — zum Beispiel Finances/Budget.',
  'wiz.folder.found': 'In „{folder}“ wurde ein vorhandenes Budget gefunden — der Assistent verbindet sich damit, statt neue Dateien anzulegen.',
  'wiz.folder.exists': '„{folder}“ existiert bereits — die Budgetdateien werden darin angelegt.',
  'wiz.folder.willCreate': '„{folder}“ existiert noch nicht — der Ordner wird für dich angelegt.',
  'wiz.folder.name': 'Budget-Ordner',
  'wiz.folder.desc': 'Wo die Kategorien, Konten, Budgets und Transaktionen liegen.',
  'wiz.folder.connected': 'In „{folder}“ wurde ein vorhandenes Budget gefunden — wir verbinden uns damit, statt neue Dateien anzulegen. Deine Kategorien, Konten und Transaktionen bleiben genau so, wie sie sind; die restlichen Schritte bestätigen nur die Einstellungen aus der dortigen Settings.md.',

  /* ---- name ---- */
  'wiz.name.name': 'Dein Name oder Spitzname',
  'wiz.name.desc': 'Wird in der Begrüßung der Übersicht und in der Kopfzeile angezeigt. Leer lassen zum Überspringen.',
  'wiz.name.placeholder': 'z. B. Alex, oder Familie Schmidt',

  /* ---- language / country / currency ---- */
  'wiz.language.desc': 'Die Sprache, in der die App geschrieben ist. Unabhängig vom Land unten — wo du lebst, entscheidet nicht darüber, was du lesen möchtest. Dein eigener Budgettext wird nie übersetzt.',
  'wiz.country.desc': 'Legt die Betragsformatierung fest, die Datumsreihenfolge beim Lesen von Kontoauszügen und die Checkliste der Steuer-Ansicht für die Steuerbehörde deines Landes.',
  'wiz.currency.desc': 'Wird vor jedem Betrag angezeigt. Startet bei deinem Land — ändere es, wenn du in etwas anderem budgetierst.',
  'wiz.currency.custom': 'Eigenes Symbol',
  'wiz.currency.customPlaceholder': 'z. B. CHF',

  /* Currency NAMES for the wizard dropdown; the stored value is the symbol. */
  'wiz.ccy.rand': 'R — Südafrikanischer Rand',
  'wiz.ccy.dollar': '$ — Dollar',
  'wiz.ccy.euro': '€ — Euro',
  'wiz.ccy.pound': '£ — Pfund',
  'wiz.ccy.other': 'Andere…',

  /* ---- period ---- */
  'wiz.period.howOften': 'Wie oft wirst du bezahlt?',
  'wiz.period.howOftenDesc': 'Monatliche Zeiträume werden nach dem Monat benannt und beginnen an dem Tag, den du unten wählst. Die anderen richten sich stattdessen nach einem Zahlungszyklus, gezählt ab deinem letzten Zahltag.',
  'wiz.period.startDay': 'An welchem Tag beginnt dein Budgetmonat?',
  'wiz.period.startDayDesc': 'Üblicherweise dein Zahltag. Wähle 1 für einen gewöhnlichen Kalendermonat. (1–28)',
  'wiz.period.badDay': 'Wähle einen Tag von 1 bis 28. Nicht jeder Monat hat einen 29., 30. oder 31., wenn du also am letzten Tag des Monats bezahlt wirst, nimm 28.',
  'wiz.period.calendarEg': 'Ein gewöhnlicher Kalendermonat: jeder Zeitraum läuft vom {first} bis zum Monatsende und ist nach diesem Monat benannt. Gerade bist du in {month}.',
  'wiz.period.paydayEg': 'Jeder Zeitraum läuft vom {start} bis zum {end} des Folgemonats und ist nach dem Monat benannt, in dem er endet. Gerade bist du in {month}.',
  'wiz.period.anchorBlank': 'Gib das Datum ein, an dem du zuletzt bezahlt wurdest, dann werden die Zeiträume davon aus berechnet.',
  'wiz.period.anchorEg': 'Von dort gezählt hat der Zeitraum, in dem du gerade bist, am {date} begonnen. Budgetdateien werden nach diesem Startdatum benannt.',
  'wiz.period.anchorName': 'Wann wurdest du zuletzt bezahlt?',
  'wiz.period.anchorDesc': 'Jeder kürzliche Zahltag genügt — es zählt nur, wo er im Zyklus liegt, ein früherer oder späterer ergibt also dieselben Zeiträume.',

  /* ---- categories ---- */
  'wiz.cats.intro': 'Beginne mit einem Satz Budgetkategorien — hake ab, was du nicht willst. Du kannst sie später hinzufügen, umbenennen oder umfärben, hier ist also nichts endgültig.',
  'wiz.cats.selected': '{count} von {total} ausgewählt',
  'wiz.cats.selectAll': 'Alle auswählen',
  'wiz.cats.selectNone': 'Keine auswählen',

  'wiz.type.income': 'Einnahmen',
  'wiz.type.expense': 'Alltägliche Ausgaben',
  'wiz.type.debt': 'Schuldentilgung',
  'wiz.type.services': 'Dienste & Abos',
  'wiz.type.insurance': 'Versicherung',
  'wiz.type.giving': 'Spenden',
  'wiz.type.savings': 'Sparen',
  'wiz.type.investment': 'Anlagen',
  'wiz.type.luxuries': 'Nice-to-have',
  'wiz.type.transfer': 'Umbuchungen',

  /* ---- first account ---- */
  'wiz.acct.intro': 'Transaktionen werden pro Konto gespeichert. Füge jetzt dein Hauptkonto hinzu, oder lass den Namen leer zum Überspringen — du kannst jederzeit Konten hinzufügen.',
  'wiz.acct.name': 'Kontoname',
  'wiz.acct.namePlaceholder': 'z. B. Girokonto',
  'wiz.acct.type': 'Art',
  'wiz.acct.balance': 'Aktueller Kontostand',
  'wiz.acct.balanceDesc': 'Optional — was gerade auf dem Konto ist.',
  'wiz.acct.balanceHint': 'Nimm den Schlusssaldo deines letzten Auszugs, oder was deine Banking-App anzeigt. Der Kontostand ist eine Momentaufnahme, die du selbst aktuell hältst — nur die neuesten Transaktionen zu importieren bringt ihn nie durcheinander — und du kannst ihn jederzeit ändern, indem du auf der Konten-Seite auf den Kontostand tippst.',

  'wiz.acctType.checking': 'Girokonto',
  'wiz.acctType.savings': 'Sparkonto',
  'wiz.acctType.credit_card': 'Kreditkarte',
  'wiz.acctType.cash': 'Bargeld',
  'wiz.acctType.investment': 'Anlage',

  /* ---- finish ---- */
  'wiz.sum.folder': 'Ordner',
  'wiz.sum.name': 'Name',
  'wiz.sum.language': 'Sprache',
  'wiz.sum.country': 'Land',
  'wiz.sum.period': 'Budgetzeitraum',
  'wiz.sum.currency': 'Währung',
  'wiz.sum.categories': 'Kategorien',
  'wiz.sum.account': 'Erstes Konto',
  'wiz.sum.opening': 'Anfangssaldo',
  'wiz.sum.catCount': {
    one: '{count} Startkategorie',
    other: '{count} Startkategorien',
  },
  'wiz.sum.monthlyCalendar': 'Monatlich (Kalendermonat)',
  'wiz.sum.monthlyOn': 'Monatlich, beginnend am {day}',
  'wiz.sum.cycleFrom': '{preset}, gezählt ab {date}',
  'wiz.finish.connectLead': 'Wir verbinden uns mit dem vorhandenen Budget-Ordner und speichern diese Einstellungen in dessen Settings.md:',
  'wiz.finish.createLead': 'Damit werden der Budget-Ordner mit Settings.md, deine Kategorien, die erste Budgetdatei und leere Owed-Money-/Services-Dateien angelegt:',
  'wiz.finish.nextLead': 'Was als Nächstes zu tun ist: ',
  'wiz.finish.nextBody': 'gib deinen Kategorien auf der Budgets-Seite einen Betrag, und importiere dann die CSV deiner Bank auf der Transaktionen-Seite.',
  'wiz.finish.privacy': 'Dein Budget öffnet sich hinter einem Datenschutz-Startbildschirm zum Antippen, damit nichts zu sehen ist, wenn jemand kurz auf deinen Vault schaut. Abschalten unter Einstellungen → Budget Vault → Datenschutz-Startbildschirm.',

  'wiz.done.connected': 'Mit deinem Budget-Ordner verbunden.',
  'wiz.done.created': 'Budget-Ordner angelegt — willkommen!',
  'wiz.failed': 'Einrichtung fehlgeschlagen: {error}',
};
