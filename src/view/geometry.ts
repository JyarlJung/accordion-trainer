import type { BassButton, BassLayout } from '../core/bassLayout';
import type { KeyButton, Layout } from '../core/layout';

const PAD = 16;
const HEAD = 30;
const FOOT = 30;

// Screen placement, left to right: bass panel, bellows meter, treble grid, note roll.
// Like the opened-up instrument, both boards face the bellows in the middle by default.
// Both boards share one button pitch; the roll shares the treble grid's vertical axis.
export class Geometry {
  readonly pitch: number; // vertical distance between buttons in a row
  readonly radius: number;
  readonly colGap: number;
  readonly top: number;
  readonly bottom: number;
  readonly bassX0: number;
  readonly bassW: number;
  readonly meterX0: number;
  readonly meterW: number;
  readonly gridX0: number;
  readonly gridW: number;
  readonly rhTop: number;
  readonly rhBottom: number;
  readonly rollX0: number;
  readonly rollX1: number;
  readonly order: number[]; // treble row numbers from left to right
  readonly bassOrder: number[]; // bass row indices from left to right
  private readonly colOf = new Map<number, number>();
  private readonly bassColOf = new Map<number, number>();
  private readonly bassSlant: number;
  private readonly bassRows: number;

  constructor(layout: Layout, bass: BassLayout, readonly width: number, readonly height: number, mirror: boolean) {
    const rhLevels = Math.max(...layout.buttons.map(b => b.y)) + 1;
    this.bassRows = bass.def.rows.length;
    this.bassSlant = bass.def.rowSlant;
    const bassLevels = bass.columns + this.bassSlant * (this.bassRows - 1);
    const levels = Math.max(rhLevels, bassLevels);

    this.top = PAD + HEAD;
    this.pitch = Math.max(8, (height - this.top - FOOT - PAD) / levels);
    this.bottom = this.top + levels * this.pitch;
    this.rhTop = this.top + ((levels - rhLevels) * this.pitch) / 2;
    this.rhBottom = this.rhTop + rhLevels * this.pitch;
    this.radius = this.pitch * 0.46;
    this.colGap = this.pitch * 0.9;

    // Default: bass rows ordered outer -> bellows, treble rows bellows -> edge.
    this.bassOrder = bass.def.rows.map((_, i) => i).reverse();
    this.order = layout.rows.map(r => r.row).reverse();
    if (mirror) {
      this.bassOrder.reverse();
      this.order.reverse();
    }
    this.bassOrder.forEach((r, i) => this.bassColOf.set(r, i));
    this.order.forEach((row, i) => this.colOf.set(row, i));

    const gap = this.pitch * 0.5;
    this.bassX0 = PAD;
    this.bassW = this.colGap * (this.bassRows - 1) + this.radius * 2;
    this.meterX0 = this.bassX0 + this.bassW + gap;
    this.meterW = this.pitch * 0.45;
    this.gridX0 = this.meterX0 + this.meterW + gap;
    this.gridW = this.colGap * (this.order.length - 1) + this.radius * 2;
    this.rollX0 = this.gridX0 + this.gridW + this.pitch * 0.6;
    this.rollX1 = width - PAD;
  }

  colX(row: number): number {
    return this.gridX0 + this.radius + (this.colOf.get(row) ?? 0) * this.colGap;
  }

  rowY(y: number): number {
    return this.rhTop + this.pitch / 2 + y * this.pitch;
  }

  pos(b: KeyButton): { x: number; y: number } {
    return { x: this.colX(b.row), y: this.rowY(b.y) };
  }

  bassColX(rowIndex: number): number {
    return this.bassX0 + this.radius + (this.bassColOf.get(rowIndex) ?? 0) * this.colGap;
  }

  bassPos(b: BassButton): { x: number; y: number } {
    // Rows further from the bellows sit higher, following the board's slant.
    const y = b.col + (this.bassRows - 1 - b.rowIndex) * this.bassSlant;
    return { x: this.bassColX(b.rowIndex), y: this.top + this.pitch / 2 + y * this.pitch };
  }
}
