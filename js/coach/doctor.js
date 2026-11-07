// Song check: reads the whole song like a mentor would and scores four areas (composition,
// sound design, arrangement, mix and master). Every finding says what is wrong, why it
// matters, and where it can, offers a one-tap fix. Things that are right are listed too.
//
// finding = { id, area, sev: 'high'|'med'|'low'|'tip', title, why, fix?: { label, run(app) → message },
//             show?: { tab, track?, target?, select?(F) } }
import { buildSweep, uid } from '../music/project.js';
import { NOTE_NAMES, noteName } from '../music/theory.js';
import { presetParams } from '../audio/presets.js';
import { facts, MELODIC, keyName, kickInfo, snapToKey, writePart, targetPattern, roundBars, pc, foldRange } from './facts.js';
import { lessonById } from './lessons.js';

export const AREAS = [
  { id: 'comp', name: 'Composition', weight: 0.3 },
  { id: 'sound', name: 'Sound design', weight: 0.2 },
  { id: 'arr', name: 'Arrangement', weight: 0.25 },
  { id: 'mix', name: 'Mix and master', weight: 0.25 },
];
export const SEV = { high: { name: 'Fix first', cost: 30 }, med: { name: 'Improve', cost: 12 }, low: { name: 'Polish', cost: 6 }, tip: { name: 'Pro tip', cost: 0 } };

