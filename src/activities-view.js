'use strict';

import {
  MIN_TEAM_SIZE, MAX_TEAM_SIZE, MAX_TEAMS, MAX_TEAM_NAME,
  MIN_CATEGORIES, MAX_CATEGORIES, MAX_CAT_LENGTH, MAX_ROUNDS,
  SECONDS_CHOICES, ROUNDS_ON_SHEET, CLASSIC_CATEGORIES
} from './constants.js';
import { state, pushUndo, detectDuplicates } from './state.js';
import { todayKey, presentStudents, groupSizes, describeSizes, drawGroups, absentToday } from './groups.js';
import {
  drawLetter, drawCategories, rerollCategory, emptyMarks, roundPoints, nextMark,
  standings, podium, buildTeams, teamsFromGroups, formatClock, roundSeconds,
  gameAsText, describeGame
} from './activities.js';
import { showToast } from './toast.js';
import { renderRuleList } from './rules-view.js';

// Everything on screen for the aktivitetene: the activity picker, the setup
// for Mariusleken, and the fullscreen game itself.
//
// Same split as groups-view.js: render.js calls in here, never the other way
// round, and the pure maths lives in activities.js.
//
// The game screen is meant to be on the projector, so it never shows anything
// about the rules — which rule a team draw broke is only ever said in the
// collapsed «Regler» panel, like everywhere else.

const $ = id => document.getElementById(id);

const TEAM_COLORS = [
  '#e8590c', '#1c7ed6', '#2f9e44', '#9c36b5', '#e03131',
  '#0c8599', '#f08c00', '#5f3dc4', '#c2255c', '#66a80f'
];
const teamColor = i => TEAM_COLORS[i % TEAM_COLORS.length];

const clamp  = (v, min, max) => Math.min(max, Math.max(min, v));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const game   = () => state.activities.mariusleken;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, dataset = {}) {
  const b = el('button', className, text);
  b.type = 'button';
  Object.assign(b.dataset, dataset);
  return b;
}

/** Total seconds a round lasts with the current settings. */
const totalSeconds = m => roundSeconds(m.categories.length, m.seconds);

// ── Lyd ──────────────────────────────────────────────────
// Made with WebAudio rather than a sound file: no extra request, and nothing
// for the Content-Security-Policy to allow. The context can only be created
// after a click, which is exactly when the first sound is needed.
let audio = null;

function tone(freq, start, duration, peak = 0.22) {
  if (!audio) return;
  const osc  = audio.createOscillator();
  const gain = audio.createGain();
  osc.type            = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, audio.currentTime + start);
  gain.gain.exponentialRampToValueAtTime(peak, audio.currentTime + start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + start + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(audio.currentTime + start);
  osc.stop(audio.currentTime + start + duration + 0.05);
}

function withAudio(fn) {
  if (!game().sound) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume?.();
    fn();
  } catch { /* no audio available — the countdown is visual anyway */ }
}

const beepTick  = () => withAudio(() => tone(880, 0, 0.09, 0.15));
const beepStart = () => withAudio(() => { tone(660, 0, 0.1); tone(990, 0.1, 0.16); });
const beepStop  = () => withAudio(() => {
  tone(523, 0,    0.22);
  tone(415, 0.22, 0.22);
  tone(311, 0.44, 0.5);
});

// ── Lag ──────────────────────────────────────────────────
export function drawTeamsNow() {
  const m     = game();
  const typed = $('students-textarea').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (detectDuplicates(typed).length > 0) {
    showToast('Fjern duplikatnavn først');
    return false;
  }

  const present = presentStudents(state.students, state.groups, todayKey());
  if (present.length < 2) {
    showToast('Legg inn minst to elever først');
    return false;
  }

  pushUndo();
  const sizes = groupSizes(present.length, { sizeMode: 'size', size: m.teamSize })
    .slice(0, MAX_TEAMS);
  const { groups, broken } = drawGroups(present, sizes, {
    rules: state.useRulesActivities ? state.rules : []
  });

  m.teams = buildTeams(groups, m.teams);
  const cleared = resetScores();
  renderActivitiesAll();
  renderRuleList();

  const notes = [];
  if (broken.length > 0) notes.push('ikke alle regler kunne oppfylles');
  if (cleared)           notes.push('poengene er nullstilt');
  showToast(notes.length > 0 ? 'Lag trukket — ' + notes.join(', ') : 'Lag trukket!');
  return true;
}

