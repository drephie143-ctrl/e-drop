// Keys, scales, chords, progressions, the arpeggiator and the part generators
// (bass lines, arps, melodies) that turn a chord progression into a full track.

export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
// Spell a pitch class the way the key's signature does (F minor: Db, Ab, Eb).
export function spell(pc, key, scale) {
  const major = scale === 'major' ? key : (key + 3) % 12; // relative major
  const flats = [5, 10, 3, 8, 1, 6].includes(major);
  return (flats ? FLATS : SHARPS)[((pc % 12) + 12) % 12];
}
export const noteName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
export const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

export const SCALES = {
  minor: { name: 'Minor', steps: [0, 2, 3, 5, 7, 8, 10] },
  major: { name: 'Major', steps: [0, 2, 4, 5, 7, 9, 11] },
  harmonic: { name: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  dorian: { name: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { name: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
};

export function inScale(m, key, scale) {
  return SCALES[scale].steps.includes((((m - key) % 12) + 12) % 12);
}

// Progressions are scale degrees (0 = I / i). The label uses the major-key roman numerals
// that producers use for the relative-major view, which is how vi–IV–I–V is usually named.
export const PROGRESSIONS = [
  { id: 'anthem', label: 'vi – IV – I – V', mode: 'major', degrees: [5, 3, 0, 4], note: 'The festival anthem' },
  { id: 'pop', label: 'I – V – vi – IV', mode: 'major', degrees: [0, 4, 5, 3], note: 'Uplifting, big hooks' },
  { id: 'emo', label: 'vi – V – IV – V', mode: 'major', degrees: [5, 4, 3, 4], note: 'Emotional breakdown' },
  { id: 'trance', label: 'i – VI – III – VII', mode: 'minor', degrees: [0, 5, 2, 6], note: 'Classic trance' },
  { id: 'epic', label: 'i – VII – VI – VII', mode: 'minor', degrees: [0, 6, 5, 6], note: 'Dark and driving' },
  { id: 'rise', label: 'i – iv – VI – V', mode: 'harmonic', degrees: [0, 3, 5, 4], note: 'Tension into the drop' },
  { id: 'prog', label: 'IV – V – iii – vi', mode: 'major', degrees: [3, 4, 2, 5], note: 'Progressive house' },
  { id: 'big', label: 'i – VI – VII – v', mode: 'minor', degrees: [0, 5, 6, 4], note: 'Big room' },
];

export const VOICINGS = {
  triad: { name: 'Triad', build: (r, s) => [r, s(2), s(4)] },
  open: { name: 'Open', build: (r, s) => [r - 12, r, s(4), s(2) + 12] },
  add9: { name: 'Add 9', build: (r, s) => [r, s(2), s(4), s(1) + 12] },
  seventh: { name: '7th', build: (r, s) => [r, s(2), s(4), s(6)] },
  sus2: { name: 'Sus 2', build: (r, s) => [r, s(1), s(4)] },
  sus4: { name: 'Sus 4', build: (r, s) => [r, s(3), s(4)] },
  power: { name: 'Power', build: (r, s) => [r, s(4), r + 12] },
};

// Notes of a chord on scale degree `deg` in key/scale, root near `baseMidi`.
export function chordNotes(key, scale, deg, voicing = 'triad', baseMidi = 57) {
  const st = SCALES[scale].steps;
  const deg2midi = (d) => {
    const oct = Math.floor(d / 7);
    return key + st[((d % 7) + 7) % 7] + 12 * oct;
  };
  let root = deg2midi(deg);
  // place root in the octave at or below baseMidi+5 for smooth voice leading
  while (root < baseMidi - 6) root += 12;
  while (root > baseMidi + 5) root -= 12;
  const shift = root - deg2midi(deg);
  const s = (i) => deg2midi(deg + i) + shift;
  return VOICINGS[voicing].build(root, s).sort((a, b) => a - b);
}

// Voice-lead a list of chords: move each chord by octaves to stay close to the first.
function voiceLead(chords) {
  const out = [chords[0]];
  for (let i = 1; i < chords.length; i++) {
    const prev = out[i - 1];
    const pc = prev.reduce((a, b) => a + b, 0) / prev.length;
    let best = chords[i];
    let bestD = Infinity;
    for (const sh of [-12, 0, 12]) {
      const c = chords[i].map((n) => n + sh);
      const d = Math.abs(c.reduce((a, b) => a + b, 0) / c.length - pc);
      if (d < bestD) { bestD = d; best = c; }
    }
    out.push(best);
  }
  return out;
}

export function progressionChords(key, scale, prog, voicing, baseMidi = 57) {
  return voiceLead(prog.degrees.map((d) => chordNotes(key, scale, d, voicing, baseMidi)));
}

const n = (pitch, start, len, vel = 0.9) => ({ pitch, start, len, vel });

// Each generator returns notes in 16th-note steps for a pattern `bars` long, with one chord
// lasting `barsPer` bars.
export const GENERATORS = {
  chords: { name: 'Chords (held)', fn: (chords, bars, barsPer) => chords.flatMap((c, i) => c.map((p) => n(p, i * barsPer * 16, barsPer * 16 - 0.25, 0.8))) },
  stabs: {
    name: 'Chord stabs (offbeat)',
    fn: (chords, bars, barsPer) => {
      const out = [];
      chords.forEach((c, i) => { for (let s = 2; s < barsPer * 16; s += 4) c.forEach((p) => out.push(n(p, i * barsPer * 16 + s, 1.5, 0.9))); });
      return out;
    },
  },
  bounce: {
    name: 'Big room stabs',
    fn: (chords, bars, barsPer) => {
      const rhythm = [0, 3, 6, 10, 12, 14];
      const out = [];
      chords.forEach((c, i) => { for (let b = 0; b < barsPer; b++) for (const s of rhythm) c.forEach((p) => out.push(n(p, (i * barsPer + b) * 16 + s, 1.5, s === 0 ? 1 : 0.85))); });
      return out;
    },
  },
  offbass: {
    name: 'Off-beat bass',
    fn: (chords, bars, barsPer) => {
      const out = [];
      chords.forEach((c, i) => { const r = bassRoot(c); for (let s = 2; s < barsPer * 16; s += 4) out.push(n(r, i * barsPer * 16 + s, 1.6, 0.95)); });
      return out;
    },
  },
  rolling: {
    name: 'Rolling bass (trance)',
    fn: (chords, bars, barsPer) => {
      const out = [];
      chords.forEach((c, i) => { const r = bassRoot(c); for (let s = 0; s < barsPer * 16; s++) if (s % 4 !== 0) out.push(n(r, i * barsPer * 16 + s, 0.8, s % 4 === 2 ? 1 : 0.8)); });
      return out;
    },
  },
  sub: { name: 'Sub (held roots)', fn: (chords, bars, barsPer) => chords.map((c, i) => n(bassRoot(c), i * barsPer * 16, barsPer * 16 - 0.25, 0.9)) },
  arp: {
    name: 'Arp line (16ths)',
    fn: (chords, bars, barsPer) => {
      const out = [];
      chords.forEach((c, i) => {
        const ns = [...c, c[0] + 12, c[1] + 12];
        const seq = [0, 1, 2, 3, 4, 3, 2, 1];
        for (let s = 0; s < barsPer * 16; s++) out.push(n(ns[seq[s % seq.length] % ns.length] + 12, i * barsPer * 16 + s, 0.9, s % 4 === 0 ? 1 : 0.75));
      });
      return out;
    },
  },
  melody: {
    name: 'Lead hook',
    fn: (chords, bars, barsPer, key, scale) => {
      // A call-and-response hook built from chord tones, landing on the next chord's tone.
      const rhythm = [[0, 3], [3, 3], [6, 2], [8, 2], [10, 4], [14, 2]];
      const out = [];
      chords.forEach((c, i) => {
        const tones = [...c.map((p) => p + 12), c[0] + 24].sort((a, b) => a - b);
        const shape = i % 2 === 0 ? [3, 2, 1, 2, 3, 2] : [2, 3, 4, 3, 2, 1];
        for (let b = 0; b < barsPer; b++) {
          rhythm.forEach(([s, len], k) => {
            if (b % 2 === 1 && k >= 4) return; // breathe every other bar
            out.push(n(tones[Math.min(tones.length - 1, shape[k])], (i * barsPer + b) * 16 + s, len - 0.25, k === 0 ? 1 : 0.85));
          });
        }
      });
      return out;
    },
  },
};

function bassRoot(chord) {
  let r = chord[0];
  // root of the chord = lowest note; bring it into the bass range (E1..E2)
  while (r > 40) r -= 12;
  while (r < 28) r += 12;
  return r;
}

// A progression written for major (or minor) is played in the relative key when the song
// is in the other mode, so vi–IV–I–V in F minor gives Fm–Db–Ab–Eb.
export function progKey(key, scale, prog) {
  const minorish = scale !== 'major';
  if (prog.mode === 'major' && minorish) return { key: (key + 3) % 12, scale: 'major' };
  if (prog.mode !== 'major' && !minorish) return { key: (key + 9) % 12, scale: prog.mode };
  if (prog.mode === 'harmonic') return { key, scale: 'harmonic' };
  return { key, scale };
}

export function generate(kind, { key, scale, progId, voicing, bars, barsPer = 1, base = 57 }) {
  const prog = PROGRESSIONS.find((p) => p.id === progId) || PROGRESSIONS[0];
  ({ key, scale } = progKey(key, scale, prog));
  const chords = progressionChords(key, scale, prog, voicing, base);
  const count = Math.max(1, Math.round(bars / barsPer));
  const seq = [];
  for (let i = 0; i < count; i++) seq.push(chords[i % chords.length]);
  return GENERATORS[kind].fn(seq, bars, barsPer, key, scale);
}

// --- arpeggiator ---------------------------------------------------------------------
export const ARP_RATES = { '1/8': 2, '1/16': 1, '1/16T': 2 / 3, '1/32': 0.5 };
export const ARP_MODES = ['up', 'down', 'updown', 'random', 'played'];

// Turns held notes into arpeggiated notes. Steps are 16ths.
export function arpeggiate(notes, arp, patternSteps) {
  if (!arp || !arp.on || !notes.length) return notes;
  const rate = ARP_RATES[arp.rate] || 1;
  const out = [];
  let k = 0;
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let t = 0; t < patternSteps - 1e-6; t += rate) {
    const held = notes.filter((x) => x.start <= t + 1e-6 && x.start + x.len > t + 1e-6);
    if (!held.length) { k = 0; continue; }
    let pool = held.map((x) => x.pitch);
    if (arp.mode !== 'played') pool.sort((a, b) => a - b);
    const oct = [];
    for (let o = 0; o < (arp.octaves || 1); o++) for (const p of pool) oct.push(p + 12 * o);
    pool = oct;
    let idx;
    const L = pool.length;
    if (arp.mode === 'down') idx = L - 1 - (k % L);
    else if (arp.mode === 'updown') { const cyc = Math.max(1, 2 * L - 2); const q = k % cyc; idx = q < L ? q : cyc - q; }
    else if (arp.mode === 'random') idx = Math.floor(rnd() * L);
    else idx = k % L;
    const v = held[0].vel;
    out.push({ pitch: pool[idx], start: t, len: rate * (arp.gate || 0.6), vel: v * (k % 4 === 0 ? 1 : 0.85) });
    k++;
  }
  return out;
}
