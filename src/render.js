'use strict';

import {
  CELL_SIZE, CELL_GAP, CELL_STRIDE, CTRL_SIZE, BB_MARGIN, MIN_BB_SIZE,
  LS_MAP, LS_LIST, VALID_PRINT_FORMATS, VALID_PRINT_ORIENTATIONS
} from './constants.js';
import {
  state, isFreeDesk, studentsWithoutDesk, isAxisEmpty, detectDuplicates, getMoveMode
} from './state.js';
import { cellToPos, deskWidth, spanOf } from './layout.js';

const $ = id => document.getElementById(id);

// ── Text sizing ──────────────────────────────────────────
export function deskFontSize(name, desk) {
  const scale = state.textScale || 1;
  if (!name) return Math.round(11 * scale) + 'px';
  // Usable inner width ≈ desk width minus 14px padding.
  // system-ui average char width ≈ font-size × 0.60.
  const inner    = deskWidth(desk) - 14;
  const computed = Math.floor(inner / (name.length * 0.60));
  return Math.round(Math.max(7, Math.min(12, computed)) * scale) + 'px';
}

// ── Small syncs ──────────────────────────────────────────
export function updateGridDisplay() {
  const cv = $('grid-cols-val');
  const rv = $('grid-rows-val');
  if (cv) cv.textContent = state.gridCols;
  if (rv) rv.textContent = state.gridRows;
}

export function updateStudentCount() {
  $('student-count').textContent = '(' + state.students.length + ')';
}

export function updateDatalist() {
  const dl = $('students-datalist');
  dl.textContent = '';
  state.students.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    dl.appendChild(opt);
  });
}

