import type { BassButton, BassLayout } from '../core/bassLayout';
import type { KeyButton, Layout } from '../core/layout';

export interface GeometryOptions {
  flipY: boolean; // reverse the row order of both boards
  flipX: boolean; // mirror everything left-right
  rowGap: number; // distance between treble rows, in button pitches
  range: { lo: number; hi: number } | null; // treble notes to show; null = the whole keyboard
  rows: number[]; // treble rows to draw (hidden rows are folded away)
}

const PAD_X = 40;
const PAD_Y = 20;
const LABEL = 30; // row labels left of each board
const ROLL_MIN = 0.25; // share of the height kept for the falling notes
const BOARD_GAP = 0.35; // space around the bellows meter, in button pitches
const METER = 0.3;
const BUTTON = 0.46; // treble button radius as a fraction of a semitone lane
const BASS_LANES = 1.1; // bass button pitch in treble lanes: about treble-button sized, since it doesn't line up with notes
const BASS_ROW_GAP = 0.9;
const BASS_MAX_WIDTH = 0.55; // cap the bass board at this share of the width, so zooming the treble doesn't inflate it
const MAX_PITCH = 140;
const BASS_LABEL = 14; // bass row titles, this far outside the bass board, px
const SIDE_GAP = 32; // between the bass board and the area beside it (room for the row titles), px
const TRACKS_W = 250; // track table, px
const PANEL_GAP = 12;

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// Top to bottom: falling notes, treble board, bellows meter, bass board. This is the
// opened-up instrument turned on its side: both boards face the bellows in the middle.
// The bass board sits at the right end; left of it are the track table and the bass part's own
// roll (all swap sides when mirrored).
// Treble buttons keep their real positions; each semitone gets a straight diagonal lane
// that runs through its button, so notes fall onto their own button and row.
export class Geometry {
  readonly pitch: number; // distance between neighbouring buttons in a row
  readonly lo: number; // lowest treble note on screen
  readonly hi: number;
  readonly lane: number; // width of one semitone lane
  readonly radius: number;
  readonly rowGap: number;
  readonly bassPitch: number;
  readonly bassRadius: number;
  readonly bassRowGap: number;
  readonly left: number; // left edge of the boards (after the row labels)
  readonly right: number;
  readonly labelX: number;
  readonly rollTop: number;
  readonly rollBottom: number; // the judgment line: top of the board's first row
  readonly lanesBottom: number; // lowest main-row judgment line plus a button
  readonly rhRowsTop: number;
  readonly meterY: number;
  readonly meterH: number;
  readonly bassX0: number;
  readonly bassRowsTop: number;
  readonly bassBox: Box; // outer edges of the bass buttons
  readonly bassLabelX: number; // bass row titles, beside the board on the panels' side
  readonly tracksBox: Box; // the track table (an HTML overlay)
  readonly bassRoll: Box; // the bass part's roll, beside the bass board
  readonly rhOrder: number[]; // treble row numbers from top to bottom
  readonly bassOrder: number[]; // bass row indices from top to bottom
  private readonly rhX0: number;
  private readonly shear: number; // lane x shift per pixel of y
  private readonly rowStep: number; // y distance from one row number to the next (negative when flipped)
  private readonly rhLine = new Map<number, number>();
  private readonly bassLine = new Map<number, number>();
  private readonly bassRows: number;
  private readonly bassSlant: number;

