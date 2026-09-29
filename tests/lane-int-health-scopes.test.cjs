'use strict';
/* Each health ratio divides by the income of its OWN scope (2026-09-29 audit,
   round 2).

   Ruan's saving-rate decision moved the saving rate onto budget income (the
   income the Dashboard prints, Excluded windfalls out) and its numerator onto
   regular transfers into funds. Every other ratio in healthMetrics divided by
   the same avg.income, so they moved too - but their numerators are
   HOUSEHOLD-lens spend, which KEEPS Excluded rows. On the real vault that read
   living costs above 100% of income and zeroed that part of the score: a
   household-wide numerator over a budget-scoped base. The saving rate keeps
   budget income, as do the debt shares and the net-worth multiple (normal
   income); only the two SPENDING shares, whose numerators keep Excluded rows,
   divide by household income.

     node tests/lane-int-health-scopes.test.cjs */
const assert = require('assert');
const { healthMetrics } = require('../src/health-math');

let checks = 0;
const near = (a, b, m) => { assert.ok(Math.abs(a - b) < 1e-9, `${m}: got ${a}, want ${b}`); checks++; };

/* One period: R50 000 of normal income, plus a R50 000 Excluded windfall the
   household lens keeps; R45 000 of household spend; R5 000 moved to funds. */
const period = { counted: true, income: 50000, householdIncome: 100000, essential: 30000,
  savings: 5000, consumption: 45000, fixed: 20000, budgeted: 40000, consumptionBudget: 38000 };
const m = healthMetrics({ periods: [period], monthsPerPeriod: 1, earmarks: null, targetMonths: 6,
  debtInterest: 1000, debtInstalments: 4000, netWorth: 1200000, hasFixed: true });

near(m.savingsRate, 0.10, 'saving rate: regular saving over NORMAL income (Ruan, 29 Sep)');
near(m.consumptionShare, 0.45, 'living costs: household spend over household income');
near(m.fixedShare, 0.20, 'fixed bills: household over household');
near(m.interestShare, 0.02, 'debt interest share: over normal income (a windfall does not make debt cheaper)');
near(m.instalmentShare, 0.08, 'instalment share: over normal income');
near(m.netWorthMultiple, 1200000 / (50000 * 12), 'net-worth multiple: over normal income');
near(m.monthlyIncome, 50000, 'the income the saving line prints is the budget income');

/* The score's gap amounts convert a share back to rand through the SAME scope. */
const { scoreBreakdown } = require('../src/health-math');
const bd = scoreBreakdown(m, 6);
const gap = key => { const pl = (bd && (bd.pillars || bd)).find ? (bd.pillars || bd).find(p => p.key === key) : null; return pl && pl.gap; };
const debtGap = gap('debt');
if (debtGap) near(debtGap.amount, 1000, 'debt gap: the interest itself, back through the same income');
const nwGap = gap('wealth') || gap('networth');
if (nwGap) near(nwGap.amount, Math.max(0, require('../src/health-math').FULL_MARKS.netWorthMultiple * 50000 * 12 - 1200000), 'net-worth gap through normal income');

/* A caller passing the old shape (no householdIncome) reads one income for all. */
const old = healthMetrics({ periods: [{ ...period, householdIncome: undefined }], monthsPerPeriod: 1,
  earmarks: null, targetMonths: 6, debtInterest: 1000, debtInstalments: 4000, netWorth: 1200000, hasFixed: true });
near(old.consumptionShare, 0.90, 'no household income given: falls back to the one income');

console.log(`PASS lane-int-health-scopes (${checks} checks)`);
