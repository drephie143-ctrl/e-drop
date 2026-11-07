// E-Drop: festival EDM production studio for iPhone and desktop browsers.
import { Engine, sectionStarts, songBars } from './audio/engine.js';
import { ensure, ensureAll, renderState, stepSec } from './audio/render.js';
import { playFx } from './audio/fx.js';
import { NOTE_NAMES, SCALES, mtof } from './music/theory.js';
import { templateProject, normalize } from './music/project.js';
import { demoProject } from './music/demo.js';
import { PianoRoll } from './ui/roll.js';
import { renderSong } from './ui/song.js';
import { renderNotes, renderDrums, renderSound, renderMix, curPattern } from './ui/screens.js';
import { h, $, $$, openSheet, closeSheet, toast, seg, field, chip, slider } from './ui/dom.js';
import { runDsp } from './dsp/client.js';
import * as store from './store.js';

export const APP_VERSION = 1;
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
  more: '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="18.5" cy="12" r="1.8" fill="currentColor"/></svg>',
  song: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="7" height="4" rx="1" fill="currentColor"/><rect x="11" y="5" width="10" height="4" rx="1" fill="currentColor" opacity=".5"/><rect x="3" y="11" width="11" height="4" rx="1" fill="currentColor" opacity=".5"/><rect x="15" y="11" width="6" height="4" rx="1" fill="currentColor"/><path d="M3 19.5c4-3 7 1 9-1.5s5-2 9 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  notes: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="6" y="7" width="5" height="2.4" rx="1" fill="currentColor"/><rect x="10" y="11" width="7" height="2.4" rx="1" fill="currentColor"/><rect x="7" y="15" width="4" height="2.4" rx="1" fill="currentColor"/></svg>',
  drums: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.8" fill="currentColor"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.8" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.8" fill="currentColor"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M3 12h2l2-6 3 12 3-15 3 15 2-6h3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  mix: '<svg viewBox="0 0 24 24"><path d="M6 4v16M12 4v16M18 4v16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="3.5" y="13" width="5" height="3" rx="1" fill="currentColor"/><rect x="9.5" y="7" width="5" height="3" rx="1" fill="currentColor"/><rect x="15.5" y="11" width="5" height="3" rx="1" fill="currentColor"/></svg>',
};

