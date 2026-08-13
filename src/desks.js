'use strict';

import { MIN_GRID, MAX_GRID } from './constants.js';
import {
  state, pushUndo, isFreeDesk, freeDesks, studentsWithoutDesk,
  deskCells, deskAt, setMoveMode
} from './state.js';
import { computeLayout, calcRequiredRows } from './layout.js';
import { renderAll, renderClassroom, renderMismatchWarning, updateGridDisplay } from './render.js';
import { showToast } from './toast.js';

const $ = id => document.getElementById(id);

function syncDeskCountInput() {
  state.deskCount = state.desks.length;
  $('desk-count').value = state.deskCount;
}

function syncTeacherButton() {
  $('btn-teacher-desk').textContent =
    state.teacherDesk ? 'Fjern lærerpult' : 'Legg til lærerpult';
}

// ── Rebuild ──────────────────────────────────────────────
export function rebuildDesks(preserveNames) {
  const positions = computeLayout(state.deskCount, state.groupSize, state.gridCols);

  // The seats the new layout offers, in layout order.
  const slots = positions.map((pos, i) => ({
    id:      'd' + (i + 1),
    col:     pos.col,
    row:     pos.row,
    groupId: 'g' + (Math.floor(i / state.groupSize) + 1),
    from:    null
  }));

  if (preserveNames && state.desks.length > 0) {
    // Reading order — top to bottom, left to right — is what the teacher sees.
    // Matching on array index instead meant that after any manual drag the list
    // order no longer matched the seating, so changing the desk count threw
    // names (and locks) onto unrelated seats.
    const inReadingOrder = [...state.desks].sort((a, b) => a.row - b.row || a.col - b.col);
    const slotByCell = new Map(slots.map(s => [`${s.col},${s.row}`, s]));
    const placed = new Set();

    // A lock means "this student keeps this seat", so honour it literally
    // whenever the rebuilt layout still contains that seat.
    for (const desk of inReadingOrder) {
      if (!desk.locked) continue;
      const slot = slotByCell.get(`${desk.col},${desk.row}`);
      if (slot && !slot.from) {
        slot.from = desk;
        placed.add(desk);
      }
    }

    // Everyone else fills the seats that are left, still in reading order.
    const free = slots.filter(s => !s.from);
    let next = 0;
    for (const desk of inReadingOrder) {
      if (placed.has(desk)) continue;
      if (next >= free.length) break;   // fewer desks than before — drop the tail
      free[next++].from = desk;
    }
  }

  state.desks = slots.map(s => ({
    id:          s.id,
    col:         s.col,
    row:         s.row,
    groupId:     s.groupId,
    studentName: s.from?.studentName ?? null,
    locked:      s.from?.locked      ?? false,
    marked:      s.from?.marked      ?? false,
    size:        s.from?.size        ?? 1
  }));

  narrowUnfittableDesks();

  // Grow the grid if the layout needs more room than it currently has.
  const needed = calcRequiredRows(state.deskCount, state.groupSize, state.gridCols) + 1;
  if (state.gridRows < needed) {
    state.gridRows = Math.min(MAX_GRID, needed);
    updateGridDisplay();
  }
}

/**
 * Returns any wide desk to single width when the rebuilt layout has no room
 * for its second cell — otherwise it would be drawn straight over a neighbour,
 * which is exactly what toggleDeskWidth refuses to allow.
 */
function narrowUnfittableDesks() {
  const occupied = new Set(state.desks.map(d => `${d.col},${d.row}`));
  for (const desk of state.desks) {
    if (desk.size !== 2) continue;
    if (desk.col + 1 > state.gridCols || occupied.has(`${desk.col + 1},${desk.row}`)) {
      desk.size = 1;
    }
  }
}

// ── Placement rules ──────────────────────────────────────
function fitsInGrid(col, row, size) {
  const lastCol = size === 2 ? col + 1 : col;
  return col >= MIN_GRID && row >= MIN_GRID &&
         lastCol <= state.gridCols && row <= state.gridRows;
}

/** Desks blocking `desk` if it moved to (col,row), excluding itself. */
function blockers(desk, col, row) {
  const cells = deskCells({ ...desk, col, row });
  const hits  = new Set();
  for (const [c, r] of cells) {
    const other = deskAt(c, r, desk.id);
    if (other) hits.add(other);
  }
  return [...hits];
}

