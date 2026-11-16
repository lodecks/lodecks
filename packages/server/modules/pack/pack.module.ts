import { Hono } from "hono";

import { PackExtension } from "@/common/constants/deck.constant";

import { Storage } from "../../providers/storage.provider";

/**
 * Packs on the server are read only: listed, and served to download.
 * Players keep and save packs in their own browser (local first).
 */
export const PackModule = new Hono()
  .get("/", async (c) => {
    return c.json({ items: await Storage.list() });
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id").replace(PackExtension, "");
    const file = await Storage.file(id);

    return new Response(file, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": `${file.size}`,
        "Cache-Control": "no-cache"
      }
    });
  });
