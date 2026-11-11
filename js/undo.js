// Undo for every change to the song, from the keyboard (no buttons):
//   Backspace            undo the last change; press again for the one before (7, 6, 5 … 1)
//   Shift+Backspace      redo (also Ctrl+Y, Ctrl+Shift+Z; Ctrl+Z is undo)
//   Esc                  reset: the song as it was first made (the demo as it ships, a new song
//                        as the template). The reset is a change too: Backspace brings it back.
//
// A change is one gesture: a tap, a drag, a hold on a ◀ ▶ arrow, a "Do it for me". The screens
// report every edit through app's 'edit' event (many a second while a slider moves); a step closes
// when the next press starts, shortly after the pointer lifts, or after a pause with nothing held.
// Each step keeps the whole song as JSON (a song is a few kilobytes), so undo is exact. History
// lives in memory, one list per song, and is gone after a reload. Two things are saved with the
// song: its original (p.original), so Esc works after a reload, and the song from before the last
// reset (p.beforeReset), so Backspace can still undo a reset after a reload.
import { demoProject } from './music/demo.js';
import { normalize } from './music/project.js';
import { toast, flushSliders } from './ui/dom.js';

const MAX = 200; // steps kept per song
const IDLE = 600; // ms without edits that closes a step when nothing is held
const AFTER_UP = 220; // ms after the pointer lifts (late 'change' events still join the step)

// The song without the fields that change on their own (save time, edited flag) or that are
// not part of it (its original, the song from before a reset).
export function snapshot(p) {
  // eslint-disable-next-line no-unused-vars
  const { updated, edited, original, beforeReset, ...rest } = p;
  return JSON.stringify(rest);
}

// The demo as it ships, carrying the ids of the song `cur` (the stored demo) wherever the parts
// match: tracks by role and name, patterns by name, sections by position and type, automation lanes
// by target and parameter. So the untouched demo equals its original, and a reset keeps the
// selection, the coach's listening record and the rendered parts that did not change.
export function demoLike(cur) {
  const d = normalize(demoProject());
  if (!cur) return d;
  const ids = new Map();
  const used = new Set();
  for (const t of d.tracks) {
    const old = cur.tracks.find((x) => x.role === t.role && x.name === t.name && !used.has(x.id));
    if (!old) continue;
    used.add(old.id);
    ids.set(t.id, old.id);
    for (const q of t.patterns) {
      const oq = old.patterns.find((x) => x.name === q.name && !used.has(x.id));
      if (oq) { used.add(oq.id); ids.set(q.id, oq.id); }
    }
  }
  const map = (id) => ids.get(id) || id;
  for (const t of d.tracks) { t.id = map(t.id); for (const q of t.patterns) q.id = map(q.id); }
  d.sections.forEach((s, i) => {
    s.cells = Object.fromEntries(Object.entries(s.cells).map(([tid, qid]) => [map(tid), map(qid)]));
    const o = cur.sections[i];
    if (o && o.type === s.type) s.id = o.id;
  });
  for (const l of d.automation) {
    l.target = map(l.target);
    const o = cur.automation.find((x) => x.target === l.target && x.param === l.param);
    if (o) l.id = o.id;
  }
  if (cur.created) d.created = cur.created;
  return d;
}

// Give a song its original the first time it is opened. The demo's original is the demo as it
// ships, even if it was changed before this version; any other song's is the song as it is now.
export function ensureOriginal(p) {
  if (typeof p.original === 'string' && p.original) return false;
  p.original = p.id === 'demo' ? snapshot(demoLike(p)) : snapshot(p);
  return true;
}

