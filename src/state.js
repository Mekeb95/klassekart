'use strict';

import {
  MIN_GRID, MAX_GRID, MAX_DESK_COUNT, MAX_DESKS, MAX_UNDO,
  MIN_TEXT_SCALE, MAX_TEXT_SCALE, MAX_RULES,
  MIN_GROUP_SIZE, MAX_GROUP_SIZE, MIN_GROUP_COUNT, MAX_GROUP_COUNT,
  MAX_GROUP_HISTORY, MAX_ROLES, MAX_ROLE_LENGTH,
  MIN_TEAM_SIZE, MAX_TEAM_SIZE, MAX_TEAMS, MAX_TEAM_NAME, MAX_ROUNDS, MAX_POINTS, MAX_PENALTY,
  DEFAULT_SECONDS, SECONDS_CHOICES, CLASSIC_CATEGORIES,
  VALID_PRINT_FORMATS, VALID_PRINT_ORIENTATIONS, VALID_BB_POSITIONS, VALID_GROUP_SIZES,
  VALID_MODES, VALID_RULE_TYPES, VALID_GROUP_SIZE_MODES, VALID_ACTIVITIES, VALID_GAME_PHASES
} from './constants.js';
import { normalizeCategories, letterPool, defaultTeamName } from './activities.js';

// ── State shape ──────────────────────────────────────────
// desks: [{id, col, row, groupId, studentName, locked, marked, size}]
export function createInitialState() {
  return {
    version:               2,
    mode:                  'seating', // 'seating' (klassekart) | 'groups' | 'activities'
    className:             '',
    students:              [],
    deskCount:             24,
    groupSize:             2,
    gridCols:              8,
    gridRows:              6,
    blackboardPosition:    'top',
    hasRandomized:         false,
    rules:                 [],   // [{a, b, type: 'apart'|'together'}] — shared by both tools
    useRulesSeating:       true,
    useRulesGroups:        true,
    useRulesActivities:    true,
    groups:                createInitialGroups(),
    activities:            createInitialActivities(),
    teacherDesk:           null, // {col, row} or null
    desks:                 [],
    printFormat:           'A4',
    printOrientation:      'landscape',
    textScale:             1,
    hideEmptyDesksOnPrint: false,
    scaleToFitOnPrint:     true,
    blackboardInset:       null
  };
}

export function createInitialGroups() {
  return {
    sizeMode:     'size',  // 'size' = elever per gruppe, 'count' = antall grupper
    size:         4,
    count:        6,
    trackAbsence: false,
    absent:       { date: '', names: [] }, // only counts on the day it was set
    avoidRepeat:  false,
    history:      [],      // [{date, groups: [[name]]}] — earlier days, newest first
    rolesEnabled: false,
    roles:        [],
    result:       null     // {date, groups: [{members: [{name, role}]}]}
  };
}

export function createInitialActivities() {
  return {
    active:      null,            // null = aktivitetsvelgeren, ellers en aktivitets-id
    mariusleken: createInitialMariusleken()
  };
}

export function createInitialMariusleken() {
  return {
    teamSize:    4,
    teams:       [],                       // [{name, custom, members: [name]}]
    categories:  [...CLASSIC_CATEGORIES],
    seconds:     DEFAULT_SECONDS,          // per kategori
    sound:       true,
    music:       true,                     // ventemusikk mens timeren går
    hardLetters: false,
    sheetCategories: false,                // skriv kategoriene på det utskrevne svararket
    phase:       'setup',                  // setup | ready | play | score | done
    letter:      null,                     // bokstaven i runden som går nå
    usedLetters: [],
    remaining:   0,                        // sekunder igjen av runden
    paused:      false,
    marks:       [],                       // marks[lag][kategori] = 0 | 1 | 2
    penalties:   [],                       // penalties[lag] = trekk denne runden
    rounds:      []                        // [{letter, categories, marks, penalties}] — ferdige runder
  };
}

export let state = createInitialState();

