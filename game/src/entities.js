// Simulation: the player ship, the shapes hunting it, bullets, particles and the wave schedule.
// Nothing in here touches the canvas -- render.js reads this state and draws it. Every random
// number comes from the injected rng, so a seeded World replays identically.

export const W = 960;
export const H = 600;

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const angleLerp = (from, to, maxStep) => {
  let d = ((to - from + Math.PI * 3) % TAU) - Math.PI;
  if (d > maxStep) d = maxStep;
  else if (d < -maxStep) d = -maxStep;
  return from + d;
};

export const ENEMY_TYPES = {
  // Steady cannon fodder: turns slowly, easy to lead.
  drone: { shape: 'square', color: '#3fe3ff', hp: 1, speed: 64, radius: 13, score: 100, turn: 1.7, spin: 1.1 },
  // Fast and weaves, so it is hard to hit but dies to one bullet.
  shard: { shape: 'diamond', color: '#ff4fa8', hp: 1, speed: 104, radius: 11, score: 160, turn: 3.0, spin: 2.6 },
  // Slow, tanky, worth the most. Shows damage by flashing.
  bulwark: { shape: 'triangle', color: '#ffc43f', hp: 3, speed: 48, radius: 20, score: 280, turn: 1.1, spin: 0.7 },
};

const PLAYER = {
  radius: 13,
  accel: 2500,
  damping: 6.2,
  fireDelay: 0.105,
  bulletSpeed: 660,
  invulnAfterHit: 2.2,
};

export class World {
  constructor(rng, sfx) {
    this.rng = rng;
    this.sfx = sfx;
    this.reset();
  }

  reset() {
    this.player = {
      x: W / 2, y: H / 2 + 60, vx: 0, vy: 0,
      angle: -Math.PI / 2, radius: PLAYER.radius,
      cooldown: 0, invuln: 0, thrust: 0, recoil: 0,
    };
    this.bullets = [];
    this.enemies = [];
    this.particles = [];
    this.rings = [];
    this.floaters = [];

    this.score = 0;
    this.lives = 3;
    this.wave = 0;
    this.comboHits = 0;
    this.combo = 1;
    this.comboTimer = 0;
    this.comboMax = comboWindow(1);
    this.comboPop = 0;

    this.time = 0;
    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.flash = 0;
    this.muzzle = 0;
    this.hitStop = 0;

    this.decay = 0;
    this.toSpawn = 0;
    this.spawnTimer = 0;
    this.spawnInterval = 0.6;
    this.intermission = 0.9;
    this.waveBanner = 0;
    this.gameOver = false;
    this.deathTime = 0;

    // Slow drifting shapes used as living wallpaper on the title and game-over screens.
    this.ambient = [];
    const shapes = Object.keys(ENEMY_TYPES);
    for (let i = 0; i < 16; i++) {
      this.ambient.push({
        x: this.rng.range(0, W),
        y: this.rng.range(0, H),
        vx: this.rng.spread(16),
        vy: this.rng.spread(16),
        angle: this.rng.angle(),
        spin: this.rng.spread(0.5),
        radius: this.rng.range(8, 24),
        type: ENEMY_TYPES[shapes[i % shapes.length]],
      });
    }
  }

  // ---------------------------------------------------------------- main step

  /** input: { dx, dy, aimX, aimY, fire } with dx/dy already normalised to [-1, 1]. */
  update(dt, input) {
    this.time += dt;
    this.updateAmbient(dt);

    if (this.gameOver) {
      this.deathTime += dt;
      this.updateBullets(dt);
      this.updateEffects(dt);
      return;
    }

    // A few frames of near-freeze on a big kill makes the impact land harder.
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      dt *= 0.25;
    }

