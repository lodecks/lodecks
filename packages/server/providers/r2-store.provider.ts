import { PackFile, PackStore } from "./storage.provider";

// the part of an R2 bucket binding this store uses (see wrangler.jsonc)
type R2Object = { key: string; size: number; etag: string };
type R2Body = R2Object & { body: ReadableStream; arrayBuffer(): Promise<ArrayBuffer> };
export type PacksBucket = {
  list(options?: { cursor?: string }): Promise<{ objects: R2Object[]; truncated: boolean; cursor?: string }>;
  head(key: string): Promise<R2Object | null>;
  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<R2Body | null>;
};

const fileOf = (object: R2Object): PackFile => ({ name: object.key, size: object.size, version: object.etag });

/** Packs in an R2 bucket, for Cloudflare Workers: each one at the top level, as <id>.lopack */
export const r2Store = (bucket: PacksBucket): PackStore => ({
  async list() {
    const files: PackFile[] = [];
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ cursor });
      files.push(...page.objects.map(fileOf));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return files;
  },
  async stat(name) {
    const object = await bucket.head(name);
    return object ? fileOf(object) : undefined;
  },
  range: (name) => async (start, length) => {
    const object = await bucket.get(name, { range: { offset: start, length } });
    if (!object) throw new Error(`${name} is gone`);
    return new Uint8Array(await object.arrayBuffer());
  },
  async body(name) {
    return (await bucket.get(name))?.body ?? undefined;
  }
});
