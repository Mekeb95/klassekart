'use strict';

import {
  MIN_TEAM_SIZE, MAX_TEAM_SIZE, MAX_TEAMS, MAX_TEAM_NAME,
  MIN_CATEGORIES, MAX_CATEGORIES, MAX_CAT_LENGTH, MAX_ROUNDS,
  SECONDS_CHOICES, ROUNDS_ON_SHEET, CLASSIC_CATEGORIES
} from './constants.js';
import { state, pushUndo, detectDuplicates } from './state.js';
import { todayKey, presentStudents, groupSizes, describeSizes, drawGroups, absentToday } from './groups.js';
import {
  drawLetter, drawCategories, rerollCategory, emptyMarks, emptyPenalties, roundPoints,
  nextMark, nextPenalty, standings, podium, buildTeams, teamsFromGroups, formatClock,
  roundSeconds, gameAsText, describeGame, letterPool
} from './activities.js';
import { showToast } from './toast.js';
import { renderRuleList } from './rules-view.js';
import { sfx, startMusic, stopMusic } from './game-audio.js';
import { celebrate } from './celebrate.js';

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
// The sounds themselves live in game-audio.js; this only decides whether the
// teacher wants them. Music needs both switches: «Lyd» off means silence.
const beep = Object.fromEntries(Object.entries(sfx).map(([name, play]) =>
  [name, (...args) => { if (game().sound) play(...args); }]));
const musicOn = () => game().sound && game().music;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

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
  m.penalties   = emptyPenalties(m.teams.length);
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
  $('act-music').checked         = m.music;
  $('act-music').disabled        = !m.sound;
  $('act-music-row').classList.toggle('opt-off', !m.sound);
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
let podiumStep = Infinity;  // how many podium places are showing; Infinity = all

function openGame() {
  const m = game();
  if (m.teams.length < 2) { showToast('Trekk lag først'); return; }
  if (m.phase === 'setup') m.phase = 'ready';
  if (m.marks.length !== m.teams.length) m.marks = emptyMarks(m.teams.length, m.categories.length);
  if (m.penalties.length !== m.teams.length) m.penalties = emptyPenalties(m.teams.length);

  gameOpen  = true;
  showBoard = false;
  podiumStep = Infinity;   // coming back to a finished game shows the whole podium
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
  stopShow();
  gameOpen = false;
  $('game-view').hidden = true;
  document.body.classList.remove('board-open');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  renderActivitiesAll();
}

// ── Runden ───────────────────────────────────────────────
/** Whenever the clock stops, the music stops with it. */
function stopTimer() {
  if (raf !== null) cancelAnimationFrame(raf);
  raf = null;
  stopMusic();
}

function newLetter() {
  const m = game();
  m.letter    = drawLetter(m.usedLetters, m.hardLetters);
  m.marks     = emptyMarks(m.teams.length, m.categories.length);
  m.penalties = emptyPenalties(m.teams.length);
  renderGame();
  rollLetter(m.letter);
}

// ── Bokstavhjulet ────────────────────────────────────────
// The new letter spins in like a fruit machine: fast at first, slowing down,
// then a pop as it lands. Purely for show — the letter is already decided, so
// pressing Start (or anything that redraws the screen) simply cuts it short.
let rollTimer = null;

function stopRoll() {
  clearTimeout(rollTimer);
  rollTimer = null;
}

function rollLetter(final) {
  stopRoll();
  const box = document.querySelector('#gv-body .gv-letterbox .gv-letter');
  if (!box || reducedMotion()) return;

  const pool  = letterPool(game().hardLetters).filter(l => l !== final);
  const delays = [];
  for (let d = 35; d < 190; d *= 1.17) delays.push(d);

  box.classList.add('gv-letter-rolling');
  let i = 0;
  const spin = () => {
    if (i < delays.length) {
      box.textContent = pool[Math.floor(Math.random() * pool.length)];
      beep.roll();
      rollTimer = setTimeout(spin, delays[i++]);
      return;
    }
    rollTimer = null;
    box.textContent = final;
    box.classList.remove('gv-letter-rolling');
    box.classList.add('gv-letter-land');
    beep.land();
  };
  box.textContent = pool[0];
  spin();
}

