import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { Plugin, defineConfig } from "vite";

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

const config = defineConfig({
  resolve: {
    tsconfigPaths: true,
    // strudel breaks when its core is loaded twice
    dedupe: ["@strudel/core", "superdough"]
  },
  plugins: [
    isolate(),
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
});

export default config;
