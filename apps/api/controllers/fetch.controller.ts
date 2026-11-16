import { Hono } from "hono";

import { FetchModule } from "@/server/modules/fetch/fetch.module";

export const FetchController = new Hono().route("/fetch", FetchModule);
