// Desktop layout, built for a 47-49" super-ultrawide (5120×1440 or 3840×1080) and fine down to a
// 1280 px laptop. At 1200 CSS px and wider the body gets class "desk": header and transport merge
// into one top bar, the tab bar goes, and every panel is on screen at once, each with a title bar
// and its own scroll. At 2200 px and wider ("ultra") Song runs across the top and the editor
// (Notes or Drums), Sound and Mix sit side by side below it; in between, Sound and Mix share one
// switchable slot. The coach docks as a column on the right (css/desktop.css).
// Also here: the song/editor split handle, the display size (CSS zoom on the root), the
// keyboard shortcuts and the top-bar loudness meter. None of it applies below 1200 px, so the
// phone layout is untouched.
import { h, $, $$, openSheet, closeSheet, sheetOpen, stepLevelControl, toast } from './dom.js';
import { renderSong } from './song.js';
import { renderNotes, renderDrums, MELODIC } from './screens.js';
import { renderSound } from './sound.js';
import { renderMix } from './mix.js';
import { sectionStarts, songBars } from '../audio/engine.js';

export const DESK_MIN = 1200;
export const ULTRA_MIN = 2200;
const ZOOMS = [['auto', 'Auto'], ['1', '100%'], ['1.25', '125%'], ['1.5', '150%'], ['1.75', '175%']];
const SONG_H = 0.42; // default share of the height for the Song panel
const PREFS = 'e-drop-desk';

const prefs = (() => {
  const d = { zoom: 'auto', songH: SONG_H };
  try { return Object.assign(d, JSON.parse(localStorage.getItem(PREFS) || '{}')); } catch { return d; }
})();
const savePrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch { /* private mode */ } };

// Auto display size. A super-ultrawide at 100 % Windows scaling (5120×1440, or 3840×2160 on a
// 4K screen) gives the browser so many pixels that text ends up the size it is on a 27" screen
// while you sit further back to take in the width: scale it up. At 125-150 % Windows scaling
// the browser already sees 2560-4096 px, which is right as it is.
function autoZoom() {
  if (innerWidth < 3800) return 1;
  if (innerHeight >= 1900) return 1.5;
  if (innerHeight >= 1250) return 1.25;
  return 1;
}
export const zoomLevel = () => (prefs.zoom === 'auto' ? autoZoom() : +prefs.zoom || 1);
const layoutWidth = () => Math.round(innerWidth / zoomLevel());
const layoutHeight = () => Math.round(innerHeight / zoomLevel());
export function deskMode() {
  const w = layoutWidth();
  return w >= ULTRA_MIN ? 'ultra' : w >= DESK_MIN ? 'desk' : 'phone';
}

// The root is zoomed with CSS zoom; viewport units don't follow it, so --zoom lets the CSS
// divide 100dvh by it.
function applyZoom() {
  const z = zoomLevel();
  const root = document.documentElement;
  root.style.zoom = z === 1 ? '' : String(z);
  root.style.setProperty('--zoom', String(z));
}

const st = { lastSel: undefined, mode: null, flashTimer: null };
let bars = null;

// --- mode ------------------------------------------------------------------------------------
function setMode(app) {
  const m = deskMode();
  const changed = m !== st.mode;
  st.mode = m;
  app.desk = m !== 'phone';
  app.ultra = m === 'ultra';
  const b = document.body;
  b.classList.toggle('desk', app.desk);
  b.classList.toggle('ultra', app.ultra);
  if (changed) st.lastSel = undefined;
  return changed;
}

// Which screens are on screen right now (phone: the current tab only).
export function visible(app, name) {
  const ui = app.ui;
  if (!app.desk) return ui.tab === name;
  if (name === 'song') return true;
  if (name === 'notes' || name === 'drums') return ui.editor === name;
  return app.ultra || ui.side === name;
}

const panelOf = (tab) => $(`#panel-${tab === 'notes' || tab === 'drums' ? 'editor' : tab}`);

