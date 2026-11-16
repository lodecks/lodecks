import { resolve } from "node:path";

export const Config = {
  port: Number(process.env.LODECKS_PORT || 8090),
  // where .lopack files live
  packs: resolve(process.env.LODECKS_PACKS || `${import.meta.dir}/../../../packs`)
};
