import type { BassLayout } from './bassLayout';
import type { HitResult } from './judge';
import { CHORD_EPS, type BassNote } from './song';

// One thing to play on the bass side: a bass note (any button sounding its pitch class) or a
// chord (any button of that chord).
export interface BassTarget {
  time: number;
  pc: number; // bass note: pitch class; chord: root
  chord: string | null; // chord row ('major', 'minor', ...), or null for a bass note
}

const EPS = 1e-6;

// Wait mode's bass: the clock also waits for the bass notes and chords due, so where melody and
// bass start together both have to be played. Chord tones count as one chord button; tones that
// don't make a chord the board has aren't asked for.
export class BassJudge {
  lastHit: BassTarget | null = null; // the target matched by the latest 'hit'
  private readonly targets: BassTarget[] = [];
  private readonly done: boolean[] = [];
  private ptr = 0;

  constructor(notes: BassNote[], bass: BassLayout) {
    let group: BassNote[] = [];
    const flush = () => {
      if (group.length === 0) return;
      const time = group[0].time;
      for (const n of group) if (!n.chord) this.targets.push({ time, pc: ((n.note % 12) + 12) % 12, chord: null });
      const chord = bass.forChord(group.filter(n => n.chord).map(n => n.note));
      if (chord) this.targets.push({ time, pc: chord.root, chord: chord.row });
      group = [];
    };
    for (const n of notes) {
      if (group.length && n.time - group[0].time >= CHORD_EPS) flush();
      group.push(n);
    }
    flush();
    this.done = this.targets.map(() => false);
  }

  // Targets before t count as played (skipped), from t on as still to play.
  resetFrom(t: number): void {
    this.targets.forEach((g, i) => (this.done[i] = g.time < t - EPS));
    this.ptr = 0;
  }

  // Time of the earliest target not yet played.
  nextPendingChordTime(): number | null {
    for (; this.ptr < this.targets.length; this.ptr++) {
      if (!this.done[this.ptr]) return this.targets[this.ptr].time;
    }
    return null;
  }

  // What's due at song time t.
  targetsAt(t: number): BassTarget[] {
    return this.targets.filter(g => Math.abs(g.time - t) < CHORD_EPS);
  }

  // A bass button (fundamental or counter-bass) sounding `note`, against what's due at `time`.
  onBass(note: number, time: number): HitResult {
    return this.match(time, g => g.chord === null && g.pc === ((note % 12) + 12) % 12);
  }

  // A chord button (row and root), against what's due at `time`.
  onChord(row: string, root: number, time: number): HitResult {
    return this.match(time, g => g.chord === row && g.pc === root);
  }

  // A target already played counts again, so it can be pressed again to hold the chord together.
  private match(time: number, fits: (g: BassTarget) => boolean): HitResult {
    if (this.targets.length === 0) return 'free';
    const i = this.targets.findIndex(g => Math.abs(g.time - time) < CHORD_EPS && fits(g));
    if (i < 0) return 'wrong';
    this.done[i] = true;
    this.lastHit = this.targets[i];
    return 'hit';
  }
}
