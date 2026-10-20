import './style.css';
import cGriffJson from '../layouts/fr4xb-c-griff-europe.json';
import bGriffJson from '../layouts/fr4xb-b-griff.json';
import pianoJson from '../layouts/piano-88.json';
import bassJson from '../layouts/fr4xb-stradella-2row.json';
import { BassLayout, type BassLayoutDef } from './core/bassLayout';
import { Layout, noteName, type LayoutDef } from './core/layout';
import { CHORD_EPS, defaultOptions, extractBass, extractNotes, extractOthers, parseSong, type BassNote, type ExtractOptions, type Song, type SongNote } from './core/song';
import { Transport } from './core/transport';
import { Judge } from './core/judge';
import { WaitMode, type Waited } from './core/practice';
import { BassJudge, type BassTarget } from './core/bassJudge';
import { MidiIO, type Part } from './io/midi';
import { PartPlayer, type Route } from './io/player';
import { engine, ITALIAN_ACCORDION, presetValue, STANDARD_DRUMS } from './io/synth';
import { PartVoice } from './io/voice';
import { getPref, persist, resetPrefs, setPref } from './io/prefs';
import { setLang, systemLang, t as tr } from './i18n';
import type { Geometry } from './view/geometry';
import { Metronome, type Click } from './io/metronome';
import { BeatSwing } from './view/beatSwing';
import { Stage } from './view/stage';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  file: $<HTMLInputElement>('file'),
  songName: $('songName'),
  trackRows: $('trackRows'),
  parts: $('parts'),
  transpose: $<HTMLSelectElement>('transpose'),
  settingsBtn: $<HTMLButtonElement>('settingsBtn'),
  settings: $('settings'),
  play: $<HTMLButtonElement>('play'),
  seek: $<HTMLInputElement>('seek'),
  time: $('time'),
  rate: $<HTMLInputElement>('rate'),
  rateLabel: $('rateLabel'),
  rateUnit: $<HTMLSelectElement>('rateUnit'),
  loopA: $<HTMLButtonElement>('loopA'),
  loopB: $<HTMLButtonElement>('loopB'),
  practiceRight: $<HTMLInputElement>('practiceRight'), // practice (wait) mode for the right hand
  practiceBass: $<HTMLInputElement>('practiceBass'), // ... and for the bass; play mode with neither
  midiIn: $<HTMLSelectElement>('midiIn'),
  chRight: $<HTMLSelectElement>('chRight'),
  chBass: $<HTMLSelectElement>('chBass'),
  chChord: $<HTMLSelectElement>('chChord'),
  lastCh: $('lastCh'),
  helpers: $<HTMLInputElement>('helpers'),
  rightLayout: $<HTMLSelectElement>('rightLayout'),
  pianoLow: $<HTMLInputElement>('pianoLow'),
  pianoHigh: $<HTMLInputElement>('pianoHigh'),
  mirror: $<HTMLInputElement>('mirror'),
  mirrorX: $<HTMLInputElement>('mirrorX'),
  noteNames: $<HTMLInputElement>('noteNames'),
  bassChromatic: $<HTMLInputElement>('bassChromatic'),
  rowGap: $<HTMLInputElement>('rowGap'),
  hitWindow: $<HTMLInputElement>('hitWindow'),
  chordNeed: $<HTMLSelectElement>('chordNeed'),
  hitWindowLabel: $('hitWindowLabel'),
  latency: $<HTMLInputElement>('latency'),
  latencyLabel: $('latencyLabel'),
  upcoming: $<HTMLInputElement>('upcoming'),
  followInput: $<HTMLInputElement>('followInput'),
  metronome: $<HTMLInputElement>('metronome'),
  metronomeUnit: $<HTMLSelectElement>('metronomeUnit'),
  rowGapLabel: $('rowGapLabel'),
};

// The language: the system's (Korean or English) unless chosen in the settings. Text built in
// code is rebuilt on a change; the canvas picks it up on the next frame.
$('version').textContent = `v${__APP_VERSION__}`;

const languageSelect = $<HTMLSelectElement>('language');
function applyLanguage(): void {
  const v = languageSelect.value;
  setLang(v === 'ko' || v === 'en' ? v : systemLang());
}
persist(languageSelect, 'language', applyLanguage);
languageSelect.addEventListener('change', () => {
  applyLanguage();
  renderTracks();
  refreshPorts();
});

// Right-hand button layouts, picked in the settings.
const layouts: Record<string, Layout> = {
  c: new Layout(cGriffJson as LayoutDef),
  b: new Layout(bGriffJson as LayoutDef),
  piano: new Layout(pianoJson as LayoutDef),
};
let layout = layouts.c;
const transport = new Transport();
const midi = new MidiIO();
const bassLayout = new BassLayout(bassJson as BassLayoutDef);
// Low-latency drawing: automatic (on unless there's a touch screen: tablets can tear), or as set.
const lowLatencySelect = $<HTMLSelectElement>('lowLatency');
const lowLatency = () => (lowLatencySelect.value === 'auto' ? navigator.maxTouchPoints === 0 : lowLatencySelect.value === 'on');
persist(lowLatencySelect, 'lowLatency');
const stage = new Stage($<HTMLCanvasElement>('stage'), layout, bassLayout, lowLatency());
lowLatencySelect.addEventListener('change', () => stage.setLowLatency(lowLatency()));
// Pointer input goes to the box around the canvas, which outlives a swapped canvas.
const stageBox = $('stageBox');

