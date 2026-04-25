'use strict';

// ── Constants ────────────────────────────────────────────
const CELL_SIZE   = 80;
const CELL_GAP    = 8;
const CELL_STRIDE = CELL_SIZE + CELL_GAP; // 88px per cell slot
const LS_MAP      = 'klassekart_';        // prefix for saved seating charts
const LS_LIST     = 'kl_liste_';          // prefix for saved student lists
const MAX_UNDO    = 20;
const CTRL_SIZE   = 28; // row-controls width = col-controls height (fixed in CSS)
const BB_MARGIN   = 12; // equal visible margin on each side of grid cells (default)

// ── State ────────────────────────────────────────────────
let state = {
  version:             1,
  className:           '',
  students:            [],
  deskCount:           24,
  groupSize:           2,
  gridCols:            8,
  gridRows:            6,
  blackboardPosition:  'top',
  hasRandomized:       false,
  exclusions:          [],   // [{a: 'Name1', b: 'Name2'}]
  teacherDesk:         null, // {col, row} or null
  desks:               [],   // [{id, col, row, groupId, studentName, locked, size}]
  groups:              [],   // [{id, deskIds:[...]}]
  printFormat:            'A4',
  printOrientation:       'landscape',
  textScale:              1,
  hideEmptyDesksOnPrint:  false,
  blackboardInset:        null
};

const undoStack = [];
let dragDeskId = null;
let ctxDeskId  = null;
let moveMode   = null; // { type: 'row'|'col', index: number }

// ── Utilities ─────────────────────────────────────────────
function cellToPos(col, row) {
  return { left: (col - 1) * CELL_STRIDE, top: (row - 1) * CELL_STRIDE };
}

function deskWidth(desk) {
  return desk && desk.size === 2 ? CELL_STRIDE * 2 - CELL_GAP : CELL_SIZE;
}

