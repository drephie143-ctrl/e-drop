// Renders every pattern (a track's part) offline into an AudioBuffer, once per change.
// Playback then only plays buffers through the mixer, which keeps the live audio thread
// light enough for an iPhone: a 9-voice supersaw over 4-note chords is ~40 oscillators per
// chord, and that work happens here, not while the song plays.
import { playNotes, playVoice, insertChain } from './synth.js';
import { drumSample } from './drums.js';
import { playFx, pumpBuffer } from './fx.js';
import { arpeggiate, mtof } from '../music/theory.js';

const cache = new Map(); // pattern id -> { sig, buf, pump, kicks }

// Gain staging: each role is trimmed so its default presets render at roughly -18 dBFS RMS
// (drums -14), leaving headroom for the mix bus, glue compressor and limiter.
const ROLE_TRIM = { lead: -3, pluck: -3.5, pad: -6, stab: -11, bass: -10, sub: -5.5, drums: -7, fx: -5 };
let chain = Promise.resolve();
let pendingCount = 0;
export const renderState = { busy: 0, onchange: null };

const OAC = () => window.OfflineAudioContext || window.webkitOfflineAudioContext;

export function stepSec(p) { return 15 / p.bpm; }
export function barSec(p) { return 240 / p.bpm; }

export function sigOf(project, track, pat) {
  const base = { bpm: project.bpm, bars: pat.bars };
  if (track.role === 'drums') return JSON.stringify({ ...base, key: project.key, kit: track.kit, hits: pat.hits, rel: project.master.pumpRelease, cur: project.master.pumpCurve });
  if (track.role === 'fx') return JSON.stringify({ ...base, key: project.key, fx: pat.fx });
  return JSON.stringify({ ...base, s: track.synth, notes: pat.notes });
}

export const cached = (pat) => cache.get(pat.id);
// A buffer is playable if it was rendered at the song's current tempo and key (after a tempo
// change an old buffer would drift; after a note edit the old one is fine until the new is in).
export function playable(project, pat) {
  const c = cache.get(pat.id);
  return c && c.buf && c.bpm === project.bpm && c.key === project.key ? c : null;
}
export function forget(patId) { cache.delete(patId); }

function tailFor(track, pat) {
  if (track.role === 'drums') return pat.hits.some((h) => h.v === 'crash') ? 2.8 : 0.9;
  if (track.role === 'fx') return pat.fx.some((f) => f.type === 'impact' || f.type === 'subdrop') ? 4.2 : 0.4;
  return Math.min(4, track.synth.amp.r * 1.6 + 0.1);
}

export function kickTimes(project, pat) {
  const st = stepSec(project);
  return pat.hits.filter((h) => h.v === 'kick' && h.s < pat.bars * 16).map((h) => h.s * st);
}

async function renderOne(project, track, pat, sr) {
  const st = stepSec(project);
  const body = pat.bars * barSec(project);
  const len = body + tailFor(track, pat);
  const C = OAC();
  const off = new C(2, Math.ceil(len * sr), sr);
  const out = off.createGain();
  out.gain.value = 10 ** ((ROLE_TRIM[track.role] || 0) / 20);
  out.connect(off.destination);
  const steps = pat.bars * 16;
  if (track.role === 'drums') {
    const kit = track.kit;
    const used = [...new Set(pat.hits.map((x) => x.v))];
    const smp = Object.fromEntries(await Promise.all(used.map(async (v) => [v, await drumSample(sr, v, project.key, kit)])));
    for (const hit of pat.hits) {
      const lv = (kit.levels[hit.v] ?? 1) * (hit.vel ?? 1);
      if (hit.s >= steps || lv <= 0) continue;
      const src = off.createBufferSource();
      src.buffer = smp[hit.v];
      const g = off.createGain();
      g.gain.value = lv;
      src.connect(g).connect(out);
      src.start(hit.s * st);
    }
  } else if (track.role === 'fx') {
    const rootHz = mtof(project.key + 41); // the key's root around F2
    for (const e of pat.fx) if (e.s < steps) playFx(off, out, e.type, e.s * st, Math.max(st, e.len * st), { vel: e.vel ?? 1, rootHz });
  } else {
    const s = track.synth;
    const notes = arpeggiate(pat.notes.filter((n) => n.start < steps).map((n) => ({ ...n, len: Math.min(n.len, steps - n.start) })), s.arp, steps);
    const input = insertChain(off, out, s, { stepSec: st, steps, tailEnd: len });
    if (s.mono) playNotes(off, input, s, notes, { stepSec: st, maxPoly: 1 });
    else await placeFromBank(off, input, s, notes, st, sr);
  }
  const r = off.startRendering();
  const buf = r && r.then ? await r : await new Promise((res) => { off.oncomplete = (e) => res(e.renderedBuffer); });
  let pump = null;
  if (track.role === 'drums') {
    const ks = kickTimes(project, pat);
    if (ks.length) pump = pumpBuffer(off, ks, body, project.master.pumpRelease * st * 4, project.master.pumpCurve);
  }
  return { buf, pump, body };
}

