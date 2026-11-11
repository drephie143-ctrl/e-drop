// Notes (piano roll + chord helper + FX events) and Drums screens. Sound is in sound.js, Mix in mix.js.
import { h, card, slider, seg, chip, select, field, openSheet, closeSheet, toast, fmtPct, fmtSec } from './dom.js';
import { NOTE_NAMES, SCALES, PROGRESSIONS, VOICINGS, GENERATORS, generate, noteName, progKey, progressionChords, spell } from '../music/theory.js';
import { newPattern, newTrack, uid } from '../music/project.js';
import { VOICES, KICKS, PATTERN_PRESETS, snareRoll, kickHz } from '../audio/drums.js';
import { FX_TYPES } from '../audio/fx.js';
import { kitEditor, kickGraph, levelsGraph, auditionChip, split, fxTimeline } from './graphs-sound.js';
import { copyBars, pasteBars, clearBars, repeatBars, fillBars, barsHave, kindOf, barSelOf, barsName, MAX_BARS } from '../music/bars.js';

export const MELODIC = new Set(['lead', 'pluck', 'pad', 'stab', 'bass', 'sub']);

// --- bars: pick whole bars of the pattern, then Repeat, Fill, Copy, Paste or Clear them ----------
// app.ui.bars = { track, pat, from, to, anchor, at } is the selection (bars [from, to) of that
// pattern); app.barClip is the bars copied, kept when you switch tracks or songs.
const cap = (s) => s[0].toUpperCase() + s.slice(1);
export const selOf = (app, t, pat) => barSelOf(app.ui.bars, t, pat);
export function selectBars(app, t, pat, from, to, anchor = from) {
  app.ui.bars = { track: t.id, pat: pat.id, from, to, anchor, at: performance.now() };
}

// The track and pattern in the editor on screen (the phone: the Notes or Drums tab), or null.
export function editorPart(app) {
  const p = app.project;
  const ui = app.ui;
  const t = p && p.tracks.find((x) => x.id === ui.track);
  if (!t) return null;
  const drums = t.role === 'drums';
  const on = app.desk ? (ui.editor === 'drums') === drums : (ui.tab === 'drums' && drums) || (ui.tab === 'notes' && !drums);
  return on ? { t, pat: curPattern(app, t) } : null;
}

const KIND_NAME = { notes: 'notes', hits: 'drum hits', fx: 'effects' };
const KIND_HOME = { notes: 'a synth track', hits: 'a drum pattern', fx: 'the FX track' };

