import { CHORD_EPS, type SongNote } from './song';

export type NoteState = 'pending' | 'hit' | 'missed' | 'skipped';
export type HitResult = 'hit' | 'wrong' | 'free';

export interface Chord {
  time: number;
  ids: number[];
}

// Float slack for window edges: wait mode parks the clock exactly on chord + window, and
// (t + w) - w doesn't always round back to t.
const EPS = 1e-6;

// Matches live note-ons against the expected notes.
export class Judge {
  readonly state: NoteState[];
  readonly chords: Chord[] = [];
  hit = 0;
  miss = 0;
  wrong = 0;
  windowSec = 0.12; // real-time tolerance (early or late); scaled by playback rate into song time
  lastHit: number | null = null; // id of the note matched by the latest 'hit'
  private missPtr = 0;
  private chordPtr = 0;

  // `playable` filters out notes with no button to press (e.g. out of range with fitting off);
  // they're skipped so wait mode never stalls on them.
  constructor(readonly notes: SongNote[], private readonly playable: (note: number) => boolean = () => true) {
    this.state = notes.map(n => (playable(n.note) ? 'pending' : 'skipped'));
    for (const n of notes) {
      const last = this.chords[this.chords.length - 1];
      if (last && n.time - last.time < CHORD_EPS) last.ids.push(n.id);
      else this.chords.push({ time: n.time, ids: [n.id] });
    }
  }

  resetFrom(t: number, resetStats: boolean): void {
    for (const n of this.notes) {
      this.state[n.id] = n.time < t - EPS || !this.playable(n.note) ? 'skipped' : 'pending';
    }
    this.missPtr = 0;
    this.chordPtr = 0;
    if (resetStats) this.hit = this.miss = this.wrong = 0;
  }

  onNoteOn(pitch: number, t: number, rate: number): HitResult {
    if (this.notes.length === 0) return 'free';
    const win = this.windowSec * rate + EPS;
    let best = -1;
    let bestDist = Infinity;
    for (const n of this.notes) {
      if (n.time > t + win) break;
      if (n.time < t - win || n.note !== pitch || this.state[n.id] !== 'pending') continue;
      const d = Math.abs(n.time - t);
      if (d < bestDist) {
        best = n.id;
        bestDist = d;
      }
    }
    if (best < 0) {
      this.wrong++;
      return 'wrong';
    }
    this.state[best] = 'hit';
    this.hit++;
    this.lastHit = best;
    return 'hit';
  }

  // Marks notes that slipped past the hit window as missed (play mode only).
  update(t: number, rate: number): void {
    const limit = t - this.windowSec * rate;
    for (; this.missPtr < this.notes.length; this.missPtr++) {
      const n = this.notes[this.missPtr];
      if (n.time >= limit) break;
      if (this.state[n.id] === 'pending') {
        this.state[n.id] = 'missed';
        this.miss++;
      }
    }
  }

  // Where wait mode should stop: just past the earliest unplayed chord. The clock keeps
  // running through the hit window, so a slightly late press doesn't break the rhythm.
  waitPoint(rate: number): number | null {
    const t = this.nextPendingChordTime();
    return t === null ? null : t + this.windowSec * rate;
  }

  // Time of the earliest chord that still has unplayed notes.
  nextPendingChordTime(): number | null {
    for (; this.chordPtr < this.chords.length; this.chordPtr++) {
      const c = this.chords[this.chordPtr];
      if (c.ids.some(id => this.state[id] === 'pending')) return c.time;
    }
    return null;
  }
}
