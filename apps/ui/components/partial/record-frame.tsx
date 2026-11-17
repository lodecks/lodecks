import { useAtom, useAtomValue } from "jotai";
import { Circle, Square, X } from "lucide-react";
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useEngine } from "@/hooks/engine.hook";
import { useLiveState } from "@/hooks/live.hook";
import { cn } from "~/utils/classes.util";
import {
  VideoFormat,
  VideoFormats,
  canRecord,
  recordModeAtom,
  recorderAtom,
  startRecording,
  stopRecording
} from "~/utils/recorder.util";

// room for the bar under the frame, and around it
const BarHeight = 52;
const Margin = 12;

/** The largest box of the format's shape that fits the window, in whole pixels */
const fit = (format: VideoFormat) => {
  const { width, height } = VideoFormats[format];
  const room = { width: window.innerWidth - Margin * 2, height: window.innerHeight - BarHeight - Margin };
  const scale = Math.min(room.width / width, room.height / height);
  return { width: Math.floor(width * scale), height: Math.floor(height * scale) };
};

const time = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/**
 * The app, normally the whole window. In recording mode it lays out inside
 * a frame of the video's shape, and only the frame is recorded: the bar
 * under it (format, record, exit) stays out of the video.
 */
export const RecordFrame = ({ children }: { children: ReactNode }) => {
  const format = useAtomValue(recordModeAtom);
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number }>();

  useLayoutEffect(() => {
    if (!format) return setSize(undefined);
    const update = () => setSize(fit(format));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [format]);

  const framed = !!format && !!size;
  // the same elements either way, so entering or leaving the mode never
  // remounts the app (and its editors)
  return (
    <div className={framed ? "flex h-screen flex-col items-center bg-black" : "h-screen"} style={framed ? { paddingTop: Margin } : undefined}>
      <div ref={frame} className={framed ? "relative shrink-0 overflow-hidden" : "h-full"} style={framed ? size : undefined}>
        {children}
      </div>
      {framed && <RecordBar frame={frame} />}
    </div>
  );
};

const RecordBar = ({ frame }: { frame: React.RefObject<HTMLDivElement | null> }) => {
  const [format, setFormat] = useAtom(recordModeAtom);
  const [state, setState] = useAtom(recorderAtom);
  const engine = useEngine();
  const live = useLiveState();
  const [, tick] = useState(0);
  const busy = state.status !== "idle" && state.status !== "failed";

  // the clock, while recording
  useEffect(() => {
    if (state.status !== "recording") return;
    const timer = setInterval(() => tick((count) => count + 1), 500);
    return () => clearInterval(timer);
  }, [state.status]);

  const record = () => {
    if (!frame.current || !engine || !format) return;
    if (state.status === "recording") return stopRecording();
    startRecording(frame.current, format, engine.audio.recordStream(), live.set?.name);
  };

  const exit = () => {
    if (state.status === "recording" && !confirm("Stop recording and save the video?")) return;
    stopRecording();
    setState({ status: "idle" });
    setFormat(undefined);
  };

  const pill = "flex h-7 items-center rounded-[4px] px-2.5 text-[12px] transition-colors";

  return (
    // above the app's own overlays (full-screen visuals, the palette)
    <div className="text-muted relative z-[90] flex shrink-0 items-center gap-3 font-mono" style={{ height: BarHeight }}>
      <div className="border-line flex items-center rounded-[5px] border p-0.5">
        {(Object.keys(VideoFormats) as VideoFormat[]).map((id) => (
          <button
            key={id}
            type="button"
            disabled={busy}
            onClick={() => setFormat(id)}
            title={`${VideoFormats[id].width}×${VideoFormats[id].height} · ${VideoFormats[id].hint}`}
            className={cn(pill, id === format ? "text-bright bg-white/[0.08]" : "hover:text-text", busy && id !== format && "opacity-40")}
          >
            {VideoFormats[id].label}
            <span className="text-dim ml-1.5 hidden sm:inline">{VideoFormats[id].hint}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={record}
        disabled={!canRecord() || state.status === "asking" || state.status === "saving"}
        className={cn(
          pill,
          "border gap-2",
          state.status === "recording" ? "border-[#ff4d4d] text-bright bg-[#ff4d4d]/15" : "border-line-strong text-bright hover:bg-white/[0.06]"
        )}
        title={canRecord() ? "records the frame and the master output" : "recording needs Chrome or Edge"}
      >
        {state.status === "recording" ? (
          <>
            <Square size={10} fill="currentColor" strokeWidth={0} className="text-[#ff4d4d]" />
            stop · <span className="tabular-nums">{time(Date.now() - state.started)}</span>
          </>
        ) : (
          <>
            <Circle size={10} fill="currentColor" strokeWidth={0} className="text-[#ff4d4d]" />
            {state.status === "asking" ? "choose this tab…" : state.status === "saving" ? "saving…" : "record"}
          </>
        )}
      </button>

      {state.status === "failed" && <span className="text-warn max-w-80 truncate text-[11px]">{state.error}</span>}
      {state.status === "recording" && (
        <span className="text-dim text-[11px]" title="the sound is held back by this much, so it lines up with the picture">
          sync {state.lag} ms{state.measured ? "" : " (guessed)"}
        </span>
      )}

      <button type="button" onClick={exit} className={cn(pill, "hover:text-bright gap-1.5")} title="leave recording mode">
        <X size={12} strokeWidth={1.75} /> exit
      </button>
    </div>
  );
};
