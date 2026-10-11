import './style.css';
import layoutJson from '../layouts/fr4xb-c-griff-europe.json';
import bassJson from '../layouts/fr4xb-stradella-2row.json';
import { BassLayout, type BassLayoutDef } from './core/bassLayout';
import { Layout, noteName, type LayoutDef } from './core/layout';
import { defaultOptions, extractBass, extractNotes, extractOthers, parseSong, type BassNote, type ExtractOptions, type Song, type SongNote } from './core/song';
import { Transport } from './core/transport';
import { Judge } from './core/judge';
import { WaitMode, pressInWaitMode, type Waited } from './core/practice';
import { BassJudge } from './core/bassJudge';
import { MidiIO, type Part } from './io/midi';
import { BUILTIN_SETS, type SampleSet } from './io/audio';
import { PartPlayer, type Route } from './io/player';
import { userSampleSets } from './io/sampleSets';
import { PartVoice } from './io/voice';
import { getPref, persist, resetPrefs, setPref } from './io/prefs';
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
  topLine: $<HTMLInputElement>('topLine'),
  fit: $<HTMLInputElement>('fit'),
  transpose: $<HTMLSelectElement>('transpose'),
  settingsBtn: $<HTMLButtonElement>('settingsBtn'),
  settings: $('settings'),
  play: $<HTMLButtonElement>('play'),
  seek: $<HTMLInputElement>('seek'),
  time: $('time'),
  rate: $<HTMLInputElement>('rate'),
  rateLabel: $('rateLabel'),
  loopA: $<HTMLButtonElement>('loopA'),
  loopB: $<HTMLButtonElement>('loopB'),
  loopClear: $<HTMLButtonElement>('loopClear'),
  practice: $<HTMLInputElement>('practice'), // practice (wait) mode; play mode when off
  midiIn: $<HTMLSelectElement>('midiIn'),
  chRight: $<HTMLSelectElement>('chRight'),
  chBass: $<HTMLSelectElement>('chBass'),
  chChord: $<HTMLSelectElement>('chChord'),
  lastCh: $('lastCh'),
  helpers: $<HTMLInputElement>('helpers'),
  mirror: $<HTMLInputElement>('mirror'),
  mirrorX: $<HTMLInputElement>('mirrorX'),
  noteNames: $<HTMLInputElement>('noteNames'),
  bassChromatic: $<HTMLInputElement>('bassChromatic'),
  rowGap: $<HTMLInputElement>('rowGap'),
  fitRange: $<HTMLInputElement>('fitRange'),
  hitWindow: $<HTMLInputElement>('hitWindow'),
  hitWindowLabel: $('hitWindowLabel'),
  latency: $<HTMLInputElement>('latency'),
  latencyLabel: $('latencyLabel'),
  upcoming: $<HTMLInputElement>('upcoming'),
  followInput: $<HTMLInputElement>('followInput'),
  waitBass: $<HTMLInputElement>('waitBass'),
  metronome: $<HTMLInputElement>('metronome'),
  metronomeUnit: $<HTMLSelectElement>('metronomeUnit'),
  rowGapLabel: $('rowGapLabel'),
};

const layout = new Layout(layoutJson as LayoutDef);
const keyRange = { min: layout.minNote, max: layout.maxNote };
const transport = new Transport();
const midi = new MidiIO();
const bassLayout = new BassLayout(bassJson as BassLayoutDef);
const canvas = $<HTMLCanvasElement>('stage');
const stage = new Stage(canvas, layout, bassLayout);

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
const inputHeld = new Map<number, Route>(); // right-hand pitches sounding from the player's keys (see followInput)
const AUTO = 'auto';
let sampleSets: SampleSet[] = [...BUILTIN_SETS];
const trackVoices = new Map<number, string>(); // track index -> voice, for the current song
const trackVolumes = new Map<number, number>(); // track index -> volume 0..1, for the current song
const DEFAULT_VOLUME = 0.8;
// A voice per part and track: the part sets the MIDI channel, the track the sound and volume.
// Track -1 is the player's own presses that match no song note.
const voices = new Map<string, { part: VoicePart; track: number; voice: PartVoice }>();
const FREE_VELOCITY = 0.8; // for presses that don't match a song note
// Wait mode: a hit note whose key is let go before the note ends goes back to its unplayed
// colour (the hit still counts).
const hitKeys = new Map<number, number>(); // right-hand pitch -> id of the note its press hit
const letGo = new Set<number>();
let loopStart: number | null = null;
let loop: { a: number; b: number } | null = null;
let songRange: { lo: number; hi: number } | null = null;

