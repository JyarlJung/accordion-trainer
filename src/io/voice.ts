import { MidiOutSink, SamplerSink, SynthSink, type NoteSink, type SampleSet } from './audio';
import type { MidiIO } from './midi';

// One part's sound: a sample set ('set:<id>'), the synth ('synth') or a MIDI output port
// ('midi:<port id>'). Each part has its own, so the right hand and the bass can use different reeds.
export class PartVoice {
  sink: NoteSink;
  value: string | null = null;
  private readonly sampler = new SamplerSink();
  private readonly synth = new SynthSink();

  // `channels` are the part's MIDI channels, primed with the bellows level on a MIDI output.
  constructor(private readonly midi: MidiIO, private readonly channels: () => number[]) {
    this.sink = this.sampler;
  }

  get midiPort(): string | null {
    return this.value?.startsWith('midi:') ? this.value.slice(5) : null;
  }

  // Switches to another sound; resolves once a sample set has loaded. The caller silences first.
  choose(value: string, sets: SampleSet[], level: number): Promise<void> {
    this.value = value;
    const port = this.midiPort;
    if (value === 'synth') {
      this.sink = this.synth;
    } else if (port) {
      this.sink = new MidiOutSink(this.midi, port, level, this.channels());
    } else {
      this.sink = this.sampler;
      return this.sampler.load(sets.find(s => `set:${s.id}` === value)!);
    }
    return Promise.resolve();
  }

  // Audio needs a user gesture to start; play and key presses both count.
  start(): void {
    if (this.sink === this.synth) void this.synth.start();
    else if (this.sink === this.sampler) void this.sampler.start();
    else if (this.sink instanceof MidiOutSink) this.sink.prime();
  }

  // The part's volume, 0..1: the app's own sounds, or the bellows level (CC11) on a MIDI output.
  setVolume(v: number): void {
    this.sampler.setVolume(v);
    this.synth.setVolume(v);
    if (this.sink instanceof MidiOutSink) this.sink.setLevel(v);
  }
}