let song: Song | null = null;
let options: ExtractOptions | null = null;
const treble = new PartPlayer(n => route('right', n.track));
const bass = new PartPlayer<BassNote>(n => route(n.chord ? 'chord' : 'bass', n.track));
// Tracks in neither part play along on their own MIDI channels, at their volume.
const others = new PartPlayer(n => route('other', n.track));
type VoicePart = Part | 'other';
let judge = new Judge([]);
let bassJudge = new BassJudge([], bassLayout); // wait mode's bass (see waited)
const waiter = new WaitMode();
// Sounds the player's keys hold (see followInput), by part and key: stopped when the key is
// released. A chord's keys share one list, so letting go of any of them stops the chord.
interface Sound {
  route: Route;
  note: number;
}
const inputHeld = new Map<string, Sound[]>();
const trackVoices = new Map<number, string>(); // track index -> voice, for the current song
const trackVolumes = new Map<number, number>(); // track index -> volume 0..1, for the current song
const mutedTracks = new Set<number>(); // tracks silenced without losing their volume, for the current song
const trackOctaves = new Map<number, number>(); // track index -> octaves up or down, for the current song
const DEFAULT_VOLUME = 0.8;
// A voice per part and track: the part sets the MIDI channel, the track the sound and volume.
// Track -1 is the player's own presses that match no song note.
const voices = new Map<string, { part: VoicePart; track: number; voice: PartVoice }>();
const FREE_VELOCITY = 0.8; // for presses that don't match a song note
// Wait mode: a hit note whose key is let go before the note ends goes back to its unplayed
// colour (the hit still counts).
const hitKeys = new Map<number, number>(); // right-hand pitch -> id of the note its press hit
const letGo = new Set<number>();
let loopA: number | null = null; // loop markers, each set on its own; together (A before B) they loop
let loopB: number | null = null;
let loop: { a: number; b: number } | null = null;
// ---------- song ----------

function setSong(s: Song): void {
  song = s;
  options = defaultOptions();
  const first = s.tracks.find(t => t.channel !== 10);
  if (first) options.tracks = [first.index]; // the first (non-drum) track starts as the right hand
  trackVoices.clear();
  trackVolumes.clear();
  mutedTracks.clear();
  trackOctaves.clear();
  applyRateUnit(); // the BPM steps follow the song's tempo
  ui.songName.textContent = s.name;
  ui.songName.title = s.name;
  ui.transpose.value = String(options.transpose);
  transport.pause();
  showPlayState();
  clearLoop();
  renderTracks();
  rebuild(0);
}

async function loadFile(file: File): Promise<void> {
  try {
    setSong(parseSong(await file.arrayBuffer(), file.name));
  } catch (e) {
    alert(`${tr('loadFailed')}\n${e}`);
  }
}

// The track table sits beside the bass roll; the geometry lays out both.
function placePanels(geo: Geometry): void {
  const { left, right, top, bottom } = geo.tracksBox;
  Object.assign(ui.parts.style, {
    left: `${left}px`, width: `${right - left}px`, top: `${top}px`, height: `${bottom - top}px`,
  });
}
stage.onLayout = placePanels;

function rebuild(t = transport.time): void {
  if (!song || !options) return;
  treble.notes = extractNotes(song, options);
  bass.notes = extractBass(song, options);
  others.notes = extractOthers(song, options);
  judge = new Judge(treble.notes, n => layout.playable(n));
  judge.windowSec = hitWindow();
  judge.need = chordNeed();
  bassJudge = new BassJudge(bass.notes, bassLayout);
  transport.duration = song.duration;
  makeClicks();
  seek(t);
}

function seek(t: number): void {
  transport.seek(t);
  silence();
  treble.seek(transport.time);
  bass.seek(transport.time);
  others.seek(transport.time);
  judge.resetFrom(transport.time);
  bassJudge.resetFrom(transport.time);
  waiter.reset();
  hitKeys.clear();
  letGo.clear();
}

function silence(): void {
  inputHeld.clear();
  for (const { voice } of voices.values()) voice.allOff();
  treble.stop();
  bass.stop();
  others.stop();
}

// One row per track: its voice, its volume, a mute switch and a checkbox for each part.
function renderTracks(): void {
  fillDefaultVoice();
  ui.trackRows.replaceChildren();
  ui.parts.classList.toggle('empty', !song);
  if (!song || !options) return;
  const opts = options;
  for (const t of song.tracks) {
    const row = document.createElement('div');
    row.className = 'track-row';
    const trackName = t.name || tr('track.fallback', { n: t.index + 1 });
    row.title = `${trackName}\nch${t.channel} · ${tr('track.notes', { n: t.noteCount })} · ${noteName(t.minNote)}–${noteName(t.maxNote)}`;
    const name = document.createElement('span');
    name.className = 'track-name';
    const ch = document.createElement('small');
    ch.textContent = ` ch${t.channel}`;
    name.append(trackName, ch);
    const pick = (part: 'tracks' | 'bassTracks', title: string) => {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.column = part;
      cb.title = title;
      cb.checked = opts[part].includes(t.index);
      cb.onchange = () => {
        opts[part] = cb.checked ? [...opts[part], t.index] : opts[part].filter(i => i !== t.index);
        rebuild();
      };
      return cb;
    };
    const voice = document.createElement('select');
    voice.title = tr('track.voice.tip');
    fillVoiceOptions(voice);
    voice.value = wantedVoice(t.index);
    voice.onchange = () => {
      trackVoices.set(t.index, voice.value);
      syncVoices();
    };
    const octave = document.createElement('select');
    octave.title = tr('tracks.octave.tip');
    for (const o of [2, 1, 0, -1, -2]) octave.add(new Option(o > 0 ? `+${o}` : String(o), String(o)));
    octave.value = String(octaveOf(t.index));
    octave.onchange = () => {
      trackOctaves.set(t.index, Number(octave.value));
      applyOctaves();
    };
    const volume = document.createElement('input');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '1';
    volume.step = '0.1';
    volume.value = String(volumeOf(t.index));
    const volumeTitle = () => tr('track.volume.tip', { n: Math.round(Number(volume.value) * 100) });
    volume.title = volumeTitle();
    volume.oninput = () => {
      trackVolumes.set(t.index, Number(volume.value));
      volume.title = volumeTitle();
      applyVolumes();
    };
    const mute = document.createElement('input');
    mute.type = 'checkbox';
    mute.dataset.column = 'mute';
    mute.title = tr('tracks.mute');
    mute.checked = mutedTracks.has(t.index);
    mute.onchange = () => {
      if (mute.checked) mutedTracks.add(t.index);
      else mutedTracks.delete(t.index);
      applyVolumes();
    };
    row.append(name, voice, octave, volume, mute, pick('tracks', tr('tracks.right.tip')), pick('bassTracks', tr('tracks.bass.tip')));
    ui.trackRows.append(row);
  }
}