function deskFontSize(name) {
  const scale = state.textScale || 1;
  if (!name) return Math.round(11 * scale) + 'px';
  // Inner desk width ≈ 66px (80px - 14px padding).
  // system-ui char width ≈ font-size × 0.60 on average.
  const computed = Math.floor(66 / (name.length * 0.60));
  return Math.round(Math.max(7, Math.min(12, computed)) * scale) + 'px';
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function safeName(name) {
  return (name || 'Uten navn').replace(/[^\w æøåÆØÅ-]/g, '').trim() || 'Uten navn';
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function syncDupWarning() {
  const names  = document.getElementById('students-textarea').value
    .split('\n').map(s => s.trim()).filter(Boolean);
  const dups   = detectDuplicates(names);
  const warnEl = document.getElementById('dup-warning');
  if (dups.length > 0) {
    warnEl.textContent   = '⚠ Duplikat: ' + dups.join(', ');
    warnEl.style.display = 'block';
  } else {
    warnEl.style.display = 'none';
  }
  return dups;
}

// Returns names that appear more than once in the array
function detectDuplicates(names) {
  const seen = new Set();
  const dups = [];
  for (const name of names) {
    if (seen.has(name)) { if (!dups.includes(name)) dups.push(name); }
    else seen.add(name);
  }
  return dups;
}

// Returns students in state.students who are not seated at any desk
function studentsWithoutDesk() {
  const assigned = new Set(state.desks.map(d => d.studentName).filter(Boolean));
  return state.students.filter(s => !assigned.has(s));
}

function isAxisEmpty(axis, value) {
  return !state.desks.some(d => d[axis] === value) &&
         !(state.teacherDesk && state.teacherDesk[axis] === value);
}

// ── Undo ─────────────────────────────────────────────────
function pushUndo() {
  undoStack.push(deepClone(state));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function undo() {
  if (undoStack.length === 0) { showToast('Ingenting å angre'); return; }
  Object.assign(state, undoStack.pop());
  renderAll();
  showToast('Angret');
}

// ── Layout computation ────────────────────────────────────
function calcGroupsPerRow(groupSize, gridCols) {
  if (groupSize === 1) return gridCols;
  return Math.max(1, Math.floor((gridCols + 1) / (groupSize + 1)));
}

function computeLayout(deskCount, groupSize, gridCols) {
  const gpr     = calcGroupsPerRow(groupSize, gridCols);
  const colStep = groupSize === 1 ? 1 : groupSize + 1;
  return Array.from({ length: deskCount }, (_, i) => {
    const deskInGroup = i % groupSize;
    const groupIndex  = Math.floor(i / groupSize);
    return {
      col: (groupIndex % gpr) * colStep + deskInGroup + 1,
      row: Math.floor(groupIndex / gpr) * 2 + 1
    };
  });
}

function calcRequiredRows(deskCount, groupSize, gridCols) {
  const gpr      = calcGroupsPerRow(groupSize, gridCols);
  const grpRows  = Math.ceil(Math.ceil(deskCount / groupSize) / gpr);
  return Math.max(1, grpRows * 2 - 1);
}

// ── Build desks ───────────────────────────────────────────
function rebuildDesks(preserveNames) {
  const positions = computeLayout(state.deskCount, state.groupSize, state.gridCols);
  const oldDesks  = preserveNames ? state.desks : [];
  const newDesks  = [];
  const newGroups = {};

  for (let i = 0; i < state.deskCount; i++) {
    const groupIndex = Math.floor(i / state.groupSize);
    const groupId    = 'g' + (groupIndex + 1);
    const deskId     = 'd' + (i + 1);
    const pos        = positions[i] || { col: 1, row: 1 };

    if (!newGroups[groupId]) newGroups[groupId] = { id: groupId, deskIds: [] };
    newGroups[groupId].deskIds.push(deskId);

    newDesks.push({
      id:          deskId,
      col:         pos.col,
      row:         pos.row,
      groupId,
      studentName: (oldDesks[i] && oldDesks[i].studentName) || null,
      locked:      (oldDesks[i] && oldDesks[i].locked)      || false,
      marked:      (oldDesks[i] && oldDesks[i].marked)      || false,
      size:        (oldDesks[i] && oldDesks[i].size)        || 1
    });
  }

  state.desks  = newDesks;
  state.groups = Object.values(newGroups);

  // Expand grid rows if layout needs more space
  const needed = calcRequiredRows(state.deskCount, state.groupSize, state.gridCols) + 1;
  if (state.gridRows < needed) {
    state.gridRows = needed;
    updateGridDisplay();
  }
}

// ── Exclusions ────────────────────────────────────────────
function areNeighbors(d1, d2) {
  return Math.abs(d1.col - d2.col) <= 1 && Math.abs(d1.row - d2.row) <= 1;
}

function checkExclusions(desks) {
  for (const ex of state.exclusions) {
    const d1 = desks.find(d => d.studentName === ex.a);
    const d2 = desks.find(d => d.studentName === ex.b);
    if (d1 && d2 && areNeighbors(d1, d2)) return false;
  }
  return true;
}

// ── Auto layout ───────────────────────────────────────────
// Computes a balanced gridCols/gridRows for the given desk count.
// Desk rows are placed at odd rows (1, 3, 5…), leaving empty rows between.
function computeAutoLayout(deskCount, groupSize) {
  const totalGroups = Math.ceil(deskCount / Math.max(1, groupSize));
  // Aim for a layout that's slightly wider than tall
  let gpr = Math.max(2, Math.min(6, Math.round(Math.sqrt(totalGroups))));

  const gridCols = groupSize <= 1 ? gpr : gpr * (groupSize + 1) - 1;
  const groupRows = Math.ceil(totalGroups / gpr);
  // Each desk-row occupies 1 row; the gap after it occupies 1 row → ×2 total
  const gridRows = groupRows * 2;

  return { gridCols: Math.max(2, gridCols), gridRows: Math.max(3, gridRows) };
}

// ── Randomize ─────────────────────────────────────────────
function randomizeSeating() {
  if (syncDupWarning().length > 0) {
    showToast('Fjern duplikatnavn først');
    return;
  }
  pushUndo();

  // First-time randomization: auto-compute an optimal grid layout
  if (!state.hasRandomized) {
    const auto = computeAutoLayout(state.deskCount, state.groupSize);
    state.gridCols = auto.gridCols;
    state.gridRows = auto.gridRows;
    updateGridDisplay();
    rebuildDesks(false); // fresh positions using the new layout
    state.hasRandomized = true;
  }

  const locked        = state.desks.filter(d => d.locked || d.marked);
  const unlocked      = state.desks.filter(d => !d.locked && !d.marked);
  const lockedNames   = new Set(locked.map(d => d.studentName).filter(Boolean));
  const available     = state.students.filter(s => !lockedNames.has(s));

  const MAX_ATTEMPTS  = 200;
  let bestShuffle     = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const shuffled = shuffle(available);

    if (state.exclusions.length === 0) {
      unlocked.forEach((desk, i) => { desk.studentName = shuffled[i] ?? null; });
      break;
    }

    // Build test array for exclusion check
    const testDesks = [
      ...locked,
      ...unlocked.map((desk, i) => ({ ...desk, studentName: shuffled[i] ?? null }))
    ];

    if (checkExclusions(testDesks)) {
      unlocked.forEach((desk, i) => { desk.studentName = shuffled[i] ?? null; });
      bestShuffle = null; // satisfied — no fallback needed
      break;
    }
    if (!bestShuffle) bestShuffle = shuffled;
  }

  // Fallback: apply best found if no valid arrangement found
  if (bestShuffle) {
    unlocked.forEach((desk, i) => { desk.studentName = bestShuffle[i] ?? null; });
    showToast('Randomisert (klarte ikke unngå alle naboskap)');
  } else {
    showToast('Pulter randomisert!');
  }

  renderClassroom();
  renderMismatchWarning();
}

// ── Grid display sync ────────────────────────────────────
function updateGridDisplay() {
  const cv = document.getElementById('grid-cols-val');
  const rv = document.getElementById('grid-rows-val');
  if (cv) cv.textContent = state.gridCols;
  if (rv) rv.textContent = state.gridRows;
}

// ── Print page style (dynamic @page) ─────────────────────
const VALID_PRINT_FORMATS      = new Set(['A4', 'A3']);
const VALID_PRINT_ORIENTATIONS = new Set(['landscape', 'portrait']);

function updatePrintPageStyle() {
  let style = document.getElementById('print-page-style');
  if (!style) {
    style    = document.createElement('style');
    style.id = 'print-page-style';
    document.head.appendChild(style);
  }
  // Allowlist-validate to prevent CSS injection via imported JSON
  const fmt = VALID_PRINT_FORMATS.has(state.printFormat)           ? state.printFormat      : 'A4';
  const ori = VALID_PRINT_ORIENTATIONS.has(state.printOrientation) ? state.printOrientation : 'landscape';
  let css = `@media print { @page { size: ${fmt} ${ori}; margin: 10mm; } }`;
  if (state.hideEmptyDesksOnPrint) css += ' @media print { .desk-empty { visibility: hidden !important; } }';
  style.textContent = css;
}

// ── Render helpers ────────────────────────────────────────
function updateStudentCount() {
  document.getElementById('student-count').textContent = '(' + state.students.length + ')';
}

function updateDatalist() {
  const dl = document.getElementById('students-datalist');
  dl.innerHTML = '';
  state.students.forEach(name => {
    const opt  = document.createElement('option');
    opt.value  = name;
    dl.appendChild(opt);
  });
}

function renderStatsBanner() {
  const banner = document.getElementById('stats-banner');
  if (!banner) return;
  if (state.desks.length === 0) { banner.classList.remove('visible'); return; }
  const locked   = state.desks.filter(d => d.locked).length;
  const assigned = state.desks.filter(d => d.studentName && !d.locked).length;
  const marked   = state.desks.filter(d => d.marked && !d.studentName && !d.locked).length;
  const empty    = state.desks.filter(d => !d.studentName && !d.locked && !d.marked).length;
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

function renderMismatchWarning() {
  const w  = document.getElementById('mismatch-warning');
  const ol = document.getElementById('overflow-list');
  w.innerHTML = '';
  ol.textContent = '';

  const unassigned  = studentsWithoutDesk();
  const emptyDesks  = state.desks.filter(d => !d.studentName && !d.locked && !d.marked).length;

  if (unassigned.length > 0) {
    // Some students have no desk
    w.className = 'show';
    const txt = document.createElement('span');
    txt.textContent = `${unassigned.length} elev${unassigned.length > 1 ? 'er' : ''} har ikke pult`;
    const btn = document.createElement('button');
    btn.className   = 'btn-fix-desks';
    btn.textContent = `+ Legg til ${unassigned.length} pult${unassigned.length > 1 ? 'er' : ''}`;
    btn.addEventListener('click', fixMissingDesks);
    w.appendChild(txt);
    w.appendChild(btn);
    ol.textContent = 'Uten pult: ' + unassigned.join(', ');
  } else if (emptyDesks > 0) {
    // More desks than students
    w.className = 'show';
    const txt = document.createElement('span');
    txt.textContent = `${emptyDesks} pult${emptyDesks > 1 ? 'er' : ''} er tom${emptyDesks > 1 ? 'me' : ''}`;
    const btn = document.createElement('button');
    btn.className   = 'btn-fix-desks btn-trim-desks';
    btn.textContent = `Fjern ${emptyDesks} overflødige pult${emptyDesks > 1 ? 'er' : ''}`;
    btn.addEventListener('click', removeExcessDesks);
    w.appendChild(txt);
    w.appendChild(btn);
  } else {
    w.className = '';
  }
}

function fixMissingDesks() {
  pushUndo();
  const unassigned = studentsWithoutDesk();
  if (unassigned.length === 0) return;

  const emptyDesks = state.desks.filter(d => !d.studentName && !d.locked);
  // Fill existing empty desks first; remainder needs new desks placed on grid
  unassigned.slice(0, emptyDesks.length).forEach((name, i) => { emptyDesks[i].studentName = name; });
  const toPlace = unassigned.slice(emptyDesks.length);

  if (toPlace.length > 0) {
    const occupied = new Set(state.desks.map(d => `${d.col},${d.row}`));
    if (state.teacherDesk) occupied.add(`${state.teacherDesk.col},${state.teacherDesk.row}`);
    let nextId = Date.now();
    toPlace.forEach(name => {
      let col = 1, row = state.gridRows;
      outer: for (let r = 1; r <= state.gridRows + 10; r++) {
        for (let c = 1; c <= state.gridCols; c++) {
          if (!occupied.has(`${c},${r}`)) { col = c; row = r; break outer; }
        }
      }
      if (row > state.gridRows) {
        state.gridRows = row;
      }
      occupied.add(`${col},${row}`);
      state.desks.push({ id: 'd_fx' + (nextId++), col, row, groupId: 'g_extra', studentName: name, locked: false, size: 1 });
    });
  }

  state.deskCount = state.desks.length;
  document.getElementById('desk-count').value = state.deskCount;
  renderAll();
  showToast(`${unassigned.length} elev${unassigned.length > 1 ? 'er' : ''} tildelt pult`);
}

function removeExcessDesks() {
  pushUndo();
  const before = state.desks.length;
  state.desks   = state.desks.filter(d => d.studentName || d.locked || d.marked);
  const removed = before - state.desks.length;
  state.deskCount = state.desks.length;
  document.getElementById('desk-count').value = state.deskCount;
  renderAll();
  showToast(`${removed} tom${removed !== 1 ? 'me' : ''} pult${removed !== 1 ? 'er' : ''} fjernet`);
}

// ── Row / Column delete & move ────────────────────────────

// Deletes an entire row or column, compacting toward the board in one pass.
// axis: 'row' | 'col'   index: 1-based row or column number
function deleteAxis(axis, index) {
  pushUndo();
  const pos   = state.blackboardPosition || 'top';
  const isRow = axis === 'row';
  // Compact toward board: rows shift up for board-top, down for board-bottom;
  // cols shift left for board-left/top/bottom, right for board-right.
  const shiftBack = isRow ? pos !== 'bottom' : pos !== 'right';
  const delta     = shiftBack ? -1 : 1;
  const dimKey    = isRow ? 'gridRows' : 'gridCols';
  const inputId   = isRow ? 'grid-rows' : 'grid-cols';
  const label     = isRow ? 'Rad' : 'Kolonne';

  let removedCount = 0;
  const newDesks = [];
  for (const d of state.desks) {
    if (d[axis] === index) { removedCount++; continue; }
    if (shiftBack ? d[axis] > index : d[axis] < index) d[axis] += delta;
    newDesks.push(d);
  }
  state.desks     = newDesks;
  state.deskCount = newDesks.length;

  let teacherRemoved = false;
  if (state.teacherDesk) {
    if (state.teacherDesk[axis] === index) {
      state.teacherDesk = null;
      teacherRemoved    = true;
      document.getElementById('btn-teacher-desk').textContent = 'Legg til lærerpult';
    } else if (shiftBack ? state.teacherDesk[axis] > index : state.teacherDesk[axis] < index) {
      state.teacherDesk[axis] += delta;
    }
  }

  state[dimKey] = Math.max(1, state[dimKey] - 1);
  // Clamp any desks that ended up beyond the new grid boundary (board-at-bottom/right edge case)
  const maxVal = state[dimKey];
  state.desks.forEach(d => { if (d[axis] > maxVal) d[axis] = maxVal; });
  document.getElementById('desk-count').value = state.deskCount;
  renderAll();
  const base = removedCount > 0
    ? `${label} slettet (${removedCount} pult${removedCount !== 1 ? 'er' : ''} fjernet)`
    : `Tom ${label.toLowerCase()} slettet`;
  showToast(teacherRemoved ? base + ' + lærerpult fjernet' : base);
}

// Moves all desks (and teacher desk) from one row/col to another empty row/col.
function moveAxis(axis, from, to) {
  if (from === to) return;
  pushUndo();
  state.desks.forEach(d => { if (d[axis] === from) d[axis] = to; });
  if (state.teacherDesk && state.teacherDesk[axis] === from) state.teacherDesk[axis] = to;
  moveMode = null;
  renderAll();
  showToast(axis === 'row' ? 'Rad flyttet' : 'Kolonne flyttet');
}

function enterMoveMode(type, index) {
  moveMode = { type, index };
  renderClassroom();
}

function exitMoveMode() {
  moveMode = null;
  renderClassroom();
}

// ── Row / Column controls rendering ──────────────────────
function renderRowColControls() {
  const rowCtrl = document.getElementById('row-controls');
  const colCtrl = document.getElementById('col-controls');
  if (!rowCtrl || !colCtrl) return;

  rowCtrl.innerHTML = '';
  colCtrl.innerHTML = '';
  rowCtrl.style.height = (state.gridRows * CELL_STRIDE - CELL_GAP) + 'px';
  colCtrl.style.width  = (state.gridCols * CELL_STRIDE - CELL_GAP) + 'px';

  // Builds one control slot for a row or column.
  function buildSlot(axis, index) {
    const isRow    = axis === 'row';
    const inMode   = moveMode?.type === axis;
    const otherMode= moveMode && !inMode;
    const ctrl     = document.createElement('div');
    ctrl.className = isRow ? 'row-ctrl' : 'col-ctrl';
    if (isRow) { ctrl.style.top    = ((index - 1) * CELL_STRIDE) + 'px'; ctrl.style.height = CELL_SIZE + 'px'; }
    else       { ctrl.style.left   = ((index - 1) * CELL_STRIDE) + 'px'; ctrl.style.width  = CELL_SIZE + 'px'; }

    if (inMode) {
      if (moveMode.index === index) {
        ctrl.classList.add('rc-selected');
        const btn = document.createElement('button');
        btn.className = 'ctrl-btn ctrl-cancel'; btn.textContent = '✕'; btn.title = 'Avbryt flytting';
        btn.addEventListener('click', e => { e.stopPropagation(); exitMoveMode(); });
        ctrl.appendChild(btn);
      } else if (isAxisEmpty(axis, index)) {
        ctrl.classList.add('rc-valid');
        ctrl.title = `Flytt ${isRow ? 'rad' : 'kolonne'} ${moveMode.index} hit`;
        ctrl.style.cursor = 'pointer';
        ctrl.addEventListener('click', () => moveAxis(axis, moveMode.index, index));
      } else {
        ctrl.classList.add('rc-invalid');
        ctrl.title = `${isRow ? 'Raden' : 'Kolonnen'} er ikke tom`;
      }
    } else if (!otherMode) {
      const delBtn = document.createElement('button');
      delBtn.className = 'ctrl-btn ctrl-delete'; delBtn.textContent = '×';
      delBtn.title = `Slett ${isRow ? 'rad' : 'kolonne'}`;
      delBtn.addEventListener('click', e => { e.stopPropagation(); deleteAxis(axis, index); });

      const movBtn = document.createElement('button');
      movBtn.className = 'ctrl-btn ctrl-move'; movBtn.textContent = isRow ? '⇅' : '⇄';
      movBtn.title = `Flytt ${isRow ? 'rad' : 'kolonne'} til tom ${isRow ? 'rad' : 'kolonne'}`;
      movBtn.addEventListener('click', e => { e.stopPropagation(); enterMoveMode(axis, index); });

      ctrl.appendChild(delBtn);
      ctrl.appendChild(movBtn);
    }
    return ctrl;
  }

  for (let r = 1; r <= state.gridRows; r++) rowCtrl.appendChild(buildSlot('row', r));
  for (let c = 1; c <= state.gridCols; c++) colCtrl.appendChild(buildSlot('col', c));
}

function renderGroupBackgrounds(container) {
  const map = {};
  state.desks.forEach(d => {
    if (!map[d.groupId]) map[d.groupId] = [];
    map[d.groupId].push(d);
  });

  Object.values(map).forEach(desks => {
    if (desks.length < 2) return;
    // Skip if any desk in the group is wide (visual overlap would look odd)
    if (desks.some(d => d.size === 2)) return;

    const cols = desks.map(d => d.col).sort((a, b) => a - b);
    const rows = desks.map(d => d.row).sort((a, b) => a - b);
    const uRows = [...new Set(rows)];
    const uCols = [...new Set(cols)];

    if (uRows.length === 1 && cols.every((c, i) => i === 0 || c === cols[i - 1] + 1)) {
      // Horizontal adjacent group
      const bg   = document.createElement('div');
      bg.className = 'group-bg';
      const pos  = cellToPos(cols[0], uRows[0]);
      bg.style.left   = (pos.left - 5) + 'px';
      bg.style.top    = (pos.top  - 5) + 'px';
      bg.style.width  = (cols.length * CELL_STRIDE - CELL_GAP + 10) + 'px';
      bg.style.height = (CELL_SIZE + 10) + 'px';
      container.appendChild(bg);
    } else if (uCols.length === 1 && rows.every((r, i) => i === 0 || r === rows[i - 1] + 1)) {
      // Vertical adjacent group
      const bg   = document.createElement('div');
      bg.className = 'group-bg';
      const pos  = cellToPos(uCols[0], rows[0]);
      bg.style.left   = (pos.left - 5) + 'px';
      bg.style.top    = (pos.top  - 5) + 'px';
      bg.style.width  = (CELL_SIZE + 10) + 'px';
      bg.style.height = (rows.length * CELL_STRIDE - CELL_GAP + 10) + 'px';
      container.appendChild(bg);
    }
  });
}

const MIN_BB_SIZE = 40;

function defaultBlackboardInset() {
  return { before: CTRL_SIZE + BB_MARGIN, after: BB_MARGIN };
}

function syncBlackboard() {
  const bb    = document.getElementById('blackboard');
  const cls   = document.getElementById('classroom');
  const pos   = state.blackboardPosition || 'top';
  const inset = state.blackboardInset ?? defaultBlackboardInset();

  cls.classList.remove('bb-top', 'bb-bottom', 'bb-left', 'bb-right');
  cls.classList.add('bb-' + pos);

  const gridW = state.gridCols * CELL_STRIDE - CELL_GAP;
  const gridH = state.gridRows * CELL_STRIDE - CELL_GAP;

  if (pos === 'top' || pos === 'bottom') {
    const w = Math.max(MIN_BB_SIZE, gridW - inset.before - inset.after);
    bb.style.width        = w + 'px';
    bb.style.height       = '';
    bb.style.marginLeft   = inset.before + 'px';
    bb.style.marginRight  = inset.after  + 'px';
    bb.style.marginTop    = '';
    bb.style.marginBottom = '';
  } else {
    const h = Math.max(MIN_BB_SIZE, gridH - inset.before - inset.after);
    bb.style.height       = h + 'px';
    bb.style.width        = '';
    bb.style.marginTop    = inset.before + 'px';
    bb.style.marginBottom = inset.after  + 'px';
    bb.style.marginLeft   = '';
    bb.style.marginRight  = '';
  }

  setupBlackboardHandles(pos);
}

function setupBlackboardHandles(pos) {
  const bb = document.getElementById('blackboard');
  bb.querySelectorAll('.bb-handle, #bb-reset').forEach(h => h.remove());

  const hBefore = document.createElement('div');
  hBefore.className = 'bb-handle bb-handle-before';
  const hAfter = document.createElement('div');
  hAfter.className = 'bb-handle bb-handle-after';
  bb.appendChild(hBefore);
  bb.appendChild(hAfter);

  const isHoriz = pos === 'top' || pos === 'bottom';

  // Add reset button
  const resetBtn = document.createElement('button');
  resetBtn.id = 'bb-reset';
  resetBtn.title = 'Tilbakestill tavle';
  resetBtn.textContent = '↺';
  resetBtn.addEventListener('click', e => {
    e.stopPropagation();
    state.blackboardInset = null;
    syncBlackboard();
  });
  bb.appendChild(resetBtn);

  function makeDragHandler(isBefore) {
    return function(e) {
      e.preventDefault();
      if (!state.blackboardInset) state.blackboardInset = defaultBlackboardInset();
      const gridDim   = isHoriz ? state.gridCols * CELL_STRIDE - CELL_GAP
                                : state.gridRows * CELL_STRIDE - CELL_GAP;
      const startPos  = isHoriz ? e.clientX : e.clientY;
      const startVal  = isBefore ? state.blackboardInset.before : state.blackboardInset.after;
      const otherVal  = () => isBefore ? state.blackboardInset.after : state.blackboardInset.before;

      function onMove(ev) {
        const delta    = (isHoriz ? ev.clientX : ev.clientY) - startPos;
        const adjusted = isBefore ? delta : -delta;
        const maxInset = Math.max(0, gridDim - MIN_BB_SIZE - otherVal());
        const newVal   = Math.max(0, Math.min(maxInset, startVal + adjusted));
        if (isBefore) state.blackboardInset.before = newVal;
        else          state.blackboardInset.after  = newVal;
        syncBlackboard();
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
  }

  hBefore.addEventListener('mousedown', makeDragHandler(true));
  hAfter.addEventListener('mousedown', makeDragHandler(false));
}

function renderClassroom() {
  document.getElementById('classroom-title').textContent = state.className;
  updatePrintHeader();
  syncBlackboard();

  const container = document.getElementById('grid-container');
  container.innerHTML = '';

  container.style.width  = (state.gridCols * CELL_STRIDE - CELL_GAP) + 'px';
  container.style.height = (state.gridRows * CELL_STRIDE - CELL_GAP) + 'px';

  // 1 — Grid cells
  for (let row = 1; row <= state.gridRows; row++) {
    for (let col = 1; col <= state.gridCols; col++) {
      const cell = document.createElement('div');
      cell.className   = 'grid-cell';
      cell.dataset.col = col;
      cell.dataset.row = row;
      const p = cellToPos(col, row);
      cell.style.left  = p.left + 'px';
      cell.style.top   = p.top  + 'px';
      container.appendChild(cell);
    }
  }

  // 2 — Group backgrounds
  renderGroupBackgrounds(container);

  // 3 — Regular desks
  state.desks.forEach(desk => {
    const el = createDeskElement(desk);
    container.appendChild(el);
  });

  // 4 — Teacher desk
  if (state.teacherDesk) {
    const el = createTeacherDeskElement(state.teacherDesk);
    container.appendChild(el);
  }

  initDragAndDrop(container);
  renderRowColControls();
  renderStatsBanner();
}

function createDeskElement(desk) {
  const el         = document.createElement('div');
  const isEmpty    = !desk.studentName;
  let cls          = 'desk';
  if (isEmpty && !desk.marked) cls += ' desk-empty';
  if (desk.locked)             cls += ' desk-locked';
  if (desk.marked && isEmpty)  cls += ' desk-marked';
  if (desk.size === 2) cls += ' desk-wide';
  el.className     = cls;
  el.id            = 'desk-el-' + desk.id;
  el.draggable     = true;
  el.dataset.id    = desk.id;
  el.textContent   = desk.studentName || '';
  el.style.fontSize = deskFontSize(desk.studentName);
  el.style.width   = deskWidth(desk) + 'px';

  const p = cellToPos(desk.col, desk.row);
  el.style.left    = p.left + 'px';
  el.style.top     = p.top  + 'px';
  return el;
}

function createTeacherDeskElement(td) {
  const el         = document.createElement('div');
  el.className     = 'desk desk-teacher';
  el.id            = 'desk-el-teacher';
  el.draggable     = true;
  el.dataset.id    = 'teacher';
  el.textContent   = 'LÆRER';

  const p = cellToPos(td.col, td.row);
  el.style.left    = p.left + 'px';
  el.style.top     = p.top  + 'px';
  return el;
}

function renderSavedMaps() {
  const sel = document.getElementById('saved-maps');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Velg lagret kart —</option>';
  Object.keys(localStorage)
    .filter(k => k.startsWith(LS_MAP))
    .map(k => k.slice(LS_MAP.length))
    .sort()
    .forEach(name => {
      const opt = document.createElement('option');
      opt.value = opt.textContent = name;
      sel.appendChild(opt);
    });
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

function renderSavedLists() {
  const sel = document.getElementById('saved-lists');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Velg elevliste —</option>';
  Object.keys(localStorage)
    .filter(k => k.startsWith(LS_LIST))
    .map(k => k.slice(LS_LIST.length))
    .sort()
    .forEach(name => {
      const opt = document.createElement('option');
      opt.value = opt.textContent = name;
      sel.appendChild(opt);
    });
  if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
}

function renderExclusionList() {
  const ul = document.getElementById('exclusion-list');
  ul.innerHTML = '';
  state.exclusions.forEach((ex, i) => {
    const li  = document.createElement('li');
    const sp  = document.createElement('span');
    sp.textContent = `${ex.a} og ${ex.b}`;
    const btn = document.createElement('button');
    btn.textContent = '×';
    btn.className   = 'excl-remove';
    btn.title       = 'Fjern regel';
    btn.addEventListener('click', () => {
      state.exclusions.splice(i, 1);
      renderExclusionList();
    });
    li.appendChild(sp);
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

function updatePrintHeader() {
  document.getElementById('ph-class').textContent = state.className || 'Klassekart';
  document.getElementById('ph-date').textContent  =
    new Date().toLocaleDateString('no-NO', { year: 'numeric', month: 'long', day: 'numeric' });
}

function renderAll() {
  document.getElementById('class-name').value        = state.className;
  document.getElementById('students-textarea').value = state.students.join('\n');
  syncDupWarning();
  document.getElementById('desk-count').value        = state.deskCount;
  document.getElementById('group-size').value        = state.groupSize;
  updateGridDisplay();
  document.getElementById('blackboard-position').value = state.blackboardPosition || 'top';
  document.getElementById('btn-teacher-desk').textContent =
    state.teacherDesk ? 'Fjern lærerpult' : 'Legg til lærerpult';

  const tsEl = document.getElementById('text-scale');
  if (tsEl) {
    const pct = Math.round((state.textScale || 1) * 100);
    tsEl.value = pct;
    document.getElementById('text-scale-val').textContent = pct + '%';
  }
  const pfEl = document.getElementById('print-format');
  if (pfEl) pfEl.value = state.printFormat || 'A4';
  const poEl = document.getElementById('print-orientation');
  if (poEl) poEl.value = state.printOrientation || 'landscape';
  const heEl = document.getElementById('hide-empty-desks');
  if (heEl) heEl.checked = !!state.hideEmptyDesksOnPrint;
  updatePrintPageStyle();

  updateStudentCount();
  updateDatalist();
  renderClassroom();
  renderMismatchWarning();
  renderSavedMaps();
  renderSavedLists();
  renderExclusionList();
}

// ── Inline edit (double-click) ────────────────────────────
function startInlineEdit(deskEl, deskObj) {
  pushUndo();
  const oldName  = deskObj.studentName;
  deskEl.textContent = '';
  deskEl.draggable   = false;

  const input = document.createElement('input');
  input.type      = 'text';
  input.value     = oldName || '';
  input.className = 'desk-inline-input';
  deskEl.appendChild(input);
  input.focus();
  input.select();

  let done = false;

  function commit() {
    if (done) return;
    done = true;
    const newName = input.value.trim();

    // Update student list
    if (oldName && oldName !== newName) {
      const idx = state.students.indexOf(oldName);
      if (idx !== -1) {
        if (newName) state.students[idx] = newName;
        else state.students.splice(idx, 1);
      }
    } else if (!oldName && newName && !state.students.includes(newName)) {
      state.students.push(newName);
    }

    deskObj.studentName = newName || null;
    document.getElementById('students-textarea').value = state.students.join('\n');
    updateStudentCount();
    updateDatalist();
    renderClassroom();
    renderMismatchWarning();
  }

  function cancel() {
    if (done) return;
    done = true;
    renderClassroom();
  }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.removeEventListener('blur', commit); cancel(); }
  });
}

// ── Drag and drop ─────────────────────────────────────────
function swapRegularDesks(idA, idB) {
  const a = state.desks.find(d => d.id === idA);
  const b = state.desks.find(d => d.id === idB);
  if (!a || !b) return;
  [a.col, b.col] = [b.col, a.col];
  [a.row, b.row] = [b.row, a.row];
}

function moveDesk(deskId, col, row) {
  if (deskId === 'teacher') { moveTeacherDesk(col, row); return; }

  const desk = state.desks.find(d => d.id === deskId);
  if (!desk) return;

  // Check teacher desk
  if (state.teacherDesk && state.teacherDesk.col === col && state.teacherDesk.row === row) {
    const tc = state.teacherDesk.col, tr = state.teacherDesk.row;
    state.teacherDesk.col = desk.col;
    state.teacherDesk.row = desk.row;
    desk.col = tc; desk.row = tr;
    renderClassroom(); return;
  }

  const occupant = state.desks.find(d => d.id !== deskId && d.col === col && d.row === row);
  if (occupant) {
    [desk.col, desk.row, occupant.col, occupant.row] = [col, row, desk.col, desk.row];
  } else {
    desk.col = col; desk.row = row;
  }
  renderClassroom();
}

function moveTeacherDesk(col, row) {
  if (!state.teacherDesk) return;
  const occupant = state.desks.find(d => d.col === col && d.row === row);
  if (occupant) {
    const tc = state.teacherDesk.col, tr = state.teacherDesk.row;
    state.teacherDesk.col = col; state.teacherDesk.row = row;
    occupant.col = tc; occupant.row = tr;
  } else {
    state.teacherDesk.col = col; state.teacherDesk.row = row;
  }
  renderClassroom();
}

function swapWithTeacher(regularDeskId) {
  const desk = state.desks.find(d => d.id === regularDeskId);
  if (!desk || !state.teacherDesk) return;
  const tc = state.teacherDesk.col, tr = state.teacherDesk.row;
  state.teacherDesk.col = desk.col; state.teacherDesk.row = desk.row;
  desk.col = tc; desk.row = tr;
  renderClassroom();
}

function initDragAndDrop(container) {
  // Grid cells — drop targets for empty positions
  container.querySelectorAll('.grid-cell').forEach(cell => {
    cell.addEventListener('dragover', e => {
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      cell.classList.add('drag-over');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'));
    cell.addEventListener('drop', e => {
      e.preventDefault(); cell.classList.remove('drag-over');
      if (!dragDeskId) return;
      pushUndo();
      moveDesk(dragDeskId, +cell.dataset.col, +cell.dataset.row);
    });
  });

  // Desk elements — drag sources + drop targets (swap)
  container.querySelectorAll('.desk').forEach(el => {
    el.addEventListener('dragstart', e => {
      dragDeskId = el.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragDeskId);
      requestAnimationFrame(() => el.classList.add('dragging'));
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      dragDeskId = null;
      container.querySelectorAll('.drag-over').forEach(x => x.classList.remove('drag-over'));
    });

    el.addEventListener('dragover', e => {
      if (el.dataset.id === dragDeskId) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      el.classList.add('drag-over');
    });

    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));

    el.addEventListener('drop', e => {
      e.preventDefault(); el.classList.remove('drag-over');
      if (!dragDeskId || el.dataset.id === dragDeskId) return;

      const srcId = dragDeskId;
      const tgtId = el.dataset.id;
      pushUndo();

      if (srcId === 'teacher') {
        swapWithTeacher(tgtId);
      } else if (tgtId === 'teacher') {
        swapWithTeacher(srcId);
      } else {
        swapRegularDesks(srcId, tgtId);
        renderClassroom();
      }
    });

    // Double-click → inline edit (not for teacher desk)
    if (el.dataset.id !== 'teacher') {
      el.addEventListener('dblclick', e => {
        e.preventDefault();
        const deskObj = state.desks.find(d => d.id === el.dataset.id);
        if (deskObj) startInlineEdit(el, deskObj);
      });
    }

    // Right-click → context menu
    el.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      showContextMenu(e, el.dataset.id, el.dataset.id === 'teacher');
    });
  });
}

// ── Context menu ──────────────────────────────────────────
function showContextMenu(e, deskId, isTeacher) {
  ctxDeskId = deskId;

  const deskObj = isTeacher ? null : state.desks.find(d => d.id === deskId);
  const menu    = document.getElementById('context-menu');

  // Toggle item visibility
  document.getElementById('ctx-lock').style.display           = isTeacher ? 'none' : '';
  document.getElementById('ctx-edit').style.display           = isTeacher ? 'none' : '';
  document.getElementById('ctx-size').style.display           = isTeacher ? 'none' : '';
  document.getElementById('ctx-remove-student').style.display = (isTeacher || !deskObj?.studentName) ? 'none' : '';
  document.getElementById('ctx-remove-teacher').style.display = isTeacher ? '' : 'none';
  document.getElementById('ctx-mark').style.display           = (!isTeacher && !deskObj?.studentName) ? '' : 'none';

  if (deskObj) {
    document.getElementById('ctx-lock').textContent =
      deskObj.locked ? '🔓 Lås opp' : '🔒 Lås pult';
    document.getElementById('ctx-size').textContent =
      deskObj.size === 2 ? '↔️ Gjør smal' : '↔️ Gjør bred';
    document.getElementById('ctx-mark').textContent =
      deskObj.marked ? '📦 Fjern tommerking' : '📦 Merk som tom pult';
  }

  // Position menu — show first to measure, then clamp to viewport
  let left = e.clientX;
  let top  = e.clientY;
  menu.style.left = left + 'px';
  menu.style.top  = top  + 'px';
  menu.classList.add('show');
  const menuW = menu.offsetWidth;
  const menuH = menu.offsetHeight;
  if (left + menuW > window.innerWidth)  left = window.innerWidth  - menuW - 6;
  if (top  + menuH > window.innerHeight) top  = window.innerHeight - menuH - 6;
  menu.style.left = left + 'px';
  menu.style.top  = top  + 'px';
}

function hideContextMenu() {
  document.getElementById('context-menu').classList.remove('show');
  ctxDeskId = null;
}

function setupContextMenuHandlers() {
  document.addEventListener('click', e => {
    if (!document.getElementById('context-menu').contains(e.target)) hideContextMenu();
  });

  document.getElementById('ctx-lock').addEventListener('click', () => {
    const desk = state.desks.find(d => d.id === ctxDeskId);
    if (!desk) return;
    pushUndo();
    desk.locked = !desk.locked;
    hideContextMenu();
    renderClassroom();
  });

  document.getElementById('ctx-edit').addEventListener('click', () => {
    const deskId = ctxDeskId;
    hideContextMenu();
    const deskEl  = document.getElementById('desk-el-' + deskId);
    const deskObj = state.desks.find(d => d.id === deskId);
    if (deskEl && deskObj) startInlineEdit(deskEl, deskObj);
  });

  document.getElementById('ctx-size').addEventListener('click', () => {
    const desk = state.desks.find(d => d.id === ctxDeskId);
    if (!desk) return;
    pushUndo();
    desk.size = desk.size === 2 ? 1 : 2;
    hideContextMenu();
    renderClassroom();
  });

  document.getElementById('ctx-mark').addEventListener('click', () => {
    const desk = state.desks.find(d => d.id === ctxDeskId);
    if (!desk) return;
    pushUndo();
    desk.marked = !desk.marked;
    hideContextMenu();
    renderClassroom();
    renderMismatchWarning();
    renderStatsBanner();
  });

  document.getElementById('ctx-remove-student').addEventListener('click', () => {
    const desk = state.desks.find(d => d.id === ctxDeskId);
    if (!desk) return;
    pushUndo();
    desk.studentName = null;
    hideContextMenu();
    renderClassroom();
    renderMismatchWarning();
  });

  document.getElementById('ctx-remove-teacher').addEventListener('click', () => {
    pushUndo();
    state.teacherDesk = null;
    document.getElementById('btn-teacher-desk').textContent = 'Legg til lærerpult';
    hideContextMenu();
    renderClassroom();
  });
}

// ── New class ────────────────────────────────────────────
function newClass() {
  if (!confirm('Start ny klasse? Alt som ikke er lagret vil gå tapt.')) return;
  state = {
    version:          1,
    className:        '',
    students:         [],
    deskCount:        24,
    groupSize:        2,
    gridCols:         8,
    gridRows:         6,
    blackboardPosition: 'top',
    hasRandomized:    false,
    exclusions:       [],
    teacherDesk:      null,
    desks:            [],
    groups:           [],
    printFormat:           'A4',
    printOrientation:      'landscape',
    textScale:             1,
    hideEmptyDesksOnPrint: false,
    blackboardInset:       null
  };
  undoStack.length = 0;
  moveMode  = null;
  dragDeskId = null;
  hideContextMenu();
  document.getElementById('dup-warning').style.display = 'none';
  rebuildDesks(false);
  renderAll();
  showToast('Ny klasse opprettet');
}

// ── Paste from clipboard ──────────────────────────────────
async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) { showToast('Utklippstavlen er tom'); return; }
    const names = text
      .split(/[\n\r]+/)
      .flatMap(line => line.split(/[\t,;]+/))
      .map(s => s.trim())
      .filter(Boolean);
    if (names.length === 0) { showToast('Ingen navn funnet'); return; }
    const before = state.students.length;
    state.students = [...new Set([...state.students, ...names])];
    const added = state.students.length - before;
    document.getElementById('students-textarea').value = state.students.join('\n');
    document.getElementById('dup-warning').style.display = 'none';
    updateStudentCount();
    updateDatalist();
    renderMismatchWarning();
    showToast(added > 0 ? `${added} navn lagt til` : 'Ingen nye navn funnet');
  } catch {
    showToast('Gi tilgang til utklippstavle i nettleseren');
  }
}

