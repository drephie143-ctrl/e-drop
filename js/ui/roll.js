// Touch piano roll on a canvas. Tap empty space to add a note, tap a note to delete it,
// drag a note to move it, drag its right end to resize, drag empty space to scroll.
// On a computer (app.desk) it fits the pattern to the panel width until you zoom (Fit puts it
// back), the rows grow with the panel's height, Ctrl + wheel zooms around the pointer, Shift +
// wheel scrolls sideways and Alt + wheel changes the row height. It also follows the
// display-size zoom (CSS zoom on the root), so it stays sharp and the clicks land right.
import { h } from './dom.js';
import { inScale, noteName, spell } from '../music/theory.js';

const LOW = 24;   // C1
const HIGH = 96;  // C7
const BLACK = new Set([1, 3, 6, 8, 10]);
const ZX = [4, 96]; // px per 16th, min and max
const FONT = '-apple-system, "Segoe UI", system-ui, sans-serif';

export class PianoRoll {
  constructor(app) {
    this.app = app;
    this.canvas = h('canvas', { class: 'roll-canvas' });
    this.zoomBar = h('div', { class: 'roll-zoom' },
      h('button', { class: 'roll-fit', 'aria-label': 'Fit the pattern to the width', title: 'Fit the pattern to the width (F)', onclick: () => this.fitNow() }, 'Fit'),
      h('button', { 'aria-label': 'Zoom out', title: 'Zoom out (Ctrl + wheel)', onclick: () => this.zoom(1 / 1.35) }, '−'),
      h('button', { 'aria-label': 'Zoom in', title: 'Zoom in (Ctrl + wheel)', onclick: () => this.zoom(1.35) }, '+'));
    this.el = h('div', { class: 'roll-wrap' }, this.canvas, this.zoomBar);
    this.g = this.canvas.getContext('2d');
    this.zx = 13; // px per 16th
    this.rowH = 17;
    this.kw = 38; // keyboard width
    this.ru = 18; // ruler height
    this.z = 1; // display-size zoom
    this.fit = true; // a computer: fit the pattern to the width until the user zooms
    this.rowAuto = true; // a computer: row height follows the panel height until Alt + wheel
    this.sx = 0;
    this.sy = null;
    this.drag = null;
    this.ghosts = [];
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('pointercancel', () => { this.drag = null; this.draw(); });
    c.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
  }

  set(track, pat, ghosts = []) {
    const changedPat = this.pat !== pat;
    this.track = track;
    this.pat = pat;
    this.ghosts = ghosts;
    this.resize(false);
    if (changedPat || this.sy == null) this.centre();
    this.clamp();
    this.draw();
  }

  centre() {
    const ns = this.pat ? this.pat.notes : [];
    const mid = ns.length ? ns.reduce((a, n) => a + n.pitch, 0) / ns.length : ({ sub: 36, bass: 40, pad: 60, stab: 62, pluck: 70, lead: 72 }[this.track?.role] || 60);
    // the phone keeps its old spot; a computer centres the notes in the visible height
    this.sy = (HIGH - mid) * this.rowH - (this.app.desk ? (this.h - this.ru) / 2 : 150);
    if (!this.app.desk || !this.fit) this.sx = 0;
  }

  // Sizes: the canvas covers the wrap's box in CSS px; its bitmap is the on-screen size, which
  // the display zoom (this.z) scales, at the device pixel ratio.
  resize(redraw = true) {
    const el = this.el;
    const r = el.getBoundingClientRect();
    if (!r.width || !el.offsetWidth) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.z = r.width / el.offsetWidth || 1;
    this.w = el.clientWidth;
    this.h = el.clientHeight;
    this.canvas.width = Math.round(this.w * this.z * dpr);
    this.canvas.height = Math.round(this.h * this.z * dpr);
    this.g.setTransform(dpr * this.z, 0, 0, dpr * this.z, 0, 0);
    const desk = !!this.app.desk;
    if (desk !== this.desk) {
      // back on the phone layout: its usual zoom (a fitted desktop zoom would be far too wide)
      if (this.desk && !desk) { this.zx = 13; this.sx = 0; this.rowAuto = true; }
      // onto the desktop layout: fit the pattern again (the phone's − + buttons turned it off)
      if (desk) this.fit = true;
      this.desk = desk;
    }
    this.kw = desk ? 48 : 38;
    this.ru = desk ? 22 : 18;
    this.zoomBar.classList.toggle('fit', desk && this.fit);
    if (desk && this.rowAuto) this.setRowH(Math.max(17, Math.min(28, Math.floor((this.h - this.ru) / 30))));
    else if (!desk) this.setRowH(17);
    if (desk && this.fit) this.fitX();
    if (redraw) { this.clamp(); this.draw(); }
  }

