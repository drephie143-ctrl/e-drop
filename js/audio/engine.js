// Mixer, master chain, transport and offline mixdown. The same graph builder runs live
// (AudioContext) and for export (OfflineAudioContext), so the WAV sounds like playback.
//
// Per track:  clips → in → filter (cutoff lane) → duck (sidechain) → pan → vol → auto (vol lane)
//             → mute → master,  + reverb send, + delay send (send lanes)
// Master:     sum → HPF/LPF (lanes) → 3-band EQ → glue comp → drive → limiter → out
import { makeIR, makePingPong, DELAY_TIMES } from './fx.js';
import { playable, ensureAll, stepSec, barSec } from './render.js';
import { playVoice } from './synth.js';
import { playDrum } from './drums.js';
import { mtof } from '../music/theory.js';
import { kCoefs } from '../dsp/master.js';

const dbToGain = (db) => 10 ** (db / 20);

export const LANE_PARAMS = {
  cutoff: { name: 'Filter cutoff', def: 1, exp: true, map: (v) => 20 * 1000 ** v, fmt: (v) => `${Math.round(20 * 1000 ** v)} Hz` },
  vol: { name: 'Volume', def: 1, map: (v) => v * v, fmt: (v) => `${Math.round(v * 100)}%` },
  rev: { name: 'Reverb send', def: null, map: (v) => v, fmt: (v) => `${Math.round(v * 100)}%` },
  dly: { name: 'Delay send', def: null, map: (v) => v, fmt: (v) => `${Math.round(v * 100)}%` },
  hpf: { name: 'Master high-pass', def: 0, exp: true, master: true, map: (v) => 20 * 100 ** v, fmt: (v) => `${Math.round(20 * 100 ** v)} Hz` },
  lpf: { name: 'Master low-pass', def: 1, exp: true, master: true, map: (v) => 20 * 1000 ** v, fmt: (v) => `${Math.round(20 * 1000 ** v)} Hz` },
};

export function laneValue(points, bar, def) {
  if (!points || !points.length) return def;
  if (bar <= points[0].b) return points[0].v;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (bar <= b.b) return b.b === a.b ? b.v : a.v + ((bar - a.b) / (b.b - a.b)) * (b.v - a.v);
  }
  return points[points.length - 1].v;
}

export function songBars(p) { return p.sections.reduce((a, s) => a + s.bars, 0); }
export function sectionStarts(p) {
  let b = 0;
  return p.sections.map((s) => { const r = b; b += s.bars; return r; });
}

// Every clip in the song: a pattern of a track placed at a bar, looping within its section.
export function songClips(p) {
  const out = [];
  const starts = sectionStarts(p);
  p.sections.forEach((sec, si) => {
    for (const t of p.tracks) {
      const pid = sec.cells[t.id];
      const pat = pid && t.patterns.find((x) => x.id === pid);
      if (!pat) continue;
      for (let r = 0; r * pat.bars < sec.bars; r++) {
        const bar = starts[si] + r * pat.bars;
        out.push({ bar, bars: Math.min(pat.bars, sec.bars - r * pat.bars), track: t, pat, sec: si });
      }
    }
  });
  return out.sort((a, b) => a.bar - b.bar);
}

function compressor(ctx, o) {
  const c = ctx.createDynamicsCompressor();
  for (const [k, v] of Object.entries(o)) c[k].value = v;
  return c;
}

