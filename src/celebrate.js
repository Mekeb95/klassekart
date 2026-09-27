'use strict';

// Raketter og konfetti for vinneren — a canvas laid over the game screen,
// drawn by hand so the page needs no library for it. Everything is time-based
// (not frame-based), so a 144 Hz laptop and a sluggish smartboard look alike.

const COLORS = ['#ffd43b', '#ff6b6b', '#4dabf7', '#69db7c', '#f783ac', '#ffa94d', '#b197fc', '#fff'];
const pick   = list => list[Math.floor(Math.random() * list.length)];
const rand   = (min, max) => min + Math.random() * (max - min);

const GRAVITY = 0.12;   // px per frame², at 60 fps

/**
 * Starts the show over `host` and returns a function that stops it early.
 * `onRocket(kind)` is called with 'launch' and 'bang', for the sound.
 */
export function celebrate(host, { rockets = 9, colors = [], onRocket = () => {} } = {}) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return () => {};

  const canvas = document.createElement('canvas');
  canvas.className = 'gv-fx';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  const g = canvas.getContext('2d');

  let w = 0, h = 0, scale = 1;
  const resize = () => {
    const box = host.getBoundingClientRect();
    scale = Math.min(window.devicePixelRatio || 1, 2);
    w = box.width;
    h = box.height;
    canvas.width  = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    g.setTransform(scale, 0, 0, scale, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  // Bigger screens get bigger bursts, so it reads from the back row.
  const size    = Math.max(0.7, Math.min(1.6, Math.min(w, h) / 700));
  const palette = [...colors, ...COLORS];

  const flying = [];   // rockets on their way up
  const sparks = [];
  const bits   = [];   // konfetti

  function launch() {
    flying.push({
      x:  rand(w * 0.15, w * 0.85),
      y:  h + 10,
      vx: rand(-1.2, 1.2),
      vy: -rand(10.5, 13.5) * Math.sqrt(h / 800),
      color: pick(palette),
      trail: []
    });
    onRocket('launch');
  }

  function explode(r) {
    const count = Math.round(rand(60, 90));
    const ring  = Math.random() < 0.35;          // some bursts are neat rings
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rand(-0.05, 0.05);
      const speed = (ring ? 5 : rand(1.5, 6.5)) * size;
      sparks.push({
        x: r.x, y: r.y, px: r.x, py: r.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        fade: rand(0.008, 0.014),
        color: Math.random() < 0.2 ? '#fff' : r.color
      });
    }
    onRocket('bang');
  }

  /** Two confetti cannons, one in each bottom corner, aimed at the middle. */
  function cannons() {
    [[0, 1], [w, -1]].forEach(([x, dir]) => {
      for (let i = 0; i < 120; i++) {
        const angle = rand(-1.35, -0.75);              // upwards, into the room
        const speed = rand(14, 27) * Math.sqrt(h / 800);
        bits.push({
          x, y: h,
          vx: Math.cos(angle) * speed * dir,
          vy: Math.sin(angle) * speed,
          rot: rand(0, Math.PI * 2),
          spin: rand(-0.3, 0.3),
          wobble: rand(0, Math.PI * 2),
          w: rand(6, 11) * size,
          h: rand(10, 17) * size,
          color: pick(palette)
        });
      }
    });
  }

  // Timeline: confetti straight away, rockets spread over the next seconds.
  const timers = [setTimeout(cannons, 60)];
  for (let i = 0; i < rockets; i++) {
    timers.push(setTimeout(launch, 250 + i * 520 + rand(0, 260)));
  }
  timers.push(setTimeout(cannons, 250 + rockets * 520));
  const lastLaunch = 600 + rockets * 520;
  const born = performance.now();

  let raf  = null;
  let last = performance.now();

  function frame(now) {
    const dt = Math.min(3, (now - last) / (1000 / 60));
    last = now;
    g.clearRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';

    for (let i = flying.length - 1; i >= 0; i--) {
      const r = flying[i];
      r.trail.push([r.x, r.y]);
      if (r.trail.length > 10) r.trail.shift();
      r.x  += r.vx * dt;
      r.y  += r.vy * dt;
      r.vy += GRAVITY * dt;
      g.strokeStyle = r.color;
      g.lineWidth   = 2.5 * size;
      g.beginPath();
      r.trail.forEach(([x, y], j) => (j ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.lineTo(r.x, r.y);
      g.stroke();
      if (r.vy >= -1.5) { explode(r); flying.splice(i, 1); }
    }

    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.px = s.x; s.py = s.y;
      s.vx *= 0.985 ** dt;
      s.vy  = s.vy * 0.985 ** dt + GRAVITY * 0.4 * dt;
      s.x  += s.vx * dt;
      s.y  += s.vy * dt;
      s.life -= s.fade * dt;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      g.globalAlpha = Math.min(1, s.life * 1.4);
      g.strokeStyle = s.color;
      g.lineWidth   = 2.2 * size;
      g.beginPath();
      g.moveTo(s.px - s.vx, s.py - s.vy);
      g.lineTo(s.x, s.y);
      g.stroke();
    }

    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      b.vx *= 0.975 ** dt;
      b.vy  = Math.min(b.vy * 0.975 ** dt + GRAVITY * 1.1 * dt, 3.2 * size);
      b.wobble += 0.08 * dt;
      b.x   += (b.vx + Math.sin(b.wobble) * 0.8) * dt;
      b.y   += b.vy * dt;
      b.rot += b.spin * dt;
      if (b.y > h + 30) { bits.splice(i, 1); continue; }
      g.save();
      g.translate(b.x, b.y);
      g.rotate(b.rot);
      g.scale(1, Math.cos(b.wobble * 1.7));   // the flutter of paper turning over
      g.fillStyle = b.color;
      g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      g.restore();
    }

    const quiet = flying.length === 0 && sparks.length === 0 && bits.length === 0;
    if (quiet && now - born > lastLaunch) { stop(); return; }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  function stop() {
    timers.forEach(clearTimeout);
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
    window.removeEventListener('resize', resize);
    canvas.remove();
  }
  return stop;
}
