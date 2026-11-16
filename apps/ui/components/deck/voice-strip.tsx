import { DeckId, VoiceKey } from "@/common/constants/deck.constant";
import { PackTrack } from "@/common/schemas/pack.schema";
import { VoiceState } from "@/common/types/deck.type";
import { padLayout } from "@/common/utils/pads.util";

import { useDeck } from "@/hooks/engine.hook";
import { cn } from "~/utils/classes.util";

/** Which voice sits on which number key */
export const keyedTracks = (tracks: PackTrack[]) => padLayout(tracks);

export const statusClass = (state?: VoiceState) => {
  switch (state?.status) {
    case "playing":
      return "pad-lit";
    case "armed":
      return "pad-lit animate-armed";
    case "stopping":
      return "pad-lit animate-armed opacity-60";
    case "loading":
      return "text-dim";
    default:
      return "text-muted";
  }
};

/** A row of LEDs: the state of every voice and stem on a deck */
export const DeckVoiceStrip = ({ id, keys }: { id: DeckId; keys: readonly VoiceKey[] }) => {
  const deck = useDeck(id);
  const voices = keyedTracks(deck.pack?.voices || []);
  const stems = keyedTracks(deck.pack?.stems || []);

  const lamp = (state?: VoiceState) => {
    switch (state?.status) {
      case "playing":
        return "bg-accent shadow-[0_0_6px_var(--accent)]";
      case "armed":
      case "stopping":
        return "bg-accent animate-armed";
      default:
        return "bg-[#2c2e33]";
    }
  };

  const row = (map: Map<VoiceKey, PackTrack>, kind: "voices" | "stems") => (
    <div className="flex items-center gap-1">
      <span className="legend w-9 !text-[8px]">{kind === "stems" ? "stems" : "voices"}</span>
      {keys.map((key) => {
        const track = map.get(key);
        const state = track ? deck[kind][track.id] : undefined;
        return (
          <span key={key} title={track ? `${kind === "stems" ? "⇧" : ""}${key} ${track.name} (${track.type})` : undefined} className="flex flex-1 flex-col items-center gap-0.5">
            <span className={cn("h-1.5 w-full max-w-5 rounded-full", track ? lamp(state) : "bg-[#1f2023]")} />
            <span className={cn("text-[8px] leading-none", track ? "text-dim" : "text-[#33353a]")}>{key}</span>
          </span>
        );
      })}
    </div>
  );

  return (
    <div className="flex shrink-0 flex-col gap-1 px-1">
      {row(voices, "voices")}
      {stems.size > 0 && row(stems, "stems")}
    </div>
  );
};
