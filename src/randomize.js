'use strict';

import { state } from './state.js';
import { areNeighbors } from './layout.js';

// Fresh starting shuffles tried before settling for the best one found. Each
// start is improved by swapping; restarts only matter when rules conflict.
const RESTARTS = 30;

export function shuffle(arr, rand = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Whether `rule` is broken when its two students sit at d1 and d2. */
function breaksSeatRule(rule, d1, d2) {
  const near = areNeighbors(d1, d2);
  return rule.type === 'together' ? !near : near;
}

/**
 * The rules this seating breaks. A rule only counts when both students have a
 * desk — someone left without a seat is neither next to nor apart from anyone.
 */
export function brokenSeatRules(desks, rules) {
  if (rules.length === 0) return [];
  const byName = new Map();
  for (const d of desks) {
    if (d.studentName && !byName.has(d.studentName)) byName.set(d.studentName, d);
  }
  return rules.filter(rule => {
    const d1 = byName.get(rule.a);
    const d2 = byName.get(rule.b);
    return d1 && d2 && breaksSeatRule(rule, d1, d2);
  });
}

/**
 * Assigns students to the unlocked desks.
 *
 * Without rules this is a plain shuffle. With rules it starts from a shuffle
 * and improves it by swapping two seats at a time, keeping every swap that
 * doesn't break more rules. The previous best-of-200-shuffles approach was fine
 * for «ikke sammen», which a random seating mostly satisfies on its own, but a
 * random seating almost never puts two particular students side by side — so
 * «sammen» rules would have been left to luck.
 *
 * Who ends up without a desk (more students than free desks) is settled by the
 * initial shuffle and never traded during the search. Otherwise the cheapest
 * way to "satisfy" a rule would be to leave one of its students out.
 *
 * Returns {violations, broken}.
 */
export function assignSeats(desks, students, rules, rand = Math.random) {
  const fixed = desks.filter(d => d.locked || d.marked);
  const open  = desks.filter(d => !d.locked && !d.marked);

  const fixedNames = new Set(fixed.map(d => d.studentName).filter(Boolean));
  const available  = students.filter(s => !fixedNames.has(s));

  const apply = names => {
    open.forEach((desk, i) => { desk.studentName = names[i] ?? null; });
  };

  if (rules.length === 0 || open.length === 0) {
    apply(shuffle(available, rand));
    const broken = brokenSeatRules(desks, rules);
    return { violations: broken.length, broken };
  }

  const rulesOf = new Map();
  for (const rule of rules) {
    for (const name of [rule.a, rule.b]) {
      if (!rulesOf.has(name)) rulesOf.set(name, []);
      rulesOf.get(name).push(rule);
    }
  }

  const fixedSeat = new Map();
  for (const d of fixed) {
    if (d.studentName && !fixedSeat.has(d.studentName)) fixedSeat.set(d.studentName, d);
  }

  let best     = null;
  let bestCost = Infinity;

  for (let restart = 0; restart < RESTARTS && bestCost > 0; restart++) {
    const names = shuffle(available, rand).slice(0, open.length);
    while (names.length < open.length) names.push(null);

    const seatOf = new Map(fixedSeat);
    names.forEach((name, i) => { if (name) seatOf.set(name, open[i]); });

    const cost = rule => {
      const d1 = seatOf.get(rule.a);
      const d2 = seatOf.get(rule.b);
      return d1 && d2 && breaksSeatRule(rule, d1, d2) ? 1 : 0;
    };
    const swap = (i, j) => {
      const a = names[i];
      const b = names[j];
      names[i] = b;
      names[j] = a;
      if (a) seatOf.set(a, open[j]);
      if (b) seatOf.set(b, open[i]);
    };

    let total = rules.reduce((sum, rule) => sum + cost(rule), 0);
    const iterations = Math.min(4000, open.length * 60);

    for (let it = 0; it < iterations && total > 0; it++) {
      const i = Math.floor(rand() * open.length);
      const j = Math.floor(rand() * open.length);
      if (i === j) continue;

      // Only rules about the two students being swapped can change.
      const touched = new Set([...(rulesOf.get(names[i]) ?? []), ...(rulesOf.get(names[j]) ?? [])]);
      if (touched.size === 0) continue;

      let before = 0;
      for (const rule of touched) before += cost(rule);
      swap(i, j);
      let after = 0;
      for (const rule of touched) after += cost(rule);

      // Accepting equal moves lets the search walk across plateaus instead of
      // getting stuck on the first arrangement where no single swap helps.
      if (after <= before) total += after - before;
      else swap(i, j);
    }

    if (total < bestCost) {
      bestCost = total;
      best     = [...names];
    }
  }

  apply(best);
  const broken = brokenSeatRules(desks, rules);
  return { violations: broken.length, broken };
}

/** Convenience wrapper bound to the live state. */
export function randomizeSeating() {
  return assignSeats(state.desks, state.students, state.useRulesSeating ? state.rules : []);
}