/** Replaces the whole state object. Import bindings stay live, so every
 *  module that imported `state` sees the new object. */
export function replaceState(next) {
  state = next;
}

// ── Transient UI state ───────────────────────────────────
// Never serialised — it only describes what the user is doing right now.
// moveMode: {type: 'row'|'col', index: number} while picking a destination.
let moveMode = null;
export const getMoveMode = () => moveMode;
export const setMoveMode = mode => { moveMode = mode; };

// ── Undo ─────────────────────────────────────────────────
const undoStack = [];

function deepClone(obj) {
  return structuredClone(obj);
}

export function pushUndo() {
  undoStack.push(deepClone(state));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

/** Pops one step. Returns false when there was nothing to undo, so the caller
 *  can decide what to tell the user (and skip the re-render). */
export function popUndo() {
  if (undoStack.length === 0) return false;
  replaceState(undoStack.pop());
  return true;
}

export function clearUndo() {
  undoStack.length = 0;
}

// ── Desk predicates ──────────────────────────────────────
// A desk is "free" when it can receive a student: no name, not locked, and not
// deliberately marked as an empty desk. Every feature that counts, fills or
// trims empty desks must agree on this, otherwise "Legg til pulter" happily
// fills the desks the teacher marked as intentionally empty.
export function isFreeDesk(desk) {
  return !desk.studentName && !desk.locked && !desk.marked;
}

export function freeDesks() {
  return state.desks.filter(isFreeDesk);
}

/** Cells a desk physically occupies — a wide desk covers two. */
export function deskCells(desk) {
  return desk.size === 2
    ? [[desk.col, desk.row], [desk.col + 1, desk.row]]
    : [[desk.col, desk.row]];
}

/** The desk covering (col,row), if any. Wide desks count for both cells. */
export function deskAt(col, row, excludeId = null) {
  return state.desks.find(d =>
    d.id !== excludeId && deskCells(d).some(([c, r]) => c === col && r === row)
  ) || null;
}

// ── Derived queries ──────────────────────────────────────
export function studentsWithoutDesk() {
  const assigned = new Set(state.desks.map(d => d.studentName).filter(Boolean));
  return state.students.filter(s => !assigned.has(s));
}

export function isAxisEmpty(axis, value) {
  return !state.desks.some(d => d[axis] === value) &&
         !(state.teacherDesk && state.teacherDesk[axis] === value);
}

/** Follows a renamed student into the rules, today's absence and the current groups. */
export function renameStudentRefs(oldName, newName) {
  if (!oldName || !newName || oldName === newName) return;
  state.rules.forEach(r => {
    if (r.a === oldName) r.a = newName;
    if (r.b === oldName) r.b = newName;
  });
  // Renaming onto the other half of a rule would leave a rule about one person.
  state.rules = state.rules.filter(r => r.a !== r.b);

  const g = state.groups;
  g.absent.names = g.absent.names.map(n => (n === oldName ? newName : n));
  g.result?.groups.forEach(grp => grp.members.forEach(m => {
    if (m.name === oldName) m.name = newName;
  }));

  state.activities.mariusleken.teams.forEach(team => {
    team.members = team.members.map(n => (n === oldName ? newName : n));
  });
}

/** Names appearing more than once, in first-seen order. */
export function detectDuplicates(names) {
  const seen = new Set();
  const dups = new Set();
  for (const name of names) {
    if (seen.has(name)) dups.add(name);
    else seen.add(name);
  }
  return [...dups];
}

// ── Validation of untrusted input ────────────────────────
// Saved charts and JSON files are user-editable and get shared between
// machines, so everything coming back in is treated as untrusted: clamped to
// the same ranges the UI enforces, with unknown fields dropped.

function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function asString(value) {
  return typeof value === 'string' ? value : '';
}

function pick(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

/** Trimmed, de-duplicated, length-capped list of non-empty strings. */
function asNameList(value, max, maxLength = 100) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value.filter(s => typeof s === 'string').map(s => s.trim().slice(0, maxLength)).filter(Boolean)
  )].slice(0, max);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function asDate(value) {
  return typeof value === 'string' && DATE_RE.test(value) ? value : '';
}

