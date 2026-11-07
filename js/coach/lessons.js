// The curriculum: a guided tour of the demo, then twelve lessons that take a beginner from an
// empty template to a finished, mastered festival track. Each step says what to do and why
// pros do it, where it happens (tab, track, target to spotlight), and how to tell it's done
// (check), plus optional "Do it for me" and "Listen" actions.
//
// step = { id, title, tab, track?, select?(F), target?, via?, text, why, ears?,
//          check?(F, base), base?(F), gotIt?, doIt?: { label, when?(F), run(app, F, coach) → message },
//          listen?: { label?, sec(F) → section fact, loop } }
// **bold** in text is shown bold.
import { buildSweep, addSection, uid } from '../music/project.js';
import { snareRoll } from '../audio/drums.js';
import { presetParams } from '../audio/presets.js';
import { facts, MELODIC, writePart, targetPattern, patternIn, snapToKey, roundBars, notesSig, kickInfo, foldRange, addBreaths } from './facts.js';

const DEFAULT_GEN = { pad: 'chords', stab: 'stabs', bass: 'offbass', sub: 'sub', pluck: 'arp', lead: 'melody' };

// --- small helpers for checks ----------------------------------------------------------------
const first = (F, type) => F.of(type)[0] || null;
const nth = (F, type, k) => F.of(type)[k] || null;
const last = (F, type) => { const a = F.of(type); return a[a.length - 1] || null; };
const preDrops = (F) => F.of('drop').map((x) => F.before(x)).filter(Boolean);
const heard = (F, x, n = 4) => !!x && !!F.ear && F.ear.heard(x) >= Math.min(n, x.bars - 0.5);
const crossed = (F, x) => !!x && !!F.ear && F.ear.crossed(x);
const syn = (F, role) => { const t = F.track(role); return t && t.synth; };
const mix = (F, role) => { const t = F.track(role); return t && t.mix; };
const between = (v, lo, hi) => v >= lo - 1e-9 && v <= hi + 1e-9;
const prog = (app) => (app.ui.chord && app.ui.chord.prog) || 'anthem';
const progName = { anthem: 'vi – IV – I – V', pop: 'I – V – vi – IV', emo: 'vi – V – IV – V', trance: 'i – VI – III – VII', epic: 'i – VII – VI – VII', rise: 'i – iv – VI – V', prog: 'IV – V – iii – vi', big: 'i – VI – VII – v' };

// groups of 3+ notes starting together = chords, low to high
export function chordsOf(q) {
  const by = new Map();
  for (const n of (q && q.notes) || []) {
    const k = Math.round(n.start * 4);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(n.pitch);
  }
  return [...by.entries()].filter(([, ps]) => ps.length >= 3).sort((a, b) => a[0] - b[0]).map(([, ps]) => ps.sort((a, b) => a - b));
}
function topMoves(q) {
  const cs = chordsOf(q);
  const moves = [];
  for (let i = 1; i < cs.length; i++) {
    const a = cs[i - 1][cs[i - 1].length - 1];
    const b = cs[i][cs[i].length - 1];
    if (cs[i].join() !== cs[i - 1].join()) moves.push(Math.abs(b - a));
  }
  return moves;
}
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// share of bars in a section whose drum hits of `voices` land on all the given bar steps
function barsWith(F, x, voices, steps) {
  if (!x) return 0;
  const hs = F.placed(F.track('drums'), x, 'hits').filter((h) => voices.includes(h.v));
  let good = 0;
  for (let b = 0; b < x.bars; b++) if (steps.every((s) => hs.some((h) => Math.abs(h.at - (b * 16 + s)) < 0.26))) good++;
  return good / x.bars;
}
// average hits of `voices` per bar in a section
function perBar(F, x, voices) {
  if (!x) return 0;
  return F.placed(F.track('drums'), x, 'hits').filter((h) => voices.includes(h.v)).length / x.bars;
}

// the drum pattern of a section, made if missing, for drum edits: an 8-bar phrase, so the crash
// and the fill the lesson adds land once per phrase, not on every bar
function dropDrumPat(app, F, x) { const d = F.track('drums'); return d && x ? patternIn(app, d, x, { name: 'Drop', bars: Math.min(8, x.bars) }) : null; }
function addHits(q, list) {
  for (const hit of list) if (!q.hits.some((y) => y.v === hit.v && Math.abs(y.s - hit.s) < 0.01)) q.hits.push(hit);
}
// apply something to every bar of a drum pattern
const everyBar = (q, fn) => { const out = []; for (let b = 0; b < q.bars; b++) out.push(...fn(b * 16)); return out; };

function selDrums(F, x) { const t = F.track('drums'); const q = F.pat(t, x); return t && { t, q, sec: x }; }

// write a snare roll into each section that builds into a drop, in a pattern of its own
function writeRolls(app, F) {
  const d = F.track('drums');
  if (!d) return 'There is no drum track.';
  let n = 0;
  for (const x of preDrops(F)) {
    if (F.snareRoll(x)) continue;
    // the roll spans the whole build (up to 16 bars), so it ends, with its empty last beat, on the drop
    const bars = Math.min(16, x.bars);
    const shared = F.pat(d, x) && F.secs.some((y) => y !== x && F.pat(d, y) === F.pat(d, x));
    let q = F.pat(d, x);
    if (!q || shared) { q = { id: uid(), name: 'Roll', bars, notes: [], hits: [], fx: [] }; d.patterns.push(q); x.s.cells[d.id] = q.id; }
    q.bars = bars;
    q.hits = snareRoll(bars, { withKick: true });
    app.patternEdited(d, q, false);
    n++;
  }
  app.arrangementChanged();
  return n ? `Wrote a snare roll into ${n} build${n > 1 ? 's' : ''}` : 'Every build already has a roll';
}

function addRisers(app, F) {
  let fxT = F.track('fx');
  if (!fxT) return 'There is no FX track. Add one in Mix first.';
  let n = 0;
  for (const x of preDrops(F)) {
    if (F.placed(fxT, x, 'fx').some((e) => e.type === 'riser' || e.type === 'noiseup')) continue;
    const shared = F.pat(fxT, x) && F.secs.some((y) => y !== x && F.pat(fxT, y) === F.pat(fxT, x));
    let q = F.pat(fxT, x);
    if (!q || shared) { q = { id: uid(), name: 'Build', bars: Math.min(16, x.bars), notes: [], hits: [], fx: q ? structuredClone(q.fx) : [] }; fxT.patterns.push(q); x.s.cells[fxT.id] = q.id; }
    const steps = q.bars * 16;
    q.fx.push({ type: 'riser', s: 0, len: steps, vel: 1 });
    app.patternEdited(fxT, q, false);
    n++;
  }
  app.arrangementChanged();
  return n ? `Added a riser to ${n} build${n > 1 ? 's' : ''}` : 'Every build already has a riser';
}

// remove drum hits in the last beat of each build so the drop gets its silent beat. A loop that
// repeats inside the build, or also plays in other sections, gets a copy for this build first
// (unrolled to the build's length), so only the build's very last beat goes quiet.
function silenceLastBeat(app, F) {
  const d = F.track('drums');
  if (!d) return 'There is no drum track.';
  let n = 0;
  let placed = false;
  for (const x of preDrops(F)) {
    let q = F.pat(d, x);
    if (!q) continue;
    const end = x.bars * 16;
    const loud = F.placed(d, x, 'hits').some((h) => h.at >= end - 4 && h.v !== 'crash');
    if (loud && (q.bars * 16 < end || F.secs.some((y) => y !== x && F.pat(d, y) === q))) {
      const bars = Math.min(16, x.bars);
      const hits = F.placed(d, x, 'hits').filter((h) => h.at < bars * 16).map((h) => ({ v: h.v, s: h.at, vel: h.vel }));
      q = { id: uid(), name: `${q.name} end`, bars, notes: [], hits, fx: [] };
      d.patterns.push(q);
      x.s.cells[d.id] = q.id;
      placed = true;
    }
    const steps = q.bars * 16;
    const lastRep = Math.floor((end - 1) / steps) * steps;
    const before = q.hits.length;
    q.hits = q.hits.filter((h) => { const at = h.s + lastRep; return !(at >= end - 4 && at < end && h.v !== 'crash'); });
    if (q.hits.length !== before) { n += before - q.hits.length; app.patternEdited(d, q, false); }
  }
  if (placed) app.arrangementChanged(); else app.render();
  return n ? `Cleared ${n} hits from the last beat of the build` : 'The last beat was already empty';
}

const setMix = (app, F, vals) => {
  let n = 0;
  for (const [role, kv] of Object.entries(vals)) for (const t of F.tracks(role)) { Object.assign(t.mix, kv); n++; }
  app.mixChanged();
  app.render();
  return n;
};
const setSynth = (app, t, fn) => { fn(t.synth); app.soundChanged(t); app.render(); };

// --- the curriculum -------------------------------------------------------------------------
export const STAGES = ['Start here', 'Write', 'Sound', 'Arrange', 'Mix and master'];

