import { isBlack, type Layout } from '../core/layout';
import type { Judge } from '../core/judge';
import type { SongNote } from '../core/song';
import { HELPER_ONLY, HIT, ROW_COLORS } from './colors';
import type { Geometry } from './geometry';

export interface RollState {
  time: number;
  notes: SongNote[];
  judge: Judge;
  lookahead: number; // seconds visible above the now line
  loop: { a: number; b: number } | null;
}

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// Notes fall from the top and reach the now line directly above their button.
export function drawRoll(ctx: CanvasRenderingContext2D, geo: Geometry, layout: Layout, s: RollState): void {
  const y0 = geo.rollTop, y1 = geo.rollBottom;
  if (y1 - y0 < 30) return;
  const pps = (y1 - y0) / s.lookahead;
  const toY = (t: number) => y1 - (t - s.time) * pps;
  const lane = geo.pitch / 3;
  const lo = geo.pitchX(layout.minNote), hi = geo.pitchX(layout.maxNote);
  const xa = Math.min(lo, hi) - lane / 2, xb = Math.max(lo, hi) + lane / 2;
  const toward = Math.sign(geo.pitchX(layout.minNote + 1) - lo); // +1 when low notes are on the left

  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(xa, y0, xb - xa, y1 - y0);

  // One lane per semitone, piano-roll style: black-key lanes darker, a line on the low side of each C.
  for (let note = layout.minNote; note <= layout.maxNote; note++) {
    const x = geo.pitchX(note);
    if (isBlack(note)) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x - lane / 2, y0, lane, y1 - y0);
    }
    if (note % 12 === 0) {
      ctx.fillStyle = 'rgba(201,162,39,0.4)';
      ctx.fillRect(x - (toward * lane) / 2, y0, 1, y1 - y0);
    }
  }

  if (s.loop) {
    const la = Math.min(y1, toY(s.loop.a)), lb = Math.max(y0, toY(s.loop.b));
    if (la > lb) {
      ctx.fillStyle = 'rgba(255,213,79,0.07)';
      ctx.fillRect(xa, lb, xb - xa, la - lb);
    }
  }

  const w = lane * 0.86;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.font = `600 ${Math.max(8, Math.min(11, w * 0.5))}px system-ui, sans-serif`;
  for (const n of s.notes) {
    if (n.time > s.time + s.lookahead) break;
    const bottom = Math.min(y1, toY(n.time));
    // A small gap keeps repeated notes of the same pitch visibly separate.
    const top = Math.max(y0, toY(n.time) - Math.max(n.duration * pps - 2, 3));
    if (top >= y1) continue;
    const b = layout.primary(n.note);
    if (!b) continue;
    const x = geo.pitchX(n.note);
    const state = s.judge.state[n.id];
    ctx.globalAlpha = state === 'missed' || state === 'skipped' ? 0.35 : 1;
    ctx.fillStyle = state === 'hit' ? HIT : b.role === 'main' ? ROW_COLORS[b.row] : HELPER_ONLY;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, top, w, bottom - top, w * 0.3);
    ctx.fill();
    if (bottom - top > 16) {
      ctx.fillStyle = '#111';
      ctx.fillText(NAMES[n.note % 12], x, bottom - 2);
    }
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(xa, y1 - 1, xb - xa, 2);
}