function sanitizeRules(parsed) {
  // Charts saved before «sammen» existed only have `exclusions`, and every one
  // of those is a «skal ikke sitte sammen».
  const raw = Array.isArray(parsed.rules)      ? parsed.rules
            : Array.isArray(parsed.exclusions) ? parsed.exclusions.map(e => ({ ...e, type: 'apart' }))
            : [];
  const seen  = new Set();
  const rules = [];
  for (const r of raw) {
    if (!r || typeof r.a !== 'string' || typeof r.b !== 'string') continue;
    const a = r.a.trim().slice(0, 100);
    const b = r.b.trim().slice(0, 100);
    if (!a || !b || a === b) continue;
    // One rule per pair — «sammen» and «ikke sammen» for the same two students
    // can't both hold, and the add button enforces the same.
    const key = a < b ? a + '\n' + b : b + '\n' + a;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push({ a, b, type: pick(r.type, VALID_RULE_TYPES, 'apart') });
    if (rules.length >= MAX_RULES) break;
  }
  return rules;
}

function sanitizeGroups(g) {
  const next = createInitialGroups();
  if (!g || typeof g !== 'object') return next;

  next.sizeMode     = pick(g.sizeMode, VALID_GROUP_SIZE_MODES, 'size');
  next.size         = clampInt(g.size,  MIN_GROUP_SIZE,  MAX_GROUP_SIZE,  4);
  next.count        = clampInt(g.count, MIN_GROUP_COUNT, MAX_GROUP_COUNT, 6);
  next.trackAbsence = g.trackAbsence === true;
  next.absent       = { date: asDate(g.absent?.date), names: asNameList(g.absent?.names, MAX_DESKS) };
  next.avoidRepeat  = g.avoidRepeat === true;
  next.rolesEnabled = g.rolesEnabled === true;
  next.roles        = asNameList(g.roles, MAX_ROLES, MAX_ROLE_LENGTH);

  if (Array.isArray(g.history)) {
    next.history = g.history
      .filter(h => h && asDate(h.date) && Array.isArray(h.groups))
      .slice(0, MAX_GROUP_HISTORY)
      .map(h => ({
        date:   h.date,
        groups: h.groups.slice(0, MAX_DESKS).map(m => asNameList(m, MAX_DESKS)).filter(m => m.length > 0)
      }));
  }

  const res = g.result;
  if (res && typeof res === 'object' && Array.isArray(res.groups)) {
    const seen = new Set();
    const groups = res.groups.slice(0, MAX_DESKS).map(grp => ({
      members: (Array.isArray(grp?.members) ? grp.members : [])
        .filter(m => m && typeof m.name === 'string' && m.name.trim())
        .map(m => ({
          name: m.name.trim().slice(0, 100),
          role: typeof m.role === 'string' && m.role.trim() ? m.role.trim().slice(0, MAX_ROLE_LENGTH) : null
        }))
        .filter(m => {
          if (seen.has(m.name)) return false; // a student can only be in one group
          seen.add(m.name);
          return true;
        })
    }));
    // Empty groups are kept on purpose: a group emptied by dragging stays as a
    // card to drag students back into.
    if (groups.length > 0) next.result = { date: asDate(res.date), groups };
  }

  return next;
}

const ALL_LETTERS = new Set(letterPool(true));

function asLetter(value) {
  const letter = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return ALL_LETTERS.has(letter) ? letter : null;
}

/** marks[team][category], every cell clamped to 0…MAX_POINTS and the grid to size. */
function asMarks(value, teamCount, categoryCount) {
  const rows = Array.isArray(value) ? value : [];
  return Array.from({ length: teamCount }, (_, t) => {
    const row = Array.isArray(rows[t]) ? rows[t] : [];
    return Array.from({ length: categoryCount }, (_, c) => clampInt(row[c], 0, MAX_POINTS, 0));
  });
}

