// Song clock. Advances with wall time scaled by rate, and never passes `hold`
// (used by wait mode to stop at a chord until it is played).
export class Transport {
  time = 0;
  rate = 1;
  playing = false;
  duration = 0;
  hold: number | null = null;
  private lastMs: number | null = null;

  play(): void {
    this.playing = true;
    this.lastMs = null;
  }

  pause(): void {
    this.playing = false;
    this.lastMs = null;
  }

  seek(t: number): void {
    this.time = Math.max(0, Math.min(t, this.duration));
  }

  tick(nowMs: number): void {
    if (!this.playing) return;
    if (this.lastMs !== null) {
      let t = this.time + ((nowMs - this.lastMs) / 1000) * this.rate;
      if (this.hold !== null) t = Math.min(t, Math.max(this.hold, this.time));
      this.time = t;
    }
    this.lastMs = nowMs;
  }

  get waiting(): boolean {
    return this.playing && this.hold !== null && this.time >= this.hold;
  }
}
