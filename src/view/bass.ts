import type { BassLayout, BassRow } from '../core/bassLayout';
import { t } from '../i18n';
import type { Geometry } from './geometry';
import { drawButton, type Mark } from './grid';

// Chord rows only: the single-note rows (counter-bass, bass) speak for themselves.
const ROW_TITLES: Record<BassRow, string> = {
  counter: '', bass: '', major: 'Maj', minor: 'min', seventh: '7th', dim: 'dim',
};

// The bass board: every button plain (no marks) for the still layer, or only the marked ones.
export function drawBass(ctx: CanvasRenderingContext2D, geo: Geometry, layout: BassLayout, marks: Map<string, Mark> | null): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (!marks) {
    ctx.font = `600 ${Math.max(10, geo.radius * 0.5)}px system-ui, sans-serif`;
    ctx.fillStyle = '#9a9aa5';
    layout.def.rows.forEach((row, i) => ctx.fillText(ROW_TITLES[row], geo.bassLabelX, geo.bassLineY(i)));
  }

  for (const b of layout.buttons) {
    const m = marks?.get(b.id);
    if (marks && !m) continue;
    const { x, y } = geo.bassPos(b);
    const single = b.row === 'bass' || b.row === 'counter';
    drawButton(ctx, x, y, geo.bassRadius * (single ? 1 : 0.86), b.label, {
      base: b.row === 'bass' ? '#ebe7de' : b.row === 'counter' ? '#cfc9bb' : '#3a3a44',
      text: single ? '#222' : '#d8d8d8',
      landmark: b.marker,
    }, m);
  }
}

// Bellows pressure (CC11) as an upright level meter at the bass board's outer side, filling from
// the bottom, with its title above it.
export function drawBellows(ctx: CanvasRenderingContext2D, geo: Geometry, pressure: number): void {
  const { left: x, top: y } = geo.meter, w = geo.meter.right - x, h = geo.meter.bottom - y;
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, w / 2);
  ctx.fill();
  const fill = h * Math.min(1, Math.max(0, pressure));
  if (fill > 0) {
    ctx.fillStyle = `hsl(${40 - pressure * 40}, 85%, 55%)`;
    ctx.beginPath();
    ctx.roundRect(x, y + h - fill, w, fill, w / 2);
    ctx.fill();
  }
  ctx.fillStyle = '#9a9aa5';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(t('pressure'), x + w / 2, y - 4);
}
