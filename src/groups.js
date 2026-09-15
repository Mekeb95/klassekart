'use strict';

import { shuffle } from './randomize.js';

// Pure group logic: sizes, the draw itself, roles, history and text export.
// No DOM and no live state — every function works on the values it is given.

// A broken rule must outweigh any number of repeated pairs, so «Unngå forrige
// grupper» can never talk the solver into breaking a rule.
const HARD     = 1000;
const RESTARTS = 12;

const pairKey = (a, b) => (a < b ? a + '\n' + b : b + '\n' + a);

/** Local calendar date as YYYY-MM-DD — what «i dag» means for absence and history. */
export function todayKey(now = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Names marked absent, but only on the day they were marked. */
export function absentToday(g, today = todayKey()) {
  return g.trackAbsence && g.absent.date === today ? g.absent.names : [];
}

export function presentStudents(students, g, today = todayKey()) {
  const away = new Set(absentToday(g, today));
  return students.filter(s => !away.has(s));
}

/**
 * Balanced sizes for n students: largest groups first, never more than one
 * apart. «Elever per gruppe» rounds to the nearest group count, so 26 students
 * at 4 per group gives 7 groups (4,4,4,4,4,3,3) rather than 6 groups of 4–5.
 */
export function groupSizes(n, g) {
  if (n <= 0) return [];
  const wanted = g.sizeMode === 'count' ? g.count : Math.round(n / g.size);
  const k      = Math.max(1, Math.min(n, wanted));
  const base   = Math.floor(n / k);
  const extra  = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

/** "7 grupper — 5 med 4 elever, 2 med 3" */
export function describeSizes(sizes) {
  if (sizes.length === 0) return 'Ingen elever å fordele';
  const k    = sizes.length;
  const head = `${k} gruppe${k === 1 ? '' : 'r'}`;
  const counts = new Map();
  sizes.forEach(s => counts.set(s, (counts.get(s) || 0) + 1));
  if (counts.size === 1) return `${head} med ${sizes[0]} elev${sizes[0] === 1 ? '' : 'er'}`;
  const [[bigSize, bigCount], [smallSize, smallCount]] = [...counts];
  return `${head} — ${bigCount} med ${bigSize} elever, ${smallCount} med ${smallSize}`;
}

/**
 * The groupings from earlier days, newest first.
 *
 * The current result counts once it is from an earlier day. Draws repeated on
 * the same day replace each other, so trying a few times before class only
 * remembers the grouping that was actually used.
 */
export function pastGroupings(g, today, max) {
  const res = g.result;
  if (!res || !res.date || res.date === today) return g.history.slice(0, max);
  const entry = {
    date:   res.date,
    groups: res.groups.map(grp => grp.members.map(m => m.name)).filter(m => m.length > 0)
  };
  return [entry, ...g.history.filter(h => h.date !== res.date)].slice(0, max);
}

/** Rules a grouping breaks. A rule about someone who isn't in any group doesn't count. */
export function brokenGroupRules(groups, rules) {
  const groupOf = new Map();
  groups.forEach((members, gi) => members.forEach(name => groupOf.set(name, gi)));
  return rules.filter(rule => {
    const ga = groupOf.get(rule.a);
    const gb = groupOf.get(rule.b);
    if (ga === undefined || gb === undefined) return false;
    return rule.type === 'together' ? ga !== gb : ga === gb;
  });
}

/** Pairs sharing a group now who also shared one in `history`. */
export function countRepeats(groups, history) {
  const before = new Set();
  for (const entry of history) {
    for (const members of entry.groups) {
      for (let x = 0; x < members.length; x++) {
        for (let y = x + 1; y < members.length; y++) before.add(pairKey(members[x], members[y]));
      }
    }
  }
  let repeats = 0;
  for (const members of groups) {
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) {
        if (before.has(pairKey(members[x], members[y]))) repeats++;
      }
    }
  }
  return repeats;
}

/**
 * Splits students into groups with exactly the given sizes.
 *
 * Every pair of students has a cost for sharing a group: +HARD for «ikke
 * sammen», −HARD for «sammen», and a small penalty for each earlier day they
 * were grouped together (recent days weigh more). The search deals a shuffled
 * class into the groups, then swaps two students from different groups
 * whenever that doesn't make things worse. A swap keeps both group sizes, so
 * the balance from groupSizes() holds no matter what the rules ask for.
 *
 * Returns {groups: string[][], broken: rule[], repeats: number}.
 */
