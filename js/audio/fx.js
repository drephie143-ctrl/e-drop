// Build-up and transition effects (risers, noise sweeps, downlifters, impacts, sub drops),
// plus the shared effects: generated reverb impulse response, synced ping-pong delay and the
// sidechain pump envelope.
import { noiseBuffer, driveCurve } from './synth.js';

export const FX_TYPES = {
  riser: { name: 'Riser', hint: 'Saw + noise climbing to the drop' },
  noiseup: { name: 'White-noise sweep up', hint: 'Filtered noise opening up' },
  downlifter: { name: 'Downlifter', hint: 'Noise and pitch falling away' },
  impact: { name: 'Impact', hint: 'Boom + crash on the downbeat' },
  subdrop: { name: 'Sub drop', hint: 'Sine diving under the drop' },
  reverse: { name: 'Reverse cymbal', hint: 'Swells into the next bar' },
};

// Plays one FX event lasting `dur` seconds from `t`.
export function playFx(ctx, out, type, t, dur, { vel = 1, rootHz = 87.3 } = {}) {
  const end = t + dur;
  switch (type) {
    case 'riser': {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5 * vel, end - 0.02);
      g.gain.linearRampToValueAtTime(0, end);
      g.connect(out);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 1.2;
      f.frequency.setValueAtTime(300, t);
      f.frequency.exponentialRampToValueAtTime(9000, end);
      f.connect(g);
      const nz = ctx.createBufferSource();
      nz.buffer = noiseBuffer(ctx);
      nz.loop = true;
      nz.connect(f);
      nz.start(t); nz.stop(end);
      for (const det of [-12, 0, 9]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(rootHz * 2, t);
        o.frequency.exponentialRampToValueAtTime(rootHz * 16, end);
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = 0.12;
        o.connect(og).connect(f);
        o.start(t); o.stop(end);
      }
      break;
    }
    case 'noiseup': {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.05 * vel, t);
      g.gain.linearRampToValueAtTime(0.45 * vel, end - 0.01);
      g.gain.linearRampToValueAtTime(0, end);
      g.connect(out);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(150, t);
      hp.frequency.exponentialRampToValueAtTime(4000, end);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 3;
      lp.frequency.setValueAtTime(600, t);
      lp.frequency.exponentialRampToValueAtTime(16000, end);
      hp.connect(lp).connect(g);
      const nz = ctx.createBufferSource();
      nz.buffer = noiseBuffer(ctx);
      nz.loop = true;
      nz.connect(hp);
      nz.start(t); nz.stop(end);
      break;
    }
    case 'downlifter': {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0005, end);
      g.connect(out);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 1;
      f.frequency.setValueAtTime(8000, t);
      f.frequency.exponentialRampToValueAtTime(200, end);
      f.connect(g);
      const nz = ctx.createBufferSource();
      nz.buffer = noiseBuffer(ctx);
      nz.loop = true;
      nz.connect(f);
      nz.start(t); nz.stop(end);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(rootHz * 8, t);
      o.frequency.exponentialRampToValueAtTime(rootHz, end);
      const og = ctx.createGain();
      og.gain.value = 0.15;
      o.connect(og).connect(f);
      o.start(t); o.stop(end);
      break;
    }
    case 'impact': {
      const len = Math.min(dur, 4);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(rootHz * 2, t);
      o.frequency.exponentialRampToValueAtTime(rootHz / 2, t + 0.6);
      const ws = ctx.createWaveShaper();
      ws.curve = driveCurve(0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.9 * vel, t + 0.004);
      g.gain.setTargetAtTime(0, t + 0.05, len / 5);
      o.connect(ws).connect(g).connect(out);
      o.start(t); o.stop(t + len);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0, t);
      ng.gain.linearRampToValueAtTime(0.5 * vel, t + 0.003);
      ng.gain.setTargetAtTime(0, t + 0.01, len / 6);
      ng.connect(out);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(12000, t);
      f.frequency.exponentialRampToValueAtTime(400, t + len);
      f.connect(ng);
      const nz = ctx.createBufferSource();
      nz.buffer = noiseBuffer(ctx);
      nz.loop = true;
      nz.connect(f);
      nz.start(t); nz.stop(t + len);
      break;
    }
    case 'subdrop': {
      const len = Math.min(dur, 3);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(rootHz, t);
      o.frequency.exponentialRampToValueAtTime(rootHz / 3, t + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.8 * vel, t + 0.01);
      g.gain.setTargetAtTime(0, t + len * 0.4, len / 5);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + len + 0.1);
      break;
    }
    case 'reverse': {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.45 * vel, end - 0.005);
      g.gain.linearRampToValueAtTime(0, end);
      g.connect(out);
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 3500;
      f.connect(g);
      const nz = ctx.createBufferSource();
      nz.buffer = noiseBuffer(ctx);
      nz.loop = true;
      nz.connect(f);
      nz.start(t); nz.stop(end);
      break;
    }
  }
}

