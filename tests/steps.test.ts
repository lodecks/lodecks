import { describe, expect, test } from "bun:test";

import { buildSteps } from "@/engine/modules/deck/steps.module";

const SR = 1000;
const voice = (id: string, data: Float32Array) =>
  ({
    track: { id, name: id, bar: 0, gain: 1 },
    loaded: { buffer: { sampleRate: SR, getChannelData: () => data } }
  }) as never;

describe("deck steps", () => {
  // 120 bpm, 4/4: a bar is 2 s, a 16th 125 ms
  const pack = { bpm: 120, timeSignature: [4, 4], gridOffset: 0 } as never;

  test("a kick on every beat lights every 4th step of the drums row", () => {
    const drums = new Float32Array(2 * 2 * SR);
    for (let beat = 0; beat < 8; beat++) for (let i = 0; i < 60; i++) drums[beat * 500 + i] = 1;
    const steps = buildSteps(pack, [voice("drums", drums)], 2);
    const row = steps.rows[0];
    expect(row.layer).toBe("drums");
    expect(row.values).toHaveLength(32);
    const lit = [...row.values].map((value, index) => (value > 0.5 ? index : -1)).filter((index) => index >= 0);
    expect(lit).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
  });

  test("layers come in a fixed order and energy averages them", () => {
    const quiet = new Float32Array(4 * SR);
    const vocals = new Float32Array(4 * SR).fill(0.5);
    for (let i = 0; i < 2 * SR; i++) vocals[i] = 0; // sung only in bar 2
    const steps = buildSteps(pack, [voice("vocals", vocals), voice("bass", quiet.fill(0.2))], 2);
    expect(steps.rows.map((row) => row.layer)).toEqual(["bass", "vocals"]);
    expect(steps.rows[1].values[0]).toBe(0);
    expect(steps.rows[1].values[20]).toBeCloseTo(1);
    expect(steps.energy[20]).toBeCloseTo(1);
  });

  test("hits mark attacks: a held pad once, a kick on every beat", () => {
    const pad = new Float32Array(4 * SR);
    for (let i = 500; i < 4 * SR; i++) pad[i] = 0.4; // comes in on beat 2, then holds
    const drums = new Float32Array(4 * SR);
    for (let beat = 0; beat < 8; beat++) for (let i = 0; i < 60; i++) drums[beat * 500 + i] = 1;
    const steps = buildSteps(pack, [voice("other", pad), voice("drums", drums)], 2);
    const lit = (values: Float32Array) => [...values].map((value, index) => (value > 0.5 ? index : -1)).filter((index) => index >= 0);
    expect(lit(steps.rows.find((row) => row.layer === "other")!.hits)).toEqual([4]);
    expect(lit(steps.rows.find((row) => row.layer === "drums")!.hits)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
  });
});
