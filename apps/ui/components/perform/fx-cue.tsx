import { DeckId } from "@/common/constants/deck.constant";
import { DeckFx, DeckFxs } from "@/common/constants/fx.constant";

import { ArrowLeft, ArrowRight } from "lucide-react";
import { useDeck, useEngine, useFocus } from "@/hooks/engine.hook";
import { cn } from "~/utils/classes.util";

const FxKeys: Record<DeckFx, string> = { filter: "A", echo: "S", reverb: "D", stutter: "F", gate: "G", brake: "H" };
const CueKeys = ["Q", "W", "E", "R", "T", "Y", "U", "I"];

/** Hot cues 1–8: jump, shift sets, alt clears */
export const DeckCuePads = ({ id, keys = true }: { id: DeckId; keys?: boolean }) => {
  const engine = useEngine();
  const deck = useDeck(id);
  const instance = engine?.decks[id];
  return (
    <div className="grid grid-cols-8 gap-2">
      {CueKeys.map((key, index) => {
        const cue = deck.cues[index + 1];
        return (
          <button
            key={key}
            onMouseDown={(event) => {
              event.preventDefault();
              if (event.altKey) instance?.clearCue(index + 1);
              else if (event.shiftKey) instance?.setCue(index + 1);
              else instance?.cue(index + 1);
            }}
            className={cn("keycap flex flex-col px-2 py-1 text-left", cue ? "text-bright" : "text-dim")}
          >
            <span className="flex items-center justify-between text-[10px]">
              <span className="flex items-center gap-1.5">
                <span className={cn("h-1.5 w-1.5 rounded-full", cue ? "bg-warn shadow-[0_0_6px_var(--color-warn)]" : "bg-[#33353a]")} />
                cue {index + 1}
              </span>
              {keys && <span className="opacity-60">{key}</span>}
            </span>
            <span className="truncate text-[11px]">{cue ? `${cue.name} · ${cue.bar + 1}` : "—"}</span>
          </button>
        );
      })}
    </div>
  );
};

/** Hold effects: on while held, shift latches */
export const DeckFxPads = ({ id, keys = true, className }: { id: DeckId; keys?: boolean; className?: string }) => {
  const engine = useEngine();
  const deck = useDeck(id);
  const instance = engine?.decks[id];
  return (
    <div className={cn("grid grid-cols-6 gap-2", className)}>
      {DeckFxs.map((fx) => (
        <button
          key={fx}
          onPointerDown={(event) => {
            event.preventDefault();
            if (event.shiftKey) instance?.toggleFx(fx);
            else instance?.engageFx(fx);
          }}
          onPointerUp={(event) => !event.shiftKey && instance?.releaseFx(fx)}
          onPointerLeave={(event) => event.buttons && !event.shiftKey && instance?.releaseFx(fx)}
          className={cn("pad flex flex-col justify-between p-2 text-left", deck.fx[fx] ? "pad-lit" : "text-muted hover:brightness-125")}
        >
          <span className="flex justify-between text-[10px]"><span className="opacity-60">hold</span>{keys && <span className="opacity-60">{FxKeys[fx]}</span>}</span>
          <span className="text-[13px] font-medium tracking-[0.08em] uppercase">{fx}</span>
        </button>
      ))}
    </div>
  );
};

/** Hot cues, hold effects and loop controls of the focused deck */
export const PerformFxCue = () => {
  const engine = useEngine();
  const focus = useFocus();
  const deck = useDeck(focus);
  const instance = engine?.decks[focus];

  return (
    <div data-deck={focus} className="flex h-full flex-col gap-2 p-1">
      <DeckCuePads id={focus} />
      <DeckFxPads id={focus} className="min-h-0 flex-1" />

      <div className="legend flex items-center gap-3 !text-[9px] !tracking-[0.08em]">
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => instance?.toggleLoop()} className={deck.loop?.active ? "text-warn" : ""}>
          [L] loop {deck.loop?.active ? "on" : "off"} · {deck.loop?.bars ?? 4} bars
        </button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => instance?.resizeLoop(-1)}>[ ½</button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => instance?.resizeLoop(1)}>2× ]</button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => instance?.beatJump(-1)} className="flex items-center gap-1"><ArrowLeft size={11} strokeWidth={1.75} />-1</button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => instance?.beatJump(1)} className="flex items-center gap-1">+1<ArrowRight size={11} strokeWidth={1.75} /></button>
        <button onMouseDown={(e) => e.preventDefault()} onClick={() => instance?.setPrelisten(!deck.prelisten)} className={deck.prelisten ? "text-warn" : ""}>
          [P] pre-listen {deck.prelisten ? "on" : "off"}
        </button>
        <span className="ml-auto">shift latches · fx let go on the beat</span>
      </div>
    </div>
  );
};
