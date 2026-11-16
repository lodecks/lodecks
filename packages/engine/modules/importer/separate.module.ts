/**
 * Stem separation in the browser: HT-Demucs exported to ONNX (MIT, by
 * StemSplit, re-converted from Meta's weights), run in a worker. The model
 * is downloaded once, after the user agrees, and kept in Cache Storage.
 */
export const ModelUrl = "https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx";
export const ModelCache = "lodecks-models";
export const ModelSize = 166 * 1024 * 1024;
// samples per window at 44.1 kHz (7.8 s), as the model was exported
export const Segment = 343980;
export const StemOrder = ["drums", "bass", "other", "vocals"] as const;

/** Window weights: flat in the middle, ramps of `overlap` at both ends */
export const mixWindow = (size: number, overlap: number) => {
  const weights = new Float32Array(size);
  for (let i = 0; i < size; i++) weights[i] = Math.max(1e-3, Math.min(1, (i + 1) / overlap, (size - i) / overlap));
  return weights;
};

export const modelCached = async () => {
  if (typeof caches === "undefined") return false;
  return !!(await (await caches.open(ModelCache)).match(ModelUrl));
};

/** Downloads the model into the cache, reporting bytes as they come */
export const downloadModel = async (progress: (loaded: number, total: number) => void, signal?: AbortSignal) => {
  const response = await fetch(ModelUrl, { signal });
  if (!response.ok || !response.body) throw new Error(`the model could not be downloaded (${response.status})`);
  const total = Number(response.headers.get("content-length")) || ModelSize;
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    progress(loaded, total);
  }
  const blob = new Blob(parts as BlobPart[], { type: "application/octet-stream" });
  await (await caches.open(ModelCache)).put(ModelUrl, new Response(blob, { headers: { "content-length": String(blob.size) } }));
};

export const forgetModel = async () => {
  if (typeof caches !== "undefined") await (await caches.open(ModelCache)).delete(ModelUrl);
};

/** Where the model runs: the GPU, or wasm threads on the CPU */
export type Backend = "webgpu" | "wasm";

export type SeparateProgress = { done: number; total: number; eta: number; backend: Backend; threads: number };

/** Runs the model over a stereo song; resolves to mono stems by name */
export const separate = (
  left: Float32Array,
  right: Float32Array,
  progress: (state: SeparateProgress) => void,
  signal?: AbortSignal,
  backend: Backend | "auto" = "auto"
) =>
  new Promise<Record<(typeof StemOrder)[number], Float32Array>>((resolve, reject) => {
    const worker = new Worker(new URL("./separate.worker.ts", import.meta.url), { type: "module" });
    const stop = () => {
      worker.terminate();
      reject(new DOMException("cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", stop, { once: true });
    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === "progress") progress(message);
      if (message.type === "done" || message.type === "error") {
        signal?.removeEventListener("abort", stop);
        worker.terminate();
        if (message.type === "done") resolve(message.stems);
        else reject(new Error(message.message));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "the separation worker failed"));
    };
    worker.postMessage({ type: "separate", left, right, backend }, [left.buffer, right.buffer]);
  });
