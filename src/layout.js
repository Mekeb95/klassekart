'use strict';

import { CELL_SIZE, CELL_GAP, CELL_STRIDE } from './constants.js';

// Pure geometry and layout maths. No state, no DOM — this is the part that is
// worth testing in isolation.

export function cellToPos(col, row) {
  return { left: (col - 1) * CELL_STRIDE, top: (row - 1) * CELL_STRIDE };
}

export function deskWidth(desk) {
  return desk && desk.size === 2 ? CELL_STRIDE * 2 - CELL_GAP : CELL_SIZE;
}

/** Pixel span of n cells including the gaps between them. */
export function spanOf(cells) {
  return cells * CELL_STRIDE - CELL_GAP;
}

export function calcGroupsPerRow(groupSize, gridCols) {
  if (groupSize === 1) return gridCols;
  return Math.max(1, Math.floor((gridCols + 1) / (groupSize + 1)));
}

/** Desk positions for a fresh layout. Desk rows sit on odd rows (1, 3, 5…),
 *  leaving a walking gap between them. */
export function computeLayout(deskCount, groupSize, gridCols) {
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

export function calcRequiredRows(deskCount, groupSize, gridCols) {
  const gpr     = calcGroupsPerRow(groupSize, gridCols);
  const grpRows = Math.ceil(Math.ceil(deskCount / groupSize) / gpr);
  return Math.max(1, grpRows * 2 - 1);
}

/** A balanced grid for the given desk count — slightly wider than tall. */
export function computeAutoLayout(deskCount, groupSize) {
  const totalGroups = Math.ceil(deskCount / Math.max(1, groupSize));
  const gpr         = Math.max(2, Math.min(6, Math.round(Math.sqrt(totalGroups))));
  const gridCols    = groupSize <= 1 ? gpr : gpr * (groupSize + 1) - 1;
  const groupRows   = Math.ceil(totalGroups / gpr);
  // Each desk row occupies 1 row and the gap after it another → ×2
  return {
    gridCols: Math.max(2, gridCols),
    gridRows: Math.max(3, groupRows * 2)
  };
}

/** Columns a desk physically covers: [first, last]. A wide desk covers two. */
function colSpan(desk) {
  return [desk.col, desk.col + (desk.size === 2 ? 1 : 0)];
}

/**
 * Diagonals count as neighbours — sitting corner to corner is still "sammen".
 *
 * Comparing desk.col alone treated a wide desk as if it stood only on its
 * left-hand cell, so a student sitting against its right half looked two
 * columns away and a "skal ikke sitte sammen" rule was silently ignored.
 * Measuring the gap between footprints handles both widths identically.
 */
export function areNeighbors(d1, d2) {
  if (Math.abs(d1.row - d2.row) > 1) return false;
  const [aFirst, aLast] = colSpan(d1);
  const [bFirst, bLast] = colSpan(d2);
  // 0 when the footprints touch or overlap, otherwise the columns between them.
  const gap = Math.max(bFirst - aLast, aFirst - bLast, 0);
  return gap <= 1;
}
