// E-Drop: festival EDM production studio for iPhone and desktop browsers.
import { Engine, sectionStarts, songBars } from './audio/engine.js';
import { ensure, ensureAll, renderState, stepSec } from './audio/render.js';
import { playFx } from './audio/fx.js';
import { NOTE_NAMES, SCALES, mtof } from './music/theory.js';
import { templateProject, normalize } from './music/project.js';
import { demoProject } from './music/demo.js';
import { PianoRoll } from './ui/roll.js';
import { renderSong } from './ui/song.js';
import { renderNotes, renderDrums, curPattern } from './ui/screens.js';
import { renderSound } from './ui/sound.js';
import { renderMix } from './ui/mix.js';
import { h, $, $$, openSheet, closeSheet, sheetOpen, toast, seg, field, chip, slider, stepLevelControl, setStepLevel } from './ui/dom.js';
import { initDesk, renderDesk, deskGoTab, deskKey, visible, updateMeter, displaySheet, shortcutsSheet, zoomLevel } from './ui/desktop.js';
import { initCoach } from './coach/coach.js';
import { initUndo, ensureOriginal, snapshot, demoLike } from './undo.js';
import { runDsp } from './dsp/client.js';
import * as store from './store.js';

export const APP_VERSION = 3;
const engine = new Engine();
const ctx = engine.ctx;
const settings = loadSettings();

function loadSettings() {
  try { return Object.assign({ lastProject: null }, JSON.parse(localStorage.getItem('e-drop-settings') || '{}')); } catch { return { lastProject: null }; }
}
function saveSettings() { try { localStorage.setItem('e-drop-settings', JSON.stringify(settings)); } catch { /* private mode */ } }

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M6 6h2.2v12H6zM19 6v12l-9-6z" fill="currentColor"/></svg>',
  loop: '<svg viewBox="0 0 24 24"><path d="M17 4l3 3-3 3M20 7H8a4 4 0 0 0-4 4v1M7 20l-3-3 3-3M4 17h12a4 4 0 0 0 4-4v-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  coach: '<svg viewBox="0 0 24 24"><path d="M12 4 2.5 9 12 14l9.5-5z" fill="currentColor"/><path d="M6.5 11.3v4.2c0 1.6 2.5 3 5.5 3s5.5-1.4 5.5-3v-4.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M20.5 9.5v5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="18.5" cy="12" r="1.8" fill="currentColor"/></svg>',
  song: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="7" height="4" rx="1" fill="currentColor"/><rect x="11" y="5" width="10" height="4" rx="1" fill="currentColor" opacity=".5"/><rect x="3" y="11" width="11" height="4" rx="1" fill="currentColor" opacity=".5"/><rect x="15" y="11" width="6" height="4" rx="1" fill="currentColor"/><path d="M3 19.5c4-3 7 1 9-1.5s5-2 9 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  notes: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="6" y="7" width="5" height="2.4" rx="1" fill="currentColor"/><rect x="10" y="11" width="7" height="2.4" rx="1" fill="currentColor"/><rect x="7" y="15" width="4" height="2.4" rx="1" fill="currentColor"/></svg>',
  drums: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.8" fill="currentColor"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.8" fill="currentColor"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M3 12h2l2-6 3 12 3-15 3 15 2-6h3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  mix: '<svg viewBox="0 0 24 24"><path d="M6 4v16M12 4v16M18 4v16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="3.5" y="13" width="5" height="3" rx="1" fill="currentColor"/><rect x="9.5" y="7" width="5" height="3" rx="1" fill="currentColor"/><rect x="15.5" y="11" width="5" height="3" rx="1" fill="currentColor"/></svg>',
  keys: '<svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 9.6h1.4M9.6 9.6H11M13 9.6h1.4M16.6 9.6H18M6 12.4h1.4M16.6 12.4H18M8.5 15h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};

