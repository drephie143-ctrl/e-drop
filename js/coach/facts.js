// Facts about the current song, shared by the lesson checks and the song check: tracks by
// role, sections by type, which pattern plays where, and the notes, hits and effects each
// track actually places in a section. Everything tolerates missing tracks and sections.
import { sectionStarts, songBars } from '../audio/engine.js';
import { SCALES, NOTE_NAMES, PROGRESSIONS, generate } from '../music/theory.js';
import { kickHz } from '../audio/drums.js';
import { newPattern } from '../music/project.js';

export const MELODIC = ['lead', 'pluck', 'pad', 'stab', 'bass', 'sub'];
export const CHORDAL = ['pad', 'stab', 'pluck'];

// Pitch classes that belong to the song's key. A minor song may borrow the raised 7th (the
// harmonic-minor V chord the "i – iv – VI – V" progression uses), so that isn't a wrong note.
// In Dorian and Phrygian the chord generators write their progressions from natural minor
// (theory.progKey), so the natural-minor notes count as in key there too.
export function keyPcs(key, scale) {
  const set = new Set(SCALES[scale].steps.map((s) => (key + s) % 12));
  if (scale !== 'major') set.add((key + 11) % 12);
  else set.add((key + 8) % 12); // raised 7th of the relative minor
  if (scale === 'dorian' || scale === 'phrygian') for (const s of SCALES.minor.steps) set.add((key + s) % 12);
  return set;
}

export const keyName = (p) => `${NOTE_NAMES[p.key]} ${SCALES[p.scale].name.toLowerCase()}`;
export const pc = (m) => ((m % 12) + 12) % 12;

// Note name of the kick's fundamental and how far it is from the key root.
export function kickInfo(p, kit) {
  const f = kickHz(p.key, kit ? kit.tune : 0);
  const midi = Math.round(12 * Math.log2(f / 440) + 69);
  return { f, midi, name: NOTE_NAMES[pc(midi)], off: pc((kit ? kit.tune : 0)) };
}

// A tiny stable hash, to notice that a part changed without keeping a copy of it.
export function hash(s) {
  let x = 5381;
  for (let i = 0; i < s.length; i++) x = ((x << 5) + x + s.charCodeAt(i)) | 0;
  return x >>> 0;
}
export const notesSig = (notes) => hash(notes.map((n) => `${n.pitch}:${n.start}:${n.len}`).sort().join('|'));

export function hasContent(t, pat) {
  if (!t || !pat) return false;
  if (t.role === 'drums') return pat.hits.length > 0;
  if (t.role === 'fx') return pat.fx.length > 0;
  return pat.notes.length > 0;
}

