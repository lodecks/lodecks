import { describe, expect, test } from "bun:test";

import { chordFromKeys, chordNotes, parseChord } from "@/common/utils/chord.util";

describe("chordFromKeys", () => {
  test.each([
    [["a", "m"], {}, "Am", "Am"],
    [["a"], {}, "A", "A"],
    [["c", "7"], {}, "C7", "C7"],
    [["d", "m", "7"], {}, "Dm7", "Dm7"],
    [["f", "j"], {}, "Fmaj7", "F^7"],
    [["g", "s"], {}, "Gsus4", "Gsus"],
    [["b", "o"], {}, "Bdim", "Bo"],
    [["e", "m", "9"], {}, "Em9", "Em9"],
    [["f", "m"], { sharp: true }, "F#m", "F#m"],
    [["b"], { flat: true }, "A#", "A#"]
  ])("%j %j → %s", (keys, modifiers, symbol, strudel) => {
    const chord = chordFromKeys(keys, modifiers);
    expect(chord?.symbol).toBe(symbol);
    expect(chord?.strudel).toBe(strudel);
  });

  test("order of keys does not matter, the root is found", () => {
    expect(chordFromKeys(["m", "a"])?.symbol).toBe("Am");
  });

  test("no root, no chord", () => {
    expect(chordFromKeys(["m", "7"])).toBeUndefined();
  });

  test("first root wins when two are held", () => {
    expect(chordFromKeys(["c", "a"])?.symbol).toBe("C");
  });
});

describe("chord notes and parsing", () => {
  test("Am in octave 4", () => {
    expect(chordNotes(chordFromKeys(["a", "m"])!, 4)).toEqual([69, 72, 76]);
  });

  test("round trips symbols", () => {
    for (const symbol of ["Am", "C7", "F#m7", "Bbmaj7", "G"]) {
      const chord = parseChord(symbol)!;
      expect(chord).toBeDefined();
      expect(parseChord(chord.symbol)?.symbol).toBe(chord.symbol);
    }
  });
});
