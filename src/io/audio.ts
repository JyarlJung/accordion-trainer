import * as Tone from 'tone';
import type { MidiIO } from './midi';

// Master volume for the app's own sounds (sampler and synth), 0..1.
export function setVolume(v: number): void {
  Tone.getDestination().volume.value = v <= 0 ? -Infinity : Tone.gainToDb(v);
}

export interface NoteSink {
  noteOn(note: number, velocity: number): void;
  noteOff(note: number): void;
  allOff(): void;
}

// Simple reedy synth so the app makes sound without the instrument.
export class SynthSink implements NoteSink {
  private synth: Tone.PolySynth | null = null;

  // Must be called from a user gesture. Not awaited by callers: the audio context may
  // resume a moment later, but the synth exists immediately.
  start(): Promise<void> {
    if (!this.synth) this.create();
    return Tone.start();
  }

  private create(): void {
    const filter = new Tone.Filter(2400, 'lowpass').toDestination();
    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'fatsawtooth', count: 2, spread: 14 },
      envelope: { attack: 0.02, decay: 0.1, sustain: 0.85, release: 0.12 },
      volume: -16,
    }).connect(filter);
  }

  noteOn(note: number, velocity: number): void {
    this.synth?.triggerAttack(Tone.Frequency(note, 'midi').toFrequency(), Tone.now(), velocity);
  }

  noteOff(note: number): void {
    this.synth?.triggerRelease(Tone.Frequency(note, 'midi').toFrequency(), Tone.now());
  }

  allOff(): void {
    this.synth?.releaseAll();
  }
}

export interface SampleSet {
  id: string;
  label: string;
  baseUrl: string;
  urls: Record<string, string>; // note name ("A4") -> file, relative to baseUrl
  loop?: [number, number]; // loop region as fractions of the sample length
  release?: number;
}

const GM_ACCORDION = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/accordion-mp3/';

export const BUILTIN_SETS: SampleSet[] = [{
  id: 'gm-accordion',
  label: 'GM 아코디언',
  baseUrl: GM_ACCORDION,
  // Minor-third spacing; the gaps are pitch-shifted.
  urls: Object.fromEntries([3, 4, 5, 6, 7].flatMap(o => ['C', 'Eb', 'Gb', 'A'].map(n => [`${n}${o}`, `${n}${o}.mp3`]))),
}];

const RETRIGGER_GAP = 0.025; // seconds

interface Voice {
  src: Tone.ToneBufferSource;
  gain: Tone.Gain;
}

interface Sample {
  root: number; // MIDI note the sample was recorded at
  buffer: Tone.ToneAudioBuffer;
  loopStart: number; // seconds
  loopEnd: number;
}

// Moves a loop point to the next rising zero crossing to avoid a click at the seam.
function snapToZero(data: Float32Array, i: number): number {
  for (let j = Math.max(1, i), end = Math.min(data.length, i + 4000); j < end; j++) {
    if (data[j - 1] < 0 && data[j] >= 0) return j;
  }
  return i;
}

function makeSample(root: number, buffer: Tone.ToneAudioBuffer, [ls, le]: [number, number]): Sample {
  const data = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  return {
    root, buffer,
    loopStart: snapToZero(data, Math.floor(data.length * ls)) / rate,
    loopEnd: snapToZero(data, Math.floor(data.length * le)) / rate,
  };
}

// Sample player that loops the middle of each sample, so held notes sustain indefinitely.
export class SamplerSink implements NoteSink {
  private samples: Sample[] = [];
  private readonly voices = new Map<number, Voice>();
  private out: Tone.Gain | null = null;
  private set: SampleSet | null = null;

  async load(set: SampleSet): Promise<void> {
    this.allOff();
    this.set = set;
    this.samples = [];
    const loop = set.loop ?? [0.35, 0.8];
    const loaded = await Promise.all(Object.entries(set.urls).map(async ([name, file]) =>
      makeSample(Tone.Frequency(name).toMidi(), await new Tone.ToneAudioBuffer().load(set.baseUrl + file), loop)));
    // Ignore a stale load if another set was chosen meanwhile.
    if (this.set === set) this.samples = loaded;
  }

  start(): Promise<void> {
    return Tone.start();
  }

  noteOn(note: number, velocity: number): void {
    if (this.samples.length === 0) return;
    // Re-striking a sounding pitch: cut the old voice fast and leave a short gap so the repeat is audible.
    const retrigger = this.voices.has(note) ? RETRIGGER_GAP : 0;
    this.release(note, retrigger || (this.set?.release ?? 0.12));
    this.out ??= new Tone.Gain(0.8).toDestination();
    const s = this.samples.reduce((a, b) => (Math.abs(b.root - note) < Math.abs(a.root - note) ? b : a));
    const src = new Tone.ToneBufferSource({ url: s.buffer, loop: true, loopStart: s.loopStart, loopEnd: s.loopEnd });
    src.playbackRate.value = 2 ** ((note - s.root) / 12);
    const gain = new Tone.Gain(0).connect(this.out);
    src.connect(gain);
    const start = Tone.now() + retrigger;
    gain.gain.setValueAtTime(0, start).linearRampToValueAtTime(velocity, start + 0.01);
    src.start(start);
    this.voices.set(note, { src, gain });
  }

  noteOff(note: number): void {
    this.release(note, this.set?.release ?? 0.12);
  }

  private release(note: number, rel: number): void {
    const v = this.voices.get(note);
    if (!v) return;
    this.voices.delete(note);
    const now = Tone.now();
    v.gain.gain.cancelScheduledValues(now).setValueAtTime(v.gain.gain.value, now).linearRampToValueAtTime(0, now + rel);
    v.src.onended = () => {
      v.src.dispose();
      v.gain.dispose();
    };
    v.src.stop(now + rel);
  }

  allOff(): void {
    for (const note of [...this.voices.keys()]) this.noteOff(note);
  }
}

// Sends the song to a MIDI output (e.g. back to the accordion to use its own sound).
// V-Accordion reed sounds take their loudness from the bellows (CC11 Expression), so a note
// arriving with no bellows value is silent. The sink sends its own bellows level unless the
// player's real bellows (echoed by soft thru) moved within the last second.
export class MidiOutSink implements NoteSink {
  private readonly on = new Set<number>();

  constructor(private readonly io: MidiIO, private readonly channel: number, private level: number) {}

  // Bellows level, 0..1 (follows the volume slider). Resent before playing in case the
  // instrument was reset in between.
  setLevel(level: number): void {
    this.level = level;
    if (this.playerBellows()) return;
    this.io.send([0xb0 | (this.channel - 1), 11, Math.round(level * 127)]);
  }

  prime(): void {
    if (!this.playerBellows()) this.setLevel(this.level);
  }

  private playerBellows(): boolean {
    return this.io.thru && performance.now() - this.io.expressionAt < 1000;
  }

  noteOn(note: number, velocity: number): void {
    this.prime();
    this.io.send([0x90 | (this.channel - 1), note, Math.max(1, Math.round(velocity * 127))]);
    this.on.add(note);
  }

  noteOff(note: number): void {
    this.io.send([0x80 | (this.channel - 1), note, 0]);
    this.on.delete(note);
  }

  allOff(): void {
    for (const note of this.on) this.noteOff(note);
    this.io.send([0xb0 | (this.channel - 1), 123, 0]); // All Notes Off, in case anything is stuck
  }
}
