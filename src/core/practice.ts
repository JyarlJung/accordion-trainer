import type { HitResult, Judge } from './judge';
import type { Transport } from './transport';

// A key press in wait mode. Inside the hit window the clock never stopped, so nothing moves.
// Once the clock has run past the window and is holding, the beat was missed: completing the
// chord restarts from that chord's own time, so the next note comes a full beat later.
export function pressInWaitMode(judge: Judge, transport: Transport, pitch: number): HitResult {
  const missed = transport.waiting ? judge.nextPendingChordTime() : null;
  const result = judge.onNoteOn(pitch, transport.time, transport.rate);
  if (result === 'hit' && missed !== null && judge.nextPendingChordTime() !== missed) {
    transport.time = missed;
  }
  return result;
}
