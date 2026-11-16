import { ChordWindowMs } from "@/common/constants/chord.constant";
import { Chord, chordFromKeys } from "@/common/utils/chord.util";

/**
 * Collects keys pressed together into one chord: keys landing within
 * the window of the first one are read as a single combo, eg. a + m.
 */
export class ChordCombo {
  private keys: string[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private modifiers = { sharp: false, flat: false };

  constructor(private onChord: (chord: Chord) => void) {}

  press(key: string, { shift = false, alt = false } = {}) {
    this.keys.push(key.toLowerCase());
    this.modifiers.sharp ||= shift;
    this.modifiers.flat ||= alt;

    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), ChordWindowMs);
    }
  }

  private flush() {
    const chord = chordFromKeys(this.keys, this.modifiers);
    this.keys = [];
    this.modifiers = { sharp: false, flat: false };
    this.timer = undefined;
    if (chord) this.onChord(chord);
  }
}
