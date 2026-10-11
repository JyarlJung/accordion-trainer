import { Midi } from '@tonejs/midi';

export interface RawNote {
  note: number;
  time: number; // seconds
  duration: number;
  velocity: number; // 0..1
  track: number;
}

export interface SongNote extends RawNote {
  id: number; // index into the extracted note list
}

export interface TrackInfo {
  index: number;
  name: string;
  channel: number; // 1..16
  noteCount: number;
  minNote: number;
  maxNote: number;
}

export interface Song {
  name: string;
  duration: number;
  tracks: TrackInfo[];
  notes: RawNote[]; // all tracks, sorted by time then pitch (high first)
  bars: number[]; // start time of every bar, seconds
  beats: number[]; // start time of every beat, seconds
  firstBar: number; // MIDI bar number of bars[0] (bars before it may have been trimmed)
}

export interface Cut {
  note: number;
  toBass: boolean;
}

export interface ExtractOptions {
  tracks: number[]; // right hand
  bassTracks: number[];
  // Treble lanes cut away from the right hand: notes at or below `note` (as shown, after
  // transposing and range fitting). With `toBass` they go to the bass part instead.
  cut: Cut | null;
  topLineOnly: boolean;
  fitToRange: boolean;
  transpose: number; // semitones, applied before fitting to the range
}

// Notes starting within this window are treated as one chord.
export const CHORD_EPS = 0.03;

function sortNotes<T extends RawNote>(notes: T[]): T[] {
  return notes.sort((a, b) => a.time - b.time || b.note - a.note);
}

function trackInfo(index: number, name: string, channel: number, notes: RawNote[]): TrackInfo {
  let min = 127, max = 0;
  for (const n of notes) {
    min = Math.min(min, n.note);
    max = Math.max(max, n.note);
  }
  return { index, name, channel, noteCount: notes.length, minNote: min, maxNote: max };
}

// MIDI text is raw bytes, which the parser maps one per character (Latin-1). Re-read them as
// UTF-8, or failing that as CP949, which Korean MIDI tools often write.
function decodeText(s: string): string {
  if (!/[\u0080-\u00ff]/.test(s) || /[^\u0000-\u00ff]/.test(s)) return s;
  const bytes = Uint8Array.from(s, c => c.charCodeAt(0));
  for (const encoding of ['utf-8', 'euc-kr']) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch {
      // not this encoding
    }
  }
  return s;
}

export function parseSong(data: ArrayBuffer, name: string): Song {
  const midi = new Midi(data);
  const tracks: TrackInfo[] = [];
  const notes: RawNote[] = [];
  midi.tracks.forEach((t, index) => {
    if (t.notes.length === 0) return;
    const own = t.notes.map(n => ({ note: n.midi, time: n.time, duration: n.duration, velocity: n.velocity, track: index }));
    notes.push(...own);
    tracks.push(trackInfo(index, decodeText(t.name).trim() || t.instrument.name || `트랙 ${index + 1}`, t.channel + 1, own));
  });
  const { firstBarEnd, ...grid } = beatGrid(midi);
  return fitLeadIn({ name, duration: midi.duration, tracks, notes: sortNotes(notes), firstBar: 1, ...grid }, firstBarEnd);
}

const MAX_LEAD_BARS = 2; // empty bars kept before the first note

// Many MIDI files start with long silence; keep at most MAX_LEAD_BARS empty bars of it. A song
// whose notes start in its very first bar gets one empty bar in front instead, so the first
// notes don't arrive the moment playback starts.
function fitLeadIn(song: Song, firstBarEnd: number): Song {
  if (song.notes.length === 0) return song;
  const first = song.notes[0].time;
  let firstNoteBar = 0;
  while (firstNoteBar + 1 < song.bars.length && song.bars[firstNoteBar + 1] <= first + 1e-6) firstNoteBar++;
  if (firstNoteBar === 0) return padLeadIn(song, firstBarEnd);
  const cut = firstNoteBar - MAX_LEAD_BARS;
  if (cut <= 0) return song;
  const offset = song.bars[cut];
  const shift = (t: number) => t - offset;
  return {
    ...song,
    duration: song.duration - offset,
    notes: song.notes.map(n => ({ ...n, time: shift(n.time) })),
    bars: song.bars.slice(cut).map(shift),
    beats: song.beats.filter(t => t >= offset - 1e-6).map(shift),
    firstBar: song.firstBar + cut,
  };
}

// Puts one empty bar, as long as the first one (which ends at firstBarEnd), in front of the
// song. It's numbered one less than the first bar.
function padLeadIn(song: Song, firstBarEnd: number): Song {
  const bar = firstBarEnd - song.bars[0];
  const shift = (t: number) => t + bar;
  return {
    ...song,
    duration: song.duration + bar,
    notes: song.notes.map(n => ({ ...n, time: shift(n.time) })),
    bars: [song.bars[0], ...song.bars.map(shift)],
    beats: [...song.beats.filter(t => t < firstBarEnd - 1e-6), ...song.beats.map(shift)],
    firstBar: song.firstBar - 1,
  };
}

