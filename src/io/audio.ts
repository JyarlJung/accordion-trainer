import * as Tone from 'tone';
import type { MidiIO } from './midi';

// Tone schedules everything `lookAhead` (0.1 s by default) after the current time, which made
// every note sound 100 ms late. Notes here are started from the frame loop or from input, never
// planned ahead, so start them right away.
Tone.getContext().lookAhead = 0;

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
  private out: Tone.Gain | null = null;
  private volume = 1;

  setVolume(v: number): void {
    this.volume = v;
    if (this.out) this.out.gain.value = v;
  }

  // Must be called from a user gesture. Not awaited by callers: the audio context may
  // resume a moment later, but the synth exists immediately.
  start(): Promise<void> {
    if (!this.synth) this.create();
    return Tone.start();
  }

  private create(): void {
    this.out = new Tone.Gain(this.volume).toDestination();
    const filter = new Tone.Filter(2400, 'lowpass').connect(this.out);
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
  loops?: Record<string, [number, number]>; // per-sample loop regions (fractions), used as given
  stack?: number[]; // semitone offsets sounded together for each note, e.g. [0, 12] for octave reeds
  crossfade?: number; // seconds blended across each loop's seam, so any loop points join smoothly
  maxHold?: number; // seconds a held note lasts before fading out on its own
  release?: number;
  part?: 'treble' | 'bass'; // which part picks this set by default
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
  srcs: Tone.ToneBufferSource[]; // one per stacked reed
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

// A copy of the buffer whose loop end blends into the audio leading up to the loop start
// (equal-power), so the jump back to the start continues the sound wherever the points fall.
function crossfaded(buffer: Tone.ToneAudioBuffer, start: number, end: number, fade: number): Tone.ToneAudioBuffer {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const out = new Float32Array(src);
    for (let i = 0; i < fade; i++) {
      const t = ((i + 1) / fade) * (Math.PI / 2);
      out[end - fade + i] = src[end - fade + i] * Math.cos(t) + src[start - fade + i] * Math.sin(t);
    }
    channels.push(out);
  }
  return Tone.ToneAudioBuffer.fromArray(channels);
}

// `snap` moves the loop points onto zero crossings; loops set by a sample's author are kept as
// they are. `crossfade` (seconds) smooths the seam.
function makeSample(
  root: number, buffer: Tone.ToneAudioBuffer, loop: [number, number] | false, snap: boolean, crossfade: number,
): Sample {
  if (!loop) return { root, buffer, loop: null };
  const data = buffer.getChannelData(0);
  const point = (f: number) => {
    const i = Math.min(Math.floor(data.length * f), data.length);
    return snap ? snapToZero(data, i) : i;
  };
  const start = point(loop[0]), end = point(loop[1]);
  const fade = Math.min(Math.round(crossfade * buffer.sampleRate), start, Math.floor((end - start) / 2));
  const out = fade > 0 ? crossfaded(buffer, start, end, fade) : buffer;
  return { root, buffer: out, loop: { start: start / buffer.sampleRate, end: end / buffer.sampleRate } };
}

// Samples ready to play, by file and loop settings, shared when both parts use the same set.
const prepared = new Map<string, Promise<Sample>>();

function prepareSample(
  url: string, root: number, loop: [number, number] | false, snap: boolean, crossfade: number,
): Promise<Sample> {
  url = new URL(url, location.href).href; // "set-b/../set-a/x.wav" is the same file as "set-a/x.wav"
  const key = JSON.stringify([url, root, loop, snap, crossfade]);
  let p = prepared.get(key);
  if (!p) {
    p = new Tone.ToneAudioBuffer().load(url).then(b => makeSample(root, b, loop, snap, crossfade));
    p.catch(() => prepared.delete(key)); // let a failed load be retried
    prepared.set(key, p);
  }
  return p;
}

// Sample player. By default it loops the middle of each sample so held notes sustain; a set can
// instead play samples once (natural decay) and/or cap how long a held note lasts.
export class SamplerSink implements NoteSink {
  private samples: Sample[] = [];
  private readonly voices = new Map<number, Voice>(); // by channel * 128 + note
  private out: Tone.Gain | null = null;
  private set: SampleSet | null = null;
  private volume = 1;

  setVolume(v: number): void {
    this.volume = v;
    if (this.out) this.out.gain.value = 0.8 * v;
  }

  async load(set: SampleSet): Promise<void> {
    this.allOff();
    this.set = set;
    this.samples = [];
    const loop = set.loop ?? [0.35, 0.8];
    const loaded = await Promise.all(Object.entries(set.urls).map(([name, file]) => {
      const own = set.loops?.[name];
      return prepareSample(set.baseUrl + file, Tone.Frequency(name).toMidi(), own ?? loop, !own, set.crossfade ?? 0);
    }));
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
    this.out ??= new Tone.Gain(0.8 * this.volume).toDestination();
    const gain = new Tone.Gain(0).connect(this.out);
    const start = Tone.now() + retrigger;
    // Each stacked reed plays from the sample nearest its own pitch.
    const srcs = (this.set?.stack ?? [0]).map(offset => {
      const pitch = note + offset;
      const s = this.samples.reduce((a, b) => (Math.abs(b.root - pitch) < Math.abs(a.root - pitch) ? b : a));
      const src = new Tone.ToneBufferSource(s.loop
        ? { url: s.buffer, loop: true, loopStart: s.loop.start, loopEnd: s.loop.end }
        : { url: s.buffer });
      src.playbackRate.value = 2 ** ((pitch - s.root) / 12);
      src.connect(gain);
      src.start(start);
      return src;
    });
    const level = velocity / Math.sqrt(srcs.length); // keep a stack about as loud as one reed
    gain.gain.setValueAtTime(0, start).linearRampToValueAtTime(level, start + 0.01);
    const voice: Voice = { srcs, gain, ended: false };
    // A voice can end by itself (samples played out, or maxHold reached) before its key is released.
    let playing = srcs.length;
    for (const src of srcs) {
      src.onended = () => {
        src.dispose();
        if (--playing > 0) return;
        voice.ended = true;
        if (this.voices.get(key) === voice) this.voices.delete(key);
        gain.dispose();
      };
    }
    const hold = this.set?.maxHold;
    if (hold) {
      gain.gain.setValueAtTime(level, start + hold).linearRampToValueAtTime(0, start + hold + HOLD_FADE);
      for (const src of srcs) src.stop(start + hold + HOLD_FADE);
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
    for (const src of v.srcs) src.stop(now + rel);
  }

  allOff(): void {
    for (const key of [...this.voices.keys()]) this.release(key, this.set?.release ?? 0.12);
  }
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
