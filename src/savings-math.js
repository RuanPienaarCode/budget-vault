'use strict';
/* Where a savings or investment balance actually came from.

   Every provider statement in the world reports the same shape:

     Opening + Contributions + Growth − Withdrawals = Closing

   and the app used to report `balance − total_invested`, calling the result
   growth. Those are only the same number while `total_invested` keeps pace with
   every contribution, and nothing makes it. A monthly debit order moves the
   balance and leaves the baseline where it was, so the difference grows by the
   contribution and is then presented as performance. Measured against four real
   accounts it was wrong on all four — most starkly on a tax-free account where
   contributions outweighed real growth by roughly twenty to one.

   So the split is DERIVED from the account's own transactions rather than
   recorded a second time by hand. A transfer into a fund already exists in the
   vault, dated and named; asking the reader to also type it into a
   `## Contributions` table would create a fourth hand-maintained ledger, and
   hand-maintained ledgers in this app die within three weeks of being created.
   See docs/adr/0003.

   THE CLASSIFICATION RULE, and its one known weakness:

     outflow                        → withdrawal
     inflow, category type `income` → growth        (interest, dividends)
     inflow, anything else          → contribution

   Growth is recognised by the category TYPE, not by a category name: "Interest
   income" is one vault's English label, and a rule keyed to that string is
   wrong in every other language and in any vault that named it differently.

   The weakness: a salary paid DIRECTLY into a savings account is also an
   income-type inflow, and would be counted as growth when it is really a
   contribution. It is not guessable from the data — both are income arriving
   from outside. Rather than pretend, `growthCategories` names every category
   that fed the growth figure so a reader can see a salary sitting in there and
   correct the category. Silent misclassification is the failure this module
   exists to end, so it must not introduce one of its own.

   Contributions deliberately have no category of their own. They wear the
   budget category they came FROM — in one real vault "Baby fund Jan" is
   uncategorised, "Emergency savings Dec" is a savings category, and
   "Christine Jan 26 tax" is a personal one. Any rule keyed to a single
   contribution category would be wrong on real data.

   Excluded rows COUNT. Every transaction in a fund account is typically
   `Excluded: yes` — that keeps the money out of income and spend totals, which
   is right, and has nothing to do with whether it entered the account. Skipping
   them would report every fund as having received nothing, ever.

   Pure — no DOM, no obsidian import. `typeOf` is injected so this module never
   has to know how categories are stored. */

/* Split one account's rows. `typeOf(categoryName)` returns the category's type
   or null. Rows are [{ date, amount, cat }] — the shape the loader produces. */
function splitFlows(rows, typeOf, opts) {
  const from = (opts && opts.from) || '';
  const to = (opts && opts.to) || '';
  let contributions = 0, growth = 0, withdrawals = 0, count = 0;
  const growthCategories = new Map();
  for (const r of rows || []) {
    if (!r || typeof r.amount !== 'number' || !r.amount) continue;
    if (from && r.date < from) continue;
    if (to && r.date > to) continue;
    count++;
    if (r.amount < 0) { withdrawals += -r.amount; continue; }
    const t = typeOf ? typeOf(r.cat) : null;
    if (t === 'income') {
      growth += r.amount;
      const k = r.cat || '(uncategorised)';
      growthCategories.set(k, (growthCategories.get(k) || 0) + r.amount);
    } else {
      contributions += r.amount;
    }
  }
  return {
    contributions, growth, withdrawals, count,
    net: contributions + growth - withdrawals,
    growthCategories: [...growthCategories]
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amount]) => ({ cat, amount })),
  };
}

/* The account's story end to end.

   `opening` is what the account held before any of these rows — inferred as
   closing less everything that moved, because no file records it. That makes
   the identity hold by construction, which is the point: the figures shown to
   a reader must add up to the balance they can see, or the page is arguing
   with itself.

   `basis` says which figure the growth came from, so the view never presents a
   derived split and a hand-typed one as though they were the same claim:

     'derived'  from the account's own transactions
     'stated'   no transactions — falls back to balance − total_invested, the
                old formula, which is the best available for an account the
                vault holds no history for (a provider-only TFSA, say)
     'none'     neither available */
function accountFlows(account, rows, typeOf, opts) {
  const a = account || {};
  const balance = typeof a.balance === 'number' ? a.balance : 0;
  const has = (rows || []).length > 0;

  if (has) {
    const f = splitFlows(rows, typeOf, opts);
    return {
      basis: 'derived',
      opening: balance - f.net,
      contributions: f.contributions,
      growth: f.growth,
      withdrawals: f.withdrawals,
      closing: balance,
      count: f.count,
      growthCategories: f.growthCategories,
    };
  }

  const baseline = a.total_invested || a.starting_amount || 0;
  if (baseline) {
    return {
      basis: 'stated',
      opening: baseline,
      contributions: 0,
      growth: balance - baseline,
      withdrawals: 0,
      closing: balance,
      count: 0,
      growthCategories: [],
    };
  }
  return {
    basis: 'none', opening: balance, contributions: 0, growth: 0,
    withdrawals: 0, closing: balance, count: 0, growthCategories: [],
  };
}

/* Is the stated monthly_contribution what is actually going in?

   Averaged over whole months that have COMPLETED, so the current part-month
   cannot drag the average down and report a shortfall that does not exist —
   the failure that would make this figure untrustworthy the first time anyone
   checked it in the first week of a month.

   Returns null when there is not enough history to say anything honest. */
function contributionRate(rows, typeOf, months, today) {
  if (!months || months < 1) return null;
  const now = (today && /^\d{4}-\d{2}-\d{2}$/.test(today)) ? today : null;
  if (!now) return null;
  // Window ends at the last day of the PREVIOUS month.
  const [y, m] = now.split('-').map(Number);
  const endY = m === 1 ? y - 1 : y, endM = m === 1 ? 12 : m - 1;
  const startTotal = endY * 12 + (endM - 1) - (months - 1);
  const sY = Math.floor(startTotal / 12), sM = (startTotal % 12) + 1;
  const from = `${String(sY).padStart(4, '0')}-${String(sM).padStart(2, '0')}-01`;
  const to = `${String(endY).padStart(4, '0')}-${String(endM).padStart(2, '0')}-31`;

  const f = splitFlows(rows, typeOf, { from, to });
  if (!f.count) return null;
  return { perMonth: f.contributions / months, months, from, to, total: f.contributions };
}

module.exports = { splitFlows, accountFlows, contributionRate };
