'use strict';

// ── Constants ────────────────────────────────────────────
const CELL_SIZE   = 80;
const CELL_GAP    = 8;
const CELL_STRIDE = CELL_SIZE + CELL_GAP; // 88px per cell slot
const LS_MAP      = 'klassekart_';        // prefix for saved seating charts
const LS_LIST     = 'kl_liste_';          // prefix for saved student lists
const MAX_UNDO    = 20;

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
  exclusions:          [],   // [{a: 'Name1', b: 'Name2'}]
  teacherDesk:         null, // {col, row} or null
  desks:               [],   // [{id, col, row, groupId, studentName, locked, size}]
  groups:              []    // [{id, deskIds:[...]}]
};

const undoStack = [];
let dragDeskId    = null;
let ctxDeskId     = null;
let ctxIsTeacher  = false;

// ── Utilities ─────────────────────────────────────────────
function cellToPos(col, row) {
  return { left: (col - 1) * CELL_STRIDE, top: (row - 1) * CELL_STRIDE };
}

function deskWidth(desk) {
  return desk && desk.size === 2 ? CELL_STRIDE * 2 - CELL_GAP : CELL_SIZE;
}

function deskFontSize(name) {
  if (!name) return '11px';
  // Inner desk width ≈ 66px (80px - 14px padding).
  // system-ui char width ≈ font-size × 0.60 on average.
  const computed = Math.floor(66 / (name.length * 0.60));
  return Math.max(7, Math.min(12, computed)) + 'px';
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
      size:        (oldDesks[i] && oldDesks[i].size)        || 1
    });
  }

  state.desks  = newDesks;
  state.groups = Object.values(newGroups);

  // Expand grid rows if layout needs more space
  const needed = calcRequiredRows(state.deskCount, state.groupSize, state.gridCols) + 1;
  if (state.gridRows < needed) {
    state.gridRows = needed;
    const el = document.getElementById('grid-rows');
    if (el) el.value = state.gridRows;
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

// ── Randomize ─────────────────────────────────────────────
function randomizeSeating() {
  pushUndo();

  const locked        = state.desks.filter(d => d.locked);
  const unlocked      = state.desks.filter(d => !d.locked);
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

function renderMismatchWarning() {
  const w  = document.getElementById('mismatch-warning');
  const ol = document.getElementById('overflow-list');
  const sc = state.students.length;
  const dc = state.deskCount;

  if (sc > dc) {
    w.className    = 'show';
    w.textContent  = `${sc - dc} elev${sc - dc > 1 ? 'er' : ''} mangler pult`;
    ol.textContent = 'Uten pult: ' + state.students.slice(dc).join(', ');
  } else if (sc > 0 && sc < dc) {
    w.className    = 'show';
    w.textContent  = `${dc - sc} pult${dc - sc > 1 ? 'er' : ''} vil stå tom${dc - sc > 1 ? 'me' : ''}`;
    ol.textContent = '';
  } else {
    w.className    = '';
    w.textContent  = '';
    ol.textContent = '';
  }
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

function syncBlackboard() {
  const bb  = document.getElementById('blackboard');
  const cls = document.getElementById('classroom');
  const pos = state.blackboardPosition || 'top';

  cls.classList.remove('bb-top', 'bb-bottom', 'bb-left', 'bb-right');
  cls.classList.add('bb-' + pos);

  const gridW = state.gridCols * CELL_STRIDE - CELL_GAP;
  const gridH = state.gridRows * CELL_STRIDE - CELL_GAP;

  if (pos === 'top' || pos === 'bottom') {
    bb.style.width  = gridW + 'px';
    bb.style.height = '';
  } else {
    bb.style.width  = '';
    bb.style.height = gridH + 'px';
  }
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
}

function createDeskElement(desk) {
  const el         = document.createElement('div');
  const isEmpty    = !desk.studentName;
  let cls          = 'desk';
  if (isEmpty)      cls += ' desk-empty';
  if (desk.locked)  cls += ' desk-locked';
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
  document.getElementById('desk-count').value        = state.deskCount;
  document.getElementById('group-size').value        = state.groupSize;
  document.getElementById('grid-cols').value         = state.gridCols;
  document.getElementById('grid-rows').value         = state.gridRows;
  document.getElementById('blackboard-position').value = state.blackboardPosition || 'top';
  document.getElementById('btn-teacher-desk').textContent =
    state.teacherDesk ? 'Fjern lærerpult' : 'Legg til lærerpult';

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
  ctxDeskId    = deskId;
  ctxIsTeacher = isTeacher;

  const deskObj = isTeacher ? null : state.desks.find(d => d.id === deskId);
  const menu    = document.getElementById('context-menu');

  // Toggle item visibility
  document.getElementById('ctx-lock').style.display           = isTeacher ? 'none' : '';
  document.getElementById('ctx-edit').style.display           = isTeacher ? 'none' : '';
  document.getElementById('ctx-size').style.display           = isTeacher ? 'none' : '';
  document.getElementById('ctx-remove-student').style.display = (isTeacher || !deskObj?.studentName) ? 'none' : '';
  document.getElementById('ctx-remove-teacher').style.display = isTeacher ? '' : 'none';

  if (deskObj) {
    document.getElementById('ctx-lock').textContent =
      deskObj.locked ? '🔓 Lås opp' : '🔒 Lås pult';
    document.getElementById('ctx-size').textContent =
      deskObj.size === 2 ? '↔️ Gjør smal' : '↔️ Gjør bred';
  }

  // Position menu (keep within viewport)
  const menuW = 170;
  let left = e.clientX;
  let top  = e.clientY;
  if (left + menuW > window.innerWidth) left = window.innerWidth - menuW - 6;
  menu.style.left = left + 'px';
  menu.style.top  = top  + 'px';
  menu.classList.add('show');
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

// ── Teacher desk toggle ───────────────────────────────────
function toggleTeacherDesk() {
  pushUndo();
  if (state.teacherDesk) {
    state.teacherDesk = null;
    document.getElementById('btn-teacher-desk').textContent = 'Legg til lærerpult';
  } else {
    // Place at center-bottom, expand grid if needed
    const centerCol = Math.ceil(state.gridCols / 2);
    const targetRow = state.gridRows + 2;
    state.gridRows = targetRow;
    document.getElementById('grid-rows').value = state.gridRows;
    state.teacherDesk = { col: centerCol, row: state.gridRows - 1 };
    document.getElementById('btn-teacher-desk').textContent = 'Fjern lærerpult';
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
  } catch (err) {
    showToast('Kunne ikke eksportere bilde');
    console.error(err);
  }
}

// Ensure new state fields have defaults when loading old saves
function mergeStateDefaults(parsed) {
  if (!parsed.exclusions)         parsed.exclusions         = [];
  if (!parsed.blackboardPosition) parsed.blackboardPosition = 'top';
  if (parsed.teacherDesk === undefined) parsed.teacherDesk  = null;
  if (parsed.desks) {
    parsed.desks.forEach(d => {
      if (d.locked === undefined) d.locked = false;
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
    state.students = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
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

  document.getElementById('grid-cols').addEventListener('change', e => {
    state.gridCols = Math.max(1, Math.min(20, +e.target.value || 1));
    e.target.value = state.gridCols;
    renderClassroom();
  });

  document.getElementById('grid-rows').addEventListener('change', e => {
    state.gridRows = Math.max(1, Math.min(20, +e.target.value || 1));
    e.target.value = state.gridRows;
    renderClassroom();
  });

  document.getElementById('blackboard-position').addEventListener('change', e => {
    state.blackboardPosition = e.target.value;
    renderClassroom();
  });

  document.getElementById('btn-teacher-desk').addEventListener('click', toggleTeacherDesk);
  document.getElementById('btn-randomize').addEventListener('click', randomizeSeating);
  document.getElementById('btn-undo').addEventListener('click', undo);

  // Saved maps
  document.getElementById('btn-save').addEventListener('click', saveToLocalStorage);
  document.getElementById('btn-load').addEventListener('click', loadFromLocalStorage);
  document.getElementById('btn-delete').addEventListener('click', deleteFromLocalStorage);

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

  setupContextMenuHandlers();
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

  // Auto-save on unload for session continuity
  window.addEventListener('beforeunload', () => {
    try { localStorage.setItem('klassekart_last', JSON.stringify(state)); } catch { /* ignore */ }
  });
}

document.addEventListener('DOMContentLoaded', initApp);
