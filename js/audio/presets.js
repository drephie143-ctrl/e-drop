// Sound presets, named for what they sound like. Each one overrides SYNTH_DEFAULT.
import { SYNTH_DEFAULT } from './synth.js';

export const ROLES = {
  lead: { name: 'Supersaw lead', short: 'Lead', color: '#F06617' },
  pluck: { name: 'Pluck', short: 'Pluck', color: '#f5c542' },
  pad: { name: 'Pad', short: 'Pad', color: '#9b7bff' },
  stab: { name: 'Stab / chords', short: 'Stab', color: '#ff5c8a' },
  bass: { name: 'Big room / reese bass', short: 'Bass', color: '#4da3ff' },
  sub: { name: 'Sub bass', short: 'Sub', color: '#2fc4b2' },
  drums: { name: 'Drums', short: 'Drums', color: '#e9eef4' },
  fx: { name: 'Risers and impacts', short: 'FX', color: '#8b98a9' },
};

const G16 = (s) => s.split('').map((c) => (c === 'x' ? 1 : 0));

export const PRESETS = [
  // --- leads
  { name: 'Festival Supersaw', role: 'lead', p: {
    osc: { voices: 9, detune: 0.45, spread: 0.95 }, osc2: { wave: 'sawtooth', voices: 3, detune: 0.3, octave: 1, level: 0.35 }, sub: 0.15,
    filter: { cutoff: 3200, res: 1.2, env: 1.6, a: 0.004, d: 0.35, s: 0.55, r: 0.25 }, amp: { a: 0.006, d: 0.3, s: 0.85, r: 0.22 }, level: 0.55 } },
  { name: 'Euphoric Trance Lead', role: 'lead', p: {
    osc: { voices: 7, detune: 0.32, spread: 0.85 }, osc2: { wave: 'square', octave: 0, level: 0.25 }, mono: true, glide: 0.07,
    filter: { cutoff: 2600, res: 2, env: 2.2, a: 0.004, d: 0.4, s: 0.45, r: 0.3 }, amp: { a: 0.004, d: 0.3, s: 0.85, r: 0.3 }, level: 0.55 } },
  { name: 'Big Room Lead', role: 'lead', p: {
    osc: { voices: 7, detune: 0.55, spread: 0.9 }, osc2: { wave: 'square', voices: 2, detune: 0.2, octave: -1, level: 0.45 }, drive: 0.35,
    pitchEnv: { amt: 3, decay: 0.03 }, filter: { cutoff: 4200, res: 1.5, env: 1.2, d: 0.2, s: 0.6 }, amp: { a: 0.003, d: 0.25, s: 0.75, r: 0.15 }, level: 0.5 } },
  { name: 'Glide Hoover Lead', role: 'lead', p: {
    osc: { voices: 5, detune: 0.6, spread: 0.7, octave: 0 }, osc2: { wave: 'sawtooth', voices: 2, detune: 0.7, octave: -1, level: 0.6 }, mono: true, glide: 0.12,
    pitchEnv: { amt: -5, decay: 0.08 }, filter: { cutoff: 1800, res: 2.5, env: 1.5, d: 0.6, s: 0.5 }, drive: 0.2, level: 0.5 } },
  // --- plucks
  { name: 'Progressive Pluck', role: 'pluck', p: {
    osc: { voices: 5, detune: 0.25, spread: 0.7 }, osc2: { wave: 'square', octave: 1, level: 0.2 },
    filter: { cutoff: 500, res: 3, env: 4.5, a: 0.002, d: 0.22, s: 0, r: 0.2 }, amp: { a: 0.002, d: 0.38, s: 0, r: 0.25 }, level: 0.7 } },
  { name: 'Trance Pluck', role: 'pluck', p: {
    osc: { voices: 3, detune: 0.18, spread: 0.6 }, osc2: { wave: 'sawtooth', octave: 1, level: 0.3 },
    filter: { cutoff: 700, res: 4, env: 4, a: 0.001, d: 0.14, s: 0, r: 0.12 }, amp: { a: 0.001, d: 0.22, s: 0, r: 0.15 }, level: 0.7 } },
  { name: 'Glass Bell Pluck', role: 'pluck', p: {
    osc: { wave: 'triangle', voices: 3, detune: 0.12, spread: 0.6, octave: 1 }, osc2: { wave: 'sine', octave: 2, semi: 7, level: 0.4 },
    filter: { cutoff: 2000, res: 1, env: 2, d: 0.3, s: 0.1 }, amp: { a: 0.001, d: 0.7, s: 0, r: 0.6 }, level: 0.75 } },
  // --- pads
  { name: 'Wide Saw Pad', role: 'pad', p: {
    osc: { voices: 7, detune: 0.35, spread: 1 }, filter: { cutoff: 1600, res: 0.7, env: 0.8, a: 1.2, d: 2, s: 0.6, r: 1.5, slope: 12 },
    amp: { a: 0.9, d: 1, s: 0.9, r: 1.6 }, width: 1.3, level: 0.4 } },
  { name: 'Warm Breakdown Pad', role: 'pad', p: {
    osc: { voices: 5, detune: 0.22, spread: 0.9 }, osc2: { wave: 'triangle', octave: -1, level: 0.5 },
    filter: { cutoff: 900, res: 0.8, env: 0.5, a: 1.5, d: 2, s: 0.7, r: 1.8, slope: 12 }, amp: { a: 1.4, d: 1, s: 0.95, r: 2 }, level: 0.45 } },
  { name: 'Airy Choir Pad', role: 'pad', p: {
    osc: { wave: 'triangle', voices: 5, detune: 0.3, spread: 1 }, noise: 0.08, osc2: { wave: 'sawtooth', voices: 3, detune: 0.4, octave: 1, level: 0.2 },
    filter: { type: 'bandpass', cutoff: 1400, res: 0.6, env: 0.6, a: 1, d: 2, s: 0.6, r: 1.5, slope: 12 }, amp: { a: 1.2, d: 1, s: 0.9, r: 2 }, width: 1.4, level: 0.55 } },
  // --- stabs
  { name: 'Festival Stab', role: 'stab', p: {
    osc: { voices: 7, detune: 0.42, spread: 0.9 }, osc2: { wave: 'square', octave: -1, level: 0.35 }, pitchEnv: { amt: 2, decay: 0.02 }, drive: 0.25,
    filter: { cutoff: 1400, res: 1.5, env: 3, a: 0.002, d: 0.18, s: 0.25, r: 0.15 }, amp: { a: 0.002, d: 0.25, s: 0.5, r: 0.18 }, level: 0.5 } },
  { name: 'House Organ Stab', role: 'stab', p: {
    osc: { wave: 'square', voices: 2, detune: 0.1, spread: 0.4 }, osc2: { wave: 'sine', octave: 1, level: 0.5 }, sub: 0.3,
    filter: { cutoff: 2200, res: 1, env: 1.5, d: 0.15, s: 0.3 }, amp: { a: 0.002, d: 0.3, s: 0.3, r: 0.12 }, level: 0.55 } },
  { name: 'Gated Trance Chords', role: 'stab', p: {
    osc: { voices: 7, detune: 0.3, spread: 0.95 }, filter: { cutoff: 2800, res: 1, env: 0.5, s: 0.8 }, amp: { a: 0.01, d: 0.5, s: 1, r: 0.3 },
    gate: { on: true, rate: '1/16', depth: 1, shape: 'square', pattern: G16('x.xxx.x.xx.xx.xx') }, level: 0.42 } },
  // --- bass
  { name: 'Big Room Bass', role: 'bass', p: {
    osc: { voices: 5, detune: 0.35, spread: 0.5, octave: 0 }, osc2: { wave: 'square', voices: 1, octave: -1, level: 0.5 }, sub: 0.5, drive: 0.45,
    pitchEnv: { amt: 4, decay: 0.03 }, filter: { cutoff: 900, res: 2, env: 2.5, a: 0.002, d: 0.16, s: 0.3, r: 0.1 }, amp: { a: 0.002, d: 0.2, s: 0.7, r: 0.08 }, width: 0.6, level: 0.55 } },
  { name: 'Reese Bass', role: 'bass', p: {
    osc: { voices: 2, detune: 0.3, spread: 0.3, octave: 0 }, osc2: { wave: 'sawtooth', voices: 2, detune: 0.45, octave: 0, level: 0.7 }, sub: 0.5, mono: true, glide: 0.05,
    filter: { cutoff: 520, res: 1.8, env: 0.8, d: 0.4, s: 0.6, slope: 24 }, amp: { a: 0.004, d: 0.3, s: 0.95, r: 0.12 }, drive: 0.3, width: 0.5, level: 0.55 } },
  { name: 'Rolling Trance Bass', role: 'bass', p: {
    osc: { voices: 1, detune: 0, spread: 0 }, osc2: { wave: 'sawtooth', octave: 0, voices: 1, level: 0.4, detune: 0.1 }, sub: 0.4,
    filter: { cutoff: 260, res: 3, env: 3.5, a: 0.001, d: 0.1, s: 0, r: 0.06 }, amp: { a: 0.001, d: 0.13, s: 0.2, r: 0.05 }, width: 0.4, level: 0.7 } },
  { name: 'Driving Off-beat Bass', role: 'bass', p: {
    osc: { voices: 3, detune: 0.2, spread: 0.3 }, sub: 0.6, filter: { cutoff: 380, res: 2.5, env: 3, a: 0.001, d: 0.12, s: 0.15, r: 0.06 },
    amp: { a: 0.001, d: 0.18, s: 0.4, r: 0.06 }, drive: 0.25, width: 0.4, level: 0.65 } },
  // --- sub
  { name: 'Clean Sub', role: 'sub', p: {
    osc: { wave: 'sine', voices: 1, detune: 0, spread: 0 }, filter: { type: 'off' }, amp: { a: 0.004, d: 0.2, s: 1, r: 0.06 }, mono: true, glide: 0.02, width: 0, level: 0.75 } },
  { name: 'Warm Sub', role: 'sub', p: {
    osc: { wave: 'triangle', voices: 1, detune: 0, spread: 0 }, filter: { cutoff: 180, res: 0.7, env: 0, slope: 12, key: 1 }, drive: 0.25,
    amp: { a: 0.004, d: 0.2, s: 1, r: 0.08 }, mono: true, glide: 0.03, width: 0, level: 0.8 } },
];

export function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = deepMerge(base[k], v);
    else out[k] = Array.isArray(v) ? v.slice() : v;
  }
  return out;
}

export function presetParams(name) {
  const p = PRESETS.find((x) => x.name === name) || PRESETS[0];
  return deepMerge(structuredClone(SYNTH_DEFAULT), p.p);
}

export const presetsFor = (role) => PRESETS.filter((p) => p.role === role);
