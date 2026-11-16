import { strFromU8, unzipSync } from "fflate";
import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { PackExtension, PackManifest } from "@/common/constants/deck.constant";
import { PackSummary, parsePack } from "@/common/schemas/pack.schema";

import { Config } from "./config.provider";

const IdPattern = /^[a-z0-9][a-z0-9._-]*$/i;

export class NotFoundError extends Error {}
export class InvalidError extends Error {}

type Cached = { modified: number; summary: PackSummary };

class StorageProvider {
  private summaries = new Map<string, Cached>();

  path(id: string) {
    if (!IdPattern.test(id)) throw new InvalidError(`Invalid pack id "${id}"`);
    return join(Config.packs, `${id}${PackExtension}`);
  }

  async list(): Promise<PackSummary[]> {
    await mkdir(Config.packs, { recursive: true });
    const names = (await readdir(Config.packs)).filter((name) =>
      name.endsWith(PackExtension)
    );

    const summaries = await Promise.all(
      names.map((name) =>
        this.summary(name.slice(0, -PackExtension.length)).catch(
          () => undefined
        )
      )
    );

    return summaries
      .filter((summary) => !!summary)
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  // reads only the manifest out of the zip, cached until the file changes
  async summary(id: string): Promise<PackSummary> {
    const path = this.path(id);
    const info = await stat(path).catch(() => undefined);
    if (!info) throw new NotFoundError(`Pack "${id}" not found`);

    const cached = this.summaries.get(id);
    if (cached && cached.modified === info.mtimeMs) return cached.summary;

    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    const files = unzipSync(bytes, {
      filter: (file) => file.name === PackManifest
    });
    if (!files[PackManifest]) throw new InvalidError(`Pack "${id}" is empty`);

    const pack = parsePack(JSON.parse(strFromU8(files[PackManifest])));
    const summary: PackSummary = {
      id,
      title: pack.title,
      artist: pack.artist,
      bpm: pack.bpm,
      key: pack.key,
      voices: pack.voices.length,
      stems: pack.stems.length,
      size: info.size
    };

    this.summaries.set(id, { modified: info.mtimeMs, summary });
    return summary;
  }

  async file(id: string) {
    const file = Bun.file(this.path(id));
    if (!(await file.exists())) throw new NotFoundError(`Pack "${id}" not found`);
    return file;
  }
}

export const Storage = new StorageProvider();
