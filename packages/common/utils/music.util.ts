export const NoteNames = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B"
] as const;

const Flats: Record<string, string> = {
  Db: "C#",
  Eb: "D#",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#",
  Cb: "B",
  Fb: "E"
};

export const Scales = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10]
} as const;
export type ScaleName = keyof typeof Scales;

export type Key = { root: number; scale: ScaleName; name: string };

export const noteIndex = (name: string) => {
  const normalized = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  const sharp = Flats[normalized] || normalized;
  return NoteNames.indexOf(sharp as (typeof NoteNames)[number]);
};

/** "Em", "F#", "Bbm", "A minor" */
export const parseKey = (key: string): Key => {
  const match = key.trim().match(/^([A-Ga-g][#b]?)\s*(m|min|minor)?/);
  const root = match ? noteIndex(match[1]) : 0;
  const scale: ScaleName = match?.[2] ? "minor" : "major";

  return {
    root: root < 0 ? 0 : root,
    scale,
    name: `${NoteNames[root < 0 ? 0 : root]}${scale === "minor" ? "m" : ""}`
  };
};

export const midiToName = (midi: number) =>
  `${NoteNames[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

/** Strudel note name, eg. 61 => "cs4" */
export const midiToStrudel = (midi: number) =>
  midiToName(midi).toLowerCase().replace("#", "s");

export const scalePitchClasses = (key: Key) =>
  Scales[key.scale].map((interval) => (key.root + interval) % 12);

/** Moves a note to the nearest note of the key, preferring downwards on ties */
export const snapToScale = (midi: number, key: Key) => {
  const classes = scalePitchClasses(key);
  for (const offset of [0, -1, 1, -2, 2]) {
    if (classes.includes((((midi + offset) % 12) + 12) % 12)) {
      return midi + offset;
    }
  }
  return midi;
};

/** Camelot wheel position, used to tell if two keys mix well */
export const camelot = (key: Key) => {
  const major = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
  const minor = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];
  const number = (key.scale === "major" ? major : minor)[key.root];

  return { number, letter: key.scale === "major" ? "B" : "A" };
};

export const isCompatibleKey = (a: Key, b: Key) => {
  const ca = camelot(a);
  const cb = camelot(b);
  const distance = Math.min(
    (ca.number - cb.number + 12) % 12,
    (cb.number - ca.number + 12) % 12
  );

  return ca.letter === cb.letter ? distance <= 1 : distance === 0;
};

/** A key moved by whole semitones */
export const shiftKey = (key: Key, semitones: number): Key => {
  const root = (((key.root + Math.round(semitones)) % 12) + 12) % 12;
  return { root, scale: key.scale, name: `${NoteNames[root]}${key.scale === "minor" ? "m" : ""}` };
};

/** Smallest transposition (semitones) that brings `from` onto `to` */
export const transposeBetween = (from: Key, to: Key) => {
  let target = to.root;
  // relative major/minor share notes, so aim for the relative key
  if (from.scale !== to.scale) {
    target = (to.root + (to.scale === "minor" ? 3 : 9)) % 12;
  }
  const up = (target - from.root + 12) % 12;
  return up > 6 ? up - 12 : up;
};
