'use strict';

import {
  MIN_GRID, MAX_GRID, MAX_DESK_COUNT, MAX_DESKS, MAX_UNDO,
  MIN_TEXT_SCALE, MAX_TEXT_SCALE,
  VALID_PRINT_FORMATS, VALID_PRINT_ORIENTATIONS, VALID_BB_POSITIONS, VALID_GROUP_SIZES
} from './constants.js';

// ── State shape ──────────────────────────────────────────
// desks: [{id, col, row, groupId, studentName, locked, marked, size}]
export function createInitialState() {
  return {
    version:               1,
    className:             '',
    students:              [],
    deskCount:             24,
    groupSize:             2,
    gridCols:              8,
    gridRows:              6,
    blackboardPosition:    'top',
    hasRandomized:         false,
    exclusions:            [],   // [{a: 'Name1', b: 'Name2'}]
    teacherDesk:           null, // {col, row} or null
    desks:                 [],
    printFormat:           'A4',
    printOrientation:      'landscape',
    textScale:             1,
    hideEmptyDesksOnPrint: false,
    blackboardInset:       null
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

/**
 * Turns arbitrary parsed JSON into a valid state object.
 * Always returns a usable state — never throws on malformed input.
 */
export function sanitizeState(parsed) {
  const next = createInitialState();
  if (!parsed || typeof parsed !== 'object') return next;

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

  if (Array.isArray(parsed.exclusions)) {
    next.exclusions = parsed.exclusions
      .filter(e => e && typeof e.a === 'string' && typeof e.b === 'string' && e.a !== e.b)
      .map(e => ({ a: e.a.trim().slice(0, 100), b: e.b.trim().slice(0, 100) }))
      .filter(e => e.a && e.b)
      .slice(0, 200);
  }

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
