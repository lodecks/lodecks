import { describe, expect, test } from "bun:test";

import { parsePack } from "@/common/schemas/pack.schema";
import { decodeWav, encodeWav } from "@/common/utils/wav.util";
import { packFilePaths, unzipPack, zipPack } from "@/common/utils/zip.util";

const minimal = {
  format: 1,
  title: "Test",
  bpm: 128,
  voices: [{ id: "hook", name: "Hook", file: "voices/hook.wav", type: "loop", bars: 4, key: "1" }]
};

describe("pack schema", () => {
  test("fills defaults", () => {
    const pack = parsePack(minimal);
    expect(pack.key).toBe("C");
    expect(pack.voices[0]).toMatchObject({ gain: 1, stretch: true, bar: 0, fxSend: 0 });
  });

  test("rejects paths leaving the pack", () => {
    expect(() =>
      parsePack({ ...minimal, voices: [{ ...minimal.voices[0], file: "../secret.wav" }] })
    ).toThrow();
    expect(() =>
      parsePack({ ...minimal, voices: [{ ...minimal.voices[0], file: "/etc/passwd" }] })
    ).toThrow();
  });

  test("rejects keys outside 1–0", () => {
    expect(() =>
      parsePack({ ...minimal, voices: [{ ...minimal.voices[0], key: "q" }] })
    ).toThrow();
  });

  test("drops the instruments of older packs", () => {
    const pack = parsePack({
      ...minimal,
      instruments: [{ id: "lead", name: "Lead", chain: "s('sawtooth')", role: "keys" }]
    });
    expect("instruments" in pack).toBe(false);
  });
});

describe("pack zip", () => {
  test("round trips manifest and audio", () => {
    const pack = parsePack(minimal);
    const audio = encodeWav([new Float32Array([0, 0.5, -0.5, 1])], 44100);
    const { pack: read, files } = unzipPack(zipPack(pack, { "voices/hook.wav": audio }));

    expect(read).toEqual(pack);
    expect(packFilePaths(read)).toEqual(["voices/hook.wav"]);

    const wav = decodeWav(files["voices/hook.wav"]);
    expect(wav.sampleRate).toBe(44100);
    expect(wav.channels[0][1]).toBeCloseTo(0.5, 3);
    expect(wav.channels[0][2]).toBeCloseTo(-0.5, 3);
  });

  test("a zip without pack.json is refused", async () => {
    const { zipSync } = await import("fflate");
    expect(() => unzipPack(zipSync({ "x.txt": new Uint8Array([1]) }))).toThrow("pack.json");
  });
});
