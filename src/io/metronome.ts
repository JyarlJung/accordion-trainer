import { engine } from './synth';

// A bar's first beat, any other beat, or a click between beats (softer).
export type Click = 'bar' | 'beat' | 'sub';
const PITCH: Record<Click, number> = { bar: 1760, beat: 1320, sub: 990 };
const LEVEL: Record<Click, number> = { bar: 1, beat: 1, sub: 0.5 };
const LENGTH = 0.04; // s

// Short clicks on the beat, the first beat of each bar higher, clicks between beats lower and
// softer. Each click is a brief triangle tone on the synth's audio clock.
export class Metronome {
  // A click `delay` seconds from now, at `volume` (0..1).
  click(delay: number, kind: Click, volume: number): void {
    const ctx = engine.context;
    const at = ctx.currentTime + Math.max(0, delay);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = PITCH[kind];
    const peak = 0.5 * volume * LEVEL[kind];
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + LENGTH);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + LENGTH + 0.01);
  }
}
