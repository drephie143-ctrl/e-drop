// The song model: tracks with patterns, sections that say which pattern each track plays,
// automation lanes and the master settings. Plus the starter song template.
import { presetParams, ROLES, deepMerge } from '../audio/presets.js';
import { SYNTH_DEFAULT } from '../audio/synth.js';
import { KIT_DEFAULT, PATTERN_PRESETS, snareRoll } from '../audio/drums.js';

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

export const SECTION_TYPES = {
  intro: { name: 'Intro', color: '#4b6584' },
  breakdown: { name: 'Breakdown', color: '#6c5ce7' },
  build: { name: 'Build', color: '#e1a336' },
  drop: { name: 'Drop', color: '#F06617' },
  break: { name: 'Break', color: '#2d98a6' },
  outro: { name: 'Outro', color: '#57606f' },
};

export const MASTER_DEFAULT = {
  low: 1, mid: 0, high: 1.5, glue: 0.4, drive: 5.5, ceiling: -1, volume: 1,
  revSize: 3.2, revDamp: 0.5, revLevel: 0.9, dlyTime: '3/16', dlyFb: 0.38, dlyLevel: 0.8,
  pumpRelease: 0.45, pumpCurve: 2, pumpFx: 0.5, exportTarget: 'loud',
};

const DEFAULT_PRESET = { lead: 'Festival Supersaw', pluck: 'Progressive Pluck', pad: 'Wide Saw Pad', stab: 'Festival Stab', bass: 'Big Room Bass', sub: 'Clean Sub' };
const DEFAULT_MIX = {
  lead: { vol: 0.8, rev: 0.25, dly: 0.18, duck: 0.6 },
  pluck: { vol: 0.65, rev: 0.3, dly: 0.3, duck: 0.5, pan: 0 },
  pad: { vol: 0.55, rev: 0.4, dly: 0, duck: 0.8 },
  stab: { vol: 0.6, rev: 0.2, dly: 0.1, duck: 0.7 },
  bass: { vol: 0.7, rev: 0, dly: 0, duck: 0.85 },
  sub: { vol: 0.75, rev: 0, dly: 0, duck: 0.95 },
  drums: { vol: 0.85, rev: 0.08, dly: 0, duck: 0 },
  fx: { vol: 0.6, rev: 0.35, dly: 0.1, duck: 0.15 },
};

export function newPattern(name = 'A', bars = 4) {
  return { id: uid(), name, bars, notes: [], hits: [], fx: [] };
}

export function newTrack(role, name) {
  const t = {
    id: uid(), role, name: name || ROLES[role].short, color: ROLES[role].color,
    mix: { vol: 0.7, pan: 0, mute: false, solo: false, rev: 0.1, dly: 0, duck: 0.5, ...DEFAULT_MIX[role] },
    patterns: [],
  };
  if (role === 'drums') t.kit = structuredClone(KIT_DEFAULT);
  else if (role !== 'fx') { t.preset = DEFAULT_PRESET[role]; t.synth = presetParams(t.preset); }
  return t;
}

export function blankProject(name = 'New song') {
  return {
    id: uid(), name, bpm: 128, key: 5, scale: 'minor', tracks: [], sections: [], automation: [],
    master: { ...MASTER_DEFAULT }, created: Date.now(), updated: Date.now(), v: 1,
  };
}

export function addSection(p, type, bars, at = p.sections.length) {
  const s = { id: uid(), type, name: SECTION_TYPES[type].name, bars, cells: {} };
  p.sections.splice(at, 0, s);
  return s;
}

export function presetHits(name) {
  const pr = PATTERN_PRESETS.find((x) => x.name === name);
  return pr ? pr.hits() : [];
}

// Bring a stored project up to the current shape.
export function normalize(p) {
  const b = blankProject();
  p.master = { ...b.master, ...p.master };
  p.automation = p.automation || [];
  for (const t of p.tracks) {
    t.mix = { ...newTrack(t.role).mix, ...t.mix };
    if (t.role === 'drums') t.kit = deepMerge(structuredClone(KIT_DEFAULT), t.kit || {});
    else if (t.role !== 'fx') t.synth = deepMerge(structuredClone(SYNTH_DEFAULT), t.synth || {});
    for (const pat of t.patterns) { pat.notes = pat.notes || []; pat.hits = pat.hits || []; pat.fx = pat.fx || []; }
  }
  return p;
}

