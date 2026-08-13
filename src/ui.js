'use strict';

import { MAX_DESKS } from './constants.js';
import {
  state, replaceState, createInitialState, pushUndo, popUndo, clearUndo,
  getMoveMode, setMoveMode
} from './state.js';
import {
  renderAll, renderClassroom, renderMismatchWarning, renderStatsBanner,
  renderExclusionList, syncBlackboard, deskFontSize,
  updateStudentCount, updateDatalist
} from './render.js';
import {
  fixMissingDesks, removeExcessDesks, deleteAxis, moveAxis,
  enterMoveMode, exitMoveMode, rebuildDesks, toggleDeskWidth, clearTeacherDesk
} from './desks.js';
import { showToast } from './toast.js';

const $ = id => document.getElementById(id);

// ── Undo ─────────────────────────────────────────────────
export function undo() {
  if (!popUndo()) { showToast('Ingenting å angre'); return; }
  renderAll();
  showToast('Angret');
}

// ── Context menu ─────────────────────────────────────────
let ctxDeskId = null;

function showContextMenu(e, deskId, isTeacher) {
  ctxDeskId = deskId;
  const deskObj = isTeacher ? null : state.desks.find(d => d.id === deskId);
  const menu    = $('context-menu');

  const show = (id, visible) => { $(id).style.display = visible ? '' : 'none'; };
  show('ctx-lock',           !isTeacher);
  show('ctx-edit',           !isTeacher);
  show('ctx-size',           !isTeacher);
  show('ctx-remove-student', !isTeacher && !!deskObj?.studentName);
  show('ctx-remove-teacher', isTeacher);
  show('ctx-mark',           !isTeacher && !deskObj?.studentName);

  if (deskObj) {
    $('ctx-lock').textContent = deskObj.locked ? '🔓 Lås opp' : '🔒 Lås pult';
    $('ctx-size').textContent = deskObj.size === 2 ? '↔️ Gjør smal' : '↔️ Gjør bred';
    $('ctx-mark').textContent = deskObj.marked ? '📦 Fjern tommerking' : '📦 Merk som tom pult';
  }

  // Show first so the menu can be measured, then clamp inside the viewport.
  menu.style.left = e.clientX + 'px';
  menu.style.top  = e.clientY + 'px';
  menu.classList.add('show');

  const left = Math.min(e.clientX, window.innerWidth  - menu.offsetWidth  - 6);
  const top  = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 6);
  menu.style.left = Math.max(0, left) + 'px';
  menu.style.top  = Math.max(0, top)  + 'px';
}

export function hideContextMenu() {
  $('context-menu').classList.remove('show');
  ctxDeskId = null;
}

function withCtxDesk(fn) {
  const desk = state.desks.find(d => d.id === ctxDeskId);
  if (!desk) { hideContextMenu(); return; }
  fn(desk);
}

function initContextMenu() {
  document.addEventListener('click', e => {
    if (!$('context-menu').contains(e.target)) hideContextMenu();
  });

  $('ctx-lock').addEventListener('click', () => withCtxDesk(desk => {
    pushUndo();
    desk.locked = !desk.locked;
    hideContextMenu();
    renderClassroom();
  }));

  $('ctx-edit').addEventListener('click', () => {
    const deskId = ctxDeskId;
    hideContextMenu();
    const deskEl  = $('desk-el-' + deskId);
    const deskObj = state.desks.find(d => d.id === deskId);
    if (deskEl && deskObj) startInlineEdit(deskEl, deskObj);
  });

  $('ctx-size').addEventListener('click', () => {
    const deskId = ctxDeskId;
    hideContextMenu();
    toggleDeskWidth(deskId);
  });

  $('ctx-mark').addEventListener('click', () => withCtxDesk(desk => {
    pushUndo();
    desk.marked = !desk.marked;
    hideContextMenu();
    renderClassroom();
    renderMismatchWarning();
  }));

  $('ctx-remove-student').addEventListener('click', () => withCtxDesk(desk => {
    pushUndo();
    desk.studentName = null;
    hideContextMenu();
    renderClassroom();
    renderMismatchWarning();
  }));

  $('ctx-remove-teacher').addEventListener('click', () => {
    hideContextMenu();
    clearTeacherDesk();
  });
}