function importTeamsFromGroups() {
  const teams = teamsFromGroups(state.groups.result);
  if (teams.length < 2) {
    showToast('Trekk grupper i Grupper-fanen først');
    return;
  }
  pushUndo();
  game().teams = teams.slice(0, MAX_TEAMS);
  const cleared = resetScores();
  renderActivitiesAll();
  renderRuleList();
  showToast(`Hentet ${plural(game().teams.length, 'lag', 'lag')} fra Grupper`
    + (cleared ? ' — poengene er nullstilt' : ''));
}

/**
 * Points belong to the teams that earned them, so changing the teams clears
 * the board rather than handing one team another's score.
 *
 * Returns whether a played game was thrown away. Toasts replace each other, so
 * the caller folds that into its own message instead of firing a second one
 * that the next toast would swallow.
 */
function resetScores() {
  const m = game();
  const cleared = m.rounds.length > 0;
  stopTimer();
  m.rounds      = [];
  m.marks       = emptyMarks(m.teams.length, m.categories.length);
  m.letter      = null;
  m.usedLetters = [];
  m.remaining   = 0;
  m.paused      = false;
  m.phase       = m.teams.length >= 2 ? 'ready' : 'setup';
  return cleared;
}

function renameTeam(index, raw) {
  const m    = game();
  const team = m.teams[index];
  if (!team) return;
  const name = raw.trim().slice(0, MAX_TEAM_NAME);
  team.name   = name || `Lag ${index + 1}`;
  team.custom = !!name;
}

// ── Kategorier ───────────────────────────────────────────
function setCategories(next, { keepScores = false } = {}) {
  const m = game();
  m.categories = next;
  if (!keepScores) {
    m.marks = emptyMarks(m.teams.length, m.categories.length);
  }
  renderActivitiesAll();
}

function rerollAllCategories() {
  const m = game();
  setCategories(drawCategories(m.categories.length, m.categories));
  showToast('Nye kategorier trukket');
}

function rerollOne(index) {
  const m = game();
  setCategories(rerollCategory(m.categories, index));
}

function removeCategory(index) {
  const m = game();
  if (m.categories.length <= MIN_CATEGORIES) {
    showToast(`Minst ${MIN_CATEGORIES} kategorier`);
    return;
  }
  setCategories(m.categories.filter((_, i) => i !== index));
}

function addCategory(raw) {
  const m   = game();
  const cat = raw.trim().slice(0, MAX_CAT_LENGTH);
  if (!cat) return;
  if (m.categories.some(c => c.toLowerCase() === cat.toLowerCase())) {
    showToast('Kategorien finnes allerede');
    return;
  }
  if (m.categories.length >= MAX_CATEGORIES) {
    showToast(`Maks ${MAX_CATEGORIES} kategorier`);
    return;
  }
  $('act-cat-input').value = '';
  setCategories([...m.categories, cat]);
}

function nudgeCategoryCount(delta) {
  const m    = game();
  const want = clamp(m.categories.length + delta, MIN_CATEGORIES, MAX_CATEGORIES);
  if (want === m.categories.length) return;
  setCategories(want < m.categories.length
    ? m.categories.slice(0, want)
    : [...m.categories, ...drawCategories(want - m.categories.length, m.categories)]);
}

// ── Oppsettskjerm ────────────────────────────────────────
function renderPanel() {
  const m = game();
  $('act-size-val').textContent  = m.teamSize;
  $('act-cat-num').textContent   = m.categories.length;
  $('act-seconds').value         = m.seconds;
  $('act-sound').checked         = m.sound;
  $('act-hard').checked          = m.hardLetters;
  $('act-sheet-cats').checked    = !!m.sheetCategories;
  $('act-round-time').textContent = formatClock(totalSeconds(m));
}

