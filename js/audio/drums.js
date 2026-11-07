// Synthesized festival drum kit. The kick is tuned to the song's key. Every voice takes a
// context, so the same code renders parts offline and plays the pads live.
import { noiseBuffer, driveCurve } from './synth.js';

export const VOICES = [
  { id: 'kick', name: 'Kick' },
  { id: 'clap', name: 'Clap' },
  { id: 'snare', name: 'Snare' },
  { id: 'hat', name: 'Hat' },
  { id: 'ohat', name: 'Open hat' },
  { id: 'ride', name: 'Ride' },
  { id: 'crash', name: 'Crash' },
  { id: 'perc', name: 'Perc' },
];

export const KICKS = {
  bigroom: { name: 'Big Room Kick', start: 5.5, sweep: 0.045, decay: 0.55, drive: 0.55, click: 0.5, tail: 0.6 },
  house: { name: 'Tight House Kick', start: 4, sweep: 0.035, decay: 0.32, drive: 0.25, click: 0.35, tail: 0.25 },
  trance: { name: 'Punchy Trance Kick', start: 6, sweep: 0.03, decay: 0.28, drive: 0.4, click: 0.6, tail: 0.15 },
  deep: { name: 'Deep Progressive Kick', start: 3.5, sweep: 0.05, decay: 0.45, drive: 0.15, click: 0.2, tail: 0.4 },
};

export const KIT_DEFAULT = {
  kick: 'bigroom', tune: 0, levels: { kick: 1, clap: 0.8, snare: 0.75, hat: 0.55, ohat: 0.5, ride: 0.4, crash: 0.5, perc: 0.5 }, hatDecay: 0.05,
};

// Kick fundamental from the key: the root in the 40–62 Hz range, plus the tune offset.
export function kickHz(key, tune = 0) {
  let f = 440 * 2 ** ((key + 24 - 69 + tune) / 12); // C1 = 32.7 Hz
  while (f < 40) f *= 2;
  while (f > 62) f /= 2;
  return f;
}

function env(ctx, t, peak, decay, out, shape = 'exp') {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.001);
  if (shape === 'exp') g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
  else g.gain.setTargetAtTime(0, t + 0.001, decay / 4);
  g.connect(out);
  return g;
}

function noise(ctx, t, dur, type, freq, q, dest, offset = 0) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  if (q) f.Q.value = q;
  s.connect(f).connect(dest);
  s.start(t, offset || Math.random() * 1.2);
  s.stop(t + dur);
  return f;
}

function metal(ctx, t, dur, freqs, hp, dest) {
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  f.connect(dest);
  for (const fr of freqs) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = fr;
    const g = ctx.createGain();
    g.gain.value = 0.18;
    o.connect(g).connect(f);
    o.start(t); o.stop(t + dur);
  }
}