const RANGE_MARGIN = 2; // semitones shown beyond the song's lowest and highest notes
const RANGE_MIN = 30; // never zoom in to less than two and a half octaves

// Treble range to show when "song range only" is on: the song's notes plus a margin,
// widened to RANGE_MIN and kept inside the keyboard.
function rangeFor(list: SongNote[]): { lo: number; hi: number } | null {
  // Notes the keyboard can't play (possible with range fitting off) aren't shown, so ignore them.
  const playable = list.filter(n => layout.primary(n.note)).map(n => n.note);
  if (playable.length === 0) return null;
  let lo = Math.min(...playable) - RANGE_MARGIN;
  let hi = Math.max(...playable) + RANGE_MARGIN;
  const grow = Math.max(0, RANGE_MIN - (hi - lo));
  lo -= Math.floor(grow / 2);
  hi += Math.ceil(grow / 2);
  if (lo < layout.minNote) [lo, hi] = [layout.minNote, hi + layout.minNote - lo];
  if (hi > layout.maxNote) [lo, hi] = [lo - (hi - layout.maxNote), layout.maxNote];
  return { lo: Math.max(lo, layout.minNote), hi: Math.min(hi, layout.maxNote) };
}

// ---------- song ----------

function setSong(s: Song): void {
  song = s;
  options = defaultOptions();
  trackVoices.clear();
  trackVolumes.clear();
  ui.songName.textContent = s.name;
  ui.songName.classList.remove('muted');
  ui.topLine.checked = options.topLineOnly;
  ui.fit.checked = options.fitToRange;
  ui.transpose.value = String(options.transpose);
  transport.pause();
  clearLoop();
  renderTracks();
  rebuild(0);
}

