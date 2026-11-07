// Song tab: the arrangement timeline. Sections across the top, a row per track showing
// which pattern plays in each section, and automation lanes under it.
// On a computer (app.desk) the timeline fits the whole song to the panel width by default,
// rows fill the panel height, cells show a picture of their pattern, a track's name selects it
// for the editor and Sound panels, and the selected section's card sits beside the timeline.
import { h, card, openSheet, closeSheet, seg, toast } from './dom.js';
import { SECTION_TYPES, addSection, newPattern, buildSweep, putRange, uid } from '../music/project.js';
import { LANE_PARAMS, laneValue, sectionStarts, songBars } from '../audio/engine.js';
import { VOICES } from '../audio/drums.js';

const PHONE_LABEL = 64;
const MAX_BPX = { phone: 40, desk: 240 };

export function renderSong(app, root, again = false) {
  const p = app.project;
  const ui = app.ui;
  const desk = !!app.desk;
  const LABEL = desk ? (app.ultra ? 172 : 152) : PHONE_LABEL;
  const total = songBars(p);
  const starts = sectionStarts(p);
  ui.section = Math.min(ui.section, p.sections.length - 1);
  // Fit: the whole song across the visible width (measured after the first layout, below)
  const fit = desk && ui.tlFit !== false;
  if (fit) ui.barPx = Math.max(4, ((ui.tlAvail || root.clientWidth * 0.72) - LABEL - 8) / Math.max(1, total));
  const bpx = ui.barPx;
  ui.tlLabel = LABEL;
  const W = LABEL + total * bpx + (desk ? 8 : 24);

  const row = (cls, label, kids, attrs = {}) => h('div', { class: 'tl-row ' + cls, style: { width: W + 'px' }, ...attrs },
    h('div', { class: 'tl-label' }, label), ...kids);

  // ruler: tap to move the playhead (positions are divided by the display-size zoom)
  const ticks = [];
  const every = desk ? (bpx >= 30 ? 1 : bpx >= 15 ? 2 : bpx >= 8 ? 4 : 8) : bpx < 9 ? 8 : 4;
  for (let b = 0; b < total; b += every) ticks.push(h('span', { class: desk && b % 4 === 0 ? 'q' : null, style: { left: LABEL + b * bpx + 'px' } }, String(b + 1)));
  const pos = app.engine.position();
  if (desk) ticks.push(h('div', { class: 'tl-ph-cap', style: { left: LABEL + pos * bpx + 'px' } }));
  const ruler = row('tl-ruler', 'bar', ticks, {
    onclick: (e) => {
      const el = e.currentTarget;
      const r = el.getBoundingClientRect();
      const z = r.width / el.offsetWidth || 1;
      const bar = Math.max(0, ((e.clientX - r.left) / z - LABEL) / bpx);
      app.engine.seek(Math.round(bar));
    },
  });

  const secRow = row('tl-secs', 'section', p.sections.map((s, i) => h('button', {
    class: 'tl-sec' + (i === ui.section ? ' sel' : ''),
    style: { left: LABEL + starts[i] * bpx + 'px', width: s.bars * bpx - 2 + 'px', background: SECTION_TYPES[s.type].color },
    onclick: () => { ui.section = i; if (app.engine.loop) app.setLoop(true); app.render(); },
  }, h('b', {}, s.name), h('small', {}, desk && s.bars * bpx > 90 ? `${s.bars} bars` : `${s.bars}`))));

  const anySolo = p.tracks.some((t) => t.mix.solo);
  const trackRows = p.tracks.map((t) => {
    const cells = p.sections.map((s, i) => {
      const pid = s.cells[t.id];
      const pat = pid && t.patterns.find((x) => x.id === pid);
      const reps = pat ? Math.ceil(s.bars / pat.bars) : 0;
      const wpx = s.bars * bpx - 2;
      return h('button', {
        class: 'tl-cell' + (pat ? ' on' : ''),
        style: { left: LABEL + starts[i] * bpx + 'px', width: wpx + 'px', '--c': t.color },
        onclick: () => cellSheet(app, t, i),
        'aria-label': `${t.name} in ${s.name}`,
      }, pat && desk ? miniPattern(t, pat, s.bars, wpx) : null, pat ? h('span', {}, pat.name + (reps > 1 ? ` ×${reps}` : '')) : '');
    });
    if (!desk) return row('tl-track', h('span', { class: 'dot', style: { background: t.color } }, ''), cells, { 'data-track': t.id });
    // a computer: the name selects the track; M and S mute and solo it
    const x = t.mix;
    const toggle = (k) => { x[k] = !x[k]; app.mixChanged(); app.render(); };
    const label = h('div', { class: 'tl-label' },
      h('button', { class: 'tl-pick', title: `Edit ${t.name}`, onclick: () => { ui.track = t.id; app.render(); } },
        h('span', { class: 'dot', style: { background: t.color } }), h('span', { class: 'tl-tname' }, t.name)),
      h('button', { class: 'tl-ms m' + (x.mute ? ' on' : ''), title: `Mute ${t.name}`, 'aria-pressed': String(!!x.mute), onclick: () => toggle('mute') }, 'M'),
      h('button', { class: 'tl-ms s' + (x.solo ? ' on' : ''), title: `Solo ${t.name}`, 'aria-pressed': String(!!x.solo), onclick: () => toggle('solo') }, 'S'));
    return h('div', {
      class: 'tl-row tl-track' + (t.id === ui.track ? ' sel' : '') + (x.mute || (anySolo && !x.solo) ? ' dim' : ''),
      style: { width: W + 'px', '--c': t.color }, 'data-track': t.id,
    }, label, ...cells);
  });
  if (!desk) trackRows.forEach((r, k) => { r.querySelector('.tl-label').append(h('span', { class: 'tl-tname' }, p.tracks[k].name)); });

  const laneRows = p.automation.map((lane) => laneRow(app, lane, W, bpx, total, LABEL, desk ? 52 : 54));

  const head = h('div', { class: 'tl-ph', style: { left: LABEL + pos * bpx + 'px' } });
  const inner = h('div', { class: 'tl-inner', style: desk ? { width: W + 'px', '--bpx': String(bpx), '--lbl': LABEL + 'px' } : { width: W + 'px' } },
    ruler, secRow, ...trackRows, ...laneRows, head);
  const tl = h('div', { class: 'tl', id: 'timeline' }, inner);
  tl.addEventListener('scroll', () => { ui.tlScroll = tl.scrollLeft; ui.tlScrollY = tl.scrollTop; }, { passive: true });

  const s = p.sections[ui.section];
  const secCard = s ? sectionCard(app, s, ui.section, starts[ui.section]) : h('div', { class: 'empty' }, 'No sections yet. Add an intro to start.');

  // zoom keeps the bar under the pointer (or the middle of the view) where it is
  const zoomAt = (f, ax) => {
    const bar = (tl.scrollLeft + ax - LABEL) / bpx;
    ui.tlFit = false;
    ui.barPx = Math.max(4, Math.min(MAX_BPX.desk, bpx * f));
    ui.tlScroll = Math.max(0, bar * ui.barPx + LABEL - ax);
    renderSong(app, root);
  };
  const zoomBtn = (f) => {
    if (desk) { zoomAt(f, tl.clientWidth / 2); return; }
    ui.barPx = f > 1 ? Math.min(MAX_BPX.phone, ui.barPx * f) : Math.max(4, ui.barPx * f);
    app.render();
  };
  const tools = h('div', { class: 'row tl-tools' },
    h('span', { class: 'hint grow' }, `${total} bars · ${fmtLen(total * 240 / p.bpm)}`),
    h('button', { class: 'chip', onclick: () => zoomBtn(1 / 1.4), 'aria-label': 'Zoom out', title: desk ? 'Zoom out (Ctrl + wheel)' : null }, '−'),
    h('button', { class: 'chip', onclick: () => zoomBtn(1.4), 'aria-label': 'Zoom in', title: desk ? 'Zoom in (Ctrl + wheel)' : null }, '+'),
    desk ? h('button', { class: 'chip' + (fit ? ' on' : ''), title: 'Fit the whole song to the width (F)', onclick: () => { ui.tlFit = true; renderSong(app, root); } }, 'Fit') : null,
    h('button', { class: 'chip', onclick: () => addSectionSheet(app) }, '+ Section'),
    h('button', { class: 'chip', onclick: () => laneSheet(app) }, '+ Lane'));

  if (!desk) {
    requestAnimationFrame(() => { tl.scrollLeft = ui.tlScroll || 0; });
    root.replaceChildren(
      tools,
      tl,
      secCard,
      h('p', { class: 'hint', style: { marginTop: '10px' } }, 'Tap a cell to pick the pattern a track plays in that section. On a lane, tap to add a point, drag to move it, tap a point to remove it.'));
    return;
  }

  // Ctrl + wheel (or a trackpad pinch) zooms the timeline
  let wheelF = 1;
  let wheelX = 0;
  let wheelRaf = 0;
  tl.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = tl.getBoundingClientRect();
    wheelX = (e.clientX - r.left) / (r.width / tl.offsetWidth || 1);
    wheelF *= Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.004);
    if (!wheelRaf) wheelRaf = requestAnimationFrame(() => zoomAt(wheelF, wheelX));
  }, { passive: false });

  const slot = root.parentElement && root.parentElement.querySelector('.panel-tools');
  if (slot) slot.replaceChildren(tools);
  root.replaceChildren(h('div', { class: 'song-body' }, tl, h('div', { class: 'song-side' }, slot ? null : tools, secCard,
    h('p', { class: 'hint' }, 'Click a cell to choose its pattern, a track name to edit that track. Lanes: click to add a point, drag to move it, click a point to remove it.'))));
  tl.scrollLeft = fit ? 0 : ui.tlScroll || 0;
  tl.scrollTop = ui.tlScrollY || 0;
  // the first fit guessed the width: measure it and lay out again once
  if (fit && !again) {
    const aw = tl.clientWidth;
    if (aw && Math.abs(aw - (ui.tlAvail || 0)) > 0.5) { ui.tlAvail = aw; renderSong(app, root, true); }
  }
}

