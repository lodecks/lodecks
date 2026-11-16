import { Hono } from "hono";

import { PackExtension } from "@/common/constants/deck.constant";

import { ApiEnv } from "../../providers/storage.provider";

/**
 * Packs on the server are read only: listed, and served to download.
 * Players keep and save packs in their own browser (local first).
 */
export const PackModule = new Hono<ApiEnv>()
  .get("/", async (c) => {
    return c.json({ items: await c.get("storage").list() });
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id").replace(PackExtension, "");
    const file = await c.get("storage").file(id);

    return new Response(file.body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": `${file.size}`,
        "Cache-Control": "no-cache"
      }
    });
  });
