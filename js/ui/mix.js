// Mix tab: loudness meter and history, mix stage, track strips, master EQ and dynamics, reverb,
// delay and sidechain. Every section has a visual editor (js/ui/graphs-mix.js) that stays in
// sync with its sliders both ways: graph drags move the sliders, slider moves redraw the graph.
import { h, card, slider, seg, field, openSheet, closeSheet, toast, fmtPct, fmtDb, fmtSec } from './dom.js';
import { newPattern, newTrack } from '../music/project.js';
import { ROLES } from '../audio/presets.js';
import { DELAY_TIMES } from '../audio/fx.js';
import { eqGraph, dynGraph, loudGraph, reverbGraph, delayGraph, pumpGraph, stageGraph, addLive } from './graphs-mix.js';

const fmtPan = (v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`);
const sub = (title, note) => h('div', { class: 'mx-sub' }, h('b', {}, title), note ? h('small', {}, note) : null);
const sec = (...kids) => h('div', { class: 'mx-sec' }, ...kids);

// --- Mix -------------------------------------------------------------------------------------
export function renderMix(app, root) {
  const p = app.project;
  const M = p.master;
  const mm = () => app.mixChanged();
  const sl = {}; // slider elements by key ('low', 'revSize', '<trackId>:vol'…), moved by graph drags
  const gx = { sync: (key, v) => { if (sl[key]) sl[key].setValue(v); } };
  const G = {
    loud: loudGraph(app), stage: stageGraph(app, gx), eq: eqGraph(app, gx), dyn: dynGraph(app, gx),
    rev: reverbGraph(app, gx), dly: delayGraph(app, gx), pump: pumpGraph(app, gx),
  };
  // a master slider that commits live and redraws its graph
  const MS = (label, key, min, max, step, fmt, gr) => (sl[key] = slider(label, M[key], min, max, step, (v) => { M[key] = v; mm(); gr.redraw(); }, fmt));

  const num = (label, id, unit) => h('div', { class: 'mcol' }, h('small', {}, label), h('b', { id }, '–'), h('small', {}, unit));
  const meter = card('Loudness',
    h('div', { class: 'meter' }, num('Momentary', 'lufsM', 'LUFS'), num('Short-term', 'lufsS', 'LUFS'), num('Peak', 'peakDb', 'dBFS'), num('Limiter', 'grDb', 'dB')),
    h('div', { class: 'mbar' }, h('div', { id: 'lufsBar' }), h('i', { style: { left: `${((-9 + 40) / 40) * 100}%` }, title: 'Club loud, −9 LUFS' }), h('i', { class: 'soft', style: { left: `${((-14 + 40) / 40) * 100}%` }, title: 'Streaming, −14 LUFS' })),
    G.loud.el,
    h('p', { class: 'hint' }, 'Festival masters sit around −9 to −7 LUFS short-term in the drop. Streaming turns everything down to about −14.'));
  addLive(app, meter, meterTick(app, meter));

  const stage = card('Mix stage', G.stage.el,
    h('p', { class: 'hint' }, 'One dot per track: drag left–right to pan, up–down for volume. Keep kick, bass and sub dead centre; spread plucks and arps a little to the sides.'));

  const anySolo = p.tracks.some((t) => t.mix.solo);
  const strips = p.tracks.map((t) => {
    const x = t.mix;
    const S = (label, key, min, max, step, fmt, after) => (sl[`${t.id}:${key}`] = slider(label, x[key], min, max, step, (v) => { x[key] = v; mm(); if (after) after(); }, fmt));
    const open = app.ui.openStrip === t.id;
    return h('div', { class: 'strip' + (x.mute || (anySolo && !x.solo) ? ' dim' : ''), 'data-track': t.id },
      h('div', { class: 'row' },
        h('span', { class: 'dot', style: { background: t.color } }),
        h('button', { class: 'sname grow', onclick: () => { app.ui.openStrip = open ? null : t.id; app.render(); } }, t.name, t.name.startsWith(ROLES[t.role].short) ? null : h('small', {}, ROLES[t.role].short)),
        h('button', { class: 'ms' + (x.mute ? ' m' : ''), 'aria-pressed': String(!!x.mute), 'aria-label': `Mute ${t.name}`, onclick: () => { x.mute = !x.mute; mm(); app.render(); } }, 'M'),
        h('button', { class: 'ms' + (x.solo ? ' s' : ''), 'aria-pressed': String(!!x.solo), 'aria-label': `Solo ${t.name}`, onclick: () => { x.solo = !x.solo; mm(); app.render(); } }, 'S')),
      S('Volume', 'vol', 0, 1.2, 0.01, fmtPct, () => G.stage.redraw()),
      S('Pump', 'duck', 0, 1, 0.01, fmtPct, () => G.pump.refresh()),
      open ? [S('Pan', 'pan', -1, 1, 0.01, fmtPan, () => G.stage.redraw()),
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
  const tracks = card('Tracks', h('div', { class: 'mx-strips' }, strips),
    h('button', { class: 'btn', onclick: () => addTrackSheet(app) }, '+ Add track'));

  const master = card('Master',
    h('div', { class: 'mx-split' },
      sec(sub('EQ', 'drag Low · Mid · High'), G.eq.el,
        MS('Low', 'low', -6, 6, 0.1, fmtDb, G.eq), MS('Mid', 'mid', -6, 6, 0.1, fmtDb, G.eq), MS('High', 'high', -6, 6, 0.1, fmtDb, G.eq),
        h('p', { class: 'hint' }, 'On the master, small moves only: ±1–2 dB. Fix a single sound on its own track.')),
      sec(sub('Dynamics', 'glue → drive → limiter'), G.dyn.el,
        MS('Glue comp', 'glue', 0, 1, 0.01, fmtPct, G.dyn), MS('Drive', 'drive', 0, 9, 0.1, fmtDb, G.dyn),
        MS('Ceiling', 'ceiling', -3, -0.1, 0.1, fmtDb, G.dyn), MS('Output', 'volume', 0, 1.2, 0.01, fmtPct, G.dyn),
        h('p', { class: 'hint' }, 'Glue squeezes the mix together. Drive pushes it into the limiter: louder, but too much flattens the kick. Keep the ceiling at −1 dB.'))));

  const fx = card('Reverb, delay and sidechain',
    h('div', { class: 'mx-split three' },
      sec(sub('Reverb', 'size · damping · level'), G.rev.el,
        sl.revSize = slider('Reverb size', M.revSize, 0.8, 6, 0.1, (v) => { M.revSize = v; G.rev.redraw(); }, fmtSec, { onChange: () => app.structureChanged() }),
        sl.revDamp = slider('Damping', M.revDamp, 0, 1, 0.01, (v) => { M.revDamp = v; G.rev.redraw(); }, fmtPct, { onChange: () => app.structureChanged() }),
        MS('Reverb level', 'revLevel', 0, 1.5, 0.01, fmtPct, G.rev),
        h('p', { class: 'hint' }, 'Bigger size, longer hall. Damping darkens the tail so it sits behind the lead. The return is cut below 220 Hz to keep the low end clean.')),
      sec(sub('Delay', 'ping-pong, tempo-synced'), G.dly.el,
        field('Delay time (synced)', seg(Object.keys(DELAY_TIMES).map((k) => [k, k]), M.dlyTime, (v) => { M.dlyTime = v; mm(); app.render(); }, 'mini')),
        MS('Feedback', 'dlyFb', 0, 0.85, 0.01, fmtPct, G.dly),
        MS('Delay level', 'dlyLevel', 0, 1.5, 0.01, fmtPct, G.dly),
        h('p', { class: 'hint' }, 'Echoes bounce left (blue) and right (orange). 3/16 is the classic trance bounce; feedback sets how many repeats you hear.')),
      sec(sub('Sidechain pump', 'one bar, four kicks'), G.pump.el, G.pump.legend,
        sl.pumpRelease = slider('Pump release', M.pumpRelease, 0.15, 1, 0.01, (v) => { M.pumpRelease = v; G.pump.redraw(); }, (v) => `${v.toFixed(2)} beat`, { onChange: () => app.pumpChanged() }),
        sl.pumpCurve = slider('Pump curve', M.pumpCurve, 0.6, 4, 0.1, (v) => { M.pumpCurve = v; G.pump.redraw(); }, (v) => (v < 1.5 ? 'Smooth' : v < 2.6 ? 'Classic' : 'Hard'), { onChange: () => app.pumpChanged() }),
        MS('Pump on FX', 'pumpFx', 0, 1, 0.01, fmtPct, { redraw: () => G.pump.refresh() }))), // refresh: the legend shows it too
    h('p', { class: 'hint' }, 'Every track ducks under the kick by its own Pump amount, and recovers over the release. Drag a line in the pump graph to set that track\'s depth (on a touch screen, tap its name first).'));

  for (const c of [master, fx, tracks]) c.classList.add('mx-card');
  root.replaceChildren(h('div', { class: 'stack mx' }, meter, stage, tracks, master, fx));
}

// The meter numbers, from app.meterNow (main.js stores the latest engine.meter() reading there).
function meterTick(app, el) {
  const q = (id) => el.querySelector('#' + id);
  const out = { m: q('lufsM'), s: q('lufsS'), pk: q('peakDb'), gr: q('grDb'), bar: q('lufsBar') };
  let last = null;
  const put = (node, s) => { if (node && node.textContent !== s) node.textContent = s; };
  return () => {
    const L = app.meterNow;
    if (!L || (L === last && !app.engine.playing)) return;
    last = L;
    put(out.m, L.m > -60 ? L.m.toFixed(1) : '–');
    put(out.s, L.s > -60 ? L.s.toFixed(1) : '–');
    put(out.pk, L.peak > 1e-4 ? (20 * Math.log10(L.peak)).toFixed(1) : '–');
    put(out.gr, L.gr < -0.05 ? L.gr.toFixed(1) : '0');
    if (out.s) out.s.className = L.s >= -10 ? 'hot' : L.s >= -16 ? 'warm' : '';
    if (out.bar) out.bar.style.width = `${Math.max(0, Math.min(100, ((L.s + 40) / 40) * 100))}%`;
  };
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