export function facts(app) {
  const p = app.project;
  const starts = sectionStarts(p);
  const secs = p.sections.map((s, i) => ({ s, i, start: starts[i], end: starts[i] + s.bars, bars: s.bars, type: s.type, name: s.name }));
  const memo = new Map();
  const once = (k, fn) => { if (!memo.has(k)) memo.set(k, fn()); return memo.get(k); };
  const F = {
    p, app, ui: app.ui, secs, total: songBars(p), demo: p.id === 'demo', ear: null,
    // the last WAV export, if it was of this song (the coach stamps exports with their song)
    exp: app.lastExport && (app.lastExport.pid == null || app.lastExport.pid === p.id) ? app.lastExport : null,
    pcs: keyPcs(p.key, p.scale),
    key: keyName(p),
    track: (role) => p.tracks.find((t) => t.role === role) || null,
    tracks: (role) => p.tracks.filter((t) => t.role === role),
    of: (type) => secs.filter((x) => x.type === type),
    sec: (i) => secs[i] || null,
    // the pattern a track plays in a section, or null
    pat(t, x) {
      if (!t || !x) return null;
      const id = x.s.cells[t.id];
      return id ? t.patterns.find((q) => q.id === id) || null : null;
    },
    plays(t, x) { return hasContent(t, F.pat(t, x)); },
    // patterns placed somewhere in the song, in song order
    used(t) {
      if (!t) return [];
      return once('u' + t.id, () => {
        const out = [];
        for (const x of secs) { const q = F.pat(t, x); if (q && !out.includes(q)) out.push(q); }
        return out;
      });
    },
    notes(t) { return t ? once('n' + t.id, () => F.used(t).flatMap((q) => q.notes)) : []; },
    // the pattern a lesson works on: the one in the first drop, else the most used, else the first
    main(t) {
      if (!t) return null;
      for (const x of F.of('drop')) { const q = F.pat(t, x); if (q) return q; }
      const u = F.used(t);
      return u[0] || t.patterns[0] || null;
    },
    active(x) { return p.tracks.filter((t) => F.plays(t, x)); },
    // hits / effects / notes placed in a section, in section steps (the pattern loops inside it)
    placed(t, x, kind) {
      const q = F.pat(t, x);
      if (!q) return [];
      const steps = q.bars * 16;
      const end = x.bars * 16;
      const out = [];
      for (let r = 0; r * steps < end; r++) {
        for (const e of q[kind]) {
          const s = (kind === 'notes' ? e.start : e.s) + r * steps;
          if (s < end) out.push({ ...e, at: s });
        }
      }
      return out;
    },
    // pitch classes the chord parts (and the bass) play in each bar of a section
    harmony(x) {
      return once('h' + x.i, () => {
        const bars = Array.from({ length: x.bars }, () => new Set());
        for (const role of [...CHORDAL, 'bass']) {
          for (const t of F.tracks(role)) {
            for (const n of F.placed(t, x, 'notes')) {
              const b0 = Math.floor(n.at / 16);
              const b1 = Math.min(x.bars - 1, Math.floor((n.at + Math.max(0.1, n.len) - 0.01) / 16));
              for (let b = b0; b <= b1; b++) bars[b].add(pc(n.pitch));
            }
          }
        }
        return bars;
      });
    },
    // the section a lead hook is best judged in: a drop where chords also play, else any
    hookSection() {
      const lead = F.track('lead');
      const good = (x) => F.plays(lead, x) && F.harmony(x).some((b) => b.size >= 2);
      return F.of('drop').find(good) || secs.find(good) || null;
    },
    outOfKey(t) { return F.notes(t).filter((n) => !F.pcs.has(pc(n.pitch))); },
    // drum hits of some voices in a pattern
    hits(q, voices) { return q ? q.hits.filter((x) => voices.includes(x.v)) : []; },
    // the section before x, if it builds into it
    before(x) { return x && x.i > 0 ? secs[x.i - 1] : null; },
    // does a section build tension into what follows (riser / noise sweep or a snare roll)?
    builds(x) {
      if (!x) return false;
      const fx = F.tracks('fx').some((t) => F.placed(t, x, 'fx').some((e) => e.type === 'riser' || e.type === 'noiseup'));
      return fx || F.snareRoll(x);
    },
    snareRoll(x) {
      const d = F.track('drums');
      const hs = F.placed(d, x, 'hits').filter((h) => h.v === 'snare' || h.v === 'clap');
      if (hs.length < 16) return false;
      const end = x.bars * 16;
      const late = hs.filter((h) => h.at >= end * 0.75).length;
      const early = hs.filter((h) => h.at < end * 0.25).length;
      return late >= Math.max(6, early * 1.5);
    },
    // automation rising across a section on the master high-pass or a track's filter
    sweeps(x) {
      return p.automation.some((l) => {
        if (!(l.target === 'master' && l.param === 'hpf') && l.param !== 'cutoff') return false;
        const inside = l.points.filter((q) => q.b >= x.start - 0.05 && q.b <= x.end + 0.05);
        if (inside.length < 2) return false;
        const lo = Math.min(...inside.map((q) => q.v));
        const hi = Math.max(...inside.filter((q) => q.b < x.end - 0.01).map((q) => q.v), lo);
        return hi - lo >= 0.25;
      });
    },
    downbeatHit(x) {
      const d = F.track('drums');
      const crash = F.placed(d, x, 'hits').some((h) => h.v === 'crash' && h.at < 1);
      const impact = F.tracks('fx').some((t) => F.placed(t, x, 'fx').some((e) => e.type === 'impact' && e.at < 1));
      return crash || impact;
    },
    kickIn(x) { return F.placed(F.track('drums'), x, 'hits').filter((h) => h.v === 'kick'); },
    // kicks on all four beats in at least `share` of the bars
    fourOnFloor(x, share = 0.75) {
      const ks = F.kickIn(x);
      if (!ks.length) return false;
      let good = 0;
      for (let b = 0; b < x.bars; b++) {
        const beats = [0, 4, 8, 12].filter((s) => ks.some((k) => Math.abs(k.at - (b * 16 + s)) < 0.26)).length;
        if (beats === 4) good++;
      }
      return good >= x.bars * share;
    },
    // in the hook section, lead notes on the beat that are chord tones / a semitone off one
    hookFit() {
      return once('fit', () => {
        const x = F.hookSection();
        const lead = F.track('lead');
        if (!x || !lead) return null;
        const H = F.harmony(x);
        let strong = 0;
        let tones = 0;
        let rubs = 0;
        for (const n of F.placed(lead, x, 'notes')) {
          if (n.at % 4 > 0.01) continue;
          const bar = H[Math.floor(n.at / 16)];
          if (!bar || bar.size < 2) continue;
          strong++;
          const c = pc(n.pitch);
          if (bar.has(c)) tones++;
          else if (bar.has((c + 1) % 12) || bar.has((c + 11) % 12)) rubs++;
        }
        return { x, strong, tones, rubs, share: strong ? tones / strong : 0 };
      });
    },
    range(t) {
      const ns = F.notes(t);
      if (!ns.length) return null;
      const ps = ns.map((n) => n.pitch);
      return { lo: Math.min(...ps), hi: Math.max(...ps), avg: ps.reduce((a, b) => a + b, 0) / ps.length };
    },
    // the sound a synth makes sits `osc.octave` octaves from the written note
    soundingHi(t) {
      const r = F.range(t);
      return r ? r.hi + 12 * ((t.synth && t.synth.osc.octave) || 0) : null;
    },
  };
  return F;
}

