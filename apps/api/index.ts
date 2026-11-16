import { Config } from "@/server/providers/config.provider";

import { Handler } from "./api";

console.log(`lodecks api on :${Config.port}, packs in ${Config.packs}`);

export default {
  port: Config.port,
  // packs can be large
  maxRequestBodySize: 1024 * 1024 * 1024,
  fetch: Handler.fetch
};