function startRound() {
  const m = game();
  if (!m.letter) newLetter();
  m.remaining = totalSeconds(m);
  m.paused    = false;
  m.phase     = 'play';
  deadline    = performance.now() + m.remaining * 1000;
  beep.start();
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

const secondsLeft = () => Math.max(0, (deadline - performance.now()) / 1000);

function tick() {
  stopTimer();
  const m = game();
  let shown = Math.ceil(m.remaining);
  if (musicOn()) startMusic(secondsLeft);

  const step = () => {
    const left = Math.max(0, (deadline - performance.now()) / 1000);
    m.remaining = left;
    paintClock(left);

    const whole = Math.ceil(left);
    if (whole !== shown) {
      shown = whole;
      if (whole > 0 && whole <= 3) beep.tick();
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
  if (!ring) return;
  ring.style.setProperty('--gv-progress', (left / totalSeconds(game())).toFixed(4));
  ring.classList.toggle('gv-ring-low', left <= 10);
  ring.classList.toggle('gv-ring-final', left > 0 && left <= 3);
}

/** «🎵 Musikk» on the play screen — mutes or restarts the music on the spot. */
function toggleMusic() {
  const m = game();
  m.music = !m.music;
  if (m.music && !m.sound) m.sound = true;   // asking for music means wanting sound
  if (musicOn() && m.phase === 'play' && !m.paused) startMusic(secondsLeft);
  else stopMusic();
  renderPanel();
  renderGame();
}

function timeUp() {
  const m = game();
  m.remaining = 0;
  m.paused    = false;
  m.phase     = 'score';
  stopMusic();
  beep.stop();
  renderGame();
}

function stopEarly() {
  stopTimer();
  timeUp();
}

/**
 * Saves the round that was just scored and readies the next one — either
 * straight on to a fresh letter, or by way of the standings when the class is
 * to see where that round left them.
 */
function commitRound({ showStandings }) {
  const m = game();
  if (m.rounds.length >= MAX_ROUNDS) { showToast(`Maks ${MAX_ROUNDS} runder`); return; }
  m.rounds.push({
    letter:     m.letter,
    categories: [...m.categories],
    marks:      m.marks.map(row => [...row]),
    penalties:  [...m.penalties]
  });
  if (m.letter && !m.usedLetters.includes(m.letter)) m.usedLetters.push(m.letter);
  m.letter    = null;
  m.marks     = emptyMarks(m.teams.length, m.categories.length);
  m.penalties = emptyPenalties(m.teams.length);
  m.phase     = 'ready';

  showBoard = showStandings;
  if (showStandings) renderGame();
  else               newLetter();   // renders, with the next letter already up
}

/** From the standings on to the next round, with a fresh letter. */
function nextRound() {
  showBoard = false;
  game().phase = 'ready';
  newLetter();
}

/** Back out of the standings without touching the round in progress. */
function closeStandings() {
  showBoard = false;
  renderGame();
}

function finishGame() {
  const m = game();
  if (m.rounds.length === 0) { showToast('Spill minst én runde først'); return; }
  stopTimer();
  m.phase   = 'done';
  showBoard = false;
  podiumStep = 0;
  renderGame();
  revealPodium();
}

function newGame() {
  if (game().rounds.length > 0 && !confirm('Starte et nytt spill? Poengene nullstilles.')) return;
  stopShow();
  resetScores();
  showBoard = false;
  renderGame();
  renderActivitiesAll();
}

/**
 * Scoring taps change just the cell and the team's sum in place — redrawing
 * the whole grid would reset the little pop each tap gets.
 */
function toggleMark(teamIndex, catIndex, cell) {
  const m   = game();
  const row = m.marks[teamIndex];
  if (!row || row[catIndex] === undefined) return;
  const value = row[catIndex] = nextMark(row[catIndex]);
  paintCell(cell, 'gv-mark gv-mark-' + value, String(value),
    `${m.teams[teamIndex].name}, ${m.categories[catIndex]}: ${value} poeng`);
  paintSum(teamIndex);
  beep.mark(value);
}

function togglePenalty(teamIndex, cell) {
  const m = game();
  if (m.penalties[teamIndex] === undefined) return;
  const value = m.penalties[teamIndex] = nextPenalty(m.penalties[teamIndex]);
  paintCell(cell, 'gv-pen' + (value > 0 ? ' gv-pen-on' : ''), penaltyLabel(value),
    `${m.teams[teamIndex].name}: ${value > 0 ? `${value} i trekk` : 'ingen trekk'}`);
  paintSum(teamIndex);
  if (value > 0) beep.penalty();
}

const penaltyLabel = n => (n > 0 ? `−${n}` : '–');

function paintCell(cell, className, text, label) {
  cell.className   = className;
  cell.textContent = text;
  cell.setAttribute('aria-label', label);
  // Restart the pop: drop the class, force a reflow, add it back.
  cell.classList.remove('gv-pop');
  void cell.offsetWidth;
  cell.classList.add('gv-pop');
}

function paintSum(teamIndex) {
  const m   = game();
  const sum = document.querySelector(`#gv-body [data-gv-sum="${teamIndex}"]`);
  if (!sum) return;
  const points = roundPoints(m.marks, teamIndex, m.penalties);
  sum.textContent = String(points);
  sum.classList.toggle('gv-grid-sum-neg', points < 0);
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
  stopRoll();
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
  const music = button('gv-btn gv-btn-music', musicOn() ? '🎵 Musikk på' : '🔇 Musikk av', { gvAction: 'music' });
  music.setAttribute('aria-pressed', String(musicOn()));
  actions.append(
    button('gv-btn', m.paused ? '▶ Fortsett' : '⏸ Pause', { gvAction: m.paused ? 'resume' : 'pause' }),
    button('gv-btn', '⏹ Stopp nå', { gvAction: 'stop' }),
    music
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
  hrow.appendChild(el('th', 'gv-grid-pen', 'Trekk'));
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
    const pen   = m.penalties[ti] || 0;
    const penTd = el('td', 'gv-grid-pen');
    const penBtn = button('gv-pen' + (pen > 0 ? ' gv-pen-on' : ''), penaltyLabel(pen), { gvPen: ti });
    penBtn.setAttribute('aria-label', `${team.name}: ${pen > 0 ? `${pen} i trekk` : 'ingen trekk'}`);
    penBtn.title = 'Trekk ett poeng (juks o.l.) — trykk flere ganger for mer';
    penTd.appendChild(penBtn);
    tr.appendChild(penTd);

    const points = roundPoints(m.marks, ti, m.penalties);
    const sum = el('td', 'gv-grid-sum' + (points < 0 ? ' gv-grid-sum-neg' : ''), String(points));
    sum.dataset.gvSum = ti;
    tr.appendChild(sum);
    tbody.appendChild(tr);
  });
  table.append(thead, tbody);

  const legend = el('p', 'gv-legend',
    'Trykk i rutene: 0 = tomt eller feil bokstav · 1 = flere hadde ordet · 2 = alene om ordet · Trekk = −1 per trykk (juks o.l.)');

  // «Neste runde» er hovedknappen: den er det læreren trykker på ni av ti
  // ganger, og den sto før bare som «↩ Tilbake» i hjørnet av stillingen.
  const actions = el('div', 'gv-actions-row');
  actions.append(
    button('gv-btn gv-btn-big gv-btn-go', '▶ Neste runde', { gvAction: 'commitNext' }),
    button('gv-btn', '📊 Lagre og se stillingen', { gvAction: 'commitBoard' }),
    button('gv-btn', '🎲 Kast runden', { gvAction: 'discard' })
  );

  wrap.append(head, table, legend, actions);
  return wrap;
}

function buildStandings({ big }) {
  const m    = game();
  const rows = standings(m.teams, m.rounds);
  const top  = Math.max(1, ...rows.map(r => r.points));
  let order  = 0;
  const wrap = el('div', big ? 'gv-board gv-board-big' : 'gv-board');

  wrap.appendChild(el('h3', 'gv-board-title', big ? 'Stillingen' : `Stillingen etter ${plural(m.rounds.length, 'runde', 'runder')}`));

  const list = el('ul', 'gv-bars');
  rows.forEach(row => {
    const li = el('li', 'gv-bar-row');
    li.style.setProperty('--team-color', teamColor(row.index));
    li.style.setProperty('--gv-fill', (Math.max(0, row.points) / top).toFixed(4));
    li.style.setProperty('--gv-i', order++);
    li.append(
      el('span', 'gv-bar-place', row.place + '.'),
      el('span', 'gv-bar-name', row.name),
      el('span', 'gv-bar-track', ''),
      el('span', 'gv-bar-points', String(row.points))
    );
    list.appendChild(li);
  });
  wrap.appendChild(list);

  // Vises den i stor visning, er den et stopp underveis — da må veien videre
  // stå her, ikke gjemt som «↩ Tilbake» oppe i hjørnet.
  if (big) {
    const actions = el('div', 'gv-actions-row gv-board-actions');
    actions.append(m.letter
      ? button('gv-btn gv-btn-big gv-btn-go', '↩ Tilbake til runden', { gvAction: 'closeBoard' })
      : button('gv-btn gv-btn-big gv-btn-go', '▶ Neste runde', { gvAction: 'next' }));
    actions.appendChild(button('gv-btn', '🏆 Avslutt spillet', { gvAction: 'finish' }));
    wrap.appendChild(actions);
  }
  return wrap;
}

/** The podium places that actually have someone on them, in reveal order. */
function podiumPlaces() {
  const top = podium(standings(game().teams, game().rounds));
  return [3, 2, 1].filter(place => top.some(r => r.place === place));
}

function buildPodium() {
  const m      = game();
  const rows   = standings(m.teams, m.rounds);
  const top    = podium(rows);
  const order  = podiumPlaces();
  const done   = podiumStep >= order.length;
  const wrap   = el('div', 'gv-podium-wrap' + (done ? ' is-done' : ''));

  wrap.appendChild(el('h3', 'gv-podium-title', '🏆 Resultat'));
  const caption = el('p', 'gv-podium-caption', done ? winnerLine(top) : '');
  caption.id = 'gv-podium-caption';
  wrap.appendChild(caption);

  // Second place to the left, first in the middle, third to the right — the
  // shape everyone recognises. Shared places simply queue up in the same slot.
  // Every column is laid out from the start and only made visible when its
  // turn comes, so nothing jumps about while the places are revealed.
  const stage = el('div', 'gv-podium');
  [2, 1, 3].forEach(place => {
    const winners = top.filter(r => r.place === place);
    if (winners.length === 0) {
      // Shared places can leave a step empty (two teams on 2. → no 3.). The
      // step still stands, so the winner stays in the middle.
      const empty = el('div', `gv-podium-col gv-podium-${place} gv-podium-empty is-shown`);
      empty.appendChild(el('div', 'gv-podium-block'));
      stage.appendChild(empty);
      return;
    }
    const shown = order.indexOf(place) < podiumStep;
    const col   = el('div', `gv-podium-col gv-podium-${place}${shown ? ' is-shown' : ''}`);
    col.dataset.place = place;
    const names = el('div', 'gv-podium-names');
    winners.forEach(w => {
      const item = el('div', 'gv-podium-name');
      item.style.setProperty('--team-color', teamColor(w.index));
      item.append(el('span', 'gv-podium-team', w.name), el('span', 'gv-podium-points', plural(w.points, 'poeng', 'poeng')));
      names.appendChild(item);
    });
    const block = el('div', 'gv-podium-block');
    block.append(el('span', 'gv-podium-medal', place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉'),
                 el('span', 'gv-podium-place', place + '.'));
    col.append(names, block);
    stage.appendChild(col);
  });
  wrap.appendChild(stage);

  const after = el('div', 'gv-podium-after');
  const rest = rows.filter(r => r.place > 3);
  if (rest.length > 0) {
    const list = el('ul', 'gv-rest');
    rest.forEach(r => list.appendChild(el('li', '', `${r.place}. ${r.name} — ${plural(r.points, 'poeng', 'poeng')}`)));
    after.appendChild(list);
  }

  after.appendChild(el('p', 'gv-sub', `${plural(m.rounds.length, 'runde', 'runder')} spilt · bokstavene ${m.usedLetters.join(', ')}`));

  const actions = el('div', 'gv-actions-row');
  actions.append(
    button('gv-btn gv-btn-big gv-btn-go', '➕ Spill en runde til', { gvAction: 'again' }),
    button('gv-btn', '📋 Kopier resultatet', { gvAction: 'copy' }),
    button('gv-btn', '🔄 Nytt spill', { gvAction: 'new' })
  );
  after.appendChild(actions);
  wrap.appendChild(after);

  if (!done) wrap.appendChild(el('p', 'gv-skip', 'Trykk hvor som helst for å hoppe over'));
  return wrap;
}

function winnerLine(top) {
  const names = top.filter(r => r.place === 1).map(r => r.name);
  if (names.length === 0) return '';
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} og ${names.at(-1)}`;
  return `Gratulerer, ${list}! 🎉`;
}

// ── Avsløringen ──────────────────────────────────────────
// 3. plass → 2. plass → trommevirvel → 1. plass med raketter og konfetti.
// It runs on its own; the teacher only has to wait (or tap to skip).
const REVEAL = { first: 900, between: 2200, drumroll: 2400 };
let showTimers = [];
let stopFx     = null;

function later(ms, fn) { showTimers.push(setTimeout(fn, ms)); }

/** Stops the reveal and the fireworks — leaving the podium, closing the game. */
function stopShow() {
  showTimers.forEach(clearTimeout);
  showTimers = [];
  stopFx?.();
  stopFx = null;
}

function caption(text) {
  const c = $('gv-podium-caption');
  if (!c) return;
  c.textContent = text;
  c.classList.remove('gv-pop');
  void c.offsetWidth;
  c.classList.add('gv-pop');
}

function showPlace(place) {
  document.querySelector(`#gv-body .gv-podium-col[data-place="${place}"]`)?.classList.add('is-shown');
}

function revealPodium() {
  stopShow();
  const order = podiumPlaces();
  if (reducedMotion()) { podiumStep = Infinity; renderGame(); return; }

  let at = REVEAL.first;
  order.forEach((place, i) => {
    if (place === 1) {
      // Only build up the drumroll when there was someone before the winner.
      if (i > 0) {
        later(at, () => { caption('Og vinneren er …'); beep.drumroll(REVEAL.drumroll / 1000); });
        at += REVEAL.drumroll;
      }
      later(at, () => {
        podiumStep = i + 1;
        showPlace(1);
        beep.fanfare();
        crowning();
      });
      at += 1600;
    } else {
      later(at, () => {
        podiumStep = i + 1;
        caption(`${place}. plass …`);
        showPlace(place);
        beep.place(place);
      });
      at += REVEAL.between;
    }
  });
  later(at, finishReveal);
}

/** The winner's moment: caption, confetti, rockets. */
function crowning() {
  const m   = game();
  const top = podium(standings(m.teams, m.rounds));
  caption(winnerLine(top));
  const host = document.querySelector('#game-view .gv-frame');
  if (!host) return;
  stopFx?.();
  stopFx = celebrate(host, {
    colors:   top.filter(r => r.place === 1).map(r => teamColor(r.index)),
    onRocket: kind => (kind === 'bang' ? beep.bang() : beep.whistle())
  });
}

function finishReveal() {
  podiumStep = Infinity;
  document.querySelector('#gv-body .gv-podium-wrap')?.classList.add('is-done');
  document.querySelector('#gv-body .gv-skip')?.remove();
}

/** Tap or Space mid-reveal: everything at once, still with the fireworks. */
function skipPodium() {
  const wasCrowned = podiumStep >= podiumPlaces().length;
  showTimers.forEach(clearTimeout);
  showTimers = [];
  podiumPlaces().forEach(showPlace);
  if (!wasCrowned) { beep.fanfare(); crowning(); }
  finishReveal();
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
  $('act-sound').addEventListener('change', e => { game().sound = e.target.checked; renderPanel(); });
  $('act-music').addEventListener('change', e => { game().music = e.target.checked; });
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
      toggleMark(ti, ci, mark);
      return;
    }
    const pen = e.target.closest('[data-gv-pen]');
    if (pen) { togglePenalty(+pen.dataset.gvPen, pen); return; }
    // A tap on the podium while it is being revealed skips to the end.
    if (podiumStep < Infinity && e.target.closest('.gv-podium-wrap') && !e.target.closest('button')) {
      skipPodium();
      return;
    }
    const action = e.target.closest('[data-gv-action]')?.dataset.gvAction;
    if (!action) return;
    ({
      letter:      newLetter,
      start:       startRound,
      pause:       pauseRound,
      resume:      resumeRound,
      stop:        stopEarly,
      commitNext:  () => commitRound({ showStandings: false }),
      commitBoard: () => commitRound({ showStandings: true }),
      next:        nextRound,
      closeBoard:  closeStandings,
      finish:      finishGame,
      discard:     discardRound,
      again:       playAgain,
      copy:        copyResult,
      new:         newGame,
      music:       toggleMusic
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
      if (m.phase === 'done' && podiumStep < Infinity) skipPodium();
      else if (showBoard) return;
      else if (m.phase === 'ready') startRound();
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
  m.marks     = emptyMarks(m.teams.length, m.categories.length);
  m.penalties = emptyPenalties(m.teams.length);
  m.letter    = null;
  m.phase     = 'ready';
  renderGame();
  showToast('Runden ble ikke telt');
}

function playAgain() {
  const m = game();
  stopShow();
  m.phase   = 'ready';
  showBoard = false;
  renderGame();
}
