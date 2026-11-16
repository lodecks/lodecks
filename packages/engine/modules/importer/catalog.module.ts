/**
 * Every pack there is, local first: the ones kept in this browser, fresh
 * imports not saved yet, and the ones on the server to download. A pack
 * plays from the browser: one only on the server is downloaded first, and
 * saving always writes to the browser, never to the server.
 */
import { PackExtension } from "@/common/constants/deck.constant";
import { Pack, PackSummary } from "@/common/schemas/pack.schema";
import { unzipPack } from "@/common/utils/zip.util";

import { Store } from "../../utils/store.util";
import { Library } from "../visual/library.module";

// remote: on the server, not downloaded; local: in this browser; new: an
// import not saved yet
export type PackSource = "remote" | "local" | "new";
export type CatalogPack = PackSummary & { source: PackSource };

const summary = (id: string, pack: Pack, size: number): PackSummary => ({
  id,
  title: pack.title,
  artist: pack.artist,
  bpm: pack.bpm,
  key: pack.key,
  voices: pack.voices.length,
  stems: pack.stems.length,
  size
});

class CatalogModule {
  store = new Store<{ packs: CatalogPack[]; server: boolean; downloading: Record<string, number> }>({ packs: [], server: true, downloading: {} });
  // imports not saved anywhere yet, by id
  private fresh = new Map<string, { pack: Pack; bytes: Uint8Array }>();
  private refreshing?: Promise<CatalogPack[]>;

  list() {
    return this.store.get().packs;
  }

  find(id: string) {
    return this.list().find((pack) => pack.id === id);
  }

  sourceOf(id: string): PackSource | undefined {
    if (this.fresh.has(id)) return "new";
    return this.find(id)?.source;
  }

  // downloads in flight, so a pack is fetched once however many ask
  private downloads = new Map<string, Promise<Uint8Array>>();

  /** Reads both lists again; browser packs win over server ones of the same id */
  refresh() {
    this.refreshing ??= (async () => {
      let server: PackSummary[] = [];
      let up = true;
      try {
        const response = await fetch("/api/v1/packs");
        if (!response.ok) throw new Error();
        server = ((await response.json()) as { items: PackSummary[] }).items;
      } catch {
        up = false;
      }
      let local: CatalogPack[] = [];
      try {
        local = (await Library.packs()).map((record) => ({
          id: record.id,
          title: record.title,
          artist: record.artist,
          bpm: record.bpm,
          key: record.key,
          voices: 0,
          stems: 0,
          size: record.bytes.length,
          source: "local" as const
        }));
      } catch {}
      const fresh = [...this.fresh].map(([id, item]) => ({ ...summary(id, item.pack, item.bytes.length), source: "new" as const }));
      const taken = new Set([...fresh, ...local].map((pack) => pack.id));
      const packs = [
        ...fresh,
        ...local,
        ...server.filter((pack) => !taken.has(pack.id)).map((pack) => ({ ...pack, source: "remote" as const }))
      ].sort((a, b) => a.title.localeCompare(b.title));
      this.store.set({ packs, server: up });
      return packs;
    })().finally(() => (this.refreshing = undefined));
    return this.refreshing;
  }

  /** The bytes of a pack in this browser (or a fresh import), if it is one */
  async localBytes(id: string) {
    const fresh = this.fresh.get(id);
    if (fresh) return fresh.bytes;
    return (await Library.pack(id))?.bytes;
  }

  /**
   * Downloads a pack from the server into this browser, with its progress
   * in `downloading` (0…1), and returns its bytes
   */
  download(id: string) {
    const running = this.downloads.get(id);
    if (running) return running;
    const work = (async () => {
      const progress = (fraction: number) => this.store.set({ downloading: { ...this.store.get().downloading, [id]: fraction } });
      progress(0);
      const response = await fetch(this.url(id));
      if (!response.ok) throw new Error(response.status === 404 ? `no pack "${id}" on the server` : `the download failed (${response.status})`);
      const total = Number(response.headers.get("content-length")) || 0;
      const chunks: Uint8Array[] = [];
      let received = 0;
      const reader = response.body!.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total) progress(Math.min(0.99, received / total));
      }
      const bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const { pack } = unzipPack(bytes);
      await Library.savePack({ id, title: pack.title, artist: pack.artist, bpm: pack.bpm, key: pack.key, bytes, updatedAt: Date.now() });
      await this.refresh();
      return bytes;
    })().finally(() => {
      this.downloads.delete(id);
      const { [id]: _, ...rest } = this.store.get().downloading;
      this.store.set({ downloading: rest });
    });
    this.downloads.set(id, work);
    return work;
  }

  /** A pack's bytes from this browser, downloading it first when it is only on the server */
  async ensureLocal(id: string) {
    return (await this.localBytes(id)) ?? this.download(id);
  }

  /** Keeps a .lopack file (dropped or picked) in this browser */
  async addFile(id: string, bytes: Uint8Array) {
    const { pack } = unzipPack(bytes);
    await this.saveToBrowser(id, pack, bytes);
    return pack;
  }

  /** An id not taken yet, from a title; `own` is the pack's current id */
  freeId(title: string, own?: string) {
    const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "pack";
    const taken = new Set(this.list().map((pack) => pack.id).filter((id) => id !== own));
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  async addImport(id: string, pack: Pack, bytes: Uint8Array) {
    this.fresh.set(id, { pack, bytes });
    await this.refresh();
  }

  /** Keeps a pack in this browser */
  async saveToBrowser(id: string, pack: Pack, bytes: Uint8Array) {
    await Library.savePack({ id, title: pack.title, artist: pack.artist, bpm: pack.bpm, key: pack.key, bytes, updatedAt: Date.now() });
    this.fresh.delete(id);
    await this.refresh();
  }

  /** Lets a pack go from this browser; one on the server can be downloaded again */
  async remove(id: string) {
    this.fresh.delete(id);
    await Library.deletePack(id);
    await this.refresh();
  }

  url(id: string) {
    return `/api/v1/packs/${id}${PackExtension}`;
  }
}

export const Catalog = new CatalogModule();
