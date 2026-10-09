import { noteName, type Layout } from '../core/layout';
import { C_MARK, ROW_COLORS, WRONG } from './colors';
import type { Geometry } from './geometry';

export interface Mark {
  fill?: string;
  ring?: string;
  badge?: number; // order of an upcoming chord (1 = next)
  cross?: boolean;
  alpha?: number;
}

export interface ButtonStyle {
  base: string;
  text: string;
  landmark: boolean; // thin gold ring for orientation (C on the treble, marked bass buttons)
}

// Draws one round button with its label and any overlay mark. Shared by the treble and bass boards.
export function drawButton(
  ctx: CanvasRenderingContext2D, x: number, y: number, r: number,
  label: string, style: ButtonStyle, m: Mark | undefined,
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = m?.fill ?? style.base;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.stroke();

  if (style.landmark) {
    ctx.beginPath();
    ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = C_MARK;
    ctx.stroke();
  }

  if (m?.ring) {
    const lw = r * 0.22;
    ctx.beginPath();
    ctx.arc(x, y, r - lw / 2, 0, Math.PI * 2);
    ctx.lineWidth = lw;
    ctx.strokeStyle = m.ring;
    ctx.stroke();
  }

  ctx.fillStyle = m?.fill ? '#fff' : style.text;
  ctx.font = `600 ${r * (label.length > 3 ? 0.46 : 0.56)}px system-ui, sans-serif`;
  ctx.fillText(label, x, y + 0.5);

  if (m?.badge) {
    const bx = x + r * 0.72, by = y - r * 0.72, br = r * 0.36;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${br * 1.3}px system-ui, sans-serif`;
    ctx.fillText(String(m.badge), bx, by + 0.5);
  }

  if (m?.cross) {
    const d = r * 0.6;
    ctx.beginPath();
    ctx.moveTo(x - d, y - d);
    ctx.lineTo(x + d, y + d);
    ctx.moveTo(x + d, y - d);
    ctx.lineTo(x - d, y + d);
    ctx.lineWidth = r * 0.2;
    ctx.strokeStyle = WRONG;
    ctx.stroke();
  }
}

export function drawGrid(
  ctx: CanvasRenderingContext2D, geo: Geometry, layout: Layout,
  marks: Map<string, Mark>, showHelpers: boolean,
): void {
  const r = geo.radius;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Row numbers on top, edge/bellows labels at the bottom.
  ctx.font = `600 ${Math.max(11, r * 0.6)}px system-ui, sans-serif`;
  for (const row of layout.rows) {
    ctx.fillStyle = ROW_COLORS[row.row] ?? '#888';
    ctx.fillText(String(row.row), geo.colX(row.row), geo.rhTop - 14);
  }
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillStyle = '#9a9aa5';
  const edgeLeft = geo.order[0] === layout.rows[0].row;
  ctx.textAlign = 'left';
  ctx.fillText(edgeLeft ? '◀ 가장자리' : '◀ 주름상자', geo.gridX0, geo.bottom + 16);
  ctx.textAlign = 'right';
  ctx.fillText(edgeLeft ? '주름상자 ▶' : '가장자리 ▶', geo.gridX0 + geo.gridW, geo.bottom + 34);
  ctx.textAlign = 'center';

  for (const b of layout.buttons) {
    const { x, y } = geo.pos(b);
    const m = marks.get(b.id);
    ctx.globalAlpha = m?.alpha ?? (b.role === 'helper' && !m ? (showHelpers ? 0.55 : 0.18) : 1);
    drawButton(ctx, x, y, r, noteName(b.note), {
      base: b.black ? '#26262b' : '#ebe7de',
      text: b.black ? '#d8d8d8' : '#222',
      landmark: b.note % 12 === 0,
    }, m);
  }
  ctx.globalAlpha = 1;
}