// ---------------------------------------------------------------------------------------
// app state shared with the screens
const app = {
  engine,
  project: null,
  ui: {
    tab: 'song', track: null, pat: {}, section: 0, grid: 1, noteLen: null, ghosts: true, barPx: 9, tlScroll: 0, drumPage: 0,
    chord: { prog: 'anthem', voicing: 'triad', barsPer: 1, octave: 0, gen: null }, snare: { bars: 8, voice: 'snare', kick: true }, openStrip: null,
    // desktop layout (js/ui/desktop.js): editor panel 'notes' | 'drums', shared side slot 'sound' | 'mix', song fitted to the width
    editor: 'notes', side: 'sound', tlFit: true,
  },
  desk: false, // true at 1200 CSS px and wider: every panel on screen at once (js/ui/desktop.js)
  ultra: false, // true at 2200 px and wider
  meterNow: null, // latest engine.meter() reading { m, s, peak, gr }, set every frame while Mix (or the desktop top bar) shows
  render,
  goTab(name) {
    if (app.desk) { deskGoTab(app, name); app.emit('tab', name); return; }
    app.ui.tab = name; render(); $('#main').scrollTop = 0; app.emit('tab', name);
  },
  changed() { scheduleSave(); render(); },
  patternEdited(t, pat, rerenderUi) { scheduleSave(); queueRender(t, pat); if (rerenderUi) render(); },
  notesEdited(t, pat) { scheduleSave(); queueRender(t, pat); app.roll.draw(); },
  soundChanged(t) {
    scheduleSave();
    clearTimeout(soundTimers.get(t.id));
    // the track as it is in the song when the timer fires (an undo may have swapped it)
    soundTimers.set(t.id, setTimeout(() => {
      const live = app.project.tracks.find((x) => x.id === t.id);
      if (live) for (const pat of live.patterns) ensure(app.project, live, pat, engine.sr);
    }, 180));
  },
  pumpChanged() { scheduleSave(); for (const t of app.project.tracks) if (t.role === 'drums') app.soundChanged(t); },
  arrangementChanged() { scheduleSave(); clampLoop(); engine.refresh(); render(); },
  automationChanged(full) { scheduleSave(); engine.relane(); if (full) render(); },
  structureChanged() { scheduleSave(); engine.rebuild(); ensureAll(app.project, engine.sr); render(); },
  mixChanged() { engine.updateMix(); scheduleSave(); },
  setLoop(on) {
    const p = app.project;
    if (on && p.sections.length) {
      const st = sectionStarts(p)[app.ui.section];
      engine.loop = { from: st, to: st + p.sections[app.ui.section].bars };
    } else engine.loop = null;
    if (engine.playing) engine.play(on ? engine.loop.from : engine.position());
    renderTransport();
    render();
  },
  preview(t, pitch, dur) { unlock(); engine.preview(t, pitch, dur); },
  previewFx(e) {
    unlock();
    const t = app.project.tracks.find((x) => x.role === 'fx');
    const s = t && engine.m.strips.get(t.id);
    if (s) playFx(ctx, s.in, e.type, ctx.currentTime + 0.02, Math.min(8, e.len * stepSec(app.project)), { vel: e.vel ?? 1, rootHz: mtof(app.project.key + 41) });
  },
  showValue(msg) { toast(msg); },
  // tiny event bus for add-ons (the coach): 'render' after every screen render, 'edit' on every
  // project change, 'tab' when the tab changes, 'play' / 'stop' from the transport, 'open' on a new project
  listeners: {},
  on(type, fn) { (app.listeners[type] || (app.listeners[type] = [])).push(fn); return () => { app.listeners[type] = app.listeners[type].filter((f) => f !== fn); }; },
  emit(type, data) { for (const fn of app.listeners[type] || []) { try { fn(data); } catch (e) { console.error(e); } } },
};
app.roll = new PianoRoll(app);
window.__edrop = app;
// for add-ons (the coach); assigned here because they're function declarations further down
Object.assign(app, { openProject, newSong, saveNow, openMenu, tempoSheet, keySheet, exportSheet, togglePlay, allChanged, toSectionStart });

const soundTimers = new Map();
const renderTimers = new Map();
function queueRender(t, pat) {
  clearTimeout(renderTimers.get(pat.id));
  renderTimers.set(pat.id, setTimeout(() => {
    const live = app.project.tracks.find((x) => x.id === t.id);
    const lp = live && live.patterns.find((q) => q.id === pat.id);
    if (lp) ensure(app.project, live, lp, engine.sr);
  }, 120));
}
function cancelRenderTimers() {
  for (const m of [soundTimers, renderTimers]) { for (const id of m.values()) clearTimeout(id); m.clear(); }
}

function clampLoop() {
  if (!engine.loop) return;
  const p = app.project;
  app.ui.section = Math.min(app.ui.section, p.sections.length - 1);
  if (app.ui.section < 0) { engine.loop = null; return; }
  const st = sectionStarts(p)[app.ui.section];
  engine.loop = { from: st, to: st + p.sections[app.ui.section].bars };
}

let saveTimer = null;
let dirty = false;
function scheduleSave() {
  if (app.project) app.project.edited = true;
  app.emit('edit');
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}
function saveNow() {
  clearTimeout(saveTimer);
  const p = app.project;
  if (!p || !dirty) return Promise.resolve();
  dirty = false;
  p.updated = Date.now();
  return store.saveProject(JSON.parse(JSON.stringify(p))).catch((e) => toast('Could not save: ' + e.message));
}

