# Accordion Trainer

**English** | [한국어](README.ko.md)

A falling-notes practice tool for the accordion, in the spirit of Synthesia. Open a MIDI file and the notes of both hands fall onto the buttons or keys you play them with: the treble on a C-system or B-system (bayan) button board or a piano keyboard, the bass on the Stradella board.

https://github.com/user-attachments/assets/d34d6058-2042-4767-a283-51cd317efa61

## Practising with an electronic accordion
Connect an electronic accordion such as a Roland V-Accordion over USB, and the app reads what you play:
- **Practice mode** waits until you play each note — for the treble, the bass, or both. A chord counts once all its notes are held down together.
- Every press is judged for timing, and the buttons you hold light up as you play.
- Loop a few bars, slow the song down, or keep time with the metronome.

## With any accordion
No MIDI needed: follow the falling notes on any acoustic accordion, button or piano. You can also press the buttons and keys with the mouse.

## Trimming the treble
When a song's treble part goes lower than you want to play with the right hand (a piano part, say), click a lane where the notes fall:
- **Left-click**: that lane and every lower one leave the treble.
- **Right-click**: the same notes move to the bass part instead, to play on the bass buttons and chords.
- Click the same lane the same way again to undo.

## Keyboard shortcuts
**Space** plays and pauses, **Home** goes back to the start (or the loop's start), **← →** move by bars and **↑ ↓** change the speed by 5%.

## Getting started
- **Windows**: download the exe from [Releases](../../releases) and run it; there's nothing to install.
- **Web**: the same app runs in a browser with Web MIDI (Chrome, Edge): **[open it on the web](https://jyarljung.github.io/accordion-trainer/)**.
- **Android tablet or phone**: open the web version in **Chrome** and choose **Install app** (or **Add to Home screen**) from the ⋮ menu. It then starts from its own icon, full screen and offline. Samsung Internet has no Web MIDI, so install it from Chrome. Turn the device sideways: the app needs a landscape screen.

"Open the sample song" on the first screen opens Greensleeves to try it out.

### Roland V-Accordion
Connect the USB COMPUTER port and the input is picked up automatically. To hear songs on the instrument's own sounds, set MIDI → Ext Seq → Accordion to On on the instrument, and choose "MIDI: Roland Arranger" as the track's sound.

On Android, connect through a USB OTG adapter or a USB-C to USB-B cable, and set the instrument's USB driver to Generic ([MENU] → System → USB Drv, then save with [MENU/WRITE] → SYSTEM and turn the instrument off and on). If the device only says it's charging, restart it with the instrument connected.

## Sound
Songs play through [SpessaSynth](https://github.com/spessasus/spessasynth_lib) with the [GeneralUser GS](https://www.schristiancollins.com/generaluser) SoundFont bundled (Italian Accordion by default).

## Development
```
npm install
npm run app    # development window
npm run dist   # builds the exe into release/
```

## License
MIT. Licences of the bundled components are in `public/licenses/`.
- SpessaSynth (spessasynth_lib, spessasynth_core): Apache License 2.0, © Spessasus
- GeneralUser GS: © S. Christian Collins, GeneralUser GS License v2.0
- App icon: the Twemoji accordion (🪗), recoloured; Twemoji graphics © Twitter, Inc and other contributors, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- Sample song `public/demo/greensleeves.mid`: Greensleeves (Traditional), arranged for accordion by Ralf Axel Gehlert, [Mutopia Project #1265](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1265), public domain
