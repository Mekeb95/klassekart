'use strict';

// ── Grid geometry ────────────────────────────────────────
export const CELL_SIZE   = 80;
export const CELL_GAP    = 8;
export const CELL_STRIDE = CELL_SIZE + CELL_GAP; // 88px per cell slot
export const CTRL_SIZE   = 28; // row-controls width = col-controls height (fixed in CSS)
export const BB_MARGIN   = 12; // equal visible margin on each side of grid cells (default)
export const MIN_BB_SIZE = 40;

// ── Limits ───────────────────────────────────────────────
// MIN/MAX_GRID mirror the stepper buttons. They are also the clamp applied to
// imported files: without them a hand-edited JSON can ask for a 5000×5000 grid,
// which renders 25 million DOM nodes and hangs the tab.
export const MIN_GRID       = 1;
export const MAX_GRID       = 20;
export const MAX_DESK_COUNT = 60;  // mirrors <input id="desk-count" max>
export const MAX_DESKS      = 400; // hard ceiling for imported files
export const MAX_UNDO       = 20;
export const MIN_TEXT_SCALE = 0.5;
export const MAX_TEXT_SCALE = 1.5;

// ── Storage keys ─────────────────────────────────────────
export const LS_MAP  = 'klassekart_'; // prefix for saved seating charts
export const LS_LIST = 'kl_liste_';   // prefix for saved student lists
export const LS_LAST = 'klassekart_last';

// ── Paper ────────────────────────────────────────────────
export const MM_TO_PX        = 96 / 25.4;
export const PAGE_MARGIN_MM  = 10; // must match the @page margin in updatePrintPageStyle
export const PAGE_SIZES_MM   = { A4: [210, 297], A3: [297, 420] }; // [short, long]

// Height of #print-header plus its bottom margin, in print layout. Only
// measurable while printing, so this is the fallback when we can't measure —
// keep it in step with the #print-header rule in styles.css.
export const PRINT_HEADER_PX = 61;

// Never shrink a chart into illegibility; below this we let it overflow instead.
export const MIN_PRINT_ZOOM  = 0.35;

// Scaling to the exact printable width leaves no room for rounding, and
// browsers and printer drivers disagree slightly about the usable area. A
// couple of percent of slack is invisible but keeps a chart off page two.
export const PRINT_FIT_SLACK = 0.98;

// ── Allowlists ───────────────────────────────────────────
// Print format/orientation are interpolated into a <style> element, so they
// must never carry arbitrary text from an imported file.
export const VALID_PRINT_FORMATS      = new Set(['A4', 'A3']);
export const VALID_PRINT_ORIENTATIONS = new Set(['landscape', 'portrait']);
export const VALID_BB_POSITIONS       = new Set(['top', 'bottom', 'left', 'right']);
export const VALID_GROUP_SIZES        = new Set([1, 2, 3, 4]);
