'use strict';
/* Français.

   Checked against src/lang/en.js at build time — same key set, no more, no
   fewer. Add a string to en.js first, then translate it here.

   Conventions used throughout:
     - "Budget Vault" is the product name and stays untranslated. "coffre" is
       the vault, matching Obsidian's own French locale.
     - Formal "vous", matching Obsidian's French locale — French software does
       not use "tu" the way German and Spanish use "du"/"tú".
     - French takes the SINGULAR at 0 as well as 1 ("0 fichier", "1 fichier",
       "2 fichiers"), which is why 'fr' is in ZERO_IS_SINGULAR in i18n.js. The
       `one` form below therefore has to read correctly for zero too.
     - Date placeholders are localised: AAAA-MM-JJ, not YYYY-MM-DD.
     - Guillemets « » are the French convention, and take a space inside them.
     - A colon, question mark and exclamation mark each take a space before. */

module.exports = {
  /* ------------------------------- splash -------------------------------- */
  'splash.sub': 'Votre budget privé, conservé en sécurité dans votre coffre.',
  'splash.enter': 'Ouvrir le budget',

  /* -------------------------------- drawer -------------------------------- */
  'nav.menu': 'Menu',
  'nav.close': 'Fermer le menu',
  'nav.section.budget': 'Budget',
  'nav.section.accounts': 'Comptes',
  'nav.section.tools': 'Outils',

  'nav.dashboard': 'Tableau de bord',
  'nav.transactions': 'Transactions',
  'nav.budgets': 'Budget',
  'nav.savings': 'Épargne et Placements',
  'nav.accounts': 'Comptes',
  'nav.assets': 'Actifs',
  'nav.debts': 'Dettes',
  'nav.owed': 'Sommes Dues',
  'nav.services': 'Services',
  'nav.tax': 'Impôts',
  'nav.loans': 'Calculateurs de Prêt',
  'nav.import': 'Importer un CSV',
  'nav.reload': 'Recharger depuis le disque',
  'nav.pluginSettings': 'Paramètres du plugin',

  /* -------------------------------- topbar -------------------------------- */
  'topbar.nav': 'Navigation du budget',
  'topbar.mainMenu': 'Menu principal',
  'topbar.openMenu': 'Ouvrir le menu de navigation',
  'topbar.home': 'Aller au tableau de bord',
  'topbar.brandSub': 'Budget dans le coffre Obsidian',
  'topbar.periodNav': 'Navigation par période',
  'topbar.prevPeriod': 'Période précédente',
  'topbar.currentPeriod': 'Aller à la période actuelle',
  'topbar.nextPeriod': 'Période suivante',
  'topbar.import': 'Importer un CSV',
  'topbar.importTitle': 'Importer un relevé bancaire au format CSV',
  'topbar.settings': 'Ouvrir les paramètres du budget',

  /* ------------------------------- settings -------------------------------- */
  'settings.folder.name': 'Dossier du budget',
  'settings.folder.desc': 'Chemin dans le coffre du dossier contenant Categories/, Accounts/, Budgets/, Transactions/, Settings.md, etc.',

  'settings.theme.name': 'Thème',
  'settings.theme.desc': 'Suivre le mode clair/sombre d\'Obsidian, ou forcer la palette Airy Glass claire ou sombre.',
  'settings.theme.auto': 'Suivre Obsidian',
  'settings.theme.dark': 'Toujours sombre',
  'settings.theme.light': 'Toujours clair',

  'settings.palette.name': 'Palette de couleurs',
  'settings.palette.desc': 'Les couleurs dans lesquelles le budget est dessiné. Chaque palette a sa propre version claire et sombre, elle est donc indépendante du paramètre Thème ci-dessus.',

  'settings.wizard.name': 'Assistant de configuration',
  'settings.wizard.desc': 'Relancer l\'assistant de première utilisation — dossier, nom, période budgétaire, devise, fichiers de départ.',
  'settings.wizard.button': 'Lancer l\'assistant',

  'settings.startup.name': 'Ouvrir au démarrage',
  'settings.startup.desc': 'Ouvrir la vue budget automatiquement au démarrage d\'Obsidian.',

  'settings.privacy.name': 'Écran de confidentialité',
  'settings.privacy.desc': 'Couvrir le budget d\'un écran jusqu\'à ce que vous touchiez « Ouvrir le budget » — à l\'ouverture, et de nouveau chaque fois qu\'Obsidian passe en arrière-plan. Rien n\'est lu depuis le coffre avant que vous ne touchiez.',

  'settings.feedback.name': 'Envoyer un retour',
  'settings.feedback.desc': 'Signaler un bug, remonter un problème ou demander une fonctionnalité. Ouvre un formulaire Google dans votre navigateur — rien de votre budget n\'est joint ni envoyé.',
  'settings.feedback.button': 'Ouvrir le formulaire',

  'settings.support.name': 'Soutenir Budget Vault',
  'settings.support.desc': 'Budget Vault est gratuit et le restera. Si vous souhaitez dire merci, ceci ouvre PayPal dans votre navigateur — entièrement facultatif, et rien ne change dans le plugin dans un cas comme dans l\'autre.',
  'settings.support.button': 'Envoyer un merci',

  'settings.data.name': 'Données du budget',
  'settings.data.desc': 'Stockées dans Settings.md à l\'intérieur du dossier du budget, afin de s\'appliquer sur chaque appareil.',

  'settings.household.name': 'Nom / foyer',
  'settings.household.desc': 'Affiché dans le message d\'accueil du tableau de bord et la barre supérieure. Laissez vide pour aucun.',
  'settings.household.placeholder': 'Laissez vide pour aucun',

  'settings.monthStart.name': 'Jour de début du mois',
  'settings.monthStart.desc': 'Jour du mois où commence chaque période financière — généralement votre jour de paie. Choisissez 1 pour un mois calendaire ordinaire. 1–28.',
  'settings.monthStart.invalid': 'Choisissez un jour entre 1 et 28.',

  'settings.periodLength.name': 'Durée de la période',
  'settings.periodLength.desc': 'La durée de chaque période budgétaire. « Mensuel » utilise le jour de début du mois ci-dessus. Les autres options alignent plutôt les périodes sur un cycle de paie, comptées à partir de la date ci-dessous.',

  'settings.anchor.name': 'Dernier jour de paie',
  'settings.anchor.desc': 'Quand avez-vous été payé pour la dernière fois ? N\'importe quel jour de paie récent convient — seul compte le jour où il tombe dans le cycle, un plus tôt ou un plus tard donne donc le même résultat. Ignoré lorsque la durée de la période est mensuelle.',
  'settings.anchor.invalid': 'Utilisez une date réelle au format AAAA-MM-JJ, par ex. 2026-08-07.',

  'settings.country.name': 'Pays',
  'settings.country.desc': 'Détermine le formatage des montants, l\'ordre des dates des relevés bancaires et la liste de contrôle de la vue Impôts (adaptée à l\'administration fiscale de votre pays). Les années fiscales existantes conservent leurs données — seuls les libellés et les valeurs initiales des nouvelles années changent. Indépendant de la langue de l\'interface ci-dessous.',

  'settings.language.name': 'Langue',
  'settings.language.desc': 'La langue dans laquelle l\'interface est écrite. Indépendante du Pays ci-dessus — vivre quelque part ne décide pas de ce que vous voulez lire. Suit par défaut la langue d\'affichage d\'Obsidian, avec l\'anglais en repli. Votre propre texte de budget — noms de catégories, notes, noms de comptes — n\'est jamais traduit.',

  'settings.currency.name': 'Symbole monétaire',
  'settings.currency.desc': 'Affiché devant chaque montant, par ex. R.',
  'settings.currency.invalid': 'Saisissez un symbole monétaire.',

  /* ------------------------- settings notices ------------------------------ */
  /* The `one` form covers 0 as well as 1 in French — worded so it reads
     correctly either way. */
  'settings.budgetsKept': {
    one: 'Budget : votre {count} fichier de budget existant reste dans le coffre. Il ne peut pas être affiché avec cette durée de période, et il revient aussitôt si vous la remettez comme avant.',
    other: 'Budget : vos {count} fichiers de budget existants restent dans le coffre. Ils ne peuvent pas être affichés avec cette durée de période, et ils reviennent aussitôt si vous la remettez comme avant.',
  },
  'settings.anchorReslices': {
    one: 'Budget : ceci décale chaque limite de période. {count} fichier de budget nommé par date ne correspondra plus — il reste dans votre coffre, et remettre cette date à {prev} le ramène aussitôt.',
    other: 'Budget : ceci décale chaque limite de période. {count} fichiers de budget nommés par date ne correspondront plus — ils restent dans votre coffre, et remettre cette date à {prev} les ramène aussitôt.',
  },
  'settings.dateNotReal': 'Budget : « {value} » n\'est pas une date — utilisez le sélecteur, ou saisissez AAAA-MM-JJ.',

  /* ============================ setup wizard ============================== */
  'wiz.title': 'Configurer Budget Vault',
  'wiz.stepOf': 'Étape {n} sur {total}',
  'wiz.cancel': 'Annuler',
  'wiz.back': 'Retour',
  'wiz.next': 'Suivant',
  'wiz.letsGo': 'C\'est parti !',
  'wiz.connectBtn': 'Connecter le budget',
  'wiz.createBtn': 'Créer mon budget',
  'wiz.skipped': 'Configuration ignorée — vous pouvez la relancer depuis Paramètres → Budget Vault → Lancer l\'assistant, ou la palette de commandes.',

  'wiz.step.folder': 'Où vit votre budget',
  'wiz.step.name': 'Comment vous appeler ?',
  'wiz.step.country': 'Langue, pays et devise',
  'wiz.step.period': 'Votre période budgétaire',
  'wiz.step.categories': 'Vos catégories budgétaires',
  'wiz.step.account': 'Votre premier compte',
  'wiz.step.finish': 'Prêt à démarrer',

  'wiz.err.folder': 'Saisissez un chemin de dossier pour le budget — par exemple Finances/Budget.',
  'wiz.err.monthStart': 'Le jour de début du mois doit être compris entre 1 et 28. Tous les mois n\'ont pas de 29, 30 ou 31, donc si vous êtes payé le dernier jour du mois, prenez 28.',
  'wiz.err.anchor': 'Saisissez la date de votre dernière paie — chaque cycle est compté à partir d\'elle, sans quoi le budget revient à des périodes mensuelles.',
  'wiz.err.currency': 'Saisissez un symbole monétaire, ou choisissez-en un dans la liste ci-dessus.',

  /* ---- welcome ---- */
  'wiz.welcome.title': 'Bienvenue dans Budget Vault !',
  'wiz.welcome.intro': 'Tout votre budget, ici même dans votre coffre, en markdown brut — pas de comptes, pas de cloud, pas le serveur de quelqu\'un d\'autre. Si votre coffre se synchronise avec votre téléphone, votre budget suit gratuitement.',
  'wiz.welcome.planLead': 'Voici le plan — cet assistant vous met en place :',
  'wiz.welcome.plan1': 'Choisissez votre dossier de budget — nous créons toute la structure pour vous',
  'wiz.welcome.plan2': 'Choisissez langue, pays et devise — pour que l\'application se lise bien et que montants, dates et fiscalité soient corrects',
  'wiz.welcome.plan3': 'Dites-nous quand vous êtes payé — vos périodes peuvent partir du jour de paie',
  'wiz.welcome.plan4': 'Choisissez vos catégories — cochez celles qui correspondent à votre vie',
  'wiz.welcome.plan5': 'Ajoutez votre premier compte — et ce qu\'il contient maintenant',
  'wiz.welcome.thenLead': 'Ensuite, les choses sérieuses commencent dans l\'application :',
  'wiz.welcome.app1': 'Fixez votre budget — donnez à chaque catégorie un montant à viser',
  'wiz.welcome.app2': 'Importez le CSV de votre banque — les transactions se rangent seules à mesure que vous lui apprenez',
  'wiz.welcome.app3': 'Ajoutez de nouvelles catégories quand vous voulez — votre budget grandit avec vous',
  'wiz.welcome.app4': 'Faites le point au fil de l\'eau — le tableau de bord montre exactement où est passé l\'argent',
  'wiz.welcome.close': 'Environ deux minutes de configuration. Vous pourrez tout changer plus tard. Prêt ?',

  /* ---- folder ---- */
  'wiz.folder.hint': 'Tout vit sous forme de fichiers markdown bruts dans un dossier de votre coffre.',
  'wiz.folder.blank': 'Saisissez un chemin de dossier — par exemple Finances/Budget.',
  'wiz.folder.found': 'Un budget existant a été trouvé dans « {folder} » — l\'assistant s\'y connectera plutôt que de créer de nouveaux fichiers.',
  'wiz.folder.exists': '« {folder} » existe déjà — les fichiers du budget y seront ajoutés.',
  'wiz.folder.willCreate': '« {folder} » n\'existe pas encore — il sera créé pour vous.',
  'wiz.folder.name': 'Dossier du budget',
  'wiz.folder.desc': 'Où sont conservés les catégories, comptes, budgets et transactions.',
  'wiz.folder.connected': 'Un budget existant a été trouvé dans « {folder} » — nous nous y connectons plutôt que de créer de nouveaux fichiers. Vos catégories, comptes et transactions restent exactement tels quels ; les étapes restantes ne font que confirmer les paramètres conservés dans son Settings.md.',

  /* ---- name ---- */
  'wiz.name.name': 'Votre nom ou surnom',
  'wiz.name.desc': 'Affiché dans le message d\'accueil du tableau de bord et la barre supérieure. Laissez vide pour passer.',
  'wiz.name.placeholder': 'par ex. Alex, ou Famille Dupont',

  /* ---- language / country / currency ---- */
  'wiz.language.desc': 'La langue dans laquelle l\'application est écrite. Indépendante du pays ci-dessous — l\'endroit où vous vivez ne décide pas de ce que vous voulez lire. Votre propre texte de budget n\'est jamais traduit.',
  'wiz.country.desc': 'Détermine le formatage des montants, l\'ordre des dates à la lecture des relevés bancaires et la liste de contrôle de la vue Impôts pour l\'administration fiscale de votre pays.',
  'wiz.currency.desc': 'Affiché devant chaque montant. Part de votre pays — changez-le si vous budgétez dans autre chose.',
  'wiz.currency.custom': 'Symbole personnalisé',
  'wiz.currency.customPlaceholder': 'par ex. CHF',

  /* Currency NAMES for the wizard dropdown; the stored value is the symbol. */
  'wiz.ccy.rand': 'R — Rand sud-africain',
  'wiz.ccy.dollar': '$ — Dollar',
  'wiz.ccy.euro': '€ — Euro',
  'wiz.ccy.pound': '£ — Livre',
  'wiz.ccy.other': 'Autre…',

  /* ---- period ---- */
  'wiz.period.howOften': 'À quelle fréquence êtes-vous payé ?',
  'wiz.period.howOftenDesc': 'Les périodes mensuelles portent le nom du mois et commencent le jour choisi ci-dessous. Les autres s\'alignent plutôt sur un cycle de paie, compté depuis votre dernier jour de paie.',
  'wiz.period.startDay': 'Quel jour commence votre mois budgétaire ?',
  'wiz.period.startDayDesc': 'Généralement votre jour de paie. Choisissez 1 pour un mois calendaire ordinaire. (1–28)',
  'wiz.period.badDay': 'Choisissez un jour de 1 à 28. Tous les mois n\'ont pas de 29, 30 ou 31, donc si vous êtes payé le dernier jour du mois, prenez 28.',
  'wiz.period.calendarEg': 'Un mois calendaire ordinaire : chaque période va du {first} à la fin du mois, et porte le nom de ce mois. Vous êtes actuellement en {month}.',
  'wiz.period.paydayEg': 'Chaque période va du {start} au {end} du mois suivant, et porte le nom du mois où elle se termine. Vous êtes actuellement en {month}.',
  'wiz.period.anchorBlank': 'Saisissez la date de votre dernière paie et les périodes en découleront.',
  'wiz.period.anchorEg': 'À partir de là, la période dans laquelle vous êtes actuellement a commencé le {date}. Les fichiers de budget portent le nom de cette date de début.',
  'wiz.period.anchorName': 'Quand avez-vous été payé pour la dernière fois ?',
  'wiz.period.anchorDesc': 'N\'importe quel jour de paie récent convient — seule compte sa place dans le cycle, un plus tôt ou un plus tard donne donc les mêmes périodes.',

  /* ---- categories ---- */
  'wiz.cats.intro': 'Commencez avec un jeu de catégories — décochez celles dont vous ne voulez pas. Vous pourrez en ajouter, les renommer ou les recolorer plus tard, rien n\'est définitif ici.',
  'wiz.cats.selected': '{count} sur {total} sélectionnées',
  'wiz.cats.selectAll': 'Tout sélectionner',
  'wiz.cats.selectNone': 'Tout désélectionner',

  'wiz.type.income': 'Revenus',
  'wiz.type.expense': 'Dépenses courantes',
  'wiz.type.debt': 'Remboursements de dettes',
  'wiz.type.services': 'Services et abonnements',
  'wiz.type.insurance': 'Assurance',
  'wiz.type.giving': 'Dons',
  'wiz.type.savings': 'Épargne',
  'wiz.type.investment': 'Placements',
  'wiz.type.luxuries': 'Petits plaisirs',
  'wiz.type.transfer': 'Virements',

  /* ---- first account ---- */
  'wiz.acct.intro': 'Les transactions sont stockées par compte. Ajoutez votre compte principal maintenant, ou laissez le nom vide pour passer — vous pourrez ajouter des comptes à tout moment.',
  'wiz.acct.name': 'Nom du compte',
  'wiz.acct.namePlaceholder': 'par ex. Compte courant',
  'wiz.acct.type': 'Type',
  'wiz.acct.balance': 'Solde actuel',
  'wiz.acct.balanceDesc': 'Facultatif — ce qu\'il y a sur le compte en ce moment.',
  'wiz.acct.balanceHint': 'Utilisez le solde de clôture de votre dernier relevé, ou ce qu\'affiche l\'application de votre banque. Le solde est un instantané que vous tenez à jour vous-même — n\'importer que les transactions récentes ne le fausse jamais — et vous pouvez le changer à tout moment en touchant le solde sur la page Comptes.',

  'acctType.checking': 'Compte courant',
  'acctType.savings': 'Compte d\'épargne',
  'acctType.credit_card': 'Carte de crédit',
  'acctType.cash': 'Espèces',
  'acctType.investment': 'Placement',
  'acctType.other': 'Autre',

  /* ---- finish ---- */
  'wiz.sum.folder': 'Dossier',
  'wiz.sum.name': 'Nom',
  'wiz.sum.language': 'Langue',
  'wiz.sum.country': 'Pays',
  'wiz.sum.period': 'Période budgétaire',
  'wiz.sum.currency': 'Devise',
  'wiz.sum.categories': 'Catégories',
  'wiz.sum.account': 'Premier compte',
  'wiz.sum.opening': 'Solde d\'ouverture',
  'wiz.sum.catCount': {
    one: '{count} catégorie de départ',
    other: '{count} catégories de départ',
  },
  'wiz.sum.monthlyCalendar': 'Mensuel (mois calendaire)',
  'wiz.sum.monthlyOn': 'Mensuel, à partir du {day}',
  'wiz.sum.cycleFrom': '{preset}, compté depuis le {date}',
  'wiz.finish.connectLead': 'Connexion au dossier de budget existant et enregistrement de ces paramètres dans son Settings.md :',
  'wiz.finish.createLead': 'Ceci créera le dossier du budget avec Settings.md, vos catégories, le premier fichier de budget et des fichiers Owed Money / Services vides :',
  'wiz.finish.nextLead': 'Que faire ensuite : ',
  'wiz.finish.nextBody': 'donnez un montant à vos catégories sur la page Budgets, puis importez le CSV de votre banque sur la page Transactions.',
  'wiz.finish.privacy': 'Votre budget s\'ouvre derrière un écran de confidentialité à toucher, ainsi rien n\'est visible si quelqu\'un jette un œil à votre coffre. Désactivez-le dans Paramètres → Budget Vault → Écran de confidentialité.',

  'wiz.done.connected': 'Connecté à votre dossier de budget.',
  'wiz.done.created': 'Dossier de budget créé — bienvenue !',
  'wiz.failed': 'Échec de la configuration : {error}',

  /* ============================== Budget page ============================= */
  'bud.shape.title': 'Vos autres budgets sont toujours là',
  'bud.shape.body': {
    one: '{count} fichier de budget est enregistré sous une autre durée de période — il s\'agit de Budgets/{newest}.md. Il reste dans votre coffre et revient dès que vous rétablissez la durée. Les montants partent vides ici parce que cette période n\'a pas la même durée que celle-là.',
    other: '{count} fichiers de budget sont enregistrés sous une autre durée de période — le plus récent est Budgets/{newest}.md. Ils restent dans votre coffre et reviennent dès que vous rétablissez la durée. Les montants partent vides ici parce que cette période n\'a pas la même durée que celles-là.',
  },
  'bud.shape.bring': 'Reprendre les catégories et les notes de {newest}',
  'bud.shape.empty': 'Ce budget est vide',
  'bud.shape.brought': {
    one: '{count} catégorie reprise — indiquez le montant pour cette période',
    other: '{count} catégories reprises — indiquez les montants pour cette période',
  },
  'bud.shape.allHere': 'Toutes les catégories de ce budget sont déjà ici',

  'bud.total.income': 'Revenus totaux',
  'bud.total.incomeNote': '{amount} reçu jusqu\'ici',
  'bud.total.budgeted': 'Total budgété',
  'bud.total.budgetedNote': '{pct}% des revenus budgétés',
  'bud.total.over': 'Sur-budgété',
  'bud.total.overNote': 'budgété au-delà des revenus',
  'bud.total.left': 'Reste à budgéter',
  'bud.total.leftNote': 'revenus pas encore affectés',
  'bud.total.spent': 'Total dépensé',
  'bud.total.spentNote': '{pct}% du budget utilisé',

  'bud.col.category': 'Catégorie',
  'bud.col.type': 'Type',
  'bud.col.amount': 'Montant',
  'bud.col.actual': 'Réel à ce jour',
  'bud.col.notes': 'Notes',

  'bud.remaining.over': '{amount} de dépassement',
  'bud.remaining.left': '{amount} restant',

  'bud.aria.amount': 'Montant budgété pour {category}',
  'bud.aria.notes': 'Notes de {category}',
  'bud.aria.clear': 'Vider le budget de {category}',
  'bud.title.clear': 'Retirer cette catégorie du fichier de la période',
  'bud.aria.delete': 'Supprimer la catégorie {category}',
  'bud.title.delete': 'Supprimer cette catégorie partout',

  'bud.saved': 'Budget enregistré dans Budgets/{period}.md',
  'bud.copy.none': 'Aucun budget trouvé pour la période précédente',
  'bud.copy.done': {
    one: '{count} catégorie copiée depuis la période précédente',
    other: '{count} catégories copiées depuis la période précédente',
  },
  'bud.copy.nothing': 'Rien à copier — chaque catégorie a déjà une valeur',


  /* =========================== Transactions page ========================== */
  'tx.wholeHistory': 'Tout l\'historique',
  'tx.allAccounts': 'Tous les comptes',
  'tx.allCategories': 'Toutes les catégories',
  'tx.uncategorised': 'Sans catégorie',
  'tx.count.window': '{shown} sur {total} lignes',
  'tx.count.all': { one: '{count} ligne', other: '{count} lignes' },

  'tx.col.date': 'Date',
  'tx.col.desc': 'Description',
  'tx.col.account': 'Compte',
  'tx.col.category': 'Catégorie',
  'tx.col.amount': 'Montant',
  'tx.col.excl': 'Excl.',
  'tx.col.note': 'Note',
  'tx.col.split': 'Répartir',

  'tx.aria.category': 'Catégorie pour {date} {desc}',
  'tx.aria.exclude': 'Exclure {desc} des totaux du budget',
  'tx.aria.note': 'Note pour {date} {desc}',
  'tx.aria.split': 'Répartir {date} {desc} en catégories',
  'tx.title.split': 'Répartir en catégories',

  'tx.none': 'Aucune transaction ne correspond.',
  'tx.showMore': 'Afficher {n} de plus sur {remaining} restantes',

  'tx.split.zero': 'Une ligne à zéro n\'a rien à répartir',
  'tx.split.excluded': 'Cette ligne est déjà exclue — décochez-la d\'abord',
  'tx.split.marker': 'Répartie en {n}',
  'tx.split.done': 'Répartie en {n} — vérifiez, puis enregistrez les modifications',

  'tx.add.noAccount': 'Ajoutez d\'abord un compte — chaque transaction appartient à un compte',
  'tx.add.title': 'Ajouter une transaction',
  'tx.field.date': 'Date',
  'tx.field.desc': 'Description',
  'tx.field.descPlaceholder': 'par ex. Espèces — légumes au marché',
  'tx.field.account': 'Compte',
  'tx.field.direction': 'Sens',
  'tx.dir.out': 'Argent sortant',
  'tx.dir.in': 'Argent entrant',
  'tx.field.amount': 'Montant',
  'tx.field.amountDesc': 'Toujours positif — le sens donne le signe',
  'tx.field.category': 'Catégorie',
  'tx.field.none': '— aucune —',
  'tx.field.note': 'Note',
  'tx.field.notePlaceholder': 'facultatif',

  'tx.err.date': 'La date doit être au format AAAA-MM-JJ',
  'tx.err.desc': 'La description est obligatoire',
  'tx.err.account': 'Nom de compte invalide',
  'tx.err.amount': 'Le montant doit être un nombre différent de 0',
  'tx.err.save': 'Impossible d\'enregistrer la transaction ({error})',

  'tx.saved': { one: '{count} fichier enregistré', other: '{count} fichiers enregistrés' },
  'tx.savedLearned': { one: ' · {count} nouvelle règle apprise', other: ' · {count} nouvelles règles apprises' },

  'tx.export.dirty': 'Enregistrez d\'abord vos modifications — un export de modifications non enregistrées ne correspondrait pas au coffre',
  'tx.export.empty': 'Rien à exporter — aucune ligne ne correspond aux filtres actuels',
  'tx.export.title': 'Exporter les transactions',
  'tx.export.folder': 'Enregistrer dans le dossier',
  'tx.export.desc': {
    one: 'Dossier du coffre pour l\'export. {count} ligne ({range}) plus {cats} catégories, en CSV et markdown.',
    other: 'Dossier du coffre pour l\'export. {count} lignes ({range}) plus {cats} catégories, en CSV et markdown.',
  },
  'tx.export.failed': 'Impossible d\'écrire l\'export — vérifiez le nom du dossier',
  'tx.export.done': {
    one: '{count} ligne et {cats} catégories exportées vers {path}/',
    other: '{count} lignes et {cats} catégories exportées vers {path}/',
  },

};