export function playDrum(ctx, out, id, t, { vel = 1, key = 5, kit = KIT_DEFAULT } = {}) {
  const lv = (kit.levels && kit.levels[id]) ?? 1;
  const v = vel * lv;
  if (v <= 0) return;
  switch (id) {
    case 'kick': {
      const k = KICKS[kit.kick] || KICKS.bigroom;
      const f = kickHz(key, kit.tune);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f * k.start, t);
      o.frequency.exponentialRampToValueAtTime(f * 1.6, t + k.sweep * 0.5);
      o.frequency.exponentialRampToValueAtTime(f, t + k.sweep * 2.2);
      const pre = ctx.createGain();
      pre.gain.value = 1 + k.drive * 2;
      const ws = ctx.createWaveShaper();
      ws.curve = driveCurve(k.drive);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.9 * v, t + 0.002);
      g.gain.setValueAtTime(0.9 * v, t + 0.02);
      g.gain.setTargetAtTime(0.5 * v * k.tail + 0.0001, t + 0.03, k.decay * 0.25);
      g.gain.setTargetAtTime(0, t + k.decay * 0.6, k.decay * 0.22);
      o.connect(pre).connect(ws).connect(g).connect(out);
      o.start(t); o.stop(t + k.decay * 1.8 + 0.1);
      // click / top
      noise(ctx, t, 0.012, 'highpass', 3000, 0, env(ctx, t, 0.5 * v * k.click, 0.012, out), 0.1);
      break;
    }
    case 'clap': {
      const g = ctx.createGain();
      g.connect(out);
      g.gain.setValueAtTime(0, t);
      for (let i = 0; i < 4; i++) {
        const tk = t + i * 0.009;
        g.gain.setValueAtTime(0.75 * v, tk);
        g.gain.exponentialRampToValueAtTime(0.1 * v, tk + 0.008);
      }
      g.gain.setValueAtTime(0.7 * v, t + 0.036);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.32);
      noise(ctx, t, 0.36, 'bandpass', 1250, 0.9, g);
      noise(ctx, t, 0.2, 'highpass', 5000, 0, env(ctx, t + 0.03, 0.15 * v, 0.15, out));
      break;
    }
    case 'snare': {
      noise(ctx, t, 0.25, 'highpass', 1800, 0, env(ctx, t, 0.55 * v, 0.22, out));
      noise(ctx, t, 0.15, 'bandpass', 4500, 0.7, env(ctx, t, 0.3 * v, 0.12, out));
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(260, t);
      o.frequency.exponentialRampToValueAtTime(185, t + 0.06);
      o.connect(env(ctx, t, 0.5 * v, 0.1, out));
      o.start(t); o.stop(t + 0.12);
      break;
    }
    case 'hat': {
      const d = kit.hatDecay || 0.05;
      const g = env(ctx, t, 0.4 * v, d, out);
      metal(ctx, t, d + 0.02, [317, 465, 541, 678, 810], 7500, g);
      noise(ctx, t, d + 0.02, 'highpass', 9000, 0, g);
      break;
    }
    case 'ohat': {
      const g = env(ctx, t, 0.32 * v, 0.38, out);
      metal(ctx, t, 0.42, [317, 465, 541, 678, 810], 7000, g);
      noise(ctx, t, 0.42, 'highpass', 8000, 0, g);
      break;
    }
    case 'ride': {
      const g = env(ctx, t, 0.22 * v, 0.9, out);
      metal(ctx, t, 0.95, [523, 612, 783, 1092, 1371], 5000, g);
      noise(ctx, t, 0.5, 'bandpass', 9000, 1.5, env(ctx, t, 0.08 * v, 0.4, out));
      break;
    }
    case 'crash': {
      const g = env(ctx, t, 0.4 * v, 2.4, out, 'target');
      noise(ctx, t, 2.6, 'highpass', 4500, 0, g);
      metal(ctx, t, 1.5, [432, 587, 718, 911, 1201], 3500, env(ctx, t, 0.3 * v, 1.4, out));
      break;
    }
    case 'perc': {
      // tuned wood/tom perc, a fifth above the kick
      const f = kickHz(key, kit.tune) * 6;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * 1.5, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.02);
      o.connect(env(ctx, t, 0.6 * v, 0.14, out));
      o.start(t); o.stop(t + 0.16);
      noise(ctx, t, 0.03, 'bandpass', 3000, 2, env(ctx, t, 0.2 * v, 0.03, out));
      break;
    }
  }
}

// --- patterns: hits are { v: voice, s: step (16ths, may be fractional), vel } --------------
const at = (v, steps, vel = 0.9) => steps.map((s) => ({ v, s, vel }));
const every = (from, step, to) => { const a = []; for (let s = from; s < to; s += step) a.push(s); return a; };

