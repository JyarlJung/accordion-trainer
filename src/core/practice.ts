import type { HitResult } from './judge';
import type { Transport } from './transport';

// A part the clock waits for: the right hand's judge, and the bass's when it's practised too.
export interface Waited {
  nextPendingChordTime(): number | null;
}

const EPS = 1e-6;

// The earliest time any of the parts still has something to play.
function nextDue(parts: Waited[]): number | null {
  let due: number | null = null;
  for (const p of parts) {
    const t = p.nextPendingChordTime();
    if (t !== null && (due === null || t < due)) due = t;
  }
  return due;
}

// Drives the clock in wait mode, one chord at a time: the chord due is everything at the earliest
// time any practised part still has to play, and presses count only against it. The clock runs on
// through the chord's hit window, so a slightly late press keeps the beat. If the window passes
// with the chord unplayed, or a press isn't part of it, the clock goes back to the chord and stops
// there until it's played, every note of it held down together.
export class WaitMode {
  windowSec = 0.12; // hit window, real seconds, early or late
  // Instrument input delay, seconds: presses arrive this long after they were played, so the
  // clock runs on that much longer before calling a chord missed.
  latencySec = 0;
  // Whether everything due at a time is held down right now.
  allHeld: (time: number) => boolean = () => true;
  private stoppedAt: number | null = null;
  private rewound = false; // the clock went back since the last tick

  reset(): void {
    this.stoppedAt = null;
    this.rewound = false;
  }

  // Advances the clock; true when it went back to a chord since the last tick, so the players
  // follow it.
  tick(parts: Waited[], transport: Transport, nowMs: number): boolean {
    if (this.stoppedAt !== null && nextDue(parts) !== this.stoppedAt && this.allHeld(this.stoppedAt)) {
      this.stoppedAt = null;
    }
    const due = this.stoppedAt ?? nextDue(parts);
    if (due === null) {
      transport.hold = null;
      transport.tick(nowMs);
      return false;
    }
    const end = this.stoppedAt ?? due + (this.windowSec + this.latencySec) * transport.rate;
    transport.hold = end;
    transport.tick(nowMs);
    if (this.stoppedAt === null && transport.time >= end - 1e-9) this.stop(due, transport);
    const rewound = this.rewound;
    this.rewound = false;
    return rewound;
  }

  // A press: `strike` tries it against the chord due, given that chord's time. It was played
  // `latencySec` before it arrived. Before the chord's hit window nothing is judged; once the clock
  // is stopped at the chord, any time will do. A wrong press stops the clock at the chord.
  press(parts: Waited[], transport: Transport, strike: (time: number) => HitResult): HitResult {
    const due = this.stoppedAt ?? nextDue(parts);
    if (due === null) return 'free';
    const played = transport.time - this.latencySec * transport.rate;
    if (this.stoppedAt === null && played < due - this.windowSec * transport.rate - EPS) return 'free';
    const result = strike(due);
    if (result === 'wrong') this.stop(due, transport);
    return result;
  }

  // Stops the clock at the chord at `time`, going back to it if it's past.
  private stop(time: number, transport: Transport): void {
    if (transport.time > time) {
      transport.time = time;
      this.rewound = true;
    }
    transport.hold = time;
    this.stoppedAt = time;
  }
}
