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
  'nav.savings': 'Épargne et placements',
  'nav.accounts': 'Comptes',
  'nav.assets': 'Actifs',
  'nav.debts': 'Dettes',
  'nav.owed': 'Sommes dues',
  'nav.services': 'Services',
  'nav.tax': 'Impôts',
  'nav.loans': 'Simulateurs de prêt',
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
  'bud.shape.bringAmounts': 'Reprendre aussi les montants…',
  'bud.shape.broughtAmounts': {
    one: '{count} montant repris — vérifiez-le, puis enregistrez',
    other: '{count} montants repris — vérifiez-les, puis enregistrez',
  },

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
  'tx.count.window': {
    one: '{shown} sur {total} ligne',
    other: '{shown} sur {total} lignes',
  },
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
  'tx.showMore': {
    one: 'Afficher {n} de plus sur {remaining} restante',
    other: 'Afficher {n} de plus sur {remaining} restantes',
  },

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


  /* ============================= Accounts page ============================ */
  'acct.group.bank': 'Comptes bancaires',
  'acct.group.savings': 'Épargne',
  'acct.group.investments': 'Placements',
  'acct.group.other': 'Autres',
  'acct.group.count': { one: '{count} compte', other: '{count} comptes' },

  'acct.noteMissing': 'Accounts/{name}.md introuvable',
  'acct.balance.title': 'Mettre à jour le solde — {name}',
  'acct.balance.field': 'Nouveau solde',
  'acct.balance.updated': 'Solde de {name} mis à jour',
  'acct.reconciled': '{name} rapproché à {amount}',
  'acct.err.nan': 'Pas un nombre',
  'acct.err.type': 'Type invalide',
  'acct.err.notNumber': '{field} n\'est pas un nombre',
  'acct.err.nameRequired': 'Le nom du compte est obligatoire',
  'acct.err.exists': 'Ce compte existe déjà',

  'acct.edit.title': 'Modifier le compte — {name}',
  'acct.new.title': 'Nouveau compte',
  'acct.field.name': 'Nom du compte',
  'acct.field.type': 'Type',
  'acct.field.institution': 'Établissement',
  'acct.field.number': 'Numéro de compte',
  'acct.field.numberDesc': 'Sert à rattacher un relevé téléchargé à ce compte lors de l\'import.',
  'acct.field.folder': 'Dossier des transactions',
  'acct.field.folderDesc': 'Laissez vide pour utiliser « {name} ». À renseigner seulement si le dossier sous Transactions/ porte un autre nom.',
  'acct.field.counts': 'Compté dans le budget',
  'acct.counts.yes': 'Oui — compte de dépenses ordinaire',
  'acct.counts.no': 'Non — enveloppe de placement ou d\'épargne',
  'acct.field.countsDesc': 'Choisissez Non pour un compte dont les intérêts ne sont pas un revenu du foyer et dont les versements ne sont pas une dépense du foyer. Ses transactions sont toujours importées et visibles dans Transactions.',
  'acct.field.limit': 'Plafond de crédit',
  'acct.field.limitDesc': 'Affiche une barre d\'utilisation sur les cartes de crédit.',
  'acct.field.balance': 'Solde actuel',
  'acct.field.goal': 'Objectif d\'épargne',
  'acct.field.goalOpt': 'Objectif d\'épargne (facultatif)',
  'acct.field.goalOptDesc': 'Affiche une barre de progression dans Épargne et placements.',
  'acct.field.goalDate': 'Date cible',
  'acct.field.monthly': 'Versement mensuel',
  'acct.field.invested': 'Total investi',
  'acct.field.investedOpt': 'Total investi (facultatif)',
  'acct.field.investedDesc': 'Ce que vous avez versé, pour situer la croissance par rapport à cela.',
  'acct.field.starting': 'Montant de départ',
  'acct.field.opened': 'Ouvert le',

  'acct.budget.on': '{name} compte de nouveau dans le budget',
  'acct.budget.off': '{name} ne compte plus dans les totaux du budget',

  'acct.creditUsed': 'Crédit utilisé',
  'acct.creditOf': '{used} sur {limit}',
  'acct.overLimit': '{amount} au-dessus du plafond',
  'acct.utilised': '{pct}% utilisé · {available} disponible',

  'acct.kpi.inCredit': 'Créditeur',
  'acct.kpi.overdrawn': 'À découvert',
  'acct.kpi.netWorth': 'Valeur nette',
  'acct.kpi.netWorthNote': 'sur ces comptes uniquement',
  'acct.kpi.attention': 'À vérifier',
  'acct.kpi.attentionNote': 'soldes non confirmés ou en écart',
  'acct.kpi.allGood': 'tous les soldes concordent',

  'acct.aria.showTx': 'Afficher les transactions de {name}',
  'acct.aria.balance': 'Solde de {name}, {amount} — cliquez pour mettre à jour',
  'acct.limitSuffix': ' · plafond {amount}',
  'acct.monthlySuffix': ' · {amount}/mois',

  'acct.badge.notInBudget': 'hors budget',
  'acct.badge.noTx': 'aucune transaction',
  'acct.badge.asOf': 'au {date}',
  'acct.badge.neverConfirmed': 'jamais confirmé',
  'acct.badge.unconfirmed': { one: 'non confirmé depuis {count} jour', other: 'non confirmé depuis {count} jours' },

  'acct.act.in': ' entrée · ',
  'acct.act.out': ' sortie · ',
  'acct.act.count': { one: '{count} transaction en {month}', other: '{count} transactions en {month}' },

  'acct.recon.since': { one: '{count} transaction depuis · implique ', other: '{count} transactions depuis · implique ' },
  'acct.recon.pending': {
    one: ' · {count} datée en avance, pas encore comptée',
    other: ' · {count} datées en avance, pas encore comptées',
  },
  'acct.recon.useThis': 'Utiliser',
  'acct.aria.useThis': 'Mettre le solde de {name} à {amount}',
  'acct.recon.matches': 'Correspond à vos transactions',
  'acct.recon.upToDate': { one: 'À jour · {count} transaction datée en avance', other: 'À jour · {count} transactions datées en avance' },
  'acct.recon.setDate': 'Indiquez une date de solde pour la confronter à vos transactions',

  'acct.foot.updated': 'mis à jour le {date}',
  'acct.foot.noDate': 'pas de date de solde',
  'acct.aria.exclude': 'Ne plus compter {name} dans les totaux du budget',
  'acct.aria.include': 'Compter de nouveau {name} dans les totaux du budget',
  'acct.btn.exclude': 'Exclure du budget',
  'acct.btn.include': 'Inclure dans le budget',
  'acct.aria.edit': 'Modifier {name}',
  'acct.btn.edit': 'Modifier',
  'acct.aria.openNote': 'Ouvrir la note de {name}',
  'acct.btn.openNote': 'Ouvrir la note',
  'acct.empty': 'Aucun compte pour l\'instant. Utilisez « Nouveau compte » ci-dessus pour ajouter un compte bancaire, une épargne ou un placement.',


  /* ===================== shell chrome + Dashboard page ==================== */
  'shell.connect.title': 'Dossier du budget introuvable',
  'shell.connect.btn': 'Ouvrir les paramètres du plugin…',
  'shell.saveChanges': 'Enregistrer les modifications',
  'shell.dash.trend': 'Tendance des dépenses',
  'shell.dash.trendSub': 'Dépensé vs budget',
  'shell.dash.split': 'Où est passé l\'argent',
  'shell.dash.vsActual': 'Budget vs réel',
  'shell.dash.position': 'Où vous en êtes',
  'shell.legend.spent': 'Dépensé',
  'shell.legend.over': 'Au-dessus du budget',
  'shell.legend.income': 'Revenus',
  'shell.legend.budget': 'Budget',
  'shell.tx.search': 'Rechercher une description…',
  'shell.tx.wholeHistory': 'tout l\'historique',
  'shell.tx.export': 'Exporter',
  'shell.tx.add': 'Ajouter une transaction',
  'shell.bud.title': 'Budgets par catégorie',
  'shell.bud.copyPrev': 'Copier la période précédente',
  'shell.bud.save': 'Enregistrer le budget',

  'dash.greet.morning': 'Bonjour',
  'dash.greet.afternoon': 'Bon après-midi',
  'dash.greet.evening': 'Bonsoir',
  'dash.greet.line': '{greeting}, {name}',
  'dash.hero.remaining': 'Reste sur cette période',
  'dash.hero.overspent': 'Dépassement sur cette période',
  'dash.hero.sub': '{spent} dépensé sur {budgeted} budgété',
  'dash.stat.income': 'Revenus totaux',
  'dash.stat.budgeted': 'Budgété',
  'dash.stat.spent': 'Total dépensé',
  'dash.stat.uncategorised': 'Sans catégorie',
  'dash.stat.allocated': '{pct}% affecté',
  'dash.stat.used': '{pct}% utilisé',
  'dash.stat.review': 'à vérifier dans Transactions',

  'dash.col.category': 'Catégorie',
  'dash.col.budget': 'Budget',
  'dash.col.spent': 'Dépensé',
  'dash.col.remaining': 'Restant',
  'dash.table.empty': 'Aucun budget ni transaction sur cette période pour l\'instant.',

  'dash.pos.sub': 'À ce jour — ces chiffres ne suivent pas la période ci-dessus',
  'dash.pos.netWorth': 'Valeur nette',
  'dash.pos.netWorthSub': '{owned} détenu · {owed} dû',
  'dash.pos.netWorthSay': 'Valeur nette {net} — {owned} détenu face à {owed} dû. Ouvrir Épargne et placements.',
  'dash.pos.debt': 'Dettes',
  'dash.pos.debtSplit': '{accounts} sur des comptes · {debts} sur la page Dettes',
  'dash.pos.debtActive': { one: '{count} active', other: '{count} actives' },
  'dash.pos.debtAccounts': { one: 'tout sur {count} compte', other: 'tout sur {count} comptes' },
  'dash.pos.debtNone': 'rien de dû',
  'dash.pos.debtSay': 'Dettes de {amount}. Ouvrir la page Dettes.',
  'dash.pos.debtSayNone': 'Aucune dette. Ouvrir la page Dettes.',
  'dash.pos.owed': 'On vous doit',
  'dash.pos.owedOpen': {
    one: '{count} en attente',
    other: '{count} en attente',
  },
  'dash.pos.owedOldest': {
    one: ' · la plus ancienne depuis {days} jour',
    other: ' · la plus ancienne depuis {days} jours',
  },
  'dash.pos.owedRecovered': '{amount} récupéré',
  'dash.pos.owedNone': 'rien de prêté',
  'dash.pos.owedSay': {
    one: '{amount} vous est dû sur {count} entrée. Ouvrir Sommes dues.',
    other: '{amount} vous est dû sur {count} entrées. Ouvrir Sommes dues.',
  },
  'dash.pos.owedSayNone': 'Rien en attente. Ouvrir Sommes dues.',
  'dash.pos.savings': 'Épargne et placements',
  'dash.pos.savingsSub': '{savings} d\'épargne · {invested} investi',
  'dash.pos.savingsSay': '{amount} en épargne et placements. Ouvrir Épargne et placements.',

  'dash.overlap': 'Comptes de carte suivis : {accounts} · dettes de carte suivies : {debts} — si une carte figure dans les deux, elle est comptée deux fois ci-dessus.',
  'dash.overlap.btn': 'Vérifier les dettes',
  'dash.overlap.aria': 'Vérifier les dettes suivies sur la page Dettes',
  'dash.stale.noDate': 'aucun ne porte de date',
  'dash.stale.oldest': {
    one: 'le plus ancien il y a {days} jour',
    other: 'le plus ancien il y a {days} jours',
  },
  'dash.stale.all': { one: 'Construit à partir d\'un solde que personne n\'a confirmé récemment', other: 'Construit à partir de {count} soldes que personne n\'a confirmés récemment' },
  'dash.stale.some': 'Construit à partir de {stale} soldes sur {total} que personne n\'a confirmés récemment',
  'dash.stale.line': '{line} — {age}.',
  'dash.stale.driftUp': ' Les opérations depuis impliquent {amount} de plus.',
  'dash.stale.driftDown': ' Les opérations depuis impliquent {amount} de moins.',
  'dash.stale.btn': 'Vérifier les soldes',
  'dash.stale.aria': 'Vérifier les soldes des comptes sur la page Comptes',

  'dash.range.all': 'Tout',
  'dash.trend.range': 'Plage de la tendance des dépenses',
  'dash.trend.sub': { one: 'Dépensé vs budget · {count} période', other: 'Dépensé vs budget · {count} périodes' },
  'dash.trend.clamped': ' · tout l\'historique importé jusqu\'ici',
  'dash.trend.empty': 'Importez une deuxième période de transactions et la courbe de tendance démarre ici.',
  'dash.trend.aria': {
    one: 'Dépensé, budgété et revenus sur {count} période',
    other: 'Dépensé, budgété et revenus sur les {count} dernières périodes',
  },
  'dash.trend.tip.over': '{amount} au-dessus du budget',
  'dash.trend.tip.under': '{amount} en dessous du budget',

  'dash.split.uncatNote': ' · {amount} sans catégorie, non affiché',
  'dash.split.nettedNote': ' · {amount} de remboursements déduits',
  'dash.split.onlyUncat': '{amount} sont sortis sur cette période, mais rien n\'est encore catégorisé — mettez des catégories dans Transactions et la répartition apparaîtra ici.',
  'dash.split.empty': 'Rien n\'est encore catégorisé comme dépense sur cette période.',
  'dash.split.aria': 'Répartition des dépenses pour {month} : ',
  'dash.split.sliceAria': '{cat} : {amount}, {pct}% des dépenses — afficher les transactions',
  'dash.split.noteAria': 'Ouvrir la note de la catégorie {cat}',
  'dash.split.noteMissing': 'Aucune note de catégorie trouvée pour « {cat} »',

  /* --------------------- what's left + comparison ------------------- */
  'shell.dash.left': 'Ce qu’il reste',
  'dash.left.sub': 'Avant la fin de cette période, le {date}',
  'dash.left.cash': 'sur tes comptes',
  'dash.left.committed': 'encore engagé',
  'dash.left.free': 'vraiment libre',
  'dash.left.short': 'manquant',
  'dash.left.counted': {
    one: '{count} compte',
    other: '{count} comptes',
  },
  'dash.left.unconfirmed': '{count} non confirmé',
  'dash.left.undated': '{count} sans date de solde',
  'dash.left.orders': {
    one: '{count} prélèvement',
    other: '{count} prélèvements',
  },
  'dash.left.instalments': {
    one: '{count} mensualité de dette',
    other: '{count} mensualités de dette',
  },
  'dash.left.cards': {
    one: '{count} solde de carte',
    other: '{count} soldes de carte',
  },
  'dash.left.none': 'rien de prévu',
  'dash.left.cardDue': 'carte à régler',
  'dash.left.cycle': '{spend} sur la carte ce cycle, sur les {settling} qui la règlent',
  'dash.left.cycleAria': 'Dépenses carte {spend} face à {settling} de revenu de règlement, {pct} pour cent',
  'dash.left.cycleUnder': '{amount} de marge avant le règlement du {date}.',
  'dash.left.cycleOver': '{amount} de PLUS que le revenu qui la règle le {date}.',
  'dash.left.incoming': '{amount} arrive le {date}',
  'dash.left.incomingCovers': 'Cela couvre tout ce qui précède et laisse environ {amount}.',
  'dash.left.incomingShort': 'Même après cela, il vous manque {amount}.',
  'dash.left.days': {
    one: '{count} jour',
    other: '{count} jours',
  },
  'dash.left.perDay': '{amount}/jour',
  'dash.left.barAria': 'Sur {cash}, {committed} est engagé et {free} est libre',
  'dash.left.owedCard': '{amount} sont dus sur {name} — déjà dépensés, et déduits d\'aucun chiffre ci-dessus.',
  'dash.left.owedCards': '{amount} sont dus sur {count} cartes de crédit — déjà dépensés, et déduits d\'aucun chiffre ci-dessus.',
  'dash.left.whatsCounted': 'Ce qui compte comme engagé',
  'dash.left.expected': 'prévu le {date}',
  'dash.left.thisPeriod': 'dû cette période',
  'dash.left.lastCharged': 'dernier prélèvement {amount}',
  'dash.left.asListed': 'tel qu’indiqué, sans historique',
  'dash.left.settledInFull': 'soldée intégralement, solde actuel',
  'dash.left.contracted': 'mensualité contractuelle',
  'dash.left.source': 'Les montants correspondent à ce qui a réellement été prélevé, pas au chiffre saisi sur la page Services. Lus uniquement depuis ta liste de Services et la page Dettes — un prélèvement récurrent absent des deux n’est pas compté ici.',
  'dash.split.colCat': 'Catégorie',
  'dash.split.colSpent': 'Dépensé',
  'dash.split.colChange': 'Écart',
  'dash.split.new': 'nouveau',
  'dash.split.r1m': 'Mois dernier',
  'dash.split.rPrev': 'Préc.',
  'dash.split.rangeAria': 'Période de comparaison',
  'dash.split.likeForLike': {
    one: 'Cette période a {count} jour, la colonne {range} ne compte donc que le premier jour de chaque période précédente. À périmètre égal — ce n\'est pas la moyenne d\'une période complète.',
    other: 'Cette période a {count} jours, la colonne {range} ne compte donc que les {count} premiers jours de chaque période précédente. À périmètre égal — ce n\'est pas la moyenne d\'une période complète.',
  },

  'dash.err.render': 'Impossible de dessiner {label} — {error}',

};
