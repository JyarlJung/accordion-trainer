import { CHORD_EPS, type SongNote } from './song';

export type NoteState = 'pending' | 'hit' | 'skipped';
export type HitResult = 'hit' | 'wrong' | 'free';

export interface Chord {
  time: number;
  ids: number[];
}

// Float slack for window edges: (t + w) - w doesn't always round back to t.
const EPS = 1e-6;

// Which song notes were played. Play mode matches a press to the nearest note in the hit window;
// wait mode (see WaitMode) only to the chord due.
export class Judge {
  readonly state: NoteState[];
  readonly chords: Chord[] = [];
  windowSec = 0.12; // real-time tolerance (early or late); scaled by playback rate into song time
  lastHit: number | null = null; // id of the note matched by the latest 'hit'
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

  resetFrom(t: number): void {
    for (const n of this.notes) {
      this.state[n.id] = n.time < t - EPS || !this.playable(n.note) ? 'skipped' : 'pending';
    }
    this.chordPtr = 0;
  }

  // Play mode: the nearest unplayed note of that pitch within the hit window.
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
    if (best < 0) return 'wrong';
    this.state[best] = 'hit';
    this.lastHit = best;
    return 'hit';
  }

  // Wait mode: a press against the chord at `time`. A note of it already played counts again, so
  // the chord can be pressed again to hold it down together.
  strike(pitch: number, time: number): HitResult {
    if (this.notes.length === 0) return 'free';
    for (const n of this.notes) {
      if (n.time > time + CHORD_EPS) break;
      if (Math.abs(n.time - time) < CHORD_EPS && n.note === pitch && this.state[n.id] !== 'skipped') {
        this.state[n.id] = 'hit';
        this.lastHit = n.id;
        return 'hit';
      }
    }
    return 'wrong';
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