function openProject(p) {
  engine.stop();
  engine.loop = null;
  normalize(p);
  // the song as it was first made, for Esc (js/undo.js); stored with the song from now on
  if (ensureOriginal(p)) store.saveProject(JSON.parse(JSON.stringify(p))).catch(() => { /* storage blocked */ });
  app.project = p;
  app.ui.track = (p.tracks.find((t) => t.role === 'lead') || p.tracks[0] || {}).id;
  app.ui.pat = {};
  app.ui.section = 0;
  app.ui.tlScroll = 0;
  engine.setProject(p);
  settings.lastProject = p.id;
  saveSettings();
  // render every part in the background so Play starts right away
  ensureAll(p, engine.sr);
  renderHeader();
  render();
  app.emit('open', p);
}

// Undo, redo and reset (js/undo.js): put a snapshot in as the song without resetting the screens
// or stopping the music. The selection stays where it still exists; app.undoFocus, when set,
// selects the track (and pattern) the step changed, so the change is on screen.
function swapProject(json) {
  const old = app.project;
  const p = normalize(JSON.parse(json));
  p.original = old.original;
  if (old.beforeReset) p.beforeReset = old.beforeReset; // undo.js drops it when a reset is undone
  p.edited = true;
  p.updated = old.updated;
  const was = engine.playing;
  const pos = engine.position();
  if (was) engine.stop();
  // renders queued for the song being replaced must not land after it
  cancelRenderTimers();
  app.project = p;
  engine.project = p;
  engine.rebuild();
  const ui = app.ui;
  const has = (id) => p.tracks.some((t) => t.id === id);
  const focus = app.undoFocus;
  app.undoFocus = null;
  if (focus && focus.track && has(focus.track)) { ui.track = focus.track; if (focus.pat) ui.pat[focus.track] = focus.pat; }
  if (!has(ui.track)) {
    const o = old.tracks.find((t) => t.id === ui.track);
    const same = o && p.tracks.find((t) => t.role === o.role && t.name === o.name);
    ui.track = (same || p.tracks.find((t) => t.role === 'lead') || p.tracks[0] || {}).id;
  }
  for (const [tid, qid] of Object.entries(ui.pat)) {
    const t = p.tracks.find((x) => x.id === tid);
    if (!t || !t.patterns.some((q) => q.id === qid)) delete ui.pat[tid];
  }
  if (ui.openStrip && !has(ui.openStrip)) ui.openStrip = null;
  // the selected section by id, so undoing a Move keeps it (and the loop) on the section that moved;
  // after undoing an Add or a Duplicate, the nearest section before it that still exists
  let j = ui.section;
  let k = -1;
  while (j >= 0 && (k = p.sections.findIndex((s) => old.sections[j] && s.id === old.sections[j].id)) < 0) j--;
  ui.section = k >= 0 ? k : Math.max(0, Math.min(ui.section, p.sections.length - 1));
  clampLoop();
  // the piano roll keeps its scroll when it still shows the same pattern; a note held down in it
  // belongs to the old song (main.js ignores the undo keys mid-drag, this is the backstop)
  const R = app.roll;
  R.drag = null;
  if (R.pat) {
    const t = p.tracks.find((x) => x.patterns.some((q) => q.id === R.pat.id));
    if (t) { R.track = t; R.pat = t.patterns.find((q) => q.id === R.pat.id); }
  }
  ensureAll(p, engine.sr);
  if (was) engine.play(pos);
  scheduleSave();
  renderHeader();
  render();
}

async function loadProject(id) {
  const p = await store.getProject(id);
  if (!p) return false;
  openProject(p);
  return true;
}

