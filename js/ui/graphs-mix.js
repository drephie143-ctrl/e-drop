// Mix visual editors: master EQ and dynamics, loudness history, reverb, delay, sidechain pump
// and the mix stage. Each one draws what the engine really does (js/audio/engine.js buildMix and
// applyMix, js/audio/fx.js makeIR, makePingPong and pumpShape), so the picture matches the sound.
// A drag edits the project directly, moves the linked slider through sync(key, v), and commits
// the way that slider does: app.mixChanged() live, app.pumpChanged() or app.structureChanged()
// once on release. Double-tap a handle to reset it; the mouse wheel over a handle nudges it by
// the arrow step level (1 small, 2 medium, 3 large); Shift-drag is fine control.
import { graph, colors, clamp, logPos, logVal, handle, text, curve, nearest } from './graph-base.js';
import { h, increments, getStepLevel, fmtDb, fmtPct, fmtSec } from './dom.js';
import { pumpShape, DELAY_TIMES } from '../audio/fx.js';
import { MASTER_DEFAULT, newTrack } from '../music/project.js';

// ---- small helpers ---------------------------------------------------------------------------
const toDb = (g) => (g > 1e-6 ? 20 * Math.log10(g) : -120);
const minus = (s) => String(s).replace('-', '−');
const sz = (w) => (w >= 640 ? 11.5 : 10.5); // canvas label size, a touch bigger on wide graphs
const FONT = '-apple-system, "Segoe UI", system-ui, sans-serif';

function rgba(hex, a) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex).trim());
  return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})` : hex;
}
function rrect(g, x, y, w, ht, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, ht, r);
  else g.rect(x, y, w, ht);
}
function dash(g, x0, y0, x1, y1, color, pattern = [4, 4], width = 1) {
  g.save();
  g.setLineDash(pattern);
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.restore();
}
function clipTo(g, geo) {
  g.save();
  g.beginPath();
  g.rect(geo.l, geo.t, geo.w, geo.h);
  g.clip();
}
// x of the first crossing of an increasing function with target, by bisection
function invert(fn, target, lo, hi) {
  if (fn(lo) >= target) return lo;
  if (fn(hi) <= target) return hi;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (fn(m) < target) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
// small readout pill next to the handle being dragged or hovered
function tag(g, s, x, y, w, ht, color) {
  g.font = `700 11px ${FONT}`;
  const tw = Math.ceil(g.measureText(s).width) + 14;
  const th = 20;
  const tx = clamp(x - tw / 2, 3, Math.max(3, w - tw - 3));
  let ty = y - th - 12;
  if (ty < 3) ty = y + 13;
  ty = clamp(ty, 3, Math.max(3, ht - th - 3));
  rrect(g, tx, ty, tw, th, 6);
  g.fillStyle = 'rgba(10, 12, 18, .92)';
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = color || colors().accent;
  g.stroke();
  text(g, s, tx + tw / 2, ty + th / 2 + 0.5, { align: 'center', base: 'middle', color: '#fff', size: 11, weight: 700 });
}
// handle caption (LOW, DRIVE…) under the handle, or above it, whichever fits
function caption(g, s, x, y, w, ht, color, prefer = 'below') {
  let tx = x + 11;
  let ty = y;
  let align = 'left';
  if (prefer !== 'right') {
    const below = prefer === 'below' ? y + 22 <= ht - 18 : y - 20 < 2;
    tx = clamp(x, 18, w - 18);
    ty = below ? y + 15 : y - 15;
    align = 'center';
  }
  // a dark halo keeps the caption readable over curves and bars
  g.font = `800 ${sz(w) - 1.5}px ${FONT}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(15, 19, 28, .85)';
  g.strokeText(s, tx, ty);
  g.fillStyle = color;
  g.fillText(s, tx, ty);
}

// The desktop Display size zooms the root with CSS zoom. graph-base now draws and hit-tests in
// CSS pixels itself (gr.z), so z comes out 1 here; this stays as a guard for a canvas sized in
// screen pixels, so labels, handles and hit areas always grow with everything else.
function zoomOf(gr) {
  const ow = gr.canvas.offsetWidth;
  const z = ow > 0 && gr.w > 0 ? gr.w / ow : 1;
  return Math.abs(z - 1) < 0.01 ? 1 : z;
}
function zoomedDraw(gr, fn) {
  return (g, w, ht) => {
    const z = zoomOf(gr);
    if (z === 1) { fn(g, w, ht); return; }
    g.save();
    g.scale(z, z);
    fn(g, w / z, ht / z);
    g.restore();
  };
}
function unzoom(gr, pt) {
  const z = zoomOf(gr);
  return z === 1 ? pt : { ...pt, x: pt.x / z, y: pt.y / z, w: pt.w / z, h: pt.h / z, dx: pt.dx / z, dy: pt.dy / z };
}

// A value a graph edits: clamped and rounded like its slider, which is moved along with it.
function prm(obj, key, min, max, step, sync, skey = key) {
  const dec = (String(step).split('.')[1] || '').length;
  const incs = increments(min, max, step);
  const P = {
    get: () => obj[key],
    set(v) {
      v = clamp(+(min + Math.round((clamp(v, min, max) - min) / step) * step).toFixed(dec), min, max);
      obj[key] = v;
      if (sync) sync(skey, v);
      return v;
    },
    nudge: (dir, level) => P.set(obj[key] + dir * incs[clamp(level, 1, 3) - 1]),
  };
  return P;
}

// ---- one animation loop for the live parts, running only while they are on screen ------------
const live = new Set();
let raf = 0;
let loopApp = null;
let lastPlaying = -1e9;
const io = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver((ents) => {
    for (const en of ents) { const it = en.target.__mxLive; if (it) it.on = en.isIntersecting; }
    wake();
  })
  : null;

// Loudness history: short-term and momentary LUFS, one point per 100 ms of playing time.
const HIST_MS = 30000;
const hist = { pts: [], clock: 0, wall: 0, next: 0, gap: true, dirty: true };
const wired = new WeakSet();
function wire(app) {
  if (wired.has(app) || !app.on) return;
  wired.add(app);
  app.on('play', () => { hist.gap = true; wake(); });
  app.on('stop', () => { hist.gap = true; hist.wall = 0; wake(); });
  app.on('open', () => { Object.assign(hist, { pts: [], clock: 0, wall: 0, next: 0, gap: true, dirty: true }); });
  app.on('tab', wake);
  app.on('render', wake);
}
function sample(app, now) {
  if (!app || !app.engine.playing) { hist.wall = 0; return; }
  if (hist.wall) hist.clock += Math.min(200, Math.max(0, now - hist.wall));
  hist.wall = now;
  const L = app.meterNow; // set by main.js every frame while the Mix panel is on screen
  if (!L || hist.clock < hist.next) return;
  hist.next = hist.clock + 100;
  hist.pts.push({ t: hist.clock, s: L.s, m: L.m, gap: hist.gap });
  hist.gap = false;
  while (hist.pts.length && hist.pts[0].t < hist.clock - HIST_MS - 1000) hist.pts.shift();
  hist.dirty = true;
}

// Register a live element: tick(now) runs every frame while the element is on screen.
export function addLive(app, el, tick) {
  loopApp = app;
  wire(app);
  const it = { el, tick, on: !io, seen: false, born: performance.now() };
  el.__mxLive = it;
  live.add(it);
  if (io) io.observe(el);
  wake();
  return it;
}
function wake() { if (!raf && live.size) raf = requestAnimationFrame(loop); }
function loop(now) {
  raf = 0;
  let any = false;
  let waiting = false;
  for (const it of live) {
    if (!it.el.isConnected) {
      // gone with a re-render (or never attached): forget it
      if (it.seen || now - it.born > 1500) { live.delete(it); if (io) io.unobserve(it.el); } else waiting = true;
      continue;
    }
    it.seen = true;
    if (it.on) any = true;
  }
  if (any) {
    sample(loopApp, now);
    for (const it of live) {
      if (!it.on || !it.el.isConnected) continue;
      try { it.tick(now); } catch (e) { console.error(e); it.tick = () => {}; }
    }
  }
  if (loopApp && loopApp.engine.playing) lastPlaying = now;
  // Keep going while the song plays (and a moment after, to clear playheads); otherwise sleep
  // until play, a re-render, a tab change or something scrolling into view wakes it.
  if ((any && now - lastPlaying < 1000) || waiting) wake();
}
// redraw a graph every `every` frames while the song plays, and once more when it stops
function whilePlaying(app, gr, every, before) {
  let n = 0;
  let was = false;
  addLive(app, gr.el, () => {
    const on = app.engine.playing;
    if (!on && !was) return;
    if (on && was && ++n % every) return;
    was = on;
    if (before) before(on);
    gr.redraw();
  });
}

