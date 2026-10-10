import { lowerBound, type SongNote } from '../core/song';
import type { NoteSink } from './audio';

// Sounds one part of the song (right hand or bass) on its own channel as the clock passes it.
export class PartPlayer<T extends SongNote = SongNote> {
  notes: T[] = [];
  private next = 0; // next note the clock will reach
  private readonly sounding = new Map<number, T>();
  private readonly claimed = new Set<number>(); // notes handed over to live input
  // Song time a sounding note stops at; its written end unless the caller says otherwise.
  endOf: (n: T) => number = n => n.time + n.duration;

  // `channel` picks each note's MIDI channel (the bass part sends chord tones on their own).
  constructor(private readonly channel: (n: T) => number) {}

  // Moves the read position to t.
  seek(t: number): void {
    this.next = lowerBound(this.notes, t);
    this.claimed.clear();
  }

  // Hands a note over to live input: the clock no longer starts or stops it. True if it was
  // already sounding, so the caller keeps it going instead of starting it again.
  claim(id: number): boolean {
    this.claimed.add(id);
    return this.sounding.delete(id);
  }

  // Releases this part's sounding notes (the other part keeps playing).
  release(sink: NoteSink): void {
    for (const n of this.sounding.values()) sink.noteOff(n.note, this.channel(n));
    this.sounding.clear();
  }

  // Forgets the sounding notes; the caller silences the sink itself.
  stop(): void {
    this.sounding.clear();
  }

  play(sink: NoteSink, n: T): void {
    sink.noteOn(n.note, n.velocity, this.channel(n));
    this.sounding.set(n.id, n);
  }

  // Releases the notes that ended by t, then passes the ones starting by t, sounding them if `sound`.
  update(sink: NoteSink, t: number, sound: boolean): void {
    // Release ended notes before starting new ones, and only when no newer note of the same
    // pitch has taken over; otherwise back-to-back repeats would cut each other off.
    for (const [id, n] of this.sounding) {
      if (this.endOf(n) > t) continue;
      this.sounding.delete(id);
      const ch = this.channel(n);
      if (![...this.sounding.values()].some(o => o.note === n.note && this.channel(o) === ch)) sink.noteOff(n.note, ch);
    }
    while (this.next < this.notes.length && this.notes[this.next].time <= t) {
      const n = this.notes[this.next++];
      if (sound && !this.claimed.has(n.id)) this.play(sink, n);
    }
  }

  get soundingNotes(): number[] {
    return [...this.sounding.values()].map(n => n.note);
  }
}
