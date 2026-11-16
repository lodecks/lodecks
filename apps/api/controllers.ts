import { Hono } from "hono";

import { ApiEnv } from "@/server/providers/storage.provider";

import { FetchController } from "./controllers/fetch.controller";
import { PackController } from "./controllers/pack.controller";

export const Controllers = new Hono<ApiEnv>()
  .route("/", PackController)
  .route("/", FetchController);
