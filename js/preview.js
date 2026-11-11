// Preview: hear the bars you are working on, in the song, from a few seconds before them to a few
// seconds after, then the playhead goes back where it was. P on a keyboard, the preview button in
// the transport, or Preview in the editors' bar strip; press it again to stop.
//
// What it plays, newest first:
// - the bars selected in the editor on screen (js/ui/screens.js bar strip), if picked after the
//   last edit;
// - else the bars your edits since the last preview touched. Each change to the song (js/undo.js
//   'step': the song before and after it) is compared part by part: the notes, hits and effects
//   that changed, the sections that changed, moved or went, the automation points that changed. A
//   pattern's bars are placed where it plays in the selected section (or where the playhead is, or
//   its first section); a section's by its id, so later moves don't put them in the wrong place;
// - else the whole selected section.
// A change with no place of its own (a sound, the mix, the tempo) keeps the stretch you had.
import { sectionStarts, songBars, LANE_PARAMS } from './audio/engine.js';
import { barSec } from './audio/render.js';
import { barSelOf } from './music/bars.js';
import { h, openSheet, seg, field, toast, flushSliders } from './ui/dom.js';

export const ROLL_SECS = [1, 2, 3, 4, 8];
const PREFS = 'e-drop-preview';
const MAX_SPAN = 16; // bars: edits spread wider than this preview only (the middle of) the latest one
const KEEP = 60; // edit spans kept between previews
const LANE_REACH = 2; // bars heard either side of a changed automation point (less if a point is nearer)

const prefs = (() => {
  const d = { pre: 2, post: 2 };
  try { return Object.assign(d, JSON.parse(localStorage.getItem(PREFS) || '{}')); } catch { return d; }
})();
const savePrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* private mode */ } };

const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const startsOf = (secs) => { let b = 0; return secs.map((s) => { const r = b; b += s.bars; return r; }); };

// The step range [a, b) (16ths) that differs between two versions of a pattern, or null.
function patDiff(o, q) {
  let lo = Infinity;
  let hi = -Infinity;
  const take = (x, kind) => {
    const s = kind === 'notes' ? x.start : x.s;
    const len = kind === 'hits' ? 1 : x.len || 1;
    lo = Math.min(lo, s);
    hi = Math.max(hi, s + len);
  };
  for (const kind of ['notes', 'hits', 'fx']) {
    const A = o[kind] || [];
    const B = q[kind] || [];
    if (same(A, B)) continue;
    // what is in one version and not the other, counting duplicates
    const count = new Map();
    for (const x of A) { const k = JSON.stringify(x); count.set(k, (count.get(k) || 0) + 1); }
    const added = [];
    for (const x of B) {
      const k = JSON.stringify(x);
      const n = count.get(k) || 0;
      if (n) count.set(k, n - 1);
      else added.push(x);
    }
    const removed = [];
    for (const x of A) {
      const k = JSON.stringify(x);
      const n = count.get(k) || 0;
      if (n) { removed.push(x); count.set(k, n - 1); }
    }
    // a note or effect that only got longer or shorter (a resize, a Clear cutting its tail): the
    // change is the stretch between its old and new end, not the whole note
    const bare = (x) => JSON.stringify({ ...x, len: 0 });
    for (const x of added) {
      const i = kind === 'hits' ? -1 : removed.findIndex((y) => bare(y) === bare(x));
      if (i < 0) { take(x, kind); continue; }
      const y = removed.splice(i, 1)[0];
      const s = kind === 'notes' ? x.start : x.s;
      lo = Math.min(lo, s + Math.min(x.len, y.len));
      hi = Math.max(hi, s + Math.max(x.len, y.len));
    }
    for (const y of removed) take(y, kind);
  }
  if (o.bars !== q.bars) {
    lo = Math.min(lo, Math.min(o.bars, q.bars) * 16);
    hi = Math.max(hi, Math.max(o.bars, q.bars) * 16);
  }
  return lo <= hi ? [lo, hi] : null;
}