// Builds the whole mixer on a context. Returns handles to every node that changes.
export function buildMix(ctx, project, { ir, live = true } = {}) {
  const m = {};
  m.sum = ctx.createGain();
  m.hpf = ctx.createBiquadFilter();
  m.hpf.type = 'highpass';
  m.hpf.frequency.value = 20;
  m.hpf.Q.value = 0.7;
  m.lpf = ctx.createBiquadFilter();
  m.lpf.type = 'lowpass';
  m.lpf.frequency.value = 20000;
  m.lpf.Q.value = 0.7;
  m.low = ctx.createBiquadFilter();
  m.low.type = 'lowshelf';
  m.low.frequency.value = 90;
  m.mid = ctx.createBiquadFilter();
  m.mid.type = 'peaking';
  m.mid.frequency.value = 1500;
  m.mid.Q.value = 0.8;
  m.high = ctx.createBiquadFilter();
  m.high.type = 'highshelf';
  m.high.frequency.value = 9000;
  m.glue = compressor(ctx, { threshold: -12, knee: 6, ratio: 2.5, attack: 0.01, release: 0.2 });
  m.makeup = ctx.createGain();
  m.drive = ctx.createGain();
  m.limit = compressor(ctx, { threshold: -1.5, knee: 0, ratio: 20, attack: 0.001, release: 0.08 });
  m.out = ctx.createGain();
  m.sum.connect(m.hpf).connect(m.lpf).connect(m.low).connect(m.mid).connect(m.high).connect(m.glue).connect(m.makeup).connect(m.drive).connect(m.limit).connect(m.out);
  m.out.connect(ctx.destination);

  // shared FX returns: big reverb and synced ping-pong delay, both pumping with the kick
  m.revIn = ctx.createGain();
  const revHp = ctx.createBiquadFilter();
  revHp.type = 'highpass';
  revHp.frequency.value = 220;
  m.conv = ctx.createConvolver();
  m.conv.normalize = false;
  m.conv.buffer = ir || makeIR(ctx, { seconds: project.master.revSize, damp: project.master.revDamp });
  m.revDuck = ctx.createGain();
  m.revRet = ctx.createGain();
  m.revIn.connect(revHp).connect(m.conv).connect(m.revDuck).connect(m.revRet).connect(m.sum);
  m.delay = makePingPong(ctx);
  m.dlyDuck = ctx.createGain();
  m.dlyRet = ctx.createGain();
  m.delay.output.connect(m.dlyDuck).connect(m.dlyRet).connect(m.sum);

  // sidechain: pump envelope sources feed pumpBus; each ducked node gets 1 - depth * pump
  m.pumpBus = ctx.createGain();
  const duckAmt = (target, depth) => { const g = ctx.createGain(); g.gain.value = -depth; m.pumpBus.connect(g).connect(target.gain); return g; };
  m.revDuckAmt = duckAmt(m.revDuck, 0);
  m.dlyDuckAmt = duckAmt(m.dlyDuck, 0);

  m.strips = new Map();
  for (const t of project.tracks) {
    const s = {};
    s.in = ctx.createGain();
    s.filter = ctx.createBiquadFilter();
    s.filter.type = 'lowpass';
    s.filter.frequency.value = 20000;
    s.filter.Q.value = 0.9;
    s.duck = ctx.createGain();
    s.duckAmt = duckAmt(s.duck, 0);
    s.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    s.vol = ctx.createGain();
    s.auto = ctx.createGain();
    s.mute = ctx.createGain();
    s.rev = ctx.createGain();
    s.dly = ctx.createGain();
    s.in.connect(s.filter).connect(s.duck).connect(s.pan).connect(s.vol).connect(s.auto).connect(s.mute);
    s.mute.connect(m.sum);
    s.mute.connect(s.rev).connect(m.revIn);
    s.mute.connect(s.dly).connect(m.delay.input);
    m.strips.set(t.id, s);
  }

  if (live) {
    // meters: K-weighted pair for loudness (the exact ITU-R BS.1770 filters as IIR filters),
    // plain pair for peak
    const [shelf, hp] = kCoefs(ctx.sampleRate);
    const kShelf = ctx.createIIRFilter(shelf.b, [1, ...shelf.a]);
    const kHp = ctx.createIIRFilter(hp.b, [1, ...hp.a]);
    const ks = ctx.createChannelSplitter(2);
    const ps = ctx.createChannelSplitter(2);
    m.out.connect(kShelf).connect(kHp).connect(ks);
    m.out.connect(ps);
    m.kAn = [0, 1].map((i) => { const a = ctx.createAnalyser(); a.fftSize = 2048; ks.connect(a, i); return a; });
    m.pAn = [0, 1].map((i) => { const a = ctx.createAnalyser(); a.fftSize = 2048; ps.connect(a, i); return a; });
    m.reduction = () => m.limit.reduction;
  }
  applyMix(ctx, m, project, true);
  return m;
}

const gainFor = (mix, anySolo) => (mix.mute || (anySolo && !mix.solo) ? 0 : 1);