// The track table's checkboxes can be painted: press one and drag over the others in its column,
// and they all take the state the first one switched to.
let painting: { column: string; checked: boolean } | null = null;
function paint(cb: HTMLInputElement): void {
  if (!painting || cb.dataset.column !== painting.column || cb.checked === painting.checked) return;
  cb.checked = painting.checked;
  cb.dispatchEvent(new Event('change'));
}
ui.trackRows.addEventListener('pointerdown', e => {
  const cb = e.target;
  if (e.button !== 0 || !(cb instanceof HTMLInputElement) || !cb.dataset.column) return;
  e.preventDefault(); // the switch happens here, not on the click that follows
  painting = { column: cb.dataset.column, checked: !cb.checked };
  paint(cb);
});
window.addEventListener('pointermove', e => {
  if (!painting) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (el instanceof HTMLInputElement) paint(el);
});
window.addEventListener('pointerup', () => {
  painting = null;
});
// A mouse click on a checkbox would switch it back; keyboard toggling (no pointer) still works.
ui.trackRows.addEventListener('click', e => {
  if (e.target instanceof HTMLInputElement && e.target.dataset.column && e.detail > 0) e.preventDefault();
});

// Clicking a treble lane cuts it and every lane below it out of the right hand; a right click
// hands that range to the bass instead. One cut at a time: a new click replaces it, and the
// same click on the same lane again undoes it.
function cutAt(e: MouseEvent, toBass: boolean): void {
  const note = options ? stage.laneAt(e.offsetX, e.offsetY) : null;
  if (!options || note === null) return;
  e.preventDefault();
  const c = options.cut;
  options.cut = c && c.note === note && c.toBass === toBass ? null : { note, toBass };
  rebuild();
}
stageBox.addEventListener('click', e => cutAt(e, false));
stageBox.addEventListener('contextmenu', e => {
  if (stage.buttonAt(e.offsetX, e.offsetY)) e.preventDefault(); // the boards have no right-click
  else cutAt(e, true);
});
stageBox.addEventListener('mousemove', e => {
  const x = e.offsetX, y = e.offsetY;
  stageBox.style.cursor = stage.buttonAt(x, y) || (song && stage.laneAt(x, y) !== null) ? 'pointer' : '';
});

// Keys and buttons on the boards play like the instrument's: a press goes in as MIDI input, so
// everything works with the mouse too, practice mode included, and it sounds.
let mouseHeld: { part: Part; notes: number[] } | null = null;
function mouseRelease(): void {
  if (!mouseHeld) return;
  for (const n of mouseHeld.notes) midi.simulate(n, false, midi.channels[mouseHeld.part]);
  mouseHeld = null;
}
function mousePress(hit: { part: Part; notes: number[] }): void {
  mouseRelease();
  mouseHeld = hit;
  for (const n of hit.notes) {
    midi.simulate(n, true, midi.channels[hit.part]);
    // The instrument sounds by itself; a mouse press has the app sound it, unless playing by my
    // keys already does. Letting go stops it like any input key.
    if (inputHeld.has(`${hit.part}:${n}`)) continue;
    startSound();
    holdKey(hit.part, n, [playFree(hit.part, n)]);
  }
}
let mouseDragging = false; // a press that started on a key or button, until the mouse lets go
stageBox.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const hit = stage.buttonAt(e.offsetX, e.offsetY);
  if (!hit) return;
  e.preventDefault();
  stageBox.setPointerCapture(e.pointerId);
  mouseDragging = true;
  mousePress(hit);
});
// Dragging across the board plays each key or button passed over (a glissando). Between round
// buttons, or off the board, the last one lets go and the drag carries on.
stageBox.addEventListener('pointermove', e => {
  if (!mouseDragging) return;
  const hit = stage.buttonAt(e.offsetX, e.offsetY);
  const same = hit && mouseHeld && hit.part === mouseHeld.part && hit.notes.join() === mouseHeld.notes.join();
  if (same) return;
  if (hit) mousePress(hit);
  else mouseRelease();
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  stageBox.addEventListener(type, () => {
    mouseDragging = false;
    mouseRelease();
  });
}
for (let t = -12; t <= 12; t++) ui.transpose.append(new Option(t > 0 ? `+${t}` : String(t), String(t)));
ui.transpose.value = '0';
ui.transpose.onchange = () => {
  if (!options) return;
  options.transpose = Number(ui.transpose.value);
  rebuild();
};

$<HTMLButtonElement>('resetPrefs').onclick = () => {
  if (!confirm(tr('resetPrefs.confirm'))) return;
  resetPrefs();
  location.reload();
};
// The settings menu drops down under ⚙ and closes on a click outside it or Esc.
function showSettings(show: boolean): void {
  ui.settings.hidden = !show;
  ui.settingsBtn.classList.toggle('active', show);
}
ui.settingsBtn.onclick = () => showSettings(ui.settings.hidden !== false);
document.addEventListener('pointerdown', e => {
  const t = e.target as Node;
  if (!ui.settings.hidden && !ui.settings.contains(t) && !ui.settingsBtn.contains(t)) showSettings(false);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !ui.settings.hidden) showSettings(false);
});

$('openOther').onclick = () => ui.file.click();

// The sample song: Greensleeves for accordion (public domain, from the Mutopia Project), with its
// "treble" and "bass" tracks given to the two parts straight away.
$<HTMLButtonElement>('openSample').onclick = async e => {
  e.preventDefault(); // it sits in the drop zone's label: don't open the file picker too
  let s: Song;
  try {
    s = parseSong(await (await fetch('demo/greensleeves.mid')).arrayBuffer(), 'Greensleeves');
  } catch (err) {
    alert(`${tr('loadFailed')}\n${err}`);
    return;
  }
  setSong(s);
  if (!options) return;
  const named = (name: string) => s.tracks.filter(t => t.name.toLowerCase() === name).map(t => t.index);
  options.tracks = named('treble');
  options.bassTracks = named('bass');
  renderTracks();
  rebuild();
};
ui.file.onchange = () => {
  const f = ui.file.files?.[0];
  if (f) loadFile(f);
  ui.file.value = '';
};

window.addEventListener('dragover', e => {
  e.preventDefault();
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', () => document.body.classList.remove('dragging'));
window.addEventListener('drop', e => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  const f = e.dataTransfer?.files[0];
  if (f) loadFile(f);
});

// ---------- transport ----------

function togglePlay(): void {
  if (!song) return;
  if (transport.playing) {
    transport.pause();
    silence();
  } else {
    startSound();
    if (transport.time >= transport.duration) seek(loop?.a ?? 0);
    transport.play();
  }
  showPlayState();
}

function showPlayState(): void {
  ui.play.textContent = transport.playing ? '❚❚' : '▶';
}

// Audio needs a user gesture to start: play, the instrument's keys (in the Electron shell; a
// browser wants a click or a key first, so any one starts it).
for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, () => engine.resume(), { once: true });
function startSound(): void {
  engine.resume();
  for (const { voice } of voices.values()) voice.start();
}