// What changed between two snapshots, in a few words, and the track to show it on.
function describe(beforeJson, afterJson) {
  let a, b;
  try { a = JSON.parse(beforeJson); b = JSON.parse(afterJson); } catch { return { what: 'the last change' }; }
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const parts = [];
  let track = null;
  let pat = null;
  if (a.name !== b.name) parts.push('the song name');
  if (a.bpm !== b.bpm) parts.push('the tempo');
  if (a.key !== b.key || a.scale !== b.scale) parts.push('the key');
  const ta = new Map(a.tracks.map((t) => [t.id, t]));
  const tb = new Map(b.tracks.map((t) => [t.id, t]));
  const added = b.tracks.filter((t) => !ta.has(t.id));
  const removed = a.tracks.filter((t) => !tb.has(t.id));
  if (added.length || removed.length) parts.push(added.length && removed.length ? 'the tracks' : added.length ? `adding ${added[0].name}` : `deleting ${removed[0].name}`);
  for (const t of b.tracks) {
    const o = ta.get(t.id);
    if (!o) continue;
    const pa = new Map(o.patterns.map((q) => [q.id, q]));
    const changedPats = t.patterns.filter((q) => !pa.has(q.id) || !same(pa.get(q.id), q));
    if (changedPats.length || o.patterns.length !== t.patterns.length) {
      parts.push(`${t.name} ${t.role === 'drums' ? 'beat' : t.role === 'fx' ? 'FX' : 'notes'}`);
      if (!track) { track = t.id; pat = changedPats.length === 1 ? changedPats[0].id : null; }
    }
    if (!same(o.synth, t.synth) || o.preset !== t.preset) { parts.push(`${t.name} sound`); track = track || t.id; }
    if (!same(o.kit, t.kit)) { parts.push(`${t.name} kit`); track = track || t.id; }
    if (!same(o.mix, t.mix)) parts.push(`${t.name} mix`);
    if (o.name !== t.name || o.color !== t.color) parts.push(`${t.name} name`);
  }
  if (!same(a.sections, b.sections)) parts.push('the arrangement');
  if (!same(a.automation, b.automation)) parts.push('the automation');
  if (!same(a.master, b.master)) parts.push('the master settings');
  const uniq = [...new Set(parts)];
  const what = !uniq.length ? 'the last change' : uniq.length > 2 ? `${uniq[0]}, ${uniq[1]} and more` : uniq.join(' and ');
  return { what, track, pat };
}