async function loadFile(file: File): Promise<void> {
  try {
    setSong(parseSong(await file.arrayBuffer(), file.name));
  } catch (e) {
    alert(`MIDI 파일을 읽지 못했습니다.\n${e}`);
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
  treble.notes = extractNotes(song, options, keyRange);
  bass.notes = extractBass(song, options, keyRange);
  others.notes = extractOthers(song, options);
  songRange = rangeFor(treble.notes);
  judge = new Judge(treble.notes, n => layout.primary(n) !== undefined);
  judge.windowSec = hitWindow();
  bassJudge = new BassJudge(bass.notes, bassLayout);
  bassJudge.windowSec = hitWindow();
  transport.duration = song.duration;
  makeClicks();
  seek(t, true);
}

function seek(t: number, resetStats = false): void {
  transport.seek(t);
  silence();
  treble.seek(transport.time);
  bass.seek(transport.time);
  others.seek(transport.time);
  judge.resetFrom(transport.time, resetStats);
  bassJudge.resetFrom(transport.time);
  waiter.reset();
  hitKeys.clear();
  letGo.clear();
}

function silence(): void {
  inputHeld.clear();
  for (const { voice } of voices.values()) voice.sink.allOff();
  treble.stop();
  bass.stop();
  others.stop();
}

// One row per track: its voice, its volume and a checkbox for each part.
function renderTracks(): void {
  ui.trackRows.replaceChildren();
  if (!song || !options) return;
  const opts = options;
  for (const t of song.tracks) {
    const row = document.createElement('div');
    row.className = 'track-row';
    row.title = `${t.name}\nch${t.channel} · ${t.noteCount}음 · ${noteName(t.minNote)}–${noteName(t.maxNote)}`;
    const name = document.createElement('span');
    name.className = 'track-name';
    const ch = document.createElement('small');
    ch.textContent = ` ch${t.channel}`;
    name.append(t.name, ch);
    const pick = (part: 'tracks' | 'bassTracks', title: string) => {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.title = title;
      cb.checked = opts[part].includes(t.index);
      cb.onchange = () => {
        opts[part] = cb.checked ? [...opts[part], t.index] : opts[part].filter(i => i !== t.index);
        rebuild();
      };
      return cb;
    };
    const voice = document.createElement('select');
    voice.title = '이 트랙의 음색';
    fillVoiceOptions(voice);
    voice.value = trackVoices.get(t.index) ?? AUTO;
    if (voice.selectedIndex < 0) voice.value = AUTO; // a MIDI output that isn't connected now
    voice.onchange = () => {
      trackVoices.set(t.index, voice.value);
      syncVoices();
    };
    const volume = document.createElement('input');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '1';
    volume.step = '0.05';
    volume.value = String(volumeOf(t.index));
    const volumeTitle = () => `볼륨 ${Math.round(Number(volume.value) * 100)}%`;
    volume.title = volumeTitle();
    volume.oninput = () => {
      trackVolumes.set(t.index, Number(volume.value));
      volume.title = volumeTitle();
      applyVolumes();
    };
    row.append(name, voice, volume, pick('tracks', '오른손'), pick('bassTracks', '베이스'));
    ui.trackRows.append(row);
  }
}

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
canvas.addEventListener('click', e => cutAt(e, false));
canvas.addEventListener('contextmenu', e => cutAt(e, true));
canvas.addEventListener('mousemove', e => {
  canvas.style.cursor = song && stage.laneAt(e.offsetX, e.offsetY) !== null ? 'pointer' : '';
});
ui.topLine.onchange = () => {
  if (!options) return;
  options.topLineOnly = ui.topLine.checked;
  rebuild();
};
for (let t = -12; t <= 12; t++) ui.transpose.append(new Option(t > 0 ? `+${t}` : String(t), String(t)));
ui.transpose.value = '0';
ui.transpose.onchange = () => {
  if (!options) return;
  options.transpose = Number(ui.transpose.value);
  rebuild();
};
ui.fit.onchange = () => {
  if (!options) return;
  options.fitToRange = ui.fit.checked;
  rebuild();
};

$<HTMLButtonElement>('resetPrefs').onclick = () => {
  if (!confirm('저장된 설정을 모두 지우고 기본값으로 다시 시작할까요?')) return;
  resetPrefs();
  location.reload();
};
ui.settingsBtn.onclick = () => {
  ui.settings.hidden = !ui.settings.hidden;
  ui.settingsBtn.classList.toggle('active', !ui.settings.hidden);
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
  ui.play.textContent = transport.playing ? '❚❚' : '▶';
}

// Audio needs a user gesture to start; play and key presses both count.
function startSound(): void {
  for (const { voice } of voices.values()) voice.start();
  metronome.start();
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
ui.metronome.addEventListener('input', () => metronome.start());
ui.metronomeUnit.addEventListener('change', makeClicks);

function clearLoop(): void {
  loopStart = null;
  loop = null;
  ui.loopA.classList.remove('active');
  ui.loopB.classList.remove('active');
}

ui.play.onclick = togglePlay;
ui.seek.oninput = () => seek((Number(ui.seek.value) / 1000) * transport.duration, true);
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
  ui.rateLabel.textContent = `${Math.round(transport.rate * 100)}%`;
};
// Loop points snap to bars: A to the start of the bar it's in, B to the end of its bar.
function loopGrid(): number[] {
  return song?.bars ?? [];
}

ui.loopA.onclick = () => {
  const grid = loopGrid();
  loopStart = grid.filter(g => g <= transport.time + 1e-3).pop() ?? transport.time;
  loop = null;
  ui.loopA.classList.add('active');
  ui.loopB.classList.remove('active');
};
ui.loopB.onclick = () => {
  if (loopStart === null) return;
  const start = loopStart;
  const end = loopGrid().find(g => g > Math.max(transport.time, start) + 1e-3) ?? transport.duration;
  if (end <= start) return;
  loop = { a: start, b: end };
  ui.loopB.classList.add('active');
  seek(loop.a, true);
};
ui.loopClear.onclick = clearLoop;
// Each track has its own volume, in whichever part its notes play.
function volumeOf(track: number): number {
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
  bassJudge.windowSec = hitWindow();
  ui.hitWindowLabel.textContent = `${ui.hitWindow.value}ms`;
}
ui.hitWindow.oninput = applyHitWindow;

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

// Toolbar collapse, remembered across launches.
const collapseBtn = $<HTMLButtonElement>('collapse');
function setCollapsed(collapsed: boolean): void {
  document.body.classList.toggle('collapsed', collapsed);
  collapseBtn.textContent = collapsed ? '▼' : '▲';
  setPref('toolbarCollapsed', collapsed);
}
collapseBtn.onclick = () => setCollapsed(!document.body.classList.contains('collapsed'));
setCollapsed(getPref('toolbarCollapsed') === true);

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

window.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault(); // a focused range input would also move itself
    seek(transport.time - 2);
  } else if (e.code === 'ArrowRight') {
    e.preventDefault();
    seek(transport.time + 2);
  } else if (e.code === 'Home') {
    seek(loop?.a ?? 0, true);
  }
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
  ui.midiIn.replaceChildren(new Option(midi.supported ? '없음' : '미지원 브라우저', ''));
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

