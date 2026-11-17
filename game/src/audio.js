// Every sound is synthesised at runtime from oscillators and one procedurally filled noise buffer --
// there are no audio files anywhere in this game. Nothing is created until the player's first real
// interaction (click or keypress), so the browser's autoplay policy is never fought with.

let ac = null;
let master = null;
let noise = null;
let enabled = false;

/** Called from the first user gesture. Safe to call repeatedly. */
export function unlock() {
  if (ac) {
    if (ac.state === 'suspended') ac.resume();
    return;
  }
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return;
  ac = new Ctor();
  master = ac.createGain();
  master.gain.value = 0.34;
  // A gentle ceiling keeps stacked explosions from clipping into mush.
  const squeeze = ac.createDynamicsCompressor();
  squeeze.threshold.value = -14;
  squeeze.ratio.value = 8;
  squeeze.attack.value = 0.003;
  squeeze.release.value = 0.18;
  master.connect(squeeze).connect(ac.destination);

  const frames = Math.floor(ac.sampleRate * 0.5);
  noise = ac.createBuffer(1, frames, ac.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  enabled = true;
}

export function setMuted(muted) {
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.34, ac.currentTime, 0.02);
}

export function isReady() {
  return enabled;
}

function env(gain, peak, attack, decay, at) {
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
}

function tone(type, from, to, peak, attack, decay, delay = 0, detune = 0) {
  if (!enabled) return;
  const at = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + attack + decay);
  env(gain, peak, attack, decay, at);
  osc.connect(gain).connect(master);
  osc.start(at);
  osc.stop(at + attack + decay + 0.05);
}

function burst(peak, decay, filterType, freq, q, delay = 0, sweepTo = null) {
  if (!enabled) return;
  const at = ac.currentTime + delay;
  const src = ac.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.7 + Math.random() * 0.6;
  const filter = ac.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(freq, at);
  if (sweepTo !== null) filter.frequency.exponentialRampToValueAtTime(sweepTo, at + decay);
  filter.Q.value = q;
  const gain = ac.createGain();
  env(gain, peak, 0.004, decay, at);
  src.connect(filter).connect(gain).connect(master);
  src.start(at);
  src.stop(at + decay + 0.08);
}

export const sfx = {
  shoot() {
    const d = Math.random() * 120;
    tone('square', 880 + d, 230, 0.16, 0.002, 0.07);
    tone('sawtooth', 1760 + d, 520, 0.05, 0.001, 0.045);
    burst(0.05, 0.05, 'highpass', 2600, 1);
  },

  /** A hit that did not kill: a dry tick. */
  graze() {
    tone('square', 520, 380, 0.08, 0.002, 0.05);
    burst(0.06, 0.05, 'bandpass', 1800, 3);
  },

  explode(pitch = 1) {
    burst(0.5, 0.3, 'lowpass', 2400 * pitch, 1, 0, 180);
    tone('sine', 180 * pitch, 42, 0.45, 0.004, 0.28);
    tone('sawtooth', 300 * pitch, 70, 0.1, 0.002, 0.14);
  },

  /** Combo step-up: a bright pitched ping that climbs with the multiplier. */
  combo(step) {
    const n = Math.min(step, 12);
    tone('triangle', 420 * Math.pow(1.0595, n * 3), 0, 0.14, 0.004, 0.16);
  },

  hurt() {
    tone('sawtooth', 320, 48, 0.4, 0.005, 0.5);
    tone('square', 160, 36, 0.28, 0.005, 0.45);
    burst(0.4, 0.45, 'lowpass', 1200, 1, 0, 120);
  },

  wave() {
    tone('triangle', 330, 332, 0.2, 0.01, 0.14, 0);
    tone('triangle', 494, 496, 0.2, 0.01, 0.16, 0.11);
    tone('triangle', 660, 662, 0.22, 0.01, 0.3, 0.22);
  },

  gameOver() {
    const notes = [440, 349, 294, 220];
    notes.forEach((f, i) => tone('sawtooth', f, f * 0.5, 0.22, 0.01, 0.55, i * 0.16));
    tone('sine', 110, 40, 0.3, 0.02, 1.4, 0.5);
    burst(0.2, 1.2, 'lowpass', 900, 1, 0.5, 90);
  },

  start() {
    tone('square', 220, 880, 0.16, 0.01, 0.18);
    tone('triangle', 440, 1760, 0.12, 0.01, 0.22, 0.05);
  },
};