// --- shared edits (used by "Do it for me" and "Fix it") -------------------------------------
export function writePart(app, t, pat, gen, { prog = 'anthem', voicing = 'triad', base } = {}) {
  const p = app.project;
  const BASE = { pad: 57, stab: 60, pluck: 57, lead: 60, bass: 57, sub: 57 };
  pat.notes = generate(gen, { key: p.key, scale: p.scale, progId: PROGRESSIONS.some((x) => x.id === prog) ? prog : 'anthem', voicing, bars: pat.bars, base: base ?? BASE[t.role] ?? 57 });
  app.ui.pat[t.id] = pat.id;
  app.patternEdited(t, pat, false);
}

// Where each role usually plays, for parts the coach writes into a song that has no place
// for them yet. Only empty cells are filled.
const HOME = { lead: ['build', 'drop'], pluck: ['intro', 'breakdown', 'drop', 'outro'], pad: ['breakdown', 'build'], stab: ['build', 'drop'], bass: ['drop'], sub: ['intro', 'drop', 'outro'], drums: ['intro', 'build', 'drop', 'outro'], fx: ['build', 'drop'] };

// The pattern to write into for a track: what plays in the first drop / anywhere, else the
// first pattern, else a new one. A pattern that plays nowhere is placed in its usual sections.
export function targetPattern(app, t) {
  const F = facts(app);
  let q = F.main(t);
  if (!q) {
    q = newPattern('A', t.role === 'lead' ? 8 : t.role === 'drums' ? 1 : 4);
    t.patterns.push(q);
  }
  if (!F.used(t).length) {
    for (const x of F.secs) if ((HOME[t.role] || []).includes(x.type) && !x.s.cells[t.id]) x.s.cells[t.id] = q.id;
  }
  return q;
}

// The pattern a track plays in one section; if it plays nothing there, a new pattern is
// made and put in that section.
export function patternIn(app, t, x, { name = 'New', bars } = {}) {
  const F = facts(app);
  let q = F.pat(t, x);
  if (!q) {
    const used = new Set(t.patterns.map((y) => y.name));
    let nm = name;
    for (let k = 2; used.has(nm); k++) nm = `${name} ${k}`;
    q = newPattern(nm, bars || Math.min(16, x.bars));
    t.patterns.push(q);
    x.s.cells[t.id] = q.id;
  }
  return q;
}

// Move notes outside the key to the nearest key note (down on a tie).
export function snapToKey(app, t) {
  const pcs = keyPcs(app.project.key, app.project.scale);
  let n = 0;
  for (const q of facts(app).used(t)) {
    let touched = false;
    for (const x of q.notes) {
      if (pcs.has(pc(x.pitch))) continue;
      x.pitch += pcs.has(pc(x.pitch - 1)) ? -1 : 1;
      n++;
      touched = true;
    }
    if (touched) app.patternEdited(t, q, false);
  }
  return n;
}

// Fold the highest notes of a part down an octave until it spans at most `span` semitones.
// Octave moves keep every note on the same chord tone, so the harmony is untouched.
export function foldRange(app, t, span = 15) {
  const qs = facts(app).used(t);
  const all = qs.flatMap((q) => q.notes);
  if (!all.length) return 0;
  const lo = Math.min(...all.map((n) => n.pitch));
  let moved = 0;
  for (let k = 0; k < 4 && Math.max(...all.map((n) => n.pitch)) - lo > span; k++) {
    for (const n of all) if (n.pitch > lo + span) { n.pitch -= 12; moved++; }
  }
  for (const q of qs) app.patternEdited(t, q, false);
  return moved;
}

// Leave space in a hook: drop the notes in the second half of every other bar, so each
// pair of bars becomes a phrase and its answer with a breath between them.
export function addBreaths(app, t) {
  let removed = 0;
  for (const q of facts(app).used(t)) {
    const before = q.notes.length;
    q.notes = q.notes.filter((n) => { const b = Math.floor(n.start / 16); return !(b % 2 === 1 && n.start - b * 16 >= 9.99); });
    if (q.notes.length !== before) { removed += before - q.notes.length; app.patternEdited(t, q, false); }
  }
  return removed;
}

// Section helpers that keep 8-bar phrasing.
export const roundBars = (b) => Math.max(4, Math.round(b / 4) * 4);
