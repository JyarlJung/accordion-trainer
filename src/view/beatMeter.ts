const RANGE_MS = 50; // the track spans -RANGE_MS..+RANGE_MS
const KEEP = 8; // presses shown (and averaged)

// A small meter of how early (-) or late (+) recent presses landed against the nearest beat,
// for tuning the input delay: with the delay right, the dots gather in the middle.
export class BeatMeter {
  private readonly offsets: number[] = [];
  private readonly track: HTMLElement;
  private readonly label: HTMLElement;

  constructor(root: HTMLElement) {
    this.track = document.createElement('span');
    this.track.className = 'meter-track';
    this.label = document.createElement('span');
    this.label.className = 'mono meter-label';
    root.append(this.track, this.label);
    this.render();
  }

  push(offsetMs: number): void {
    this.offsets.push(offsetMs);
    if (this.offsets.length > KEEP) this.offsets.shift();
    this.render();
  }

  clear(): void {
    this.offsets.length = 0;
    this.render();
  }

  private render(): void {
    this.track.replaceChildren(...this.offsets.map((ms, i) => {
      const dot = document.createElement('span');
      dot.className = 'meter-dot';
      const x = Math.max(-RANGE_MS, Math.min(RANGE_MS, ms));
      dot.style.left = `${50 + (x / RANGE_MS) * 50}%`;
      dot.style.background = Math.abs(ms) <= 15 ? '#43a047' : Math.abs(ms) <= 35 ? '#ffd54f' : '#e53935';
      dot.style.opacity = String((i + 1) / this.offsets.length); // older presses fade
      return dot;
    }));
    const signed = (ms: number) => `${ms > 0 ? '+' : ''}${Math.round(ms)}`;
    const last = this.offsets[this.offsets.length - 1];
    const avg = this.offsets.reduce((a, b) => a + b, 0) / (this.offsets.length || 1);
    this.label.textContent = last === undefined ? '박 오차 –' : `${signed(last)}ms · 평균 ${signed(avg)}`;
  }
}

// Time of the beat nearest t (beats sorted ascending), or null if there are none.
export function nearestBeat(beats: number[], t: number): number | null {
  if (beats.length === 0) return null;
  let lo = 0, hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  const after = beats[Math.min(lo, beats.length - 1)], before = beats[Math.max(lo - 1, 0)];
  return t - before <= after - t ? before : after;
}