// --- rendering every visible panel -------------------------------------------------------------
// renderNotes, renderDrums and renderSound each pick a track and write app.ui.track when the
// selected one doesn't suit them. The editor shows the selected track (a drum track opens Drums,
// any other track Notes); Sound shows the selected synth, or the last one picked while the
// editor is on the drums; app.ui.track stays what the editor shows.
export function renderDesk(app) {
  const p = app.project;
  const ui = app.ui;
  // first render on a computer (or after the phone layout): the current tab picks the editor
  if (st.lastSel === undefined && ui.tab !== 'song') {
    show(app, ui.tab);
    if (ui.tab === 'notes' || ui.tab === 'drums') st.lastSel = ui.track;
  }
  const sel = p.tracks.find((t) => t.id === ui.track);
  if (sel && sel.id !== st.lastSel) ui.editor = sel.role === 'drums' ? 'drums' : 'notes';
  if (ui.editor !== 'drums') ui.editor = 'notes';
  if (ui.side !== 'mix') ui.side = 'sound';
  if (ui.tab === 'notes' || ui.tab === 'drums') ui.tab = ui.editor;
  layout(app);
  const keep = $$('#main .tab.active').map((s) => [s, s.scrollTop]);
  renderSong(app, $('#tab-song'));
  if (ui.editor === 'drums') renderDrums(app, $('#tab-drums'));
  else renderNotes(app, $('#tab-notes'));
  const chosen = ui.track;
  const cur = p.tracks.find((t) => t.id === chosen);
  st.lastSel = chosen;
  remember(ui, cur);
  let mel = null;
  if (visible(app, 'sound')) {
    mel = (cur && MELODIC.has(cur.role) && cur) || p.tracks.find((t) => t.id === ui.lastMel && MELODIC.has(t.role)) || null;
    if (mel) ui.track = mel.id;
    renderSound(app, $('#tab-sound'));
    mel = p.tracks.find((t) => t.id === ui.track) || mel;
    ui.track = chosen;
  }
  if (visible(app, 'mix')) { renderMix(app, $('#tab-mix')); ui.track = chosen; }
  for (const [s, y] of keep) if (s.isConnected && s.classList.contains('active')) s.scrollTop = y;
  if (bars) {
    bars.editorWho.replaceChildren(...who(ui.editor === 'drums' && cur && cur.role !== 'drums' ? null : cur));
    bars.soundWho.replaceChildren(...who(mel && MELODIC.has(mel.role) ? mel : null));
  }
}

function remember(ui, t) {
  if (!t) return;
  if (MELODIC.has(t.role)) ui.lastMel = t.id;
  if (t.role === 'drums') ui.lastDrum = t.id;
  else ui.lastNote = t.id;
}

const who = (t) => (t ? [h('span', { class: 'dot', style: { background: t.color } }), t.name] : []);

