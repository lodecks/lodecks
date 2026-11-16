/**
 * Song → pack, in the browser: decode, split into stems (HT-Demucs in a
 * worker), analyse (the grid, key, sections and phrases, in a worker),
 * encode, build and zip. The pack is then kept as a fresh import in the
 * catalogue, ready to be loaded and edited.
 */
import { Analysis, buildPack } from "@/common/utils/build-pack.util";
import { encodeWav } from "@/common/utils/wav.util";
import { PackFiles, zipPack } from "@/common/utils/zip.util";

import { Store } from "../../utils/store.util";
import { SR } from "./analyse.module";
import { Catalog } from "./catalog.module";
import { canEncodeOpus, encodeOggOpus } from "./ogg.module";
import { ModelSize, downloadModel, modelCached, separate } from "./separate.module";

export type ImportStage = "idle" | "decode" | "consent" | "download" | "separate" | "analyse" | "encode" | "build" | "done" | "error";

export type ImportState = {
  stage: ImportStage;
  title: string;
  // 0…1 for the whole import
  progress: number;
  detail: string;
  // ms left in the current stage, when known
  eta?: number;
  error?: string;
  // the pack, once built
  packId?: string;
  log: string[];
};

export type ImportOptions = { title?: string; bpm?: number; key?: string };

// how much of the bar each stage fills
const Span: Partial<Record<ImportStage, [number, number]>> = {
  decode: [0, 0.03],
  download: [0.03, 0.03],
  separate: [0.03, 0.75],
  analyse: [0.75, 0.9],
  encode: [0.9, 0.98],
  build: [0.98, 1]
};

const Idle: ImportState = { stage: "idle", title: "", progress: 0, detail: "", log: [] };

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

class ImporterModule {
  store = new Store<ImportState>(Idle);
  private abort?: AbortController;
  private answer?: (choice: "download" | "skip") => void;

  get busy() {
    const stage = this.store.get().stage;
    return stage !== "idle" && stage !== "done" && stage !== "error";
  }

  private set(stage: ImportStage, fraction: number, detail: string, eta?: number) {
    const [from, to] = Span[stage] ?? [this.store.get().progress, this.store.get().progress];
    this.store.set({ stage, progress: from + (to - from) * fraction, detail, eta });
  }

  private log(message: string) {
    this.store.set({ log: [...this.store.get().log, message].slice(-40) });
  }

  /** The user's answer to "download the stem model?" */
  consent(choice: "download" | "skip") {
    this.answer?.(choice);
  }

  cancel() {
    this.abort?.abort();
    this.answer?.("skip");
  }

  reset() {
    if (!this.busy) this.store.set(Idle);
  }