export function applyMix(ctx, m, project, instant = false) {
  const now = ctx.currentTime;
  const set = (param, v) => { if (instant) param.value = v; else param.setTargetAtTime(v, now, 0.015); };
  const M = project.master;
  set(m.low.gain, M.low);
  set(m.mid.gain, M.mid);
  set(m.high.gain, M.high);
  // Web Audio compressors add automatic make-up gain of 0.6 × the gain they'd remove from a
  // 0 dBFS signal. Undo it, so Drive alone sets how hard the limiter is hit.
  const autoMakeup = (T, R) => -0.6 * T * (1 - 1 / R);
  const gT = -6 - M.glue * 18;
  const gR = 1.5 + M.glue * 2.5;
  set(m.glue.threshold, gT);
  set(m.glue.ratio, gR);
  set(m.makeup.gain, dbToGain(-autoMakeup(gT, gR)));
  set(m.drive.gain, dbToGain(M.drive));
  // the compressor-limiter overshoots by ~0.6 dB on transients; the trim keeps live peaks at the ceiling
  set(m.out.gain, dbToGain(M.ceiling + 1.5 - autoMakeup(-1.5, 20) - 0.7) * M.volume);
  set(m.revRet.gain, M.revLevel);
  set(m.dlyRet.gain, M.dlyLevel);
  set(m.revDuckAmt.gain, -M.pumpFx);
  set(m.dlyDuckAmt.gain, -M.pumpFx);
  m.delay.set(stepSec(project), DELAY_TIMES[M.dlyTime] || 3, M.dlyFb);
  const anySolo = project.tracks.some((t) => t.mix.solo);
  const lanes = project.automation;
  for (const t of project.tracks) {
    const s = m.strips.get(t.id);
    if (!s) continue;
    set(s.vol.gain, t.mix.vol);
    if (s.pan.pan) set(s.pan.pan, t.mix.pan);
    set(s.mute.gain, gainFor(t.mix, anySolo));
    set(s.duckAmt.gain, -t.mix.duck);
    if (!lanes.some((l) => l.target === t.id && l.param === 'rev')) set(s.rev.gain, t.mix.rev);
    if (!lanes.some((l) => l.target === t.id && l.param === 'dly')) set(s.dly.gain, t.mix.dly);
  }
}

function laneParam(m, lane) {
  if (lane.target === 'master') return lane.param === 'hpf' ? m.hpf.frequency : lane.param === 'lpf' ? m.lpf.frequency : null;
  const s = m.strips.get(lane.target);
  if (!s) return null;
  return { cutoff: s.filter.frequency, vol: s.auto.gain, rev: s.rev.gain, dly: s.dly.gain }[lane.param] || null;
}

// Schedule automation for song range [fromBar, toBar) starting at context time `when`.
export function scheduleLanes(m, project, fromBar, toBar, when, first, cancelAt = null) {
  const bs = barSec(project);
  for (const lane of project.automation) {
    const param = laneParam(m, lane);
    const P = LANE_PARAMS[lane.param];
    if (!param || !P) continue;
    const def = P.def ?? 0;
    const val = (v) => Math.max(P.exp ? 1e-3 : 0, P.map(v));
    if (first) param.cancelScheduledValues(0);
    if (cancelAt != null) param.cancelScheduledValues(cancelAt);
    param.setValueAtTime(val(laneValue(lane.points, fromBar, def)), when);
    for (const pt of lane.points) {
      if (pt.b <= fromBar || pt.b > toBar) continue;
      const t = when + (pt.b - fromBar) * bs;
      if (P.exp) param.exponentialRampToValueAtTime(val(pt.v), t);
      else param.linearRampToValueAtTime(val(pt.v), t);
    }
    // ramp to the value at the range end so the segment finishes on the curve
    const tEnd = when + (toBar - fromBar) * bs;
    const vEnd = val(laneValue(lane.points, toBar, def));
    if (P.exp) param.exponentialRampToValueAtTime(vEnd, tEnd - 0.001);
    else param.linearRampToValueAtTime(vEnd, tEnd - 0.001);
  }
}

function resetLanes(ctx, m, project) {
  for (const lane of project.automation) {
    const param = laneParam(m, lane);
    if (!param) continue;
    param.cancelScheduledValues(0);
    const P = LANE_PARAMS[lane.param];
    param.setValueAtTime(Math.max(P.exp ? 1e-3 : 0, P.map(laneValue(lane.points, 0, P.def ?? 0))), ctx.currentTime);
  }
}

