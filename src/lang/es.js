'use strict';
/* Español.

   Checked against src/lang/en.js at build time — same key set, no more, no
   fewer. Add a string to en.js first, then translate it here.

   Conventions used throughout:
     - "Budget Vault" is the product name and stays untranslated. "bóveda" is
       the vault, matching Obsidian's own Spanish locale.
     - Informal "tú", matching Obsidian's Spanish locale and this plugin's
       conversational English.
     - Spanish takes the plural at 0, same as English, so plural entries use the
       ordinary one/other split.
     - Date placeholders are localised: AAAA-MM-DD, not YYYY-MM-DD.
     - Angular quotes «» are the Spanish convention, not "". */

module.exports = {
  /* ------------------------------- splash -------------------------------- */
  'splash.sub': 'Tu presupuesto privado, guardado de forma segura dentro de tu bóveda.',
  'splash.enter': 'Abrir presupuesto',

  /* -------------------------------- drawer -------------------------------- */
  'nav.menu': 'Menú',
  'nav.close': 'Cerrar menú',
  'nav.section.budget': 'Presupuesto',
  'nav.section.accounts': 'Cuentas',
  'nav.section.tools': 'Herramientas',

  'nav.dashboard': 'Panel',
  'nav.transactions': 'Transacciones',
  'nav.budgets': 'Presupuesto',
  'nav.savings': 'Ahorros e inversiones',
  'nav.accounts': 'Cuentas',
  'nav.assets': 'Activos',
  'nav.debts': 'Deudas',
  'nav.owed': 'Dinero adeudado',
  'nav.services': 'Servicios',
  'nav.tax': 'Impuestos',
  'nav.loans': 'Calculadoras de préstamos',
  'nav.import': 'Importar CSV',
  'nav.reload': 'Recargar desde el disco',
  'nav.pluginSettings': 'Ajustes del plugin',

  /* -------------------------------- topbar -------------------------------- */
  'topbar.nav': 'Navegación del presupuesto',
  'topbar.mainMenu': 'Menú principal',
  'topbar.openMenu': 'Abrir el menú de navegación',
  'topbar.home': 'Ir al Panel',
  'topbar.brandSub': 'Presupuesto en la bóveda de Obsidian',
  'topbar.periodNav': 'Navegación por periodos',
  'topbar.prevPeriod': 'Periodo anterior',
  'topbar.currentPeriod': 'Ir al periodo actual',
  'topbar.nextPeriod': 'Periodo siguiente',
  'topbar.import': 'Importar CSV',
  'topbar.importTitle': 'Importar un extracto bancario en CSV',
  'topbar.settings': 'Abrir los ajustes del presupuesto',

  /* ------------------------------- settings -------------------------------- */
  'settings.folder.name': 'Carpeta del presupuesto',
  'settings.folder.desc': 'Ruta en la bóveda de la carpeta que contiene Categories/, Accounts/, Budgets/, Transactions/, Settings.md, etc.',

  'settings.theme.name': 'Tema',
  'settings.theme.desc': 'Seguir el modo claro/oscuro de Obsidian, o forzar la paleta Airy Glass clara u oscura.',
  'settings.theme.auto': 'Seguir a Obsidian',
  'settings.theme.dark': 'Siempre oscuro',
  'settings.theme.light': 'Siempre claro',

  'settings.palette.name': 'Paleta de colores',
  'settings.palette.desc': 'Con qué colores se dibuja el presupuesto. Cada paleta tiene su propia versión clara y oscura, así que es independiente del ajuste Tema de arriba.',

  'settings.wizard.name': 'Asistente de configuración',
  'settings.wizard.desc': 'Volver a ejecutar el asistente de primer uso — carpeta, nombre, periodo del presupuesto, moneda, archivos iniciales.',
  'settings.wizard.button': 'Ejecutar el asistente',

  'settings.startup.name': 'Abrir al iniciar',
  'settings.startup.desc': 'Abrir la vista del presupuesto automáticamente cuando Obsidian arranca.',

  'settings.privacy.name': 'Pantalla de privacidad',
  'settings.privacy.desc': 'Cubrir el presupuesto con una pantalla hasta que toques «Abrir presupuesto» — al abrirlo, y de nuevo cada vez que Obsidian pase a segundo plano. No se lee nada de la bóveda hasta que toques.',

  'settings.feedback.name': 'Enviar comentarios',
  'settings.feedback.desc': 'Informar de un error, señalar un problema o pedir una función. Abre un formulario de Google en tu navegador — no se adjunta ni se envía nada de tu presupuesto.',
  'settings.feedback.button': 'Abrir el formulario',

  'settings.support.name': 'Apoyar a Budget Vault',
  'settings.support.desc': 'Budget Vault es gratuito y siempre lo será. Si quieres dar las gracias, esto abre PayPal en tu navegador — totalmente opcional, y en el plugin no cambia nada de una forma u otra.',
  'settings.support.button': 'Enviar un agradecimiento',

  'settings.data.name': 'Datos del presupuesto',
  'settings.data.desc': 'Guardados en Settings.md dentro de la carpeta del presupuesto, para que se apliquen en todos los dispositivos.',

  'settings.household.name': 'Nombre / hogar',
  'settings.household.desc': 'Se muestra en el saludo del panel y en la barra superior. Déjalo en blanco para ninguno.',
  'settings.household.placeholder': 'Déjalo en blanco para ninguno',

  'settings.monthStart.name': 'Día de inicio del mes',
  'settings.monthStart.desc': 'Día del mes en que empieza cada periodo financiero — normalmente tu día de pago. Elige 1 para un mes natural corriente. 1–28.',
  'settings.monthStart.invalid': 'Elige un día entre 1 y 28.',

  'settings.periodLength.name': 'Duración del periodo',
  'settings.periodLength.desc': 'Cuánto dura cada periodo del presupuesto. «Mensual» usa el día de inicio del mes de arriba. Las demás opciones alinean los periodos con un ciclo de pago, contando desde la fecha de abajo.',

  'settings.anchor.name': 'Último día de pago',
  'settings.anchor.desc': '¿Cuándo te pagaron por última vez? Sirve cualquier día de pago reciente — solo importa el día en que cae dentro del ciclo, así que uno anterior o posterior da el mismo resultado. Se ignora cuando la duración del periodo es mensual.',
  'settings.anchor.invalid': 'Usa una fecha real con el formato AAAA-MM-DD, p. ej. 2026-08-07.',

  'settings.country.name': 'País',
  'settings.country.desc': 'Determina el formato de los importes, el orden de las fechas en los extractos bancarios y la lista de comprobación de la vista Impuestos (adaptada a la agencia tributaria de tu país). Los años fiscales existentes conservan sus datos — solo cambian las etiquetas y los valores iniciales de los años nuevos. Independiente del idioma de la interfaz de abajo.',

  'settings.language.name': 'Idioma',
  'settings.language.desc': 'El idioma en que está escrita la interfaz. Independiente del País de arriba — vivir en un sitio no decide qué quieres leer. Por defecto sigue el idioma de Obsidian, con el inglés como alternativa. Tu propio texto del presupuesto — nombres de categorías, notas, nombres de cuentas — nunca se traduce.',

  'settings.currency.name': 'Símbolo de moneda',
  'settings.currency.desc': 'Se muestra delante de cada importe, p. ej. R.',
  'settings.currency.invalid': 'Introduce un símbolo de moneda.',

  /* ------------------------- settings notices ------------------------------ */
  'settings.budgetsKept': {
    one: 'Presupuesto: tu {count} archivo de presupuesto existente permanece en la bóveda. No puede mostrarse con esta duración de periodo, y vuelve enseguida si la cambias de nuevo.',
    other: 'Presupuesto: tus {count} archivos de presupuesto existentes permanecen en la bóveda. No pueden mostrarse con esta duración de periodo, y vuelven enseguida si la cambias de nuevo.',
  },
  'settings.anchorReslices': {
    one: 'Presupuesto: esto desplaza cada límite de periodo. {count} archivo de presupuesto con nombre de fecha dejará de coincidir — permanece en tu bóveda, y volver a poner esta fecha en {prev} lo trae enseguida de vuelta.',
    other: 'Presupuesto: esto desplaza cada límite de periodo. {count} archivos de presupuesto con nombre de fecha dejarán de coincidir — permanecen en tu bóveda, y volver a poner esta fecha en {prev} los trae enseguida de vuelta.',
  },
  'settings.dateNotReal': 'Presupuesto: «{value}» no es una fecha — usa el selector, o escribe AAAA-MM-DD.',

  /* ============================ setup wizard ============================== */
  'wiz.title': 'Configurar Budget Vault',
  'wiz.stepOf': 'Paso {n} de {total}',
  'wiz.cancel': 'Cancelar',
  'wiz.back': 'Atrás',
  'wiz.next': 'Siguiente',
  'wiz.letsGo': '¡Vamos!',
  'wiz.connectBtn': 'Conectar presupuesto',
  'wiz.createBtn': 'Crear mi presupuesto',
  'wiz.skipped': 'Configuración omitida — puedes volver a ejecutarla desde Ajustes → Budget Vault → Ejecutar el asistente, o desde la paleta de comandos.',

  'wiz.step.folder': 'Dónde vive tu presupuesto',
  'wiz.step.name': '¿Cómo te llamamos?',
  'wiz.step.country': 'Idioma, país y moneda',
  'wiz.step.period': 'Tu periodo de presupuesto',
  'wiz.step.categories': 'Tus categorías de presupuesto',
  'wiz.step.account': 'Tu primera cuenta',
  'wiz.step.finish': 'Todo listo',

  'wiz.err.folder': 'Introduce una ruta de carpeta para el presupuesto — por ejemplo Finances/Budget.',
  'wiz.err.monthStart': 'El día de inicio del mes debe estar entre 1 y 28. No todos los meses tienen 29, 30 o 31, así que si te pagan el último día del mes, usa 28.',
  'wiz.err.anchor': 'Introduce la fecha en que te pagaron por última vez — cada ciclo de pago se cuenta desde ahí, así que sin ella el presupuesto vuelve a periodos mensuales.',
  'wiz.err.currency': 'Introduce un símbolo de moneda, o elige uno de la lista de arriba.',

  /* ---- welcome ---- */
  'wiz.welcome.title': '¡Bienvenido a Budget Vault!',
  'wiz.welcome.intro': 'Todo tu presupuesto, viviendo aquí mismo en tu bóveda como markdown simple — sin cuentas, sin nube, sin el servidor de nadie más. Si tu bóveda se sincroniza con tu móvil, tu presupuesto viaja con ella gratis.',
  'wiz.welcome.planLead': 'Este es el plan — este asistente te deja listo:',
  'wiz.welcome.plan1': 'Elige tu carpeta de presupuesto — montamos toda la estructura por ti',
  'wiz.welcome.plan2': 'Elige idioma, país y moneda — para que la app se lea bien y los importes, fechas e impuestos tengan buen aspecto',
  'wiz.welcome.plan3': 'Dinos cuándo cobras — tus periodos pueden ir de día de pago a día de pago',
  'wiz.welcome.plan4': 'Elige tus categorías — marca las que encajen con tu vida',
  'wiz.welcome.plan5': 'Añade tu primera cuenta — y lo que hay en ella ahora mismo',
  'wiz.welcome.thenLead': 'Y entonces empieza lo bueno dentro de la app:',
  'wiz.welcome.app1': 'Fija tu presupuesto — dale a cada categoría una cifra a la que apuntar',
  'wiz.welcome.app2': 'Importa el CSV de tu banco — las transacciones se ordenan solas a medida que le enseñas',
  'wiz.welcome.app3': 'Añade categorías nuevas cuando quieras — tu presupuesto crece contigo',
  'wiz.welcome.app4': 'Revisa sobre la marcha — el panel muestra exactamente adónde fue el dinero',
  'wiz.welcome.close': 'Unos dos minutos de configuración. Puedes cambiar cualquier cosa más tarde. ¿Listo?',

  /* ---- folder ---- */
  'wiz.folder.hint': 'Todo vive como archivos markdown simples dentro de una carpeta de tu bóveda.',
  'wiz.folder.blank': 'Introduce una ruta de carpeta — por ejemplo Finances/Budget.',
  'wiz.folder.found': 'Se encontró un presupuesto existente en «{folder}» — el asistente se conectará a él en vez de crear archivos nuevos.',
  'wiz.folder.exists': '«{folder}» ya existe — los archivos del presupuesto se añadirán dentro.',
  'wiz.folder.willCreate': '«{folder}» aún no existe — se creará por ti.',
  'wiz.folder.name': 'Carpeta del presupuesto',
  'wiz.folder.desc': 'Donde se guardan las categorías, cuentas, presupuestos y transacciones.',
  'wiz.folder.connected': 'Se encontró un presupuesto existente en «{folder}» — nos conectamos a él en vez de crear archivos nuevos. Tus categorías, cuentas y transacciones se quedan exactamente como están; los pasos restantes solo confirman los ajustes guardados en su Settings.md.',

  /* ---- name ---- */
  'wiz.name.name': 'Tu nombre o apodo',
  'wiz.name.desc': 'Se muestra en el saludo del panel y en la barra superior. Déjalo en blanco para omitirlo.',
  'wiz.name.placeholder': 'p. ej. Alex, o Los García',

  /* ---- language / country / currency ---- */
  'wiz.language.desc': 'El idioma en que está escrita la app. Independiente del país de abajo — dónde vives no decide qué quieres leer. Tu propio texto del presupuesto nunca se traduce.',
  'wiz.country.desc': 'Fija el formato de los importes, el orden de las fechas al leer extractos bancarios y la lista de comprobación de la vista Impuestos para la agencia tributaria de tu país.',
  'wiz.currency.desc': 'Se muestra delante de cada importe. Parte de tu país — cámbialo si presupuestas en otra cosa.',
  'wiz.currency.custom': 'Símbolo personalizado',
  'wiz.currency.customPlaceholder': 'p. ej. CHF',

  /* Currency NAMES for the wizard dropdown; the stored value is the symbol. */
  'wiz.ccy.rand': 'R — Rand sudafricano',
  'wiz.ccy.dollar': '$ — Dólar',
  'wiz.ccy.euro': '€ — Euro',
  'wiz.ccy.pound': '£ — Libra',
  'wiz.ccy.other': 'Otro…',

  /* ---- period ---- */
  'wiz.period.howOften': '¿Cada cuánto cobras?',
  'wiz.period.howOftenDesc': 'Los periodos mensuales se nombran por mes y empiezan el día que elijas abajo. Los demás se alinean con un ciclo de pago, contando desde tu último día de pago.',
  'wiz.period.startDay': '¿Qué día empieza tu mes de presupuesto?',
  'wiz.period.startDayDesc': 'Normalmente tu día de pago. Elige 1 para un mes natural corriente. (1–28)',
  'wiz.period.badDay': 'Elige un día del 1 al 28. No todos los meses tienen 29, 30 o 31, así que si te pagan el último día del mes, usa 28.',
  'wiz.period.calendarEg': 'Un mes natural corriente: cada periodo va del {first} al final del mes, y lleva el nombre de ese mes. Ahora mismo estás en {month}.',
  'wiz.period.paydayEg': 'Cada periodo va del {start} al {end} del mes siguiente, y lleva el nombre del mes en que termina. Ahora mismo estás en {month}.',
  'wiz.period.anchorBlank': 'Introduce la fecha en que te pagaron por última vez y los periodos se calculan a partir de ahí.',
  'wiz.period.anchorEg': 'Contando desde ahí, el periodo en el que estás ahora empezó el {date}. Los archivos de presupuesto se nombran por esa fecha de inicio.',
  'wiz.period.anchorName': '¿Cuándo te pagaron por última vez?',
  'wiz.period.anchorDesc': 'Vale cualquier día de pago reciente — solo importa dónde cae dentro del ciclo, así que uno anterior o posterior da los mismos periodos.',

  /* ---- categories ---- */
  'wiz.cats.intro': 'Empieza con un conjunto de categorías — desmarca las que no quieras. Puedes añadirlas, renombrarlas o cambiarles el color más tarde, así que aquí nada es definitivo.',
  'wiz.cats.selected': '{count} de {total} seleccionadas',
  'wiz.cats.selectAll': 'Seleccionar todas',
  'wiz.cats.selectNone': 'No seleccionar ninguna',

  'wiz.type.income': 'Ingresos',
  'wiz.type.expense': 'Gastos del día a día',
  'wiz.type.debt': 'Pago de deudas',
  'wiz.type.services': 'Servicios y suscripciones',
  'wiz.type.insurance': 'Seguros',
  'wiz.type.giving': 'Donaciones',
  'wiz.type.savings': 'Ahorros',
  'wiz.type.investment': 'Inversiones',
  'wiz.type.luxuries': 'Caprichos',
  'wiz.type.transfer': 'Transferencias',

  /* ---- first account ---- */
  'wiz.acct.intro': 'Las transacciones se guardan por cuenta. Añade ahora tu cuenta principal, o deja el nombre en blanco para omitirlo — puedes añadir cuentas en cualquier momento.',
  'wiz.acct.name': 'Nombre de la cuenta',
  'wiz.acct.namePlaceholder': 'p. ej. Cuenta corriente',
  'wiz.acct.type': 'Tipo',
  'wiz.acct.balance': 'Saldo actual',
  'wiz.acct.balanceDesc': 'Opcional — lo que hay en la cuenta ahora mismo.',
  'wiz.acct.balanceHint': 'Usa el saldo de cierre de tu último extracto, o lo que muestre la app de tu banco. El saldo es una instantánea que mantienes al día tú mismo — importar solo transacciones recientes nunca lo descuadra — y puedes cambiarlo cuando quieras tocando el saldo en la página Cuentas.',

  'acctType.checking': 'Cuenta corriente',
  'acctType.savings': 'Cuenta de ahorro',
  'acctType.credit_card': 'Tarjeta de crédito',
  'acctType.cash': 'Efectivo',
  'acctType.investment': 'Inversión',
  'acctType.other': 'Otra',

  /* ---- finish ---- */
  'wiz.sum.folder': 'Carpeta',
  'wiz.sum.name': 'Nombre',
  'wiz.sum.language': 'Idioma',
  'wiz.sum.country': 'País',
  'wiz.sum.period': 'Periodo del presupuesto',
  'wiz.sum.currency': 'Moneda',
  'wiz.sum.categories': 'Categorías',
  'wiz.sum.account': 'Primera cuenta',
  'wiz.sum.opening': 'Saldo inicial',
  'wiz.sum.catCount': {
    one: '{count} categoría inicial',
    other: '{count} categorías iniciales',
  },
  'wiz.sum.monthlyCalendar': 'Mensual (mes natural)',
  'wiz.sum.monthlyOn': 'Mensual, empezando el {day}',
  'wiz.sum.cycleFrom': '{preset}, contando desde {date}',
  'wiz.finish.connectLead': 'Conectando con la carpeta de presupuesto existente y guardando estos ajustes en su Settings.md:',
  'wiz.finish.createLead': 'Esto creará la carpeta del presupuesto con Settings.md, tus categorías, el primer archivo de presupuesto y archivos vacíos de Owed Money / Services:',
  'wiz.finish.nextLead': 'Qué hacer ahora: ',
  'wiz.finish.nextBody': 'dale un importe a tus categorías en la página Presupuestos, y luego importa el CSV de tu banco en la página Transacciones.',
  'wiz.finish.privacy': 'Tu presupuesto se abre tras una pantalla de privacidad que requiere un toque, así que no queda nada a la vista si alguien echa un vistazo a tu bóveda. Desactívala en Ajustes → Budget Vault → Pantalla de privacidad.',

  'wiz.done.connected': 'Conectado a tu carpeta de presupuesto.',
  'wiz.done.created': 'Carpeta de presupuesto creada — ¡bienvenido!',
  'wiz.failed': 'La configuración falló: {error}',

  /* ============================== Budget page ============================= */
  'bud.shape.title': 'Tus otros presupuestos siguen aquí',
  'bud.shape.body': {
    one: '{count} archivo de presupuesto está guardado con otra duración de periodo — es Budgets/{newest}.md. Permanece en tu bóveda y vuelve en cuanto restablezcas la duración. Los importes empiezan en blanco aquí porque este periodo no tiene la misma duración que aquel.',
    other: '{count} archivos de presupuesto están guardados con otra duración de periodo — el más reciente es Budgets/{newest}.md. Permanecen en tu bóveda y vuelven en cuanto restablezcas la duración. Los importes empiezan en blanco aquí porque este periodo no tiene la misma duración que aquellos.',
  },
  'bud.shape.bring': 'Traer las categorías y notas de {newest}',
  'bud.shape.empty': 'Ese presupuesto está vacío',
  'bud.shape.brought': {
    one: 'Se trajo {count} categoría — pon el importe para este periodo',
    other: 'Se trajeron {count} categorías — pon los importes para este periodo',
  },
  'bud.shape.allHere': 'Todas las categorías de ese presupuesto ya están aquí',
  'bud.shape.bringAmounts': 'Traer también los importes…',
  'bud.shape.broughtAmounts': {
    one: 'Se trajo {count} importe — revísalo y luego guarda',
    other: 'Se trajeron {count} importes — revísalos y luego guarda',
  },

  'bud.total.income': 'Ingresos totales',
  'bud.total.incomeNote': '{amount} recibido hasta ahora',
  'bud.total.budgeted': 'Total presupuestado',
  'bud.total.budgetedNote': '{pct}% de los ingresos presupuestados',
  'bud.total.over': 'Presupuestado de más',
  'bud.total.overNote': 'presupuestado por encima de los ingresos',
  'bud.total.left': 'Por presupuestar',
  'bud.total.leftNote': 'ingresos aún sin asignar',
  'bud.total.spent': 'Total gastado',
  'bud.total.spentNote': '{pct}% del presupuesto usado',

  'bud.col.category': 'Categoría',
  'bud.col.type': 'Tipo',
  'bud.col.amount': 'Importe',
  'bud.col.actual': 'Real hasta ahora',
  'bud.col.notes': 'Notas',

  'bud.remaining.over': '{amount} de más',
  'bud.remaining.left': '{amount} restante',

  'bud.aria.amount': 'Importe presupuestado para {category}',
  'bud.aria.notes': 'Notas de {category}',
  'bud.aria.clear': 'Vaciar el presupuesto de {category}',
  'bud.title.clear': 'Quitar esta categoría del archivo del periodo',
  'bud.aria.delete': 'Eliminar la categoría {category}',
  'bud.title.delete': 'Eliminar esta categoría en todas partes',

  'bud.saved': 'Presupuesto guardado en Budgets/{period}.md',
  'bud.copy.none': 'No se encontró presupuesto del periodo anterior',
  'bud.copy.done': {
    one: 'Copiada {count} categoría del periodo anterior',
    other: 'Copiadas {count} categorías del periodo anterior',
  },
  'bud.copy.nothing': 'Nada que copiar — todas las categorías ya tienen un valor',


  /* =========================== Transactions page ========================== */
  'tx.wholeHistory': 'Todo el historial',
  'tx.allAccounts': 'Todas las cuentas',
  'tx.allCategories': 'Todas las categorías',
  'tx.uncategorised': 'Sin categoría',
  'tx.count.window': {
    one: '{shown} de {total} fila',
    other: '{shown} de {total} filas',
  },
  'tx.count.all': { one: '{count} fila', other: '{count} filas' },

  'tx.col.date': 'Fecha',
  'tx.col.desc': 'Descripción',
  'tx.col.account': 'Cuenta',
  'tx.col.category': 'Categoría',
  'tx.col.amount': 'Importe',
  'tx.col.excl': 'Excl.',
  'tx.col.note': 'Nota',
  'tx.col.split': 'Dividir',

  'tx.aria.category': 'Categoría de {date} {desc}',
  'tx.aria.exclude': 'Excluir {desc} de los totales del presupuesto',
  'tx.aria.note': 'Nota de {date} {desc}',
  'tx.aria.split': 'Dividir {date} {desc} en categorías',
  'tx.title.split': 'Dividir en categorías',

  'tx.none': 'Ninguna transacción coincide.',
  'tx.showMore': {
    one: 'Mostrar {n} más de {remaining} restante',
    other: 'Mostrar {n} más de {remaining} restantes',
  },

  'tx.split.zero': 'Una línea con importe cero no tiene nada que dividir',
  'tx.split.excluded': 'Esta línea ya está excluida — desmárcala primero',
  'tx.split.marker': 'Dividida en {n}',
  'tx.split.done': 'Dividida en {n} — revisa y luego guarda los cambios',

  'tx.add.noAccount': 'Añade una cuenta primero — cada transacción pertenece a una',
  'tx.add.title': 'Añadir transacción',
  'tx.field.date': 'Fecha',
  'tx.field.desc': 'Descripción',
  'tx.field.descPlaceholder': 'p. ej. Efectivo — verduras en el mercado',
  'tx.field.account': 'Cuenta',
  'tx.field.direction': 'Dirección',
  'tx.dir.out': 'Dinero que sale',
  'tx.dir.in': 'Dinero que entra',
  'tx.field.amount': 'Importe',
  'tx.field.amountDesc': 'Siempre positivo — la dirección pone el signo',
  'tx.field.category': 'Categoría',
  'tx.field.none': '— ninguna —',
  'tx.field.note': 'Nota',
  'tx.field.notePlaceholder': 'opcional',

  'tx.err.date': 'La fecha debe ser AAAA-MM-DD',
  'tx.err.desc': 'La descripción es obligatoria',
  'tx.err.account': 'Nombre de cuenta no válido',
  'tx.err.amount': 'El importe debe ser un número distinto de 0',
  'tx.err.save': 'No se pudo guardar la transacción ({error})',

  'tx.saved': { one: '{count} archivo guardado', other: '{count} archivos guardados' },
  'tx.savedLearned': { one: ' · aprendida {count} regla nueva', other: ' · aprendidas {count} reglas nuevas' },

  'tx.export.dirty': 'Guarda tus cambios primero — una exportación con ediciones sin guardar no coincidiría con la bóveda',
  'tx.export.empty': 'Nada que exportar — ninguna fila coincide con los filtros actuales',
  'tx.export.title': 'Exportar transacciones',
  'tx.export.folder': 'Guardar en la carpeta',
  'tx.export.desc': {
    one: 'Carpeta de la bóveda para la exportación. {count} fila ({range}) más {cats} categorías, como CSV y markdown.',
    other: 'Carpeta de la bóveda para la exportación. {count} filas ({range}) más {cats} categorías, como CSV y markdown.',
  },
  'tx.export.failed': 'No se pudo escribir la exportación — revisa el nombre de la carpeta',
  'tx.export.done': {
    one: 'Exportada {count} fila y {cats} categorías a {path}/',
    other: 'Exportadas {count} filas y {cats} categorías a {path}/',
  },


  /* ============================= Accounts page ============================ */
  'acct.group.bank': 'Cuentas bancarias',
  'acct.group.savings': 'Ahorros',
  'acct.group.investments': 'Inversiones',
  'acct.group.other': 'Otras',
  'acct.group.count': { one: '{count} cuenta', other: '{count} cuentas' },

  'acct.noteMissing': 'No se encontró Accounts/{name}.md',
  'acct.balance.title': 'Actualizar saldo — {name}',
  'acct.balance.field': 'Nuevo saldo',
  'acct.balance.updated': 'Saldo de {name} actualizado',
  'acct.reconciled': '{name} conciliada a {amount}',
  'acct.err.nan': 'No es un número',
  'acct.err.type': 'Tipo no válido',
  'acct.err.notNumber': '{field} no es un número',
  'acct.err.nameRequired': 'El nombre de la cuenta es obligatorio',
  'acct.err.exists': 'La cuenta ya existe',

  'acct.edit.title': 'Editar cuenta — {name}',
  'acct.new.title': 'Nueva cuenta',
  'acct.field.name': 'Nombre de la cuenta',
  'acct.field.type': 'Tipo',
  'acct.field.institution': 'Entidad',
  'acct.field.number': 'Número de cuenta',
  'acct.field.numberDesc': 'Sirve para asociar un extracto descargado a esta cuenta al importarlo.',
  'acct.field.folder': 'Carpeta de transacciones',
  'acct.field.folderDesc': 'Déjalo en blanco para usar «{name}». Ponlo solo cuando la carpeta bajo Transactions/ tenga otro nombre.',
  'acct.field.counts': 'Se cuenta en el presupuesto',
  'acct.counts.yes': 'Sí — cuenta de gasto normal',
  'acct.counts.no': 'No — envoltorio de inversión o ahorro',
  'acct.field.countsDesc': 'Elige No para una cuenta cuyos intereses no son ingresos del hogar y cuyas aportaciones no son gasto del hogar. Sus transacciones se siguen importando y se ven en Transacciones.',
  'acct.field.limit': 'Límite de crédito',
  'acct.field.limitDesc': 'Muestra una barra de uso en las tarjetas de crédito.',
  'acct.field.balance': 'Saldo actual',
  'acct.field.goal': 'Objetivo de ahorro',
  'acct.field.goalOpt': 'Objetivo de ahorro (opcional)',
  'acct.field.goalOptDesc': 'Muestra una barra de progreso en Ahorros e inversiones.',
  'acct.field.goalDate': 'Fecha objetivo',
  'acct.field.monthly': 'Aportación mensual',
  'acct.field.invested': 'Total invertido',
  'acct.field.investedOpt': 'Total invertido (opcional)',
  'acct.field.investedDesc': 'Lo que has puesto, para poder mostrar el crecimiento frente a ello.',
  'acct.field.starting': 'Importe inicial',
  'acct.field.opened': 'Abierta el',

  'acct.budget.on': '{name} vuelve a contar para el presupuesto',
  'acct.budget.off': '{name} ya no cuenta para los totales del presupuesto',

  'acct.creditUsed': 'Crédito usado',
  'acct.creditOf': '{used} de {limit}',
  'acct.overLimit': '{amount} por encima del límite',
  'acct.utilised': '{pct}% usado · {available} disponible',

  'acct.kpi.inCredit': 'A favor',
  'acct.kpi.overdrawn': 'En descubierto',
  'acct.kpi.netWorth': 'Patrimonio neto',
  'acct.kpi.netWorthNote': 'solo de estas cuentas',
  'acct.kpi.attention': 'Requiere atención',
  'acct.kpi.attentionNote': 'saldos sin verificar o desviados',
  'acct.kpi.allGood': 'todos los saldos cuadran',

  'acct.aria.showTx': 'Mostrar las transacciones de {name}',
  'acct.aria.balance': 'Saldo de {name}, {amount} — haz clic para actualizar',
  'acct.limitSuffix': ' · límite {amount}',
  'acct.monthlySuffix': ' · {amount}/mes',

  'acct.badge.notInBudget': 'fuera del presupuesto',
  'acct.badge.noTx': 'sin transacciones',
  'acct.badge.asOf': 'a fecha de {date}',
  'acct.badge.neverConfirmed': 'nunca confirmado',
  'acct.badge.unconfirmed': { one: 'sin confirmar desde hace {count} día', other: 'sin confirmar desde hace {count} días' },

  'acct.act.in': ' entra · ',
  'acct.act.out': ' sale · ',
  'acct.act.count': { one: '{count} transacción en {month}', other: '{count} transacciones en {month}' },

  'acct.recon.since': { one: '{count} transacción desde entonces · implica ', other: '{count} transacciones desde entonces · implica ' },
  'acct.recon.pending': {
    one: ' · {count} con fecha futura, aún sin contar',
    other: ' · {count} con fecha futura, aún sin contar',
  },
  'acct.recon.useThis': 'Usar este',
  'acct.aria.useThis': 'Poner el saldo de {name} en {amount}',
  'acct.recon.matches': 'Coincide con tus transacciones',
  'acct.recon.upToDate': { one: 'Al día · {count} transacción con fecha futura', other: 'Al día · {count} transacciones con fecha futura' },
  'acct.recon.setDate': 'Pon una fecha de saldo para contrastarlo con tus transacciones',

  'acct.foot.updated': 'actualizado {date}',
  'acct.foot.noDate': 'sin fecha de saldo',
  'acct.aria.exclude': 'Dejar de contar {name} en los totales del presupuesto',
  'acct.aria.include': 'Volver a contar {name} en los totales del presupuesto',
  'acct.btn.exclude': 'Excluir del presupuesto',
  'acct.btn.include': 'Incluir en el presupuesto',
  'acct.aria.edit': 'Editar {name}',
  'acct.btn.edit': 'Editar',
  'acct.aria.openNote': 'Abrir la nota de {name}',
  'acct.btn.openNote': 'Abrir nota',
  'acct.empty': 'Aún no hay cuentas. Usa «Nueva cuenta» arriba para añadir una cuenta bancaria, un fondo de ahorro o una inversión.',


  /* ===================== shell chrome + Dashboard page ==================== */
  'shell.connect.title': 'No se encontró la carpeta del presupuesto',
  'shell.connect.btn': 'Abrir los ajustes del plugin…',
  'shell.saveChanges': 'Guardar cambios',
  'shell.dash.trend': 'Tendencia de gasto',
  'shell.dash.trendSub': 'Gastado frente a presupuesto',
  'shell.dash.split': 'Adónde fue',
  'shell.dash.vsActual': 'Presupuesto frente a real',
  'shell.dash.position': 'Cómo estás',
  'shell.legend.spent': 'Gastado',
  'shell.legend.over': 'Por encima del presupuesto',
  'shell.legend.income': 'Ingresos',
  'shell.legend.budget': 'Presupuesto',
  'shell.tx.search': 'Buscar descripción…',
  'shell.tx.wholeHistory': 'todo el historial',
  'shell.tx.export': 'Exportar',
  'shell.tx.add': 'Añadir transacción',
  'shell.bud.title': 'Presupuestos por categoría',
  'shell.bud.copyPrev': 'Copiar el periodo anterior',
  'shell.bud.save': 'Guardar presupuesto',

  'dash.greet.morning': 'Buenos días',
  'dash.greet.afternoon': 'Buenas tardes',
  'dash.greet.evening': 'Buenas noches',
  'dash.greet.line': '{greeting}, {name}',
  'dash.hero.remaining': 'Queda en este periodo',
  'dash.hero.overspent': 'Gastado de más en este periodo',
  'dash.hero.sub': '{spent} gastado de {budgeted} presupuestado',
  'dash.stat.income': 'Ingresos totales',
  'dash.stat.budgeted': 'Presupuestado',
  'dash.stat.spent': 'Total gastado',
  'dash.stat.uncategorised': 'Sin categoría',
  'dash.stat.allocated': '{pct}% asignado',
  'dash.stat.used': '{pct}% usado',
  'dash.stat.review': 'revisar en Transacciones',

  'dash.col.category': 'Categoría',
  'dash.col.budget': 'Presupuesto',
  'dash.col.spent': 'Gastado',
  'dash.col.remaining': 'Restante',
  'dash.table.empty': 'Aún no hay presupuesto ni transacciones en este periodo.',

  'dash.pos.sub': 'Tal como está hoy — estas cifras no se mueven con el periodo de arriba',
  'dash.pos.netWorth': 'Patrimonio neto',
  'dash.pos.netWorthSub': '{owned} en propiedad · {owed} adeudado',
  'dash.pos.netWorthSay': 'Patrimonio neto {net} — {owned} en propiedad frente a {owed} adeudado. Abre Ahorros e inversiones.',
  'dash.pos.debt': 'Deuda',
  'dash.pos.debtSplit': '{accounts} en cuentas · {debts} en la página de deudas',
  'dash.pos.debtActive': { one: '{count} activa', other: '{count} activas' },
  'dash.pos.debtNone': 'nada adeudado',
  'dash.pos.debtSay': 'Deuda de {amount}. Abre la página Deudas.',
  'dash.pos.debtSayNone': 'Sin deudas. Abre la página Deudas.',
  'dash.pos.owed': 'Te deben',
  'dash.pos.owedOpen': {
    one: '{count} pendiente',
    other: '{count} pendientes',
  },
  'dash.pos.owedOldest': {
    one: ' · el más antiguo hace {days} día',
    other: ' · el más antiguo hace {days} días',
  },
  'dash.pos.owedRecovered': '{amount} recuperado',
  'dash.pos.owedNone': 'nada prestado',
  'dash.pos.owedSay': {
    one: '{amount} te deben en {count} entrada. Abre Dinero adeudado.',
    other: '{amount} te deben en {count} entradas. Abre Dinero adeudado.',
  },
  'dash.pos.owedSayNone': 'Nada pendiente. Abre Dinero adeudado.',
  'dash.pos.savings': 'Ahorros e inversiones',
  'dash.pos.savingsSub': '{savings} en ahorro · {invested} invertido',
  'dash.pos.savingsSay': '{amount} en ahorros e inversiones. Abre Ahorros e inversiones.',

  'dash.overlap': 'Cuentas de tarjeta registradas: {accounts} · deudas de tarjeta registradas: {debts} — si alguna tarjeta está en ambas, arriba se cuenta dos veces.',
  'dash.overlap.btn': 'Revisar deudas',
  'dash.overlap.aria': 'Revisar las deudas registradas en la página Deudas',
  'dash.stale.noDate': 'ninguno lleva fecha',
  'dash.stale.oldest': {
    one: 'el más antiguo hace {days} día',
    other: 'el más antiguo hace {days} días',
  },
  'dash.stale.all': { one: 'Construido a partir de un saldo que nadie ha confirmado últimamente', other: 'Construido a partir de {count} saldos que nadie ha confirmado últimamente' },
  'dash.stale.some': 'Construido a partir de {stale} de {total} saldos que nadie ha confirmado últimamente',
  'dash.stale.line': '{line} — {age}.',
  'dash.stale.btn': 'Revisar saldos',
  'dash.stale.aria': 'Revisar los saldos de las cuentas en la página Cuentas',

  'dash.trend.range': 'Rango de la tendencia de gasto',
  'dash.trend.sub': { one: 'Gastado frente a presupuesto · {count} periodo', other: 'Gastado frente a presupuesto · {count} periodos' },
  'dash.trend.clamped': ' · todo el historial importado hasta ahora',
  'dash.trend.empty': 'Importa un segundo periodo de transacciones y la línea de tendencia empieza aquí.',
  'dash.trend.aria': {
    one: 'Gastado, presupuestado e ingresos en {count} periodo',
    other: 'Gastado, presupuestado e ingresos en los últimos {count} periodos',
  },
  'dash.trend.tip.over': '{amount} por encima del presupuesto',
  'dash.trend.tip.under': '{amount} por debajo del presupuesto',

  'dash.split.uncatNote': ' · {amount} sin categoría, no mostrado',
  'dash.split.onlyUncat': 'Salieron {amount} en este periodo, pero nada está categorizado todavía — pon categorías en Transacciones y el reparto aparecerá aquí.',
  'dash.split.empty': 'Aún no hay nada categorizado como gasto en este periodo.',
  'dash.split.aria': 'Reparto del gasto de {month}: ',
  'dash.split.sliceAria': '{cat}: {amount}, {pct}% del gasto — mostrar transacciones',
  'dash.split.noteAria': 'Abrir la nota de la categoría {cat}',
  'dash.split.noteMissing': 'No se encontró nota de categoría para «{cat}»',

  'dash.err.render': 'No se pudo dibujar {label} — {error}',

};
