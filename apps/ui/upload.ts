/**
 * Fills the R2 bucket the Worker reads (wrangler.jsonc): every .lopack in
 * ../../packs, and onnxruntime-web's WebGPU wasm, too big to deploy as a
 * static file. `bun run upload` sends them to Cloudflare; `bun run upload
 * --local` to the bucket `vite preview` uses.
 */
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";

import { RuntimeWasm, runtimePath } from "@/engine/modules/importer/separate.module";

const Bucket = "lodecks-packs";
const where = process.argv.includes("--local") ? "--local" : "--remote";

const put = async (key: string, file: string, type: string) => {
  const wrangler = Bun.spawn(["bunx", "wrangler", "r2", "object", "put", `${Bucket}/${key}`, "--file", file, "--content-type", type, where], {
    cwd: import.meta.dir,
    stdout: "inherit",
    stderr: "inherit"
  });
  if ((await wrangler.exited) !== 0) throw new Error(`could not upload ${key}`);
};

const packs = join(import.meta.dir, "../../packs");
for (const name of (await readdir(packs)).filter((file) => file.endsWith(".lopack"))) {
  await put(name, join(packs, name), "application/zip");
}

const ort = createRequire(join(import.meta.dir, "../../packages/engine/package.json"));
const dist = dirname(ort.resolve("onnxruntime-web"));
const { version } = await Bun.file(join(dist, "../package.json")).json();
await put(runtimePath(version).slice(1), join(dist, RuntimeWasm), "application/wasm");

console.log(`uploaded to ${Bucket} (${where.slice(2)}): the packs and ${basename(RuntimeWasm)} for onnxruntime-web ${version}`);