// body data attributes drive the CSS; .active marks every section that is on screen
function layout(app) {
  const ui = app.ui;
  const b = document.body;
  b.dataset.editor = ui.editor;
  b.dataset.side = ui.side;
  for (const s of $$('#main .tab')) s.classList.toggle('active', visible(app, s.id.slice(4)));
  for (const pn of $$('#main .panel')) pn.classList.toggle('cur', pn === panelOf(ui.tab));
  if (bars) {
    for (const btn of bars.editorSeg) { const on = btn.dataset.v === ui.editor; btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', String(on)); }
    for (const btn of bars.sideSegs) { const on = btn.dataset.v === ui.side; btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', String(on)); }
  }
  $('#main').classList.remove('fill');
}

// app.goTab on a computer: every panel is already up, so show the one asked for (switch the
// editor or the shared Sound / Mix slot), bring it into view and flash it.
export function deskGoTab(app, name) {
  show(app, name);
  app.ui.tab = name;
  // Notes / Drums chose the editor here: don't let the track override it. For the other panels a
  // track picked just before (the coach selects Sub, then shows Sound) still moves the editor to
  // it, so the Sound panel can show it.
  if (name === 'notes' || name === 'drums') st.lastSel = app.ui.track;
  app.render();
  flash(panelOf(name));
}

// Point the editor (selecting a track that suits it) or the shared side slot at a screen.
function show(app, name) {
  const ui = app.ui;
  const p = app.project;
  const sel = p.tracks.find((t) => t.id === ui.track);
  if (name === 'drums') {
    ui.editor = 'drums';
    if (!sel || sel.role !== 'drums') {
      const d = p.tracks.find((t) => t.id === ui.lastDrum && t.role === 'drums') || p.tracks.find((t) => t.role === 'drums');
      if (d) ui.track = d.id;
    }
  } else if (name === 'notes') {
    ui.editor = 'notes';
    if (!sel || sel.role === 'drums') {
      const n = p.tracks.find((t) => t.id === ui.lastNote && t.role !== 'drums') || p.tracks.find((t) => t.id === ui.lastMel) || p.tracks.find((t) => MELODIC.has(t.role));
      if (n) ui.track = n.id;
    }
  } else if (name === 'sound' || name === 'mix') ui.side = name;
}

function flash(panel) {
  if (!panel) return;
  panel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  for (const x of $$('.panel.panel-focus')) x.classList.remove('panel-focus');
  void panel.offsetWidth; // restart the animation
  panel.classList.add('panel-focus');
  clearTimeout(st.flashTimer);
  st.flashTimer = setTimeout(() => panel.classList.remove('panel-focus'), 1000);
}

// --- top bar and panel title bars --------------------------------------------------------------
function buildBars(app, icons) {
  const ico = (name) => h('i', { class: 'panel-ico', html: icons[name] || '' });
  const segBtn = (v, label, key, onPick) => h('button', { 'data-v': v, title: `${label} (${key})`, onclick: () => onPick(v) }, label, h('kbd', {}, key));
  const editorSeg = [segBtn('notes', 'Notes', 'N', (v) => app.goTab(v)), segBtn('drums', 'Drums', 'D', (v) => app.goTab(v))];
  const sideSeg = () => [segBtn('sound', 'Sound', 'S', (v) => app.goTab(v)), segBtn('mix', 'Mix', 'M', (v) => app.goTab(v))];
  const sound = sideSeg();
  const mix = sideSeg();
  const editorWho = h('span', { class: 'panel-who' });
  const soundWho = h('span', { class: 'panel-who' });
  const fill = (id, ...kids) => $(`#panel-${id} > .panel-bar`).replaceChildren(...kids);
  fill('song', ico('song'), h('b', { class: 'panel-name' }, 'Song'), h('div', { class: 'panel-tools' }));
  fill('editor', ico('notes'), h('div', { class: 'seg mini panel-seg', role: 'group', 'aria-label': 'Editor' }, editorSeg), editorWho);
  fill('sound', ico('sound'), h('b', { class: 'panel-name' }, 'Sound'), h('div', { class: 'seg mini panel-seg side-seg', role: 'group', 'aria-label': 'Side panel' }, sound), soundWho);
  fill('mix', ico('mix'), h('b', { class: 'panel-name' }, 'Mix'), h('div', { class: 'seg mini panel-seg side-seg', role: 'group', 'aria-label': 'Side panel' }, mix));
  bars = { editorSeg, sideSegs: [...sound, ...mix], editorWho, soundWho };
}

let meterEls = null;
function buildTop(app, icons) {
  const val = (label) => { const b = h('b', {}, '–'); return [h('div', { class: 'dm-read' }, h('small', {}, label), b), b]; };
  const [lufsEl, lufs] = val('LUFS');
  const [peakEl, peak] = val('Peak');
  const fill = h('div', { class: 'dm-fill' });
  const pct = (db) => `${((db + 40) / 40) * 100}%`;
  const meterBar = h('div', { class: 'dm-bar' }, fill,
    h('i', { class: 'soft', style: { left: pct(-14) }, title: 'Streaming, −14 LUFS' }), h('i', { style: { left: pct(-9) }, title: 'Club loud, −9 LUFS' }));
  const m = $('#deskMeter');
  m.replaceChildren(lufsEl, meterBar, peakEl);
  m.title = 'Master loudness: short-term LUFS and peak. Click for the Mix panel.';
  m.addEventListener('click', () => app.goTab('mix'));
  meterEls = { lufs, peak, fill, last: '' };
  $('#deskRight').replaceChildren(
    stepLevelControl(),
    h('button', { class: 'icon-btn keys-btn', 'aria-label': 'Keyboard shortcuts', title: 'Keyboard shortcuts (?)', html: icons.keys, onclick: () => shortcutsSheet() }));
}

// Called every frame on a computer with the latest engine.meter() reading.
export function updateMeter(L) {
  if (!meterEls) return;
  const s = L.s > -60 ? L.s.toFixed(1) : '–';
  const pk = L.peak > 1e-4 ? (20 * Math.log10(L.peak)).toFixed(1) : '–';
  const key = s + '|' + pk;
  if (key === meterEls.last) return;
  meterEls.last = key;
  meterEls.lufs.textContent = s;
  meterEls.peak.textContent = pk;
  meterEls.peak.classList.toggle('hot', L.peak > 0.97);
  meterEls.fill.style.width = `${Math.max(0, Math.min(100, ((L.s + 40) / 40) * 100))}%`;
}

// --- the split between the Song panel and the panels below it ----------------------------------
function setSongH(f, save) {
  f = Math.max(0.16, Math.min(0.8, f));
  prefs.songH = f;
  $('#main').style.setProperty('--song-h', `${(f * 100).toFixed(2)}%`);
  if (save) savePrefs();
}

function wireSplit() {
  const split = $('#split');
  const main = $('#main');
  setSongH(prefs.songH);
  let drag = null;
  split.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    e.preventDefault();
    try { split.setPointerCapture(e.pointerId); } catch { /* fine */ }
    const r = main.getBoundingClientRect();
    const z = r.height / main.offsetHeight || 1;
    const cs = getComputedStyle(main);
    const top = r.top + parseFloat(cs.paddingTop) * z;
    const inner = (main.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) * z;
    drag = { top, inner };
    split.classList.add('drag');
  });
  split.addEventListener('pointermove', (e) => { if (drag) setSongH((e.clientY - drag.top - 5) / drag.inner); });
  const end = () => { if (!drag) return; drag = null; split.classList.remove('drag'); setSongH(prefs.songH, true); };
  split.addEventListener('pointerup', end);
  split.addEventListener('pointercancel', end);
  split.addEventListener('dblclick', () => setSongH(SONG_H, true));
  split.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowUp' ? -0.03 : e.key === 'ArrowDown' ? 0.03 : 0;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    setSongH(prefs.songH + d, true);
  });
}