// ---------------------------------------------------------------------------------------
// screens
function render() {
  const p = app.project;
  if (!p) return;
  const tab = app.ui.tab;
  $$('#tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  // a computer: every visible panel (js/ui/desktop.js); the phone: the current tab
  if (app.desk) renderDesk(app);
  else {
    $$('.tab').forEach((s) => s.classList.toggle('active', s.id === `tab-${tab}`));
    const root = $(`#tab-${tab}`);
    $('#main').classList.toggle('fill', tab === 'notes');
    if (tab === 'song') renderSong(app, root);
    else if (tab === 'notes') renderNotes(app, root);
    else if (tab === 'drums') renderDrums(app, root);
    else if (tab === 'sound') renderSound(app, root);
    else if (tab === 'mix') renderMix(app, root);
  }
  renderHeader();
  renderTransport();
  app.emit('render');
}

function renderHeader() {
  const p = app.project;
  $('#projName').textContent = p.name;
  $('#bpmBtn').textContent = `${p.bpm} BPM`;
  $('#keyBtn').textContent = `${NOTE_NAMES[p.key]} ${p.scale === 'major' ? 'maj' : p.scale === 'minor' ? 'min' : SCALES[p.scale].name.split(' ')[0].toLowerCase()}`;
}

function renderTransport() {
  $('#btnPlay').innerHTML = engine.playing ? ICON.stop : ICON.play;
  $('#btnPlay').setAttribute('aria-label', engine.playing ? 'Stop' : 'Play');
  $('#btnLoop').classList.toggle('on', !!engine.loop);
}

renderState.onchange = () => {
  const el = $('#renderBadge');
  el.hidden = !renderState.busy;
  el.textContent = renderState.busy > 1 ? `Rendering ${renderState.busy} parts` : 'Rendering';
};

// ---------------------------------------------------------------------------------------
// sheets: tempo, key, menu, projects, export, install
function tempoSheet() {
  const p = app.project;
  const set = (v) => { p.bpm = v; allChanged(); tempoSheet(); };
  openSheet('Tempo',
    h('div', { class: 'big-num' }, `${p.bpm} BPM`),
    slider('Tempo', p.bpm, 100, 150, 1, (v) => { $('.big-num').textContent = `${v} BPM`; }, (v) => `${v}`, { onChange: (v) => set(v) }),
    h('div', { class: 'chips' }, [[124, 'Progressive 124'], [126, 'House 126'], [128, 'Big room 128'], [130, 'Festival 130'], [132, 'Uplifting 132'], [138, 'Trance 138']].map(([v, l]) => chip(l, p.bpm === v, () => set(v)))),
    h('p', { class: 'hint' }, 'Changing the tempo re-renders every part. Notes stay on the grid.'));
}

function keySheet() {
  const p = app.project;
  const st = keySheet.st || (keySheet.st = { move: true });
  const setKey = (k) => {
    let d = ((k - p.key) % 12 + 12) % 12;
    if (d > 6) d -= 12;
    if (st.move && d) for (const t of p.tracks) if (t.synth) for (const pat of t.patterns) for (const n of pat.notes) n.pitch += d;
    p.key = k;
    allChanged();
    keySheet();
  };
  openSheet('Key and scale',
    field('Key', h('div', { class: 'keys12' }, NOTE_NAMES.map((n, i) => h('button', { class: 'chip' + (i === p.key ? ' on' : ''), onclick: () => setKey(i) }, n)))),
    field('Scale', seg(Object.entries(SCALES).map(([k, v]) => [k, v.name]), p.scale, (v) => { p.scale = v; allChanged(); keySheet(); }, 'wrap')),
    chip('Move the notes to the new key', st.move, (v) => { st.move = v; keySheet(); }),
    h('p', { class: 'hint' }, 'The kick and the percussion are tuned to the key. The piano roll highlights the scale, and the chord helper writes in it.'));
}

async function allChanged() {
  scheduleSave();
  renderHeader();
  const was = engine.playing;
  const pos = engine.position();
  if (was) engine.stop();
  engine.updateMix();
  const p0 = app.project;
  const gen = engine.gen;
  await ensureAll(p0, engine.sr, { untilBar: pos + 12 });
  // play again unless Play or Stop was pressed meanwhile; after an undo it plays the restored song
  if (was && !engine.playing && engine.gen === gen) engine.play(pos);
  // an undo swapped in another song object meanwhile and has drawn the screens for it
  if (app.project === p0) render();
}

function logoTile() { return h('span', { class: 'logo-tile', html: $('.top .logo-tile').innerHTML }); }

function openMenu() {
  openSheet(null,
    h('button', { class: 'mi', onclick: exportSheet }, 'Export song as WAV', h('small', {}, 'Mastered, then Share or Save to Files')),
    h('button', { class: 'mi', onclick: openProjects }, 'Songs', h('small', {}, 'Open, copy or delete saved songs')),
    h('button', { class: 'mi', onclick: () => newSong(false) }, 'New song', h('small', {}, 'Festival template: sections, drums, FX and build sweep ready; you write the notes')),
    h('button', { class: 'mi', onclick: () => newSong(true) }, 'Load the demo song', h('small', {}, 'A full intro → build → drop → breakdown → build → drop')),
    h('button', { class: 'mi', onclick: openHelp }, 'How to make a track'),
    app.desk ? h('button', { class: 'mi', onclick: shortcutsSheet }, 'Keyboard shortcuts', h('small', {}, 'Backspace undo, Esc reset, Space play, L loop, F fit, N / D / S / M panels, C coach · press ? any time')) : null,
    innerWidth >= 900 ? h('button', { class: 'mi', onclick: () => displaySheet(app) }, 'Display size', h('small', {}, `${Math.round(zoomLevel() * 100)}% · bigger text and controls for a big screen seen from a distance`)) : null,
    h('button', { class: 'mi', onclick: openInstall }, onComputer() ? 'Install on this computer' : 'Install on iPhone'),
    h('div', { class: 'about' }, logoTile(), h('div', {}, h('b', {}, 'E-Drop'), h('br'), `by E-Estimating LLC · version ${APP_VERSION}. Songs stay on this device.`)));
}

async function newSong(demo) {
  closeSheet();
  await saveNow();
  let old = null;
  if (demo) {
    old = await store.getProject('demo').catch(() => null);
    if (old && old.edited && !confirm('Reload the demo? Changes you made to it will be replaced.')) return;
  }
  // the demo again keeps the stored demo's ids (js/undo.js demoLike): nothing re-renders that didn't
  // change, and Backspace can undo the reload
  const p = demo ? (old ? demoLike(old) : demoProject()) : templateProject('New song');
  try { await store.saveProject(JSON.parse(JSON.stringify(p))); } catch { /* storage blocked */ }
  openProject(p);
  app.goTab(demo ? 'song' : 'notes');
  toast(demo ? 'Demo loaded. Press play.' : 'New song: start with Chords & parts on the pad, then write the lead.');
}

async function openProjects() {
  await saveNow();
  const list = await store.listProjects();
  openSheet('Songs', h('div', { class: 'list' }, list.map((p) => h('div', { class: 'row' },
    h('button', { class: 'mi grow' + (p.id === app.project.id ? ' on' : ''), onclick: () => { closeSheet(); openProject(normalize(p)); } }, p.name,
      h('small', {}, `${p.bpm} BPM · ${NOTE_NAMES[p.key]} · ${songBars(p)} bars · ${new Date(p.updated).toLocaleDateString()}`)),
    h('button', { class: 'chip', onclick: async () => {
      const c = JSON.parse(JSON.stringify(p));
      c.id = Math.random().toString(36).slice(2, 10);
      c.name = `${p.name} copy`;
      c.created = c.updated = Date.now();
      c.original = snapshot(c); // Esc in the copy goes back to the copy as it was made
      delete c.beforeReset;
      await store.saveProject(c);
      openProjects();
    } }, 'Copy'),
    h('button', { class: 'chip danger', disabled: p.id === app.project.id, onclick: async () => {
      if (!confirm(`Delete "${p.name}"? This can't be undone.`)) return;
      await store.deleteProject(p.id);
      openProjects();
    } }, 'Delete')))));
}

function openHelp() {
  openSheet('Making a festival track',
    h('ol', { class: 'help' },
      h('li', {}, h('b', {}, 'New song'), ' from the menu gives you the sections (intro, breakdown, build, drop, outro), drums, risers and the build sweep.'),
      h('li', {}, h('b', {}, 'Chords: '), 'Notes tab → pick Pad → Chords & parts → choose vi–IV–I–V → Fill every synth track. That writes chords, stabs, bass, sub, an arp and a lead hook.'),
      h('li', {}, h('b', {}, 'Lead: '), 'pick Lead and change the hook. Tap to add notes, drag to move, drag the right end to resize. Ghost notes show the chords.'),
      h('li', {}, h('b', {}, 'Sound: '), 'pick presets (Festival Supersaw, Big Room Bass…) and shape them.'),
      h('li', {}, h('b', {}, 'Drums: '), 'presets for each section, and Snare roll for the build.'),
      h('li', {}, h('b', {}, 'Song: '), 'tap cells to choose which pattern plays where. Select the build and tap Add build sweep.'),
      h('li', {}, h('b', {}, 'Mix: '), 'set levels and how much each track pumps under the kick. Aim for about −9 LUFS in the drop.'),
      h('li', {}, h('b', {}, 'Export: '), 'menu → Export song as WAV → Share or Save to Files.')));
}

// Edge and Chrome offer to install E-Drop as an app; keep the offer for the menu's button.
// A computer is a mouse, not the layout: a laptop window under 1200 px has the phone layout.
const onComputer = () => app.desk || matchMedia('(pointer: fine)').matches;
const isLocal = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
let installOffer = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installOffer = e; });
window.addEventListener('appinstalled', () => { installOffer = null; });

