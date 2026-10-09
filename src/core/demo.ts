import { sortNotes, trackInfo, type RawNote, type Song } from './song';

// Built-in test song: C major scale, chromatic run, triads, plus a left-hand bass track.
export function demoSong(): Song {
  const beat = 0.5;
  const right: RawNote[] = [];
  const left: RawNote[] = [];
  const add = (list: RawNote[], note: number, time: number, duration: number, track: number) =>
    list.push({ note, time, duration, velocity: 0.8, track });

  let t = 0;
  for (const n of [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60]) {
    add(right, n, t, beat * 0.9, 0);
    t += beat;
  }
  t += beat;
  for (let n = 60; n <= 72; n++) {
    add(right, n, t, beat * 0.45, 0);
    t += beat / 2;
  }
  t += beat;
  for (const chord of [[60, 64, 67], [60, 65, 69], [59, 62, 67], [60, 64, 67]]) {
    for (const n of chord) add(right, n, t, beat * 1.8, 0);
    t += beat * 2;
  }
  // Back-to-back repeats with no gap: each should still sound and show as a new press.
  for (const n of [67, 67, 67, 72]) {
    add(right, n, t, beat, 0);
    t += beat;
  }
  for (let bt = 0; bt < t; bt += beat * 2) add(left, bt % (beat * 4) === 0 ? 36 : 43, bt, beat * 0.9, 1);

  return {
    name: '데모: 다장조 음계',
    duration: t,
    tracks: [trackInfo(0, '오른손', 1, right), trackInfo(1, '왼손', 2, left)],
    notes: sortNotes([...right, ...left]),
  };
}
