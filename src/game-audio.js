'use strict';

// Every sound in Mariusleken — the beeps, the waiting music and the fanfare —
// made with WebAudio rather than sound files: no extra requests, nothing for
// the Content-Security-Policy to allow, and no rights to clear for music
// played in a classroom. The context can only be created after a click, which
// is exactly when the first sound is needed.
//
// The music voices take a context and a destination instead of reaching for
// the live ones, so the same code can be rendered offline to check the mix.

let ctx    = null;
let master = null;
let noise  = null;

const mtof = n => 440 * 2 ** ((n - 69) / 12);

function ensure() {
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      // The compressor keeps a drumroll on top of the music from clipping.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value     = 6;
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(comp).connect(ctx.destination);
    }
    ctx.resume?.();
    return ctx;
  } catch {
    return null;   // no audio available — everything on screen works without it
  }
}

function noiseBuffer(a) {
  if (noise && noise.sampleRate === a.sampleRate) return noise;
  const buf  = a.createBuffer(1, a.sampleRate, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  if (a === ctx) noise = buf;
  return buf;
}

// ── Byggeklosser ─────────────────────────────────────────
function envelope(a, dest, t, dur, peak, attack = 0.01) {
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(dest);
  return g;
}

function osc(a, dest, { type = 'sine', freq, t, dur, peak, attack, to, filter }) {
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  let out = envelope(a, dest, t, dur, peak, attack);
  if (filter) {
    const f = a.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filter;
    f.connect(out);
    out = f;
  }
  o.connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function burst(a, dest, { t, dur, peak, type = 'highpass', freq = 7000, q = 0.7 }) {
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(a);
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  src.connect(f).connect(envelope(a, dest, t, dur, peak, 0.003));
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

// ── Ventemusikk ──────────────────────────────────────────
// An original little quiz-show loop in A minor: Am – F – C – G, one bar each,
// eight eighth-notes to the bar. Bass and drums play throughout, off-beat
// chord stabs keep it bouncy, and the tune only comes in every other time
// round so two and a half minutes of it don't wear thin.
const BPM         = 116;
const HURRY       = 1.4;    // tempo factor for the last HURRY_FROM seconds
const HURRY_FROM  = 10;
const MUSIC_LEVEL = 0.7;
const STEPS       = 32;     // 4 bars × 8

const CHORDS = [
  { root: 45, third: 3 },   // Am
  { root: 41, third: 4 },   // F
  { root: 48, third: 4 },   // C
  { root: 43, third: 4 }    // G
];
const BASS = [0, null, 12, null, 7, null, 12, 7];
const TUNE = [
  69, null, 72, null, 76, null, 74, 72,
  69, null, null, null, 65, null, 69, 72,
  67, null, 72, null, 76, null, 79, 76,
  74, null, null, 71, 74, null, null, null
];

/** Seconds per eighth-note, faster once time is nearly up. */
export const stepLength = hurry => 60 / (BPM * (hurry ? HURRY : 1)) / 2;

/** One eighth-note of the loop, starting at time `t`. `loop` counts whole times round. */
export function musicStep(a, dest, step, loop, t, len, hurry) {
  const bar   = Math.floor(step / 8);
  const beat  = step % 8;
  const chord = CHORDS[bar];

  // Trommer: kick on 1 and 3, snare on 2 and 4, hi-hat on every eighth.
  if (beat === 0 || beat === 4) {
    osc(a, dest, { freq: 140, to: 45, t, dur: 0.16, peak: 0.55, attack: 0.002 });
  }
  if (beat === 2 || beat === 6) {
    burst(a, dest, { t, dur: 0.11, peak: 0.16, type: 'bandpass', freq: 1900, q: 0.8 });
  }
  burst(a, dest, { t, dur: 0.035, peak: beat % 2 ? 0.07 : 0.035 });
  if (hurry) burst(a, dest, { t: t + len / 2, dur: 0.03, peak: 0.05 });

  // Bass
  const b = BASS[beat];
  if (b !== null) {
    osc(a, dest, { type: 'triangle', freq: mtof(chord.root + b), t, dur: len * 0.9, peak: 0.34 });
  }

  // Off-beat stabs
  if (beat % 2 === 1) {
    [24, 24 + chord.third, 31].forEach(iv => osc(a, dest, {
      type: 'square', freq: mtof(chord.root + iv), t, dur: 0.09, peak: 0.028, filter: 2200
    }));
  }

  // The tune, every other loop — and always once the clock is nearly out.
  const note = TUNE[step];
  if (note && (loop % 2 === 1 || hurry)) {
    let hold = 1;
    while (hold < 4 && TUNE[(step + hold) % STEPS] === null) hold++;
    osc(a, dest, {
      type: 'square', freq: mtof(note), t, dur: len * Math.min(hold, 2) * 0.95,
      peak: 0.05, attack: 0.012, filter: 2600
    });
  }
}

let music = null;

/**
 * Starts the loop. `secondsLeft` is asked before every note, so the music
 * speeds up by itself when the round is nearly over. Calling it while the
 * music is already playing does nothing.
 */
export function startMusic(secondsLeft) {
  if (music) return;
  const a = ensure();
  if (!a) return;

  const bus = a.createGain();
  bus.gain.setValueAtTime(0.0001, a.currentTime);
  bus.gain.exponentialRampToValueAtTime(MUSIC_LEVEL, a.currentTime + 0.5);
  bus.connect(master);

  music = { bus, step: 0, loop: 0, next: a.currentTime + 0.06, timer: null };

  // Look-ahead scheduling: a coarse JS timer queues the notes a little ahead
  // on the audio clock, which is what keeps the beat steady.
  const schedule = () => {
    if (!music) return;
    while (music.next < a.currentTime + 0.15) {
      const hurry = secondsLeft() <= HURRY_FROM;
      const len   = stepLength(hurry);
      musicStep(a, music.bus, music.step, music.loop, music.next, len, hurry);
      music.next += len;
      music.step  = (music.step + 1) % STEPS;
      if (music.step === 0) music.loop++;
    }
  };
  schedule();
  music.timer = setInterval(schedule, 25);
}

export function stopMusic() {
  if (!music) return;
  const { bus, timer } = music;
  music = null;
  clearInterval(timer);
  const now = ctx.currentTime;
  bus.gain.cancelScheduledValues(now);
  bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), now);
  bus.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
  setTimeout(() => bus.disconnect(), 400);
}

export const musicPlaying = () => music !== null;

// ── Lydeffekter ──────────────────────────────────────────
function play(fn) {
  const a = ensure();
  if (a) fn(a, master, a.currentTime + 0.01);
}

const note = (a, d, n, t, dur, peak = 0.2, type = 'sine') =>
  osc(a, d, { type, freq: mtof(n), t, dur, peak });

export const sfx = {
  tick:  () => play((a, d, t) => osc(a, d, { freq: 880, t, dur: 0.09, peak: 0.15 })),
  start: () => play((a, d, t) => { note(a, d, 76, t, 0.1); note(a, d, 83, t + 0.1, 0.16); }),
  stop:  () => play((a, d, t) => {
    note(a, d, 72, t, 0.22);
    note(a, d, 68, t + 0.22, 0.22);
    note(a, d, 63, t + 0.44, 0.5);
  }),

  /** One click of the letter wheel spinning past. */
  roll:  () => play((a, d, t) => osc(a, d, { type: 'triangle', freq: 1500, t, dur: 0.035, peak: 0.08 })),
  land:  () => play((a, d, t) => {
    note(a, d, 79, t, 0.12, 0.16, 'triangle');
    note(a, d, 84, t + 0.07, 0.3, 0.16, 'triangle');
  }),

  /** Scoring taps: higher and brighter the more points. */
  mark: value => play((a, d, t) => {
    if (value === 0) osc(a, d, { type: 'triangle', freq: 260, t, dur: 0.08, peak: 0.12 });
    else if (value === 1) note(a, d, 72, t, 0.12, 0.14, 'triangle');
    else { note(a, d, 76, t, 0.1, 0.14, 'triangle'); note(a, d, 83, t + 0.06, 0.2, 0.14, 'triangle'); }
  }),

  /** Sad trombone-ish «wah-wah» for trekk. */
  penalty: () => play((a, d, t) => {
    osc(a, d, { type: 'sawtooth', freq: 233, to: 220, t, dur: 0.22, peak: 0.1, filter: 900 });
    osc(a, d, { type: 'sawtooth', freq: 208, to: 175, t: t + 0.24, dur: 0.45, peak: 0.1, filter: 800 });
  }),

  /** Third and second place: a short rising «ta-da». */
  place: rank => play((a, d, t) => {
    const top = rank === 3 ? 72 : 76;
    note(a, d, top - 5, t, 0.14, 0.16, 'triangle');
    note(a, d, top, t + 0.12, 0.5, 0.18, 'triangle');
  }),

  /** A snare roll that swells for `seconds`, then a crash. */
  drumroll: seconds => play((a, d, t) => {
    const hits = Math.floor(seconds / 0.045);
    for (let i = 0; i < hits; i++) {
      burst(a, d, {
        t: t + i * 0.045, dur: 0.06, peak: 0.04 + 0.2 * (i / hits),
        type: 'bandpass', freq: 2100, q: 0.9
      });
    }
    burst(a, d, { t: t + seconds, dur: 1.4, peak: 0.28, freq: 5000 });
  }),

  /** The winner's fanfare. */
  fanfare: () => play((a, d, t) => {
    [60, 64, 67].forEach((n, i) => note(a, d, n + 12, t + i * 0.11, 0.16, 0.16, 'square'));
    [72, 76, 79, 84].forEach(n => osc(a, d, {
      type: 'square', freq: mtof(n), t: t + 0.36, dur: 1.3, peak: 0.07, filter: 3000
    }));
  }),

  whistle: () => play((a, d, t) =>
    osc(a, d, { freq: 500 + Math.random() * 200, to: 1500, t, dur: 0.7, peak: 0.03 })),
  bang: () => play((a, d, t) => {
    burst(a, d, { t, dur: 0.7, peak: 0.35, type: 'lowpass', freq: 700 });
    burst(a, d, { t: t + 0.05, dur: 0.9, peak: 0.06, freq: 4000 });
  })
};