  constructor(
    private readonly layout: Layout, bass: BassLayout,
    readonly width: number, readonly height: number, private readonly opts: GeometryOptions,
  ) {
    this.bassRows = bass.def.rows.length;
    this.bassSlant = bass.def.rowSlant;
    const semis = layout.def.semitonesPerButton;
    this.lo = opts.range?.lo ?? layout.minNote;
    this.hi = opts.range?.hi ?? layout.maxNote;
    const rhSpan = (this.hi - this.lo) / semis + 1;
    const bassSpan = bass.columns + this.bassSlant * (this.bassRows - 1);
    const g = opts.rowGap;
    const rhUnits = (opts.rows.length - 1) * g + (2 * BUTTON) / semis;
    const bassScale = BASS_LANES / semis; // bass pitch relative to the treble pitch
    const bassUnits = ((this.bassRows - 1) * BASS_ROW_GAP + 0.92) * bassScale;
    const stack = rhUnits + BOARD_GAP + METER + BOARD_GAP + bassUnits;

    this.left = PAD_X + LABEL;
    this.right = width - PAD_X;
    this.labelX = PAD_X + LABEL / 2;
    const availW = this.right - this.left, availH = height - 2 * PAD_Y;
    // Lanes lean by rowShift buttons per row, so the roll's height adds sideways extent:
    // width = span * p + rollHeight * k, with rollHeight = availH - stack * p.
    const k = Math.abs(layout.rowShift) / g;
    const byWidth = Math.min((availW - availH * k) / (rhSpan - stack * k), availW / (bassSpan * bassScale));
    const byHeight = (availH * (1 - ROLL_MIN)) / stack;
    this.pitch = Math.max(8, Math.min(byWidth > 0 ? byWidth : 8, byHeight, MAX_PITCH));
    const p = this.pitch;
    this.lane = p / semis;
    this.radius = this.lane * BUTTON;
    this.rowGap = p * g;
    this.bassPitch = Math.min(p * bassScale, (availW * BASS_MAX_WIDTH) / bassSpan);
    this.bassRadius = this.bassPitch * 0.46;
    this.bassRowGap = this.bassPitch * BASS_ROW_GAP;

    // Stack from the bottom up; the roll takes whatever is left on top.
    this.bassRowsTop = height - PAD_Y - ((this.bassRows - 1) * this.bassRowGap + this.bassRadius * 2);
    this.meterH = p * METER;
    this.meterY = this.bassRowsTop - p * BOARD_GAP - this.meterH;
    this.rhRowsTop = this.meterY - p * BOARD_GAP - ((opts.rows.length - 1) * this.rowGap + this.radius * 2);

    // Default: treble row 1 on top (next to the roll), counter-bass on top (next to the bellows).
    this.rhOrder = layout.rows.map(r => r.row).filter(r => opts.rows.includes(r));
    this.bassOrder = bass.def.rows.map((_, i) => i);
    if (opts.flipY) {
      this.rhOrder.reverse();
      this.bassOrder.reverse();
    }
    this.rhOrder.forEach((row, i) => this.rhLine.set(row, this.rhRowsTop + this.radius + i * this.rowGap));
    this.bassOrder.forEach((r, i) => this.bassLine.set(r, this.bassRowsTop + this.bassRadius + i * this.bassRowGap));

    const mainLines = layout.rows.filter(r => r.role === 'main').map(r => this.landY(r.row));
    this.rollTop = PAD_Y;
    this.rollBottom = Math.min(...this.rhOrder.map(r => this.landY(r)));
    this.lanesBottom = Math.max(...mainLines) + this.radius * 2;
    this.rowStep = this.rowLineY(2) - this.rowLineY(1);
    this.shear = (layout.rowShift * p) / this.rowStep;

    // Centre the whole lane fan (boards plus the leaning roll) horizontally.
    const xs = [this.lo, this.hi].flatMap(n => [this.rollTop, this.lanesBottom].map(y => this.laneXFrom(0, n, y)));
    const extent = Math.max(...xs) - Math.min(...xs) + this.lane;
    this.rhX0 = this.left + (availW - extent) / 2 + this.lane / 2 - Math.min(...xs);
    this.bassX0 = this.right - bassSpan * this.bassPitch + this.bassPitch / 2;

    // Boxes in screen space (after mirroring).
    const span = (a: number, b: number) => (opts.flipX ? { left: this.fx(b), right: this.fx(a) } : { left: a, right: b });
    const bassLeft = this.bassX0 - this.bassRadius;
    this.bassBox = {
      ...span(bassLeft, this.bassX0 + (bassSpan - 1) * this.bassPitch + this.bassRadius),
      top: this.bassRowsTop,
      bottom: this.bassRowsTop + (this.bassRows - 1) * this.bassRowGap + this.bassRadius * 2,
    };
    const side = { top: this.meterY, bottom: this.bassBox.bottom };
    this.tracksBox = { ...span(this.left, this.left + TRACKS_W), ...side };
    this.bassRoll = { ...span(this.left + TRACKS_W + PANEL_GAP, bassLeft - SIDE_GAP), ...side };
    this.bassLabelX = opts.flipX ? this.bassBox.right + BASS_LABEL : this.bassBox.left - BASS_LABEL;
  }

  get flipX(): boolean {
    return this.opts.flipX;
  }

  // Mirrors x around the board area's centre when flipped left-right.
  private fx(x: number): number {
    return this.opts.flipX ? this.left + this.right - x : x;
  }

  private laneXFrom(x0: number, note: number, y: number): number {
    const b = this.layout.primary(note);
    const row = b?.row ?? this.layout.rows[0].row;
    // Use where the row would be even if it's folded away, so lanes don't depend on what's shown.
    const rowY = this.rowLineY(1) + (row - 1) * this.rowStep;
    return x0 + this.layout.laneU(note, row) * this.pitch + (y - rowY) * this.shear;
  }

  // Centre of a note's lane at height y.
  laneX(note: number, y: number): number {
    return this.fx(this.laneXFrom(this.rhX0, note, y));
  }

  rowLineY(row: number): number {
    return this.rhLine.get(row) ?? 0;
  }

  showsRow(row: number): boolean {
    return this.rhLine.has(row);
  }

  // Judgment line of a row: the top of its buttons.
  landY(row: number): number {
    return this.rowLineY(row) - this.radius;
  }

  bassLineY(rowIndex: number): number {
    return this.bassLine.get(rowIndex) ?? 0;
  }

  pos(b: KeyButton): { x: number; y: number } {
    return { x: this.fx(this.rhX0 + b.y * this.pitch), y: this.rowLineY(b.row) };
  }

  // The bass board is drawn mirrored within its box, so moving down the instrument's columns
  // (C to F, fourths up) moves left on screen, the same way round as the hand.
  bassPos(b: BassButton): { x: number; y: number } {
    // Rows further from the bellows are shifted along the board, following its slant.
    const x = this.fx(this.bassX0 + (b.col + (this.bassRows - 1 - b.rowIndex) * this.bassSlant) * this.bassPitch);
    return { x: this.bassBox.left + this.bassBox.right - x, y: this.bassLineY(b.rowIndex) };
  }
}
