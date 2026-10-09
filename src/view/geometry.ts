import type { BassButton, BassLayout } from '../core/bassLayout';
import type { KeyButton, Layout } from '../core/layout';

const PAD = 16;
const LABEL = 30; // row labels left of each board
const ROLL_MIN = 0.25; // share of the height kept for the falling notes
const ROW_GAP = 0.9; // distance between rows of a board, in button pitches
const BOARD_GAP = 0.5; // space around the bellows meter
const METER = 0.45;
const MAX_PITCH = 110;
const BASS_SCALE = 0.6; // the bass board is drawn smaller; it doesn't line up with the falling notes

// Top to bottom: falling notes, treble board, bellows meter, bass board. This is the
// opened-up instrument turned on its side: both boards face the bellows in the middle.
// The horizontal axis is pitch on the treble board (low notes left), so each note falls
// straight onto its button.
export class Geometry {
  readonly pitch: number; // distance between neighbouring buttons in a row
  readonly radius: number;
  readonly rowGap: number;
  readonly bassPitch: number;
  readonly bassRadius: number;
  readonly bassRowGap: number;
  readonly left: number; // left edge of the boards (after the row labels)
  readonly right: number;
  readonly labelX: number;
  readonly rollTop: number;
  readonly rollBottom: number;
  readonly rhX0: number; // centre x of the lowest treble pitch
  readonly rhRowsTop: number;
  readonly meterY: number;
  readonly meterH: number;
  readonly bassX0: number;
  readonly bassRowsTop: number;
  readonly rhOrder: number[]; // treble row numbers from top to bottom
  readonly bassOrder: number[]; // bass row indices from top to bottom
  private readonly rhLine = new Map<number, number>();
  private readonly bassLine = new Map<number, number>();
  private readonly bassRows: number;
  private readonly bassSlant: number;

  constructor(
    private readonly layout: Layout, bass: BassLayout,
    readonly width: number, readonly height: number, flipY: boolean, private readonly flipX: boolean,
  ) {
    this.bassRows = bass.def.rows.length;
    this.bassSlant = bass.def.rowSlant;
    const rhSpan = layout.pitchY(layout.maxNote) + 1;
    const bassSpan = bass.columns + this.bassSlant * (this.bassRows - 1);
    const boardUnits = (rows: number) => (rows - 1) * ROW_GAP + 0.92;
    const stackUnits = boardUnits(layout.rows.length) + BOARD_GAP + METER + BOARD_GAP + boardUnits(this.bassRows) * BASS_SCALE;

    this.left = PAD + LABEL;
    this.right = width - PAD;
    this.labelX = PAD + LABEL / 2;
    const byWidth = (this.right - this.left) / Math.max(rhSpan, bassSpan * BASS_SCALE);
    const byHeight = ((height - 2 * PAD) * (1 - ROLL_MIN)) / stackUnits;
    this.pitch = Math.max(8, Math.min(byWidth, byHeight, MAX_PITCH));
    const p = this.pitch;
    this.radius = p * 0.46;
    this.rowGap = p * ROW_GAP;
    this.bassPitch = p * BASS_SCALE;
    this.bassRadius = this.radius * BASS_SCALE;
    this.bassRowGap = this.rowGap * BASS_SCALE;

    // Stack from the bottom up; the roll takes whatever is left on top.
    const boardH = (rows: number) => (rows - 1) * this.rowGap + this.radius * 2;
    this.bassRowsTop = height - PAD - boardH(this.bassRows) * BASS_SCALE;
    this.meterH = p * METER;
    this.meterY = this.bassRowsTop - p * BOARD_GAP - this.meterH;
    this.rhRowsTop = this.meterY - p * BOARD_GAP - boardH(layout.rows.length);
    this.rollTop = PAD;
    this.rollBottom = this.rhRowsTop - p * 0.2;

    const centre = (span: number, pitch: number) => this.left + (this.right - this.left - span * pitch) / 2 + pitch / 2;
    this.rhX0 = centre(rhSpan, p);
    this.bassX0 = centre(bassSpan, this.bassPitch);

    // Default: treble row 1 on top (next to the roll), counter-bass on top (next to the bellows).
    this.rhOrder = layout.rows.map(r => r.row);
    this.bassOrder = bass.def.rows.map((_, i) => i);
    if (flipY) {
      this.rhOrder.reverse();
      this.bassOrder.reverse();
    }
    this.rhOrder.forEach((row, i) => this.rhLine.set(row, this.rhRowsTop + this.radius + i * this.rowGap));
    this.bassOrder.forEach((r, i) => this.bassLine.set(r, this.bassRowsTop + this.bassRadius + i * this.bassRowGap));
  }

  // Mirrors x around the board area's centre when flipped left-right.
  private fx(x: number): number {
    return this.flipX ? this.left + this.right - x : x;
  }

  pitchX(note: number): number {
    return this.fx(this.rhX0 + this.layout.pitchY(note) * this.pitch);
  }

  rowLineY(row: number): number {
    return this.rhLine.get(row) ?? 0;
  }

  bassLineY(rowIndex: number): number {
    return this.bassLine.get(rowIndex) ?? 0;
  }

  pos(b: KeyButton): { x: number; y: number } {
    return { x: this.pitchX(b.note), y: this.rowLineY(b.row) };
  }

  bassPos(b: BassButton): { x: number; y: number } {
    // Rows further from the bellows are shifted along the board, following its slant.
    const x = this.bassX0 + (b.col + (this.bassRows - 1 - b.rowIndex) * this.bassSlant) * this.bassPitch;
    return { x: this.fx(x), y: this.bassLineY(b.rowIndex) };
  }
}
