import { describe, expect, test } from "bun:test";

import { parseLayers } from "@/engine/utils/layers.util";

describe("set layers", () => {
  test("finds labelled blocks and muted ones", () => {
    const code = `// comment\ndrums: s("bd*4")\n\n_keys: note("c e g")\narp: chord("Am").voicing()\n  .fast(2)`;
    expect(parseLayers(code)).toEqual([
      { name: "drums", muted: false, line: 1 },
      { name: "keys", muted: true, line: 3 },
      { name: "arp", muted: false, line: 4 }
    ]);
  });

  test("ignores urls and object keys inside code", () => {
    expect(parseLayers(`s("bd").bank("x") // see: https://strudel.cc`)).toEqual([]);
  });
});
