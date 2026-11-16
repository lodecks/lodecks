import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { PackManifest } from "../constants/deck.constant";
import { Pack, parsePack } from "../schemas/pack.schema";

export type PackFiles = Record<string, Uint8Array>;

const Compressed = /\.(mp3|ogg|m4a|aac|flac|opus|webm)$/i;

/** Zips a manifest plus its audio files into a .lopack: only the files it uses */
export const zipPack = (pack: Pack, files: PackFiles) => {
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    [PackManifest]: [strToU8(JSON.stringify(pack, null, 2)), { level: 6 }]
  };

  for (const path of new Set(packFilePaths(pack))) {
    const data = files[path];
    if (!data) continue;
    // already compressed audio gains nothing from deflate
    entries[path] = [data, { level: Compressed.test(path) ? 0 : 6 }];
  }

  return zipSync(entries);
};

export const unzipPack = (bytes: Uint8Array) => {
  const files = unzipSync(bytes) as PackFiles;
  const manifest = files[PackManifest];
  if (!manifest) throw new Error(`Pack has no ${PackManifest}`);

  const pack = parsePack(JSON.parse(strFromU8(manifest)));
  return { pack, files };
};

/** Every audio file a pack references */
export const packFilePaths = (pack: Pack) => [
  ...pack.voices.map((track) => track.file),
  ...pack.stems.map((track) => track.file)
];
