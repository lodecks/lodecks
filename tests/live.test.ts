import { describe, expect, test } from "bun:test";

import { Globals, Methods, docFor, returnsOf } from "@/engine/modules/live/api.module";
import { Layers, boxRect, parseCorner } from "@/engine/modules/live/layers.module";
import { Runtime, blockAt, splitBlocks, transform } from "@/engine/modules/live/runtime.module";
import { Lead, Scheduler, nextBoundary } from "@/engine/modules/live/schedule.module";
import { Binder, Signal, lfo, ramp, shape } from "@/engine/modules/live/signals.module";

describe("blocks", () => {
  const doc = "const a = 1\na.x()\n\n\n// two\nb()\n";

  test("are runs of non-blank lines", () => {
    expect(splitBlocks(doc).map((block) => [block.startLine, block.endLine])).toEqual([[1, 2], [5, 6]]);
    expect(doc.slice(splitBlocks(doc)[1].from, splitBlocks(doc)[1].to)).toBe("// two\nb()");
  });

  test("the block under the cursor, or the one above a blank line", () => {
    expect(blockAt(doc, 3)?.startLine).toBe(1);
    expect(blockAt(doc, doc.indexOf("b()"))?.startLine).toBe(5);
    expect(blockAt(doc, doc.indexOf("\n\n") + 2)?.startLine).toBe(1);
  });
});

describe("runtime", () => {
  test("declarations become assignments, keeping the lines", () => {
    const { code, names } = transform("const a = 1, b = 2\nlet c\nfunction f() {}\nclass K {}\nconst { d, e: [g] } = o", { line: 1 });
    expect(names).toEqual(["a", "b", "c", "f", "K", "d", "g"]);
    expect(code.split("\n")).toHaveLength(5);
    expect(code).toContain("__at(1);a = 1, b = 2");
    expect(code).toContain("__at(2);c = undefined");
    expect(code).toContain("__at(3);f = function f() {}");
    expect(code).toContain("({ d, e: [g] } = o)");
  });

  test("the last expression is the result, statements report their end line", () => {
    const { code } = transform('deck("a")\n  .show()', { line: 10, tag: "r1" });
    expect(code).toBe('__at("r1", 11);__result = (deck("a")\n  .show())');
  });

  test("controls get an id as first argument", () => {
    const { code, controls } = transform("a.filter(slider(0, -1, 1)).vol(knob())\nbutton('go', () => toggle(1))", {
      line: 1,
      controls: ["slider", "knob", "toggle", "button"],
      controlId: (index) => `b:${index}`
    });
    expect(controls).toBe(4);
    expect(code).toContain('slider("b:0", 0, -1, 1)');
    expect(code).toContain('knob("b:1")');
    expect(code).toContain(`button("b:2", 'go', () => toggle("b:3", 1))`);
  });

  test("variables live on between runs, built-ins are protected", async () => {
    const runtime = new Runtime({ __at: () => {}, twice: (x: number) => x * 2 });
    expect((await runtime.run("const a = twice(21)", { line: 1 })).value).toBeUndefined();
    expect((await runtime.run("a + 1", { line: 3 })).value).toBe(43);
    expect((await runtime.run("const a = 1\na", { line: 5 })).value).toBe(1);
    expect(runtime.bindings()).toEqual(["a"]);
    expect((await runtime.run("const twice = 0", { line: 7 })).error?.message).toContain("part of lodecks");
    expect((await runtime.run("await Promise.resolve(5)", { line: 8 })).value).toBe(5);
    runtime.reset();
    expect(runtime.bindings()).toEqual([]);
  });

  test("errors point at the line", async () => {
    const runtime = new Runtime({ __at: () => {} });
    expect((await runtime.run("const x = 1\nconst y = (", { line: 20 })).error).toEqual({ message: "Unexpected token", line: 21 });
    const failed = await runtime.run("const x = 1\nnope()", { line: 20 });
    expect(failed.error?.message).toContain("nope");
  });
});

describe("signals", () => {
  test("shapes span 0…1", () => {
    expect(shape("sine", 0)).toBeCloseTo(0);
    expect(shape("sine", 0.5)).toBeCloseTo(1);
    expect(shape("tri", 0.25)).toBeCloseTo(0.5);
    expect(shape("saw", 0.75)).toBeCloseTo(0.75);
    expect(shape("square", 0.6)).toBe(0);
  });

  test("lfo and ramp follow the clock", () => {
    let now = 0;
    const clock = () => now;
    const wave = lfo(clock, 4, -1, 1);
    expect(wave.read()).toBeCloseTo(-1);
    now = 2;
    expect(wave.read()).toBeCloseTo(1);
    const glide = ramp(clock, 8, 0, 1);
    now = 6;
    expect(glide.read()).toBeCloseTo(0.5);
    now = 30;
    expect(glide.read()).toBe(1);
    expect(new Signal(() => 0.5).range(10, 20).mul(2).add(1).read()).toBe(31);
  });

  test("a binding follows its signal until a plain value replaces it", () => {
    const binder = new Binder();
    const applied: number[] = [];
    let value = 0.1;
    binder.set("a.filter", new Signal(() => value), (v) => applied.push(v));
    value = 0.2;
    binder.tick();
    binder.tick();
    expect(applied).toEqual([0.1, 0.2]);
    binder.set("a.filter", 0.9, (v) => applied.push(v));
    value = 0.5;
    binder.tick();
    expect(applied).toEqual([0.1, 0.2, 0.9]);
    expect(binder.size).toBe(0);
  });
});

