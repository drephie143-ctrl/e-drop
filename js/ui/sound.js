// Sound tab: the synth editor for the selected track. Every module has a visual editor
// (graphs-sound.js) beside its sliders; both edit the same model and follow each other live.
import { h, card, seg, chip, select, field, fmtPct, fmtSec, fmtHz } from './dom.js';
import { ARP_MODES, ARP_RATES } from '../music/theory.js';
import { PRESETS, presetsFor, presetParams, ROLES } from '../audio/presets.js';
import { MELODIC, trackChips } from './screens.js';
import * as G from './graphs-sound.js';

// --- Sound -----------------------------------------------------------------------------------
export function renderSound(app, root) {
  const p = app.project;
  let t = p.tracks.find((x) => x.id === app.ui.track && MELODIC.has(x.role)) || p.tracks.find((x) => MELODIC.has(x.role));
  if (!t) { root.replaceChildren(h('div', { class: 'empty' }, 'No synth tracks. Add one in Mix.')); return; }
  app.ui.track = t.id;
  if (app.ui.audition === undefined) app.ui.audition = true;
  const s = t.synth;
  const ed = G.soundEditor(app, t);
  const S = (label, obj, key, min, max, step, fmt, o) => ed.slider(label, obj, key, min, max, step, fmt, o);
  const L = (label, obj, key, min, max, fmt, o) => ed.logSlider(label, obj, key, min, max, fmt, o);
  const waves = [['sawtooth', 'Saw'], ['square', 'Square'], ['triangle', 'Tri'], ['sine', 'Sine']];
  // buttons that change the shape of the screen still re-render; they audition the result first
  const pick = (fn, kind) => (v) => { fn(v); ed.commit(kind); app.render(); };
  const presets = presetsFor(t.role);
  const low = t.role === 'sub' || t.role === 'bass';

  // gate step buttons stay under the gate graph, column for column, and update in place
  const gateBtns = s.gate.pattern.map((on, i) => h('button', {
    class: 'step' + (on ? ' on' : '') + (i % 4 === 0 ? ' beat' : ''), 'aria-label': `Gate step ${i + 1}`, 'aria-pressed': String(!!on),
    onclick: () => { s.gate.pattern[i] = s.gate.pattern[i] ? 0 : 1; syncGate(); ed.redrawAll(); ed.commit('gate'); },
  }));
  const syncGate = () => gateBtns.forEach((b, i) => { b.classList.toggle('on', !!s.gate.pattern[i]); b.setAttribute('aria-pressed', String(!!s.gate.pattern[i])); });
  const gateBox = G.gateGraph(ed, { onToggle: () => syncGate() });
  gateBox.insertBefore(h('div', { class: 'gate' }, gateBtns), gateBox.lastChild);

  root.replaceChildren(h('div', { class: 'stack sound-stack' },
    trackChips(app, (x) => MELODIC.has(x.role), (x) => { app.ui.track = x.id; app.render(); }),
    card(`${ROLES[t.role].name} presets`,
      h('div', { class: 'chips' }, presets.map((pr) => chip(pr.name, t.preset === pr.name, () => { t.preset = pr.name; t.synth = presetParams(pr.name); app.soundChanged(t); app.render(); app.preview(t, 60 + (low ? -24 : 0), 0.6); }))),
      field('Any preset', select([['', '—'], ...PRESETS.map((pr) => [pr.name, `${pr.name} (${ROLES[pr.role].short})`])], presets.some((x) => x.name === t.preset) ? '' : t.preset || '', (v) => { if (!v) return; t.preset = v; t.synth = presetParams(v); app.soundChanged(t); app.render(); }, 'All presets')),
      h('div', { class: 'row sg-play' },
        h('button', { class: 'btn', onclick: () => app.preview(t, low ? 41 : 65, 0.8) }, '▶ Note'),
        h('button', { class: 'btn', onclick: () => { for (const m of [65, 68, 72]) app.preview(t, m - (low ? 24 : 0), 0.9); } }, '▶ Chord'),
        G.auditionChip(app)),
      h('p', { class: 'hint sg-tip' }, 'Drag the graphs or use the ◀ ▶ arrows. Double-tap a graph handle to put it back to the preset.')),
    card('Oscillator 1 · unison', G.split(
      [G.unisonGraph(ed)],
      [seg(waves, s.osc.wave, pick((v) => { s.osc.wave = v; })),
        S('Voices', s.osc, 'voices', 1, 9, 1, (v) => `${v}`),
        S('Detune', s.osc, 'detune', 0, 1, 0.01, (v) => `±${Math.round(v * 55)} ct`),
        S('Stereo', s.osc, 'spread', 0, 1, 0.01, fmtPct),
        S('Octave', s.osc, 'octave', -2, 2, 1, (v) => `${v > 0 ? '+' : ''}${v}`),
        S('Level', s.osc, 'level', 0, 1, 0.01, fmtPct)])),
    card('Oscillator 2, sub and noise', G.split(
      [G.mixerGraph(ed)],
      [seg(waves, s.osc2.wave, pick((v) => { s.osc2.wave = v; })),
        S('Level', s.osc2, 'level', 0, 1, 0.01, fmtPct),
        S('Octave', s.osc2, 'octave', -2, 2, 1, (v) => `${v > 0 ? '+' : ''}${v}`),
        S('Semitone', s.osc2, 'semi', -12, 12, 1, (v) => `${v > 0 ? '+' : ''}${v}`),
        S('Voices', s.osc2, 'voices', 1, 5, 1, String),
        S('Detune', s.osc2, 'detune', 0, 1, 0.01, (v) => `±${Math.round(v * 55)} ct`),
        S('Sub', s, 'sub', 0, 1, 0.01, fmtPct),
        S('Noise', s, 'noise', 0, 1, 0.01, fmtPct)])),
    card('Filter', G.split(
      [G.filterGraph(ed), G.filterEnvGraph(ed)],
      [seg([['lowpass', 'Low-pass'], ['bandpass', 'Band'], ['highpass', 'High-pass'], ['off', 'Off']], s.filter.type, pick((v) => { s.filter.type = v; })),
        L('Cutoff', s.filter, 'cutoff', 40, 16000, fmtHz),
        S('Resonance', s.filter, 'res', 0.3, 12, 0.1, (v) => v.toFixed(1)),
        S('Env amount', s.filter, 'env', 0, 6, 0.1, (v) => `${v.toFixed(1)} oct`),
        L('Attack', s.filter, 'a', 0.001, 3, fmtSec),
        L('Decay', s.filter, 'd', 0.01, 4, fmtSec),
        S('Sustain', s.filter, 's', 0, 1, 0.01, fmtPct),
        seg([[12, '12 dB'], [24, '24 dB']], s.filter.slope, pick((v) => { s.filter.slope = v; }), 'mini')])),
    card('Amp envelope', G.split(
      [G.ampEnvGraph(ed)],
      [L('Attack', s.amp, 'a', 0.001, 3, fmtSec),
        L('Decay', s.amp, 'd', 0.01, 4, fmtSec),
        S('Sustain', s.amp, 's', 0, 1, 0.01, fmtPct),
        L('Release', s.amp, 'r', 0.01, 4, fmtSec),
        S('Volume', s, 'level', 0, 1, 0.01, fmtPct)])),
    card('Pitch, glide and character', G.split(
      [h('div', { class: 'sg-trio' }, G.pitchEnvGraph(ed), G.driveGraph(ed), G.widthGraph(ed))],
      [S('Pitch env', s.pitchEnv, 'amt', -12, 12, 1, (v) => `${v > 0 ? '+' : ''}${v} st`),
        L('Pitch decay', s.pitchEnv, 'decay', 0.005, 0.5, fmtSec),
        h('div', { class: 'row' }, chip('Mono', s.mono, pick((v) => { s.mono = v; })), h('span', { class: 'hint' }, 'Mono + glide slides between overlapping notes.')),
        S('Glide', s, 'glide', 0, 0.4, 0.005, fmtSec),
        S('Distortion', s, 'drive', 0, 1, 0.01, fmtPct),
        S('Width', s, 'width', 0, 2, 0.01, (v) => (v < 0.02 ? 'Mono' : fmtPct(v)))])),
    card('Arpeggiator', G.split(
      [G.arpGraph(ed)],
      [h('div', { class: 'row' }, chip('On', s.arp.on, pick((v) => { s.arp.on = v; }, 'arp')), h('span', { class: 'hint' }, 'Hold chords in the piano roll; the arp plays them.')),
        seg(Object.keys(ARP_RATES).map((r) => [r, r]), s.arp.rate, pick((v) => { s.arp.rate = v; }, 'arp'), 'mini'),
        seg(ARP_MODES.map((m) => [m, m === 'updown' ? 'Up-down' : m[0].toUpperCase() + m.slice(1)]), s.arp.mode, pick((v) => { s.arp.mode = v; }, 'arp'), 'mini wrap'),
        seg([[1, '1 oct'], [2, '2 oct'], [3, '3 oct']], s.arp.octaves, pick((v) => { s.arp.octaves = v; }, 'arp'), 'mini'),
        S('Gate', s.arp, 'gate', 0.1, 1, 0.01, fmtPct, { kind: 'arp' })])),
    card('Trance gate', G.split(
      [gateBox],
      [h('div', { class: 'row' }, chip('On', s.gate.on, pick((v) => { s.gate.on = v; }, 'gate')), seg([['1/8', '1/8'], ['1/16', '1/16'], ['1/32', '1/32']], s.gate.rate, pick((v) => { s.gate.rate = v; }, 'gate'), 'mini')),
        seg([['square', 'Hard'], ['pluck', 'Pluck']], s.gate.shape, pick((v) => { s.gate.shape = v; }, 'gate'), 'mini'),
        S('Depth', s.gate, 'depth', 0, 1, 0.01, fmtPct, { kind: 'gate' })]))));
}