function openInstall() {
  if (onComputer()) {
    openSheet('Install on this computer',
      installOffer ? h('button', { class: 'btn primary big', onclick: async () => {
        const offer = installOffer;
        installOffer = null;
        closeSheet();
        offer.prompt();
        try { await offer.userChoice; } catch { /* dismissed */ }
      } }, 'Install E-Drop') : null,
      h('ol', { class: 'help' },
        h('li', {}, h('b', {}, 'Microsoft Edge: '), 'click ', h('b', {}, 'App available'), ' at the right end of the address bar, or menu ··· → Apps → Install this site as an app.'),
        h('li', {}, h('b', {}, 'Google Chrome: '), 'click the install icon at the right end of the address bar, or menu ⋮ → Cast, save and share → Install.'),
        h('li', {}, 'E-Drop opens in its own window without the browser bars. Pin it to the taskbar.', isLocal() ? ' Installed from this local address it needs the local server running; install it from the HTTPS address to use it offline.' : ' It works offline.')),
      h('p', { class: 'hint' }, 'Press F11 in its window for full screen: the most room on a super-ultrawide. Menu → Display size makes everything bigger if you sit back from a big screen. Songs stay in this browser on this computer.'));
    return;
  }
  openSheet('Install on iPhone',
    h('ol', { class: 'help' },
      h('li', {}, 'Open E-Drop in Safari.'),
      h('li', {}, 'Tap the Share button, then ', h('b', {}, 'Add to Home Screen'), '.'),
      h('li', {}, 'Open it from the home screen. It runs full screen and works offline.')),
    h('p', { class: 'hint' }, 'Sound plays with the silent switch on. Headphones or a speaker are best for judging the low end.'));
}

