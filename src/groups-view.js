'use strict';

import {
  MIN_GROUP_SIZE, MAX_GROUP_SIZE, MIN_GROUP_COUNT, MAX_GROUP_COUNT,
  MAX_GROUP_HISTORY, MAX_ROLES, MAX_ROLE_LENGTH, ROLE_SUGGESTIONS
} from './constants.js';
import { state, pushUndo, detectDuplicates } from './state.js';
import {
  todayKey, absentToday, presentStudents, groupSizes, describeSizes, drawGroups,
  brokenGroupRules, pastGroupings, buildResult, fillRoles, moveMember, resultDiff,
  groupsAsText
} from './groups.js';
import { showToast } from './toast.js';
import { renderRuleList } from './rules-view.js';

// Everything on screen for the group tool: the settings panel, the group cards,
// and tavlemodus. Deliberately independent of render.js — render.js calls in
// here, never the other way round.
//
// The group view is meant to be shown to the class, so it says nothing lasting
// about rules — no names, no counts. Which rule is broken is only shown inside
// the collapsed «Regler» panel (rules-view.js); here a brief toast at most.

const $ = id => document.getElementById(id);

const GROUP_COLORS = [
  '#e8590c', '#1c7ed6', '#2f9e44', '#9c36b5', '#e03131',
  '#0c8599', '#f08c00', '#5f3dc4', '#c2255c', '#66a80f'
];
const groupColor = i => GROUP_COLORS[i % GROUP_COLORS.length];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const clamp  = (v, min, max) => Math.min(max, Math.max(min, v));
const resultNames = res => res.groups.map(g => g.members.map(m => m.name));