// --- reverb impulse response: stereo noise with an exponential decay that gets darker
// as it decays (a one-pole low-pass whose cutoff falls over time), plus pre-delay.
export function makeIR(ctx, { seconds = 3.5, predelay = 0.02, damp = 0.5, seed = 7 } = {}) {
  const sr = ctx.sampleRate;
  const len = Math.ceil((seconds + predelay) * sr);
  const b = ctx.createBuffer(2, len, sr);
  let x = seed;
  const rnd = () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x3fffffff - 1; };
  const pd = Math.floor(predelay * sr);
  const k = Math.log(1000) / (seconds * sr); // -60 dB at `seconds`
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    let lp = 0;
    for (let i = pd; i < len; i++) {
      const n = i - pd;
      const pos = n / (len - pd);
      const a = Math.exp(-k * n);
      const coef = 0.95 - damp * 0.85 * pos; // brighter early, darker late
      lp = lp * (1 - coef) + rnd() * coef;
      d[i] = lp * a;
    }
    // short fade-in avoids a click at the onset
    for (let i = 0; i < 64; i++) d[pd + i] *= i / 64;
  }
  // normalise energy so bigger rooms are not louder
  let e = 0;
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) e += d[i] * d[i]; }
  const g = 1 / Math.sqrt(e / 2) * 0.9;
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] *= g; }
  return b;
}

export const DELAY_TIMES = { '1/16': 1, '1/8': 2, '3/16': 3, '1/4': 4, '3/8': 6 }; // in 16ths

// Ping-pong delay: input → L tap → R tap → back to L, with filtering in the loop.
export function makePingPong(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dl = ctx.createDelay(2);
  const dr = ctx.createDelay(2);
  const fb = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 300;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 6000;
  const merge = ctx.createChannelMerger(2);
  const mono = ctx.createGain();
  mono.channelCount = 1;
  mono.channelCountMode = 'explicit';
  mono.channelInterpretation = 'speakers';
  input.connect(hp).connect(lp).connect(mono).connect(dl);
  dl.connect(merge, 0, 0);
  dl.connect(dr);
  dr.connect(merge, 0, 1);
  dr.connect(fb).connect(dl);
  merge.connect(output);
  return {
    input, output,
    set(stepSec, steps, feedback) {
      const t = Math.min(1.9, stepSec * steps);
      dl.delayTime.value = t;
      dr.delayTime.value = t;
      fb.gain.value = Math.min(0.85, feedback);
    },
  };
}

// --- sidechain pump: 1 at each kick, then back to 0 over `release` seconds.
// The duck gain is 1 - depth * pump(t).
export function pumpShape(dt, release, curve = 2) {
  if (dt < 0) return 0;
  const att = 0.004;
  if (dt < att) return dt / att; // short fade avoids a click on the duck
  const x = (dt - att) / release;
  if (x >= 1) return 0;
  return (1 - x) ** curve;
}

// Pump envelope for a pattern: returns a mono buffer `seconds` long.
export function pumpBuffer(ctx, kickTimes, seconds, release, curve) {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.ceil(seconds * sr));
  const b = ctx.createBuffer(1, len, sr);
  const d = b.getChannelData(0);
  const ks = kickTimes.slice().sort((a, b) => a - b);
  let k = -1;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    while (k + 1 < ks.length && ks[k + 1] <= t) k++;
    d[i] = k >= 0 ? pumpShape(t - ks[k], release, curve) : 0;
  }
  return b;
}