const TARGETS = { mix: { name: 'As mixed', lufs: null }, stream: { name: 'Streaming −14', lufs: -14 }, loud: { name: 'Club loud −9', lufs: -9 } };

function exportSheet() {
  const M = app.project.master;
  openSheet('Export WAV',
    field('Loudness', seg(Object.entries(TARGETS).map(([k, v]) => [k, v.name]), M.exportTarget, (v) => { M.exportTarget = v; scheduleSave(); exportSheet(); })),
    h('p', { class: 'hint' }, `The whole song is rendered offline, then a lookahead limiter holds peaks under ${M.ceiling.toFixed(1)} dBFS. 16-bit, ${ctx.sampleRate} Hz stereo.`),
    h('div', { id: 'exportStatus', class: 'status' }),
    h('button', { class: 'btn primary big', id: 'exportGo', onclick: doExport }, 'Render the song'));
}

async function doExport() {
  const btn = $('#exportGo');
  const st = $('#exportStatus');
  btn.disabled = true;
  st.className = 'status busy';
  const t0 = performance.now();
  try {
    engine.stop();
    renderTransport();
    const buf = await engine.renderSong((m) => { st.textContent = m; });
    st.textContent = 'Mastering…';
    const chans = [buf.getChannelData(0).slice(), buf.getChannelData(1).slice()];
    const M = app.project.master;
    const res = await runDsp('master', { chans, sr: buf.sampleRate, targetLufs: TARGETS[M.exportTarget].lufs, ceilingDb: M.ceiling }, (v) => { st.textContent = `Mastering… ${Math.round(v * 100)}%`; }, chans.map((c) => c.buffer));
    app.lastExport = { ...res.stats, ms: performance.now() - t0, bytes: res.wav.byteLength };
    fileReady(new Blob([res.wav], { type: 'audio/wav' }), `${safeName(app.project.name)}.wav`, res.stats);
  } catch (e) {
    console.error(e);
    st.className = 'status';
    st.textContent = 'Export failed: ' + e.message;
    btn.disabled = false;
  }
}

const safeName = (n) => n.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, ' ') || 'E-Drop song';

// The share has to come from a fresh tap on iPhone, so the file waits on a button.
function fileReady(blob, name, stats) {
  const file = new File([blob], name, { type: 'audio/wav' });
  const canShare = navigator.canShare && navigator.canShare({ files: [file] });
  const mb = (blob.size / 1048576).toFixed(1);
  const mm = `${Math.floor(stats.seconds / 60)}:${String(Math.round(stats.seconds % 60)).padStart(2, '0')}`;
  openSheet('Your WAV is ready',
    h('p', { class: 'hint' }, `${name} · ${mm} · ${mb} MB`),
    h('div', { class: 'meter', style: { margin: '10px 0' } },
      h('div', { class: 'mcol' }, h('small', {}, 'Loudness'), h('b', {}, stats.lufs.toFixed(1)), h('small', {}, 'LUFS')),
      h('div', { class: 'mcol' }, h('small', {}, 'Peak'), h('b', {}, stats.peakDb.toFixed(1)), h('small', {}, 'dBFS')),
      h('div', { class: 'mcol' }, h('small', {}, 'Limited'), h('b', {}, stats.limitedPct.toFixed(0)), h('small', {}, '% of time'))),
    canShare ? h('button', { class: 'btn primary big', onclick: async () => {
      try { await navigator.share({ files: [file], title: name }); closeSheet(); } catch (e) { if (e.name !== 'AbortError') toast('Sharing failed: ' + e.message); }
    } }, 'Share or Save to Files') : null,
    h('button', { class: 'btn big', style: { marginTop: '8px' }, onclick: () => {
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: name });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } }, 'Download'),
    h('audio', { controls: true, src: URL.createObjectURL(blob), style: { width: '100%', marginTop: '12px' } }));
}

// ---------------------------------------------------------------------------------------
// audio unlock (iOS: only from a tap; 'playback' keeps sound on with the silent switch)
function setSession(type) { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch { /* Safari < 16.4 */ } }
function unlock() {
  setSession('playback');
  if (ctx.state !== 'running') {
    ctx.resume();
    const b = ctx.createBuffer(1, 1, ctx.sampleRate);
    const s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination); s.start();
  }
}

