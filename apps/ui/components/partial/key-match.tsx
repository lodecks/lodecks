import { camelot, isCompatibleKey, parseKey, shiftKey } from "@/common/utils/music.util";

import { useDeck } from "@/hooks/engine.hook";
import { cn } from "~/utils/classes.util";

/** A deck's key as it sounds now: its pack's, moved by tune() / transpose */
export const useSounding = (id: "a" | "b") => {
  const deck = useDeck(id);
  if (!deck.pack) return undefined;
  return shiftKey(parseKey(deck.pack.key), deck.transpose);
};

/**
 * A deck's key as it sounds, red while it clashes with the other deck's;
 * for the decks on v2's top line
 */
export const DeckKey = ({ id, className }: { id: "a" | "b"; className?: string }) => {
  const key = useSounding(id);
  const other = useSounding(id === "a" ? "b" : "a");
  if (!key) return null;
  const clash = other ? !isCompatibleKey(key, other) : false;
  const { number, letter } = camelot(key);
  return (
    <span
      className={cn("font-mono text-[11px] whitespace-nowrap", clash ? "text-bad" : "text-code", className)}
      title={`${key.name} (${number}${letter})${other ? (clash ? ` — clashes with ${other.name}: tune() one into the other` : ` — goes with ${other.name}`) : ""}`}
    >
      {key.name}
    </span>
  );
};

/**
 * Both decks' keys as they sound, and whether they go together (a ✓, or
 * a red ✗ when they clash): A G · B Am ✓
 */
export const KeyMatch = ({ className }: { className?: string }) => {
  const a = useSounding("a");
  const b = useSounding("b");
  const match = a && b ? isCompatibleKey(a, b) : undefined;
  const code = (key: NonNullable<typeof a>) => {
    const { number, letter } = camelot(key);
    return `${number}${letter}`;
  };
  const title =
    a && b
      ? `A ${a.name} (${code(a)}) · B ${b.name} (${code(b)}) — ${match ? "they go together" : "they clash: tune() one into the other"}`
      : "the keys of the decks, as they sound";

  return (
    <span className={cn("flex items-baseline gap-1.5 whitespace-nowrap font-mono tabular-nums", className)} title={title}>
      <span className="text-deck-a">A</span>
      <span className={a ? "text-bright" : "text-dim"}>{a?.name ?? "—"}</span>
      <span className="text-dim">·</span>
      <span className="text-deck-b">B</span>
      <span className={b ? "text-bright" : "text-dim"}>{b?.name ?? "—"}</span>
      {match !== undefined && <span className={match ? "text-deck-a" : "text-bad"}>{match ? "✓" : "✗"}</span>}
    </span>
  );
};
