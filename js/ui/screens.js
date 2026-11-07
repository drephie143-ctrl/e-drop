// Notes (piano roll + chord helper + FX events), Drums, Sound (synth editor) and Mix screens.
import { h, card, slider, seg, chip, select, field, openSheet, closeSheet, toast, fmtPct, fmtDb, fmtSec, fmtHz } from './dom.js';
import { NOTE_NAMES, SCALES, PROGRESSIONS, VOICINGS, GENERATORS, generate, ARP_MODES, ARP_RATES, noteName, progKey, progressionChords, spell } from '../music/theory.js';
import { newPattern, newTrack, uid } from '../music/project.js';
import { PRESETS, presetsFor, presetParams, ROLES } from '../audio/presets.js';
import { VOICES, KICKS, PATTERN_PRESETS, snareRoll, kickHz } from '../audio/drums.js';
import { FX_TYPES, DELAY_TIMES } from '../audio/fx.js';

const MELODIC = new Set(['lead', 'pluck', 'pad', 'stab', 'bass', 'sub']);

function trackChips(app, filter, onPick) {
  const p = app.project;
  return h('div', { class: 'chips scroll' }, p.tracks.filter(filter).map((t) => h('button', {
    class: 'chip tchip' + (t.id === app.ui.track ? ' on' : ''), style: { '--c': t.color }, onclick: () => onPick(t),
  }, h('span', { class: 'dot', style: { background: t.color } }), t.name)));
}

export function curPattern(app, t) {
  if (!t) return null;
  let pat = t.patterns.find((x) => x.id === app.ui.pat[t.id]);
  if (!pat) {
    const sec = app.project.sections[app.ui.section];
    pat = (sec && t.patterns.find((x) => x.id === sec.cells[t.id])) || t.patterns[0];
  }
  if (!pat) { pat = newPattern('A', t.role === 'drums' ? 1 : 4); t.patterns.push(pat); }
  app.ui.pat[t.id] = pat.id;
  return pat;
}

function patternBar(app, t, pat) {
  const dup = () => {
    const c = { ...structuredClone(pat), id: uid(), name: nextName(t) };
    t.patterns.push(c);
    app.ui.pat[t.id] = c.id;
    app.changed();
    toast(`Copied to pattern ${c.name}. Assign it to a section in Song.`);
  };
  return h('div', { class: 'row pbar' },
    select(t.patterns.map((x) => [x.id, `${x.name} · ${x.bars} bar${x.bars > 1 ? 's' : ''}`]), pat.id, (v) => { app.ui.pat[t.id] = v; app.render(); }, 'Pattern'),
    h('button', { class: 'chip', onclick: () => { const n = newPattern(nextName(t), pat.bars); t.patterns.push(n); app.ui.pat[t.id] = n.id; app.changed(); } }, '+ New'),
    h('button', { class: 'chip', onclick: dup }, 'Copy'),
    h('button', { class: 'chip', onclick: () => patternSheet(app, t, pat) }, 'Edit…'));
}

const nextName = (t) => { for (let i = 0; i < 26; i++) { const n = String.fromCharCode(65 + i); if (!t.patterns.some((x) => x.name === n)) return n; } return 'P' + t.patterns.length; };

function patternSheet(app, t, pat) {
  const p = app.project;
  const used = p.sections.filter((s) => s.cells[t.id] === pat.id).map((s) => s.name);
  openSheet(`Pattern ${pat.name}`,
    field('Name', h('input', { type: 'text', value: pat.name, maxlength: 16, onchange: (e) => { pat.name = e.target.value.trim() || pat.name; app.changed(); } })),
    field('Length', seg([1, 2, 4, 8, 16].map((b) => [b, `${b} bar${b > 1 ? 's' : ''}`]), pat.bars, (v) => { pat.bars = v; closeSheet(); app.patternEdited(t, pat, true); })),
    MELODIC.has(t.role) ? h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { pat.notes.forEach((n) => { n.pitch += 12; }); closeSheet(); app.patternEdited(t, pat, true); } }, 'Octave up'),
      h('button', { class: 'btn', onclick: () => { pat.notes.forEach((n) => { n.pitch -= 12; }); closeSheet(); app.patternEdited(t, pat, true); } }, 'Octave down')) : null,
    h('p', { class: 'hint' }, used.length ? `Plays in: ${used.join(', ')}` : 'Not used in any section yet.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { pat.notes = []; pat.hits = []; pat.fx = []; closeSheet(); app.patternEdited(t, pat, true); } }, 'Clear it'),
      h('button', { class: 'btn danger', disabled: t.patterns.length < 2, onclick: () => {
        if (!confirm(`Delete pattern ${pat.name}?`)) return;
        t.patterns.splice(t.patterns.indexOf(pat), 1);
        for (const s of p.sections) if (s.cells[t.id] === pat.id) s.cells[t.id] = null;
        app.ui.pat[t.id] = t.patterns[0].id;
        closeSheet();
        app.arrangementChanged();
      } }, 'Delete')));
}