// Start a clip's buffer (and its pump envelope) at `when`, `offset` seconds into it.
export function startClip(ctx, m, project, clip, when, offset, sources) {
  const c = playable(project, clip.pat);
  if (!c) return;
  const s = m.strips.get(clip.track.id);
  if (!s) return;
  const bs = barSec(project);
  const cut = clip.bars < clip.pat.bars; // section ends before the pattern does
  const dur = clip.bars * bs - offset;
  if (dur <= 0.001 && cut) return;
  const src = ctx.createBufferSource();
  src.buffer = c.buf;
  if (cut) {
    const g = ctx.createGain();
    const tc = when + dur;
    g.gain.setValueAtTime(1, Math.max(when, tc - 0.012));
    g.gain.linearRampToValueAtTime(0, tc);
    src.connect(g).connect(s.in);
    src.start(when, offset);
    src.stop(tc + 0.01);
  } else {
    src.connect(s.in);
    src.start(when, offset);
  }
  if (sources) { sources.add(src); src.onended = () => sources.delete(src); }
  if (c.pump && !clip.track.mix.mute) {
    const ps = ctx.createBufferSource();
    ps.buffer = c.pump;
    ps.connect(m.pumpBus);
    ps.start(when, Math.min(offset, c.pump.duration));
    ps.stop(when + Math.min(dur, c.pump.duration - offset));
    if (sources) { sources.add(ps); ps.onended = () => sources.delete(ps); }
  }
}