// ---------- metronome ----------

// Clicks are scheduled a little ahead on the audio clock, so they land on the beat rather than on
// the next frame. None while the clock waits, and none past where it's held. The volume slider
// at 0 turns them off.
const metronome = new Metronome();
const CLICK_AHEAD = 0.05; // s of real time
let clicks: { time: number; kind: Click }[] = []; // in time order
let nextClick = 0; // index into clicks of the next one to play
let clickedAt = -Infinity; // song time of the last frame that scheduled clicks

// The clicks for the chosen spacing, whatever the swing does (it always reaches an end on each
// beat). 2분 clicks on every other beat of a bar, from its first, so once per swing there and
// back; 4분 on every beat; 8분 also halfway between beats, with a softer click.
function makeClicks(): void {
  const beats = song?.beats ?? [];
  const barStarts = new Set(song?.bars ?? []);
  const unit = ui.metronomeUnit.value;
  let inBar = 0;
  clicks = beats.flatMap((b, i) => {
    if (barStarts.has(b)) inBar = 0;
    const kind: Click = barStarts.has(b) ? 'bar' : 'beat';
    if (unit === 'half') return inBar++ % 2 === 0 ? [{ time: b, kind }] : [];
    const next = beats[i + 1];
    if (unit === 'eighth' && next !== undefined) return [{ time: b, kind }, { time: (b + next) / 2, kind: 'sub' as Click }];
    return [{ time: b, kind }];
  });
  clickedAt = -Infinity;
}

function clickBeats(t: number): void {
  const volume = Number(ui.metronome.value);
  if (volume <= 0 || !transport.playing || transport.waiting) {
    clickedAt = -Infinity; // pick up from wherever the clock is when clicks resume
    return;
  }
  // A jump (seek, loop, wait-mode rewind) restarts from the click at or after t.
  if (t < clickedAt - 1e-6 || t > clickedAt + 0.25 * transport.rate) {
    nextClick = clicks.findIndex(c => c.time >= t - 1e-6);
    if (nextClick < 0) nextClick = clicks.length;
  }
  clickedAt = t;
  const until = Math.min(t + CLICK_AHEAD * transport.rate, transport.hold ?? Infinity);
  for (; nextClick < clicks.length && clicks[nextClick].time <= until; nextClick++) {
    metronome.click((clicks[nextClick].time - t) / transport.rate, clicks[nextClick].kind, volume);
  }
}
ui.metronome.addEventListener('input', () => engine.resume());
ui.metronomeUnit.addEventListener('change', makeClicks);

function clearLoop(): void {
  loopA = loopB = null;
  applyLoop();
}

// The loop from the markers. A loop that has only just come about starts playing from A; moving an
// end of a loop already there leaves the playhead alone.
function applyLoop(): void {
  const had = loop !== null;
  loop = loopA !== null && loopB !== null && loopA < loopB ? { a: loopA, b: loopB } : null;
  ui.loopA.classList.toggle('active', loopA !== null);
  ui.loopB.classList.toggle('active', loopB !== null);
  if (loop && !had) seek(loop.a);
}

ui.play.onclick = togglePlay;
ui.seek.oninput = () => seek((Number(ui.seek.value) / 1000) * transport.duration);
// The frame loop moves the seek bar except while the user is dragging it. (Checking focus
// instead left the bar frozen after any click, since a clicked range input keeps focus.)
let draggingSeek = false;
ui.seek.addEventListener('pointerdown', () => {
  draggingSeek = true;
});
window.addEventListener('pointerup', () => {
  if (!draggingSeek) return;
  draggingSeek = false;
  ui.seek.blur(); // hand Space and the arrow keys back to the app's shortcuts
});
ui.rate.oninput = () => {
  transport.rate = Number(ui.rate.value);
  ui.rateLabel.textContent = bpmMode() ? `${Math.round(song!.bpm * transport.rate)} BPM` : `${Math.round(transport.rate * 100)}%`;
};

// The speed in percent, in steps of 5%, or in BPM: the song's first tempo times the speed, in
// steps of 4 BPM counted from the song's own tempo so that 100% stays on the slider. Either way the
// slider runs from 25% to 150%.
function bpmMode(): boolean {
  return ui.rateUnit.value === 'bpm' && song !== null;
}
function rateStep(): number {
  return bpmMode() ? 4 / song!.bpm : 0.05;
}
function applyRateUnit(): void {
  const s = rateStep();
  ui.rate.step = String(s);
  // A hair past the last step, so float error can't leave that step off the slider.
  ui.rate.min = String(1 - Math.floor(0.75 / s + 1e-9) * s);
  ui.rate.max = String(1 + Math.floor(0.5 / s + 1e-9) * s + 1e-9);
  setRate(transport.rate);
}
ui.rateUnit.addEventListener('change', applyRateUnit);
// Loop points snap to bars: A to the start of the bar it's in, B to the end of its bar.
function loopGrid(): number[] {
  return song?.bars ?? [];
}

// A marks the start of the bar the playhead is in, B the end of it. Each moves on its own and keeps
// the other, unless it would land on the wrong side of it: then the other one goes. Pressed where
// it already is (or right-clicked), a marker goes away.
const sameSpot = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-3;
ui.loopA.onclick = () => {
  const at = loopGrid().filter(g => g <= transport.time + 1e-3).pop() ?? transport.time;
  loopA = sameSpot(loopA, at) ? null : at;
  if (loopA !== null && loopB !== null && loopA >= loopB) loopB = null;
  applyLoop();
};
ui.loopB.onclick = () => {
  const at = loopGrid().find(g => g > transport.time + 1e-3) ?? transport.duration;
  loopB = sameSpot(loopB, at) ? null : at;
  if (loopA !== null && loopB !== null && loopB <= loopA) loopA = null;
  applyLoop();
};
ui.loopA.oncontextmenu = e => {
  e.preventDefault();
  loopA = null;
  applyLoop();
};
ui.loopB.oncontextmenu = e => {
  e.preventDefault();
  loopB = null;
  applyLoop();
};
// Each track has its own volume, in whichever part its notes play.
function volumeOf(track: number): number {
  if (mutedTracks.has(track)) return 0;
  return trackVolumes.get(track) ?? DEFAULT_VOLUME;
}
function applyVolumes(): void {
  for (const { track, voice } of voices.values()) voice.setVolume(volumeOf(track));
}
// Hit window, ms on the slider, seconds in the judge.
function hitWindow(): number {
  return Number(ui.hitWindow.value) / 1000;
}
function applyHitWindow(): void {
  judge.windowSec = hitWindow();
  waiter.windowSec = hitWindow();
  ui.hitWindowLabel.textContent = `${ui.hitWindow.value}ms`;
}
ui.hitWindow.oninput = applyHitWindow;

