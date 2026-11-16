import { useAtomValue } from "jotai";
import { FavoriteIcon, ShiftIcon, TrackIcon } from "@/components/icon";
import { useState } from "react";

import { DeckId, VoiceKeys } from "@/common/constants/deck.constant";

import { keyedTracks, statusClass } from "@/components/deck/voice-strip";
import { useDeck, useEngine, useFocus, useTransport } from "@/hooks/engine.hook";
import { heldAtom } from "@/utils/atoms.util";
import { isTrackDrag, readTrackDrag, startTrackDrag } from "@/utils/drag.util";
import { cn } from "~/utils/classes.util";


/** 1–0 voice pads and Shift+1–0 stem pads of the focused deck */
export const PerformPads = () => {
  const focus = useFocus();
  return <DeckPads id={focus} />;
};

/**
 * A deck's pads: voices on 1–0, stems on Shift+1–0. They fire on press
 * (on the grid), light while playing and blink while armed. `legend`
 * adds the line of hints below (the / screen's).
 */
export const DeckPads = ({ id: focus, legend = true, className }: { id: DeckId; legend?: boolean; className?: string }) => {
  const engine = useEngine();
  const deck = useDeck(focus);
  const transport = useTransport();
  const held = useAtomValue(heldAtom);
  const [over, setOver] = useState<string>();
  // alt turns pads into drag handles, otherwise they fire on mouse down
  const arranging = held.has("AltLeft") || held.has("AltRight");

  const row = (kind: "voices" | "stems") => {
    const map = keyedTracks(deck.pack?.[kind] || []);
    return (
      <div className="grid min-h-0 flex-1 grid-cols-10 gap-2">
        {VoiceKeys.map((key, index) => {
          const track = map.get(key);
          const state = track ? deck[kind][track.id] : undefined;
          const pressed = held.has(`Digit${key}`) && (kind === "stems") === (held.has("ShiftLeft") || held.has("ShiftRight"));
          return (
            <button
              key={key}
              disabled={state?.status === "loading"}
              draggable={!!track && arranging}
              onDragStart={(event) => track && startTrackDrag(event, { kind, id: track.id })}
              onDragOver={(event) => {
                if (!isTrackDrag(event)) return;
                event.preventDefault();
                setOver(`${kind}:${key}`);
              }}
              onDragLeave={() => setOver(undefined)}
              onDrop={(event) => {
                event.preventDefault();
                setOver(undefined);
                const dragged = readTrackDrag(event);
                // voices land on voice pads, stems on stem pads
                if (dragged && dragged.kind === kind) {
                  engine?.decks[focus].assignPad(kind, dragged.id, key);
                }
              }}
              onMouseDown={(event) => {
                if (arranging) return;
                event.preventDefault();
                if (track) engine?.decks[focus].press(kind, track.id);
              }}
              className={cn(
                "pad relative flex min-h-0 flex-col justify-between p-2 text-left",
                track ? statusClass(state) : "text-[#3a3c41] opacity-60",
                pressed && "ring-accent ring-1",
                over === `${kind}:${key}` && "ring-warn ring-2",
                track && state?.status === "idle" && "hover:brightness-125",
                arranging && track && "cursor-grab outline-1 outline-dashed outline-[#55585e]"
              )}
            >
              <span className="flex w-full items-center justify-between text-[10px]">
                <span className="flex items-center text-[15px] leading-none font-light opacity-80">{kind === "stems" && <ShiftIcon size={14} />}{key}</span>
                {track && <span className="flex items-center gap-0.5 opacity-70"><TrackIcon type={track.type} size={11} />{track.bars ? track.bars : ""}</span>}
              </span>
              <span className="truncate text-[11px] font-medium">
                {track?.favorite && <FavoriteIcon on size={11} className="mr-1 align-[-1px]" />}
                {track?.name || "—"}
              </span>
              {index === 0 && !deck.pack && kind === "voices" && <span className="sr-only">empty</span>}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div data-deck={focus} className={cn("flex h-full flex-col gap-2 p-1", className)}>
      {row("voices")}
      {(deck.pack?.stems.length || 0) > 0 && <div className="flex h-[38%] min-h-0">{row("stems")}</div>}
      {legend && <div className="legend flex gap-4 !text-[9px] !tracking-[0.08em]">
        <span className="flex items-center gap-1"><TrackIcon type="loop" size={11} /> loop · <TrackIcon type="oneshot" size={11} /> oneshot · <TrackIcon type="stem" size={11} /> stem</span>
        <span>launch on <span className="text-warn">{transport.quantize}</span> (Q)</span>
        <span>blinking = armed, lands on the grid</span>
        <span className="ml-auto">
          {(deck.pack?.voices.length || 0) + (deck.pack?.stems.length || 0)} tracks · Alt+drag pads to swap · all of them in the pack editor
          {deck.edited && <span className="text-warn"> · unsaved (Ctrl+S)</span>}
        </span>
      </div>}
    </div>
  );
};
