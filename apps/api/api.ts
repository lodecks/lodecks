import { Hono } from "hono";
import { ZodError } from "zod";

import {
  ApiEnv,
  InvalidError,
  NotFoundError,
  StorageProvider
} from "@/server/providers/storage.provider";

import { Controllers } from "./controllers";

/** The api over a pack store: the folder (Bun) or an R2 bucket (Workers) */
export const createApi = (storage: StorageProvider) => {
  const api = new Hono<ApiEnv>()
    .basePath("/api/v1")
    .use(async (c, next) => {
      c.set("storage", storage);
      await next();
    })
    .get("/health", (c) => c.json({ ok: true }))
    .route("/", Controllers);

  api.onError((error, c) => {
    if (error instanceof NotFoundError) {
      return c.json({ error: error.message }, 404);
    }
    if (error instanceof InvalidError || error instanceof ZodError) {
      return c.json({ error: error.message }, 400);
    }

    console.error(error);
    return c.json({ error: "Internal error" }, 500);
  });

  return api;
};

export type ApiType = ReturnType<typeof createApi>;