// The bar actions for one pattern, shared by the bar strip and the keys (main.js: Ctrl+D, Ctrl+C,
// Ctrl+V, Delete). Each returns true when it did something or said why not.
export function barOps(app, t, pat) {
  const kind = kindOf(t.role);
  const sel = () => selOf(app, t, pat);
  const need = () => { toast('Select bars first: tap a bar number above the grid'); return true; };
  // the drum grid shows that bar (renderDrums turns it into a page once it knows the new width)
  const show = (b) => { if (t.role === 'drums') app.ui.drumShowBar = b; };
  // The pattern changed: re-render it. A longer pattern moves the clips in the song; while it plays,
  // start again in place (a preview stays a preview), or the part already sounding runs out at
  // its old length and the new bars stay silent until the next pass.
  const done = (grew) => {
    const E = app.engine;
    if (grew && E.playing) {
      const range = E.range;
      E.stop({ keep: true });
      E.play(E.pos, { range });
    } else if (grew) E.refresh();
    app.patternEdited(t, pat, true);
    app.emit('bars');
  };
  const longer = (r) => (r.grew ? ` · pattern ${pat.name} is now ${pat.bars} bars` : '') + (r.cut ? ` (a pattern goes up to ${MAX_BARS} bars)` : '');
  return {
    repeat() {
      const s = sel();
      if (!s) return need();
      const r = repeatBars(pat, s.from, s.to, kind);
      if (r.to <= r.from) { toast(`A pattern goes up to ${MAX_BARS} bars`); return true; }
      selectBars(app, t, pat, r.from, r.to);
      show(r.from);
      done(r.grew);
      toast(`Repeated ${barsName(s.from, s.to)} into ${barsName(r.from, r.to)}${longer(r)}`);
      return true;
    },
    fill() {
      const s = sel();
      if (!s) return need();
      const r = fillBars(pat, s.from, s.to, kind);
      if (!r) { toast(`Nothing after ${barsName(s.from, s.to)} to fill. Repeat adds bars.`); return true; }
      done(false);
      toast(`${cap(barsName(s.from, s.to))} repeated through bar ${pat.bars}`);
      return true;
    },
    copy() {
      const s = sel();
      if (!s) return need();
      app.barClip = { ...copyBars(pat, s.from, s.to, kind), what: `${t.name} ${barsName(s.from, s.to)}` };
      app.emit('bars');
      app.render();
      toast(`Copied ${app.barClip.what}. Select the bar it goes to, then Paste.`);
      return true;
    },
    paste() {
      const c = app.barClip;
      if (!c) { toast('Copy some bars first'); return true; }
      if (c.kind !== kind) { toast(`Those are ${KIND_NAME[c.kind]}: paste them into ${KIND_HOME[c.kind]}`); return true; }
      const s = sel();
      if (!s) return need();
      const r = pasteBars(pat, c, s.from);
      if (r.to <= r.from) { toast(`A pattern goes up to ${MAX_BARS} bars`); return true; }
      selectBars(app, t, pat, r.from, r.to);
      show(r.from);
      done(r.grew);
      toast(`Pasted ${c.what} at bar ${s.from + 1}${longer(r)}`);
      return true;
    },
    clear() {
      const s = sel();
      if (!s) return need();
      if (!barsHave(pat, s.from, s.to, kind, { ringing: true })) { toast(`${cap(barsName(s.from, s.to))} is already empty`); return true; }
      clearBars(pat, s.from, s.to, kind);
      done(false);
      toast(`Cleared ${barsName(s.from, s.to)}`);
      return true;
    },
    all() {
      selectBars(app, t, pat, 0, pat.bars);
      app.emit('bars');
      app.render();
      return true;
    },
  };
}

// The strip above the editor: a button per bar (tap one, drag across several, Shift-click to
// extend, tap the only selected bar again to let go), the actions, and Preview.
function barStrip(app, t, pat) {
  const s = selOf(app, t, pat);
  const ops = barOps(app, t, pat);
  const drums = t.role === 'drums';
  const span = Math.max(1, app.ui.drumSpan || 1);
  const page = app.ui.drumPage || 0;
  const kind = kindOf(t.role);
  const clip = app.barClip;
  const lbl = h('span', { class: 'bars-lbl' });
  const nums = h('div', { class: 'bnums', role: 'group', 'aria-label': 'Select bars' },
    Array.from({ length: pat.bars }, (_, b) => h('button', {
      class: 'bnum' + (drums && Math.floor(b / span) === page ? ' shown' : ''), 'data-bar': b,
      title: `Bar ${b + 1}: tap to select, drag across bars or Shift-click for several${drums ? '. Shows it in the grid.' : ''}`,
    }, String(b + 1))));
  const mark = () => {
    const x = selOf(app, t, pat);
    for (const el of nums.children) {
      const k = +el.dataset.bar;
      const on = !!x && k >= x.from && k < x.to;
      el.classList.toggle('on', on);
      el.setAttribute('aria-pressed', String(on));
    }
    lbl.textContent = x ? cap(barsName(x.from, x.to)) : 'Bars';
  };
  mark();
  // while the pointer moves only the marks change; the screens draw again when it lets go
  const live = () => { mark(); if (!drums && app.roll.el.isConnected) app.roll.draw(); app.emit('bars'); };
  const finish = () => {
    const x = selOf(app, t, pat);
    if (drums && x && Math.floor(x.from / span) !== page) app.ui.drumPage = Math.floor(x.from / span);
    app.emit('bars');
    app.render();
  };
  // on the drums, tapping the selected bar while another page shows brings it into view (it stays selected)
  pickBars(app, t, pat, nums, (b) => +b.dataset.bar, '.bnum', live, finish, { keep: (b) => drums && Math.floor(b / span) !== page });
  const act = (label, title, fn, on, cls = '') => h('button', { class: 'chip ' + cls, title, disabled: !on, onclick: fn }, label);
  const P = app.previewer;
  // one row that wraps where it must: the numbers, then the actions, then Preview
  return h('div', { class: 'bars-strip', role: 'toolbar', 'aria-label': 'Bars' }, lbl, nums,
    h('button', { class: 'chip', title: 'Select every bar of the pattern', onclick: ops.all }, 'All'),
    act('Repeat', 'Copy the selected bars right after them; again for one more copy (Ctrl+D)', ops.repeat, !!s, 'bars-gap'),
    act('Fill', 'Repeat the selected bars to the end of the pattern', ops.fill, !!s && s.to < pat.bars),
    act('Copy', 'Copy the selected bars (Ctrl+C)', ops.copy, !!s),
    act('Paste', clip ? `Paste ${clip.what} at the selected bar (Ctrl+V)` : 'Copy some bars first', ops.paste, !!s && !!clip && clip.kind === kind),
    act('Clear', 'Empty the selected bars (Delete)', ops.clear, !!s),
    P ? h('button', { class: 'chip pv bars-gap', title: 'Hear it in the song, from a few seconds before to a few seconds after (P)', onclick: () => P.play() }, '▶ Preview') : null,
    P ? h('button', { class: 'chip', title: 'How much to play before and after', 'aria-label': `Preview settings: ${P.prefs.pre} s before, ${P.prefs.post} s after`, onclick: () => P.sheet() }, `${P.prefs.pre} s · ${P.prefs.post} s`) : null);
}

