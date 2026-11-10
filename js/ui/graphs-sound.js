// Visual editors for the Sound screen (every synth module) and the drum kit. Each graph draws
// what the engine actually plays: the formulas mirror synth.js and drums.js (unison spread,
// biquad responses with the Web Audio Q rules, envelope curve shapes, drive curve, gate
// automation, the kick's pitch sweep). Handles edit the model directly while the linked sliders
// follow; the audio re-renders once, on release, and an optional audition note plays.
import { h, slider, fmtPct, fmtSec, fmtHz } from './dom.js';
import { graph, colors, clamp, logPos, logVal, gridLines, handle, text, curve } from './graph-base.js';
import { unisonOffsets, unisonPan, driveCurve, SYNTH_DEFAULT } from '../audio/synth.js';
import { PRESETS, presetParams } from '../audio/presets.js';
import { KICKS, VOICES, KIT_DEFAULT, kickHz } from '../audio/drums.js';
import { arpeggiate, chordNotes, spell, noteName, mtof } from '../music/theory.js';

const HIT = 22; // handle hit radius in px: big enough for a fingertip
const DBL = 340; // double-tap window (ms) that resets a handle to the preset's value

// --- small utilities ---------------------------------------------------------------------------
const getP = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const setP = (o, path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
const snap = (v, step) => +(Math.round(v / step) * step).toFixed(6);
const signed = (v, unit = '') => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}${unit}`;
const db = (m) => 20 * Math.log10(Math.max(1e-6, m));

export function alpha(hex, a) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex).trim());
  return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})` : hex;
}

const area = (w, hh, { l = 10, r = 10, t = 12, b = 16 } = {}) => {
  const L = l; const R = w - r; const T = t; const B = hh - b;
  return { L, R, T, B, W: R - L, H: B - T, cx: (L + R) / 2, cy: (T + B) / 2 };
};