// How many notes of a right-hand chord practice mode needs played (see Judge.need).
function chordNeed(): number | null {
  return ui.chordNeed.value ? Number(ui.chordNeed.value) : null;
}
function applyChordNeed(): void {
  judge.need = chordNeed();
  // Chords already counted are looked at again with the new number.
  judge.resetFrom(transport.time);
  waiter.reset();
}
ui.chordNeed.addEventListener('change', applyChordNeed);

// The instrument's input delay, ms on the slider: a press is judged at the moment it was played,
// that long before it arrived.
function latency(): number {
  return Number(ui.latency.value) / 1000;
}
function applyLatency(): void {
  waiter.latencySec = latency();
  ui.latencyLabel.textContent = `${ui.latency.value}ms`;
}
ui.latency.oninput = applyLatency;

function applyRowGap(): void {
  ui.rowGapLabel.textContent = Number(ui.rowGap.value).toFixed(2);
}
ui.rowGap.oninput = applyRowGap;

// Don't leave notes hanging on an external instrument when the app closes.
function shutdown(): void {
  silence();
  midi.shutdown();
}
window.addEventListener('beforeunload', shutdown);
// The Electron shell calls accordionShutdown before closing, so the messages get out before the
// process exits, and accordionPause when the window is minimised.
function pause(): void {
  if (transport.playing) togglePlay();
}
Object.assign(window, { accordionShutdown: shutdown, accordionPause: pause });

// Hidden pages stop requestAnimationFrame, so note-offs would never fire: pause. Not in the
// Electron shell, which keeps the page running when its window is merely covered (e.g. by the
// Windows volume mixer) and pauses on minimise instead.
if (!navigator.userAgent.includes('Electron')) {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });
}

// The bar start before t, or after it; the song's ends past the first and last bars. Going back
// from within a bar's first beat goes to the bar before, so pressing again while it plays keeps
// going back instead of landing on the same bar start.
function barStep(t: number, dir: -1 | 1): number {
  const bars = song?.bars ?? [];
  if (dir > 0) return bars.find(b => b > t + 0.05) ?? transport.duration;
  const i = bars.filter(b => b <= t + 0.05).length - 1; // the bar t is in
  if (i < 0) return 0;
  const firstBeatEnd = song?.beats.find(b => b > bars[i] + 1e-3) ?? Infinity;
  return t < firstBeatEnd ? (bars[i - 1] ?? 0) : bars[i];
}

// Sets the speed, on the slider's steps.
function setRate(rate: number): void {
  const min = Number(ui.rate.min), s = rateStep();
  const snapped = min + Math.round((rate - min) / s) * s;
  ui.rate.value = String(Math.min(Number(ui.rate.max), Math.max(min, snapped)));
  ui.rate.dispatchEvent(new Event('input'));
}

// Space plays and pauses, Home goes back to the start (or the loop's), the left and right
// arrows move by bars, the up and down arrows change the speed a step (5% or 4 BPM).
window.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
  if (e.target instanceof HTMLSelectElement || e.ctrlKey || e.altKey || e.metaKey) return;
  // A focused slider would also move itself on these keys.
  if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(e.code)) e.preventDefault();
  if (e.code === 'Space') togglePlay();
  else if (e.code === 'ArrowLeft') seek(barStep(transport.time, -1));
  else if (e.code === 'ArrowRight') seek(barStep(transport.time, 1));
  else if (e.code === 'ArrowUp') setRate(transport.rate + rateStep());
  else if (e.code === 'ArrowDown') setRate(transport.rate - rateStep());
  else if (e.code === 'Home') seek(loop?.a ?? 0);
});

// ---------- MIDI devices ----------

for (const [part, select] of [['right', ui.chRight], ['bass', ui.chBass], ['chord', ui.chChord]] as const) {
  for (let c = 1; c <= 16; c++) select.append(new Option(String(c), String(c)));
  select.value = String(midi.channels[part]);
  const apply = () => {
    silence(); // notes already sounding belong to the old channel
    midi.channels[part] = Number(select.value);
  };
  select.addEventListener('change', apply);
  persist(select, `channel.${part}`, apply);
}

function refreshPorts(): void {
  const inputs = midi.inputs();
  const current = midi.inputId;
  ui.midiIn.replaceChildren(new Option(tr(midi.supported ? 'input.none' : 'input.unsupported'), ''));
  for (const p of inputs) ui.midiIn.append(new Option(p.name, p.id));
  // Keep the current input; otherwise prefer something that looks like the accordion.
  const savedName = getPref('midiIn');
  const pick = inputs.find(p => p.id === current)
    ?? inputs.find(p => p.name === savedName)
    ?? inputs.find(p => /FR-?\d|roland/i.test(p.name))
    ?? inputs[0];
  ui.midiIn.value = pick?.id ?? '';
  if ((pick?.id ?? null) !== current) midi.selectInput(pick?.id ?? null);

  renderTracks(); // the voice lists include the MIDI outputs
  syncVoices();
}

// Each track can sound octaves up or down, in whichever part its notes play (as played back and as
// played by the player's keys); the board and roll don't move.
function octaveOf(track: number): number {
  return trackOctaves.get(track) ?? 0;
}
function applyOctaves(): void {
  silence(); // notes sounding were started at the old octave
  for (const { track, voice } of voices.values()) voice.transpose = 12 * octaveOf(track);
}