function renderSetup() {
  const m        = game();
  const open     = state.activities.active === 'mariusleken';
  const today    = todayKey();
  const present  = presentStudents(state.students, state.groups, today);
  const away     = state.students.filter(s => absentToday(state.groups, today).includes(s));

  $('act-picker').hidden = open;
  $('act-setup').hidden  = !open;
  if (!open) return;

  // Kategorier
  const list = $('act-cat-list');
  list.textContent = '';
  m.categories.forEach((cat, i) => {
    const li = el('li', 'act-cat');
    li.append(
      el('span', 'act-cat-num', String(i + 1)),
      el('span', 'act-cat-name', cat)
    );
    const reroll = button('act-cat-btn', '🎲', { actCatReroll: i });
    reroll.title = 'Trekk en annen kategori her';
    const remove = button('act-cat-btn act-cat-remove', '✕', { actCatRemove: i });
    remove.title = 'Fjern kategorien';
    li.append(reroll, remove);
    list.appendChild(li);
  });
  $('act-cat-count').textContent = `(${m.categories.length})`;
  $('act-cat-hint').textContent  =
    `Hver kategori gir ${m.seconds} sekunder — runden varer ${formatClock(totalSeconds(m))}.`;

  // Lag
  const teams = $('act-teams');
  teams.textContent = '';
  m.teams.forEach((team, i) => {
    const card = el('div', 'act-team');
    card.style.setProperty('--team-color', teamColor(i));

    const name = el('input', 'act-team-name');
    name.type      = 'text';
    name.value     = team.name;
    name.maxLength = MAX_TEAM_NAME;
    name.setAttribute('aria-label', `Navn på lag ${i + 1}`);
    name.dataset.actTeamName = i;

    const ul = el('ul', 'act-team-members');
    team.members.forEach(n => ul.appendChild(el('li', '', n)));
    if (team.members.length === 0) ul.appendChild(el('li', 'act-muted', '(tomt)'));

    card.append(name, el('span', 'act-team-count', plural(team.members.length, 'elev', 'elever')), ul);
    teams.appendChild(card);
  });

  const hint = $('act-team-hint');
  if (m.teams.length === 0) {
    hint.textContent = present.length < 2
      ? 'Legg inn elevene i listen til venstre, så trekker du lag her.'
      : `${plural(present.length, 'elev', 'elever')} → ${describeSizes(groupSizes(present.length, { sizeMode: 'size', size: m.teamSize }))}.`;
  } else {
    const parts = [describeGame(m.teams, m.rounds)];
    if (away.length > 0) parts.push(`borte: ${away.join(', ')}`);
    hint.textContent = parts.join(' · ');
  }
  $('act-team-count').textContent = m.teams.length > 0 ? `(${m.teams.length})` : '';

  const ready = m.teams.length >= 2;
  $('act-start').disabled    = !ready;
  $('act-start').textContent = m.rounds.length > 0 ? '▶ Fortsett spillet' : '▶ Start Mariusleken';
  $('act-reset').hidden      = m.rounds.length === 0;
  $('act-setup-sub').textContent = ready
    ? 'Alt klart. Spillet åpnes i fullskjerm.'
    : 'Trekk lag for å komme i gang.';
}

// ── Spillskjermen ────────────────────────────────────────
let gameOpen  = false;
let showBoard = false;   // «📊 Stillingen» instead of the current phase
let raf       = null;
let deadline  = 0;       // performance.now() when the round ends

function openGame() {
  const m = game();
  if (m.teams.length < 2) { showToast('Trekk lag først'); return; }
  if (m.phase === 'setup') m.phase = 'ready';
  if (m.marks.length !== m.teams.length) m.marks = emptyMarks(m.teams.length, m.categories.length);

  gameOpen  = true;
  showBoard = false;
  const view = $('game-view');
  view.hidden = false;
  document.body.classList.add('board-open');
  // Fullscreen is a bonus — the overlay already covers the window, so a refusal
  // (iframe, browser policy) is fine to ignore.
  view.requestFullscreen?.().catch(() => {});
  renderGame();
  $('gv-close').focus();
}

