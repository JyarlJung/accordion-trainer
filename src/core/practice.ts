import type { HitResult, Judge } from './judge';
import type { Transport } from './transport';

// Drives the clock in wait mode. It runs through each chord's hit window, so a slightly
// late press keeps the beat. If the window passes with the chord unplayed, the beat counts
// as missed: the clock jumps back to the chord's own time and holds there until it's played.
export class WaitMode {
  // Instrument input delay, seconds: presses arrive this long after they were played, so the
  // clock runs on that much longer before calling a chord missed.
  latencySec = 0;
  private missedAt: number | null = null;

  reset(): void {
    this.missedAt = null;
  }

  // Advances the clock; true when a chord was just missed and the clock jumped back to it.
  tick(judge: Judge, transport: Transport, nowMs: number): boolean {
    const due = judge.nextPendingChordTime();
    if (due === null) {
      transport.hold = null;
      transport.tick(nowMs);
      return false;
    }
    if (this.missedAt !== due) this.missedAt = null;
    const end = due + (judge.windowSec + this.latencySec) * transport.rate;
    transport.hold = this.missedAt === due ? due : end;
    transport.tick(nowMs);
    if (this.missedAt === null && transport.time >= end - 1e-9) {
      transport.time = due;
      transport.hold = due; // waiting from this frame on, not the next
      this.missedAt = due;
      return true;
    }
    return false;
  }
}

// A key press in wait mode, played `latencySec` before it arrived. A chord completed while the
// clock holds restarts from the chord's own time (the clock is normally already parked there
// after a miss); a press while the clock holds is on time whenever it comes.
export function pressInWaitMode(judge: Judge, transport: Transport, pitch: number, latencySec: number): HitResult {
  const missed = transport.waiting ? judge.nextPendingChordTime() : null;
  const played = transport.time - latencySec * transport.rate;
  const result = judge.onNoteOn(pitch, missed === null ? played : Math.max(played, missed), transport.rate);
  if (result === 'hit' && missed !== null && judge.nextPendingChordTime() !== missed) {
    transport.time = missed;
  }
  return result;
}
