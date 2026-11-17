// Bootstrap: canvas sizing, input, the state machine, the fixed-step loop, and the deterministic
// ?shot= modes used for automated screenshots.

import { createRng } from './rng.js';
import { unlock, sfx } from './audio.js';
import { World, W, H } from './entities.js';
import { render } from './render.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d', { alpha: false });

const params = new URLSearchParams(location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isFinite(seedParam) ? seedParam : (shot ? 1 : (Date.now() & 0x7fffffff));

const rng = createRng(seed);
const world = new World(rng, sfx);


let state = 'title';          // 'title' | 'playing' | 'over'
let renderScale = 1;
let bestCombo = 1;
let overAt = 0;

const ui = { scale: 1, best: null, bestCombo: 1 };

// ------------------------------------------------------------------ sizing

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const fit = Math.min(window.innerWidth / W, window.innerHeight / H);
  const cssW = Math.max(240, Math.floor(W * fit));
  const cssH = Math.max(150, Math.floor(H * fit));
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  // Backing store matches the displayed pixels exactly, so lines stay crisp at any window size.
  renderScale = canvas.width / W;
  ui.scale = renderScale;
  ctx.imageSmoothingEnabled = true;
}

window.addEventListener('resize', () => {
  resize();
  if (shot) drawFrame();   // shot frames are static: redraw the same state at the new size
});

// ----------------------------------------------------------------- storage

const BEST_KEY = 'volt.best';

function loadBest() {
  if (shot) return null;
  try {
    const v = Number.parseInt(localStorage.getItem(BEST_KEY) ?? '', 10);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return null;
  }
}

function saveBest(score) {
  try {
    localStorage.setItem(BEST_KEY, String(score));
  } catch {
    /* private mode: the run just does not persist */
  }
}

// ------------------------------------------------------------------- input

const keys = new Set();
const input = { dx: 0, dy: 0, aimX: W / 2, aimY: H / 2 - 120, fire: false };

function toWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * W,
    y: ((clientY - rect.top) / rect.height) * H,
  };
}

function readKeys() {
  const left = keys.has('a') || keys.has('arrowleft');
  const right = keys.has('d') || keys.has('arrowright');
  const up = keys.has('w') || keys.has('arrowup');
  const down = keys.has('s') || keys.has('arrowdown');
  input.dx = (right ? 1 : 0) - (left ? 1 : 0);
  input.dy = (down ? 1 : 0) - (up ? 1 : 0);
}

function beginPlay() {
  world.reset();
  bestCombo = 1;
  state = 'playing';
  sfx.start();
}

function activate() {
  unlock();
  if (state === 'title') beginPlay();
  else if (state === 'over' && performance.now() - overAt > 500) beginPlay();
}

if (!shot) {
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'spacebar'].includes(k)) e.preventDefault();
    keys.add(k === ' ' || k === 'spacebar' ? ' ' : k);
    unlock();
    if (k === ' ' && state !== 'playing') activate();
    if (k === 'r' && state === 'over') activate();
  });

  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    keys.delete(k === ' ' || k === 'spacebar' ? ' ' : k);
  });

  window.addEventListener('blur', () => {
    keys.clear();
    input.fire = false;
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = toWorld(e.clientX, e.clientY);
    input.aimX = p.x;
    input.aimY = p.y;
  });

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    const p = toWorld(e.clientX, e.clientY);
    input.aimX = p.x;
    input.aimY = p.y;
    input.fire = true;
    activate();
  });

  const release = () => { input.fire = false; };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('contextmenu', (e) => e.preventDefault());
}

// -------------------------------------------------------------------- loop

function step(dt) {
  if (state === 'playing') {
    readKeys();
    world.update(dt, input);
    if (world.combo > bestCombo) bestCombo = world.combo;
    if (world.gameOver) {
      state = 'over';
      overAt = performance.now();
      ui.bestCombo = bestCombo;
      const best = loadBest();
      if (best !== null) {
        ui.best = Math.max(best, world.score);
        if (world.score > best) saveBest(world.score);
      }
    }
  } else if (state === 'title') {
    world.idle(dt);
  } else {
    // Game over: no gameplay runs, but the wreckage keeps burning.
    world.update(dt, { dx: 0, dy: 0, aimX: world.player.x + 1, aimY: world.player.y, fire: false });
  }
}

function drawFrame() {
  ui.bestCombo = Math.max(bestCombo, world.combo);
  render(ctx, world, state, ui);
}

const FIXED = 1 / 120;
let accumulator = 0;
let last = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000 || 0);
  last = now;
  accumulator += dt;
  let guard = 0;
  while (accumulator >= FIXED && guard++ < 16) {
    accumulator -= FIXED;
    step(FIXED);
  }
  drawFrame();
  requestAnimationFrame(frame);
}

// ----------------------------------------------------- deterministic shots
// Each mode advances the simulation with a scripted pilot and then renders exactly one frame.
// No animation loop is started, so the captured image is stable and reproducible from the seed.