function closeGame() {
  if (!gameOpen) return;
  // A round in progress is paused rather than lost: the letter and the time
  // left are kept, so reopening picks up where the class left off.
  if (game().phase === 'play') pauseRound();
  stopTimer();
  gameOpen = false;
  $('game-view').hidden = true;
  document.body.classList.remove('board-open');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  renderActivitiesAll();
}

// ── Runden ───────────────────────────────────────────────
function stopTimer() {
  if (raf !== null) cancelAnimationFrame(raf);
  raf = null;
}

function newLetter() {
  const m = game();
  m.letter = drawLetter(m.usedLetters, m.hardLetters);
  m.marks  = emptyMarks(m.teams.length, m.categories.length);
  renderGame();
}

function startRound() {
  const m = game();
  if (!m.letter) newLetter();
  m.remaining = totalSeconds(m);
  m.paused    = false;
  m.phase     = 'play';
  deadline    = performance.now() + m.remaining * 1000;
  beepStart();
  renderGame();
  tick();
}

function resumeRound() {
  const m = game();
  m.paused = false;
  deadline = performance.now() + m.remaining * 1000;
  renderGame();
  tick();
}

function pauseRound() {
  const m = game();
  stopTimer();
  m.paused    = true;
  m.remaining = Math.max(0, (deadline - performance.now()) / 1000);
}

