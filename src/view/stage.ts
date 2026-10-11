import type { BassButton, BassLayout } from '../core/bassLayout';
import type { Layout } from '../core/layout';
import type { HitResult } from '../core/judge';
import { CHORD_EPS, type BassNote } from '../core/song';
import { drawBass, drawBellows } from './bass';
import { drawBassRoll } from './bassRoll';
import { DUPLICATE, EXPECT, HIT, LIVE, UPCOMING, expectFill } from './colors';
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

export class Stage {
  private readonly ctx: CanvasRenderingContext2D;
  private geo: Geometry | null = null;
  private geoKey = '';
  private flashes: { note: number; kind: HitResult; at: number }[] = [];
  private rowsFor: unknown = null;
  private onsetsFor: unknown = null;
  // When each note due now was first shown (real ms), for its arrival burst. Real time, so a burst
  // still settles while practice mode holds the clock on a missed note.
  private readonly bursts = new Map<string, number>();
  private readonly burstsShown = new Set<string>();
  private frameMs = 0;
  private onsets: { time: number; end: number; notes: BassNote[] }[] = [];
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
    this.frameMs = now;
    this.burstsShown.clear();

    const geo = this.geo;
    drawLanes(ctx, geo, s);
    drawGrid(ctx, geo, this.layout, this.buildMarks(s), s.cut?.note ?? null);
    if (s.showUpcoming) this.drawMove(ctx, geo, s);
    drawNotes(ctx, geo, this.layout, s);
    drawBellows(ctx, geo, s.pressure);
    drawBass(ctx, geo, this.bass, this.buildBassMarks(s));
    // Notes no longer due forget their burst, so they burst again when next due (after a seek).
    for (const key of this.bursts.keys()) if (!this.burstsShown.has(key)) this.bursts.delete(key);
    if (s.showUpcoming) this.drawBassMoves(ctx, geo, s);
    drawBassRoll(ctx, geo, this.bass, s);
  }

  // Lines from each button to the next one, when both are single buttons. A line grows from the
  // current button as its note starts and withdraws from that end when the note ends (or the next
  // one starts), so the previous line can still be leaving while the new one grows.
  private drawMove(ctx: CanvasRenderingContext2D, geo: Geometry, s: ViewState): void {
    const chords = s.judge.chords;
    let i = chords.findIndex(c => c.time > s.time + 0.02);
    if (i < 0) i = chords.length;
    for (const k of [i - 2, i - 1]) {
      if (k < 0 || k + 1 >= chords.length || chords[k].ids.length !== 1 || chords[k + 1].ids.length !== 1) continue;
      const a = s.notes[chords[k].ids[0]], b = s.notes[chords[k + 1].ids[0]];
      const span = lineSpan(s, a.time, a.time + a.duration, b.time);
      if (!span) continue;
      const from = this.layout.primary(a.note), to = this.layout.primary(b.note);
      if (!from || !to || from === to || ![from, to].every(x => geo.showsRow(x.row) && x.note >= geo.lo && x.note <= geo.hi)) continue;
      drawMoveLine(ctx, geo.pos(from), geo.pos(to), geo.radius, span);
    }
  }

  // The bass's moves, drawn the same way: when an onset and the next are each one bass note or one
  // chord, every button of the first is joined to the nearest button of the next, so each stretch
  // of the board (the end columns repeat) shows its own way. A bass note to a chord joins only the
  // root nearest the chord; a chord to a bass note gets no line.
  private drawBassMoves(ctx: CanvasRenderingContext2D, geo: Geometry, s: ViewState): void {
    const groups = this.bassOnsets(s.bassNotes);
    let i = groups.findIndex(g => g.time > s.time + 0.02);
    if (i < 0) i = groups.length;
    for (const k of [i - 2, i - 1]) {
      if (k < 0 || k + 1 >= groups.length) continue;
      const a = groups[k], b = groups[k + 1];
      const span = lineSpan(s, a.time, a.end, b.time);
      if (!span) continue;
      const from = this.groupButtons(a.notes), to = this.groupButtons(b.notes);
      if (!from || !to || from.some(x => to.includes(x))) continue;
      const dist = (x: BassButton, y: BassButton) => {
        const p = geo.bassPos(x), q = geo.bassPos(y);
        return Math.hypot(q.x - p.x, q.y - p.y);
      };
      const nearest = (x: BassButton, among: BassButton[]) => among.reduce((m, y) => (dist(x, y) < dist(x, m) ? y : m));
      // From a chord back to a bass note: no line; the hand returns to the next root without one.
      // From a bass note to a chord: one line, from the fundamental button nearest the chord (the
      // root the chord is played over), not from every counter-bass and repeated column too.
      const isChord = (x: BassButton) => x.row !== 'bass' && x.row !== 'counter';
      if (isChord(from[0]) && !isChord(to[0])) continue;
      const roots = from.filter(x => x.row === 'bass');
      if (isChord(to[0]) && roots.length) {
        const pairs = roots.map(x => [x, nearest(x, to)] as const);
        const [x, y] = pairs.reduce((m, p) => (dist(...p) < dist(...m) ? p : m));
        drawMoveLine(ctx, geo.bassPos(x), geo.bassPos(y), geo.bassRadius, span);
        continue;
      }
      for (const x of from) drawMoveLine(ctx, geo.bassPos(x), geo.bassPos(nearest(x, to)), geo.bassRadius, span);
    }
  }

  // The bass notes grouped by onset, with when each group starts and stops sounding.
  private bassOnsets(notes: BassNote[]): { time: number; end: number; notes: BassNote[] }[] {
    if (notes === this.onsetsFor) return this.onsets;
    this.onsetsFor = notes;
    this.onsets = [];
    for (const n of notes) {
      const last = this.onsets[this.onsets.length - 1];
      if (last && n.time - last.time < CHORD_EPS) {
        last.notes.push(n);
        last.end = Math.max(last.end, n.time + n.duration);
      } else {
        this.onsets.push({ time: n.time, end: n.time + n.duration, notes: [n] });
      }
    }
    return this.onsets;
  }

  // The fill of a note due now: its arrival burst, timed from the frame it was first shown (so it
  // starts bright on that frame, not a frame later).
  private dueFill(key: string): string {
    const at = this.bursts.get(key) ?? this.frameMs;
    this.bursts.set(key, at);
    this.burstsShown.add(key);
    return expectFill((this.frameMs - at) / 1000);
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

    const mark = (b: BassButton, held: boolean, key: string) => {
      const due = this.dueFill(key);
      set(b.id, { fill: held ? HIT : due });
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
      for (const b of this.bass.forBassNote(n.note)) mark(b, held, `b${n.id}`);
    }
    const chord = chordOf(now);
    const chordHeld = chord.some(b => b.id === heldChord?.id);
    const chordKey = `c${Math.max(...now.filter(n => n.chord).map(n => n.time))}`;
    for (const b of chord) mark(b, chordHeld, chordKey);

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
        if (b) set(b.id, { ring: UPCOMING });
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
      // Green while played right (a key let go early counts as unplayed again); otherwise due,
      // missed or not (practice mode never misses: it waits).
      const played = s.judge.state[n.id] === 'hit' && !s.letGo.has(n.id);
      const due = this.dueFill(`t${n.id}`); // kept while green, so letting go doesn't burst again
      set(primary.id, { fill: played ? HIT : due });
      if (s.showHelpers) for (const d of dups) set(d.id, { ring: DUPLICATE });
    }

    // Live input from the instrument.
    for (const note of s.held.keys()) {
      const [primary, ...dups] = this.layout.candidates(note);
      if (!primary) continue;
      if (!expected.has(note)) set(primary.id, { fill: LIVE });
      if (s.showHelpers) for (const d of dups) set(d.id, { ring: LIVE });
    }

    // Wrong notes get a cross in practice mode; in play mode they just show as pressed.
    if (s.practice) {
      for (const f of this.flashes) {
        const b = this.layout.primary(f.note);
        if (b && f.kind === 'wrong') set(b.id, { cross: true });
      }
    }
    return marks;
  }
}

