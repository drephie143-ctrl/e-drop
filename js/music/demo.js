// The demo song that opens on first launch: F minor, 128 BPM, the vi–IV–I–V festival
// progression (Fm – Db – Ab – Eb). Intro → build → drop → breakdown → build → drop → outro,
// about 2:15, with risers, snare rolls, a filter sweep into each drop and sidechain pump.
import { blankProject, newTrack, newPattern, addSection, presetHits, dropDrums, buildSweep, putRange, uid } from './project.js';
import { generate } from './theory.js';
import { snareRoll } from '../audio/drums.js';
import { presetParams } from '../audio/presets.js';

export function demoProject() {
  const p = blankProject('Demo: Main Stage Anthem');
  p.id = 'demo'; // reloading the demo replaces it instead of adding copies
  const K = { key: p.key, scale: p.scale, progId: 'anthem' };
  const T = {};
  const add = (role, name, preset) => {
    const t = newTrack(role, name);
    if (preset) { t.preset = preset; t.synth = presetParams(preset); }
    p.tracks.push(t);
    T[role] = t;
    return t;
  };
  const pat = (t, name, bars, notes) => { const x = { ...newPattern(name, bars), notes }; t.patterns.push(x); return x; };

  add('lead', 'Lead', 'Festival Supersaw');
  add('pluck', 'Pluck', 'Progressive Pluck');
  add('pad', 'Pad', 'Wide Saw Pad');
  add('stab', 'Stab', 'Festival Stab');
  add('bass', 'Bass', 'Big Room Bass');
  add('sub', 'Sub', 'Clean Sub');
  add('drums', 'Drums');
  add('fx', 'FX');

  const hook = pat(T.lead, 'Hook', 8, generate('melody', { ...K, voicing: 'triad', bars: 8, base: 60 }));
  const arp = pat(T.pluck, 'Arp', 4, generate('arp', { ...K, voicing: 'triad', bars: 4, base: 57 }));
  const pad = pat(T.pad, 'Chords', 4, generate('chords', { ...K, voicing: 'open', bars: 4, base: 57 }));
  const stabOff = pat(T.stab, 'Off-beat', 4, generate('stabs', { ...K, voicing: 'triad', bars: 4, base: 60 }));
  const stabBig = pat(T.stab, 'Big room', 4, generate('bounce', { ...K, voicing: 'power', bars: 4, base: 57 }));
  const bass = pat(T.bass, 'Off-beat', 4, generate('offbass', { ...K, voicing: 'triad', bars: 4 }));
  const sub = pat(T.sub, 'Roots', 4, generate('sub', { ...K, voicing: 'triad', bars: 4 }));

  const d = T.drums;
  const dIntro = { ...newPattern('Intro', 1), hits: presetHits('Intro kick + hats') };
  const dDrop = { ...newPattern('Drop', 8), hits: dropDrums() };
  const dRoll = { ...newPattern('Roll', 8), hits: snareRoll(8) };
  const dBreak = { ...newPattern('Break', 1), hits: presetHits('Breakdown (no kick)') };
  const dGroove = { ...newPattern('Groove', 1), hits: presetHits('Progressive groove') };
  d.patterns.push(dIntro, dGroove, dDrop, dRoll, dBreak);

  const f = T.fx;
  const fBuild = { ...newPattern('Build', 8), fx: [{ type: 'riser', s: 0, len: 128 }, { type: 'noiseup', s: 64, len: 64 }] };
  const fDrop = { ...newPattern('Drop', 16), fx: [{ type: 'impact', s: 0, len: 64 }, { type: 'subdrop', s: 0, len: 32 }] };
  const fBreak = { ...newPattern('Break', 8), fx: [{ type: 'downlifter', s: 0, len: 32 }, { type: 'reverse', s: 112, len: 16 }] };
  const fOut = { ...newPattern('Outro', 8), fx: [{ type: 'impact', s: 0, len: 32 }] };
  f.patterns.push(fBuild, fDrop, fBreak, fOut);

  const sec = (type, bars, cells, name) => {
    const s = addSection(p, type, bars);
    if (name) s.name = name;
    for (const [r, x] of Object.entries(cells)) s.cells[T[r].id] = x.id;
    return s;
  };
  sec('intro', 8, { pluck: arp, drums: dIntro });
  const b1 = sec('build', 8, { lead: hook, pad, drums: dRoll, fx: fBuild });
  sec('drop', 16, { lead: hook, stab: stabBig, bass, sub, drums: dDrop, fx: fDrop, pluck: arp });
  sec('breakdown', 8, { pad, pluck: arp, drums: dBreak, fx: fBreak });
  const b2 = sec('build', 8, { lead: hook, pad, stab: stabOff, drums: dRoll, fx: fBuild }, 'Build 2');
  sec('drop', 16, { lead: hook, stab: stabBig, bass, sub, drums: dDrop, fx: fDrop, pluck: arp }, 'Drop 2');
  sec('outro', 8, { pluck: arp, drums: dGroove, sub, fx: fOut });

  buildSweep(p, p.sections.indexOf(b1), T.lead.id);
  buildSweep(p, p.sections.indexOf(b2), T.lead.id);

  // the intro pluck opens up over 8 bars; the outro fades the pluck back down
  const lane = { id: uid(), target: T.pluck.id, param: 'cutoff', points: [] };
  putRange(lane, 0, 8, [{ b: 0, v: 0.45 }, { b: 7.9, v: 0.9 }, { b: 8, v: 1 }]);
  putRange(lane, 64, 72, [{ b: 64, v: 1 }, { b: 72, v: 0.4 }]);
  p.automation.push(lane);
  return p;
}
