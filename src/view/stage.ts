import type { BassButton, BassLayout } from '../core/bassLayout';
import type { Layout } from '../core/layout';
import type { HitResult } from '../core/judge';
import { CHORD_EPS, type BassNote } from '../core/song';
import { drawBass, drawBellows } from './bass';
import { drawBassRoll } from './bassRoll';
import { DUPLICATE, EXPECT, HIT, LIVE, MISSED, ONSET, UPCOMING } from './colors';
import { Geometry } from './geometry';
import { drawGrid, type Mark } from './grid';
import { drawLanes, drawNotes, type RollState } from './roll';

export interface ViewState extends RollState {
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
const MIN_W = 320;
const MIN_H = 240;
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

  // The treble lane under a point of the roll or board, or null.
  laneAt(x: number, y: number): number | null {
    const geo = this.geo;
    if (!geo || y < geo.rollTop || y > geo.lanesBottom) return null;
    for (let note = geo.lo; note <= geo.hi; note++) {
      if (Math.abs(geo.laneX(note, y) - x) <= geo.lane / 2) return note;
    }
    return null;
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
    // Too small to lay out (e.g. a hidden or minimised window): the layout would go negative.
    if (w < MIN_W || h < MIN_H) return;
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

    const geo = this.geo;
    drawLanes(ctx, geo, s);
    drawGrid(ctx, geo, this.layout, this.buildMarks(s), s.cut?.note ?? null);
    if (s.showUpcoming) this.drawMove(ctx, geo, s);
    drawNotes(ctx, geo, this.layout, s);
    drawBellows(ctx, geo, s.pressure);
    drawBass(ctx, geo, this.bass, this.buildBassMarks(s));
    if (s.showUpcoming) this.drawBassMoves(ctx, geo, s);
    drawBassRoll(ctx, geo, this.bass, s);
  }

  // A line from the current button to the next one, when both are single buttons.
  private drawMove(ctx: CanvasRenderingContext2D, geo: Geometry, s: ViewState): void {
    const chords = s.judge.chords;
    const i = chords.findIndex(c => c.time > s.time + 0.02);
    if (i < 1 || chords[i - 1].ids.length !== 1 || chords[i].ids.length !== 1) return;
    const from = this.layout.primary(s.notes[chords[i - 1].ids[0]].note);
    const to = this.layout.primary(s.notes[chords[i].ids[0]].note);
    if (!from || !to || from === to || ![from, to].every(b => geo.showsRow(b.row) && b.note >= geo.lo && b.note <= geo.hi)) return;
    drawMoveLine(ctx, geo.pos(from), geo.pos(to), geo.radius);
  }

  // The bass's moves: when the current and the next onset are each one bass note or one chord,
  // every button of the current one is joined to the nearest button of the next, so each stretch of
  // the board (the end columns repeat) shows its own way.
  private drawBassMoves(ctx: CanvasRenderingContext2D, geo: Geometry, s: ViewState): void {
    const notes = s.bassNotes;
    const j = notes.findIndex(n => n.time > s.time + 0.02);
    if (j < 1) return;
    const next = notes.filter((n, k) => k >= j && n.time - notes[j].time < CHORD_EPS);
    const now = notes.filter((n, k) => k < j && notes[j - 1].time - n.time < CHORD_EPS);
    const from = this.groupButtons(now), to = this.groupButtons(next);
    if (!from || !to || from.some(b => to.includes(b))) return;
    for (const b of from) {
      const a = geo.bassPos(b);
      const nearest = to.map(t => geo.bassPos(t)).reduce((p, q) => (Math.hypot(q.x - a.x, q.y - a.y) < Math.hypot(p.x - a.x, p.y - a.y) ? q : p));
      drawMoveLine(ctx, a, nearest, geo.bassRadius);
    }
  }

