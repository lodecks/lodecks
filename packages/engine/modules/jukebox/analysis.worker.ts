import { JukeboxVersion } from "@/common/schemas/jukebox.schema";

import { analyseMix } from "./features.module";
import { Grid, buildGraph } from "./graph.module";

export type AnalysisRequest = { mix: Float32Array; sampleRate: number; grid: Grid };

self.onmessage = (event: MessageEvent<AnalysisRequest>) => {
  const { mix, sampleRate, grid } = event.data;
  const started = performance.now();
  try {
    const analysis = analyseMix(mix, sampleRate, grid);
    const featuresMs = performance.now() - started;
    const jukebox = {
      version: JukeboxVersion,
      bar: buildGraph(analysis, "bar"),
      beat: buildGraph(analysis, "beat")
    };
    self.postMessage({
      ok: true,
      jukebox,
      ms: { features: Math.round(featuresMs), total: Math.round(performance.now() - started) }
    });
  } catch (error) {
    self.postMessage({ ok: false, error: (error as Error).message });
  }
};