    this.updatePlayer(dt, input);
    this.updateBullets(dt);
    this.updateEnemies(dt);
    this.updateSpawning(dt);
    this.resolveCollisions();
    this.updateCombo(dt);
    this.updateEffects(dt);
  }

  /** Screens-only tick: wallpaper drift and lingering debris, with no gameplay at all. */
  idle(dt) {
    this.time += dt;
    this.updateAmbient(dt);
    this.updateEffects(dt);
  }

  updateAmbient(dt) {
    for (const a of this.ambient) {
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.angle += a.spin * dt;
      if (a.x < -40) a.x = W + 40;
      else if (a.x > W + 40) a.x = -40;
      if (a.y < -40) a.y = H + 40;
      else if (a.y > H + 40) a.y = -40;
    }
  }

  updatePlayer(dt, input) {
    const p = this.player;
    const len = Math.hypot(input.dx, input.dy);
    const nx = len > 1 ? input.dx / len : input.dx;
    const ny = len > 1 ? input.dy / len : input.dy;

    p.vx += nx * PLAYER.accel * dt;
    p.vy += ny * PLAYER.accel * dt;
    const damp = Math.exp(-PLAYER.damping * dt);
    p.vx *= damp;
    p.vy *= damp;
    p.x = clamp(p.x + p.vx * dt, p.radius, W - p.radius);
    p.y = clamp(p.y + p.vy * dt, p.radius, H - p.radius);
    if (p.x <= p.radius || p.x >= W - p.radius) p.vx *= -0.3;
    if (p.y <= p.radius || p.y >= H - p.radius) p.vy *= -0.3;

    p.angle = Math.atan2(input.aimY - p.y, input.aimX - p.x);
    p.thrust = Math.min(1, len);
    p.recoil = Math.max(0, p.recoil - dt * 9);
    if (p.invuln > 0) p.invuln -= dt;

    // Engine wash, trailing behind the ship whenever it is moving.
    if (len > 0.1 && this.rng.chance(Math.min(1, len) * 0.8)) {
      const back = p.angle + Math.PI;
      const sp = this.rng.range(30, 90);
      const dir = Math.atan2(-p.vy, -p.vx) + this.rng.spread(0.5);
      this.particles.push({
        x: p.x + Math.cos(back) * 10, y: p.y + Math.sin(back) * 10,
        vx: Math.cos(dir) * sp, vy: Math.sin(dir) * sp,
        life: 0.3, maxLife: 0.3, size: this.rng.range(1.2, 2.6),
        color: this.rng.chance(0.3) ? '#ffffff' : '#36d9ff', kind: 'dot', drag: 2.4,
      });
    }

    p.cooldown -= dt;
    if (input.fire && p.cooldown <= 0) this.fire();
  }

  fire() {
    const p = this.player;
    p.cooldown = PLAYER.fireDelay;
    const spread = this.rng.spread(0.03);
    const a = p.angle + spread;
    const muzzleX = p.x + Math.cos(a) * (p.radius + 8);
    const muzzleY = p.y + Math.sin(a) * (p.radius + 8);
    this.bullets.push({
      x: muzzleX, y: muzzleY,
      px: muzzleX, py: muzzleY,
      vx: Math.cos(a) * PLAYER.bulletSpeed + p.vx * 0.35,
      vy: Math.sin(a) * PLAYER.bulletSpeed + p.vy * 0.35,
      life: 1.15, radius: 4,
    });
    p.vx -= Math.cos(a) * 42;
    p.vy -= Math.sin(a) * 42;
    p.recoil = 1;
    this.muzzle = 0.07;
    this.shake = Math.min(this.shake + 0.5, 22);

    for (let i = 0; i < 2; i++) {
      const sp = this.rng.range(60, 200);
      const d = a + this.rng.spread(0.55);
      this.particles.push({
        x: muzzleX, y: muzzleY,
        vx: Math.cos(d) * sp, vy: Math.sin(d) * sp,
        life: 0.12, maxLife: 0.12, size: this.rng.range(1, 2.4),
        color: '#cfefff', kind: 'dot', drag: 6,
      });
    }
    this.sfx.shoot();
  }

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.px = b.x;
      b.py = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H + 30) {
        this.bullets.splice(i, 1);
      }
    }
  }

  updateEnemies(dt) {
    const p = this.player;
    for (const e of this.enemies) {
      if (e.spawning > 0) {
        e.spawning -= dt;
        // Materialise in place before committing to the chase.
        e.angle += e.type.spin * dt * 3;
        continue;
      }
      const want = Math.atan2(p.y - e.y, p.x - e.x);
      const weave = e.weave === 0 ? 0 : Math.sin(this.time * 5 + e.phase) * e.weave;
      e.heading = angleLerp(e.heading, want + weave, e.type.turn * dt);
      const speed = e.speed * (e.knock > 0 ? 0.35 : 1);
      e.x += Math.cos(e.heading) * speed * dt + e.kx * dt;
      e.y += Math.sin(e.heading) * speed * dt + e.ky * dt;
      e.kx *= Math.exp(-9 * dt);
      e.ky *= Math.exp(-9 * dt);
      e.knock = Math.max(0, e.knock - dt);
      e.angle += e.type.spin * dt;
      e.flash = Math.max(0, e.flash - dt * 6);

      // They are spawned outside the arena, so only clamp once they have arrived.
      if (e.x > -60 && e.x < W + 60) e.inside = true;
      if (e.inside) {
        e.x = clamp(e.x, -30, W + 30);
        e.y = clamp(e.y, -30, H + 30);
      }
    }
  }

  // ------------------------------------------------------------------- waves

  updateSpawning(dt) {
    if (this.waveBanner > 0) this.waveBanner -= dt;

    if (this.toSpawn <= 0 && this.enemies.length === 0) {
      this.intermission -= dt;
      if (this.intermission <= 0) this.startWave();
      return;
    }
    if (this.toSpawn > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = this.spawnInterval;
        this.spawnEnemy();
        this.toSpawn--;
      }
    }
  }

  startWave() {
    this.wave++;
    const n = this.wave;
    this.toSpawn = Math.min(6 + Math.floor(n * 2.4), 34);
    this.spawnInterval = Math.max(0.16, 0.72 - n * 0.045);
    this.spawnTimer = 0;
    this.intermission = 1.5;
    this.waveBanner = 2.0;
    this.rings.push({ x: W / 2, y: H / 2, r: 10, maxR: 520, life: 0.9, maxLife: 0.9, color: '#6ad7ff', width: 3 });
    this.sfx.wave();
  }

  spawnEnemy() {
    const n = this.wave;
    const roll = this.rng.next();
    let key = 'drone';
    if (n >= 3 && roll > 0.92 - Math.min(0.22, n * 0.012)) key = 'bulwark';
    else if (n >= 2 && roll > 0.55) key = 'shard';
    const type = ENEMY_TYPES[key];

    const edge = this.rng.int(0, 3);
    const m = 46;
    let x, y;
    if (edge === 0) { x = this.rng.range(0, W); y = -m; }
    else if (edge === 1) { x = W + m; y = this.rng.range(0, H); }
    else if (edge === 2) { x = this.rng.range(0, W); y = H + m; }
    else { x = -m; y = this.rng.range(0, H); }

    const pace = 1 + (n - 1) * 0.05;
    this.enemies.push({
      x, y, type, key,
      hp: type.hp,
      maxHp: type.hp,
      radius: type.radius,
      speed: type.speed * Math.min(pace, 2.1) * this.rng.range(0.92, 1.08),
      heading: Math.atan2(this.player.y - y, this.player.x - x),
      angle: this.rng.angle(),
      weave: key === 'shard' ? 0.55 : key === 'drone' ? 0.14 : 0,
      phase: this.rng.angle(),
      flash: 0, knock: 0, kx: 0, ky: 0,
      spawning: 0.45,
      inside: false,
    });
  }

  // -------------------------------------------------------------- collisions

  resolveCollisions() {
    const p = this.player;

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];

      for (let j = this.bullets.length - 1; j >= 0; j--) {
        const b = this.bullets[j];
        const rr = e.radius + b.radius;
        if ((b.x - e.x) ** 2 + (b.y - e.y) ** 2 > rr * rr) continue;
        this.bullets.splice(j, 1);
        e.hp--;
        e.flash = 1;
        const kick = 160 / Math.sqrt(e.maxHp);
        const bl = Math.hypot(b.vx, b.vy) || 1;
        e.kx += (b.vx / bl) * kick;
        e.ky += (b.vy / bl) * kick;
        e.knock = 0.1;
        this.sparks(b.x, b.y, e.type.color, 5, 180);
        if (e.hp <= 0) {
          this.killEnemy(e, i);
          break;
        }
        this.shake = Math.min(this.shake + 0.8, 22);
        this.sfx.graze();
      }

      if (e.spawning > 0 || p.invuln > 0) continue;
      const rr = e.radius + p.radius;
      if ((p.x - e.x) ** 2 + (p.y - e.y) ** 2 <= rr * rr) this.hurtPlayer();
    }
  }

  killEnemy(e, index) {
    this.enemies.splice(index, 1);
    const points = e.type.score * this.combo;
    this.score += points;

    this.comboHits++;
    const next = comboFromHits(this.comboHits);
    if (next > this.combo) {
      this.combo = next;
      this.comboPop = 1;
      this.sfx.combo(next);
    } else {
      this.combo = next;
    }
    // The window is recomputed from the multiplier you now hold, so stepping up immediately
    // shortens the leash you are on.
    this.comboMax = comboWindow(this.combo);
    this.comboTimer = this.comboMax;

    this.explosion(e.x, e.y, e.type.color, e.radius);
    this.rings.push({
      x: e.x, y: e.y, r: e.radius * 0.6, maxR: e.radius * 7,
      life: 0.45, maxLife: 0.45, color: e.type.color, width: 2.5,
    });
    this.floaters.push({
      x: e.x, y: e.y - e.radius, life: 0.85, maxLife: 0.85,
      text: `+${points}`, color: this.combo > 1 ? '#ffe36a' : '#dff6ff',
      size: 13 + Math.min(10, this.combo),
    });
    this.shake = Math.min(this.shake + 2 + e.radius * 0.12, 26);
    this.hitStop = Math.max(this.hitStop, e.maxHp > 1 ? 0.06 : 0.02);
    this.sfx.explode(e.maxHp > 1 ? 0.7 : 1.15);
  }

  hurtPlayer() {
    const p = this.player;
    this.lives--;
    p.invuln = PLAYER.invulnAfterHit;
    this.combo = 1;
    this.comboHits = 0;
    this.comboTimer = 0;
    this.comboMax = comboWindow(1);
    this.shake = 26;
    this.flash = 1;

    // A panic shockwave: everything close by is vaporised (no score) so the player gets air.
    this.rings.push({ x: p.x, y: p.y, r: 20, maxR: 320, life: 0.7, maxLife: 0.7, color: '#ff5a6e', width: 4 });
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 < 170 * 170) {
        this.explosion(e.x, e.y, e.type.color, e.radius);
        this.enemies.splice(i, 1);
      }
    }
    this.explosion(p.x, p.y, '#ff5a6e', 26);
    this.sfx.hurt();

    if (this.lives <= 0) {
      this.lives = 0;
      this.gameOver = true;
      this.deathTime = 0;
      this.shake = 34;
      for (let i = 0; i < 4; i++) {
        this.rings.push({
          x: p.x, y: p.y, r: 8 + i * 14, maxR: 420 + i * 90,
          life: 1.1 + i * 0.16, maxLife: 1.1 + i * 0.16,
          color: i % 2 ? '#ff5a6e' : '#ffd36a', width: 3,
        });
      }
      this.explosion(p.x, p.y, '#ffd36a', 50);
      this.explosion(p.x, p.y, '#ffffff', 34);
      this.sfx.gameOver();
    }
  }

  // ------------------------------------------------------------------- juice

  sparks(x, y, color, count, speed) {
    for (let i = 0; i < count; i++) {
      const a = this.rng.angle();
      const sp = this.rng.range(speed * 0.3, speed);
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: this.rng.range(0.12, 0.3), maxLife: 0.3,
        size: this.rng.range(1, 2.2), color, kind: 'dot', drag: 4,
      });
    }
  }

  explosion(x, y, color, radius) {
    const count = Math.round(22 + radius * 1.7);
    for (let i = 0; i < count; i++) {
      const a = this.rng.angle();
      const sp = this.rng.range(60, 130 + radius * 16);
      const life = this.rng.range(0.3, 0.95);
      this.particles.push({
        x: x + Math.cos(a) * radius * 0.3, y: y + Math.sin(a) * radius * 0.3,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life, maxLife: life,
        size: this.rng.range(1.6, 3.8),
        color: this.rng.chance(0.22) ? '#ffffff' : color,
        kind: this.rng.chance(0.45) ? 'streak' : 'dot',
        drag: this.rng.range(1.3, 3.0),
      });
    }
    // A handful of slow embers that linger after the flash is gone.
    for (let i = 0; i < 9; i++) {
      const a = this.rng.angle();
      const life = this.rng.range(0.7, 1.4);
      this.particles.push({
        x, y, vx: Math.cos(a) * this.rng.range(10, 60), vy: Math.sin(a) * this.rng.range(10, 60),
        life, maxLife: life, size: this.rng.range(1, 2),
        color, kind: 'dot', drag: 0.8,
      });
    }
  }

  updateCombo(dt) {
    this.comboPop = Math.max(0, this.comboPop - dt * 3);
    if (this.comboHits === 0) return;
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      return;
    }
    // Past the window the chain unwinds one kill at a time rather than snapping to zero.
    this.decay += dt;
    while (this.decay > 0.3 && this.comboHits > 0) {
      this.decay -= 0.3;
      this.comboHits--;
    }
    this.combo = comboFromHits(this.comboHits);
    this.comboMax = comboWindow(this.combo);
  }

  updateEffects(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const q = this.particles[i];
      const d = Math.exp(-q.drag * dt);
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vx *= d;
      q.vy *= d;
      q.life -= dt;
      if (q.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const t = 1 - r.life / r.maxLife;
      r.r = r.r + (r.maxR - r.r) * Math.min(1, dt * 7 * (1 - t * 0.6));
      if (r.life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.y -= 34 * dt;
      f.life -= dt;
      if (f.life <= 0) this.floaters.splice(i, 1);
    }

    this.flash = Math.max(0, this.flash - dt * 3.2);
    this.muzzle = Math.max(0, this.muzzle - dt);
    this.shake *= Math.exp(-7 * dt);
    if (this.shake < 0.05) this.shake = 0;
    this.shakeX = this.rng.spread(this.shake);
    this.shakeY = this.rng.spread(this.shake);
  }
}

/** Four quick kills per multiplier step, capped so the HUD stays readable. */
export function comboFromHits(hits) {
  return Math.min(1 + Math.floor(hits / 4), 10);
}

/**
 * How long the chain survives between kills. This tightens as the multiplier climbs -- a relaxed
 * 2.4s at x1 down to 1.1s at x10 -- so the top of the range is a tightrope rather than a plateau
 * you reach once and then sit on. Climbing is forgiving; staying up means never stopping to think.
 */
export function comboWindow(combo) {
  return 2.4 - Math.min(combo - 1, 9) * 0.144;
}
