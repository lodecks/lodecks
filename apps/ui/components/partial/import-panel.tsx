import { X } from "lucide-react";
import { useEffect } from "react";

import { useEngine } from "@/hooks/engine.hook";
import { useImporter } from "@/hooks/import.hook";
import { cn } from "~/utils/classes.util";

const StageNames = {
  idle: "",
  decode: "reading the song",
  consent: "stem model",
  download: "downloading the stem model",
  separate: "splitting into stems",
  analyse: "analysing",
  encode: "encoding",
  build: "building the pack",
  done: "done",
  error: "import stopped"
};

const time = (ms?: number) => {
  if (!ms || !Number.isFinite(ms)) return "";
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s left` : `${Math.floor(seconds / 60)}m ${seconds % 60}s left`;
};

/** A song becoming a pack: stages, progress, the model question, cancel */
export const ImportPanel = () => {
  const engine = useEngine();
  const state = useImporter();
  const active = state.stage !== "idle";

  // a finished import closes itself after a moment
  useEffect(() => {
    if (state.stage !== "done") return;
    const timer = setTimeout(() => engine?.importer.reset(), 4000);
    return () => clearTimeout(timer);
  }, [state.stage, engine]);

  if (!active) return null;
  const working = state.stage !== "done" && state.stage !== "error";

  return (
    <div className="border-line-strong fixed right-4 bottom-4 z-[65] w-[420px] rounded-[5px] border bg-[#0b0f17]/95 p-3 text-[12px] shadow-[0_18px_50px_rgba(0,0,0,0.7)] backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <span className="legend !text-[8px]">import</span>
        <span className="text-bright min-w-0 flex-1 truncate">{state.title}</span>
        {working ? (
          <button className="text-bad text-[10px] uppercase tracking-[0.06em]" onClick={() => engine?.importer.cancel()}>
            cancel
          </button>
        ) : (
          <button className="text-dim hover:text-bright" onClick={() => engine?.importer.reset()}>
            <X size={13} strokeWidth={1.75} />
          </button>
        )}
      </div>

      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <span
          className={cn("block h-full rounded-full transition-[width] duration-300", state.stage === "error" ? "bg-bad" : "bg-deck-a")}
          style={{ width: `${Math.round(state.progress * 100)}%` }}
        />
      </div>
      <div className="mt-1.5 flex gap-2 font-mono text-[11px]">
        <span className={state.stage === "error" ? "text-bad" : state.stage === "done" ? "text-deck-a" : "text-text"}>
          {StageNames[state.stage]}
        </span>
        <span className="text-dim min-w-0 flex-1 truncate">{state.stage === "error" ? state.error : state.detail}</span>
        <span className="text-dim shrink-0">{time(state.eta)}</span>
      </div>

      {state.stage === "consent" && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-text leading-[1.5]">
            Splitting into stems (drums, bass, vocals, other) uses a 166 MB model (HT-Demucs, MIT) from Hugging Face. It is downloaded
            once and kept in this browser.
          </p>
          <div className="flex gap-2">
            <button className="bg-deck-a text-ink rounded-[3px] px-3 py-1 text-[11px] uppercase tracking-[0.06em]" onClick={() => engine?.importer.consent("download")}>
              download, once
            </button>
            <button className="border-line-strong text-text rounded-[3px] border px-3 py-1 text-[11px] uppercase tracking-[0.06em]" onClick={() => engine?.importer.consent("skip")}>
              no stems this time
            </button>
          </div>
        </div>
      )}

      {state.log.length > 0 && state.stage !== "consent" && (
        <div className="text-dim mt-2 max-h-24 overflow-auto font-mono text-[10.5px] leading-[1.5]">
          {state.log.slice(-5).map((line, index) => (
            <div key={index} className="truncate">{line}</div>
          ))}
        </div>
      )}
    </div>
  );
};