// ---------- voices ----------

// Each track picks its own sound: a sample set, the synth, or a MIDI output. "Auto" is the default
// for the part the note plays in (the first set meant for the bass for the bass and chords, else
// the right hand's). User sample sets arrive asynchronously (read from disk); built-in sets until
// then. (State at the top.)
function defaultVoice(part: VoicePart): string {
  const want = part === 'bass' || part === 'chord' ? 'bass' : 'treble';
  return `set:${(sampleSets.find(s => (s.part ?? 'treble') === want) ?? sampleSets[0]).id}`;
}

function voiceChoices(): { label: string; value: string }[] {
  return [
    ...sampleSets.map(s => ({ label: s.label, value: `set:${s.id}` })),
    { label: '신시', value: 'synth' },
    ...midi.outputs().map(p => ({ label: `MIDI: ${p.name}`, value: `midi:${p.id}` })),
  ];
}

function fillVoiceOptions(select: HTMLSelectElement): void {
  select.append(new Option('자동', AUTO));
  for (const c of voiceChoices()) select.append(new Option(c.label, c.value));
}

// What a part of a track should sound with; a choice that's gone (an unplugged MIDI output) falls
// back to the default.
function wantedVoice(part: VoicePart, track: number): string {
  const v = trackVoices.get(track);
  return v && v !== AUTO && voiceChoices().some(c => c.value === v) ? v : defaultVoice(part);
}

function chooseVoice(voice: PartVoice, value: string, track: number): void {
  voice.choose(value, sampleSets, volumeOf(track)).catch(e => {
    const set = sampleSets.find(s => `set:${s.id}` === value);
    alert(`음색을 불러오지 못했습니다: ${set?.label ?? value}\n${e}`);
  });
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
    entry.voice.setVolume(volumeOf(track));
    voices.set(key, entry);
  }
  const want = wantedVoice(part, track);
  if (entry.voice.value !== want) chooseVoice(entry.voice, want, track);
  return entry.voice;
}

function route(part: VoicePart, track: number): Route {
  return { sink: voiceOf(part, track).sink, channel: channelOf(part, track) };
}

// The player's own right-hand presses that match no note sound like the first right-hand track.
function freeRoute(): Route {
  return route('right', options?.tracks[0] ?? -1);
}

// Brings every voice in use up to its track's choice, silencing first if any changes.
function syncVoices(): void {
  const stale = [...voices.values()].filter(e => e.voice.value !== wantedVoice(e.part, e.track));
  if (stale.length === 0) return;
  silence();
  for (const e of stale) chooseVoice(e.voice, wantedVoice(e.part, e.track), e.track);
}

ui.midiIn.onchange = () => {
  midi.selectInput(ui.midiIn.value || null);
  setPref('midiIn', ui.midiIn.selectedOptions[0]?.text ?? '');
};

// Restore the remembered settings (song-specific options are left out on purpose).
persist(ui.rowGap, 'rowGap', applyRowGap);
persist(ui.hitWindow, 'hitWindow', applyHitWindow);
persist(ui.latency, 'latency', applyLatency);
persist(ui.metronome, 'metronomeLevel');
persist(ui.metronomeUnit, 'metronomeUnit', makeClicks);
for (const [el, key] of [[ui.helpers, 'helpers'], [ui.fitRange, 'fitRange'], [ui.upcoming, 'upcoming'], [ui.followInput, 'followInput'], [ui.practice, 'practice'], [ui.waitBass, 'waitBass'], [ui.mirror, 'mirror'], [ui.mirrorX, 'mirrorX'], [ui.noteNames, 'noteNames'], [ui.bassChromatic, 'bassChromatic']] as const) {
  persist(el, key);
}

// The options that only apply in practice mode fade out without it.
function applyPractice(): void {
  const on = ui.practice.checked;
  for (const el of document.querySelectorAll<HTMLElement>('.practice-only')) el.classList.toggle('off', !on);
  ui.waitBass.disabled = ui.hitWindow.disabled = !on;
}
ui.practice.addEventListener('change', applyPractice);
applyPractice();