// ── Teacher desk toggle ───────────────────────────────────
function toggleTeacherDesk() {
  pushUndo();
  if (state.teacherDesk) {
    state.teacherDesk = null;
    document.getElementById('btn-teacher-desk').textContent = 'Legg til lærerpult';
  } else {
    const pos        = state.blackboardPosition || 'top';
    const centerCol  = Math.ceil(state.gridCols / 2);
    const centerRow  = Math.ceil(state.gridRows / 2);

    if (pos === 'top') {
      // Shift all student desks down 1 row, teacher at row 1
      state.desks.forEach(d => { d.row += 1; });
      state.gridRows += 1;
      state.teacherDesk = { col: centerCol, row: 1 };
    } else if (pos === 'bottom') {
      // Expand grid down 1 row, teacher at last row
      state.gridRows += 1;
      state.teacherDesk = { col: centerCol, row: state.gridRows };
    } else if (pos === 'left') {
      // Shift all student desks right 1 col, teacher at col 1
      state.desks.forEach(d => { d.col += 1; });
      state.gridCols += 1;
      state.teacherDesk = { col: 1, row: centerRow };
    } else { // right
      // Expand grid right 1 col, teacher at last col
      state.gridCols += 1;
      state.teacherDesk = { col: state.gridCols, row: centerRow };
    }

    document.getElementById('btn-teacher-desk').textContent = 'Fjern lærerpult';
    updateGridDisplay();
  }
  renderClassroom();
}