// A ready-to-fill festival song: every track, the usual sections, drums and FX already in,
// and the build sweep automated. The melodic patterns start empty.
export function templateProject(name = 'New song') {
  const p = blankProject(name);
  const roles = ['lead', 'pluck', 'pad', 'stab', 'bass', 'sub', 'drums', 'fx'];
  const T = {};
  for (const r of roles) { T[r] = newTrack(r); p.tracks.push(T[r]); }
  for (const r of ['lead', 'pluck', 'pad', 'stab', 'bass', 'sub']) T[r].patterns.push(newPattern('A', r === 'lead' ? 8 : 4));
  const dIntro = { ...newPattern('Intro', 1), hits: presetHits('Intro kick + hats') };
  const dDrop = { ...newPattern('Drop', 8), hits: dropDrums() };
  const dRoll = { ...newPattern('Roll', 8), hits: snareRoll(8) };
  const dBreak = { ...newPattern('Break', 1), hits: presetHits('Breakdown (no kick)') };
  T.drums.patterns.push(dIntro, dDrop, dRoll, dBreak);
  const fBuild = { ...newPattern('Build', 8), fx: [{ type: 'riser', s: 0, len: 128 }, { type: 'noiseup', s: 64, len: 64 }] };
  const fDrop = { ...newPattern('Drop', 16), fx: [{ type: 'impact', s: 0, len: 64 }, { type: 'subdrop', s: 0, len: 32 }] };
  const fBreak = { ...newPattern('Break', 8), fx: [{ type: 'downlifter', s: 0, len: 32 }, { type: 'reverse', s: 112, len: 16 }] };
  T.fx.patterns.push(fBuild, fDrop, fBreak);
  const A = (r) => T[r].patterns[0].id;
  const sec = (type, bars, cells) => { const s = addSection(p, type, bars); for (const [r, id] of Object.entries(cells)) s.cells[T[r].id] = id; return s; };
  sec('intro', 8, { pluck: A('pluck'), drums: dIntro.id, sub: A('sub') });
  sec('breakdown', 8, { pad: A('pad'), pluck: A('pluck'), drums: dBreak.id, fx: fBreak.id });
  const build = sec('build', 8, { lead: A('lead'), stab: A('stab'), pad: A('pad'), drums: dRoll.id, fx: fBuild.id });
  sec('drop', 16, { lead: A('lead'), stab: A('stab'), bass: A('bass'), sub: A('sub'), drums: dDrop.id, fx: fDrop.id });
  sec('outro', 8, { pluck: A('pluck'), drums: dIntro.id, sub: A('sub') });
  buildSweep(p, p.sections.indexOf(build), T.lead.id);
  return p;
}

export function dropDrums() {
  const hits = presetHits('Big room drop');
  const out = [];
  for (let b = 0; b < 8; b++) for (const h of hits) out.push({ ...h, s: h.s + b * 16 });
  out.push({ v: 'crash', s: 0, vel: 1 });
  return out;
}

// One-tap build-up automation over a section: master high-pass rises, the lead's filter
// opens, the lead's reverb send swells, then everything snaps back on the drop.
export function buildSweep(p, si, leadId) {
  let start = 0;
  for (let i = 0; i < si; i++) start += p.sections[i].bars;
  const end = start + p.sections[si].bars;
  const lane = (target, param) => {
    let l = p.automation.find((x) => x.target === target && x.param === param);
    if (!l) { l = { id: uid(), target, param, points: [] }; p.automation.push(l); }
    return l;
  };
  // Replace the lane inside [start, end] and hold the old curve on both sides, so a sweep
  // never bends the lane outside its own section.
  const put = (l, pts) => putRange(l, start, end, pts);
  put(lane('master', 'hpf'), [{ b: start, v: 0 }, { b: start + (end - start) * 0.5, v: 0.25 }, { b: end - 0.05, v: 0.6 }, { b: end, v: 0 }]);
  if (leadId) {
    put(lane(leadId, 'cutoff'), [{ b: start, v: 0.42 }, { b: end - 0.05, v: 0.97 }, { b: end, v: 1 }]);
    put(lane(leadId, 'rev'), [{ b: start, v: 0.2 }, { b: end - 0.05, v: 0.7 }, { b: end, v: 0.22 }]);
  }
}

export function putRange(l, start, end, pts) {
  const old = l.points;
  const before = old.filter((pt) => pt.b < start - 0.03);
  const after = old.filter((pt) => pt.b > end + 0.03);
  const out = [...before];
  if (before.length) out.push({ b: start - 0.02, v: valueAt(old, start - 0.02) });
  out.push(...pts);
  if (after.length) out.push({ b: after[0].b - 0.02, v: pts[pts.length - 1].v });
  out.push(...after);
  l.points = out.sort((a, b) => a.b - b.b);
}

function valueAt(points, bar) {
  if (!points.length) return 0;
  if (bar <= points[0].b) return points[0].v;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (bar <= b.b) return b.b === a.b ? b.v : a.v + ((bar - a.b) / (b.b - a.b)) * (b.v - a.v);
  }
  return points[points.length - 1].v;
}
