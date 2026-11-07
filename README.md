# E-Drop

A festival dance-music studio for iPhone, built as a web app you add to the home screen: big-room,
progressive house and trance, with supersaw leads, big room bass, snare-roll builds and drops. It
runs full screen, works offline, and keeps songs on the phone (IndexedDB). No build step and no
dependencies: plain HTML, CSS and JavaScript modules, and every sound is made with Web Audio.

It opens on a demo song (F minor, 128 BPM, vi–IV–I–V): intro → build → drop → breakdown → build 2 →
drop 2 → outro, about 2:15. Press play.

## The screens

| Tab | What's there |
|---|---|
| **Song** | The arrangement. Sections (intro, breakdown, build, drop, break, outro) across a timeline, a row per track saying which pattern it plays in each section, and automation lanes (filter cutoff, volume, reverb and delay sends per track, master high-pass and low-pass). **Add build sweep** on a section automates the classic build: master high-pass rising, the lead's filter opening and its reverb swelling, all snapping back on the drop. Loop a section while you work on it. |
| **Notes** | Touch piano roll for every synth track. Tap to add, tap a note to delete, drag to move, drag its right end to resize, drag empty space to scroll. Ghost notes show the other parts in the section. **Chords & parts**: pick a progression (vi–IV–I–V, i–VI–III–VII and more) and a voicing, then write chords, off-beat stabs, big room stabs, off-beat or rolling bass, sub roots, a 16th arp or a lead hook, or fill every synth track at once. The FX track shows its risers and impacts here. |
| **Drums** | 16-step grid with kick, clap, snare, closed and open hat, ride, crash and perc. Presets (four on the floor, big room drop, progressive groove, trance drive, breakdown) and a **snare roll** generator for builds (quarters → 8ths → 16ths → 32nds, rising, the last beat left open). The kick is tuned to the song's key. |
| **Sound** | The synth for the selected track, with presets per role: supersaw leads (up to 9 detuned voices with stereo spread), plucks, pads, stabs, big room / reese bass and sub. Two oscillators, sub, noise, filter with its own envelope, amp envelope, pitch envelope, mono glide, distortion, stereo width, arpeggiator and trance gate. |
| **Mix** | Volume, pan, mute, solo, reverb and delay sends, and **Pump** (how much the track ducks under the kick) per track. Master 3-band EQ, glue compressor, drive and limiter, with a loudness meter (momentary and short-term LUFS, peak, limiter reduction). Reverb size and damping, synced ping-pong delay, pump release and curve. |

Menu: export the song as WAV, open or copy songs, start a new song (a festival template with the
sections, drums, risers and build sweep already in; you write the notes), reload the demo.

## Writing a track from scratch

1. Menu → **New song**. It opens on the Notes tab.
2. **Chords & parts** → pick a progression → **Fill every synth track from this**. You now have
   chords on the pad, stabs, bass, sub, an arp and a lead hook.
3. Pick **Lead** and make the hook yours. Try other lead presets in **Sound**.
4. **Drums**: the template has an intro beat, an 8-bar snare roll for the build and a drop beat.
5. **Song**: tap cells to choose what plays where. Select the build, tap **Add build sweep**.
6. **Mix**: balance it. Aim for around −9 LUFS short-term in the drop.
7. Menu → **Export song as WAV** → **Share or Save to Files**.

## How it works

- Every pattern is rendered offline (OfflineAudioContext) into a buffer when it changes
  (`js/audio/render.js`). Playback only plays those buffers through the mixer, so a 9-voice supersaw
  over chords never runs on the live audio thread, which is what makes iPhones crackle. Live sounds
  (tapping keys, drum pads) use a 3-voice version of the same synth.
- Drums are synthesized once per kit setting as one-shots, then placed by the patterns.
- The sidechain is an envelope (1 at each kick, back to 0 over the release) that feeds a gain on every
  track: gain = 1 − pump × envelope. The reverb and delay returns pump too.
- Reverb is a generated impulse response (decaying stereo noise that darkens as it decays).
- Export renders the whole song offline through the same mixer, then a worker
  (`js/dsp/master.js`) measures loudness (ITU-R BS.1770 integrated LUFS), applies the loudness target
  (as mixed, −14 or −9 LUFS), runs a lookahead brickwall limiter that holds peaks under the ceiling,
  and writes a dithered 16-bit WAV.

## Getting it on an iPhone

Any static HTTPS host works (GitHub Pages, Netlify, Cloudflare Pages). Then:

1. Open the URL in Safari on the iPhone.
2. Tap Share, then **Add to Home Screen**.
3. Open E-Drop from the home screen. Sound plays with the silent switch on.

## Running it on this PC

```
python -m http.server 8792 --directory "C:\E-Estimating\e-estimatingllc ai creations\E-Drop"
```

Then open http://localhost:8792. The offline cache (`sw.js`) is off on localhost. Bump `VERSION` in
`sw.js` whenever files change, so installed copies update.

Built for E-Estimating LLC; the app icon and the menu use the official logo
(`brand/e-estimating-logo.svg`). E-Drop is an original tool for this style of music and isn't
affiliated with any artist.