// Polyphonic parts repeat the same notes a lot (a chord stab 16 times, an arp cycling five
// pitches), so each distinct note (pitch, length, velocity) is synthesized once into a "note
// bank" buffer, and the part plays slices of it. This cuts render time 2-4x on chord parts.
async function placeFromBank(off, input, s, notes, st, sr) {
  if (!notes.length) return;
  const keyOf = (n) => `${n.pitch}|${n.len.toFixed(3)}|${(n.vel ?? 0.9).toFixed(2)}`;
  const uniq = new Map();
  for (const n of notes) if (!uniq.has(keyOf(n))) uniq.set(keyOf(n), n);
  const rel = s.amp.r * 1.6 + 0.04;
  let t = 0;
  const slots = new Map();
  for (const [k, n] of uniq) {
    const d = n.len * st;
    const L = Math.max(d, s.amp.a) + rel;
    slots.set(k, { o: t, L });
    t += L + 0.02;
  }
  const C = OAC();
  const bank = new C(2, Math.ceil(t * sr) + 128, sr);
  for (const [k, n] of uniq) {
    const sl = slots.get(k);
    playVoice(bank, bank.destination, s, { freqs: [{ t: sl.o, f: mtof(n.pitch) }], t1: sl.o + n.len * st, vel: n.vel ?? 0.9 });
  }
  const r = bank.startRendering();
  const buf = r && r.then ? await r : await new Promise((res) => { bank.oncomplete = (e) => res(e.renderedBuffer); });
  // simple polyphony cap, like the live synth: skip notes beyond 24 sounding at once
  const ends = [];
  for (const n of notes.slice().sort((a, b) => a.start - b.start)) {
    const when = n.start * st;
    for (let i = ends.length - 1; i >= 0; i--) if (ends[i] <= when) ends.splice(i, 1);
    if (ends.length >= 24) continue;
    const sl = slots.get(keyOf(n));
    ends.push(when + sl.L);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(input);
    src.start(when, sl.o, sl.L);
  }
}

// Make sure a pattern's buffer is current. Renders run one at a time.
export function ensure(project, track, pat, sr) {
  const sig = sigOf(project, track, pat);
  const c = cache.get(pat.id);
  // Current, and nothing else on its way. With a render of another version queued (an undo came
  // in while the edit it undoes was still rendering), ask again below: that marks the queued one
  // superseded, so it can't land in the cache after the undo.
  if (c && c.sig === sig && (!c.pendingSig || c.pendingSig === sig)) return Promise.resolve(c);
  if (c && c.pendingSig === sig) return c.pending;
  pendingCount++;
  renderState.busy = pendingCount;
  if (renderState.onchange) renderState.onchange();
  const job = chain.then(async () => {
    // a newer edit may already have superseded this one
    const cur = cache.get(pat.id);
    if (cur && cur.pendingSig && cur.pendingSig !== sig) return cur; // superseded, skip
    if (cur && cur.sig === sig) { if (cur.pendingSig === sig) { delete cur.pendingSig; delete cur.pending; } return cur; }
    const r = await renderOne(project, track, pat, sr);
    const entry = { sig, ...r, bpm: project.bpm, key: project.key };
    const latest = cache.get(pat.id);
    if (latest && latest.pendingSig && latest.pendingSig !== sig) Object.assign(entry, { pendingSig: latest.pendingSig, pending: latest.pending });
    cache.set(pat.id, entry);
    return entry;
  }).finally(() => {
    pendingCount--;
    renderState.busy = pendingCount;
    if (renderState.onchange) renderState.onchange();
  });
  chain = job.catch(() => {});
  cache.set(pat.id, { ...(c || {}), pendingSig: sig, pending: job });
  return job;
}

// Render everything the arrangement uses, in the order the song needs it. With `untilBar`,
// resolve once the parts that start before that bar are ready (the rest keep rendering).
export function ensureAll(project, sr, { untilBar = Infinity } = {}) {
  const first = [];
  let bar = 0;
  const seen = new Set();
  for (const sec of project.sections) {
    for (const t of project.tracks) {
      const pat = sec.cells[t.id] && t.patterns.find((x) => x.id === sec.cells[t.id]);
      if (pat && !seen.has(pat.id)) { seen.add(pat.id); first.push({ bar, t, pat }); }
    }
    bar += sec.bars;
  }
  const jobs = first.map((x) => ({ bar: x.bar, job: ensure(project, x.t, x.pat, sr) }));
  return Promise.all(jobs.filter((j) => j.bar < untilBar).map((j) => j.job));
}
