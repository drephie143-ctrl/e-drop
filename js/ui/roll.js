// Touch piano roll on a canvas. Tap empty space to add a note, tap a note to delete it,
// drag a note to move it, drag its right end to resize, drag empty space to scroll.
import { h } from './dom.js';
import { inScale, noteName } from '../music/theory.js';

const KEYW = 38;
const RULER = 18;
const LOW = 24;   // C1
const HIGH = 96;  // C7
const BLACK = new Set([1, 3, 6, 8, 10]);

export class PianoRoll {
  constructor(app) {
    this.app = app;
    this.canvas = h('canvas', { class: 'roll-canvas' });
    this.el = h('div', { class: 'roll-wrap' }, this.canvas,
      h('div', { class: 'roll-zoom' },
        h('button', { 'aria-label': 'Zoom out', onclick: () => this.zoom(1 / 1.35) }, '−'),
        h('button', { 'aria-label': 'Zoom in', onclick: () => this.zoom(1.35) }, '+')));
    this.g = this.canvas.getContext('2d');
    this.zx = 13; // px per 16th
    this.rowH = 17;
    this.sx = 0;
    this.sy = null;
    this.drag = null;
    this.ghosts = [];
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('pointercancel', () => { this.drag = null; this.draw(); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) this.sx += e.deltaX || e.deltaY;
      else this.sy += e.deltaY;
      this.clamp(); this.draw();
    }, { passive: false });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
  }

  set(track, pat, ghosts = []) {
    const changedPat = this.pat !== pat;
    this.track = track;
    this.pat = pat;
    this.ghosts = ghosts;
    if (changedPat || this.sy == null) this.centre();
    this.resize();
  }

  centre() {
    const ns = this.pat ? this.pat.notes : [];
    const mid = ns.length ? ns.reduce((a, n) => a + n.pitch, 0) / ns.length : ({ sub: 36, bass: 40, pad: 60, stab: 62, pluck: 70, lead: 72 }[this.track?.role] || 60);
    this.sy = (HIGH - mid) * this.rowH - 150;
    this.sx = 0;
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.clamp();
    this.draw();
  }

  get grid() { return this.app.ui.grid || 1; }
  get steps() { return (this.pat?.bars || 4) * 16; }

  clamp() {
    const maxX = Math.max(0, this.steps * this.zx - (this.w - KEYW) + 20);
    const maxY = Math.max(0, (HIGH - LOW + 1) * this.rowH - (this.h - RULER));
    this.sx = Math.max(0, Math.min(maxX, this.sx));
    this.sy = Math.max(0, Math.min(maxY, this.sy ?? 0));
  }

  zoom(f) {
    const centre = (this.sx + (this.w - KEYW) / 2) / this.zx;
    this.zx = Math.max(5, Math.min(48, this.zx * f));
    this.sx = centre * this.zx - (this.w - KEYW) / 2;
    this.clamp(); this.draw();
  }

  // coordinates
  xOf(step) { return KEYW + step * this.zx - this.sx; }
  yOf(pitch) { return RULER + (HIGH - pitch) * this.rowH - this.sy; }
  at(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    return { x, y, step: (x - KEYW + this.sx) / this.zx, pitch: HIGH - Math.floor((y - RULER + this.sy) / this.rowH) };
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
    if (p.x < KEYW && p.y > RULER) { this.app.preview(this.track, p.pitch); return; }
    if (p.y < RULER) return;
    const hit = this.hit(p);
    this.drag = { p0: p, x0: e.clientX, y0: e.clientY, sx: this.sx, sy: this.sy, hit, moved: false,
      orig: hit ? { ...hit.n } : null, mode: hit ? (hit.edge ? 'resize' : 'move') : 'pan' };
  }

  move(e) {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
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

  draw(playStep = this.playStep) {
    this.playStep = playStep;
    const g = this.g;
    const { w, h: H } = this;
    if (!w || !this.pat) return;
    const p = this.app.project;
    const css = getComputedStyle(document.documentElement);
    const col = (n) => css.getPropertyValue(n).trim();
    g.fillStyle = col('--roll-bg');
    g.fillRect(0, 0, w, H);
    // rows
    for (let m = HIGH; m >= LOW; m--) {
      const y = this.yOf(m);
      if (y > H || y + this.rowH < RULER) continue;
      const pc = ((m % 12) + 12) % 12;
      const isRoot = pc === p.key;
      g.fillStyle = isRoot ? col('--roll-root') : inScale(m, p.key, p.scale) ? col('--roll-scale') : BLACK.has(pc) ? col('--roll-black') : col('--roll-bg');
      g.fillRect(KEYW, y, w - KEYW, this.rowH);
      g.fillStyle = col('--roll-line');
      g.fillRect(KEYW, y + this.rowH - 1, w - KEYW, 1);
    }
    // columns
    const steps = this.steps;
    for (let s = 0; s <= steps; s++) {
      const x = this.xOf(s);
      if (x < KEYW || x > w) continue;
      g.fillStyle = s % 16 === 0 ? col('--roll-bar') : s % 4 === 0 ? col('--roll-beat') : col('--roll-line');
      if (s % 4 === 0 || this.zx >= 9) g.fillRect(x, RULER, s % 16 === 0 ? 1.5 : 1, H);
    }
    const endX = this.xOf(steps);
    if (endX < w) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(endX, RULER, w - endX, H); }
    // ghost notes (other parts in the same section)
    g.fillStyle = col('--roll-ghost');
    for (const n of this.ghosts) {
      if (n.start >= steps) continue;
      const x = this.xOf(n.start);
      const y = this.yOf(n.pitch);
      g.fillRect(x + 1, y + 3, Math.max(2, Math.min(n.len, steps - n.start) * this.zx - 2), this.rowH - 6);
    }
    // notes
    const color = this.track.color;
    for (const n of this.pat.notes) {
      const x = this.xOf(n.start);
      const y = this.yOf(n.pitch);
      const ww = Math.max(3, n.len * this.zx - 1);
      if (x > w || x + ww < KEYW || y > H || y + this.rowH < RULER) continue;
      g.globalAlpha = 0.55 + 0.45 * (n.vel ?? 0.9);
      g.fillStyle = color;
      rr(g, x + 0.5, y + 1, ww, this.rowH - 2, 3);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(0,0,0,.35)';
      if (ww > 14) g.fillRect(x + ww - 5, y + 4, 2, this.rowH - 8);
    }
    // playhead
    if (playStep != null && playStep >= 0) {
      const x = this.xOf(playStep);
      if (x >= KEYW && x <= w) { g.fillStyle = col('--accent'); g.fillRect(x - 1, RULER, 2, H); }
    }
    // keyboard
    g.fillStyle = col('--panel');
    g.fillRect(0, RULER, KEYW, H);
    g.font = '600 9.5px -apple-system, system-ui, sans-serif';
    g.textBaseline = 'middle';
    for (let m = HIGH; m >= LOW; m--) {
      const y = this.yOf(m);
      if (y > H || y + this.rowH < RULER) continue;
      const pc = ((m % 12) + 12) % 12;
      g.fillStyle = BLACK.has(pc) ? '#11161d' : '#d9dee5';
      g.fillRect(0, y, BLACK.has(pc) ? KEYW * 0.62 : KEYW - 1, this.rowH - 1);
      if (pc === 0 || pc === p.key) {
        g.fillStyle = BLACK.has(pc) ? '#d9dee5' : '#11161d';
        g.fillText(noteName(m), 3, y + this.rowH / 2);
      }
    }
    // ruler
    g.fillStyle = col('--panel');
    g.fillRect(0, 0, w, RULER);
    g.fillStyle = col('--muted');
    g.font = '600 10px -apple-system, system-ui, sans-serif';
    for (let b = 0; b < this.pat.bars; b++) {
      const x = this.xOf(b * 16);
      if (x >= KEYW - 2 && x < w) g.fillText(String(b + 1), x + 3, RULER / 2 + 1);
      for (let q = 1; q < 4 && this.zx > 6; q++) { const xq = this.xOf(b * 16 + q * 4); if (xq > KEYW && xq < w) g.fillRect(xq, RULER - 4, 1, 4); }
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
