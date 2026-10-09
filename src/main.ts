import './style.css';
import layoutJson from '../layouts/fr4xb-c-griff-europe.json';
import bassJson from '../layouts/fr4xb-stradella-2row.json';
import { BassLayout, type BassLayoutDef } from './core/bassLayout';
import { Layout, noteName, type LayoutDef } from './core/layout';
import { extractNotes, guessOptions, lowerBound, parseSong, type ExtractOptions, type Song, type SongNote } from './core/song';
import { demoSong } from './core/demo';
import { Transport } from './core/transport';
import { Judge } from './core/judge';
import { MidiIO } from './io/midi';
import { BUILTIN_SETS, MidiOutSink, SamplerSink, SynthSink, type NoteSink } from './io/audio';
import { userSampleSets } from './io/sampleSets';
import { Stage } from './view/stage';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  file: $<HTMLInputElement>('file'),
  demo: $<HTMLButtonElement>('demo'),
  songName: $('songName'),
  tracks: $('tracks'),
  split: $<HTMLSelectElement>('split'),
  topLine: $<HTMLInputElement>('topLine'),
  fit: $<HTMLInputElement>('fit'),
  play: $<HTMLButtonElement>('play'),
  seek: $<HTMLInputElement>('seek'),
  time: $('time'),
  rate: $<HTMLInputElement>('rate'),
  rateLabel: $('rateLabel'),
  loopA: $<HTMLButtonElement>('loopA'),
  loopB: $<HTMLButtonElement>('loopB'),
  loopClear: $<HTMLButtonElement>('loopClear'),
  mode: $<HTMLSelectElement>('mode'),
  sound: $<HTMLInputElement>('sound'),
  output: $<HTMLSelectElement>('output'),
  midiIn: $<HTMLSelectElement>('midiIn'),
  chRight: $<HTMLSelectElement>('chRight'),
  chBass: $<HTMLSelectElement>('chBass'),
  chChord: $<HTMLSelectElement>('chChord'),
  lastCh: $('lastCh'),
  helpers: $<HTMLInputElement>('helpers'),
  mirror: $<HTMLInputElement>('mirror'),
  mirrorX: $<HTMLInputElement>('mirrorX'),
  rowGap: $<HTMLInputElement>('rowGap'),
  rowGapLabel: $('rowGapLabel'),
};

const layout = new Layout(layoutJson as LayoutDef);
const transport = new Transport();
const midi = new MidiIO();
const synth = new SynthSink();
const sampler = new SamplerSink();
let sink: NoteSink = sampler;
const bassLayout = new BassLayout(bassJson as BassLayoutDef);
const stage = new Stage($<HTMLCanvasElement>('stage'), layout, bassLayout);

let song: Song | null = null;
let options: ExtractOptions | null = null;
let notes: SongNote[] = [];
let judge = new Judge([]);
let nextIdx = 0; // next song note to sound
const sounding = new Map<number, SongNote>();
let loopStart: number | null = null;
let loop: { a: number; b: number } | null = null;

// ---------- song ----------

function setSong(s: Song): void {
  song = s;
  options = guessOptions(s);
  ui.songName.textContent = s.name;
  ui.songName.classList.remove('muted');
  ui.split.value = options.splitNote === null ? '' : String(options.splitNote);
  ui.topLine.checked = options.topLineOnly;
  ui.fit.checked = options.fitToRange;
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

function rebuild(t = transport.time): void {
  if (!song || !options) return;
  notes = extractNotes(song, options, { min: layout.minNote, max: layout.maxNote });
  judge = new Judge(notes);
  transport.duration = song.duration;
  seek(t, true);
}

function seek(t: number, resetStats = false): void {
  transport.seek(t);
  silence();
  nextIdx = lowerBound(notes, transport.time);
  judge.resetFrom(transport.time, resetStats);
}

function silence(): void {
  sink.allOff();
  sounding.clear();
}

function renderTracks(): void {
  ui.tracks.replaceChildren();
  if (!song || !options) return;
  const opts = options;
  for (const t of song.tracks) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = opts.tracks.includes(t.index);
    cb.onchange = () => {
      opts.tracks = cb.checked ? [...opts.tracks, t.index] : opts.tracks.filter(i => i !== t.index);
      rebuild();
    };
    const info = document.createElement('small');
    info.textContent = `ch${t.channel} · ${t.noteCount}음 · ${noteName(t.minNote)}–${noteName(t.maxNote)}`;
    label.append(cb, t.name, info);
    ui.tracks.append(label);
  }
}

ui.split.append(new Option('없음', ''));
for (let n = 48; n <= 72; n++) ui.split.append(new Option(`${noteName(n)} 이상`, String(n)));
ui.split.onchange = () => {
  if (!options) return;
  options.splitNote = ui.split.value === '' ? null : Number(ui.split.value);
  rebuild();
};
ui.topLine.onchange = () => {
  if (!options) return;
  options.topLineOnly = ui.topLine.checked;
  rebuild();
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
ui.demo.onclick = () => setSong(demoSong());

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
    if (sink === synth) void synth.start();
    if (sink === sampler) void sampler.start();
    if (transport.time >= transport.duration) seek(loop?.a ?? 0);
    transport.play();
  }
  ui.play.textContent = transport.playing ? '❚❚' : '▶';
}

function clearLoop(): void {
  loopStart = null;
  loop = null;
  ui.loopA.classList.remove('active');
  ui.loopB.classList.remove('active');
}

