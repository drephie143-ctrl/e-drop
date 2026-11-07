// Export mastering, run in a worker: loudness (ITU-R BS.1770 integrated LUFS), optional
// loudness target, a lookahead brickwall limiter that guarantees the ceiling, and a
// dithered 16-bit WAV.

// Biquad coefficients for the K-weighting filters at any sample rate (bilinear transform).
export function kCoefs(sr) {
  const shelf = (() => {
    const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    const K = Math.tan(Math.PI * f0 / sr);
    const Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
    const a0 = 1 + K / Q + K * K;
    return { b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
  })();
  const hp = (() => {
    const f0 = 38.13547087602444, Q = 0.5003270373238773;
    const K = Math.tan(Math.PI * f0 / sr);
    const a0 = 1 + K / Q + K * K;
    return { b: [1, -2, 1], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
  })();
  return [shelf, hp];
}

function biquad(x, { b, a }) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

export function integratedLufs(chans, sr) {
  const [shelf, hp] = kCoefs(sr);
  const w = chans.map((c) => biquad(biquad(c, shelf), hp));
  const block = Math.round(0.4 * sr);
  const hop = Math.round(0.1 * sr);
  const zs = [];
  for (let s = 0; s + block <= w[0].length; s += hop) {
    let z = 0;
    for (const c of w) { let e = 0; for (let i = s; i < s + block; i++) e += c[i] * c[i]; z += e / block; }
    zs.push(z);
  }
  const L = (z) => -0.691 + 10 * Math.log10(z);
  const abs = zs.filter((z) => L(z) > -70);
  if (!abs.length) return -70;
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const rel = L(mean(abs)) - 10;
  const gated = abs.filter((z) => L(z) > rel);
  return gated.length ? L(mean(gated)) : -70;
}

export function peakOf(chans) {
  let p = 0;
  for (const c of chans) for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > p) p = v; }
  return p;
}

// Lookahead brickwall limiter. Gain is the sliding minimum of the required reduction over
// the lookahead, smoothed by a moving average of the same length (so it reaches the needed
// gain exactly at the peak), with an exponential release. Output never exceeds `ceil`.
export function limit(chans, sr, ceil, { lookMs = 1.5, releaseMs = 80 } = {}) {
  const n = chans[0].length;
  const L = Math.max(2, Math.round((lookMs / 1000) * sr));
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const c of chans) { const v = Math.abs(c[i]); if (v > p) p = v; }
    r[i] = p > ceil ? ceil / p : 1;
  }
  // h[i] = min(r[i .. i+L-1]) via a monotonic deque
  const h = new Float32Array(n);
  const dq = new Int32Array(n);
  let head = 0, tail = 0;
  let j = 0;
  for (let i = 0; i < n; i++) {
    while (j < Math.min(n, i + L)) { while (tail > head && r[dq[tail - 1]] >= r[j]) tail--; dq[tail++] = j; j++; }
    while (dq[head] < i) head++;
    h[i] = r[dq[head]];
  }
  // moving average of h over the last L samples, then release smoothing
  const rc = 1 - Math.exp(-1 / ((releaseMs / 1000) * sr));
  let acc = L; // the window starts full of unity gain
  let g = 1;
  const out = chans.map(() => new Float32Array(n));
  let reduced = 0;
  for (let i = 0; i < n; i++) {
    acc += h[i] - (i >= L ? h[i - L] : 1);
    const target = acc / L;
    g = target < g ? target : g + (target - g) * rc;
    if (g < 0.999) reduced++;
    for (let c = 0; c < chans.length; c++) out[c][i] = chans[c][i] * g;
  }
  // final guard against float rounding
  for (const c of out) for (let i = 0; i < n; i++) { if (c[i] > ceil) c[i] = ceil; else if (c[i] < -ceil) c[i] = -ceil; }
  return { chans: out, reducedPct: (reduced / n) * 100 };
}

export function encodeWav(chans, sampleRate) {
  const nCh = chans.length;
  const len = chans[0].length;
  const bytes = len * nCh * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); w(8, 'WAVE');
  w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nCh * 2, true);
  v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, bytes, true);
  let o = 44;
  let seed = 22222;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nCh; c++) {
      const d = (rnd() - rnd()) / 32768; // TPDF dither, ±1 LSB
      const s = Math.max(-1, Math.min(32767 / 32768, chans[c][i] + d));
      v.setInt16(o, Math.round(s * 32768), true);
      o += 2;
    }
  }
  return buf;
}

// The whole export job: measure, reach the loudness target, limit, measure again, encode.
export function master({ chans, sr, targetLufs = null, ceilingDb = -1 }, onProgress = () => {}) {
  const before = integratedLufs(chans, sr);
  const peakIn = peakOf(chans);
  onProgress(0.25);
  let gain = 1;
  if (targetLufs != null && before > -70) gain = 10 ** ((targetLufs - before) / 20);
  const pre = gain === 1 ? chans : chans.map((c) => c.map((x) => x * gain));
  const ceil = 10 ** (ceilingDb / 20);
  const lim = limit(pre, sr, ceil);
  onProgress(0.6);
  const after = integratedLufs(lim.chans, sr);
  const peak = peakOf(lim.chans);
  onProgress(0.8);
  const wav = encodeWav(lim.chans, sr);
  return { wav, stats: { lufsIn: before, lufs: after, peakIn, peak, peakDb: 20 * Math.log10(peak || 1e-9), gainDb: 20 * Math.log10(gain), limitedPct: lim.reducedPct, seconds: chans[0].length / sr } };
}
