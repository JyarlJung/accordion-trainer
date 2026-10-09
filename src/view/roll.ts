import { noteName, type Layout } from '../core/layout';
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
  ctx.fillRect(x0, geo.top, x1 - x0, geo.bottom - geo.top);

  // One guide line per button height.
  const levels = [...new Set(layout.buttons.map(b => b.y))];
  ctx.lineWidth = 1;
  for (const y of levels) {
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.moveTo(x0, geo.rowY(y));
    ctx.lineTo(x1, geo.rowY(y));
    ctx.stroke();
  }

  if (s.loop) {
    const la = Math.max(x0, toX(s.loop.a)), lb = Math.min(x1, toX(s.loop.b));
    if (lb > la) {
      ctx.fillStyle = 'rgba(255,213,79,0.07)';
      ctx.fillRect(la, geo.top, lb - la, geo.bottom - geo.top);
    }
  }

  const h = geo.radius * 0.8;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.max(10, h * 0.62)}px system-ui, sans-serif`;
  for (const n of s.notes) {
    if (n.time > s.time + s.lookahead) break;
    const xa = Math.max(x0, toX(n.time));
    const xb = Math.min(x1, toX(n.time) + Math.max(n.duration * pps, 4));
    if (xb <= x0) continue;
    const b = layout.primary(n.note);
    if (!b) continue;
    const y = geo.rowY(b.y);
    const state = s.judge.state[n.id];
    ctx.globalAlpha = state === 'missed' || state === 'skipped' ? 0.35 : 1;
    ctx.fillStyle = state === 'hit' ? HIT : b.role === 'main' ? ROW_COLORS[b.row] : HELPER_ONLY;
    ctx.beginPath();
    ctx.roundRect(xa, y - h / 2, xb - xa, h, h * 0.3);
    ctx.fill();
    if (xb - xa > 30) {
      ctx.fillStyle = '#111';
      ctx.fillText(noteName(n.note), xa + 4, y + 0.5);
    }
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, geo.top - 4);
  ctx.lineTo(x0, geo.bottom + 4);
  ctx.stroke();
}
