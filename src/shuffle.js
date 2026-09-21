'use strict';

// Fisher–Yates, in its own module because the seating draw, the group draw and
// the activities all need it — and state.js sanitises activity data, so pulling
// it out of randomize.js (which reads `state`) keeps the imports acyclic.

/** A shuffled copy. The original array is left alone. */
export function shuffle(arr, rand = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
