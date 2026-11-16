import { folderStore } from "@/server/providers/folder-store.provider";
import { StorageProvider } from "@/server/providers/storage.provider";
import { Config } from "@/server/providers/config.provider";

import { createApi } from "./api";

const Handler = createApi(new StorageProvider(folderStore(Config.packs)));

console.log(`lodecks api on :${Config.port}, packs in ${Config.packs}`);

export default {
  port: Config.port,
  // packs can be large
  maxRequestBodySize: 1024 * 1024 * 1024,
  fetch: Handler.fetch
};
