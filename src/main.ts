import './style.css';
import layoutJson from '../layouts/fr4xb-c-griff-europe.json';
import bassJson from '../layouts/fr4xb-stradella-2row.json';
import { BassLayout, type BassLayoutDef } from './core/bassLayout';
import { Layout, noteName, type LayoutDef } from './core/layout';
import { defaultOptions, extractBass, extractNotes, parseSong, type BassNote, type ExtractOptions, type Song, type SongNote } from './core/song';
import { Transport } from './core/transport';
import { Judge } from './core/judge';
import { WaitMode, pressInWaitMode } from './core/practice';
import { MidiIO } from './io/midi';
import { BUILTIN_SETS, setVolume, type SampleSet } from './io/audio';
import { PartPlayer } from './io/player';
import { userSampleSets } from './io/sampleSets';
import { PartVoice } from './io/voice';
import { getPref, persist, resetPrefs, setPref } from './io/prefs';
import type { Geometry } from './view/geometry';
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
  loopUnit: $<HTMLSelectElement>('loopUnit'),
  mode: $<HTMLSelectElement>('mode'),
  sound: $<HTMLInputElement>('sound'),
  bassSound: $<HTMLInputElement>('bassSound'),
  output: $<HTMLSelectElement>('output'),
  bassOutput: $<HTMLSelectElement>('bassOutput'),
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
  upcoming: $<HTMLInputElement>('upcoming'),
  thru: $<HTMLInputElement>('thru'),
  volume: $<HTMLInputElement>('volume'),
  volumeLabel: $('volumeLabel'),
  rowGapLabel: $('rowGapLabel'),
};

const layout = new Layout(layoutJson as LayoutDef);
const transport = new Transport();
const midi = new MidiIO();
const trebleVoice = new PartVoice(midi, () => [midi.channels.right]);
const bassVoice = new PartVoice(midi, () => [midi.channels.bass, midi.channels.chord]);
const bassLayout = new BassLayout(bassJson as BassLayoutDef);
const canvas = $<HTMLCanvasElement>('stage');
const stage = new Stage(canvas, layout, bassLayout);

let song: Song | null = null;
let options: ExtractOptions | null = null;
const treble = new PartPlayer(() => midi.channels.right);
const bass = new PartPlayer<BassNote>(n => (n.chord ? midi.channels.chord : midi.channels.bass));
let judge = new Judge([]);
const waiter = new WaitMode();
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
  treble.notes = extractNotes(song, options, { min: layout.minNote, max: layout.maxNote });
  bass.notes = extractBass(song, options, { min: layout.minNote, max: layout.maxNote });
  songRange = rangeFor(treble.notes);
  judge = new Judge(treble.notes, n => layout.primary(n) !== undefined);
  judge.windowSec = hitWindow();
  transport.duration = song.duration;
  seek(t, true);
}

function seek(t: number, resetStats = false): void {
  transport.seek(t);
  silence();
  treble.seek(transport.time);
  bass.seek(transport.time);
  judge.resetFrom(transport.time, resetStats);
  waiter.reset();
}

function silence(): void {
  trebleVoice.sink.allOff();
  bassVoice.sink.allOff();
  treble.stop();
  bass.stop();
}

// One row per track with a checkbox for each part.
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
    row.append(name, pick('tracks', '오른손'), pick('bassTracks', '베이스'));
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
$<HTMLButtonElement>('resetPrefs').onclick = () => {
  if (!confirm('저장된 설정을 모두 지우고 기본값으로 다시 시작할까요?')) return;
  resetPrefs();
  location.reload();
};
ui.settingsBtn.onclick = () => {
  ui.settings.hidden = !ui.settings.hidden;
  ui.settingsBtn.classList.toggle('active', !ui.settings.hidden);
};
ui.fit.onchange = () => {
  if (!options) return;
  options.fitToRange = ui.fit.checked;
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
  ui.play.textContent = transport.playing ? '❚❚' : '▶';
}

// Audio needs a user gesture to start; play and key presses both count.
function startSound(): void {
  trebleVoice.start();
  bassVoice.start();
}

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
// Loop points snap to the bar or beat grid: A to the start of the unit it's in, B to its end.
function loopGrid(): number[] {
  return (ui.loopUnit.value === 'beat' ? song?.beats : song?.bars) ?? [];
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
function applyVolume(): void {
  setVolume(Number(ui.volume.value));
  trebleVoice.setLevel(Number(ui.volume.value));
  bassVoice.setLevel(Number(ui.volume.value));
  ui.volumeLabel.textContent = `${Math.round(Number(ui.volume.value) * 100)}%`;
}
ui.volume.oninput = applyVolume;
// Hit window, ms on the slider, seconds in the judge.
function hitWindow(): number {
  return Number(ui.hitWindow.value) / 1000;
}
function applyHitWindow(): void {
  judge.windowSec = hitWindow();
  ui.hitWindowLabel.textContent = `${ui.hitWindow.value}ms`;
}
ui.hitWindow.oninput = applyHitWindow;

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
// The Electron shell calls this before closing so the messages get out before the process exits.
Object.assign(window, { accordionShutdown: shutdown });

// Background tabs stop requestAnimationFrame, so note-offs would never fire.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && transport.playing) togglePlay();
});

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

  fillVoices(ui.output, 'output', trebleVoice, 'treble');
  fillVoices(ui.bassOutput, 'bassOutput', bassVoice, 'bass');
}

