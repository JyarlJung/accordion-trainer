import type { BassLayout } from '../core/bassLayout';
import type { Layout } from '../core/layout';
import type { HitResult } from '../core/judge';
import { drawBass, drawBellows } from './bass';
import { DUPLICATE, EXPECT, HIT, LIVE, MISSED, ONSET } from './colors';
import { Geometry } from './geometry';
import { drawGrid, type Mark } from './grid';
import { drawLanes, drawNotes, type RollState } from './roll';

export interface ViewState extends RollState {
  held: ReadonlyMap<number, number>; // treble notes held on the instrument
  bassHeld: ReadonlyMap<number, number>;
  chordHeld: ReadonlyMap<number, number>;
  pressure: number; // bellows, 0..1
  mirror: boolean; // flip top-bottom
  mirrorX: boolean; // flip left-right
  rowGap: number; // treble row spacing, in button pitches
}

const FLASH_MS = 400;
const ONSET_FLASH = 0.12; // seconds of song time

export class Stage {
  private readonly ctx: CanvasRenderingContext2D;
  private geo: Geometry | null = null;
  private geoKey = '';
  private flashes: { note: number; kind: HitResult; at: number }[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly layout: Layout,
    private readonly bass: BassLayout,
  ) {
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
    const key = `${w}x${h}:${s.mirror}:${s.mirrorX}:${s.rowGap}`;
    if (!this.geo || key !== this.geoKey) {
      this.geo = new Geometry(this.layout, this.bass, w, h, { flipY: s.mirror, flipX: s.mirrorX, rowGap: s.rowGap });
      this.geoKey = key;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const now = performance.now();
    this.flashes = this.flashes.filter(f => now - f.at < FLASH_MS);

    drawLanes(ctx, this.geo, this.layout, s);
    drawGrid(ctx, this.geo, this.layout, this.buildMarks(s), s.showHelpers);
    drawNotes(ctx, this.geo, this.layout, s);
    drawBellows(ctx, this.geo, s.pressure);
    drawBass(ctx, this.geo, this.bass, this.buildBassMarks(s));
  }

  private buildBassMarks(s: ViewState): Map<string, Mark> {
    const marks = new Map<string, Mark>();
    // A bass note can't tell fundamental from counter-bass: fill the likely one, ring the others.
    for (const note of s.bassHeld.keys()) {
      const [primary, ...others] = this.bass.forBassNote(note);
      if (primary) marks.set(primary.id, { fill: LIVE });
      for (const b of others) if (!marks.has(b.id)) marks.set(b.id, { ring: LIVE });
    }
    const chord = this.bass.forChord(s.chordHeld.keys());
    if (chord) marks.set(chord.id, { fill: LIVE });
    return marks;
  }

  private buildMarks(s: ViewState): Map<string, Mark> {
    const marks = new Map<string, Mark>();
    const set = (id: string, m: Mark) => marks.set(id, { ...marks.get(id), ...m });
    const t = s.time;

    // Notes that should be held right now.
    const expected = new Set<number>();
    for (const n of s.notes) {
      if (n.time > t + 0.02) break;
      if (n.time + n.duration <= t) continue;
      const [primary, ...dups] = this.layout.candidates(n.note);
      if (!primary) continue;
      expected.add(n.note);
      const state = s.judge.state[n.id];
      const fill = state === 'hit' ? HIT : state === 'missed' ? MISSED : EXPECT;
      // Briefly flash at each onset so a repeated note reads as a new press.
      const onset = t - n.time < ONSET_FLASH && state !== 'hit';
      set(primary.id, { fill: onset ? ONSET : fill, ring: onset ? '#fff' : undefined, alpha: 1 });
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
