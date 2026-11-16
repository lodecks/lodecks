import { Hono } from "hono";

import { PackModule } from "@/server/modules/pack/pack.module";

export const PackController = new Hono().route("/packs", PackModule);
