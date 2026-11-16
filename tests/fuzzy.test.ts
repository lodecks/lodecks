import { describe, expect, test } from "bun:test";

import { fuzzy } from "../apps/ui/utils/fuzzy.util";

describe("command palette matching", () => {
  test("letters in order, anywhere", () => {
    expect(fuzzy("rnb", "Run block")?.positions).toEqual([0, 2, 4]);
    expect(fuzzy("xyz", "Run block")).toBeUndefined();
    expect(fuzzy("", "Run block")?.score).toBe(0);
  });

  test("word starts and runs rank first", () => {
    const titles = ["Run block", "Run all blocks", "Crossfader: to B", "Clock: start"];
    const rank = (query: string) =>
      titles
        .map((title) => ({ title, match: fuzzy(query, title) }))
        .filter((item) => item.match)
        .sort((a, b) => b.match!.score - a.match!.score)
        .map((item) => item.title);
    expect(rank("rb")[0]).toBe("Run block");
    expect(rank("cs")[0]).toBe("Clock: start");
    expect(rank("block")[0]).toBe("Run block");
  });
});