// ── Add / remove desks ───────────────────────────────────
export function fixMissingDesks() {
  const unassigned = studentsWithoutDesk();
  if (unassigned.length === 0) return;
  pushUndo();

  // Only genuinely free desks may be filled — a desk the teacher marked as
  // "skal stå tom" must stay empty.
  const targets = freeDesks();
  unassigned.slice(0, targets.length).forEach((name, i) => { targets[i].studentName = name; });

  const toPlace = unassigned.slice(targets.length);
  if (toPlace.length > 0) {
    const occupied = new Set();
    state.desks.forEach(d => deskCells(d).forEach(([c, r]) => occupied.add(`${c},${r}`)));
    if (state.teacherDesk) occupied.add(`${state.teacherDesk.col},${state.teacherDesk.row}`);

    let seq = 0;
    const stamp = Date.now();
    for (const name of toPlace) {
      let col = null, row = null;
      search:
      for (let r = 1; r <= MAX_GRID; r++) {
        for (let c = 1; c <= state.gridCols; c++) {
          if (!occupied.has(`${c},${r}`)) { col = c; row = r; break search; }
        }
      }
      if (col === null) {
        showToast('Ikke plass til flere pulter i rutenettet');
        break;
      }
      if (row > state.gridRows) state.gridRows = Math.min(MAX_GRID, row);
      occupied.add(`${col},${row}`);
      state.desks.push({
        id: `d_fx${stamp}_${seq++}`, col, row, groupId: 'g_extra',
        studentName: name, locked: false, marked: false, size: 1
      });
    }
  }

  syncDeskCountInput();
  renderAll();
  const n = unassigned.length;
  showToast(`${n} elev${n > 1 ? 'er' : ''} tildelt pult`);
}

export function removeExcessDesks() {
  pushUndo();
  const before  = state.desks.length;
  state.desks   = state.desks.filter(d => !isFreeDesk(d));
  const removed = before - state.desks.length;
  syncDeskCountInput();
  renderAll();
  showToast(`${removed} tom${removed !== 1 ? 'me' : ''} pult${removed !== 1 ? 'er' : ''} fjernet`);
}

// ── Row / column delete & move ───────────────────────────
/** Shifts every desk along `axis` by `delta`. */
function shiftAll(axis, delta) {
  state.desks.forEach(d => { d[axis] += delta; });
  if (state.teacherDesk) state.teacherDesk[axis] += delta;
}

/**
 * Deletes a whole row or column, compacting the remainder toward the board.
 * axis: 'row' | 'col'   index: 1-based
 */
export function deleteAxis(axis, index) {
  pushUndo();
  const pos   = state.blackboardPosition || 'top';
  const isRow = axis === 'row';
  // Compact toward the board: rows shift up unless the board is at the bottom,
  // columns shift left unless the board is on the right.
  const shiftBack = isRow ? pos !== 'bottom' : pos !== 'right';
  const delta     = shiftBack ? -1 : 1;
  const dimKey    = isRow ? 'gridRows' : 'gridCols';
  const label     = isRow ? 'Rad' : 'Kolonne';

  let removedCount = 0;
  const kept = [];
  for (const d of state.desks) {
    if (d[axis] === index) { removedCount++; continue; }
    if (shiftBack ? d[axis] > index : d[axis] < index) d[axis] += delta;
    kept.push(d);
  }
  state.desks = kept;

  let teacherRemoved = false;
  if (state.teacherDesk) {
    if (state.teacherDesk[axis] === index) {
      state.teacherDesk = null;
      teacherRemoved    = true;
      syncTeacherButton();
    } else if (shiftBack ? state.teacherDesk[axis] > index : state.teacherDesk[axis] < index) {
      state.teacherDesk[axis] += delta;
    }
  }

  state[dimKey] = Math.max(MIN_GRID, state[dimKey] - 1);

  // If anything now sits past the new edge, slide the whole layout back rather
  // than clamping it — clamping stacked desks on top of each other.
  const positions = state.desks.map(d => d[axis])
    .concat(state.teacherDesk ? [state.teacherDesk[axis]] : []);
  const maxUsed = positions.length ? Math.max(...positions) : 0;
  if (maxUsed > state[dimKey]) shiftAll(axis, state[dimKey] - maxUsed);

  syncDeskCountInput();
  renderAll();

  const base = removedCount > 0
    ? `${label} slettet (${removedCount} pult${removedCount !== 1 ? 'er' : ''} fjernet)`
    : `Tom ${label.toLowerCase()} slettet`;
  showToast(teacherRemoved ? base + ' + lærerpult fjernet' : base);
}