// A small picture of the pattern inside its cell, repeated over the section like a clip.
const DRUM_Y = Object.fromEntries(VOICES.map((v, i) => [v.id, i]));
function miniPattern(t, pat, bars, wpx) {
  if (wpx < 36) return null;
  const total = bars * 16;
  const steps = pat.bars * 16;
  const reps = Math.ceil(total / steps);
  let d = '';
  const rect = (x, y, w, hh) => {
    if (x >= total) return;
    const ww = Math.max(0.35, Math.min(w, total - x)).toFixed(2);
    d += `M${x.toFixed(2)} ${y.toFixed(1)}h${ww}v${hh.toFixed(1)}h-${ww}z`;
  };
  if (t.role === 'drums') {
    const rowH = 100 / VOICES.length;
    for (let r = 0; r < reps; r++) for (const x of pat.hits) rect(r * steps + x.s, (VOICES.length - 1 - (DRUM_Y[x.v] ?? 0)) * rowH + 1, 0.55, rowH - 2);
  } else if (t.role === 'fx') {
    for (let r = 0; r < reps; r++) {
      for (const e of pat.fx) {
        const x0 = r * steps + e.s;
        if (x0 >= total) continue;
        const x1 = Math.min(total, x0 + e.len);
        const up = e.type === 'riser' || e.type === 'noiseup' || e.type === 'reverse';
        d += up ? `M${x0} 96L${x1} 8L${x1} 96Z` : `M${x0} 8L${x1} 96L${x0} 96Z`;
      }
    }
  } else {
    if (!pat.notes.length) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const n of pat.notes) { lo = Math.min(lo, n.pitch); hi = Math.max(hi, n.pitch); }
    const span = Math.max(12, hi - lo + 1);
    const nh = Math.max(5, Math.min(14, 100 / span));
    const mid = (lo + hi) / 2;
    for (let r = 0; r < reps; r++) {
      for (const n of pat.notes) rect(r * steps + n.start, 50 - ((n.pitch - mid) / span) * (100 - nh) - nh / 2, Math.max(0.4, n.len - 0.15), nh);
    }
  }
  if (!d) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'tl-mini');
  svg.setAttribute('viewBox', `0 0 ${total} 100`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<path d="${d}" fill="rgba(0,0,0,.62)"/>`;
  return svg;
}

const fmtLen = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

function sectionCard(app, s, i, start) {
  const p = app.project;
  const set = (fn) => { fn(); app.arrangementChanged(); };
  return card(null,
    h('div', { class: 'row' },
      h('span', { class: 'sec-dot', style: { background: SECTION_TYPES[s.type].color } }),
      h('button', { class: 'sec-name grow', onclick: () => { const n = prompt('Section name', s.name); if (n && n.trim()) set(() => { s.name = n.trim().slice(0, 24); }); } }, s.name),
      h('span', { class: 'hint' }, `bar ${start + 1} · ${s.bars} bars`)),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => app.engine.seek(start) }, 'Go here'),
      h('button', { class: 'btn' + (app.engine.loop ? ' on' : ''), onclick: () => app.setLoop(!app.engine.loop) }, app.engine.loop ? 'Looping' : 'Loop it'),
      h('button', { class: 'btn', onclick: () => set(() => { s.bars = Math.max(1, s.bars - (s.bars > 4 ? 4 : 1)); }) }, '− bars'),
      h('button', { class: 'btn', onclick: () => set(() => { s.bars = Math.min(64, s.bars + (s.bars >= 4 ? 4 : 1)); }) }, '+ bars')),
    seg(Object.entries(SECTION_TYPES).map(([k, v]) => [k, v.name]), s.type, (v) => set(() => { const auto = s.name === SECTION_TYPES[s.type].name; s.type = v; if (auto) s.name = SECTION_TYPES[v].name; }), 'wrap'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', disabled: i === 0, onclick: () => set(() => { p.sections.splice(i, 1); p.sections.splice(i - 1, 0, s); app.ui.section = i - 1; }) }, '◀ Move'),
      h('button', { class: 'btn', disabled: i === p.sections.length - 1, onclick: () => set(() => { p.sections.splice(i, 1); p.sections.splice(i + 1, 0, s); app.ui.section = i + 1; }) }, 'Move ▶'),
      h('button', { class: 'btn', onclick: () => set(() => { const c = { ...structuredClone(s), id: uid() }; p.sections.splice(i + 1, 0, c); app.ui.section = i + 1; }) }, 'Duplicate'),
      h('button', { class: 'btn danger', onclick: () => { if (confirm(`Delete the ${s.name} section?`)) set(() => { p.sections.splice(i, 1); app.ui.section = Math.max(0, i - 1); }); } }, 'Delete')),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => {
        const lead = p.tracks.find((t) => t.role === 'lead');
        set(() => buildSweep(p, i, lead && lead.id));
        toast(`Build sweep over ${s.name}: high-pass up, lead filter opening, reverb swelling`);
      } }, 'Add build sweep'),
      h('button', { class: 'btn', onclick: () => fadeSheet(app, i, start) }, 'Fade / filter…')));
}

function addSectionSheet(app) {
  const p = app.project;
  const pick = (type, bars) => {
    const at = Math.min(p.sections.length, app.ui.section + 1);
    const prev = p.sections[at - 1];
    const s = addSection(p, type, bars, at);
    // start from what the last section of the same type played, else the previous section
    const like = [...p.sections].reverse().find((x) => x !== s && x.type === type) || prev;
    if (like) s.cells = { ...like.cells };
    app.ui.section = at;
    closeSheet();
    app.arrangementChanged();
  };
  openSheet('Add a section',
    h('p', { class: 'hint' }, 'It goes after the selected section and starts with the same parts as the last section of its type.'),
    h('div', { class: 'list' }, Object.entries(SECTION_TYPES).map(([k, v]) => h('div', { class: 'row' },
      h('span', { class: 'sec-dot', style: { background: v.color } }), h('b', { class: 'grow' }, v.name),
      ...[4, 8, 16].map((b) => h('button', { class: 'chip', onclick: () => pick(k, b) }, `${b} bars`))))));
}

function cellSheet(app, t, si) {
  const p = app.project;
  const s = p.sections[si];
  const assign = (id) => { s.cells[t.id] = id; closeSheet(); app.arrangementChanged(); };
  const edit = (pat) => {
    s.cells[t.id] = pat.id;
    app.ui.track = t.id;
    app.ui.pat[t.id] = pat.id;
    app.ui.section = si;
    closeSheet();
    app.arrangementChanged();
    app.goTab(t.role === 'drums' ? 'drums' : 'notes');
  };
  openSheet(`${t.name} · ${s.name}`,
    h('div', { class: 'list' },
      h('button', { class: 'mi' + (!s.cells[t.id] ? ' on' : ''), onclick: () => assign(null) }, '— Silent'),
      t.patterns.map((pat) => h('div', { class: 'row' },
        h('button', { class: 'mi grow' + (s.cells[t.id] === pat.id ? ' on' : ''), onclick: () => assign(pat.id) }, pat.name, h('small', {}, `${pat.bars} bar${pat.bars > 1 ? 's' : ''} · ${countOf(t, pat)}`)),
        h('button', { class: 'chip', onclick: () => edit(pat) }, 'Edit'))),
      h('button', { class: 'mi', onclick: () => {
        const used = new Set(t.patterns.map((x) => x.name));
        const name = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].find((c) => !used.has(c)) || `P${t.patterns.length}`;
        const pat = newPattern(name, t.role === 'drums' ? 1 : Math.min(8, s.bars));
        t.patterns.push(pat);
        edit(pat);
      } }, '+ New pattern', h('small', {}, 'Empty, then open it in the editor'))));
}

const countOf = (t, pat) => (t.role === 'drums' ? `${pat.hits.length} hits` : t.role === 'fx' ? `${pat.fx.length} effects` : `${pat.notes.length} notes`);

// --- automation lanes --------------------------------------------------------------------
function laneLabel(app, lane) {
  const P = LANE_PARAMS[lane.param];
  const t = app.project.tracks.find((x) => x.id === lane.target);
  return { who: t ? t.name : 'Master', what: P ? P.name : lane.param, color: t ? t.color : '#e9eef4' };
}

function laneRow(app, lane, W, bpx, total, LABEL, H) {
  const L = laneLabel(app, lane);
  const pad = 5;
  const P = LANE_PARAMS[lane.param];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'lane-svg');
  svg.setAttribute('width', W - LABEL);
  svg.setAttribute('height', H);
  const X = (b) => b * bpx;
  const Y = (v) => pad + (1 - v) * (H - 2 * pad);
  const draw = () => {
    const pts = lane.points;
    const def = P.def ?? 0.3;
    let d = '';
    if (!pts.length) d = `M0 ${Y(def)} H${X(total)}`;
    else {
      d = `M0 ${Y(pts[0].v)} `;
      for (const pt of pts) d += `L${X(pt.b)} ${Y(pt.v)} `;
      d += `L${X(total)} ${Y(pts[pts.length - 1].v)}`;
    }
    svg.innerHTML = `<path d="${d} V${H} H0 Z" fill="${L.color}" opacity=".13"/><path d="${d}" fill="none" stroke="${L.color}" stroke-width="2"/>` +
      pts.map((pt) => `<circle cx="${X(pt.b)}" cy="${Y(pt.v)}" r="5" fill="#0b0f14" stroke="${L.color}" stroke-width="2"/>`).join('');
  };
  draw();
  let drag = null;
  const at = (e) => {
    const r = svg.getBoundingClientRect();
    const z = r.width / (W - LABEL) || 1; // display-size zoom
    const x = (e.clientX - r.left) / z;
    const y = (e.clientY - r.top) / z;
    return { x, y, b: Math.max(0, Math.min(total, x / bpx)), v: Math.max(0, Math.min(1, 1 - (y - pad) / (H - 2 * pad))) };
  };
  svg.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { svg.setPointerCapture(e.pointerId); } catch { /* fine */ }
    const q = at(e);
    let best = null;
    let bd = 18;
    for (const pt of lane.points) { const dd = Math.hypot(X(pt.b) - q.x, Y(pt.v) - q.y); if (dd < bd) { bd = dd; best = pt; } }
    drag = { pt: best, q0: q, moved: false, x0: e.clientX, y0: e.clientY };
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag || !drag.pt) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
    drag.moved = true;
    const q = at(e);
    drag.pt.b = Math.round(q.b * 4) / 4;
    drag.pt.v = q.v;
    lane.points.sort((a, b) => a.b - b.b);
    draw();
    app.showValue(`${L.who} ${L.what}: ${P.fmt(q.v)} at bar ${(drag.pt.b + 1).toFixed(2)}`);
  });
  svg.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) {
      if (d.pt) lane.points.splice(lane.points.indexOf(d.pt), 1);
      else { lane.points.push({ b: Math.round(d.q0.b * 4) / 4, v: d.q0.v }); lane.points.sort((a, b) => a.b - b.b); }
      draw();
    }
    app.automationChanged();
  });
  const label = h('button', { class: 'tl-label lane-label', onclick: () => laneEditSheet(app, lane) },
    h('span', { class: 'dot', style: { background: L.color } }), h('span', { class: 'tl-tname' }, L.who), h('small', {}, P ? P.name.replace('Master ', '') : ''));
  const body = h('div', { class: 'lane-body', style: { left: LABEL + 'px' } });
  body.append(svg);
  return h('div', { class: 'tl-row tl-lane', style: { width: W + 'px', height: H + 'px' } }, label, body);
}

function laneSheet(app) {
  const p = app.project;
  const add = (target, param) => {
    if (!p.automation.some((l) => l.target === target && l.param === param)) {
      const P = LANE_PARAMS[param];
      const t = p.tracks.find((x) => x.id === target);
      const v0 = P.def ?? (t ? t.mix[param] : 0);
      p.automation.push({ id: uid(), target, param, points: [{ b: 0, v: v0 }] });
    }
    closeSheet();
    app.automationChanged(true);
  };
  openSheet('Add an automation lane',
    h('p', { class: 'hint' }, 'Draw how a setting moves over the song: a filter opening through a build, a send swelling, a fade.'),
    h('div', { class: 'list' },
      h('div', { class: 'row' }, h('b', { class: 'grow' }, 'Master'), chipAdd('High-pass', () => add('master', 'hpf')), chipAdd('Low-pass', () => add('master', 'lpf'))),
      p.tracks.map((t) => h('div', { class: 'row' }, h('span', { class: 'dot', style: { background: t.color } }), h('b', { class: 'grow' }, t.name),
        ['cutoff', 'vol', 'rev', 'dly'].map((k) => chipAdd({ cutoff: 'Filter', vol: 'Vol', rev: 'Reverb', dly: 'Delay' }[k], () => add(t.id, k)))))));
}
const chipAdd = (label, fn) => h('button', { class: 'chip', onclick: fn }, label);

function laneEditSheet(app, lane) {
  const p = app.project;
  const L = laneLabel(app, lane);
  const si = app.ui.section;
  const starts = sectionStarts(p);
  const s = p.sections[si];
  const shape = (pts) => { putRange(lane, starts[si], starts[si] + s.bars, pts); closeSheet(); app.automationChanged(true); };
  const a = starts[si];
  const b = a + (s ? s.bars : 4);
  const cur = laneValue(lane.points, a, LANE_PARAMS[lane.param].def ?? 0.5);
  openSheet(`${L.who} · ${L.what}`,
    s ? h('p', { class: 'hint' }, `Shapes apply to the selected section, ${s.name} (bars ${a + 1}–${b}).`) : null,
    h('div', { class: 'list' },
      h('button', { class: 'mi', onclick: () => shape([{ b: a, v: 0.1 }, { b: b - 0.05, v: 1 }]) }, 'Rise over the section', h('small', {}, 'Low to high, for a build')),
      h('button', { class: 'mi', onclick: () => shape([{ b: a, v: 1 }, { b: b - 0.05, v: 0.1 }]) }, 'Fall over the section', h('small', {}, 'High to low, for an outro or a breakdown')),
      h('button', { class: 'mi', onclick: () => shape([{ b: a, v: cur }, { b: b, v: cur }]) }, 'Hold flat', h('small', {}, 'Keep the value it has at the section start')),
      h('button', { class: 'mi', onclick: () => { lane.points = []; closeSheet(); app.automationChanged(true); } }, 'Clear all points'),
      h('button', { class: 'mi danger', onclick: () => { p.automation.splice(p.automation.indexOf(lane), 1); closeSheet(); app.automationChanged(true); } }, 'Delete this lane')));
}

function fadeSheet(app, si, start) {
  const p = app.project;
  const s = p.sections[si];
  const end = start + s.bars;
  const lane = (target, param) => {
    let l = p.automation.find((x) => x.target === target && x.param === param);
    if (!l) { l = { id: uid(), target, param, points: [] }; p.automation.push(l); }
    return l;
  };
  const go = (fn, msg) => { fn(); closeSheet(); app.automationChanged(true); toast(msg); };
  openSheet(`Shape ${s.name}`,
    h('div', { class: 'list' },
      h('button', { class: 'mi', onclick: () => go(() => putRange(lane('master', 'lpf'), start, end, [{ b: start, v: 0.45 }, { b: end - 0.05, v: 1 }]), 'Master low-pass opens over the section') }, 'Filter in (low-pass opens)', h('small', {}, 'Muffled to bright, great for an intro')),
      h('button', { class: 'mi', onclick: () => go(() => putRange(lane('master', 'lpf'), start, end, [{ b: start, v: 1 }, { b: end, v: 0.4 }]), 'Master low-pass closes over the section') }, 'Filter out (low-pass closes)', h('small', {}, 'Bright to muffled, for a breakdown or outro')),
      h('button', { class: 'mi', onclick: () => go(() => putRange(lane('master', 'hpf'), start, end, [{ b: start, v: 0 }, { b: end - 0.05, v: 0.65 }, { b: end, v: 0 }]), 'Master high-pass sweeps up into the next section') }, 'High-pass build', h('small', {}, 'Thins out the mix, then slams back on the next bar')),
      p.tracks.filter((t) => t.role !== 'fx').map((t) => h('button', { class: 'mi', onclick: () => go(() => putRange(lane(t.id, 'vol'), start, end, [{ b: start, v: 1 }, { b: end, v: 0 }]), `${t.name} fades out`) }, `Fade out ${t.name}`))));
}