function applyRightLayout(): void {
  layout = layouts[ui.rightLayout.value] ?? layouts.c;
  stage.setLayout(layout);
  // Row options for the button boards, the played range for the piano.
  for (const el of document.querySelectorAll<HTMLElement>('.button-only')) el.hidden = layout.piano;
  for (const el of document.querySelectorAll<HTMLElement>('.piano-only')) el.hidden = !layout.piano;
  rebuild(); // judging asks the layout which notes have a button
}
// The piano's played range: one slider with two knobs, which can't pass each other.
function applyPianoRange(moved?: HTMLInputElement): void {
  let low = Number(ui.pianoLow.value), high = Number(ui.pianoHigh.value);
  if (low > high) {
    if (moved === ui.pianoHigh) high = low;
    else low = high;
    ui.pianoLow.value = String(low);
    ui.pianoHigh.value = String(high);
  }
  layouts.piano.setPlayRange(low, high);
  $('pianoLowLabel').textContent = noteName(low);
  $('pianoHighLabel').textContent = noteName(high);
  const min = Number(ui.pianoLow.min), span = Number(ui.pianoLow.max) - min;
  Object.assign($('pianoRangeFill').style, { left: `${((low - min) / span) * 100}%`, right: `${100 - ((high - min) / span) * 100}%` });
  // The knob moved last stays on top, so two knobs at one spot can still be pulled apart.
  ui.pianoLow.style.zIndex = moved === ui.pianoLow ? '2' : '1';
  ui.pianoHigh.style.zIndex = moved === ui.pianoLow ? '1' : '2';
}
persist(ui.pianoLow, 'pianoLow');
persist(ui.pianoHigh, 'pianoHigh', applyPianoRange);
for (const el of [ui.pianoLow, ui.pianoHigh]) {
  el.addEventListener('input', () => {
    applyPianoRange(el);
    if (layout.piano) rebuild(); // judging asks which notes have a key
  });
}

persist(ui.rightLayout, 'rightLayout', applyRightLayout);
ui.rightLayout.addEventListener('change', applyRightLayout);

// ---------- voices ----------

// Each track picks its own sound: a preset of the SoundFont (Italian Accordion by default, a drum
// kit for a drum track) or a MIDI output. (State at the top.)
function voiceChoices(): { label: string; value: string }[] {
  return [
    ...engine.presets.map(p => ({ label: p.drum ? tr('drumPrefix') + p.name : p.name, value: presetValue(p) })),
    ...midi.outputs().map(p => ({ label: `MIDI: ${p.name}`, value: `midi:${p.id}` })),
  ];
}

function fillVoiceOptions(select: HTMLSelectElement): void {
  for (const c of voiceChoices()) select.append(new Option(c.label, c.value));
}

const isDrumTrack = (track: number) => song?.tracks.find(t => t.index === track)?.channel === 10;

// The sound tracks start with, drum tracks aside: chosen in the settings, Italian Accordion
// until then (or when the choice is gone, like an unplugged MIDI output).
const defaultVoiceSelect = $<HTMLSelectElement>('defaultVoice');
function defaultVoice(): string {
  const v = defaultVoiceSelect.value || getPref('defaultVoice');
  return typeof v === 'string' && voiceChoices().some(c => c.value === v) ? v : ITALIAN_ACCORDION;
}
// Fills the choice from the voices there are (they come with the SoundFont and the MIDI ports).
function fillDefaultVoice(): void {
  const saved = getPref('defaultVoice');
  defaultVoiceSelect.replaceChildren();
  for (const c of voiceChoices()) if (!c.value.startsWith('sf:drum:')) defaultVoiceSelect.append(new Option(c.label, c.value));
  const has = (v: unknown) => [...defaultVoiceSelect.options].some(o => o.value === v);
  defaultVoiceSelect.value = has(saved) ? (saved as string) : ITALIAN_ACCORDION;
}
defaultVoiceSelect.addEventListener('change', () => {
  setPref('defaultVoice', defaultVoiceSelect.value);
  syncVoices();
  renderTracks();
});

// What a track should sound with; a choice that's gone (an unplugged MIDI output) falls back to
// the default.
function wantedVoice(track: number): string {
  const v = trackVoices.get(track);
  if (v && voiceChoices().some(c => c.value === v)) return v;
  return isDrumTrack(track) ? STANDARD_DRUMS : defaultVoice();
}

// A part's MIDI channel; a track playing along keeps the channel it was written on.
function channelOf(part: VoicePart, track: number): number {
  return part === 'other' ? song?.tracks.find(t => t.index === track)?.channel ?? 1 : midi.channels[part];
}

function voiceOf(part: VoicePart, track: number): PartVoice {
  const key = `${part}:${track}`;
  let entry = voices.get(key);
  if (!entry) {
    entry = { part, track, voice: new PartVoice(midi, () => channelOf(part, track)) };
    entry.voice.transpose = 12 * octaveOf(track);
    voices.set(key, entry);
  }
  const want = wantedVoice(track);
  if (entry.voice.value !== want) entry.voice.choose(want, volumeOf(track));
  return entry.voice;
}

function route(part: VoicePart, track: number): Route {
  return { sink: voiceOf(part, track), channel: channelOf(part, track) };
}

// Brings every voice in use up to its track's choice, silencing first if any changes.
function syncVoices(): void {
  const stale = [...voices.values()].filter(e => e.voice.value !== wantedVoice(e.track));
  if (stale.length === 0) return;
  silence();
  for (const e of stale) e.voice.choose(wantedVoice(e.track), volumeOf(e.track));
}

ui.midiIn.onchange = () => {
  midi.selectInput(ui.midiIn.value || null);
  setPref('midiIn', ui.midiIn.selectedOptions[0]?.text ?? '');
};

// Restore the remembered settings (song-specific options are left out on purpose).
persist(ui.rowGap, 'rowGap', applyRowGap);
persist(ui.hitWindow, 'hitWindow', applyHitWindow);
persist(ui.chordNeed, 'chordNeed', applyChordNeed);
persist(ui.rateUnit, 'rateUnit', applyRateUnit);
persist(ui.latency, 'latency', applyLatency);
persist(ui.metronome, 'metronomeLevel');
persist(ui.metronomeUnit, 'metronomeUnit', makeClicks);
for (const [el, key] of [[ui.helpers, 'helpers'], [ui.upcoming, 'upcoming'], [ui.followInput, 'followInput'], [ui.mirror, 'mirror'], [ui.mirrorX, 'mirrorX'], [ui.noteNames, 'noteNames'], [ui.bassChromatic, 'bassChromatic']] as const) {
  persist(el, key);
}

