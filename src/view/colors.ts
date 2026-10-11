// One hue, darker from row 1 to row 3, so the rows read as a sequence rather than categories.
export const ROW_COLORS: Record<number, string> = {
  1: 'hsl(258, 100%, 82%)',
  2: 'hsl(258, 70%, 64%)',
  3: 'hsl(258, 45%, 46%)',
};
// The bass part: teal, well apart from the treble's violet and the red/green/gold marks.
export const BASS_NOTE = 'hsl(176, 58%, 48%)';
export const BASS_ROLL = 'rgba(56, 190, 180, 0.04)';

export const HELPER_ONLY = 'hsl(258, 20%, 36%)'; // notes that exist only on rows 4-5

export const EXPECT = '#e53935'; // press now
export const DUPLICATE = '#fb8c00'; // same pitch on the treble helper rows
export const HIT = '#43a047'; // played right
export const LIVE = '#1e88e5'; // pressed on the instrument, not expected
export const WRONG = '#f50057';
export const UPCOMING = '#ef9a9a';
export const C_MARK = '#c9a227';

// A note's arrival: the button bursts in a bright colour and settles quickly back to EXPECT, so a
// repeated note reads as a new press.
const BURST = [255, 228, 222]; // near-white red
const EXPECT_RGB = [0xe5, 0x39, 0x35];
export const ONSET_FADE = 0.18; // s of real time to settle

// EXPECT as it looks `age` real seconds after the note was first shown due.
export function expectFill(age: number): string {
  if (age >= ONSET_FADE) return EXPECT;
  const k = (1 - Math.max(0, age) / ONSET_FADE) ** 2; // fast at first, easing into EXPECT
  const c = BURST.map((b, i) => Math.round(EXPECT_RGB[i] + (b - EXPECT_RGB[i]) * k));
  return `rgb(${c.join(',')})`;
}
