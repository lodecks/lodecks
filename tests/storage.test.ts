import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { strFromU8 } from "fflate";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parsePack } from "@/common/schemas/pack.schema";
import { zipPack } from "@/common/utils/zip.util";
import { folderStore } from "@/server/providers/folder-store.provider";
import { NotFoundError, StorageProvider } from "@/server/providers/storage.provider";
import { readZipEntry } from "@/server/utils/zip-entry.util";

const pack = parsePack({
  format: 1,
  title: "Ranged",
  bpm: 124,
  key: "Am",
  stems: [{ id: "drums", name: "Drums", file: "stems/drums.ogg", type: "stem" }]
});
// big enough that the manifest is far from the end of the file
const audio = Uint8Array.from({ length: 300_000 }, (_, index) => (index * 7919) % 251);
const zipped = zipPack(pack, { "stems/drums.ogg": audio });

let folder: string;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), "lodecks-packs-"));
  await writeFile(join(folder, "ranged.lopack"), zipped);
  await writeFile(join(folder, "notes.txt"), "not a pack");
});
afterAll(() => rm(folder, { recursive: true, force: true }));

describe("readZipEntry", () => {
  test("reads one file with a few ranged reads, not the whole zip", async () => {
    const reads: number[] = [];
    const read = async (start: number, length: number) => {
      reads.push(length);
      return zipped.slice(start, start + length);
    };
    const manifest = await readZipEntry(read, zipped.length, "pack.json");
    expect(JSON.parse(strFromU8(manifest!)).title).toBe("Ranged");
    expect(reads.reduce((sum, length) => sum + length, 0)).toBeLessThan(zipped.length / 3);
    expect(await readZipEntry(read, zipped.length, "missing.json")).toBeUndefined();
  });

  test("reads stored (uncompressed) entries too", async () => {
    const read = async (start: number, length: number) => zipped.slice(start, start + length);
    expect(await readZipEntry(read, zipped.length, "stems/drums.ogg")).toEqual(audio);
  });
});

describe("storage over a folder", () => {
  test("lists packs with their manifest, skipping other files", async () => {
    const storage = new StorageProvider(folderStore(folder));
    expect(await storage.list()).toEqual([
      { id: "ranged", title: "Ranged", artist: "", bpm: 124, key: "Am", voices: 0, stems: 1, size: zipped.length }
    ]);
  });

  test("serves a pack, refuses bad ids and missing packs", async () => {
    const storage = new StorageProvider(folderStore(folder));
    const file = await storage.file("ranged");
    expect(file.size).toBe(zipped.length);
    expect(new Uint8Array(await new Response(file.body).arrayBuffer())).toEqual(zipped);
    expect(storage.file("../secret")).rejects.toThrow();
    expect(storage.file("nope")).rejects.toBeInstanceOf(NotFoundError);
  });
});
