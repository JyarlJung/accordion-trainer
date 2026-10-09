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
  avgNote: number;
}

export interface Song {
  name: string;
  duration: number;
  tracks: TrackInfo[];
  notes: RawNote[]; // all tracks, sorted by time then pitch (high first)
}

export interface ExtractOptions {
  tracks: number[];
  splitNote: number | null; // keep notes >= splitNote
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
  let min = 127, max = 0, sum = 0;
  for (const n of notes) {
    min = Math.min(min, n.note);
    max = Math.max(max, n.note);
    sum += n.note;
  }
  return { index, name, channel, noteCount: notes.length, minNote: min, maxNote: max, avgNote: sum / notes.length };
}

export function parseSong(data: ArrayBuffer, name: string): Song {
  const midi = new Midi(data);
  const tracks: TrackInfo[] = [];
  const notes: RawNote[] = [];
  midi.tracks.forEach((t, index) => {
    if (t.notes.length === 0) return;
    const own = t.notes.map(n => ({ note: n.midi, time: n.time, duration: n.duration, velocity: n.velocity, track: index }));
    notes.push(...own);
    tracks.push(trackInfo(index, t.name.trim() || t.instrument.name || `트랙 ${index + 1}`, t.channel + 1, own));
  });
  return { name, duration: midi.duration, tracks, notes: sortNotes(notes) };
}

const RIGHT_HAND_NAME = /right|\br\.?h\b|treble|melody|오른/i;

export function guessOptions(song: Song): ExtractOptions {
  const base = { topLineOnly: false, fitToRange: true, transpose: 0 };
  if (song.tracks.length === 0) return { ...base, tracks: [], splitNote: null };
  // One track usually means both hands are merged; split at middle C.
  if (song.tracks.length === 1) return { ...base, tracks: [song.tracks[0].index], splitNote: 60 };
  const named = song.tracks.find(t => RIGHT_HAND_NAME.test(t.name));
  const pick = named ?? [...song.tracks].sort((a, b) => b.avgNote - a.avgNote)[0];
  return { ...base, tracks: [pick.index], splitNote: null };
}

export function extractNotes(song: Song, opts: ExtractOptions, range: { min: number; max: number }): SongNote[] {
  const selected = new Set(opts.tracks);
  let picked = song.notes.filter(n => selected.has(n.track) && (opts.splitNote === null || n.note >= opts.splitNote));

  if (opts.topLineOnly) {
    const top: RawNote[] = [];
    let groupTime = -Infinity;
    for (const n of picked) {
      if (n.time - groupTime < CHORD_EPS) {
        if (n.note > top[top.length - 1].note) top[top.length - 1] = n;
      } else {
        top.push(n);
        groupTime = n.time;
      }
    }
    picked = top;
  }

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