// The value a lane's parameter has with no lane: its default, or the track's own send level.
function laneRest(song, lane) {
  const P = LANE_PARAMS[lane.param];
  if (!P) return null;
  if (P.def != null) return P.def;
  const t = song.tracks.find((x) => x.id === lane.target);
  return t && t.mix ? t.mix[lane.param] ?? 0 : 0;
}

// Where two songs differ, by place:
//   pats:  [{ track, pat, a, b }]  a pattern's 16ths that changed
//   secs:  [{ id, a, b }]          bars of a section (from its start) that changed, moved or were added
//   joins: [{ id }]                a section went: the join where it was, at the start of section
//                                  `id` (null: the end of the song)
//   bars:  [{ from, to, focus }]   song bars around automation points that changed
export function changedSpans(beforeJson, afterJson) {
  let a;
  let b;
  const out = { pats: [], secs: [], joins: [], bars: [] };
  try { a = JSON.parse(beforeJson); b = JSON.parse(afterJson); } catch { return out; }
  const ta = new Map(a.tracks.map((t) => [t.id, t]));
  for (const t of b.tracks) {
    const o = ta.get(t.id);
    if (!o) continue;
    const pa = new Map(o.patterns.map((q) => [q.id, q]));
    for (const q of t.patterns) {
      const oq = pa.get(q.id);
      if (!oq) continue; // a new pattern sounds once a section plays it: the arrangement says where
      const span = patDiff(oq, q);
      if (span) out.pats.push({ track: t.id, pat: q.id, a: span[0], b: span[1] });
    }
  }
  // sections that changed or are new; one that only got longer, the bars it gained (shorter: its end)
  const ia = new Map(a.sections.map((s, i) => [s.id, i]));
  const ib = new Map(b.sections.map((s, i) => [s.id, i]));
  for (const s of b.sections) {
    const j = ia.get(s.id);
    const o = j == null ? null : a.sections[j];
    if (o && same(o, s)) continue;
    if (o && o.bars !== s.bars && same({ ...o, bars: 0 }, { ...s, bars: 0 })) out.secs.push({ id: s.id, a: Math.min(o.bars, s.bars), b: s.bars });
    else out.secs.push({ id: s.id, a: 0, b: s.bars });
  }
  // moved: the sections out of their old order among the ones both songs have
  const ca = a.sections.filter((s) => ib.has(s.id)).map((s) => s.id);
  const cb = b.sections.filter((s) => ia.has(s.id)).map((s) => s.id);
  cb.forEach((id, k) => { if (ca[k] !== id) out.secs.push({ id, a: 0, b: b.sections[ib.get(id)].bars }); });
  // deleted: the join where it was
  a.sections.forEach((s, j) => {
    if (ib.has(s.id)) return;
    const next = a.sections.slice(j + 1).find((x) => ib.has(x.id));
    out.joins.push({ id: next ? next.id : null });
  });
  // automation: around the points that changed, as far as the points either side (at most LANE_REACH
  // bars). A lane added or deleted counts against a flat line at the value it would otherwise have.
  const lane = (A, B, rest) => {
    const key = (pt) => `${pt.b}|${pt.v}`;
    let ch;
    if (rest == null) {
      const inA = new Set(A.map(key));
      const inB = new Set(B.map(key));
      ch = [...A.filter((pt) => !inB.has(key(pt))), ...B.filter((pt) => !inA.has(key(pt)))];
    } else ch = [...A, ...B].filter((pt) => Math.abs(pt.v - rest) > 1e-3);
    if (!ch.length) return;
    const lo = Math.min(...ch.map((pt) => pt.b));
    const hi = Math.max(...ch.map((pt) => pt.b));
    const all = [...A, ...B].map((pt) => pt.b);
    const before = all.filter((x) => x < lo);
    const after = all.filter((x) => x > hi);
    let from = Math.max(before.length ? Math.max(...before) : -Infinity, lo - LANE_REACH);
    let to = Math.min(after.length ? Math.min(...after) : Infinity, hi + LANE_REACH);
    if (to - from < 1) { const m = (lo + hi) / 2; from = m - 0.5; to = m + 0.5; }
    out.bars.push({ from: Math.max(0, from), to, focus: (lo + hi) / 2 });
  };
  const la = new Map(a.automation.map((l) => [l.id, l]));
  const lb = new Map(b.automation.map((l) => [l.id, l]));
  for (const l of b.automation) {
    if (la.has(l.id)) lane(la.get(l.id).points, l.points, null);
    else lane([], l.points, laneRest(b, l));
  }
  for (const l of a.automation) if (!lb.has(l.id)) lane(l.points, [], laneRest(a, l));
  return out;
}