// ── Persistence: localStorage (named seating charts) ─────
function saveToLocalStorage() {
  const name = safeName(state.className);
  try {
    localStorage.setItem(LS_MAP + name, JSON.stringify({ ...state, version: 1 }));
    renderSavedMaps();
    document.getElementById('saved-maps').value = name;
    showToast(`Lagret som "${name}"`);
  } catch { showToast('Feil ved lagring'); }
}

function loadFromLocalStorage() {
  const name = document.getElementById('saved-maps').value;
  if (!name) { showToast('Velg et lagret kart først'); return; }
  try {
    const raw    = localStorage.getItem(LS_MAP + name);
    if (!raw) { showToast(`Fant ikke "${name}"`); return; }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.desks)) { showToast('Ugyldig data'); return; }
    mergeStateDefaults(parsed);
    Object.assign(state, parsed);
    renderAll();
    showToast(`Lastet inn "${name}"`);
  } catch { showToast('Feil ved innlasting'); }
}

function deleteFromLocalStorage() {
  const name = document.getElementById('saved-maps').value;
  if (!name) { showToast('Velg et kart å slette'); return; }
  if (!confirm(`Slette "${name}"?`)) return;
  localStorage.removeItem(LS_MAP + name);
  renderSavedMaps();
  showToast(`"${name}" slettet`);
}

