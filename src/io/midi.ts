export interface MidiPort {
  id: string;
  name: string;
}

export type Part = 'right' | 'bass' | 'chord';
export const PARTS: Part[] = ['right', 'bass', 'chord'];

// Web MIDI wrapper: one selected input split by channel into parts, and one output.
export class MidiIO {
  // FR-4xb defaults: treble on 1, bass on 2, chord on 3.
  readonly channels: Record<Part, number> = { right: 1, bass: 2, chord: 3 };
  readonly held: Record<Part, Map<number, number>> = { right: new Map(), bass: new Map(), chord: new Map() }; // note -> velocity
  expression = 0; // last CC11 (bellows pressure on the FR-4xb), 0..1
  // Soft thru: echo the right-hand part back to the output. With the FR-4xb's accordion part set
  // to External Seq. Playback (needed for it to play the song), its own keys no longer reach its
  // sound engine; this puts them back.
  thru = false;
  lastChannel: number | null = null;
  onNoteOn?: (part: Part, note: number, velocity: number) => void;
  onNoteOff?: (part: Part, note: number) => void;
  onPortsChanged?: () => void;

  private access: MIDIAccess | null = null;
  private input: MIDIInput | null = null;
  private output: MIDIOutput | null = null;

  get supported(): boolean {
    return typeof navigator.requestMIDIAccess === 'function';
  }

  async init(): Promise<boolean> {
    if (!this.supported) return false;
    try {
      this.access = await navigator.requestMIDIAccess();
    } catch {
      return false;
    }
    this.access.onstatechange = () => this.onPortsChanged?.();
    return true;
  }

  inputs(): MidiPort[] {
    return this.access ? [...this.access.inputs.values()].map(p => ({ id: p.id, name: p.name ?? p.id })) : [];
  }

  outputs(): MidiPort[] {
    return this.access ? [...this.access.outputs.values()].map(p => ({ id: p.id, name: p.name ?? p.id })) : [];
  }

  get inputId(): string | null {
    return this.input?.id ?? null;
  }

  selectInput(id: string | null): void {
    if (this.input) this.input.onmidimessage = null;
    this.input = (id && this.access?.inputs.get(id)) || null;
    this.releaseAll();
    if (this.input) this.input.onmidimessage = e => this.handle(e.data);
  }

  // The output soft thru echoes to.
  selectOutput(id: string | null): void {
    this.output = (id && this.access?.outputs.get(id)) || null;
  }

  // Sends to an output port by id (each part's voice can use its own).
  sendTo(id: string, bytes: number[]): void {
    this.access?.outputs.get(id)?.send(bytes);
  }

  // Stops soft thru and silences every channel of every output (used when the app closes).
  shutdown(): void {
    this.thru = false;
    for (const out of this.access?.outputs.values() ?? []) {
      for (let ch = 0; ch < 16; ch++) {
        out.send([0xb0 | ch, 123, 0]); // All Notes Off
        out.send([0xb0 | ch, 120, 0]); // All Sound Off
      }
    }
  }

  // Feeds a fake message through the same path as real input (for testing without the instrument).
  simulate(note: number, on: boolean, channel = 1): void {
    this.handle(new Uint8Array([(on ? 0x90 : 0x80) | (channel - 1), note, on ? 100 : 0]));
  }

  private releaseAll(): void {
    for (const part of PARTS) {
      for (const note of [...this.held[part].keys()]) {
        this.held[part].delete(note);
        this.onNoteOff?.(part, note);
      }
    }
  }

  private handle(data: Uint8Array | null): void {
    if (!data || data.length < 2 || data[0] >= 0xf0) return;
    const type = data[0] & 0xf0;
    const channel = (data[0] & 0x0f) + 1;
    if (this.thru && this.output && channel === this.channels.right) this.output.send(data);
    if (data.length < 3) return;
    const [, d1, d2] = data;
    if (type === 0xb0 && d1 === 11) {
      this.expression = d2 / 127;
      return;
    }
    if (type !== 0x80 && type !== 0x90) return;
    this.lastChannel = channel;
    const part = PARTS.find(p => this.channels[p] === channel);
    if (!part) return;
    if (type === 0x90 && d2 > 0) {
      this.held[part].set(d1, d2 / 127);
      this.onNoteOn?.(part, d1, d2 / 127);
    } else if (this.held[part].delete(d1)) {
      this.onNoteOff?.(part, d1);
    }
  }
}