// ---- interaction layer: a graph whose handles are parameters ----------------------------------
// layout(w, h) sets the geometry and returns the handles: { id, x, y, color, cursor, commit
// ('live' | 'pump' | 'structure'), value(), drag(q, d), nudge(dir, level), reset(), tag() }.
// drag gets q = the handle's virtual position (pointer movement, quartered with Shift).
function editor(app, o) {
  const st = { active: null, hover: null, hs: [], tap: null, wacc: 0, wt: null, ref: null };
  const lay = (w, ht) => (st.hs = (o.layout(w, ht, st) || []).filter((k) => k && !k.off));
  const radius = (pt) => (pt.e && pt.e.pointerType === 'touch' ? 28 : 20);
  const hit = (pt) => {
    const hs = lay(pt.w, pt.h);
    const i = nearest(hs, pt, radius(pt)); // ties go to the last (top-most) handle
    return i >= 0 ? hs[i] : null;
  };
  const commit = (k) => {
    if (k.commit === 'pump') app.pumpChanged();
    else if (k.commit === 'structure') app.structureChanged();
    else app.mixChanged();
  };
  const gr = graph({
    height: o.height,
    label: o.label,
    className: 'mx-graph ' + (o.className || ''),
    draw: (g, w, ht) => paint(g, w, ht),
    down(pt) {
      pt = unzoom(gr, pt);
      let k = hit(pt);
      // a second tap on the same handle right after a first one resets it
      if (k && k.reset && st.tap && st.tap.id === k.id && performance.now() - st.tap.t < 350) {
        st.tap = null;
        const v0 = k.value ? k.value() : NaN;
        k.reset();
        // a reverb reset rebuilds the engine and re-renders: skip it when nothing changed
        if (!k.value || k.value() !== v0) commit(k);
        if (o.changed) o.changed(k);
        gr.redraw();
        return null;
      }
      if (!k && o.fallback) k = o.fallback(pt);
      if (!k) return null;
      st.active = k.id;
      st.ref = k;
      return { k, t0: performance.now(), hx: k.x, hy: k.y, v0: k.value ? k.value() : NaN, ...(k.grab ? k.grab(pt) : {}) };
    },
    move(pt, d) {
      pt = unzoom(gr, pt);
      const f = pt.e && pt.e.shiftKey ? 0.25 : 1;
      d.k.drag({ x: d.hx + pt.dx * f, y: d.hy + pt.dy * f, dx: pt.dx * f, dy: pt.dy * f, e: pt.e }, d);
      if (!d.k.commit || d.k.commit === 'live') app.mixChanged();
      if (o.changed) o.changed(d.k);
    },
    up(pt, d) {
      pt = unzoom(gr, pt);
      st.active = null;
      st.ref = null;
      const now = performance.now();
      st.tap = d.k.reset && Math.hypot(pt.dx, pt.dy) < 5 && now - d.t0 < 300 ? { id: d.k.id, t: now } : null;
      // the expensive commits (reverb rebuild, pump re-render) only when something changed
      if (d.k.commit && d.k.commit !== 'live' && d.k.value && d.k.value() !== d.v0) commit(d.k);
      if (o.changed) o.changed(null);
    },
    hover(pt) {
      pt = unzoom(gr, pt);
      const k = hit(pt);
      const id = k ? k.id : null;
      if (id !== st.hover) { st.hover = id; gr.redraw(); }
      return k ? k.cursor || 'grab' : (o.cursor ? o.cursor(pt) : '');
    },
    wheel(pt, e) {
      pt = unzoom(gr, pt);
      const k = hit(pt);
      if (!k || !k.nudge) return false; // not over a handle: let the page scroll
      st.wacc += e.deltaY || e.deltaX;
      if (Math.abs(st.wacc) < 30 && e.deltaMode === 0) return true;
      const dir = st.wacc < 0 ? 1 : -1;
      st.wacc = 0;
      k.nudge(dir, e.shiftKey ? 3 : e.altKey ? 1 : getStepLevel());
      st.hover = k.id;
      if (o.changed) o.changed(k);
      if (!k.commit || k.commit === 'live') app.mixChanged();
      else { clearTimeout(st.wt); st.wt = setTimeout(() => commit(k), 400); }
      return true;
    },
  });
  const paint = zoomedDraw(gr, (g, w, ht) => {
    lay(w, ht);
    o.draw(g, w, ht, st);
    if (o.handles !== false) for (const k of st.hs) handle(g, k.x, k.y, { active: st.active === k.id || st.hover === k.id, color: k.color });
    const id = st.active || st.hover;
    const k = id && (st.hs.find((x) => x.id === id) || (st.ref && st.ref.id === id ? st.ref : null));
    if (k && k.tag) tag(g, k.tag(), k.x, k.y, w, ht, k.color);
  });
  gr.canvas.addEventListener('pointerleave', () => { if (st.hover && !st.active) { st.hover = null; gr.redraw(); } });
  // The canvas lets the page scroll on touch (mix.css); a touch that grabbed a handle stops it.
  const stopScroll = (e) => { if (gr.drag && e.cancelable) e.preventDefault(); };
  gr.canvas.addEventListener('touchstart', stopScroll, { passive: false });
  gr.canvas.addEventListener('touchmove', stopScroll, { passive: false });
  gr.st = st;
  return gr;
}

// ---- master EQ ---------------------------------------------------------------------------------
// The three bands exactly as buildMix makes them (low shelf 90 Hz, peaking 1.5 kHz Q 0.8, high
// shelf 9 kHz), with Web Audio's biquad formulas (shelf slope S = 1), summed.
const EQ_BANDS = [
  { key: 'low', name: 'Low', type: 'lowshelf', f: 90, q: 1, upTo: 300 },
  { key: 'mid', name: 'Mid', type: 'peaking', f: 1500, q: 0.8, upTo: 4500 },
  { key: 'high', name: 'High', type: 'highshelf', f: 9000, q: 1, upTo: Infinity },
];
export function biquadDb(type, f0, gain, q, f, sr) {
  const A = 10 ** (gain / 40);
  const w0 = (2 * Math.PI * f0) / sr;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'peaking') {
    const aq = sw / (2 * q);
    b0 = 1 + aq * A; b1 = -2 * cw; b2 = 1 - aq * A;
    a0 = 1 + aq / A; a1 = -2 * cw; a2 = 1 - aq / A;
  } else {
    const s2 = 2 * Math.sqrt(A) * (sw / 2) * Math.SQRT2;
    if (type === 'lowshelf') {
      b0 = A * ((A + 1) - (A - 1) * cw + s2); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s2);
      a0 = (A + 1) + (A - 1) * cw + s2; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s2;
    } else {
      b0 = A * ((A + 1) + (A - 1) * cw + s2); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s2);
      a0 = (A + 1) - (A - 1) * cw + s2; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s2;
    }
  }
  const w = (2 * Math.PI * f) / sr;
  const c1 = Math.cos(w); const s1 = Math.sin(w); const c2 = Math.cos(2 * w); const s2b = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2; const ni = -(b1 * s1 + b2 * s2b);
  const dr = a0 + a1 * c1 + a2 * c2; const di = -(a1 * s1 + a2 * s2b);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

