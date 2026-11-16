import { describe, expect, test } from "bun:test";

import {
  SR,
  analyse,
  chroma,
  detectKey,
  grid,
  phrases,
  sections
} from "@/engine/modules/importer/analyse.module";

// a seeded random, so the tests do not flake
const random = (() => {
  let seed = 7;
  return () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
})();

const kick = (out: Float32Array, at: number, gain = 1) => {
  for (let i = 0; i < 0.25 * SR && at + i < out.length; i++) {
    const t = i / SR;
    out[at + i] += gain * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-t * 30)) * t) * Math.exp(-t * 14);
  }
};

const hat = (out: Float32Array, at: number, gain = 0.3) => {
  let previous = 0;
  for (let i = 0; i < 0.05 * SR && at + i < out.length; i++) {
    const noise = random();
    out[at + i] += gain * (noise - previous) * Math.exp(-(i / SR) * 80);
    previous = noise;
  }
};

/** Four on the floor at `bpm`: a louder kick on each bar's first beat, hats between */
const beat = (bpm: number, seconds: number, offset: number) => {
  const out = new Float32Array(Math.floor(seconds * SR));
  const step = 60 / bpm;
  for (let index = 0; offset + index * step < seconds; index++) {
    const at = Math.floor((offset + index * step) * SR);
    kick(out, at, index % 4 === 0 ? 1 : 0.55);
    hat(out, at + Math.floor((step / 2) * SR));
  }
  return out;
};

const tone = (frequencies: [number, number][], seconds: number) => {
  const out = new Float32Array(Math.floor(seconds * SR));
  for (let i = 0; i < out.length; i++) {
    let value = 0;
    for (const [hz, gain] of frequencies) value += gain * Math.sin((2 * Math.PI * hz * i) / SR);
    out[i] = value * 0.2;
  }
  return out;
};

describe("importer analysis", () => {
  test("finds the tempo and the downbeat of a beat", () => {
    const drums = beat(128, 30, 0.31);
    const found = grid(drums, drums);
    expect(found.bpm).toBe(128);
    // bar 0 starts on the loud kick (modulo a bar)
    const bar = 240 / 128;
    const error = Math.abs(((found.offset - 0.31 + bar / 2) % bar) - bar / 2);
    expect(error).toBeLessThan(0.03);
  });

  test("respects a tempo given by hand", () => {
    const drums = beat(100, 20, 0.1);
    expect(grid(drums, drums, 100).bpm).toBe(100);
  });

  test("finds the key of a chord", () => {
    // A minor: A, C, E, with the tonic strongest
    const am = tone([[220, 1], [261.63, 0.6], [329.63, 0.7], [440, 0.5]], 4);
    expect(detectKey(chroma(am, 2))).toBe("Am");
    // D major: D, F#, A
    const d = tone([[293.66, 1], [369.99, 0.6], [440, 0.7], [587.33, 0.5]], 4);
    expect(detectKey(chroma(d, 2))).toBe("D");
  });

  test("names sections from the 4 bar energy", () => {
    const energy = new Float64Array([...Array(8).fill(0.1), ...Array(8).fill(0.4), ...Array(16).fill(1), ...Array(4).fill(0.1)]);
    expect(sections(energy).map((section) => [section.name, section.bar, section.bars])).toEqual([
      ["intro", 0, 8],
      ["build", 8, 8],
      ["drop", 16, 16],
      ["outro", 32, 4]
    ]);
  });

  test("cuts sung runs into 8, 4, 2 and 1 bar phrases", () => {
    // sung on bars 2–8 (7 bars) and 12
    const energy = new Float64Array(16).map((_, bar) => ((bar >= 2 && bar <= 8) || bar === 12 ? 0.3 : 0));
    expect(phrases(energy).map(([bar, size]) => [bar, size])).toEqual([
      [2, 4],
      [6, 2],
      [8, 1],
      [12, 1]
    ]);
  });

  test("the whole analysis gives what buildPack needs", () => {
    const drums = beat(124, 40, 0.2);
    const bass = tone([[55, 1], [110, 0.5]], 40);
    const vocals = new Float32Array(drums.length);
    // a "vocal" on bars 4–11
    const bar = 240 / 124;
    for (let i = Math.floor((0.2 + 4 * bar) * SR); i < Math.floor((0.2 + 12 * bar) * SR); i++) vocals[i] = 0.3 * Math.sin((2 * Math.PI * 330 * i) / SR);
    const mix = new Float32Array(drums.length).map((_, i) => drums[i] + bass[i] * 0.5 + vocals[i]);
    const { analysis, files } = analyse({ mix, stems: { drums, bass, vocals } });
    expect(analysis.bpm).toBe(124);
    expect(analysis.stems.map((stem) => stem.id)).toEqual(["drums", "bass"]);
    expect(analysis.voices[0].id).toBe("vocals");
    expect(analysis.voices.some((voice) => voice.type === "loop" && voice.bars === 8 && voice.bar === 4)).toBe(true);
    for (const file of [...analysis.stems.map((stem) => stem.file), ...analysis.voices.map((voice) => voice.file)]) {
      expect(files[file]).toBeInstanceOf(Float32Array);
    }
  });
});

describe("ogg opus muxer", () => {
  test("pages carry the header, a valid crc and the trimmed length", async () => {
    const { muxOggOpus, oggCrc } = await import("@/engine/modules/importer/ogg.module");
    // 3 s of 20 ms packets at 48 kHz, the last one padded past the end
    const packets = Array.from({ length: 150 }, (_, index) => ({ data: new Uint8Array(40 + (index % 7)), samples: 960 }));
    const file = muxOggOpus(packets, { channels: 1, preSkip: 312, inputRate: 44100, samples: 143_500 });

    const pages: { flags: number; granule: bigint; crcOk: boolean; segments: number }[] = [];
    for (let offset = 0; offset < file.length; ) {
      expect(new TextDecoder().decode(file.subarray(offset, offset + 4))).toBe("OggS");
      const view = new DataView(file.buffer, file.byteOffset + offset);
      const segments = file[offset + 26];
      const body = file.subarray(offset + 27, offset + 27 + segments).reduce((total, size) => total + size, 0);
      const page = file.slice(offset, offset + 27 + segments + body);
      const crc = view.getUint32(22, true);
      new DataView(page.buffer).setUint32(22, 0, true);
      pages.push({ flags: file[offset + 5], granule: view.getBigInt64(6, true), crcOk: oggCrc(page) === crc, segments });
      offset += page.length;
    }
    expect(pages.every((page) => page.crcOk)).toBe(true);
    expect(new TextDecoder().decode(file.subarray(28, 36))).toBe("OpusHead");
    expect(pages[0].flags).toBe(2);
    expect(pages[pages.length - 1].flags).toBe(4);
    // the last granule is the real length plus the pre-skip, so padding is trimmed
    expect(pages[pages.length - 1].granule).toBe(BigInt(143_500 + 312));
    // granules only go up
    const granules = pages.map((page) => page.granule);
    expect(granules.every((value, index) => index === 0 || value >= granules[index - 1])).toBe(true);
  });
});
