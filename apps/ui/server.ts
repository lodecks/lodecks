/**
 * The server entry (TanStack Start picks this file up). On Cloudflare
 * Workers it also answers the api, with the packs in R2, and serves the
 * runtime files too big to deploy as static files (/runtime, from the same
 * bucket). Locally the Bun api and Vite do both, so only the app comes here.
 */
import handler from "@tanstack/react-start/server-entry";

import { createApi } from "../api/api";
import { PacksBucket, r2Store } from "@/server/providers/r2-store.provider";
import { StorageProvider } from "@/server/providers/storage.provider";

import { setLocalApi } from "./utils/local-api.util";

/** The Worker's bindings (wrangler.jsonc) */
type WorkerEnv = { PACKS?: PacksBucket };

// cross-origin isolation, so the stem model can run on several threads;
// public/_headers sends the same on static files
const Isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless"
};

// one api per isolate, made on the first request that has the bucket
let api: ReturnType<typeof createApi> | undefined;
const apiFor = (env: WorkerEnv) => {
  if (!env.PACKS) return undefined;
  api ??= createApi(new StorageProvider(r2Store(env.PACKS)));
  return api;
};

// /runtime/onnxruntime-web@<version>/<file>.wasm, at runtime/... in the bucket
const RuntimeFile = /^\/runtime\/onnxruntime-web@[\w.-]+\/[\w.-]+\.wasm$/;

const runtimeFile = async (bucket: PacksBucket, path: string) => {
  const object = await bucket.get(path.slice(1));
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/wasm",
      "Content-Length": `${object.size}`,
      // the version is in the path
      "Cache-Control": "public, max-age=31536000, immutable"
    }
  });
};

const isolate = (response: Response) => {
  // responses from fetch() can have immutable headers
  const isolated = new Response(response.body, response);
  for (const [name, value] of Object.entries(Isolation)) isolated.headers.set(name, value);
  return isolated;
};

export default {
  async fetch(request: Request, env?: WorkerEnv) {
    const local = env ? apiFor(env) : undefined;
    if (local && env?.PACKS) {
      setLocalApi((inner) => local.fetch(inner));
      const path = new URL(request.url).pathname;
      if (path.startsWith("/api/v1/")) return isolate(await local.fetch(request));
      if (RuntimeFile.test(path)) return isolate(await runtimeFile(env.PACKS, path));
    }
    return isolate(await handler.fetch(request));
  }
};
