# The pay cycle is stored as a number of days, not a named type

Status: accepted

`period_days: 14` looks like a setting that wants to be an enum. It was one, briefly —
`period_type: fortnightly` — and that is the obvious shape. It was replaced deliberately,
and the reason is not visible from the code.

## Why

Any word we pick is somebody's second language, and there is nowhere to hide it.

- **"Fortnightly"** is idiomatic in `za`, `uk`, `au` and merely comprehensible in `us`, `ca`.
- **"Bi-weekly"** is idiomatic in `us`/`ca` and genuinely ambiguous — in American usage it
  means both *every two weeks* and *twice a week*. A budgeting app cannot afford a setting
  whose name leaves the user unsure whether their budget window is 7 days or 14.
- `locale.js` carries profiles for seven countries, but they cover tax authorities, banks,
  date order and currency — there is **no general UI vocabulary layer**. There is no seam to
  swap the word per country, so one word ships to everyone.

A number reads the same in every locale, needs no new vocabulary when a cycle is added, and
lets a household paid every ten days work without anyone having invented a name for it.

## Consequences

Storing a number lets a hand-edited `Settings.md` express far more nonsense than an enum
could — `period_days: 1`, `400`, `-14`, `banana`. So:

- `periodDaysOrZero` in `dates.js` bands it to 7–31 and is applied by the **loader**, on the
  way in, so the stored setting and the running one can never disagree. A settings control
  reading `S.settings.period_days` describes the cycle the app is actually running.
- Out-of-band values become `0` — the payday month — never the nearest legal number.
  Coercing `400` to `31` would invent a cycle nobody chose; falling back to the behaviour the
  user already had is the honest failure.
- `period_days` and `period_anchor` are dropped **together** whenever either is unusable. A
  cycle with no anchor has nothing to count from.

## The trap this exists to prevent

The presets in `constants.js` (`Every 2 weeks`, …) are labels over the number, not the
storage. Do not "tidy" them into the stored value. The map from label to day count is a
UI concern precisely so the day count can stay language-free — collapsing the two would put
a dialect back into every user's `Settings.md` and into the file format itself.
