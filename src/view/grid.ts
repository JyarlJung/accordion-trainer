import { noteName, type Layout } from '../core/layout';
import { C_MARK, ROW_COLORS, WRONG } from './colors';
import type { Geometry } from './geometry';

export interface Mark {
  fill?: string;
  ring?: string;
  cross?: boolean;
}

export interface ButtonStyle {
  base: string;
  text: string;
  landmark: boolean; // thin gold ring for orientation (C on the treble, marked bass buttons)
  fontScale?: number; // label size relative to the radius
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
  ctx.font = `600 ${r * (style.fontScale ?? (label.length > 3 ? 0.46 : 0.56))}px system-ui, sans-serif`;
  ctx.fillText(label, x, y + 0.5);

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
  marks: Map<string, Mark>, cutNote: number | null,
): void {
  if (layout.piano) {
    drawKeyboard(ctx, geo, layout, marks, cutNote);
    return;
  }
  const r = geo.radius;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Row numbers to the left of each row.
  ctx.font = `600 ${Math.max(11, r * 0.6)}px system-ui, sans-serif`;
  for (const row of layout.rows) {
    if (!geo.showsRow(row.row)) continue;
    ctx.fillStyle = ROW_COLORS[row.row] ?? '#888';
    ctx.fillText(String(row.row), geo.labelX, geo.rowLineY(row.row));
  }

  for (const b of layout.buttons) {
    if (b.note < geo.lo || b.note > geo.hi || !geo.showsRow(b.row)) continue;
    const { x, y } = geo.pos(b);
    const m = marks.get(b.id);
    const cut = cutNote !== null && b.note <= cutNote;
    // Marked buttons are drawn in full; unmarked cut-away and helper buttons dimmed.
    ctx.globalAlpha = m ? 1 : cut ? 0.3 : b.role === 'helper' ? 0.55 : 1;
    // Buttons are lane-sized, so only C carries its octave.
    const label = b.note % 12 === 0 ? noteName(b.note) : noteName(b.note).replace(/-?\d+$/, '');
    drawButton(ctx, x, y, r, label, {
      base: b.black ? '#26262b' : '#ebe7de',
      text: b.black ? '#d8d8d8' : '#222',
      landmark: b.note % 12 === 0,
      fontScale: label.length > 2 ? 0.62 : 0.8,
    }, m);
  }
  ctx.globalAlpha = 1;
}

// The piano keyboard: white keys, then the black keys over them. Marks colour a whole key; its
// ring runs inside the key's edge and a cross sits near its front end.
function drawKeyboard(
  ctx: CanvasRenderingContext2D, geo: Geometry, layout: Layout,
  marks: Map<string, Mark>, cutNote: number | null,
): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const keys = [...layout.buttons].sort((a, b) => Number(a.black) - Number(b.black));
  for (const b of keys) {
    const k = geo.keyRect(b.note);
    const w = k.right - k.left, h = k.bottom - k.top;
    const m = marks.get(b.id);
    // Keys beyond the played range are shown for reference, in darker colours with the
    // background's blue tint (not see-through, so the keys behind don't show).
    const off = !layout.playable(b.note);
    ctx.globalAlpha = m ? 1 : cutNote !== null && b.note <= cutNote ? 0.3 : 1;
    ctx.fillStyle = m?.fill ?? (off ? (b.black ? '#16161c' : '#4a4a5a') : b.black ? '#26262b' : '#ebe7de');
    ctx.fillRect(k.left, k.top, w, h);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeRect(k.left + 0.5, k.top + 0.5, w - 1, h - 1);
    if (m?.ring) {
      const lw = Math.max(2, w * 0.12);
      ctx.lineWidth = lw;
      ctx.strokeStyle = m.ring;
      ctx.strokeRect(k.left + lw / 2 + 1, k.top + lw / 2 + 1, w - lw - 2, h - lw - 2);
    }
    // Names near the front of each key; C also carries its octave and a gold bar.
    const { x, y } = geo.pos(b);
    const label = b.note % 12 === 0 ? noteName(b.note) : noteName(b.note).replace(/-?\d+$/, '');
    if (b.note % 12 === 0) {
      ctx.fillStyle = C_MARK;
      ctx.fillRect(k.left + 2, k.bottom - 4, w - 4, 2);
    }
    ctx.fillStyle = m?.fill ? '#fff' : off ? '#80808e' : b.black ? '#d8d8d8' : '#222';
    ctx.font = `600 ${Math.max(8, Math.min(13, w * (label.length > 2 ? 0.3 : 0.4)))}px system-ui, sans-serif`;
    ctx.fillText(label, x, y);
    if (m?.cross) {
      const d = Math.min(w, h) * 0.3;
      ctx.beginPath();
      ctx.moveTo(x - d, y - d);
      ctx.lineTo(x + d, y + d);
      ctx.moveTo(x + d, y - d);
      ctx.lineTo(x - d, y + d);
      ctx.lineWidth = Math.max(2, d * 0.35);
      ctx.strokeStyle = WRONG;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
