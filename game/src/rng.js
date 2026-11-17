// Seeded pseudo-random numbers. Every roll the game makes goes through one of these, so a given
// seed always produces the same run -- which is what makes the ?shot= screenshot frames reproducible.

/** mulberry32: small, fast, good enough spread for a game. Returns a function giving [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A few conveniences on top of the raw stream. */
export function createRng(seed) {
  const next = mulberry32(seed);
  return {
    seed,
    next,
    /** Float in [min, max). */
    range: (min, max) => min + next() * (max - min),
    /** Integer in [min, max]. */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    /** Float in [-amount, amount). */
    spread: (amount) => (next() * 2 - 1) * amount,
    /** Radians in [0, 2pi). */
    angle: () => next() * Math.PI * 2,
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
  };
}
