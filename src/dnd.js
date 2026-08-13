'use strict';

import { MIN_BB_SIZE } from './constants.js';
import { state, pushUndo } from './state.js';
import {
  renderClassroom, syncBlackboard, defaultBlackboardInset, blackboardTrackLength
} from './render.js';
import { moveDesk, swapRegularDesks, swapWithTeacher } from './desks.js';

let dragDeskId = null;
let hovered    = null;

function setHovered(el) {
  if (hovered === el) return;
  hovered?.classList.remove('drag-over');
  hovered = el;
  hovered?.classList.add('drag-over');
}

function clearHover() {
  hovered?.classList.remove('drag-over');
  hovered = null;
}

/**
 * Wires drag and drop once, via delegation on the grid container.
 *
 * The previous version attached four listeners to every grid cell and every
 * desk on each render — a 20×20 grid meant well over a thousand listener
 * registrations per redraw, and a redraw happens on every drag, rename and
 * slider tick.
 */
export function initDragAndDrop() {
  const container = document.getElementById('grid-container');

  container.addEventListener('dragstart', e => {
    const desk = e.target.closest('.desk');
    if (!desk) return;
    dragDeskId = desk.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragDeskId);
    requestAnimationFrame(() => desk.classList.add('dragging'));
  });

  container.addEventListener('dragend', e => {
    e.target.closest('.desk')?.classList.remove('dragging');
    dragDeskId = null;
    clearHover();
  });

  container.addEventListener('dragover', e => {
    if (!dragDeskId) return;
    const desk = e.target.closest('.desk');
    const cell = desk ? null : e.target.closest('.grid-cell');
    const target = desk || cell;
    if (!target) return;
    if (desk && desk.dataset.id === dragDeskId) return; // can't drop onto itself

    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setHovered(target);
  });

  container.addEventListener('dragleave', e => {
    if (e.target === hovered) clearHover();
  });

  container.addEventListener('drop', e => {
    if (!dragDeskId) return;
    e.preventDefault();
    clearHover();

    const deskEl = e.target.closest('.desk');
    const srcId  = dragDeskId;

    if (deskEl) {
      const tgtId = deskEl.dataset.id;
      if (tgtId === srcId) return;
      pushUndo();
      const ok = srcId === 'teacher' ? swapWithTeacher(tgtId)
               : tgtId === 'teacher' ? swapWithTeacher(srcId)
               : swapRegularDesks(srcId, tgtId);
      if (ok) renderClassroom();
      return;
    }

    const cell = e.target.closest('.grid-cell');
    if (!cell) return;
    pushUndo();
    if (moveDesk(srcId, +cell.dataset.col, +cell.dataset.row)) renderClassroom();
  });
}

/**
 * Blackboard resize handles, also delegated so they survive re-rendering.
 * Dragging updates the inset and re-syncs the board only — it no longer tears
 * down and rebuilds the very handle being dragged on each mouse move.
 */
export function initBlackboardResize() {
  const bb = document.getElementById('blackboard');

  bb.addEventListener('mousedown', e => {
    const handle = e.target.closest('.bb-handle');
    if (!handle) return;
    e.preventDefault();

    const isBefore = handle.dataset.edge === 'before';
    const pos      = state.blackboardPosition || 'top';
    const isHoriz  = pos === 'top' || pos === 'bottom';

    if (!state.blackboardInset) state.blackboardInset = defaultBlackboardInset();
    const track    = blackboardTrackLength();
    const startPos = isHoriz ? e.clientX : e.clientY;
    const startVal = isBefore ? state.blackboardInset.before : state.blackboardInset.after;

    function onMove(ev) {
      const delta    = (isHoriz ? ev.clientX : ev.clientY) - startPos;
      const adjusted = isBefore ? delta : -delta;
      const other    = isBefore ? state.blackboardInset.after : state.blackboardInset.before;
      const maxInset = Math.max(0, track - MIN_BB_SIZE - other);
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
  });
}
