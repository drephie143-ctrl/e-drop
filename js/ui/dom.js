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

export function slider(label, value, min, max, step, onInput, fmt, { onChange } = {}) {
  const out = h('span', { class: 'val' }, fmt ? fmt(value) : String(value));
  const inp = h('input', {
    type: 'range', min, max, step, value, 'aria-label': label,
    oninput: (e) => { const v = +e.target.value; onInput(v); out.textContent = fmt ? fmt(v) : String(v); },
    onchange: onChange ? (e) => onChange(+e.target.value) : null,
  });
  return h('label', { class: 'slider' }, h('span', { class: 'lbl' }, label), inp, out);
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
export const card = (title, ...kids) => h('div', { class: 'card' }, title ? h('div', { class: 'card-title' }, title) : null, ...kids);

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