export function eqGraph(app, { sync }) {
  const M = app.project.master;
  const sr = app.engine.sr || 48000;
  const R = 9; // dB shown above and below 0
  const F0 = 20;
  const F1 = 20000;
  const geo = {};
  const X = (f) => geo.l + logPos(f, F0, F1) * geo.w;
  const Y = (db) => geo.t + ((R - db) / (2 * R)) * geo.h;
  const col = () => { const c = colors(); return { low: c.blue, mid: c.teal, high: c.solo }; };
  const P = Object.fromEntries(EQ_BANDS.map((b) => [b.key, prm(M, b.key, -6, 6, 0.1, sync)]));
  const spec = { on: false, a: null, b: null, db: null, binHz: 0 };
  const bandHandle = (b) => ({
    id: b.key, color: col()[b.key], cursor: 'ns-resize', commit: 'live',
    x: X(b.f), y: Y(M[b.key]),
    value: () => M[b.key],
    grab: () => ({ v: M[b.key] }),
    drag(q, d) { let v = d.v - q.dy / (geo.h / (2 * R)); if (Math.abs(v) < 0.15) v = 0; P[b.key].set(v); },
    nudge: (dir, lv) => P[b.key].nudge(dir, lv),
    reset: () => P[b.key].set(MASTER_DEFAULT[b.key]),
    tag: () => `${b.name} ${minus(fmtDb(M[b.key]))}`,
  });
  const gr = editor(app, {
    height: 'var(--mx-h-eq, 132px)',
    label: 'Master EQ curve. Drag the Low, Mid and High handles up or down.',
    layout(w, ht) {
      Object.assign(geo, { l: 26, t: 8, w: w - 26 - 8, h: ht - 8 - 18 });
      return EQ_BANDS.map(bandHandle);
    },
    // with a mouse, anywhere in a band's zone grabs that band (no jump: it moves from where it is)
    fallback(pt) {
      if (pt.e && pt.e.pointerType === 'touch') return null;
      const f = logVal(clamp((pt.x - geo.l) / geo.w, 0, 1), F0, F1);
      return bandHandle(EQ_BANDS.find((b) => f < b.upTo));
    },
    cursor: () => 'ns-resize',
    draw(g, w, ht) {
      const c = colors();
      const fs = sz(w);
      const bot = geo.t + geo.h;
      g.fillStyle = c.grid;
      for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) g.fillRect(Math.round(X(f)), geo.t, 1, geo.h);
      for (const d of [-6, -3, 3, 6]) g.fillRect(geo.l, Math.round(Y(d)), geo.w, 1);
      g.fillStyle = 'rgba(141, 151, 171, .32)';
      g.fillRect(geo.l, Math.round(Y(0)), geo.w, 1);
      let lastX = -99;
      for (const [f, s] of [[50, '50'], [100, '100'], [200, '200'], [500, '500'], [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']]) {
        const x = X(f);
        if (x - lastX < 25) continue;
        lastX = x;
        text(g, s, x, bot + 13, { align: 'center', size: fs - 1 });
      }
      for (const d of [6, 0, -6]) text(g, d > 0 ? `+${d}` : minus(d), geo.l - 5, Y(d), { align: 'right', base: 'middle', size: fs - 1 });
      clipTo(g, geo);
      if (spec.on) drawSpectrum(g, geo, spec, F0, F1);
      // each band's own response, then the sum
      const N = Math.max(80, Math.round(geo.w / 3));
      const fx = Array.from({ length: N + 1 }, (_, i) => logVal(i / N, F0, F1));
      const per = EQ_BANDS.map((b) => fx.map((f) => biquadDb(b.type, b.f, M[b.key], b.q, f, sr)));
      const cc = col();
      per.forEach((arr, i) => {
        if (Math.abs(M[EQ_BANDS[i].key]) < 0.05) return;
        curve(g, arr.map((d, j) => [X(fx[j]), Y(d)]), { color: rgba(cc[EQ_BANDS[i].key], 0.55), width: 1.25 });
      });
      curve(g, fx.map((f, j) => [X(f), Y(per[0][j] + per[1][j] + per[2][j])]), { color: c.accent, width: 2.25, fill: rgba(c.accent, 0.14), y0: Y(0) });
      g.restore();
      for (const b of EQ_BANDS) caption(g, b.name.toUpperCase(), X(b.f), Y(M[b.key]), w, ht, cc[b.key]);
    },
  });
  // live spectrum of the master output behind the curve while the song plays
  whilePlaying(app, gr, 2, (on) => {
    const m = app.engine.m;
    spec.on = false;
    if (!on || !m || !m.pAn) return;
    const [a, b] = m.pAn;
    const n = a.frequencyBinCount;
    if (!spec.a || spec.a.length !== n) { spec.a = new Float32Array(n); spec.b = new Float32Array(n); spec.db = new Float32Array(n); }
    a.getFloatFrequencyData(spec.a);
    b.getFloatFrequencyData(spec.b);
    for (let i = 0; i < n; i++) {
      const v = (spec.a[i] + spec.b[i]) / 2;
      spec.db[i] = Number.isFinite(v) ? v : -200;
    }
    spec.binHz = sr / a.fftSize;
    spec.on = true;
  });
  return gr;
}

// Analyser magnitudes with a +3 dB/octave tilt (so a mix reads roughly flat), as a soft shape.
function drawSpectrum(g, geo, spec, F0, F1) {
  const LO = -92;
  const HI = -12;
  const n = spec.db.length;
  const at = (f) => {
    const k = f / spec.binHz;
    const i = Math.floor(k);
    if (i >= n - 1) return spec.db[n - 1];
    return spec.db[i] + (spec.db[i + 1] - spec.db[i]) * (k - i);
  };
  const bot = geo.t + geo.h;
  g.beginPath();
  g.moveTo(geo.l, bot);
  for (let x = 0; x <= geo.w; x += 2) {
    const fa = logVal(x / geo.w, F0, F1);
    const fb = logVal(Math.min(1, (x + 2) / geo.w), F0, F1);
    let v = at(fa);
    for (let k = Math.ceil(fa / spec.binHz); k * spec.binHz < fb && k < n; k++) v = Math.max(v, spec.db[k]);
    v += 3 * Math.log2(fa / 1000);
    g.lineTo(geo.l + x, bot - clamp((v - LO) / (HI - LO), 0, 1) * geo.h);
  }
  g.lineTo(geo.l + geo.w, bot);
  g.closePath();
  g.fillStyle = 'rgba(141, 151, 171, .17)';
  g.fill();
  g.strokeStyle = 'rgba(141, 151, 171, .35)';
  g.lineWidth = 1;
  g.stroke();
}

// ---- master dynamics ---------------------------------------------------------------------------
// Static input → output curve of the master chain as applyMix sets it: glue compressor (threshold
// −6 … −24 dB, ratio 1.5 … 4, 6 dB knee, its auto make-up undone), drive gain, the limiter
// (−1.5 dB threshold, 20:1, its make-up and the output trim) and the output level.
const glueT = (v) => -6 - v * 18;
const glueR = (v) => 1.5 + v * 2.5;
function comp(x, T, W, R) {
  if (x <= T) return x;
  if (W > 0 && x < T + W) return x + ((1 / R - 1) * (x - T) ** 2) / (2 * W);
  return W > 0 ? T + W / 2 + W / (2 * R) + (x - T - W) / R : T + (x - T) / R;
}
const LIM_T = -1.5;
const LIM_R = 20;
const LIM_MAKEUP = -0.6 * LIM_T * (1 - 1 / LIM_R);

export function dynGraph(app, { sync }) {
  const M = app.project.master;
  const LO = -36;
  const HI = 6;
  const DRIVE_AT = -30; // input level where the Drive handle sits on the curve
  const geo = {};
  const X = (db) => geo.l + ((db - LO) / (HI - LO)) * geo.w;
  const Y = (db) => geo.t + ((HI - db) / (HI - LO)) * geo.h;
  const colX = (w) => w - 25; // the ceiling fader column at the right edge
  const cY = (v) => geo.t + (-v / 3) * geo.h; // 0 dB at the top, −3 dB at the bottom
  const P = { glue: prm(M, 'glue', 0, 1, 0.01, sync), drive: prm(M, 'drive', 0, 9, 0.1, sync), ceiling: prm(M, 'ceiling', -3, -0.1, 0.1, sync) };
  const glue = (x) => comp(x, glueT(M.glue), 6, glueR(M.glue));
  const chain = (x) => comp(glue(x) + M.drive, LIM_T, 0, LIM_R) + LIM_MAKEUP + (M.ceiling + 1.5 - LIM_MAKEUP - 0.7) + toDb(M.volume);
  const meter = { peak: null, gr: 0 };
  const gr = editor(app, {
    height: 'var(--mx-h-dyn, 150px)',
    label: 'Master dynamics: input to output curve. Drag Glue sideways, Drive up or down, and the Ceiling fader.',
    layout(w, ht) {
      Object.assign(geo, { l: 26, t: 8, w: w - 26 - 36, h: ht - 8 - 18 });
      const c = colors();
      const T = glueT(M.glue);
      return [
        {
          id: 'glue', color: c.teal, cursor: 'ew-resize', commit: 'live', x: X(T), y: Y(T),
          value: () => M.glue,
          grab: () => ({ T: glueT(M.glue) }),
          drag(q, d) { P.glue.set((-6 - clamp(d.T + q.dx / (geo.w / (HI - LO)), -24, -6)) / 18); },
          nudge: (dir, lv) => P.glue.nudge(dir, lv),
          reset: () => P.glue.set(MASTER_DEFAULT.glue),
          tag: () => `Glue ${fmtPct(M.glue)} · ${minus(glueT(M.glue).toFixed(1))} dB · ${glueR(M.glue).toFixed(1)}:1`,
        },
        {
          id: 'drive', color: c.accent, cursor: 'ns-resize', commit: 'live', x: X(DRIVE_AT), y: Y(chain(DRIVE_AT)),
          value: () => M.drive,
          grab: () => ({ v: M.drive }),
          drag(q, d) { P.drive.set(d.v - q.dy / (geo.h / (HI - LO))); },
          nudge: (dir, lv) => P.drive.nudge(dir, lv),
          reset: () => P.drive.set(MASTER_DEFAULT.drive),
          tag: () => `Drive +${M.drive.toFixed(1)} dB`,
        },
        {
          id: 'ceiling', color: c.mute, cursor: 'ns-resize', commit: 'live', x: colX(w), y: cY(M.ceiling),
          value: () => M.ceiling,
          drag(q) { P.ceiling.set(-((q.y - geo.t) / geo.h) * 3); },
          nudge: (dir, lv) => P.ceiling.nudge(dir, lv),
          reset: () => P.ceiling.set(MASTER_DEFAULT.ceiling),
          tag: () => `Ceiling ${minus(M.ceiling.toFixed(1))} dBFS`,
        },
      ];
    },
    draw(g, w, ht) {
      const c = colors();
      const fs = sz(w);
      const bot = geo.t + geo.h;
      const right = geo.l + geo.w;
      g.fillStyle = c.grid;
      for (let d = -30; d <= 0; d += 6) { g.fillRect(Math.round(X(d)), geo.t, 1, geo.h); g.fillRect(geo.l, Math.round(Y(d)), geo.w, 1); }
      for (const d of [-24, -12, 0]) {
        text(g, minus(d), X(d), bot + 13, { align: 'center', size: fs - 1 });
        text(g, minus(d), geo.l - 5, Y(d), { align: 'right', base: 'middle', size: fs - 1 });
      }
      text(g, 'IN dB', geo.l + 2, bot + 13, { size: fs - 1.5, weight: 800 });
      text(g, 'OUT', geo.l + 5, geo.t + 11, { size: fs - 1.5, weight: 800 });
      clipTo(g, geo);
      // where Drive pushes the glued signal past the limiter's threshold
      const xl = invert((x) => glue(x) + M.drive, LIM_T, LO - 60, HI + 80);
      if (xl < HI) {
        const x0 = X(Math.max(LO, xl));
        g.fillStyle = rgba(c.mute, 0.08);
        g.fillRect(x0, geo.t, right - x0, geo.h);
        if (right - x0 > 58) text(g, 'LIMITING', right - 4, geo.t + 11, { align: 'right', size: fs - 2, color: rgba(c.mute, 0.85), weight: 800 });
      }
      dash(g, X(LO), Y(LO), X(HI), Y(HI), 'rgba(141, 151, 171, .35)');
      dash(g, geo.l, Y(M.ceiling), right, Y(M.ceiling), rgba(c.mute, 0.85), [5, 4], 1.25);
      const N = Math.max(80, Math.round(geo.w / 2));
      const xs = Array.from({ length: N + 1 }, (_, i) => LO + (i / N) * (HI - LO));
      curve(g, xs.map((x) => [X(x), Y(glue(x))]), { color: rgba(c.teal, 0.8), width: 1.5 });
      curve(g, xs.map((x) => [X(x), Y(chain(x))]), { color: c.accent, width: 2.5 });
      // live: where the output peak sits on the curve, and the limiter's gain reduction
      if (meter.peak != null && meter.peak > LO) {
        // limiter overshoot puts live peaks above the static curve's top: keep the dot in view,
        // clear of the gain-reduction bar at the right edge
        const x = Math.min(right - 12, X(invert(chain, meter.peak, LO - 60, HI + 80)));
        const y = Y(Math.min(meter.peak, HI));
        g.beginPath();
        g.arc(x, y, 9, 0, Math.PI * 2);
        g.fillStyle = rgba(c.glow, 0.25);
        g.fill();
        g.beginPath();
        g.arc(x, y, 4, 0, Math.PI * 2);
        g.fillStyle = '#fff';
        g.fill();
      }
      if (meter.gr < -0.1) {
        g.fillStyle = rgba(c.mute, 0.85);
        g.fillRect(right - 5, geo.t, 4, Math.min(1, -meter.gr / 12) * geo.h);
      }
      g.restore();
      caption(g, 'GLUE', X(glueT(M.glue)), Y(glueT(M.glue)), w, ht, c.teal);
      caption(g, 'DRIVE', X(DRIVE_AT), Y(chain(DRIVE_AT)), w, ht, c.accent);
      // ceiling fader: −3 … 0 dBFS
      const cx = colX(w);
      rrect(g, cx - 8, geo.t, 16, geo.h, 6);
      g.fillStyle = c.panel2;
      g.fill();
      rrect(g, cx - 8, cY(M.ceiling), 16, bot - cY(M.ceiling), 6);
      g.fillStyle = rgba(c.mute, 0.28);
      g.fill();
      g.fillStyle = 'rgba(141, 151, 171, .45)';
      for (const v of [-1, -2]) g.fillRect(cx - 8, Math.round(cY(v)), 4, 1);
      text(g, 'CEIL', cx, bot + 13, { align: 'center', size: fs - 2, color: c.mute, weight: 800 });
    },
  });
  whilePlaying(app, gr, 2, (on) => {
    const L = app.meterNow;
    meter.peak = on && L && L.peak > 1e-4 ? toDb(L.peak) : null;
    meter.gr = on && L && L.gr ? L.gr : 0;
  });
  return gr;
}

// ---- loudness history --------------------------------------------------------------------------
export function loudGraph(app) {
  const LO = -36;
  const HI = -3;
  const gr = graph({
    height: 'var(--mx-h-loud, 100px)',
    label: 'Short-term loudness over the last 30 seconds, with the −9 LUFS club and −14 LUFS streaming lines',
    className: 'mx-graph mx-loud',
    draw: (g, w, ht) => paint(g, w, ht),
  });
  const paint = zoomedDraw(gr, (g, w, ht) => {
    const c = colors();
    const fs = sz(w);
    const geo = { l: 28, t: 6, w: w - 28 - 66, h: ht - 6 - 17 };
    const bot = geo.t + geo.h;
    const right = geo.l + geo.w;
    const Y = (v) => geo.t + ((HI - v) / (HI - LO)) * geo.h;
    const X = (t) => right - ((hist.clock - t) / HIST_MS) * geo.w;
    g.fillStyle = c.grid;
    for (let v = -30; v <= -6; v += 6) g.fillRect(geo.l, Math.round(Y(v)), geo.w, 1);
    for (let s = 10; s < 30; s += 10) g.fillRect(Math.round(right - (s / 30) * geo.w), geo.t, 1, geo.h);
    for (const v of [-6, -18, -30]) text(g, minus(v), geo.l - 5, Y(v), { align: 'right', base: 'middle', size: fs - 1 });
    for (const [s, lb] of [[30, '−30 s'], [20, '−20 s'], [10, '−10 s'], [0, 'now']]) text(g, lb, right - (s / 30) * geo.w, bot + 13, { align: s === 30 ? 'left' : s === 0 ? 'right' : 'center', size: fs - 1.5 });
    // the club zone (−9 … −6) and the two reference lines
    g.fillStyle = rgba(c.accent, 0.07);
    g.fillRect(geo.l, Y(-6), geo.w, Y(-9) - Y(-6));
    dash(g, geo.l, Y(-9), right, Y(-9), rgba(c.accent, 0.8), [5, 4], 1.25);
    dash(g, geo.l, Y(-14), right, Y(-14), rgba(c.blue, 0.75), [5, 4], 1.25);
    text(g, '−9 club', right + 6, Y(-9), { base: 'middle', size: fs - 1, color: c.accent, weight: 700 });
    text(g, '−14 stream', right + 6, Y(-14), { base: 'middle', size: fs - 1.5, color: c.blue, weight: 700 });
    const pts = hist.pts.filter((p) => p.t >= hist.clock - HIST_MS - 200);
    if (!pts.length) {
      text(g, app.engine.playing && !app.meterNow ? 'Waiting for the meter…' : 'Press play to see the last 30 s', geo.l + geo.w / 2, geo.t + geo.h / 2, { align: 'center', base: 'middle', size: fs, color: c.muted });
      return;
    }
    clipTo(g, geo);
    // split into runs at gaps (stop / play) and silence
    const runs = (key) => {
      const out = [];
      let cur = null;
      for (const p of pts) {
        const v = p[key];
        if (p.gap || !(v > -60)) { cur = null; if (!(v > -60)) continue; }
        if (!cur) out.push(cur = []);
        cur.push([X(p.t), Y(clamp(v, LO - 2, HI + 2))]);
      }
      return out;
    };
    for (const r of runs('m')) curve(g, r, { color: 'rgba(141, 151, 171, .45)', width: 1 });
    for (const r of runs('s')) curve(g, r, { color: c.accent, width: 2, fill: rgba(c.accent, 0.12), y0: bot });
    g.restore();
    const last = pts[pts.length - 1];
    if (last.s > -60) {
      const y = Y(clamp(last.s, LO, HI));
      g.beginPath();
      g.arc(X(last.t), y, 3.5, 0, Math.PI * 2);
      g.fillStyle = '#fff';
      g.fill();
    }
  });
  addLive(app, gr.el, () => { if (hist.dirty) { hist.dirty = false; gr.redraw(); } });
  hist.dirty = true;
  return gr;
}

// ---- reverb ------------------------------------------------------------------------------------
// The impulse response makeIR builds, as a time × frequency picture: −60 dB at `size` seconds,
// a one-pole low-pass that closes as the tail decays (damping), the 220 Hz high-pass on the
// return, the level of the return, and the energy normalisation (bigger rooms start quieter).
const REV_PD = 0.02;
const REV_TMAX = 6.4;
function heatColor(u) {
  const S = [[0, 14, 22, 40, 0], [0.25, 28, 62, 122, 0.55], [0.55, 60, 140, 235, 0.85], [0.8, 140, 200, 255, 0.95], [1, 235, 245, 255, 1]];
  let i = 1;
  while (i < S.length - 1 && u > S[i][0]) i++;
  const [u0, r0, g0, b0, a0] = S[i - 1];
  const [u1, r1, g1, b1, a1] = S[i];
  const k = clamp((u - u0) / (u1 - u0), 0, 1);
  return [r0 + (r1 - r0) * k, g0 + (g1 - g0) * k, b0 + (b1 - b0) * k, a0 + (a1 - a0) * k];
}

export function reverbGraph(app, { sync }) {
  const M = app.project.master;
  const sr = app.engine.sr || 48000;
  const F0 = 40;
  const F1 = Math.min(20000, sr / 2);
  const P = { revSize: prm(M, 'revSize', 0.8, 6, 0.1, sync), revDamp: prm(M, 'revDamp', 0, 1, 0.01, sync), revLevel: prm(M, 'revLevel', 0, 1.5, 0.01, sync) };
  const geo = {};
  const X = (t) => geo.l + (t / REV_TMAX) * geo.w;
  const Yf = (f) => geo.t + (1 - logPos(clamp(f, F0, F1), F0, F1)) * geo.h;
  const lvY = (v) => geo.t + (1 - v / 1.5) * geo.h;
  // one-pole coefficient over the tail (makeIR: 0.95 early, darker later), and its −3 dB point
  const coef = (pos, damp = M.revDamp) => 0.95 - damp * 0.85 * pos;
  const fc = (cf) => {
    const p = 1 - cf;
    if (p < 1e-6) return sr / 2;
    return (Math.acos(clamp((1 + p * p - 2 * cf * cf) / (2 * p), -1, 1)) * sr) / (2 * Math.PI);
  };
  const fcEnd = (damp = M.revDamp) => fc(coef(1, damp));
  const levelDb = (t, f) => {
    const n = t - REV_PD;
    if (n < 0 || n > M.revSize) return -200;
    const pos = n / M.revSize;
    const cf = coef(pos);
    const p = 1 - cf;
    const w = (2 * Math.PI * f) / sr;
    const lp = 10 * Math.log10((cf * cf) / (1 - 2 * p * Math.cos(w) + p * p));
    const r = (f / 220) ** 2; // the return's 2nd-order high-pass at 220 Hz
    const hp = 10 * Math.log10((r * r) / ((1 - r) ** 2 + r / 1.26));
    return -60 * pos + lp + hp + toDb(M.revLevel / 0.9) - 10 * Math.log10(M.revSize / 3.2) - 1;
  };
  const heat = { key: '', cv: null };
  const heatmap = (cols, rows) => {
    const key = `${M.revSize}|${M.revDamp}|${M.revLevel}|${cols}|${rows}`;
    if (heat.key === key) return heat.cv;
    const cv = heat.cv || document.createElement('canvas');
    cv.width = cols;
    cv.height = rows;
    const cg = cv.getContext('2d');
    const img = cg.createImageData(cols, rows);
    for (let j = 0; j < rows; j++) {
      const f = logVal(1 - (j + 0.5) / rows, F0, F1);
      for (let i = 0; i < cols; i++) {
        const [r, gg, b, a] = heatColor(clamp((levelDb(((i + 0.5) / cols) * REV_TMAX, f) + 60) / 63, 0, 1));
        const o = (j * cols + i) * 4;
        img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = a * 255;
      }
    }
    cg.putImageData(img, 0, 0);
    Object.assign(heat, { key, cv });
    return cv;
  };
  const gr = editor(app, {
    height: 'var(--mx-h-rev, 128px)',
    label: 'Reverb tail: time across, frequency up. Drag Size sideways, Damping up or down, and the Level fader.',
    layout(w, ht) {
      Object.assign(geo, { l: 32, t: 6, w: w - 32 - 6, h: ht - 6 - 18 });
      const c = colors();
      const xe = X(REV_PD + M.revSize);
      return [
        {
          id: 'size', color: c.blue, cursor: 'ew-resize', commit: 'structure', x: xe, y: geo.t + geo.h - 11,
          value: () => M.revSize,
          drag(q) { P.revSize.set(((q.x - geo.l) / geo.w) * REV_TMAX - REV_PD); },
          nudge: (dir, lv) => P.revSize.nudge(dir, lv),
          reset: () => P.revSize.set(MASTER_DEFAULT.revSize),
          tag: () => `Size ${fmtSec(M.revSize)}`,
        },
        {
          id: 'damp', color: c.accent, cursor: 'ns-resize', commit: 'structure', x: xe, y: Math.max(geo.t + 7, Yf(fcEnd())),
          value: () => M.revDamp,
          drag(q) {
            const f = logVal(clamp(1 - (q.y - geo.t) / geo.h, 0, 1), F0, F1);
            P.revDamp.set(invert((d) => -fcEnd(d), -f, 0, 1)); // the tail's top end falls as damping rises
          },
          nudge: (dir, lv) => P.revDamp.nudge(-dir, lv), // wheel up = brighter
          reset: () => P.revDamp.set(MASTER_DEFAULT.revDamp),
          tag: () => { const f = fcEnd(); return `Damping ${fmtPct(M.revDamp)} · tail ends ${f >= 1000 ? (f / 1000).toFixed(1) + ' kHz' : Math.round(f) + ' Hz'}`; },
        },
        {
          id: 'level', color: c.blue, cursor: 'ns-resize', commit: 'live', x: 15, y: lvY(M.revLevel),
          value: () => M.revLevel,
          drag(q) { P.revLevel.set((1 - (q.y - geo.t) / geo.h) * 1.5); },
          nudge: (dir, lv) => P.revLevel.nudge(dir, lv),
          reset: () => P.revLevel.set(MASTER_DEFAULT.revLevel),
          tag: () => `Level ${fmtPct(M.revLevel)}`,
        },
      ];
    },
    draw(g, w, ht) {
      const c = colors();
      const fs = sz(w);
      const bot = geo.t + geo.h;
      const right = geo.l + geo.w;
      const cols = clamp(Math.round(geo.w / 3), 40, 220);
      const rows = clamp(Math.round(geo.h / 3), 24, 90);
      g.imageSmoothingEnabled = true;
      g.drawImage(heatmap(cols, rows), geo.l, geo.t, geo.w, geo.h);
      g.fillStyle = 'rgba(141, 151, 171, .10)';
      for (let s = 1; s <= 6; s++) g.fillRect(Math.round(X(s)), geo.t, 1, geo.h);
      let lastX = -99;
      for (let s = 0; s <= 6; s++) {
        const x = X(s);
        if (x - lastX < 30) continue;
        lastX = x;
        text(g, s ? `${s} s` : '0', x, bot + 13, { align: s ? 'center' : 'left', size: fs - 1 });
      }
      for (const [f, s] of [[100, '100'], [1000, '1k'], [10000, '10k']]) text(g, s, right - 3, Yf(f), { align: 'right', base: 'middle', size: fs - 2, color: 'rgba(238, 241, 246, .5)' });
      clipTo(g, geo);
      dash(g, geo.l, Yf(220), right, Yf(220), 'rgba(141, 151, 171, .35)', [2, 4]);
      // highs roll-off: where the damping low-pass sits over the tail
      const N = 60;
      const roll = [];
      for (let i = 0; i <= N; i++) { const pos = i / N; roll.push([X(REV_PD + pos * M.revSize), Yf(fc(coef(pos)))]); }
      curve(g, roll, { color: rgba(c.accent, 0.9), width: 1.5 });
      const xe = X(REV_PD + M.revSize);
      dash(g, xe, geo.t, xe, bot, 'rgba(238, 241, 246, .5)', [3, 3]);
      g.restore();
      caption(g, 'HPF 220 Hz', geo.l - 7, Yf(220) - 7, w, ht, 'rgba(238, 241, 246, .8)', 'right'); // haloed: it sits on the bright early tail
      // level fader (the reverb return)
      rrect(g, 8, geo.t, 14, geo.h, 6);
      g.fillStyle = c.panel2;
      g.fill();
      rrect(g, 8, lvY(M.revLevel), 14, bot - lvY(M.revLevel), 6);
      g.fillStyle = rgba(c.blue, 0.35);
      g.fill();
      g.fillStyle = 'rgba(141, 151, 171, .5)';
      g.fillRect(8, Math.round(lvY(1)), 5, 1);
      text(g, 'LVL', 15, bot + 13, { align: 'center', size: fs - 2, color: c.blue, weight: 800 });
      caption(g, 'SIZE', xe, geo.t + geo.h - 11, w, ht, c.blue, 'above');
      caption(g, 'DAMP', xe, Math.max(geo.t + 7, Yf(fcEnd())), w, ht, c.accent, 'above');
    },
  });
  return gr;
}

// ---- delay -------------------------------------------------------------------------------------
// makePingPong: the input goes to the left tap; the left feeds the right; the right feeds back to
// the left through the feedback gain. So echo n sounds at n × time, alternating L, R, and
// echoes 1–2 are at the return level, 3–4 × feedback, 5–6 × feedback², …
export function delayGraph(app, { sync }) {
  const p = app.project;
  const M = p.master;
  const P = { dlyFb: prm(M, 'dlyFb', 0, 0.85, 0.01, sync), dlyLevel: prm(M, 'dlyLevel', 0, 1.5, 0.01, sync) };
  const DB_LO = -36;
  const DB_HI = 4;
  const st16 = () => 15 / p.bpm;
  const span = () => 32 * st16(); // two bars
  const T = () => Math.min(1.9, st16() * (DELAY_TIMES[M.dlyTime] || 3));
  const geo = {};
  const yc = () => geo.t + geo.h / 2;
  const half = () => geo.h / 2 - 2;
  const H = (db) => clamp((db - DB_LO) / (DB_HI - DB_LO), 0, 1) * half();
  const X = (s) => geo.l + (s / span()) * geo.w;
  const fbHandle = () => {
    const c = colors();
    const t3 = 3 * T();
    return {
      id: 'fb', color: c.accent, cursor: 'ns-resize', commit: 'live', off: t3 > span(), x: X(t3), y: yc() - H(toDb(M.dlyLevel * M.dlyFb)),
      value: () => M.dlyFb,
      // relative: the whole height of the graph covers the feedback range (the dB scale would
      // squeeze 20 … 85 % into a few pixels)
      grab: () => ({ v: M.dlyFb }),
      drag(q, d) { P.dlyFb.set(d.v - (q.dy / geo.h) * 0.85 * 1.15); },
      nudge: (dir, lv) => P.dlyFb.nudge(dir, lv),
      reset: () => P.dlyFb.set(MASTER_DEFAULT.dlyFb),
      tag: () => `Feedback ${fmtPct(M.dlyFb)}`,
    };
  };
  const gr = editor(app, {
    height: 'var(--mx-h-dly, 120px)',
    label: 'Ping-pong delay echoes over two bars, left channel up, right down. Drag up or down for feedback; the first echo sets the level.',
    layout(w, ht) {
      Object.assign(geo, { l: 20, t: 8, w: w - 20 - 8, h: ht - 8 - 18 });
      const c = colors();
      return [
        {
          id: 'level', color: c.blue, cursor: 'ns-resize', commit: 'live', x: X(T()), y: yc() - H(toDb(M.dlyLevel)),
          value: () => M.dlyLevel,
          drag(q) { const db = DB_LO + ((yc() - q.y) / half()) * (DB_HI - DB_LO); P.dlyLevel.set(db < DB_LO + 0.5 ? 0 : 10 ** (db / 20)); },
          nudge: (dir, lv) => P.dlyLevel.nudge(dir, lv),
          reset: () => P.dlyLevel.set(MASTER_DEFAULT.dlyLevel),
          tag: () => `Delay level ${fmtPct(M.dlyLevel)}`,
        },
        fbHandle(),
      ];
    },
    // with a mouse, a vertical drag anywhere sets the feedback
    fallback: (pt) => (pt.e && pt.e.pointerType === 'touch' ? null : fbHandle()),
    cursor: () => 'ns-resize',
    draw(g, w, ht) {
      const c = colors();
      const fs = sz(w);
      const bot = geo.t + geo.h;
      const right = geo.l + geo.w;
      const cy = yc();
      const s16 = st16();
      const px16 = geo.w / 32;
      for (let i = 0; i <= 32; i++) {
        if (i % 4 && px16 < 6) continue;
        g.fillStyle = i % 16 === 0 ? 'rgba(141, 151, 171, .28)' : i % 4 === 0 ? c.grid : 'rgba(141, 151, 171, .06)';
        g.fillRect(Math.round(X(i * s16)), geo.t, 1, geo.h);
      }
      g.fillStyle = 'rgba(141, 151, 171, .3)';
      g.fillRect(geo.l, Math.round(cy), geo.w, 1);
      for (let b = 0; b < 8; b++) text(g, `${Math.floor(b / 4) + 1}.${(b % 4) + 1}`, X(b * 4 * s16) + 3, bot + 13, { size: fs - 1.5, color: b % 4 ? c.muted : c.text });
      text(g, 'L', 6, geo.t + 12, { size: fs - 0.5, color: c.blue, weight: 800 });
      text(g, 'R', 6, bot - 4, { size: fs - 0.5, color: c.accent, weight: 800 });
      const t = T();
      text(g, `${M.dlyTime} · ${Math.round(t * 1000)} ms`, right - 4, geo.t + 11, { align: 'right', size: fs - 1, color: c.text, weight: 700 });
      const bw = clamp((X(t) - X(0)) * 0.32, 3, 10);
      // dry hit
      g.fillStyle = 'rgba(238, 241, 246, .85)';
      rrect(g, X(0), cy - H(0), bw, H(0) * 2, 2);
      g.fill();
      text(g, 'dry', X(0) + bw + 3, cy + H(0) - 3, { size: fs - 2, color: c.muted });
      // echoes and the decay line through them
      const tops = [[], []];
      for (let n = 1; n * t <= span() + 1e-6; n++) {
        const gain = M.dlyLevel * M.dlyFb ** Math.floor((n - 1) / 2);
        const hh = H(toDb(gain));
        const left = n % 2 === 1;
        const x = X(n * t) - bw / 2;
        g.fillStyle = left ? c.blue : c.accent;
        if (hh > 0.5) { rrect(g, x, left ? cy - hh : cy, bw, hh, 2); g.fill(); }
        tops[left ? 0 : 1].push([X(n * t), left ? cy - hh : cy + hh]);
      }
      g.save();
      g.setLineDash([3, 3]);
      if (tops[0].length > 1) curve(g, tops[0], { color: rgba(c.blue, 0.5), width: 1 });
      if (tops[1].length > 1) curve(g, tops[1], { color: rgba(c.accent, 0.5), width: 1 });
      g.restore();
      caption(g, 'LEVEL', X(t), cy - H(toDb(M.dlyLevel)), w, ht, c.blue, 'right');
      const fh = fbHandle();
      if (!fh.off) caption(g, 'FEEDBACK', fh.x, fh.y, w, ht, c.accent, 'right');
    },
  });
  return gr;
}

// ---- sidechain pump ----------------------------------------------------------------------------
// One bar of four kicks through the real pumpShape (release in beats, curve). Each track's line
// is its gain, 1 − Pump × envelope; the dashed line is the reverb and delay returns (Pump on FX).
export function pumpGraph(app, { sync }) {
  const p = app.project;
  const M = p.master;
  const P = { pumpRelease: prm(M, 'pumpRelease', 0.15, 1, 0.01, sync), pumpCurve: prm(M, 'pumpCurve', 0.6, 4, 0.1, sync) };
  const beat = () => 60 / p.bpm;
  const ATT = 0.004; // pumpShape's attack, seconds
  const env = (b) => { const k = Math.floor(b); return pumpShape((b - k) * beat(), M.pumpRelease * beat(), M.pumpCurve); };
  const geo = {};
  const X = (b) => geo.l + (b / 4) * geo.w;
  const Y = (gain) => geo.t + (1 - gain) * geo.h;
  const view = { focus: null, pin: null };
  const ducking = () => p.tracks.filter((t) => t.mix.duck > 0.004);
  const curveName = (v) => (v < 1.5 ? 'Smooth' : v < 2.6 ? 'Classic' : 'Hard');
  const gr = editor(app, {
    height: 'var(--mx-h-pump, 132px)',
    label: 'Sidechain pump over one bar of four kicks, one line per track. Drag Release sideways, Curve up or down, or a track line for its pump depth.',
    layout(w, ht) {
      Object.assign(geo, { l: 30, t: 12, w: w - 30 - 8, h: ht - 12 - 18 });
      const c = colors();
      const a = ATT / beat();
      return [
        {
          id: 'release', color: c.text, cursor: 'ew-resize', commit: 'pump', x: X(a + M.pumpRelease), y: Y(1),
          value: () => M.pumpRelease,
          drag(q) { P.pumpRelease.set(((q.x - geo.l) / geo.w) * 4 - a); },
          nudge: (dir, lv) => P.pumpRelease.nudge(dir, lv),
          reset: () => P.pumpRelease.set(MASTER_DEFAULT.pumpRelease),
          tag: () => `Release ${M.pumpRelease.toFixed(2)} beat · ${Math.round(M.pumpRelease * beat() * 1000)} ms`,
        },
        {
          id: 'curve', color: c.accent, cursor: 'ns-resize', commit: 'pump', x: X(a + M.pumpRelease / 2), y: Y(1 - 0.5 ** M.pumpCurve),
          value: () => M.pumpCurve,
          drag(q) { const u = clamp((q.y - geo.t) / geo.h, 0.01, 0.99); P.pumpCurve.set(Math.log(u) / Math.log(0.5)); },
          nudge: (dir, lv) => P.pumpCurve.nudge(dir, lv),
          reset: () => P.pumpCurve.set(MASTER_DEFAULT.pumpCurve),
          tag: () => `Curve ${curveName(M.pumpCurve)} ${M.pumpCurve.toFixed(1)}`,
        },
      ];
    },
    // grab a track's line (or the FX returns line) to set how deep it pumps
    fallback(pt) {
      const b = clamp(((pt.x - geo.l) / geo.w) * 4, 0, 3.999);
      const e = env(b);
      if (e < 0.2) return null;
      // On touch a swipe over the graph must scroll the page, not change a depth by accident:
      // only the line picked in the legend grabs there.
      const touch = pt.e && pt.e.pointerType === 'touch';
      if (touch && !view.pin) return null;
      const r = touch ? 20 : 12;
      const c = colors();
      const lines = [...ducking().map((t) => ({ t, obj: t.mix, key: 'duck', skey: `${t.id}:duck`, name: t.name, color: t.color })),
        { obj: M, key: 'pumpFx', skey: 'pumpFx', name: 'FX returns', color: c.muted }]
        .filter((L) => !touch || (L.t ? L.t.id : 'fx') === view.pin);
      let best = null;
      let bd = r;
      for (const L of lines) { const d = Math.abs(Y(1 - L.obj[L.key] * e) - pt.y); if (d <= bd) { bd = d; best = L; } }
      if (!best) return null;
      const Pd = prm(best.obj, best.key, 0, 1, 0.01, sync, best.skey);
      view.focus = best.t ? best.t.id : 'fx';
      return {
        id: 'line:' + best.skey, color: best.color, commit: 'live', x: pt.x, y: Y(1 - best.obj[best.key] * e),
        value: () => best.obj[best.key],
        drag(q) { Pd.set((q.y - geo.t) / geo.h / e); }, // gain = 1 − depth × envelope
        tag: () => `${best.name} pump ${fmtPct(best.obj[best.key])}`,
      };
    },
    changed(k) { if (!k) view.focus = view.pin; legendSync(); },
    draw(g, w, ht) {
      const c = colors();
      const fs = sz(w);
      const bot = geo.t + geo.h;
      for (let i = 0; i <= 16; i++) {
        g.fillStyle = i % 4 ? 'rgba(141, 151, 171, .06)' : c.grid;
        g.fillRect(Math.round(X(i / 4)), geo.t, 1, geo.h);
      }
      for (const [v, s] of [[1, '0 dB'], [0.5, '−6'], [0.25, '−12']]) {
        g.fillStyle = c.grid;
        g.fillRect(geo.l, Math.round(Y(v)), geo.w, 1);
        text(g, s, geo.l - 4, Y(v), { align: 'right', base: 'middle', size: fs - 1.5 });
      }
      for (let k = 0; k < 4; k++) {
        g.fillStyle = c.accent;
        rrect(g, X(k) - 1, bot + 4, 3, 8, 1.5);
        g.fill();
        text(g, k ? `${k + 1}` : '1 kick', X(k) + 5, bot + 13, { size: fs - 1.5, color: k ? c.muted : c.text });
      }
      // sample densely, plus right after each kick so the duck's drop is crisp
      const a = ATT / beat();
      const N = Math.max(100, Math.round(geo.w / 2));
      const bs = new Set(Array.from({ length: N + 1 }, (_, i) => (i / N) * 4));
      for (let k = 0; k < 4; k++) { bs.add(k + a); bs.add(k + a * 0.5); }
      const xs = [...bs].filter((b) => b <= 4).sort((x, y) => x - y);
      const envs = xs.map((b) => (b >= 4 ? 0 : env(b)));
      g.fillStyle = rgba(c.accent, 0.06);
      g.fillRect(X(0), geo.t, X(a + M.pumpRelease) - X(0), geo.h);
      clipTo(g, { l: geo.l, t: geo.t - 8, w: geo.w, h: geo.h + 8 });
      const anySolo = p.tracks.some((t) => t.mix.solo);
      const focus = view.focus;
      g.save();
      g.setLineDash([2, 3]);
      curve(g, xs.map((b, i) => [X(b), Y(1 - envs[i])]), { color: 'rgba(238, 241, 246, .32)', width: 1 });
      g.restore();
      const fxOn = focus === 'fx';
      g.save();
      g.setLineDash([6, 4]);
      curve(g, xs.map((b, i) => [X(b), Y(1 - M.pumpFx * envs[i])]), { color: fxOn ? c.text : rgba(c.muted, focus ? 0.35 : 0.85), width: fxOn ? 2.5 : 1.5 });
      g.restore();
      const order = ducking().sort((x, y) => (x.id === focus) - (y.id === focus));
      for (const t of order) {
        const dim = t.mix.mute || (anySolo && !t.mix.solo);
        const on = t.id === focus;
        g.globalAlpha = on ? 1 : focus ? 0.3 : dim ? 0.35 : 0.9;
        curve(g, xs.map((b, i) => [X(b), Y(1 - t.mix.duck * envs[i])]), { color: t.color, width: on ? 3 : 1.75 });
        g.globalAlpha = 1;
      }
      // playhead (the beat inside the current bar)
      if (app.engine.playing) {
        const x = X((app.engine.position() % 1) * 4);
        g.fillStyle = rgba(c.accent, 0.7);
        g.fillRect(Math.round(x), geo.t, 2, geo.h);
      }
      g.restore();
      const rk = { x: X(a + M.pumpRelease), y: Y(1) };
      text(g, 'RELEASE', clamp(rk.x + 10, 0, w - 50), geo.t - 2, { size: fs - 2, color: c.text, weight: 800 });
      caption(g, 'CURVE', X(a + M.pumpRelease / 2), Y(1 - 0.5 ** M.pumpCurve), w, ht, c.accent);
    },
  });
  // legend: one entry per ducking track (hover or tap to pick out its line)
  const items = new Map();
  const legend = h('div', { class: 'mx-legend', role: 'group', 'aria-label': 'Pump depth per track' });
  const item = (id, name, color, get) => {
    const pct = h('b', {}, '');
    const el = h('button', {
      class: 'mx-leg', type: 'button', style: { '--c': color }, // a toggle: a listitem role would hide that
      onpointerenter: (e) => { if (e.pointerType !== 'touch') { view.focus = id; legendSync(); gr.redraw(); } },
      onpointerleave: () => { view.focus = view.pin; legendSync(); gr.redraw(); },
      onclick: () => { view.pin = view.pin === id ? null : id; view.focus = view.pin; legendSync(); gr.redraw(); },
    }, h('i'), h('span', {}, name), pct);
    items.set(id, { el, pct, get });
    return el;
  };
  function legendSync() {
    for (const [id, it] of items) {
      it.pct.textContent = fmtPct(it.get());
      it.el.classList.toggle('on', view.focus === id);
      it.el.setAttribute('aria-pressed', String(view.pin === id));
      it.el.classList.toggle('zero', it.get() < 0.005);
    }
  }
  legend.append(...p.tracks.filter((t) => t.role !== 'drums' || t.mix.duck > 0.004).map((t) => item(t.id, t.name, t.color, () => t.mix.duck)),
    item('fx', 'FX returns', colors().muted, () => M.pumpFx));
  legendSync();
  gr.legend = legend;
  gr.refresh = () => { legendSync(); gr.redraw(); };
  whilePlaying(app, gr, 2);
  return gr;
}

// ---- mix stage ---------------------------------------------------------------------------------
// One dot per track: across = pan, up = volume (0 … 120%, dB marks on the right).
export function stageGraph(app, { sync }) {
  const p = app.project;
  const geo = {};
  const X = (pan) => geo.l + ((pan + 1) / 2) * geo.w;
  const Y = (v) => geo.t + (1 - v / 1.2) * geo.h;
  const fmtPan = (v) => (Math.abs(v) < 0.02 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`);
  const defaults = new Map();
  const roleDefault = (t) => { if (!defaults.has(t.role)) defaults.set(t.role, newTrack(t.role).mix); return defaults.get(t.role); };
  let R = 8;
  const gr = editor(app, {
    height: 'var(--mx-h-stage, 200px)',
    label: 'Mix stage: one dot per track. Drag left or right to pan, up or down for volume.',
    handles: false,
    layout(w, ht, st) {
      Object.assign(geo, { l: 12, t: 14, w: w - 12 - 40, h: ht - 14 - 20 });
      R = clamp(Math.round(Math.min(w, ht) / 30), 8, 12);
      const ks = p.tracks.map((t) => {
        const Pv = prm(t.mix, 'vol', 0, 1.2, 0.01, sync, `${t.id}:vol`);
        const Pp = prm(t.mix, 'pan', -1, 1, 0.01, sync, `${t.id}:pan`);
        return {
          id: t.id, t, color: t.color, cursor: 'move', commit: 'live', x: X(t.mix.pan), y: Y(t.mix.vol), tx: X(t.mix.pan),
          grab: () => ({ pan: t.mix.pan, vol: t.mix.vol }),
          drag(q, d) {
            let pan = d.pan + (q.dx / geo.w) * 2;
            if (Math.abs(pan) < 0.04) pan = 0; // the centre is magnetic: the low end lives there
            Pp.set(pan);
            Pv.set(d.vol - (q.dy / geo.h) * 1.2);
          },
          nudge: (dir, lv) => Pv.nudge(dir, lv),
          reset: () => { const d = roleDefault(t); Pv.set(d.vol); Pp.set(d.pan); },
          tag: () => `${t.name} · ${fmtPan(t.mix.pan)} · ${fmtPct(t.mix.vol)} (${minus(toDb(t.mix.vol).toFixed(1))} dB)`,
        };
      });
      // Dots that would cover each other (several tracks centred at similar levels) step aside,
      // beeswarm style, so every track stays visible and grabbable; the dragged one stays put.
      const done = [];
      const gap = (2 * R + 2) ** 2;
      for (const k of [...ks].sort((a, b) => (b.id === st.active) - (a.id === st.active) || a.y - b.y)) {
        for (let i = 0; i < 16; i++) {
          const x = k.tx + Math.ceil(i / 2) * R * 1.2 * (i % 2 ? 1 : -1);
          if (k.id === st.active || done.every((o) => (o.x - x) ** 2 + (o.y - k.y) ** 2 >= gap)) { k.x = clamp(x, geo.l, geo.l + geo.w); break; }
        }
        done.push(k);
      }
      return ks;
    },
    draw(g, w, ht, st) {
      const c = colors();
      const fs = sz(w);
      const bot = geo.t + geo.h;
      const right = geo.l + geo.w;
      g.fillStyle = rgba(c.blue, 0.07);
      g.fillRect(X(-0.12), geo.t, X(0.12) - X(-0.12), geo.h);
      g.fillStyle = rgba(c.mute, 0.05);
      g.fillRect(geo.l, geo.t, geo.w, Y(1) - geo.t);
      g.fillStyle = c.grid;
      for (const pn of [-0.5, 0.5]) g.fillRect(Math.round(X(pn)), geo.t, 1, geo.h);
      for (const [v, s] of [[1, '0 dB'], [0.5, '−6'], [0.25, '−12'], [0.125, '−18']]) {
        g.fillStyle = v === 1 ? 'rgba(141, 151, 171, .3)' : c.grid;
        g.fillRect(geo.l, Math.round(Y(v)), geo.w, 1);
        text(g, s, right + 5, Y(v), { base: 'middle', size: fs - 1.5 });
      }
      dash(g, X(0), geo.t, X(0), bot, 'rgba(141, 151, 171, .35)', [3, 4]);
      text(g, 'L', geo.l + 2, bot + 14, { size: fs - 0.5, weight: 800 });
      text(g, 'C', X(0), bot + 14, { align: 'center', size: fs - 0.5, weight: 800 });
      text(g, 'R', right - 2, bot + 14, { align: 'right', size: fs - 0.5, weight: 800 });
      text(g, '↑ louder', geo.l + 4, geo.t + 10, { size: fs - 2, color: c.muted });
      // dots, the dragged / hovered one on top, names placed so they don't collide
      const anySolo = p.tracks.some((t) => t.mix.solo);
      const hot = st.active || st.hover;
      const hs = [...st.hs].sort((a, b) => (a.id === hot) - (b.id === hot));
      const placed = hs.map((k) => ({ x: k.x - R, y: k.y - R, w: 2 * R, h: 2 * R }));
      g.font = `700 ${fs}px ${FONT}`;
      for (const k of hs) {
        const t = k.t;
        const dim = t.mix.mute || (anySolo && !t.mix.solo);
        const on = k.id === hot;
        g.globalAlpha = dim ? 0.35 : 1;
        if (on) { g.beginPath(); g.arc(k.x, k.y, R + 7, 0, Math.PI * 2); g.fillStyle = rgba(t.color, 0.22); g.fill(); }
        g.beginPath();
        g.arc(k.x, k.y, R, 0, Math.PI * 2);
        g.fillStyle = t.color;
        g.fill();
        g.lineWidth = on ? 2.5 : 1.5;
        g.strokeStyle = on ? '#fff' : t.mix.solo ? c.solo : 'rgba(10, 12, 18, .9)';
        g.stroke();
        if (t.mix.mute) text(g, 'M', k.x, k.y + 0.5, { align: 'center', base: 'middle', size: R + 1, color: '#0a0c12', weight: 800 });
        g.font = `${on ? 800 : 700} ${fs}px ${FONT}`;
        const [lx, ly] = placeLabel(g, t.name, k.x, k.y, R, placed, 2, w - 2);
        text(g, t.name, lx, ly, { base: 'middle', size: fs, color: on ? '#fff' : rgba(c.text, 0.85), weight: on ? 800 : 700 });
        g.globalAlpha = 1;
      }
    },
  });
  return gr;
}

// Put a dot's name beside it where it doesn't cover another dot or name.
function placeLabel(g, s, x, y, r, placed, minX, maxX) {
  const tw = g.measureText(s).width;
  const th = 13;
  const L = x - r - 5 - tw;
  const Rx = x + r + 5;
  const C = x - tw / 2;
  const cands = [[Rx, y], [L, y], [C, y + r + 9], [C, y - r - 9], [Rx, y - 12], [Rx, y + 12], [L, y - 12], [L, y + 12], [Rx, y - 24], [L, y + 24]];
  for (const [lx, ly] of cands) {
    if (lx < minX || lx + tw > maxX) continue;
    const rc = { x: lx - 1, y: ly - th / 2, w: tw + 2, h: th };
    if (placed.some((o) => rc.x < o.x + o.w && o.x < rc.x + rc.w && rc.y < o.y + o.h && o.y < rc.y + rc.h)) continue;
    placed.push(rc);
    return [lx, ly];
  }
  const lx = clamp(Rx, minX, maxX - tw);
  placed.push({ x: lx - 1, y: y - th / 2, w: tw + 2, h: th });
  return [lx, y];
}