function rrect(g, x, y, w, hh, r) {
  r = Math.min(r, w / 2, hh / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + hh, r);
  g.arcTo(x + w, y + hh, x, y + hh, r);
  g.arcTo(x, y + hh, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// value bubble shown next to the handle being dragged
function tip(g, s, x, y, w, hh) {
  const c = colors();
  g.font = '700 11px -apple-system, "Segoe UI", system-ui, sans-serif';
  const tw = g.measureText(s).width + 14;
  const tx = clamp(x - tw / 2, 2, w - tw - 2);
  let ty = y - 32;
  if (ty < 2) ty = y + 14;
  ty = clamp(ty, 2, hh - 22);
  rrect(g, tx, ty, tw, 20, 7);
  g.fillStyle = 'rgba(10, 12, 18, .9)';
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = alpha(c.accent, 0.8);
  g.stroke();
  text(g, s, tx + tw / 2, ty + 14, { align: 'center', color: c.text, size: 11, weight: 700 });
}

function dashed(g, pts, color, width = 1.25, dash = [4, 4]) {
  g.save();
  g.setLineDash(dash);
  curve(g, pts, { color, width });
  g.restore();
}

function dot(g, x, y, r, fill, stroke) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  if (stroke) { g.lineWidth = 1.25; g.strokeStyle = stroke; g.stroke(); }
}

// one sample of a waveform at phase 0..1, for the little wave pictures
function waveAt(type, ph, i = 0) {
  if (type === 'sawtooth') return 2 * ((ph + 0.5) % 1) - 1;
  if (type === 'square') return ph < 0.5 ? 1 : -1;
  if (type === 'triangle') return ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4;
  if (type === 'noise') { const x = Math.sin(i * 12.9898 + 4.1) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }
  return Math.sin(2 * Math.PI * ph);
}
function drawWave(g, type, x, y, w, hh, color, { cycles = 2, width = 1.5 } = {}) {
  const N = Math.max(24, Math.round(w * (type === 'noise' ? 0.6 : 1.5)));
  const pts = [];
  for (let i = 0; i <= N; i++) pts.push([x + (i / N) * w, y + hh / 2 - waveAt(type, ((i / N) * cycles) % 1, i) * hh / 2]);
  curve(g, pts, { color, width });
}

// --- the audition note ---------------------------------------------------------------------------
// The note a graph edit plays: the song's root between F#3 and F4 (leads, pads), or two octaves
// lower for bass and sub.
export function auditionNote(app, t) {
  const low = t.role === 'bass' || t.role === 'sub';
  return (low ? 36 : 60) + (((app.project.key + 6) % 12) - 6);
}

let auditionTimers = [];
function stopAudition() { for (const x of auditionTimers) clearTimeout(x); auditionTimers = []; }

function auditionSynth(app, t, kind = 'note') {
  if (app.ui.audition === false || !t.synth) return;
  stopAudition();
  const s = t.synth;
  const p = app.project;
  const root = auditionNote(app, t);
  const st = 15 / p.bpm;
  const play = (m, d, at = 0) => {
    if (at <= 0) app.preview(t, m, d);
    else auditionTimers.push(setTimeout(() => app.preview(t, m, d), at * 1000));
  };
  // long enough to hear the attack and the decay settle, short enough not to get in the way
  const dur = clamp(s.amp.a + Math.min(s.amp.d, 0.5) + 0.3, 0.3, 2.4);
  if (kind === 'arp' && s.arp.on) {
    // the graph's sample chord, moved by whole octaves into the track's range
    const shift = 12 * Math.round((root - sampleChord(app)[0]) / 12);
    for (const n of arpNotes(app, s)) play(n.pitch + shift, Math.max(0.04, n.len * st), n.start * st);
  } else if (kind === 'gate' && s.gate.on) {
    const per = gatePer(s.gate);
    for (let k = 0; k < 16; k++) if (s.gate.pattern[k]) play(root, per * st * (s.gate.shape === 'pluck' ? 0.4 : 0.85), k * per * st);
  } else if (t.role === 'pad' || t.role === 'stab') {
    for (const m of chordNotes(p.key, p.scale, 0, 'triad', root)) play(m, dur);
  } else play(root, dur);
}

// The "Audition" chip: plays a short note after every graph or slider edit (app.ui.audition).
export function auditionChip(app) {
  const el = h('button', {
    class: 'chip sg-audition', title: 'Play a short note after each change',
    onclick: () => {
      app.ui.audition = app.ui.audition === false;
      // on a computer the Sound, Drums kit and FX chips can all be on screen: keep them in step
      for (const x of document.querySelectorAll('.sg-audition')) if (x.__sync) x.__sync();
      if (!app.ui.audition) stopAudition();
    },
  });
  el.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6h2.6L8.5 3v10L5.1 10H2.5z" fill="currentColor"/><path d="M10.6 5.2a4 4 0 0 1 0 5.6M12.5 3.4a6.6 6.6 0 0 1 0 9.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg><span>Audition</span>';
  el.__sync = () => { const on = app.ui.audition !== false; el.classList.toggle('on', on); el.setAttribute('aria-pressed', String(on)); };
  el.__sync();
  return el;
}

// --- the editor: the model, its sliders and its graphs for one track ------------------------------
function makeEditor(app, t, root, { defaults, audition }) {
  const graphs = new Set();
  const sliders = new Map();
  const ed = {
    app, t, root, graphs, sliders,
    // 'filter.cutoff' style path of obj[key] inside the root object
    path(obj, key) {
      if (obj === root) return key;
      for (const [k, v] of Object.entries(root)) if (v === obj) return `${k}.${key}`;
      return null;
    },
    get: (p) => getP(root, p),
    set: (p, v) => setP(root, p, v),
    redrawAll(except) { for (const g of graphs) if (g !== except) g.redraw(); },
    sync(keys) { for (const k of keys || []) { const el = sliders.get(k); if (el) el.sync(); } },
    commit(kind) { app.soundChanged(t); audition(kind); },
    reset(keys, kind) {
      const d = defaults();
      for (const k of keys) { const v = getP(d, k); if (v !== undefined) setP(root, k, structuredClone(v)); }
      ed.sync(keys);
      ed.redrawAll();
      ed.commit(kind);
    },
    // a slider bound to obj[key]; it redraws the graphs on every move and commits on release
    slider(label, obj, key, min, max, step, fmt, { kind, after, inc } = {}) {
      const el = slider(label, obj[key], min, max, step, (v) => { obj[key] = v; ed.redrawAll(); if (after) after(v); }, fmt, { onChange: () => ed.commit(kind), inc });
      el.sync = () => { el.setValue(obj[key]); if (after) after(obj[key]); };
      const p = ed.path(obj, key);
      if (p) sliders.set(p, el);
      return el;
    },
    // the same on a log scale (times, frequencies): the range input runs 0..1
    logSlider(label, obj, key, min, max, fmt, { kind } = {}) {
      const toV = (x) => Math.log(Math.max(min, x) / min) / Math.log(max / min);
      const fromV = (u) => min * (max / min) ** u;
      const el = slider(label, toV(obj[key]), 0, 1, 0.001, (u) => { obj[key] = fromV(u); ed.redrawAll(); }, (u) => fmt(fromV(u)), { onChange: () => ed.commit(kind) });
      el.sync = () => el.setValue(toV(obj[key]));
      const p = ed.path(obj, key);
      if (p) sliders.set(p, el);
      return el;
    },
  };
  return ed;
}

// The synth editor: double-tap resets to the track's preset (or the synth default).
export function soundEditor(app, t) {
  const known = t.preset && PRESETS.some((x) => x.name === t.preset);
  return makeEditor(app, t, t.synth, {
    defaults: () => (known ? presetParams(t.preset) : structuredClone(SYNTH_DEFAULT)),
    audition: (kind) => auditionSynth(app, t, kind),
  });
}

// The drum kit editor: double-tap resets to the default kit; edits audition the voice touched.
export function kitEditor(app, t) {
  return makeEditor(app, t, t.kit, {
    defaults: () => structuredClone(KIT_DEFAULT),
    audition: (kind) => { if (app.ui.audition !== false) app.preview(t, VOICES.some((v) => v.id === kind) ? kind : 'kick'); },
  });
}

// Graphs on one side, controls on the other once the card is wide enough (css/sound.css).
export function split(graphs, controls, cls = '') {
  return h('div', { class: `sg ${cls}` }, h('div', { class: 'sg-in' }, h('div', { class: 'sg-g' }, graphs), h('div', { class: 'sg-c' }, controls)));
}

// --- the editable graph -----------------------------------------------------------------------------
// The nearest handle within its own hit radius (hd.r, default HIT), or -1. A small radius lets
// presses between two close handles reach the body behind them (a short FX event).
function hitTest(hs, pt) {
  let best = -1;
  let bd = Infinity;
  hs.forEach((hd, i) => { const d = Math.hypot(hd.x - pt.x, hd.y - pt.y); if (d <= (hd.r ?? HIT) && d < bd) { bd = d; best = i; } });
  return best;
}

// opts.handles(w, h) → [{ id, x, y, keys, move(pt, d), tip(), color, hidden, r }] (hidden: hit-test only)
// opts.press(pt) → a drag for presses away from the handles, or null; { keys, move, up, hid, now }
// d.start holds the keys' values when the drag began, for relative drags.
function editGraph(ed, { label, small = false, hint, readout, draw, handles = () => [], press, kind, cls = '', pressCursor = 'crosshair' }) {
  let hoverId = null;
  let last = null;
  let self = null;
  const read = h('span', { class: 'sg-read' });
  const start = (keys) => Object.fromEntries((keys || []).map((k) => [k, structuredClone(ed.get(k))]));
  const live = (w, hh) => handles(w, hh).filter(Boolean);
  self = graph({
    height: small ? 'var(--sg-hs, 104px)' : 'var(--sg-h, 132px)',
    label, className: `sg-graph${small ? ' small' : ''} ${cls}`,
    draw(g, w, hh, gr) {
      const hs = live(w, hh);
      const d = gr.drag;
      const act = d ? (d.hd ? d.hd.id : d.hid) : null;
      draw(g, w, hh, { hs, act, drag: d });
      for (const hd of hs) if (!hd.hidden) handle(g, hd.x, hd.y, { active: hd.id === act || hd.id === hoverId, color: hd.color });
      if (d && d.moved && act) {
        const hd = hs.find((x) => x.id === act);
        if (hd && hd.tip) tip(g, hd.tip(), hd.x, hd.y, w, hh);
      }
      if (readout) read.textContent = readout();
    },
    down(pt) {
      const hs = live(pt.w, pt.h);
      const i = hitTest(hs, pt);
      const now = performance.now();
      if (i >= 0) {
        const hd = hs[i];
        if (last && last.id === hd.id && now - last.t < DBL && Math.hypot(pt.x - last.x, pt.y - last.y) < HIT) {
          last = null;
          ed.reset(hd.keys, hd.kind ?? kind);
          return null;
        }
        last = { id: hd.id, t: now, x: pt.x, y: pt.y };
        return { hd, keys: hd.keys, start: start(hd.keys), moved: false, move: hd.move, up: hd.up, kind: hd.kind };
      }
      last = null;
      const d = press ? press(pt) : null;
      if (!d) return null;
      Object.assign(d, { start: start(d.keys), moved: !!d.now });
      if (d.now) { d.move(pt, d); ed.sync(d.keys); ed.redrawAll(self); }
      return d;
    },
    move(pt, d) {
      if (!d.moved && Math.abs(pt.dx) < 3 && Math.abs(pt.dy) < 3) return;
      d.moved = true;
      if (d.move) d.move(pt, d);
      ed.sync(d.keys);
      ed.redrawAll(self);
    },
    up(pt, d) {
      const changed = d.up ? d.up(pt, d) : false;
      if (d.moved || changed) { last = null; ed.commit(d.kind ?? kind); }
    },
    hover(pt) {
      const hs = live(pt.w, pt.h);
      const i = hitTest(hs, pt);
      const id = i >= 0 ? hs[i].id : null;
      if (id !== hoverId) { hoverId = id; self.redraw(); }
      if (i >= 0) return hs[i].cursor || 'grab';
      // '' would fall back to the stylesheet's crosshair, which says "click here" where nothing happens
      return press ? pressCursor : 'default';
    },
  });
  self.canvas.addEventListener('pointerleave', () => { if (hoverId) { hoverId = null; self.redraw(); } });
  ed.graphs.add(self);
  return h('div', { class: 'sg-box' }, self.el, h('div', { class: 'sg-cap' }, read, hint ? h('span', { class: 'sg-hint' }, hint) : null));
}

// =====================================================================================================
// Oscillator 1 · unison: every voice by stereo position (x) and detune (y)
// =====================================================================================================
// Voices exactly as playVoice() lays them out: offsets from unisonOffsets(), pans from unisonPan(),
// the middle voice 15% louder, and each pan rounded to one of five shared panners.
export function unisonVoices(o) {
  const nv = Math.max(1, o.voices | 0);
  const per = (o.level ?? 1) / Math.sqrt(nv);
  return unisonOffsets(nv, o.detune).map((cents, i) => {
    const pan = unisonPan(i, nv, o.spread);
    return { cents, pan, bus: panBus(pan), gain: per * (i === (nv >> 1) ? 1.15 : 1), main: i === (nv >> 1) };
  });
}
function osc2Voices(o2) {
  const n2 = Math.max(1, o2.voices || 1);
  return unisonOffsets(n2, o2.detune || 0).map((cents, i) => {
    const pan = n2 > 1 ? ((i / (n2 - 1)) * 2 - 1) * (o2.spread ?? 0.5) : 0;
    return { cents, pan, bus: panBus(pan), gain: o2.level / Math.sqrt(n2) };
  });
}
const panBus = (pan) => Math.round(clamp(pan, -1, 1) * 2) / 2;

export function unisonGraph(ed) {
  const s = ed.root;
  const geo = (w, hh) => area(w, hh, { l: 16, r: 16, t: 14, b: 18 });
  const keys = ['osc.spread', 'osc.detune'];
  const tipOf = () => `±${Math.round(s.osc.detune * 55)} ct · ${Math.round(s.osc.spread * 100)}%`;
  const setFrom = (A, x, y) => {
    s.osc.spread = clamp(snap(Math.abs(x - A.cx) / (A.W / 2), 0.01), 0, 1);
    s.osc.detune = clamp(snap(Math.abs(A.cy - y) / (A.H / 2), 0.01), 0, 1);
  };
  return editGraph(ed, {
    label: 'Unison voices: stereo position across, detune up and down',
    hint: '↔ stereo · ↕ detune',
    readout: () => { const o = s.osc; return `${o.voices} voice${o.voices > 1 ? 's' : ''} · ±${Math.round(o.detune * 55)} ct · ${Math.round(o.spread * 100)}% stereo`; },
    draw(g, w, hh) {
      const c = colors();
      const A = geo(w, hh);
      const o = s.osc;
      const hx = A.W / 2;
      const hy = A.H / 2;
      // the five shared panners, and the 0-cent line
      for (const k of [-1, -0.5, 0, 0.5, 1]) { g.fillStyle = k === 0 ? 'rgba(141, 151, 171, .3)' : c.grid; g.fillRect(Math.round(A.cx + k * hx), A.T, 1, A.H); }
      g.fillStyle = c.grid;
      g.fillRect(A.L, Math.round(A.cy), A.W, 1);
      text(g, 'L', A.L, hh - 5, { size: 10, align: 'center' });
      text(g, 'R', A.R, hh - 5, { size: 10, align: 'center' });
      text(g, 'centre', A.cx, hh - 5, { size: 9.5, align: 'center' });
      text(g, '+55 ct', A.R + 12, A.T + 3, { size: 9, align: 'right', base: 'middle' });
      text(g, '−55 ct', A.R + 12, A.B - 3, { size: 9, align: 'right', base: 'middle' });
      // the oscillator's waveform, top left, under the voices so it never hides one
      g.fillStyle = 'rgba(10, 12, 18, .75)';
      rrect(g, A.L - 10, 4, 52, 24, 6);
      g.fill();
      drawWave(g, o.wave, A.L - 5, 8, 42, 16, c.text, { width: 1.25 });
      // the cloud: how far the voices reach
      const bx = o.spread * hx;
      const by = o.detune * hy;
      g.fillStyle = alpha(c.accent, 0.07);
      g.fillRect(A.cx - bx, A.cy - by, 2 * bx, 2 * by);
      g.save();
      g.setLineDash([4, 4]);
      g.strokeStyle = alpha(c.accent, 0.5);
      g.lineWidth = 1;
      g.strokeRect(A.cx - bx + 0.5, A.cy - by + 0.5, 2 * bx, 2 * by);
      g.restore();
      // osc 2 and the sub, behind the main stack
      if (s.osc2 && s.osc2.level > 0) for (const v of osc2Voices(s.osc2)) dot(g, A.cx + v.bus * hx, A.cy - (v.cents / 55) * hy, 2.5 + 4 * Math.sqrt(v.gain), alpha(c.blue, 0.55), c.blue);
      if (s.sub > 0) dot(g, A.cx, A.cy, 3 + 5 * Math.sqrt(s.sub), alpha(c.teal, 0.45), c.teal);
      for (const v of unisonVoices(o)) {
        const r = 3 + 6 * Math.sqrt(Math.min(1.2, v.gain * Math.sqrt(o.voices)));
        dot(g, A.cx + v.bus * hx, A.cy - (v.cents / 55) * hy, r * (o.voices > 4 ? 0.8 : 1), v.main ? c.accent : alpha(c.accent, 0.7), v.main ? c.text : null);
      }
      if (o.voices <= 1) text(g, 'One voice: add voices for the supersaw spread', A.cx, A.T + 8, { align: 'center', size: 10.5, color: c.muted });
    },
    handles(w, hh) {
      const A = geo(w, hh);
      const x = s.osc.spread * (A.W / 2);
      const y = s.osc.detune * (A.H / 2);
      const mk = (id, sx, sy, hidden) => ({ id, x: A.cx + sx * x, y: A.cy - sy * y, keys, hidden, cursor: 'move', tip: tipOf, move: (pt) => setFrom(A, pt.x, pt.y) });
      return [mk('tr', 1, 1, false), mk('tl', -1, 1, true), mk('br', 1, -1, true), mk('bl', -1, -1, true)];
    },
    press(pt) {
      const A = geo(pt.w, pt.h);
      return {
        keys, hid: 'tr', move: (q, d) => {
          s.osc.spread = clamp(snap(d.start['osc.spread'] + q.dx / (A.W / 2), 0.01), 0, 1);
          s.osc.detune = clamp(snap(d.start['osc.detune'] - q.dy / (A.H / 2), 0.01), 0, 1);
        },
      };
    },
    pressCursor: 'move',
  });
}

// =====================================================================================================
// Oscillator 2, sub and noise: the source mixer
// =====================================================================================================
export function mixerGraph(ed) {
  const s = ed.root;
  const geo = (w, hh) => area(w, hh, { l: 6, r: 6, t: 24, b: 32 });
  const octSemi = (o) => [o.octave ? `${signed(o.octave)} oct` : '', o.semi ? `${signed(o.semi)} st` : ''].filter(Boolean).join(' ');
  const cols = () => {
    const c = colors();
    return [
      { key: 'osc.level', name: 'Osc 1', color: c.accent, wave: s.osc.wave, info: [`×${s.osc.voices}`, octSemi(s.osc)].filter(Boolean).join(' ') },
      { key: 'osc2.level', name: 'Osc 2', color: c.blue, wave: s.osc2.wave, info: s.osc2.level > 0 ? [`×${s.osc2.voices || 1}`, octSemi(s.osc2) || 'unison'].join(' ') : 'off' },
      { key: 'sub', name: 'Sub', color: c.teal, wave: 'sine', info: s.sub > 0 ? 'sine −1 oct' : 'off' },
      { key: 'noise', name: 'Noise', color: c.muted, wave: 'noise', info: s.noise > 0 ? 'white' : 'off' },
    ];
  };
  const colAt = (A, x) => clamp(Math.floor((x - A.L) / (A.W / 4)), 0, 3);
  const setLevel = (A, key, y) => ed.set(key, clamp(snap((A.B - y) / A.H, 0.01), 0, 1));
  return editGraph(ed, {
    label: 'Source mixer: Osc 1, Osc 2, sub and noise levels',
    hint: '↕ drag a bar',
    draw(g, w, hh, { act }) {
      const c = colors();
      const A = geo(w, hh);
      const cw = A.W / 4;
      gridLines(g, w, hh, [], [A.T, A.T + A.H / 2, A.B].map(Math.round));
      cols().forEach((col, i) => {
        const v = ed.get(col.key) ?? 1;
        const x = A.L + cw * i + cw / 2;
        const bw = Math.min(cw * 0.46, 54);
        const y = A.B - v * A.H;
        g.fillStyle = alpha(col.color, 0.12);
        rrect(g, x - bw / 2, A.T, bw, A.H, 5);
        g.fill();
        const grd = g.createLinearGradient(0, y, 0, A.B);
        grd.addColorStop(0, alpha(col.color, act === col.key ? 0.95 : 0.8));
        grd.addColorStop(1, alpha(col.color, 0.3));
        g.fillStyle = grd;
        if (v > 0.005) { rrect(g, x - bw / 2, y, bw, A.B - y, 5); g.fill(); }
        text(g, fmtPct(v), x, A.T - 9, { align: 'center', size: 10.5, color: v > 0 ? c.text : c.muted });
        drawWave(g, col.wave, x - bw / 2 + 4, A.B - 16, bw - 8, 10, alpha('#ffffff', v > 0 ? 0.75 : 0.3), { cycles: 2, width: 1.2 });
        text(g, col.name, x, A.B + 13, { align: 'center', size: 11, color: c.text, weight: 700 });
        text(g, col.info, x, A.B + 26, { align: 'center', size: 9.5, color: c.muted, weight: 600 });
      });
    },
    handles(w, hh) {
      const A = geo(w, hh);
      const cw = A.W / 4;
      return cols().map((col, i) => ({
        id: col.key, x: A.L + cw * i + cw / 2, y: A.B - (ed.get(col.key) ?? 1) * A.H, keys: [col.key], color: col.color, cursor: 'ns-resize',
        tip: () => `${col.name} ${fmtPct(ed.get(col.key) ?? 1)}`,
        move: (pt) => setLevel(A, col.key, pt.y),
      }));
    },
    press(pt) {
      const A = geo(pt.w, pt.h);
      if (pt.y > A.B + 2) return null;
      const key = cols()[colAt(A, pt.x)].key;
      return { keys: [key], hid: key, now: true, move: (q) => setLevel(A, key, q.y) };
    },
    pressCursor: 'ns-resize',
  });
}

// =====================================================================================================
// Filter: the real frequency response, with the harmonics of the audition note behind it
// =====================================================================================================
const FMIN = 20;
const FMAX = 20000;
const DBTOP = 18;
const DBBOT = -48;

// |H(f)| of one BiquadFilterNode, with the Web Audio spec's coefficients: low- and high-pass
// read Q in dB (the peak at the cutoff is Q dB), band-pass reads Q as a plain ratio.
export function biquadMag(type, f0, Q, f, sr) {
  const w0 = (2 * Math.PI * f0) / sr;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  let b0;
  let b1;
  let b2;
  let al;
  if (type === 'bandpass') { al = sw / (2 * Q); b0 = al; b1 = 0; b2 = -al; }
  else {
    al = sw / (2 * 10 ** (Q / 20));
    if (type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; } else { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
  }
  const a0 = 1 + al;
  const a1 = -2 * cw;
  const a2 = 1 - al;
  const w = (2 * Math.PI * f) / sr;
  const c1 = Math.cos(w); const s1 = Math.sin(w); const c2 = Math.cos(2 * w); const s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2; const ni = -(b1 * s1 + b2 * s2);
  const dr = a0 + a1 * c1 + a2 * c2; const di = -(a1 * s1 + a2 * s2);
  return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
}
// The synth's filter: one stage at the resonance, a 24 dB slope adds a second stage at Q 0.5.
export function filterMag(flt, cutoff, f, sr) {
  if (!flt || flt.type === 'off') return 1;
  let m = biquadMag(flt.type, cutoff, flt.res, f, sr);
  if (flt.slope === 24) m *= biquadMag(flt.type, cutoff, 0.5, f, sr);
  return m;
}
// Harmonic n of a waveform, relative to the fundamental.
function harmonic(wave, n) {
  if (wave === 'sawtooth') return 1 / n;
  if (wave === 'square') return n % 2 ? 1 / n : 0;
  if (wave === 'triangle') return n % 2 ? 1 / (n * n) : 0;
  return n === 1 ? 1 : 0;
}

export function filterGraph(ed) {
  const s = ed.root;
  const f = s.filter;
  const sr = () => ed.app.engine.sr || 48000;
  const nyq = () => sr() / 2 - 100;
  const geo = (w, hh) => area(w, hh, { l: 4, r: 4, t: 8, b: 16 });
  const X = (A, fr) => A.L + logPos(clamp(fr, FMIN, FMAX), FMIN, FMAX) * A.W;
  const Y = (A, d) => A.T + ((DBTOP - clamp(d, DBBOT - 6, DBTOP + 6)) / (DBTOP - DBBOT)) * A.H;
  const keys = ['filter.cutoff', 'filter.res'];
  const typeName = { lowpass: 'Low-pass', highpass: 'High-pass', bandpass: 'Band-pass', off: 'Off' };
  const tipOf = () => `${fmtHz(f.cutoff)} · res ${f.res.toFixed(1)}`;
  const moveTo = (A, pt, d) => {
    f.cutoff = clamp(logVal(clamp((pt.x - A.L) / A.W, 0, 1), FMIN, FMAX), 40, 16000);
    f.res = clamp(snap(d.start['filter.res'] - (pt.dy * 11.7) / (A.H * 0.8), 0.1), 0.3, 12);
  };
  return editGraph(ed, {
    label: 'Filter frequency response',
    hint: '↔ cutoff · ↕ resonance',
    readout: () => (f.type === 'off' ? 'Filter off: every harmonic passes' : `${typeName[f.type]} ${f.slope} dB · ${fmtHz(f.cutoff)} · res ${f.res.toFixed(1)}`),
    draw(g, w, hh) {
      const c = colors();
      const A = geo(w, hh);
      const S = sr();
      const off = f.type === 'off';
      const cut = clamp(f.cutoff, 20, nyq());
      // grid: octave-ish frequencies and 12 dB steps
      gridLines(g, w, hh, [50, 100, 200, 500, 1000, 2000, 5000, 10000].map((fr) => X(A, fr)), [0, -12, -24, -36].map((d) => Y(A, d)));
      g.fillStyle = 'rgba(141, 151, 171, .3)';
      g.fillRect(A.L, Math.round(Y(A, 0)), A.W, 1);
      for (const [fr, l] of [[100, '100'], [1000, '1k'], [10000, '10k']]) text(g, l, X(A, fr) + 3, hh - 4, { size: 9.5 });
      text(g, '0 dB', A.L + 3, Y(A, 0) - 3, { size: 9 });
      // the harmonics of the audition note, dim as played, bright after the filter. Key tracking
      // moves the cutoff with the note played (playVoice: cutoff × (f / 261.6)^key; the curve is
      // drawn for C4), so the harmonics are filtered where this note's cutoff really sits.
      const o = s.osc;
      const note = auditionNote(ed.app, ed.t);
      const f0 = mtof(note) * 2 ** (o.octave || 0);
      const cutN = clamp(f.cutoff * (f.key ? (mtof(note) / 261.6) ** f.key : 1), 20, nyq());
      const top = (d) => Y(A, d - 4);
      for (let n = 1; n * f0 < FMAX && n < 400; n++) {
        const a = harmonic(o.wave, n);
        if (!a) continue;
        const fr = n * f0;
        const x = Math.round(X(A, fr));
        const d0 = db(a);
        if (d0 - 4 < DBBOT) continue;
        g.fillStyle = 'rgba(141, 151, 171, .16)';
        g.fillRect(x, top(d0), 1.5, A.B - top(d0));
        const d1 = off ? d0 : d0 + db(filterMag(f, cutN, fr, S));
        if (d1 - 4 > DBBOT) { g.fillStyle = alpha(c.solo, 0.5); g.fillRect(x, top(d1), 1.5, A.B - top(d1)); }
      }
      if (!off && Math.abs(Math.log2(cutN / cut)) > 0.05) {
        const xk = X(A, cutN);
        dashed(g, [[xk, A.T + A.H * 0.3], [xk, A.B]], alpha(c.solo, 0.6), 1, [2, 3]);
        text(g, `${noteName(note)} cutoff`, Math.min(xk + 3, A.R - 52), A.B - 4, { size: 9, color: c.solo });
      }
      const N = clamp(Math.round(A.W / 2), 80, 420);
      const freqs = Array.from({ length: N + 1 }, (_, i) => logVal(i / N, FMIN, FMAX));
      if (off) {
        curve(g, [[A.L, Y(A, 0)], [A.R, Y(A, 0)]], { color: c.muted, width: 2 });
        text(g, 'Filter off', A.cx, A.T + 14, { align: 'center', size: 11, color: c.muted });
        return;
      }
      // how far the envelope opens it: cutoff × 2^env, shaded, with the response at the peak
      if (f.env > 0) {
        const peak = clamp(cut * 2 ** f.env, 20, nyq());
        const x0 = X(A, cut);
        const x1 = X(A, peak);
        const grd = g.createLinearGradient(x0, 0, x1, 0);
        grd.addColorStop(0, alpha(c.blue, 0.16));
        grd.addColorStop(1, alpha(c.blue, 0.02));
        g.fillStyle = grd;
        g.fillRect(x0, A.T, x1 - x0, A.H);
        dashed(g, freqs.map((fr) => [X(A, fr), Y(A, db(filterMag(f, peak, fr, S)))]), alpha(c.blue, 0.75), 1.25);
        text(g, `env +${f.env.toFixed(1)} oct`, Math.min(x1 - 4, A.R - 4), A.T + 10, { align: 'right', size: 9.5, color: c.blue });
      }
      const pts = freqs.map((fr) => [X(A, fr), Y(A, db(filterMag(f, cut, fr, S)))]);
      const grd = g.createLinearGradient(0, A.T, 0, A.B);
      grd.addColorStop(0, alpha(c.accent, 0.32));
      grd.addColorStop(1, alpha(c.accent, 0.02));
      curve(g, pts, { color: c.accent, width: 2.25, fill: grd, y0: A.B + 16 });
    },
    handles(w, hh) {
      if (f.type === 'off') return [];
      const A = geo(w, hh);
      const cut = clamp(f.cutoff, 20, nyq());
      const y = clamp(Y(A, db(filterMag(f, cut, cut, sr()))), A.T + 6, A.B - 6);
      return [{ id: 'cut', x: X(A, cut), y, keys, tip: tipOf, cursor: 'move', move: (pt, d) => moveTo(A, pt, d) }];
    },
    press(pt) {
      if (f.type === 'off') return null;
      const A = geo(pt.w, pt.h);
      return { keys, hid: 'cut', move: (q, d) => moveTo(A, q, d) };
    },
  });
}

// =====================================================================================================
// Envelopes (amp and filter): each stage gets a width from a log curve of its time, so 1 ms and 4 s
// both read clearly; inside a stage, time runs linearly, so the curve has its true shape.
// =====================================================================================================
const ENV_T0 = 0.005;
const ENV_TMAX = 4;
const ENV_K = Math.log1p(ENV_TMAX / ENV_T0);
function envLayout(A, z = 1) {
  const hold = clamp(A.W * 0.14, 22, 140);
  const seg = ((A.W - hold) / 3) * z;
  return {
    hold, seg, z,
    segW: (t) => (seg * Math.log1p(Math.max(0, t) / ENV_T0)) / ENV_K,
    inv: (px) => ENV_T0 * Math.expm1((clamp(px, 0, seg) / seg) * ENV_K),
  };
}
// Zoom so the three timed stages fill the graph (up to 2.5×); frozen while a point is dragged,
// so the axis never slides under the finger.
function envZoom(A, times) {
  const L = envLayout(A, 1);
  const used = times.reduce((sum, t) => sum + L.segW(t), 0);
  return clamp(((A.W - L.hold) * 0.92) / Math.max(1, used), 1, 2.5);
}
function sample(n, fn) { const out = []; for (let i = 0; i <= n; i++) out.push(fn(i / n)); return out; }
function stageLabels(g, A, xs, names) {
  const c = colors();
  for (let i = 0; i < names.length; i++) {
    const x0 = xs[i];
    const x1 = xs[i + 1];
    if (x1 - x0 >= 10) text(g, names[i], (x0 + x1) / 2, A.B + 12, { align: 'center', size: 9.5, color: c.muted });
    g.fillStyle = c.grid;
    g.fillRect(Math.round(x1), A.T, 1, A.H);
  }
}

export function ampEnvGraph(ed) {
  const s = ed.root;
  const a = s.amp;
  const geo = (w, hh) => area(w, hh, { l: 10, r: 12, t: 10, b: 16 });
  let zoom = null;
  const lay = (A) => {
    const L = envLayout(A, zoom ?? envZoom(A, [Math.max(0.002, a.a), a.d, a.r]));
    const xa = A.L + L.segW(Math.max(0.002, a.a));
    const xd = xa + L.segW(a.d);
    const xs = xd + L.hold;
    const xr = xs + L.segW(a.r);
    return { ...L, xa, xd, xs, xr };
  };
  const Y = (A, v) => A.B - v * A.H;
  return editGraph(ed, {
    label: 'Amp envelope: attack, decay, sustain, release',
    hint: 'drag the points',
    readout: () => `A ${fmtSec(a.a)} · D ${fmtSec(a.d)} · S ${fmtPct(a.s)} · R ${fmtSec(a.r)}`,
    draw(g, w, hh) {
      const c = colors();
      const A = geo(w, hh);
      const P = lay(A);
      gridLines(g, w, hh, [], [Y(A, 0.5), Y(A, 1)]);
      stageLabels(g, A, [A.L, P.xa, P.xd, P.xs, P.xr], ['A', 'D', 'hold', 'R']);
      // the same schedule as playVoice(): linear attack, setTargetAtTime decay (d/3) toward
      // sustain, release from where it is (r/4)
      const tc = Math.max(0.004, a.d / 3);
      const val = (t) => (a.s >= 0.999 ? 1 : a.s + (1 - a.s) * Math.exp(-t / tc));
      const held = val(a.d * 1.6);
      const tr = Math.max(0.004, a.r / 4);
      const pts = [
        [A.L, Y(A, 0)], [P.xa, Y(A, 1)],
        ...sample(40, (u) => [P.xa + (P.xd - P.xa) * u, Y(A, val(a.d * u))]),
        ...sample(12, (u) => [P.xd + (P.xs - P.xd) * u, Y(A, val(a.d * (1 + 0.6 * u)))]),
        ...sample(40, (u) => [P.xs + (P.xr - P.xs) * u, Y(A, held * Math.exp((-a.r * u) / tr))]),
        [P.xr, Y(A, 0)],
      ];
      const grd = g.createLinearGradient(0, A.T, 0, A.B);
      grd.addColorStop(0, alpha(c.accent, 0.35));
      grd.addColorStop(1, alpha(c.accent, 0.03));
      curve(g, pts, { color: c.accent, width: 2.25, fill: grd, y0: A.B });
      // sustain level guide
      dashed(g, [[P.xd, Y(A, a.s)], [P.xs, Y(A, a.s)]], alpha(c.text, 0.35), 1);
      text(g, 'note off', P.xs + 3, A.T + 8, { size: 9, color: c.muted });
      g.fillStyle = alpha(c.text, 0.25);
      g.fillRect(Math.round(P.xs), A.T, 1, A.H);
    },
    handles(w, hh) {
      const A = geo(w, hh);
      const P = lay(A);
      return [
        { id: 'a', x: P.xa, y: Y(A, 1), keys: ['amp.a'], cursor: 'ew-resize', tip: () => `attack ${fmtSec(a.a)}`, move: (pt) => { zoom = P.z; a.a = clamp(snap(P.inv(pt.x - A.L), 0.001), 0.001, 3); } },
        { id: 'ds', x: P.xd, y: Y(A, a.s), keys: ['amp.d', 'amp.s'], cursor: 'move', tip: () => `decay ${fmtSec(a.d)} · sustain ${fmtPct(a.s)}`,
          move: (pt) => { zoom = P.z; a.d = clamp(snap(P.inv(pt.x - P.xa), 0.001), 0.01, 4); a.s = clamp(snap((A.B - pt.y) / A.H, 0.01), 0, 1); } },
        { id: 'r', x: P.xr, y: Y(A, 0), keys: ['amp.r'], cursor: 'ew-resize', tip: () => `release ${fmtSec(a.r)}`, move: (pt) => { zoom = P.z; a.r = clamp(snap(P.inv(pt.x - P.xs), 0.001), 0.01, 4); } },
      ].map((x) => ({ ...x, up: () => { zoom = null; } }));
    },
  });
}

export function filterEnvGraph(ed) {
  const s = ed.root;
  const f = s.filter;
  const OCT = 6;
  const geo = (w, hh) => area(w, hh, { l: 10, r: 12, t: 10, b: 16 });
  let zoom = null;
  const lay = (A) => {
    const L = envLayout(A, zoom ?? envZoom(A, [Math.max(0.002, f.a || 0.002), f.d || 0.2, f.r ?? s.amp.r]));
    const xa = A.L + L.segW(Math.max(0.002, f.a || 0.002));
    const xd = xa + L.segW(f.d || 0.2);
    const xs = xd + L.hold;
    const xr = xs + L.segW(f.r ?? s.amp.r);
    return { ...L, xa, xd, xs, xr };
  };
  const Y = (A, o) => A.B - (o / OCT) * A.H;
  return editGraph(ed, {
    label: 'Filter envelope: how far above the cutoff the filter opens over time',
    small: true,
    hint: '↕ peak = env amount',
    readout: () => (f.env ? `A ${fmtSec(f.a)} · D ${fmtSec(f.d)} · S ${fmtPct(f.s)} · +${f.env.toFixed(1)} oct` : 'Env amount 0: the filter stays at the cutoff'),
    draw(g, w, hh) {
      const c = colors();
      const A = geo(w, hh);
      const P = lay(A);
      gridLines(g, w, hh, [], [2, 4, 6].map((o) => Y(A, o)));
      text(g, '+6 oct', A.L + 2, A.T + 8, { size: 9 });
      stageLabels(g, A, [A.L, P.xa, P.xd, P.xs, P.xr], ['A', 'D', 'hold', 'R']);
      const off = f.type === 'off';
      // playVoice(): exponential ramp up (a straight line in octaves), then setTargetAtTime in Hz
      // toward the sustain (d/3), and back to the cutoff after note off ((r or amp r)/3)
      const env = f.env || 0;
      const peak = 2 ** env;
      const sus = 2 ** (env * (f.s ?? 0));
      const tc = Math.max(0.005, (f.d || 0.2) / 3);
      const ratio = (t) => sus + (peak - sus) * Math.exp(-t / tc);
      const d = f.d || 0.2;
      const held = ratio(d * 1.6);
      const r = f.r ?? s.amp.r;
      const tr = Math.max(0.005, r / 3);
      const pts = [
        [A.L, Y(A, 0)], [P.xa, Y(A, env)],
        ...sample(40, (u) => [P.xa + (P.xd - P.xa) * u, Y(A, Math.log2(ratio(d * u)))]),
        ...sample(12, (u) => [P.xd + (P.xs - P.xd) * u, Y(A, Math.log2(ratio(d * (1 + 0.6 * u))))]),
        ...sample(40, (u) => [P.xs + (P.xr - P.xs) * u, Y(A, Math.log2(1 + (held - 1) * Math.exp((-r * u) / tr)))]),
      ];
      const grd = g.createLinearGradient(0, A.T, 0, A.B);
      grd.addColorStop(0, alpha(c.blue, off ? 0.08 : 0.3));
      grd.addColorStop(1, alpha(c.blue, 0.02));
      curve(g, pts, { color: off ? c.muted : c.blue, width: 2, fill: grd, y0: A.B });
      if (off) text(g, 'Filter off', A.cx, A.T + 14, { align: 'center', size: 10.5 });
    },
    handles(w, hh) {
      const A = geo(w, hh);
      const P = lay(A);
      const env = f.env || 0;
      return [
        { id: 'a', x: P.xa, y: Y(A, env), keys: ['filter.a', 'filter.env'], color: colors().blue, cursor: 'move', tip: () => `attack ${fmtSec(f.a)} · +${f.env.toFixed(1)} oct`,
          move: (pt) => { zoom = P.z; f.a = clamp(snap(P.inv(pt.x - A.L), 0.001), 0.001, 3); f.env = clamp(snap(((A.B - pt.y) / A.H) * OCT, 0.1), 0, OCT); } },
        { id: 'ds', x: P.xd, y: Y(A, env * (f.s ?? 0)), keys: ['filter.d', 'filter.s'], color: colors().blue, cursor: 'move', tip: () => `decay ${fmtSec(f.d)} · sustain ${fmtPct(f.s)}`,
          move: (pt) => {
            zoom = P.z;
            f.d = clamp(snap(P.inv(pt.x - P.xa), 0.001), 0.01, 4);
            if (f.env > 0) f.s = clamp(snap(((A.B - pt.y) / A.H) * OCT / f.env, 0.01), 0, 1);
          } },
      ].map((x) => ({ ...x, up: () => { zoom = null; } }));
    },
  });
}

// =====================================================================================================
// Pitch, glide and character: pitch envelope, drive curve, stereo width
// =====================================================================================================
export function pitchEnvGraph(ed) {
  const s = ed.root;
  const pe = s.pitchEnv;
  const TMAX = 0.5;
  const geo = (w, hh) => area(w, hh, { l: 36, r: 10, t: 10, b: 16 });
  // a square-root time axis, so a 5 ms blip and a 500 ms dive both have room
  const X = (A, t) => A.L + Math.sqrt(clamp(t, 0, TMAX) / TMAX) * A.W;
  const Y = (A, st) => A.cy - (st / 12) * (A.H / 2);
  return editGraph(ed, {
    label: 'Pitch envelope: the note starts this many semitones off and slides to pitch',
    small: true,
    hint: '↕ amount · ↔ decay',
    readout: () => (pe.amt ? `${signed(pe.amt)} st → 0 in ${fmtSec(pe.decay)}` : `No pitch drop · decay ${fmtSec(pe.decay)}`) + (s.mono ? ` · glide ${fmtSec(s.glide)}` : ''),
    draw(g, w, hh) {
      const c = colors();
      const A = geo(w, hh);
      gridLines(g, w, hh, [0.01, 0.05, 0.1, 0.25].map((t) => X(A, t)), [Y(A, 12), Y(A, -12)]);
      g.fillStyle = 'rgba(141, 151, 171, .3)';
      g.fillRect(A.L, Math.round(Y(A, 0)), A.W, 1);
      for (const [t, l] of [[0.01, '10'], [0.05, '50'], [0.1, '100'], [0.25, '250'], [0.5, '500 ms']]) text(g, l, X(A, t), hh - 4, { size: 9, align: t === 0.5 ? 'right' : 'center' });
      text(g, '+12', A.L - 11, A.T + 3, { size: 9, align: 'right', base: 'middle' });
      text(g, '0 st', A.L - 11, Y(A, 0), { size: 9, align: 'right', base: 'middle' });
      text(g, '−12', A.L - 11, A.B - 3, { size: 9, align: 'right', base: 'middle' });
      // exponentialRampToValueAtTime in Hz is a straight line in semitones
      const d = Math.max(0.005, pe.decay);
      const pts = [...sample(32, (u) => [X(A, d * u), Y(A, pe.amt * (1 - u))]), [A.R, Y(A, 0)]];
      curve(g, pts, { color: c.solo, width: 2.25, fill: alpha(c.solo, 0.12), y0: Y(A, 0) });
    },
    handles(w, hh) {
      const A = geo(w, hh);
      const col = colors().solo;
      return [
        { id: 'amt', x: A.L, y: Y(A, pe.amt), keys: ['pitchEnv.amt'], color: col, cursor: 'ns-resize', tip: () => `${signed(pe.amt)} st`,
          move: (pt) => { pe.amt = clamp(Math.round(((A.cy - pt.y) / (A.H / 2)) * 12), -12, 12); } },
        { id: 'dec', x: X(A, Math.max(0.005, pe.decay)), y: Y(A, 0), keys: ['pitchEnv.decay'], color: col, cursor: 'ew-resize', tip: () => fmtSec(pe.decay),
          move: (pt) => { pe.decay = clamp(snap(((pt.x - A.L) / A.W) ** 2 * TMAX, 0.001), 0.005, TMAX); } },
      ];
    },
  });
}

// The insert drive exactly as insertChain() builds it: pre gain, the shared tanh curve, make-up.
function driveOut(drive, x) {
  if (!(drive > 0)) return x;
  const cv = driveCurve(drive);
  const u = clamp(x * (1 + drive * 1.5), -1, 1);
  const p = ((u + 1) / 2) * (cv.length - 1);
  const i = Math.min(cv.length - 2, Math.floor(p));
  const y = cv[i] + (cv[i + 1] - cv[i]) * (p - i);
  return y / (1 + drive * 0.8);
}

export function driveGraph(ed) {
  const s = ed.root;
  const geo = (w, hh) => area(w, hh, { l: 8, r: 8, t: 8, b: 16 });
  const box = (A) => { const S = Math.min(A.H, A.W * 0.5); return { x: A.L, y: A.T + (A.H - S) / 2, S }; };
  return editGraph(ed, {
    label: 'Distortion: input to output curve and what it does to a sine wave',
    small: true,
    hint: '↕ drive',
    readout: () => (s.drive > 0 ? `Drive ${fmtPct(s.drive)}` : 'Clean (drive off)'),
    draw(g, w, hh) {
      const c = colors();
      const A = geo(w, hh);
      const b = box(A);
      const tx = (x) => b.x + ((x + 1) / 2) * b.S;
      const ty = (y) => b.y + ((1 - y) / 2) * b.S;
      g.strokeStyle = c.grid;
      g.lineWidth = 1;
      g.strokeRect(b.x + 0.5, b.y + 0.5, b.S, b.S);
      g.fillStyle = c.grid;
      g.fillRect(Math.round(tx(0)), b.y, 1, b.S);
      g.fillRect(b.x, Math.round(ty(0)), b.S, 1);
      curve(g, [[tx(-1), ty(-1)], [tx(1), ty(1)]], { color: 'rgba(141, 151, 171, .35)', width: 1 });
      curve(g, sample(80, (u) => { const x = u * 2 - 1; return [tx(x), ty(driveOut(s.drive, x))]; }), { color: c.mute, width: 2.25 });
      text(g, 'in → out', b.x + b.S / 2, hh - 4, { align: 'center', size: 9 });
      // a sine through it, clean behind, driven in front
      const x0 = b.x + b.S + 10;
      const ww = A.R - x0;
      if (ww > 30) {
        const cy = A.cy;
        const amp = A.H * 0.42;
        curve(g, sample(90, (u) => [x0 + u * ww, cy - Math.sin(u * 2 * Math.PI) * 0.9 * amp]), { color: 'rgba(141, 151, 171, .4)', width: 1.25 });
        curve(g, sample(90, (u) => [x0 + u * ww, cy - driveOut(s.drive, Math.sin(u * 2 * Math.PI) * 0.9) * amp]), { color: c.mute, width: 2 });
        text(g, 'sine wave', x0 + ww / 2, hh - 4, { align: 'center', size: 9 });
      }
    },
    handles(w, hh) {
      const A = geo(w, hh);
      const b = box(A);
      return [{ id: 'drv', x: b.x + 0.75 * b.S, y: b.y + ((1 - driveOut(s.drive, 0.5)) / 2) * b.S, keys: ['drive'], color: colors().mute, cursor: 'ns-resize', tip: () => `drive ${fmtPct(s.drive)}`,
        move: (pt, d) => { s.drive = clamp(snap(d.start.drive - pt.dy / (b.S * 0.7), 0.01), 0, 1); } }];
    },
    press() { return { keys: ['drive'], hid: 'drv', move: (q, d) => { s.drive = clamp(snap(d.start.drive - q.dy / 80, 0.01), 0, 1); } }; },
    pressCursor: 'ns-resize',
  });
}

// Where a sound panned with an equal-power StereoPanner ends up after the width matrix
// (L' = M + w·S): its side/mid ratio scales with the width. ±1 is a speaker, beyond is phasey.
function widthPos(pan, w) {
  const th = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  const gl = Math.cos(th);
  const gr = Math.sin(th);
  return (w * (gr - gl)) / (gr + gl);
}

export function widthGraph(ed) {
  const s = ed.root;
  const geo = (w, hh) => area(w, hh, { l: 8, r: 8, t: 10, b: 16 });
  const U = (A) => A.W / 4; // one speaker's distance from the centre
  const low = ed.t.role === 'bass' || ed.t.role === 'sub';
  return editGraph(ed, {
    label: 'Stereo width: where the voices sit between and beyond the speakers',
    small: true,
    hint: '↔ width',
    readout: () => ((s.width ?? 1) < 0.02 ? 'Mono' : `Width ${fmtPct(s.width ?? 1)}`) + (low && (s.width ?? 1) > 0.7 ? ' · keep bass narrow' : ''),
    draw(g, w, hh) {
      const c = colors();
      const A = geo(w, hh);
      const u = U(A);
      const wd = s.width ?? 1;
      // beyond the speakers: wider than the room, and it collapses in mono
      g.fillStyle = alpha(c.mute, 0.06);
      g.fillRect(A.L, A.T, u, A.H);
      g.fillRect(A.R - u, A.T, u, A.H);
      for (const k of [-1, 1]) {
        const x = A.cx + k * u;
        g.fillStyle = c.grid;
        g.fillRect(Math.round(x), A.T, 1, A.H);
        g.fillStyle = c.muted;
        rrect(g, x - 5, A.B - 9, 10, 9, 2);
        g.fill();
      }
      g.fillStyle = c.grid;
      g.fillRect(Math.round(A.cx), A.T, 1, A.H);
      text(g, 'L', A.cx - u, hh - 4, { align: 'center', size: 9.5 });
      text(g, 'R', A.cx + u, hh - 4, { align: 'center', size: 9.5 });
      text(g, 'mono', A.cx, hh - 4, { align: 'center', size: 9 });
      // the field
      const half = Math.max(2, Math.min(2, wd) * u);
      const ey = A.T + A.H * 0.42;
      const grd = g.createLinearGradient(A.cx - half, 0, A.cx + half, 0);
      grd.addColorStop(0, alpha(c.teal, 0.05));
      grd.addColorStop(0.5, alpha(c.teal, 0.3));
      grd.addColorStop(1, alpha(c.teal, 0.05));
      g.beginPath();
      g.ellipse(A.cx, ey, half, A.H * 0.32, 0, 0, Math.PI * 2);
      g.fillStyle = grd;
      g.fill();
      g.lineWidth = 1.25;
      g.strokeStyle = alpha(c.teal, 0.7);
      g.stroke();
      // the voices where they end up
      const vs = unisonVoices(s.osc);
      vs.forEach((v, i) => dot(g, A.cx + widthPos(v.bus, wd) * u, ey + ((i % 3) - 1) * 7, 3.5, v.main ? c.accent : alpha(c.accent, 0.75)));
      if (s.sub > 0) dot(g, A.cx, ey + 12, 3, c.teal);
    },
    handles(w, hh) {
      const A = geo(w, hh);
      const u = U(A);
      const wd = s.width ?? 1;
      const set = (pt) => { s.width = clamp(snap(Math.abs(pt.x - A.cx) / u, 0.01), 0, 2); };
      const ey = A.T + A.H * 0.42;
      return [
        { id: 'w', x: A.cx + wd * u, y: ey, keys: ['width'], color: colors().teal, cursor: 'ew-resize', tip: () => (s.width < 0.02 ? 'mono' : fmtPct(s.width)), move: set },
        { id: 'wl', x: A.cx - wd * u, y: ey, keys: ['width'], hidden: true, cursor: 'ew-resize', tip: () => fmtPct(s.width), move: set },
      ];
    },
    press(pt) {
      const A = geo(pt.w, pt.h);
      return { keys: ['width'], hid: 'w', move: (q, d) => { s.width = clamp(snap(d.start.width + q.dx / U(A), 0.01), 0, 2); } };
    },
    pressCursor: 'ew-resize',
  });
}

// =====================================================================================================
// Arpeggiator: one bar of what it plays from a held chord in the song's key
// =====================================================================================================
function sampleChord(app) { const p = app.project; return chordNotes(p.key, p.scale, 0, 'triad', 60); }
function arpNotes(app, s) {
  const held = sampleChord(app).map((m) => ({ pitch: m, start: 0, len: 16, vel: 0.9 }));
  return arpeggiate(held, { ...s.arp, on: true }, 16);
}
function chordName(app, chord) {
  const p = app.project;
  const q = chord[1] - chord[0] === 3 ? (chord[2] - chord[0] === 6 ? 'dim' : 'm') : '';
  return spell(chord[0], p.key, p.scale) + q;
}

export function arpGraph(ed) {
  const s = ed.root;
  const arp = s.arp;
  const geo = (w, hh) => area(w, hh, { l: 4, r: 4, t: 8, b: 14 });
  const modeName = { up: 'Up', down: 'Down', updown: 'Up-down', random: 'Random', played: 'As played' };
  const layout = (A) => {
    const chord = sampleChord(ed.app);
    const notes = arpNotes(ed.app, s);
    const lo = Math.min(...chord) - 1;
    const hi = Math.max(...notes.map((n) => n.pitch), ...chord) + 1;
    const rh = A.H / (hi - lo + 1);
    const sw = A.W / 16;
    return { chord, notes, lo, hi, rh, sw, py: (m) => A.B - (m - lo + 1) * rh };
  };
  return editGraph(ed, {
    label: 'Arpeggiator: one bar of what it plays from a held chord',
    hint: '↔ gate',
    readout: () => `${arp.on ? '' : 'Off · '}${modeName[arp.mode] || arp.mode} · ${arp.rate} · ${arp.octaves} oct · gate ${fmtPct(arp.gate)} · ${chordName(ed.app, sampleChord(ed.app))} chord`,
    draw(g, w, hh) {
      const c = colors();
      const A = geo(w, hh);
      const P = layout(A);
      g.globalAlpha = arp.on ? 1 : 0.4;
      for (let i = 0; i <= 16; i++) { g.fillStyle = i % 4 === 0 ? 'rgba(141, 151, 171, .26)' : c.grid; g.fillRect(Math.round(A.L + i * P.sw), A.T, 1, A.H); }
      for (let i = 1; i <= 4; i++) text(g, String(i), A.L + (i - 1) * 4 * P.sw + 3, hh - 3, { size: 9 });
      // the held chord, faint
      for (const m of P.chord) {
        g.fillStyle = alpha(c.text, 0.07);
        g.fillRect(A.L, P.py(m), A.W, Math.max(2, P.rh - 1));
      }
      for (const n of P.notes) {
        const x = A.L + n.start * P.sw;
        const nw = Math.max(2, n.len * P.sw - 1);
        g.fillStyle = alpha(c.accent, 0.35 + 0.65 * (n.vel ?? 0.9));
        rrect(g, x + 0.5, P.py(n.pitch) + 0.5, nw, Math.max(3, P.rh - 1), Math.min(3, P.rh / 2));
        g.fill();
      }
      g.globalAlpha = 1;
      if (!arp.on) text(g, 'Arp off: turn it on to play held chords as a pattern', A.cx, A.cy, { align: 'center', base: 'middle', size: 11, color: c.text });
    },
    handles(w, hh) {
      const A = geo(w, hh);
      const P = layout(A);
      const n = P.notes[0];
      if (!n) return [];
      const rate = n.len / Math.max(0.01, arp.gate);
      const x0 = A.L + n.start * P.sw;
      return [{ id: 'gate', x: x0 + n.len * P.sw, y: P.py(n.pitch) + P.rh / 2, keys: ['arp.gate'], cursor: 'ew-resize', tip: () => `gate ${fmtPct(arp.gate)}`,
        move: (pt) => { arp.gate = clamp(snap((pt.x - x0) / (rate * P.sw), 0.01), 0.1, 1); } }];
    },
    press(pt) {
      const A = geo(pt.w, pt.h);
      const P = layout(A);
      const n = P.notes[0];
      const rate = n ? n.len / Math.max(0.01, arp.gate) : 1;
      return { keys: ['arp.gate'], hid: 'gate', move: (q, d) => { arp.gate = clamp(snap(d.start['arp.gate'] + q.dx / (rate * P.sw), 0.01), 0.1, 1); } };
    },
    pressCursor: 'ew-resize',
    kind: 'arp',
  });
}

// =====================================================================================================
// Trance gate: the volume over the 16 gate steps, simulated from insertChain()'s automation
// =====================================================================================================
const gatePer = (gate) => (gate.rate === '1/8' ? 2 : gate.rate === '1/32' ? 0.5 : 1);

// Gain over two passes of the pattern (the second is the steady state shown): setTargetAtTime to
// 1 or 1 − depth at each step, and for Pluck a fall to 35% open 0.35 steps in.
export function gateCurve(gate, stepSec, N = 400) {
  const per = gatePer(gate);
  const span = 16 * per * stepSec;
  const lo = 1 - gate.depth;
  const sm = Math.min(0.012, stepSec * per * 0.25);
  const ev = [];
  for (let k = 0; k < 32; k++) {
    const on = gate.pattern[k % 16];
    const tt = k * per * stepSec;
    ev.push([tt, on ? 1 : lo, sm / 3]);
    if (on && gate.shape === 'pluck') ev.push([tt + stepSec * per * 0.35, lo + (1 - lo) * 0.35, stepSec * per * 0.2]);
  }
  ev.sort((a, b) => a[0] - b[0]);
  let v = gate.pattern[0] ? 1 : lo;
  let e = 0;
  let v0 = v;
  const out = new Float32Array(N + 1);
  for (let i = 0; i <= 2 * N; i++) {
    const t = (i / (2 * N)) * 2 * span;
    while (e + 1 < ev.length && ev[e + 1][0] <= t) {
      const [t1, tg, tc] = ev[e];
      v0 = tg + (v0 - tg) * Math.exp(-(ev[e + 1][0] - t1) / tc);
      e++;
    }
    const [t1, tg, tc] = ev[e];
    v = tg + (v0 - tg) * Math.exp(-(t - t1) / tc);
    if (i >= N) out[i - N] = v;
  }
  return out;
}

export function gateGraph(ed, { onToggle } = {}) {
  const s = ed.root;
  const gate = s.gate;
  const geo = (w, hh) => area(w, hh, { l: 0, r: 0, t: 10, b: 14 });
  // columns line up with the 16 step buttons under the graph (2 px gaps)
  const colX = (A, k) => A.L + k * ((A.W + 2) / 16);
  const colW = (A) => (A.W + 2) / 16 - 2;
  const span = () => ({ '1/8': '2 bars', '1/32': '½ bar' }[gate.rate] || '1 bar');
  // where each group of 4 steps starts: beats at 1/16; bar.beat at 1/8 (two bars); "&" halves at 1/32
  const beatAt = (b) => {
    const beat = b * gatePer(gate);
    if (gate.rate === '1/8') return `${Math.floor(beat / 4) + 1}.${(beat % 4) + 1}`;
    return Number.isInteger(beat) ? String(beat + 1) : '&';
  };
  return editGraph(ed, {
    label: 'Trance gate: the volume shape over the 16 gate steps',
    hint: 'tap a step · ↕ depth',
    readout: () => `${gate.on ? '' : 'Off · '}${gate.rate} · ${gate.shape === 'pluck' ? 'Pluck' : 'Hard'} · depth ${fmtPct(gate.depth)} · ${gate.pattern.filter(Boolean).length}/16 on · ${span()}`,
    draw(g, w, hh, { drag }) {
      const c = colors();
      const A = geo(w, hh);
      const cw = colW(A);
      g.globalAlpha = gate.on ? 1 : 0.4;
      for (let k = 0; k < 16; k++) {
        g.fillStyle = gate.pattern[k] ? alpha(c.accent, 0.1) : k % 4 === 0 ? 'rgba(141, 151, 171, .06)' : 'rgba(0, 0, 0, 0)';
        g.fillRect(colX(A, k), A.T, cw, A.H);
        dot(g, colX(A, k) + cw / 2, 5, 2.5, gate.pattern[k] ? c.accent : c.line);
      }
      for (let b = 0; b < 4; b++) text(g, beatAt(b), colX(A, b * 4) + 3, hh - 3, { size: 9 });
      const v = gateCurve(gate, 15 / ed.app.project.bpm, Math.max(64, Math.round(A.W)));
      const n = v.length - 1;
      const Y = (x) => A.B - x * A.H;
      const pts = Array.from(v, (x, i) => [A.L + (i / n) * A.W, Y(x)]);
      const grd = g.createLinearGradient(0, A.T, 0, A.B);
      grd.addColorStop(0, alpha(c.accent, 0.42));
      grd.addColorStop(1, alpha(c.accent, 0.05));
      curve(g, pts, { color: c.accent, width: 2, fill: grd, y0: A.B });
      // the floor the closed steps fall to
      const fy = Y(1 - gate.depth);
      dashed(g, [[A.L, fy], [A.R, fy]], alpha(c.text, drag && drag.moved ? 0.8 : 0.35), 1);
      if (drag && drag.moved) tip(g, `depth ${fmtPct(gate.depth)}`, A.cx, fy, w, hh);
      g.globalAlpha = 1;
      if (!gate.on) text(g, 'Gate off', A.cx, A.cy, { align: 'center', base: 'middle', size: 11, color: c.text });
    },
    press(pt) {
      const A = geo(pt.w, pt.h);
      const k = clamp(Math.floor((pt.x - A.L) / ((A.W + 2) / 16)), 0, 15);
      return {
        keys: ['gate.depth'],
        move: (q, d) => { gate.depth = clamp(snap(d.start['gate.depth'] + q.dy / (A.H * 0.9), 0.01), 0, 1); },
        up: (q, d) => {
          if (d.moved) return false;
          gate.pattern[k] = gate.pattern[k] ? 0 : 1;
          if (onToggle) onToggle(k);
          return true;
        },
      };
    },
    pressCursor: 'pointer',
    kind: 'gate',
  });
}

// =====================================================================================================
// Drums: the kick (pitch sweep, amp shape and waveform, tuned to the key) and the kit levels
// =====================================================================================================
const kickCache = new Map();
// The kick as playDrum() makes it, at 12 kHz: two exponential pitch ramps, the drive curve, the
// gain schedule (2 ms attack, hold, two setTargetAtTime falls) and the noise click.
export function kickSim(kit, key) {
  const sig = `${kit.kick}|${key}|${kit.tune}`;
  let r = kickCache.get(sig);
  if (r) return r;
  const k = KICKS[kit.kick] || KICKS.bigroom;
  const f = kickHz(key, kit.tune);
  const T = k.decay * 1.8 + 0.1;
  const sr = 12000;
  const N = Math.ceil(T * sr);
  const wave = new Float32Array(N);
  const env = new Float32Array(N);
  const freq = new Float32Array(N);
  const cv = driveCurve(k.drive);
  const pre = 1 + k.drive * 2;
  const t1 = k.sweep * 0.5;
  const t2 = k.sweep * 2.2;
  const A = 0.5 * k.tail + 0.0001;
  const tB = k.decay * 0.6;
  const vB = A + (0.9 - A) * Math.exp(-(tB - 0.03) / (k.decay * 0.25));
  const clickPk = 0.5 * k.click;
  let ph = 0;
  let seed = 7;
  for (let i = 0; i < N; i++) {
    const t = i / sr;
    const fr = t < t1 ? f * k.start * (1.6 / k.start) ** (t / t1) : t < t2 ? f * 1.6 * (1 / 1.6) ** ((t - t1) / (t2 - t1)) : f;
    ph += fr / sr;
    const u = clamp(Math.sin(2 * Math.PI * ph) * pre, -1, 1);
    const p = ((u + 1) / 2) * (cv.length - 1);
    const j = Math.min(cv.length - 2, Math.floor(p));
    const y = cv[j] + (cv[j + 1] - cv[j]) * (p - j);
    const gn = t < 0.002 ? (0.9 * t) / 0.002 : t < 0.03 ? 0.9 : t < tB ? A + (0.9 - A) * Math.exp(-(t - 0.03) / (k.decay * 0.25)) : vB * Math.exp(-(t - tB) / (k.decay * 0.22));
    let click = 0;
    if (t < 0.012 && clickPk > 0) {
      seed = (seed * 16807) % 2147483647;
      click = ((seed / 2147483647) * 2 - 1) * clickPk * (0.0005 / clickPk) ** (t / 0.012);
    }
    wave[i] = y * gn + click;
    env[i] = gn;
    freq[i] = fr;
  }
  r = { wave, env, freq, T, sr, f, k };
  kickCache.set(sig, r);
  if (kickCache.size > 24) kickCache.delete(kickCache.keys().next().value);
  return r;
}

export function kickGraph(ed, { after } = {}) {
  const kit = ed.root;
  const key = () => ed.app.project.key;
  const geo = (w, hh) => area(w, hh, { l: 8, r: 34, t: 10, b: 16 });
  const HZ0 = 30;
  const HZ1 = 420;
  const X = (A, t, T) => A.L + Math.sqrt(clamp(t / T, 0, 1)) * A.W;
  const P = (A, fr) => A.B - logPos(clamp(fr, HZ0, HZ1), HZ0, HZ1) * A.H;
  const name = (fr) => noteName(Math.round(12 * Math.log2(fr / 440) + 69));
  const setTune = (d, dy) => { kit.tune = clamp(Math.round(d.start.tune - dy / 7), -7, 7); if (after) after(); };
  return editGraph(ed, {
    label: 'Kick: waveform, amp shape and pitch sweep, tuned to the key',
    hint: '↕ tune',
    readout: () => { const fr = kickHz(key(), kit.tune); return `${(KICKS[kit.kick] || KICKS.bigroom).name} · ${name(fr)} ${fr.toFixed(1)} Hz · tune ${signed(kit.tune, ' st')}`; },
    draw(g, w, hh) {
      const c = colors();
      const A = geo(w, hh);
      const K = kickSim(kit, key());
      const ticks = [[0.01, '10'], [0.05, '50'], [0.1, '100'], [0.25, '250'], [0.5, '500 ms']].filter(([t]) => t < K.T);
      gridLines(g, w, hh, ticks.map(([t]) => X(A, t, K.T)), [A.cy]);
      for (const [t, l] of ticks) text(g, l, X(A, t, K.T), hh - 4, { size: 9, align: 'center' });
      // the waveform: filled from the centre line, outlined (a column never spans a whole cycle)
      const amp = A.H * 0.47;
      const at = (px) => K.wave[Math.min(K.wave.length - 1, Math.floor(((px / A.W) ** 2) * K.T * K.sr))];
      const wpts = [];
      g.fillStyle = alpha(c.accent, 0.28);
      for (let px = 0; px <= A.W; px++) {
        const v = at(px);
        wpts.push([A.L + px, A.cy - v * amp]);
        g.fillRect(A.L + px, Math.min(A.cy, A.cy - v * amp), 1, Math.abs(v * amp));
      }
      curve(g, wpts, { color: alpha(c.accent, 0.95), width: 1.25 });
      // amp shape
      const envPts = sample(120, (u) => { const t = u * u * K.T; return [X(A, t, K.T), A.cy - K.env[Math.min(K.env.length - 1, Math.floor(t * K.sr))] * amp]; });
      curve(g, envPts, { color: alpha(c.text, 0.6), width: 1.25 });
      // pitch sweep on the right-hand Hz axis, with the key's root for reference
      const root = kickHz(key(), 0);
      dashed(g, [[A.L, P(A, root)], [A.R, P(A, root)]], alpha(c.teal, 0.7), 1, [3, 4]);
      text(g, `key root ${name(root)}`, A.R - 4, P(A, root) + 11, { size: 9, color: c.teal, align: 'right' });
      for (const fr of [50, 100, 200, 400]) text(g, String(fr), A.R + 3, P(A, fr), { size: 9, base: 'middle' });
      const fp = sample(120, (u) => { const t = u * u * K.T; return [X(A, t, K.T), P(A, K.freq[Math.min(K.freq.length - 1, Math.floor(t * K.sr))])]; });
      curve(g, fp, { color: c.blue, width: 2 });
    },
    handles(w, hh) {
      const A = geo(w, hh);
      const K = kickSim(kit, key());
      const t = Math.min(K.T * 0.6, K.k.sweep * 4);
      return [{ id: 'tune', x: X(A, t, K.T), y: P(A, K.f), keys: ['tune'], color: colors().blue, cursor: 'ns-resize', kind: 'kick',
        tip: () => `${signed(kit.tune, ' st')} · ${kickHz(key(), kit.tune).toFixed(1)} Hz`, move: (pt, d) => setTune(d, pt.dy) }];
    },
    press() { return { keys: ['tune'], hid: 'tune', kind: 'kick', move: (q, d) => setTune(d, q.dy) }; },
    pressCursor: 'ns-resize',
    kind: 'kick',
  });
}

const SHORT = { kick: 'Kick', clap: 'Clap', snare: 'Snare', hat: 'Hat', ohat: 'O-hat', ride: 'Ride', crash: 'Crash', perc: 'Perc' };
export function levelsGraph(ed) {
  const kit = ed.root;
  const MAX = 1.2;
  const geo = (w, hh) => area(w, hh, { l: 4, r: 4, t: 24, b: 18 });
  const col = (id) => { const c = colors(); return { kick: c.accent, clap: c.glow, snare: c.solo, hat: c.teal, ohat: c.teal, ride: c.blue, crash: c.text, perc: c.muted }[id]; };
  const n = VOICES.length;
  const setLevel = (A, id, y) => { kit.levels[id] = clamp(snap(((A.B - y) / A.H) * MAX, 0.01), 0, MAX); };
  return editGraph(ed, {
    label: 'Drum kit levels',
    hint: '↕ drag a bar',
    draw(g, w, hh, { act }) {
      const c = colors();
      const A = geo(w, hh);
      const cw = A.W / n;
      const y1 = A.B - (1 / MAX) * A.H;
      dashed(g, [[A.L, y1], [A.R, y1]], alpha(c.text, 0.3), 1);
      text(g, '100%', A.R - 2, y1 - 3, { size: 9, align: 'right' });
      VOICES.forEach((v, i) => {
        const lv = kit.levels[v.id] ?? 1;
        const x = A.L + cw * i + cw / 2;
        const bw = Math.min(cw * 0.56, 44);
        const y = A.B - (lv / MAX) * A.H;
        g.fillStyle = 'rgba(141, 151, 171, .08)';
        rrect(g, x - bw / 2, A.T, bw, A.H, 4);
        g.fill();
        if (lv > 0.005) {
          g.fillStyle = alpha(col(v.id), act === `levels.${v.id}` ? 0.95 : 0.7);
          rrect(g, x - bw / 2, y, bw, A.B - y, 4);
          g.fill();
        }
        text(g, fmtPct(lv), x, A.T - 9, { align: 'center', size: cw < 40 ? 9 : 10, color: lv > 0 ? c.text : c.muted });
        text(g, cw < 44 ? SHORT[v.id] : v.name, x, hh - 4, { align: 'center', size: cw < 40 ? 9 : 10.5, color: c.text, weight: 700 });
      });
    },
    handles(w, hh) {
      const A = geo(w, hh);
      const cw = A.W / n;
      return VOICES.map((v, i) => ({
        id: `levels.${v.id}`, x: A.L + cw * i + cw / 2, y: A.B - ((kit.levels[v.id] ?? 1) / MAX) * A.H, keys: [`levels.${v.id}`], color: col(v.id), cursor: 'ns-resize', kind: v.id,
        tip: () => `${v.name} ${fmtPct(kit.levels[v.id] ?? 1)}`, move: (pt) => setLevel(A, v.id, pt.y),
      }));
    },
    press(pt) {
      const A = geo(pt.w, pt.h);
      if (pt.y > A.B + 2) return null;
      const v = VOICES[clamp(Math.floor((pt.x - A.L) / (A.W / n)), 0, n - 1)];
      return { keys: [`levels.${v.id}`], hid: `levels.${v.id}`, kind: v.id, now: true, move: (q) => setLevel(A, v.id, q.y) };
    },
    pressCursor: 'ns-resize',
  });
}

// =====================================================================================================
// FX track: each event of the pattern on its own lane, drawn from playFx()'s schedules (loudness in
// dB plus the filter or pitch sweep). Drag an edge to move it or change its length, the body sideways
// to move it or up and down for its level; tap it to hear it.
// =====================================================================================================
// gain of an event x seconds in (dur seconds long), relative to its peak
function fxGain(type, x, dur) {
  switch (type) {
    case 'riser': { const e = Math.max(0.001, dur - 0.02); return x < e ? (0.0001 / 0.5) ** (1 - x / e) : Math.max(0, 1 - (x - e) / 0.02); }
    case 'noiseup': { const e = Math.max(0.001, dur - 0.01); return x < e ? (0.05 + (0.4 * x) / e) / 0.45 : Math.max(0, 1 - (x - e) / 0.01); }
    case 'downlifter': return (0.0005 / 0.5) ** (x / dur);
    case 'impact': { const len = Math.min(dur, 4); if (x > len) return 0; return x < 0.004 ? x / 0.004 : x < 0.05 ? 1 : Math.exp(-(x - 0.05) / (len / 5)); }
    case 'subdrop': { const len = Math.min(dur, 3); if (x > len + 0.1) return 0; return x < 0.01 ? x / 0.01 : x < len * 0.4 ? 1 : Math.exp(-(x - len * 0.4) / (len / 5)); }
    case 'reverse': { const e = Math.max(0.001, dur - 0.005); return x < e ? (0.0001 / 0.45) ** (1 - x / e) : 0; }
    default: return 0;
  }
}
// what sweeps inside the event: [from Hz, to Hz, over how many seconds (null: the whole event)]
function fxSweep(type, rootHz, dur) {
  if (type === 'riser') return [300, 9000, null];
  if (type === 'noiseup') return [600, 16000, null];
  if (type === 'downlifter') return [8000, 200, null];
  if (type === 'impact') return [12000, 400, Math.min(dur, 4)];
  if (type === 'subdrop') return [rootHz, rootHz / 3, Math.min(dur, 3)];
  return null;
}
const FX_NAME = { riser: 'Riser', noiseup: 'Noise sweep', downlifter: 'Downlifter', impact: 'Impact', subdrop: 'Sub drop', reverse: 'Reverse cymbal' };

export function fxTimeline(app, t, pat) {
  const sliders = new Map();
  const graphs = new Set();
  const ed = {
    app, t, root: pat, graphs, sliders,
    get: (p) => getP(pat, p),
    set: (p, v) => setP(pat, p, v),
    redrawAll(except) { for (const g of graphs) if (g !== except) g.redraw(); },
    sync(keys) { for (const k of keys || []) { const el = sliders.get(k); if (el) el.sync(); } },
    commit(i) {
      app.patternEdited(t, pat, false);
      const e = pat.fx[i];
      if (e && app.ui.audition !== false) app.previewFx(e);
    },
    reset() {},
  };
  const steps = () => pat.bars * 16;
  const st = () => 15 / app.project.bpm;
  const geo = (w, hh) => area(w, hh, { l: 4, r: 4, t: 6, b: 16 });
  const lane = (A, i) => { const lh = A.H / Math.max(1, pat.fx.length); return { y: A.T + i * lh, h: lh }; };
  const X = (A, s) => A.L + (s / steps()) * A.W;
  const DB = 42;
  const col = (type) => { const c = colors(); return { riser: c.accent, noiseup: c.teal, downlifter: c.blue, impact: c.mute, subdrop: c.solo, reverse: c.glow }[type] || c.muted; };
  const snapS = (v) => clamp(Math.round(v / 4) * 4, 0, steps() - 4);
  const box = editGraph(ed, {
    label: 'FX timeline: every riser, sweep and impact in this pattern',
    hint: 'drag edges or body · tap to hear',
    readout: () => (pat.fx.length ? `${pat.fx.length} effect${pat.fx.length > 1 ? 's' : ''} over ${pat.bars} bar${pat.bars > 1 ? 's' : ''}` : 'No effects yet'),
    draw(g, w, hh, { act }) {
      const c = colors();
      const A = geo(w, hh);
      const n = steps();
      for (let s = 0; s <= n; s += 4) { g.fillStyle = s % 16 === 0 ? 'rgba(141, 151, 171, .3)' : c.grid; g.fillRect(Math.round(X(A, s)), A.T, 1, A.H); }
      const every = Math.max(1, Math.ceil(pat.bars / Math.max(1, Math.floor(A.W / 34))));
      for (let b = 0; b < pat.bars; b += every) text(g, String(b + 1), X(A, b * 16) + 3, hh - 4, { size: 9 });
      if (!pat.fx.length) { text(g, 'Add a riser, sweep or impact below', A.cx, A.cy, { align: 'center', base: 'middle', size: 11 }); return; }
      const rootHz = mtof(app.project.key + 41);
      pat.fx.forEach((e, i) => {
        const L = lane(A, i);
        const x0 = X(A, e.s);
        const x1 = X(A, Math.min(n, e.s + e.len));
        const dur = Math.max(st(), e.len * st());
        // an event that runs past the pattern end is cut there: draw only the part that plays
        const shown = dur * ((Math.min(n, e.s + e.len) - e.s) / Math.max(1, e.len));
        const color = col(e.type);
        const on = typeof act === 'string' && act.startsWith(`fx.${i}.`);
        g.fillStyle = alpha(color, on ? 0.16 : 0.08);
        rrect(g, x0, L.y + 2, Math.max(4, x1 - x0), L.h - 4, 5);
        g.fill();
        g.lineWidth = 1;
        g.strokeStyle = alpha(color, on ? 0.9 : 0.45);
        g.stroke();
        // loudness in dB (how it rises and falls to the ear), scaled by the event's level
        const vel = e.vel ?? 1;
        const base = L.y + L.h - 3;
        const yv = (gn) => base - clamp(1 + db(gn * vel) / DB, 0, 1) * (L.h - 8);
        const N = Math.max(16, Math.round((x1 - x0) / 2));
        curve(g, sample(N, (u) => [x0 + u * (x1 - x0), yv(fxGain(e.type, u * shown, dur))]), { color, width: 1.75, fill: alpha(color, 0.22), y0: base });
        const sw = fxSweep(e.type, rootHz, dur);
        if (sw && L.h > 26) {
          const [f0, f1, over] = sw;
          const span = over ?? dur;
          const fy = (fr) => L.y + L.h - 4 - logPos(clamp(fr, 25, 16000), 25, 16000) * (L.h - 10);
          dashed(g, sample(24, (u) => { const k = Math.min(1, (u * shown) / span); return [x0 + u * (x1 - x0), fy(f0 * (f1 / f0) ** k)]; }), alpha(c.text, 0.55), 1, [3, 3]);
        }
        text(g, `${FX_NAME[e.type] || e.type}${L.h > 30 ? ` · ${fmtPct(vel)}` : ''}`, clamp(x0 + 8, A.L + 4, A.R - 110), L.y + 14, { size: 10, color: c.text, weight: 700 });
      });
    },
    handles(w, hh) {
      const A = geo(w, hh);
      const out = [];
      pat.fx.forEach((e, i) => {
        const L = lane(A, i);
        const y = L.y + L.h / 2;
        const color = col(e.type);
        const x0 = X(A, e.s);
        const x1 = X(A, Math.min(steps(), e.s + e.len));
        // a short event keeps the middle of its body free for moving, levelling and tapping
        const r = clamp((x1 - x0) / 4, 8, HIT);
        out.push({ id: `fx.${i}.s`, x: x0, y, r, keys: [`fx.${i}.s`], color, cursor: 'ew-resize', kind: i, tip: () => `starts bar ${(e.s / 16 + 1).toFixed(2)}`,
          move: (pt, d) => { e.s = snapS(d.start[`fx.${i}.s`] + (pt.dx / A.W) * steps()); } });
        out.push({ id: `fx.${i}.len`, x: x1, y, r, keys: [`fx.${i}.len`], color, cursor: 'ew-resize', kind: i, tip: () => `${(e.len / 16).toFixed(2)} bars`,
          move: (pt, d) => { e.len = clamp(Math.round((d.start[`fx.${i}.len`] + (pt.dx / A.W) * steps()) / 4) * 4, 4, steps()); } });
      });
      return out;
    },
    press(pt) {
      const A = geo(pt.w, pt.h);
      const i = pat.fx.findIndex((e, k) => { const L = lane(A, k); return pt.y >= L.y && pt.y < L.y + L.h && pt.x >= X(A, e.s) - 4 && pt.x <= X(A, e.s + e.len) + 4; });
      if (i < 0) return null;
      const e = pat.fx[i];
      // a tap only listens: it must not write into the song (an unannounced change would become a
      // stray undo step), so a missing vel stays missing and reads as 1
      let mode = null;
      return {
        keys: [`fx.${i}.s`, `fx.${i}.vel`], hid: `fx.${i}.body`, kind: i,
        move: (q, d) => {
          // the first real movement picks the axis: sideways moves it, up and down sets its level
          if (!mode) mode = Math.abs(q.dx) >= Math.abs(q.dy) ? 'move' : 'level';
          if (mode === 'move') e.s = snapS(d.start[`fx.${i}.s`] + (q.dx / A.W) * steps());
          else e.vel = clamp(snap((d.start[`fx.${i}.vel`] ?? 1) - q.dy / (lane(A, i).h + 40), 0.01), 0, 1);
        },
        up: (q, d) => { if (!d.moved) app.previewFx(e); return false; },
      };
    },
    pressCursor: 'grab',
  });
  return {
    el: box,
    redraw: () => ed.redrawAll(),
    // link an event's slider; get() reads the model in the slider's own units
    bind(key, el, get) { el.sync = () => el.setValue(get()); sliders.set(key, el); return el; },
  };
}
