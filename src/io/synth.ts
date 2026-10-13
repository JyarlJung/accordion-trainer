import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import type { NoteSink } from './audio';

// The app's sound: one SoundFont synthesizer (SpessaSynth, in an AudioWorklet) playing the bundled
// GeneralUser GS bank. Each voice in use gets a synth channel of its own, set to its preset and
// volume, so any number of tracks and parts can sound at once.
const SOUNDFONT = 'soundfonts/GeneralUser-GS.sf2';

export interface Preset {
  name: string;
  bankMSB: number;
  bankLSB: number;
  program: number;
  drum: boolean;
}

// A preset as a voice value: "sf:<bank MSB>:<bank LSB>:<program>", drum kits "sf:drum:<program>".
export const presetValue = (p: Preset) => (p.drum ? `sf:drum:${p.program}` : `sf:${p.bankMSB}:${p.bankLSB}:${p.program}`);
export const ITALIAN_ACCORDION = 'sf:8:0:21';
export const STANDARD_DRUMS = 'sf:drum:0';

const DRUM_CHANNEL = 9; // the synth's own drum channel; melodic voices never take it

class Engine {
  readonly context = new AudioContext({ latencyHint: 'interactive' });
  presets: Preset[] = [];
  private synth: WorkletSynthesizer | null = null;
  private next = 0;
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    await this.context.audioWorklet.addModule(processorUrl);
    const synth = new WorkletSynthesizer(this.context);
    synth.connect(this.context.destination);
    const bank = await (await fetch(SOUNDFONT)).arrayBuffer();
    await synth.soundBankManager.addSoundBank(bank, 'main');
    await synth.isReady;
    this.presets = synth.presetList
      .map(p => ({ name: p.name, bankMSB: p.bankMSB, bankLSB: p.bankLSB, program: p.program, drum: p.isDrum }))
      .sort((a, b) => Number(a.drum) - Number(b.drum) || a.program - b.program || a.bankMSB - b.bankMSB || a.bankLSB - b.bankLSB);
    this.synth = synth;
  }

  get synthesizer(): WorkletSynthesizer | null {
    return this.synth;
  }

  // Audio may only start from a user gesture; play and key presses both count.
  resume(): void {
    if (this.context.state !== 'running') void this.context.resume();
  }

  // A synth channel for a new voice.
  takeChannel(): number {
    if (this.next === DRUM_CHANNEL) this.next++;
    return this.next++;
  }
}

export const engine = new Engine();

// A voice on a synth channel of its own. MIDI channel numbers passed in are for MIDI outputs; this
// sink plays on its own channel.
export class SynthChannelSink implements NoteSink {
  private readonly channel = engine.takeChannel();
  private readonly on = new Set<number>();

  // The preset goes on before any note: right away once the bank is loaded, else when it is.
  constructor(private preset: string, private volume: number) {
    if (this.synth) this.apply();
    else void engine.ready.then(() => this.apply());
  }

  private get synth(): WorkletSynthesizer | null {
    return engine.synthesizer;
  }

  setPreset(value: string): void {
    this.allOff();
    this.preset = value;
    this.apply();
  }

  setVolume(v: number): void {
    this.volume = v;
    this.synth?.controllerChange(this.channel, 7, Math.round(v * 127));
  }

  private apply(): void {
    const synth = this.synth;
    if (!synth) return;
    while (synth.channelCount <= this.channel) synth.addNewChannel(); // past 16 the synth grows
    const parts = this.preset.split(':');
    const drum = parts[1] === 'drum';
    synth.midiChannels[this.channel].setDrums(drum);
    if (!drum) {
      synth.controllerChange(this.channel, 0, Number(parts[1]));
      synth.controllerChange(this.channel, 32, Number(parts[2]));
    }
    synth.programChange(this.channel, Number(parts[parts.length - 1]));
    this.setVolume(this.volume);
  }

  // A note sounding again is struck anew, as on a real key: the synth's noteOff ends only one of a
  // pitch's noteOns, so a second one left on its own would never stop.
  noteOn(note: number, velocity: number): void {
    if (!this.synth || note < 0 || note > 127) return;
    if (this.on.has(note)) this.synth.noteOff(this.channel, note);
    this.synth.noteOn(this.channel, note, Math.max(1, Math.round(velocity * 127)));
    this.on.add(note);
  }

  noteOff(note: number): void {
    if (!this.synth || note < 0 || note > 127) return;
    this.synth.noteOff(this.channel, note);
    this.on.delete(note);
  }

  allOff(): void {
    for (const note of this.on) this.synth?.noteOff(this.channel, note);
    this.on.clear();
  }
}
