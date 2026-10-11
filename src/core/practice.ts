import type { HitResult } from './judge';
import type { Transport } from './transport';

// A part the clock waits for: the right hand's judge, and the bass's when it's waited for too.
export interface Waited {
  windowSec: number;
  nextPendingChordTime(): number | null;
}

// The earliest time any of the parts still has something to play.
function nextDue(parts: Waited[]): number | null {
  let due: number | null = null;
  for (const p of parts) {
    const t = p.nextPendingChordTime();
    if (t !== null && (due === null || t < due)) due = t;
  }
  return due;
}

// Drives the clock in wait mode. It runs through each chord's hit window, so a slightly
// late press keeps the beat. With several parts waited for, a chord is everything due at that
// time in all of them. If the window passes with the chord unplayed, the beat counts
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
  tick(parts: Waited[], transport: Transport, nowMs: number): boolean {
    const due = nextDue(parts);
    if (due === null) {
      transport.hold = null;
      transport.tick(nowMs);
      return false;
    }
    if (this.missedAt !== due) this.missedAt = null;
    const window = Math.max(...parts.map(p => p.windowSec));
    const end = due + (window + this.latencySec) * transport.rate;
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

// A press in wait mode, played `latencySec` before it arrived; `press` judges it at a song time.
// A chord completed (in every part) while the clock holds restarts from the chord's own time
// (the clock is normally already parked there after a miss); a press while the clock holds is on
// time whenever it comes.
export function pressInWaitMode(
  parts: Waited[], transport: Transport, latencySec: number, press: (t: number) => HitResult,
): HitResult {
  const missed = transport.waiting ? nextDue(parts) : null;
  const played = transport.time - latencySec * transport.rate;
  const result = press(missed === null ? played : Math.max(played, missed));
  if (result === 'hit' && missed !== null && nextDue(parts) !== missed) {
    transport.time = missed;
  }
  return result;
}
