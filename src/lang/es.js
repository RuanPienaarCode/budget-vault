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
  'nav.savings': 'Ahorros e Inversiones',
  'nav.accounts': 'Cuentas',
  'nav.assets': 'Activos',
  'nav.debts': 'Deudas',
  'nav.owed': 'Dinero Adeudado',
  'nav.services': 'Servicios',
  'nav.tax': 'Impuestos',
  'nav.loans': 'Calculadoras de Préstamos',
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

  'wiz.acctType.checking': 'Cuenta corriente',
  'wiz.acctType.savings': 'Cuenta de ahorro',
  'wiz.acctType.credit_card': 'Tarjeta de crédito',
  'wiz.acctType.cash': 'Efectivo',
  'wiz.acctType.investment': 'Inversión',

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
};
