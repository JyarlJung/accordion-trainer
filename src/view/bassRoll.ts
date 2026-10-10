import { bassName, type BassLayout } from '../core/bassLayout';
import { BASS_NOTE, BASS_ROLL } from './colors';
import type { Geometry } from './geometry';
import type { RollState } from './roll';

const NOTE_ALPHA = 0.5;
const LABEL_H = 18; // lane names under the judgment line

// The bass part's own roll beside the bass board. One lane per pitch class (the bass has no
// octaves), in the board's column order around C, so moving across lanes is moving along the
// board. Notes fall at the treble's speed, so both hands' rhythms read alike.
export function drawBassRoll(ctx: CanvasRenderingContext2D, geo: Geometry, bass: BassLayout, s: RollState): void {
  const box = geo.bassRoll;
  const w = box.right - box.left;
  const top = box.top, land = box.bottom - LABEL_H;
  if (w <= 0 || land <= top) return;
  const lanes = bass.laneOrder();
  if (geo.flipX) lanes.reverse();
  const laneW = w / lanes.length;
  const laneOf = new Map(lanes.map((pc, i) => [pc, i]));
  const pps = (geo.rollBottom - geo.rollTop) / s.lookahead;
  const toY = (t: number) => land - (t - s.time) * pps;
  const horizon = s.time + (land - top) / pps;

  ctx.save();
  ctx.beginPath();
  ctx.rect(box.left, top, w, land - top);
  ctx.clip();
  ctx.fillStyle = BASS_ROLL;
  ctx.fillRect(box.left, top, w, land - top);

  ctx.lineWidth = 1;
  lanes.forEach((pc, i) => {
    const x = box.left + i * laneW;
    if (pc === 0) {
      ctx.fillStyle = 'rgba(201,162,39,0.07)'; // C, as on the treble lanes
      ctx.fillRect(x, top, laneW, land - top);
    }
    if (i === 0) return;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, land);
    ctx.stroke();
  });

  // Bar and beat lines, as on the treble roll.
  const rule = (times: number[], style: string) => {
    ctx.strokeStyle = style;
    for (const t of times) {
      const y = toY(t);
      if (y < top || y > land) continue;
      ctx.beginPath();
      ctx.moveTo(box.left, y);
      ctx.lineTo(box.right, y);
      ctx.stroke();
    }
  };
  rule(s.beats, 'rgba(255,255,255,0.06)');
  rule(s.bars, 'rgba(255,255,255,0.22)');
  if (s.loop) {
    const ya = Math.min(land, toY(s.loop.a)), yb = Math.max(top, toY(s.loop.b));
    if (ya > yb) {
      ctx.fillStyle = 'rgba(255,213,79,0.06)';
      ctx.fillRect(box.left, yb, w, ya - yb);
    }
  }

  // A bass note and a chord tone can share a pitch class; draw that lane once.
  let groupTime = -Infinity;
  const drawn = new Set<number>();
  for (const n of s.bassNotes) {
    if (n.time > horizon) break;
    const pc = ((n.note % 12) + 12) % 12;
    if (n.time !== groupTime) {
      groupTime = n.time;
      drawn.clear();
    }
    if (drawn.has(pc)) continue;
    drawn.add(pc);
    const bottom = Math.min(land, toY(n.time));
    const blockTop = Math.max(top, toY(n.time + n.duration) + 2);
    if (blockTop >= bottom) continue;
    const x = box.left + laneOf.get(pc)! * laneW + 3, bw = laneW - 6;
    ctx.globalAlpha = NOTE_ALPHA;
    ctx.fillStyle = BASS_NOTE;
    ctx.fillRect(x, blockTop, bw, bottom - blockTop);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = BASS_NOTE;
    ctx.lineWidth = bottom >= land - 0.5 ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.moveTo(x, bottom);
    ctx.lineTo(x + bw, bottom);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(box.left, land);
  ctx.lineTo(box.right, land);
  ctx.stroke();

  // Lane names; the ones sounding now light up.
  const now = new Set<number>();
  for (const n of s.bassNotes) {
    if (n.time > s.time + 0.02) break;
    if (n.time + n.duration > s.time) now.add(((n.note % 12) + 12) % 12);
  }
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lanes.forEach((pc, i) => {
    ctx.fillStyle = now.has(pc) ? '#fff' : '#7a7a86';
    ctx.fillText(bassName(pc), box.left + (i + 0.5) * laneW, land + LABEL_H / 2 + 1);
  });
}
