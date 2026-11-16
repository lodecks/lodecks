/**
 * The effects library, kept in the browser (IndexedDB): user effects and
 * imported gifs. Built-in effects live in code and are never stored.
 */
export type EffectKind = "hydra" | "shader" | "gif";

export type Effect = {
  id: string;
  name: string;
  kind: EffectKind;
  code: string;
  description?: string;
  // gif played by the effect: its own picture for "gif", a layer otherwise
  gifId?: string;
  // loop length in beats, auto when unset
  beats?: number;
  builtIn?: boolean;
  updatedAt: number;
};

export type GifRecord = {
  id: string;
  name: string;
  blob: Blob;
  // url it was imported from
  source?: string;
  createdAt: number;
};

/** A live set; snapshots of it are kept as "snap:<id>:<time>" */
export type SetRecord = { id: string; name: string; code: string; updatedAt: number };

/** A pack kept in the browser (imported, or saved here instead of the server) */
export type PackRecord = { id: string; title: string; artist: string; bpm: number; key: string; bytes: Uint8Array; updatedAt: number };

const Name = "lodecks";
const Version = 3;
// "modules" is left over from an earlier live language, kept so the
// database does not need another upgrade
const Stores = { effects: "id", gifs: "id", modules: "name", sets: "id", packs: "id" } as const;
type StoreName = keyof typeof Stores;
// snapshots of the set kept besides the current one
const SetHistory = 20;

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

class LibraryModule {
  private db?: Promise<IDBDatabase>;

  get available() {
    return typeof indexedDB !== "undefined";
  }

  private open() {
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(Name, Version);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, keyPath] of Object.entries(Stores)) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  private async store(name: StoreName, mode: IDBTransactionMode) {
    return (await this.open()).transaction(name, mode).objectStore(name);
  }

  async effects() {
    const effects = await request<Effect[]>((await this.store("effects", "readonly")).getAll());
    return effects.sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveEffect(effect: Effect) {
    await request((await this.store("effects", "readwrite")).put({ ...effect, builtIn: undefined }));
  }

  async deleteEffect(id: string) {
    await request((await this.store("effects", "readwrite")).delete(id));
  }

  async gifs() {
    const gifs = await request<GifRecord[]>((await this.store("gifs", "readonly")).getAll());
    return gifs.sort((a, b) => b.createdAt - a.createdAt);
  }

  async gif(id: string) {
    return request<GifRecord | undefined>((await this.store("gifs", "readonly")).get(id));
  }

  async saveGif(gif: GifRecord) {
    await request((await this.store("gifs", "readwrite")).put(gif));
  }

  async deleteGif(id: string) {
    await request((await this.store("gifs", "readwrite")).delete(id));
  }

  async packs() {
    const packs = await request<PackRecord[]>((await this.store("packs", "readonly")).getAll());
    return packs.sort((a, b) => a.title.localeCompare(b.title));
  }

  async pack(id: string) {
    return request<PackRecord | undefined>((await this.store("packs", "readonly")).get(id));
  }

  async savePack(pack: PackRecord) {
    await request((await this.store("packs", "readwrite")).put(pack));
  }

  async deletePack(id: string) {
    await request((await this.store("packs", "readwrite")).delete(id));
  }

  /** The live sets, newest first (snapshots left out) */
  async sets() {
    const all = await request<SetRecord[]>((await this.store("sets", "readonly")).getAll());
    return all.filter((item) => !item.id.startsWith("snap:")).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async set(id: string) {
    return request<SetRecord | undefined>((await this.store("sets", "readonly")).get(id));
  }

  async saveSet(set: SetRecord) {
    await request((await this.store("sets", "readwrite")).put(set));
  }

  async deleteSet(id: string) {
    const store = await this.store("sets", "readwrite");
    await request(store.delete(id));
    for (const snap of await this.snapshots(id)) await request((await this.store("sets", "readwrite")).delete(snap.id));
  }

  /** Keeps a copy of a set in its history, dropping the oldest */
  async snapshot(set: SetRecord) {
    const now = Date.now();
    await request((await this.store("sets", "readwrite")).put({ ...set, id: `snap:${set.id}:${now}`, updatedAt: now }));
    const snaps = await this.snapshots(set.id);
    for (const old of snaps.slice(SetHistory)) await request((await this.store("sets", "readwrite")).delete(old.id));
  }

  async snapshots(id: string) {
    const all = await request<SetRecord[]>((await this.store("sets", "readonly")).getAll());
    return all.filter((item) => item.id.startsWith(`snap:${id}:`)).sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

export const Library = new LibraryModule();