export function moveAxis(axis, from, to) {
  if (from === to) { setMoveMode(null); renderClassroom(); return; }
  pushUndo();
  state.desks.forEach(d => { if (d[axis] === from) d[axis] = to; });
  if (state.teacherDesk && state.teacherDesk[axis] === from) state.teacherDesk[axis] = to;
  setMoveMode(null);
  renderAll();
  showToast(axis === 'row' ? 'Rad flyttet' : 'Kolonne flyttet');
}

export function enterMoveMode(type, index) {
  setMoveMode({ type, index });
  renderClassroom();
}

export function exitMoveMode() {
  setMoveMode(null);
  renderClassroom();
}

// ── Teacher desk ─────────────────────────────────────────
function addTeacherDesk() {
  const pos       = state.blackboardPosition || 'top';
  const centerCol = Math.ceil(state.gridCols / 2);
  const centerRow = Math.ceil(state.gridRows / 2);

  if (pos === 'top') {
    state.desks.forEach(d => { d.row += 1; });
    state.gridRows = Math.min(MAX_GRID, state.gridRows + 1);
    state.teacherDesk = { col: centerCol, row: 1 };
  } else if (pos === 'bottom') {
    state.gridRows = Math.min(MAX_GRID, state.gridRows + 1);
    state.teacherDesk = { col: centerCol, row: state.gridRows };
  } else if (pos === 'left') {
    state.desks.forEach(d => { d.col += 1; });
    state.gridCols = Math.min(MAX_GRID, state.gridCols + 1);
    state.teacherDesk = { col: 1, row: centerRow };
  } else {
    state.gridCols = Math.min(MAX_GRID, state.gridCols + 1);
    state.teacherDesk = { col: state.gridCols, row: centerRow };
  }
  updateGridDisplay();
}

/**
 * Removes the teacher desk and gives back the row/column that adding it took.
 *
 * Adding a teacher desk grows the grid by one lane and (for board-top/left)
 * pushes every student desk over. Removal used to skip that reversal entirely,
 * so each add/remove cycle left an extra empty lane behind and walked the class
 * further from the board — six toggles turned an 8-row grid into an 11-row one.
 *
 * The reversal only runs when the lane the teacher occupied is genuinely free,
 * so a teacher desk the user dragged elsewhere never disturbs the layout.
 */
function removeTeacherDesk() {
  const td = state.teacherDesk;
  state.teacherDesk = null;
  if (!td) return;

  if (td.row === 1 && state.desks.every(d => d.row > 1)) {
    state.desks.forEach(d => { d.row -= 1; });
    state.gridRows = Math.max(MIN_GRID, state.gridRows - 1);
  } else if (td.row === state.gridRows && state.desks.every(d => d.row < state.gridRows)) {
    state.gridRows = Math.max(MIN_GRID, state.gridRows - 1);
  } else if (td.col === 1 && state.desks.every(d => d.col > 1)) {
    state.desks.forEach(d => { d.col -= 1; });
    state.gridCols = Math.max(MIN_GRID, state.gridCols - 1);
  } else if (td.col === state.gridCols && state.desks.every(d => d.col + (d.size === 2 ? 1 : 0) < state.gridCols)) {
    state.gridCols = Math.max(MIN_GRID, state.gridCols - 1);
  }
  updateGridDisplay();
}

export function toggleTeacherDesk() {
  pushUndo();
  if (state.teacherDesk) removeTeacherDesk();
  else addTeacherDesk();
  syncTeacherButton();
  renderClassroom();
}

export function clearTeacherDesk() {
  pushUndo();
  removeTeacherDesk();
  syncTeacherButton();
  renderClassroom();
}

// ── Desk size ────────────────────────────────────────────
/**
 * Toggles a desk between one and two cells wide.
 *
 * A wide desk physically covers (col,row) and (col+1,row). Nothing used to
 * check that second cell, so "Gjør bred" would silently draw the desk straight
 * over its right-hand neighbour.
 */
export function toggleDeskWidth(deskId) {
  const desk = state.desks.find(d => d.id === deskId);
  if (!desk) return;

  if (desk.size === 2) {
    pushUndo();
    desk.size = 1;
    renderClassroom();
    return;
  }

  if (!fitsInGrid(desk.col, desk.row, 2)) {
    showToast('Ikke plass — pulten står ytterst til høyre');
    return;
  }
  if (deskAt(desk.col + 1, desk.row, desk.id)) {
    showToast('Ikke plass — pulten til høyre er opptatt');
    return;
  }
  pushUndo();
  desk.size = 2;
  renderClassroom();
}

// ── Moving desks ─────────────────────────────────────────
function swapPositions(a, b) {
  [a.col, b.col] = [b.col, a.col];
  [a.row, b.row] = [b.row, a.row];
}

