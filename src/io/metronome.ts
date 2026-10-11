import * as Tone from 'tone';

// A bar's first beat, any other beat, or a click between beats (softer).
export type Click = 'bar' | 'beat' | 'sub';
const PITCH: Record<Click, number> = { bar: 1760, beat: 1320, sub: 990 };
const LEVEL: Record<Click, number> = { bar: 1, beat: 1, sub: 0.5 };

// Short clicks on the beat, the first beat of each bar higher, clicks between beats lower and softer.
export class Metronome {
  private synth: Tone.Synth | null = null;
  private out: Tone.Gain | null = null;
  private last = 0; // audio time of the latest click

  // Must be called from a user gesture, like the other sounds.
  start(): void {
    void Tone.start();
  }

  // A click `delay` seconds from now, at `volume` (0..1).
  click(delay: number, kind: Click, volume: number): void {
    if (!this.synth || !this.out) {
      this.out = new Tone.Gain(volume).toDestination();
      this.synth = new Tone.Synth({
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.01 },
        volume: -6,
      }).connect(this.out);
    }
    this.out.gain.value = volume;
    // The synth refuses a start no later than the one before. That can happen when the audio clock
    // stalls or jumps (the output device reset, say), so keep each click just after the last.
    const at = Math.max(Tone.now() + Math.max(0, delay), this.last + 0.005);
    this.last = at;
    this.synth.triggerAttackRelease(PITCH[kind], 0.03, at, LEVEL[kind]);
  }
}