// ── Inline edit ──────────────────────────────────────────
export function startInlineEdit(deskEl, deskObj) {
  const oldName = deskObj.studentName;
  deskEl.textContent = '';
  deskEl.draggable   = false;

  const input = document.createElement('input');
  input.type      = 'text';
  input.value     = oldName || '';
  input.className = 'desk-inline-input';
  input.setAttribute('aria-label', 'Elevnavn');
  deskEl.appendChild(input);
  input.focus();
  input.select();

  let done = false;

  function commit() {
    if (done) return;
    done = true;
    const newName = input.value.trim();

    if (newName === (oldName || '')) { renderClassroom(); return; }

    // Only now is there something worth undoing. Pushing on edit *start* meant
    // opening an editor and pressing Escape still consumed an undo step.
    pushUndo();

    if (oldName) {
      const idx = state.students.indexOf(oldName);
      if (idx !== -1) {
        if (newName) state.students[idx] = newName;
        else state.students.splice(idx, 1);
      }
    } else if (newName && !state.students.includes(newName)) {
      if (state.students.length >= MAX_DESKS) {
        showToast('For mange elever');
        renderClassroom();
        return;
      }
      state.students.push(newName);
    }

    deskObj.studentName = newName || null;
    $('students-textarea').value = state.students.join('\n');
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
    e.stopPropagation(); // keep Ctrl+Z etc. from reaching the global handler
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') {
      input.removeEventListener('blur', commit);
      cancel();
    }
  });
}

// ── Desk interactions (delegated) ────────────────────────
function initDeskInteractions() {
  const container = $('grid-container');

  container.addEventListener('dblclick', e => {
    const el = e.target.closest('.desk');
    if (!el || el.dataset.id === 'teacher') return;
    e.preventDefault();
    const deskObj = state.desks.find(d => d.id === el.dataset.id);
    if (deskObj) startInlineEdit(el, deskObj);
  });

  container.addEventListener('contextmenu', e => {
    const el = e.target.closest('.desk');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e, el.dataset.id, el.dataset.id === 'teacher');
  });
}

// ── Delegated data-action buttons ────────────────────────
// Buttons produced by render.js carry data-action instead of a bound listener,
// which keeps render.js free of any dependency on the action modules.
function initDelegatedActions() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const { action, axis, index } = el.dataset;

    switch (action) {
      case 'fix-desks':  fixMissingDesks(); break;
      case 'trim-desks': removeExcessDesks(); break;

      case 'delete-axis':
        e.stopPropagation();
        deleteAxis(axis, +index);
        break;

      case 'pick-axis':
        e.stopPropagation();
        enterMoveMode(axis, +index);
        break;

      case 'drop-axis': {
        const mode = getMoveMode();
        if (mode) moveAxis(axis, mode.index, +index);
        break;
      }

      case 'cancel-move':
        e.stopPropagation();
        exitMoveMode();
        break;

      case 'remove-exclusion':
        state.exclusions.splice(+index, 1);
        renderExclusionList();
        break;

      case 'reset-blackboard':
        e.stopPropagation();
        state.blackboardInset = null;
        syncBlackboard();
        break;
    }
  });
}

// ── New class ────────────────────────────────────────────
export function newClass() {
  if (!confirm('Start ny klasse? Alt som ikke er lagret vil gå tapt.')) return;
  replaceState(createInitialState());
  clearUndo();
  setMoveMode(null);
  hideContextMenu();
  rebuildDesks(false);
  renderAll();
  showToast('Ny klasse opprettet');
}

// ── Clipboard ────────────────────────────────────────────
export async function pasteFromClipboard() {
  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    showToast('Gi tilgang til utklippstavle i nettleseren');
    return;
  }

  if (!text.trim()) { showToast('Utklippstavlen er tom'); return; }

  const names = text
    .split(/[\n\r]+/)
    .flatMap(line => line.split(/[\t,;]+/))
    .map(s => s.trim())
    .filter(Boolean);

  if (names.length === 0) { showToast('Ingen navn funnet'); return; }

  const before = state.students.length;
  state.students = [...new Set([...state.students, ...names])].slice(0, MAX_DESKS);
  const added = state.students.length - before;

  $('students-textarea').value = state.students.join('\n');
  updateStudentCount();
  updateDatalist();
  renderMismatchWarning();
  showToast(added > 0 ? `${added} navn lagt til` : 'Ingen nye navn funnet');
}

// ── Sidebar tabs ─────────────────────────────────────────
function initSidebarTabs() {
  const sync = () => {
    const lc = $('sidebar-left').classList.contains('collapsed');
    const rc = $('sidebar-right').classList.contains('collapsed');
    $('tab-left').textContent  = lc ? '›' : '‹';
    $('tab-right').textContent = rc ? '‹' : '›';
    $('tab-left').setAttribute('aria-expanded',  String(!lc));
    $('tab-right').setAttribute('aria-expanded', String(!rc));
  };

  $('tab-left').addEventListener('click', () => {
    $('sidebar-left').classList.toggle('collapsed');
    sync();
  });
  $('tab-right').addEventListener('click', () => {
    $('sidebar-right').classList.toggle('collapsed');
    sync();
  });
  sync();
}

export function initUI() {
  initContextMenu();
  initDeskInteractions();
  initDelegatedActions();
  initSidebarTabs();
}