  // change the row height keeping the pitch in the middle of the view where it is
  setRowH(rh) {
    if (rh === this.rowH) return;
    if (this.sy != null && this.h) {
      const midPitch = (this.sy + (this.h - this.ru) / 2) / this.rowH;
      this.sy = midPitch * rh - (this.h - this.ru) / 2;
    }
    this.rowH = rh;
  }

  get grid() { return this.app.ui.grid || 1; }
  get steps() { return (this.pat?.bars || 4) * 16; }

  fitX() {
    this.zx = Math.max(ZX[0], Math.min(ZX[1], (this.w - this.kw - 10) / this.steps));
    this.sx = 0;
  }

  fitNow() {
    this.fit = true;
    this.zoomBar.classList.toggle('fit', !!this.app.desk);
    this.fitX();
    this.clamp();
    this.draw();
  }

  clamp() {
    const maxX = Math.max(0, this.steps * this.zx - (this.w - this.kw) + 20);
    const maxY = Math.max(0, (HIGH - LOW + 1) * this.rowH - (this.h - this.ru));
    this.sx = Math.max(0, Math.min(maxX, this.sx));
    this.sy = Math.max(0, Math.min(maxY, this.sy ?? 0));
  }

  // zoom around x (CSS px in the canvas; default the middle of the grid)
  zoom(f, x = null) {
    const ax = x == null ? (this.w - this.kw) / 2 : Math.max(0, x - this.kw);
    const at = (this.sx + ax) / this.zx;
    this.fit = false;
    this.zoomBar.classList.remove('fit');
    this.zx = Math.max(ZX[0], Math.min(ZX[1], this.zx * f));
    this.sx = at * this.zx - ax;
    this.clamp(); this.draw();
  }

