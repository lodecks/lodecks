import { describe, expect, test } from "bun:test";

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { Analysis, buildPack } from "@/common/utils/build-pack.util";
import { unzipPack, zipPack } from "@/common/utils/zip.util";

const analysis: Analysis = {
  bpm: 174,
  key: "Em",
  gridOffset: 0.21,
  bars: 96,
  sections: [
    { name: "intro", bar: 0, bars: 16 },
    { name: "drop", bar: 16, bars: 32 },
    { name: "break", bar: 48, bars: 16 },
    { name: "drop 2", bar: 64, bars: 32 }
  ],
  stems: [
    { id: "drums", file: "stems/drums.wav" },
    { id: "bass", file: "stems/bass.wav" },
    { id: "other", file: "stems/other.wav" }
  ],
  voices: [
    { id: "vocals", name: "Vocals", file: "voices/vocals.wav", type: "stem", score: 1e9 },
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `v${index}`,
      name: `phrase ${index}`,
      file: `voices/v${index}.wav`,
      type: (index === 3 ? "oneshot" : "loop") as "loop" | "oneshot",
      bars: index === 3 ? 1 : 4,
      bar: index * 4,
      score: index
    })),
    { id: "riser", name: "Riser", file: "voices/riser.wav", type: "oneshot", bars: 2, score: 0 },
    { id: "impact", name: "Impact", file: "voices/impact.wav", type: "oneshot", bars: 1, score: 0 }
  ]
};

describe("buildPack", () => {
  const pack = buildPack(analysis, { title: "Song" });

  test("puts the strongest phrases on 1–7 and the utilities on 8, 9, 0", () => {
    const byKey = Object.fromEntries(
      pack.voices.filter((voice) => voice.key).map((voice) => [voice.key, voice.id])
    );
    expect(byKey).toEqual({
      "1": "v9", "2": "v8", "3": "v7", "4": "v6", "5": "v5", "6": "v4", "7": "v3",
      "8": "riser", "9": "impact", "0": "vocals"
    });
  });

  test("the other phrases stay in the library, in song order", () => {
    const library = pack.voices.filter((voice) => !voice.key).map((voice) => voice.id);
    expect(library).toEqual(["v0", "v1", "v2"]);
  });

  test("short oneshots launch on the beat, loops choke each other", () => {
    const shout = pack.voices.find((voice) => voice.id === "v3")!;
    expect(shout.quantize).toBe("beat");
    expect(pack.voices.find((voice) => voice.id === "v9")!.choke).toBe("vocal");
  });

  test("stems and cues, and none of the old fields", () => {
    expect(pack.stems.map((stem) => stem.key)).toEqual(["1", "2", "3"]);
    expect(pack.cues.map((cue) => cue.bar)).toEqual([0, 16, 48, 64]);
    for (const old of ["samples", "instruments", "patterns", "visuals", "fx"]) expect(old in pack).toBe(false);
    expect(pack.gridOffset).toBe(0.21);
  });
});

describe("older packs", () => {
  test("lose their old fields and unused files when saved again", () => {
    const old = {
      format: 1,
      title: "Old",
      bpm: 120,
      stems: [{ id: "drums", name: "Drums", file: "stems/drums.ogg", type: "stem" }],
      samples: { kick: ["samples/kick.wav"] },
      instruments: [{ id: "lead", name: "Lead", chain: "s('sawtooth')" }],
      patterns: [{ name: "beat", code: 's("{deck}_kick*4")', autoload: true }],
      visuals: [{ name: "pulse", code: "osc().out()", autoload: true }],
      fx: { echo: { time: "1/8d", feedback: 0.45 } }
    };
    const audio = new Uint8Array([1, 2, 3]);
    const files = {
      "pack.json": strToU8(JSON.stringify(old)),
      "stems/drums.ogg": audio,
      "samples/kick.wav": audio
    };
    const { pack } = unzipPack(zipSync(files));
    for (const field of ["samples", "instruments", "patterns", "visuals", "fx"]) expect(field in pack).toBe(false);

    const saved = unzipSync(zipPack(pack, files));
    expect(Object.keys(saved).sort()).toEqual(["pack.json", "stems/drums.ogg"]);
    expect(Object.keys(JSON.parse(strFromU8(saved["pack.json"])))).not.toContain("instruments");
  });
});
