/**
 * Splits a song into drums, bass, other and vocals with HT-Demucs (ONNX,
 * onnxruntime-web). Runs in its own worker, on the GPU through WebGPU when
 * the browser has it, else on wasm threads. The model comes from the
 * browser's cache, downloaded there by the importer.
 */
import type * as Ort from "onnxruntime-web";
import gpuWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

import { Backend, ModelCache, ModelUrl, Segment, StemOrder, mixWindow } from "./separate.module";

type Request = { type: "separate"; left: Float32Array; right: Float32Array; backend?: Backend | "auto" };
type Loaded = { ort: typeof Ort; session: Ort.InferenceSession; backend: Backend; threads: number };

let model: Uint8Array | undefined;
let loaded: Loaded | undefined;

const modelBytes = async () => {
  if (model) return model;
  const cached = await (await caches.open(ModelCache)).match(ModelUrl);
  if (!cached) throw new Error("the stem model is not downloaded");
  return (model = new Uint8Array(await cached.arrayBuffer()));
};

// threads need a cross-origin isolated page; one thread works anywhere
const threadCount = () => (self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)) : 1);

const gpuAvailable = async () => {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
};

/**
 * A session on the GPU: ops WebGPU lacks run on the CPU beside it. The
 * JSEP build, not the native one ("onnxruntime-web/webgpu"): that one
 * leaves a node of the model's iSTFT without a provider and won't build.
 */
const loadGpu = async (): Promise<Loaded> => {
  const ort = (await import("onnxruntime-web")) as typeof Ort;
  ort.env.wasm.wasmPaths = { wasm: gpuWasmUrl };
  ort.env.wasm.numThreads = threadCount();
  const session = await ort.InferenceSession.create(await modelBytes(), {
    executionProviders: ["webgpu"],
    // as on wasm: optimising copies the weights and runs out of memory
    graphOptimizationLevel: "disabled",
    enableCpuMemArena: false,
    enableMemPattern: false
  });
  return { ort, session, backend: "webgpu", threads: ort.env.wasm.numThreads as number };
};

const loadWasm = async (): Promise<Loaded> => {
  const ort = (await import("onnxruntime-web/wasm")) as typeof Ort;
  ort.env.wasm.wasmPaths = { wasm: wasmUrl };
  ort.env.wasm.numThreads = threadCount();
  // light options: full optimisation folds the fp16 → fp32 casts into
  // extra copies of the weights and runs out of wasm memory
  const session = await ort.InferenceSession.create(await modelBytes(), {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "disabled",
    enableCpuMemArena: false,
    enableMemPattern: false
  });
  return { ort, session, backend: "wasm", threads: ort.env.wasm.numThreads as number };
};

const load = async (wanted: Backend | "auto") => {
  if (loaded && (wanted === "auto" || loaded.backend === wanted)) return loaded;
  await loaded?.session.release();
  loaded = undefined;
  if (wanted !== "wasm" && (await gpuAvailable())) {
    try {
      return (loaded = await loadGpu());
    } catch (error) {
      if (wanted === "webgpu") throw error;
      console.warn("[separate] webgpu failed, using wasm", error);
    }
  }
  return (loaded = await loadWasm());
};

const runWindow = async (input: Float32Array) => {
  const { ort, session } = loaded!;
  const result = await session.run({ mix: new ort.Tensor("float32", input, [1, 2, Segment]) });
  return result.stems.data as Float32Array;
};

self.onmessage = async (event: MessageEvent<Request>) => {
  const { left, right } = event.data;
  try {
    await load(event.data.backend ?? "auto");
    const length = left.length;
    const overlap = Math.floor(Segment / 4);
    const stride = Segment - overlap;
    const windows = Math.max(1, Math.ceil((length - overlap) / stride));
    const weights = mixWindow(Segment, overlap);

    // mono stems are what packs keep; summed straight into the output
    const stems = StemOrder.map(() => new Float32Array(length));
    const total = new Float32Array(length);
    const input = new Float32Array(2 * Segment);
    const started = performance.now();

    for (let index = 0; index < windows; index++) {
      const start = index * stride;
      const size = Math.min(Segment, length - start);
      input.fill(0);
      input.set(left.subarray(start, start + size), 0);
      input.set(right.subarray(start, start + size), Segment);
      let out: Float32Array;
      try {
        out = await runWindow(input);
      } catch (error) {
        // a GPU that fails on the first window: start over on wasm
        if (loaded?.backend !== "webgpu" || index > 0 || event.data.backend === "webgpu") throw error;
        console.warn("[separate] webgpu run failed, using wasm", error);
        await load("wasm");
        out = await runWindow(input);
      }
      for (let stem = 0; stem < StemOrder.length; stem++) {
        const l = stem * 2 * Segment;
        const r = l + Segment;
        const target = stems[stem];
        for (let i = 0; i < size; i++) target[start + i] += 0.5 * (out[l + i] + out[r + i]) * weights[i];
      }
      for (let i = 0; i < size; i++) total[start + i] += weights[i];
      const elapsed = performance.now() - started;
      self.postMessage({ type: "progress", done: index + 1, total: windows, eta: (elapsed / (index + 1)) * (windows - index - 1), backend: loaded!.backend, threads: loaded!.threads });
    }

    for (const stem of stems) for (let i = 0; i < length; i++) stem[i] /= total[i] || 1;
    const named = Object.fromEntries(StemOrder.map((name, index) => [name, stems[index]]));
    self.postMessage({ type: "done", stems: named }, { transfer: stems.map((stem) => stem.buffer) });
  } catch (error) {
    self.postMessage({ type: "error", message: (error as Error).message ?? String(error) });
  }
};
