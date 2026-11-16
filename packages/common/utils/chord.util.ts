import {
  ChordModifier,
  ChordModifierKeys,
  ChordQualities,
  ChordQuality,
  ChordRootKeys
} from "../constants/chord.constant";
import { NoteNames, noteIndex } from "./music.util";

export type Chord = {
  root: number;
  quality: ChordQuality;
  // display symbol, eg. "Am7"
  symbol: string;
  // symbol understood by strudel chord().voicing(), eg. "A^7"
  strudel: string;
};

const resolveQuality = (modifiers: Set<ChordModifier>): ChordQuality => {
  const minor = modifiers.has("minor");

  if (modifiers.has("dim")) return "dim";
  if (modifiers.has("aug")) return "aug";
  if (modifiers.has("sus4")) return "sus4";
  if (modifiers.has("sus2")) return "sus2";
  if (modifiers.has("major7")) return "maj7";
  if (modifiers.has("ninth")) return minor ? "min9" : "dom9";
  if (modifiers.has("seventh")) return minor ? "min7" : "dom7";
  if (modifiers.has("sixth")) return minor ? "min6" : "six";

  return minor ? "min" : "maj";
};

export const makeChord = (root: number, quality: ChordQuality): Chord => {
  const name = NoteNames[((root % 12) + 12) % 12];
  const definition = ChordQualities[quality];

  return {
    root: ((root % 12) + 12) % 12,
    quality,
    symbol: `${name}${definition.symbol}`,
    strudel: `${name}${definition.strudel}`
  };
};

/**
 * Chord from keys held together, eg. ["a", "m"] => Am, ["c", "7"] => C7.
 * The first root key pressed wins; `sharp` and `flat` come from shift / alt.
 */
export const chordFromKeys = (
  keys: string[],
  { sharp = false, flat = false }: { sharp?: boolean; flat?: boolean } = {}
): Chord | undefined => {
  const lower = keys.map((key) => key.toLowerCase());
  const rootKey = lower.find((key) =>
    (ChordRootKeys as readonly string[]).includes(key)
  );
  if (!rootKey) return undefined;

  const modifiers = new Set<ChordModifier>();
  for (const key of lower) {
    if (key === rootKey) continue;
    const modifier = ChordModifierKeys[key as keyof typeof ChordModifierKeys];
    if (modifier) modifiers.add(modifier);
  }

  const root = noteIndex(rootKey) + (sharp ? 1 : 0) - (flat ? 1 : 0);
  return makeChord(root, resolveQuality(modifiers));
};

/** "Am7", "F#", "Bbmaj7" */
export const parseChord = (symbol: string): Chord | undefined => {
  const match = symbol.trim().match(/^([A-Ga-g][#b]?)(.*)$/);
  if (!match) return undefined;

  const root = noteIndex(match[1]);
  if (root < 0) return undefined;

  const rest = match[2];
  const quality = (Object.keys(ChordQualities) as ChordQuality[]).find(
    (name) =>
      ChordQualities[name].symbol === rest ||
      ChordQualities[name].strudel === rest
  );

  return quality ? makeChord(root, quality) : undefined;
};

/** Midi notes of a chord, root placed in `octave` */
export const chordNotes = (chord: Chord, octave = 4) => {
  const base = (octave + 1) * 12 + chord.root;
  return ChordQualities[chord.quality].intervals.map(
    (interval) => base + interval
  );
};
