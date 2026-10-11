import { lowerBound, type SongNote } from '../core/song';
import type { NoteSink } from './audio';

// Where a note sounds: the sink of its channel's voice, and the MIDI channel.
export interface Route {
  sink: NoteSink;
  channel: number;
}

// Sounds one part of the song (right hand or bass) on its own channels as the clock passes it.
export class PartPlayer<T extends SongNote = SongNote> {
  notes: T[] = [];
  private next = 0; // next note the clock will reach
  private readonly sounding = new Map<number, T>();
  private readonly claimed = new Set<number>(); // notes handed over to live input
  // Song time a sounding note stops at; its written end unless the caller says otherwise.
  endOf: (n: T) => number = n => n.time + n.duration;

  // `route` picks each note's voice and channel (the bass part sends chord tones on their own).
  constructor(private readonly route: (n: T) => Route) {}

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
  release(): void {
    for (const n of this.sounding.values()) {
      const r = this.route(n);
      r.sink.noteOff(n.note, r.channel);
    }
    this.sounding.clear();
  }

  // Forgets the sounding notes; the caller silences the sinks itself.
  stop(): void {
    this.sounding.clear();
  }

  play(n: T): void {
    const r = this.route(n);
    r.sink.noteOn(n.note, n.velocity, r.channel);
    this.sounding.set(n.id, n);
  }

  // Releases the notes that ended by t, then passes the ones starting by t, sounding them if `sound`.
  update(t: number, sound: boolean): void {
    // Release ended notes before starting new ones, and only when no newer note of the same
    // pitch has taken over; otherwise back-to-back repeats would cut each other off.
    for (const [id, n] of this.sounding) {
      if (this.endOf(n) > t) continue;
      this.sounding.delete(id);
      const r = this.route(n);
      const same = (o: T) => o.note === n.note && this.route(o).channel === r.channel && this.route(o).sink === r.sink;
      if (![...this.sounding.values()].some(same)) r.sink.noteOff(n.note, r.channel);
    }
    while (this.next < this.notes.length && this.notes[this.next].time <= t) {
      const n = this.notes[this.next++];
      if (sound && !this.claimed.has(n.id)) this.play(n);
    }
  }

  get soundingNotes(): number[] {
    return [...this.sounding.values()].map(n => n.note);
  }
}
