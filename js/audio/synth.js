// The synth voice behind every melodic instrument: supersaw unison with stereo spread,
// a second oscillator, sub, noise, a filter with its own envelope, an amp envelope,
// a pitch envelope and mono glide. Each part renders offline (render.js), so the
// heavy unison stacks never run on the live audio thread; live note previews use a
// lighter version of the same voice (fewer unison voices, 12 dB filter).
import { mtof } from '../music/theory.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const driveCurves = new Map();
export function driveCurve(amount) {
  const k = Math.round(amount * 50) / 50;
  let c = driveCurves.get(k);
  if (!c) {
    c = new Float32Array(2048);
    const g = 1 + k * 9;
    const norm = Math.tanh(g);
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1;
      c[i] = Math.tanh(x * g) / norm;
    }
    driveCurves.set(k, c);
  }
  return c;
}

// Unison detune offsets in cents for `n` voices: spread evenly, outer voices a bit wider,
// like the classic supersaw. `amount` 0..1 maps to ±0..±55 cents.
export function unisonOffsets(n, amount) {
  if (n <= 1) return [0];
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1; // -1..1
    out.push(Math.sign(x) * Math.abs(x) ** 1.3 * amount * 55);
  }
  return out;
}

// Saw and square waves with a fixed start phase, so unison voices don't all start in phase
// (a phase-locked stack sounds like one loud flam on every note-on).
const waveCache = new WeakMap();
const PHASES = [0, 0.37, 0.71, 0.13, 0.55, 0.89, 0.24, 0.63, 0.05];
export function phasedWave(ctx, type, i) {
  if (type !== 'sawtooth' && type !== 'square') return null;
  let m = waveCache.get(ctx);
  if (!m) { m = new Map(); waveCache.set(ctx, m); }
  const k = `${type}${i % PHASES.length}`;
  let w = m.get(k);
  if (!w) {
    const N = 512;
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    const ph = PHASES[i % PHASES.length] * 2 * Math.PI;
    for (let n = 1; n < N; n++) {
      const b = type === 'sawtooth' ? (2 / (Math.PI * n)) * (n % 2 ? 1 : -1) : n % 2 ? 4 / (Math.PI * n) : 0;
      re[n] = b * Math.sin(n * ph);
      im[n] = b * Math.cos(n * ph);
    }
    w = ctx.createPeriodicWave(re, im);
    m.set(k, w);
  }
  return w;
}

const noiseCache = new WeakMap();
export function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(2, ctx.sampleRate * 2, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    noiseCache.set(ctx, b);
  }
  return b;
}

