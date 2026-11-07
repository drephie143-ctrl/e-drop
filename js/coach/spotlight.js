// Spotlight: a pulsing ring over the control a step is about. It sits on top of everything
// with pointer-events: none, so it never blocks the app, re-finds its target every few frames
// (screens re-render often), follows scroll and resize, and steps aside when a sheet covers
// the target. Targets are described, not hard-wired, so they survive layout changes:
//
//   '#menuBtn'                         a selector
//   { sel: '.tl', nth }                a selector, the nth visible match
//   { card: 'Filter', slider: 'Cutoff' } a card by title, optionally a slider in it
//   { btn: 'Chords & parts' }          a button (or chip) whose text starts with this
//   { strip: 'bass', slider: 'Pump' }  a Mix strip by track role
//   { sec: (F) => sectionFact }        a section block in the Song timeline
//   { sheet: 'Loudness' }              a field or button inside the open sheet
//   [spec, spec, ...]                  the first one found
import { h } from '../ui/dom.js';

// CSS zoom on the page (the desktop Display size setting) scales what we position: rects
// come back in screen pixels, while left/top on a fixed element are multiplied by the zoom.
export function pageZoom() {
  const z = (el) => parseFloat(getComputedStyle(el).zoom) || 1;
  return z(document.documentElement) * z(document.body);
}

