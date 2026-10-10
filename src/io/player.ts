import { lowerBound, type SongNote } from '../core/song';
import type { NoteSink } from './audio';

// Sounds one part of the song (right hand or bass) on its own channel as the clock passes it.
export class PartPlayer {
  notes: SongNote[] = [];
  private next = 0; // next note the clock will reach
  private readonly sounding = new Map<number, SongNote>();

  constructor(private readonly channel: () => number) {}

  // Moves the read position to t.
  seek(t: number): void {
    this.next = lowerBound(this.notes, t);
  }

  // Forgets the sounding notes; the caller silences the sink itself.
  stop(): void {
    this.sounding.clear();
  }

  play(sink: NoteSink, n: SongNote): void {
    sink.noteOn(n.note, n.velocity, this.channel());
    this.sounding.set(n.id, n);
  }

  // Releases the notes that ended by t, then passes the ones starting by t, sounding them if `sound`.
  update(sink: NoteSink, t: number, sound: boolean): void {
    // Release ended notes before starting new ones, and only when no newer note of the same
    // pitch has taken over; otherwise back-to-back repeats would cut each other off.
    for (const [id, n] of this.sounding) {
      if (n.time + n.duration > t) continue;
      this.sounding.delete(id);
      if (![...this.sounding.values()].some(o => o.note === n.note)) sink.noteOff(n.note, this.channel());
    }
    while (this.next < this.notes.length && this.notes[this.next].time <= t) {
      const n = this.notes[this.next++];
      if (sound) this.play(sink, n);
    }
  }

  get soundingNotes(): number[] {
    return [...this.sounding.values()].map(n => n.note);
  }
}
