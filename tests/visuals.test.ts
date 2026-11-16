import { describe, expect, test } from "bun:test";

import { fitScale, frameAt, frameDuration, loopBeats, parseFit } from "@/engine/modules/visual/gif.module";
import { GifTemplate, fitOfCode, gifShader, withFit } from "@/engine/modules/visual/shader-presets.module";
import { ShaderHeader, shaderErrors, wrapShader } from "@/engine/modules/visual/glsl.module";

describe("gif tempo lock", () => {
  test("a loop takes the nearest of 1, 2, 4, 8, 16 beats", () => {
    // at 120 bpm a beat is 500 ms
    expect(loopBeats(500, 120)).toBe(1);
    expect(loopBeats(1900, 120)).toBe(4);
    expect(loopBeats(3200, 120)).toBe(8);
    expect(loopBeats(100, 120)).toBe(1);
    expect(loopBeats(60_000, 120)).toBe(16);
    // the same gif loops over fewer beats at a slower tempo
    expect(loopBeats(2000, 60)).toBe(2);
  });

  test("frames follow the position in the loop, wrapping", () => {
    const durations = [100, 100, 200];
    expect(frameAt(durations, 0)).toBe(0);
    expect(frameAt(durations, 0.24)).toBe(0);
    expect(frameAt(durations, 0.25)).toBe(1);
    expect(frameAt(durations, 0.5)).toBe(2);
    expect(frameAt(durations, 0.99)).toBe(2);
    expect(frameAt(durations, 1.25)).toBe(1);
    expect(frameAt([], 0.5)).toBe(0);
  });

  test("frames land on the beat whatever the tempo", () => {
    // 4 equal frames looped over 4 beats: one frame per beat
    const durations = [80, 80, 80, 80];
    const beats = 4;
    for (const beat of [0, 1, 2, 3, 4, 5.5]) {
      expect(frameAt(durations, beat / beats)).toBe(Math.floor(beat) % 4);
    }
  });

  test("too short or missing frame times play at 100 ms", () => {
    expect(frameDuration(0)).toBe(100);
    expect(frameDuration(null)).toBe(100);
    expect(frameDuration(10_000)).toBe(100);
    expect(frameDuration(40_000)).toBe(40);
  });
});

describe("glsl wrapping", () => {
  test("mainImage gets a main() and the header", () => {
    const source = wrapShader("void mainImage(out vec4 c, in vec2 p) { c = vec4(1.0); }");
    expect(source.startsWith(ShaderHeader)).toBe(true);
    expect(source).toContain("#line 1\nvoid mainImage");
    expect(source).toContain("mainImage(fragColor, gl_FragCoord.xy);");
  });

  test("code with its own main() is left as it is", () => {
    const source = wrapShader("void main() { fragColor = vec4(1.0); }");
    expect(source).not.toContain("mainImage(fragColor");
  });

  test("errors keep the user's line numbers", () => {
    const log = "ERROR: 0:3: 'foo' : undeclared identifier\nERROR: 0:3: '' : compilation terminated\n";
    expect(shaderErrors(log)).toEqual(["line 3: 'foo' : undeclared identifier"]);
  });
});

describe("gif fit", () => {
  test("cover crops, contain shows all, fill stretches", () => {
    // a 16:9 screen, a square gif
    expect(fitScale("cover", 16 / 9, 1)).toEqual([1, 9 / 16]);
    expect(fitScale("contain", 16 / 9, 1)).toEqual([16 / 9, 1]);
    expect(fitScale("fill", 16 / 9, 1)).toEqual([1, 1]);
    // a tall screen, a wide gif
    expect(fitScale("cover", 0.5, 2)).toEqual([0.25, 1]);
    expect(fitScale("contain", 0.5, 2)).toEqual([1, 4]);
  });

  test("parses fit names", () => {
    expect(parseFit("Contain")).toBe("contain");
    expect(parseFit("stretch")).toBeUndefined();
  });

  test("the gif shader defaults to cover, and its fit can change", () => {
    expect(fitOfCode(GifTemplate)).toBe("cover");
    expect(fitOfCode(gifShader("fill"))).toBe("fill");
    expect(fitOfCode(withFit(GifTemplate, "contain")!)).toBe("contain");
    expect(withFit("void mainImage() {}", "contain")).toBeUndefined();
    // saved effects from before FIT
    const old = "// gif — old\nconst float COVER = 0.0;\n";
    expect(fitOfCode(old)).toBe("contain");
    expect(fitOfCode(withFit(old, "fill")!)).toBe("fill");
  });
});
