import type { Layout } from '../core/layout';
import type { HitResult } from '../core/judge';
import { DUPLICATE, EXPECT, HIT, LIVE, MISSED, UPCOMING } from './colors';
import { Geometry } from './geometry';
import { drawGrid, type Mark } from './grid';
import { drawRoll, type RollState } from './roll';

export interface ViewState extends RollState {
  held: ReadonlyMap<number, number>;
  showHelpers: boolean;
  mirror: boolean;
}

const UPCOMING_CHORDS = 3;
const FLASH_MS = 400;

export class Stage {
  private readonly ctx: CanvasRenderingContext2D;
  private geo: Geometry | null = null;
  private geoKey = '';
  private flashes: { note: number; kind: HitResult; at: number }[] = [];

  constructor(private readonly canvas: HTMLCanvasElement, private readonly layout: Layout) {
    this.ctx = canvas.getContext('2d')!;
  }

  flash(note: number, kind: HitResult): void {
    this.flashes.push({ note, kind, at: performance.now() });
  }

  draw(s: ViewState): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const key = `${w}x${h}:${s.mirror}`;
    if (!this.geo || key !== this.geoKey) {
      this.geo = new Geometry(this.layout, w, h, s.mirror);
      this.geoKey = key;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const now = performance.now();
    this.flashes = this.flashes.filter(f => now - f.at < FLASH_MS);

    drawRoll(ctx, this.geo, this.layout, s);
    drawGrid(ctx, this.geo, this.layout, this.buildMarks(s), s.showHelpers);
  }

  private buildMarks(s: ViewState): Map<string, Mark> {
    const marks = new Map<string, Mark>();
    const set = (id: string, m: Mark) => marks.set(id, { ...marks.get(id), ...m });
    const t = s.time;

    // Upcoming chords: numbered outlines, fading with distance.
    let k = 0;
    for (const c of s.judge.chords) {
      if (c.time <= t + 0.02) continue;
      if (k >= UPCOMING_CHORDS) break;
      for (const id of c.ids) {
        const b = this.layout.primary(s.notes[id].note);
        if (b && !marks.has(b.id)) set(b.id, { ring: UPCOMING, badge: k + 1, alpha: 1 - k * 0.25 });
      }
      k++;
    }

    // Notes that should be held right now.
    const expected = new Set<number>();
    for (const n of s.notes) {
      if (n.time > t + 0.02) break;
      if (n.time + n.duration <= t) continue;
      const [primary, ...dups] = this.layout.candidates(n.note);
      if (!primary) continue;
      expected.add(n.note);
      const state = s.judge.state[n.id];
      set(primary.id, { fill: state === 'hit' ? HIT : state === 'missed' ? MISSED : EXPECT, badge: undefined, alpha: 1 });
      if (s.showHelpers) for (const d of dups) set(d.id, { ring: DUPLICATE, alpha: 1 });
    }

    // Live input from the instrument.
    for (const note of s.held.keys()) {
      const [primary, ...dups] = this.layout.candidates(note);
      if (!primary) continue;
      if (!expected.has(note)) set(primary.id, { fill: LIVE, alpha: 1 });
      if (s.showHelpers) for (const d of dups) set(d.id, { ring: LIVE, alpha: 1 });
    }

    for (const f of this.flashes) {
      const b = this.layout.primary(f.note);
      if (b && f.kind === 'wrong') set(b.id, { cross: true, alpha: 1 });
    }
    return marks;
  }
}
