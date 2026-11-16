import { strFromU8 } from "fflate";

import { PackExtension, PackManifest } from "@/common/constants/deck.constant";
import { PackSummary, parsePack } from "@/common/schemas/pack.schema";

import { ReadRange, readZipEntry } from "../utils/zip-entry.util";

const IdPattern = /^[a-z0-9][a-z0-9._-]*$/i;

export class NotFoundError extends Error {}
export class InvalidError extends Error {}

/** A .lopack in a store: its name, size and a version that changes with it */
export type PackFile = { name: string; size: number; version: string };

/**
 * Where the server's packs live: a folder (the Bun api) or an R2 bucket
 * (Cloudflare Workers). Read only.
 */
export type PackStore = {
  list(): Promise<PackFile[]>;
  stat(name: string): Promise<PackFile | undefined>;
  range(name: string): ReadRange;
  /** The whole file, streamed */
  body(name: string): Promise<ReadableStream | Blob | undefined>;
};

/** What the api's routes see: the packs of the store it was made with */
export type ApiEnv = { Variables: { storage: StorageProvider } };

type Cached = { version: string; summary: PackSummary };

export class StorageProvider {
  private summaries = new Map<string, Cached>();

  constructor(private store: PackStore) {}

  private name(id: string) {
    if (!IdPattern.test(id)) throw new InvalidError(`Invalid pack id "${id}"`);
    return `${id}${PackExtension}`;
  }

  async list(): Promise<PackSummary[]> {
    const files = (await this.store.list()).filter((file) => file.name.endsWith(PackExtension));
    const summaries = await Promise.all(files.map((file) => this.summarise(file).catch(() => undefined)));
    return summaries.filter((summary) => !!summary).sort((a, b) => a.title.localeCompare(b.title));
  }

  async summary(id: string): Promise<PackSummary> {
    const file = await this.store.stat(this.name(id));
    if (!file) throw new NotFoundError(`Pack "${id}" not found`);
    return this.summarise(file);
  }

  // reads only the manifest out of the zip, cached until the file changes
  private async summarise(file: PackFile): Promise<PackSummary> {
    const id = file.name.slice(0, -PackExtension.length);
    const cached = this.summaries.get(id);
    if (cached && cached.version === file.version) return cached.summary;

    const manifest = await readZipEntry(this.store.range(file.name), file.size, PackManifest);
    if (!manifest) throw new InvalidError(`Pack "${id}" is empty`);

    const pack = parsePack(JSON.parse(strFromU8(manifest)));
    const summary: PackSummary = {
      id,
      title: pack.title,
      artist: pack.artist,
      bpm: pack.bpm,
      key: pack.key,
      voices: pack.voices.length,
      stems: pack.stems.length,
      size: file.size
    };

    this.summaries.set(id, { version: file.version, summary });
    return summary;
  }

  /** The pack file to send, with its size */
  async file(id: string) {
    const name = this.name(id);
    const [file, body] = await Promise.all([this.store.stat(name), this.store.body(name)]);
    if (!file || !body) throw new NotFoundError(`Pack "${id}" not found`);
    return { body, size: file.size };
  }
}
