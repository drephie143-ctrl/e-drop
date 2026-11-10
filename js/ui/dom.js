// Small DOM helpers shared by every screen.
export const $ = (q, el = document) => el.querySelector(q);
export const $$ = (q, el = document) => [...el.querySelectorAll(q)];

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') value = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat(3)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  if (value !== undefined) el.value = value;
  return el;
}

// --- Step size for the ◀ ▶ arrows on every slider: 1 small, 2 medium, 3 large -------------
export const STEP_LEVELS = { 1: 'Small', 2: 'Medium', 3: 'Large' };
let stepLevel = (() => { try { return Math.min(3, Math.max(1, +localStorage.getItem('e-drop-step') || 2)); } catch { return 2; } })();
export const getStepLevel = () => stepLevel;
export function setStepLevel(n) {
  n = Math.min(3, Math.max(1, Math.round(+n) || 2));
  if (n === stepLevel) return;
  stepLevel = n;
  try { localStorage.setItem('e-drop-step', String(n)); } catch { /* private mode */ }
  document.dispatchEvent(new CustomEvent('edrop-steplevel', { detail: n }));
}

// A compact button that cycles 1 → 2 → 3 (phone transport), or a full 3-way switch (desktop).
export function stepLevelControl({ compact = false } = {}) {
  let el;
  const sync = () => {
    if (!el.isConnected && el.dataset.mounted) { document.removeEventListener('edrop-steplevel', sync); return; }
    if (compact) {
      el.replaceChildren(h('small', {}, 'Step'), h('b', {}, String(stepLevel)));
      el.title = `Arrow step: ${stepLevel} · ${STEP_LEVELS[stepLevel]} (keys 1, 2, 3)`;
      el.setAttribute('aria-label', `Arrow step size ${STEP_LEVELS[stepLevel]}. Tap to change.`);
    } else {
      for (const b of el.querySelectorAll('button')) { const on = +b.dataset.level === stepLevel; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
    }
  };
  if (compact) el = h('button', { class: 'step-pill', onclick: () => setStepLevel(stepLevel % 3 + 1) });
  else {
    el = h('div', { class: 'seg mini step-seg', role: 'group', 'aria-label': 'Arrow step size', title: 'Step size for the ◀ ▶ arrows (keys 1, 2, 3)' },
      h('span', { class: 'step-seg-lbl' }, 'Step'),
      Object.entries(STEP_LEVELS).map(([n, name]) => h('button', { 'data-level': n, onclick: () => setStepLevel(+n) }, `${n} ${name}`)));
  }
  requestAnimationFrame(() => { el.dataset.mounted = '1'; });
  document.addEventListener('edrop-steplevel', sync);
  sync();
  return el;
}

// 1-2-5 "nice" numbers, so the arrows move by 1%, 5%, 20% or 0.1, 0.5, 2 dB and the like.
function nice(x) {
  if (!(x > 0)) return 0;
  const e = Math.floor(Math.log10(x));
  const b = x / 10 ** e;
  return (b < 1.5 ? 1 : b < 3.5 ? 2 : b < 7.5 ? 5 : 10) * 10 ** e;
}
const FRAC = [1 / 200, 1 / 20, 1 / 5];
// The three arrow increments for a slider: small, medium, large. Each is a whole number of steps.
export function increments(min, max, step) {
  const range = max - min;
  const snap = (x) => Math.max(step, Math.round(x / step) * step);
  const [s, m, l] = FRAC.map((f) => snap(nice(range * f)));
  return [s, Math.max(s, m), Math.max(s, m, l)];
}
const decimals = (step) => { const t = String(step); return t.includes('e-') ? +t.split('e-')[1] : (t.split('.')[1] || '').length; };

// Sliders whose onChange is still waiting (a keyboard nudge commits 260 ms later). Undo runs them
// first (js/undo.js), so a commit can't fire after the song was swapped and re-render the old track.
const pendingCommits = new Set();
export function flushSliders() { for (const c of [...pendingCommits]) c(); }

// A labelled range with ◀ ▶ arrows. The arrows move by the global step level (1, 2, 3);
// Shift-click moves by the large step and Alt-click by the small one. Hold an arrow to repeat.
// Arrow keys on the focused slider use the same steps. onInput runs on every change; onChange
// (the expensive commit, e.g. re-rendering audio) runs once the arrows or the drag stop.
// The returned element has setValue(v) to update it from outside (a graph) without callbacks.
export function slider(label, value, min, max, step, onInput, fmt, { onChange, inc } = {}) {
  const show = (v) => (fmt ? fmt(v) : String(v));
  const out = h('span', { class: 'val' }, show(value));
  const dec = decimals(step);
  const incs = inc || increments(min, max, step);
  let cur = +value;
  let commitTimer = null;
  const commit = () => { clearTimeout(commitTimer); commitTimer = null; pendingCommits.delete(commit); if (onChange) onChange(cur); };
  const later = () => { clearTimeout(commitTimer); commitTimer = setTimeout(commit, 260); pendingCommits.add(commit); };
  const setTo = (v, fire) => {
    v = Math.min(max, Math.max(min, v));
    v = +(min + Math.round((v - min) / step) * step).toFixed(dec);
    v = Math.min(max, Math.max(min, v));
    if (v === cur && fire) return false;
    cur = v;
    inp.value = v;
    out.textContent = show(v);
    if (fire) onInput(v);
    return true;
  };
  const nudge = (dir, level) => setTo(cur + dir * incs[level - 1], true);
  const inp = h('input', {
    type: 'range', min, max, step, value, 'aria-label': label,
    oninput: (e) => { cur = +e.target.value; onInput(cur); out.textContent = show(cur); },
    onchange: () => { if (onChange) commit(); },
    onkeydown: (e) => {
      const k = e.key;
      let moved = null;
      if (k === 'ArrowRight' || k === 'ArrowUp') moved = nudge(1, e.shiftKey ? 3 : e.altKey ? 1 : stepLevel);
      else if (k === 'ArrowLeft' || k === 'ArrowDown') moved = nudge(-1, e.shiftKey ? 3 : e.altKey ? 1 : stepLevel);
      else if (k === 'PageUp') moved = nudge(1, 3);
      else if (k === 'PageDown') moved = nudge(-1, 3);
      else if (k === 'Home') moved = setTo(min, true);
      else if (k === 'End') moved = setTo(max, true);
      else return;
      e.preventDefault();
      if (moved) later();
    },
  });
  const arrow = (dir) => {
    let hold = null;
    let n = 0;
    let level = stepLevel;
    const stop = () => { if (hold) { clearTimeout(hold); hold = null; if (commitTimer) commit(); } };
    const tick = () => {
      if (!btn.isConnected) { hold = null; return; }
      nudge(dir, level);
      n++;
      hold = setTimeout(tick, n > 14 ? 40 : 75);
    };
    const btn = h('button', {
      type: 'button', class: 'nudge', 'aria-label': `${label} ${dir > 0 ? 'up' : 'down'}`,
      html: dir > 0 ? '<svg viewBox="0 0 12 12"><path d="M4 2l4.5 4L4 10z" fill="currentColor"/></svg>' : '<svg viewBox="0 0 12 12"><path d="M8 2L3.5 6 8 10z" fill="currentColor"/></svg>',
      onpointerdown: (e) => {
        if (e.button) return;
        e.preventDefault();
        try { btn.setPointerCapture(e.pointerId); } catch { /* old Safari */ }
        level = e.shiftKey ? 3 : e.altKey ? 1 : stepLevel;
        n = 0;
        if (nudge(dir, level)) later();
        hold = setTimeout(tick, 380);
      },
      onpointerup: stop, onpointercancel: stop, onlostpointercapture: stop,
      onclick: (e) => { if (e.detail === 0 && nudge(dir, stepLevel)) later(); }, // keyboard Enter / Space
    });
    return btn;
  };
  const el = h('div', { class: 'slider', role: 'group', 'data-label': label }, h('span', { class: 'lbl' }, label), arrow(-1), inp, arrow(1), out);
  el.input = inp;
  el.setValue = (v) => { cur = +v; inp.value = v; out.textContent = show(+v); };
  el.commit = () => { if (commitTimer) commit(); };
  return el;
}

export function seg(options, current, onPick, cls = '') {
  return h('div', { class: 'seg ' + cls, role: 'group' }, options.map(([v, label]) =>
    h('button', { class: v === current ? 'on' : '', 'aria-pressed': String(v === current), onclick: () => onPick(v) }, label)));
}

export function chip(label, on, onToggle, extra = {}) {
  return h('button', { class: 'chip' + (on ? ' on' : ''), 'aria-pressed': String(!!on), onclick: () => onToggle(!on), ...extra }, label);
}

export function select(options, current, onPick, label) {
  const s = h('select', { 'aria-label': label, onchange: (e) => onPick(e.target.value) },
    options.map(([v, l]) => h('option', { value: String(v) }, l)));
  s.value = String(current);
  return s;
}

export const field = (label, control) => h('label', { class: 'field' }, label, control);
export const card = (title, ...kids) => h('div', { class: 'card', 'data-card': title || null }, title ? h('div', { class: 'card-title' }, title) : null, ...kids);

let toastTimer = null;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

export function openSheet(title, ...kids) {
  const body = $('#sheetBody');
  body.replaceChildren(title ? h('h2', {}, title) : '', ...kids.flat());
  $('#sheetWrap').hidden = false;
  body.scrollTop = 0;
}
export function closeSheet() { $('#sheetWrap').hidden = true; $('#sheetBody').replaceChildren(); }
export const sheetOpen = () => !$('#sheetWrap').hidden;

export const fmtPct = (v) => `${Math.round(v * 100)}%`;
export const fmtDb = (v) => `${v > 0 ? '+' : ''}${(+v).toFixed(1)} dB`;
export const fmtSec = (v) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${(+v).toFixed(2)} s`);
export const fmtHz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`);
