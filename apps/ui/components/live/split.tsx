import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useEngine } from "@/hooks/engine.hook";
import { useLiveState } from "@/hooks/live.hook";

import { SetMenu } from "./menu";
import { EditorPane } from "./pane";

const RatioKey = "lodecks.live.ratio";

const readRatio = () => {
  try {
    const value = Number(localStorage.getItem(RatioKey));
    return value > 0.15 && value < 0.85 ? value : 0.5;
  } catch {
    return 0.5;
  }
};

/**
 * The editors: one, or two side by side when split (⌘\). They share the
 * running session, so a deck made on one side can be played from the
 * other; each keeps its own set. The divider drags.
 */
export const LiveEditors = () => {
  const engine = useEngine();
  const live = useLiveState();
  const box = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(0.5);
  const [dragging, setDragging] = useState(false);
  const split = !!live.right;

  useEffect(() => setRatio(readRatio()), []);

  const drag = (event: React.PointerEvent) => {
    if (!dragging || !box.current) return;
    const rect = box.current.getBoundingClientRect();
    setRatio(Math.min(0.85, Math.max(0.15, (event.clientX - rect.left) / rect.width)));
  };

  return (
    <div ref={box} className="relative flex min-h-0 min-w-0 flex-1" onPointerMove={drag}>
      <div className="flex min-h-0 min-w-0 flex-col" style={{ flexBasis: split ? `${ratio * 100}%` : "100%" }}>
        <EditorPane pane="left" />
      </div>
      {split && (
        <>
          <div
            className="group relative w-px shrink-0 cursor-col-resize bg-[var(--color-line)]"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragging(true);
            }}
            onPointerUp={() => {
              setDragging(false);
              try {
                localStorage.setItem(RatioKey, String(ratio));
              } catch {}
            }}
            onDoubleClick={() => setRatio(0.5)}
            title="drag to resize · double click centres"
          >
            {/* a wider grip than the line */}
            <span className="absolute inset-y-0 -left-1.5 w-3 group-hover:bg-white/[0.04]" />
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex h-7 shrink-0 items-center gap-1 pr-2 pl-1 text-[12px]">
              <SetMenu pane="right" />
              <button
                className="text-dim hover:text-bright ml-auto rounded-[3px] p-1 hover:bg-white/[0.05]"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => engine?.live.unsplit()}
                title="close this editor (⌘\\)"
              >
                <X size={13} strokeWidth={1.75} />
              </button>
            </div>
            <EditorPane pane="right" />
          </div>
        </>
      )}
    </div>
  );
};