// --- display size --------------------------------------------------------------------------------
export function displaySheet(app) {
  const z = zoomLevel();
  const pick = (v) => {
    prefs.zoom = v;
    savePrefs();
    applyZoom();
    setMode(app);
    app.render();
    displaySheet(app);
  };
  const mode = deskMode();
  openSheet('Display size',
    h('div', { class: 'seg wrap', role: 'group' }, ZOOMS.map(([v, label]) => h('button', {
      class: String(prefs.zoom) === v ? 'on' : '', 'aria-pressed': String(String(prefs.zoom) === v), onclick: () => pick(v),
    }, v === 'auto' ? `Auto (${Math.round(autoZoom() * 100)}%)` : label))),
    h('p', { class: 'hint' }, `Makes everything bigger for a big screen seen from a distance. Now ${Math.round(z * 100)}%: E-Drop has ${layoutWidth()} × ${layoutHeight()} px to lay out, so it shows the ${mode === 'ultra' ? 'ultrawide layout (Song on top; editor, Sound and Mix side by side)' : mode === 'desk' ? 'desktop layout (Song on top; the editor and Sound or Mix below)' : 'phone layout'}.`),
    h('p', { class: 'hint' }, 'Auto picks 125% on a 5120×1440 super-ultrawide at 100% Windows scaling and 150% on a 4K screen at 100%. Ctrl + and Ctrl − in the browser work too.'));
}

// --- keyboard ------------------------------------------------------------------------------------
// keys: each entry is a key cap, '+' joins a modifier, '/' separates alternatives
const SHORTCUTS = [
  [['Space'], 'Play / stop'],
  [['L'], 'Loop the selected section on / off'],
  [['Home'], 'Back to the start of the section'],
  [['←', '/', '→'], 'Playhead one bar back / forward'],
  [['Shift', '+', '←', '/', '→'], 'Previous / next section'],
  [['F'], 'Fit the whole song (and the pattern) to the width'],
  [['N', '/', 'D'], 'Editor: Notes / Drums'],
  [['S', '/', 'M'], 'Show Sound / Mix'],
  [['C'], 'Open or close the coach'],
  [['1', '/', '2', '/', '3'], 'Arrow step size: small, medium, large'],
  [['Shift', '+', 'click ◀ ▶'], 'One large step (Alt-click: one small step)'],
  [['Ctrl', '+', 'wheel'], 'Zoom the piano roll or the song timeline'],
  [['Shift', '+', 'wheel'], 'Scroll sideways'],
  [['Alt', '+', 'wheel'], 'Piano roll row height'],
  [['Esc'], 'Close a sheet'],
  [['?'], 'This list'],
];

