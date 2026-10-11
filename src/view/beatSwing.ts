const MARK_MS = 1200; // how long a press mark takes to fade out (set in style.css too)

// A dot that swings from one end of a small track to the other, reaching an end on every beat
// (whatever the metronome's spacing), so the beat can be seen. Right-hand presses leave a fading mark where the dot
// was when they were played: marks at the ends are on the beat. Ticks split the track in four.
export class BeatSwing {
  private readonly track: HTMLElement;
  private readonly dot: HTMLElement;

  constructor(root: HTMLElement) {
    this.track = document.createElement('span');
    this.track.className = 'swing-track';
    this.dot = document.createElement('span');
    this.dot.className = 'swing-dot';
    for (const [at, kind] of [[25, 'short'], [50, 'mid'], [75, 'short']] as const) {
      const tick = document.createElement('span');
      tick.className = `swing-tick ${kind}`;
      tick.style.left = `${at}%`;
      this.track.append(tick);
    }
    this.track.append(this.dot);
    root.append(this.track);
  }

  // Moves the dot to song time t.
  update(t: number, beats: readonly number[]): void {
    this.dot.style.left = `${position(t, beats) * 100}%`;
  }

  // Marks a press played at song time t.
  mark(t: number, beats: readonly number[]): void {
    const m = document.createElement('span');
    m.className = 'swing-mark';
    m.style.left = `${position(t, beats) * 100}%`;
    this.track.append(m);
    setTimeout(() => m.remove(), MARK_MS);
  }
}

// Where the dot is at t: at the left end on even beats, the right end on odd ones, moving evenly
// in between.
function position(t: number, beats: readonly number[]): number {
  if (beats.length < 2 || t < beats[0]) return 0;
  let lo = 0, hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (beats[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  const next = beats[lo + 1] ?? beats[lo] + (beats[lo] - beats[lo - 1]);
  const f = Math.min(1, (t - beats[lo]) / (next - beats[lo]));
  return lo % 2 === 0 ? f : 1 - f;
}