export class Engine {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'playback' });
    this.project = null;
    this.m = null;
    this.playing = false;
    this.pos = 0; // bars
    this.loop = null; // { from, to } in bars, or null for the whole song
    // a preview (js/preview.js): play to `to` once, then stop and put the playhead back at `back`.
    // It wins over the loop while it plays, and leaves the loop as it was.
    this.range = null; // { to, back } in bars
    this.sources = new Set();
    this.gen = 0; // bumped by every play and stop: a play still waiting on renders checks it
    this.onEnded = null;
    this.lufs = { hist: [], m: -70, s: -70, peak: 0 };
  }

  get sr() { return this.ctx.sampleRate; }

  setProject(p) {
    this.stop();
    // a play waiting on renders, or a preview held for them, belongs to the song being replaced
    this.range = null;
    this.gen++;
    this.project = p;
    this.pos = 0;
    this.rebuild();
  }

  // Rebuild the mixer (tracks added or removed, reverb size changed).
  rebuild() {
    const wasPlaying = this.playing;
    const range = this.range;
    if (wasPlaying) this.stop({ keep: true }); // a preview carries on to its end
    if (this.m) { try { this.m.out.disconnect(); } catch { /* gone */ } }
    const M = this.project.master;
    const irKey = `${M.revSize}|${M.revDamp}`;
    if (this.irKey !== irKey) { this.ir = makeIR(this.ctx, { seconds: M.revSize, damp: M.revDamp }); this.irKey = irKey; }
    this.m = buildMix(this.ctx, this.project, { ir: this.ir, live: true });
    resetLanes(this.ctx, this.m, this.project);
    if (wasPlaying) this.play(this.pos, { range });
  }

  updateMix() { if (this.m) applyMix(this.ctx, this.m, this.project); }

  songBars() { return songBars(this.project); }

  // --- transport (positions in bars) ---------------------------------------------
  // With opts.range ({ to, back }) it plays [fromBar, to) once: the preview. Any other play,
  // a seek or a stop ends a preview; stop() puts the playhead back at `back`.
  async play(fromBar = this.pos, opts = {}) {
    if (this.playing) this.stop();
    const p = this.project;
    const total = songBars(p);
    // a preview asked to go on from its own end (an undo in its last moments): it is over
    if (opts.range && Math.min(total, opts.range.to) <= fromBar + 1e-6) {
      this.pos = opts.range.back;
      this.range = null;
      if (this.onEnded) this.onEnded();
      return;
    }
    const range = opts.range ? { to: Math.min(total, opts.range.to), back: opts.range.back } : null;
    this.range = range;
    if (!range && !this.loop && fromBar >= total - 0.01) fromBar = 0;
    if (!range && this.loop && (fromBar < this.loop.from || fromBar >= this.loop.to)) fromBar = this.loop.from;
    // the playhead is where playback will start, also while the parts it needs still render (an
    // undo or a stop in that wait goes on from, or remembers, this bar)
    this.pos = fromBar;
    this.playing = true;
    const gen = ++this.gen;
    await ensureAll(p, this.sr, { untilBar: fromBar + 12 });
    // stopped, or a newer play (an undo while this one waited) took over: two would play at once
    if (!this.playing || gen !== this.gen) return;
    const ctx = this.ctx;
    this.clips = songClips(p);
    this.segs = [];
    this.late = [];
    this.timer = setInterval(() => this.tick(), 25);
    this.addSeg(fromBar, range ? range.to : this.loop ? this.loop.to : total, ctx.currentTime + 0.06, true);
    this.tick();
  }

  addSeg(from, to, when, first = false) {
    const seg = { from, to, when, end: when + (to - from) * barSec(this.project), idx: 0 };
    // clips in range: starting inside it, or (first segment only) already sounding at `from`
    seg.list = this.clips.filter((c) => (c.bar >= from && c.bar < to) || (first && c.bar < from && c.bar + c.bars > from));
    this.segs.push(seg);
    scheduleLanes(this.m, this.project, from, to, when, first);
    return seg;
  }

  tick() {
    const ctx = this.ctx;
    const ahead = ctx.currentTime + 0.3;
    const bs = barSec(this.project);
    for (const seg of this.segs) {
      while (seg.idx < seg.list.length) {
        const c = seg.list[seg.idx];
        const rel = (c.bar - seg.from) * bs;
        const when = seg.when + Math.max(0, rel);
        if (when > ahead) break;
        if (playable(this.project, c.pat)) startClip(ctx, this.m, this.project, c, when, Math.max(0, -rel), this.sources);
        else this.late.push({ c, when, offset: Math.max(0, -rel) }); // still rendering: join late
        seg.idx++;
        this.horizon = Math.max(this.horizon || 0, when);
      }
    }
    // parts that weren't rendered in time start as soon as they are, in sync
    for (let i = this.late.length - 1; i >= 0; i--) {
      const L = this.late[i];
      const ready = playable(this.project, L.c.pat);
      const now = ctx.currentTime + 0.03;
      const off = L.offset + Math.max(0, now - L.when);
      if (off >= L.c.bars * bs) { this.late.splice(i, 1); continue; }
      if (ready) { startClip(ctx, this.m, this.project, L.c, Math.max(now, L.when), off, this.sources); this.late.splice(i, 1); }
    }
    const last = this.segs[this.segs.length - 1];
    if (this.loop && !this.range) {
      if (last.end < ctx.currentTime + 1) this.addSeg(this.loop.from, this.loop.to, last.end);
      this.segs = this.segs.filter((s) => s.end > ctx.currentTime - 1 || s === last);
    } else if (ctx.currentTime > last.end + 0.05) {
      const preview = !!this.range;
      this.stop(); // a preview's stop puts the playhead back where it was
      if (!preview) this.pos = 0;
      if (this.onEnded) this.onEnded();
    }
  }

  position() {
    if (!this.playing || !this.segs || !this.segs.length) return this.pos;
    const now = this.ctx.currentTime;
    const bs = barSec(this.project);
    let seg = this.segs[0];
    for (const s of this.segs) if (now >= s.when) seg = s;
    return Math.min(seg.to, seg.from + Math.max(0, now - seg.when) / bs);
  }

  // opts.keep: a stop to start again at once (a rebuild, an undo while playing). It keeps the
  // preview, and the playhead where it is; the caller plays on with { range: this.range }.
  stop(opts = {}) {
    if (!this.playing) return;
    this.pos = Math.max(0, this.position());
    if (this.range && !opts.keep) { this.pos = this.range.back; this.range = null; }
    this.playing = false;
    this.gen++;
    clearInterval(this.timer);
    this.late = [];
    const now = this.ctx.currentTime;
    for (const s of this.sources) { try { s.stop(now + 0.02); } catch { /* not started */ } }
    this.sources.clear();
    // a quick fade on the bus avoids a click
    const g = this.m.out.gain;
    const v = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(v, now);
    g.linearRampToValueAtTime(0, now + 0.025);
    g.linearRampToValueAtTime(v, now + 0.4); // reverb and delay tails come back in softly
    resetLanes(this.ctx, this.m, this.project);
    this.segs = [];
  }

  seek(bar) {
    bar = Math.max(0, Math.min(bar, songBars(this.project)));
    if (this.playing) this.play(bar);
    else this.pos = bar;
  }

  // The arrangement changed while playing: rebuild the clip lists without restarting.
  // Clips that would have started before what is already scheduled are skipped.
  refresh() {
    if (!this.playing || !this.segs) return;
    const p = this.project;
    this.clips = songClips(p);
    const bs = barSec(p);
    const total = songBars(p);
    for (const [i, seg] of this.segs.entries()) {
      // a preview keeps its end (inside the song as it is now); the whole song runs to its new end
      if (this.range) { seg.to = Math.max(seg.from, Math.min(this.range.to, total)); seg.end = seg.when + (seg.to - seg.from) * bs; }
      else if (!this.loop) { seg.to = total; seg.end = seg.when + (seg.to - seg.from) * bs; }
      const first = i === 0;
      seg.list = this.clips.filter((c) => (c.bar >= seg.from && c.bar < seg.to) || (first && c.bar < seg.from && c.bar + c.bars > seg.from));
      seg.idx = 0;
      while (seg.idx < seg.list.length && seg.when + Math.max(0, (seg.list[seg.idx].bar - seg.from) * bs) <= (this.horizon || 0)) seg.idx++;
    }
    ensureAll(p, this.sr);
  }

  // Automation changed while playing: reschedule the lanes from now.
  relane() {
    if (!this.playing || !this.segs || !this.segs.length) { if (this.m) resetLanes(this.ctx, this.m, this.project); return; }
    const now = this.ctx.currentTime + 0.02;
    const bs = barSec(this.project);
    let cancelled = false;
    for (const seg of this.segs) {
      if (seg.end <= now) continue;
      const from = Math.max(seg.from, seg.from + (now - seg.when) / bs);
      const when = Math.max(now, seg.when);
      scheduleLanes(this.m, this.project, from, seg.to, when, false, cancelled ? null : now);
      cancelled = true;
    }
  }

  // --- live note preview (lite voice, through the track's strip) ---------------------
  preview(track, pitch, dur = 0.35) {
    const s = this.m && this.m.strips.get(track.id);
    if (!s) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    if (track.role === 'drums') playDrum(ctx, s.in, pitch, t, { key: this.project.key, kit: track.kit });
    else if (track.role === 'fx') return;
    else playVoice(ctx, s.in, { ...track.synth, pitchEnv: track.synth.pitchEnv }, { freqs: [{ t, f: mtof(pitch) }], t1: t + dur, vel: 0.85, lite: true });
  }

  // --- loudness meter -------------------------------------------------------------
  meter() {
    const m = this.m;
    if (!m || !m.kAn) return this.lufs;
    const buf = this.mbuf || (this.mbuf = new Float32Array(2048));
    let z = 0;
    for (const a of m.kAn) { a.getFloatTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; z += s / buf.length; }
    let pk = 0;
    for (const a of m.pAn) { a.getFloatTimeDomainData(buf); for (let i = 0; i < buf.length; i++) pk = Math.max(pk, Math.abs(buf[i])); }
    const now = performance.now();
    const L = this.lufs;
    L.hist.push([now, z]);
    while (L.hist.length && L.hist[0][0] < now - 3000) L.hist.shift();
    const avg = (ms) => { const h = L.hist.filter((x) => x[0] >= now - ms); return h.reduce((a, x) => a + x[1], 0) / Math.max(1, h.length); };
    const lu = (ms) => { const v = avg(ms); return v > 1e-10 ? -0.691 + 10 * Math.log10(v) : -70; };
    L.m = lu(400);
    L.s = lu(3000);
    L.peak = Math.max(pk, L.peak * 0.95);
    L.gr = m.limit.reduction;
    return L;
  }

  // --- export ---------------------------------------------------------------------------
  async renderSong(onStage) {
    const p = this.project;
    const sr = this.sr;
    onStage && onStage('Rendering parts…');
    await ensureAll(p, sr);
    const bs = barSec(p);
    const total = songBars(p) * bs;
    const tail = Math.min(6, p.master.revSize + 1);
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new OAC(2, Math.ceil((total + tail) * sr), sr);
    const m = buildMix(off, p, { live: false });
    scheduleLanes(m, p, 0, songBars(p), 0, true);
    for (const c of songClips(p)) startClip(off, m, p, c, c.bar * bs, 0, null);
    onStage && onStage('Mixing the song…');
    const r = off.startRendering();
    return r && r.then ? r : new Promise((res) => { off.oncomplete = (e) => res(e.renderedBuffer); });
  }
}
