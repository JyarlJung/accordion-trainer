import type { MidiIO } from './midi';

// Where notes go. `channel` (1..16) is the part's MIDI channel: a MIDI output sends on it; the
// app's own synth plays each voice on a channel of its own instead (see synth.ts).
export interface NoteSink {
  noteOn(note: number, velocity: number, channel: number): void;
  noteOff(note: number, channel: number): void;
  allOff(): void;
}

// Sends the song to a MIDI output (e.g. back to the accordion to use its own sound), each part on
// its own channel.
// V-Accordion reed sounds take their loudness from the bellows (CC11 Expression), so a note
// arriving with no bellows value is silent: the sink sends a fixed level from the part's volume.
export class MidiOutSink implements NoteSink {
  private readonly on = new Set<number>(); // channel * 128 + note
  private readonly channels: Set<number>;

  constructor(private readonly io: MidiIO, private readonly port: string, private level: number, channels: number[]) {
    this.channels = new Set(channels);
  }

  // Bellows level, 0..1 (follows the volume slider), on every channel in use. Resent before
  // playing in case the instrument was reset in between.
  setLevel(level: number): void {
    this.level = level;
    for (const ch of this.channels) this.io.sendTo(this.port, [0xb0 | (ch - 1), 11, Math.round(level * 127)]);
  }

  prime(): void {
    this.setLevel(this.level);
  }

  noteOn(note: number, velocity: number, channel: number): void {
    this.channels.add(channel);
    this.prime();
    this.io.sendTo(this.port, [0x90 | (channel - 1), note, Math.max(1, Math.round(velocity * 127))]);
    this.on.add(channel * 128 + note);
  }

  noteOff(note: number, channel: number): void {
    this.io.sendTo(this.port, [0x80 | (channel - 1), note, 0]);
    this.on.delete(channel * 128 + note);
  }

  allOff(): void {
    for (const key of this.on) this.noteOff(key % 128, key >> 7);
    for (const ch of this.channels) {
      this.io.sendTo(this.port, [0xb0 | (ch - 1), 123, 0]); // All Notes Off
      this.io.sendTo(this.port, [0xb0 | (ch - 1), 120, 0]); // All Sound Off
    }
  }
}
