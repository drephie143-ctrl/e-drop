// Explain: what every control does and the sweet spot for big room, progressive house and
// trance, plus the producer's vocabulary. Entries are found by slider label (optionally
// "Card title/Label" when a label means different things in different cards), by card title
// ("card:Title"), or by search.
//
// entry = { term, cat, keys: [...], text, sweet? }

export const CATS = ['Synth', 'Drums', 'Mix', 'Master', 'Song', 'Theory'];

export const GLOSSARY = [
  // ---------------------------------------------------------------- synth: cards and controls
  { term: 'Presets', cat: 'Synth', keys: ['card:presets'], text: 'Ready-made starting sounds for this track\'s role, named for what they sound like. Pick one, then shape it with the cards below.', sweet: 'Start from the closest preset, change two or three things, and it is yours.' },
  { term: 'Oscillator 1 and unison', cat: 'Synth', keys: ['card:Oscillator 1 · unison'], text: 'The main sound source. Unison plays several copies of the wave at once, each slightly detuned and placed across the stereo field. With saw waves, that is the supersaw.', sweet: 'Leads 7–9 voices · pads 5–7 · plucks 3–5 · sub 1.' },
  { term: 'Voices (unison)', cat: 'Synth', keys: ['Oscillator 1 · unison/Voices', 'Voices'], text: 'How many detuned copies of the oscillator play each note. More voices sound thicker and wider; one voice is a plain, focused tone.', sweet: 'Supersaw lead 7–9 · pad 5–7 · pluck 3–5 · bass 1–5 · sub 1.' },
  { term: 'Detune', cat: 'Synth', keys: ['Detune'], text: 'How far apart the unison voices are tuned, in cents (100 cents is a semitone). The voices drift against each other, which creates the shimmering, chorused width.', sweet: '±20–30 ct for leads · ±10–20 ct for plucks · 0 for a sub.' },
  { term: 'Stereo (spread)', cat: 'Synth', keys: ['Oscillator 1 · unison/Stereo', 'Stereo'], text: 'How far the unison voices are spread between left and right.', sweet: 'Leads and pads 80–100% · bass 30–50% · sub 0%.' },
  { term: 'Octave', cat: 'Synth', keys: ['Oscillator 1 · unison/Octave', 'Octave'], text: 'Moves the oscillator up or down in whole octaves without changing the notes you wrote.', sweet: '0 for most sounds; −1 for a bass written high; +1 for a bright layer.' },
  { term: 'Level (oscillator 1)', cat: 'Synth', keys: ['Oscillator 1 · unison/Level'], text: 'Volume of oscillator 1 inside the synth, before the filter. Balance oscillator 2, sub and noise against it.', sweet: '100%.' },
  { term: 'Oscillator 2, sub and noise', cat: 'Synth', keys: ['card:Oscillator 2, sub and noise'], text: 'Extra layers under the main oscillator: a second oscillator with its own wave, octave and detune, a sine one octave below the note (sub), and white noise.', sweet: 'A square one octave down at 30–45% adds body to leads and stabs.' },
  { term: 'Level (oscillator 2)', cat: 'Synth', keys: ['Oscillator 2, sub and noise/Level'], text: 'How loud oscillator 2 is under oscillator 1.', sweet: '20–45% as a supporting layer.' },
  { term: 'Octave (oscillator 2)', cat: 'Synth', keys: ['Oscillator 2, sub and noise/Octave'], text: 'Octave of oscillator 2 against oscillator 1. +1 adds brightness, −1 adds weight.', sweet: '−1 for body, +1 for sparkle.' },
  { term: 'Semitone', cat: 'Synth', keys: ['Semitone'], text: 'Moves oscillator 2 by semitones. A fifth (+7) or an octave (+12) layers cleanly; other intervals turn every note into a chord.', sweet: '0, +7 or +12.' },
  { term: 'Voices (oscillator 2)', cat: 'Synth', keys: ['Oscillator 2, sub and noise/Voices'], text: 'Unison voices on oscillator 2. A couple of voices thicken a layer without clouding the main supersaw.', sweet: '1–3.' },
  { term: 'Detune (oscillator 2)', cat: 'Synth', keys: ['Oscillator 2, sub and noise/Detune'], text: 'Spread of oscillator 2\'s unison voices, in cents.', sweet: '±10–25 ct.' },
  { term: 'Sub oscillator', cat: 'Synth', keys: ['Sub'], text: 'A sine one octave below the note, mixed in under the oscillators. Adds weight without a separate track.', sweet: 'Bass 40–60% · leads 0–15% (the Sub track carries the low end).' },
  { term: 'Noise', cat: 'Synth', keys: ['Noise'], text: 'White noise mixed in before the filter. Adds air, breath and grit; risers are mostly filtered noise.', sweet: 'Pads 5–10% · leads 0–5%.' },
  { term: 'Filter', cat: 'Synth', keys: ['card:Filter'], text: 'Removes part of the frequency range. A low-pass keeps the lows and cuts the highs, so it makes a sound darker or brighter. Band-pass keeps a middle band; high-pass cuts the lows. 24 dB cuts more steeply than 12 dB.', sweet: 'Low-pass, 24 dB for leads and plucks; 12 dB for softer pads.' },
  { term: 'Cutoff', cat: 'Synth', keys: ['Cutoff'], text: 'The frequency where the filter starts cutting. Lower is darker and softer, higher is brighter and more aggressive.', sweet: 'Leads 2.5–4.5 kHz · plucks 400–800 Hz with a big env amount · pads 1–2 kHz.' },
  { term: 'Resonance', cat: 'Synth', keys: ['Resonance'], text: 'Boosts the frequencies right at the cutoff, giving the filter a vocal, whistling edge. High values ring like a bell.', sweet: 'Leads 1–2 · plucks 3–4 · pads under 1.' },
  { term: 'Env amount', cat: 'Synth', keys: ['Env amount'], text: 'How far the filter envelope opens the cutoff on each note, in octaves. This is what makes a pluck "pluck" and a lead "bite".', sweet: 'Leads 1–2 oct · plucks 3–5 oct · pads 0.5–1 oct.' },
  { term: 'Filter attack', cat: 'Synth', keys: ['Filter/Attack'], text: 'How long the filter takes to open after a note starts.', sweet: 'Under 5 ms for leads and plucks · 0.5–1.5 s for swelling pads.' },
  { term: 'Filter decay', cat: 'Synth', keys: ['Filter/Decay'], text: 'How fast the filter closes from fully open down to its sustain level.', sweet: 'Plucks 0.1–0.3 s · leads 0.2–0.5 s.' },
  { term: 'Filter sustain', cat: 'Synth', keys: ['Filter/Sustain'], text: 'How open the filter stays while a note is held, as a share of the env amount.', sweet: 'Plucks 0% · leads 40–60% · pads about 60%.' },
  { term: 'Amp envelope (ADSR)', cat: 'Synth', keys: ['card:Amp envelope', 'ADSR'], text: 'Shapes every note\'s volume over time: Attack (fade in), Decay (fall to the sustain level), Sustain (level while held) and Release (fade after the note ends).', sweet: 'Lead: fast attack, high sustain, short release. Pluck: no sustain. Pad: slow attack, long release.' },
  { term: 'Attack', cat: 'Synth', keys: ['Amp envelope/Attack', 'Attack'], text: 'Time from silence to full volume at the start of a note.', sweet: 'Leads and plucks 1–6 ms · pads 0.3–1.5 s.' },
  { term: 'Decay', cat: 'Synth', keys: ['Amp envelope/Decay', 'Decay'], text: 'Time to fall from the peak to the sustain level.', sweet: 'Plucks 0.2–0.5 s · stabs 0.2–0.3 s · leads 0.3 s.' },
  { term: 'Sustain', cat: 'Synth', keys: ['Amp envelope/Sustain', 'Sustain'], text: 'The level a held note stays at after the decay.', sweet: 'Leads 70–90% · plucks 0% · pads about 90%.' },
  { term: 'Release', cat: 'Synth', keys: ['Release'], text: 'How long a note takes to fade out after it ends.', sweet: 'Leads 0.15–0.4 s · bass under 0.1 s · pads 1.5–2 s.' },
  { term: 'Synth volume', cat: 'Synth', keys: ['Amp envelope/Volume'], text: 'The synth\'s own output level, before the mixer fader. Leave headroom here and balance in Mix.', sweet: '40–70%.' },
  { term: 'Pitch, glide and character', cat: 'Synth', keys: ['card:Pitch, glide and character'], text: 'Movement and colour: a pitch drop at the start of each note, mono glide between notes, distortion and stereo width.' },
  { term: 'Pitch envelope', cat: 'Synth', keys: ['Pitch env'], text: 'Starts every note a few semitones away and bends it to the right pitch. Short and small, it sounds like extra punch; longer, it becomes an audible swoop.', sweet: '+2 to +4 st for big room leads and stabs.' },
  { term: 'Pitch decay', cat: 'Synth', keys: ['Pitch decay'], text: 'How long the pitch bend takes to settle.', sweet: '10–40 ms for punch · 80 ms or more for a swoop.' },
  { term: 'Mono and glide', cat: 'Synth', keys: ['Glide', 'Mono'], text: 'Mono plays one note at a time; with Glide, overlapping notes slide into each other (portamento).', sweet: 'Glide 50–120 ms on trance and hoover leads; 20 ms on a sub.' },
  { term: 'Distortion', cat: 'Synth', keys: ['Distortion'], text: 'Soft clipping that adds harmonics and grit, so a sound cuts through on small speakers.', sweet: 'Bass 25–45% · big room leads 20–35% · pads 0%.' },
  { term: 'Width', cat: 'Synth', keys: ['Width'], text: 'Stereo width of the whole synth. 0 is mono, 100% is as recorded, above 100% exaggerates the sides.', sweet: 'Sub mono · bass 40–60% · leads 100% · pads 120–140%.' },
  { term: 'Arpeggiator', cat: 'Synth', keys: ['card:Arpeggiator', 'Arp'], text: 'Turns held chords into a repeating run of single notes at the chosen rate, mode and octave range.', sweet: '1/16, up or up-down, 1–2 octaves for trance plucks.' },
  { term: 'Arp gate', cat: 'Synth', keys: ['Arpeggiator/Gate', 'Gate'], text: 'How long each arp note lasts, as a share of its step. Short is staccato, long is legato.', sweet: '50–70% for a plucky arp.' },
  { term: 'Trance gate', cat: 'Synth', keys: ['card:Trance gate'], text: 'Chops the sound on and off with a 16-step pattern: the stuttering gated pad of classic trance. Hard is a clean chop, Pluck gives each step a little decay.', sweet: '1/16 rate on held pads and chords.' },
  { term: 'Gate depth', cat: 'Synth', keys: ['Trance gate/Depth', 'Depth'], text: 'How far the gate turns the sound down on its off steps.', sweet: '100% for a hard chop · 50–70% for a softer pulse.' },
  { term: 'Supersaw', cat: 'Synth', keys: ['supersaw'], text: 'A stack of detuned saw waves spread in stereo: the defining lead and pad sound of trance and big room.', sweet: '7–9 voices, ±20–30 ct, stereo 80–100%.' },
  { term: 'Saw, square, triangle, sine', cat: 'Synth', keys: ['waveform', 'Saw', 'Square', 'Tri', 'Sine'], text: 'Saw is bright and buzzy (every harmonic); square is hollow (odd harmonics); triangle is soft; sine is pure, with no harmonics at all.', sweet: 'Saw for leads and pads · square for body layers · sine for the sub.' },
  { term: 'Pluck', cat: 'Synth', keys: ['pluck'], text: 'A short sound with a sharp attack and no sustain, shaped mostly by a fast filter envelope. Plucks play arps and riffs in progressive and trance.' },
  { term: 'Stab', cat: 'Synth', keys: ['stab'], text: 'A short, punchy chord hit. Big room stabs play a bouncy rhythm in the drop; off-beat stabs give a house bounce.' },
  { term: 'Pad', cat: 'Synth', keys: ['pad'], text: 'A long, soft, wide chord sound with a slow attack. It carries the harmony in breakdowns.' },
  { term: 'Reese bass', cat: 'Synth', keys: ['reese'], text: 'Two or more detuned saws in mono, gently low-passed, so the bass slowly phases and growls.' },
  { term: 'Hoover', cat: 'Synth', keys: ['hoover'], text: 'A detuned, gliding lead with a pitch dip at the start of each note: an old-school rave sound that big room keeps reviving.' },
  { term: 'Sub bass', cat: 'Synth', keys: ['sub bass', 'subbass'], text: 'The lowest part of the track, usually a pure sine playing the chord roots between about 40 and 80 Hz. Felt as much as heard.', sweet: 'Sine, mono, dry, below C3, pump 90–100%.' },

  // ---------------------------------------------------------------- drums
  { term: 'Kit', cat: 'Drums', keys: ['card:Kit'], text: 'The drum kit: which kick, its tuning, and the level of each drum voice. Every drum is synthesized and the kick follows the song\'s key.' },
  { term: 'Kick', cat: 'Drums', keys: ['Kit/Kick', 'Kick', 'kick drum'], text: 'The heartbeat of the track. Big Room has a long tail, Tight House is short, Punchy Trance is tight with a strong click, Deep Progressive is round and soft.', sweet: 'Level 100%: the kick is the reference for the whole mix.' },
  { term: 'Kick tune', cat: 'Drums', keys: ['Kick tune'], text: 'Moves the kick\'s pitch in semitones from the key root. The kick\'s tail is a note, so it should agree with the sub.', sweet: '0 (root), or +7 (fifth) when that stays above about 40 Hz.' },
  { term: 'Clap', cat: 'Drums', keys: ['Kit/Clap', 'Clap'], text: 'The backbeat on beats 2 and 4.', sweet: '80–100%.' },
  { term: 'Snare', cat: 'Drums', keys: ['Kit/Snare', 'Snare'], text: 'Layered quietly under the clap for crack, and the voice of build-up snare rolls.', sweet: '60–80% under the clap.' },
  { term: 'Closed hat', cat: 'Drums', keys: ['Kit/Hat', 'Hat'], text: 'Short ticks in 8ths or 16ths that add speed and drive.', sweet: '40–55%; 16ths at low velocity.' },
  { term: 'Open hat', cat: 'Drums', keys: ['Kit/Open hat', 'Open hat'], text: 'The off-beat "tss" between the kicks.', sweet: '50–70%, on every "and".' },
  { term: 'Ride', cat: 'Drums', keys: ['Kit/Ride', 'Ride'], text: 'A washy, pinging cymbal for drive in trance and progressive grooves.', sweet: '30–45%.' },
  { term: 'Crash', cat: 'Drums', keys: ['Kit/Crash', 'Crash'], text: 'Marks the downbeat of drops and the start of new phrases.', sweet: '50–70%, on bar 1 of the drop.' },
  { term: 'Perc', cat: 'Drums', keys: ['Kit/Perc', 'Perc'], text: 'A tuned wood-like hit, a fifth above the kick, for extra groove on the off-16ths.', sweet: '40–55%.' },
  { term: 'Hat decay', cat: 'Drums', keys: ['Hat decay'], text: 'How long the closed hat rings.', sweet: '40–60 ms tight · 100 ms or more loose.' },
  { term: 'Four on the floor', cat: 'Drums', keys: ['four on the floor'], text: 'A kick on every beat of the bar. The foundation of house, big room and trance.' },
  { term: 'Backbeat', cat: 'Drums', keys: ['backbeat'], text: 'The clap or snare on beats 2 and 4, which gives a beat its forward lean.' },
  { term: 'Snare roll', cat: 'Drums', keys: ['snare roll', 'roll'], text: 'A build-up where the snare plays faster and louder (quarters, 8ths, 16ths, 32nds) and stops just before the drop.' },
  { term: 'Fill', cat: 'Drums', keys: ['fill'], text: 'A short drum variation at the end of a phrase that tells the listener something is about to change.' },
  { term: 'Velocity', cat: 'Drums', keys: ['velocity'], text: 'How hard a note or hit is played. Lower velocity is quieter and often softer in tone; it is how hats are kept in the background.' },

  // ---------------------------------------------------------------- mix
  { term: 'Mix stage', cat: 'Mix', keys: ['card:Mix stage', 'stage'], text: 'Every track as a dot: left to right is its pan, up and down its volume. Drag a dot to move both at once; muted and unsoloed tracks are dimmed. A quick picture of the balance and the stereo spread.', sweet: 'Kick, bass, sub and lead in the centre and near the top; plucks, arps and percussion a little to the sides.' },
  { term: 'Tracks (mixer)', cat: 'Mix', keys: ['card:Tracks'], text: 'One channel per track: volume, pump (sidechain), mute (M), solo (S), and under "Pan, sends…" the pan and the reverb and delay sends.' },
  { term: 'Volume (fader)', cat: 'Mix', keys: ['Tracks/Volume', 'Volume'], text: 'The track\'s level in the mix.', sweet: 'Drums 80–90% first, then balance everything else against the kick.' },
  { term: 'Pump (sidechain)', cat: 'Mix', keys: ['Pump', 'sidechain'], text: 'How much the track ducks under each kick: gain = 1 − pump × envelope. It clears room for the kick and makes the mix breathe in time.', sweet: 'Sub 90–100 · bass 80–90 · pad 70–90 · stab 60–80 · lead 40–60 · drums 0.' },
  { term: 'Pan', cat: 'Mix', keys: ['Pan'], text: 'Places the track between left and right.', sweet: 'Kick, bass, sub and lead in the centre; small moves (L15–R25) for percussion and plucks.' },
  { term: 'Reverb send', cat: 'Mix', keys: ['Tracks/Reverb', 'Reverb'], text: 'How much of the track goes to the shared reverb. More send pushes a sound further back in the space.', sweet: 'Lead 20–30% · pad 30–50% · pluck 25–35% · bass and sub 0.' },
  { term: 'Delay send', cat: 'Mix', keys: ['Tracks/Delay', 'Delay'], text: 'How much of the track goes to the shared tempo-synced ping-pong delay.', sweet: 'Lead 15–25% · pluck 25–35%.' },
  { term: 'Mute and solo', cat: 'Mix', keys: ['M', 'S', 'mute', 'solo'], text: 'M silences a track; S plays only the soloed tracks. Both affect the export, so clear them before you render.' },
  { term: 'Reverb, delay and sidechain', cat: 'Mix', keys: ['card:Reverb, delay and sidechain'], text: 'The shared effects every track can send to: one big reverb, one tempo-synced ping-pong delay, and the settings of the sidechain pump.' },
  { term: 'Reverb size', cat: 'Mix', keys: ['Reverb size'], text: 'The reverb\'s decay time: how long the space rings after a sound.', sweet: '2.5–4 s for festival space; shorter keeps a busy mix clear.' },
  { term: 'Damping', cat: 'Mix', keys: ['Damping'], text: 'How quickly the reverb\'s highs die away. More damping sounds darker and smoother.', sweet: '40–60%.' },
  { term: 'Reverb level', cat: 'Mix', keys: ['Reverb level'], text: 'Volume of the reverb return for the whole mix.', sweet: '70–100%; set the per-track amounts with the sends.' },
  { term: 'Delay time', cat: 'Mix', keys: ['Delay time (synced)', 'delay time'], text: 'The delay\'s repeat time in note values at the song tempo. 3/16 (a dotted 8th) is the classic bouncing delay.', sweet: '3/16 for leads and plucks.' },
  { term: 'Feedback', cat: 'Mix', keys: ['Feedback'], text: 'How much of each repeat feeds back into the delay, so how many repeats you hear.', sweet: '30–45%.' },
  { term: 'Delay level', cat: 'Mix', keys: ['Delay level'], text: 'Volume of the delay return for the whole mix.', sweet: '60–90%.' },
  { term: 'Pump release', cat: 'Mix', keys: ['Pump release'], text: 'How long the duck takes to recover after each kick, in beats.', sweet: '0.4–0.6 beat: back up just before the next kick.' },
  { term: 'Pump curve', cat: 'Mix', keys: ['Pump curve'], text: 'The shape of the swell back after each kick. Low values (Smooth) hold the duck for most of the release and come back late; Classic is the familiar pump; high values (Hard) cut a short, sharp dip on the kick and recover fast.', sweet: 'Classic (about 2) for big room and trance; Smooth for a slow, deep breath in progressive.' },
  { term: 'Pump on FX', cat: 'Mix', keys: ['Pump on FX'], text: 'How much the reverb and delay returns duck with the kick.', sweet: '40–60%.' },
  { term: 'Sends and returns', cat: 'Mix', keys: ['send', 'return'], text: 'Instead of a reverb on every track, each track sends some signal to one shared reverb and delay. It puts the whole mix in one space and saves processing.' },
  { term: 'Mono compatibility', cat: 'Mix', keys: ['mono'], text: 'How the mix holds up when left and right are added together, as many club systems do with the bass. Stereo low end can cancel itself out.', sweet: 'Keep everything below about 150 Hz in mono.' },
  { term: 'Headroom', cat: 'Mix', keys: ['headroom'], text: 'The space between your loudest peaks and 0 dBFS. Mixing with headroom leaves room for the master chain to work cleanly.' },
  { term: 'Low end', cat: 'Mix', keys: ['low end'], text: 'Kick, sub and bass: everything below about 150 Hz. It carries the energy on a club system and is the hardest part to get right.' },
  { term: 'Mud', cat: 'Mix', keys: ['mud'], text: 'A thick, unclear sound from too many parts in the low mids (about 200–500 Hz): pads, bass harmonics and reverb tails piling up.' },

  // ---------------------------------------------------------------- master
  { term: 'Master', cat: 'Master', keys: ['card:Master'], text: 'The chain the whole mix goes through: a 3-band EQ, a glue compressor, Drive into a brickwall limiter, and the output level.' },
  { term: 'Low (shelf)', cat: 'Master', keys: ['Master/Low', 'Low'], text: 'A low shelf at 90 Hz: lifts or trims everything below it.', sweet: '+0.5 to +1.5 dB.' },
  { term: 'Mid (bell)', cat: 'Master', keys: ['Master/Mid', 'Mid'], text: 'A wide bell at 1.5 kHz: the body and presence of leads and claps.', sweet: '−1 to +1 dB.' },
  { term: 'High (shelf)', cat: 'Master', keys: ['Master/High', 'High'], text: 'A high shelf at 9 kHz: the "air" and sparkle.', sweet: '+1 to +2 dB.' },
  { term: 'Glue compression', cat: 'Master', keys: ['Glue comp'], text: 'Gentle compression on the whole mix, so separate parts feel like one record.', sweet: '30–50%.' },
  { term: 'Drive', cat: 'Master', keys: ['Drive'], text: 'Gain into the limiter. More drive makes the master louder and denser; too much flattens the kick.', sweet: 'Raise until the drop reads −9 to −7 LUFS short-term.' },
  { term: 'Ceiling', cat: 'Master', keys: ['Ceiling'], text: 'The highest level the limiter lets through, in dBFS.', sweet: '−1.0 dBFS, so MP3 and AAC copies do not clip.' },
  { term: 'Output', cat: 'Master', keys: ['Output'], text: 'Final volume after the limiter.', sweet: '100%; turn your speakers down instead.' },
  { term: 'Loudness meter', cat: 'Master', keys: ['card:Loudness'], text: 'Live loudness of the master. Momentary is the last 0.4 s, Short-term the last 3 s, Peak the highest sample, Limiter how many dB the limiter is taking off.', sweet: 'Drop: −9 to −7 LUFS short-term for club masters.' },
  { term: 'LUFS', cat: 'Master', keys: ['LUFS', 'loudness'], text: 'Loudness Units relative to Full Scale: loudness as the ear hears it, not just the peak level. Streaming services and broadcasters measure in LUFS.', sweet: 'Club masters −9 to −6 · streaming −14.' },
  { term: 'dBFS and true peak', cat: 'Master', keys: ['dBFS', 'peak', 'true peak'], text: '0 dBFS is the loudest a digital file can go. Encoders can create peaks between samples that go higher than the file\'s own peaks, which is why masters stop at about −1 dBFS.' },
  { term: 'Limiter', cat: 'Master', keys: ['limiter', 'Limiter'], text: 'A very fast compressor that stops the signal going over the ceiling. Pushing into it is how masters get loud.' },
  { term: 'Compression', cat: 'Master', keys: ['compression', 'compressor'], text: 'Turns the loud moments down so the overall level can come up. On the master it glues; on single sounds it controls punch.' },
  { term: 'EQ', cat: 'Master', keys: ['EQ', 'equalizer'], text: 'Equalization: turning frequency ranges up or down. Cut to fix, boost gently to flatter.' },
  { term: 'Export targets', cat: 'Master', keys: ['export', 'Loudness'], text: 'As mixed keeps the level you set; Streaming −14 matches what streaming services play back at; Club loud −9 is for DJs and clubs.', sweet: 'Make a −9 club master and a −14 streaming master.' },

  // ---------------------------------------------------------------- song and arrangement
  { term: 'Section', cat: 'Song', keys: ['section'], text: 'A block of the song (intro, build, drop, breakdown, break, outro) that says which pattern each track plays for that many bars.' },
  { term: 'Intro', cat: 'Song', keys: ['intro'], text: 'The opening: mostly drums and a little melody, so DJs can mix the track in.', sweet: '16–32 bars for club play.' },
  { term: 'Build', cat: 'Song', keys: ['build', 'build-up'], text: 'The tension section before a drop: snare roll, riser, high-pass sweep and an empty last beat.', sweet: '8 bars (4 for a short one, 16 for an epic one).' },
  { term: 'Drop', cat: 'Song', keys: ['drop'], text: 'The release: full drums, bass, sub, stabs and the lead hook, as loud and wide as the track gets.', sweet: '16 bars.' },
  { term: 'Breakdown', cat: 'Song', keys: ['breakdown'], text: 'The emotional middle: no kick, pads and melody, space to breathe before the second build.', sweet: '8–16 bars, four or five elements.' },
  { term: 'Break', cat: 'Song', keys: ['break'], text: 'A short pause in the energy, often drums with a filtered loop, used to move between sections.' },
  { term: 'Outro', cat: 'Song', keys: ['outro'], text: 'The ending, mirroring the intro: a clean beat the next DJ track can be mixed over.', sweet: '16–32 bars for club play.' },
  { term: 'Phrase', cat: 'Song', keys: ['phrase', 'phrasing'], text: 'A group of bars that feels like one musical sentence. Dance music moves in 8-bar phrases, so changes land on bars 9, 17, 25 and 33.', sweet: 'Every section a multiple of 8 (or at least 4).' },
  { term: 'Energy map', cat: 'Song', keys: ['energy'], text: 'How busy and loud each section is, over the whole song. Pros sketch it first: drops at the top, breakdowns in the valleys.' },
  { term: 'Add an effect', cat: 'Song', keys: ['card:Add an effect'], text: 'Puts a riser, noise sweep, downlifter, impact, sub drop or reverse cymbal into the FX track\'s pattern. Risers and sweeps fill the pattern and peak at its end; impacts hit on bar 1.', sweet: 'Riser and noise sweep in the build\'s pattern; impact and sub drop at the start of the drop.' },
  { term: 'FX timeline', cat: 'Song', keys: ['card:FX timeline'], text: 'The effects in this pattern laid out over its bars: the curve is how loud each one gets, the dashed line its filter or pitch sweep. Drag an effect\'s body to move it or its edges to stretch it; tap to hear it.' },
  { term: 'Riser', cat: 'Song', keys: ['riser', '+ Riser'], text: 'A sound that climbs in pitch and brightness and peaks at the drop: a musical arrow pointing at the release.' },
  { term: 'White-noise sweep', cat: 'Song', keys: ['noise sweep', '+ Noise sweep up'], text: 'Filtered noise opening up over the build, adding air and urgency on top of the riser.' },
  { term: 'Downlifter', cat: 'Song', keys: ['downlifter', '+ Downlifter'], text: 'The opposite of a riser: noise and pitch falling away, used at the start of breakdowns.' },
  { term: 'Impact', cat: 'Song', keys: ['impact', '+ Impact'], text: 'A boom and crash on the downbeat of a drop: the full stop after the build.' },
  { term: 'Sub drop', cat: 'Song', keys: ['sub drop', '+ Sub drop'], text: 'A sine diving down in pitch under the first beat of a drop, for extra weight.' },
  { term: 'Reverse cymbal', cat: 'Song', keys: ['reverse cymbal', '+ Reverse cymbal'], text: 'A cymbal played backwards, swelling up into the next bar. Great at the end of a breakdown.' },
  { term: 'Build sweep', cat: 'Song', keys: ['build sweep', 'Add build sweep', 'high-pass sweep'], text: 'Automation over the build: the master high-pass rises (the low end disappears), the lead\'s filter opens and its reverb swells, then everything snaps back on the drop.' },
  { term: 'Automation', cat: 'Song', keys: ['automation', 'lane'], text: 'A setting that changes over time, drawn as a line under the timeline: filter sweeps, send swells, fades.' },
  { term: 'The silent beat', cat: 'Song', keys: ['silent beat', 'silence'], text: 'Leaving the last beat (or half beat) before the drop empty. The tiny gap makes the first kick of the drop hit much harder.' },
  { term: 'Pattern', cat: 'Song', keys: ['pattern'], text: 'A loop of notes, hits or effects for one track. Sections choose which pattern each track plays; a pattern repeats until the section ends.' },
  { term: 'Starts', cat: 'Song', keys: ['Starts'], text: 'Where the effect begins in its pattern, in bars.', sweet: 'Risers at bar 1 of an 8-bar build pattern, so they peak at the drop.' },
  { term: 'Length', cat: 'Song', keys: ['Length'], text: 'How long the effect lasts. Risers and sweeps peak at the end of their length.' },
  { term: 'Level (effect)', cat: 'Song', keys: ['Level'], text: 'How loud this effect or layer is.' },
  { term: 'Tempo (BPM)', cat: 'Song', keys: ['Tempo', 'BPM'], text: 'Beats per minute: how fast the track is.', sweet: 'Progressive 124–126 · big room 126–130 · trance 132–140.' },
  { term: 'DJ-friendly', cat: 'Song', keys: ['dj'], text: 'Built to be mixed: long, sparse intro and outro, 8-bar phrasing, a steady tempo, and no melody in the first and last 16 bars.' },

  // ---------------------------------------------------------------- theory
  { term: 'Key', cat: 'Theory', keys: ['key'], text: 'The home note of the song and the scale its notes come from.', sweet: 'F, F#, G, Ab or A minor put the kick and sub at 43–55 Hz.' },
  { term: 'Scale', cat: 'Theory', keys: ['scale'], text: 'The set of seven notes the song uses. Minor is dramatic; major is bright; harmonic minor has a tense raised 7th; Dorian and Phrygian are darker colours.' },
  { term: 'Relative major and minor', cat: 'Theory', keys: ['relative'], text: 'Every minor key shares its notes with a major key three semitones up (F minor and Ab major). That is why vi – IV – I – V works in a minor song: it is played in the relative major.' },
  { term: 'Chord progression', cat: 'Theory', keys: ['progression', 'Chords & parts'], text: 'The order of chords that loops under the track. Four chords of one bar each is the festival standard.' },
  { term: 'vi – IV – I – V', cat: 'Theory', keys: ['vi-iv-i-v', 'anthem'], text: 'The festival anthem progression. It starts on the minor chord and climbs through the majors, so it sounds sad and hopeful at once. In F minor: Fm – Db – Ab – Eb.' },
  { term: 'Voicing', cat: 'Theory', keys: ['voicing', 'Voicing'], text: 'How the notes of a chord are spread out. Triad: close together. Open: root an octave down and the other notes spread wide. Add 9, 7th, Sus 2 and Sus 4 add colour notes.', sweet: 'Open for pads, triad or power for stabs.' },
  { term: 'Voice leading', cat: 'Theory', keys: ['voice leading'], text: 'Moving each note of a chord to the nearest note of the next chord, so the progression flows instead of jumping.' },
  { term: 'Chord tones', cat: 'Theory', keys: ['chord tone', 'chord tones'], text: 'The notes of the chord playing at that moment. Melodies sound strongest with chord tones on the beats and other notes in between.' },
  { term: 'Call and response', cat: 'Theory', keys: ['call and response', 'question and answer'], text: 'A melody in two halves: a phrase that asks (ends unresolved) and one that answers (ends on the root).' },
  { term: 'Hook', cat: 'Theory', keys: ['hook', 'melody'], text: 'The main melody people remember and sing back. Usually a simple rhythm with one surprising note, repeated with small changes.' },
  { term: 'Off-beat bass', cat: 'Theory', keys: ['off-beat bass', 'offbeat'], text: 'A bass note on every "and" between the kicks. Kick and bass never collide and the see-saw between them drives the groove.' },
  { term: 'Steps and 16ths', cat: 'Theory', keys: ['step', '16th'], text: 'A bar of 4/4 is 16 steps of a 16th note each. Beats fall on steps 1, 5, 9 and 13; the off-beats ("and") on 3, 7, 11 and 15.' },
  { term: 'Ghost notes', cat: 'Theory', keys: ['ghost', 'Ghosts'], text: 'In the piano roll, the faint notes of the other parts in the selected section, so you can write against the chords.' },
  { term: 'Root and fifth', cat: 'Theory', keys: ['root', 'fifth'], text: 'The root is the chord\'s (or key\'s) home note; the fifth is seven semitones above it. Both sound stable against the root.' },
];

const norm = (s) => String(s || '').toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
const INDEX = new Map();
for (const e of GLOSSARY) for (const k of e.keys) { const n = norm(k); if (!INDEX.has(n)) INDEX.set(n, e); }

// A slider label, optionally inside a card with this title.
export function lookup(label, card) {
  const l = norm(label);
  return (card && INDEX.get(norm(`${card}/${label}`))) || INDEX.get(l) || null;
}
export function lookupCard(title) {
  const t = norm(title);
  return INDEX.get('card:' + t) || (t.endsWith(' presets') ? INDEX.get('card:presets') : null) || INDEX.get(t) || null;
}

export function search(q, cat = null) {
  const words = norm(q).split(' ').filter(Boolean);
  return GLOSSARY.filter((e) => (!cat || e.cat === cat) && words.every((w) => norm(`${e.term} ${e.keys.join(' ')} ${e.text} ${e.sweet || ''}`).includes(w)))
    .sort((a, b) => (words.length ? Number(!norm(a.term).includes(words[0])) - Number(!norm(b.term).includes(words[0])) : 0));
}