// Bar picking on a set of elements (the strip's numbers, the drum grid's bar labels): press one
// to select it, drag across others to extend, Shift extends from the first one, and a tap on the
// only selected bar lets it go (unless keep(bar) says to keep it). `barOf(el)` reads an element's bar.
export function pickBars(app, t, pat, box, barOf, sel, live, finish, { keep = () => false } = {}) {
  let drag = null;
  const at = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const b = el && el.closest && el.closest(sel);
    return b && box.contains(b) ? barOf(b) : null;
  };
  const set = (anchor, b) => selectBars(app, t, pat, Math.min(anchor, b), Math.max(anchor, b) + 1, anchor);
  box.addEventListener('pointerdown', (e) => {
    const b = at(e);
    if (b == null || e.button) return;
    e.preventDefault();
    const s = selOf(app, t, pat);
    const anchor = e.shiftKey && s ? app.ui.bars.anchor ?? s.from : b;
    drag = { anchor, last: b, moved: false, was: !e.shiftKey && !!s && s.from === b && s.to === b + 1 };
    try { box.setPointerCapture(e.pointerId); } catch { /* fine */ }
    set(anchor, b);
    live();
  });
  box.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const b = at(e);
    if (b == null || b === drag.last) return;
    drag.last = b;
    drag.moved = true;
    set(drag.anchor, b);
    live();
  });
  const end = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.was && !d.moved && !keep(d.last)) app.ui.bars = null;
    finish();
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  // Enter or Space on a focused bar button
  box.addEventListener('click', (e) => {
    if (e.detail !== 0) return;
    const el = e.target.closest && e.target.closest(sel);
    if (!el) return;
    const b = barOf(el);
    const s = selOf(app, t, pat);
    if (s && s.from === b && s.to === b + 1) { if (!keep(b)) app.ui.bars = null; } else selectBars(app, t, pat, b, b + 1);
    finish();
  });
}

