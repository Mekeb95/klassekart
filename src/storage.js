'use strict';

import { LS_MAP, LS_LIST, LS_LAST, MAX_DESKS } from './constants.js';
import { state, replaceState, sanitizeState } from './state.js';
import { renderAll, renderSavedMaps, renderSavedLists, renderMismatchWarning,
         updateStudentCount, updateDatalist } from './render.js';
import { showToast } from './toast.js';

const $ = id => document.getElementById(id);

/** Filename-safe version of a class name. */
export function safeName(name) {
  return (name || 'Uten navn').replace(/[^\w æøåÆØÅ-]/g, '').trim() || 'Uten navn';
}

// ── Saved seating charts ─────────────────────────────────
export function saveToLocalStorage() {
  const name = safeName(state.className);
  // safeName strips punctuation, so "7A", "7A!" and "7.A" all collapse to the
  // same key. Saving used to overwrite the older chart without a word.
  if (localStorage.getItem(LS_MAP + name) !== null &&
      !confirm(`Det finnes allerede et kart som heter "${name}". Overskrive det?`)) {
    return;
  }
  try {
    localStorage.setItem(LS_MAP + name, JSON.stringify(state));
    renderSavedMaps();
    $('saved-maps').value = name;
    showToast(`Lagret som "${name}"`);
  } catch {
    showToast('Feil ved lagring — nettleserens lagringsplass kan være full');
  }
}

export function loadFromLocalStorage() {
  const name = $('saved-maps').value;
  if (!name) { showToast('Velg et lagret kart først'); return; }
  try {
    const raw = localStorage.getItem(LS_MAP + name);
    if (!raw) { showToast(`Fant ikke "${name}"`); return; }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.desks)) { showToast('Ugyldig data'); return; }
    replaceState(sanitizeState(parsed));
    renderAll();
    showToast(`Lastet inn "${name}"`);
  } catch {
    showToast('Feil ved innlasting');
  }
}

export function deleteFromLocalStorage() {
  const name = $('saved-maps').value;
  if (!name) { showToast('Velg et kart å slette'); return; }
  if (!confirm(`Slette "${name}"?`)) return;
  localStorage.removeItem(LS_MAP + name);
  renderSavedMaps();
  showToast(`"${name}" slettet`);
}

export function clearAllData() {
  if (!confirm('Dette sletter alle lagrede kart, elevlister og siste økt permanent.\nEr du sikker?')) return;
  const doomed = Object.keys(localStorage)
    .filter(k => k.startsWith(LS_MAP) || k.startsWith(LS_LIST) || k === LS_LAST);
  doomed.forEach(k => localStorage.removeItem(k));
  renderSavedMaps();
  renderSavedLists();
  showToast(`${doomed.length} element(er) slettet fra nettleseren`);
}

// ── Saved student lists ──────────────────────────────────
export function saveList() {
  const name = $('list-name-input').value.trim();
  if (!name) { showToast('Skriv et listenavn'); return; }
  if (state.students.length === 0) { showToast('Ingen elever å lagre'); return; }
  if (localStorage.getItem(LS_LIST + name) !== null &&
      !confirm(`Det finnes allerede en liste som heter "${name}". Overskrive den?`)) {
    return;
  }
  try {
    localStorage.setItem(LS_LIST + name, JSON.stringify(state.students));
  } catch {
    showToast('Feil ved lagring av liste');
    return;
  }
  renderSavedLists();
  $('saved-lists').value = name;
  showToast(`Liste "${name}" lagret`);
}

export function loadList() {
  const name = $('saved-lists').value;
  if (!name) { showToast('Velg en liste'); return; }
  try {
    const raw = localStorage.getItem(LS_LIST + name);
    if (!raw) { showToast(`Fant ikke "${name}"`); return; }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) { showToast('Ugyldig liste'); return; }

    state.students = [...new Set(
      parsed.filter(s => typeof s === 'string').map(s => s.trim()).filter(Boolean)
    )].slice(0, MAX_DESKS);

    $('students-textarea').value  = state.students.join('\n');
    $('list-name-input').value    = name;
    updateStudentCount();
    updateDatalist();
    renderMismatchWarning();
    showToast(`Liste "${name}" lastet inn`);
  } catch {
    showToast('Feil ved innlasting av liste');
  }
}

export function deleteList() {
  const name = $('saved-lists').value;
  if (!name) { showToast('Velg en liste å slette'); return; }
  if (!confirm(`Slette listen "${name}"?`)) return;
  localStorage.removeItem(LS_LIST + name);
  renderSavedLists();
  showToast(`Liste "${name}" slettet`);
}

// ── JSON file export / import ────────────────────────────
export function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = safeName(state.className) + '.json';
  a.click();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function importJSON(file) {
  const reader = new FileReader();
  reader.onerror = () => showToast('Kunne ikke lese filen');
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!Array.isArray(parsed?.desks)) { showToast('Ugyldig JSON-fil'); return; }
      // Imported files are shared between machines and hand-editable, so they
      // go through the same clamping as everything else.
      replaceState(sanitizeState(parsed));
      renderAll();
      showToast('Importert!');
    } catch {
      showToast('Feil ved import');
    }
  };
  reader.readAsText(file);
}

// ── PNG export ───────────────────────────────────────────
export async function exportPNG() {
  if (typeof html2canvas === 'undefined') {
    showToast('Bildebiblioteket er ikke lastet — sjekk nettforbindelsen');
    return;
  }
  showToast('Genererer bilde...');

  // Hide editing affordances that shouldn't appear in the exported image.
  const overrides = document.createElement('style');
  overrides.textContent = `
    .desk-locked::after { display: none !important; }
    #row-controls, #col-controls { display: none !important; }
    .bb-handle, #bb-reset, .sidebar-tab { display: none !important; }
    ${state.hideEmptyDesksOnPrint ? '.desk-empty { visibility: hidden !important; }' : ''}
  `;
  document.head.appendChild(overrides);

  try {
    const canvas = await html2canvas($('classroom'), {
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
    overrides.remove();
  }
}

// ── Session continuity ───────────────────────────────────
export function saveSession() {
  try { localStorage.setItem(LS_LAST, JSON.stringify(state)); } catch { /* quota — ignore */ }
}

/** Returns true when a previous session was restored. */
export function restoreSession() {
  try {
    const raw = localStorage.getItem(LS_LAST);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.desks) || parsed.desks.length === 0) return false;
    replaceState(sanitizeState(parsed));
    return true;
  } catch {
    return false;
  }
}
