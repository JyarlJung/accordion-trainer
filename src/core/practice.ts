import type { HitResult, Judge } from './judge';
import type { Transport } from './transport';

// Drives the clock in wait mode. It runs through each chord's hit window, so a slightly
// late press keeps the beat. If the window passes with the chord unplayed, the beat counts
// as missed: the clock jumps back to the chord's own time and holds there until it's played.
export class WaitMode {
  private missedAt: number | null = null;

  reset(): void {
    this.missedAt = null;
  }

  tick(judge: Judge, transport: Transport, nowMs: number): void {
    const due = judge.nextPendingChordTime();
    if (due === null) {
      transport.hold = null;
      transport.tick(nowMs);
      return;
    }
    if (this.missedAt !== due) this.missedAt = null;
    const end = due + judge.windowSec * transport.rate;
    transport.hold = this.missedAt === due ? due : end;
    transport.tick(nowMs);
    if (this.missedAt === null && transport.time >= end - 1e-9) {
      transport.time = due;
      this.missedAt = due;
    }
  }
}

// A key press in wait mode. A chord completed while the clock holds restarts from the chord's
// own time (the clock is normally already parked there after a miss).
export function pressInWaitMode(judge: Judge, transport: Transport, pitch: number): HitResult {
  const missed = transport.waiting ? judge.nextPendingChordTime() : null;
  const result = judge.onNoteOn(pitch, transport.time, transport.rate);
  if (result === 'hit' && missed !== null && judge.nextPendingChordTime() !== missed) {
    transport.time = missed;
  }
  return result;
}
