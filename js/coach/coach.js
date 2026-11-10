// Coach: a production teacher that sits beside the work (never a modal). The graduation-cap
// button opens it in #coachDock. Three views:
//   Learn       the curriculum (lessons.js): one step at a time, with Show me (spotlight),
//               Do it for me, Listen, and automatic ticks when the learner has done the step
//   Song check  doctor.js scores the song and offers fixes; re-runs as the song changes
//   Explain     the glossary (glossary.js), searchable, and Explain mode: tap any slider
//               label or card title in the app for a popover with what it does
// Progress lives in localStorage. On the phone the dock is a bottom panel above the tab bar
// that collapses to a slim bar; on desktop (body.desk) the layout docks it as a column.
import { h, $, toast } from '../ui/dom.js';
import { sectionStarts } from '../audio/engine.js';
import { LESSONS, STAGES, lessonById, stepKey, runCheck, runDoIt } from './lessons.js';
import { checkSong, AREAS, SEV } from './doctor.js';
import { CATS, lookup, lookupCard, search } from './glossary.js';
import { Spotlight, resolveTarget, pageZoom } from './spotlight.js';
import { facts } from './facts.js';

const STORE = 'e-drop-coach';
const TABNAME = { song: 'Song', notes: 'Notes', drums: 'Drums', sound: 'Sound', mix: 'Mix' };
const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const ICON = {
  cap: svg('<path d="M12 4 2.5 9 12 14l9.5-5z" fill="currentColor"/><path d="M6.5 11.3v4.2c0 1.6 2.5 3 5.5 3s5.5-1.4 5.5-3v-4.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M20.5 9.5v5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'),
  check: svg('<path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'),
  close: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  down: svg('<path d="M6 9.5l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  up: svg('<path d="M6 14.5l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  back: svg('<path d="M14.5 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  next: svg('<path d="M9.5 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
  target: svg('<circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>'),
  play: svg('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>'),
  stop: svg('<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/>'),
  wand: svg('<path d="M4.5 19.5l10-10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M16 3.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9zM19.5 11l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z" fill="currentColor"/>'),
  ears: svg('<path d="M4.5 15v-3a7.5 7.5 0 0 1 15 0v3" fill="none" stroke="currentColor" stroke-width="1.9"/><rect x="3.5" y="14" width="4.5" height="6" rx="1.6" fill="currentColor"/><rect x="16" y="14" width="4.5" height="6" rx="1.6" fill="currentColor"/>'),
  search: svg('<circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  info: svg('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M12 10.5v6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="7.4" r="1.3" fill="currentColor"/>'),
};
const ic = (name, cls = 'co-ic') => h('i', { class: cls, html: ICON[name] });

// **bold** → <b>
const md = (s) => String(s || '').split('**').map((t, i) => (i % 2 ? h('b', {}, t) : t));
const safe = (fn, d = null) => { try { return fn(); } catch { return d; } };
const frames = (n = 2) => new Promise((res) => { const f = () => (n-- <= 0 ? res() : requestAnimationFrame(f)); f(); });

function loadState() {
  const d = { v: 1, done: {}, bases: {}, lesson: null, step: 0, view: 'learn', collapsed: false, welcomed: false, hinted: false, explain: false, open: false };
  try { return Object.assign(d, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch { return d; }
}

export function initCoach(app) {
  const dock = $('#coachDock');
  const btn = $('#coachBtn');
  if (!dock || !btn) return;
  const S = loadState();
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch { /* private mode */ } };
  // runtime-only state
  const R = { view: S.view === 'check' || S.view === 'explain' ? S.view : 'learn', report: null, q: '', cat: null, undo: null, undoGuard: false, listening: null, firstPass: false, flash: null, sig: '', celebrate: null, lastExport: undefined, focusSearch: false };
  // stamp each WAV export with the song it rendered, so another song isn't judged by it
  let lastExport = app.lastExport;
  Object.defineProperty(app, 'lastExport', {
    configurable: true, enumerable: true, get: () => lastExport,
    set: (v) => { if (v && typeof v === 'object' && app.project) v.pid = app.project.id; lastExport = v; },
  });
  const spot = new Spotlight();
  const isDesk = () => document.body.classList.contains('desk');
  const isOpen = () => !dock.hidden;

  // --- what the learner has heard (for Listen steps) and the drop's live loudness -------------
  const ear = {
    bars: new Map(), cross: new Set(), dropLufs: null, dropPid: null, last: null, dropT: 0,
    heard: (x) => ear.bars.get(x.s.id) || 0,
    crossed: (x) => ear.cross.has(x.s.id),
  };
  setInterval(() => {
    const E = app.engine;
    const p = app.project;
    if (!p || !E.playing || !p.sections.length) { ear.last = null; ear.dropT = 0; return; }
    const pos = E.position();
    const st = sectionStarts(p);
    let si = 0;
    for (let i = 0; i < st.length; i++) if (pos >= st[i] - 1e-6) si = i;
    const sec = p.sections[si];
    const L = ear.last;
    let grew = false;
    // count only continuous listening: no seeks, no loop wraps
    if (L && L.pid === p.id && pos >= L.pos && pos - L.pos < 0.75) {
      if (L.si === si) ear.bars.set(sec.id, ear.heard({ s: sec }) + (pos - L.pos));
      else if (si === L.si + 1) { ear.cross.add(sec.id); ear.bars.set(sec.id, ear.heard({ s: sec }) + (pos - st[si])); }
      grew = true;
    }
    ear.last = { pid: p.id, pos, si };
    if (sec.type === 'drop') {
      ear.dropT += 0.25;
      // the meter's short-term window is 3 s: read it once it holds only drop audio
      if (ear.dropT >= 3.2) {
        const m = safe(() => E.meter());
        if (m && m.s > -60) {
          const prev = ear.dropLufs;
          ear.dropLufs = m.s;
          ear.dropPid = p.id;
          if (prev == null || Math.abs(prev - m.s) > 0.5) recheck(1200);
        }
      }
    } else ear.dropT = 0;
    if (grew) soon(250);
  }, 250);

  // --- open / close / collapse -----------------------------------------------------------------
  function open() {
    if (isOpen()) return;
    dock.hidden = false;
    document.body.classList.add('coach-open');
    btn.classList.add('on');
    btn.classList.remove('co-new');
    btn.setAttribute('aria-expanded', 'true');
    S.open = true;
    save();
    if (!R.report && app.project) R.report = checkSong(app, ear);
    evaluate(false);
    renderDock(true);
    relayout();
  }
  function close() {
    if (!isOpen()) return;
    dock.hidden = true;
    document.body.classList.remove('coach-open');
    btn.classList.remove('on');
    btn.setAttribute('aria-expanded', 'false');
    S.open = false;
    if (S.explain) setExplain(false);
    spot.hide();
    closePop();
    save();
    relayout();
  }
  const toggle = () => (isOpen() ? close() : open());
  // layouts and canvases that size themselves on resize get a nudge
  const relayout = () => requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  function setCollapsed(v) { S.collapsed = v; save(); renderDock(true); relayout(); }

  btn.addEventListener('click', toggle);
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'coachDock');
  if (!S.welcomed) btn.classList.add('co-new');

  // the dock's height lifts the toast above it on the phone
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => document.body.style.setProperty('--co-dock-h', (isOpen() && !isDesk() ? dock.offsetHeight : 0) + 'px')).observe(dock);

  // --- views ---------------------------------------------------------------------------------------
  function setView(v) {
    if (v === 'learn' && R.view === 'learn' && S.lesson) S.lesson = null; // tapping Learn again goes home
    R.view = v;
    S.view = v;
    spot.hide();
    if (v === 'check' && app.project) R.report = checkSong(app, ear);
    save();
    if (!isOpen()) open();
    if (S.collapsed && !isDesk()) S.collapsed = false;
    renderDock(true);
  }
  const lesson = () => (S.lesson ? lessonById(S.lesson) : null);
  const isDone = (L, st) => !!S.done[stepKey(L, st)];
  const doneCount = (L) => L.steps.filter((st) => isDone(L, st)).length;
  const lessonDone = (L) => doneCount(L) === L.steps.length;

  function openLesson(id) {
    const L = lessonById(id);
    if (!L) return;
    S.lesson = id;
    const firstOpen = L.steps.findIndex((st) => !isDone(L, st));
    S.step = firstOpen < 0 ? 0 : firstOpen;
    S.welcomed = true;
    R.view = 'learn';
    S.view = 'learn';
    R.celebrate = null;
    R.firstPass = true;
    spot.hide();
    save();
    if (!isOpen()) open();
    if (!isDesk()) S.collapsed = false;
    evaluate(false);
    renderDock(true);
  }
  function goStep(i) {
    const L = lesson();
    if (!L) return;
    S.step = Math.max(0, Math.min(L.steps.length - 1, i));
    R.flash = null;
    spot.hide();
    save();
    evaluate(false);
    renderDock(true);
  }
  function nextStep() {
    const L = lesson();
    if (!L) return;
    if (S.step < L.steps.length - 1) { goStep(S.step + 1); return; }
    if (lessonDone(L)) { R.celebrate = L.id; renderDock(true); return; }
    const todo = L.steps.findIndex((st) => !isDone(L, st));
    goStep(todo < 0 ? 0 : todo);
  }

  // is this lesson waiting for the right song? (own lessons need your own song, the tour the demo)
  function gate(L) {
    const p = app.project;
    if (!p) return null;
    if (L.song === 'own' && p.id === 'demo') return { msg: 'This lesson builds your own track, so its checks start once you are on your own song.', label: 'Start a new song', run: () => app.newSong(false) };
    if (L.song === 'demo' && p.id !== 'demo') return { msg: 'The tour plays the demo song.', label: 'Load the demo', run: () => app.newSong(true) };
    return null;
  }

  // --- checks ----------------------------------------------------------------------------------------
  // a throttle, not a debounce: during playback the ear asks four times a second and the
  // check must still run
  let evalTimer = 0;
  function soon(ms = 160) {
    if (evalTimer) return;
    evalTimer = setTimeout(() => { evalTimer = 0; evaluate(true); }, ms);
  }
  function factsNow() { const F = facts(app); F.ear = ear; F.doctor = R.report; return F; }

  function evaluate(draw = true) {
    if (!app.project) return;
    const L = lesson();
    if (L) {
      const F = factsNow();
      const blocked = !!gate(L);
      let changed = false;
      L.steps.forEach((st, i) => {
        const key = stepKey(L, st);
        if (S.done[key] || !st.check || blocked) return;
        let base;
        if (st.base) {
          // baseline = how the song was when this step became the current one
          const bk = `${key}@${app.project.id}`;
          if (i === S.step && S.bases[bk] == null) { const b = safe(() => st.base(F)); if (b != null) { S.bases[bk] = b; changed = true; } }
          base = S.bases[bk];
          if (base == null) return;
        }
        if (runCheck(st, F, base)) {
          S.done[key] = R.firstPass ? 'had' : 'did';
          changed = true;
          if (i === S.step && !R.firstPass) { R.flash = key; R.reveal = true; }
        }
      });
      R.firstPass = false;
      if (changed) {
        save();
        if (lessonDone(L) && R.flash) R.celebrate = L.id;
      }
    }
    if (app.lastExport !== R.lastExport) { R.lastExport = app.lastExport; recheck(50); }
    if (draw) renderDock();
  }

  let docTimer = 0;
  function recheck(ms = 700) {
    clearTimeout(docTimer);
    docTimer = setTimeout(() => {
      if (!app.project) return;
      R.report = checkSong(app, ear);
      evaluate(false);
      renderDock();
    }, ms);
  }

  // --- actions ---------------------------------------------------------------------------------------
  // put the app where a step happens: track, pattern, section, tab
  function navigate(st) {
    const F = facts(app);
    if (st.track) { const t = F.track(st.track); if (t) app.ui.track = t.id; }
    const sel = st.select && safe(() => st.select(F));
    if (sel) {
      if (sel.t) app.ui.track = sel.t.id;
      if (sel.t && sel.q) app.ui.pat[sel.t.id] = sel.q.id;
      if (sel.sec) app.ui.section = sel.sec.i;
    }
    if (st.tab) app.goTab(st.tab); else app.render();
  }
  async function showMe(st) {
    navigate(st);
    await frames(2);
    const F = facts(app);
    const el = resolveTarget(st.target, { tab: st.tab, F });
    const found = spot.show(st.target, { tab: st.tab, F, label: st.title, via: st.via });
    // on the phone, get the dock out of the way so the spotlight is visible
    if (!isDesk() && isOpen() && !S.collapsed && !(el && dock.contains(el))) setCollapsed(true);
    if (!found && st.target && !st.via) toast('Not on screen yet. Follow the step text to get there.');
  }

  function doIt(st) {
    const snap = st.doIt.undo === false ? null : safe(() => structuredClone(app.project));
    let msg = null;
    R.undoGuard = true;
    try { msg = runDoIt(st, app, api); } catch (e) { console.error(e); toast('Could not do that: ' + e.message); } finally { R.undoGuard = false; }
    if (msg) {
      R.undo = snap ? { msg, snap, t: Date.now() } : null;
      if (!snap) toast(msg);
    }
    if (msg && (st.track || st.select)) navigate(st);
    soon(80);
    recheck(300);
    renderDock(true);
  }
  function undo() {
    const u = R.undo;
    if (!u) return;
    R.undo = null;
    // the change is the last step in the app's history (js/undo.js): undo it there, so the music
    // keeps playing and Shift+Backspace can redo it; the old way if the history doesn't have it
    if (!(app.history && app.history.undoIf(u.snap))) {
      app.openProject(u.snap);
      app.changed();
      toast('Undone');
    }
    renderDock(true);
  }
  function fix(f) {
    // the card may be a few edits old (the check re-runs after a pause): fix what is true now
    const now = safe(() => checkSong(app, ear).findings.find((x) => x.id === f.id));
    if (!now || !now.fix) { R.report = checkSong(app, ear); renderDock(true); toast('Already fixed'); return; }
    const snap = safe(() => structuredClone(app.project));
    let msg = null;
    R.undoGuard = true;
    try { msg = now.fix.run(app); } catch (e) { console.error(e); toast('Could not fix that: ' + e.message); } finally { R.undoGuard = false; }
    if (msg) R.undo = snap ? { msg, snap, t: Date.now() } : null;
    R.report = checkSong(app, ear);
    evaluate(false);
    renderDock(true);
  }
  function gotIt(key) { S.done[key] = 'got'; R.flash = key; save(); const L = lesson(); if (L && lessonDone(L)) R.celebrate = L.id; renderDock(true); }

  function listen(st, key) {
    const E = app.engine;
    if (R.listening && R.listening.key === key && E.playing) { stopListen(); return; }
    const x = safe(() => st.listen.sec(facts(app)));
    if (!x) { toast('This song has no such section yet.'); return; }
    const prevLoop = R.listening ? R.listening.prevLoop : (E.loop ? { ...E.loop } : null);
    R.listening = { key, prevLoop };
    if (E.playing) E.stop();
    app.ui.section = x.i;
    if (st.listen.loop) app.setLoop(true);
    else if (E.loop) app.setLoop(false);
    E.seek(sectionStarts(app.project)[x.i]);
    ear.last = null;
    Promise.resolve(app.togglePlay()).then(() => renderDock());
    renderDock();
  }
  function stopListen() {
    const L = R.listening;
    R.listening = null;
    if (app.engine.playing) app.togglePlay();
    if (L && !L.prevLoop && app.engine.loop) app.setLoop(false);
    renderDock();
  }

  // --- explain mode and popovers ---------------------------------------------------------------------
  let pop = null;
  function setExplain(on) {
    S.explain = on;
    document.body.classList.toggle('co-explain', on);
    save();
    if (!on) closePop();
    renderDock(true);
  }
  function closePop() { if (pop) { pop.remove(); pop = null; } }
  function showPop(entry, anchor, label) {
    closePop();
    pop = h('div', { class: 'co-pop', role: 'dialog', 'aria-label': entry ? entry.term : label },
      h('div', { class: 'co-pop-top' },
        h('b', {}, entry ? entry.term : label),
        entry ? h('span', { class: 'co-cat' }, entry.cat) : null,
        h('button', { class: 'co-icon sm', 'aria-label': 'Close', onclick: closePop, html: ICON.close })),
      entry ? h('p', {}, entry.text) : h('p', {}, 'No explanation for this control yet. Search the glossary in the coach.'),
      entry && entry.sweet ? h('div', { class: 'co-sweet' }, h('small', {}, 'Sweet spot'), h('span', {}, entry.sweet)) : null,
      h('button', { class: 'co-link', onclick: () => { R.q = entry ? entry.term : label; R.cat = null; R.focusSearch = true; closePop(); setView('explain'); } }, 'Open in the glossary'));
    document.body.append(pop);
    // work in CSS pixels of the (possibly zoomed) page
    const z = pageZoom();
    const a = anchor.getBoundingClientRect();
    const r = { left: a.left / z, top: a.top / z, bottom: a.bottom / z };
    const vw = window.innerWidth / z;
    const vh = window.innerHeight / z;
    const w = Math.min(340, vw - 16);
    pop.style.width = w + 'px';
    const ph = pop.offsetHeight;
    const left = Math.max(8, Math.min(vw - w - 8, r.left));
    const below = r.bottom + 8;
    pop.style.left = left + 'px';
    pop.style.top = (below + ph < vh - 8 ? below : Math.max(8, r.top - ph - 8)) + 'px';
  }
  // event delegation: labels and titles anywhere in the app, without touching the screens
  document.addEventListener('click', (e) => {
    if (!S.explain || !(e.target instanceof Element) || dock.contains(e.target)) return;
    const lbl = e.target.closest('.slider .lbl');
    const title = !lbl && e.target.closest('.card-title');
    if (!lbl && !title) return;
    e.preventDefault();
    e.stopPropagation();
    if (lbl) {
      const sl = lbl.closest('.slider');
      const label = sl.dataset.label || lbl.textContent.trim();
      const card = sl.closest('.card');
      showPop(lookup(label, card && card.dataset.card), lbl, label);
    } else {
      const t = title.textContent.trim();
      showPop(lookupCard(t), title, t);
    }
  }, true);
  document.addEventListener('pointerdown', (e) => { if (pop && !pop.contains(e.target)) closePop(); }, true);
  // Esc first closes a definition or the Show me ring; only with neither up does it reach main.js,
  // where it resets the song (js/undo.js). Capture phase, so this runs before that.
  // A ring that isn't showing (its target scrolled away or under a sheet) is cleared without
  // taking the key, so the same Esc still closes the sheet. A quick second Esc after one that
  // closed something doesn't reset either (main.js undoKey, app.escClosedAt).
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !(pop || spot.active)) return;
    const shown = !!pop || !spot.ring.hidden;
    closePop();
    spot.hide();
    if (shown) { e.preventDefault(); app.escClosedAt = performance.now(); }
  }, true);
  window.addEventListener('resize', closePop);

  // --- rendering -------------------------------------------------------------------------------------
  function signature() {
    const L = lesson();
    const st = L && L.steps[S.step];
    const F = app.project ? factsNow() : null;
    const can = st && st.doIt && F ? safe(() => !st.doIt.when || st.doIt.when(F), false) : null;
    const rep = R.report;
    return JSON.stringify([R.view, S.lesson, S.step, S.collapsed, isDesk(), L ? L.steps.map((x) => S.done[stepKey(L, x)] || 0) : 0,
      rep ? [rep.overall, rep.findings.map((f) => f.id + f.title)] : 0, app.engine.playing, R.listening && R.listening.key, R.undo && R.undo.t,
      S.welcomed, S.explain, app.project && app.project.id, L && !!gate(L), R.celebrate, R.flash, can, R.view === 'learn' && !L ? Object.keys(S.done).length : 0]);
  }
  let bodyEl = null;
  function renderDock(force = false) {
    if (!isOpen()) return;
    const sig = signature();
    if (!force && sig === R.sig) return;
    const sameView = R.sig && JSON.parse(R.sig).slice(0, 3).join() === JSON.parse(sig).slice(0, 3).join();
    R.sig = sig;
    const keep = sameView && bodyEl ? bodyEl.scrollTop : 0;
    // someone typing in the glossary search keeps the box (and the caret) through a re-render
    const ae = document.activeElement;
    const typing = ae && dock.contains(ae) && ae.classList.contains('co-search-in') ? [ae.selectionStart, ae.selectionEnd] : null;
    const collapsed = !isDesk() && S.collapsed;
    dock.classList.toggle('co-collapsed', collapsed);
    if (collapsed) { dock.replaceChildren(h('div', { class: 'co-wrap' }, slimBar())); bodyEl = null; return; }
    bodyEl = h('div', { class: 'co-body' }, app.project ? viewContent() : h('p', { class: 'co-muted' }, 'Loading the song…'));
    dock.replaceChildren(h('div', { class: 'co-wrap' }, head(), bodyEl, undoBar()));
    if (keep) bodyEl.scrollTop = keep;
    const inp = typing && bodyEl.querySelector('.co-search-in');
    if (inp) { inp.focus({ preventScroll: true }); try { inp.setSelectionRange(...typing); } catch { /* not a text box */ } }
    // a step just ticked: bring its "Done" state into view
    const card = R.reveal && bodyEl.querySelector('.co-step.flash');
    R.reveal = false;
    if (card && card.offsetTop < bodyEl.scrollTop) bodyEl.scrollTo({ top: Math.max(0, card.offsetTop - 8), behavior: 'smooth' });
  }
  // timeouts expire the undo bar and the success flash
  setInterval(() => {
    let dirty = false;
    if (R.undo && Date.now() - R.undo.t > 20000) { R.undo = null; dirty = true; }
    if (app.lastExport !== R.lastExport) { evaluate(false); dirty = true; }
    if (dirty) renderDock();
  }, 1500);

  function head() {
    const tabs = [['learn', 'Learn'], ['check', 'Song check'], ['explain', 'Explain']];
    return h('div', { class: 'co-head' },
      h('span', { class: 'co-brand' }, ic('cap'), h('b', {}, 'Coach')),
      h('div', { class: 'co-tabs', role: 'tablist', 'aria-label': 'Coach views' }, tabs.map(([v, l]) => h('button', {
        class: 'co-tab' + (R.view === v ? ' on' : ''), 'data-view': v, role: 'tab', 'aria-selected': String(R.view === v), onclick: () => setView(v),
      }, l, v === 'check' && R.report ? h('span', { class: 'co-badge ' + grade(R.report.overall) }, String(R.report.overall)) : null))),
      h('button', { class: 'co-icon co-collapse', 'aria-label': 'Collapse the coach', title: 'Collapse', onclick: () => setCollapsed(true), html: ICON.down }),
      h('button', { class: 'co-icon', 'aria-label': 'Close the coach', title: 'Close', onclick: close, html: ICON.close }));
  }

  function slimBar() {
    const L = lesson();
    const st = L && L.steps[S.step];
    const d = st && isDone(L, st);
    const hasNext = L && S.step < L.steps.length - 1;
    const main = st
      ? [h('small', {}, `${L.n ? `Lesson ${L.n}` : 'Tour'} · step ${S.step + 1} of ${L.steps.length}`), h('b', {}, st.title)]
      : S.explain ? [h('small', {}, 'Explain mode is on'), h('b', {}, 'Tap any slider name or card title')]
        : [h('small', {}, 'Coach'), h('b', {}, R.view === 'check' && R.report ? `Song check: ${R.report.overall} · ${R.report.verdict}` : 'Lessons, song check and explain')];
    return h('div', { class: 'co-slim' },
      h('button', { class: 'co-slim-main', 'aria-expanded': 'false', 'aria-label': 'Expand the coach', onclick: () => setCollapsed(false) },
        ic('cap', 'co-ic co-slim-cap'),
        h('span', { class: 'co-slim-txt' }, main),
        st ? h('span', { class: 'co-state' + (d ? ' ok' : '') }, d ? [ic('check'), 'Done'] : 'To do') : null,
        ic('up', 'co-ic co-slim-up')),
      d && hasNext ? h('button', { class: 'co-btn primary sm', onclick: () => { goStep(S.step + 1); } }, 'Next', ic('next')) : null,
      h('button', { class: 'co-icon', 'aria-label': 'Close the coach', onclick: close, html: ICON.close }));
  }

  function undoBar() {
    if (!R.undo) return null;
    return h('div', { class: 'co-undo', role: 'status' }, ic('check'), h('span', {}, R.undo.msg), h('button', { class: 'co-link', onclick: undo }, 'Undo'));
  }

  function viewContent() {
    if (R.view === 'check') return checkView();
    if (R.view === 'explain') return explainView();
    const L = lesson();
    return L ? lessonView(L) : homeView();
  }

  // --- Learn: home --------------------------------------------------------------------------------
  function homeView() {
    const all = LESSONS.reduce((n, L) => n + L.steps.length, 0);
    const done = LESSONS.reduce((n, L) => n + doneCount(L), 0);
    const lessonsDone = LESSONS.filter(lessonDone).length;
    const resume = LESSONS.find((L) => doneCount(L) > 0 && !lessonDone(L));
    const out = [];
    if (!S.welcomed) {
      out.push(h('div', { class: 'co-welcome' },
        h('div', { class: 'co-wel-top' }, ic('cap'), h('b', {}, 'Your production coach')),
        h('p', {}, 'I will take you from an empty song to a finished, festival-ready track, one small step at a time. Every step tells you what to do and why the pros do it, points at the control, and ticks itself off when you have done it.'),
        h('div', { class: 'co-actions' },
          h('button', { class: 'co-btn primary', onclick: () => openLesson('tour') }, ic('play'), 'Take the 6-minute tour'),
          h('button', { class: 'co-btn', onclick: () => openLesson('first') }, 'Start Lesson 1')),
        h('button', { class: 'co-link', onclick: () => { S.welcomed = true; save(); renderDock(true); } }, 'Dismiss')));
    }
    if (resume) {
      const st = resume.steps.find((x) => !isDone(resume, x));
      out.push(h('button', { class: 'co-resume', onclick: () => openLesson(resume.id) },
        h('small', {}, 'Continue'),
        h('b', {}, `${resume.n ? `Lesson ${resume.n} · ` : ''}${resume.title}`),
        h('span', {}, st ? `Next: ${st.title}` : ''),
        bar(doneCount(resume) / resume.steps.length)));
    }
    out.push(h('div', { class: 'co-progress' },
      h('div', {}, h('b', {}, `${lessonsDone} of ${LESSONS.length}`), ' lessons · ', h('b', {}, `${done} of ${all}`), ' steps'),
      bar(done / all)));
    for (const stage of STAGES) {
      const list = LESSONS.filter((L) => L.stage === stage);
      if (!list.length) continue;
      out.push(h('div', { class: 'co-stage' }, stage));
      out.push(h('div', { class: 'co-lessons' }, list.map(lessonRow)));
    }
    out.push(h('div', { class: 'co-foot' },
      h('button', { class: 'co-link', onclick: () => { if (confirm('Reset all coach progress? Your songs are not touched.')) { S.done = {}; S.bases = {}; S.lesson = null; save(); renderDock(true); } } }, 'Reset progress')));
    return out;
  }
  function lessonRow(L) {
    const n = doneCount(L);
    const full = n === L.steps.length;
    return h('button', { class: 'co-lrow' + (full ? ' ok' : ''), onclick: () => openLesson(L.id) },
      h('span', { class: 'co-num' }, full ? ic('check') : L.n ? String(L.n) : ic('play')),
      h('span', { class: 'co-lmain' },
        h('b', {}, L.title),
        h('small', {}, `${L.steps.length} steps · ${L.minutes} min${n && !full ? ` · ${n} done` : ''}`),
        n && !full ? bar(n / L.steps.length) : null),
      ic('next', 'co-ic co-chev'));
  }
  const bar = (v) => h('span', { class: 'co-bar' }, h('i', { style: { width: `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%` } }));

  // --- Learn: a lesson -----------------------------------------------------------------------------
  function lessonView(L) {
    const i = Math.max(0, Math.min(L.steps.length - 1, S.step));
    const st = L.steps[i];
    const n = doneCount(L);
    const g = gate(L);
    const nextL = LESSONS[LESSONS.indexOf(L) + 1];
    const out = [
      h('div', { class: 'co-lhead' },
        h('button', { class: 'co-back', onclick: () => { S.lesson = null; save(); spot.hide(); renderDock(true); } }, ic('back'), 'Lessons'),
        h('div', { class: 'co-ltitle' }, h('small', {}, L.n ? `Lesson ${L.n} · ${L.stage}` : L.stage), h('b', {}, L.title)),
        h('div', { class: 'co-lprog' }, bar(n / L.steps.length), h('small', {}, `${n}/${L.steps.length}`))),
    ];
    if (i === 0 && !n) out.push(h('p', { class: 'co-summary' }, L.summary));
    if (g) out.push(h('div', { class: 'co-gate' }, ic('info'), h('p', {}, g.msg), h('button', { class: 'co-btn primary sm', onclick: () => { g.run(); } }, g.label)));
    if (R.celebrate === L.id || (lessonDone(L) && i === L.steps.length - 1 && R.flash)) {
      out.push(h('div', { class: 'co-complete' },
        h('div', { class: 'co-wel-top' }, ic('check'), h('b', {}, `${L.n ? `Lesson ${L.n}` : 'Tour'} complete`)),
        h('ul', {}, L.recap.map((r) => h('li', {}, r))),
        h('div', { class: 'co-actions' },
          nextL ? h('button', { class: 'co-btn primary', onclick: () => openLesson(nextL.id) }, `Next: ${nextL.title}`, ic('next')) : h('button', { class: 'co-btn primary', onclick: () => setView('check') }, 'Run the Song check'),
          h('button', { class: 'co-btn', onclick: () => { S.lesson = null; R.celebrate = null; save(); renderDock(true); } }, 'All lessons'))));
    }
    out.push(stepCard(L, st, i));
    out.push(h('ol', { class: 'co-steps', 'aria-label': 'Steps' }, L.steps.map((x, j) => {
      const d = S.done[stepKey(L, x)];
      return h('li', {}, h('button', { class: 'co-srow' + (j === i ? ' cur' : '') + (d ? ' ok' : '') + (d === 'had' ? ' had' : ''), 'aria-current': j === i ? 'step' : null, onclick: () => goStep(j) },
        h('span', { class: 'co-tick' }, d ? ic('check') : String(j + 1)), h('span', { class: 'co-stitle' }, x.title)));
    })));
    out.push(h('div', { class: 'co-foot' }, h('button', { class: 'co-link', onclick: () => { for (const x of L.steps) delete S.done[stepKey(L, x)]; for (const k of Object.keys(S.bases)) if (k.startsWith(L.id + '.')) delete S.bases[k]; S.step = 0; R.celebrate = null; R.firstPass = true; save(); evaluate(false); renderDock(true); } }, 'Restart this lesson')));
    return out;
  }

  function stepCard(L, st, i) {
    const key = stepKey(L, st);
    const d = S.done[key];
    const F = factsNow();
    const g = gate(L);
    // while an own-song lesson waits for your own song, nothing writes into the demo
    const can = st.doIt && !(g && L.song === 'own' && st.id !== 'new') && safe(() => !st.doIt.when || st.doIt.when(F), false);
    const playingThis = R.listening && R.listening.key === key && app.engine.playing;
    const last = i === L.steps.length - 1;
    const status = d === 'did' ? [ic('check'), 'Done'] : d === 'had' ? [ic('check'), 'Already in your song'] : d === 'got' ? [ic('check'), 'Got it'] : g ? 'Waiting for the right song' : st.check ? [h('i', { class: 'co-dot' }), 'Waiting for you'] : 'Read, then tap Got it';
    return h('section', { class: 'co-step' + (d ? ' done' : '') + (R.flash === key ? ' flash' : ''), 'aria-live': 'polite' },
      h('div', { class: 'co-step-top' },
        h('span', { class: 'co-stepno' }, `Step ${i + 1} of ${L.steps.length}`),
        st.tab ? h('span', { class: 'co-where' }, TABNAME[st.tab]) : null,
        h('span', { class: 'co-state' + (d ? ' ok' : '') }, status)),
      h('h3', {}, st.title),
      h('p', { class: 'co-text' }, md(st.text)),
      h('div', { class: 'co-why' }, h('small', {}, 'Why pros do it'), h('p', {}, md(st.why))),
      st.ears ? h('div', { class: 'co-ears' }, ic('ears'), h('p', {}, md(st.ears))) : null,
      h('div', { class: 'co-actions' },
        st.target ? h('button', { class: 'co-btn', onclick: () => showMe(st) }, ic('target'), 'Show me') : null,
        st.listen ? h('button', { class: 'co-btn' + (playingThis ? ' on' : ''), onclick: () => listen(st, key) }, playingThis ? [ic('stop'), 'Stop'] : [ic('ears'), st.listen.label || 'Listen']) : null,
        can ? h('button', { class: 'co-btn accent', onclick: () => doIt(st) }, ic('wand'), st.doIt.label) : null,
        st.gotIt && !d ? h('button', { class: 'co-btn', onclick: () => gotIt(key) }, ic('check'), 'Got it') : null),
      h('div', { class: 'co-nav' },
        h('button', { class: 'co-btn ghost', disabled: i === 0, onclick: () => goStep(i - 1) }, ic('back'), 'Back'),
        h('button', { class: 'co-btn ' + (d ? 'primary' : 'ghost') + (R.flash === key ? ' pulse' : ''), onclick: nextStep }, last ? 'Finish' : d ? 'Next step' : 'Skip', ic('next'))));
  }

  // --- Song check ---------------------------------------------------------------------------------------
  const grade = (n) => (n >= 85 ? 'g-good' : n >= 65 ? 'g-ok' : 'g-low');
  function checkView() {
    const rep = R.report || (R.report = checkSong(app, ear));
    const out = [
      h('div', { class: 'co-score' },
        h('div', { class: 'co-ring ' + grade(rep.overall), style: { '--v': rep.overall } }, h('b', {}, String(rep.overall))),
        h('div', { class: 'co-score-txt' },
          h('b', {}, rep.verdict),
          h('small', {}, 'Re-checks as you edit'),
          h('button', { class: 'co-link', onclick: () => { R.report = checkSong(app, ear); renderDock(true); } }, 'Check again'))),
      h('div', { class: 'co-areas' }, rep.areas.map((A) => h('button', { class: 'co-area', onclick: () => { const el = bodyEl && bodyEl.querySelector(`[data-area="${A.id}"]`); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } },
        h('span', {}, A.name), h('span', { class: 'co-bar ' + grade(A.score) }, h('i', { style: { width: A.score + '%' } })), h('b', {}, String(A.score))))),
    ];
    // details worst area first, so what to fix first is at the top
    const rank = (A) => A.findings.reduce((n, f) => n + SEV[f.sev].cost, 0);
    for (const A of rep.areas.slice().sort((a, b) => rank(b) - rank(a))) {
      out.push(h('div', { class: 'co-ahead', 'data-area': A.id }, h('b', {}, A.name), h('span', { class: 'co-badge ' + grade(A.score) }, String(A.score))));
      if (!A.findings.length) out.push(h('p', { class: 'co-muted co-allgood' }, ic('check'), 'Nothing to fix here.'));
      for (const f of A.findings) out.push(findingCard(f));
      if (A.passes.length) {
        out.push(h('details', { class: 'co-passes' }, h('summary', {}, `${A.passes.length} thing${A.passes.length === 1 ? '' : 's'} you got right`),
          h('ul', {}, A.passes.map((x) => h('li', {}, ic('check'), x.title)))));
      }
    }
    return out;
  }
  function findingCard(f) {
    const can = !!f.fix;
    return h('div', { class: 'co-find sev-' + f.sev },
      h('div', { class: 'co-find-top' }, h('span', { class: 'co-sev' }, SEV[f.sev].name), h('b', {}, f.title)),
      h('p', {}, f.why),
      can || f.show ? h('div', { class: 'co-actions' },
        can ? h('button', { class: 'co-btn accent sm', onclick: () => fix(f) }, ic('wand'), f.fix.label) : null,
        f.show ? h('button', { class: 'co-btn sm', onclick: () => showMe({ ...f.show, title: f.title }) }, ic('target'), 'Show me') : null) : null);
  }

  // --- Explain ------------------------------------------------------------------------------------------
  let results = null;
  function explainView() {
    const input = h('input', { type: 'text', class: 'co-search-in', placeholder: 'Search: detune, LUFS, voicing, pump…', value: R.q, 'aria-label': 'Search the glossary',
      oninput: (e) => { R.q = e.target.value; renderResults(); } });
    results = h('div', { class: 'co-terms' });
    renderResults();
    // focus the search only when the learner came here from a popover, never on a re-render
    // (that would pull the keyboard away from the app: Space and the arrows would type here)
    if (R.focusSearch) { R.focusSearch = false; if (isDesk()) requestAnimationFrame(() => input.focus()); }
    return [
      h('label', { class: 'co-switch' + (S.explain ? ' on' : '') },
        h('input', { type: 'checkbox', checked: S.explain, onchange: (e) => setExplain(e.target.checked) }),
        h('span', { class: 'co-switch-ui', 'aria-hidden': 'true' }),
        h('span', { class: 'co-switch-txt' }, h('b', {}, 'Explain mode'), h('small', {}, S.explain ? 'On: tap any slider name or card title in the app.' : 'Tap any slider name or card title in the app to see what it does and its sweet spot.'))),
      h('div', { class: 'co-search' }, ic('search'), input),
      h('div', { class: 'co-cats' }, [null, ...CATS].map((c) => h('button', { class: 'co-chip' + (R.cat === c ? ' on' : ''), onclick: () => { R.cat = c; renderDock(true); } }, c || 'All'))),
      results,
    ];
  }
  function renderResults() {
    if (!results) return;
    const list = search(R.q, R.cat);
    results.replaceChildren(
      h('small', { class: 'co-muted' }, `${list.length} term${list.length === 1 ? '' : 's'}`),
      ...list.slice(0, 80).map((e) => h('div', { class: 'co-term' },
        h('div', { class: 'co-term-top' }, h('b', {}, e.term), h('span', { class: 'co-cat' }, e.cat)),
        h('p', {}, e.text),
        e.sweet ? h('div', { class: 'co-sweet' }, h('small', {}, 'Sweet spot'), h('span', {}, e.sweet)) : null)));
  }

  // --- app events ---------------------------------------------------------------------------------------
  app.on('render', () => soon(120));
  app.on('edit', () => {
    if (!R.undoGuard && R.undo) R.undo = null; // the learner changed something: undo would lose it
    soon(220);
    recheck(900);
  });
  app.on('open', () => {
    R.report = null;
    R.listening = null;
    // the drop loudness heard belongs to the song it was heard in
    if (!app.project || ear.dropPid !== app.project.id) ear.dropLufs = null;
    recheck(150);
    soon(60);
    if (!S.hinted) setTimeout(hint, 2600);
  });
  app.on('play', () => renderDock());
  app.on('stop', () => {
    const L = R.listening;
    if (L) { R.listening = null; if (!L.prevLoop && app.engine.loop) app.setLoop(false); }
    renderDock();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) spot.hide(); });

  // a one-time nudge towards the coach button (never opens over the app by itself)
  function hint() {
    if (S.hinted || isOpen()) return;
    S.hinted = true;
    save();
    if (navigator.webdriver || /HeadlessChrome/.test(navigator.userAgent)) return; // no surprise toasts in automated runs
    const sheet = $('#sheetWrap');
    if (sheet && !sheet.hidden) return;
    toast('New: tap the graduation cap for the Coach. Lessons that teach you to produce like a pro.');
  }

  const api = { open, close, toggle, openLesson, setView, goStep, evaluate: () => evaluate(true), state: S, ear, spot, report: () => R.report, lessons: LESSONS, areas: AREAS };
  app.coach = api;
  if (S.explain) document.body.classList.add('co-explain');
  if (S.open) open();
}