function clearAllData() {
  if (!confirm('Dette sletter alle lagrede kart, elevlister og siste økt permanent.\nEr du sikker?')) return;
  const keysToDelete = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key.startsWith(LS_MAP) || key.startsWith(LS_LIST) || key === 'klassekart_last') {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach(key => localStorage.removeItem(key));
  renderSavedMaps();
  renderSavedLists();
  showToast(`${keysToDelete.length} element(er) slettet fra nettleseren`);
}

// ── Persistence: student lists ────────────────────────────
function saveList() {
  const name = document.getElementById('list-name-input').value.trim();
  if (!name) { showToast('Skriv et listenavn'); return; }
  if (state.students.length === 0) { showToast('Ingen elever å lagre'); return; }
  localStorage.setItem(LS_LIST + name, JSON.stringify(state.students));
  renderSavedLists();
  document.getElementById('saved-lists').value = name;
  showToast(`Liste "${name}" lagret`);
}

function loadList() {
  const name = document.getElementById('saved-lists').value;
  if (!name) { showToast('Velg en liste'); return; }
  try {
    const raw = localStorage.getItem(LS_LIST + name);
    if (!raw) { showToast(`Fant ikke "${name}"`); return; }
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) { showToast('Ugyldig liste'); return; }
    state.students = list;
    document.getElementById('students-textarea').value = list.join('\n');
    document.getElementById('list-name-input').value   = name;
    updateStudentCount();
    updateDatalist();
    renderMismatchWarning();
    showToast(`Liste "${name}" lastet inn`);
  } catch { showToast('Feil ved innlasting av liste'); }
}