/** Moves a desk (or the teacher desk) to (col,row), swapping when occupied. */
export function moveDesk(deskId, col, row) {
  if (deskId === 'teacher') { moveTeacherDesk(col, row); return true; }

  const desk = state.desks.find(d => d.id === deskId);
  if (!desk) return false;
  if (desk.col === col && desk.row === row) return false; // no-op drop

  if (!fitsInGrid(col, row, desk.size)) {
    showToast('Pulten får ikke plass der');
    return false;
  }

  // Swapping with the teacher desk
  if (state.teacherDesk &&
      deskCells({ ...desk, col, row }).some(([c, r]) =>
        c === state.teacherDesk.col && r === state.teacherDesk.row)) {
    const from = { col: desk.col, row: desk.row };
    state.teacherDesk.col = from.col;
    state.teacherDesk.row = from.row;
    desk.col = col; desk.row = row;
    return true;
  }

  const hit = blockers(desk, col, row);
  if (hit.length > 1) {
    showToast('Kan ikke bytte med flere pulter samtidig');
    return false;
  }
  if (hit.length === 1) {
    const other = hit[0];
    const from  = { col: desk.col, row: desk.row };
    // The swap must be legal in both directions.
    if (!fitsInGrid(from.col, from.row, other.size)) {
      showToast('Pultene passer ikke å bytte plass');
      return false;
    }
    desk.col = col; desk.row = row;
    other.col = from.col; other.row = from.row;
    return true;
  }

  desk.col = col;
  desk.row = row;
  return true;
}

export function moveTeacherDesk(col, row) {
  if (!state.teacherDesk) return false;
  if (state.teacherDesk.col === col && state.teacherDesk.row === row) return false;
  if (col < MIN_GRID || row < MIN_GRID || col > state.gridCols || row > state.gridRows) return false;

  const occupant = deskAt(col, row);
  if (occupant) {
    const from = { col: state.teacherDesk.col, row: state.teacherDesk.row };
    if (!fitsInGrid(from.col, from.row, occupant.size)) {
      showToast('Pultene passer ikke å bytte plass');
      return false;
    }
    state.teacherDesk.col = col; state.teacherDesk.row = row;
    occupant.col = from.col; occupant.row = from.row;
  } else {
    state.teacherDesk.col = col;
    state.teacherDesk.row = row;
  }
  return true;
}

/** Swaps a regular desk with the teacher desk. */
export function swapWithTeacher(regularDeskId) {
  const desk = state.desks.find(d => d.id === regularDeskId);
  if (!desk || !state.teacherDesk) return false;
  const tc = state.teacherDesk.col, tr = state.teacherDesk.row;
  if (!fitsInGrid(tc, tr, desk.size)) {
    showToast('Pulten får ikke plass der');
    return false;
  }
  state.teacherDesk.col = desk.col;
  state.teacherDesk.row = desk.row;
  desk.col = tc; desk.row = tr;
  return true;
}

/** Swaps two regular desks. */
export function swapRegularDesks(idA, idB) {
  const a = state.desks.find(d => d.id === idA);
  const b = state.desks.find(d => d.id === idB);
  if (!a || !b) return false;
  if (!fitsInGrid(b.col, b.row, a.size) || !fitsInGrid(a.col, a.row, b.size)) {
    showToast('Pultene passer ikke å bytte plass');
    return false;
  }
  swapPositions(a, b);
  return true;
}

// ── Grid size ────────────────────────────────────────────
export function nudgeGrid(dimKey, delta) {
  const next = Math.min(MAX_GRID, Math.max(MIN_GRID, state[dimKey] + delta));
  if (next === state[dimKey]) return;

  if (delta < 0) {
    // Shrinking must not strand desks outside the grid.
    const axis  = dimKey === 'gridCols' ? 'col' : 'row';
    const edge  = state.desks.some(d => {
      const last = d[axis] + (axis === 'col' && d.size === 2 ? 1 : 0);
      return last > next;
    });
    const teacherEdge = state.teacherDesk && state.teacherDesk[axis] > next;
    if (edge || teacherEdge) {
      showToast(dimKey === 'gridCols'
        ? 'Kolonnen er ikke tom — flytt pultene først'
        : 'Raden er ikke tom — flytt pultene først');
      return;
    }
  }

  // The steppers previously changed the grid without recording an undo step,
  // so Ctrl+Z skipped straight past them to an older change.
  pushUndo();
  state[dimKey] = next;
  updateGridDisplay();
  renderClassroom();
  renderMismatchWarning();
}