export function initPreview(app, { unlock }) {
  const E = app.engine;
  // edit spans since the last preview: { pat }, { sec }, { join } or { bars } (changedSpans' shapes)
  const R = { spans: [], at: 0, open: false };

  app.on('open', () => { R.spans = []; R.at = 0; R.open = false; paint(); });
  app.on('step', ({ before, after, how }) => {
    // a reset changes everything: back to the selected section
    if (how === 'reset') { R.spans = []; R.open = false; R.at = performance.now(); paint(); return; }
    const d = changedSpans(before, after);
    const add = [...d.pats.map((x) => ({ pat: x })), ...d.bars.map((x) => ({ bars: x })), ...d.joins.map((x) => ({ join: x }))];
    // the selected section last: a Move swaps two sections, and the one you moved is the one to hear
    const sel = app.project && app.project.sections[app.ui.section];
    const secs = d.secs.slice().sort((x, y) => (sel && x.id === sel.id ? 1 : 0) - (sel && y.id === sel.id ? 1 : 0));
    add.push(...secs.map((x) => ({ sec: x })));
    if (!add.length) return; // a sound, mix or tempo change: listen where you were
    if (!R.open) R.spans = [];
    R.spans.push(...add);
    if (R.spans.length > KEEP) R.spans.splice(0, R.spans.length - KEEP);
    R.open = true;
    R.at = performance.now();
    paint();
  });

  // A pattern's step range [a, b) in the song: where its track plays it in the selected section,
  // or the section the playhead is in, or its first section. Inside that section, the repeat the
  // playhead is in (else the first). { unplaced } when no section plays that part of it.
  function place(trackId, patId, a, b) {
    const p = app.project;
    const t = p.tracks.find((x) => x.id === trackId);
    const q = t && t.patterns.find((x) => x.id === patId);
    if (!q) return null;
    const st = sectionStarts(p);
    const pos = E.position();
    const uses = p.sections.map((s, i) => (s.cells[trackId] === patId && a / 16 < s.bars ? i : -1)).filter((i) => i >= 0);
    if (!uses.length) return { unplaced: `${t.name} pattern ${q.name}` };
    const inSec = (i) => pos >= st[i] && pos < st[i] + p.sections[i].bars;
    const si = uses.includes(app.ui.section) ? app.ui.section : uses.find(inSec) ?? uses[0];
    const S = st[si];
    const end = S + p.sections[si].bars;
    const L = Math.max(1, q.bars);
    let k = inSec(si) ? Math.floor((pos - S) / L) : 0;
    while (k > 0 && S + k * L + a / 16 >= end) k--;
    const from = S + k * L + a / 16;
    return { from, to: Math.max(from, Math.min(end, S + k * L + b / 16)), si };
  }

  const secAt = (bar) => {
    const st = sectionStarts(app.project);
    let si = 0;
    for (let i = 0; i < st.length; i++) if (bar >= st[i] - 1e-6) si = i;
    return si;
  };

  // One stored span in the song as it is now: { from, to, si, focus?, join? }, or null / { unplaced }.
  function resolve(s, total) {
    const p = app.project;
    if (s.pat) return place(s.pat.track, s.pat.pat, s.pat.a, s.pat.b);
    if (s.sec) {
      const i = p.sections.findIndex((x) => x.id === s.sec.id);
      if (i < 0) return null;
      const S = sectionStarts(p)[i];
      const bars = p.sections[i].bars;
      // a section that got shorter: the join at its new end, named after the section that follows
      if (s.sec.a >= bars) return { from: S + bars, to: S + bars, si: Math.min(i + 1, p.sections.length - 1), join: true };
      const from = S + Math.min(s.sec.a, bars);
      return { from, to: Math.max(from, S + Math.min(s.sec.b, bars)), si: i };
    }
    if (s.join) {
      const i = s.join.id ? p.sections.findIndex((x) => x.id === s.join.id) : -1;
      if (s.join.id && i < 0) return null;
      const x = i >= 0 ? sectionStarts(p)[i] : total;
      return { from: x, to: x, si: i >= 0 ? i : p.sections.length - 1, join: true };
    }
    if (s.bars) {
      if (s.bars.from > total) return null;
      return { from: s.bars.from, to: Math.min(s.bars.to, total), si: secAt(s.bars.from), focus: s.bars.focus };
    }
    return null;
  }

  // The bar selection counts only while it is on screen: the pattern the editor shows.
  function shownSel(p) {
    const ui = app.ui;
    const sel = ui.bars;
    const t = sel && p.tracks.find((x) => x.id === sel.track);
    if (!t || t.id !== ui.track || ui.pat[t.id] !== sel.pat) return null;
    const drums = t.role === 'drums';
    const on = app.desk ? (ui.editor === 'drums') === drums : (ui.tab === 'drums' && drums) || (ui.tab === 'notes' && !drums);
    const q = on && t.patterns.find((x) => x.id === sel.pat);
    const sv = q && barSelOf(sel, t, q);
    return sv ? { t, q, sv, at: sel.at || 0 } : null;
  }

  // What a preview plays now: { a, b } the bars it is about, { from, to } with the time before and
  // after, `why` ('sel', 'edits', 'section') and a label. Null for a song with no sections.
  function target() {
    const p = app.project;
    if (!p || !p.sections.length) return null;
    const total = songBars(p);
    let span = null;
    let why = 'section';
    let note = '';
    const S = shownSel(p);
    let selMiss = false;
    if (S && S.at >= R.at) {
      const x = place(S.t.id, S.q.id, S.sv.from * 16, S.sv.to * 16);
      if (x && !x.unplaced) { span = x; why = 'sel'; } else if (x) { note = x.unplaced; selMiss = true; }
    }
    // bars just selected that no section plays: say so over the selected section, not older edits
    if (!span && !selMiss && R.spans.length) {
      const got = [];
      for (const s of R.spans) {
        const x = resolve(s, total);
        if (x && !x.unplaced) got.push(x);
        else if (x && !note) note = x.unplaced;
      }
      if (got.length) {
        // the latest edit's section, and the ones in reach of it
        const last = got[got.length - 1];
        const keep = got.filter((x) => x.si === last.si || (x.from < last.to + 4 && x.to > last.from - 4));
        const lo = Math.min(...keep.map((x) => x.from));
        const hi = Math.max(...keep.map((x) => x.to));
        if (hi - lo <= MAX_SPAN) span = { from: lo, to: hi, si: last.si, join: keep.length === 1 && last.join };
        else {
          // too wide: the latest one alone, and if that is too, MAX_SPAN bars around its focus
          let from = last.from;
          let to = last.to;
          if (to - from > MAX_SPAN) {
            const f = last.focus ?? from + MAX_SPAN / 2;
            from = Math.max(last.from, Math.min(f - MAX_SPAN / 2, last.to - MAX_SPAN));
            to = from + MAX_SPAN;
          }
          span = { from, to, si: secAt(from), join: last.join };
        }
        why = 'edits';
      }
    }
    let a;
    let b;
    let si;
    if (span) ({ from: a, to: b, si } = span);
    else {
      si = Math.max(0, Math.min(app.ui.section, p.sections.length - 1));
      a = sectionStarts(p)[si];
      b = a + p.sections[si].bars;
    }
    const bs = barSec(p);
    const from = Math.max(0, Math.floor((a - prefs.pre / bs) * 4 + 1e-6) / 4);
    const to = Math.min(total, Math.ceil((b + prefs.post / bs) * 4 - 1e-6) / 4);
    const sec = p.sections[si];
    const fa = Math.floor(a + 1e-6) + 1;
    const fb = Math.max(fa, Math.ceil(b - 1e-6));
    let where;
    if (b - a < 1e-6 && a >= total - 1e-6) where = 'the end of the song';
    else if (b - a < 1e-6) where = span && span.join ? `the join at bar ${fa}` : `bar ${fa}`;
    else where = fa === fb ? `bar ${fa}` : `bars ${fa}–${fb}`;
    const label = why === 'section' ? `the ${sec.name} (${where})` : where === 'the end of the song' ? where : `${where}${sec ? ` of the song, in the ${sec.name}` : ''}`;
    return { a, b, from, to: Math.max(to, from + 0.25), why, si, label, note };
  }

  function play() {
    unlock();
    flushSliders();
    if (app.history) app.history.commit();
    if (E.playing && E.range) { E.stop(); return true; } // a second press stops it
    const T = target();
    if (!T) { toast('Add a section to the song first'); return false; }
    // a preview held while the parts re-render (a tempo change) still goes back where it began
    const back = E.playing ? E.position() : E.range ? E.range.back : E.pos;
    R.open = false; // the next edit starts a new stretch
    E.play(T.from, { range: { to: T.to, back } });
    const extra = T.why === 'section' && T.note ? ` · ${T.note} isn't in the song here yet` : '';
    toast(`Preview: ${T.label} · ${prefs.pre} s before, ${prefs.post} s after${extra}`);
    paint();
    return true;
  }

  // The stretch on the Song timeline's ruler: the bars (bright) and the time around them (soft).
  // song.js calls this after every redraw of the timeline (zoom, Fit and resizes included).
  function paint() {
    const band = document.querySelector('#timeline .tl-pv');
    if (!band) return;
    const T = target();
    const ui = app.ui;
    if (!T || T.why === 'section') { band.hidden = true; return; }
    const x = (bar) => (ui.tlLabel ?? 64) + bar * ui.barPx;
    band.hidden = false;
    band.style.left = x(T.from) + 'px';
    band.style.width = Math.max(2, x(T.to) - x(T.from)) + 'px';
    const core = band.firstElementChild;
    if (core) { core.style.left = (T.a - T.from) * ui.barPx + 'px'; core.style.width = Math.max(3, (T.b - T.a) * ui.barPx) + 'px'; }
    band.title = `P previews ${T.label}`;
  }
  app.on('render', paint);
  app.on('bars', paint);

  function sheet() {
    const T = target();
    const set = (k) => (v) => { prefs[k] = v; savePrefs(); paint(); app.render(); sheet(); };
    openSheet('Preview',
      h('p', { class: 'hint' }, 'Plays the bars you are working on in the song, from a few seconds before them to a few seconds after, then puts the playhead back. Press P or the preview button; press again to stop.'),
      field('Before', seg(ROLL_SECS.map((s) => [s, `${s} s`]), prefs.pre, set('pre'), 'mini')),
      field('After', seg(ROLL_SECS.map((s) => [s, `${s} s`]), prefs.post, set('post'), 'mini')),
      T ? h('p', { class: 'hint' }, `Now it plays ${T.label}: ${T.why === 'sel' ? 'the bars you selected' : T.why === 'edits' ? 'where your last edits are' : 'the selected section (no edits since the last preview)'}.`) : null,
      h('button', { class: 'btn primary big', onclick: () => { play(); } }, 'Preview now'));
  }

  const api = { play, target, sheet, paint, get prefs() { return { ...prefs }; } };
  app.previewer = api;
  return api;
}