/** penalties[team], each clamped to 0…MAX_PENALTY. Missing (older saves) = no trekk. */
function asPenalties(value, teamCount) {
  const list = Array.isArray(value) ? value : [];
  return Array.from({ length: teamCount }, (_, t) => clampInt(list[t], 0, MAX_PENALTY, 0));
}

function sanitizeMariusleken(m) {
  const next = createInitialMariusleken();
  if (!m || typeof m !== 'object') return next;

  next.teamSize        = clampInt(m.teamSize, MIN_TEAM_SIZE, MAX_TEAM_SIZE, 4);
  next.seconds         = pick(clampInt(m.seconds, 5, 300, DEFAULT_SECONDS), new Set(SECONDS_CHOICES), DEFAULT_SECONDS);
  next.sound           = m.sound !== false;
  next.music           = m.music !== false;
  next.hardLetters     = m.hardLetters === true;
  next.sheetCategories = m.sheetCategories === true;

  // An empty category list would leave the game with nothing to play, so the
  // classic set from createInitialMariusleken() stands in.
  const categories = normalizeCategories(m.categories);
  if (categories.length > 0) next.categories = categories;

  if (Array.isArray(m.teams)) {
    // A student can only play on one team, whatever the file says.
    const taken = new Set();
    next.teams = m.teams
      .filter(t => t && typeof t === 'object')
      .slice(0, MAX_TEAMS)
      .map((t, i) => {
        const name = asString(t.name).trim().slice(0, MAX_TEAM_NAME);
        return {
          name:    name || defaultTeamName(i),
          custom:  t.custom === true && !!name,
          members: asNameList(t.members, MAX_DESKS).filter(n => {
            if (taken.has(n)) return false;
            taken.add(n);
            return true;
          })
        };
      });
  }

  next.usedLetters = [...new Set(
    (Array.isArray(m.usedLetters) ? m.usedLetters : []).map(asLetter).filter(Boolean)
  )].slice(0, ALL_LETTERS.size);

  const teamCount = next.teams.length;

  if (Array.isArray(m.rounds)) {
    next.rounds = m.rounds
      .filter(r => r && typeof r === 'object' && asLetter(r.letter))
      .slice(0, MAX_ROUNDS)
      .map(r => {
        const cats = normalizeCategories(r.categories);
        return {
          letter:     asLetter(r.letter),
          categories: cats,
          marks:      asMarks(r.marks, teamCount, cats.length),
          penalties:  asPenalties(r.penalties, teamCount)
        };
      })
      .filter(r => r.categories.length > 0);
  }

  next.letter = asLetter(m.letter);
  next.marks     = asMarks(m.marks, teamCount, next.categories.length);
  next.penalties = asPenalties(m.penalties, teamCount);

  // A countdown can't keep running while the tab is gone, so a round that was
  // in progress comes back paused with the time it had left — not restarted.
  let phase = pick(m.phase, VALID_GAME_PHASES, 'setup');
  if (!next.letter && (phase === 'score' || phase === 'play')) phase = 'ready';
  if (teamCount < 2) phase = 'setup';
  next.phase     = phase;
  next.remaining = clampInt(m.remaining, 0, MAX_ROUNDS * 60 * 60, 0);
  next.paused    = phase === 'play' ? true : m.paused === true;

  return next;
}

function sanitizeActivities(a) {
  const next = createInitialActivities();
  if (!a || typeof a !== 'object') return next;
  next.active      = pick(a.active, VALID_ACTIVITIES, null);
  next.mariusleken = sanitizeMariusleken(a.mariusleken);
  return next;
}

/**
 * Turns arbitrary parsed JSON into a valid state object.
 * Always returns a usable state — never throws on malformed input.
 */