function formatDate(key) {
  if (!key) return '';
  return new Date(key + 'T12:00').toLocaleDateString('no-NO', { day: 'numeric', month: 'long', year: 'numeric' });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Set right after a draw so the cards animate in once — and not again on the
// next re-render caused by a drag or a settings tweak.
let justDrawn = false;

// ── Actions ──────────────────────────────────────────────
export function drawGroupsNow() {
  const typed = $('students-textarea').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (detectDuplicates(typed).length > 0) {
    showToast('Fjern duplikatnavn først');
    return false;
  }

  const g       = state.groups;
  const today   = todayKey();
  const present = presentStudents(state.students, g, today);
  if (present.length < 2) {
    showToast('Legg inn minst to elever først');
    return false;
  }

  pushUndo();
  g.history = pastGroupings(g, today, MAX_GROUP_HISTORY);

  const { groups, broken, repeats } = drawGroups(present, groupSizes(present.length, g), {
    rules:   state.useRulesGroups ? state.rules : [],
    history: g.avoidRepeat ? g.history : []
  });
  g.result  = buildResult(groups, g.roles, today);
  justDrawn = true;
  renderGroupsAll();

  const notes = [];
  if (broken.length > 0) notes.push('ikke alle regler kunne oppfylles');
  if (g.avoidRepeat && repeats > 0) notes.push(`${plural(repeats, 'par', 'par')} har vært sammen før`);
  showToast(notes.length ? 'Grupper trukket — ' + notes.join(', ') : 'Grupper trukket!');
  return true;
}

function refillRoles() {
  const res = state.groups.result;
  if (!res) return;
  res.groups.forEach(grp => { grp.members = fillRoles(grp.members, state.groups.roles); });
}

function rerollRoles() {
  const res = state.groups.result;
  if (!res) return;
  pushUndo();
  res.groups.forEach(grp => {
    grp.members = fillRoles(grp.members.map(m => ({ ...m, role: null })), state.groups.roles);
  });
  renderGroupsAll();
  showToast('Nye roller delt ut');
}

function addRole(raw) {
  const role  = raw.trim().slice(0, MAX_ROLE_LENGTH);
  const roles = state.groups.roles;
  if (!role) return;
  if (roles.some(r => r.toLowerCase() === role.toLowerCase())) { showToast('Rollen finnes allerede'); return; }
  if (roles.length >= MAX_ROLES) { showToast(`Maks ${MAX_ROLES} roller`); return; }
  roles.push(role);
  $('grp-role-input').value = '';
  refillRoles();
  renderGroupsAll();
}

function removeRole(index) {
  state.groups.roles.splice(index, 1);
  refillRoles();
  renderGroupsAll();
}

function toggleAbsent(name) {
  const g     = state.groups;
  const today = todayKey();
  if (g.absent.date !== today) g.absent = { date: today, names: [] };
  const i = g.absent.names.indexOf(name);
  if (i === -1) g.absent.names.push(name);
  else g.absent.names.splice(i, 1);
  renderGroupsAll();
}

function forgetHistory() {
  if (!confirm('Glemme de tidligere gruppene for denne klassen?')) return;
  const g = state.groups;
  g.history = [];
  // A result from an earlier day would otherwise be remembered again on the
  // next draw.
  if (g.result) g.result.date = todayKey();
  renderGroupsAll();
  showToast('Tidligere grupper glemt');
}

function nudgeGroupSetting(delta) {
  const g = state.groups;
  if (g.sizeMode === 'size') g.size  = clamp(g.size + delta,  MIN_GROUP_SIZE,  MAX_GROUP_SIZE);
  else                       g.count = clamp(g.count + delta, MIN_GROUP_COUNT, MAX_GROUP_COUNT);
  renderGroupsAll();
}

async function copyGroups() {
  const res = state.groups.result;
  if (!res) { showToast('Trekk grupper først'); return; }
  const text = groupsAsText(res, {
    title:     state.className || 'Klassen',
    dateLabel: formatDate(res.date),
    showRoles: state.groups.rolesEnabled
  });
  try {
    await navigator.clipboard.writeText(text);
    showToast('Gruppene er kopiert — lim inn der du vil');
  } catch {
    showToast('Nettleseren nektet tilgang til utklippstavlen');
  }
}

// ── Settings panel ───────────────────────────────────────
function renderPanel() {
  const g       = state.groups;
  const today   = todayKey();
  const present = presentStudents(state.students, g, today);
  const bySize  = g.sizeMode === 'size';

  document.querySelectorAll('[data-grp-sizemode]').forEach(btn => {
    const on = btn.dataset.grpSizemode === g.sizeMode;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', String(on));
  });
  $('grp-stepper-label').textContent = bySize ? 'Elever per gruppe' : 'Antall grupper';
  $('grp-val').textContent           = bySize ? g.size : g.count;
  $('grp-preview').textContent       = present.length < 2
    ? 'Legg inn minst to elever'
    : '→ ' + describeSizes(groupSizes(present.length, g));

  // Borte i dag
  $('grp-absent-toggle').checked = g.trackAbsence;
  $('grp-absent-body').hidden    = !g.trackAbsence;
  if (g.trackAbsence) renderAbsentChips(today);

  // Unngå forrige grupper
  $('grp-repeat-toggle').checked = g.avoidRepeat;
  $('grp-repeat-body').hidden    = !g.avoidRepeat;
  const past = pastGroupings(g, today, MAX_GROUP_HISTORY).length;
  $('grp-history-count').textContent = past === 0
    ? 'Ingen tidligere grupper å huske ennå.'
    : `Husker ${plural(past, 'tidligere inndeling', 'tidligere inndelinger')}.`;
  $('btn-forget-history').hidden = past === 0;

  // Roller
  $('grp-roles-toggle').checked = g.rolesEnabled;
  $('grp-roles-body').hidden    = !g.rolesEnabled;
  if (g.rolesEnabled) renderRoleEditor();
}

function renderAbsentChips(today) {
  const box  = $('grp-absent-chips');
  const away = new Set(absentToday(state.groups, today));
  box.textContent = '';

  if (state.students.length === 0) {
    box.appendChild(el('span', 'opt-hint', 'Elevlisten er tom.'));
  }
  state.students.forEach(name => {
    const isAway = away.has(name);
    const chip = el('button', 'chip' + (isAway ? ' chip-away' : ''), name);
    chip.type = 'button';
    chip.dataset.grpAbsent = name;
    chip.setAttribute('aria-pressed', String(isAway));
    chip.title = isAway ? 'Borte i dag — klikk for å markere til stede' : 'Klikk for å markere borte i dag';
    box.appendChild(chip);
  });

  const n = state.students.filter(s => away.has(s)).length;
  $('grp-absent-count').textContent = n > 0 ? `${n} borte.` : '';
}

function renderRoleEditor() {
  const roles = state.groups.roles;
  const list  = $('grp-role-list');
  list.textContent = '';
  roles.forEach((role, i) => {
    const li  = el('li');
    const rm  = el('button', 'rule-remove', '×');
    rm.type   = 'button';
    rm.title  = 'Fjern rolle';
    rm.dataset.grpRoleRemove = i;
    li.append(el('span', '', role), rm);
    list.appendChild(li);
  });

  $('grp-role-hint').textContent = roles.length === 0
    ? 'Ingen roller ennå. Skriv inn egne, eller velg fra forslagene.'
    : 'Deles ut ovenfra — har gruppa færre elever enn roller, faller de nederste bort.';

  const box  = $('grp-role-suggestions');
  const left = ROLE_SUGGESTIONS.filter(r => !roles.some(x => x.toLowerCase() === r.toLowerCase()));
  box.textContent = '';
  left.forEach(role => {
    const chip = el('button', 'chip chip-suggest', '+ ' + role);
    chip.type = 'button';
    chip.dataset.grpRoleAdd = role;
    box.appendChild(chip);
  });
  $('grp-role-suggest-wrap').hidden = left.length === 0 || roles.length >= MAX_ROLES;
}

// ── Group cards ──────────────────────────────────────────
function addNotice(box, kind, text, withDraw = false) {
  const div = el('div', 'grp-notice grp-notice-' + kind);
  div.appendChild(el('span', '', text));
  if (withDraw) {
    const btn = el('button', 'btn-tool', '🎲 Trekk på nytt');
    btn.type = 'button';
    btn.dataset.grpDraw = '';
    div.appendChild(btn);
  }
  box.appendChild(div);
}

function renderView() {
  const g       = state.groups;
  const res     = g.result;
  const today   = todayKey();
  const present = presentStudents(state.students, g, today);
  const away    = state.students.filter(s => absentToday(g, today).includes(s));

  $('groups-empty').hidden   = !!res;
  $('groups-toolbar').hidden = !res;
  const grid   = $('groups-grid');
  const notice = $('groups-notice');
  grid.textContent   = '';
  notice.textContent = '';

  if (!res) {
    $('groups-empty-text').textContent = present.length < 2
      ? 'Legg inn elevene i listen til venstre, så er du i gang.'
      : `${plural(present.length, 'elev', 'elever')} → ${describeSizes(groupSizes(present.length, g))}.`;
    justDrawn = false;
    return;
  }

  // Summary line
  const summary = $('groups-summary');
  summary.textContent = '';
  summary.appendChild(el('strong', '', plural(res.groups.length, 'gruppe', 'grupper')));
  const members = res.groups.reduce((n, grp) => n + grp.members.length, 0);
  let detail = ` · ${plural(members, 'elev', 'elever')}`;
  if (away.length > 0) detail += ` · borte: ${away.join(', ')}`;
  summary.appendChild(document.createTextNode(detail));

  $('btn-reroll-roles').hidden = !(g.rolesEnabled && g.roles.length > 0);

  // Notices: out of date, or rules broken (by the draw or by dragging)
  const { added, removed } = resultDiff(res, present);
  const sizesNow = groupSizes(present.length, g);
  if (added.length || removed.length) {
    const parts = [];
    if (added.length)   parts.push('ikke i noen gruppe: ' + added.join(', '));
    if (removed.length) parts.push('ikke med lenger: ' + removed.join(', '));
    addNotice(notice, 'warn', 'Elevlisten er endret siden trekningen — ' + parts.join(' · '), true);
  } else if (sizesNow.length !== res.groups.length) {
    addNotice(notice, 'warn', `Inndelingen er endret til ${describeSizes(sizesNow).split(' —')[0]}.`, true);
  }

  // Cards
  grid.classList.toggle('groups-pop', justDrawn);
  justDrawn = false;
  const showRoles = g.rolesEnabled;
  let order = 0;

  res.groups.forEach((grp, gi) => {
    const card = el('section', 'group-card');
    card.dataset.grpGroup = gi;
    card.style.setProperty('--grp-color', groupColor(gi));

    const head = el('header', 'group-card-head');
    head.append(
      el('span', 'group-num', String(gi + 1)),
      el('span', 'group-title', `Gruppe ${gi + 1}`),
      el('span', 'group-count', String(grp.members.length))
    );

    const ul = el('ul', 'group-members');
    grp.members.forEach((m, mi) => {
      const li = el('li', 'gm');
      li.draggable = true;
      li.dataset.grpGroup = gi;
      li.dataset.grpIndex = mi;
      li.style.setProperty('--i', order++);
      li.appendChild(el('span', 'gm-name', m.name));
      if (showRoles && m.role) li.appendChild(el('span', 'gm-role', m.role));
      ul.appendChild(li);
    });
    if (grp.members.length === 0) ul.appendChild(el('li', 'gm gm-empty', 'Dra elever hit'));

    card.append(head, ul);
    grid.appendChild(card);
  });
}

// ── Drag between groups ──────────────────────────────────
function initGroupDrag() {
  const grid = $('groups-grid');
  let from    = null;
  let hovered = null;

  const setHovered = node => {
    if (hovered === node) return;
    hovered?.classList.remove('drag-over');
    hovered = node;
    hovered?.classList.add('drag-over');
  };

  grid.addEventListener('dragstart', e => {
    const li = e.target.closest('.gm[draggable="true"]');
    if (!li) return;
    from = { group: +li.dataset.grpGroup, index: +li.dataset.grpIndex };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', li.textContent);
    requestAnimationFrame(() => li.classList.add('dragging'));
  });

  grid.addEventListener('dragend', e => {
    e.target.closest('.gm')?.classList.remove('dragging');
    from = null;
    setHovered(null);
  });

  grid.addEventListener('dragover', e => {
    if (!from) return;
    const target = e.target.closest('.gm[draggable="true"]') || e.target.closest('.group-card');
    if (!target) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setHovered(target);
  });

  grid.addEventListener('drop', e => {
    if (!from) return;
    e.preventDefault();
    setHovered(null);
    const card = e.target.closest('.group-card');
    const res  = state.groups.result;
    if (!card || !res) return;

    const li      = e.target.closest('.gm[draggable="true"]');
    const toGroup = +card.dataset.grpGroup;
    const toIndex = li ? +li.dataset.grpIndex : null;
    if (toIndex === null && toGroup === from.group) return;
    if (toIndex !== null && toGroup === from.group && toIndex === from.index) return;

    const brokenCount = () =>
      state.useRulesGroups ? brokenGroupRules(resultNames(res), state.rules).length : 0;
    const brokenBefore = brokenCount();

    pushUndo();
    if (!moveMember(res, from.group, from.index, toGroup, toIndex)) return;
    for (const gi of new Set([from.group, toGroup])) {
      res.groups[gi].members = fillRoles(res.groups[gi].members, state.groups.roles);
    }
    renderGroupsAll();
    if (brokenCount() > brokenBefore) showToast('Obs: flyttingen bryter en regel');
  });
}

// ── Tavlemodus ───────────────────────────────────────────
let boardOpen = false;
let dealing   = null; // {timers, flights} while names are being dealt

function openBoard() {
  boardOpen = true;
  const view = $('board-view');
  view.hidden = false;
  document.body.classList.add('board-open');
  // Fullscreen is a bonus — an overlay covering the window works too, so a
  // refusal (iframe, browser policy) is fine to ignore.
  view.requestFullscreen?.().catch(() => {});
  renderBoard();
  $('bv-close').focus();
}

function closeBoard() {
  if (!boardOpen) return;
  stopDeal();
  boardOpen = false;
  $('board-view').hidden = true;
  document.body.classList.remove('board-open');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function drawOnBoard() {
  stopDeal();
  if (drawGroupsNow()) dealCards();
}

function renderBoard(pending = false) {
  const res = state.groups.result;
  $('bv-title').textContent = state.className ? `${state.className} · Grupper` : 'Grupper';
  $('bv-empty').hidden  = !!res;
  $('bv-replay').hidden = !res;
  $('bv-draw').hidden   = !res;

  const grid = $('bv-grid');
  grid.textContent = '';
  grid.hidden = !res;
  if (!res) return;

  const showRoles = state.groups.rolesEnabled;
  res.groups.forEach((grp, gi) => {
    const card = el('section', 'bv-card');
    card.style.setProperty('--grp-color', groupColor(gi));

    const head = el('header', 'bv-card-head');
    head.append(el('span', 'bv-dot'), el('span', '', `Gruppe ${gi + 1}`));

    const ul = el('ul', 'bv-members');
    grp.members.forEach(m => {
      const li = el('li', 'bv-member' + (pending ? ' bv-pending' : ''));
      li.appendChild(el('span', 'bv-name', m.name));
      if (showRoles && m.role) li.appendChild(el('span', 'bv-role', m.role));
      ul.appendChild(li);
    });

    card.append(head, ul);
    grid.appendChild(card);
  });
  fitBoard();
}

/**
 * Picks the column count that gives the largest readable font, since a class
 * of 30 on a smartboard has to be legible from the back row.
 */
function fitBoard() {
  const res  = state.groups.result;
  const grid = $('bv-grid');
  if (!res || grid.hidden) return;

  const GAP   = 16;
  const W     = grid.clientWidth;
  const H     = grid.clientHeight;
  const k     = res.groups.length;
  const lines = Math.max(1, ...res.groups.map(g => g.members.length)) + 1.3; // + card header
  const showRoles = state.groups.rolesEnabled;
  const longest = Math.max(5, ...res.groups.flatMap(g => g.members.map(m =>
    m.name.length + (showRoles && m.role ? m.role.length * 0.55 + 2 : 0))));

  let bestFont = 0;
  let bestCols = 1;
  for (let cols = 1; cols <= k; cols++) {
    const rows  = Math.ceil(k / cols);
    const cardW = (W - GAP * (cols - 1)) / cols;
    const cardH = (H - GAP * (rows - 1)) / rows;
    const font  = Math.min(cardH / (lines * 1.42 + 0.9), (cardW - 28) / (longest * 0.6));
    if (font > bestFont) { bestFont = font; bestCols = cols; }
  }

  grid.style.setProperty('--bv-cols', bestCols);
  grid.style.setProperty('--bv-rows', Math.ceil(k / bestCols));
  grid.style.setProperty('--bv-font', clamp(bestFont, 12, 72).toFixed(1) + 'px');
}

/**
 * Deals the names out like a deck of cards: round-robin across the groups,
 * each name flying from the deck to its seat and turning into chalk on landing.
 */
function dealCards() {
  stopDeal();
  if (!state.groups.result) return;
  renderBoard(true);

  const cards   = [...$('bv-grid').querySelectorAll('.bv-card')];
  const byGroup = cards.map(card => [...card.querySelectorAll('.bv-member')]);
  const depth   = Math.max(0, ...byGroup.map(list => list.length));
  const order   = [];
  for (let r = 0; r < depth; r++) byGroup.forEach(list => { if (list[r]) order.push(list[r]); });

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || order.length === 0) {
    order.forEach(li => li.classList.remove('bv-pending'));
    return;
  }

  const view  = $('board-view');
  const deck  = $('bv-deck');
  const count = $('bv-deck-count');
  deck.hidden = false;
  deck.classList.remove('bv-deck-empty');
  $('bv-skip').hidden = false;

  const dr   = deck.querySelector('.bv-deck-stack').getBoundingClientRect();
  const from = { x: dr.left + dr.width / 2, y: dr.top + dr.height / 2 };

  // Append every flyer first and measure afterwards — one layout pass instead
  // of one per name.
  const flyers = order.map(li => {
    const flyer = li.cloneNode(true);
    flyer.classList.remove('bv-pending');
    flyer.classList.add('bv-flyer');
    flyer.style.fontSize = getComputedStyle(li).fontSize;
    view.appendChild(flyer);
    return flyer;
  });

  const stagger  = clamp(4200 / order.length, 70, 260);
  const run      = { timers: [], flights: [] };
  let remaining  = order.length;
  count.textContent = remaining;
  dealing = run;

  order.forEach((li, i) => {
    const flyer  = flyers[i];
    const target = li.getBoundingClientRect();
    const size   = flyer.getBoundingClientRect();
    flyer.style.left = target.left + 'px';
    flyer.style.top  = target.top + (target.height - size.height) / 2 + 'px';

    const dx   = from.x - (target.left + size.width / 2);
    const dy   = from.y - (target.top + target.height / 2);
    const tilt = (Math.random() - 0.5) * 36;
    const card = { backgroundColor: '#f4f1e6', color: '#1f3b1b', boxShadow: '0 8px 20px rgba(0,0,0,.35)' };
    const chalk = { backgroundColor: 'rgba(244,241,230,0)', color: '#f7f4ea', boxShadow: '0 0 0 rgba(0,0,0,0)' };

    const anim = flyer.animate([
      { transform: `translate(${dx}px, ${dy}px) rotate(${tilt}deg) scale(.55)`, opacity: 0, ...card },
      { transform: `translate(${dx}px, ${dy}px) rotate(${tilt}deg) scale(.6)`, opacity: 1, offset: 0.08, ...card },
      { transform: 'none', opacity: 1, offset: 0.8, ...card },
      { transform: 'none', opacity: 1, ...chalk }
    ], { duration: 720, delay: i * stagger, easing: 'cubic-bezier(.25,.75,.25,1)', fill: 'backwards' });

    run.flights.push({ anim, flyer, li });
    run.timers.push(setTimeout(() => {
      count.textContent = --remaining;
      if (remaining === 0) deck.classList.add('bv-deck-empty');
    }, i * stagger));

    anim.finished.then(() => {
      li.classList.remove('bv-pending');
      flyer.remove();
      if (i === order.length - 1 && dealing === run) finishDeal();
    }).catch(() => { /* cancelled by stopDeal */ });
  });
}

function finishDeal() {
  dealing = null;
  $('bv-skip').hidden = true;
  $('bv-deck').hidden = true;
}

/** Skips straight to the end of a deal. */
function stopDeal() {
  if (!dealing) return;
  const run = dealing;
  dealing = null;
  run.timers.forEach(clearTimeout);
  run.flights.forEach(({ anim, flyer, li }) => {
    anim.cancel();
    flyer.remove();
    li.classList.remove('bv-pending');
  });
  finishDeal();
}

// ── Render entry point ───────────────────────────────────
export function renderGroupsAll() {
  renderPanel();
  renderView();
  renderRuleList();
  if (boardOpen && !dealing) renderBoard();
}

export function initGroups() {
  // Settings panel
  document.querySelectorAll('[data-grp-sizemode]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.groups.sizeMode = btn.dataset.grpSizemode;
      renderGroupsAll();
    });
  });
  $('grp-dec').addEventListener('click', () => nudgeGroupSetting(-1));
  $('grp-inc').addEventListener('click', () => nudgeGroupSetting(+1));

  $('grp-absent-toggle').addEventListener('change', e => {
    state.groups.trackAbsence = e.target.checked;
    renderGroupsAll();
  });
  $('grp-absent-chips').addEventListener('click', e => {
    const chip = e.target.closest('[data-grp-absent]');
    if (chip) toggleAbsent(chip.dataset.grpAbsent);
  });

  $('grp-repeat-toggle').addEventListener('change', e => {
    state.groups.avoidRepeat = e.target.checked;
    renderGroupsAll();
  });
  $('grp-repeat-info').addEventListener('click', () => {
    const tip = $('grp-repeat-tip');
    tip.hidden = !tip.hidden;
    $('grp-repeat-info').setAttribute('aria-expanded', String(!tip.hidden));
  });
  $('btn-forget-history').addEventListener('click', forgetHistory);

  $('grp-roles-toggle').addEventListener('change', e => {
    state.groups.rolesEnabled = e.target.checked;
    renderGroupsAll();
    if (e.target.checked && state.groups.roles.length === 0) $('grp-role-input').focus();
  });
  $('btn-add-role').addEventListener('click', () => addRole($('grp-role-input').value));
  $('grp-role-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addRole(e.target.value); }
  });
  $('grp-role-suggestions').addEventListener('click', e => {
    const chip = e.target.closest('[data-grp-role-add]');
    if (chip) addRole(chip.dataset.grpRoleAdd);
  });
  $('grp-role-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-grp-role-remove]');
    if (btn) removeRole(+btn.dataset.grpRoleRemove);
  });

  // Group cards
  $('btn-draw-empty').addEventListener('click', drawGroupsNow);
  $('btn-board-empty').addEventListener('click', openBoard);
  $('groups-notice').addEventListener('click', e => {
    if (e.target.closest('[data-grp-draw]')) drawGroupsNow();
  });
  $('btn-reroll-roles').addEventListener('click', rerollRoles);
  $('btn-copy-groups').addEventListener('click', copyGroups);
  $('btn-print-groups').addEventListener('click', () => window.print());
  $('btn-board').addEventListener('click', openBoard);
  initGroupDrag();

  // Tavlemodus
  $('bv-close').addEventListener('click', closeBoard);
  $('bv-draw').addEventListener('click', drawOnBoard);
  $('bv-draw-empty').addEventListener('click', drawOnBoard);
  $('bv-replay').addEventListener('click', dealCards);
  $('bv-skip').addEventListener('click', stopDeal);

  // Leaving fullscreen with Esc never reaches keydown, so treat it as closing.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && boardOpen) closeBoard();
  });
  document.addEventListener('keydown', e => {
    if (boardOpen && e.key === 'Escape') { e.preventDefault(); closeBoard(); }
  });
  window.addEventListener('resize', () => {
    if (boardOpen && !dealing) fitBoard();
  });
}
