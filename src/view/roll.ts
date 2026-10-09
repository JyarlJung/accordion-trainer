import { isBlack, noteName, type Layout } from '../core/layout';
import type { Judge } from '../core/judge';
import type { SongNote } from '../core/song';
import { HELPER_ONLY, HIT, ROW_COLORS } from './colors';
import type { Geometry } from './geometry';

export interface RollState {
  time: number;
  notes: SongNote[];
  judge: Judge;
  lookahead: number; // seconds visible ahead of the now line
  loop: { a: number; b: number } | null;
}

// Notes travel right-to-left and reach the now line at the height of their button.
export function drawRoll(ctx: CanvasRenderingContext2D, geo: Geometry, layout: Layout, s: RollState): void {
  const x0 = geo.rollX0, x1 = geo.rollX1;
  if (x1 - x0 < 40) return;
  const pps = (x1 - x0) / s.lookahead;
  const toX = (t: number) => x0 + (t - s.time) * pps;

  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(x0, geo.rhTop, x1 - x0, geo.rhBottom - geo.rhTop);

  // One lane per semitone, piano-roll style: black-key lanes darker, a line under each C.
  const lane = geo.pitch / 3;
  for (let note = layout.minNote; note <= layout.maxNote; note++) {
    const y = geo.rowY(layout.pitchY(note));
    if (isBlack(note)) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x0, y - lane / 2, x1 - x0, lane);
    }
    if (note % 12 === 0) {
      ctx.fillStyle = 'rgba(201,162,39,0.35)';
      ctx.fillRect(x0, y - lane / 2, x1 - x0, 1);
    }
  }

  if (s.loop) {
    const la = Math.max(x0, toX(s.loop.a)), lb = Math.min(x1, toX(s.loop.b));
    if (lb > la) {
      ctx.fillStyle = 'rgba(255,213,79,0.07)';
      ctx.fillRect(la, geo.rhTop, lb - la, geo.rhBottom - geo.rhTop);
    }
  }

  const h = lane * 0.86;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.max(9, h * 0.78)}px system-ui, sans-serif`;
  for (const n of s.notes) {
    if (n.time > s.time + s.lookahead) break;
    const xa = Math.max(x0, toX(n.time));
    // A small gap at the end keeps repeated notes of the same pitch visibly separate.
    const xb = Math.min(x1, toX(n.time) + Math.max(n.duration * pps - 2, 3));
    if (xb <= x0) continue;
    const b = layout.primary(n.note);
    if (!b) continue;
    const y = geo.rowY(layout.pitchY(n.note));
    const state = s.judge.state[n.id];
    ctx.globalAlpha = state === 'missed' || state === 'skipped' ? 0.35 : 1;
    ctx.fillStyle = state === 'hit' ? HIT : b.role === 'main' ? ROW_COLORS[b.row] : HELPER_ONLY;
    ctx.beginPath();
    ctx.roundRect(xa, y - h / 2, xb - xa, h, h * 0.3);
    ctx.fill();
    if (xb - xa > 26) {
      ctx.fillStyle = '#111';
      ctx.fillText(noteName(n.note), xa + 4, y + 0.5);
    }
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, geo.rhTop - 4);
  ctx.lineTo(x0, geo.rhBottom + 4);
  ctx.stroke();
}
