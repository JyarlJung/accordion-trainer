import { isBlack, type Layout } from '../core/layout';
import type { Judge } from '../core/judge';
import type { SongNote } from '../core/song';
import { HELPER_ONLY, HIT, ROW_COLORS } from './colors';
import type { Geometry } from './geometry';

export interface RollState {
  time: number;
  notes: SongNote[];
  judge: Judge;
  lookahead: number; // seconds of travel from the top to the highest judgment line
  loop: { a: number; b: number } | null;
  showHelpers: boolean;
}

const NOTE_ALPHA = 0.5;

// Background: one diagonal lane per semitone, and a judgment line on top of each row.
export function drawLanes(ctx: CanvasRenderingContext2D, geo: Geometry, layout: Layout, s: RollState): void {
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

  if (s.loop) {
    const pps = (geo.rollBottom - geo.rollTop) / s.lookahead;
    const ya = Math.min(geo.rollBottom, geo.rollBottom - (s.loop.a - s.time) * pps);
    const yb = Math.max(geo.rollTop, geo.rollBottom - (s.loop.b - s.time) * pps);
    if (ya > yb) {
      ctx.fillStyle = 'rgba(255,213,79,0.06)';
      ctx.fillRect(geo.left, yb, geo.right - geo.left, ya - yb);
    }
  }

  for (const row of layout.rows) {
    if (row.role !== 'main' && !s.showHelpers) continue;
    const y = geo.landY(row.row);
    ctx.globalAlpha = row.role === 'main' ? 0.55 : 0.2;
    ctx.strokeStyle = ROW_COLORS[row.row] ?? HELPER_ONLY;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(geo.left, y);
    ctx.lineTo(geo.right, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// Notes: translucent, sheared along their lane, bottom edge level. A note is due when its
// bottom edge reaches the judgment line of its own row.
export function drawNotes(ctx: CanvasRenderingContext2D, geo: Geometry, layout: Layout, s: RollState): void {
  const pps = (geo.rollBottom - geo.rollTop) / s.lookahead;
  const half = geo.radius;
  for (const n of s.notes) {
    if (n.time > s.time + s.lookahead * 1.5) break;
    const b = layout.primary(n.note);
    if (!b) continue;
    const land = geo.landY(b.row);
    const bottom = Math.min(land, land - (n.time - s.time) * pps);
    // A small gap keeps repeated notes of the same pitch visibly separate.
    const top = Math.max(geo.rollTop, land - (n.time + n.duration - s.time) * pps + 2);
    if (top >= bottom || bottom < geo.rollTop) continue;
    const xb = geo.laneX(n.note, bottom), xt = geo.laneX(n.note, top);
    const state = s.judge.state[n.id];
    const color = state === 'hit' ? HIT : b.role === 'main' ? ROW_COLORS[b.row] : HELPER_ONLY;
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
  }
  ctx.globalAlpha = 1;
}