type Point = { x: number; y: number };

const GROW_SHARE = 0.4; // of the time to the next onset, for a line to reach its button
const GROW_MAX = 0.25; // s of real time: the longest a line takes to reach the next button

// How much of the line from an onset (at `start`, sounding until `end`) to the next (at `next`) is
// showing, as fractions from the first button's edge: it grows over 40% of the time to the next
// onset (but no slower than GROW_MAX), so quick back-and-forth moves leave a visible gap, and
// withdraws, from the first end, at the same pace once the note stops. Null when none of it shows.
function lineSpan(s: ViewState, start: number, end: number, next: number): { from: number; to: number } | null {
  const pace = Math.max(1e-3, Math.min((next - start) * GROW_SHARE, GROW_MAX * s.rate));
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const to = clamp((s.time - start) / pace);
  const from = clamp((s.time - Math.min(end, next)) / pace);
  return to > from ? { from, to } : null;
}

// A line from the edge of one button towards the edge of the next (radius r), the `span` part of
// it showing, fading from the colour of a note due now to the next button's. Drawn over the
// board, so it may cover the buttons it crosses, but never the two it joins.
function drawMoveLine(ctx: CanvasRenderingContext2D, a: Point, b: Point, r: number, span: { from: number; to: number }): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len <= r * 2) return; // touching: nothing between the edges
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  const x0 = a.x + ux * r, y0 = a.y + uy * r;
  const x1 = b.x - ux * r, y1 = b.y - uy * r;
  const at = (f: number) => [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f] as const;
  const fade = ctx.createLinearGradient(x0, y0, x1, y1);
  fade.addColorStop(0, EXPECT);
  fade.addColorStop(1, UPCOMING);
  ctx.save();
  ctx.strokeStyle = fade;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = Math.max(2, r * 0.3);
  ctx.beginPath();
  ctx.moveTo(...at(span.from));
  ctx.lineTo(...at(span.to));
  ctx.stroke();
  ctx.restore();
}
