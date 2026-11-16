import { DeckId } from "@/common/constants/deck.constant";

import { Pause, Play } from "lucide-react";

import { DeckState } from "@/common/types/deck.type";

import { Colors, useCanvas } from "@/hooks/canvas.hook";
import { useDeck, useEngine } from "@/hooks/engine.hook";
import { cn } from "~/utils/classes.util";

/** Whether any song track (stem or stem voice) is playing or about to */
const songTrackPlaying = (deck: DeckState) => {
  const pack = deck.pack;
  if (!pack) return false;
  return [...pack.stems, ...pack.voices.filter((track) => track.type === "stem")].some((track) => {
    const state = deck.stems[track.id] ?? deck.voices[track.id];
    return state?.status === "playing" || state?.status === "armed";
  });
};

// the disc is drawn on a grid of this many cells across
const Cells = 26;
const Radius = 12.6;
const Hub = 4.6;

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * A pixel disc: a bright ring in the deck colour, a disc of cells with two
 * wedges of light sweeping round as the song turns (once a bar), and a dark
 * hub with a play / pause icon. The ring cell at the current 16th lights up.
 * Empty decks are drawn in grey.
 */
export const DeckPlatter = ({
  id,
  className,
  onToggle
}: {
  id: DeckId;
  className?: string;
  onToggle?: () => void;
}) => {
  const engine = useEngine();

  const ref = useCanvas((ctx, width, height) => {
    ctx.clearRect(0, 0, width, height);
    const size = Math.min(width, height);
    const cell = size / Cells;
    const left = (width - size) / 2;
    const top = (height - size) / 2;
    const gap = Math.max(1, cell * 0.12);

    const transport = engine?.transport;
    const deck = engine?.decks[id];
    const state = deck?.store.get();
    const loaded = !!state?.pack;
    const running = !!transport?.running;
    const cycle = running ? transport!.now() : 0;
    const playing = !!deck && loaded && deck.songPlaying();
    const level = engine ? Math.min(1, engine.analysis.data.decks[id] * 3) : 0;
    const turn = playing ? (cycle % 1) * Math.PI * 2 : 0;
    const sixteenth = Math.floor((cycle % 1) * 16);

    const [r, g, b] = rgb(loaded ? Colors[id] : "#5a6170");
    const [pr, pg, pb] = rgb(Colors.paper);
    const base = [8, 12, 18];
    const mix = (amount: number) =>
      `rgb(${Math.round(base[0] + (r - base[0]) * amount)},${Math.round(base[1] + (g - base[1]) * amount)},${Math.round(base[2] + (b - base[2]) * amount)})`;

    const center = (Cells - 1) / 2;
    for (let y = 0; y < Cells; y++) {
      for (let x = 0; x < Cells; x++) {
        const dx = x - center;
        const dy = y - center;
        const distance = Math.hypot(dx, dy);
        if (distance > Radius) continue;

        let fill: string;
        if (distance > Radius - 1.15) {
          // the ring, with the current 16th of the bar lit
          const angle = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2);
          const segment = Math.floor((angle / (Math.PI * 2)) * 16);
          fill = running && playing && segment === sixteenth
            ? `rgb(${pr},${pg},${pb})`
            : mix(loaded ? 0.92 : 0.55);
        } else if (distance < Hub) {
          fill = "rgb(6,9,14)";
        } else {
          // two wedges of light, like a reflection on a turning record
          const angle = Math.atan2(dy, dx) - turn;
          const sheen = Math.max(0, Math.cos(angle * 2));
          const shade = (loaded ? 0.1 : 0.06) + sheen * (loaded ? 0.32 : 0.12) + level * 0.12;
          fill = mix(Math.min(1, shade));
        }

        ctx.fillStyle = fill;
        ctx.fillRect(
          Math.round(left + x * cell),
          Math.round(top + y * cell),
          Math.ceil(cell - gap),
          Math.ceil(cell - gap)
        );
      }
    }

    const cx = left + size / 2;
    if (state?.loading) {
      ctx.fillStyle = Colors.text;
      ctx.font = `${Math.round(size / 11)}px "JetBrains Mono", monospace`;
      ctx.textAlign = "center";
      ctx.fillText("loading", cx, top + size * 0.97);
      ctx.textAlign = "start";
    }
  });

  const deck = useDeck(id);
  const loaded = !!deck.pack;
  const playing = loaded && songTrackPlaying(deck);

  // the canvas draws the disc, the play / pause icon sits on its hub
  return (
    <div
      className={cn("relative", className)}
      onMouseDown={(event) => {
        if (!onToggle) return;
        event.preventDefault();
        onToggle();
      }}
      style={{ cursor: onToggle ? "pointer" : undefined }}
      title={onToggle ? "start / stop the song" : undefined}
    >
      <canvas ref={ref} className="absolute inset-0 h-full w-full [image-rendering:pixelated]" />
      <span
        data-deck={id}
        className={cn(
          "pointer-events-none absolute inset-0 flex items-center justify-center",
          loaded ? "text-accent" : "text-[#4a505c]"
        )}
      >
        {playing ? (
          <Pause className="h-[17%] w-[17%]" strokeWidth={2.5} fill="currentColor" />
        ) : (
          <Play className="ml-[2%] h-[17%] w-[17%]" strokeWidth={2.5} fill="currentColor" />
        )}
      </span>
    </div>
  );
};
