import * as Tone from 'tone';
import type { MidiIO } from './midi';

// Master volume for the app's own sounds (sampler and synth), 0..1.
export function setVolume(v: number): void {
  Tone.getDestination().volume.value = v <= 0 ? -Infinity : Tone.gainToDb(v);
}

// `channel` (1..16) is the part's MIDI channel: a MIDI output sends on it, and the sampler keeps
// each channel's voices apart so the same pitch in two parts doesn't cut itself off.
export interface NoteSink {
  noteOn(note: number, velocity: number, channel: number): void;
  noteOff(note: number, channel: number): void;
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

  // One shared voice per pitch, whatever the channel.
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
  // Loop region as fractions of the sample length, so held notes sustain; false plays the
  // sample once, letting it fade out the way it was recorded.
  loop?: [number, number] | false;
  maxHold?: number; // seconds a held note lasts before fading out on its own
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

const HOLD_FADE = 0.3; // seconds, fade at the end of maxHold

interface Voice {
  src: Tone.ToneBufferSource;
  gain: Tone.Gain;
  ended: boolean;
}

interface Sample {
  root: number; // MIDI note the sample was recorded at
  buffer: Tone.ToneAudioBuffer;
  loop: { start: number; end: number } | null; // seconds; null = play once
}

// Moves a loop point to the next rising zero crossing to avoid a click at the seam.
function snapToZero(data: Float32Array, i: number): number {
  for (let j = Math.max(1, i), end = Math.min(data.length, i + 4000); j < end; j++) {
    if (data[j - 1] < 0 && data[j] >= 0) return j;
  }
  return i;
}

function makeSample(root: number, buffer: Tone.ToneAudioBuffer, loop: [number, number] | false): Sample {
  if (!loop) return { root, buffer, loop: null };
  const data = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  const [ls, le] = loop;
  return {
    root, buffer,
    loop: { start: snapToZero(data, Math.floor(data.length * ls)) / rate, end: snapToZero(data, Math.floor(data.length * le)) / rate },
  };
}

// Sample player. By default it loops the middle of each sample so held notes sustain; a set can
// instead play samples once (natural decay) and/or cap how long a held note lasts.
export class SamplerSink implements NoteSink {
  private samples: Sample[] = [];
  private readonly voices = new Map<number, Voice>(); // by channel * 128 + note
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

  noteOn(note: number, velocity: number, channel: number): void {
    if (this.samples.length === 0) return;
    const key = channel * 128 + note;
    // Re-striking a sounding pitch: cut the old voice fast and leave a short gap so the repeat is audible.
    const retrigger = this.voices.has(key) ? RETRIGGER_GAP : 0;
    this.release(key, retrigger || (this.set?.release ?? 0.12));
    this.out ??= new Tone.Gain(0.8).toDestination();
    const s = this.samples.reduce((a, b) => (Math.abs(b.root - note) < Math.abs(a.root - note) ? b : a));
    const src = new Tone.ToneBufferSource(s.loop
      ? { url: s.buffer, loop: true, loopStart: s.loop.start, loopEnd: s.loop.end }
      : { url: s.buffer });
    src.playbackRate.value = 2 ** ((note - s.root) / 12);
    const gain = new Tone.Gain(0).connect(this.out);
    src.connect(gain);
    const start = Tone.now() + retrigger;
    gain.gain.setValueAtTime(0, start).linearRampToValueAtTime(velocity, start + 0.01);
    src.start(start);
    const voice: Voice = { src, gain, ended: false };
    // A voice can end by itself (sample played out, or maxHold reached) before its key is released.
    src.onended = () => {
      voice.ended = true;
      if (this.voices.get(key) === voice) this.voices.delete(key);
      src.dispose();
      gain.dispose();
    };
    const hold = this.set?.maxHold;
    if (hold) {
      gain.gain.setValueAtTime(velocity, start + hold).linearRampToValueAtTime(0, start + hold + HOLD_FADE);
      src.stop(start + hold + HOLD_FADE);
    }
    this.voices.set(key, voice);
  }

  noteOff(note: number, channel: number): void {
    this.release(channel * 128 + note, this.set?.release ?? 0.12);
  }

  private release(key: number, rel: number): void {
    const v = this.voices.get(key);
    if (!v) return;
    this.voices.delete(key);
    if (v.ended) return;
    const now = Tone.now();
    v.gain.gain.cancelScheduledValues(now).setValueAtTime(v.gain.gain.value, now).linearRampToValueAtTime(0, now + rel);
    v.src.stop(now + rel);
  }

  allOff(): void {
    for (const key of [...this.voices.keys()]) this.release(key, this.set?.release ?? 0.12);
  }
}

// Sends the song to a MIDI output (e.g. back to the accordion to use its own sound), each part on
// its own channel.
// V-Accordion reed sounds take their loudness from the bellows (CC11 Expression), so a note
// arriving with no bellows value is silent. With soft thru on, the player's own bellows (echoed
// back) is the only bellows source; mixing in a second one made the volume jump. Without thru,
// the sink sends a fixed level from the volume slider so a listen-only setup still sounds.
export class MidiOutSink implements NoteSink {
  private readonly on = new Set<number>(); // channel * 128 + note
  private readonly channels: Set<number>;

  constructor(private readonly io: MidiIO, private level: number, channels: number[]) {
    this.channels = new Set(channels);
  }

  // Bellows level, 0..1 (follows the volume slider), on every channel in use. Resent before
  // playing in case the instrument was reset in between.
  setLevel(level: number): void {
    this.level = level;
    if (this.playerBellows()) return;
    for (const ch of this.channels) this.io.send([0xb0 | (ch - 1), 11, Math.round(level * 127)]);
  }

  prime(): void {
    if (!this.playerBellows()) this.setLevel(this.level);
  }

  private playerBellows(): boolean {
    return this.io.thru;
  }

  noteOn(note: number, velocity: number, channel: number): void {
    this.channels.add(channel);
    this.prime();
    this.io.send([0x90 | (channel - 1), note, Math.max(1, Math.round(velocity * 127))]);
    this.on.add(channel * 128 + note);
  }

  noteOff(note: number, channel: number): void {
    this.io.send([0x80 | (channel - 1), note, 0]);
    this.on.delete(channel * 128 + note);
  }

  allOff(): void {
    for (const key of this.on) this.noteOff(key % 128, key >> 7);
    for (const ch of this.channels) {
      this.io.send([0xb0 | (ch - 1), 123, 0]); // All Notes Off
      this.io.send([0xb0 | (ch - 1), 120, 0]); // All Sound Off
    }
  }
}
