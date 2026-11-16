import { Hono } from "hono";

import { FetchController } from "./controllers/fetch.controller";
import { PackController } from "./controllers/pack.controller";

export const Controllers = new Hono()
  .route("/", PackController)
  .route("/", FetchController);
