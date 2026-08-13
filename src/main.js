'use strict';

import { MAX_GRID, MAX_DESK_COUNT, MAX_DESKS, MIN_TEXT_SCALE, MAX_TEXT_SCALE } from './constants.js';
import { state, pushUndo, getMoveMode } from './state.js';
import { computeAutoLayout } from './layout.js';
import {
  renderAll, renderClassroom, renderMismatchWarning, updateGridDisplay,
  updatePrintPageStyle, updatePrintHeader, updateStudentCount, updateDatalist,
  refreshDeskFontSizes, renderExclusionList, syncDupWarning, deskFontSize,
  updatePrintScale
} from './render.js';
import { rebuildDesks, toggleTeacherDesk, nudgeGrid, exitMoveMode } from './desks.js';
import { randomizeSeating } from './randomize.js';
import { initDragAndDrop, initBlackboardResize } from './dnd.js';
import {
  saveToLocalStorage, loadFromLocalStorage, deleteFromLocalStorage, clearAllData,
  saveList, loadList, deleteList, exportJSON, importJSON, exportPNG,
  saveSession, restoreSession
} from './storage.js';
import { initUI, undo, newClass, pasteFromClipboard, hideContextMenu } from './ui.js';
import { showToast } from './toast.js';

const $ = id => document.getElementById(id);

// ── Randomize ────────────────────────────────────────────
function handleRandomize() {
  if (syncDupWarning().length > 0) {
    showToast('Fjern duplikatnavn først');
    return;
  }
  pushUndo();

  // The first randomisation also picks a sensible grid; later ones respect
  // whatever layout the teacher has arranged by hand.
  if (!state.hasRandomized) {
    const auto = computeAutoLayout(state.deskCount, state.groupSize);
    state.gridCols = Math.min(MAX_GRID, auto.gridCols);
    state.gridRows = Math.min(MAX_GRID, auto.gridRows);
    updateGridDisplay();
    rebuildDesks(false);
    state.hasRandomized = true;
  }

  const { violations } = randomizeSeating();
  renderClassroom();
  renderMismatchWarning();

  showToast(violations > 0
    ? `Randomisert — ${violations} naboskap kunne ikke unngås`
    : 'Pulter randomisert!');
}

// ── Student textarea ─────────────────────────────────────
function handleStudentInput(e) {
  const newNames = e.target.value.split('\n').map(s => s.trim()).filter(Boolean);
  syncDupWarning();

  // If exactly one name was swapped for another, treat it as a rename and
  // follow it to whichever desk the student is sitting at.
  const removed = state.students.filter(n => !newNames.includes(n));
  const added   = newNames.filter(n => !state.students.includes(n));
  if (removed.length === 1 && added.length === 1) {
    const [oldName, newName] = [removed[0], added[0]];
    state.desks.forEach(d => {
      if (d.studentName !== oldName) return;
      d.studentName = newName;
      const el = $('desk-el-' + d.id);
      if (el) {
        el.textContent    = newName;
        el.style.fontSize = deskFontSize(newName, d);
      }
    });
  }

  state.students = [...new Set(newNames)].slice(0, MAX_DESKS);
  updateStudentCount();
  updateDatalist();
  renderMismatchWarning();
}

