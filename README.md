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

## Graphs and arrows

Every sound module has a graph you drag, kept in step with its sliders (`js/ui/graphs-sound.js`,
`js/ui/graphs-mix.js`, on `js/ui/graph-base.js`). **Sound**: the unison voices, the source mixer, the
filter's real response with its envelope, the amp envelope, pitch envelope, drive curve, stereo width,
arpeggiator and trance gate; **Drums**: the kick (tuned to the key) and the kit levels; the **FX
timeline** on the Notes tab. **Mix**: loudness history, a stage with a dot per track (pan × volume),
master EQ and dynamics, reverb, delay and the sidechain pump. Audio updates when you let go; with
**Audition** on, a note plays after each edit. Double-tap a handle to put it back to the preset.

Every slider has ◀ ▶ arrows. They move by the step size: **1 Small**, **2 Medium** or **3 Large**
(the STEP pill in the transport, the switch in the desktop top bar, or the 1 / 2 / 3 keys).
Shift-click an arrow for one large step, Alt-click for a small one; hold it to repeat.

## The coach

The graduation cap opens the coach (`js/coach/`): a panel above the tab bar on the phone (collapse it
to a slim bar), a column on the right on a computer. It never opens by itself.

- **Learn**: a tour of the demo song, then 12 lessons from a first drop in 10 minutes to mastering
  and export (chords, bass and kick, drums, the hook, supersaw design, arrangement, tension and
  release, sidechain, mixing). Each step says what to do and why pros do it. **Show me** goes to the
  screen and rings the control, **Do it for me** does it (with Undo), **Listen** plays the section.
  Steps tick themselves when the song has it. Lessons that build your own track wait until you are
  on your own song (Menu → New song).
- **Song check**: scores Composition, Sound design, Arrangement and Mix and master, and lists what to
  fix first, each with why and, where it can, a one-tap **Fix**.
- **Explain**: a searchable glossary of every control and term, and **Explain mode**: tap any slider
  label or card title for what it does and the sweet spot for this style.

Progress is kept in this browser (localStorage).

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

## On a computer

E-Drop is built for a big screen too, up to a 47–49" super-ultrawide (5120×1440 or 3840×1080). When
the window is at least 1200 px wide it switches to the desktop layout (`js/ui/desktop.js`,
`css/desktop.css`); narrower windows and phones keep the phone layout.

- **One top bar**: the song, transport, clock, a master loudness meter (short-term LUFS with −14 and
  −9 marks, and peak; click it for Mix), the arrow step size (1 Small · 2 Medium · 3 Large), key,
  tempo, coach and menu. No tab bar: every panel is on screen at once, each with its own title bar and
  scroll. Click in a panel to make it the current one.
- **Ultrawide (2200 px and wider)**: Song across the full width on top; below it the editor (Notes or
  Drums), Sound and Mix side by side. Sound and Mix lay their cards out in as many columns as fit.
- **Desktop (1200–2199 px)**: Song on top; the editor and one side panel switchable between Sound and
  Mix below.
- **Coach**: the graduation cap docks the coach as a column on the right.
- Drag the bar between Song and the panels below to share the height (double-click resets it).
- **Song** fits the whole song to the width (**Fit**; the − + buttons or Ctrl + wheel zoom). The
  rows fill the panel, each cell shows a picture of its pattern, click a track's name to edit it in
  the editor and Sound, and M / S mute and solo it. The selected section's card sits on the right.
- **Notes** fits the pattern to the width (**Fit**), zooms to 96 px per 16th, and names the notes when
  they're wide enough. Ctrl + wheel zooms around the pointer, Shift + wheel scrolls sideways, Alt +
  wheel changes the row height.
- Sheets open as centred dialogs.
- **Display size** (menu): Auto, 100%, 125%, 150% or 175%, for a big screen seen from a distance. Auto
  picks 125% on a 5120×1440 screen at 100% Windows scaling and 150% on a 4K screen at 100%.

### Keyboard shortcuts

| Key | Does |
|---|---|
| Backspace | Undo the last change; press again for the one before, and so on back to the first |
| Shift + Backspace | Redo (Ctrl+Y and Ctrl+Shift+Z too; Ctrl+Z also undoes) |
| Esc | Reset the song to the original: the demo as it ships, a new song as the template, a copy as it was copied. Backspace brings your changes back |
| Space | Play / stop |
| L | Loop the selected section on / off |
| Home | Back to the start of the section |
| ← → | Playhead one bar back / forward (Shift: previous / next section) |
| F | Fit the song (and the pattern) to the width |
| N / D | Editor: Notes / Drums |
| S / M | Show Sound / Mix |
| C | Open or close the coach |
| 1 / 2 / 3 | Arrow step size: small, medium, large (Shift-click an arrow for one large step, Alt-click for a small one) |
| Esc | With a sheet, a coach definition or a Show me ring up: closes it (press again to reset) |
| ? | The list of shortcuts |

Shortcuts are off while you type in a box, and all but undo and redo while you hold Ctrl. Arrow keys
on a focused slider move it.

**Undo** (`js/undo.js`) counts one gesture as one change: a tap, a drag, a hold on a ◀ ▶ arrow, a
key sheet pick, a coach Do it for me. Each change keeps the whole song, so undo is exact, and the
music keeps playing. The toast says what was undone (for example "Undid Lead notes · 6 more to
undo"), and the track it was on is selected so you see it. Up to 200 changes per song are kept until
the page reloads. The original that Esc goes back to is saved with the song, so it survives a
reload; songs from before version 3 get theirs the first time they open (the demo's is always the
demo as it ships). The song from before a reset is saved too, so Backspace can undo a reset even
after a reload. A second Esc within a second of one that closed a sheet or a coach pop-up doesn't
reset, and the undo keys wait while a note or a slider is still held down.

### Installing it from Edge or Chrome

Open E-Drop's address in Microsoft Edge or Google Chrome (the HTTPS address, or
http://localhost:8792 on this PC; a copy installed from localhost needs the local server running,
because the offline cache is off there), then:

- **Edge**: click **App available** at the right end of the address bar, or menu ··· → Apps →
  **Install this site as an app**.
- **Chrome**: click the install icon at the right end of the address bar, or menu ⋮ → Cast, save and
  share → **Install**. Menu → Install on this computer in E-Drop shows the same steps, with an
  Install button when the browser offers one.

It opens in its own window without browser bars; pin it to the taskbar. F11 makes it full screen,
the most room on a super-ultrawide. Songs stay in that browser on that computer.

## Running it on this PC

```
python -m http.server 8792 --directory "C:\E-Estimating\e-estimatingllc ai creations\E-Drop"
```

Then open http://localhost:8792. The offline cache (`sw.js`) is off on localhost. Bump `VERSION` in
`sw.js` whenever files change, so installed copies update.

Built for E-Estimating LLC; the app icon and the menu use the official logo
(`brand/e-estimating-logo.svg`). E-Drop is an original tool for this style of music and isn't
affiliated with any artist.
