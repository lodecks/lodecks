import { Hono } from "hono";

import { PackModule } from "@/server/modules/pack/pack.module";
import { ApiEnv } from "@/server/providers/storage.provider";

export const PackController = new Hono<ApiEnv>().route("/packs", PackModule);
