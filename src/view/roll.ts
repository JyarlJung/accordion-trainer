import type { Judge } from '../core/judge';
import { isBlack, noteName, type Layout } from '../core/layout';
import type { BassNote, Cut, SongNote } from '../core/song';
import { HELPER_ONLY, HIT, ROW_COLORS } from './colors';
import type { Geometry } from './geometry';

export interface RollState {
  time: number;
  notes: SongNote[];
  bassNotes: BassNote[]; // the song's bass part (shown, never judged)
  judge: Judge;
  lookahead: number; // seconds of travel from the top to the highest judgment line
  loop: { a: number; b: number } | null;
  bars: number[];
  beats: number[];
  firstBar: number; // number shown for bars[0]
  cut: Cut | null; // treble lanes cut away from the right hand
  letGo: ReadonlySet<number>; // hit notes whose key was let go before they ended: shown unplayed again
  noteNames: boolean; // write each note's name on it
  bassChromatic: boolean; // bass roll lanes in semitone order instead of the board's
}

const NOTE_ALPHA = 0.5;

// Background: one diagonal lane per semitone (running on to its button), and the judgment line.
export function drawLanes(ctx: CanvasRenderingContext2D, geo: Geometry, s: RollState): void {
  const y0 = geo.rollTop, y1 = geo.lanesBottom, w = geo.lane;
  for (let note = geo.lo; note <= geo.hi; note++) {
    const a = geo.laneX(note, y0), b = geo.laneX(note, y1);
    if (isBlack(note)) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.moveTo(a - w / 2, y0);
      ctx.lineTo(a + w / 2, y0);
      ctx.lineTo(b + w / 2, y1);
      ctx.lineTo(b - w / 2, y1);
      ctx.fill();
    }
    // Gold edge on the low side of each C lane.
    const side = Math.sign(geo.laneX(note + 1, y1) - b) * (w / 2);
    ctx.strokeStyle = note % 12 === 0 ? 'rgba(201,162,39,0.5)' : 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a - side, y0);
    ctx.lineTo(b - side, y1);
    ctx.stroke();
  }

  // Bar lines (with bar numbers) and faint beat lines across the roll.
  {
    const pps = (geo.rollBottom - geo.rollTop) / s.lookahead;
    const toY = (t: number) => geo.rollBottom - (t - s.time) * pps;
    ctx.lineWidth = 1;
    for (const t of s.beats) {
      const y = toY(t);
      if (y > geo.rollBottom || y < geo.rollTop) continue;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.moveTo(geo.left, y);
      ctx.lineTo(geo.right, y);
      ctx.stroke();
    }
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    s.bars.forEach((t, i) => {
      const y = toY(t);
      if (y > geo.rollBottom || y < geo.rollTop) return;
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      ctx.moveTo(geo.left, y);
      ctx.lineTo(geo.right, y);
      ctx.stroke();
      ctx.fillStyle = '#7a7a86';
      ctx.fillText(String(s.firstBar + i), geo.labelX, y);
    });
  }

  if (s.loop) {
    const pps = (geo.rollBottom - geo.rollTop) / s.lookahead;
    const ya = Math.min(geo.rollBottom, geo.rollBottom - (s.loop.a - s.time) * pps);
    const yb = Math.max(geo.rollTop, geo.rollBottom - (s.loop.b - s.time) * pps);
    if (ya > yb) {
      ctx.fillStyle = 'rgba(255,213,79,0.06)';
      ctx.fillRect(geo.left, yb, geo.right - geo.left, ya - yb);
    }
  }

  // Cut-away lanes, dimmed down through the board; tinted teal when they go to the bass.
  if (s.cut) {
    for (let note = geo.lo; note <= Math.min(geo.hi, s.cut.note); note++) {
      const a = geo.laneX(note, y0), b = geo.laneX(note, y1);
      ctx.beginPath();
      ctx.moveTo(a - w / 2, y0);
      ctx.lineTo(a + w / 2, y0);
      ctx.lineTo(b + w / 2, y1);
      ctx.lineTo(b - w / 2, y1);
      ctx.fillStyle = 'rgba(8,8,12,0.55)';
      ctx.fill();
      if (s.cut.toBass) {
        ctx.fillStyle = 'rgba(56,190,180,0.10)';
        ctx.fill();
      }
    }
  }

  // One shared judgment line, so notes of one chord always land together.
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(geo.left, geo.rollBottom);
  ctx.lineTo(geo.right, geo.rollBottom);
  ctx.stroke();
}

// Notes: translucent, sheared along their lane, bottom edge level. A note is due when its
// bottom edge reaches the shared judgment line; its lane then leads on to its button.
export function drawNotes(ctx: CanvasRenderingContext2D, geo: Geometry, layout: Layout, s: RollState): void {
  const pps = (geo.rollBottom - geo.rollTop) / s.lookahead;
  const half = geo.radius;
  ctx.font = `600 ${Math.max(8, Math.min(11, geo.lane * 0.5))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const n of s.notes) {
    if (n.time > s.time + s.lookahead * 1.5) break;
    const b = layout.primary(n.note);
    if (!b) continue;
    const land = geo.rollBottom;
    const bottom = Math.min(land, land - (n.time - s.time) * pps);
    // A small gap keeps repeated notes of the same pitch visibly separate.
    const top = Math.max(geo.rollTop, land - (n.time + n.duration - s.time) * pps + 2);
    if (top >= bottom || bottom < geo.rollTop) continue;
    const xb = geo.laneX(n.note, bottom), xt = geo.laneX(n.note, top);
    const state = s.judge.state[n.id];
    const color = state === 'hit' && !s.letGo.has(n.id) ? HIT : b.role === 'main' ? ROW_COLORS[b.row] : HELPER_ONLY;
    const faded = state === 'missed' || state === 'skipped';

    ctx.globalAlpha = faded ? NOTE_ALPHA * 0.4 : NOTE_ALPHA;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(xt - half, top);
    ctx.lineTo(xt + half, top);
    ctx.lineTo(xb + half, bottom);
    ctx.lineTo(xb - half, bottom);
    ctx.fill();

    // Solid bottom edge, thicker once it sits on the judgment line.
    ctx.globalAlpha = faded ? 0.4 : 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = bottom >= land - 0.5 ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.moveTo(xb - half, bottom);
    ctx.lineTo(xb + half, bottom);
    ctx.stroke();

    // The name sits at the landing edge, so it stays readable as the note runs out. No octave:
    // the lane says which one.
    if (s.noteNames) {
      const y = bottom - Math.min(bottom - top, 14) / 2;
      ctx.fillStyle = '#fff';
      ctx.fillText(noteName(n.note).replace(/-?\d+$/, ''), geo.laneX(n.note, y), y);
    }
  }
  ctx.globalAlpha = 1;
}
