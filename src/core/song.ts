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
  srcNote: number; // pitch before octave fitting
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

export interface ExtractOptions {
  tracks: number[]; // right hand
  bassTracks: number[];
  splitNote: number | null; // the right hand keeps notes >= splitNote, the bass the ones below
  topLineOnly: boolean;
  fitToRange: boolean;
  transpose: number; // semitones, applied before fitting to the range
}

// Notes starting within this window are treated as one chord.
export const CHORD_EPS = 0.03;

export function sortNotes<T extends RawNote>(notes: T[]): T[] {
  return notes.sort((a, b) => a.time - b.time || b.note - a.note);
}

export function trackInfo(index: number, name: string, channel: number, notes: RawNote[]): TrackInfo {
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
  return trimLeadIn({ name, duration: midi.duration, tracks, notes: sortNotes(notes), firstBar: 1, ...beatGrid(midi) });
}

const MAX_LEAD_BARS = 2; // empty bars kept before the first note

// Many MIDI files start with long silence; keep at most MAX_LEAD_BARS empty bars of it.
function trimLeadIn(song: Song): Song {
  if (song.notes.length === 0) return song;
  const first = song.notes[0].time;
  let firstNoteBar = 0;
  while (firstNoteBar + 1 < song.bars.length && song.bars[firstNoteBar + 1] <= first + 1e-6) firstNoteBar++;
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

// Bar and beat start times, following time-signature changes (tempo is handled by ticksToSeconds).
function beatGrid(midi: Midi): { bars: number[]; beats: number[] } {
  const ppq = midi.header.ppq;
  const sigs = midi.header.timeSignatures.length
    ? [...midi.header.timeSignatures].sort((a, b) => a.ticks - b.ticks)
    : [{ ticks: 0, timeSignature: [4, 4] }];
  const end = Math.max(midi.durationTicks, ppq);
  const bars: number[] = [];
  const beats: number[] = [];
  let tick = 0;
  let i = 0;
  while (tick <= end) {
    while (i + 1 < sigs.length && sigs[i + 1].ticks <= tick) i++;
    const [num, den] = sigs[i].timeSignature;
    const beatTicks = (ppq * 4) / den;
    bars.push(midi.header.ticksToSeconds(tick));
    for (let b = 0; b < num; b++) beats.push(midi.header.ticksToSeconds(tick + b * beatTicks));
    tick += beatTicks * num;
  }
  return { bars, beats };
}

// Tracks start unassigned: the player picks each part's tracks. A single track usually holds
// both hands, so it gets a split at middle C in case it's picked for both parts.
export function defaultOptions(song: Song): ExtractOptions {
  return {
    tracks: [], bassTracks: [], splitNote: song.tracks.length === 1 ? 60 : null,
    topLineOnly: false, fitToRange: true, transpose: 0,
  };
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
// octaves, so each pitch class appears once per role and onset.
export function extractBass(song: Song, opts: ExtractOptions): BassNote[] {
  const selected = new Set(opts.bassTracks);
  const picked = song.notes.filter(n => selected.has(n.track) && (opts.splitNote === null || n.note < opts.splitNote));
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
      out.push({ ...n, note, srcNote: n.note, id: out.length, chord });
    }
  }
  return out;
}

export function extractNotes(song: Song, opts: ExtractOptions, range: { min: number; max: number }): SongNote[] {
  const selected = new Set(opts.tracks);
  let picked = song.notes.filter(n => selected.has(n.track) && (opts.splitNote === null || n.note >= opts.splitNote));
  if (opts.topLineOnly) picked = onsetGroups(picked).map(g => g[g.length - 1]);

  const result: SongNote[] = [];
  const seen = new Set<string>();
  for (const n of picked) {
    let note = n.note + opts.transpose;
    if (opts.fitToRange) {
      while (note < range.min) note += 12;
      while (note > range.max) note -= 12;
    }
    const key = `${note}@${Math.round(n.time * 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...n, note, srcNote: n.note, id: result.length });
  }
  return result;
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
