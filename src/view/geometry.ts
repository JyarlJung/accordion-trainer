import type { BassButton, BassLayout } from '../core/bassLayout';
import { isBlack, type KeyButton, type Layout } from '../core/layout';

export interface GeometryOptions {
  flipY: boolean; // reverse the row order of both boards
  flipX: boolean; // mirror everything left-right
  rowGap: number; // distance between treble rows, in button pitches
  rows: number[]; // treble rows to draw (hidden rows are folded away)
}

const PAD_X = 40;
const PAD_Y = 20;
const LABEL = 30; // row labels left of each board
const ROLL_MIN = 0.25; // share of the height kept for the falling notes
const BOARD_GAP = 0.35; // space between the treble and bass boards, in button pitches
const METER = 0.3; // bellows meter thickness, in button pitches; it stands at the bass board's outer side
const METER_GAP = 0.25; // between the bass board and the meter
// The bass board gets half the height a meter between the boards used to take; the other half
// goes to the falling notes.
const BASS_EXTRA = (METER + BOARD_GAP) / 2;
const BUTTON = 0.46; // treble button radius as a fraction of a semitone lane
const BASS_LANES = 1.1; // bass button pitch in treble lanes: about treble-button sized, since it doesn't line up with notes
const BASS_ROW_GAP = 0.9;
const BASS_MAX_WIDTH = 0.55; // cap the bass board at this share of the width, so zooming the treble doesn't inflate it
const MAX_PITCH = 140;
const BASS_LABEL = 20; // bass row titles, this far outside the bass board, px
const SIDE_GAP = 44; // between the bass board and the area beside it (room for the row titles), px
const TRACKS_W = 440; // track table, px
const PANEL_GAP = 12;
const BASS_ROLL_MAX = 720; // widest the bass roll gets, px; on wider screens it stays by the bass board
const BASS_ROLL_MIN = 260; // ... and narrowest: the bass board stops growing there
// Piano keyboard: as tall as button rows 1-3 at a row gap of 0.50, in button pitches.
const KEYS_UNITS = 2 * 0.5 + (2 * BUTTON) / 3;
const KEY_ASPECT = 6.5; // longest a white key gets, in (average) key widths (a real piano's is about 6.3)
const KEY_MIN_ASPECT = 3.2; // ... and shortest: wide screens leave space at the sides instead
const WHITE_PER_SEMITONE = 12 / 7; // a white key's average width, in semitone lanes
const BLACK_H = 0.62; // black key length, in white key lengths

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
  readonly meter: Box; // bellows meter, upright beside the bass board
  readonly bassX0: number;
  readonly bassRowsTop: number;
  readonly bassBox: Box; // outer edges of the bass buttons
  readonly bassLabelX: number; // bass row titles, beside the board on the panels' side
  readonly tracksBox: Box; // the track table (an HTML overlay)
  readonly bassRoll: Box; // the bass part's roll, beside the bass board
  readonly rhOrder: number[]; // treble row numbers from top to bottom
  readonly bassOrder: number[]; // bass row indices from top to bottom
  readonly keysTop: number; // piano keyboard: top edge of the keys
  readonly keysH: number; // ... and their length
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
    this.lo = layout.minNote;
    this.hi = layout.maxNote;
    const rhSpan = (this.hi - this.lo) / semis + 1;
    const bassSpan = bass.columns + this.bassSlant * (this.bassRows - 1);
    const g = opts.rowGap;
    const rhUnits = layout.piano ? KEYS_UNITS : (opts.rows.length - 1) * g + (2 * BUTTON) / semis;
    const bassHeight = (this.bassRows - 1) * BASS_ROW_GAP + 0.92; // in bass pitches
    const bassScale0 = BASS_LANES / semis; // bass pitch relative to the treble pitch, before growing
    const bassUnits = bassHeight * bassScale0 + BASS_EXTRA;
    const bassScale = bassUnits / bassHeight;
    const stack = rhUnits + BOARD_GAP + bassUnits;

    this.left = PAD_X + LABEL;
    this.right = width - PAD_X;
    this.labelX = PAD_X + LABEL / 2;
    const availW = this.right - this.left, availH = height - 2 * PAD_Y;
    const byHeight = (availH * (1 - ROLL_MIN)) / stack;
    const bassByWidth = availW / (bassSpan * bassScale0);
    let semitone = 0;
    if (layout.piano) {
      // The keys' length follows the height; their width the screen, within a key's proportions.
      // Lanes are one semitone each (one more for the half lanes the end keys stick out).
      const p0 = Math.max(8, Math.min(byHeight, bassByWidth, MAX_PITCH));
      semitone = Math.min(availW / (this.hi - this.lo + 2), (KEYS_UNITS * p0) / KEY_MIN_ASPECT / WHITE_PER_SEMITONE);
      this.pitch = Math.max(8, Math.min(p0, (KEY_ASPECT * semitone * WHITE_PER_SEMITONE) / KEYS_UNITS));
    } else {
      // Lanes lean by rowShift buttons per row, so the roll's height adds sideways extent:
      // width = span * p + rollHeight * k, with rollHeight = availH - stack * p.
      const k = Math.abs(layout.rowShift) / g;
      const byWidth = Math.min((availW - availH * k) / (rhSpan - stack * k), bassByWidth);
      this.pitch = Math.max(8, Math.min(byWidth > 0 ? byWidth : 8, byHeight, MAX_PITCH));
    }
    const p = this.pitch;
    this.lane = layout.piano ? semitone : p / semis;
    this.radius = (p / semis) * BUTTON;
    this.rowGap = p * g;
    const meterW = p * METER, meterGap = p * METER_GAP;
    // The bass board fills its band's height, short of a share of the width and of leaving the
    // bass roll too narrow.
    const roomForBoard = availW - TRACKS_W - PANEL_GAP - BASS_ROLL_MIN - SIDE_GAP - meterGap - meterW;
    this.bassPitch = Math.max(8, Math.min(p * bassScale, (availW * BASS_MAX_WIDTH) / bassSpan, roomForBoard / bassSpan));
    this.bassRadius = this.bassPitch * 0.46;
    this.bassRowGap = this.bassPitch * BASS_ROW_GAP;

    // Stack from the bottom up; the roll takes whatever is left on top. A bass board held back
    // by the width sits in the middle of its band.
    const bandTop = height - PAD_Y - bassUnits * p;
    const boardH = (this.bassRows - 1) * this.bassRowGap + this.bassRadius * 2;
    this.bassRowsTop = bandTop + Math.max(0, (bassUnits * p - boardH) / 2);
    this.keysH = layout.piano ? KEYS_UNITS * p : 0;
    this.rhRowsTop = bandTop - p * BOARD_GAP - (layout.piano ? this.keysH : (opts.rows.length - 1) * this.rowGap + this.radius * 2);
    this.keysTop = this.rhRowsTop;

    // Default: treble row 1 on top (next to the roll), counter-bass on top (next to the bellows).
    this.rhOrder = layout.rows.map(r => r.row).filter(r => layout.piano || opts.rows.includes(r));
    this.bassOrder = bass.def.rows.map((_, i) => i);
    if (opts.flipY) {
      this.rhOrder.reverse();
      this.bassOrder.reverse();
    }
    if (layout.piano) this.rhLine.set(1, this.keysTop + this.keysH / 2);
    else this.rhOrder.forEach((row, i) => this.rhLine.set(row, this.rhRowsTop + this.radius + i * this.rowGap));
    this.bassOrder.forEach((r, i) => this.bassLine.set(r, this.bassRowsTop + this.bassRadius + i * this.bassRowGap));

    this.rollTop = PAD_Y;
    if (layout.piano) {
      // Notes land on the top edge of the keys and fall straight; the keyboard is centred.
      this.rollBottom = this.keysTop;
      this.lanesBottom = this.keysTop + this.keysH;
      this.rowStep = 1;
      this.shear = 0;
      this.rhX0 = this.left + (availW - (this.hi - this.lo + 1) * semitone) / 2;
    } else {
      const mainLines = layout.rows.filter(r => r.role === 'main').map(r => this.landY(r.row));
      this.rollBottom = Math.min(...this.rhOrder.map(r => this.landY(r)));
      this.lanesBottom = Math.max(...mainLines) + this.radius * 2;
      this.rowStep = this.rowLineY(2) - this.rowLineY(1);
      this.shear = (layout.rowShift * p) / this.rowStep;

      // Centre the whole lane fan (boards plus the leaning roll) horizontally.
      const xs = [this.lo, this.hi].flatMap(n => [this.rollTop, this.lanesBottom].map(y => this.laneXFrom(0, n, y)));
      const extent = Math.max(...xs) - Math.min(...xs) + this.lane;
      this.rhX0 = this.left + (availW - extent) / 2 + this.lane / 2 - Math.min(...xs);
    }
    this.bassX0 = this.right - meterW - meterGap - bassSpan * this.bassPitch + this.bassPitch / 2;

    // Boxes in screen space (after mirroring).
    const span = (a: number, b: number) => (opts.flipX ? { left: this.fx(b), right: this.fx(a) } : { left: a, right: b });
    const bassLeft = this.bassX0 - this.bassRadius;
    this.bassBox = {
      ...span(bassLeft, this.bassX0 + (bassSpan - 1) * this.bassPitch + this.bassRadius),
      top: this.bassRowsTop,
      bottom: this.bassRowsTop + (this.bassRows - 1) * this.bassRowGap + this.bassRadius * 2,
    };
    this.meter = { ...span(this.right - meterW, this.right), top: this.bassBox.top, bottom: this.bassBox.bottom };
    const side = { top: bandTop, bottom: height - PAD_Y };
    this.tracksBox = { ...span(this.left, this.left + TRACKS_W), ...side };
    const rollRight = bassLeft - SIDE_GAP;
    this.bassRoll = { ...span(Math.max(this.left + TRACKS_W + PANEL_GAP, rollRight - BASS_ROLL_MAX), rollRight), ...side };
    this.bassLabelX = opts.flipX ? this.bassBox.right + BASS_LABEL : this.bassBox.left - BASS_LABEL;
  }

  get flipX(): boolean {
    return this.opts.flipX;
  }

  // Mirrors x around the board area's centre when flipped left-right.
  private fx(x: number): number {
    return this.opts.flipX ? this.left + this.right - x : x;
  }

  // The keyboard as in a DAW's piano roll: every semitone gets a lane of the same width, as on
  // the button boards. A black key is exactly its lane; a white key's front reaches halfway
  // into each black neighbour's lane (so C, E, F and B are 1.5 lanes wide, D, G and A 2), and
  // behind the black keys only its own lane shows.
  private keySpan(note: number): [number, number] {
    const start = (note - this.lo) * this.lane;
    if (isBlack(note)) return [start, start + this.lane];
    return [start - (isBlack(note - 1) ? this.lane / 2 : 0), start + this.lane + (isBlack(note + 1) ? this.lane / 2 : 0)];
  }

  // Width of a note's lane: one semitone, on the button boards and the keyboard alike.
  laneW(_note: number): number {
    return this.lane;
  }

  // Half the width of a falling note.
  noteHalf(_note: number): number {
    return this.layout.piano ? this.lane * BUTTON : this.radius;
  }

  // A piano key's rectangle on screen (a white key's front part; the black keys cover the rest).
  keyRect(note: number): Box {
    const [a, b] = this.keySpan(note).map(x => this.fx(this.rhX0 + x));
    const h = isBlack(note) ? this.keysH * BLACK_H : this.keysH;
    return { left: Math.min(a, b), right: Math.max(a, b), top: this.keysTop, bottom: this.keysTop + h };
  }

  private laneXFrom(x0: number, note: number, y: number): number {
    if (this.layout.piano) return x0 + (note - this.lo + 0.5) * this.lane;
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
    if (this.layout.piano) {
      // Near the key's front end, where the hand meets it.
      const r = this.keyRect(b.note);
      return { x: (r.left + r.right) / 2, y: r.bottom - Math.min(r.bottom - r.top, this.lane * 1.2) / 2 };
    }
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
