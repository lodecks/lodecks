export const ChordQualities = {
  maj: { symbol: "", strudel: "", intervals: [0, 4, 7] },
  min: { symbol: "m", strudel: "m", intervals: [0, 3, 7] },
  dom7: { symbol: "7", strudel: "7", intervals: [0, 4, 7, 10] },
  min7: { symbol: "m7", strudel: "m7", intervals: [0, 3, 7, 10] },
  maj7: { symbol: "maj7", strudel: "^7", intervals: [0, 4, 7, 11] },
  dom9: { symbol: "9", strudel: "9", intervals: [0, 4, 7, 10, 14] },
  min9: { symbol: "m9", strudel: "m9", intervals: [0, 3, 7, 10, 14] },
  six: { symbol: "6", strudel: "6", intervals: [0, 4, 7, 9] },
  min6: { symbol: "m6", strudel: "m6", intervals: [0, 3, 7, 9] },
  sus4: { symbol: "sus4", strudel: "sus", intervals: [0, 5, 7] },
  sus2: { symbol: "sus2", strudel: "2", intervals: [0, 2, 7] },
  dim: { symbol: "dim", strudel: "o", intervals: [0, 3, 6] },
  aug: { symbol: "aug", strudel: "aug", intervals: [0, 4, 8] }
} as const;

export type ChordQuality = keyof typeof ChordQualities;

// keys that select a chord root while the chords panel is active
export const ChordRootKeys = ["c", "d", "e", "f", "g", "a", "b"] as const;

// keys held together with a root to change the chord quality
export const ChordModifierKeys = {
  m: "minor",
  "7": "seventh",
  "9": "ninth",
  "6": "sixth",
  j: "major7",
  s: "sus4",
  "2": "sus2",
  o: "dim",
  u: "aug"
} as const;

export type ChordModifier =
  (typeof ChordModifierKeys)[keyof typeof ChordModifierKeys];

// keys landing within this window are read as one chord
export const ChordWindowMs = 45;
