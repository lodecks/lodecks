/** Runs the analysis (analyse.module) off the main thread */
import { AnalyseInput, analyse } from "./analyse.module";

self.onmessage = (event: MessageEvent<AnalyseInput>) => {
  try {
    const logs: string[] = [];
    const { analysis, files } = analyse(event.data, (message) => {
      logs.push(message);
      self.postMessage({ type: "log", message });
    });
    const buffers = [...new Set(Object.values(files).map((audio) => audio.buffer))];
    self.postMessage({ type: "done", analysis, files, logs }, { transfer: buffers as ArrayBuffer[] });
  } catch (error) {
    self.postMessage({ type: "error", message: (error as Error).message ?? String(error) });
  }
};