describe("scheduler", () => {
  test("every fires just before its bars, on the grid", () => {
    const fired: number[] = [];
    const scheduler = new Scheduler();
    let cycle = 3.2;
    scheduler.every("block", cycle, 4, () => fired.push(cycle));
    for (cycle = 3.2; cycle < 17; cycle += 0.05) scheduler.tick(cycle);
    // each fires within one step of its bar minus the lead
    expect(fired.map((at) => Math.round(at + Lead))).toEqual([4, 8, 12, 16]);
    expect(nextBoundary(3.95, 4)).toBe(8);
  });

  test("at and next fire once; a block run again replaces its jobs", () => {
    const fired: string[] = [];
    const scheduler = new Scheduler();
    scheduler.at("x", 0, 3, () => fired.push("at"));
    scheduler.next("x", 0, () => fired.push("next"));
    scheduler.every("y", 0, 1, () => fired.push("y"));
    scheduler.cancelOwner("y");
    for (let cycle = 0; cycle < 4; cycle += 0.1) scheduler.tick(cycle);
    expect(fired).toEqual(["next", "at"]);
    expect(scheduler.list()).toHaveLength(0);
  });

  test("errors are reported, the job keeps its schedule", () => {
    const errors: string[] = [];
    const scheduler = new Scheduler((job, error) => errors.push(`${job.label}: ${error.message}`));
    scheduler.every("z", 0, 1, () => {
      throw new Error("boom");
    });
    scheduler.tick(0.9);
    expect(errors).toEqual(["every 1: boom"]);
    expect(scheduler.list()[0].at).toBe(2);
  });
});

describe("api table", () => {
  test("names are unique, chainable methods say what they return", () => {
    const names = Globals.map((doc) => doc.name);
    expect(new Set(names).size).toBe(names.length);
    expect(returnsOf("deck")).toBe("deck");
    expect(returnsOf("filter", "deck")).toBe("deck");
    expect(docFor("opacity")?.signature).toContain("opacity");
    expect(Methods.deck.find((doc) => doc.name === "load")?.args).toEqual(["pack"]);
  });

  test("layers replace the whole stack", () => {
    const layers = new Layers();
    layers.set([{ source: { kind: "glsl", code: "a" } }, { source: { kind: "glsl", code: "b" }, blend: "add", opacity: 0.5 }]);
    expect(layers.store.get().list.map((layer) => [layer.name, layer.blend])).toEqual([["l0", "normal"], ["l1", "add"]]);
  });

  test("a boxed layer sits in its corner, in the screen's shape", () => {
    const near = (rect: number[], expected: number[]) => rect.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 6));
    expect(boxRect()).toEqual([0, 0, 1, 1]);
    // y is up, as WebGL reads it: bottom is near 0
    near(boxRect({ corner: "bottom-right", size: 0.3 }), [0.675, 0.025, 0.3, 0.3]);
    near(boxRect({ corner: "top-left", size: 0.3 }), [0.025, 0.675, 0.3, 0.3]);
    near(boxRect({ corner: "center", size: 0.5 }), [0.25, 0.25, 0.5, 0.5]);
    // a signal is read every frame; out of range is clamped, full size has no inset
    near(boxRect({ corner: "bottom-left", size: () => 2 }), [0, 0, 1, 1]);
    expect(boxRect({ corner: "bottom-left", size: 0 })[2]).toBe(0.05);
    expect(parseCorner("Bottom Right")).toBe("bottom-right");
    expect(parseCorner("middle")).toBeUndefined();
  });

  test("the box goes with the layer", () => {
    const layers = new Layers();
    layers.set([{ source: { kind: "glsl", code: "a" } }, { source: { kind: "glsl", code: "cam", camera: true }, box: { corner: "bottom-right", size: 0.25 } }]);
    expect(layers.store.get().list.map((layer) => layer.box)).toEqual([undefined, { corner: "bottom-right", size: 0.25 }]);
    expect(docFor("corner")?.args).toEqual(["corner"]);
  });
});
