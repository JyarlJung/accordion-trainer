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
  semitonesPerButton: number;
  rows: RowDef[];
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
  private readonly byNote = new Map<number, KeyButton[]>();

  constructor(readonly def: LayoutDef) {
    this.rows = [...def.rows].sort((a, b) => a.row - b.row);
    for (const r of this.rows) {
      for (let i = 0; i < r.count; i++) {
        const note = r.start + i * def.semitonesPerButton;
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

  primary(note: number): KeyButton | undefined {
    return this.byNote.get(note)?.[0];
  }
}