function deleteList() {
  const name = document.getElementById('saved-lists').value;
  if (!name) { showToast('Velg en liste å slette'); return; }
  if (!confirm(`Slette listen "${name}"?`)) return;
  localStorage.removeItem(LS_LIST + name);
  renderSavedLists();
  showToast(`Liste "${name}" slettet`);
}

// ── Persistence: JSON file ────────────────────────────────
function exportJSON() {
  const json = JSON.stringify({ ...state, version: 1 }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = safeName(state.className) + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!Array.isArray(parsed?.desks)) { showToast('Ugyldig JSON-fil'); return; }
      mergeStateDefaults(parsed);
      Object.assign(state, parsed);
      renderAll();
      showToast('Importert!');
    } catch { showToast('Feil ved import'); }
  };
  reader.readAsText(file);
}

// ── PNG export ────────────────────────────────────────────
async function exportPNG() {
  if (typeof html2canvas === 'undefined') {
    showToast('Laster ned html2canvas... prøv igjen om et øyeblikk');
    return;
  }
  showToast('Genererer bilde...');

  // Temporarily hide lock icons and edge controls for the export
  const exportStyle = document.createElement('style');
  exportStyle.id = 'png-export-overrides';
  exportStyle.textContent = `
    .desk-locked::after { display: none !important; }
    #row-controls, #col-controls { display: none !important; }
    .bb-handle, #bb-reset, .sidebar-tab { display: none !important; }
    ${state.hideEmptyDesksOnPrint ? '.desk-empty { visibility: hidden !important; }' : ''}
  `;
  document.head.appendChild(exportStyle);

  try {
    const el     = document.getElementById('classroom');
    const canvas = await html2canvas(el, {
      backgroundColor: '#ffffff',
      scale:           2,
      logging:         false,
      useCORS:         true
    });
    const a    = document.createElement('a');
    a.download = safeName(state.className) + '.png';
    a.href     = canvas.toDataURL('image/png');
    a.click();
  } catch {
    showToast('Kunne ikke eksportere bilde');
  } finally {
    exportStyle.remove();
  }
}