// Sound choices for each part: sample sets, the synth, or a MIDI output. User sample sets
// arrive asynchronously (read from disk); built-in sets until then.
let sampleSets: SampleSet[] = [...BUILTIN_SETS];

// A part's default: the first set meant for it, else the first set.
function defaultVoice(part: 'treble' | 'bass'): string {
  return `set:${(sampleSets.find(s => (s.part ?? 'treble') === part) ?? sampleSets[0]).id}`;
}

function fillVoices(select: HTMLSelectElement, key: string, voice: PartVoice, part: 'treble' | 'bass'): void {
  const saved = getPref(key);
  const want = select.value || (typeof saved === 'string' ? saved : defaultVoice(part));
  select.replaceChildren();
  for (const s of sampleSets) select.append(new Option(s.label, `set:${s.id}`));
  select.append(new Option('신시', 'synth'));
  for (const p of midi.outputs()) select.append(new Option(`MIDI: ${p.name}`, `midi:${p.id}`));
  select.value = [...select.options].some(o => o.value === want) ? want : defaultVoice(part);
  // A saved MIDI output only appears once MIDI is ready; switch to it then.
  if (voice.value !== null && select.value !== voice.value) selectVoice(voice, select.value);
}

// Soft thru echoes the right hand to the right hand's MIDI output, so it only makes sense
// while that part plays on one.
function applyThru(): void {
  midi.selectOutput(trebleVoice.midiPort);
  midi.thru = ui.thru.checked && trebleVoice.midiPort !== null;
}
ui.thru.onchange = applyThru;

function selectVoice(voice: PartVoice, value: string): void {
  silence();
  voice.choose(value, sampleSets, Number(ui.volume.value)).catch(e => {
    const set = sampleSets.find(s => `set:${s.id}` === value);
    alert(`음색을 불러오지 못했습니다: ${set?.label ?? value}\n${e}`);
  });
  applyThru();
}

ui.midiIn.onchange = () => {
  midi.selectInput(ui.midiIn.value || null);
  setPref('midiIn', ui.midiIn.selectedOptions[0]?.text ?? '');
};
ui.output.onchange = () => {
  selectVoice(trebleVoice, ui.output.value);
  setPref('output', ui.output.value);
};
ui.bassOutput.onchange = () => {
  selectVoice(bassVoice, ui.bassOutput.value);
  setPref('bassOutput', ui.bassOutput.value);
};

// Restore the remembered settings (song-specific options are left out on purpose).
persist(ui.volume, 'volume', applyVolume);
persist(ui.rowGap, 'rowGap', applyRowGap);
persist(ui.hitWindow, 'hitWindow', applyHitWindow);
persist(ui.mode, 'mode');
persist(ui.loopUnit, 'loopUnit');
for (const [el, key] of [[ui.sound, 'sound'], [ui.bassSound, 'bassSound'], [ui.helpers, 'helpers'], [ui.fitRange, 'fitRange'], [ui.upcoming, 'upcoming'], [ui.thru, 'thru'], [ui.mirror, 'mirror'], [ui.mirrorX, 'mirrorX'], [ui.noteNames, 'noteNames'], [ui.bassChromatic, 'bassChromatic']] as const) {
  persist(el, key);
}

midi.onNoteOff = () => drawStage();
midi.onNoteOn = (part, note) => {
  if (part === 'right') judgePress(note);
  drawStage();
};

function judgePress(note: number): void {
  const waitMode = ui.mode.value === 'wait';
  const result = waitMode
    ? pressInWaitMode(judge, transport, note)
    : judge.onNoteOn(note, transport.time, transport.rate);
  stage.flash(note, result);
  // Wait mode stays quiet until a note is played right, then sounds it for its written length.
  if (result === 'hit' && waitMode && ui.sound.checked && judge.lastHit !== null) {
    startSound();
    treble.play(trebleVoice.sink, treble.notes[judge.lastHit]);
  }
}
midi.onPortsChanged = refreshPorts;
// Pick the voice only once the user's sample sets are known, so a saved voice can be restored
// (and the online GM set isn't fetched for nothing).
void userSampleSets().then(list => {
  sampleSets = [...list, ...BUILTIN_SETS];
  refreshPorts();
  selectVoice(trebleVoice, ui.output.value);
  selectVoice(bassVoice, ui.bassOutput.value);
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

function frame(now: number): void {
  const waitMode = ui.mode.value === 'wait';
  if (waitMode) {
    waiter.tick(judge, transport, now);
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

  // In wait mode right-hand notes sound when they're played right (see judgePress), not on
  // arrival. The bass isn't judged, so it plays along either way.
  treble.update(trebleVoice.sink, t, ui.sound.checked && transport.playing && !waitMode);
  bass.update(bassVoice.sink, t, ui.bassSound.checked && transport.playing);
  if (!waitMode && transport.playing) judge.update(t, transport.rate);

  drawStage();

  if (!draggingSeek && transport.duration > 0) {
    ui.seek.value = String(Math.round((t / transport.duration) * 1000));
  }
  ui.time.textContent = `${fmt(t)} / ${fmt(transport.duration)}${transport.waiting ? ' · 대기 중' : ''}`;
  ui.lastCh.textContent = midi.lastChannel ? `최근 입력 ch${midi.lastChannel}` : '';
  requestAnimationFrame(frame);
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
    },
  });
}