// app: the app object (project, on/emit). swap(json): puts that snapshot in as the song without
// resetting the screens or the transport (main.js); app.undoFocus = { track, pat } says what to show.
export function initUndo(app, { swap }) {
  // song id -> { undo: [step], redo: [step], base }. A step is { s, k }: s is the song before it
  // (on the redo list, after it), k marks a reset so the toast can say so.
  const lists = new Map();
  const H = { p: null, base: null, list: null, pending: false, timer: 0, down: new Set(), quiet: false };

  const listFor = (id) => { let l = lists.get(id); if (!l) { l = { undo: [], redo: [], base: null }; lists.set(id, l); } return l; };
  const push = (arr, s, k) => { arr.push({ s, k }); if (arr.length > MAX) arr.splice(0, arr.length - MAX); };
  const setBase = (s) => { H.base = s; if (H.list) H.list.base = s; }; // the list keeps it for a reopen

  // Close the open step: if the song differs from the last step, the old state goes on the list.
  function commit() {
    clearTimeout(H.timer);
    H.timer = 0;
    H.pending = false;
    if (!H.p) return false;
    const now = snapshot(H.p);
    if (now === H.base) return false;
    const before = H.base;
    push(H.list.undo, before);
    H.list.redo.length = 0;
    setBase(now);
    step(before, now);
    return true;
  }
  // 'step' tells add-ons (js/preview.js: where the edits are) what one change did: the song
  // before and after it, as snapshots. Undo and redo are changes too (`how` says which).
  const step = (before, after, how = 'edit') => { if (before != null && after != null) app.emit('step', { before, after, how }); };
  const arm = (ms) => {
    clearTimeout(H.timer);
    H.timer = setTimeout(() => { H.timer = 0; if (!H.down.size) commit(); }, ms);
  };

  // A song opened (or reopened: Songs list, the demo reloaded, the coach's own undo). The same song
  // keeps its list, and if it comes back different, that difference is a step too.
  app.on('open', (p) => {
    if (H.p && H.pending) commit();
    H.p = p;
    H.list = listFor(p.id);
    const now = snapshot(p);
    if (H.list.base != null && H.list.base !== now) { push(H.list.undo, H.list.base); H.list.redo.length = 0; }
    // first open since a reload, still exactly as a reset left it: Backspace can undo that reset
    else if (H.list.base == null && typeof p.beforeReset === 'string' && p.beforeReset !== now && now === p.original) push(H.list.undo, p.beforeReset, 'reset');
    setBase(now);
  });
  app.on('edit', () => {
    if (H.quiet || !H.p) return;
    H.pending = true;
    arm(IDLE);
  });

  // The next gesture starting closes the last one. commit() compares the whole song, not only the
  // pending flag: a keyboard nudge writes the song at once but announces it 260 ms later.
  document.addEventListener('pointerdown', (e) => { commit(); H.down.add(e.pointerId); }, true);
  const lift = (e) => { H.down.delete(e.pointerId); if (H.pending && !H.down.size) arm(AFTER_UP); };
  document.addEventListener('pointerup', lift, true);
  document.addEventListener('pointercancel', lift, true);
  // a mouse let go outside the window sends no pointerup: the next move with no button is the lift
  document.addEventListener('pointermove', (e) => { if (!e.buttons && H.down.has(e.pointerId)) lift(e); }, true);
  window.addEventListener('blur', () => { H.down.clear(); if (H.pending) arm(AFTER_UP); });
  document.addEventListener('keydown', (e) => {
    if (e.repeat || /^(Shift|Control|Alt|Meta|CapsLock)$/.test(e.key)) return;
    commit();
  }, true);

  // Run a slider's waiting commit now, while the song it changed is still the live one, then close
  // the step. Every undo, redo and reset starts with this.
  function settle() {
    flushSliders();
    commit();
  }

  function apply(json) {
    H.quiet = true;
    try { swap(json); } finally { H.quiet = false; }
    // a render can fill in defaults: take the step's state from the song as it is now
    H.p = app.project;
    setBase(snapshot(H.p));
  }

  function undo() {
    settle();
    const L = H.list;
    if (!L || !L.undo.length) { toast(L && L.redo.length ? 'Nothing more to undo (Shift+Backspace redoes)' : 'Nothing to undo'); return false; }
    const s = L.undo.pop();
    const was = H.base;
    const d = s.k === 'reset' ? { what: 'the reset: your changes are back' } : describe(s.s, H.base);
    push(L.redo, H.base, s.k);
    app.undoFocus = s.k === 'reset' ? null : { track: d.track, pat: d.pat };
    apply(s.s);
    if (s.k === 'reset') delete app.project.beforeReset; // the reset is undone: nothing to bring back
    step(was, H.base, s.k === 'reset' ? 'reset' : 'undo');
    const n = L.undo.length;
    toast(`Undid ${d.what}${n ? ` · ${n} more to undo` : ' · back to the start of the history'}`);
    return true;
  }

  function redo() {
    settle();
    const L = H.list;
    if (!L || !L.redo.length) { toast('Nothing to redo'); return false; }
    const s = L.redo.pop();
    const before = H.base;
    const d = s.k === 'reset' ? { what: 'the reset to the original' } : describe(H.base, s.s);
    push(L.undo, H.base, s.k);
    app.undoFocus = s.k === 'reset' ? null : { track: d.track, pat: d.pat };
    apply(s.s);
    if (s.k === 'reset') app.project.beforeReset = before;
    step(before, H.base, s.k === 'reset' ? 'reset' : 'redo');
    toast(`Redid ${d.what}${L.redo.length ? ` · ${L.redo.length} more to redo` : ''}`);
    return true;
  }

  function reset() {
    settle();
    const p = H.p;
    if (!p) return false;
    ensureOriginal(p); // main.js gives every song one when it opens; this is a fallback
    if (p.original === H.base) { toast('This is already the original. Backspace undoes your last change.'); return false; }
    const before = H.base;
    push(H.list.undo, before, 'reset');
    H.list.redo.length = 0;
    app.undoFocus = null;
    apply(p.original);
    // saved with the song (the save apply scheduled writes it), so a reload can't lose the way back
    app.project.beforeReset = before;
    step(before, H.base, 'reset');
    toast(`Reset ${p.id === 'demo' ? 'the demo' : 'the song'} to the original · Backspace brings your changes back`);
    return true;
  }

  // Undo only if the last step started from this song (the coach's own Undo after Do it for me):
  // anything else would undo a different change.
  function undoIf(p) {
    settle();
    const L = H.list;
    return !!(L && L.undo.length && L.undo[L.undo.length - 1].s === snapshot(p)) && undo();
  }

  const api = {
    undo, redo, reset, commit, undoIf,
    // a pointer is down: a drag or a held note is in progress (main.js ignores the undo keys then)
    get busy() { return H.down.size > 0; },
    get steps() { return H.list ? H.list.undo.length + (H.pending ? 1 : 0) : 0; },
    get redoSteps() { return H.list ? H.list.redo.length : 0; },
  };
  app.history = api;
  return api;
}