// Practice mode, part by part: either part checked waits for that part. Saved settings from before
// the split ("practice" with "bass too") carry over.
function practicing(): boolean {
  return ui.practiceRight.checked || ui.practiceBass.checked;
}
if (getPref('practiceRight') === undefined && getPref('practice') === true) {
  setPref('practiceRight', true);
  setPref('practiceBass', getPref('waitBass') !== false);
}
persist(ui.practiceRight, 'practiceRight');
persist(ui.practiceBass, 'practiceBass');

// The options that only apply in practice mode fade out without it.
function applyPractice(): void {
  const on = practicing();
  for (const el of document.querySelectorAll<HTMLElement>('.practice-only')) el.classList.toggle('off', !on);
  ui.hitWindow.disabled = !on;
  ui.followInput.disabled = !on;
}
for (const box of [ui.practiceRight, ui.practiceBass]) {
  box.addEventListener('change', () => {
    applyPractice();
    silence(); // play-by-my-keys and the parts' sounds change hands
    // A part switched on mid-song mustn't pull the clock back to what already went by.
    judge.resetFrom(transport.time);
    bassJudge.resetFrom(transport.time);
    waiter.reset();
  });
}
applyPractice();

// "Play by my keys" (practice mode; the bass too when it's practised): the sound follows the
// player's keys instead of the written notes. A note still starts on arrival, to cover the input
// delay, and holds through its hit window; a press that hits it takes it over (or starts it, if it
// hasn't arrived yet), and any other press sounds as played. Either way it stops when the key is
// released.
function followInput(): boolean {
  return ui.practiceRight.checked && ui.followInput.checked;
}
function followBass(): boolean {
  return ui.practiceBass.checked && ui.followInput.checked;
}
const holdUntil = (n: SongNote) => n.time + (judge.windowSec + latency()) * transport.rate;
treble.endOf = n => {
  const written = n.time + n.duration;
  if (!followInput() || judge.state[n.id] !== 'pending') return written;
  return Math.max(written, holdUntil(n));
};
// Bass notes a press takes over leave the player, so any still sounding is unplayed so far.
bass.endOf = n => (followBass() ? Math.max(n.time + n.duration, holdUntil(n)) : n.time + n.duration);
ui.followInput.addEventListener('change', silence);

function holdKey(part: Part, key: number, sounds: Sound[]): void {
  inputHeld.set(`${part}:${key}`, sounds);
}
function releaseKey(part: Part, key: number): void {
  const sounds = inputHeld.get(`${part}:${key}`);
  if (!sounds) return;
  inputHeld.delete(`${part}:${key}`);
  for (const s of sounds.splice(0)) s.route.sink.noteOff(s.note, s.route.channel);
}
// A key that matches no song note sounds as played, on the part's first track's voice.
function playFree(part: Part, key: number): Sound {
  const tracks = part === 'right' ? options?.tracks : options?.bassTracks;
  const r = route(part, tracks?.[0] ?? -1);
  r.sink.noteOn(key, FREE_VELOCITY, r.channel);
  return { route: r, note: key };
}
// The song's bass notes a hit plays, taken over from the clock: started if not yet sounding, or
// (with `restart`) in any case.
function takeOver(target: BassTarget, restart = false): Sound[] {
  const pc = (note: number) => ((note % 12) + 12) % 12;
  return bass.notes
    .filter(n => Math.abs(n.time - target.time) < CHORD_EPS
      && (target.chord !== null ? n.chord : !n.chord && pc(n.note) === target.pc))
    .map(n => {
      const r = route(n.chord ? 'chord' : 'bass', n.track);
      if (!bass.claim(n.id) || restart) r.sink.noteOn(n.note, n.velocity, r.channel);
      return { route: r, note: n.note };
    });
}

midi.onNoteOff = (part, note) => {
  releaseKey(part, note);
  const id = part === 'right' ? hitKeys.get(note) : undefined;
  if (id !== undefined) {
    hitKeys.delete(note);
    const n = treble.notes[id];
    if (ui.practiceRight.checked && transport.time < n.time + n.duration) letGo.add(id);
  }
  drawStage();
};
// The beat swing beside the metronome switch; a right-hand press is marked where the dot was when
// it was played (the input delay before it arrived taken off).
const beatSwing = new BeatSwing($('beatSwing'));

// What practice mode waits for: the parts checked.
function waited(): Waited[] {
  return [...(ui.practiceRight.checked ? [judge] : []), ...(ui.practiceBass.checked ? [bassJudge] : [])];
}

// Everything due at a time, in the parts practised, held down now: the right-hand chord's keys (as many
// as it needs), a button for each bass note, the button of each chord.
waiter.allHeld = time => {
  if (ui.practiceRight.checked) {
    const c = judge.chords.find(c => Math.abs(c.time - time) < CHORD_EPS);
    if (c && c.ids.filter(id => judge.state[id] !== 'skipped' && midi.held.right.has(treble.notes[id].note)).length < judge.needOf(c)) return false;
  }
  if (ui.practiceBass.checked) {
    const pcs = new Set([...midi.held.bass.keys()].map(n => n % 12));
    const chord = bassLayout.forChord(midi.held.chord.keys());
    for (const g of bassJudge.targetsAt(time)) {
      if (g.chord === null ? !pcs.has(g.pc) : !(chord && chord.row === g.chord && chord.root === g.pc)) return false;
    }
  }
  return true;
};

// A bass or chord button in wait mode. A chord button sends its notes one by one; it counts once
// they make a chord.
// With "play by my keys", a hit takes over the song's notes it plays; anything else sounds as
// played. A chord button's notes sound one by one as they come, then the chord's song notes take
// over once they make it.
function bassPress(part: Part, note: number): void {
  if (!ui.practiceBass.checked) return;
  const follow = followBass();
  if (follow) startSound();
  if (part === 'bass') {
    const result = waiter.press(waited(), transport, t => bassJudge.onBass(note, t));
    if (!follow) return;
    const taken = result === 'hit' && bassJudge.lastHit ? takeOver(bassJudge.lastHit) : [];
    holdKey(part, note, taken.length ? taken : [playFree(part, note)]);
    return;
  }
  if (follow) holdKey(part, note, [playFree(part, note)]);
  const chord = bassLayout.forChord(midi.held.chord.keys());
  if (!chord) return;
  const result = waiter.press(waited(), transport, t => bassJudge.onChord(chord.row, chord.root, t));
  if (!follow || result !== 'hit' || !bassJudge.lastHit) return;
  // The keys' own sounds go first. They can share pitch and channel with the chord's song notes,
  // and stopping them stops those too, so the song notes start again.
  const keys = [...midi.held.chord.keys()];
  for (const k of keys) releaseKey(part, k);
  const taken = takeOver(bassJudge.lastHit, true);
  for (const k of keys) holdKey(part, k, taken.length ? taken : [playFree(part, k)]);
}