function tick() {
  stopTimer();
  const m = game();
  let shown = Math.ceil(m.remaining);

  const step = () => {
    const left = Math.max(0, (deadline - performance.now()) / 1000);
    m.remaining = left;
    paintClock(left);

    const whole = Math.ceil(left);
    if (whole !== shown) {
      shown = whole;
      if (whole > 0 && whole <= 3) beepTick();
    }
    if (left <= 0) { stopTimer(); timeUp(); return; }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

/** Updates only the two elements that change every frame. */
function paintClock(left) {
  const clock = $('gv-clock');
  if (!clock) return;
  clock.textContent = formatClock(left);
  clock.classList.toggle('gv-clock-low', left <= 10);
  const ring = $('gv-ring');
  if (ring) ring.style.setProperty('--gv-progress', (left / totalSeconds(game())).toFixed(4));
}

function timeUp() {
  const m = game();
  m.remaining = 0;
  m.paused    = false;
  m.phase     = 'score';
  beepStop();
  renderGame();
}

function stopEarly() {
  stopTimer();
  timeUp();
}

/** Saves the round that was just scored and readies the next one. */
function commitRound() {
  const m = game();
  if (m.rounds.length >= MAX_ROUNDS) { showToast(`Maks ${MAX_ROUNDS} runder`); return; }
  m.rounds.push({
    letter:     m.letter,
    categories: [...m.categories],
    marks:      m.marks.map(row => [...row])
  });
  if (m.letter && !m.usedLetters.includes(m.letter)) m.usedLetters.push(m.letter);
  m.letter = null;
  m.marks  = emptyMarks(m.teams.length, m.categories.length);
  m.phase  = 'ready';
  showBoard = true;   // the class wants to see where that round left them
  renderGame();
}

function finishGame() {
  const m = game();
  if (m.rounds.length === 0) { showToast('Spill minst én runde først'); return; }
  stopTimer();
  m.phase   = 'done';
  showBoard = false;
  renderGame();
}

function newGame() {
  if (game().rounds.length > 0 && !confirm('Starte et nytt spill? Poengene nullstilles.')) return;
  resetScores();
  showBoard = false;
  renderGame();
  renderActivitiesAll();
}

function toggleMark(teamIndex, catIndex) {
  const m   = game();
  const row = m.marks[teamIndex];
  if (!row || row[catIndex] === undefined) return;
  row[catIndex] = nextMark(row[catIndex]);
  renderGame();
}

async function copyResult() {
  const m = game();
  const text = gameAsText(m.teams, m.rounds, {
    title:     state.className || 'Klassen',
    dateLabel: new Date().toLocaleDateString('no-NO', { day: 'numeric', month: 'long', year: 'numeric' })
  });
  try {
    await navigator.clipboard.writeText(text);
    showToast('Resultatet er kopiert — lim inn der du vil');
  } catch {
    showToast('Nettleseren nektet tilgang til utklippstavlen');
  }
}

// ── Tegning av spillskjermen ─────────────────────────────
function renderGame() {
  if (!gameOpen) return;
  const m    = game();
  const body = $('gv-body');
  body.textContent = '';
  body.className   = 'gv-body gv-phase-' + (showBoard ? 'board' : m.phase);

  $('gv-title').textContent = state.className
    ? `${state.className} · Mariusleken`
    : 'Mariusleken';
  $('gv-round').textContent  = m.phase === 'done'
    ? 'Sluttresultat'
    : `Runde ${m.rounds.length + 1}`;
  $('gv-scores').hidden = m.rounds.length === 0 || m.phase === 'done';
  $('gv-scores').textContent = showBoard ? '↩ Tilbake' : '📊 Stillingen';
  $('gv-finish').hidden = m.rounds.length === 0 || m.phase === 'done';

  if (showBoard)            body.appendChild(buildStandings({ big: true }));
  else if (m.phase === 'play')  body.appendChild(buildPlay());
  else if (m.phase === 'score') body.appendChild(buildScoring());
  else if (m.phase === 'done')  body.appendChild(buildPodium());
  else                          body.appendChild(buildReady());

  if (m.phase === 'play') paintClock(m.remaining);
}

function categoryStrip(extraClass = '') {
  const strip = el('ul', 'gv-cats ' + extraClass);
  game().categories.forEach((cat, i) => {
    const li = el('li', 'gv-cat');
    li.append(el('span', 'gv-cat-num', String(i + 1)), el('span', '', cat));
    strip.appendChild(li);
  });
  return strip;
}

function buildReady() {
  const m    = game();
  const wrap = el('div', 'gv-ready');

  const letterBox = el('div', 'gv-letterbox');
  letterBox.appendChild(el('div', 'gv-letter' + (m.letter ? '' : ' gv-letter-blank'), m.letter || '?'));
  letterBox.appendChild(el('p', 'gv-sub', m.letter
    ? `Runden varer ${formatClock(totalSeconds(m))}`
    : 'Trekk en bokstav for å starte runden'));

  const actions = el('div', 'gv-actions-row');
  actions.appendChild(button('gv-btn gv-btn-big', m.letter ? '🎲 Ny bokstav' : '🎲 Trekk bokstav', { gvAction: 'letter' }));
  if (m.letter) {
    const start = button('gv-btn gv-btn-big gv-btn-go', `▶ Start (${formatClock(totalSeconds(m))})`, { gvAction: 'start' });
    actions.appendChild(start);
  }

  wrap.append(letterBox, actions, categoryStrip());
  if (m.rounds.length > 0) wrap.appendChild(buildStandings({ big: false }));
  return wrap;
}

function buildPlay() {
  const m    = game();
  const wrap = el('div', 'gv-play');

  const ring = el('div', 'gv-ring');
  ring.id = 'gv-ring';
  const clock = el('div', 'gv-clock', formatClock(m.remaining));
  clock.id = 'gv-clock';
  ring.appendChild(clock);

  const left = el('div', 'gv-play-left');
  left.append(el('div', 'gv-letter', m.letter || '?'), el('p', 'gv-sub', 'Alle ord skal starte på denne bokstaven'));

  const right = el('div', 'gv-play-right');
  right.append(ring);

  const actions = el('div', 'gv-actions-row');
  actions.append(
    button('gv-btn', m.paused ? '▶ Fortsett' : '⏸ Pause', { gvAction: m.paused ? 'resume' : 'pause' }),
    button('gv-btn', '⏹ Stopp nå', { gvAction: 'stop' })
  );

  const top = el('div', 'gv-play-top');
  top.append(left, right);
  wrap.append(top, categoryStrip('gv-cats-play'), actions);
  if (m.paused) wrap.appendChild(el('p', 'gv-paused', '⏸ Pauset'));
  return wrap;
}

function buildScoring() {
  const m    = game();
  const wrap = el('div', 'gv-score');

  const head = el('div', 'gv-score-head');
  head.append(
    el('span', 'gv-stop', '✋ Stopp — legg ned blyanten!'),
    el('span', 'gv-score-letter', `Bokstav ${m.letter || '?'}`)
  );

  const table = el('table', 'gv-grid');
  const thead = el('thead');
  const hrow  = el('tr');
  hrow.appendChild(el('th', 'gv-grid-team', 'Lag'));
  m.categories.forEach(cat => hrow.appendChild(el('th', '', cat)));
  hrow.appendChild(el('th', 'gv-grid-sum', 'Sum'));
  thead.appendChild(hrow);

  const tbody = el('tbody');
  m.teams.forEach((team, ti) => {
    const tr = el('tr');
    tr.style.setProperty('--team-color', teamColor(ti));
    tr.appendChild(el('th', 'gv-grid-team', team.name));
    m.categories.forEach((_, ci) => {
      const td    = el('td');
      const value = m.marks[ti]?.[ci] || 0;
      const cell  = button('gv-mark gv-mark-' + value, String(value), { gvMark: `${ti},${ci}` });
      cell.setAttribute('aria-label', `${team.name}, ${m.categories[ci]}: ${value} poeng`);
      td.appendChild(cell);
      tr.appendChild(td);
    });
    tr.appendChild(el('td', 'gv-grid-sum', String(roundPoints(m.marks, ti))));
    tbody.appendChild(tr);
  });
  table.append(thead, tbody);

  const legend = el('p', 'gv-legend',
    'Trykk i rutene: 0 = tomt eller feil bokstav · 1 = flere hadde ordet · 2 = alene om ordet');

  const actions = el('div', 'gv-actions-row');
  actions.append(
    button('gv-btn gv-btn-big gv-btn-go', '✓ Lagre runden', { gvAction: 'commit' }),
    button('gv-btn', '🎲 Kast runden', { gvAction: 'discard' })
  );

  wrap.append(head, table, legend, actions);
  return wrap;
}

function buildStandings({ big }) {
  const m    = game();
  const rows = standings(m.teams, m.rounds);
  const top  = Math.max(1, ...rows.map(r => r.points));
  const wrap = el('div', big ? 'gv-board gv-board-big' : 'gv-board');

  wrap.appendChild(el('h3', 'gv-board-title', big ? 'Stillingen' : `Stillingen etter ${plural(m.rounds.length, 'runde', 'runder')}`));

  const list = el('ul', 'gv-bars');
  rows.forEach(row => {
    const li = el('li', 'gv-bar-row');
    li.style.setProperty('--team-color', teamColor(row.index));
    li.style.setProperty('--gv-fill', (row.points / top).toFixed(4));
    li.append(
      el('span', 'gv-bar-place', row.place + '.'),
      el('span', 'gv-bar-name', row.name),
      el('span', 'gv-bar-track', ''),
      el('span', 'gv-bar-points', String(row.points))
    );
    list.appendChild(li);
  });
  wrap.appendChild(list);
  return wrap;
}

function buildPodium() {
  const m    = game();
  const rows = standings(m.teams, m.rounds);
  const top  = podium(rows);
  const wrap = el('div', 'gv-podium-wrap');

  wrap.appendChild(el('h3', 'gv-podium-title', '🏆 Resultat'));

  // Second place to the left, first in the middle, third to the right — the
  // shape everyone recognises. Shared places simply queue up in the same slot.
  const stage = el('div', 'gv-podium');
  [2, 1, 3].forEach(place => {
    const winners = top.filter(r => r.place === place);
    if (winners.length === 0) return;
    const col = el('div', 'gv-podium-col gv-podium-' + place);
    const names = el('div', 'gv-podium-names');
    winners.forEach(w => {
      const item = el('div', 'gv-podium-name');
      item.style.setProperty('--team-color', teamColor(w.index));
      item.append(el('span', 'gv-podium-team', w.name), el('span', 'gv-podium-points', `${w.points} poeng`));
      names.appendChild(item);
    });
    const block = el('div', 'gv-podium-block');
    block.append(el('span', 'gv-podium-medal', place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉'),
                 el('span', 'gv-podium-place', place + '.'));
    col.append(names, block);
    stage.appendChild(col);
  });
  wrap.appendChild(stage);

  const rest = rows.filter(r => r.place > 3);
  if (rest.length > 0) {
    const list = el('ul', 'gv-rest');
    rest.forEach(r => list.appendChild(el('li', '', `${r.place}. ${r.name} — ${plural(r.points, 'poeng', 'poeng')}`)));
    wrap.appendChild(list);
  }

  wrap.appendChild(el('p', 'gv-sub', `${plural(m.rounds.length, 'runde', 'runder')} spilt · bokstavene ${m.usedLetters.join(', ')}`));

  const actions = el('div', 'gv-actions-row');
  actions.append(
    button('gv-btn gv-btn-big gv-btn-go', '➕ Spill en runde til', { gvAction: 'again' }),
    button('gv-btn', '📋 Kopier resultatet', { gvAction: 'copy' }),
    button('gv-btn', '🔄 Nytt spill', { gvAction: 'new' })
  );
  wrap.appendChild(actions);
  return wrap;
}

// ── Svarark ──────────────────────────────────────────────
/**
 * One sheet per team, built only while printing. The category headings are
 * blank by default: the sheets can then be printed before the lesson and the
 * categories written in by the pupils once they are drawn.
 */
function buildAnswerSheets() {
  const m     = game();
  const box   = $('answer-sheets');
  const cats  = m.sheetCategories ? m.categories : m.categories.map(() => '');
  const teams = m.teams.length > 0
    ? m.teams.map(t => ({ name: t.name, members: t.members }))
    : Array.from({ length: 8 }, () => ({ name: '', members: [] }));

  box.textContent = '';
  teams.forEach(team => {
    const sheet = el('section', 'sheet');

    const head = el('header', 'sheet-head');
    head.append(
      el('strong', '', 'Mariusleken'),
      el('span', 'sheet-class', state.className || '')
    );

    const nameRow = el('div', 'sheet-team');
    nameRow.append(el('span', 'sheet-label', 'Lag:'), el('span', 'sheet-line', team.name));
    const memberRow = el('div', 'sheet-members');
    memberRow.append(el('span', 'sheet-label', 'Deltakere:'), el('span', 'sheet-line', team.members.join(', ')));

    const table = el('table', 'sheet-table');
    const thead = el('thead');
    const hrow  = el('tr');
    hrow.appendChild(el('th', 'sheet-col-letter', 'Bokstav'));
    cats.forEach(cat => hrow.appendChild(el('th', '', cat)));
    thead.appendChild(hrow);

    const tbody = el('tbody');
    for (let r = 0; r < ROUNDS_ON_SHEET; r++) {
      const tr = el('tr');
      tr.appendChild(el('td', 'sheet-col-letter', ''));
      cats.forEach(() => tr.appendChild(el('td', '', '')));
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);

    const foot = el('p', 'sheet-foot',
      'Poeng: 0 = tomt eller feil bokstav · 1 = flere lag hadde ordet · 2 = alene om ordet');

    sheet.append(head, nameRow, memberRow, table, foot);
    box.appendChild(sheet);
  });
}

function printSheets() {
  buildAnswerSheets();
  window.print();
}

// ── Render entry point ───────────────────────────────────
export function renderActivitiesAll() {
  renderPanel();
  renderSetup();
  if (gameOpen) renderGame();
}

export function initActivities() {
  // Aktivitetsvelger
  $('act-cards').addEventListener('click', e => {
    const card = e.target.closest('[data-act-open]');
    if (!card) return;
    state.activities.active = card.dataset.actOpen;
    renderActivitiesAll();
  });
  $('act-back').addEventListener('click', () => {
    state.activities.active = null;
    renderActivitiesAll();
  });

  // Kategorier
  $('act-cat-list').addEventListener('click', e => {
    const reroll = e.target.closest('[data-act-cat-reroll]');
    if (reroll) { rerollOne(+reroll.dataset.actCatReroll); return; }
    const remove = e.target.closest('[data-act-cat-remove]');
    if (remove) removeCategory(+remove.dataset.actCatRemove);
  });
  $('act-cat-reroll').addEventListener('click', rerollAllCategories);
  $('act-cat-classic').addEventListener('click', () => {
    setCategories([...CLASSIC_CATEGORIES]);
    showToast('Klassisk sett: By, Land, Elv, Navn, Dyr');
  });
  $('act-cat-add').addEventListener('click', () => addCategory($('act-cat-input').value));
  $('act-cat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addCategory(e.target.value); }
  });
  $('act-cat-dec').addEventListener('click', () => nudgeCategoryCount(-1));
  $('act-cat-inc').addEventListener('click', () => nudgeCategoryCount(+1));

  // Lag
  $('act-teams-draw').addEventListener('click', drawTeamsNow);
  $('act-teams-import').addEventListener('click', importTeamsFromGroups);
  $('act-teams').addEventListener('change', e => {
    const input = e.target.closest('[data-act-team-name]');
    if (input) { renameTeam(+input.dataset.actTeamName, input.value); renderActivitiesAll(); }
  });
  $('act-size-dec').addEventListener('click', () => nudgeTeamSize(-1));
  $('act-size-inc').addEventListener('click', () => nudgeTeamSize(+1));

  // Innstillinger
  $('act-seconds').addEventListener('change', e => {
    const secs = +e.target.value;
    game().seconds = SECONDS_CHOICES.includes(secs) ? secs : 30;
    renderActivitiesAll();
  });
  $('act-sound').addEventListener('change', e => { game().sound = e.target.checked; });
  $('act-hard').addEventListener('change', e => { game().hardLetters = e.target.checked; });
  $('act-hard-info').addEventListener('click', e => {
    const tip = $('act-hard-tip');
    tip.hidden = !tip.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!tip.hidden));
  });
  $('act-sheet-cats').addEventListener('change', e => { game().sheetCategories = e.target.checked; });

  // Start / utskrift / nullstill
  $('act-start').addEventListener('click', openGame);
  $('act-print-sheets').addEventListener('click', printSheets);
  $('act-reset').addEventListener('click', newGame);

  // Spillskjermen
  $('gv-close').addEventListener('click', closeGame);
  $('gv-finish').addEventListener('click', finishGame);
  $('gv-scores').addEventListener('click', () => { showBoard = !showBoard; renderGame(); });

  $('gv-body').addEventListener('click', e => {
    const mark = e.target.closest('[data-gv-mark]');
    if (mark) {
      const [ti, ci] = mark.dataset.gvMark.split(',').map(Number);
      toggleMark(ti, ci);
      return;
    }
    const action = e.target.closest('[data-gv-action]')?.dataset.gvAction;
    if (!action) return;
    ({
      letter:  newLetter,
      start:   startRound,
      pause:   pauseRound,
      resume:  resumeRound,
      stop:    stopEarly,
      commit:  commitRound,
      discard: discardRound,
      again:   playAgain,
      copy:    copyResult,
      new:     newGame
    })[action]?.();
    if (action === 'pause') renderGame();
  });

  // Leaving fullscreen with Esc never reaches keydown, so treat it as closing.
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && gameOpen) closeGame();
  });
  document.addEventListener('keydown', e => {
    if (!gameOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); closeGame(); return; }
    // Space starts and stops the round — the teacher stands by the projector,
    // not the keyboard, so it has to work without aiming at a button.
    if (e.code === 'Space' && !e.target.closest('input, textarea')) {
      e.preventDefault();
      const m = game();
      if (m.phase === 'ready') startRound();
      else if (m.phase === 'play' && m.paused) resumeRound();
      else if (m.phase === 'play') { pauseRound(); renderGame(); }
    }
  });

  window.addEventListener('beforeprint', () => {
    if (state.mode === 'activities') buildAnswerSheets();
  });
}

function nudgeTeamSize(delta) {
  const m = game();
  m.teamSize = clamp(m.teamSize + delta, MIN_TEAM_SIZE, MAX_TEAM_SIZE);
  renderActivitiesAll();
}

/** Throws away the round that was just played, letter and all. */
function discardRound() {
  const m = game();
  m.marks  = emptyMarks(m.teams.length, m.categories.length);
  m.letter = null;
  m.phase  = 'ready';
  renderGame();
  showToast('Runden ble ikke telt');
}

function playAgain() {
  const m = game();
  m.phase   = 'ready';
  showBoard = false;
  renderGame();
}
