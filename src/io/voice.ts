import { MidiOutSink, type NoteSink } from './audio';
import type { MidiIO } from './midi';
import { engine, SynthChannelSink } from './synth';

// One part of one track's sound: a SoundFont preset ("sf:...", see synth.ts) or a MIDI output port
// ("midi:<port id>"). Notes can be shifted by octaves on the way (the bass octave option).
export class PartVoice implements NoteSink {
  value: string | null = null;
  transpose = 0; // semitones; change it only with no notes sounding
  private sink: NoteSink | null = null;
  private synth: SynthChannelSink | null = null;

  // `channel` is the voice's MIDI channel, primed with the bellows level on a MIDI output.
  constructor(private readonly midi: MidiIO, private readonly channel: () => number) {}

  get midiPort(): string | null {
    return this.value?.startsWith('midi:') ? this.value.slice(5) : null;
  }

  // Switches to another sound. The caller silences first.
  choose(value: string, level: number): void {
    this.value = value;
    const port = this.midiPort;
    if (port) {
      this.sink = new MidiOutSink(this.midi, port, level, [this.channel()]);
      return;
    }
    if (this.synth) this.synth.setPreset(value);
    else this.synth = new SynthChannelSink(value, level);
    this.sink = this.synth;
  }

  // Audio needs a user gesture to start; play and key presses both count.
  start(): void {
    engine.resume();
    if (this.sink instanceof MidiOutSink) this.sink.prime();
  }

  // The voice's volume, 0..1: the synth channel's volume, or the bellows level (CC11) on a MIDI output.
  setVolume(v: number): void {
    this.synth?.setVolume(v);
    if (this.sink instanceof MidiOutSink) this.sink.setLevel(v);
  }

  noteOn(note: number, velocity: number, channel: number): void {
    this.sink?.noteOn(note + this.transpose, velocity, channel);
  }

  noteOff(note: number, channel: number): void {
    this.sink?.noteOff(note + this.transpose, channel);
  }

  allOff(): void {
    this.sink?.allOff();
  }
}