// Bar and beat start times, following time-signature changes (tempo is handled by ticksToSeconds),
// and where the first bar ends (the grid itself stops at the song's last bar).
function beatGrid(midi: Midi): { bars: number[]; beats: number[]; firstBarEnd: number } {
  const ppq = midi.header.ppq;
  const sigs = midi.header.timeSignatures.length
    ? [...midi.header.timeSignatures].sort((a, b) => a.ticks - b.ticks)
    : [{ ticks: 0, timeSignature: [4, 4] }];
  const end = Math.max(midi.durationTicks, ppq);
  const bars: number[] = [];
  const beats: number[] = [];
  let tick = 0;
  let i = 0;
  let firstBarEnd = 0;
  while (tick <= end) {
    while (i + 1 < sigs.length && sigs[i + 1].ticks <= tick) i++;
    const [num, den] = sigs[i].timeSignature;
    const beatTicks = (ppq * 4) / den;
    bars.push(midi.header.ticksToSeconds(tick));
    for (let b = 0; b < num; b++) beats.push(midi.header.ticksToSeconds(tick + b * beatTicks));
    tick += beatTicks * num;
    if (bars.length === 1) firstBarEnd = midi.header.ticksToSeconds(tick);
  }
  return { bars, beats, firstBarEnd };
}

// Tracks start unassigned and nothing is cut: the player sets up each part.
export function defaultOptions(): ExtractOptions {
  return { tracks: [], bassTracks: [], cut: null, topLineOnly: false, fitToRange: true, transpose: 0 };
}

type Range = { min: number; max: number };

// Where a note of the right hand shows: transposed, and moved by octaves into the keyboard's range.
function treblePitch(n: RawNote, opts: ExtractOptions, range: Range): number {
  let note = n.note + opts.transpose;
  if (opts.fitToRange) {
    while (note < range.min) note += 12;
    while (note > range.max) note -= 12;
  }
  return note;
}

function isCut(n: RawNote, opts: ExtractOptions, range: Range): boolean {
  return opts.cut !== null && treblePitch(n, opts, range) <= opts.cut.note;
}

// Groups of notes starting together, each sorted from low to high.
function onsetGroups(notes: RawNote[]): RawNote[][] {
  const groups: RawNote[][] = [];
  let groupTime = -Infinity;
  for (const n of notes) {
    if (n.time - groupTime < CHORD_EPS) {
      groups[groups.length - 1].push(n);
    } else {
      groups.push([n]);
      groupTime = n.time;
    }
  }
  for (const g of groups) g.sort((a, b) => a.note - b.note);
  return groups;
}

const BASS_GAP = 7; // semitones: a note this far below the rest of its group is a bass note

// A note of the bass part: a bass note, or a tone of a chord button.
export interface BassNote extends SongNote {
  chord: boolean;
}

// The bass part, chords included. Each onset's lowest note is a bass note if it sounds alone or
// stands a fifth or more below the rest (bass under a chord); the other notes are chord tones,
// and close clusters (the "pah" of an oom-pah) are all chord tones. The bass side has no
// octaves, so each pitch class appears once per role and onset. It takes the bass tracks, plus
// the right hand's cut-away notes when the cut hands them to the bass.
export function extractBass(song: Song, opts: ExtractOptions, range: Range): BassNote[] {
  const bassTracks = new Set(opts.bassTracks);
  const treble = new Set(opts.tracks);
  const picked = song.notes.filter(n => bassTracks.has(n.track)
    || (opts.cut?.toBass && treble.has(n.track) && isCut(n, opts, range)));
  const out: BassNote[] = [];
  for (const g of onsetGroups(picked)) {
    const bass = g.length === 1 || g[1].note - g[0].note >= BASS_GAP ? g[0] : null;
    const seen = new Set<string>();
    for (const n of g) {
      const note = n.note + opts.transpose;
      const chord = n !== bass;
      const key = `${chord}:${note % 12}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...n, note, id: out.length, chord });
    }
  }
  return out;
}

export function extractNotes(song: Song, opts: ExtractOptions, range: Range): SongNote[] {
  const selected = new Set(opts.tracks);
  let picked = song.notes.filter(n => selected.has(n.track) && !isCut(n, opts, range));
  if (opts.topLineOnly) picked = onsetGroups(picked).map(g => g[g.length - 1]);

  const result: SongNote[] = [];
  const seen = new Set<string>();
  for (const n of picked) {
    const note = treblePitch(n, opts, range);
    const key = `${note}@${Math.round(n.time * 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...n, note, id: result.length });
  }
  return result;
}

// The tracks given to neither part, as written (transposed), to play along with.
export function extractOthers(song: Song, opts: ExtractOptions): SongNote[] {
  const used = new Set([...opts.tracks, ...opts.bassTracks]);
  return song.notes
    .filter(n => !used.has(n.track))
    .map((n, id) => ({ ...n, note: Math.min(127, Math.max(0, n.note + opts.transpose)), id }));
}

// First index whose time >= t.
export function lowerBound(notes: RawNote[], t: number): number {
  let lo = 0, hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
