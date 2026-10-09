export interface MidiPort {
  id: string;
  name: string;
}

// Web MIDI wrapper: one selected input (with optional channel filter) and one output.
export class MidiIO {
  channel: number | null = null; // 1..16, null = all channels
  lastChannel: number | null = null;
  readonly held = new Map<number, number>(); // note -> velocity (0..1)
  onNoteOn?: (note: number, velocity: number) => void;
  onNoteOff?: (note: number) => void;
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

  selectOutput(id: string | null): void {
    this.output = (id && this.access?.outputs.get(id)) || null;
  }

  send(bytes: number[]): void {
    this.output?.send(bytes);
  }

  // Feeds a fake message through the same path as real input (for testing without the instrument).
  simulate(note: number, on: boolean, channel = 1): void {
    this.handle(new Uint8Array([(on ? 0x90 : 0x80) | (channel - 1), note, on ? 100 : 0]));
  }

  private releaseAll(): void {
    for (const note of [...this.held.keys()]) {
      this.held.delete(note);
      this.onNoteOff?.(note);
    }
  }

  private handle(data: Uint8Array | null): void {
    if (!data || data.length < 3) return;
    const type = data[0] & 0xf0;
    const channel = (data[0] & 0x0f) + 1;
    if (type !== 0x80 && type !== 0x90) return;
    this.lastChannel = channel;
    if (this.channel !== null && channel !== this.channel) return;
    const [, note, velocity] = data;
    if (type === 0x90 && velocity > 0) {
      this.held.set(note, velocity / 127);
      this.onNoteOn?.(note, velocity / 127);
    } else if (this.held.delete(note)) {
      this.onNoteOff?.(note);
    }
  }
}
