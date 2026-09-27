'use strict';

import { shuffle } from './shuffle.js';
import {
  CATEGORY_BANK, CLASSIC_CATEGORIES, EASY_LETTERS, HARD_LETTERS,
  MAX_CATEGORIES, MAX_CAT_LENGTH, MAX_POINTS, MAX_PENALTY
} from './constants.js';

// Pure logic for aktivitetene: letters, categories, scoring and standings.
// No DOM and no live state — every function works on the values it is given,
// the same split groups.js uses.

// ── Bokstaver ────────────────────────────────────────────
export function letterPool(hard = false) {
  return hard ? [...EASY_LETTERS, ...HARD_LETTERS] : [...EASY_LETTERS];
}

/**
 * A letter nobody has played yet this game. When the pool runs dry the whole
 * alphabet is up for grabs again, so a long game never gets stuck.
 */
export function drawLetter(used = [], hard = false, rand = Math.random) {
  const pool = letterPool(hard);
  const left = pool.filter(l => !used.includes(l));
  const from = left.length > 0 ? left : pool;
  return from[Math.floor(rand() * from.length)];
}

// ── Kategorier ───────────────────────────────────────────
const sameCat = (a, b) => a.toLowerCase() === b.toLowerCase();

/** `n` categories from the bank, never one already in `avoid`. */
export function drawCategories(n, avoid = [], rand = Math.random) {
  const left = CATEGORY_BANK.filter(c => !avoid.some(a => sameCat(a, c)));
  return shuffle(left, rand).slice(0, Math.max(0, n));
}

/**
 * One fresh category for slot `index`. The other slots are kept, so swapping
 * out «Elv» never drags the rest of the row along with it.
 */
export function rerollCategory(categories, index, rand = Math.random) {
  const [next] = drawCategories(1, categories, rand);
  if (!next) return categories;
  const out = [...categories];
  out[index] = next;
  return out;
}

/** The classic set, padded from the bank if the teacher asked for more. */
export function startingCategories(n = CLASSIC_CATEGORIES.length, rand = Math.random) {
  const base = CLASSIC_CATEGORIES.slice(0, n);
  return base.length >= n ? base : [...base, ...drawCategories(n - base.length, base, rand)];
}

/** Trimmed, deduplicated, capped — used by both the input field and sanitising. */
export function normalizeCategories(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    if (typeof raw !== 'string') continue;
    const cat = raw.trim().slice(0, MAX_CAT_LENGTH);
    if (!cat || out.some(c => sameCat(c, cat))) continue;
    out.push(cat);
    if (out.length >= MAX_CATEGORIES) break;
  }
  return out;
}

// ── Poeng ────────────────────────────────────────────────
// marks[team][category] is 0, 1 or 2 — nothing/wrong letter, a word someone
// else had too, or a word the team was alone about.
//
// penalties[team] is how many points the teacher took off that team this
// round (juks, bråk). It is kept apart from the marks so the grid still shows
// what the team actually wrote. Rounds saved before trekk existed have no
// penalties at all, which counts as none.
export function emptyMarks(teamCount, categoryCount) {
  return Array.from({ length: teamCount }, () => new Array(categoryCount).fill(0));
}

export const emptyPenalties = teamCount => new Array(teamCount).fill(0);

export function roundPoints(marks, teamIndex, penalties = []) {
  const earned = (marks[teamIndex] || []).reduce((sum, p) => sum + (Number(p) || 0), 0);
  return earned - (Number(penalties?.[teamIndex]) || 0);
}

export function totalPoints(rounds, teamIndex) {
  return rounds.reduce((sum, r) => sum + roundPoints(r.marks, teamIndex, r.penalties), 0);
}

/** Cycles a cell 0 → 1 → 2 → 0, which is how the teacher taps through scoring. */
export function nextMark(value) {
  const n = Number(value) || 0;
  return n >= MAX_POINTS ? 0 : n + 1;
}

/** Same tap-through for trekk: 0 → 1 → … → MAX_PENALTY → 0. */
export function nextPenalty(value) {
  const n = Number(value) || 0;
  return n >= MAX_PENALTY ? 0 : n + 1;
}

/**
 * Teams sorted by points, best first. Equal points share a place, so two teams
 * on 14 are both «2.» and the next one is 4. — nobody gets robbed on the podium.
 */
export function standings(teams, rounds) {
  const rows = teams.map((team, index) => ({
    index,
    name:   team.name,
    points: totalPoints(rounds, index)
  }));
  rows.sort((a, b) => b.points - a.points || a.index - b.index);

  let place = 0;
  let prev  = null;
  rows.forEach((row, i) => {
    if (row.points !== prev) { place = i + 1; prev = row.points; }
    row.place = place;
  });
  return rows;
}

/** The rows on the podium: places 1–3, ties included. */
export function podium(rows) {
  return rows.filter(r => r.place <= 3);
}

// ── Lag ──────────────────────────────────────────────────
export const defaultTeamName = i => `Lag ${i + 1}`;

/** Turns a draw of names into teams, keeping any names the teacher has typed. */
export function buildTeams(groupNames, previous = []) {
  return groupNames.map((members, i) => ({
    name:    previous[i]?.custom ? previous[i].name : defaultTeamName(i),
    custom:  previous[i]?.custom === true,
    members: [...members]
  }));
}

/** The groups from the Grupper tab, as teams. */
export function teamsFromGroups(result) {
  if (!result?.groups) return [];
  return result.groups
    .map(g => g.members.map(m => m.name))
    .filter(members => members.length > 0)
    .map((members, i) => ({ name: defaultTeamName(i), custom: false, members }));
}

export const teamNames = teams => teams.map(t => t.name);

/** "4 lag · 3 runder spilt" */
export function describeGame(teams, rounds) {
  const t = `${teams.length} lag`;
  if (rounds.length === 0) return `${t} · ingen runder spilt ennå`;
  return `${t} · ${rounds.length} ${rounds.length === 1 ? 'runde' : 'runder'} spilt`;
}

/** Total playing time for a round, in seconds. */
export const roundSeconds = (categoryCount, secondsPerCategory) =>
  Math.max(1, categoryCount * secondsPerCategory);

/** "2:00" / "0:45" */
export function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Copy-ready summary of the whole game. */
export function gameAsText(teams, rounds, { title, dateLabel }) {
  const rows  = standings(teams, rounds);
  const lines = [`${title} – Mariusleken${dateLabel ? ` (${dateLabel})` : ''}`, ''];
  rounds.forEach((r, i) => {
    const docked = teams
      .map((t, ti) => (r.penalties?.[ti] > 0 ? `${t.name} −${r.penalties[ti]}` : null))
      .filter(Boolean);
    lines.push(`Runde ${i + 1} — bokstav ${r.letter}: ${r.categories.join(', ')}`
      + (docked.length > 0 ? ` (trekk: ${docked.join(', ')})` : ''));
  });
  if (rounds.length > 0) lines.push('');
  lines.push('Stilling:');
  rows.forEach(row => {
    lines.push(`${row.place}. ${row.name} — ${row.points} poeng`);
  });
  return lines.join('\n');
}