const pct = (v) => `${Math.round(v * 100)}%`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function checkSong(app, ear = null) {
  const F = facts(app);
  F.ear = ear;
  const p = F.p;
  const out = [];
  const passes = [];
  const add = (area, sev, id, title, why, extra = {}) => out.push({ area, sev, id, title, why, ...extra });
  const ok = (area, title) => passes.push({ area, title });
  const T = (r) => F.track(r);
  const drops = F.of('drop');
  const lead = T('lead');
  const sub = T('sub');
  const bass = T('bass');
  const pad = T('pad');
  const drums = T('drums');
  const fxT = T('fx');

  // ---------------------------------------------------------------- composition
  const chordParts = ['pad', 'stab', 'pluck'].filter((r) => F.notes(T(r)).length > 0);
  if (!chordParts.length) {
    add('comp', 'high', 'nochords', 'No chords yet', 'Chords carry the emotion of the track and every other part is written against them.', {
      fix: pad ? { label: 'Write vi – IV – I – V', run: (a) => { writePart(a, pad, targetPattern(a, pad), 'chords', { voicing: 'open' }); a.arrangementChanged(); return 'Wrote vi – IV – I – V on the Pad'; } } : null,
      show: { tab: 'notes', track: 'pad', target: { btn: 'Chords & parts' } } });
  } else ok('comp', `Chords on the ${chordParts.join(', ')}`);

  if (drops.length && lead && !drops.some((x) => F.plays(lead, x))) {
    add('comp', 'high', 'nohook', 'No lead hook in the drop', 'The drop is where the crowd hears the hook. Without one, it is a loop, not a song.', {
      fix: { label: 'Write a hook', run: (a) => { const q = targetPattern(a, lead); writePart(a, lead, q, 'melody'); for (const x of facts(a).of('drop')) if (!x.s.cells[lead.id]) x.s.cells[lead.id] = q.id; a.arrangementChanged(); return 'Wrote a lead hook and put it in the drops'; } },
      show: { tab: 'notes', track: 'lead', target: { btn: 'Chords & parts' } } });
  }

  let wrongTotal = 0;
  for (const t of p.tracks.filter((x) => MELODIC.includes(x.role))) {
    const bad = F.outOfKey(t);
    if (!bad.length) continue;
    wrongTotal += bad.length;
    const names = [...new Set(bad.map((n) => NOTE_NAMES[pc(n.pitch)]))].slice(0, 3).join(', ');
    add('comp', bad.length >= 3 ? 'med' : 'low', 'key-' + t.id, `${t.name} has ${plural(bad.length, 'note')} outside ${F.key} (${names})`,
      'Wrong notes repeat every time the pattern loops; at festival volume they sound like mistakes, not colour.', {
        fix: { label: 'Snap to the key', run: (a) => { const n = snapToKey(a, t); a.render(); return `Moved ${plural(n, 'note')} on ${t.name} into ${keyName(a.project)}`; } },
        show: { tab: 'notes', track: t.role, target: { sel: '.roll-wrap' } } });
  }
  if (!wrongTotal && p.tracks.some((t) => MELODIC.includes(t.role) && F.notes(t).length)) ok('comp', `Every note is in ${F.key}`);

  const fit = F.hookFit();
  if (fit && fit.strong >= 4) {
    if (fit.rubs >= 3) add('comp', 'med', 'rubs', `Lead rubs a semitone against the chords ${plural(fit.rubs, 'time')} on the beat`, 'A note a half step from a chord tone, on a strong beat, clashes. Move it onto the chord tone next to it.', { show: { tab: 'notes', track: 'lead', target: { sel: '.roll-wrap' } } });
    else if (fit.share < 0.5) add('comp', 'low', 'tones', `Only ${pct(fit.share)} of the hook's on-beat notes are chord tones`, 'Chord tones on strong beats make a hook sound confident. Aim for most of them.', { show: { tab: 'notes', track: 'lead', target: { sel: '.roll-wrap' } } });
    else ok('comp', `Hook sits on chord tones (${pct(fit.share)} of strong beats)`);
  }
  const lr = F.range(lead);
  if (lr) {
    const span = lr.hi - lr.lo;
    if (span > 19) add('comp', 'low', 'range-wide', `Lead spans ${span} semitones`, 'Hooks that get sung back stay within about an octave. Save big jumps for one climax note.', { fix: { label: 'Fold it into range', run: (a) => { const n = foldRange(a, lead); a.render(); return `Moved ${plural(n, 'high note')} down an octave`; } }, show: { tab: 'notes', track: 'lead', target: { sel: '.roll-wrap' } } });
    else if (span < 5 && F.notes(lead).length >= 6) add('comp', 'low', 'range-narrow', `Lead only moves ${span} semitones`, 'A hook that barely moves can sound like a drone. Give it a high point to aim at.', { show: { tab: 'notes', track: 'lead', target: { sel: '.roll-wrap' } } });
    else ok('comp', `Singable hook range (${span} semitones)`);
    const pr = F.range(pad);
    if (pr && lr.avg <= pr.avg + 3) add('comp', 'low', 'register', 'Lead sits inside the chords, not above them', 'The lead is the voice of the track; an octave up it cuts through instead of fighting the pad.', { show: { tab: 'notes', track: 'lead', target: { btn: 'Edit…' } } });
  }
  if (sub) {
    const hi = F.soundingHi(sub);
    if (hi != null && hi > 48) {
      add('comp', 'med', 'subhigh', `Your sub plays notes up to ${noteName(hi)}, above C3`, 'Above C3 a sine stops being sub and starts fighting the bass. Keep the sub low and simple.', {
        fix: { label: 'Move it down', run: (a) => { let k = 0; while (facts(a).soundingHi(sub) > 48 && k < 3) { for (const q of facts(a).used(sub)) q.notes.forEach((n) => { n.pitch -= 12; }); k++; } for (const q of facts(a).used(sub)) a.patternEdited(sub, q, false); a.render(); return `Sub moved down ${plural(k, 'octave')}`; } },
        show: { tab: 'notes', track: 'sub', target: { sel: '.roll-wrap' } } });
    } else if (hi != null) ok('comp', 'Sub stays below C3');
  }
  if (bass && drops.length) {
    const x = drops[0];
    const kicks = F.kickIn(x).map((k) => k.at);
    const ns = F.placed(bass, x, 'notes');
    const onKick = ns.filter((n) => kicks.some((k) => Math.abs(k - n.at) < 0.26)).length;
    if (ns.length >= 8 && onKick / ns.length > 0.5) add('comp', 'low', 'bass-kick', `Bass lands on the kick ${plural(onKick, 'time')} in the drop`, 'Kick and bass fight for the same space. An off-beat or rolling bass that leaves the beat to the kick sounds bigger.', { show: { tab: 'notes', track: 'bass', target: { btn: 'Chords & parts' } } });
  }

  // ---------------------------------------------------------------- sound design
  if (lead && lead.synth) {
    const o = lead.synth.osc;
    if (o.voices < 5) add('sound', 'low', 'voices', `Lead uses ${plural(o.voices, 'unison voice')}`, 'A festival supersaw is 7–9 detuned saws; fewer sound thin next to the drums.', { fix: { label: 'Use 9 voices', run: (a) => { o.voices = 9; a.soundChanged(lead); a.render(); return 'Lead: 9 voices'; } }, show: { tab: 'sound', track: 'lead', target: { card: 'Oscillator 1 · unison' } } });
    else if (o.detune > 0.72) add('sound', 'low', 'detune', `Lead detune is ±${Math.round(o.detune * 55)} ct`, 'Past about ±35 cents a supersaw sounds out of tune instead of wide.', { fix: { label: 'Set ±25 ct', run: (a) => { o.detune = 0.45; a.soundChanged(lead); a.render(); return 'Lead detune ±25 ct'; } }, show: { tab: 'sound', track: 'lead', target: { card: 'Oscillator 1 · unison' } } });
    else if (o.voices > 1 && o.detune < 0.15) add('sound', 'low', 'detune-low', 'Lead voices are barely detuned', 'Without detune the voices stack into one loud saw and the width disappears.', { fix: { label: 'Set ±25 ct', run: (a) => { o.detune = 0.45; a.soundChanged(lead); a.render(); return 'Lead detune ±25 ct'; } }, show: { tab: 'sound', track: 'lead', target: { card: 'Oscillator 1 · unison' } } });
    else ok('sound', `Lead supersaw: ${o.voices} voices, ±${Math.round(o.detune * 55)} ct`);
    const fl = lead.synth.filter;
    if (fl.type === 'lowpass' && fl.cutoff * 2 ** (fl.env * Math.max(fl.s, 0.3)) < 900) add('sound', 'low', 'dull', 'Lead is muffled', 'Its filter barely opens, so the hook will hide behind the stabs. Raise Cutoff or Env amount.', { show: { tab: 'sound', track: 'lead', target: { card: 'Filter' } } });
  }
  if (sub && sub.synth) {
    const s = sub.synth;
    if (!['sine', 'triangle'].includes(s.osc.wave) || s.osc.voices > 1 || s.osc2.level > 0.05) {
      add('sound', 'med', 'subsine', 'Sub is not a clean sine', 'Saws and unison on a sub add harmonics that clash with the bass and phase when summed to mono.', { fix: { label: 'Use Clean Sub', run: (a) => { sub.preset = 'Clean Sub'; sub.synth = presetParams('Clean Sub'); a.soundChanged(sub); a.render(); return 'Sub set to Clean Sub'; } }, show: { tab: 'sound', track: 'sub', target: { card: 'Sub bass presets' } } });
    } else ok('sound', 'Sub is a clean single sine');
    if (s.width > 0.05) add('sound', 'med', 'subwide', 'Sub is stereo', 'Stereo low end cancels itself when a club sums to mono. Keep the sub at Width: Mono.', { fix: { label: 'Make it mono', run: (a) => { s.width = 0; a.soundChanged(sub); a.render(); return 'Sub width: mono'; } }, show: { tab: 'sound', track: 'sub', target: { card: 'Pitch, glide and character' } } });
  }
  if (bass && bass.synth && bass.synth.width > 0.9) add('sound', 'low', 'basswide', `Bass width is ${pct(bass.synth.width)}`, 'The body of the bass should stay near mono; a little width is fine, full stereo is not.', { fix: { label: 'Set 60%', run: (a) => { bass.synth.width = 0.6; a.soundChanged(bass); a.render(); return 'Bass width 60%'; } }, show: { tab: 'sound', track: 'bass', target: { card: 'Pitch, glide and character' } } });
  if (pad && pad.synth && pad.synth.amp.a < 0.05 && F.notes(pad).length) add('sound', 'low', 'padattack', 'Pad starts with a hard attack', 'Pads should breathe in. An attack of 0.3–1.5 s turns a block chord into a swell.', { fix: { label: 'Set 0.6 s attack', run: (a) => { pad.synth.amp.a = 0.6; a.soundChanged(pad); a.render(); return 'Pad attack 0.6 s'; } }, show: { tab: 'sound', track: 'pad', target: { card: 'Amp envelope' } } });
  const pluck = T('pluck');
  if (pluck && pluck.synth && pluck.synth.amp.s > 0.3 && !pluck.synth.arp.on) add('sound', 'low', 'plucksus', `Pluck sustains at ${pct(pluck.synth.amp.s)}`, 'A pluck should die away on its own; sustain smears fast arps together.', { fix: { label: 'Make it pluck', run: (a) => { Object.assign(pluck.synth.amp, { s: 0, d: Math.min(0.5, Math.max(0.2, pluck.synth.amp.d)) }); pluck.synth.filter.s = 0; a.soundChanged(pluck); a.render(); return 'Pluck sustain 0'; } }, show: { tab: 'sound', track: 'pluck', target: { card: 'Amp envelope' } } });
  if (drums) {
    const k = kickInfo(p, drums.kit);
    if (![0, 7].includes(k.off)) add('sound', 'med', 'kicktune', `Kick is tuned to ${k.name}, not near the ${NOTE_NAMES[p.key]} root`, 'An out-of-key kick beats against the sub on every hit. Root or fifth only.', { fix: { label: `Tune to ${NOTE_NAMES[p.key]}`, run: (a) => { drums.kit.tune = 0; a.soundChanged(drums); a.render(); return `Kick tuned to ${NOTE_NAMES[a.project.key]}`; } }, show: { tab: 'drums', target: { card: 'Kit' } } });
    else ok('sound', `Kick tuned to ${k.name} (${k.f.toFixed(1)} Hz)`);
  }

  // ---------------------------------------------------------------- arrangement
  if (!F.secs.length) add('arr', 'high', 'nosecs', 'The song has no sections', 'Sections are the story of the track. Start with intro, build, drop.', { show: { tab: 'song', target: { btn: '+ Section' } } });
  if (F.secs.length && !drops.length) add('arr', 'high', 'nodrop', 'There is no drop', 'The drop is the whole point of a festival track. Add one after a build.', { show: { tab: 'song', target: { btn: '+ Section' } } });
  for (const x of drops) {
    if (x.bars < 16) add('arr', 'med', 'droplen-' + x.s.id, `${x.name} is ${x.bars} bars; use 16`, 'Sixteen bars gives the hook two full statements. Shorter drops end before the crowd settles in.', { fix: { label: 'Make it 16', run: (a) => { x.s.bars = 16; a.arrangementChanged(); return `${x.name} is 16 bars`; } }, show: { tab: 'song', select: () => ({ sec: x }), target: { sec: () => x } } });
  }
  const odd = F.secs.filter((x) => x.bars % 4);
  if (odd.length) add('arr', 'med', 'phrase', `${plural(odd.length, 'section')} not a multiple of 4 bars (${odd.map((x) => `${x.name} ${x.bars}`).join(', ')})`, 'Dance music moves in 8-bar phrases; odd lengths make the next section arrive at the wrong moment for DJs and dancers.', { fix: { label: 'Round them', run: (a) => { for (const x of odd) x.s.bars = roundBars(x.bars); a.arrangementChanged(); return 'Sections rounded to 4-bar phrases'; } }, show: { tab: 'song', target: { sel: '.tl-secs' } } });
  else if (F.secs.length) ok('arr', 'Every section is in 4-bar phrases');
  drops.forEach((x, k) => {
    const b = F.before(x);
    const name = x.name || (k ? `Drop ${k + 1}` : 'the drop');
    if (!b) return;
    if (!F.builds(b)) {
      add('arr', 'med', 'riser-' + x.s.id, `No riser or snare roll into ${name}`, 'Without a build-up the drop just arrives. A riser and a speeding snare roll make the crowd feel it coming.', {
        fix: fxT ? { label: 'Add a riser', run: (a) => {
          const f = facts(a);
          const bx = f.secs[b.i];
          let q = f.pat(fxT, bx);
          if (!q || f.secs.some((y) => y !== bx && f.pat(fxT, y) === q)) { q = { id: uid(), name: 'Build', bars: Math.min(16, bx.bars), notes: [], hits: [], fx: q ? structuredClone(q.fx) : [] }; fxT.patterns.push(q); bx.s.cells[fxT.id] = q.id; }
          q.fx.push({ type: 'riser', s: 0, len: q.bars * 16, vel: 1 });
          a.patternEdited(fxT, q, false);
          a.arrangementChanged();
          return `Riser added before ${name}`;
        } } : null,
        show: { tab: 'notes', track: 'fx', target: { btn: '+ Riser' } } });
    }
    if (b.type === 'build' && !F.sweeps(b)) add('arr', 'low', 'sweep-' + b.s.id, `${b.name} has no filter sweep`, 'A high-pass sweep lifts the build off the ground, so the bass slamming back on the drop feels huge.', { fix: { label: 'Add build sweep', run: (a) => { buildSweep(a.project, b.i, lead && lead.id); a.automationChanged(true); return `Build sweep on ${b.name}`; } }, show: { tab: 'song', select: () => ({ sec: b }), target: { btn: 'Add build sweep' } } });
    if (drums && F.placed(drums, b, 'hits').some((h) => ['kick', 'snare', 'clap'].includes(h.v) && h.at >= b.bars * 16 - 4)) add('arr', 'tip', 'silent-' + b.s.id, `No silent beat before ${name}`, 'Leaving the last beat of the build empty is the inhale before the drop; it makes the first kick hit twice as hard.', { show: { tab: 'drums', target: { sel: '.dgrid' } } });
    if (!F.downbeatHit(x)) add('arr', 'low', 'crash-' + x.s.id, `${name} has no crash on the downbeat`, 'The crash (or an impact) marks the moment of release; crowds expect it.', {
      fix: drums ? { label: 'Add a crash', run: (a) => { const f = facts(a); const q = f.pat(drums, f.secs[x.i]); if (!q) return 'The drop has no drum pattern'; q.hits.push({ v: 'crash', s: 0, vel: 1 }); a.patternEdited(drums, q, true); return `Crash on the first beat of ${name}`; } } : null,
      show: { tab: 'drums', target: { sel: '.dgrid' } } });
  });
  if (drops.length && drops.every((x) => F.downbeatHit(x))) ok('arr', 'Every drop starts with a crash or impact');
  if (drops.length && drops.every((x) => F.builds(F.before(x)) || !F.before(x))) ok('arr', 'Every drop is built up to');
  if (drops.length >= 2 && drops.slice(1).every((x) => p.tracks.every((t) => (x.s.cells[t.id] || null) === (drops[0].s.cells[t.id] || null)))) {
    const twist = lessonById('hook').steps.find((st) => st.id === 'twist');
    add('arr', 'low', 'samedrop', `${drops[1].name} is an exact copy of ${drops[0].name}`, 'The second drop should feel like the peak. Give the hook a new ending, or add a layer or a counter-melody, so it is not copy and paste.', {
      fix: lead && F.main(lead) ? { label: 'Give Drop 2 a new ending', run: (a) => twist.doIt.run(a, facts(a)) } : null,
      show: { tab: 'song', target: { sec: () => drops[1] } } });
  }
  if (drops.length === 1) add('arr', 'low', 'onedrop', 'Only one drop', 'Festival tracks usually tell the story twice: breakdown, build and a bigger second drop.', { show: { tab: 'song', target: { btn: '+ Section' } } });
  else if (drops.length >= 2) ok('arr', `${drops.length} drops`);
  for (const x of F.of('breakdown')) {
    const act = F.active(x);
    if (drums && F.kickIn(x).length) add('arr', 'tip', 'bdkick-' + x.s.id, `${x.name} has a kick`, 'Dropping the kick in the breakdown is what makes the next drop hit hard. Try hats or nothing at all.', { show: { tab: 'song', target: { sec: () => x } } });
    if (act.length > 5) add('arr', 'low', 'bdbusy-' + x.s.id, `${plural(act.length, 'track')} play in ${x.name}`, 'A breakdown is about space and emotion; four or five elements are plenty.', { show: { tab: 'song', target: { sec: () => x } } });
  }
  if (drops.length) {
    const peak = Math.max(...drops.map((x) => F.active(x).length));
    const busier = F.secs.filter((x) => x.type !== 'drop' && F.active(x).length > peak);
    if (busier.length) add('arr', 'low', 'energy', `${busier[0].name} is busier than the drop`, 'The drop should be the fullest section. If something else is busier, the drop feels like a step down.', { show: { tab: 'song', target: { sel: '.tl' } } });
    else ok('arr', 'The drop is the fullest section');
  }
  const intro = F.sec(0);
  if (intro && intro.type === 'intro' && intro.bars < 16) add('arr', 'tip', 'djintro', `Intro is ${intro.bars} bars`, 'DJs like 16–32 bars of mostly drums to mix in. Make a longer "extended mix" intro for club play.', { show: { tab: 'song', target: { sec: () => intro } } });
  const end = F.sec(F.secs.length - 1);
  if (end && end.type !== 'outro') add('arr', 'tip', 'outro', 'The song does not end on an outro', 'An outro with a clean beat lets the next DJ track come in.', { show: { tab: 'song', target: { btn: '+ Section' } } });
  for (const t of p.tracks) {
    if (t.role === 'fx') continue;
    const hasAny = t.patterns.some((q) => (t.role === 'drums' ? q.hits.length : q.notes.length));
    if (hasAny && !F.secs.some((x) => F.plays(t, x))) add('arr', 'low', 'unused-' + t.id, `${t.name} has notes but plays in no section`, 'Put its pattern into a section in Song, or delete the track to keep the project tidy.', { show: { tab: 'song', target: { sel: '.tl' } } });
  }
  const secs = Math.round(F.total * 240 / p.bpm);
  if (F.secs.length && secs < 180) add('arr', 'tip', 'short', `The song is ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} long`, 'Radio edits run about 3 minutes and club mixes 4–6. Longer intros, outros and a second drop get you there.');

  // ---------------------------------------------------------------- mix and master
  const solos = p.tracks.filter((t) => t.mix.solo);
  if (solos.length) add('mix', 'high', 'solo', `Solo is on (${solos.map((t) => t.name).join(', ')})`, 'The export only contains soloed tracks. Clear solo before you render.', { fix: { label: 'Clear solo', run: (a) => { solos.forEach((t) => { t.mix.solo = false; }); a.mixChanged(); a.render(); return 'Solo cleared'; } }, show: { tab: 'mix', target: { card: 'Tracks' } } });
  const muted = p.tracks.filter((t) => t.mix.mute && F.secs.some((x) => F.plays(t, x)));
  if (muted.length) add('mix', 'low', 'mute', `${muted.map((t) => t.name).join(', ')} ${muted.length === 1 ? 'is' : 'are'} muted`, 'Muted tracks are left out of the export. Fine if it is on purpose.', { fix: { label: 'Unmute', run: (a) => { muted.forEach((t) => { t.mix.mute = false; }); a.mixChanged(); a.render(); return 'Unmuted'; } }, show: { tab: 'mix', target: { card: 'Tracks' } } });
  for (const t of [...F.tracks('sub'), ...F.tracks('bass')]) {
    if (t.mix.rev > 0.1) add('mix', 'med', 'wet-' + t.id, `${t.name} has ${t.mix.rev.toFixed(2)} reverb send: keep the low end dry`, 'Reverb on low notes becomes a boomy wash that eats headroom and blurs the kick.', { fix: { label: 'Dry it', run: (a) => { t.mix.rev = 0; a.mixChanged(); a.render(); return `${t.name} reverb 0`; } }, show: { tab: 'mix', target: [{ strip: t.role, slider: 'Volume' }, { card: 'Tracks' }] } });
    if (Math.abs(t.mix.pan) > 0.05) add('mix', 'med', 'pan-' + t.id, `${t.name} is panned off centre`, 'Low end belongs in the middle: off-centre bass sounds lopsided and loses power in mono.', { fix: { label: 'Centre it', run: (a) => { t.mix.pan = 0; a.mixChanged(); a.render(); return `${t.name} centred`; } }, show: { tab: 'mix', target: { card: 'Tracks' } } });
  }
  if ([...F.tracks('sub'), ...F.tracks('bass')].length && [...F.tracks('sub'), ...F.tracks('bass')].every((t) => t.mix.rev <= 0.1 && Math.abs(t.mix.pan) <= 0.05)) ok('mix', 'Low end is dry and centred');
  const low = [...F.tracks('sub'), ...F.tracks('bass')].filter((t) => t.mix.duck < 0.5);
  if (low.length) add('mix', 'med', 'pumplow', `${low.map((t) => `${t.name} pump ${pct(t.mix.duck)}`).join(', ')}`, 'The low end barely ducks under the kick, so they fight. Bass 80–90%, sub 90–100%.', { fix: { label: 'Set the pump', run: (a) => { low.forEach((t) => { t.mix.duck = t.role === 'sub' ? 0.95 : 0.85; }); a.mixChanged(); a.render(); return 'Low-end pump set'; } }, show: { tab: 'mix', target: { card: 'Tracks' } } });
  if (drums && drums.mix.duck > 0.15) add('mix', 'med', 'pumpdrums', `Drums pump at ${pct(drums.mix.duck)}`, 'The drums carry the kick that drives the pump; ducking them dulls every hit.', { fix: { label: 'Set 0%', run: (a) => { drums.mix.duck = 0; a.mixChanged(); a.render(); return 'Drums pump 0%'; } }, show: { tab: 'mix', target: { card: 'Tracks' } } });
  if (pad && pad.mix.duck < 0.4 && F.notes(pad).length) add('mix', 'low', 'pumppad', `Pad pump is ${pct(pad.mix.duck)}`, 'A pad that does not breathe with the kick blurs the groove. Try 70–90%.', { fix: { label: 'Set 80%', run: (a) => { pad.mix.duck = 0.8; a.mixChanged(); a.render(); return 'Pad pump 80%'; } }, show: { tab: 'mix', target: { card: 'Tracks' } } });
  if (!low.length && (!drums || drums.mix.duck <= 0.15) && (sub || bass)) ok('mix', 'Sidechain amounts in the pro range');
  const M = p.master;
  if (M.ceiling > -0.9) add('mix', 'med', 'ceiling', `Ceiling is ${M.ceiling.toFixed(1)} dBFS`, 'MP3 and AAC encoding can push peaks over 0 dBFS. A −1 dB ceiling keeps streaming copies clean.', { fix: { label: 'Set −1.0', run: (a) => { a.project.master.ceiling = -1; a.mixChanged(); a.render(); return 'Ceiling −1.0 dBFS'; } }, show: { tab: 'mix', target: { card: 'Master', slider: 'Ceiling' } } });
  else ok('mix', `Ceiling ${M.ceiling.toFixed(1)} dBFS`);
  if (M.drive > 8) add('mix', 'low', 'drive', `Drive is +${M.drive.toFixed(1)} dB`, 'That much drive into the limiter flattens the kick and makes the pump jerky. Check by ear.', { show: { tab: 'mix', target: { card: 'Master', slider: 'Drive' } } });
  const eq = ['low', 'mid', 'high'].filter((k) => Math.abs(M[k]) > 4);
  if (eq.length) add('mix', 'low', 'eq', `Master EQ moves of more than 4 dB (${eq.join(', ')})`, 'Big master EQ moves usually hide a problem in one track. Fix it there.', { show: { tab: 'mix', target: { card: 'Master' } } });
  if (M.glue > 0.7) add('mix', 'low', 'glue', `Glue comp at ${pct(M.glue)}`, 'Heavy bus compression squashes the kick before the limiter. 30–50% is usually plenty.', { show: { tab: 'mix', target: { card: 'Master', slider: 'Glue comp' } } });
  if (M.pumpRelease < 0.25 || M.pumpRelease > 0.8) add('mix', 'low', 'release', `Pump release is ${M.pumpRelease.toFixed(2)} beat`, 'Around 0.4–0.6 beat the duck recovers just before the next kick. Outside that it clicks or chokes.', { fix: { label: 'Set 0.45', run: (a) => { a.project.master.pumpRelease = 0.45; a.pumpChanged(); a.render(); return 'Pump release 0.45 beat'; } }, show: { tab: 'mix', target: { card: 'Reverb, delay and sidechain' } } });
  const e = F.exp;
  if (e) {
    const tgt = { loud: -9, stream: -14 }[M.exportTarget];
    if (e.lufs > -6) add('mix', 'med', 'loudx', `Export is ${e.lufs.toFixed(1)} LUFS`, 'Louder than about −6 LUFS the limiter crushes the transients and the drop loses punch.', { show: { tab: 'mix', target: { card: 'Master', slider: 'Drive' } } });
    else if (tgt != null && Math.abs(e.lufs - tgt) > 1.5) add('mix', 'low', 'loudtgt', `Export is ${e.lufs.toFixed(1)} LUFS, target ${tgt}`, 'The master did not reach its target; the limiter may be capped by the ceiling, or the mix is very dynamic.');
    else ok('mix', `Export loudness ${e.lufs.toFixed(1)} LUFS`);
    if (e.peakDb > -0.8) add('mix', 'med', 'peak', `Export peaks at ${e.peakDb.toFixed(1)} dBFS`, 'Keep peaks at −1 dBFS or lower so encoders do not clip.', { show: { tab: 'mix', target: { card: 'Master', slider: 'Ceiling' } } });
    if (e.limitedPct > 35) add('mix', 'low', 'limited', `Limiter works ${e.limitedPct.toFixed(0)}% of the time`, 'A limiter that never rests means the mix is pushed too hard before mastering. Lower Drive a little.', { show: { tab: 'mix', target: { card: 'Master', slider: 'Drive' } } });
  } else add('mix', 'tip', 'export', 'Export once to measure the real loudness', 'The export measures integrated loudness, true peaks and limiting over the whole song.', { show: { tab: 'song', target: '#menuBtn' } });
  if (ear && ear.dropLufs != null) {
    if (ear.dropLufs < -12) add('mix', 'low', 'quiet', `The drop plays at ${ear.dropLufs.toFixed(1)} LUFS short-term`, 'Club masters sit around −9 to −7 LUFS in the drop. Raise Drive on the Master.', { show: { tab: 'mix', target: { card: 'Master', slider: 'Drive' } } });
    else if (ear.dropLufs > -6) add('mix', 'low', 'hot', `The drop plays at ${ear.dropLufs.toFixed(1)} LUFS short-term`, 'That is louder than most club masters; the kick will start to flatten.', { show: { tab: 'mix', target: { card: 'Master', slider: 'Drive' } } });
    else ok('mix', `Drop loudness ${ear.dropLufs.toFixed(1)} LUFS short-term`);
  }

  // ---------------------------------------------------------------- scores
  const order = { high: 0, med: 1, low: 2, tip: 3 };
  out.sort((a, b) => order[a.sev] - order[b.sev]);
  const areas = AREAS.map((A) => {
    const fs = out.filter((f) => f.area === A.id);
    const score = Math.max(5, Math.round(100 - fs.reduce((s, f) => s + SEV[f.sev].cost, 0)));
    return { ...A, score, findings: fs, passes: passes.filter((x) => x.area === A.id) };
  });
  let overall = Math.round(areas.reduce((s, A) => s + A.score * A.weight, 0));
  // a song with "fix first" problems can't score as nearly finished, and an empty one is a start
  const highs = out.filter((f) => f.sev === 'high').length;
  if (highs) overall = Math.min(overall, Math.max(40, 74 - 12 * (highs - 1)));
  if (!p.tracks.some((t) => MELODIC.includes(t.role) && F.notes(t).length)) overall = Math.min(overall, 25);
  return { overall, areas, findings: out, passes, verdict: verdict(overall), at: Date.now() };
}

export function verdict(n) {
  if (n >= 92) return 'Festival ready';
  if (n >= 80) return 'Almost there';
  if (n >= 65) return 'Getting there';
  if (n >= 45) return 'Taking shape';
  return 'Just getting started';
}