// Plays one voice. `freqs` is [{t, f}]: the first entry is the note-on; later ones are glides
// (mono legato). `t1` is the note-off. Returns the time the voice is silent.
export function playVoice(ctx, out, s, { freqs, t1, vel = 1, lite = false }) {
  const t0 = freqs[0].t;
  const amp = s.amp;
  const flt = s.filter;
  const end = Math.max(t1, t0 + amp.a) + amp.r * 1.6 + 0.03;
  const glide = Math.max(0.005, s.glide || 0.06);

  // frequency schedule, applied to each oscillator's own frequency param (cheaper than an
  // audio-rate control signal: between events the oscillator runs on its fast path)
  const f0 = freqs[0].f;
  const pe = s.pitchEnv || { amt: 0, decay: 0.1 };
  const schedule = (param, mult) => {
    if (pe.amt) {
      param.setValueAtTime(f0 * mult * 2 ** (pe.amt / 12), t0);
      param.exponentialRampToValueAtTime(f0 * mult, t0 + Math.max(0.005, pe.decay));
    } else param.setValueAtTime(f0 * mult, t0);
    for (let i = 1; i < freqs.length; i++) {
      param.setValueAtTime(freqs[i - 1].f * mult, freqs[i].t);
      param.exponentialRampToValueAtTime(freqs[i].f * mult, freqs[i].t + glide);
    }
  };

  const bus = ctx.createGain();
  const oscs = [];
  // unison voices share up to five pan positions instead of one panner each
  const pans = new Map();
  const panBus = (pan) => {
    const k = Math.round(clamp(pan, -1, 1) * 2) / 2;
    if (!k || !ctx.createStereoPanner) return bus;
    let p = pans.get(k);
    if (!p) { p = ctx.createStereoPanner(); p.pan.value = k; p.connect(bus); pans.set(k, p); }
    return p;
  };
  let phaseIdx = 0;
  const addOsc = (type, mult, detune, pan, gain, phased = false) => {
    const o = ctx.createOscillator();
    const w = phased ? phasedWave(ctx, type, phaseIdx++) : null;
    if (w) o.setPeriodicWave(w); else o.type = type;
    schedule(o.frequency, mult);
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = gain;
    o.connect(g).connect(panBus(pan));
    oscs.push(o);
  };

  // main oscillator (unison stack, each voice with its own start phase)
  const o1 = s.osc;
  const nv = lite ? Math.min(3, o1.voices) : o1.voices;
  const offs = unisonOffsets(nv, o1.detune);
  const per = (o1.level ?? 1) / Math.sqrt(nv);
  offs.forEach((c, i) => {
    const pan = nv > 1 ? ((i / (nv - 1)) * 2 - 1) * o1.spread * (i % 2 ? -1 : 1) : 0;
    addOsc(o1.wave, 2 ** (o1.octave || 0), c + (o1.semi || 0) * 100, pan, per * (i === (nv >> 1) ? 1.15 : 1), nv > 1);
  });
  const o2 = s.osc2;
  if (o2 && o2.level > 0) {
    const n2 = lite ? 1 : Math.max(1, o2.voices || 1);
    const offs2 = unisonOffsets(n2, o2.detune || 0);
    offs2.forEach((c, i) => addOsc(o2.wave, 2 ** (o2.octave || 0), c + (o2.semi || 0) * 100,
      n2 > 1 ? ((i / (n2 - 1)) * 2 - 1) * (o2.spread ?? 0.5) : 0, o2.level / Math.sqrt(n2), n2 > 1));
  }
  if (s.sub > 0) addOsc('sine', 0.5, 0, 0, s.sub);
  if (s.noise > 0) {
    const nz = ctx.createBufferSource();
    nz.buffer = noiseBuffer(ctx);
    nz.loop = true;
    const g = ctx.createGain();
    g.gain.value = s.noise * 0.5;
    nz.connect(g).connect(bus);
    oscs.push(nz);
  }

  // filter + its envelope
  let node = bus;
  if (flt && flt.type !== 'off') {
    const nyq = ctx.sampleRate / 2 - 100;
    const key = flt.key ? (f0 / 261.6) ** flt.key : 1;
    const base = clamp(flt.cutoff * key, 20, nyq);
    const peak = clamp(base * 2 ** (flt.env || 0), 20, nyq);
    const sus = clamp(base * 2 ** ((flt.env || 0) * (flt.s ?? 0)), 20, nyq);
    const stages = !lite && flt.slope === 24 ? 2 : 1;
    for (let k = 0; k < stages; k++) {
      const f = ctx.createBiquadFilter();
      f.type = flt.type || 'lowpass';
      f.Q.value = k === 0 ? flt.res : 0.5;
      const fp = f.frequency;
      if (flt.env) {
        fp.setValueAtTime(base, t0);
        fp.exponentialRampToValueAtTime(peak, t0 + Math.max(0.002, flt.a || 0.002));
        fp.setTargetAtTime(sus, t0 + (flt.a || 0.002), Math.max(0.005, (flt.d || 0.2) / 3));
        fp.setTargetAtTime(base, Math.max(t1, t0 + (flt.a || 0.002) + 0.001), Math.max(0.005, (flt.r ?? amp.r) / 3));
      } else fp.value = base;
      node.connect(f);
      node = f;
    }
  }

  // amp envelope, scheduled in time order (no cancels, so short notes can't click)
  const env = ctx.createGain();
  const g = env.gain;
  const peakV = vel * (s.level ?? 0.7);
  const a = Math.max(0.002, amp.a);
  const relStart = Math.max(t1, t0 + a + 0.001);
  g.setValueAtTime(0, t0);
  g.linearRampToValueAtTime(peakV, t0 + a);
  let held = peakV;
  if (amp.s < 0.999) {
    const tc = Math.max(0.004, amp.d / 3);
    g.setTargetAtTime(peakV * amp.s, t0 + a, tc);
    held = peakV * (amp.s + (1 - amp.s) * Math.exp(-(relStart - t0 - a) / tc));
  }
  g.setValueAtTime(held, relStart);
  g.setTargetAtTime(0, relStart, Math.max(0.004, amp.r / 4));
  node.connect(env).connect(out);

  for (const o of oscs) { o.start(t0); o.stop(end); }
  return end;
}

