import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { createReadStream } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Plugin, defaultClientConditions, defineConfig } from "vite";

// cross-origin isolation, so the stem model can run on several threads
// (credentialless keeps cross-origin loads working without CORP headers)
const Isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless"
};

/** Sends the isolation headers on every response, the rendered pages too */
const isolate = (): Plugin => ({
  name: "lodecks-isolation",
  configureServer(server) {
    server.middlewares.use((_request, response, next) => {
      for (const [name, value] of Object.entries(Isolation)) response.setHeader(name, value);
      next();
    });
  }
});

/**
 * /runtime/onnxruntime-web@<version>/<file>.wasm in dev, from the package:
 * the WebGPU wasm is too big to bundle for Cloudflare, so production serves
 * it from R2 (server.ts) and dev from here, at the same path.
 */
const runtimeFiles = (): Plugin => ({
  name: "lodecks-runtime-files",
  configureServer(server) {
    const dist = dirname(createRequire(join(server.config.root, "../../packages/engine/package.json")).resolve("onnxruntime-web"));
    server.middlewares.use((request, response, next) => {
      const match = /^\/runtime\/onnxruntime-web@[\w.-]+\/([\w.-]+\.wasm)$/.exec(request.url?.split("?")[0] ?? "");
      if (!match) return next();
      response.setHeader("Content-Type", "application/wasm");
      createReadStream(join(dist, match[1]))
        .on("error", () => {
          response.statusCode = 404;
          response.end();
        })
        .pipe(response);
    });
  }
});

const config = defineConfig(({ command, isPreview }) => ({
  resolve: {
    tsconfigPaths: true,
    // strudel breaks when its core is loaded twice
    dedupe: ["@strudel/core", "superdough"],
    // onnxruntime-web's builds that load their wasm from wasmPaths instead
    // of bundling it: its WebGPU wasm is too big for Cloudflare's static files
    conditions: [...defaultClientConditions, "onnxruntime-web-use-extern-wasm"]
  },
  plugins: [
    isolate(),
    runtimeFiles(),
    // builds for Cloudflare Workers (wrangler.jsonc), and `vite preview`
    // runs that build in workerd; `vite dev` stays on node with the Bun api
    (command === "build" || isPreview) && cloudflare({ viteEnvironment: { name: "ssr" } }),
    // the docs at /docs (content/docs, see source.config.ts)
    mdx(),
    tailwindcss(),
    tanstackStart({
      srcDirectory: "./"
    }),
    viteReact()
  ],
  // onnxruntime-web loads its own wasm at runtime; pre-bundling breaks that
  // meyda is only reached from a worker; listed so vite does not reload the
  // page to bundle it the first time a pack is analysed
  optimizeDeps: { exclude: ["onnxruntime-web"], include: ["@/engine > meyda"] },
  worker: { format: "es" },
  // @kabelsalat/web (imported by @strudel/core) has no exports map, so node
  // loads its commonjs build, which lacks the named exports strudel imports:
  // vite bundles them for the server render, from their es builds
  ssr: { noExternal: [/^@strudel\//, /^@kabelsalat\//, "superdough"] },
  server: {
    proxy: {
      "/api/v1": {
        target: process.env.LODECKS_API || "http://127.0.0.1:8090",
        changeOrigin: false
      }
    },
    host: "0.0.0.0",
    headers: Isolation
  }
}));

export default config;