midi.onNoteOn = (part, note) => {
  if (part === 'right') {
    beatSwing.mark(transport.time - latency() * transport.rate, song?.beats ?? []);
    judgePress(note);
  } else {
    bassPress(part, note);
  }
  drawStage();
};

function judgePress(note: number): void {
  const waitMode = ui.practiceRight.checked;
  const wasWaiting = transport.waiting;
  const result = waitMode
    ? waiter.press(waited(), transport, t => judge.strike(note, t))
    : judge.onNoteOn(note, transport.time - latency() * transport.rate, transport.rate);
  stage.flash(note, result);
  if (waitMode && result === 'hit' && judge.lastHit !== null) hitKeys.set(note, judge.lastHit);
  if (waitMode && followInput()) {
    // Key velocity is ignored, like the bellows: a hit sounds at its written velocity, any
    // other press at a fixed one.
    startSound();
    const hit = result === 'hit' ? judge.lastHit : null;
    const taken = hit !== null && treble.claim(hit);
    if (hit === null) {
      holdKey('right', note, [playFree('right', note)]);
      return;
    }
    const r = route('right', treble.notes[hit].track);
    if (!taken) r.sink.noteOn(note, treble.notes[hit].velocity, r.channel);
    holdKey('right', note, [{ route: r, note }]);
    return;
  }
  // A chord the clock is waiting for stays quiet until it's played right, then each note sounds
  // for its written length. (Within the hit window notes already sound on arrival.)
  if (result === 'hit' && waitMode && wasWaiting && judge.lastHit !== null) {
    startSound();
    treble.play(treble.notes[judge.lastHit]);
  }
}
midi.onPortsChanged = refreshPorts;
refreshPorts();
void midi.init().then(refreshPorts);
// The voice lists fill once the SoundFont is in.
engine.ready.then(renderTracks, e => showError(new Error(`${tr('soundFailed')}: ${e}`)));

// ---------- frame loop ----------

// Draws the board for the current state. Called every frame, and straight away on instrument
// input so a key press shows up without waiting for the next frame.
function drawStage(): void {
  stage.draw({
    time: transport.time,
    notes: treble.notes,
    bassNotes: bass.notes,
    judge,
    lookahead: 4,
    loop,
    bars: song?.bars ?? [],
    beats: song?.beats ?? [],
    firstBar: song?.firstBar ?? 1,
    cut: options?.cut ?? null,
    letGo,
    practice: ui.practiceRight.checked,
    rate: transport.rate,
    noteNames: ui.noteNames.checked,
    bassChromatic: ui.bassChromatic.checked,
    held: midi.held.right,
    bassHeld: midi.held.bass,
    chordHeld: midi.held.chord,
    pressure: midi.expression,
    showHelpers: ui.helpers.checked,
    showUpcoming: ui.upcoming.checked,
    mirror: ui.mirror.checked,
    mirrorX: ui.mirrorX.checked,
    rowGap: Number(ui.rowGap.value),
  });
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// An error in one frame mustn't stop the loop (playback and drawing would freeze for good): the
// next frame is asked for first, and the error is shown so it can be reported.
function frame(now: number): void {
  requestAnimationFrame(frame);
  try {
    step(now);
  } catch (e) {
    showError(e);
  }
}

const errorBox = $('error');
errorBox.onclick = () => (errorBox.hidden = true);
function showError(e: unknown): void {
  const text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  if (errorBox.textContent === text && !errorBox.hidden) return;
  console.error(e);
  errorBox.textContent = text;
  errorBox.hidden = false;
}

function step(now: number): void {
  const waitMode = practicing();
  if (waitMode) {
    // A chord missed or played wrong falls silent, bass included, and both parts play on from it
    // once it's played right.
    if (waiter.tick(waited(), transport, now)) {
      treble.release();
      treble.seek(transport.time);
      bass.release();
      bass.seek(transport.time);
      others.release();
      others.seek(transport.time);
    }
  } else {
    transport.hold = null;
    transport.tick(now);
  }
  if (transport.playing) {
    if (loop && transport.time >= loop.b) {
      seek(loop.a);
    } else if (transport.time >= transport.duration) {
      transport.time = transport.duration;
      transport.pause();
      silence();
      showPlayState();
    }
  }
  const t = transport.time;
  clickBeats(t);
  beatSwing.update(t, song?.beats ?? []);

  // Right-hand notes sound on arrival, except while wait mode holds the clock for a missed chord
  // (see judgePress). The bass and the tracks playing along aren't judged; they stand still while the clock waits and come in
  // with the chord once that's played.
  treble.update(t, transport.playing && !transport.waiting);
  if (!transport.waiting) {
    bass.update(t, transport.playing);
    others.update(t, transport.playing);
  }

  drawStage();

  if (!draggingSeek && transport.duration > 0) {
    ui.seek.value = String(Math.round((t / transport.duration) * 1000));
  }
  ui.time.textContent = `${fmt(t)} / ${fmt(transport.duration)}${transport.waiting ? ` · ${tr('waiting')}` : ''}`;
  ui.lastCh.textContent = midi.lastChannel ? tr('lastChannel', { ch: midi.lastChannel }) : '';
}
requestAnimationFrame(frame);

// Dev helper: simulate the instrument from the console, e.g. app.press(60) / app.release(60).
if (import.meta.env.DEV) {
  Object.assign(window, {
    app: {
      press: (note: number, channel = 1) => midi.simulate(note, true, channel),
      release: (note: number, channel = 1) => midi.simulate(note, false, channel),
      transport,
      judge: () => judge,
      sounding: () => ({ treble: treble.soundingNotes, bass: bass.soundingNotes }),
      voices: () => Object.fromEntries([...voices].map(([key, e]) => [key, e.voice.value])),
    },
  });
}

// On the web the app installs as a PWA and works offline (public/sw.js). Not in the desktop app
// (app://) or the dev server (http), where a cache would only get in the way.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
