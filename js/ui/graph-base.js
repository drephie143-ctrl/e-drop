// Shared base for the visual editors (envelope, filter, EQ, pump… graphs): a canvas that fills
// its box at the device pixel ratio, redraws on resize, and turns pointer drags into calls.
//
//   const gr = graph({ height: 120, label: 'Amp envelope', draw(g, w, h) {...},
//     down(pt) { return dragObjectOrNull }, move(pt, drag) {...}, up(pt, drag) {...}, hover(pt) { return 'grab' } });
//   card.append(gr.el); ... gr.redraw();
//
// pt = { x, y, w, h, dx, dy, e } in CSS pixels; dx/dy are from where the drag started.
// down() returning a truthy value starts a drag (pointer captured, page scroll blocked);
// returning nothing lets the gesture through. Every move/up redraws automatically.
import { h } from './dom.js';

const live = new Set();
const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((entries) => {
  for (const en of entries) { const gr = en.target.__graph; if (gr) gr.resize(); }
}) : null;

// Forget graphs whose element left the page (screens re-render often).
function prune() {
  for (const gr of live) if (!gr.el.isConnected && gr.mounted) { live.delete(gr); if (ro) ro.unobserve(gr.el); }
}

let C = null;
// Theme colours, read once from the CSS custom properties.
export function colors() {
  if (C) return C;
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => (cs.getPropertyValue(n).trim() || d);
  C = {
    bg: v('--bg', '#0a0c12'), panel: v('--panel', '#131722'), panel2: v('--panel2', '#1b2130'), line: v('--line', '#2a3245'),
    text: v('--text', '#eef1f6'), muted: v('--muted', '#8d97ab'), accent: v('--accent', '#F06617'), glow: v('--glow', '#ff8a3d'),
    blue: v('--blue', '#4da3ff'), solo: v('--solo', '#f5c542'), mute: v('--mute', '#ff5c5c'), teal: '#2fc4b2', grid: 'rgba(141,151,171,.14)',
  };
  return C;
}

export function graph({ height = 120, label = 'Graph', className = '', draw, down, move, up, hover, wheel } = {}) {
  const canvas = h('canvas', { class: 'graph-canvas', role: 'img', 'aria-label': label });
  const el = h('div', { class: 'graph ' + className, style: { height: typeof height === 'number' ? height + 'px' : height } }, canvas);
  const g = canvas.getContext('2d');
  const gr = { el, canvas, g, w: 0, h: 0, drag: null, mounted: false };
  el.__graph = gr;

  // gr.z: the desktop Display size zooms the root with CSS zoom; rects and pointer positions come
  // in screen pixels, so the bitmap is sized in those while drawing and hit-testing stay in CSS
  // pixels (text and handles grow with the page). The canvas's own box, not the .graph's, so
  // the 1 px border doesn't squash the drawing.
  gr.z = 1;
  gr.resize = () => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    let z = canvas.offsetWidth ? r.width / canvas.offsetWidth : 1;
    // offsetWidth is whole pixels: snap to the zoom steps (1, 1.25, 1.5…)
    z = Math.abs(z - 1) < 0.01 ? 1 : Math.round(z * 100) / 100;
    gr.z = z;
    gr.w = r.width / z;
    gr.h = r.height / z;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    g.setTransform(dpr * z, 0, 0, dpr * z, 0, 0);
    gr.redraw();
  };
  gr.redraw = () => {
    if (!gr.w) return;
    g.clearRect(0, 0, gr.w, gr.h);
    if (draw) draw(g, gr.w, gr.h, gr);
  };

  let start = null;
  let pid = null; // the pointer that owns the drag: a second finger doesn't take it over
  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / gr.z;
    const y = (e.clientY - r.top) / gr.z;
    return { x, y, w: gr.w, h: gr.h, dx: start ? x - start.x : 0, dy: start ? y - start.y : 0, e };
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!down) return;
    if (gr.drag) {
      if (e.pointerType === 'touch' && e.pointerId !== pid) return;
      finish(e); // the last drag's pointerup never came (no capture): close it first
    }
    start = null;
    const pt = local(e);
    const d = down(pt, e);
    if (!d) return;
    e.preventDefault();
    start = { x: pt.x, y: pt.y };
    gr.drag = d;
    pid = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* old Safari */ }
    gr.redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (gr.drag) { if (e.pointerId !== pid) return; if (move) move(local(e), gr.drag, e); gr.redraw(); return; }
    if (hover) canvas.style.cursor = hover(local(e)) || '';
  });
  function finish(e) {
    const d = gr.drag;
    gr.drag = null;
    pid = null;
    if (up) up(local(e), d, e);
    start = null;
    gr.redraw();
  }
  const end = (e) => { if (gr.drag && e.pointerId === pid) finish(e); };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  if (wheel) canvas.addEventListener('wheel', (e) => { if (wheel(local(e), e) !== false) { e.preventDefault(); gr.redraw(); } }, { passive: false });

  prune();
  live.add(gr);
  if (ro) ro.observe(el);
  requestAnimationFrame(() => { gr.mounted = true; gr.resize(); });
  return gr;
}

// ---- helpers ------------------------------------------------------------------------------
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// log-scale position 0..1 of v between min and max, and back
export const logPos = (v, min, max) => Math.log(v / min) / Math.log(max / min);
export const logVal = (u, min, max) => min * (max / min) ** u;

// faint grid: xs and ys are positions in pixels
export function gridLines(g, w, h, xs = [], ys = []) {
  const c = colors();
  g.fillStyle = c.grid;
  for (const x of xs) g.fillRect(Math.round(x), 0, 1, h);
  for (const y of ys) g.fillRect(0, Math.round(y), w, 1);
}

// a draggable handle; active = being dragged or hovered
export function handle(g, x, y, { active = false, color } = {}) {
  const c = colors();
  g.beginPath();
  g.arc(x, y, active ? 8 : 6, 0, Math.PI * 2);
  g.fillStyle = active ? (color || c.accent) : c.text;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = color || c.accent;
  g.stroke();
}

export function text(g, s, x, y, { align = 'left', base = 'alphabetic', color, size = 10.5, weight = 600 } = {}) {
  g.font = `${weight} ${size}px -apple-system, "Segoe UI", system-ui, sans-serif`;
  g.textAlign = align;
  g.textBaseline = base;
  g.fillStyle = color || colors().muted;
  g.fillText(s, x, y);
}

// stroke a polyline [[x,y]...] and optionally fill under it to the baseline y0
export function curve(g, pts, { color, width = 2, fill = null, y0 = null } = {}) {
  if (!pts.length) return;
  const c = colors();
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  if (fill && y0 != null) {
    g.save();
    g.lineTo(pts[pts.length - 1][0], y0);
    g.lineTo(pts[0][0], y0);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.restore();
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  }
  g.lineWidth = width;
  g.lineJoin = 'round';
  g.strokeStyle = color || c.accent;
  g.stroke();
}

// index of the point nearest pt within r pixels, or -1. points: [{x, y}]
export function nearest(points, pt, r = 18) {
  let best = -1;
  let bd = r * r;
  points.forEach((p, i) => { const d = (p.x - pt.x) ** 2 + (p.y - pt.y) ** 2; if (d <= bd) { bd = d; best = i; } });
  return best;
}