// --- Notes -------------------------------------------------------------------------------
export function renderNotes(app, root) {
  const p = app.project;
  let t = p.tracks.find((x) => x.id === app.ui.track && (MELODIC.has(x.role) || x.role === 'fx'));
  if (!t) t = p.tracks.find((x) => MELODIC.has(x.role));
  if (!t) { root.replaceChildren(h('div', { class: 'empty' }, 'Add a synth track in Mix first.')); return; }
  app.ui.track = t.id;
  const chips = trackChips(app, (x) => MELODIC.has(x.role) || x.role === 'fx', (x) => { app.ui.track = x.id; app.render(); });
  const pat = curPattern(app, t);
  if (t.role === 'fx') { root.replaceChildren(chips, patternBar(app, t, pat), fxEditor(app, t, pat)); return; }
  const ui = app.ui;
  const s = t.synth;
  const tools = h('div', { class: 'row tools' },
    seg([[4, '1/4'], [2, '1/8'], [1, '1/16']], ui.grid, (v) => { ui.grid = v; ui.noteLen = v; app.render(); }, 'mini'),
    h('button', { class: 'chip on-accent', onclick: () => chordSheet(app, t, pat) }, 'Chords & parts'),
    chip('Arp', s.arp.on, (v) => { s.arp.on = v; app.soundChanged(t); app.render(); toast(v ? `Arpeggiator on: ${s.arp.mode}, ${s.arp.rate}. Settings in Sound.` : 'Arpeggiator off'); }),
    chip('Ghosts', ui.ghosts, (v) => { ui.ghosts = v; app.render(); }));
  root.replaceChildren(chips, patternBar(app, t, pat), tools, app.roll.el,
    h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Tap to add a note · tap a note to delete · drag a note to move · drag its right end to resize · drag empty space to scroll. Tap the keys to hear them.'));
  app.roll.set(t, pat, ui.ghosts ? ghostNotes(app, t) : []);
}

// Notes the other synth tracks play in the selected section, to write against.
function ghostNotes(app, t) {
  const p = app.project;
  const sec = p.sections[app.ui.section];
  if (!sec) return [];
  const out = [];
  for (const o of p.tracks) {
    if (o === t || !MELODIC.has(o.role) || o.role === 'sub' || o.role === 'bass') continue;
    const pat = o.patterns.find((x) => x.id === sec.cells[o.id]);
    if (pat) out.push(...pat.notes);
  }
  return out;
}

const DEFAULT_GEN = { pad: 'chords', stab: 'stabs', bass: 'offbass', sub: 'sub', pluck: 'arp', lead: 'melody' };
const BASE = { pad: 57, stab: 60, pluck: 57, lead: 60, bass: 57, sub: 57 };

function chordSheet(app, t, pat) {
  const p = app.project;
  const st = app.ui.chord;
  if (!st.gen || !GENERATORS[st.gen]) st.gen = DEFAULT_GEN[t.role] || 'chords';
  const prog = PROGRESSIONS.find((x) => x.id === st.prog) || PROGRESSIONS[0];
  const k = progKey(p.key, p.scale, prog);
  const names = progressionChords(k.key, k.scale, prog, 'triad').map((c) => chordLabel(c, p.key, p.scale));
  const write = (track, target, gen) => {
    const bars = target.bars;
    target.notes = generate(gen, { key: p.key, scale: p.scale, progId: prog.id, voicing: st.voicing, bars, barsPer: st.barsPer, base: (BASE[track.role] || 57) + st.octave * 12 });
  };
  const body = () => [
    h('p', { class: 'hint' }, `Song key: ${NOTE_NAMES[p.key]} ${SCALES[p.scale].name}. Change it from the key button at the top.`),
    field('Progression', h('div', { class: 'list' }, PROGRESSIONS.map((x) => h('button', { class: 'mi' + (x.id === prog.id ? ' on' : ''), onclick: () => { st.prog = x.id; chordSheet(app, t, pat); } },
      x.label, h('small', {}, x.note))))),
    h('div', { class: 'prog-names' }, names.map((n) => h('span', {}, n))),
    field('Voicing', seg(Object.entries(VOICINGS).map(([id, v]) => [id, v.name]), st.voicing, (v) => { st.voicing = v; chordSheet(app, t, pat); }, 'wrap')),
    field('Each chord lasts', seg([[0.5, '½ bar'], [1, '1 bar'], [2, '2 bars']], st.barsPer, (v) => { st.barsPer = v; chordSheet(app, t, pat); })),
    field('Octave', seg([[-1, 'Lower'], [0, 'Normal'], [1, 'Higher']], st.octave, (v) => { st.octave = v; chordSheet(app, t, pat); })),
    field(`Write into ${t.name} · pattern ${pat.name} (${pat.bars} bars)`, seg(Object.entries(GENERATORS).map(([id, g]) => [id, g.name]), st.gen, (v) => { st.gen = v; chordSheet(app, t, pat); }, 'wrap')),
    h('button', { class: 'btn primary big', onclick: () => { write(t, pat, st.gen); closeSheet(); app.patternEdited(t, pat, true); toast(`Wrote ${GENERATORS[st.gen].name.toLowerCase()} into ${t.name}`); } }, `Write ${GENERATORS[st.gen].name}`),
    h('button', { class: 'btn big', style: { marginTop: '8px' }, onclick: () => {
      let n = 0;
      for (const tr of p.tracks) {
        if (!MELODIC.has(tr.role)) continue;
        const tp = curPattern(app, tr);
        write(tr, tp, DEFAULT_GEN[tr.role]);
        app.patternEdited(tr, tp, false);
        n++;
      }
      closeSheet();
      app.changed();
      toast(`Filled ${n} tracks from ${prog.label}: chords, stabs, bass, sub, arp and a lead hook`);
    } }, 'Fill every synth track from this'),
    h('p', { class: 'hint' }, 'Fill every synth track writes held chords on the pad, off-beat stabs, an off-beat bass, sub roots, a 16th arp on the pluck and a lead hook, each into its selected pattern.'),
  ];
  openSheet('Chords & parts', ...body());
}

function chordLabel(c, key, scale) {
  const r = c[0];
  const third = (c[1] - r + 12) % 12;
  const fifth = (c[2] - r + 12) % 12;
  const q = third === 3 ? (fifth === 6 ? 'dim' : 'm') : third === 4 ? (fifth === 8 ? '+' : '') : '';
  return spell(r, key, scale) + q;
}

function fxEditor(app, t, pat) {
  const steps = pat.bars * 16;
  const add = (type, s, len) => { pat.fx.push({ type, s, len, vel: 1 }); app.patternEdited(t, pat, true); };
  const list = pat.fx.map((e) => card(null,
    h('div', { class: 'row' }, h('b', { class: 'grow' }, FX_TYPES[e.type].name), h('button', { class: 'chip', onclick: () => app.previewFx(e) }, '▶ Hear'),
      h('button', { class: 'chip danger', onclick: () => { pat.fx.splice(pat.fx.indexOf(e), 1); app.patternEdited(t, pat, true); } }, 'Remove')),
    slider('Starts', e.s / 16, 0, pat.bars - 0.25, 0.25, (v) => { e.s = v * 16; }, (v) => `bar ${(v + 1).toFixed(2)}`, { onChange: () => app.patternEdited(t, pat, true) }),
    slider('Length', e.len / 16, 0.25, pat.bars, 0.25, (v) => { e.len = v * 16; }, (v) => `${v} bars`, { onChange: () => app.patternEdited(t, pat, true) }),
    slider('Level', e.vel ?? 1, 0, 1, 0.01, (v) => { e.vel = v; }, fmtPct, { onChange: () => app.patternEdited(t, pat, true) })));
  return h('div', { class: 'stack' },
    card('Add an effect',
      h('p', { class: 'hint' }, `This pattern is ${pat.bars} bars. Risers and sweeps fill it and peak at the end, ready for the drop. Impacts hit on bar 1.`),
      h('div', { class: 'chips' },
        h('button', { class: 'chip', onclick: () => add('riser', 0, steps) }, '+ Riser'),
        h('button', { class: 'chip', onclick: () => add('noiseup', steps / 2, steps / 2) }, '+ Noise sweep up'),
        h('button', { class: 'chip', onclick: () => add('downlifter', 0, Math.min(steps, 32)) }, '+ Downlifter'),
        h('button', { class: 'chip', onclick: () => add('impact', 0, Math.min(steps, 64)) }, '+ Impact'),
        h('button', { class: 'chip', onclick: () => add('subdrop', 0, Math.min(steps, 32)) }, '+ Sub drop'),
        h('button', { class: 'chip', onclick: () => add('reverse', Math.max(0, steps - 16), 16) }, '+ Reverse cymbal'))),
    list.length ? list : h('div', { class: 'empty' }, 'No effects in this pattern yet.'));
}

// --- Drums ---------------------------------------------------------------------------------
export function renderDrums(app, root) {
  const p = app.project;
  let t = p.tracks.find((x) => x.id === app.ui.track && x.role === 'drums') || p.tracks.find((x) => x.role === 'drums');
  if (!t) {
    root.replaceChildren(h('div', { class: 'empty' }, 'No drum track.'), h('button', { class: 'btn primary big', onclick: () => { p.tracks.push(newTrack('drums')); app.structureChanged(); } }, 'Add drums'));
    return;
  }
  app.ui.track = t.id;
  const pat = curPattern(app, t);
  const ui = app.ui;
  ui.drumPage = Math.min(ui.drumPage, pat.bars - 1);
  const page = ui.drumPage;
  const drums = p.tracks.filter((x) => x.role === 'drums');
  const grid = h('div', { class: 'dgrid' }, VOICES.map((v) => h('div', { class: 'drow' },
    h('button', { class: 'dname', onclick: () => app.preview(t, v.id) }, v.name),
    h('div', { class: 'dcells' }, Array.from({ length: 16 }, (_, i) => {
      const s = page * 16 + i;
      const hs = pat.hits.filter((x) => x.v === v.id && x.s >= s && x.s < s + 1);
      const roll = hs.length > 1 || hs.some((x) => x.s % 1);
      const vel = hs.reduce((a, x) => Math.max(a, x.vel), 0);
      return h('button', {
        class: 'step' + (hs.length ? ' on' : '') + (roll ? ' roll' : '') + (i % 4 === 0 ? ' beat' : ''), 'data-step': i,
        style: hs.length ? { opacity: String(0.45 + 0.55 * vel) } : null,
        'aria-label': `${v.name} step ${s + 1}`,
        onclick: () => {
          if (hs.length) pat.hits = pat.hits.filter((x) => !hs.includes(x));
          else { pat.hits.push({ v: v.id, s, vel: v.id === 'kick' ? 1 : 0.9 }); app.preview(t, v.id); }
          app.patternEdited(t, pat, true);
        },
      });
    })))));
  const kit = t.kit;
  const f = kickHz(p.key, kit.tune);
  const kitCard = card('Kit',
    field('Kick', select(Object.entries(KICKS).map(([k, v]) => [k, v.name]), kit.kick, (v) => { kit.kick = v; app.soundChanged(t); app.preview(t, 'kick'); })),
    slider('Kick tune', kit.tune, -7, 7, 1, (v) => { kit.tune = v; }, (v) => `${v > 0 ? '+' : ''}${v} st · ${kickHz(p.key, v).toFixed(1)} Hz`, { onChange: () => { app.soundChanged(t); app.preview(t, 'kick'); } }),
    h('p', { class: 'hint' }, `The kick is tuned to the key: ${noteName(Math.round(12 * Math.log2(f / 440) + 69))} (${f.toFixed(1)} Hz) with tune at ${kit.tune}.`),
    VOICES.map((v) => slider(v.name, kit.levels[v.id], 0, 1.2, 0.01, (x) => { kit.levels[v.id] = x; }, fmtPct, { onChange: () => app.soundChanged(t) })),
    slider('Hat decay', kit.hatDecay, 0.02, 0.2, 0.005, (x) => { kit.hatDecay = x; }, fmtSec, { onChange: () => { app.soundChanged(t); app.preview(t, 'hat'); } }));
  root.replaceChildren(
    drums.length > 1 ? trackChips(app, (x) => x.role === 'drums', (x) => { app.ui.track = x.id; app.render(); }) : '',
    patternBar(app, t, pat),
    pat.bars > 1 ? seg(Array.from({ length: pat.bars }, (_, i) => [i, `Bar ${i + 1}`]), page, (v) => { ui.drumPage = v; app.render(); }, 'mini wrap') : '',
    grid,
    h('div', { class: 'chips', style: { marginTop: '12px' } },
      PATTERN_PRESETS.map((pr) => h('button', { class: 'chip', onclick: () => {
        const hits = pr.hits();
        pat.hits = [];
        for (let b = 0; b < pat.bars; b += pr.bars) for (const x of hits) pat.hits.push({ ...x, s: x.s + b * 16 });
        app.patternEdited(t, pat, true);
        toast(`${pr.name} on every bar of pattern ${pat.name}`);
      } }, pr.name)),
      h('button', { class: 'chip on-accent', onclick: () => rollSheet(app, t, pat) }, 'Snare roll…')),
    h('div', { style: { height: '12px' } }),
    kitCard);
}

function rollSheet(app, t, pat) {
  const st = app.ui.snare;
  openSheet('Snare roll for a build',
    h('p', { class: 'hint' }, 'Quarter notes, then 8ths, 16ths and 32nds, getting louder, with the last beat left open before the drop.'),
    field('Length', seg([[4, '4 bars'], [8, '8 bars'], [16, '16 bars']], st.bars, (v) => { st.bars = v; rollSheet(app, t, pat); })),
    field('Sound', seg([['snare', 'Snare'], ['clap', 'Clap']], st.voice, (v) => { st.voice = v; rollSheet(app, t, pat); })),
    chip('Kick under it (doubles at the end)', st.kick, (v) => { st.kick = v; rollSheet(app, t, pat); }),
    h('button', { class: 'btn primary big', style: { marginTop: '12px' }, onclick: () => {
      pat.bars = st.bars;
      pat.hits = snareRoll(st.bars, { withKick: st.kick, voice: st.voice });
      closeSheet();
      app.patternEdited(t, pat, true);
      toast(`Snare roll written into pattern ${pat.name}`);
    } }, `Write into pattern ${pat.name}`));
}

// --- Sound -----------------------------------------------------------------------------------
const logS = (label, v, min, max, set, fmt, done) => {
  const toV = (x) => Math.log(x / min) / Math.log(max / min);
  const fromV = (u) => min * (max / min) ** u;
  return slider(label, toV(v), 0, 1, 0.001, (u) => set(fromV(u)), (u) => fmt(fromV(u)), { onChange: done });
};

export function renderSound(app, root) {
  const p = app.project;
  let t = p.tracks.find((x) => x.id === app.ui.track && MELODIC.has(x.role)) || p.tracks.find((x) => MELODIC.has(x.role));
  if (!t) { root.replaceChildren(h('div', { class: 'empty' }, 'No synth tracks. Add one in Mix.')); return; }
  app.ui.track = t.id;
  const s = t.synth;
  const done = () => app.soundChanged(t);
  const S = (label, obj, key, min, max, step, fmt) => slider(label, obj[key], min, max, step, (v) => { obj[key] = v; }, fmt, { onChange: done });
  const L = (label, obj, key, min, max, fmt) => logS(label, obj[key], min, max, (v) => { obj[key] = v; }, fmt, done);
  const waves = [['sawtooth', 'Saw'], ['square', 'Square'], ['triangle', 'Tri'], ['sine', 'Sine']];
  const pick = (fn) => (v) => { fn(v); done(); app.render(); };
  const presets = presetsFor(t.role);
  root.replaceChildren(h('div', { class: 'stack' },
    trackChips(app, (x) => MELODIC.has(x.role), (x) => { app.ui.track = x.id; app.render(); }),
    card(`${ROLES[t.role].name} presets`,
      h('div', { class: 'chips' }, presets.map((pr) => chip(pr.name, t.preset === pr.name, () => { t.preset = pr.name; t.synth = presetParams(pr.name); app.soundChanged(t); app.render(); app.preview(t, 60 + (t.role === 'sub' || t.role === 'bass' ? -24 : 0), 0.6); }))),
      field('Any preset', select([['', '—'], ...PRESETS.map((pr) => [pr.name, `${pr.name} (${ROLES[pr.role].short})`])], presets.some((x) => x.name === t.preset) ? '' : t.preset || '', (v) => { if (!v) return; t.preset = v; t.synth = presetParams(v); app.soundChanged(t); app.render(); }, 'All presets')),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => app.preview(t, t.role === 'sub' || t.role === 'bass' ? 41 : 65, 0.8) }, '▶ Note'),
        h('button', { class: 'btn', onclick: () => { for (const m of [65, 68, 72]) app.preview(t, m - (t.role === 'sub' || t.role === 'bass' ? 24 : 0), 0.9); } }, '▶ Chord'))),
    card('Oscillator 1 · unison',
      seg(waves, s.osc.wave, pick((v) => { s.osc.wave = v; })),
      S('Voices', s.osc, 'voices', 1, 9, 1, (v) => `${v}`),
      S('Detune', s.osc, 'detune', 0, 1, 0.01, (v) => `±${Math.round(v * 55)} ct`),
      S('Stereo', s.osc, 'spread', 0, 1, 0.01, fmtPct),
      S('Octave', s.osc, 'octave', -2, 2, 1, (v) => `${v > 0 ? '+' : ''}${v}`),
      S('Level', s.osc, 'level', 0, 1, 0.01, fmtPct)),
    card('Oscillator 2, sub and noise',
      seg(waves, s.osc2.wave, pick((v) => { s.osc2.wave = v; })),
      S('Level', s.osc2, 'level', 0, 1, 0.01, fmtPct),
      S('Octave', s.osc2, 'octave', -2, 2, 1, (v) => `${v > 0 ? '+' : ''}${v}`),
      S('Semitone', s.osc2, 'semi', -12, 12, 1, (v) => `${v > 0 ? '+' : ''}${v}`),
      S('Voices', s.osc2, 'voices', 1, 5, 1, String),
      S('Detune', s.osc2, 'detune', 0, 1, 0.01, (v) => `±${Math.round(v * 55)} ct`),
      S('Sub', s, 'sub', 0, 1, 0.01, fmtPct),
      S('Noise', s, 'noise', 0, 1, 0.01, fmtPct)),
    card('Filter',
      seg([['lowpass', 'Low-pass'], ['bandpass', 'Band'], ['highpass', 'High-pass'], ['off', 'Off']], s.filter.type, pick((v) => { s.filter.type = v; })),
      L('Cutoff', s.filter, 'cutoff', 40, 16000, fmtHz),
      S('Resonance', s.filter, 'res', 0.3, 12, 0.1, (v) => v.toFixed(1)),
      S('Env amount', s.filter, 'env', 0, 6, 0.1, (v) => `${v.toFixed(1)} oct`),
      L('Attack', s.filter, 'a', 0.001, 3, fmtSec),
      L('Decay', s.filter, 'd', 0.01, 4, fmtSec),
      S('Sustain', s.filter, 's', 0, 1, 0.01, fmtPct),
      seg([[12, '12 dB'], [24, '24 dB']], s.filter.slope, pick((v) => { s.filter.slope = v; }), 'mini')),
    card('Amp envelope',
      L('Attack', s.amp, 'a', 0.001, 3, fmtSec),
      L('Decay', s.amp, 'd', 0.01, 4, fmtSec),
      S('Sustain', s.amp, 's', 0, 1, 0.01, fmtPct),
      L('Release', s.amp, 'r', 0.01, 4, fmtSec),
      S('Volume', s, 'level', 0, 1, 0.01, fmtPct)),
    card('Pitch, glide and character',
      S('Pitch env', s.pitchEnv, 'amt', -12, 12, 1, (v) => `${v > 0 ? '+' : ''}${v} st`),
      L('Pitch decay', s.pitchEnv, 'decay', 0.005, 0.5, fmtSec),
      h('div', { class: 'row' }, chip('Mono', s.mono, pick((v) => { s.mono = v; })), h('span', { class: 'hint' }, 'Mono + glide slides between overlapping notes.')),
      S('Glide', s, 'glide', 0, 0.4, 0.005, fmtSec),
      S('Distortion', s, 'drive', 0, 1, 0.01, fmtPct),
      S('Width', s, 'width', 0, 2, 0.01, (v) => (v < 0.02 ? 'Mono' : fmtPct(v)))),
    card('Arpeggiator',
      h('div', { class: 'row' }, chip('On', s.arp.on, pick((v) => { s.arp.on = v; })), h('span', { class: 'hint' }, 'Hold chords in the piano roll; the arp plays them.')),
      seg(Object.keys(ARP_RATES).map((r) => [r, r]), s.arp.rate, pick((v) => { s.arp.rate = v; }), 'mini'),
      seg(ARP_MODES.map((m) => [m, m === 'updown' ? 'Up-down' : m[0].toUpperCase() + m.slice(1)]), s.arp.mode, pick((v) => { s.arp.mode = v; }), 'mini wrap'),
      seg([[1, '1 oct'], [2, '2 oct'], [3, '3 oct']], s.arp.octaves, pick((v) => { s.arp.octaves = v; }), 'mini'),
      S('Gate', s.arp, 'gate', 0.1, 1, 0.01, fmtPct)),
    card('Trance gate',
      h('div', { class: 'row' }, chip('On', s.gate.on, pick((v) => { s.gate.on = v; })), seg([['1/8', '1/8'], ['1/16', '1/16'], ['1/32', '1/32']], s.gate.rate, pick((v) => { s.gate.rate = v; }), 'mini')),
      seg([['square', 'Hard'], ['pluck', 'Pluck']], s.gate.shape, pick((v) => { s.gate.shape = v; }), 'mini'),
      S('Depth', s.gate, 'depth', 0, 1, 0.01, fmtPct),
      h('div', { class: 'gate' }, s.gate.pattern.map((on, i) => h('button', { class: 'step' + (on ? ' on' : '') + (i % 4 === 0 ? ' beat' : ''), 'aria-label': `Gate step ${i + 1}`, onclick: () => { s.gate.pattern[i] = on ? 0 : 1; done(); app.render(); } }))))));
}