export const PATTERN_PRESETS = [
  { name: 'Four on the floor', bars: 1, hits: () => [...at('kick', [0, 4, 8, 12], 1), ...at('clap', [4, 12]), ...at('ohat', [2, 6, 10, 14], 0.7)] },
  { name: 'Big room drop', bars: 1, hits: () => [...at('kick', [0, 4, 8, 12], 1), ...at('clap', [4, 12], 1), ...at('snare', [4, 12], 0.6), ...at('ohat', [2, 6, 10, 14], 0.8), ...at('hat', every(0, 1, 16), 0.45)] },
  { name: 'Progressive groove', bars: 1, hits: () => [...at('kick', [0, 4, 8, 12], 1), ...at('clap', [4, 12], 0.9), ...at('hat', every(0, 2, 16), 0.5), ...at('ohat', [2, 6, 10, 14], 0.6), ...at('perc', [3, 7, 11, 15], 0.5), ...at('ride', every(2, 4, 16), 0.5)] },
  { name: 'Trance drive', bars: 1, hits: () => [...at('kick', [0, 4, 8, 12], 1), ...at('clap', [4, 12], 0.85), ...at('ohat', [2, 6, 10, 14], 0.8), ...at('hat', every(1, 2, 16), 0.4), ...at('ride', every(0, 1, 16), 0.3)] },
  { name: 'Breakdown (no kick)', bars: 1, hits: () => [...at('hat', every(2, 4, 16), 0.3)] },
  { name: 'Intro kick + hats', bars: 1, hits: () => [...at('kick', [0, 4, 8, 12], 1), ...at('hat', every(2, 4, 16), 0.55)] },
  { name: 'Crash on the one', bars: 1, hits: () => [...at('crash', [0], 1)] },
];

// Snare roll for a build: density doubles as it goes (quarters → 8ths → 16ths → 32nds),
// velocity rises, and the last beat is left open for the drop. Optional kick roll too.
export function snareRoll(bars = 8, { withKick = true, voice = 'snare', gapLast = true } = {}) {
  const hits = [];
  const steps = bars * 16;
  const quarters = Math.max(1, Math.round(bars / 4));
  const stages = bars >= 8 ? [4, 2, 1, 0.5] : bars >= 4 ? [4, 2, 1, 0.5] : [2, 1, 0.5];
  const stageLen = steps / stages.length;
  const end = gapLast ? steps - 4 : steps;
  for (let si = 0; si < stages.length; si++) {
    const div = stages[si];
    const from = si * stageLen;
    for (let s = from; s < Math.min(end, from + stageLen) - 1e-6; s += div) {
      const prog = s / steps;
      hits.push({ v: voice, s, vel: 0.35 + 0.65 * prog });
      if (voice === 'snare' && div <= 1) hits.push({ v: 'clap', s, vel: 0.2 + 0.5 * prog });
    }
  }
  if (withKick) {
    for (let s = 0; s < end; s += 4) hits.push({ v: 'kick', s, vel: 0.9 });
    // the kick doubles to 8ths in the last stage
    for (let s = steps - stageLen; s < end; s += 2) if (s % 4) hits.push({ v: 'kick', s, vel: 0.8 });
  }
  void quarters;
  return hits;
}

// One-shot samples of each voice, rendered once per kit setting and key. Patterns then place
// these buffers instead of re-synthesizing every hit (a bar of 16th hats is 16 buffer plays).
const SAMPLE_LEN = { kick: 1.3, clap: 0.45, snare: 0.32, hat: 0.3, ohat: 0.5, ride: 1.05, crash: 2.8, perc: 0.22 };
const sampleCache = new Map();

export function drumSample(sr, id, key, kit) {
  const sig = `${sr}|${id}|${key}|${kit.kick}|${kit.tune}|${kit.hatDecay}`;
  let p = sampleCache.get(sig);
  if (!p) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new OAC(2, Math.ceil(SAMPLE_LEN[id] * sr), sr);
    playDrum(off, off.destination, id, 0, { vel: 1, key, kit: { ...kit, levels: { [id]: 1 } } });
    const r = off.startRendering();
    p = r && r.then ? r : new Promise((res) => { off.oncomplete = (e) => res(e.renderedBuffer); });
    sampleCache.set(sig, p);
    if (sampleCache.size > 64) sampleCache.delete(sampleCache.keys().next().value);
  }
  return p;
}