// Ensure new state fields have defaults when loading old saves
function mergeStateDefaults(parsed) {
  if (!parsed.exclusions)         parsed.exclusions         = [];
  if (!parsed.blackboardPosition) parsed.blackboardPosition = 'top';
  if (parsed.teacherDesk === undefined) parsed.teacherDesk  = null;
  // Loaded states already have a layout — don't auto-layout again
  parsed.hasRandomized = true;
  if (parsed.printFormat === undefined)      parsed.printFormat      = 'A4';
  if (parsed.printOrientation === undefined) parsed.printOrientation = 'landscape';
  if (parsed.textScale === undefined)        parsed.textScale        = 1;
  if (parsed.hideEmptyDesksOnPrint === undefined) parsed.hideEmptyDesksOnPrint = false;
  if (!parsed.blackboardInset ||
      (parsed.blackboardInset.before === 0 && parsed.blackboardInset.after === 0)) {
    parsed.blackboardInset = null;
  }
  if (parsed.desks) {
    parsed.desks.forEach(d => {
      if (d.locked === undefined) d.locked = false;
      if (d.marked === undefined) d.marked = false;
      if (!d.size)                d.size   = 1;
    });
  }
}

// ── Toast ─────────────────────────────────────────────────
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast    = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), 2400);
}

