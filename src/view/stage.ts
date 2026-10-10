import type { BassLayout } from '../core/bassLayout';
import type { Layout } from '../core/layout';
import type { HitResult } from '../core/judge';
import type { SongNote } from '../core/song';
import { drawBass, drawBellows } from './bass';
import { DUPLICATE, EXPECT, HIT, LIVE, MISSED, ONSET, UPCOMING } from './colors';
import { Geometry } from './geometry';
import { drawGrid, type Mark } from './grid';
import { drawLanes, drawNotes, type RollState } from './roll';

export interface ViewState extends RollState {
  bassNotes: SongNote[]; // the song's bass part (shown, never judged)
  held: ReadonlyMap<number, number>; // treble notes held on the instrument
  bassHeld: ReadonlyMap<number, number>;
  chordHeld: ReadonlyMap<number, number>;
  pressure: number; // bellows, 0..1
  showHelpers: boolean; // rows 4-5
  showUpcoming: boolean; // outline the next chord's buttons
  mirror: boolean; // flip top-bottom
  mirrorX: boolean; // flip left-right
  rowGap: number; // treble row spacing, in button pitches
  range: { lo: number; hi: number } | null; // treble notes to show; null = all
}

const FLASH_MS = 400;
const ONSET_FLASH = 0.12; // seconds of song time

export class Stage {
  private readonly ctx: CanvasRenderingContext2D;
  private geo: Geometry | null = null;
  private geoKey = '';
  private flashes: { note: number; kind: HitResult; at: number }[] = [];
  private rowsFor: unknown = null;
  private neededRows = new Set<number>();
  onLayout?: (geo: Geometry) => void; // called whenever the board is laid out anew

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly layout: Layout,
    private readonly bass: BassLayout,
  ) {
    // Low-latency canvas: presented without waiting in the compositor queue. Opaque, so each
    // frame paints its own background.
    this.ctx = canvas.getContext('2d', { desynchronized: true, alpha: false })!;
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
    const rows = this.visibleRows(s);
    const key = `${w}x${h}:${s.mirror}:${s.mirrorX}:${s.rowGap}:${s.range?.lo}-${s.range?.hi}:${rows}`;
    if (!this.geo || key !== this.geoKey) {
      this.geo = new Geometry(this.layout, this.bass, w, h, { flipY: s.mirror, flipX: s.mirrorX, rowGap: s.rowGap, range: s.range, rows });
      this.geoKey = key;
      this.onLayout?.(this.geo);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#16161b';
    ctx.fillRect(0, 0, w, h);

    const now = performance.now();
    this.flashes = this.flashes.filter(f => now - f.at < FLASH_MS);

    drawLanes(ctx, this.geo, s);
    drawGrid(ctx, this.geo, this.layout, this.buildMarks(s));
    drawNotes(ctx, this.geo, this.layout, s);
    drawBellows(ctx, this.geo, s.pressure);
    drawBass(ctx, this.geo, this.bass, this.buildBassMarks(s));
  }

  // Helper rows fold away when hidden, except a row the song needs (a note only it has).
  private visibleRows(s: ViewState): number[] {
    if (s.notes !== this.rowsFor) {
      this.rowsFor = s.notes;
      this.neededRows = new Set(s.notes.map(n => this.layout.primary(n.note)?.row ?? 0));
    }
    return this.layout.rows
      .filter(r => r.role === 'main' || s.showHelpers || this.neededRows.has(r.row))
      .map(r => r.row);
  }

  private buildBassMarks(s: ViewState): Map<string, Mark> {
    const marks = new Map<string, Mark>();
    const set = (id: string, m: Mark) => marks.set(id, { ...marks.get(id), ...m });
    const t = s.time;
    const heldPcs = new Set([...s.bassHeld.keys()].map(n => n % 12));

    // The song's bass, marked like the treble but not judged: holding the right pitch just
    // turns its buttons green. Fundamental and counter-bass are both main buttons; the
    // instrument sends the same note for either, so there's no telling which was pressed.
    if (s.showUpcoming) {
      const next = s.bassNotes.find(n => n.time > t + 0.02);
      for (const b of next ? this.bass.mainButtons(next.note) : []) set(b.id, { ring: UPCOMING });
    }
    const expected = new Set<number>(); // pitch classes
    for (const n of s.bassNotes) {
      if (n.time > t + 0.02) break;
      if (n.time + n.duration <= t) continue;
      const pc = n.note % 12;
      expected.add(pc);
      const held = heldPcs.has(pc);
      const onset = t - n.time < ONSET_FLASH && !held;
      const mark = { fill: held ? HIT : onset ? ONSET : EXPECT, ring: onset ? '#fff' : undefined };
      for (const b of this.bass.mainButtons(n.note)) set(b.id, mark);
    }

    // Live input. A bass note can't tell fundamental from counter-bass: fill the likely one, ring the others.
    for (const note of s.bassHeld.keys()) {
      if (expected.has(note % 12)) continue;
      const [primary, ...others] = this.bass.forBassNote(note);
      if (primary) set(primary.id, { fill: LIVE });
      for (const b of others) if (!marks.has(b.id)) set(b.id, { ring: LIVE });
    }
    const chord = this.bass.forChord(s.chordHeld.keys());
    if (chord) set(chord.id, { fill: LIVE });
    return marks;
  }

  private buildMarks(s: ViewState): Map<string, Mark> {
    const marks = new Map<string, Mark>();
    const set = (id: string, m: Mark) => marks.set(id, { ...marks.get(id), ...m });
    const t = s.time;

    // The very next chord's buttons get an outline.
    if (s.showUpcoming) {
      const next = s.judge.chords.find(c => c.time > t + 0.02);
      for (const id of next?.ids ?? []) {
        const b = this.layout.primary(s.notes[id].note);
        if (b) set(b.id, { ring: UPCOMING, alpha: 1 });
      }
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
      const fill = state === 'hit' ? HIT : state === 'missed' ? MISSED : EXPECT;
      // Briefly flash at each onset so a repeated note reads as a new press.
      const onset = t - n.time < ONSET_FLASH && state !== 'hit';
      set(primary.id, { fill: onset ? ONSET : fill, ring: onset ? '#fff' : undefined, badge: undefined, alpha: 1 });
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