  // Every button that plays an onset of the bass, if it's a single bass note or a single chord.
  private groupButtons(group: BassNote[]): BassButton[] | null {
    const bassNotes = group.filter(n => !n.chord), tones = group.filter(n => n.chord);
    if (bassNotes.length === 1 && tones.length === 0) return this.bass.forBassNote(bassNotes[0].note);
    if (bassNotes.length > 0) return null;
    const chord = this.bass.forChord(tones.map(n => n.note));
    return chord ? this.bass.twins(chord) : null;
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
    const heldChord = this.bass.forChord(s.chordHeld.keys());

    // The song's bass, marked like the treble but not judged: holding the right button just
    // turns it green. Every button that sounds the note is marked alike: a bass note lights all its
    // fundamental and counter-bass buttons (the instrument sends the same note for any of them, and
    // the board repeats its end columns); chord tones light every button of the chord they make.
    const chordOf = (notes: BassNote[]) => {
      const b = this.bass.forChord(notes.filter(n => n.chord).map(n => n.note));
      return b ? this.bass.twins(b) : [];
    };
    if (s.showUpcoming) {
      const i = s.bassNotes.findIndex(n => n.time > t + 0.02);
      const group: BassNote[] = [];
      for (let j = i; j >= 0 && j < s.bassNotes.length && s.bassNotes[j].time - s.bassNotes[i].time < CHORD_EPS; j++) {
        group.push(s.bassNotes[j]);
      }
      for (const n of group) if (!n.chord) for (const b of this.bass.forBassNote(n.note)) set(b.id, { ring: UPCOMING });
      for (const b of chordOf(group)) set(b.id, { ring: UPCOMING });
    }

    const mark = (b: BassButton, held: boolean, since: number) => {
      const onset = t - since < ONSET_FLASH && !held;
      set(b.id, { fill: held ? HIT : onset ? ONSET : EXPECT, ring: onset ? '#fff' : undefined });
    };
    const expected = new Set<number>(); // pitch classes of the bass notes due now
    const now: BassNote[] = [];
    for (const n of s.bassNotes) {
      if (n.time > t + 0.02) break;
      if (n.time + n.duration <= t) continue;
      now.push(n);
      if (n.chord) continue;
      expected.add(n.note % 12);
      const held = heldPcs.has(n.note % 12);
      for (const b of this.bass.forBassNote(n.note)) mark(b, held, n.time);
    }
    const chord = chordOf(now);
    const chordHeld = chord.some(b => b.id === heldChord?.id);
    const chordSince = Math.max(...now.filter(n => n.chord).map(n => n.time));
    for (const b of chord) mark(b, chordHeld, chordSince);

    // Live input. A pressed button can't be told from the others with the same note: all light up.
    for (const note of s.bassHeld.keys()) {
      if (expected.has(note % 12)) continue;
      for (const b of this.bass.forBassNote(note)) set(b.id, { fill: LIVE });
    }
    if (heldChord && !chordHeld) for (const b of this.bass.twins(heldChord)) set(b.id, { fill: LIVE });
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
      const state = s.judge.state[n.id] === 'hit' && s.letGo.has(n.id) ? 'pending' : s.judge.state[n.id];
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

type Point = { x: number; y: number };

// A line from the edge of one button to the edge of the next (radius r), fading from the colour
// of a note due now to the next button's. Drawn over the board, so it may cover the buttons it
// crosses, but never the two it joins.
function drawMoveLine(ctx: CanvasRenderingContext2D, a: Point, b: Point, r: number): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len <= r * 2) return; // touching: nothing between the edges
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  const x0 = a.x + ux * r, y0 = a.y + uy * r;
  const x1 = b.x - ux * r, y1 = b.y - uy * r;
  const fade = ctx.createLinearGradient(x0, y0, x1, y1);
  fade.addColorStop(0, EXPECT);
  fade.addColorStop(1, UPCOMING);
  ctx.save();
  ctx.strokeStyle = fade;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = Math.max(2, r * 0.3);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}