// "Play by my keys" (wait mode, right hand): the sound follows the player's keys instead of the
// written notes. A note still starts on arrival, to cover the input delay, and holds through its
// hit window; a press that hits it takes it over (or starts it, if it hasn't arrived yet), and
// any other press sounds as played. Either way it stops when the key is released.
function followInput(): boolean {
  return ui.practice.checked && ui.followInput.checked;
}
treble.endOf = n => {
  const written = n.time + n.duration;
  if (!followInput() || judge.state[n.id] !== 'pending') return written;
  return Math.max(written, n.time + (judge.windowSec + latency()) * transport.rate);
};
ui.followInput.addEventListener('change', silence);

midi.onNoteOff = (part, note) => {
  const held = part === 'right' ? inputHeld.get(note) : undefined;
  if (held) {
    inputHeld.delete(note);
    held.sink.noteOff(note, held.channel);
  }
  const id = part === 'right' ? hitKeys.get(note) : undefined;
  if (id !== undefined) {
    hitKeys.delete(note);
    const n = treble.notes[id];
    if (ui.practice.checked && transport.time < n.time + n.duration) letGo.add(id);
  }
  drawStage();
};
// The beat swing beside the metronome switch; a right-hand press is marked where the dot was when
// it was played (the input delay before it arrived taken off).
const beatSwing = new BeatSwing($('beatSwing'));

// What wait mode waits for: the right hand, and the bass too unless that's switched off.
function waited(): Waited[] {
  return ui.waitBass.checked ? [judge, bassJudge] : [judge];
}
// Switched on mid-song, the bass already passed mustn't pull the clock back.
ui.waitBass.addEventListener('change', () => bassJudge.resetFrom(transport.time));

// A bass or chord button in wait mode. A chord button sends its notes one by one; it counts once
// they make a chord.
function bassPress(part: Part, note: number): void {
  if (!ui.practice.checked || !ui.waitBass.checked) return;
  const rate = transport.rate;
  if (part === 'bass') {
    pressInWaitMode(waited(), transport, latency(), t => bassJudge.onBass(note, t, rate));
    return;
  }
  const chord = bassLayout.forChord(midi.held.chord.keys());
  if (chord) pressInWaitMode(waited(), transport, latency(), t => bassJudge.onChord(chord.row, chord.root, t, rate));
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
  const waitMode = ui.practice.checked;
  const wasWaiting = transport.waiting;
  const result = waitMode
    ? pressInWaitMode(waited(), transport, latency(), t => judge.onNoteOn(note, t, transport.rate))
    : judge.onNoteOn(note, transport.time - latency() * transport.rate, transport.rate);
  stage.flash(note, result);
  if (waitMode && result === 'hit' && judge.lastHit !== null) hitKeys.set(note, judge.lastHit);
  if (waitMode && followInput()) {
    // Key velocity is ignored, like the bellows: a hit sounds at its written velocity, any
    // other press at a fixed one.
    startSound();
    const hit = result === 'hit' ? judge.lastHit : null;
    const taken = hit !== null && treble.claim(hit);
    const r = hit !== null ? route('right', treble.notes[hit].track) : freeRoute();
    if (!taken) r.sink.noteOn(note, hit !== null ? treble.notes[hit].velocity : FREE_VELOCITY, r.channel);
    inputHeld.set(note, r);
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
// Pick the voice only once the user's sample sets are known, so a saved voice can be restored
// (and the online GM set isn't fetched for nothing).
void userSampleSets().then(list => {
  sampleSets = [...list, ...BUILTIN_SETS];
  refreshPorts();
  void midi.init().then(refreshPorts);
});

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
    range: ui.fitRange.checked ? songRange : null,
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
  const waitMode = ui.practice.checked;
  if (waitMode) {
    // A missed chord falls silent, bass included, and both parts play on from it once it's
    // played right.
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
      ui.play.textContent = '▶';
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
  // Notes count as missed only once a press played in time could no longer still be arriving.
  if (!waitMode && transport.playing) judge.update(t - latency() * transport.rate, transport.rate);

  drawStage();

  if (!draggingSeek && transport.duration > 0) {
    ui.seek.value = String(Math.round((t / transport.duration) * 1000));
  }
  ui.time.textContent = `${fmt(t)} / ${fmt(transport.duration)}${transport.waiting ? ' · 대기 중' : ''}`;
  ui.lastCh.textContent = midi.lastChannel ? `최근 입력 ch${midi.lastChannel}` : '';
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
