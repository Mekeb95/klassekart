'use strict';

import { state } from './state.js';
import { areNeighbors } from './layout.js';

const MAX_ATTEMPTS = 200;

export function shuffle(arr, rand = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** How many "skal ikke sitte sammen" rules this arrangement breaks. */
export function countViolations(desks, exclusions) {
  if (exclusions.length === 0) return 0;
  const byName = new Map();
  for (const d of desks) {
    if (d.studentName && !byName.has(d.studentName)) byName.set(d.studentName, d);
  }
  let violations = 0;
  for (const ex of exclusions) {
    const d1 = byName.get(ex.a);
    const d2 = byName.get(ex.b);
    if (d1 && d2 && areNeighbors(d1, d2)) violations++;
  }
  return violations;
}

/**
 * Assigns students to the unlocked desks.
 *
 * Tries up to MAX_ATTEMPTS shuffles and keeps the one that breaks the fewest
 * rules, stopping early on a perfect fit. The previous version generated the
 * same 200 shuffles but scored none of them — it kept attempt #1 and threw the
 * rest away, so a solvable-but-tight room landed on the optimum only by luck.
 *
 * Returns {violations, attempts} so the caller can phrase the message.
 */
export function assignSeats(desks, students, exclusions, rand = Math.random) {
  const locked   = desks.filter(d => d.locked || d.marked);
  const unlocked = desks.filter(d => !d.locked && !d.marked);

  const lockedNames = new Set(locked.map(d => d.studentName).filter(Boolean));
  const available   = students.filter(s => !lockedNames.has(s));

  const apply = names => {
    unlocked.forEach((desk, i) => { desk.studentName = names[i] ?? null; });
  };

  if (exclusions.length === 0) {
    apply(shuffle(available, rand));
    return { violations: 0, attempts: 1 };
  }

  let best = null;
  let bestScore = Infinity;
  let attempts = 0;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    attempts++;
    const candidate = shuffle(available, rand);
    const testDesks = [
      ...locked,
      ...unlocked.map((desk, j) => ({ ...desk, studentName: candidate[j] ?? null }))
    ];
    const score = countViolations(testDesks, exclusions);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
      if (score === 0) break; // can't do better than perfect
    }
  }

  apply(best);
  return { violations: bestScore, attempts };
}

/** Convenience wrapper bound to the live state. */
export function randomizeSeating() {
  return assignSeats(state.desks, state.students, state.exclusions);
}
