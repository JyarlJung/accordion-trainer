import type { BassLayout, BassRow } from '../core/bassLayout';
import { t } from '../i18n';
import type { Geometry } from './geometry';
import { drawButton, type Mark } from './grid';

// Chord rows only: the single-note rows (counter-bass, bass) speak for themselves.
const ROW_TITLES: Record<BassRow, string> = {
  counter: '', bass: '', major: 'Maj', minor: 'min', seventh: '7th', dim: 'dim',
};

export function drawBass(ctx: CanvasRenderingContext2D, geo: Geometry, layout: BassLayout, marks: Map<string, Mark>): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = `600 ${Math.max(10, geo.radius * 0.5)}px system-ui, sans-serif`;
  ctx.fillStyle = '#9a9aa5';
  layout.def.rows.forEach((row, i) => ctx.fillText(ROW_TITLES[row], geo.bassLabelX, geo.bassLineY(i)));

  for (const b of layout.buttons) {
    const { x, y } = geo.bassPos(b);
    const single = b.row === 'bass' || b.row === 'counter';
    drawButton(ctx, x, y, geo.bassRadius * (single ? 1 : 0.86), b.label, {
      base: b.row === 'bass' ? '#ebe7de' : b.row === 'counter' ? '#cfc9bb' : '#3a3a44',
      text: single ? '#222' : '#d8d8d8',
      landmark: b.marker,
    }, marks.get(b.id));
  }
}

// Bellows pressure (CC11) drawn as a bar in the gap between the two boards, as wide as the bass
// board so the part panels beside it can use the height.
export function drawBellows(ctx: CanvasRenderingContext2D, geo: Geometry, pressure: number): void {
  const x = geo.bassBox.left, w = geo.bassBox.right - x, y = geo.meterY, h = geo.meterH;
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  const fill = w * Math.min(1, Math.max(0, pressure));
  if (fill > 0) {
    ctx.fillStyle = `hsl(${40 - pressure * 40}, 85%, 55%)`;
    ctx.beginPath();
    ctx.roundRect(x, y, fill, h, h / 2);
    ctx.fill();
  }
  ctx.fillStyle = '#9a9aa5';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(t('pressure'), geo.bassLabelX, y + h / 2);
}
