// Whole bars of a pattern: copy, paste, repeat, fill and clear. A pattern holds notes
// ({ pitch, start, len } in 16ths), drum hits ({ v, s }) and FX events ({ type, s, len }); a bar
// is 16 steps. A bar range is [from, to) in bars, 0-based.
//
// The rules, the same for all three:
// - What a range holds is what starts in it. A note that starts in it and rings past its end is
//   cut at the end, so a copied bar sounds like that bar alone.
// - Writing into a range replaces it: what starts there is removed, and a note that starts
//   before it and rings into it is cut where the range begins.
// - A paste that runs past the pattern's end makes the pattern longer, up to MAX_BARS.

export const STEPS = 16;
export const MAX_BARS = 64;

const startOf = (x) => (x.start ?? x.s);
const lenOf = (x) => (x.len ?? 1);
const setStart = (x, v) => { if ('start' in x) x.start = v; else x.s = v; };

// The kind of content a track's patterns hold (a clip pastes only into the same kind).
export const kindOf = (role) => (role === 'drums' ? 'hits' : role === 'fx' ? 'fx' : 'notes');

// A bar selection ({ track, pat, from, to }: track and pattern ids, bars [from, to)) checked
// against the pattern as it is now: null if it is for another pattern or starts past the end,
// else { from, to } inside the pattern.
export function barSelOf(sel, track, pat) {
  if (!sel || !track || !pat || sel.track !== track.id || sel.pat !== pat.id || !(sel.from < pat.bars)) return null;
  const from = Math.max(0, sel.from);
  return { from, to: Math.max(from + 1, Math.min(sel.to, pat.bars)) };
}

export const barsName = (from, to) => (to - from === 1 ? `bar ${from + 1}` : `bars ${from + 1}–${to}`);

// The bars [from, to) of a pattern, as a clip that starts at step 0.
export function copyBars(pat, from, to, kind) {
  const A = from * STEPS;
  const B = to * STEPS;
  const items = [];
  for (const x of pat[kind] || []) {
    const s = startOf(x);
    if (s < A || s >= B) continue;
    const c = structuredClone(x);
    setStart(c, s - A);
    if (kind !== 'hits') c.len = Math.min(lenOf(x), B - s);
    items.push(c);
  }
  return { kind, bars: to - from, items };
}

// Empty the bars [from, to): remove what starts there, cut what rings into it from before.
export function clearBars(pat, from, to, kind) {
  const A = from * STEPS;
  const B = to * STEPS;
  const list = pat[kind] || (pat[kind] = []);
  for (let i = list.length - 1; i >= 0; i--) {
    const x = list[i];
    const s = startOf(x);
    if (s >= A && s < B) list.splice(i, 1);
    else if (kind !== 'hits' && s < A && s + lenOf(x) > A) x.len = A - s;
  }
}

// Put a clip in at bar `at`, replacing what is there. Returns { from, to, grew, cut }: the bars
// it now covers, whether the pattern got longer, and whether MAX_BARS cut the clip short.
export function pasteBars(pat, clip, at, { grow = true } = {}) {
  const before = pat.bars;
  const want = at + clip.bars;
  let cut = false;
  if (want > pat.bars) {
    if (grow && at < MAX_BARS) {
      const nb = Math.min(MAX_BARS, want);
      cut = nb < want;
      pat.bars = nb;
    } else cut = true;
  }
  const end = Math.min(want, pat.bars);
  if (end <= at) return { from: at, to: at, grew: false, cut: true };
  const grew = pat.bars > before;
  clearBars(pat, at, end, clip.kind);
  const A = at * STEPS;
  const E = end * STEPS;
  const list = pat[clip.kind] || (pat[clip.kind] = []);
  for (const x of clip.items) {
    const s = A + startOf(x);
    if (s >= E) continue;
    const c = structuredClone(x);
    setStart(c, s);
    if (clip.kind !== 'hits') c.len = Math.min(lenOf(x), E - s);
    list.push(c);
  }
  return { from: at, to: end, grew, cut };
}

// Copy the bars [from, to) right after themselves (a second press copies the copy, and so on).
export function repeatBars(pat, from, to, kind) {
  return pasteBars(pat, copyBars(pat, from, to, kind), to);
}

// Repeat the bars [from, to) over every bar after them, to the end of the pattern. The last copy
// is cut at the end when the length doesn't divide. Returns the bars written, or null if there
// is no room after the range.
export function fillBars(pat, from, to, kind) {
  if (to >= pat.bars) return null;
  const clip = copyBars(pat, from, to, kind);
  for (let at = to; at < pat.bars; at += clip.bars) pasteBars(pat, clip, at, { grow: false });
  return { from: to, to: pat.bars };
}

// Is there anything in the bars [from, to)? With ringing, a note or effect that starts earlier and
// rings into them counts too (clearBars cuts it).
export function barsHave(pat, from, to, kind, { ringing = false } = {}) {
  const A = from * STEPS;
  const B = to * STEPS;
  return (pat[kind] || []).some((x) => {
    const s = startOf(x);
    return (s >= A && s < B) || (ringing && kind !== 'hits' && s < A && s + lenOf(x) > A);
  });
}
