import { describe, expect, test } from "bun:test";

import {
  isCompatibleKey,
  midiToStrudel,
  parseKey,
  snapToScale,
  transposeBetween
} from "@/common/utils/music.util";

describe("keys", () => {
  test("parses names", () => {
    expect(parseKey("Em")).toMatchObject({ root: 4, scale: "minor", name: "Em" });
    expect(parseKey("Bb")).toMatchObject({ root: 10, scale: "major", name: "A#" });
    expect(parseKey("F# minor")).toMatchObject({ root: 6, scale: "minor" });
  });

  test("snaps to the scale", () => {
    const am = parseKey("Am");
    // C# is not in A minor, it goes down to C
    expect(snapToScale(61, am)).toBe(60);
    expect(snapToScale(69, am)).toBe(69);
  });

  test("camelot compatibility", () => {
    expect(isCompatibleKey(parseKey("Am"), parseKey("C"))).toBe(true);
    expect(isCompatibleKey(parseKey("Am"), parseKey("Em"))).toBe(true);
    expect(isCompatibleKey(parseKey("Am"), parseKey("F#m"))).toBe(false);
  });

  test("smallest transposition", () => {
    expect(transposeBetween(parseKey("Em"), parseKey("Am"))).toBe(5);
    expect(transposeBetween(parseKey("Am"), parseKey("Gm"))).toBe(-2);
  });

  test("strudel note names", () => {
    expect(midiToStrudel(60)).toBe("c4");
    expect(midiToStrudel(61)).toBe("cs4");
  });
});