export const LESSONS = [
  // -------------------------------------------------------------------------------------------
  {
    id: 'tour', n: 0, title: 'Tour of the demo song', stage: 'Start here', minutes: 6, song: 'demo',
    summary: 'Hear how a festival anthem is built, section by section, before you make your own.',
    recap: ['Intro → build → drop → breakdown → build → drop → outro', 'Builds take energy away so drops can give it back', 'Every repeat adds something new'],
    steps: [
      { id: 'map', title: 'The map of a festival track', tab: 'song', target: { sel: '.tl' }, gotIt: true,
        text: 'The top row of the timeline shows the **sections**; each row under it is a **track**, and a coloured cell means that track plays there. Read it left to right: intro, build, drop, breakdown, build 2, drop 2, outro.',
        why: 'Nearly every big room, progressive and trance anthem follows this map. DJs plan their mixes around it and crowds feel it in their bodies. Learn the map first; later you can bend it on purpose.' },
      { id: 'intro', title: 'Intro: a runway for the DJ', tab: 'song', target: { sec: (F) => first(F, 'intro') },
        listen: { sec: (F) => first(F, 'intro'), loop: true },
        text: 'Press **Listen**. Kick and hats, plus a pluck whose filter slowly opens (the curve in the Pluck lane under the tracks).',
        why: 'An intro is a tool. DJs blend it under the previous record, so it needs a steady beat and very little melody to clash with. Club mixes often run the intro for 16 to 32 bars.',
        ears: 'Hear the pluck go from dull to bright? That is a low-pass filter opening, and it tells the crowd something is coming.',
        check: (F) => heard(F, first(F, 'intro')) },
      { id: 'build', title: 'Build: wind up the tension', tab: 'song', target: { sec: (F) => first(F, 'build') },
        listen: { sec: (F) => first(F, 'build'), loop: true },
        text: 'A snare roll speeds up from quarter notes to 8ths, 16ths and 32nds. A riser climbs, the master high-pass thins out the low end and the lead\'s filter opens. The very last beat is empty.',
        why: 'Tension is energy you borrow and pay back on the drop. Taking the bass away makes the drop feel enormous by contrast, and the silent beat is the breath before the shout.',
        check: (F) => heard(F, first(F, 'build')) },
      { id: 'drop', title: 'Drop: the payoff', tab: 'song', target: { sec: (F) => first(F, 'drop') },
        listen: { sec: (F) => first(F, 'drop'), loop: true },
        text: 'Crash and impact on bar 1, a kick on every beat, an off-beat bass, big room stabs and the supersaw hook, all ducking under the kick so it punches through.',
        why: 'The drop is what the crowd waited for: the loudest, widest, busiest 16 bars. Everything locks to the kick, and the sidechain makes the whole mix breathe in time.',
        ears: 'Listen to the stabs and the bass: they dip on every kick and swell back in between. That is the pump.',
        check: (F) => heard(F, first(F, 'drop')) },
      { id: 'breakdown', title: 'Breakdown: emotion and space', tab: 'song', target: { sec: (F) => first(F, 'breakdown') },
        listen: { sec: (F) => first(F, 'breakdown'), loop: true },
        text: 'No kick. The pad holds the chords, the pluck plays its arp, a downlifter falls away and a reverse cymbal swells into the next section.',
        why: 'Contrast resets the ears. After 16 bars of full energy the breakdown gives the crowd the melody and the feeling, so the second drop can hit as hard as the first.',
        check: (F) => heard(F, first(F, 'breakdown')) },
      { id: 'drop2', title: 'Build 2 into Drop 2', tab: 'song', target: { sec: (F) => nth(F, 'drop', 1) },
        listen: { label: 'Listen across the switch', sec: (F) => nth(F, 'build', 1), loop: false },
        text: 'Press **Listen** and stay for the switch. Build 2 adds the off-beat stab, so it starts higher than the first build, then Drop 2 lands.',
        why: 'Every repeat should add something. The second drop is the peak of the track, so the road into it has to feel bigger than the first time.',
        check: (F) => crossed(F, nth(F, 'drop', 1)) },
      { id: 'outro', title: 'Outro: hand it back to the DJ', tab: 'song', target: { sec: (F) => last(F, 'outro') },
        listen: { sec: (F) => last(F, 'outro'), loop: true },
        text: 'A groove with ride and perc, sub roots underneath, and the pluck\'s filter closing down.',
        why: 'The outro mirrors the intro: a clean beat the next record can be mixed over. Ending on drums is a courtesy every DJ notices.',
        check: (F) => heard(F, last(F, 'outro')) },
      { id: 'next', title: 'Your turn', tab: 'song', gotIt: true,
        doIt: { label: 'Start Lesson 1', run: (app, F, coach) => { coach.openLesson('first'); return null; } },
        text: 'You have heard the whole map. Lesson 1 gets your own first drop playing in about ten minutes with the same building blocks.',
        why: 'Pros learn by copying the structure of tracks they love and filling it with their own ideas. That is exactly what you will do next.' },
    ],
  },
  // -------------------------------------------------------------------------------------------
  {
    id: 'first', n: 1, title: 'First drop in 10 minutes', stage: 'Start here', minutes: 10, song: 'own',
    summary: 'Start from the festival template, fill it from one chord progression and hear your first drop.',
    recap: ['A template gets you to the music fast', 'One progression feeds every part, so nothing clashes', 'Listen in context, then make the hook yours'],
    steps: [
      { id: 'new', title: 'Start a new song', tab: 'song', target: '#menuBtn',
        doIt: { label: 'Start it for me', when: (F) => F.demo, run: (app) => { app.newSong(false); return null; } },
        text: 'Open the menu (**⋯**) and choose **New song**. You get the festival template: sections, drums, risers and a build sweep are in, and the melodic parts are empty for you to fill.',
        why: 'Pros rarely start from silence. A template handles the plumbing, so your first ten minutes go into the musical idea while it is still fresh.',
        check: (F) => !F.demo && F.secs.length > 0 },
      { id: 'chords', title: 'Write the chords on the pad', tab: 'notes', track: 'pad', target: { btn: 'Chords & parts' },
        doIt: { label: 'Write them for me', when: (F) => !!F.track('pad'), run: (app, F) => { const t = F.track('pad'); writePart(app, t, targetPattern(app, t), 'chords', { prog: prog(app), voicing: 'open' }); app.ui.track = t.id; app.arrangementChanged(); return `Wrote ${progName[prog(app)]} on the Pad`; } },
        text: 'Pick the **Pad** track, tap **Chords & parts**, choose **vi – IV – I – V** and tap **Write Chords (held)**.',
        why: 'Chords carry the emotion. vi – IV – I – V starts on the minor chord and climbs to the major ones, which is why it sounds sad and hopeful at the same time: the classic festival-anthem feeling.',
        check: (F) => chordsOf(F.main(F.track('pad'))).length >= 2 },
      { id: 'fill', title: 'Fill every part from the same chords', tab: 'notes', track: 'pad', target: { btn: 'Fill every synth track from this' }, via: { btn: 'Chords & parts' },
        doIt: { label: 'Fill them for me', run: (app, F) => {
          let n = 0;
          for (const t of app.project.tracks) {
            if (!MELODIC.includes(t.role)) continue;
            writePart(app, t, targetPattern(app, t), DEFAULT_GEN[t.role], { prog: prog(app), voicing: t.role === 'pad' ? 'open' : 'triad' });
            n++;
          }
          app.arrangementChanged();
          return `Filled ${n} tracks from ${progName[prog(app)]}`;
        } },
        text: 'In **Chords & parts**, tap **Fill every synth track from this**. It writes off-beat stabs, an off-beat bass, sub roots, a 16th arp on the pluck and a lead hook, all from your progression.',
        why: 'When every part grows from one progression, nothing clashes. Producers do the same thing by copying the chord MIDI to every instrument and then carving each copy into its own role.',
        check: (F) => ['lead', 'stab', 'bass', 'sub', 'pluck'].filter((r) => F.notes(F.track(r)).length > 0).length >= 4 },
      { id: 'hear', title: 'Hear your first drop', tab: 'song', target: { sec: (F) => first(F, 'drop') },
        listen: { sec: (F) => first(F, 'drop'), loop: true },
        text: 'Press **Listen** to loop the **Drop**. That is your first drop: your chords, bass and hook over the template\'s drums.',
        why: 'Listen early and often. Hearing the whole drop in context tells you more than any single part on its own.',
        check: (F) => heard(F, first(F, 'drop')) },
      { id: 'hook', title: 'Make the hook yours', tab: 'notes', track: 'lead', target: { sel: '.roll-wrap' },
        base: (F) => { const ns = F.notes(F.track('lead')); return ns.length >= 4 ? notesSig(ns) : null; },
        text: 'Pick **Lead**. Drag two or three notes of the hook up or down onto other notes of the chord (the grey ghost notes show the chords). Keep the rhythm as it is.',
        why: 'A generated hook is a sketch. Changing a few pitches on the same rhythm keeps it catchy while making it yours: most memorable hooks are a simple rhythm with one surprising note.',
        ears: 'Loop the drop while you edit; every change is re-rendered within a moment.',
        check: (F, base) => F.notes(F.track('lead')).length >= 4 && base != null && notesSig(F.notes(F.track('lead'))) !== base },
      { id: 'transition', title: 'Play the build into the drop', tab: 'song', target: { sec: (F) => first(F, 'drop') },
        listen: { label: 'Listen from the build', sec: (F) => F.before(first(F, 'drop')), loop: false },
        text: 'Press **Listen** to play from the start of the build and stay for the drop. Feel the snare roll, the riser and the high-pass sweep pull the energy back, then let it go.',
        why: 'The transition is what makes a drop feel like a drop. You will learn to shape every part of it in Lesson 9.',
        check: (F) => crossed(F, first(F, 'drop')) },
    ],
  },
  // -------------------------------------------------------------------------------------------
  {
    id: 'key', n: 2, title: 'Key and tempo', stage: 'Write', minutes: 5, song: 'any',
    summary: 'Pick a tempo for the style and a key that makes the kick and sub hit hard on a club system.',
    recap: ['Progressive 124–126, big room 126–130, trance 132–140 BPM', 'F to A keep the kick and sub at 43–55 Hz', 'Kick tuned to the root or the fifth'],
    steps: [
      { id: 'tempo', title: 'Pick a tempo for the style', tab: 'song', target: '#bpmBtn',
        text: 'Tap the tempo at the top. Progressive house sits around **124–126 BPM**, big room **126–130** and festival trance **132–140**.',
        why: 'Tempo is part of the genre. DJs mix records within a few BPM of each other, so a track far outside its style\'s range is hard to play in a set.',
        check: (F) => between(F.p.bpm, 124, 140) },
      { id: 'root', title: 'Choose a key with a strong low end', tab: 'song', target: '#keyBtn',
        text: 'Tap the key. **F, F#, G, Ab and A** are favourites: their root puts the kick and the sub between about 43 and 55 Hz.',
        why: 'That range is where big club and festival systems hit hardest. In C, the sub root is either 33 Hz (felt more than heard) or an octave up, where it starts to sound thin.',
        check: (F) => between(kickInfo(F.p, null).f, 43, 56) },
      { id: 'minor', title: 'Minor or major?', tab: 'song', target: '#keyBtn', gotIt: true,
        text: 'Most festival anthems are in a **minor** key. vi – IV – I – V gives them their lift: in F minor it plays **Fm – Db – Ab – Eb**, the same chords trance producers call i – VI – III – VII.',
        why: 'Minor gives the drama and the major chords inside the progression give the euphoria. That push and pull is the emotional core of this music. Major keys suit sunny, uplifting progressive house.' },
      { id: 'kick', title: 'Tune the kick to the key', tab: 'drums', target: [{ card: 'Kit', slider: 'Kick tune' }, { card: 'Kit' }],
        doIt: { label: 'Tune it for me', when: (F) => !!F.track('drums'), run: (app, F) => { const t = F.track('drums'); t.kit.tune = 0; app.soundChanged(t); app.render(); return `Kick tuned to ${kickInfo(F.p, t.kit).name}, the root`; } },
        text: 'Open **Drums** and find the **Kit** card. The kick follows the key and the hint shows its note and frequency. Leave **Kick tune** at **0** (the root), or try **+7** (the fifth) if that keeps it above about 40 Hz.',
        why: 'An out-of-tune kick fights the sub on every beat and makes the low end muddy even when the levels are right. In tune, kick and sub reinforce each other.',
        check: (F) => { const t = F.track('drums'); return !!t && [0, 7].includes(kickInfo(F.p, t.kit).off); } },
      { id: 'scale', title: 'See the scale in the piano roll', tab: 'notes', target: { sel: '.roll-wrap' }, gotIt: true,
        text: 'In **Notes**, the lighter rows are the notes of your key and the tinted row is the root. Write on those rows and nothing will sound wrong.',
        why: 'Pros know their key so well they stop thinking about it. Until you do, the highlighted rows are your guard rails.' },
    ],
  },
  // -------------------------------------------------------------------------------------------
  {
    id: 'chords', n: 3, title: 'Chords that lift', stage: 'Write', minutes: 8, song: 'own',
    summary: 'Choose a progression, voice it wide and smooth, and give the drop chords that punch.',
    recap: ['Four chords, one bar each, carry the mood', 'Open voicings sound big; smooth voice leading sounds pro', 'Held chords for breakdowns, stabs for drops'],
    steps: [
      { id: 'prog', title: 'Choose a progression', tab: 'notes', track: 'pad', target: { btn: 'Chords & parts' },
        doIt: { label: 'Write vi – IV – I – V', when: (F) => !!F.track('pad'), run: (app, F) => { const t = F.track('pad'); writePart(app, t, targetPattern(app, t), 'chords', { prog: 'anthem', voicing: 'triad' }); app.arrangementChanged(); return 'Wrote vi – IV – I – V on the Pad'; } },
        text: 'Open **Chords & parts** on the Pad. Try **vi – IV – I – V** (the anthem), **i – VI – III – VII** (classic trance) or **i – VI – VII – v** (darker big room), then write **Chords (held)**.',
        why: 'Four chords, one bar each, looping: that is the harmonic engine of almost every festival track. The progression sets the mood before a single melody note is written.',
        check: (F) => chordsOf(F.main(F.track('pad'))).length >= 3 },
      { id: 'open', title: 'Open up the voicing', tab: 'notes', track: 'pad', target: { btn: 'Chords & parts' },
        doIt: { label: 'Rewrite it open', when: (F) => !!F.track('pad'), run: (app, F) => { const t = F.track('pad'); writePart(app, t, targetPattern(app, t), 'chords', { prog: prog(app), voicing: 'open' }); app.arrangementChanged(); return 'Pad rewritten with open voicings'; } },
        text: 'Write the pad again with **Voicing: Open**. The root drops an octave and the third and fifth spread out above it.',
        why: 'A close triad bunches three notes into a few semitones and sounds small. Spread over two octaves the same chord sounds wide and expensive, which is exactly what a supersaw pad needs.',
        check: (F) => chordsOf(F.main(F.track('pad'))).some((c) => c[c.length - 1] - c[0] >= 13) },
      { id: 'leading', title: 'Check the voice leading', tab: 'notes', track: 'pad', target: { sel: '.roll-wrap' },
        text: 'Look at the pad in the piano roll. Each chord moves to the **closest** notes of the next: the top note moves by one or two semitones, or stays put.',
        why: 'Smooth voice leading is why a good progression sounds like one flowing sound instead of four separate blocks. Big leaps in every voice sound clumsy, even with the right chords.',
        check: (F) => { const m = topMoves(F.main(F.track('pad'))); return m.length >= 2 && avg(m) <= 5; } },
      { id: 'stabs', title: 'Give the drop chords that punch', tab: 'notes', track: 'stab', target: { btn: 'Chords & parts' },
        doIt: { label: 'Write big room stabs', when: (F) => !!F.track('stab'), run: (app, F) => { const t = F.track('stab'); writePart(app, t, targetPattern(app, t), 'bounce', { prog: prog(app), voicing: 'power', base: 57 }); app.arrangementChanged(); return 'Wrote big room stabs on the Stab'; } },
        text: 'Pick **Stab** and write **Big room stabs** with the **Power** voicing, or **Chord stabs (offbeat)** for a house bounce.',
        why: 'Held chords are for breakdowns. In a drop, short rhythmic chords leave gaps for the kick and make the groove bounce, and the pump makes them breathe.',
        check: (F) => { const ns = F.main(F.track('stab'))?.notes || []; return ns.length >= 8 && ns.filter((n) => n.len <= 2.01).length / ns.length >= 0.8; } },
      { id: 'breakdown', title: 'Listen to the chords alone', tab: 'song', target: { sec: (F) => first(F, 'breakdown') },
        listen: { sec: (F) => first(F, 'breakdown'), loop: true },
        text: 'Loop the **Breakdown**. With no kick, the chords are exposed: this is where your progression has to carry the emotion on its own.',
        why: 'If the breakdown moves you with just a pad and a pluck, the drop will too. If it does not, change the progression before you polish anything else.',
        ears: 'Try **Each chord lasts: 2 bars** in Chords & parts for a slower, more emotional breakdown.',
        check: (F) => heard(F, first(F, 'breakdown')) },
    ],
  },
  // -------------------------------------------------------------------------------------------
  {
    id: 'low', n: 4, title: 'Bass, sub and kick', stage: 'Write', minutes: 8, song: 'own',
    summary: 'Build a low end that hits: an off-beat bass, a mono sine sub, a kick in key and the sidechain that locks them.',
    recap: ['Kick on the beat, bass on the off-beat', 'Sub: held roots, sine, mono, below C3', 'Pump the bass and sub under the kick'],
    steps: [
      { id: 'offbass', title: 'Write an off-beat bass', tab: 'notes', track: 'bass', target: { btn: 'Chords & parts' },
        doIt: { label: 'Write it for me', when: (F) => !!F.track('bass'), run: (app, F) => { const t = F.track('bass'); writePart(app, t, targetPattern(app, t), 'offbass', { prog: prog(app) }); app.arrangementChanged(); return 'Wrote an off-beat bass'; } },
        text: 'Pick **Bass**, open **Chords & parts** and write **Off-beat bass**: one note on every "and" between the kicks (steps 3, 7, 11 and 15 of each bar).',
        why: 'Kick on the beat, bass on the off-beat: they never collide, and the see-saw between them is the engine of big room and progressive house.',
        check: (F) => { const ns = F.notes(F.track('bass')); return ns.length >= 8 && ns.filter((n) => Math.abs(n.start % 4 - 2) < 0.26).length / ns.length >= 0.7; } },
      { id: 'sub', title: 'Hold the roots on the sub', tab: 'notes', track: 'sub', target: { btn: 'Chords & parts' },
        doIt: { label: 'Write it for me', when: (F) => !!F.track('sub'), run: (app, F) => { const t = F.track('sub'); writePart(app, t, targetPattern(app, t), 'sub', { prog: prog(app) }); app.arrangementChanged(); return 'Wrote held roots on the Sub'; } },
        text: 'Pick **Sub** and write **Sub (held roots)**: one long note per chord, on the chord\'s root, below C3.',
        why: 'The sub is the weight you feel in your chest. One clean, held root per chord keeps the low end solid; busy sub lines turn to mud on big systems.',
        check: (F) => { const t = F.track('sub'); return F.notes(t).length >= 2 && F.soundingHi(t) <= 48; } },
      { id: 'sine', title: 'Make the sub a clean sine', tab: 'sound', track: 'sub', target: [{ card: 'Sub bass presets' }, { card: 'Oscillator 1 · unison' }],
        doIt: { label: 'Use Clean Sub', when: (F) => !!F.track('sub'), run: (app, F) => { const t = F.track('sub'); t.preset = 'Clean Sub'; t.synth = presetParams('Clean Sub'); app.soundChanged(t); app.render(); return 'Sub set to the Clean Sub preset'; } },
        text: 'In **Sound**, pick the **Clean Sub** preset: one sine wave, no unison, no stereo width.',
        why: 'A sine has no harmonics to clash with the bass above it, and a single mono voice cannot phase-cancel when a club sums the system to mono.',
        check: (F) => { const s = syn(F, 'sub'); return !!s && ['sine', 'triangle'].includes(s.osc.wave) && s.osc.voices === 1 && s.width < 0.05; } },
      { id: 'kick', title: 'Pick and tune the kick', tab: 'drums', target: [{ card: 'Kit' }],
        doIt: { label: 'Tune it to the root', when: (F) => !!F.track('drums'), run: (app, F) => { const t = F.track('drums'); t.kit.tune = 0; app.soundChanged(t); app.render(); return 'Kick tuned to the root'; } },
        text: 'In **Drums → Kit**, choose a kick: **Big Room Kick** has a long boom, **Punchy Trance Kick** is short and tight for rolling basses. Keep **Kick tune** at 0 or +7.',
        why: 'The kick\'s tail is a note. In key, kick and sub add up; out of key, they beat against each other and the low end sounds blurred.',
        check: (F) => { const t = F.track('drums'); return !!t && [0, 7].includes(kickInfo(F.p, t.kit).off); } },
      { id: 'pump', title: 'Lock them with the sidechain', tab: 'mix', target: [{ strip: 'bass', slider: 'Pump' }, { card: 'Tracks' }],
        doIt: { label: 'Set the pump for me', run: (app, F) => { setMix(app, F, { bass: { duck: 0.85 }, sub: { duck: 0.95 } }); return 'Bass pump 85%, Sub pump 95%'; } },
        text: 'In **Mix**, set **Pump** on Bass to **80–90%** and on Sub to **90–100%**. Every kick now ducks them out of the way.',
        why: 'Kick and bass share the same frequencies. Ducking the bass for a split second on each kick lets the kick punch through at full size, and the swell back creates the pumping groove.',
        check: (F) => (!F.track('bass') || mix(F, 'bass').duck >= 0.7) && (!F.track('sub') || mix(F, 'sub').duck >= 0.8) && !!(F.track('bass') || F.track('sub')) },
      { id: 'listen', title: 'Listen to the low end', tab: 'song', target: { sec: (F) => first(F, 'drop') },
        listen: { sec: (F) => first(F, 'drop'), loop: true },
        text: 'Loop the **Drop** on headphones or good speakers. You should hear the kick clearly on every beat, the bass bouncing between kicks and the sub as a steady weight underneath.',
        why: 'Most mixes fail in the low end. Getting kick, bass and sub to cooperate is half of a professional-sounding drop.',
        check: (F) => heard(F, first(F, 'drop')) },
    ],
  },
  // -------------------------------------------------------------------------------------------
  {
    id: 'drums', n: 5, title: 'Drums that drive', stage: 'Write', minutes: 8, song: 'own',
    summary: 'Program a festival beat: four on the floor, claps, off-beat hats, a crash on the drop, fills and a snare roll.',
    recap: ['Kick every beat, clap on 2 and 4, open hat on the off-beat', 'Quiet 16th hats add drive', 'Crash on the downbeat, fills at phrase ends, rolls in builds'],
    steps: [
      { id: 'four', title: 'Four on the floor', tab: 'drums', select: (F) => selDrums(F, first(F, 'drop')), target: { sel: '.dgrid' },
        doIt: { label: 'Add the kicks', when: (F) => !!first(F, 'drop') && !!F.track('drums'), run: (app, F) => { const q = dropDrumPat(app, F, first(F, 'drop')); addHits(q, everyBar(q, (o) => [0, 4, 8, 12].map((s) => ({ v: 'kick', s: o + s, vel: 1 })))); app.patternEdited(F.track('drums'), q, false); app.arrangementChanged(); return 'Kick on every beat of the drop'; } },
        text: 'This is the drop\'s drum pattern. The **Kick** hits every beat: steps 1, 5, 9 and 13 of every bar.',
        why: 'The four-on-the-floor kick is the heartbeat of house, big room and trance. Everything else in the track is arranged around it.',
        check: (F) => !!first(F, 'drop') && F.fourOnFloor(first(F, 'drop')) },
      { id: 'clap', title: 'Clap on 2 and 4', tab: 'drums', select: (F) => selDrums(F, first(F, 'drop')), target: { sel: '.dgrid' },
        doIt: { label: 'Add the claps', when: (F) => !!first(F, 'drop') && !!F.track('drums'), run: (app, F) => { const q = dropDrumPat(app, F, first(F, 'drop')); addHits(q, everyBar(q, (o) => [4, 12].map((s) => ({ v: 'clap', s: o + s, vel: 1 })))); app.patternEdited(F.track('drums'), q, false); app.arrangementChanged(); return 'Clap on 2 and 4'; } },
        text: 'Put a **Clap** on beats 2 and 4 (steps 5 and 13). Layer a quieter **Snare** under it for extra crack.',
        why: 'The backbeat gives the groove its forward lean. Without it, a four-on-the-floor kick sounds like a metronome.',
        check: (F) => barsWith(F, first(F, 'drop'), ['clap', 'snare'], [4, 12]) >= 0.75 },
      { id: 'ohat', title: 'Open hats on the off-beat', tab: 'drums', select: (F) => selDrums(F, first(F, 'drop')), target: { sel: '.dgrid' },
        doIt: { label: 'Add them', when: (F) => !!first(F, 'drop') && !!F.track('drums'), run: (app, F) => { const q = dropDrumPat(app, F, first(F, 'drop')); addHits(q, everyBar(q, (o) => [2, 6, 10, 14].map((s) => ({ v: 'ohat', s: o + s, vel: 0.8 })))); app.patternEdited(F.track('drums'), q, false); app.arrangementChanged(); return 'Open hat on every off-beat'; } },
        text: 'Add an **Open hat** on every "and" between the kicks (steps 3, 7, 11 and 15).',
        why: 'The off-beat hat is the "tss" in "boom-tss". With the off-beat bass, it is what makes people move.',
        check: (F) => barsWith(F, first(F, 'drop'), ['ohat'], [2, 6, 10, 14]) >= 0.75 },
      { id: 'hats', title: '16th hats for drive', tab: 'drums', select: (F) => selDrums(F, first(F, 'drop')), target: { sel: '.dgrid' },
        doIt: { label: 'Add quiet 16ths', when: (F) => !!first(F, 'drop') && !!F.track('drums'), run: (app, F) => { const q = dropDrumPat(app, F, first(F, 'drop')); addHits(q, everyBar(q, (o) => Array.from({ length: 16 }, (_, s) => ({ v: 'hat', s: o + s, vel: 0.45 })))); app.patternEdited(F.track('drums'), q, false); app.arrangementChanged(); return 'Quiet 16th hats in the drop'; } },
        text: 'Fill the **Hat** row with 16ths (or 8ths for a lighter feel). The **Big room drop** preset does this with the hats at low velocity.',
        why: 'Quiet 16th hats add speed and sparkle without getting in the way. Keep them low: loud 16ths sound busy and tiring after a minute.',
        check: (F) => perBar(F, first(F, 'drop'), ['hat']) >= 7.5 },
      { id: 'crash', title: 'Crash on the drop\'s downbeat', tab: 'drums', select: (F) => selDrums(F, first(F, 'drop')), target: { sel: '.dgrid' },
        doIt: { label: 'Add the crash', when: (F) => !!first(F, 'drop') && !!F.track('drums'), run: (app, F) => { const q = dropDrumPat(app, F, first(F, 'drop')); addHits(q, [{ v: 'crash', s: 0, vel: 1 }]); app.patternEdited(F.track('drums'), q, false); app.arrangementChanged(); return 'Crash on the first beat of the drop'; } },
        text: 'Put a **Crash** on step 1 of the drop.',
        why: 'The crash marks the moment of release; every DJ and every crowd expects it. Many producers add another every 8 bars to mark each phrase.',
        check: (F) => !!first(F, 'drop') && F.downbeatHit(first(F, 'drop')) },
      { id: 'fill', title: 'A fill at the end of the phrase', tab: 'drums', select: (F) => selDrums(F, first(F, 'drop')), target: { sel: '.dgrid' },
        doIt: { label: 'Add a fill', when: (F) => !!first(F, 'drop') && !!F.track('drums'), run: (app, F) => { const q = dropDrumPat(app, F, first(F, 'drop')); const e = q.bars * 16; addHits(q, [{ v: 'snare', s: e - 3, vel: 0.7 }, { v: 'snare', s: e - 2, vel: 0.85 }, { v: 'snare', s: e - 1, vel: 1 }]); app.patternEdited(F.track('drums'), q, false); app.arrangementChanged(); return 'Snare fill on the last beat of the drop pattern'; } },
        text: 'On the last beat of the drop pattern, add two or three **Snare** hits on the 16ths (the last steps of the final bar). Use **Bar** buttons to get to the last bar.',
        why: 'A fill tells the crowd "something changes now". It marks the end of an 8-bar phrase and makes the next bar land harder.',
        check: (F) => { const q = F.pat(F.track('drums'), first(F, 'drop')); if (!q) return false; const e = q.bars * 16; return q.hits.filter((h) => ['snare', 'clap', 'perc'].includes(h.v) && h.s > e - 4 + 0.01 && h.s < e).length >= 2; } },
      { id: 'roll', title: 'A snare roll for the build', tab: 'drums', select: (F) => selDrums(F, F.before(first(F, 'drop'))), target: { btn: 'Snare roll…' },
        doIt: { label: 'Write the roll', when: (F) => preDrops(F).length > 0, run: (app, F) => writeRolls(app, F) },
        text: 'Open the **Build**\'s drum pattern and tap **Snare roll…**. Quarter notes become 8ths, 16ths and 32nds, getting louder, with the last beat left open.',
        why: 'Speeding up the rhythm is the oldest trick for building tension. The ear hears acceleration as rising energy, even though the tempo never changes.',
        check: (F) => preDrops(F).length > 0 && preDrops(F).some((x) => F.snareRoll(x)) },
    ],
  },
  // -------------------------------------------------------------------------------------------
  {
    id: 'hook', n: 6, title: 'Writing the hook', stage: 'Write', minutes: 10, song: 'own',
    summary: 'Write a lead melody people remember: rhythm first, chord tones on the beat, question and answer, a singable range.',
    recap: ['Rhythm first, pitches second', 'Chord tones on strong beats', 'Ask and answer, within about an octave, above the chords'],
    steps: [
      { id: 'rhythm', title: 'Rhythm first', tab: 'notes', track: 'lead', target: { sel: '.roll-wrap' }, gotIt: true,
        text: 'Before thinking about notes, tap the hook\'s **rhythm** on a single note. Great hooks mix long and short notes, such as dotted 8ths (3 steps) against 8ths, and leave a gap to breathe.',
        why: 'People remember rhythm before pitch. If the hook is catchy played on one note, it will be unforgettable with the right melody on top.' },
      { id: 'tones', title: 'Chord tones on the strong beats', tab: 'notes', track: 'lead', target: { sel: '.roll-wrap' },
        doIt: { label: 'Write a hook for me', when: (F) => !!F.track('lead'), run: (app, F) => { const t = F.track('lead'); writePart(app, t, targetPattern(app, t), 'melody', { prog: prog(app) }); app.arrangementChanged(); return 'Wrote a chord-tone hook on the Lead'; } },
        text: 'Notes that start on a beat should be **chord tones**: notes of the chord playing under them (the ghost notes show them). Save the other notes for the steps in between.',
        why: 'Chord tones on strong beats sound confident and "right"; passing notes between them add movement. Off-chord notes on the beat sound like mistakes at festival volume.',
        check: (F) => { const f = F.hookFit(); return !!f && f.strong >= 4 && f.share >= 0.6; } },
      { id: 'answer', title: 'Question and answer', tab: 'notes', track: 'lead', target: { sel: '.roll-wrap' },
        doIt: { label: 'Add the breaths', when: (F) => !!F.main(F.track('lead')) && F.main(F.track('lead')).notes.length >= 6, run: (app, F) => { const n = addBreaths(app, F.track('lead')); app.render(); return n ? `Removed ${n} notes to leave a breath every other bar` : 'The hook already breathes'; } },
        text: 'Shape the hook in pairs: bars 1–2 **ask** (end on an unfinished note, like the 2nd or the 5th of the key), bars 3–4 **answer** (come home to a stable note, ideally the root of the key). Leave a short gap between them.',
        why: 'Question and answer is how the ear makes sense of a melody. It is why a good hook feels complete after four bars and makes you want to hear it again.',
        check: (F) => {
          const q = F.main(F.track('lead'));
          if (!q || q.notes.length < 4 || q.bars < 2) return false;
          const ns = q.notes.slice().sort((a, b) => a.start - b.start);
          let gaps = 0;
          for (let i = 1; i < ns.length; i++) if (ns[i].start - (ns[i - 1].start + ns[i - 1].len) >= 3.5) gaps++;
          if (q.bars * 16 - (ns[ns.length - 1].start + ns[ns.length - 1].len) >= 3.5) gaps++;
          return gaps >= Math.max(1, Math.floor(q.bars / 4));
        } },
      { id: 'range', title: 'Keep it singable', tab: 'notes', track: 'lead', target: { sel: '.roll-wrap' },
        doIt: { label: 'Fold it into range', when: (F) => { const r = F.range(F.track('lead')); return !!r && r.hi - r.lo > 15; }, run: (app, F) => { const n = foldRange(app, F.track('lead')); app.render(); return `Moved ${n} high note${n === 1 ? '' : 's'} down an octave`; } },
        text: 'Keep the hook within about an **octave** (12 semitones). Jump higher only for the climax note.',
        why: 'Festival hooks get sung back by tens of thousands of people. A narrow range is easy to sing and to remember; a wide one sounds like an exercise.',
        check: (F) => { const r = F.range(F.track('lead')); return !!r && between(r.hi - r.lo, 5, 15); } },
      { id: 'inkey', title: 'Stay in key', tab: 'notes', track: 'lead', target: { sel: '.roll-wrap' },
        doIt: { label: 'Snap to the key', when: (F) => F.outOfKey(F.track('lead')).length > 0, run: (app, F) => { const n = snapToKey(app, F.track('lead')); app.render(); return `Moved ${n} lead note${n === 1 ? '' : 's'} into ${F.key}`; } },
        text: 'Check that every lead note sits on a highlighted row of the piano roll.',
        why: 'One wrong note repeated 32 times in a drop is all the crowd will hear. Stay in key unless you are borrowing a note on purpose for colour.',
        check: (F) => F.notes(F.track('lead')).length >= 4 && F.outOfKey(F.track('lead')).length === 0 },
      { id: 'above', title: 'Sit above the chords', tab: 'notes', track: 'lead', target: [{ btn: 'Edit…' }, { sel: '.roll-wrap' }],
        doIt: { label: 'Move it up an octave', when: (F) => { const a = F.range(F.track('lead')); const b = F.range(F.track('pad')); return !!a && !!b && a.avg <= b.avg + 5; }, run: (app, F) => {
          const t = F.track('lead');
          const b = F.range(F.track('pad'));
          let k = 0;
          while (F.range(t) && facts(app).range(t).avg <= b.avg + 5 && k < 2) { for (const q of F.used(t)) q.notes.forEach((n) => { n.pitch += 12; }); k++; }
          for (const q of F.used(t)) app.patternEdited(t, q, false);
          app.render();
          return `Lead moved up ${k} octave${k === 1 ? '' : 's'}`;
        } },
        text: 'The lead should sit **above** the chords: its average note higher than the pad\'s. If it is not, use **Edit… → Octave up** on the lead pattern.',
        why: 'The lead is the voice of the track. Above the chords it cuts through; buried inside them it fights the pad for the same space.',
        check: (F) => { const a = F.range(F.track('lead')); const b = F.range(F.track('pad')); return !!a && (!b || a.avg > b.avg + 5); } },
      { id: 'twist', title: 'Repeat with a twist', tab: 'notes', track: 'lead', target: { btn: 'Copy' },
        doIt: { label: 'Make a Drop 2 version', when: (F) => F.of('drop').length >= 2 && !!F.main(F.track('lead')), run: (app, F) => {
          const t = F.track('lead');
          const src = F.main(t);
          let name = 'Hook 2';
          for (let k = 3; t.patterns.some((y) => y.name === name); k++) name = `Hook ${k}`;
          const q = { ...structuredClone(src), id: uid(), name };
          // a new ending: the last note climbs to the next key note that is also in the chord
          const ns = q.notes.slice().sort((a, b) => a.start - b.start);
          const end = ns[ns.length - 1];
          if (end) {
            const x = F.of('drop')[1];
            const bar = F.harmony(x)[Math.floor(end.start / 16)] || new Set();
            for (let up = 1; up <= 7; up++) { const p = end.pitch + up; if (F.pcs.has(p % 12) && (bar.size < 2 || bar.has(p % 12))) { end.pitch = p; break; } }
          }
          t.patterns.push(q);
          F.of('drop')[1].s.cells[t.id] = q.id;
          app.patternEdited(t, q, false);
          app.arrangementChanged();
          return `${name} (new ending) now plays in the second drop`;
        } },
        text: 'Use **Copy** on the lead pattern, change only the **last bar** of the copy, and put the copy in **Drop 2** (tap the Lead cell of Drop 2 in Song).',
        why: 'Repetition makes a hook stick; a small change keeps the second drop from feeling like copy and paste. Same start, new ending is the classic move.',
        check: (F) => { const u = F.used(F.track('lead')).filter((q) => q.notes.length >= 4); return u.length >= 2 && new Set(u.map((q) => notesSig(q.notes))).size >= 2; } },
    ],
  },
  // -------------------------------------------------------------------------------------------
  {
    id: 'sound', n: 7, title: 'Designing the supersaw and pluck', stage: 'Sound', minutes: 10, song: 'any',
    summary: 'Shape a festival supersaw from scratch (unison, detune, filter envelope, ADSR), then turn a synth into a crisp pluck.',
    recap: ['7–9 voices, ±20–30 ct, wide stereo', 'Filter envelope = movement', 'Pluck = no sustain, fast filter decay'],
    steps: [
      { id: 'voices', title: 'Stack the unison voices', tab: 'sound', track: 'lead', target: [{ card: 'Oscillator 1 · unison', slider: 'Voices' }, { card: 'Oscillator 1 · unison' }],
        doIt: { label: 'Set 9 voices', when: (F) => !!F.track('lead'), run: (app, F) => { setSynth(app, F.track('lead'), (s) => { s.osc.voices = 9; }); return 'Lead: 9 unison voices'; } },
        text: 'Pick **Lead** in **Sound**. In **Oscillator 1 · unison**, set **Voices** to **7–9**.',
        why: 'A supersaw is a stack of slightly detuned saw waves. Every extra voice thickens it; 7 to 9 is where it becomes the wall of sound festival leads are known for.',
        check: (F) => { const s = syn(F, 'lead'); return !!s && s.osc.voices >= 7; } },
      { id: 'detune', title: 'Detune and spread', tab: 'sound', track: 'lead', target: [{ card: 'Oscillator 1 · unison', slider: 'Detune' }, { card: 'Oscillator 1 · unison' }],
        doIt: { label: 'Set them for me', when: (F) => !!F.track('lead'), run: (app, F) => { setSynth(app, F.track('lead'), (s) => { s.osc.detune = 0.45; s.osc.spread = 0.95; }); return 'Lead: detune ±25 ct, stereo 95%'; } },
        text: 'Set **Detune** to about **±20–30 ct** and **Stereo** to **80–100%**.',
        why: 'Detune makes the voices drift against each other: too little sounds thin, too much sounds seasick. Spreading them across left and right makes the lead wider than the speakers.',
        check: (F) => { const s = syn(F, 'lead'); return !!s && between(s.osc.detune, 0.33, 0.6) && s.osc.spread >= 0.75; } },
      { id: 'filter', title: 'Let the filter breathe', tab: 'sound', track: 'lead', target: { card: 'Filter' },
        doIt: { label: 'Set it for me', when: (F) => !!F.track('lead'), run: (app, F) => { setSynth(app, F.track('lead'), (s) => { Object.assign(s.filter, { type: 'lowpass', cutoff: 3200, res: 1.2, env: 1.6, a: 0.004, d: 0.35, s: 0.55 }); }); return 'Lead filter: 3.2 kHz, res 1.2, env 1.6 oct'; } },
        text: 'In **Filter**, keep **Cutoff** around **2.5–4.5 kHz**, **Resonance** low (**1–2**) and **Env amount** at **1–2 oct** with a short **Decay** (0.2–0.5 s).',
        why: 'The filter envelope makes every note open bright and settle a little. That movement is what makes a lead feel alive instead of static, and low resonance keeps it smooth at high volume.',
        check: (F) => { const s = syn(F, 'lead'); return !!s && s.filter.type === 'lowpass' && between(s.filter.cutoff, 1500, 6000) && s.filter.res <= 3 && s.filter.env >= 0.8; } },
      { id: 'amp', title: 'Shape the amp envelope', tab: 'sound', track: 'lead', target: { card: 'Amp envelope' },
        doIt: { label: 'Set it for me', when: (F) => !!F.track('lead'), run: (app, F) => { setSynth(app, F.track('lead'), (s) => { Object.assign(s.amp, { a: 0.005, d: 0.3, s: 0.85, r: 0.22 }); }); return 'Lead envelope: 5 ms attack, 85% sustain, 0.22 s release'; } },
        text: 'In **Amp envelope**: **Attack** under 10 ms, **Sustain** high (70–90%) and **Release** 0.15–0.4 s.',
        why: 'A fast attack makes the lead speak right on the beat, a high sustain holds the long notes, and a short release stops notes smearing into each other while leaving a little tail.',
        check: (F) => { const s = syn(F, 'lead'); return !!s && s.amp.a <= 0.012 && s.amp.s >= 0.65 && between(s.amp.r, 0.1, 0.5); } },
      { id: 'pluck', title: 'Turn the pluck into a pluck', tab: 'sound', track: 'pluck', target: [{ card: 'Amp envelope' }, { card: 'Filter' }],
        doIt: { label: 'Set it for me', when: (F) => !!F.track('pluck'), run: (app, F) => { setSynth(app, F.track('pluck'), (s) => { Object.assign(s.amp, { a: 0.002, d: 0.38, s: 0 }); Object.assign(s.filter, { env: 4.5, d: 0.22, s: 0 }); }); return 'Pluck: no sustain, 4.5 oct filter snap'; } },
        text: 'Pick **Pluck**. In **Amp envelope**, set **Sustain** to **0** and **Decay** to **0.2–0.5 s**. In **Filter**, set **Sustain** to 0 with a high **Env amount** (3–5 oct) and a short **Decay**.',
        why: 'A pluck is all attack: the filter snaps open and closes again in a fraction of a second. With no sustain, fast arps stay crisp and leave space between the notes.',
        check: (F) => { const s = syn(F, 'pluck'); return !!s && s.amp.s <= 0.1 && between(s.amp.d, 0.12, 0.7) && s.filter.s <= 0.15 && s.filter.env >= 2.5; } },
      { id: 'presets', title: 'Compare the lead presets', tab: 'sound', track: 'lead', target: { card: 'Supersaw lead presets' }, gotIt: true,
        text: 'Try **Festival Supersaw**, **Euphoric Trance Lead** (mono with glide) and **Big Room Lead** (a pitch drop on every note plus distortion). Press **▶ Chord** after each one.',
        why: 'Presets are a shortcut to learning: notice what each one changes, then rebuild that idea on your own sound.' },
      { id: 'listen', title: 'Hear it in the drop', tab: 'song', target: { sec: (F) => first(F, 'drop') },
        listen: { sec: (F) => first(F, 'drop'), loop: true },
        text: 'Loop the **Drop** and listen to the lead with everything else playing.',
        why: 'Sounds that are huge on their own can be too much in a mix. Always judge a sound in context.',
        check: (F) => heard(F, first(F, 'drop')) },
    ],
  },
  // -------------------------------------------------------------------------------------------
  {
    id: 'arrange', n: 8, title: 'Arrangement', stage: 'Arrange', minutes: 8, song: 'own',
    summary: 'Turn loops into a track: 8-bar phrases, a 16-bar drop, a DJ intro and outro, an energy map and a second drop.',
    recap: ['Sections in 8- and 16-bar phrases', 'Energy map: drops busiest, breakdowns sparse', 'DJ-friendly intro and outro'],
    steps: [
      { id: 'phrases', title: 'Think in 8-bar phrases', tab: 'song', target: { sel: '.tl-secs' },
        doIt: { label: 'Round them for me', when: (F) => F.secs.some((x) => x.bars % 4), run: (app, F) => { for (const x of F.secs) x.s.bars = roundBars(x.bars); app.arrangementChanged(); return 'Every section is now a multiple of 4 bars'; } },
        text: 'Every section should be a multiple of **4** bars, ideally **8** or **16**. Use **− bars** and **+ bars** in the section card under the timeline.',
        why: 'Dance music is counted in 8-bar phrases. DJs and dancers feel the change on bars 9, 17 and 33; a 6- or 10-bar section makes the next one arrive at the "wrong" moment.',
        check: (F) => F.secs.length >= 3 && F.secs.every((x) => x.bars % 4 === 0) },
      { id: 'drop16', title: 'Give the drop 16 bars', tab: 'song', target: { sec: (F) => first(F, 'drop') },
        doIt: { label: 'Make drops 16 bars', when: (F) => F.of('drop').some((x) => x.bars < 16), run: (app, F) => { for (const x of F.of('drop')) if (x.bars < 16) x.s.bars = 16; app.arrangementChanged(); return 'Every drop is 16 bars'; } },
        text: 'Select the **Drop** and make it **16 bars**.',
        why: 'Eight bars of drop is over before the crowd has jumped twice. Sixteen gives the hook two full statements, the standard in festival music.',
        check: (F) => F.of('drop').length > 0 && F.of('drop').every((x) => x.bars >= 16) },
      { id: 'intro', title: 'A DJ-friendly intro', tab: 'song', target: { sec: (F) => first(F, 'intro') || F.sec(0) },
        doIt: { label: 'Make it 16 bars', when: (F) => !!first(F, 'intro') && first(F, 'intro').bars < 16, run: (app, F) => { first(F, 'intro').s.bars = 16; app.arrangementChanged(); return 'Intro is 16 bars'; } },
        text: 'Make the intro **16 bars** or more, with the kick and hats and very little melody.',
        why: 'DJs need a runway to mix your track in. A long, sparse intro is the first thing that makes a track DJ-friendly, and that gets it played.',
        check: (F) => { const x = F.sec(0); return !!x && x.type === 'intro' && x.bars >= 16 && F.kickIn(x).length > 0; } },
      { id: 'energy', title: 'Draw the energy map', tab: 'song', target: { sel: '.tl' },
        text: 'Count the coloured cells in each column. The **drop** should have the most tracks, the **breakdown** far fewer, and builds add parts as they go.',
        why: 'Arrangement is energy management. Contrast between sections is what makes a drop feel big; a full mix that never changes just sounds loud.',
        check: (F) => {
          const drops = F.of('drop');
          if (!drops.length) return false;
          const peak = Math.max(...drops.map((x) => F.active(x).length));
          const others = F.secs.filter((x) => x.type !== 'drop');
          return others.every((x) => F.active(x).length <= peak) && F.of('breakdown').every((x) => F.active(x).length < peak);
        } },
      { id: 'second', title: 'Add the second drop', tab: 'song', target: { btn: '+ Section' },
        doIt: { label: 'Add breakdown, build and drop', when: (F) => F.of('drop').length === 1, run: (app, F) => {
          const p = app.project;
          const drop = F.of('drop')[0];
          const like = (type) => F.of(type)[0];
          let at = drop.i + 1;
          const add = (type, bars, src) => { const s = addSection(p, type, bars, at++); if (src) s.cells = { ...src.s.cells }; return s; };
          add('breakdown', 8, like('breakdown') || like('intro'));
          const b = add('build', (like('build') || {}).bars || 8, like('build'));
          b.name = 'Build 2';
          const d2 = add('drop', Math.max(16, drop.bars), drop);
          d2.name = 'Drop 2';
          const lead = p.tracks.find((t) => t.role === 'lead');
          buildSweep(p, p.sections.indexOf(b), lead && lead.id);
          app.automationChanged(false);
          app.arrangementChanged();
          return 'Added Breakdown → Build 2 → Drop 2 after the first drop';
        } },
        text: 'After the first drop, add a **Breakdown**, a **Build** and a second **Drop** with **+ Section**. Each new section starts with the parts of the last section of its type.',
        why: 'Festival tracks tell the story twice: the first drop introduces the hook, the breakdown builds emotion, and the second drop pays it off even bigger.',
        check: (F) => F.of('drop').length >= 2 && F.of('build').length >= 2 },
      { id: 'outro', title: 'An outro to mix out of', tab: 'song', target: { sec: (F) => F.sec(F.secs.length - 1) },
        doIt: { label: 'Fix the outro', when: (F) => !(F.secs.length && F.sec(F.secs.length - 1).type === 'outro' && F.sec(F.secs.length - 1).bars >= 8), run: (app, F) => {
          const p = app.project;
          const lastX = F.sec(F.secs.length - 1);
          if (lastX && lastX.type === 'outro') { lastX.s.bars = 16; app.arrangementChanged(); return 'Outro is 16 bars'; }
          const s = addSection(p, 'outro', 16);
          const intro = first(F, 'intro');
          if (intro) s.cells = { ...intro.s.cells };
          app.arrangementChanged();
          return 'Added a 16-bar outro with the intro\'s parts';
        } },
        text: 'End with an **Outro** of 8–16 bars: drums and a few elements, mirroring the intro.',
        why: 'The outro is where the next DJ track comes in. A clean beat at the end makes your track easy to mix out of.',
        check: (F) => { const x = F.sec(F.secs.length - 1); return !!x && x.type === 'outro' && x.bars >= 8 && F.kickIn(x).length > 0; } },
    ],
  },
  // -------------------------------------------------------------------------------------------
  {
    id: 'tension', n: 9, title: 'Tension and release', stage: 'Arrange', minutes: 8, song: 'own',
    summary: 'Make every drop explode: snare roll, riser, high-pass sweep, the silent beat and an impact on the downbeat.',
    recap: ['Roll, riser and sweep stack up the tension', 'One silent beat before the drop', 'A big hit on the downbeat'],
    steps: [
      { id: 'roll', title: 'A snare roll that speeds up', tab: 'drums', select: (F) => selDrums(F, F.before(first(F, 'drop'))), target: { btn: 'Snare roll…' },
        doIt: { label: 'Write the rolls', when: (F) => preDrops(F).some((x) => !F.snareRoll(x)), run: (app, F) => writeRolls(app, F) },
        text: 'Each section before a drop needs a snare roll that speeds up (Drums → **Snare roll…**). Use 8 bars for a big build and 4 for a short one.',
        why: 'Acceleration is tension. Doubling the snare rate every couple of bars makes the build feel like it is racing towards the drop.',
        check: (F) => preDrops(F).length > 0 && preDrops(F).every((x) => F.snareRoll(x)) },
      { id: 'riser', title: 'A riser into the drop', tab: 'notes', track: 'fx', select: (F) => { const t = F.track('fx'); const x = F.before(first(F, 'drop')); return t && { t, q: F.pat(t, x), sec: x }; }, target: { btn: '+ Riser' },
        doIt: { label: 'Add the risers', when: (F) => !!F.track('fx') && preDrops(F).length > 0, run: (app, F) => addRisers(app, F) },
        text: 'Pick the **FX** track in Notes and add a **+ Riser** to the build\'s pattern. It climbs in pitch and brightness and peaks right at the drop.',
        why: 'A riser is a musical arrow pointing at the drop. It glues the build together and makes the moment of release unmistakable.',
        check: (F) => preDrops(F).length > 0 && preDrops(F).every((x) => F.tracks('fx').some((t) => F.placed(t, x, 'fx').some((e) => e.type === 'riser' || e.type === 'noiseup'))) },
      { id: 'sweep', title: 'High-pass sweep', tab: 'song', select: (F) => { const x = F.before(first(F, 'drop')); return x && { sec: x }; }, target: { btn: 'Add build sweep' },
        doIt: { label: 'Add the sweeps', when: (F) => preDrops(F).some((x) => !F.sweeps(x)), run: (app, F) => {
          const lead = F.track('lead');
          let n = 0;
          for (const x of preDrops(F)) if (!F.sweeps(x)) { buildSweep(app.project, x.i, lead && lead.id); n++; }
          app.automationChanged(true);
          return `Build sweep on ${n} section${n === 1 ? '' : 's'}`;
        } },
        text: 'Select the **Build** in Song and tap **Add build sweep**: the master high-pass rises, the lead\'s filter opens and its reverb swells, then everything snaps back on the drop.',
        why: 'Filtering out the low end makes the mix feel like it is lifting off the ground. When the bass slams back on the drop, the contrast does the rest.',
        check: (F) => preDrops(F).length > 0 && preDrops(F).every((x) => F.sweeps(x)) },
      { id: 'silent', title: 'The silent beat', tab: 'drums', select: (F) => selDrums(F, F.before(first(F, 'drop'))), target: { sel: '.dgrid' },
        doIt: { label: 'Clear the last beat', when: (F) => !!F.track('drums'), run: (app, F) => silenceLastBeat(app, F) },
        text: 'Leave the **last beat** of the build empty: no kick, no snare. The Snare roll tool already does this.',
        why: 'A split second of silence before the drop is the crowd\'s inhale. It makes the first kick of the drop feel twice as loud.',
        check: (F) => preDrops(F).length > 0 && preDrops(F).every((x) => !F.placed(F.track('drums'), x, 'hits').some((h) => ['kick', 'snare', 'clap'].includes(h.v) && h.at >= x.bars * 16 - 4)) },
      { id: 'impact', title: 'A hit on the downbeat', tab: 'notes', track: 'fx', select: (F) => { const t = F.track('fx'); const x = first(F, 'drop'); return t && { t, q: F.pat(t, x), sec: x }; }, target: { btn: '+ Impact' },
        doIt: { label: 'Add impacts', when: (F) => !!F.track('fx') && F.of('drop').some((x) => !F.downbeatHit(x)), run: (app, F) => {
          const t = F.track('fx');
          let n = 0;
          for (const x of F.of('drop')) {
            if (F.downbeatHit(x)) continue;
            const q = patternIn(app, t, x, { name: 'Drop', bars: Math.min(16, x.bars) });
            q.fx.push({ type: 'impact', s: 0, len: Math.min(64, q.bars * 16), vel: 1 });
            app.patternEdited(t, q, false);
            n++;
          }
          app.arrangementChanged();
          return `Impact on ${n} drop${n === 1 ? '' : 's'}`;
        } },
        text: 'Make sure every drop starts with an **Impact** on the FX track or a **Crash** on step 1.',
        why: 'After all that tension the drop needs a full stop: one big hit on the downbeat that says "now".',
        check: (F) => F.of('drop').length > 0 && F.of('drop').every((x) => F.downbeatHit(x)) },
      { id: 'listen', title: 'Hear the whole transition', tab: 'song', target: { sec: (F) => first(F, 'drop') },
        listen: { label: 'Listen from the build', sec: (F) => F.before(first(F, 'drop')), loop: false },
        text: 'Press **Listen** and play the build into the drop. Follow the roll speeding up, the riser climbing, the low end disappearing, the silent beat, then the impact.',
        why: 'Each of these tricks is small on its own. Stacked together they create the rush that makes festival crowds lose it.',
        check: (F) => crossed(F, first(F, 'drop')) },
    ],
  },
  // -------------------------------------------------------------------------------------------
  {
    id: 'pump', n: 10, title: 'Sidechain and groove', stage: 'Mix and master', minutes: 6, song: 'any',
    summary: 'Make the whole track breathe with the kick: pump amounts per role, release, curve and the FX returns.',
    recap: ['Low and long sounds pump the most', 'Release 0.4–0.6 beat', 'Pump the reverb and delay too'],
    steps: [
      { id: 'what', title: 'What the pump does', tab: 'mix', target: { card: 'Reverb, delay and sidechain' }, gotIt: true,
        listen: { sec: (F) => first(F, 'drop'), loop: true },
        text: 'Each kick starts an envelope that ducks the other tracks: gain = 1 − **Pump** × envelope. **Pump release** sets how fast they swell back.',
        why: 'In this style the sidechain is not just a mix fix, it is part of the groove: the whole track breathes in time with the kick.' },
      { id: 'amounts', title: 'Set the pump per track', tab: 'mix', target: { card: 'Tracks' },
        doIt: { label: 'Set them for me', run: (app, F) => { setMix(app, F, { sub: { duck: 0.95 }, bass: { duck: 0.85 }, pad: { duck: 0.8 }, stab: { duck: 0.7 }, lead: { duck: 0.55 }, pluck: { duck: 0.5 }, drums: { duck: 0 } }); return 'Pump set for every role'; } },
        text: 'Starting points: **Sub 90–100%**, **Bass 80–90%**, **Pad 70–90%**, **Stab 60–80%**, **Lead 40–60%**, **Drums 0%**.',
        why: 'The lower and longer a sound, the more it competes with the kick, so it ducks the most. The lead ducks less so the hook stays steady, and drums never duck because they carry the kick.',
        check: (F) => !!(F.track('sub') || F.track('bass') || F.track('pad')) && (!F.track('sub') || mix(F, 'sub').duck >= 0.8) && (!F.track('bass') || mix(F, 'bass').duck >= 0.7) && (!F.track('pad') || mix(F, 'pad').duck >= 0.6) && (!F.track('drums') || mix(F, 'drums').duck <= 0.1) },
      { id: 'release', title: 'Time the release', tab: 'mix', target: [{ card: 'Reverb, delay and sidechain', slider: 'Pump release' }, { card: 'Reverb, delay and sidechain' }],
        doIt: { label: 'Set 0.45 beat', run: (app) => { app.project.master.pumpRelease = 0.45; app.pumpChanged(); app.render(); return 'Pump release 0.45 beat'; } },
        text: 'Set **Pump release** to **0.4–0.6 beat**, so the duck recovers just before the next kick.',
        why: 'Too short and the pump sounds like a click; too long and the tracks never come back up, so the mix sounds quiet and choked.',
        check: (F) => between(F.p.master.pumpRelease, 0.35, 0.65) },
      { id: 'curve', title: 'Choose the curve', tab: 'mix', target: [{ card: 'Reverb, delay and sidechain', slider: 'Pump curve' }, { card: 'Reverb, delay and sidechain' }],
        text: '**Pump curve** shapes the swell: **Smooth** holds the duck longer and swells back late (a deep, slow breath for progressive house), **Classic** is the familiar pump for big room and trance, **Hard** cuts a short, sharp dip on each kick that recovers fast.',
        why: 'The same pump amount can feel like slow breathing or a tight bounce depending on its shape. Pros pick it by ear: watch the pump graph and listen to the pad while you switch.',
        check: (F) => between(F.p.master.pumpCurve, 1.4, 2.8) },
      { id: 'fx', title: 'Pump the reverb and delay too', tab: 'mix', target: [{ card: 'Reverb, delay and sidechain', slider: 'Pump on FX' }, { card: 'Reverb, delay and sidechain' }],
        doIt: { label: 'Set 50%', run: (app) => { app.project.master.pumpFx = 0.5; app.mixChanged(); app.render(); return 'Pump on FX 50%'; } },
        text: 'Set **Pump on FX** to **40–60%** so the reverb and delay tails duck with the kick.',
        why: 'Long reverb tails fill the space between kicks and blur the groove. Pumping them keeps the space but leaves every kick clean.',
        check: (F) => F.p.master.pumpFx >= 0.3 },
      { id: 'listen', title: 'Listen for the breathing', tab: 'mix', target: { card: 'Tracks' },
        listen: { sec: (F) => first(F, 'drop'), loop: true },
        text: 'Loop the **Drop**. Mute and unmute the Pad (**M**) to hear it dip on every kick and swell back between them.',
        why: 'Training your ear to hear the pump on single parts is how you learn to set it by feel instead of by numbers.',
        check: (F) => heard(F, first(F, 'drop')) },
    ],
  },
  // -------------------------------------------------------------------------------------------
  {
    id: 'mix', n: 11, title: 'Mixing', stage: 'Mix and master', minutes: 10, song: 'any',
    summary: 'Balance the track like a pro: kick first, low end mono and dry, sends for depth, levels by ear, small master EQ.',
    recap: ['Kick is the reference', 'Low end mono and dry', 'Sends for depth, levels by "do I miss it?"'],
    steps: [
      { id: 'kick', title: 'Start with the kick', tab: 'mix', target: [{ strip: 'drums', slider: 'Volume' }, { card: 'Tracks' }],
        text: 'Mix from the bottom up. Set **Drums** to **80–90%** first and leave it there; every other level is set against the kick.',
        why: 'The kick is the reference point of a dance mix. If it is not the strongest thing in the drop, the track will not hit on a club system.',
        check: (F) => !!F.track('drums') && mix(F, 'drums').vol >= 0.7 },
      { id: 'mono', title: 'Keep the low end mono', tab: 'mix', target: [{ strip: 'sub', slider: 'Pan' }, { card: 'Tracks' }],
        doIt: { label: 'Centre it for me', run: (app, F) => { for (const t of [...F.tracks('sub'), ...F.tracks('bass')]) { t.mix.pan = 0; if (t.role === 'sub' && t.synth) { t.synth.width = 0; app.soundChanged(t); } } app.mixChanged(); app.render(); return 'Sub and bass centred, sub width mono'; } },
        text: '**Sub** and **Bass** stay panned to the centre (**Pan: C**), and the Sub\'s **Width** in Sound stays at **Mono**.',
        why: 'Club systems often sum the bass to mono, and stereo low end can cancel itself out there. A centred, mono low end is also tighter and hits harder.',
        check: (F) => !!(F.track('sub') || F.track('bass')) && (!F.track('sub') || (Math.abs(mix(F, 'sub').pan) < 0.05 && syn(F, 'sub').width < 0.05)) && (!F.track('bass') || Math.abs(mix(F, 'bass').pan) < 0.1) },
      { id: 'dry', title: 'Keep the low end dry', tab: 'mix', target: [{ strip: 'bass', slider: 'Reverb' }, { card: 'Tracks' }],
        doIt: { label: 'Dry them for me', run: (app, F) => { setMix(app, F, { sub: { rev: 0 }, bass: { rev: 0 } }); return 'No reverb on the sub and bass'; } },
        text: 'Set the **Reverb** send on **Sub** and **Bass** to 0 (tap **Pan, sends…** under the track).',
        why: 'Reverb on low notes turns into a booming wash that eats headroom. Pros keep the low end dry and let the highs carry the space.',
        check: (F) => { const low = [...F.tracks('sub'), ...F.tracks('bass')]; return low.length > 0 && low.every((t) => t.mix.rev <= 0.05 && !F.p.automation.some((l) => l.target === t.id && l.param === 'rev')); } },
      { id: 'sends', title: 'Sends for depth', tab: 'mix', target: { card: 'Tracks' },
        doIt: { label: 'Set them for me', run: (app, F) => { setMix(app, F, { lead: { rev: 0.25, dly: 0.18 }, pad: { rev: 0.4 }, pluck: { rev: 0.3, dly: 0.3 } }); return 'Lead 25/18%, Pad 40%, Pluck 30/30%'; } },
        text: 'Give the **Lead** about **20–30%** reverb and **15–25%** delay, the **Pad** **30–50%** reverb, and the **Pluck** some delay for a ping-pong bounce.',
        why: 'One shared reverb and delay put everything in the same space. The send sets how far back each sound sits: dry is close, wet is far away.',
        check: (F) => !!(F.track('lead') || F.track('pad')) && (!F.track('lead') || (between(mix(F, 'lead').rev, 0.12, 0.45) && mix(F, 'lead').dly >= 0.08)) && (!F.track('pad') || mix(F, 'pad').rev >= 0.25) },
      { id: 'balance', title: 'Balance by ear', tab: 'mix', target: { card: 'Tracks' },
        listen: { sec: (F) => first(F, 'drop'), loop: true },
        text: 'Loop the **Drop**. Pull each track\'s **Volume** down until you miss it, then nudge it back up. Set the arrow step to **1** for fine moves.',
        why: 'Levels are most of a mix. Judging each part by "do I miss it?" stops you making everything loud and keeps the important parts on top.',
        ears: 'Check at low volume too: if the kick and the hook still come through quietly, the balance is right.',
        check: (F) => !F.p.tracks.some((t) => t.mix.solo) && heard(F, first(F, 'drop'), 8) },
      { id: 'eq', title: 'Small master EQ moves', tab: 'mix', target: { card: 'Master' },
        text: 'On the **Master**, keep EQ moves small: around **+1 dB Low** and **+1–2 dB High** for air. Needing more than ±3 dB usually means a single track needs fixing instead.',
        why: 'Master EQ changes everything at once. Big boosts on the master hide problems in single tracks and make the whole mix harsh or boomy.',
        check: (F) => ['low', 'mid', 'high'].every((k) => Math.abs(F.p.master[k]) <= 3) },
    ],
  },
  // -------------------------------------------------------------------------------------------
  {
    id: 'master', n: 12, title: 'Mastering and export', stage: 'Mix and master', minutes: 8, song: 'any',
    summary: 'Glue, drive to −9 LUFS for clubs, a −1 dBFS ceiling, pick the export target, render it and read the numbers.',
    recap: ['−9 to −7 LUFS for clubs, −14 for streaming', 'Ceiling −1 dBFS', 'Check loudness, peak and limiting after export'],
    steps: [
      { id: 'glue', title: 'Glue the mix', tab: 'mix', target: [{ card: 'Master', slider: 'Glue comp' }, { card: 'Master' }],
        doIt: { label: 'Set 40%', run: (app) => { app.project.master.glue = 0.4; app.mixChanged(); app.render(); return 'Glue comp 40%'; } },
        text: 'Set **Glue comp** to **30–50%**: gentle compression on the whole mix.',
        why: 'A little bus compression makes separate tracks feel like one record. Too much flattens the punch of the kick.',
        check: (F) => between(F.p.master.glue, 0.25, 0.6) },
      { id: 'loud', title: 'Drive to club loudness', tab: 'mix', target: [{ card: 'Loudness' }, { card: 'Master', slider: 'Drive' }],
        listen: { sec: (F) => first(F, 'drop'), loop: true },
        text: 'Loop the **Drop** and raise **Drive** until **Short-term** sits around **−9 to −7 LUFS**.',
        why: 'Club and festival masters are loud and dense. The limiter after Drive keeps peaks under the ceiling, so more drive means louder, until it starts to crush the kick.',
        ears: 'If the kick goes flat or the pump turns jerky, back the drive off by 1 dB.',
        check: (F) => !!F.ear && F.ear.dropLufs != null && between(F.ear.dropLufs, -10.5, -6.5) },
      { id: 'ceiling', title: 'Ceiling at −1 dBFS', tab: 'mix', target: [{ card: 'Master', slider: 'Ceiling' }, { card: 'Master' }],
        doIt: { label: 'Set −1.0 dB', run: (app) => { app.project.master.ceiling = -1; app.mixChanged(); app.render(); return 'Ceiling −1.0 dBFS'; } },
        text: 'Set **Ceiling** to **−1.0 dB**.',
        why: 'MP3 and AAC encoding can push peaks a little higher than the original. A −1 dB ceiling leaves room, so streaming versions do not distort.',
        check: (F) => between(F.p.master.ceiling, -1.5, -0.9) },
      { id: 'target', title: 'Choose the export loudness', tab: 'song', target: [{ sheet: 'Loudness' }, '#menuBtn'],
        doIt: { label: 'Open Export', run: (app) => { app.exportSheet(); return null; } },
        text: 'In **Menu → Export song as WAV**, pick **Club loud −9** for DJs or **Streaming −14** for streaming platforms.',
        why: 'Streaming services turn loud tracks down to about −14 LUFS anyway, so a −14 master keeps more punch there. DJs want the loud version so it sits with other club records.',
        check: (F) => F.p.master.exportTarget !== 'mix' },
      { id: 'export', title: 'Export your track', tab: 'song', target: [{ btn: 'Render the song' }, '#menuBtn'],
        doIt: { label: 'Open Export', run: (app) => { app.exportSheet(); return null; } },
        text: 'Tap **Render the song**, then **Share or Save to Files** (or **Download** on a computer).',
        why: 'Finishing is a skill. Exporting, listening on other speakers and coming back with fresh ears is how tracks go from good to great.',
        check: (F) => !!F.exp },
      { id: 'numbers', title: 'Read the numbers', tab: 'song', target: '#menuBtn',
        text: 'After the export, check **Loudness** (near your target), **Peak** (at or under the ceiling) and **Limited** (under about 30% of the time).',
        why: 'Numbers do not replace your ears, but they catch problems your ears get used to. A limiter working all the time means the mix is pushed too hard before mastering.',
        check: (F) => {
          const e = F.exp;
          if (!e) return false;
          const tgt = { loud: -9, stream: -14 }[F.p.master.exportTarget];
          return (tgt == null || Math.abs(e.lufs - tgt) <= 1.5) && e.peakDb <= -0.8 && (e.limitedPct == null || e.limitedPct <= 30);
        } },
      { id: 'check', title: 'Run the Song check', gotIt: false, target: '.co-tab[data-view="check"]',
        doIt: { label: 'Open Song check', run: (app, F, coach) => { coach.setView('check'); return null; } },
        text: 'Open **Song check**. It scores composition, sound, arrangement and mix, and fixes most problems with one tap. Aim for **80** or more.',
        why: 'Pros use reference checklists before they call a track finished. The song check is yours: it catches what tired ears miss.',
        check: (F) => !!F.doctor && F.doctor.overall >= 80 },
    ],
  },
];

export const lessonById = (id) => LESSONS.find((l) => l.id === id) || null;
export const stepKey = (l, s) => `${l.id}.${s.id}`;

// Run a step's check safely: missing tracks or sections never throw, they just fail.
export function runCheck(step, F, base) {
  if (!step.check) return false;
  try { return !!step.check(F, base); } catch { return false; }
}

// "Do it for me" from anywhere: facts are re-read after each edit.
export function runDoIt(step, app, coach) {
  return step.doIt.run(app, facts(app), coach);
}