// ── Event listeners ───────────────────────────────────────
function setupEventListeners() {
  document.getElementById('class-name').addEventListener('input', e => {
    state.className = e.target.value;
    document.getElementById('classroom-title').textContent = state.className;
    updatePrintHeader();
  });

  document.getElementById('students-textarea').addEventListener('input', e => {
    const newNames = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
    syncDupWarning();

    // Rename detection: exactly one name changed → follow it to assigned desks
    const removed = state.students.filter(n => !newNames.includes(n));
    const added   = newNames.filter(n => !state.students.includes(n));
    if (removed.length === 1 && added.length === 1) {
      const [oldName, newName] = [removed[0], added[0]];
      state.desks.forEach(d => {
        if (d.studentName === oldName) {
          d.studentName = newName;
          const el = document.getElementById('desk-el-' + d.id);
          if (el) {
            el.textContent   = newName;
            el.style.fontSize = deskFontSize(newName);
          }
        }
      });
    }

    state.students = [...new Set(newNames)];
    updateStudentCount();
    updateDatalist();
    renderMismatchWarning();
  });

  document.getElementById('desk-count').addEventListener('change', e => {
    state.deskCount = Math.max(1, Math.min(60, +e.target.value || 1));
    e.target.value  = state.deskCount;
    rebuildDesks(true);
    renderAll();
  });

  document.getElementById('group-size').addEventListener('change', e => {
    state.groupSize = +e.target.value;
    rebuildDesks(true);
    renderAll();
  });

  document.getElementById('grid-cols-dec').addEventListener('click', () => {
    state.gridCols = Math.max(1, state.gridCols - 1);
    updateGridDisplay();
    renderClassroom();
  });
  document.getElementById('grid-cols-inc').addEventListener('click', () => {
    state.gridCols = Math.min(20, state.gridCols + 1);
    updateGridDisplay();
    renderClassroom();
  });
  document.getElementById('grid-rows-dec').addEventListener('click', () => {
    state.gridRows = Math.max(1, state.gridRows - 1);
    updateGridDisplay();
    renderClassroom();
  });
  document.getElementById('grid-rows-inc').addEventListener('click', () => {
    state.gridRows = Math.min(20, state.gridRows + 1);
    updateGridDisplay();
    renderClassroom();
  });

  document.getElementById('blackboard-position').addEventListener('change', e => {
    state.blackboardPosition = e.target.value;
    state.blackboardInset = null;
    renderClassroom();
  });

  document.getElementById('btn-teacher-desk').addEventListener('click', toggleTeacherDesk);
  document.getElementById('btn-randomize').addEventListener('click', randomizeSeating);
  document.getElementById('btn-undo').addEventListener('click', undo);

  // Saved maps
  document.getElementById('btn-save').addEventListener('click', saveToLocalStorage);
  document.getElementById('btn-load').addEventListener('click', loadFromLocalStorage);
  document.getElementById('btn-delete').addEventListener('click', deleteFromLocalStorage);
  document.getElementById('btn-clear-data').addEventListener('click', clearAllData);

  // Student lists
  document.getElementById('btn-save-list').addEventListener('click', saveList);
  document.getElementById('btn-load-list').addEventListener('click', loadList);
  document.getElementById('btn-delete-list').addEventListener('click', deleteList);

  // Exclusions
  document.getElementById('btn-add-excl').addEventListener('click', () => {
    const a = document.getElementById('excl-a').value.trim();
    const b = document.getElementById('excl-b').value.trim();
    if (!a || !b)     { showToast('Skriv inn to elevnavn'); return; }
    if (a === b)      { showToast('Navnene må være forskjellige'); return; }
    if (state.exclusions.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))) {
      showToast('Denne regelen finnes allerede'); return;
    }
    state.exclusions.push({ a, b });
    document.getElementById('excl-a').value = '';
    document.getElementById('excl-b').value = '';
    renderExclusionList();
    showToast('Regel lagt til');
  });

  // Export / Import
  document.getElementById('btn-export').addEventListener('click', exportJSON);
  document.getElementById('btn-export-png').addEventListener('click', exportPNG);
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', e => {
    if (e.target.files.length > 0) { importJSON(e.target.files[0]); e.target.value = ''; }
  });

  // New class
  document.getElementById('btn-new-class').addEventListener('click', newClass);

  // Paste from clipboard
  document.getElementById('btn-paste-students').addEventListener('click', pasteFromClipboard);

  // Text scale slider
  document.getElementById('text-scale').addEventListener('input', e => {
    state.textScale = +e.target.value / 100;
    document.getElementById('text-scale-val').textContent = e.target.value + '%';
    renderClassroom();
  });

  // Print format / orientation
  document.getElementById('print-format').addEventListener('change', e => {
    state.printFormat = e.target.value;
    updatePrintPageStyle();
  });
  document.getElementById('print-orientation').addEventListener('change', e => {
    state.printOrientation = e.target.value;
    updatePrintPageStyle();
  });
  document.getElementById('hide-empty-desks').addEventListener('change', e => {
    state.hideEmptyDesksOnPrint = e.target.checked;
    updatePrintPageStyle();
  });

  setupContextMenuHandlers();

  // Sidebar collapse tabs
  function updateSidebarTabs() {
    const lc = document.getElementById('sidebar-left').classList.contains('collapsed');
    const rc = document.getElementById('sidebar-right').classList.contains('collapsed');
    document.getElementById('tab-left').textContent  = lc ? '›' : '‹';
    document.getElementById('tab-right').textContent = rc ? '‹' : '›';
  }
  document.getElementById('tab-left').addEventListener('click', () => {
    document.getElementById('sidebar-left').classList.toggle('collapsed');
    updateSidebarTabs();
  });
  document.getElementById('tab-right').addEventListener('click', () => {
    document.getElementById('sidebar-right').classList.toggle('collapsed');
    updateSidebarTabs();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && moveMode) exitMoveMode();
    if (e.ctrlKey && e.key === 'z' &&
        e.target.tagName !== 'INPUT' &&
        e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      undo();
    }
  });
}

// ── Init ──────────────────────────────────────────────────
function initApp() {
  // Restore last session
  try {
    const raw = localStorage.getItem('klassekart_last');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.desks) && parsed.desks.length > 0) {
        mergeStateDefaults(parsed);
        Object.assign(state, parsed);
      }
    }
  } catch { /* ignore */ }

  if (state.desks.length === 0) rebuildDesks(false);

  setupEventListeners();
  renderAll();
  updatePrintPageStyle();

  // Auto-save on unload for session continuity
  window.addEventListener('beforeunload', () => {
    try { localStorage.setItem('klassekart_last', JSON.stringify(state)); } catch { /* ignore */ }
  });
}

document.addEventListener('DOMContentLoaded', initApp);
