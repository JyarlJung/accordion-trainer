import type { KeyButton, Layout } from '../core/layout';

const PAD = 16;
const HEAD = 30;
const FOOT = 30;

// Screen placement of the button grid (left) and the note roll (right).
// The roll shares the grid's vertical axis, so each note bar lines up with its button.
export class Geometry {
  readonly pitch: number; // vertical distance between buttons in a row
  readonly radius: number;
  readonly colGap: number;
  readonly gridX0: number;
  readonly gridW: number;
  readonly top: number;
  readonly bottom: number;
  readonly rollX0: number;
  readonly rollX1: number;
  readonly order: number[]; // row numbers from left to right
  private readonly colOf = new Map<number, number>();

  constructor(layout: Layout, readonly width: number, readonly height: number, mirror: boolean) {
    const yMax = Math.max(...layout.buttons.map(b => b.y));
    this.top = PAD + HEAD;
    this.pitch = Math.max(8, (height - this.top - FOOT - PAD) / (yMax + 1));
    this.bottom = this.top + (yMax + 1) * this.pitch;
    this.radius = this.pitch * 0.46;
    this.colGap = this.pitch * 0.9;
    this.order = layout.rows.map(r => r.row);
    if (mirror) this.order.reverse();
    this.order.forEach((row, i) => this.colOf.set(row, i));
    this.gridX0 = PAD;
    this.gridW = this.colGap * (this.order.length - 1) + this.radius * 2;
    this.rollX0 = this.gridX0 + this.gridW + this.pitch * 0.6;
    this.rollX1 = width - PAD;
  }

  colX(row: number): number {
    return this.gridX0 + this.radius + (this.colOf.get(row) ?? 0) * this.colGap;
  }

  rowY(y: number): number {
    return this.top + this.pitch / 2 + y * this.pitch;
  }

  pos(b: KeyButton): { x: number; y: number } {
    return { x: this.colX(b.row), y: this.rowY(b.y) };
  }
}