// ── Event wiring ─────────────────────────────────────────
function setupEventListeners() {
  $('class-name').addEventListener('input', e => {
    state.className = e.target.value;
    $('classroom-title').textContent = state.className;
    updatePrintHeader();
  });

  $('students-textarea').addEventListener('input', handleStudentInput);

  $('desk-count').addEventListener('change', e => {
    state.deskCount = Math.max(1, Math.min(MAX_DESK_COUNT, +e.target.value || 1));
    e.target.value  = state.deskCount;
    rebuildDesks(true);
    renderAll();
  });

  $('group-size').addEventListener('change', e => {
    state.groupSize = +e.target.value;
    rebuildDesks(true);
    renderAll();
  });

  $('grid-cols-dec').addEventListener('click', () => nudgeGrid('gridCols', -1));
  $('grid-cols-inc').addEventListener('click', () => nudgeGrid('gridCols', +1));
  $('grid-rows-dec').addEventListener('click', () => nudgeGrid('gridRows', -1));
  $('grid-rows-inc').addEventListener('click', () => nudgeGrid('gridRows', +1));

  $('blackboard-position').addEventListener('change', e => {
    state.blackboardPosition = e.target.value;
    state.blackboardInset    = null;
    renderClassroom();
  });

  $('btn-teacher-desk').addEventListener('click', toggleTeacherDesk);
  $('btn-randomize').addEventListener('click', handleRandomize);
  $('btn-undo').addEventListener('click', undo);
  $('btn-new-class').addEventListener('click', newClass);
  $('btn-paste-students').addEventListener('click', pasteFromClipboard);

  // Saved charts
  $('btn-save').addEventListener('click', saveToLocalStorage);
  $('btn-load').addEventListener('click', loadFromLocalStorage);
  $('btn-delete').addEventListener('click', deleteFromLocalStorage);
  $('btn-clear-data').addEventListener('click', clearAllData);

  // Student lists
  $('btn-save-list').addEventListener('click', saveList);
  $('btn-load-list').addEventListener('click', loadList);
  $('btn-delete-list').addEventListener('click', deleteList);

  // Exclusions
  $('btn-add-excl').addEventListener('click', () => {
    const a = $('excl-a').value.trim();
    const b = $('excl-b').value.trim();
    if (!a || !b) { showToast('Skriv inn to elevnavn'); return; }
    if (a === b)  { showToast('Navnene må være forskjellige'); return; }
    if (state.exclusions.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))) {
      showToast('Denne regelen finnes allerede');
      return;
    }
    state.exclusions.push({ a, b });
    $('excl-a').value = '';
    $('excl-b').value = '';
    renderExclusionList();
    showToast('Regel lagt til');
  });

  // Export / import
  $('btn-export').addEventListener('click', exportJSON);
  $('btn-export-png').addEventListener('click', exportPNG);
  $('btn-import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', e => {
    if (e.target.files.length > 0) {
      importJSON(e.target.files[0]);
      e.target.value = '';
    }
  });

  // Text size — fires continuously while dragging, so only the font sizes are
  // touched rather than rebuilding the whole grid on every tick.
  $('text-scale').addEventListener('input', e => {
    const pct = +e.target.value;
    state.textScale = Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, pct / 100));
    $('text-scale-val').textContent = pct + '%';
    refreshDeskFontSizes();
  });

  // Print settings
  $('print-format').addEventListener('change', e => {
    state.printFormat = e.target.value;
    updatePrintPageStyle();
  });
  $('print-orientation').addEventListener('change', e => {
    state.printOrientation = e.target.value;
    updatePrintPageStyle();
  });
  $('hide-empty-desks').addEventListener('change', e => {
    state.hideEmptyDesksOnPrint = e.target.checked;
    updatePrintPageStyle();
  });
  $('scale-to-fit').addEventListener('change', e => {
    state.scaleToFitOnPrint = e.target.checked;
    updatePrintScale();
  });

  // Last chance to get the zoom right — by now the print layout is settled, so
  // the header can be measured for real instead of falling back to a constant.
  window.addEventListener('beforeprint', updatePrintScale);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (getMoveMode()) exitMoveMode();
      hideContextMenu();
    }
    const typing = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      undo();
    }
  });
}

// ── Init ─────────────────────────────────────────────────
function initApp() {
  restoreSession();
  if (state.desks.length === 0) rebuildDesks(false);

  setupEventListeners();
  initUI();
  initDragAndDrop();
  initBlackboardResize();
  renderAll();

  // pagehide fires reliably on mobile and on tab close, where beforeunload is
  // increasingly ignored.
  window.addEventListener('pagehide', saveSession);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveSession();
  });
}

document.addEventListener('DOMContentLoaded', initApp);
