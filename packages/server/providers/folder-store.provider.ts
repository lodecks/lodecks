import { mkdir, open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { PackFile, PackStore } from "./storage.provider";

/** Packs in a folder on disk, for the Bun api */
export const folderStore = (folder: string): PackStore => {
  const fileOf = async (name: string): Promise<PackFile | undefined> => {
    const info = await stat(join(folder, name)).catch(() => undefined);
    return info?.isFile() ? { name, size: info.size, version: String(info.mtimeMs) } : undefined;
  };

  return {
    async list() {
      await mkdir(folder, { recursive: true });
      const files = await Promise.all((await readdir(folder)).map(fileOf));
      return files.filter((file) => !!file);
    },
    stat: fileOf,
    range: (name) => async (start, length) => {
      const handle = await open(join(folder, name));
      try {
        const bytes = new Uint8Array(length);
        const { bytesRead } = await handle.read(bytes, 0, length, start);
        return bytes.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    },
    async body(name) {
      const file = Bun.file(join(folder, name));
      return (await file.exists()) ? file : undefined;
    }
  };
};