export function shortcutsSheet() {
  openSheet('Keyboard shortcuts',
    h('div', { class: 'keys-list' }, SHORTCUTS.map(([keys, what]) => h('div', { class: 'keys-row' },
      h('span', { class: 'keys-k' }, keys.map((x) => (x === '+' || x === '/' ? h('span', {}, x) : h('kbd', {}, x)))), h('span', {}, what)))),
    h('p', { class: 'hint' }, 'Shortcuts are off while you type in a box or hold Ctrl. Arrow keys on a focused slider move it by the step size.'));
}

// Returns true when the key was handled. Space and 1/2/3 are handled in main.js.
export function deskKey(e, app, { home }) {
  const k = e.key;
  if (k === 'Escape') { if (sheetOpen()) { closeSheet(); return true; } return false; }
  if (k === '?') { shortcutsSheet(); return true; }
  if (sheetOpen() || e.altKey) return false;
  // a held key repeats: the arrows may walk the playhead, the panel / loop / coach keys act once
  if (e.repeat && /^[lfndsmc]$/i.test(k)) return true;
  const eng = app.engine;
  const p = app.project;
  const seekTo = (bar) => { eng.seek(Math.max(0, Math.min(songBars(p), bar))); };
  switch (k) {
    case 'l': case 'L': app.setLoop(!eng.loop); return true;
    case 'Home': home(); return true;
    case 'ArrowRight': case 'ArrowLeft': {
      const pos = eng.position();
      const dir = k === 'ArrowRight' ? 1 : -1;
      if (e.shiftKey) {
        const starts = sectionStarts(p);
        const next = dir > 0 ? starts.find((s) => s > pos + 0.01) : [...starts].reverse().find((s) => s < pos - 0.5);
        seekTo(next ?? (dir > 0 ? songBars(p) : 0));
      } else seekTo(dir > 0 ? Math.floor(pos + 1e-6) + 1 : Math.ceil(pos - 1e-6) - 1);
      return true;
    }
    case 'f': case 'F':
      app.ui.tlFit = true;
      if (app.roll) app.roll.fitNow();
      app.render();
      toast('Fit to the width');
      return true;
    case 'n': case 'N': app.goTab('notes'); return true;
    case 'd': case 'D': app.goTab('drums'); return true;
    case 's': case 'S': app.goTab('sound'); return true;
    case 'm': case 'M': app.goTab('mix'); return true;
    case 'c': case 'C': { const b = $('#coachBtn'); if (b) b.click(); return true; }
    default: return false;
  }
}

// --- setup ---------------------------------------------------------------------------------------
export function initDesk(app, { icons }) {
  const ui = app.ui;
  ui.editor = ui.editor || 'notes';
  ui.side = ui.side || 'sound';
  if (ui.tlFit === undefined) ui.tlFit = true;
  applyZoom();
  setMode(app);
  buildBars(app, icons);
  buildTop(app, icons);
  wireSplit();

  // window resized (or moved to another screen): auto zoom and the mode may change
  let raf = 0;
  addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      applyZoom();
      if (setMode(app) && app.project) app.render();
    });
  });

  // Clicking in a panel makes it the current one (its title lights up; app.ui.tab follows).
  $('#main').addEventListener('pointerdown', (e) => {
    if (!app.desk) return;
    const pn = e.target.closest('.panel');
    if (!pn) return;
    const name = pn.dataset.panel === 'editor' ? ui.editor : pn.dataset.panel;
    if (name === ui.tab) return;
    ui.tab = name;
    for (const x of $$('#main .panel')) x.classList.toggle('cur', x === pn);
    app.emit('tab', name);
  }, true);

  // Re-fit the song when its panel changes width (coach opened, window resized). Deferred to the
  // next frame: re-rendering inside a ResizeObserver callback would loop. The drum grid re-lays
  // itself when its panel's width changes the bars it fits (watchDrumWidth in screens.js).
  if (typeof ResizeObserver !== 'undefined') {
    let lastW;
    let songRaf = 0;
    const ro = new ResizeObserver((entries) => {
      if (!app.desk || !app.project) return;
      for (const en of entries) {
        const w = Math.round(en.contentRect.width);
        const was = lastW;
        lastW = w;
        if (!w || was === undefined || was === w || ui.tlFit === false) continue;
        cancelAnimationFrame(songRaf);
        songRaf = requestAnimationFrame(() => renderSong(app, en.target));
      }
    });
    ro.observe($('#tab-song'));
  }
}