// ---------------------------------------------------------------------------------------
// app state shared with the screens
const app = {
  engine,
  project: null,
  ui: {
    tab: 'song', track: null, pat: {}, section: 0, grid: 1, noteLen: null, ghosts: true, barPx: 9, tlScroll: 0, drumPage: 0,
    chord: { prog: 'anthem', voicing: 'triad', barsPer: 1, octave: 0, gen: null }, snare: { bars: 8, voice: 'snare', kick: true }, openStrip: null,
  },
  render,
  goTab(name) { app.ui.tab = name; render(); $('#main').scrollTop = 0; },
  changed() { scheduleSave(); render(); },
  patternEdited(t, pat, rerenderUi) { scheduleSave(); queueRender(t, pat); if (rerenderUi) render(); },
  notesEdited(t, pat) { scheduleSave(); queueRender(t, pat); app.roll.draw(); },
  soundChanged(t) {
    scheduleSave();
    clearTimeout(soundTimers.get(t.id));
    soundTimers.set(t.id, setTimeout(() => { for (const pat of t.patterns) ensure(app.project, t, pat, engine.sr); }, 180));
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
};
app.roll = new PianoRoll(app);
window.__edrop = app;

const soundTimers = new Map();
const renderTimers = new Map();
function queueRender(t, pat) {
  clearTimeout(renderTimers.get(pat.id));
  renderTimers.set(pat.id, setTimeout(() => ensure(app.project, t, pat, engine.sr), 120));
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
  $$('.tab').forEach((s) => s.classList.toggle('active', s.id === `tab-${tab}`));
  const root = $(`#tab-${tab}`);
  $('#main').classList.toggle('fill', tab === 'notes');
  if (tab === 'song') renderSong(app, root);
  else if (tab === 'notes') renderNotes(app, root);
  else if (tab === 'drums') renderDrums(app, root);
  else if (tab === 'sound') renderSound(app, root);
  else if (tab === 'mix') renderMix(app, root);
  renderHeader();
  renderTransport();
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
  await ensureAll(app.project, engine.sr, { untilBar: pos + 12 });
  if (was) engine.play(pos);
  render();
}

function logoTile() { return h('span', { class: 'logo-tile', html: $('.top .logo-tile').innerHTML }); }

function openMenu() {
  openSheet(null,
    h('button', { class: 'mi', onclick: exportSheet }, 'Export song as WAV', h('small', {}, 'Mastered, then Share or Save to Files')),
    h('button', { class: 'mi', onclick: openProjects }, 'Songs', h('small', {}, 'Open, copy or delete saved songs')),
    h('button', { class: 'mi', onclick: () => newSong(false) }, 'New song', h('small', {}, 'Festival template: sections, drums, FX and build sweep ready; you write the notes')),
    h('button', { class: 'mi', onclick: () => newSong(true) }, 'Load the demo song', h('small', {}, 'A full intro → build → drop → breakdown → build → drop')),
    h('button', { class: 'mi', onclick: openHelp }, 'How to make a track'),
    h('button', { class: 'mi', onclick: openInstall }, 'Install on iPhone'),
    h('div', { class: 'about' }, logoTile(), h('div', {}, h('b', {}, 'E-Drop'), h('br'), `by E-Estimating LLC · version ${APP_VERSION}. Songs stay on this device.`)));
}

async function newSong(demo) {
  closeSheet();
  await saveNow();
  if (demo) {
    const old = await store.getProject('demo').catch(() => null);
    if (old && old.edited && !confirm('Reload the demo? Changes you made to it will be replaced.')) return;
  }
  const p = demo ? demoProject() : templateProject('New song');
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

function openInstall() {
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

function wire() {
  $('#btnPlay').addEventListener('click', togglePlay);
  $('#btnHome').addEventListener('click', () => {
    const p = app.project;
    const st = sectionStarts(p);
    const pos = engine.position();
    // back to the start of this section, or the previous one if we're right at it
    let target = 0;
    for (const s of st) if (s < pos - 0.5) target = s;
    engine.seek(engine.loop ? engine.loop.from : target);
  });
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
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !/input|select|textarea/i.test(e.target.tagName)) { e.preventDefault(); togglePlay(); }
  });
  window.addEventListener('beforeunload', () => { saveNow(); });
  for (const b of $$('#tabs button')) b.querySelector('i').innerHTML = ICON[b.dataset.tab];
  $('#btnHome').innerHTML = ICON.home;
  $('#btnLoop').innerHTML = ICON.loop;
  $('#menuBtn').innerHTML = ICON.more;
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
    const tab = app.ui.tab;
    if (tab === 'song') {
      const ph = $('.tl-ph');
      if (ph) ph.style.left = 64 + pos * app.ui.barPx + 'px';
      const tl = $('#timeline');
      if (tl && engine.playing && app.ui.follow !== false) {
        const x = 64 + pos * app.ui.barPx;
        if (x > tl.scrollLeft + tl.clientWidth - 40 || x < tl.scrollLeft + 64) tl.scrollLeft = x - 80;
      }
    } else if (tab === 'notes' || tab === 'drums') {
      const t = p.tracks.find((x) => x.id === app.ui.track);
      const pat = t && curPattern(app, t);
      let step = -1;
      if (engine.playing && sec && pat && sec.cells[t.id] === pat.id) step = (((pos - st[si]) * 16) % (pat.bars * 16));
      if (tab === 'notes') { if (step !== app.roll.playStep && (engine.playing || app.roll.playStep >= 0)) app.roll.draw(step); }
      else {
        const cur = step >= 0 && Math.floor(step / 16) === app.ui.drumPage ? Math.floor(step) % 16 : -1;
        if (cur !== lastStep) {
          $$('.dgrid .step.cur').forEach((el) => el.classList.remove('cur'));
          if (cur >= 0) $$(`.dgrid .step[data-step="${cur}"]`).forEach((el) => el.classList.add('cur'));
          lastStep = cur;
        }
      }
    } else if (tab === 'mix') {
      const L = engine.meter();
      const el = $('#lufsM');
      if (el) {
        el.textContent = L.m > -60 ? L.m.toFixed(1) : '–';
        $('#lufsS').textContent = L.s > -60 ? L.s.toFixed(1) : '–';
        $('#peakDb').textContent = L.peak > 1e-4 ? (20 * Math.log10(L.peak)).toFixed(1) : '–';
        $('#grDb').textContent = L.gr < -0.05 ? L.gr.toFixed(1) : '0';
        $('#lufsBar').style.width = `${Math.max(0, Math.min(100, ((L.s + 40) / 40) * 100))}%`;
      }
    }
    if (engine.playing !== frame.was) { frame.was = engine.playing; renderTransport(); }
  }
  requestAnimationFrame(frame);
}

async function boot() {
  wire();
  store.askPersistent();
  let ok = false;
  try { if (settings.lastProject) ok = await loadProject(settings.lastProject); } catch (e) { console.warn(e); }
  if (!ok) {
    const p = demoProject();
    try { await store.saveProject(JSON.parse(JSON.stringify(p))); } catch { /* storage blocked */ }
    openProject(p);
  }
  requestAnimationFrame(frame);
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if ('serviceWorker' in navigator && !local && location.protocol === 'https:') {
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded && !engine.playing) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => { /* offline mode is optional */ });
  }
}

boot();
