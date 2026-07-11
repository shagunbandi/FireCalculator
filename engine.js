/*
 * FIRE calculation engine — pure functions, no DOM.
 * Loaded by index.html in the browser and by tests in Node.
 *
 * Model (annual steps, nominal money):
 *  - Every expense category inflates at its own rate from today.
 *  - Accumulation (current age → FIRE age): portfolio grows at the pre-FIRE
 *    return; monthly investing is approximated as one annual contribution
 *    earning half a year of growth; one-time goals are paid from the portfolio
 *    in the year they occur.
 *  - Withdrawal (FIRE age → life expectancy): each year's spending is taken at
 *    the start of the year, the remainder grows at the post-FIRE return.
 *  - Coast FIRE: between the coast age and the traditional retirement age the
 *    portfolio grows untouched (the job covers living costs, goals still come
 *    from the portfolio).
 *  - Barista FIRE: part-time income (inflating with general inflation) offsets
 *    spending until the barista end age.
 *  - Required corpus = present value, at the applicable growth rates, of every
 *    withdrawal from FIRE to life expectancy (exact reverse recursion).
 *  - Required monthly investment = smallest amount for which the simulated
 *    balance never goes below zero through life expectancy (binary search).
 */
(function (global) {
  'use strict';

  var DISCRETIONARY_MULT = { lean: 0.5, regular: 1.0, fat: 1.5, coast: 1.0, barista: 1.0 };

  function buildEngine(cfg) {
    var r = cfg.rates;
    var pct = function (x) { return (Number(x) || 0) / 100; };
    var dm = DISCRETIONARY_MULT[cfg.fireType] != null ? DISCRETIONARY_MULT[cfg.fireType] : 1.0;

    function infOf(cat) {
      if (cat === 'education') return r.eduInflation;
      if (cat === 'healthcare') return r.healthInflation;
      return r.inflation;
    }
    function yearsFrom(age) { return age - cfg.currentAge; }

    // Annual spending at a given age, in that year's money.
    // The lean/fat lifestyle multiplier applies to discretionary items only.
    function annualExpenseAt(age) {
      var t = 0;
      for (var i = 0; i < cfg.expenses.length; i++) {
        var e = cfg.expenses[i];
        var m = Number(e.monthly) || 0;
        if (m <= 0) continue;
        var mult = e.essential ? 1 : dm;
        t += m * 12 * mult * Math.pow(1 + pct(infOf(e.infCat)), yearsFrom(age));
      }
      return t;
    }

    // One-time goals: cost is "as of today", inflated to the year it happens;
    // a goal spread over N years pays cost/N in each of those years.
    function goalOutflowAt(age) {
      var t = 0;
      var goals = cfg.goals || [];
      for (var i = 0; i < goals.length; i++) {
        var g = goals[i];
        var c = Number(g.cost) || 0;
        if (c <= 0) continue;
        var yrs = Math.max(1, Math.round(Number(g.years) || 1));
        if (age >= g.atAge && age < g.atAge + yrs) {
          t += (c / yrs) * Math.pow(1 + pct(infOf(g.infCat)), yearsFrom(age));
        }
      }
      return t;
    }

    function retireAgeFor(fireAge) {
      return cfg.fireType === 'coast' ? Math.max(Number(cfg.coastRetAge) || fireAge, fireAge) : fireAge;
    }
    function baristaUntilFor(fireAge) {
      return cfg.fireType === 'barista' ? Math.max(Number(cfg.baristaUntil) || fireAge, fireAge) : fireAge;
    }
    function baristaIncomeAt(age) {
      return (Number(cfg.baristaIncomeMonthly) || 0) * 12 * Math.pow(1 + pct(r.inflation), yearsFrom(age));
    }

    // Withdrawal taken from the portfolio at the start of a given year.
    function withdrawalAt(age, fireAge) {
      var retireAge = retireAgeFor(fireAge);
      if (age < retireAge) return 0; // coasting: job covers living costs
      var w = annualExpenseAt(age);
      if (cfg.fireType === 'barista' && age < baristaUntilFor(fireAge)) {
        w = Math.max(0, w - baristaIncomeAt(age));
      }
      return w;
    }

    function growthAt(age, fireAge) {
      return age < retireAgeFor(fireAge) ? pct(r.preReturn) : pct(r.postReturn);
    }

    // Year-by-year simulation from current age to life expectancy.
    // ok === true means the balance never went below zero.
    function simulate(sipMonthly, stepUpPct, fireAge) {
      var bal = Number(cfg.corpus) || 0;
      var ok = true;
      var rows = [];
      for (var age = cfg.currentAge; age < cfg.lifeExpectancy; age++) {
        var accumulating = age < fireAge;
        var growth = accumulating ? pct(r.preReturn) : growthAt(age, fireAge);
        var contrib = accumulating
          ? sipMonthly * 12 * Math.pow(1 + pct(stepUpPct), age - cfg.currentAge)
          : 0;
        var withdrawal = accumulating ? 0 : withdrawalAt(age, fireAge);
        var goalOut = goalOutflowAt(age);
        var phase = accumulating ? 'accumulate'
          : age < retireAgeFor(fireAge) ? 'coast'
          : (cfg.fireType === 'barista' && age < baristaUntilFor(fireAge)) ? 'barista'
          : 'retire';
        var start = bal;
        var afterOut = bal - goalOut - withdrawal;
        if (afterOut < -1e-6) ok = false;
        bal = afterOut * (1 + growth) + contrib * Math.sqrt(1 + growth);
        rows.push({
          age: age, phase: phase, start: start, contrib: contrib,
          goalOut: goalOut, withdrawal: withdrawal, growthRate: growth, end: bal
        });
      }
      if (bal < -1e-6) ok = false;
      return { ok: ok, rows: rows, end: bal };
    }

    // Exact present value of all withdrawals + post-FIRE goals: the corpus
    // needed in hand at the FIRE age.
    function requiredCorpusAt(fireAge) {
      var needed = 0;
      for (var age = cfg.lifeExpectancy - 1; age >= fireAge; age--) {
        var growth = growthAt(age, fireAge);
        var w = withdrawalAt(age, fireAge) + goalOutflowAt(age);
        needed = w + needed / (1 + growth);
      }
      return needed;
    }

    // Smallest monthly investment that keeps the plan solvent for life.
    function solveSip(stepUpPct, fireAge) {
      if (simulate(0, stepUpPct, fireAge).ok) return 0;
      var hi = 1000;
      while (!simulate(hi, stepUpPct, fireAge).ok) {
        hi *= 2;
        if (hi > 1e13) return Infinity;
      }
      var lo = hi / 2 > 0 ? 0 : 0;
      for (var i = 0; i < 100; i++) {
        var mid = (lo + hi) / 2;
        if (simulate(mid, stepUpPct, fireAge).ok) hi = mid; else lo = mid;
      }
      return hi;
    }

    // Earliest FIRE age that works with a given monthly investment.
    function achievableFireAge(sipMonthly, stepUpPct) {
      for (var a = cfg.currentAge + 1; a < cfg.lifeExpectancy; a++) {
        if (simulate(sipMonthly, stepUpPct, a).ok) return a;
      }
      return null;
    }

    return {
      annualExpenseAt: annualExpenseAt,
      goalOutflowAt: goalOutflowAt,
      withdrawalAt: withdrawalAt,
      retireAgeFor: retireAgeFor,
      simulate: simulate,
      requiredCorpusAt: requiredCorpusAt,
      solveSip: solveSip,
      achievableFireAge: achievableFireAge
    };
  }

  // One call that produces everything the results screen needs.
  function buildPlan(cfg) {
    var eng = buildEngine(cfg);
    var r = cfg.rates;
    var fireAge = cfg.fireAge;
    var retireAge = eng.retireAgeFor(fireAge);
    var yearsToFire = fireAge - cfg.currentAge;

    var requiredCorpus = eng.requiredCorpusAt(fireAge);
    var requiredCorpusToday = requiredCorpus / Math.pow(1 + (r.inflation / 100), yearsToFire);
    var annualExpenseAtRetire = eng.annualExpenseAt(retireAge);
    var annualExpenseToday = eng.annualExpenseAt(cfg.currentAge);
    var swr = Number(r.swr) || 4;
    var swrCorpus = annualExpenseAtRetire / (swr / 100);

    var sipFlat = eng.solveSip(0, fireAge);
    var stepUp = Number(r.stepUp) || 0;
    var sipStepped = stepUp > 0 ? eng.solveSip(stepUp, fireAge) : sipFlat;

    var series = isFinite(sipFlat) ? eng.simulate(sipFlat, 0, fireAge).rows : [];

    var planned = null;
    var plannedSip = Number(cfg.plannedSip) || 0;
    if (plannedSip > 0 && isFinite(sipFlat)) {
      var sim = eng.simulate(plannedSip, 0, fireAge);
      planned = {
        sip: plannedSip,
        ok: sim.ok,
        gap: Math.max(0, sipFlat - plannedSip),
        surplus: Math.max(0, plannedSip - sipFlat),
        achievableAge: eng.achievableFireAge(plannedSip, 0)
      };
    }

    return {
      engine: eng,
      fireAge: fireAge,
      retireAge: retireAge,
      yearsToFire: yearsToFire,
      annualExpenseToday: annualExpenseToday,
      annualExpenseAtRetire: annualExpenseAtRetire,
      requiredCorpus: requiredCorpus,
      requiredCorpusToday: requiredCorpusToday,
      swrCorpus: swrCorpus,
      sipFlat: sipFlat,
      sipStepped: sipStepped,
      stepUpPct: stepUp,
      series: series,
      planned: planned,
      alreadyThere: sipFlat === 0
    };
  }

  var api = { buildEngine: buildEngine, buildPlan: buildPlan, DISCRETIONARY_MULT: DISCRETIONARY_MULT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.FireEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