export function updatePrintHeader() {
  $('ph-class').textContent = state.className || 'Klassekart';
  $('ph-date').textContent  =
    new Date().toLocaleDateString('no-NO', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Shows the duplicate-name warning and returns the duplicates found. */
export function syncDupWarning() {
  const names = $('students-textarea').value
    .split('\n').map(s => s.trim()).filter(Boolean);
  const dups   = detectDuplicates(names);
  const warnEl = $('dup-warning');
  if (dups.length > 0) {
    warnEl.textContent   = '⚠ Duplikat: ' + dups.join(', ');
    warnEl.style.display = 'block';
  } else {
    warnEl.textContent   = '';
    warnEl.style.display = 'none';
  }
  return dups;
}

// ── Print page style ─────────────────────────────────────
export function updatePrintPageStyle() {
  let style = $('print-page-style');
  if (!style) {
    style    = document.createElement('style');
    style.id = 'print-page-style';
    document.head.appendChild(style);
  }
  // Allowlist-validated: these values land inside a stylesheet.
  const fmt = VALID_PRINT_FORMATS.has(state.printFormat)           ? state.printFormat      : 'A4';
  const ori = VALID_PRINT_ORIENTATIONS.has(state.printOrientation) ? state.printOrientation : 'landscape';
  let css = `@media print { @page { size: ${fmt} ${ori}; margin: 10mm; } }`;
  if (state.hideEmptyDesksOnPrint) {
    css += ' @media print { .desk-empty { visibility: hidden !important; } }';
  }
  style.textContent = css;
}

// ── Stats banner ─────────────────────────────────────────
export function renderStatsBanner() {
  const banner = $('stats-banner');
  if (!banner) return;
  if (state.desks.length === 0) { banner.classList.remove('visible'); return; }

  const locked   = state.desks.filter(d => d.locked).length;
  const assigned = state.desks.filter(d => d.studentName && !d.locked).length;
  const marked   = state.desks.filter(d => d.marked && !d.studentName && !d.locked).length;
  const empty    = state.desks.filter(isFreeDesk).length;

  banner.textContent = '';
  const entries = [
    ['🔒', locked,   'låst'],
    ['🎲', assigned, 'plassert'],
    ...(marked > 0 ? [['📦', marked, 'markert']] : []),
    ['⬜', empty,    'tom' + (empty !== 1 ? 'me' : '')]
  ];
  entries.forEach(([icon, count, label]) => {
    const span = document.createElement('span');
    span.textContent = `${icon} ${count} ${label}`;
    banner.appendChild(span);
  });
  banner.classList.add('visible');
}

// ── Mismatch warning ─────────────────────────────────────
function pluralDesks(n) { return `pult${n !== 1 ? 'er' : ''}`; }

export function renderMismatchWarning() {
  const w  = $('mismatch-warning');
  const ol = $('overflow-list');
  w.textContent  = '';
  ol.textContent = '';

  const unassigned = studentsWithoutDesk();
  const emptyCount = state.desks.filter(isFreeDesk).length;

  const addRow = (text, action, btnLabel, extraClass = '') => {
    w.className = 'show';
    const span = document.createElement('span');
    span.textContent = text;
    const btn = document.createElement('button');
    btn.className     = 'btn-fix-desks' + (extraClass ? ' ' + extraClass : '');
    btn.textContent   = btnLabel;
    btn.dataset.action = action;
    w.append(span, btn);
  };

  if (unassigned.length > 0) {
    const n = unassigned.length;
    // The button fills free desks first and only creates what's still missing.
    // Labelling it "+ Legg til 6 pulter" when six desks are already standing
    // empty promised something it never did.
    const needNew = Math.max(0, n - emptyCount);
    const label = needNew > 0
      ? `+ Legg til ${needNew} ${pluralDesks(needNew)}`
      : `Plasser ${n} elev${n > 1 ? 'er' : ''}`;
    addRow(`${n} elev${n > 1 ? 'er' : ''} har ikke pult`, 'fix-desks', label);
    ol.textContent = 'Uten pult: ' + unassigned.join(', ');
  } else if (emptyCount > 0) {
    addRow(`${emptyCount} ${pluralDesks(emptyCount)} er tom${emptyCount > 1 ? 'me' : ''}`,
           'trim-desks', `Fjern ${emptyCount} overflødige ${pluralDesks(emptyCount)}`,
           'btn-trim-desks');
  } else {
    w.className = '';
  }
}

// ── Row / column controls ────────────────────────────────
function buildAxisSlot(axis, index) {
  const isRow     = axis === 'row';
  const moveMode  = getMoveMode();
  const inMode    = moveMode?.type === axis;
  const otherMode = moveMode && !inMode;

  const ctrl = document.createElement('div');
  ctrl.className = isRow ? 'row-ctrl' : 'col-ctrl';
  if (isRow) {
    ctrl.style.top    = ((index - 1) * CELL_STRIDE) + 'px';
    ctrl.style.height = CELL_SIZE + 'px';
  } else {
    ctrl.style.left   = ((index - 1) * CELL_STRIDE) + 'px';
    ctrl.style.width  = CELL_SIZE + 'px';
  }

  const noun = isRow ? 'rad' : 'kolonne';

  if (inMode) {
    if (moveMode.index === index) {
      ctrl.classList.add('rc-selected');
      const btn = document.createElement('button');
      btn.className      = 'ctrl-btn ctrl-cancel';
      btn.textContent    = '✕';
      btn.title          = 'Avbryt flytting';
      btn.dataset.action = 'cancel-move';
      ctrl.appendChild(btn);
    } else if (isAxisEmpty(axis, index)) {
      ctrl.classList.add('rc-valid');
      ctrl.title            = `Flytt ${noun} ${moveMode.index} hit`;
      ctrl.style.cursor     = 'pointer';
      ctrl.dataset.action   = 'drop-axis';
      ctrl.dataset.axis     = axis;
      ctrl.dataset.index    = index;
    } else {
      ctrl.classList.add('rc-invalid');
      ctrl.title = `${isRow ? 'Raden' : 'Kolonnen'} er ikke tom`;
    }
  } else if (!otherMode) {
    const del = document.createElement('button');
    del.className      = 'ctrl-btn ctrl-delete';
    del.textContent    = '×';
    del.title          = `Slett ${noun}`;
    del.dataset.action = 'delete-axis';
    del.dataset.axis   = axis;
    del.dataset.index  = index;

    const mov = document.createElement('button');
    mov.className      = 'ctrl-btn ctrl-move';
    mov.textContent    = isRow ? '⇅' : '⇄';
    mov.title          = `Flytt ${noun} til tom ${noun}`;
    mov.dataset.action = 'pick-axis';
    mov.dataset.axis   = axis;
    mov.dataset.index  = index;

    ctrl.append(del, mov);
  }
  return ctrl;
}

export function renderRowColControls() {
  const rowCtrl = $('row-controls');
  const colCtrl = $('col-controls');
  if (!rowCtrl || !colCtrl) return;

  rowCtrl.textContent = '';
  colCtrl.textContent = '';
  rowCtrl.style.height = spanOf(state.gridRows) + 'px';
  colCtrl.style.width  = spanOf(state.gridCols) + 'px';

  for (let r = 1; r <= state.gridRows; r++) rowCtrl.appendChild(buildAxisSlot('row', r));
  for (let c = 1; c <= state.gridCols; c++) colCtrl.appendChild(buildAxisSlot('col', c));
}

// ── Group backgrounds ────────────────────────────────────
function isContiguous(values) {
  return values.every((v, i) => i === 0 || v === values[i - 1] + 1);
}

function renderGroupBackgrounds(container) {
  const byGroup = new Map();
  state.desks.forEach(d => {
    if (!byGroup.has(d.groupId)) byGroup.set(d.groupId, []);
    byGroup.get(d.groupId).push(d);
  });

  const PAD = 5;
  byGroup.forEach(desks => {
    if (desks.length < 2) return;
    if (desks.some(d => d.size === 2)) return; // wide desks would overlap the frame

    const cols  = desks.map(d => d.col).sort((a, b) => a - b);
    const rows  = desks.map(d => d.row).sort((a, b) => a - b);
    const uRows = [...new Set(rows)];
    const uCols = [...new Set(cols)];

    const horizontal = uRows.length === 1 && isContiguous(cols);
    const vertical   = uCols.length === 1 && isContiguous(rows);
    if (!horizontal && !vertical) return;

    const pos = cellToPos(horizontal ? cols[0] : uCols[0], horizontal ? uRows[0] : rows[0]);
    const bg  = document.createElement('div');
    bg.className    = 'group-bg';
    bg.style.left   = (pos.left - PAD) + 'px';
    bg.style.top    = (pos.top  - PAD) + 'px';
    bg.style.width  = (horizontal ? spanOf(cols.length) : CELL_SIZE) + PAD * 2 + 'px';
    bg.style.height = (vertical   ? spanOf(rows.length) : CELL_SIZE) + PAD * 2 + 'px';
    container.appendChild(bg);
  });
}

// ── Blackboard ───────────────────────────────────────────
export function defaultBlackboardInset() {
  return { before: CTRL_SIZE + BB_MARGIN, after: BB_MARGIN };
}

/**
 * Length of the track the board is measured against.
 *
 * `inset.before` is measured from the edge of #classroom, which on screen
 * starts CTRL_SIZE earlier than the desk grid because the row/column controls
 * sit there. The track therefore has to include that strip — leaving it out is
 * what made the board CTRL_SIZE too narrow, giving it 40px of air on one side
 * and 12px on the other despite BB_MARGIN promising an equal margin.
 */
export function blackboardTrackLength() {
  const pos = state.blackboardPosition || 'top';
  const grid = (pos === 'top' || pos === 'bottom')
    ? spanOf(state.gridCols)
    : spanOf(state.gridRows);
  return CTRL_SIZE + grid;
}

/** Resizes/positions the board. Cheap enough to call on every drag frame —
 *  it deliberately does not rebuild the drag handles. */
export function syncBlackboard() {
  const bb    = $('blackboard');
  const cls   = $('classroom');
  const pos   = state.blackboardPosition || 'top';
  const inset = state.blackboardInset ?? defaultBlackboardInset();

  cls.classList.remove('bb-top', 'bb-bottom', 'bb-left', 'bb-right');
  cls.classList.add('bb-' + pos);

  const isHoriz = pos === 'top' || pos === 'bottom';
  const size    = Math.max(MIN_BB_SIZE, blackboardTrackLength() - inset.before - inset.after);

  // The row/column controls are hidden when printing, which pulls the desk grid
  // CTRL_SIZE closer to the edge. --ctrl-shift (0 on screen, -CTRL_SIZE in
  // print, set in styles.css) moves the board by the same amount so it stays
  // aligned with the desks on paper.
  const before = `calc(${inset.before}px + var(--ctrl-shift, 0px))`;

  if (isHoriz) {
    Object.assign(bb.style, {
      width: size + 'px', height: '',
      marginLeft: before, marginRight: inset.after + 'px',
      marginTop: '', marginBottom: ''
    });
  } else {
    Object.assign(bb.style, {
      height: size + 'px', width: '',
      marginTop: before, marginBottom: inset.after + 'px',
      marginLeft: '', marginRight: ''
    });
  }
}

/** Creates the resize handles and reset button once. Previously these were
 *  torn down and rebuilt on every mousemove of a board drag. */
export function ensureBlackboardHandles() {
  const bb = $('blackboard');
  if (bb.querySelector('.bb-handle')) return;

  const before = document.createElement('div');
  before.className    = 'bb-handle bb-handle-before';
  before.dataset.edge = 'before';

  const after = document.createElement('div');
  after.className    = 'bb-handle bb-handle-after';
  after.dataset.edge = 'after';

  const reset = document.createElement('button');
  reset.id            = 'bb-reset';
  reset.title         = 'Tilbakestill tavle';
  reset.textContent   = '↺';
  reset.dataset.action = 'reset-blackboard';

  bb.append(before, after, reset);
}

// ── Desks ────────────────────────────────────────────────
export function createDeskElement(desk) {
  const el      = document.createElement('div');
  const isEmpty = !desk.studentName;

  let cls = 'desk';
  if (isEmpty && !desk.marked)  cls += ' desk-empty';
  if (desk.locked)              cls += ' desk-locked';
  if (desk.marked && isEmpty)   cls += ' desk-marked';
  if (desk.size === 2)          cls += ' desk-wide';

  el.className      = cls;
  el.id             = 'desk-el-' + desk.id;
  el.draggable      = true;
  el.dataset.id     = desk.id;
  el.textContent    = desk.studentName || '';
  el.style.fontSize = deskFontSize(desk.studentName, desk);
  el.style.width    = deskWidth(desk) + 'px';

  const p = cellToPos(desk.col, desk.row);
  el.style.left = p.left + 'px';
  el.style.top  = p.top  + 'px';
  return el;
}

function createTeacherDeskElement(td) {
  const el       = document.createElement('div');
  el.className   = 'desk desk-teacher';
  el.id          = 'desk-el-teacher';
  el.draggable   = true;
  el.dataset.id  = 'teacher';
  el.textContent = 'LÆRER';

  const p = cellToPos(td.col, td.row);
  el.style.left = p.left + 'px';
  el.style.top  = p.top  + 'px';
  return el;
}

/** Re-applies font sizes without rebuilding the grid — used by the text-size
 *  slider, which fires continuously while dragging. */
export function refreshDeskFontSizes() {
  state.desks.forEach(desk => {
    const el = $('desk-el-' + desk.id);
    if (el) el.style.fontSize = deskFontSize(desk.studentName, desk);
  });
}

export function renderClassroom() {
  $('classroom-title').textContent = state.className;
  updatePrintHeader();
  syncBlackboard();
  ensureBlackboardHandles();

  const container = $('grid-container');
  container.textContent = '';
  container.style.width  = spanOf(state.gridCols) + 'px';
  container.style.height = spanOf(state.gridRows) + 'px';

  // 1 — grid cells
  const frag = document.createDocumentFragment();
  for (let row = 1; row <= state.gridRows; row++) {
    for (let col = 1; col <= state.gridCols; col++) {
      const cell = document.createElement('div');
      cell.className   = 'grid-cell';
      cell.dataset.col = col;
      cell.dataset.row = row;
      const p = cellToPos(col, row);
      cell.style.left = p.left + 'px';
      cell.style.top  = p.top  + 'px';
      frag.appendChild(cell);
    }
  }
  container.appendChild(frag);

  // 2 — group backgrounds, 3 — desks, 4 — teacher desk
  renderGroupBackgrounds(container);
  state.desks.forEach(desk => container.appendChild(createDeskElement(desk)));
  if (state.teacherDesk) container.appendChild(createTeacherDeskElement(state.teacherDesk));

  renderRowColControls();
  renderStatsBanner();
}

// ── Saved maps / lists ───────────────────────────────────
function renderSavedSelect(selectId, prefix, placeholder) {
  const sel = $(selectId);
  const cur = sel.value;
  sel.textContent = '';

  const blank = document.createElement('option');
  blank.value       = '';
  blank.textContent = placeholder;
  sel.appendChild(blank);

  Object.keys(localStorage)
    .filter(k => k.startsWith(prefix))
    .map(k => k.slice(prefix.length))
    .sort((a, b) => a.localeCompare(b, 'no'))
    .forEach(name => {
      const opt = document.createElement('option');
      opt.value = opt.textContent = name;
      sel.appendChild(opt);
    });

  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

export function renderSavedMaps() {
  renderSavedSelect('saved-maps', LS_MAP, '— Velg lagret kart —');
}

export function renderSavedLists() {
  renderSavedSelect('saved-lists', LS_LIST, '— Velg elevliste —');
}

// ── Exclusions ───────────────────────────────────────────
export function renderExclusionList() {
  const ul = $('exclusion-list');
  ul.textContent = '';
  state.exclusions.forEach((ex, i) => {
    const li  = document.createElement('li');
    const sp  = document.createElement('span');
    sp.textContent = `${ex.a} og ${ex.b}`;

    const btn = document.createElement('button');
    btn.textContent    = '×';
    btn.className      = 'excl-remove';
    btn.title          = 'Fjern regel';
    btn.dataset.action = 'remove-exclusion';
    btn.dataset.index  = i;

    li.append(sp, btn);
    ul.appendChild(li);
  });
}

// ── Full render ──────────────────────────────────────────
export function renderAll() {
  $('class-name').value        = state.className;
  $('students-textarea').value = state.students.join('\n');
  syncDupWarning();
  $('desk-count').value = state.deskCount;
  $('group-size').value = state.groupSize;
  updateGridDisplay();
  $('blackboard-position').value = state.blackboardPosition || 'top';
  $('btn-teacher-desk').textContent =
    state.teacherDesk ? 'Fjern lærerpult' : 'Legg til lærerpult';

  const pct = Math.round((state.textScale || 1) * 100);
  $('text-scale').value          = pct;
  $('text-scale-val').textContent = pct + '%';

  $('print-format').value       = state.printFormat || 'A4';
  $('print-orientation').value  = state.printOrientation || 'landscape';
  $('hide-empty-desks').checked = !!state.hideEmptyDesksOnPrint;
  updatePrintPageStyle();

  updateStudentCount();
  updateDatalist();
  renderClassroom();
  renderMismatchWarning();
  renderSavedMaps();
  renderSavedLists();
  renderExclusionList();
}