const visible = (el) => !!el && el.isConnected && el.getClientRects().length > 0 && !el.closest('[hidden]');
const q = (s) => s.replace(/"/g, '\\"');
const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

function scopes(tab) {
  const out = [];
  const sheet = document.getElementById('sheetWrap');
  if (sheet && !sheet.hidden) out.push(document.getElementById('sheetBody'));
  if (tab) { const t = document.getElementById(`tab-${tab}`); if (t) out.push(t); }
  out.push(document);
  return out.filter(Boolean);
}

// visible matches in the first scope that has any (an open sheet, the tab's panel, the page),
// optionally only those passing `pred`
function all(sel, tab, pred = null) {
  for (const root of scopes(tab)) {
    const list = [...root.querySelectorAll(sel)].filter((el) => visible(el) && (!pred || pred(el)));
    if (list.length) return list;
  }
  return [];
}

export function resolveTarget(spec, { tab, F } = {}) {
  if (!spec) return null;
  if (Array.isArray(spec)) { for (const s of spec) { const el = resolveTarget(s, { tab, F }); if (el) return el; } return null; }
  try {
    if (typeof spec === 'string') return all(spec, tab)[0] || null;
    if (spec.sel) return all(spec.sel, tab)[spec.nth || 0] || null;
    if (spec.card) {
      const cards = all(`.card[data-card="${q(spec.card)}"]`, tab);
      for (const c of cards) {
        if (!spec.slider) return c;
        const s = c.querySelector(`.slider[data-label="${q(spec.slider)}"]`);
        if (visible(s)) return s;
      }
      return null;
    }
    if (spec.btn) {
      const want = spec.btn;
      return all('button, .chip, .mi', tab, (b) => textOf(b).startsWith(want))[0] || null;
    }
    if (spec.strip) {
      const names = F ? F.tracks(spec.strip).map((t) => t.name) : [];
      const strip = all('.strip', 'mix', (s) => { const n = s.querySelector('.sname'); return !!n && names.some((nm) => textOf(n).startsWith(nm)); })[0];
      if (!strip) return null;
      const s = spec.slider && strip.querySelector(`.slider[data-label="${q(spec.slider)}"]`);
      return visible(s) ? s : strip;
    }
    if (spec.sec) {
      const x = F && spec.sec(F);
      if (!x) return null;
      return all('.tl-sec', 'song')[x.i] || null;
    }
    if (spec.sheet) {
      const body = document.getElementById('sheetBody');
      const wrap = document.getElementById('sheetWrap');
      if (!body || !wrap || wrap.hidden) return null;
      return [...body.querySelectorAll('.field, button, .mi')].filter(visible).find((el) => textOf(el).startsWith(spec.sheet)) || null;
    }
  } catch { /* a bad selector or a missing track is just "not found" */ }
  return null;
}

export class Spotlight {
  constructor() {
    this.ring = h('div', { class: 'co-spot', hidden: true, 'aria-hidden': 'true' });
    this.tag = h('div', { class: 'co-spot-tag', hidden: true, 'aria-hidden': 'true' });
    document.body.append(this.ring, this.tag);
    this.spec = null;
    this.el = null;
    this.raf = 0;
    this.n = 0;
    // once the learner touches the target, the ring has done its job
    document.addEventListener('pointerdown', (e) => {
      if (this.spec && this.el && !this.usingVia && this.el.contains(e.target)) { clearTimeout(this.doneTimer); this.doneTimer = setTimeout(() => this.hide(), 900); }
    }, true);
  }

  get active() { return !!this.spec; }

  // ctx: { tab, F, label, via } — via is shown when the target itself is not on screen yet
  // (a button inside a sheet that a first tap opens).
  show(spec, ctx = {}) {
    this.hide();
    if (!spec) return false;
    this.spec = spec;
    this.ctx = ctx;
    this.t0 = performance.now();
    this.el = this.find();
    if (this.el) this.reveal(this.el);
    this.loop();
    return !!this.el;
  }

  find() {
    const { tab, F, via } = this.ctx;
    const el = resolveTarget(this.spec, { tab, F });
    this.usingVia = false;
    if (el) return el;
    if (via) { const v = resolveTarget(via, { tab, F }); if (v) { this.usingVia = true; return v; } }
    return null;
  }

  reveal(el) {
    // scroll whatever scrolls it (main, a panel, the timeline) so it sits in view; a target
    // taller than its scroller is shown from its top
    const box = this.clipBox(el);
    const tall = el.getBoundingClientRect().height > (box.b - box.t) * 0.8;
    try { el.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest', behavior: 'smooth' }); } catch { el.scrollIntoView(); }
  }

  // the part of the screen where the target can be seen: the viewport cut down by every
  // scrolling or clipping ancestor (so the ring never spills over the header or the dock)
  clipBox(el) {
    if (this.clipFor !== el) {
      this.clipFor = el;
      this.clips = [];
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(cs.overflowX + cs.overflowY)) this.clips.push(p);
      }
    }
    const box = { l: 0, t: 0, r: window.innerWidth, b: window.innerHeight };
    for (const p of this.clips) {
      const pr = p.getBoundingClientRect();
      box.l = Math.max(box.l, pr.left); box.t = Math.max(box.t, pr.top);
      box.r = Math.min(box.r, pr.right); box.b = Math.min(box.b, pr.bottom);
    }
    return box;
  }

  loop() {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (!this.spec) return;
      this.n++;
      // re-find often: screens rebuild their DOM on every render
      if (!this.el || !this.el.isConnected || this.n % 12 === 0 || this.usingVia) {
        const wasVia = this.usingVia;
        this.el = this.find();
        // the first tap opened the way (a sheet): now bring the real target into view
        if (wasVia && !this.usingVia && this.el) { this.t0 = performance.now(); setTimeout(() => this.el && this.reveal(this.el), 250); }
      }
      this.place();
      // a reminder, not a fixture: fade out after a while
      if (performance.now() - this.t0 > 22000) { this.hide(); return; }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  place() {
    const el = this.el;
    const sheet = document.getElementById('sheetWrap');
    const covered = sheet && !sheet.hidden && el && !sheet.contains(el);
    if (!el || !visible(el) || covered) { this.ring.hidden = true; this.tag.hidden = true; return; }
    const r = el.getBoundingClientRect();
    const c = this.clipBox(el);
    const vw = window.innerWidth;
    const pad = 5;
    let x0 = r.left - pad, y0 = r.top - pad, x1 = r.right + pad, y1 = r.bottom + pad;
    // hide when the target is scrolled out of its area, else clip the ring to that area
    if (x1 < c.l + 4 || y1 < c.t + 4 || x0 > c.r - 4 || y0 > c.b - 4) { this.ring.hidden = true; this.tag.hidden = true; return; }
    x0 = Math.max(c.l + 1, x0); y0 = Math.max(c.t + 1, y0); x1 = Math.min(c.r - 1, x1); y1 = Math.min(c.b - 1, y1);
    if (this.n % 30 === 1 || !this.z) this.z = pageZoom();
    const z = this.z;
    Object.assign(this.ring.style, { left: x0 / z + 'px', top: y0 / z + 'px', width: (x1 - x0) / z + 'px', height: (y1 - y0) / z + 'px' });
    this.ring.hidden = false;
    const label = this.usingVia ? 'Tap here first' : this.ctx.label;
    if (label) {
      this.tag.textContent = label;
      this.tag.hidden = false;
      const tw = this.tag.offsetWidth * z;
      const th = this.tag.offsetHeight * z;
      this.tag.style.left = Math.min(vw - tw - 8, Math.max(8, x0)) / z + 'px';
      // above the ring if there is room in its area, else below it, else inside its top edge
      const top = y0 - th - 6 >= c.t ? y0 - th - 6 : y1 + 6 + th <= c.b ? y1 + 6 : y0 + 6;
      this.tag.style.top = top / z + 'px';
    } else this.tag.hidden = true;
  }

  hide() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.doneTimer);
    this.spec = null;
    this.el = null;
    this.ring.hidden = true;
    this.tag.hidden = true;
  }
}