  wheel(e) {
    e.preventDefault();
    const p = this.at(e);
    if (e.ctrlKey || e.metaKey) this.zoom(Math.exp(-Math.max(-60, Math.min(60, e.deltaY)) * 0.004), p.x);
    else if (e.altKey && this.app.desk) {
      this.rowAuto = false;
      this.setRowH(Math.max(10, Math.min(40, Math.round(this.rowH * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))));
      this.clamp(); this.draw();
    } else {
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) this.sx += e.deltaX || e.deltaY;
      else this.sy += e.deltaY;
      this.clamp(); this.draw();
    }
  }

  // coordinates
  xOf(step) { return this.kw + step * this.zx - this.sx; }
  yOf(pitch) { return this.ru + (HIGH - pitch) * this.rowH - this.sy; }
  at(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / this.z;
    const y = (e.clientY - r.top) / this.z;
    return { x, y, step: (x - this.kw + this.sx) / this.zx, pitch: HIGH - Math.floor((y - this.ru + this.sy) / this.rowH) };
  }
  hit(p) {
    const ns = this.pat.notes;
    for (let i = ns.length - 1; i >= 0; i--) {
      const n = ns[i];
      if (n.pitch !== p.pitch || p.step < n.start || p.step > n.start + n.len) continue;
      const wpx = n.len * this.zx;
      const edge = Math.max(9, Math.min(wpx * 0.35, 22));
      return { n, edge: this.xOf(n.start + n.len) - p.x < edge && wpx > 10 };
    }
    return null;
  }

  down(e) {
    if (!this.pat) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* fine */ }
    const p = this.at(e);
    if (p.x < this.kw && p.y > this.ru) { this.app.preview(this.track, p.pitch); return; }
    if (p.y < this.ru) return;
    const hit = this.hit(p);
    this.drag = { p0: p, x0: e.clientX, y0: e.clientY, sx: this.sx, sy: this.sy, hit, moved: false,
      orig: hit ? { ...hit.n } : null, mode: hit ? (hit.edge ? 'resize' : 'move') : 'pan' };
  }

  move(e) {
    const d = this.drag;
    if (!d) {
      // a mouse: show what a press would do
      if (this.app.desk && this.pat && e.pointerType === 'mouse') {
        const p = this.at(e);
        const hit = p.x > this.kw && p.y > this.ru ? this.hit(p) : null;
        this.canvas.style.cursor = p.x < this.kw ? 'pointer' : hit ? (hit.edge ? 'ew-resize' : 'grab') : 'crosshair';
      }
      return;
    }
    const dx = (e.clientX - d.x0) / this.z;
    const dy = (e.clientY - d.y0) / this.z;
    if (!d.moved && Math.hypot(dx, dy) < 7) return;
    d.moved = true;
    const g = this.grid;
    if (d.mode === 'pan') {
      this.sx = d.sx - dx;
      this.sy = d.sy - dy;
      this.clamp();
    } else if (d.mode === 'move') {
      const n = d.hit.n;
      const ds = Math.round(dx / this.zx / g) * g;
      const dp = -Math.round(dy / this.rowH);
      n.start = Math.max(0, Math.min(this.steps - n.len, d.orig.start + ds));
      const np = Math.max(LOW, Math.min(HIGH, d.orig.pitch + dp));
      if (np !== n.pitch) { n.pitch = np; this.app.preview(this.track, np, 0.15); }
    } else if (d.mode === 'resize') {
      const n = d.hit.n;
      const end = Math.round((d.orig.start + d.orig.len + dx / this.zx) / g) * g;
      n.len = Math.max(g / 2, Math.min(this.steps - n.start, end - n.start));
    }
    this.draw();
  }

  up() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const ns = this.pat.notes;
    if (!d.moved) {
      if (d.hit) ns.splice(ns.indexOf(d.hit.n), 1);
      else {
        const g = this.grid;
        const start = Math.floor(d.p0.step / g) * g;
        if (start >= 0 && start < this.steps && d.p0.pitch >= LOW && d.p0.pitch <= HIGH) {
          const len = Math.min(this.app.ui.noteLen || g, this.steps - start);
          ns.push({ pitch: d.p0.pitch, start, len, vel: 0.9 });
          this.app.preview(this.track, d.p0.pitch, Math.min(0.5, len * 15 / this.app.project.bpm));
        }
      }
      this.app.notesEdited(this.track, this.pat);
    } else if (d.mode !== 'pan') {
      this.app.ui.noteLen = d.mode === 'resize' ? d.hit.n.len : this.app.ui.noteLen;
      this.app.notesEdited(this.track, this.pat);
    }
    this.draw();
  }

  // theme colours, read once (getComputedStyle every frame is slow)
  get cols() {
    if (!this._cols) {
      const css = getComputedStyle(document.documentElement);
      const v = (n) => css.getPropertyValue(n).trim();
      this._cols = Object.fromEntries(['--roll-bg', '--roll-root', '--roll-scale', '--roll-black', '--roll-line', '--roll-bar', '--roll-beat', '--roll-ghost', '--accent', '--panel', '--muted'].map((n) => [n, v(n)]));
    }
    return this._cols;
  }

  draw(playStep = this.playStep) {
    this.playStep = playStep;
    const g = this.g;
    const { w, h: H, kw: KW, ru: RU } = this;
    if (!w || !this.pat) return;
    const p = this.app.project;
    const desk = !!this.app.desk;
    const col = (n) => this.cols[n];
    g.fillStyle = col('--roll-bg');
    g.fillRect(0, 0, w, H);
    // rows
    for (let m = HIGH; m >= LOW; m--) {
      const y = this.yOf(m);
      if (y > H || y + this.rowH < RU) continue;
      const pc = ((m % 12) + 12) % 12;
      const isRoot = pc === p.key;
      g.fillStyle = isRoot ? col('--roll-root') : inScale(m, p.key, p.scale) ? col('--roll-scale') : BLACK.has(pc) ? col('--roll-black') : col('--roll-bg');
      g.fillRect(KW, y, w - KW, this.rowH);
      g.fillStyle = col('--roll-line');
      g.fillRect(KW, y + this.rowH - 1, w - KW, 1);
    }
    // columns
    const steps = this.steps;
    for (let s = 0; s <= steps; s++) {
      const x = this.xOf(s);
      if (x < KW || x > w) continue;
      g.fillStyle = s % 16 === 0 ? col('--roll-bar') : s % 4 === 0 ? col('--roll-beat') : col('--roll-line');
      if (s % 4 === 0 || this.zx >= 9) g.fillRect(x, RU, s % 16 === 0 ? 1.5 : 1, H);
    }
    const endX = this.xOf(steps);
    if (endX < w) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(endX, RU, w - endX, H); }
    // ghost notes (other parts in the same section)
    g.fillStyle = col('--roll-ghost');
    for (const n of this.ghosts) {
      if (n.start >= steps) continue;
      const x = this.xOf(n.start);
      const y = this.yOf(n.pitch);
      g.fillRect(x + 1, y + 3, Math.max(2, Math.min(n.len, steps - n.start) * this.zx - 2), this.rowH - 6);
    }
    // notes (on a computer, named when they're wide enough)
    const color = this.track.color;
    const label = desk && this.rowH >= 15;
    // names spelled the way the key is written (F minor: Db, not C#); the phone keeps its labels
    const nm = (m) => (desk ? spell(m, p.key, p.scale) + (Math.floor(m / 12) - 1) : noteName(m));
    if (label) { g.font = `700 ${Math.min(12, this.rowH - 5)}px ${FONT}`; g.textBaseline = 'middle'; }
    for (const n of this.pat.notes) {
      const x = this.xOf(n.start);
      const y = this.yOf(n.pitch);
      const ww = Math.max(3, n.len * this.zx - 1);
      if (x > w || x + ww < KW || y > H || y + this.rowH < RU) continue;
      g.globalAlpha = 0.55 + 0.45 * (n.vel ?? 0.9);
      g.fillStyle = color;
      rr(g, x + 0.5, y + 1, ww, this.rowH - 2, 3);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(0,0,0,.35)';
      if (ww > 14) g.fillRect(x + ww - 5, y + 4, 2, this.rowH - 8);
      if (label && ww > 34) { g.fillStyle = 'rgba(10,12,18,.78)'; g.fillText(nm(n.pitch), x + 5, y + this.rowH / 2 + 0.5); }
    }
    // playhead
    if (playStep != null && playStep >= 0) {
      const x = this.xOf(playStep);
      if (x >= KW && x <= w) { g.fillStyle = col('--accent'); g.fillRect(x - 1, RU, 2, H); }
    }
    // keyboard
    g.fillStyle = col('--panel');
    g.fillRect(0, RU, KW, H);
    const big = desk && this.rowH >= 20;
    g.font = `600 ${big ? 11 : 9.5}px ${FONT}`;
    g.textBaseline = 'middle';
    for (let m = HIGH; m >= LOW; m--) {
      const y = this.yOf(m);
      if (y > H || y + this.rowH < RU) continue;
      const pc = ((m % 12) + 12) % 12;
      g.fillStyle = BLACK.has(pc) ? '#11161d' : '#d9dee5';
      g.fillRect(0, y, BLACK.has(pc) ? KW * 0.62 : KW - 1, this.rowH - 1);
      if (pc === 0 || pc === p.key || (big && !BLACK.has(pc) && inScale(m, p.key, p.scale))) {
        g.fillStyle = BLACK.has(pc) ? '#d9dee5' : pc === 0 || pc === p.key ? '#11161d' : '#6b7486';
        g.fillText(nm(m), 3, y + this.rowH / 2);
      }
    }
    // ruler
    g.fillStyle = col('--panel');
    g.fillRect(0, 0, w, RU);
    g.fillStyle = col('--muted');
    g.font = `600 ${desk ? 11 : 10}px ${FONT}`;
    const beats = desk && this.zx * 4 >= 34;
    for (let b = 0; b < this.pat.bars; b++) {
      const x = this.xOf(b * 16);
      if (x >= KW - 2 && x < w) g.fillText(String(b + 1), x + 3, RU / 2 + 1);
      for (let q = 1; q < 4 && this.zx > 6; q++) {
        const xq = this.xOf(b * 16 + q * 4);
        if (xq <= KW || xq >= w) continue;
        g.fillRect(xq, RU - 4, 1, 4);
        if (beats) g.fillText(`${b + 1}.${q + 1}`, xq + 3, RU / 2 + 1);
      }
    }
  }
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