/** A competent autopilot: orbits the arena and leads the nearest live target. */
function autopilot(t) {
  const p = world.player;
  const tx = W / 2 + Math.cos(t * 0.52) * 230;
  const ty = H / 2 + Math.sin(t * 0.81) * 125;
  let dx = tx - p.x;
  let dy = ty - p.y;
  const d = Math.hypot(dx, dy) || 1;

  let target = null;
  let bestD = Infinity;
  let fleeX = 0;
  let fleeY = 0;
  for (const e of world.enemies) {
    const dd = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    // Shove away from anything uncomfortably close, strength falling off with distance.
    if (dd < 165 * 165) {
      const dist = Math.sqrt(dd) || 1;
      const push = 1 - dist / 165;
      fleeX += ((p.x - e.x) / dist) * push * 2.4;
      fleeY += ((p.y - e.y) / dist) * push * 2.4;
    }
    if (e.spawning > 0) continue;
    if (dd < bestD) { bestD = dd; target = e; }
  }
  dx = dx / d + fleeX;
  dy = dy / d + fleeY;
  const steer = Math.hypot(dx, dy) || 1;

  let aimX = p.x + Math.cos(t) * 100;
  let aimY = p.y + Math.sin(t) * 100;
  if (target) {
    const travel = Math.sqrt(bestD) / 660;
    aimX = target.x + Math.cos(target.heading) * target.speed * travel;
    aimY = target.y + Math.sin(target.heading) * target.speed * travel;
  }

  input.dx = dx / steer;
  input.dy = dy / steer;
  // Deliberately imperfect: a wobbling aim and a trigger that pauses now and then, so hostiles
  // build up on screen the way they do in a real run instead of being picked off at the edges.
  input.aimX = aimX + Math.cos(t * 3.1) * 26;
  input.aimY = aimY + Math.sin(t * 2.3) * 26;
  input.fire = Math.sin(t * 1.7) > -0.3;
}

const DT = 1 / 120;

/**
 * Rates how good the current frame would look as a mid-game screenshot: hostiles actually inside
 * the arena, some of them near the ship, debris in the air, bullets in flight, a live multiplier.
 */
function framingScore() {
  if (world.gameOver || world.waveBanner > 0 || world.wave < 3) return -1;
  let framed = 0;
  let near = 0;
  for (const e of world.enemies) {
    if (e.x > 40 && e.x < W - 40 && e.y > 40 && e.y < H - 40) framed++;
    if ((e.x - world.player.x) ** 2 + (e.y - world.player.y) ** 2 < 340 * 340) near++;
  }
  return Math.min(framed, 8) * 9 +
    Math.min(near, 4) * 7 +
    Math.min(world.particles.length, 170) * 0.22 +
    Math.min(world.bullets.length, 8) * 3 +
    Math.min(world.combo, 8) * 2.5 +
    Math.min(world.floaters.length, 3) * 4 +
    (world.muzzle > 0.02 ? 7 : 0);
}

function rewind() {
  world.rng = createRng(seed);
  world.reset();
  bestCombo = 1;
}

/** Runs `steps` simulation ticks starting at absolute tick `from`, keeping the autopilot alive. */
function advance(steps, from = 0, onStep = null) {
  for (let i = 0; i < steps; i++) {
    const k = from + i;
    autopilot(k * DT);
    world.update(DT, input);
    // The shot pilot is not allowed to die during the run-up; these frames are set dressing.
    if (world.gameOver) {
      world.gameOver = false;
      world.lives = 2;
      world.player.invuln = 1.2;
    }
    if (world.combo > bestCombo) bestCombo = world.combo;
    if (onStep) onStep(k);
  }
  return from + steps;
}

function runShot(mode) {
  if (mode === 'start') {
    state = 'title';
    drawFrame();
    return;
  }

  if (mode === 'play') {
    state = 'playing';
    // Two passes over the same seeded run: the first scores every candidate frame, the second
    // replays from scratch and stops on the best one. Same seed in, same picture out.
    const warmup = Math.round(13 / DT);
    const total = Math.round(52 / DT);
    let bestAt = total - 1;
    let bestRating = -Infinity;
    advance(total, 0, (k) => {
      if (k < warmup) return;
      const rating = framingScore();
      if (rating > bestRating) {
        bestRating = rating;
        bestAt = k;
      }
    });
    rewind();
    advance(bestAt + 1);
    drawFrame();
    return;
  }

  // mode === 'end': play a believable run, then let the last life go.
  state = 'playing';
  advance(Math.round(24 / DT));
  world.lives = 1;
  world.hurtPlayer();
  // Hold just long enough for the death bloom to open and the overlay to finish fading in.
  for (let i = 0; i < 56; i++) world.update(DT, input);
  state = 'over';
  ui.bestCombo = bestCombo;
  ui.best = null;
  drawFrame();
}

// ------------------------------------------------------------------- start

resize();
ui.best = loadBest();

if (shot === 'start' || shot === 'play' || shot === 'end') {
  runShot(shot);
} else {
  state = 'title';
  requestAnimationFrame((now) => { last = now; requestAnimationFrame(frame); });
}