export function trackChips(app, filter, onPick) {
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
  if (t.role === 'fx') { root.replaceChildren(chips, patternBar(app, t, pat), barStrip(app, t, pat), fxEditor(app, t, pat)); return; }
  const ui = app.ui;
  const s = t.synth;
  const tools = h('div', { class: 'row tools' },
    seg([[4, '1/4'], [2, '1/8'], [1, '1/16']], ui.grid, (v) => { ui.grid = v; ui.noteLen = v; app.render(); }, 'mini'),
    h('button', { class: 'chip on-accent', onclick: () => chordSheet(app, t, pat) }, 'Chords & parts'),
    chip('Arp', s.arp.on, (v) => { s.arp.on = v; app.soundChanged(t); app.render(); toast(v ? `Arpeggiator on: ${s.arp.mode}, ${s.arp.rate}. Settings in Sound.` : 'Arpeggiator off'); }),
    chip('Ghosts', ui.ghosts, (v) => { ui.ghosts = v; app.render(); }));
  root.replaceChildren(chips, patternBar(app, t, pat), tools, barStrip(app, t, pat), app.roll.el,
    h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Tap to add a note · tap a note to delete · drag a note to move · drag its right end to resize · drag empty space to scroll. Tap the keys to hear them. Tap a bar number (or the ruler) to select bars.'));
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
  if (app.ui.audition === undefined) app.ui.audition = true;
  // the timeline graph and the sliders below edit the same events and follow each other
  const tl = fxTimeline(app, t, pat);
  const list = pat.fx.map((e, i) => card(null,
    h('div', { class: 'row' }, h('b', { class: 'grow' }, FX_TYPES[e.type].name), h('button', { class: 'chip', onclick: () => app.previewFx(e) }, '▶ Hear'),
      h('button', { class: 'chip danger', onclick: () => { pat.fx.splice(pat.fx.indexOf(e), 1); app.patternEdited(t, pat, true); } }, 'Remove')),
    tl.bind(`fx.${i}.s`, slider('Starts', e.s / 16, 0, pat.bars - 0.25, 0.25, (v) => { e.s = v * 16; tl.redraw(); }, (v) => `bar ${(v + 1).toFixed(2)}`, { onChange: () => app.patternEdited(t, pat, true) }), () => e.s / 16),
    tl.bind(`fx.${i}.len`, slider('Length', e.len / 16, 0.25, pat.bars, 0.25, (v) => { e.len = v * 16; tl.redraw(); }, (v) => `${v} bars`, { onChange: () => app.patternEdited(t, pat, true) }), () => e.len / 16),
    tl.bind(`fx.${i}.vel`, slider('Level', e.vel ?? 1, 0, 1, 0.01, (v) => { e.vel = v; tl.redraw(); }, fmtPct, { onChange: () => app.patternEdited(t, pat, true) }), () => e.vel ?? 1)));
  return h('div', { class: 'stack fx-stack' },
    card('Add an effect',
      h('p', { class: 'hint' }, `This pattern is ${pat.bars} bars. Risers and sweeps fill it and peak at the end, ready for the drop. Impacts hit on bar 1.`),
      h('div', { class: 'chips' },
        h('button', { class: 'chip', onclick: () => add('riser', 0, steps) }, '+ Riser'),
        h('button', { class: 'chip', onclick: () => add('noiseup', steps / 2, steps / 2) }, '+ Noise sweep up'),
        h('button', { class: 'chip', onclick: () => add('downlifter', 0, Math.min(steps, 32)) }, '+ Downlifter'),
        h('button', { class: 'chip', onclick: () => add('impact', 0, Math.min(steps, 64)) }, '+ Impact'),
        h('button', { class: 'chip', onclick: () => add('subdrop', 0, Math.min(steps, 32)) }, '+ Sub drop'),
        h('button', { class: 'chip', onclick: () => add('reverse', Math.max(0, steps - 16), 16) }, '+ Reverse cymbal'))),
    pat.fx.length ? card('FX timeline', h('div', { class: 'row sg-play' }, auditionChip(app), h('span', { class: 'hint grow' }, 'The curve is how loud it gets; the dashed line is its filter or pitch sweep.')), tl.el) : null,
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
  if (ui.audition === undefined) ui.audition = true;
  // Drum page rule (shared with main.js): drumSpan bars show at once, page k shows bars
  // [k*span, (k+1)*span), and each step's data-step is its 16th within the page.
  const span = drumSpanFor(root, pat.bars);
  const was = ui.drumSpan || 1;
  if (was !== span) ui.drumPage = Math.floor(((ui.drumPage || 0) * was) / span);
  ui.drumSpan = span;
  // a bar to bring into view (Repeat or Paste, which may also have changed the length and span)
  if (ui.drumShowBar != null) { ui.drumPage = Math.floor(ui.drumShowBar / span); ui.drumShowBar = null; }
  const pages = Math.ceil(pat.bars / span);
  ui.drumPage = Math.max(0, Math.min(ui.drumPage || 0, pages - 1));
  const page = ui.drumPage;
  const first = page * span * 16;
  const drums = p.tracks.filter((x) => x.role === 'drums');
  const bsel = selOf(app, t, pat);
  const step = (v, i) => {
    const s = first + i;
    // the last page of a length the span doesn't divide: the bars past the end are blank
    if (s >= pat.bars * 16) return h('span', { class: 'step void', 'aria-hidden': 'true' });
    const hs = pat.hits.filter((x) => x.v === v.id && x.s >= s && x.s < s + 1);
    const roll = hs.length > 1 || hs.some((x) => x.s % 1);
    const vel = hs.reduce((a, x) => Math.max(a, x.vel), 0);
    const inSel = bsel && s >= bsel.from * 16 && s < bsel.to * 16;
    return h('button', {
      class: 'step' + (hs.length ? ' on' : '') + (roll ? ' roll' : '') + (i % 4 === 0 ? ' beat' : '') + (inSel ? ' bsel' : ''), 'data-step': i,
      style: hs.length ? { opacity: String(0.45 + 0.55 * vel) } : null,
      'aria-label': `${v.name} step ${s + 1}`,
      onclick: () => {
        if (hs.length) pat.hits = pat.hits.filter((x) => !hs.includes(x));
        else { pat.hits.push({ v: v.id, s, vel: v.id === 'kick' ? 1 : 0.9 }); app.preview(t, v.id); }
        app.patternEdited(t, pat, true);
      },
    });
  };
  // one bar: the original 16-column grid; several bars: a 16-column grid per bar, side by side
  const cells = (v) => (span === 1
    ? h('div', { class: 'dcells' }, Array.from({ length: 16 }, (_, i) => step(v, i)))
    : h('div', { class: 'dcells multi' }, Array.from({ length: span }, (_, b) => h('div', { class: 'dbar' }, Array.from({ length: 16 }, (_, i) => step(v, b * 16 + i))))));
  // several bars side by side: each one's label above it selects it, like the strip's numbers
  let ruler = null;
  if (span > 1) {
    const lbls = h('div', { class: 'dcells multi' }, Array.from({ length: span }, (_, b) => {
      const k = page * span + b;
      if (k >= pat.bars) return h('span', { class: 'dbar-lbl void' });
      const on = bsel && k >= bsel.from && k < bsel.to;
      return h('button', { class: 'dbar-lbl' + (on ? ' on' : ''), 'data-bar': k, title: `Select bar ${k + 1} (drag or Shift-click for several)` }, `Bar ${k + 1}`);
    }));
    pickBars(app, t, pat, lbls, (el) => +el.dataset.bar, '.dbar-lbl[data-bar]', () => {
      const x = selOf(app, t, pat);
      for (const el of lbls.children) el.classList.toggle('on', !!x && +el.dataset.bar >= x.from && +el.dataset.bar < x.to);
      app.emit('bars');
    }, () => { app.emit('bars'); app.render(); });
    ruler = h('div', { class: 'drow druler' }, h('span', { class: 'dname' }), lbls);
  }
  const grid = h('div', { class: 'dgrid' + (span > 1 ? ' wide' : '') },
    ruler,
    VOICES.map((v) => h('div', { class: 'drow' },
      h('button', { class: 'dname', onclick: () => app.preview(t, v.id) }, v.name),
      cells(v))));
  const kitCard = drumKitCard(app, t);
  watchDrumWidth(app, root);
  // the pages of a long beat: ‹ › only move the view; the strip's numbers select (and show) a bar
  const go = (k) => { ui.drumPage = k; app.render(); };
  const pager = pages > 1 ? h('div', { class: 'dpager' },
    h('button', { 'aria-label': 'Previous bars', title: 'Previous bars', disabled: page === 0, onclick: () => go(page - 1) }, '‹'),
    h('b', {}, page * span + 1 >= Math.min(pat.bars, (page + 1) * span) ? `Bar ${page * span + 1} of ${pat.bars}` : `Bars ${page * span + 1}–${Math.min(pat.bars, (page + 1) * span)} of ${pat.bars}`),
    h('button', { 'aria-label': 'Next bars', title: 'Next bars', disabled: page >= pages - 1, onclick: () => go(page + 1) }, '›')) : null;
  root.replaceChildren(
    drums.length > 1 ? trackChips(app, (x) => x.role === 'drums', (x) => { app.ui.track = x.id; app.render(); }) : '',
    patternBar(app, t, pat),
    // the strip's numbers underline the bars on screen
    barStrip(app, t, pat),
    pager,
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

// How many bars of the drum grid fit side by side at 26 px or more per step, 1 on a phone: the
// largest divisor of the pattern length that fits (so every page is whole), unless that is under
// half what fits (a 5-bar beat, made by Repeat): then as many as fit, the last page partly blank.
const DRUM_STEP_MIN = 26;
function drumSpanFor(root, bars) {
  const w = root.clientWidth;
  if (!w || !(bars > 1)) return 1;
  const cs = getComputedStyle(root);
  const inner = w - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  const perBar = 16 * DRUM_STEP_MIN + 15 * 2 + 10; // steps, the 2 px gaps, the gap between bars
  const fit = Math.max(1, Math.floor((inner - 80 + 10) / perBar)); // 80: the voice names column
  const cap = Math.min(fit, bars);
  let span = 1;
  for (let d = 2; d <= cap; d++) if (bars % d === 0) span = d;
  return span * 2 < cap ? cap : span;
}

// Re-lay the grid when the Drums panel changes width (desktop window or panel resize).
function watchDrumWidth(app, root) {
  if (root.__drumWatch || typeof ResizeObserver === 'undefined') return;
  let timer = 0;
  root.__drumWatch = new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const grid = root.querySelector('.dgrid');
      if (!grid || !root.clientWidth || !app.project) return;
      const t = app.project.tracks.find((x) => x.id === app.ui.track && x.role === 'drums') || app.project.tracks.find((x) => x.role === 'drums');
      const pat = curPattern(app, t);
      if (!pat || drumSpanFor(root, pat.bars) === (app.ui.drumSpan || 1)) return;
      const keep = app.ui.track; // in desk mode the other panels keep their own selection
      renderDrums(app, root);
      app.ui.track = keep;
    }, 120);
  });
  root.__drumWatch.observe(root);
}

