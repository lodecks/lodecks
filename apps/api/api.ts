import { Hono } from "hono";
import { ZodError } from "zod";

import {
  InvalidError,
  NotFoundError
} from "@/server/providers/storage.provider";

import { Controllers } from "./controllers";

export const Api = new Hono()
  .basePath("/api/v1")
  .get("/health", (c) => c.json({ ok: true }))
  .route("/", Controllers);

Api.onError((error, c) => {
  if (error instanceof NotFoundError) {
    return c.json({ error: error.message }, 404);
  }
  if (error instanceof InvalidError || error instanceof ZodError) {
    return c.json({ error: error.message }, 400);
  }

  console.error(error);
  return c.json({ error: "Internal error" }, 500);
});

export type ApiType = typeof Api;
export const Handler = Api;