// Turns notes (16th-step units) into voices on a context. Notes are already arpeggiated.
// Mono tracks with glide tie overlapping notes into one gliding voice.
export function playNotes(ctx, out, s, notes, { stepSec, offset = 0, lite = false, maxPoly = 16 }) {
  const ev = notes.map((x) => ({ t0: offset + x.start * stepSec, t1: offset + (x.start + x.len) * stepSec, f: mtof(x.pitch), vel: x.vel ?? 0.9 }))
    .sort((a, b) => a.t0 - b.t0);
  let last = 0;
  if (s.mono) {
    let i = 0;
    while (i < ev.length) {
      const phrase = [ev[i]];
      let tEnd = ev[i].t1;
      let j = i + 1;
      while (j < ev.length && ev[j].t0 <= tEnd + 0.002 && s.glide > 0) { phrase.push(ev[j]); tEnd = Math.max(ev[j].t1, ev[j].t0 + 0.01); j++; }
      if (j === i + 1) { tEnd = ev[i].t1; if (j < ev.length) tEnd = Math.min(tEnd, ev[j].t0); }
      last = Math.max(last, playVoice(ctx, out, s, { freqs: phrase.map((p) => ({ t: p.t0, f: p.f })), t1: tEnd, vel: phrase[0].vel, lite }));
      i = j;
    }
  } else {
    // simple polyphony cap: drop the quietest overlap beyond maxPoly
    const active = [];
    for (const e of ev) {
      for (let k = active.length - 1; k >= 0; k--) if (active[k] <= e.t0) active.splice(k, 1);
      if (active.length >= maxPoly) continue;
      active.push(e.t1 + s.amp.r);
      last = Math.max(last, playVoice(ctx, out, s, { freqs: [{ t: e.t0, f: e.f }], t1: e.t1, vel: e.vel, lite }));
    }
  }
  return last;
}

// Track-level inserts that are baked into the rendered part: trance gate, drive, width.
export function insertChain(ctx, out, s, { stepSec, offset = 0, steps = 16, tailEnd }) {
  let head = ctx.createGain();
  const input = head;
  const gate = s.gate;
  if (gate && gate.on && gate.depth > 0) {
    const gg = ctx.createGain();
    const p = gg.gain;
    const per = gate.rate === '1/8' ? 2 : gate.rate === '1/32' ? 0.5 : 1;
    const pat = gate.pattern;
    const lo = 1 - gate.depth;
    const sm = Math.min(0.012, stepSec * per * 0.25);
    p.setValueAtTime(pat[0] ? 1 : lo, offset);
    let k = 0;
    for (let t = 0; offset + t * stepSec < tailEnd; t += per, k++) {
      const v = pat[k % pat.length] ? 1 : lo;
      const tt = offset + t * stepSec;
      p.setTargetAtTime(v, tt, sm / 3);
      if (pat[k % pat.length] && gate.shape === 'pluck') p.setTargetAtTime(lo + (1 - lo) * 0.35, tt + stepSec * per * 0.35, stepSec * per * 0.2);
    }
    head.connect(gg);
    head = gg;
  }
  if (s.drive > 0) {
    const pre = ctx.createGain();
    pre.gain.value = 1 + s.drive * 1.5;
    const ws = ctx.createWaveShaper();
    ws.curve = driveCurve(s.drive);
    ws.oversample = '2x';
    const post = ctx.createGain();
    post.gain.value = 1 / (1 + s.drive * 0.8);
    head.connect(pre).connect(ws).connect(post);
    head = post;
  }
  const w = s.width ?? 1;
  if (Math.abs(w - 1) > 0.01) {
    const sp = ctx.createChannelSplitter(2);
    const mg = ctx.createChannelMerger(2);
    const same = (1 + w) / 2;
    const cross = (1 - w) / 2;
    const gains = [[0, 0, same], [0, 1, cross], [1, 1, same], [1, 0, cross]];
    head.connect(sp);
    for (const [from, to, v] of gains) {
      const g = ctx.createGain();
      g.gain.value = v;
      sp.connect(g, from);
      g.connect(mg, 0, to);
    }
    head = mg;
  }
  head.connect(out);
  return input;
}

export const SYNTH_DEFAULT = {
  osc: { wave: 'sawtooth', voices: 7, detune: 0.4, spread: 0.8, octave: 0, semi: 0, level: 1 },
  osc2: { wave: 'square', voices: 1, detune: 0, octave: -1, semi: 0, level: 0 },
  sub: 0,
  noise: 0,
  filter: { type: 'lowpass', cutoff: 2400, res: 1, env: 2, a: 0.005, d: 0.5, s: 0.4, r: 0.3, slope: 24, key: 0.5 },
  amp: { a: 0.005, d: 0.4, s: 0.8, r: 0.25 },
  pitchEnv: { amt: 0, decay: 0.05 },
  mono: false,
  glide: 0,
  drive: 0,
  width: 1,
  level: 0.6,
  gate: { on: false, rate: '1/16', depth: 1, shape: 'square', pattern: [1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1] },
  arp: { on: false, rate: '1/16', mode: 'up', octaves: 1, gate: 0.6 },
};