export function drawGroups(students, sizes, { rules = [], history = [], rand = Math.random } = {}) {
  const n     = students.length;
  const index = new Map(students.map((s, i) => [s, i]));

  const deal = order => {
    const groups = [];
    let at = 0;
    for (const size of sizes) {
      groups.push(order.slice(at, at + size));
      at += size;
    }
    return groups;
  };

  const score = new Float64Array(n * n);
  let togetherRules = 0;
  let constrained   = false;

  for (const rule of rules) {
    const i = index.get(rule.a);
    const j = index.get(rule.b);
    if (i === undefined || j === undefined || i === j) continue;
    const v = rule.type === 'together' ? -HARD : HARD;
    if (rule.type === 'together') togetherRules++;
    score[i * n + j] += v;
    score[j * n + i] += v;
    constrained = true;
  }

  history.forEach((entry, age) => {
    const weight = history.length - age;
    for (const members of entry.groups) {
      const ids = members.map(m => index.get(m)).filter(i => i !== undefined);
      for (let x = 0; x < ids.length; x++) {
        for (let y = x + 1; y < ids.length; y++) {
          score[ids[x] * n + ids[y]] += weight;
          score[ids[y] * n + ids[x]] += weight;
          constrained = true;
        }
      }
    }
  });

  const finish = groups => {
    const named = groups.map(g => g.map(i => students[i]));
    return {
      groups:  named,
      broken:  brokenGroupRules(named, rules),
      repeats: countRepeats(named, history)
    };
  };

  const ids = [...students.keys()];
  if (!constrained) return finish(deal(shuffle(ids, rand)));

  const groupCost = members => {
    let c = 0;
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) c += score[members[x] * n + members[y]];
    }
    return c;
  };

  let best     = null;
  let bestCost = Infinity;

  for (let restart = 0; restart < RESTARTS && bestCost > 0; restart++) {
    const groups = deal(shuffle(ids, rand));
    const costs  = groups.map(groupCost);
    // Shifted by HARD per «sammen» rule so that zero means perfect: nothing
    // broken and nobody repeated.
    let total = HARD * togetherRules + costs.reduce((a, b) => a + b, 0);
    const iterations = Math.min(20000, n * 150);

    for (let it = 0; it < iterations && total > 0; it++) {
      const p = Math.floor(rand() * groups.length);
      const q = Math.floor(rand() * groups.length);
      if (p === q) continue;
      const gp = groups[p];
      const gq = groups[q];
      if (gp.length === 0 || gq.length === 0) continue;
      const x = Math.floor(rand() * gp.length);
      const y = Math.floor(rand() * gq.length);

      [gp[x], gq[y]] = [gq[y], gp[x]];
      const cp    = groupCost(gp);
      const cq    = groupCost(gq);
      const delta = cp + cq - costs[p] - costs[q];
      if (delta <= 0) {
        costs[p] = cp;
        costs[q] = cq;
        total   += delta;
      } else {
        [gp[x], gq[y]] = [gq[y], gp[x]];
      }
    }

    if (total < bestCost) {
      bestCost = total;
      best     = groups.map(g => [...g]);
    }
  }

  return finish(best);
}

/**
 * Gives each member at most one role and each role to at most one member.
 *
 * Roles already held are kept where still valid, so moving one student doesn't
 * reshuffle the rest of the group. The remaining roles go out in list order to
 * randomly chosen members — a group smaller than the list goes without the last.
 */
export function fillRoles(members, roles, rand = Math.random) {
  const wanted = new Set(roles);
  const taken  = new Set();
  const out = members.map(m => {
    if (m.role && wanted.has(m.role) && !taken.has(m.role)) {
      taken.add(m.role);
      return { ...m };
    }
    return { ...m, role: null };
  });
  const free = roles.filter(r => !taken.has(r));
  shuffle(out.filter(m => !m.role), rand).forEach((m, i) => {
    if (i < free.length) m.role = free[i];
  });
  return out;
}

/** Turns a draw into the stored result shape, with roles handed out. */
export function buildResult(groupNames, roles, date, rand = Math.random) {
  return {
    date,
    groups: groupNames.map(names => ({
      members: fillRoles(names.map(name => ({ name, role: null })), roles, rand)
    }))
  };
}

/**
 * Moves a member to another group (toIndex null), or swaps two members.
 * The moved members give up their roles — they take over whatever role is
 * free where they land, instead of bringing a duplicate along.
 * Returns false, without changing anything, when the move is a no-op.
 */
export function moveMember(result, fromGroup, fromIndex, toGroup, toIndex = null) {
  const src = result.groups[fromGroup]?.members;
  const dst = result.groups[toGroup]?.members;
  if (!src || !dst || !src[fromIndex]) return false;

  if (toIndex === null) {
    if (fromGroup === toGroup) return false;
    const [member] = src.splice(fromIndex, 1);
    dst.push({ ...member, role: null });
    return true;
  }

  if (!dst[toIndex] || (fromGroup === toGroup && fromIndex === toIndex)) return false;
  if (fromGroup === toGroup) {
    [src[fromIndex], src[toIndex]] = [src[toIndex], src[fromIndex]];
    return true;
  }
  const a = src[fromIndex];
  const b = dst[toIndex];
  src[fromIndex] = { ...b, role: null };
  dst[toIndex]   = { ...a, role: null };
  return true;
}

/** Who is missing from, or no longer belongs in, a stored result. */
export function resultDiff(result, present) {
  const inResult = result.groups.flatMap(g => g.members.map(m => m.name));
  const inSet    = new Set(inResult);
  const now      = new Set(present);
  return {
    added:   present.filter(s => !inSet.has(s)),
    removed: inResult.filter(s => !now.has(s))
  };
}

export function groupsAsText(result, { title, dateLabel, showRoles }) {
  const lines = [`${title} – grupper${dateLabel ? ` (${dateLabel})` : ''}`, ''];
  result.groups.forEach((grp, i) => {
    const names = grp.members.map(m => (showRoles && m.role ? `${m.name} (${m.role})` : m.name));
    lines.push(`Gruppe ${i + 1}: ${names.length ? names.join(', ') : '(tom)'}`);
  });
  return lines.join('\n');
}
