export type BassRow = 'counter' | 'bass' | 'major' | 'minor' | 'seventh' | 'dim';
type ChordRow = Exclude<BassRow, 'counter' | 'bass'>;

export interface BassLayoutDef {
  name: string;
  columnsTopToBottom: string[]; // fundamental bass note of each column
  rows: BassRow[]; // from the bellows side outwards
  markerColumns: number[]; // columns whose fundamental bass button has a tactile mark
  rowSlant: number; // vertical shift between neighbouring rows, in button units
}

export interface BassButton {
  id: string;
  col: number;
  row: BassRow;
  rowIndex: number;
  root: number; // pitch class of the column's fundamental
  label: string;
  marker: boolean;
}

const PC: Record<string, number> = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
// Name of a bass note's button, as printed on the board (the bass has no octaves).
export function bassName(note: number): string {
  return NAMES[((note % 12) + 12) % 12];
}

const SUFFIX: Record<ChordRow, string> = { major: 'M', minor: 'm', seventh: '7', dim: '°' };

// Pitch-class shapes the instrument sends for each chord row, relative to the root.
const CHORD_SHAPES: Record<ChordRow, number[][]> = {
  major: [[0, 4, 7]],
  minor: [[0, 3, 7]],
  seventh: [[0, 4, 10], [0, 4, 7, 10]], // Stradella 7th usually omits the 5th
  dim: [[0, 3, 9], [0, 3, 6, 9]], // dim7, often without the 5th
};

export class BassLayout {
  readonly buttons: BassButton[] = [];
  readonly columns: number;
  private readonly centerCol: number;

  constructor(readonly def: BassLayoutDef) {
    this.columns = def.columnsTopToBottom.length;
    def.columnsTopToBottom.forEach((name, col) => {
      const root = PC[name];
      def.rows.forEach((row, rowIndex) => {
        const label = row === 'counter' ? NAMES[(root + 4) % 12] : row === 'bass' ? NAMES[root] : NAMES[root] + SUFFIX[row];
        this.buttons.push({
          id: `b${col}-${rowIndex}`, col, row, rowIndex, root, label,
          marker: row === 'bass' && def.markerColumns.includes(col),
        });
      });
    });
    this.centerCol = def.columnsTopToBottom.indexOf('C');
  }

  // Fundamental buttons first, then counter-bass ones; within each, closest to C first.
  forBassNote(note: number): BassButton[] {
    const pc = note % 12;
    const byDistance = (a: BassButton, b: BassButton) => Math.abs(a.col - this.centerCol) - Math.abs(b.col - this.centerCol);
    const fundamental = this.buttons.filter(b => b.row === 'bass' && b.root === pc).sort(byDistance);
    const counter = this.buttons.filter(b => b.row === 'counter' && (b.root + 4) % 12 === pc).sort(byDistance);
    return [...fundamental, ...counter];
  }

  // The two buttons that play a bass note: its fundamental and its counter-bass, each in the
  // column nearest C. Either one is a right way to play it.
  mainButtons(note: number): BassButton[] {
    const all = this.forBassNote(note);
    return (['bass', 'counter'] as const).map(row => all.find(b => b.row === row)!);
  }

  // The twelve pitch classes in the board's column order: the twelve columns around C.
  laneOrder(): number[] {
    return this.buttons
      .filter(b => b.row === 'bass' && b.col >= this.centerCol - 6 && b.col < this.centerCol + 6)
      .map(b => b.root);
  }

  // Identifies one chord button from the held notes (any octave or inversion).
  forChord(notes: Iterable<number>): BassButton | undefined {
    const held = [...notes].sort((a, b) => a - b);
    const pcs = new Set(held.map(n => n % 12));
    if (pcs.size < 3) return undefined;
    // Try the lowest note as root first; this settles the symmetric 4-note dim7.
    const roots = [...new Set(held.map(n => n % 12))];
    for (const root of [...roots, ...NAMES.map((_, i) => i)]) {
      for (const [row, shapes] of Object.entries(CHORD_SHAPES) as [ChordRow, number[][]][]) {
        if (!shapes.some(s => s.length === pcs.size && s.every(i => pcs.has((root + i) % 12)))) continue;
        return this.buttons
          .filter(b => b.row === row && b.root === root)
          .sort((a, b) => Math.abs(a.col - this.centerCol) - Math.abs(b.col - this.centerCol))[0];
      }
    }
    return undefined;
  }
}