async function togglePlay() {
  unlock();
  if (engine.playing) engine.stop();
  else {
    renderTransport();
    const p = engine.play(engine.pos);
    renderTransport();
    await p;
  }
  renderTransport();
}

// back to the start of this section, or the previous one if we're right at it
function toSectionStart() {
  const st = sectionStarts(app.project);
  const pos = engine.position();
  let target = 0;
  for (const s of st) if (s < pos - 0.5) target = s;
  engine.seek(engine.loop ? engine.loop.from : target);
}

function wire() {
  $('#btnPlay').addEventListener('click', togglePlay);
  $('#btnHome').addEventListener('click', toSectionStart);
  $('#btnLoop').addEventListener('click', () => app.setLoop(!engine.loop));
  $('#menuBtn').addEventListener('click', openMenu);
  $('#bpmBtn').addEventListener('click', tempoSheet);
  $('#keyBtn').addEventListener('click', keySheet);
  $('#projName').addEventListener('click', () => {
    const n = prompt('Song name', app.project.name);
    if (n && n.trim()) { app.project.name = n.trim().slice(0, 40); app.changed(); }
  });
  $('.sheet-backdrop').addEventListener('click', closeSheet);
  $$('#tabs button').forEach((b) => b.addEventListener('click', () => app.goTab(b.dataset.tab)));
  engine.onEnded = () => renderTransport();
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && engine.playing) ctx.resume(); });
  // Keyboard: Space play/stop, 1/2/3 arrow step size, the rest in js/ui/desktop.js (? lists them).
  // Off while typing in a box or with Ctrl/Meta held. A focused slider isn't typing: Space still
  // plays, and its own arrow keys (which it handles first) don't move the playhead.
  document.addEventListener('keydown', (e) => {
    const el = e.target;
    const inText = (el.tagName === 'INPUT' && !/^(range|checkbox|radio|button)$/i.test(el.type)) || el.tagName === 'TEXTAREA' || el.isContentEditable;
    const typing = inText || el.tagName === 'SELECT';
    if (inText || e.defaultPrevented || !app.project) return;
    // undo keys work on a focused list box too (it was just used to pick a pattern)
    if (undoKey(e)) { e.preventDefault(); return; }
    if (typing || e.ctrlKey || e.metaKey) return;
    // a held Space would start and stop at the key-repeat rate
    if (e.code === 'Space' || e.key === ' ') { e.preventDefault(); if (!e.repeat) togglePlay(); return; }
    if (!e.altKey && /^(Digit|Numpad)[123]$/.test(e.code)) { setStepLevel(+e.code.slice(-1)); return; }
    if (deskKey(e, app, { home: toSectionStart })) e.preventDefault();
  });
  window.addEventListener('beforeunload', () => { saveNow(); });
  for (const b of $$('#tabs button')) b.querySelector('i').innerHTML = ICON[b.dataset.tab];
  $('#btnHome').innerHTML = ICON.home;
  $('#btnLoop').innerHTML = ICON.loop;
  $('#menuBtn').innerHTML = ICON.more;
  $('#coachBtn').innerHTML = ICON.coach;
  $('#stepSlot').append(stepLevelControl({ compact: true }));
}

// Backspace undoes the last change, Shift+Backspace (Ctrl+Y, Ctrl+Shift+Z) redoes, Ctrl+Z undoes,
// Esc resets the song to its original (js/undo.js). Not while a sheet is open: there Esc closes it.
// Holding Backspace keeps undoing, a step every 140 ms.
let undoKeyAt = 0;
function undoKey(e) {
  if (e.altKey || !app.history) return false;
  const k = e.key;
  if (sheetOpen()) {
    // this Esc closes the sheet (desktop.js deskKey); a quick second one is the same habit, not a reset
    if (k === 'Escape') app.escClosedAt = performance.now();
    return false;
  }
  const mod = e.ctrlKey || e.metaKey;
  let act = null;
  if (k === 'Backspace' && !mod) act = e.shiftKey ? 'redo' : 'undo';
  else if (mod && (k === 'z' || k === 'Z')) act = e.shiftKey ? 'redo' : 'undo';
  else if (mod && (k === 'y' || k === 'Y') && !e.shiftKey) act = 'redo';
  else if (k === 'Escape' && !mod && !e.shiftKey) act = 'reset';
  if (!act) return false;
  // mid-drag (a note held in the piano roll, a slider being dragged) the song stays put
  if (app.history.busy) return true;
  if (act === 'reset' && (e.repeat || performance.now() - (app.escClosedAt || 0) < 1000)) return true;
  if (e.repeat && performance.now() - undoKeyAt < 140) return true;
  undoKeyAt = performance.now();
  app.history[act]();
  return true;
}

