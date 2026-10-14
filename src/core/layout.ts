export type RowRole = 'main' | 'helper';

export interface RowDef {
  row: number;
  start: number; // MIDI note of the first (top) button
  count: number;
  role: RowRole;
  yOffset: number; // vertical stagger in button units
  duplicateOf?: number;
}

export interface LayoutDef {
  name: string;
  semitonesPerButton: number; // a piano keyboard keeps 3, so it's sized like the button boards
  rows: RowDef[];
  // A piano keyboard instead of button rows: keys low-high shown, playLow-playHigh played.
  keyboard?: { low: number; high: number; playLow: number; playHigh: number };
}

export interface KeyButton {
  id: string;
  row: number;
  index: number;
  note: number;
  role: RowRole;
  y: number; // position along the row, in button units
  black: boolean;
}

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

export function noteName(note: number): string {
  return NAMES[note % 12] + (Math.floor(note / 12) - 1);
}

export function isBlack(note: number): boolean {
  return [1, 3, 6, 8, 10].includes(note % 12);
}

export class Layout {
  readonly buttons: KeyButton[] = [];
  readonly rows: RowDef[];
  readonly minNote: number;
  readonly maxNote: number;
  readonly piano: boolean; // piano keys, one per semitone, all on "row" 1
  private playRange = { low: 0, high: 127 };
  private readonly byNote = new Map<number, KeyButton[]>();

  constructor(readonly def: LayoutDef) {
    const kb = def.keyboard;
    this.piano = kb !== undefined;
    if (kb) this.playRange = { low: kb.playLow, high: kb.playHigh };
    this.rows = kb
      ? [{ row: 1, start: kb.low, count: kb.high - kb.low + 1, role: 'main', yOffset: 0 }]
      : [...def.rows].sort((a, b) => a.row - b.row);
    const step = kb ? 1 : def.semitonesPerButton;
    for (const r of this.rows) {
      for (let i = 0; i < r.count; i++) {
        const note = r.start + i * step;
        const b: KeyButton = {
          id: `${r.row}-${i}`, row: r.row, index: i, note, role: r.role,
          y: i + r.yOffset, black: isBlack(note),
        };
        this.buttons.push(b);
        const list = this.byNote.get(note) ?? [];
        list.push(b);
        this.byNote.set(note, list);
      }
    }
    // Main rows first, so candidates(note)[0] is the default button to press.
    for (const list of this.byNote.values()) {
      list.sort((a, b) => (a.role === b.role ? a.row - b.row : a.role === 'main' ? -1 : 1));
    }
    const notes = this.buttons.map(b => b.note);
    this.minNote = Math.min(...notes);
    this.maxNote = Math.max(...notes);
  }

  candidates(note: number): KeyButton[] {
    return this.byNote.get(note) ?? [];
  }

  // Whether the instrument has the note: a button for it, or a key in the played range.
  playable(note: number): boolean {
    return this.byNote.has(note) && (!this.piano || (note >= this.playRange.low && note <= this.playRange.high));
  }

  // Changes whenever the played range does (for redrawing what depends on it).
  get playKey(): string {
    return `${this.playRange.low}-${this.playRange.high}`;
  }

  // The piano keys played (the rest are shown for reference only).
  setPlayRange(low: number, high: number): void {
    this.playRange = { low, high };
  }

  primary(note: number): KeyButton | undefined {
    return this.byNote.get(note)?.[0];
  }

  // Position along a row (in buttons) where `note` sits, or would sit, on that row.
  // Fractional for notes the row doesn't have; this is what lets each semitone get its own lane.
  laneU(note: number, row: number): number {
    const r = this.rows.find(d => d.row === row)!;
    return (note - r.start) / this.def.semitonesPerButton + r.yOffset;
  }

  // How far a note's lane moves along the rows (in buttons) per row step. On the C-system this is
  // 1/6 for every row, which makes the lanes straight diagonals that never share a pitch.
  get rowShift(): number {
    if (this.piano) return 0; // piano lanes fall straight
    return this.laneU(this.minNote, 2) - this.laneU(this.minNote, 1);
  }
}
