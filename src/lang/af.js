'use strict';
/* Afrikaans.

   Checked against src/lang/en.js at build time — same key set, no more, no
   fewer. Add a string to en.js first, then translate it here.

   Conventions used throughout:
     - "Budget Vault" is the product name and stays untranslated.
     - "kluis" is the vault (Obsidian's own Afrikaans term).
     - Afrikaans takes the plural at 0, same as English, so plural entries use
       the ordinary one/other split.
     - Compound nouns are written closed (begrotingsvouer, geldeenheidsimbool)
       per AWS spelling rules, not hyphenated as in English. */

module.exports = {
  /* ------------------------------- splash -------------------------------- */
  'splash.sub': 'Jou private begroting, veilig bewaar binne-in jou kluis.',
  'splash.enter': 'Gaan na begroting',

  /* -------------------------------- drawer -------------------------------- */
  'nav.menu': 'Kieslys',
  'nav.close': 'Maak kieslys toe',
  'nav.section.budget': 'Begroting',
  'nav.section.accounts': 'Rekeninge',
  'nav.section.tools': 'Gereedskap',

  'nav.dashboard': 'Paneelbord',
  'nav.transactions': 'Transaksies',
  'nav.budgets': 'Begroting',
  'nav.savings': 'Spaargeld en Beleggings',
  'nav.accounts': 'Rekeninge',
  'nav.assets': 'Bates',
  'nav.debts': 'Skuld',
  'nav.owed': 'Geld Verskuldig',
  'nav.services': 'Dienste',
  'nav.tax': 'Belasting',
  'nav.loans': 'Leningsberekenaars',
  'nav.import': 'Voer CSV in',
  'nav.reload': 'Herlaai vanaf skyf',
  'nav.pluginSettings': 'Inpropinstellings',

  /* -------------------------------- topbar -------------------------------- */
  'topbar.nav': 'Begrotingsnavigasie',
  'topbar.mainMenu': 'Hoofkieslys',
  'topbar.openMenu': 'Maak navigasiekieslys oop',
  'topbar.home': 'Gaan na Paneelbord',
  'topbar.brandSub': 'Obsidian-kluisbegroting',
  'topbar.periodNav': 'Tydperknavigasie',
  'topbar.prevPeriod': 'Vorige tydperk',
  'topbar.currentPeriod': 'Spring na huidige tydperk',
  'topbar.nextPeriod': 'Volgende tydperk',
  'topbar.import': 'Voer CSV in',
  'topbar.importTitle': 'Voer \'n bankstaat-CSV in',
  'topbar.settings': 'Maak begrotingsinstellings oop',

  /* ------------------------------- settings -------------------------------- */
  'settings.folder.name': 'Begrotingsvouer',
  'settings.folder.desc': 'Kluispad van die vouer wat Categories/, Accounts/, Budgets/, Transactions/, Settings.md, ens. hou.',

  'settings.theme.name': 'Tema',
  'settings.theme.desc': 'Volg Obsidian se lig/donker-modus, of dwing die Airy Glass donker of ligte palet af.',
  'settings.theme.auto': 'Volg Obsidian',
  'settings.theme.dark': 'Altyd donker',
  'settings.theme.light': 'Altyd lig',

  'settings.palette.name': 'Kleurpalet',
  'settings.palette.desc': 'Watter kleure die begroting in geteken word. Elke palet het sy eie ligte en donker weergawe, dus is dit onafhanklik van die Tema-instelling hierbo.',

  'settings.wizard.name': 'Opstelassistent',
  'settings.wizard.desc': 'Hardloop die eerste-keer-assistent weer — vouer, naam, begrotingstydperk, geldeenheid, beginlêers.',
  'settings.wizard.button': 'Hardloop opstelassistent',

  'settings.startup.name': 'Maak oop met begin',
  'settings.startup.desc': 'Maak die begrotingsaansig outomaties oop wanneer Obsidian begin.',

  'settings.privacy.name': 'Privaatheidskerm',
  'settings.privacy.desc': 'Bedek die begroting met \'n skerm totdat jy "Gaan na begroting" tik — met oopmaak, en weer elke keer wanneer Obsidian na die agtergrond gaan. Niks word uit die kluis gelees voordat jy tik nie.',

  'settings.feedback.name': 'Stuur terugvoer',
  'settings.feedback.desc': 'Rapporteer \'n fout, meld \'n probleem aan of vra \'n kenmerk aan. Maak \'n Google-vorm in jou blaaier oop — niks uit jou begroting word aangeheg of gestuur nie.',
  'settings.feedback.button': 'Maak terugvoervorm oop',

  'settings.support.name': 'Ondersteun Budget Vault',
  'settings.support.desc': 'Budget Vault is gratis en sal altyd wees. As jy dankie wil sê, maak dit PayPal in jou blaaier oop — heeltemal opsioneel, en niks in die inprop verander so of so nie.',
  'settings.support.button': 'Stuur \'n dankie',

  'settings.data.name': 'Begrotingsdata',
  'settings.data.desc': 'Gestoor in Settings.md binne die begrotingsvouer, sodat dit op elke toestel geld.',

  'settings.household.name': 'Naam / huishouding',
  'settings.household.desc': 'Word in die paneelbord se groet en die boonste balk gewys. Los leeg vir geen.',
  'settings.household.placeholder': 'Los leeg vir geen',

  'settings.monthStart.name': 'Maand se begindag',
  'settings.monthStart.desc': 'Dag van die maand waarop elke finansiële tydperk begin — gewoonlik jou betaaldag. Kies 1 vir \'n gewone kalendermaand. 1–28.',
  'settings.monthStart.invalid': 'Kies \'n dag tussen 1 en 28.',

  'settings.periodLength.name': 'Tydperklengte',
  'settings.periodLength.desc': 'Hoe lank elke begrotingstydperk loop. Maandeliks gebruik die maand se begindag hierbo. Die ander opsies belyn tydperke eerder met \'n betaalsiklus, getel vanaf die datum hieronder.',

  'settings.anchor.name': 'Laaste betaaldag',
  'settings.anchor.desc': 'Wanneer is jy laas betaal? Enige onlangse betaaldag werk — net die dag waarop dit binne die siklus val, maak saak, dus gee \'n vroeër of later een dieselfde uitkoms. Word geïgnoreer wanneer die tydperklengte maandeliks is.',
  'settings.anchor.invalid': 'Gebruik \'n werklike datum as JJJJ-MM-DD, bv. 2026-08-07.',

  'settings.country.name': 'Land',
  'settings.country.desc': 'Dryf bedragformatering, die datumvolgorde van bankstate en die Belasting-aansig se kontrolelys (toegespits op jou land se belastingowerheid). Bestaande belastingjare behou hul data — net etikette en nuwejaarsaanvangswaardes verander. Onafhanklik van die koppelvlaktaal hieronder.',

  'settings.language.name': 'Taal',
  'settings.language.desc': 'Die taal waarin die koppelvlak geskryf is. Onafhanklik van Land hierbo — waar jy woon, bepaal nie wat jy wil lees nie. Volg by verstek Obsidian se eie vertoontaal, met Engels as terugval. Jou eie begrotingsteks — kategoriename, notas, rekeningname — word nooit vertaal nie.',

  'settings.currency.name': 'Geldeenheidsimbool',
  'settings.currency.desc': 'Word voor elke bedrag gewys, bv. R.',
  'settings.currency.invalid': 'Voer \'n geldeenheidsimbool in.',

  /* ------------------------- settings notices ------------------------------ */
  'settings.budgetsKept': {
    one: 'Begroting: jou {count} bestaande begrotingslêer bly in die kluis. Dit kan nie by hierdie tydperklengte gewys word nie, en dit kom dadelik terug as jy dit terugverander.',
    other: 'Begroting: jou {count} bestaande begrotingslêers bly in die kluis. Hulle kan nie by hierdie tydperklengte gewys word nie, en hulle kom dadelik terug as jy dit terugverander.',
  },
  'settings.anchorReslices': {
    one: 'Begroting: dit skuif elke tydperkgrens. {count} begrotingslêer wat volgens datum benoem is, sal ophou pas — dit bly in jou kluis, en om hierdie datum terug te stel na {prev} bring dit dadelik terug.',
    other: 'Begroting: dit skuif elke tydperkgrens. {count} begrotingslêers wat volgens datum benoem is, sal ophou pas — hulle bly in jou kluis, en om hierdie datum terug te stel na {prev} bring hulle dadelik terug.',
  },
  'settings.dateNotReal': 'Begroting: "{value}" is nie \'n datum nie — gebruik die kieser, of tik JJJJ-MM-DD.',

  /* ============================ setup wizard ============================== */
  'wiz.title': 'Stel Budget Vault op',
  'wiz.stepOf': 'Stap {n} van {total}',
  'wiz.cancel': 'Kanselleer',
  'wiz.back': 'Terug',
  'wiz.next': 'Volgende',
  'wiz.letsGo': 'Kom ons gaan!',
  'wiz.connectBtn': 'Koppel begroting',
  'wiz.createBtn': 'Skep my begroting',
  'wiz.skipped': 'Opstelling oorgeslaan — jy kan dit weer hardloop vanaf Instellings → Budget Vault → Hardloop opstelassistent, of die bevelpalet.',

  'wiz.step.folder': 'Waar jou begroting bly',
  'wiz.step.name': 'Wat moet ons jou noem?',
  'wiz.step.country': 'Taal, land en geldeenheid',
  'wiz.step.period': 'Jou begrotingstydperk',
  'wiz.step.categories': 'Jou begrotingskategorieë',
  'wiz.step.account': 'Jou eerste rekening',
  'wiz.step.finish': 'Gereed om te begin',

  'wiz.err.folder': 'Voer \'n vouerpad vir die begroting in — byvoorbeeld Finances/Budget.',
  'wiz.err.monthStart': 'Die maand se begindag moet van 1 tot 28 wees. Nie elke maand het \'n 29ste, 30ste of 31ste nie, so as jy op die laaste dag van die maand betaal word, gebruik 28.',
  'wiz.err.anchor': 'Voer die datum in waarop jy laas betaal is — elke betaalsiklus word daarvandaan getel, dus val die begroting daarsonder terug op maandelikse tydperke.',
  'wiz.err.currency': 'Voer \'n geldeenheidsimbool in, of kies een uit die lys hierbo.',

  /* ---- welcome ---- */
  'wiz.welcome.title': 'Welkom by Budget Vault!',
  'wiz.welcome.intro': 'Jou hele begroting, wat reg hier in jou kluis as gewone markdown leef — geen rekeninge, geen wolk, niemand anders se bediener nie. As jou kluis na jou foon sinkroniseer, ry jou begroting gratis saam.',
  'wiz.welcome.planLead': 'Hier is die plan — hierdie assistent stel jou op:',
  'wiz.welcome.plan1': 'Kies jou begrotingsvouer — ons stel die hele struktuur vir jou op',
  'wiz.welcome.plan2': 'Kies jou taal, land en geldeenheid — sodat die program reg lees en bedrae, datums en belastinggoed reg lyk',
  'wiz.welcome.plan3': 'Sê vir ons wanneer jy betaal word — jou begrotingstydperke loop vanaf betaaldag, as jy wil',
  'wiz.welcome.plan4': 'Kies jou begrotingskategorieë — merk dié wat by jou lewe pas',
  'wiz.welcome.plan5': 'Voeg jou eerste rekening by — en wat tans daarin is',
  'wiz.welcome.thenLead': 'Dan begin die pret in die program:',
  'wiz.welcome.app1': 'Stel jou begroting — gee elke kategorie \'n bedrag om na te mik',
  'wiz.welcome.app2': 'Voer jou bank se CSV in — transaksies sorteer hulself soos jy dit leer',
  'wiz.welcome.app3': 'Voeg enige tyd nuwe kategorieë by — jou begroting groei saam met jou',
  'wiz.welcome.app4': 'Kyk terug soos jy gaan — die paneelbord wys presies waarheen die geld is',
  'wiz.welcome.close': 'Omtrent twee minute se opstelling. Jy kan enigiets daarvan later verander. Gereed?',

  /* ---- folder ---- */
  'wiz.folder.hint': 'Alles leef as gewone markdown-lêers binne een vouer van jou kluis.',
  'wiz.folder.blank': 'Voer \'n vouerpad in — byvoorbeeld Finances/Budget.',
  'wiz.folder.found': '\'n Bestaande begroting is in "{folder}" gevind — die assistent sal daaraan koppel eerder as om nuwe lêers te skep.',
  'wiz.folder.exists': '"{folder}" bestaan reeds — die begrotingslêers sal daarbinne bygevoeg word.',
  'wiz.folder.willCreate': '"{folder}" bestaan nog nie — dit sal vir jou geskep word.',
  'wiz.folder.name': 'Begrotingsvouer',
  'wiz.folder.desc': 'Waar die kategorieë, rekeninge, begrotings en transaksies gehou word.',
  'wiz.folder.connected': '\'n Bestaande begroting is in "{folder}" gevind — ons koppel daaraan eerder as om nuwe lêers te skep. Jou kategorieë, rekeninge en transaksies bly presies soos hulle is; die oorblywende stappe bevestig net die instellings wat in sy Settings.md gehou word.',

  /* ---- name ---- */
  'wiz.name.name': 'Jou naam of bynaam',
  'wiz.name.desc': 'Word in die paneelbord se groet en die boonste balk gewys. Los leeg om oor te slaan.',
  'wiz.name.placeholder': 'bv. Alex, of Die Smiths',

  /* ---- language / country / currency ---- */
  'wiz.language.desc': 'Die taal waarin die program geskryf is. Onafhanklik van die land hieronder — waar jy woon, bepaal nie wat jy wil lees nie. Jou eie begrotingsteks word nooit vertaal nie.',
  'wiz.country.desc': 'Stel bedragformatering, die datumvolgorde wat gebruik word om bankstate te lees, en die Belasting-aansig se opgawekontrolelys vir jou land se belastingowerheid.',
  'wiz.currency.desc': 'Word voor elke bedrag gewys. Begin by jou land — verander dit as jy in iets anders begroot.',
  'wiz.currency.custom': 'Pasgemaakte simbool',
  'wiz.currency.customPlaceholder': 'bv. CHF',

  /* Currency NAMES for the wizard dropdown; the stored value is the symbol. */
  'wiz.ccy.rand': 'R — Suid-Afrikaanse rand',
  'wiz.ccy.dollar': '$ — Dollar',
  'wiz.ccy.euro': '€ — Euro',
  'wiz.ccy.pound': '£ — Pond',
  'wiz.ccy.other': 'Ander…',

  /* ---- period ---- */
  'wiz.period.howOften': 'Hoe gereeld word jy betaal?',
  'wiz.period.howOftenDesc': 'Maandelikse tydperke word volgens maand benoem en begin op die dag wat jy hieronder kies. Die ander belyn eerder met \'n betaalsiklus, getel vanaf jou laaste betaaldag.',
  'wiz.period.startDay': 'Op watter dag begin jou begrotingsmaand?',
  'wiz.period.startDayDesc': 'Gewoonlik jou betaaldag. Kies 1 vir \'n gewone kalendermaand. (1–28)',
  'wiz.period.badDay': 'Kies \'n dag van 1 tot 28. Nie elke maand het \'n 29ste, 30ste of 31ste nie, so as jy op die laaste dag van die maand betaal word, gebruik 28.',
  'wiz.period.calendarEg': '\'n Gewone kalendermaand: elke tydperk loop van die {first} tot die einde van die maand, en word na daardie maand vernoem. Jy is nou in {month}.',
  'wiz.period.paydayEg': 'Elke tydperk loop van die {start} tot die {end} van die volgende maand, en word vernoem na die maand waarin dit eindig. Jy is nou in {month}.',
  'wiz.period.anchorBlank': 'Voer die datum in waarop jy laas betaal is, en die tydperke word daarvandaan uitgewerk.',
  'wiz.period.anchorEg': 'Van daar af getel, het die tydperk waarin jy nou is op {date} begin. Begrotingslêers word volgens daardie begindatum benoem.',
  'wiz.period.anchorName': 'Wanneer is jy laas betaal?',
  'wiz.period.anchorDesc': 'Enige onlangse betaaldag sal deug — net waar dit binne die siklus val, maak saak, dus gee \'n vroeër of later een dieselfde tydperke.',

  /* ---- categories ---- */
  'wiz.cats.intro': 'Begin met \'n stel begrotingskategorieë — ontmerk enige wat jy nie wil hê nie. Jy kan hulle later byvoeg, hernoem of herkleur, dus is niks hier finaal nie.',
  'wiz.cats.selected': '{count} van {total} gekies',
  'wiz.cats.selectAll': 'Kies almal',
  'wiz.cats.selectNone': 'Kies geen',

  'wiz.type.income': 'Inkomste',
  'wiz.type.expense': 'Daaglikse uitgawes',
  'wiz.type.debt': 'Skuldafbetalings',
  'wiz.type.services': 'Dienste en intekeninge',
  'wiz.type.insurance': 'Versekering',
  'wiz.type.giving': 'Gee',
  'wiz.type.savings': 'Spaargeld',
  'wiz.type.investment': 'Beleggings',
  'wiz.type.luxuries': 'Lekker-om-te-hê',
  'wiz.type.transfer': 'Oorplasings',

  /* ---- first account ---- */
  'wiz.acct.intro': 'Transaksies word per rekening gestoor. Voeg nou jou hoofrekening by, of los die naam leeg om oor te slaan — jy kan enige tyd rekeninge byvoeg.',
  'wiz.acct.name': 'Rekeningnaam',
  'wiz.acct.namePlaceholder': 'bv. Tjekrekening',
  'wiz.acct.type': 'Tipe',
  'wiz.acct.balance': 'Huidige saldo',
  'wiz.acct.balanceDesc': 'Opsioneel — wat tans in die rekening is.',
  'wiz.acct.balanceHint': 'Gebruik jou jongste staat se sluitingsaldo, of wat ook al jou bankprogram wys. Die saldo is \'n momentopname wat jy self op datum hou — om net onlangse transaksies in te voer, gooi dit nooit uit nie — en jy kan dit enige tyd verander deur op die saldo op die Rekeninge-bladsy te tik.',

  'wiz.acctType.checking': 'Tjek-/lopende rekening',
  'wiz.acctType.savings': 'Spaarrekening',
  'wiz.acctType.credit_card': 'Kredietkaart',
  'wiz.acctType.cash': 'Kontant',
  'wiz.acctType.investment': 'Belegging',

  /* ---- finish ---- */
  'wiz.sum.folder': 'Vouer',
  'wiz.sum.name': 'Naam',
  'wiz.sum.language': 'Taal',
  'wiz.sum.country': 'Land',
  'wiz.sum.period': 'Begrotingstydperk',
  'wiz.sum.currency': 'Geldeenheid',
  'wiz.sum.categories': 'Kategorieë',
  'wiz.sum.account': 'Eerste rekening',
  'wiz.sum.opening': 'Aanvangsaldo',
  'wiz.sum.catCount': {
    one: '{count} beginkategorie',
    other: '{count} beginkategorieë',
  },
  'wiz.sum.monthlyCalendar': 'Maandeliks (kalendermaand)',
  'wiz.sum.monthlyOn': 'Maandeliks, begin op die {day}',
  'wiz.sum.cycleFrom': '{preset}, getel vanaf {date}',
  'wiz.finish.connectLead': 'Ons koppel aan die bestaande begrotingsvouer en stoor hierdie instellings in sy Settings.md:',
  'wiz.finish.createLead': 'Dit sal die begrotingsvouer skep met Settings.md, jou kategorieë, die eerste begrotingslêer en leë Owed Money-/Services-lêers:',
  'wiz.finish.nextLead': 'Wat om volgende te doen: ',
  'wiz.finish.nextBody': 'gee jou kategorieë \'n bedrag op die Begrotings-bladsy, en voer dan jou bank se CSV op die Transaksies-bladsy in.',
  'wiz.finish.privacy': 'Jou begroting maak agter \'n tik-om-in-te-gaan privaatheidskerm oop, sodat niks sigbaar is as iemand vlugtig na jou kluis kyk nie. Skakel dit af by Instellings → Budget Vault → Privaatheidskerm.',

  'wiz.done.connected': 'Gekoppel aan jou begrotingsvouer.',
  'wiz.done.created': 'Begrotingsvouer geskep — welkom!',
  'wiz.failed': 'Opstelling het misluk: {error}',
};