ui.play.onclick = togglePlay;
ui.seek.oninput = () => seek((Number(ui.seek.value) / 1000) * transport.duration, true);
ui.rate.oninput = () => {
  transport.rate = Number(ui.rate.value);
  ui.rateLabel.textContent = `${Math.round(transport.rate * 100)}%`;
};
ui.loopA.onclick = () => {
  loopStart = transport.time;
  loop = null;
  ui.loopA.classList.add('active');
  ui.loopB.classList.remove('active');
};
ui.loopB.onclick = () => {
  if (loopStart === null || transport.time <= loopStart) return;
  loop = { a: loopStart, b: transport.time };
  ui.loopB.classList.add('active');
  seek(loop.a, true);
};
ui.loopClear.onclick = clearLoop;
ui.rowGap.oninput = () => {
  ui.rowGapLabel.textContent = Number(ui.rowGap.value).toFixed(2);
};

// Sidebar collapse, remembered across launches.
const collapseBtn = $<HTMLButtonElement>('collapse');
function setCollapsed(collapsed: boolean): void {
  document.body.classList.toggle('collapsed', collapsed);
  collapseBtn.textContent = collapsed ? '▶' : '◀';
  try {
    localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
  } catch {
    // Storage may be unavailable; the toggle still works for this session.
  }
}
collapseBtn.onclick = () => setCollapsed(!document.body.classList.contains('collapsed'));
try {
  setCollapsed(localStorage.getItem('sidebarCollapsed') === '1');
} catch {
  setCollapsed(false);
}

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
    seek(transport.time - 2);
  } else if (e.code === 'ArrowRight') {
    seek(transport.time + 2);
  } else if (e.code === 'Home') {
    seek(loop?.a ?? 0, true);
  }
});

// ---------- MIDI devices ----------

for (const [part, select] of [['right', ui.chRight], ['bass', ui.chBass], ['chord', ui.chChord]] as const) {
  for (let c = 1; c <= 16; c++) select.append(new Option(String(c), String(c)));
  select.value = String(midi.channels[part]);
  select.onchange = () => {
    midi.channels[part] = Number(select.value);
  };
}

function refreshPorts(): void {
  const inputs = midi.inputs();
  const current = midi.inputId;
  ui.midiIn.replaceChildren(new Option(midi.supported ? '없음' : '미지원 브라우저', ''));
  for (const p of inputs) ui.midiIn.append(new Option(p.name, p.id));
  // Keep the current input; otherwise prefer something that looks like the accordion.
  const pick = inputs.find(p => p.id === current) ?? inputs.find(p => /FR-?\d|roland/i.test(p.name)) ?? inputs[0];
  ui.midiIn.value = pick?.id ?? '';
  if ((pick?.id ?? null) !== current) midi.selectInput(pick?.id ?? null);

  const outValue = ui.output.value || defaultVoice;
  ui.output.replaceChildren();
  for (const s of sampleSets) ui.output.append(new Option(s.label, `set:${s.id}`));
  ui.output.append(new Option('신시', 'synth'));
  for (const p of midi.outputs()) ui.output.append(new Option(`MIDI: ${p.name}`, `midi:${p.id}`));
  ui.output.value = [...ui.output.options].some(o => o.value === outValue) ? outValue : defaultVoice;
}

// Sound choices: sample sets, the synth, or a MIDI output.
const sampleSets = [...userSampleSets(), ...BUILTIN_SETS];
const defaultVoice = `set:${sampleSets[0].id}`;

function selectVoice(value: string): void {
  silence();
  midi.selectOutput(null);
  if (value === 'synth') {
    sink = synth;
  } else if (value.startsWith('midi:')) {
    midi.selectOutput(value.slice(5));
    sink = new MidiOutSink(midi, midi.channels.right);
  } else {
    const set = sampleSets.find(s => `set:${s.id}` === value)!;
    sink = sampler;
    sampler.load(set).catch(e => alert(`음색을 불러오지 못했습니다: ${set.label}\n${e}`));
  }
}

ui.midiIn.onchange = () => midi.selectInput(ui.midiIn.value || null);
ui.output.onchange = () => selectVoice(ui.output.value);

midi.onNoteOn = (part, note) => {
  if (part === 'right') stage.flash(note, judge.onNoteOn(note, transport.time, transport.rate));
};
midi.onPortsChanged = refreshPorts;
refreshPorts();
selectVoice(ui.output.value);
void midi.init().then(refreshPorts);

// ---------- frame loop ----------

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function frame(now: number): void {
  const waitMode = ui.mode.value === 'wait';
  transport.hold = waitMode ? judge.nextPendingChordTime() : null;
  transport.tick(now);
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

  // Release ended notes before starting new ones, and only when no newer note of the same
  // pitch has taken over; otherwise back-to-back repeats would cut each other off.
  for (const [id, n] of sounding) {
    if (n.time + n.duration > t) continue;
    sounding.delete(id);
    if (![...sounding.values()].some(o => o.note === n.note)) sink.noteOff(n.note);
  }
  const sound = ui.sound.checked && transport.playing;
  while (nextIdx < notes.length && notes[nextIdx].time <= t) {
    const n = notes[nextIdx++];
    if (sound) {
      sink.noteOn(n.note, n.velocity);
      sounding.set(n.id, n);
    }
  }
  if (!waitMode && transport.playing) judge.update(t, transport.rate);

  stage.draw({
    time: t,
    notes,
    judge,
    lookahead: 4,
    loop,
    held: midi.held.right,
    bassHeld: midi.held.bass,
    chordHeld: midi.held.chord,
    pressure: midi.expression,
    showHelpers: ui.helpers.checked,
    mirror: ui.mirror.checked,
    mirrorX: ui.mirrorX.checked,
    rowGap: Number(ui.rowGap.value),
  });

  if (document.activeElement !== ui.seek && transport.duration > 0) {
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
    },
  });
}