export function sanitizeState(parsed) {
  const next = createInitialState();
  if (!parsed || typeof parsed !== 'object') return next;

  next.mode      = pick(parsed.mode, VALID_MODES, 'seating');
  next.className = asString(parsed.className).slice(0, 100);

  if (Array.isArray(parsed.students)) {
    next.students = [...new Set(
      parsed.students.filter(s => typeof s === 'string').map(s => s.trim()).filter(Boolean)
    )].slice(0, MAX_DESKS);
  }

  next.gridCols = clampInt(parsed.gridCols, MIN_GRID, MAX_GRID, 8);
  next.gridRows = clampInt(parsed.gridRows, MIN_GRID, MAX_GRID, 6);

  const groupSize = clampInt(parsed.groupSize, 1, 4, 2);
  next.groupSize = pick(groupSize, VALID_GROUP_SIZES, 2);

  next.blackboardPosition = pick(parsed.blackboardPosition, VALID_BB_POSITIONS, 'top');
  next.printFormat        = pick(parsed.printFormat, VALID_PRINT_FORMATS, 'A4');
  next.printOrientation   = pick(parsed.printOrientation, VALID_PRINT_ORIENTATIONS, 'landscape');

  const scale = Number(parsed.textScale);
  next.textScale = Number.isFinite(scale)
    ? Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, scale))
    : 1;

  next.hideEmptyDesksOnPrint = parsed.hideEmptyDesksOnPrint === true;
  // Defaults to on, including for charts saved before the option existed —
  // only an explicit false turns it off.
  next.scaleToFitOnPrint = parsed.scaleToFitOnPrint !== false;

  // Desks: drop anything without usable coordinates, clamp the rest into the grid.
  if (Array.isArray(parsed.desks)) {
    next.desks = parsed.desks
      .filter(d => d && typeof d === 'object')
      .slice(0, MAX_DESKS)
      .map((d, i) => ({
        id:          typeof d.id === 'string' && d.id ? d.id : 'd' + (i + 1),
        col:         clampInt(d.col, MIN_GRID, next.gridCols, 1),
        row:         clampInt(d.row, MIN_GRID, next.gridRows, 1),
        groupId:     typeof d.groupId === 'string' ? d.groupId : 'g' + (i + 1),
        studentName: typeof d.studentName === 'string' && d.studentName.trim()
                       ? d.studentName.trim().slice(0, 100)
                       : null,
        locked:      d.locked === true,
        marked:      d.marked === true,
        size:        d.size === 2 ? 2 : 1
      }));
  }

  // Duplicate ids would break every lookup-by-id; renumber if we see any.
  const ids = new Set();
  next.desks.forEach((d, i) => {
    if (ids.has(d.id)) d.id = 'd' + (i + 1) + '_' + i;
    ids.add(d.id);
  });

  next.deskCount = next.desks.length > 0
    ? next.desks.length
    : clampInt(parsed.deskCount, 1, MAX_DESK_COUNT, 24);

  next.rules              = sanitizeRules(parsed);
  next.useRulesSeating    = parsed.useRulesSeating    !== false;
  next.useRulesGroups     = parsed.useRulesGroups     !== false;
  next.useRulesActivities = parsed.useRulesActivities !== false;
  next.groups             = sanitizeGroups(parsed.groups);
  next.activities         = sanitizeActivities(parsed.activities);

  if (parsed.teacherDesk && typeof parsed.teacherDesk === 'object') {
    next.teacherDesk = {
      col: clampInt(parsed.teacherDesk.col, MIN_GRID, next.gridCols, 1),
      row: clampInt(parsed.teacherDesk.row, MIN_GRID, next.gridRows, 1)
    };
  }

  const inset = parsed.blackboardInset;
  if (inset && typeof inset === 'object') {
    const before = clampInt(inset.before, 0, 2000, 0);
    const after  = clampInt(inset.after,  0, 2000, 0);
    // before/after both 0 means "never customised" — fall back to the default.
    next.blackboardInset = (before === 0 && after === 0) ? null : { before, after };
  }

  // A restored chart already has a layout; auto-layout must not overwrite it
  // on the next randomise.
  next.hasRandomized = true;

  return next;
}