// --- Mix -------------------------------------------------------------------------------------
export function renderMix(app, root) {
  const p = app.project;
  const M = p.master;
  const mm = () => app.mixChanged();
  const MS = (label, key, min, max, step, fmt, obj = M) => slider(label, obj[key], min, max, step, (v) => { obj[key] = v; mm(); }, fmt);
  const meter = card('Loudness',
    h('div', { class: 'meter' },
      h('div', { class: 'mcol' }, h('small', {}, 'Momentary'), h('b', { id: 'lufsM' }, '–'), h('small', {}, 'LUFS')),
      h('div', { class: 'mcol' }, h('small', {}, 'Short-term'), h('b', { id: 'lufsS' }, '–'), h('small', {}, 'LUFS')),
      h('div', { class: 'mcol' }, h('small', {}, 'Peak'), h('b', { id: 'peakDb' }, '–'), h('small', {}, 'dBFS')),
      h('div', { class: 'mcol' }, h('small', {}, 'Limiter'), h('b', { id: 'grDb' }, '–'), h('small', {}, 'dB'))),
    h('div', { class: 'mbar' }, h('div', { id: 'lufsBar' }), h('i', { style: { left: `${((-9 + 40) / 40) * 100}%` }, title: 'Club loud, −9 LUFS' }), h('i', { class: 'soft', style: { left: `${((-14 + 40) / 40) * 100}%` }, title: 'Streaming, −14 LUFS' })),
    h('p', { class: 'hint' }, 'Festival masters sit around −9 to −7 LUFS short-term in the drop. Streaming turns everything down to about −14.'));
  const master = card('Master',
    MS('Low', 'low', -6, 6, 0.1, fmtDb), MS('Mid', 'mid', -6, 6, 0.1, fmtDb), MS('High', 'high', -6, 6, 0.1, fmtDb),
    MS('Glue comp', 'glue', 0, 1, 0.01, fmtPct), MS('Drive', 'drive', 0, 9, 0.1, fmtDb), MS('Ceiling', 'ceiling', -3, -0.1, 0.1, fmtDb), MS('Output', 'volume', 0, 1.2, 0.01, fmtPct));
  const fx = card('Reverb, delay and sidechain',
    slider('Reverb size', M.revSize, 0.8, 6, 0.1, (v) => { M.revSize = v; }, fmtSec, { onChange: () => app.structureChanged() }),
    slider('Damping', M.revDamp, 0, 1, 0.01, (v) => { M.revDamp = v; }, fmtPct, { onChange: () => app.structureChanged() }),
    MS('Reverb level', 'revLevel', 0, 1.5, 0.01, fmtPct),
    field('Delay time (synced)', seg(Object.keys(DELAY_TIMES).map((k) => [k, k]), M.dlyTime, (v) => { M.dlyTime = v; mm(); app.render(); }, 'mini')),
    MS('Feedback', 'dlyFb', 0, 0.85, 0.01, fmtPct),
    MS('Delay level', 'dlyLevel', 0, 1.5, 0.01, fmtPct),
    slider('Pump release', M.pumpRelease, 0.15, 1, 0.01, (v) => { M.pumpRelease = v; }, (v) => `${v.toFixed(2)} beat`, { onChange: () => app.pumpChanged() }),
    slider('Pump curve', M.pumpCurve, 0.6, 4, 0.1, (v) => { M.pumpCurve = v; }, (v) => (v < 1.5 ? 'Smooth' : v < 2.6 ? 'Classic' : 'Hard'), { onChange: () => app.pumpChanged() }),
    MS('Pump on FX', 'pumpFx', 0, 1, 0.01, fmtPct),
    h('p', { class: 'hint' }, 'Every track ducks under the kick by its own Pump amount below, and recovers over the release.'));
  const anySolo = p.tracks.some((t) => t.mix.solo);
  const strips = p.tracks.map((t) => {
    const x = t.mix;
    const S = (label, key, min, max, step, fmt) => slider(label, x[key], min, max, step, (v) => { x[key] = v; mm(); }, fmt);
    const open = app.ui.openStrip === t.id;
    return h('div', { class: 'strip' + (x.mute || (anySolo && !x.solo) ? ' dim' : '') },
      h('div', { class: 'row' },
        h('span', { class: 'dot', style: { background: t.color } }),
        h('button', { class: 'sname grow', onclick: () => { app.ui.openStrip = open ? null : t.id; app.render(); } }, t.name, t.name.startsWith(ROLES[t.role].short) ? null : h('small', {}, ROLES[t.role].short)),
        h('button', { class: 'ms' + (x.mute ? ' m' : ''), onclick: () => { x.mute = !x.mute; mm(); app.render(); } }, 'M'),
        h('button', { class: 'ms' + (x.solo ? ' s' : ''), onclick: () => { x.solo = !x.solo; mm(); app.render(); } }, 'S')),
      S('Volume', 'vol', 0, 1.2, 0.01, fmtPct),
      S('Pump', 'duck', 0, 1, 0.01, fmtPct),
      open ? [S('Pan', 'pan', -1, 1, 0.01, (v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)),
        S('Reverb', 'rev', 0, 1, 0.01, fmtPct), S('Delay', 'dly', 0, 1, 0.01, fmtPct),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => { const n = prompt('Track name', t.name); if (n && n.trim()) { t.name = n.trim().slice(0, 16); app.changed(); } } }, 'Rename'),
          h('button', { class: 'btn danger', onclick: () => {
            if (!confirm(`Delete the ${t.name} track and its patterns?`)) return;
            p.tracks.splice(p.tracks.indexOf(t), 1);
            p.automation = p.automation.filter((l) => l.target !== t.id);
            for (const s of p.sections) delete s.cells[t.id];
            app.structureChanged();
          } }, 'Delete track'))] : h('button', { class: 'more', onclick: () => { app.ui.openStrip = t.id; app.render(); } }, 'Pan, sends, rename…'));
  });
  root.replaceChildren(h('div', { class: 'stack' }, meter, card('Tracks', strips,
    h('button', { class: 'btn', onclick: () => addTrackSheet(app) }, '+ Add track')), master, fx));
}

function addTrackSheet(app) {
  const p = app.project;
  openSheet('Add a track', h('div', { class: 'list' }, Object.entries(ROLES).map(([role, r]) => h('button', { class: 'mi', onclick: () => {
    const t = newTrack(role, `${r.short} ${p.tracks.filter((x) => x.role === role).length + 1}`);
    t.patterns.push(newPattern('A', role === 'drums' ? 1 : 4));
    p.tracks.push(t);
    app.ui.track = t.id;
    closeSheet();
    app.structureChanged();
    toast(`${t.name} added. Put its pattern into a section in Song.`);
  } }, h('span', { class: 'dot', style: { background: r.color } }), ` ${r.name}`))));
}
