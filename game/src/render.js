// All drawing. The look is additive neon: everything bright is stamped twice -- once wide and soft
// through shadowBlur, once tight and hot -- over a dark pulsing grid, with 'lighter' compositing so
// overlapping glows bloom into white. Nothing here mutates the world.

import { W, H } from './entities.js';

const FONT = '"DejaVu Sans Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const TAU = Math.PI * 2;

const INK = {
  bg: '#05060c',
  grid: '#1d6fa8',
  gridHot: '#59e0ff',
  player: '#7ef9ff',
  bullet: '#fff2a8',
  text: '#dff4ff',
  dim: '#5d7f99',
  danger: '#ff5a6e',
  gold: '#ffd36a',
};

let vignette = null;

// ------------------------------------------------------------------ text kit

/**
 * Draws text with manual letter tracking (canvas letterSpacing is not everywhere yet) and an
 * optional glow pass. Returns the drawn width.
 */
export function text(ctx, str, x, y, o = {}) {
  const size = o.size || 16;
  const track = o.track === undefined ? size * 0.08 : o.track;
  ctx.font = `${o.weight || 700} ${size}px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = o.baseline || 'alphabetic';

  const chars = [...str];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + track * Math.max(0, chars.length - 1);
  let cx = o.align === 'center' ? x - total / 2 : o.align === 'right' ? x - total : x;

  ctx.globalAlpha = o.alpha === undefined ? 1 : o.alpha;
  ctx.fillStyle = o.color || INK.text;
  if (o.glow) {
    ctx.shadowColor = o.glowColor || o.color || INK.text;
    ctx.shadowBlur = o.glow;
  }
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], cx, y);
    cx += widths[i] + track;
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  return total;
}

// ------------------------------------------------------------- VOLT wordmark
// Hand-built angular letterforms so the logo looks designed and renders identically everywhere,
// with no dependency on which fonts the machine happens to have.

const GLYPHS = {
  V: [[[0, 0], [0.5, 1], [1, 0]]],
  O: [[[0, 0.2], [0.2, 0], [0.8, 0], [1, 0.2], [1, 0.8], [0.8, 1], [0.2, 1], [0, 0.8], [0, 0.2]]],
  L: [[[0, 0], [0, 1], [0.92, 1]]],
  T: [[[0, 0], [1, 0]], [[0.5, 0], [0.5, 1]]],
};

function strokeGlyph(ctx, glyph, x, y, w, h, width) {
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const path of glyph) {
    ctx.beginPath();
    for (let i = 0; i < path.length; i++) {
      const px = x + path[i][0] * w;
      const py = y + path[i][1] * h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

/** Draws VOLT centred on cx, with a sheen that sweeps across on `phase` in [0, 1). */
export function wordmark(ctx, cx, cy, height, phase) {
  const letters = ['V', 'O', 'L', 'T'];
  const w = height * 0.66;
  const gap = height * 0.3;
  const total = letters.length * w + (letters.length - 1) * gap;
  const left = cx - total / 2;
  const top = cy - height / 2;
  const lw = Math.max(3, height * 0.1);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // Soft outer halo, then the hot core.
  const passes = [
    { color: '#1d4fff', blur: 60, width: lw * 1.9, alpha: 0.5 },
    { color: '#35d6ff', blur: 34, width: lw * 1.15, alpha: 0.9 },
    { color: '#eaffff', blur: 10, width: lw * 0.42, alpha: 1 },
  ];
  for (const pass of passes) {
    ctx.strokeStyle = pass.color;
    ctx.shadowColor = pass.color;
    ctx.shadowBlur = pass.blur;
    ctx.globalAlpha = pass.alpha;
    letters.forEach((ch, i) => {
      strokeGlyph(ctx, GLYPHS[ch], left + i * (w + gap), top, w, height, pass.width);
    });
  }
  ctx.shadowBlur = 0;

  // A narrow bright band travelling left to right over the glyphs.
  const sx = left - height + phase * (total + height * 2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, top - 20, height * 0.42, height + 40);
  ctx.clip();
  ctx.strokeStyle = '#ffffff';
  ctx.globalAlpha = 0.85;
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 24;
  letters.forEach((ch, i) => {
    strokeGlyph(ctx, GLYPHS[ch], left + i * (w + gap), top, w, height, lw * 0.5);
  });
  ctx.restore();
  ctx.restore();
}

// -------------------------------------------------------------- background

function drawBackground(ctx, world, intensity) {
  ctx.fillStyle = INK.bg;
  ctx.fillRect(0, 0, W, H);

  const t = world.time;
  const px = world.player.x;
  const py = world.player.y;
  const step = 40;
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.4);

  ctx.save();
  ctx.lineWidth = 1;
  ctx.globalCompositeOperation = 'lighter';

  for (let x = 0; x <= W; x += step) {
    // Lines brighten near the ship, so the grid feels charged by the player.
    const near = Math.exp(-((x - px) ** 2) / (2 * 150 * 150));
    const a = (0.05 + 0.03 * pulse + 0.3 * near) * intensity;
    ctx.strokeStyle = near > 0.35 ? INK.gridHot : INK.grid;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += step) {
    const near = Math.exp(-((y - py) ** 2) / (2 * 150 * 150));
    const a = (0.05 + 0.03 * pulse + 0.3 * near) * intensity;
    ctx.strokeStyle = near > 0.35 ? INK.gridHot : INK.grid;
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
    ctx.stroke();
  }

  // Expanding ripple rings tied to the beat of the wave timer.
  const ripple = (t * 0.45) % 1;
  ctx.globalAlpha = 0.12 * (1 - ripple) * intensity;
  ctx.strokeStyle = INK.gridHot;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, 30 + ripple * 420, 0, TAU);
  ctx.stroke();
  ctx.restore();

  // Arena border.
  ctx.save();
  ctx.globalAlpha = 0.5 * intensity;
  ctx.strokeStyle = '#2a7fc0';
  ctx.shadowColor = '#2a7fc0';
  ctx.shadowBlur = 18;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  // Corner brackets: a bit of instrument-panel framing around the arena.
  ctx.globalAlpha = 0.9 * intensity;
  ctx.strokeStyle = INK.gridHot;
  ctx.shadowColor = INK.gridHot;
  ctx.lineWidth = 3;
  const b = 26;
  for (const [cx, sx] of [[6, 1], [W - 6, -1]]) {
    for (const [cy, sy] of [[6, 1], [H - 6, -1]]) {
      ctx.beginPath();
      ctx.moveTo(cx + sx * b, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + sy * b);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawVignette(ctx) {
  if (!vignette) {
    vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.95);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.75)');
  }
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
}

function drawAmbient(ctx, world) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const a of world.ambient) {
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = a.type.color;
    ctx.shadowColor = a.type.color;
    ctx.shadowBlur = 16;
    ctx.lineWidth = 2;
    shapePath(ctx, a.type.shape, a.x, a.y, a.radius, a.angle);
    ctx.stroke();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ shapes

function shapePath(ctx, shape, x, y, r, angle) {
  ctx.beginPath();
  if (shape === 'square') {
    const pts = 4;
    for (let i = 0; i < pts; i++) {
      const a = angle + (i / pts) * TAU + Math.PI / 4;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
  } else if (shape === 'diamond') {
    for (let i = 0; i < 4; i++) {
      const a = angle + (i / 4) * TAU;
      const rr = i % 2 === 0 ? r * 1.25 : r * 0.78;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
  } else {
    for (let i = 0; i < 3; i++) {
      const a = angle + (i / 3) * TAU - Math.PI / 2;
      const px = x + Math.cos(a) * r * 1.15;
      const py = y + Math.sin(a) * r * 1.15;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
}

function drawEnemies(ctx, world) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const e of world.enemies) {
    const spawning = e.spawning > 0;
    const grow = spawning ? 1 - e.spawning / 0.45 : 1;
    const r = e.radius * (0.3 + 0.7 * grow) * (1 + e.flash * 0.22);
    const alpha = spawning ? 0.35 + 0.65 * grow : 1;
    const color = e.flash > 0.4 ? '#ffffff' : e.type.color;

    ctx.globalAlpha = alpha;
    // Damage shows as a brighter interior fill draining away.
    ctx.fillStyle = e.type.color;
    ctx.globalAlpha = alpha * (0.1 + 0.2 * (e.hp / e.maxHp) + e.flash * 0.5);
    shapePath(ctx, e.type.shape, e.x, e.y, r, e.angle);
    ctx.fill();

    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.shadowColor = e.type.color;
    ctx.shadowBlur = 20 + e.flash * 24;
    ctx.lineWidth = 2.4;
    shapePath(ctx, e.type.shape, e.x, e.y, r, e.angle);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.globalAlpha = alpha * 0.9;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.9;
    shapePath(ctx, e.type.shape, e.x, e.y, r * 0.55, -e.angle * 0.7);
    ctx.stroke();

    if (spawning) {
      // Telegraph ring so nothing ever materialises straight on top of you unannounced.
      ctx.globalAlpha = (1 - grow) * 0.9;
      ctx.strokeStyle = e.type.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius + 30 * (1 - grow), 0, TAU);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawBullets(ctx, world) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const b of world.bullets) {
    const tx = b.x - b.vx * 0.016;
    const ty = b.y - b.vy * 0.016;
    ctx.strokeStyle = '#ffb33c';
    ctx.shadowColor = '#ff8a1e';
    ctx.shadowBlur = 18;
    ctx.lineWidth = 5.5;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.strokeStyle = '#fffbe6';
    ctx.shadowBlur = 8;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawParticles(ctx, world) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const q of world.particles) {
    const k = Math.max(0, q.life / q.maxLife);
    ctx.globalAlpha = k;
    if (q.kind === 'streak') {
      ctx.strokeStyle = q.color;
      ctx.shadowColor = q.color;
      ctx.shadowBlur = 10;
      ctx.lineWidth = q.size;
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(q.x - q.vx * 0.03, q.y - q.vy * 0.03);
      ctx.stroke();
    } else {
      ctx.fillStyle = q.color;
      ctx.shadowColor = q.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.size * (0.4 + k * 0.6), 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawRings(ctx, world) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const r of world.rings) {
    const k = Math.max(0, r.life / r.maxLife);
    ctx.globalAlpha = k * 0.8;
    ctx.strokeStyle = r.color;
    ctx.shadowColor = r.color;
    ctx.shadowBlur = 20;
    ctx.lineWidth = r.width * k;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFloaters(ctx, world) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const f of world.floaters) {
    const k = Math.max(0, f.life / f.maxLife);
    text(ctx, f.text, f.x, f.y, {
      size: f.size, align: 'center', color: f.color, glow: 12, alpha: k * 0.95, weight: 700,
    });
  }
  ctx.restore();
}

function drawPlayer(ctx, world, state) {
  const p = world.player;
  if (world.gameOver || state === 'title') return;
  // Blink while the respawn shield is up, but stay solid for the last half second.
  const blinking = p.invuln > 0.5 && Math.floor(world.time * 18) % 2 === 0;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  const recoil = -p.recoil * 3;
  ctx.translate(recoil, 0);

  if (!blinking) {
    // Engine flame, length driven by throttle.
    const flame = 10 + p.thrust * 16;
    ctx.globalAlpha = 0.55 + p.thrust * 0.4;
    const grad = ctx.createLinearGradient(-p.radius, 0, -p.radius - flame, 0);
    grad.addColorStop(0, 'rgba(120,240,255,0.95)');
    grad.addColorStop(1, 'rgba(20,80,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-p.radius * 0.7, -5);
    ctx.lineTo(-p.radius - flame, 0);
    ctx.lineTo(-p.radius * 0.7, 5);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 1;
    const body = [[p.radius * 1.5, 0], [-p.radius * 0.9, -p.radius * 0.92], [-p.radius * 0.45, 0], [-p.radius * 0.9, p.radius * 0.92]];
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(body[0][0], body[0][1]);
      for (let i = 1; i < body.length; i++) ctx.lineTo(body[i][0], body[i][1]);
      ctx.closePath();
    };

    ctx.fillStyle = 'rgba(40,180,255,0.22)';
    trace();
    ctx.fill();

    ctx.strokeStyle = INK.player;
    ctx.shadowColor = '#2fd0ff';
    ctx.shadowBlur = 24;
    ctx.lineWidth = 2.6;
    trace();
    ctx.stroke();

    ctx.strokeStyle = '#ffffff';
    ctx.shadowBlur = 8;
    ctx.lineWidth = 1;
    trace();
    ctx.stroke();

    // Muzzle flash at the nose.
    if (world.muzzle > 0) {
      const m = world.muzzle / 0.07;
      ctx.globalAlpha = m;
      ctx.fillStyle = '#fff6cf';
      ctx.shadowColor = '#ffcf5a';
      ctx.shadowBlur = 30;
      ctx.beginPath();
      ctx.ellipse(p.radius * 1.9, 0, 16 * m, 6 * m, 0, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();

  if (p.invuln > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.25 + 0.25 * Math.sin(world.time * 14);
    ctx.strokeStyle = '#8bf3ff';
    ctx.shadowColor = '#8bf3ff';
    ctx.shadowBlur = 20;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius + 12, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
}

// ---------------------------------------------------------------------- HUD

function shipIcon(ctx, x, y, s, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(-Math.PI / 2);
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(s * 1.4, 0);
  ctx.lineTo(-s * 0.9, -s * 0.9);
  ctx.lineTo(-s * 0.45, 0);
  ctx.lineTo(-s * 0.9, s * 0.9);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawHud(ctx, world) {
  ctx.save();

  text(ctx, 'SCORE', 26, 32, { size: 11, color: INK.dim, track: 3 });
  text(ctx, String(world.score).padStart(6, '0'), 26, 62, {
    size: 30, color: '#ffffff', glow: 16, glowColor: '#45c8ff', track: 2,
  });

  // Combo: colour and size climb with the multiplier, with a pop on each step up.
  if (world.combo > 1) {
    const pop = 1 + world.comboPop * 0.45;
    const hot = Math.min(1, (world.combo - 1) / 8);
    const color = `rgb(255, ${Math.round(220 - hot * 110)}, ${Math.round(110 - hot * 90)})`;
    const label = `x${world.combo}`;
    text(ctx, label, 200, 60, { size: 28 * pop, color, glow: 20, glowColor: color, track: 1 });
    const bar = Math.max(0, Math.min(1, world.comboTimer / world.comboMax));
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fillRect(200, 68, 64 * bar, 3);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.18;
    ctx.fillRect(200, 68, 64, 3);
    ctx.globalAlpha = 1;
  }

  text(ctx, 'WAVE', W / 2, 32, { size: 11, color: INK.dim, track: 3, align: 'center' });
  text(ctx, String(Math.max(1, world.wave)).padStart(2, '0'), W / 2, 62, {
    size: 30, color: '#9fe8ff', glow: 16, glowColor: '#35b7ff', align: 'center', track: 2,
  });

  text(ctx, 'LIVES', W - 26, 32, { size: 11, color: INK.dim, track: 3, align: 'right' });
  for (let i = 0; i < 3; i++) {
    const alive = i < world.lives;
    shipIcon(ctx, W - 36 - i * 32, 52, 9, alive ? INK.player : '#30506a', alive ? 1 : 0.5);
  }

  // Remaining-in-wave ticker, so pressure is legible.
  const left = world.enemies.length + world.toSpawn;
  if (!world.gameOver && left > 0) {
    text(ctx, `${left} HOSTILE${left === 1 ? '' : 'S'}`, W / 2, 84, {
      size: 11, color: INK.dim, track: 3, align: 'center',
    });
  }
  ctx.restore();
}

function drawWaveBanner(ctx, world) {
  if (world.waveBanner <= 0 || world.gameOver) return;
  const t = 1 - world.waveBanner / 2.0;
  // Snap in, hold, fade out.
  const appear = Math.min(1, t / 0.12);
  const fade = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
  const alpha = Math.max(0, appear * fade);
  const scale = 1 + (1 - appear) * 0.5;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(W / 2, H / 2 - 40);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha * 0.35;
  ctx.fillStyle = '#0a2740';
  ctx.fillRect(-250, -44, 500, 88);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#35d6ff';
  ctx.shadowColor = '#35d6ff';
  ctx.shadowBlur = 20;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-250, -44); ctx.lineTo(250, -44);
  ctx.moveTo(-250, 44); ctx.lineTo(250, 44);
  ctx.stroke();
  ctx.shadowBlur = 0;
  text(ctx, `WAVE ${world.wave}`, 0, 14, {
    size: 50, align: 'center', color: '#ffffff', glow: 26, glowColor: '#35d6ff', track: 8, alpha,
  });
  ctx.restore();
}

// ------------------------------------------------------------------ screens

function drawTitle(ctx, world, ui) {
  const t = world.time;
  ctx.save();
  ctx.fillStyle = 'rgba(5,6,12,0.55)';
  ctx.fillRect(0, 0, W, H);

  wordmark(ctx, W / 2, 176, 126, (t * 0.22 + 0.28) % 1);

  text(ctx, 'NEON SURVIVAL', W / 2, 294, {
    size: 15, align: 'center', color: '#58c8ff', track: 10, glow: 14,
  });

  if (ui.best) {
    text(ctx, `PERSONAL BEST ${ui.best}`, W / 2, 326, {
      size: 12, align: 'center', color: INK.gold, track: 4, alpha: 0.85, glow: 10,
    });
  }

  const blink = 0.82 + 0.18 * Math.sin(t * 4);
  text(ctx, 'CLICK OR PRESS SPACE TO START', W / 2, 360, {
    size: 20, align: 'center', color: '#ffffff', glow: 22, glowColor: '#ffd36a', track: 4, alpha: blink,
  });

  const rows = [
    ['WASD / ARROWS', 'THRUST'],
    ['MOUSE', 'AIM'],
    ['CLICK / HOLD', 'AUTO-FIRE'],
    ['R', 'RESTART'],
  ];
  const top = 424;
  ctx.globalAlpha = 1;
  rows.forEach((row, i) => {
    const y = top + i * 26;
    text(ctx, row[0], W / 2 - 16, y, { size: 13, align: 'right', color: '#8fd6ff', track: 2 });
    text(ctx, row[1], W / 2 + 16, y, { size: 13, align: 'left', color: INK.dim, track: 2 });
  });

  text(ctx, 'SHOOT THE SHAPES. CHAIN KILLS FOR MULTIPLIERS. DO NOT GET TOUCHED.', W / 2, H - 34, {
    size: 11, align: 'center', color: '#4a6b85', track: 3,
  });
  ctx.restore();
}

function drawGameOver(ctx, world, ui) {
  const t = Math.min(1, world.deathTime / 0.45);
  ctx.save();
  ctx.fillStyle = `rgba(5,6,12,${0.6 * t})`;
  ctx.fillRect(0, 0, W, H);

  text(ctx, 'GAME OVER', W / 2, 206, {
    size: 68, align: 'center', color: '#ffffff', glow: 34, glowColor: INK.danger, track: 12, alpha: t,
  });
  text(ctx, 'SIGNAL LOST', W / 2, 240, {
    size: 13, align: 'center', color: INK.danger, track: 9, alpha: t,
  });

  text(ctx, 'FINAL SCORE', W / 2, 310, { size: 12, align: 'center', color: INK.dim, track: 5, alpha: t });
  text(ctx, String(world.score), W / 2, 364, {
    size: 54, align: 'center', color: INK.gold, glow: 28, glowColor: '#ff9c2a', track: 4, alpha: t,
  });

  const stats = `WAVE ${Math.max(1, world.wave)}    BEST x${ui.bestCombo}`;
  text(ctx, stats, W / 2, 404, { size: 14, align: 'center', color: '#8fd6ff', track: 4, alpha: t });

  if (ui.best !== null && ui.best !== undefined) {
    const isNew = world.score >= ui.best && world.score > 0;
    text(ctx, isNew ? 'NEW PERSONAL BEST' : `PERSONAL BEST ${ui.best}`, W / 2, 432, {
      size: 12, align: 'center', color: isNew ? INK.gold : INK.dim, track: 4, alpha: t,
      glow: isNew ? 14 : 0,
    });
  }

  const blink = 0.72 + 0.28 * Math.sin(world.time * 4);
  text(ctx, 'PRESS R OR CLICK TO RESTART', W / 2, 496, {
    size: 18, align: 'center', color: '#ffffff', glow: 16, glowColor: '#35d6ff', track: 4, alpha: t * blink,
  });
  ctx.restore();
}

// ------------------------------------------------------------- entry point

/**
 * Draws one complete frame. `state` is 'title' | 'playing' | 'over'.
 * `ui` carries presentation-only extras (personal best, best combo reached).
 */
export function render(ctx, world, state, ui = {}) {
  ctx.setTransform(ui.scale || 1, 0, 0, ui.scale || 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  const shaking = state === 'playing' || state === 'over';
  ctx.save();
  if (shaking) ctx.translate(world.shakeX, world.shakeY);

  drawBackground(ctx, world, state === 'playing' ? 1 : 0.65);
  if (state !== 'playing') drawAmbient(ctx, world);

  drawRings(ctx, world);
  drawEnemies(ctx, world);
  drawBullets(ctx, world);
  drawParticles(ctx, world);
  drawPlayer(ctx, world, state);
  drawFloaters(ctx, world);
  ctx.restore();

  drawVignette(ctx);

  if (world.flash > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,90,110,${0.3 * world.flash})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  if (state === 'playing' || state === 'over') {
    drawHud(ctx, world);
    drawWaveBanner(ctx, world);
  }
  if (state === 'title') drawTitle(ctx, world, ui);
  if (state === 'over') drawGameOver(ctx, world, ui);

  // Scanlines last: a faint CRT weave that ties the whole frame together.
  ctx.save();
  ctx.globalAlpha = 0.045;
  ctx.fillStyle = '#9fe8ff';
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  ctx.restore();
}
