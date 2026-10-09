// One hue, darker from row 1 to row 3, so the rows read as a sequence rather than categories.
export const ROW_COLORS: Record<number, string> = {
  1: 'hsl(258, 100%, 82%)',
  2: 'hsl(258, 70%, 64%)',
  3: 'hsl(258, 45%, 46%)',
};
export const HELPER_ONLY = 'hsl(258, 20%, 36%)'; // notes that exist only on rows 4-5

export const EXPECT = '#e53935'; // press now (main rows)
export const ONSET = '#ff8a80'; // first moment of a note, so repeats stand out
export const DUPLICATE = '#fb8c00'; // same pitch on helper rows
export const HIT = '#43a047';
export const MISSED = '#7f3b3b';
export const LIVE = '#1e88e5'; // pressed on the instrument, not expected
export const WRONG = '#f50057';
export const UPCOMING = '#ef9a9a';
export const C_MARK = '#c9a227';