// Kit: the kick (waveform, amp shape and pitch sweep against the key) and the voice levels as
// draggable graphs, with their sliders.
function drumKitCard(app, t) {
  const p = app.project;
  const kit = t.kit;
  const ed = kitEditor(app, t);
  const tuneText = () => {
    const f = kickHz(p.key, kit.tune);
    return `The kick is tuned to the key: ${noteName(Math.round(12 * Math.log2(f / 440) + 69))} (${f.toFixed(1)} Hz) with tune at ${kit.tune}.`;
  };
  const hint = h('p', { class: 'hint' }, tuneText());
  const after = () => { hint.textContent = tuneText(); };
  return card('Kit',
    h('div', { class: 'row sg-play' }, auditionChip(app), h('span', { class: 'hint grow' }, 'Drag the graphs or use the ◀ ▶ arrows. Double-tap a handle to reset it.')),
    h('div', { class: 'kit-grid' },
      split([kickGraph(ed, { after })], [
        field('Kick', select(Object.entries(KICKS).map(([k, v]) => [k, v.name]), kit.kick, (v) => { kit.kick = v; ed.redrawAll(); after(); ed.commit('kick'); })),
        ed.slider('Kick tune', kit, 'tune', -7, 7, 1, (v) => `${v > 0 ? '+' : ''}${v} st · ${kickHz(p.key, v).toFixed(1)} Hz`, { kind: 'kick', after }),
        hint], 'kit-kick'),
      split([levelsGraph(ed)], [
        h('div', { class: 'kit-levels' }, VOICES.map((v) => ed.slider(v.name, kit.levels, v.id, 0, 1.2, 0.01, fmtPct, { kind: v.id }))),
        ed.slider('Hat decay', kit, 'hatDecay', 0.02, 0.2, 0.005, fmtSec, { kind: 'hat' })], 'kit-lv')));
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