// Animation: clock, playheads, meters.
let lastStep = -1;
function frame() {
  const p = app.project;
  if (p) {
    const pos = engine.position();
    const bar = Math.floor(pos);
    const beat = Math.floor((pos - bar) * 4);
    const st = sectionStarts(p);
    let si = 0;
    for (let i = 0; i < st.length; i++) if (pos >= st[i] - 1e-6) si = i;
    const sec = p.sections[si];
    $('#clockBar').textContent = `${bar + 1}.${beat + 1}`;
    $('#clockSec').textContent = sec ? sec.name : '';
    const secs = pos * 240 / p.bpm;
    $('#clockTime').textContent = `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
    // every panel on screen updates (on the phone that's the current tab)
    const ui = app.ui;
    if (visible(app, 'song')) {
      const lbl = ui.tlLabel ?? 64;
      const x = lbl + pos * ui.barPx;
      for (const el of document.querySelectorAll('#tab-song .tl-ph, #tab-song .tl-ph-cap')) el.style.left = x + 'px';
      const tl = $('#timeline');
      if (tl && engine.playing && ui.follow !== false) {
        if (x > tl.scrollLeft + tl.clientWidth - 40 || x < tl.scrollLeft + lbl) tl.scrollLeft = x - lbl - 16;
      }
    }
    const showNotes = visible(app, 'notes');
    const showDrums = visible(app, 'drums');
    if (showNotes || showDrums) {
      const t = p.tracks.find((x) => x.id === ui.track);
      const pat = t && curPattern(app, t);
      let step = -1;
      if (engine.playing && sec && pat && sec.cells[t.id] === pat.id) step = (((pos - st[si]) * 16) % (pat.bars * 16));
      if (showNotes && app.roll.el.isConnected) { if (step !== app.roll.playStep && (engine.playing || app.roll.playStep >= 0)) app.roll.draw(step); }
      if (showDrums) {
        // drum page rule: page k shows bars [k*span, (k+1)*span); data-step is the 16th within the page
        const span = Math.max(1, ui.drumSpan || 1);
        const page = step >= 0 ? Math.floor(step / (16 * span)) : -1;
        const cur = step >= 0 && page === ui.drumPage ? Math.floor(step) - page * span * 16 : -1;
        if (cur !== lastStep) {
          $$('#tab-drums .dgrid .step.cur').forEach((el) => el.classList.remove('cur'));
          if (cur >= 0) $$(`#tab-drums .dgrid .step[data-step="${cur}"]`).forEach((el) => el.classList.add('cur'));
          lastStep = cur;
        }
      }
    }
    const showMix = visible(app, 'mix');
    if (showMix || app.desk) {
      const L = engine.meter();
      app.meterNow = { m: L.m, s: L.s, peak: L.peak, gr: L.gr };
      if (app.desk) updateMeter(L);
      const el = showMix && $('#lufsM');
      if (el) {
        el.textContent = L.m > -60 ? L.m.toFixed(1) : '–';
        const set = (sel, v) => { const x = $(sel); if (x) x.textContent = v; };
        set('#lufsS', L.s > -60 ? L.s.toFixed(1) : '–');
        set('#peakDb', L.peak > 1e-4 ? (20 * Math.log10(L.peak)).toFixed(1) : '–');
        set('#grDb', L.gr < -0.05 ? L.gr.toFixed(1) : '0');
        const bar = $('#lufsBar');
        if (bar) bar.style.width = `${Math.max(0, Math.min(100, ((L.s + 40) / 40) * 100))}%`;
      }
    }
    if (engine.playing !== frame.was) { frame.was = engine.playing; renderTransport(); app.emit(engine.playing ? 'play' : 'stop'); }
  }
  requestAnimationFrame(frame);
}

async function boot() {
  wire();
  // #tab=sound opens a tab directly (handy for links and screenshots)
  const hashTab = /(?:^|[#&])tab=(song|notes|drums|sound|mix)/.exec(location.hash);
  if (hashTab) app.ui.tab = hashTab[1];
  initDesk(app, { icons: ICON });
  app.on('render', () => { lastStep = -2; }); // the drum grid was rebuilt: re-mark the playing step
  initUndo(app, { swap: swapProject });
  initCoach(app);
  store.askPersistent();
  let ok = false;
  try { if (settings.lastProject) ok = await loadProject(settings.lastProject); } catch (e) { console.warn(e); }
  if (!ok) {
    const p = demoProject();
    try { await store.saveProject(JSON.parse(JSON.stringify(p))); } catch { /* storage blocked */ }
    openProject(p);
  }
  requestAnimationFrame(frame);
  if ('serviceWorker' in navigator && !isLocal() && location.protocol === 'https:') {
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded && !engine.playing) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => { /* offline mode is optional */ });
  }
}

boot();
