import { describe, expect, test } from "bun:test";

import { Palettes, hexToRgb, themeVariables } from "@/common/constants/theme.constant";
import { DefaultSettings, readSettings } from "@/engine/providers/settings.provider";

describe("settings", () => {
  test("nothing saved, or something broken, reads as the defaults", () => {
    expect(readSettings(null)).toEqual(DefaultSettings);
    expect(readSettings("nonsense")).toEqual(DefaultSettings);
    expect(readSettings({ palette: "neon", deckColors: { a: "red", b: 3 }, starterCode: "yes", editorDocs: 1 })).toEqual(DefaultSettings);
  });

  test("keeps what is valid, and fixes only what is not", () => {
    expect(readSettings({ palette: "ember", deckColors: { a: "#34c8ff", b: "pink" }, starterCode: false, editorDocs: false })).toEqual({
      palette: "ember",
      deckColors: { a: "#34c8ff", b: DefaultSettings.deckColors.b },
      starterCode: false,
      editorDocs: false
    });
  });

  test("every palette sets every colour variable, and the deck colours", () => {
    const names = Object.keys(themeVariables("lodecks", DefaultSettings.deckColors)).sort();
    expect(names).toContain("--color-line-strong");
    expect(names).toContain("--color-popover");
    for (const palette of Palettes) {
      const variables = themeVariables(palette.id, { a: "#000001", b: "#000002" });
      expect(Object.keys(variables).sort()).toEqual(names);
      expect(variables["--color-deck-a"]).toBe("#000001");
    }
  });

  test("deck colours become 0..1 rgb for shaders", () => {
    expect(hexToRgb("#ff0080")).toEqual([1, 0, 128 / 255]);
  });
});