  async run(file: File, options: ImportOptions = {}) {
    if (this.busy) throw new Error("an import is already running");
    const title = (options.title || file.name.replace(/\.[^.]+$/, "")).trim() || "untitled";
    const abort = new AbortController();
    this.abort = abort;
    this.store.set({ ...Idle, stage: "decode", title, detail: `reading ${file.name}`, log: [] });
    const check = () => {
      if (abort.signal.aborted) throw new DOMException("cancelled", "AbortError");
    };

    try {
      // —— decode, at the packs' rate ——
      const context = new OfflineAudioContext(2, 1, SR);
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      const left = decoded.getChannelData(0).slice();
      const right = (decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : decoded.getChannelData(0)).slice();
      const mix = new Float32Array(left.length);
      for (let i = 0; i < mix.length; i++) mix[i] = 0.5 * (left[i] + right[i]);
      this.log(`${title}: ${(decoded.duration / 60).toFixed(1)} min`);
      check();

      // —— stems ——
      let stems: Record<string, Float32Array>;
      let split = await modelCached();
      if (!split) {
        this.set("consent", 0, `the stem model is a one-time ${mb(ModelSize)} download`);
        const choice = await new Promise<"download" | "skip">((resolve) => (this.answer = resolve));
        this.answer = undefined;
        check();
        if (choice === "download") {
          this.set("download", 0, "downloading the stem model");
          await downloadModel((loaded, total) => this.set("download", loaded / total, `stem model ${mb(loaded)} of ${mb(total)}`), abort.signal);
          split = true;
        }
      }
      if (split) {
        this.set("separate", 0, "splitting into stems");
        stems = await separate(
          left,
          right,
          ({ done, total, eta, backend, threads }) =>
            this.set("separate", done / total, `splitting into stems · ${done}/${total} · ${backend === "webgpu" ? "gpu" : `${threads} thread${threads === 1 ? "" : "s"}`}`, eta),
          abort.signal
        );
        this.log("stems: drums, bass, other, vocals");
      } else {
        // without the model: the whole song is the one stem
        stems = { other: mix.slice() };
        this.log("no stem split: the whole song is one stem");
      }
      check();

      // —— analysis ——
      this.set("analyse", 0, "finding the grid, key and phrases");
      const { analysis, files } = await new Promise<{ analysis: Analysis; files: Record<string, Float32Array> }>((resolve, reject) => {
        const worker = new Worker(new URL("./analyse.worker.ts", import.meta.url), { type: "module" });
        abort.signal.addEventListener("abort", () => {
          worker.terminate();
          reject(new DOMException("cancelled", "AbortError"));
        }, { once: true });
        worker.onmessage = (event) => {
          const message = event.data;
          if (message.type === "log") {
            this.log(message.message);
            this.set("analyse", 0.5, message.message);
          }
          if (message.type === "done" || message.type === "error") {
            worker.terminate();
            if (message.type === "done") resolve(message);
            else reject(new Error(message.message));
          }
        };
        worker.onerror = (event) => {
          worker.terminate();
          reject(new Error(event.message || "the analysis failed"));
        };
        worker.postMessage({ mix, stems, bpm: options.bpm, key: options.key });
      });
      check();

      // —— encode: long tracks as opus, hits as wav ——
      const opus = await canEncodeOpus();
      const long = new Set([
        ...analysis.stems.map((stem) => stem.file),
        ...analysis.voices.filter((voice) => voice.type === "stem" || (voice.bars ?? 0) >= 4).map((voice) => voice.file)
      ]);
      const packFiles: PackFiles = {};
      const renamed = new Map<string, string>();
      const paths = Object.keys(files);
      for (const [index, path] of paths.entries()) {
        this.set("encode", index / paths.length, `encoding ${path}`);
        if (opus && long.has(path)) {
          const target = path.replace(/\.wav$/, ".ogg");
          packFiles[target] = await encodeOggOpus(files[path], SR);
          renamed.set(path, target);
        } else {
          packFiles[path] = encodeWav([files[path]], SR);
        }
        check();
      }
      for (const entry of [...analysis.stems, ...analysis.voices]) entry.file = renamed.get(entry.file) ?? entry.file;

      // —— build ——
      this.set("build", 0, "building the pack");
      const pack = buildPack(analysis, { title });
      const bytes = zipPack(pack, packFiles);
      await Catalog.refresh();
      const id = Catalog.freeId(title);
      await Catalog.addImport(id, pack, bytes);
      this.log(`${pack.bpm} bpm · ${pack.key} · ${pack.sections.length} sections · ${pack.voices.length} voices · ${mb(bytes.length)}`);
      this.store.set({ stage: "done", progress: 1, detail: `${pack.bpm} bpm · ${pack.key} · ${mb(bytes.length)}`, packId: id, eta: undefined });
      return id;
    } catch (error) {
      const cancelled = (error as Error).name === "AbortError";
      this.store.set({ stage: "error", error: cancelled ? "cancelled" : (error as Error).message, eta: undefined });
      return undefined;
    } finally {
      this.abort = undefined;
    }
  }
}

export const Importer = new ImporterModule();
