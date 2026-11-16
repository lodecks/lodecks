import { Eject, Play, Square } from "lucide-react";
import { InfinityIcon } from "@/components/icon";
import { useRef } from "react";

import { DeckId, VoiceKeys } from "@/common/constants/deck.constant";
import { isCompatibleKey, parseKey } from "@/common/utils/music.util";

import { Button } from "@/components/button";
import { DeckPlatter } from "@/components/deck/platter";
import { DeckVoiceStrip } from "@/components/deck/voice-strip";
import { DeckWaveform } from "@/components/deck/waveform";
import { useDeck, useEngine, useFocus, useTransport } from "@/hooks/engine.hook";
import { useFrame } from "@/hooks/frame.hook";
import { cn } from "~/utils/classes.util";
import { focusedPane } from "@/components/live/editor";
import { openPackTab } from "@/components/live/tabs";

const CueColors = ["var(--color-deck-a)", "var(--color-code)", "var(--color-gray)", "var(--color-deck-b)"];

/** Whether the song plays (its stems and stem voices), and starting / stopping it */
export const useSong = (id: DeckId) => {
  const engine = useEngine();
  const deck = useDeck(id);
  const transport = useTransport();
  const pack = deck.pack;
  // the song is every track that follows it: stems and stem voices (vocals)
  const songTracks = pack ? [...pack.stems, ...pack.voices.filter((track) => track.type === "stem")] : [];
  const stemsPlaying = songTracks.some((track) => {
    const state = deck.stems[track.id] ?? deck.voices[track.id];
    return state?.status === "playing" || state?.status === "armed";
  });

  const toggleSong = () => {
    const instance = engine?.decks[id];
    if (!instance) return;
    if (stemsPlaying) {
      for (const voice of instance.followers()) if (voice.active) voice.press(transport.quantize);
      return;
    }
    for (const voice of instance.followers()) instance.press(voice.kind, voice.id);
  };
  return { stemsPlaying, toggleSong };
};

/**
 * A deck's row of buttons: song, sync, loop, infinite and its options,
 * the key shift and eject. On the deck panel, and deck().show("controls").
 */
export const DeckControls = ({ id, className }: { id: DeckId; className?: string }) => {
  const engine = useEngine();
  const deck = useDeck(id);
  const pack = deck.pack;
  const { stemsPlaying, toggleSong } = useSong(id);

  return (
  <div className={cn("flex shrink-0 flex-wrap items-center gap-1.5", className)}>
      <Button design={stemsPlaying ? "active" : "accent"} disabled={!pack || deck.loading} onClick={toggleSong} title="start / stop the backing stems">
        {stemsPlaying ? <Square size={11} strokeWidth={2} /> : <Play size={11} strokeWidth={2} />}
        song
      </Button>
      <Button disabled={!pack} onClick={() => engine?.syncTempo(id)} title="master tempo = pack tempo (\\)">sync</Button>
      <Button disabled={!pack} onClick={() => engine?.decks[id].toggleLoop()} design={deck.loop?.active ? "active" : "default"}>
        loop {deck.loop?.bars ?? 4}
      </Button>
      <Button
        design={deck.infinite ? "active" : "default"}
        onClick={() => engine?.decks[id].setInfinite(!deck.infinite)}
        title="infinite: branch between similar parts forever (Ctrl+I)"
      >
        <InfinityIcon size={15} />
      </Button>
      <Button
        size="sm"
        disabled={!pack}
        onClick={() => engine?.decks[id].setJukeUnit(deck.jukeUnit === "bar" ? "beat" : "bar")}
        title="branch on bar lines, or on beats like the classic jukebox"
      >
        {deck.jukeUnit}
      </Button>
      <Button
        size="sm"
        disabled={!pack || !deck.infinite || deck.jukebox.status !== "ready"}
        design={deck.jukebox.forced ? "active" : "default"}
        onClick={() => engine?.decks[id].jumpNow()}
        title="branch at the next boundary (J in pads)"
      >
        jump
      </Button>
      <Button size="sm" disabled={!pack} onClick={() => engine?.decks[id].cycleVariety()} title="how often it branches">
        {deck.variety}
      </Button>
      <span className="ml-auto flex items-center gap-1">
        {/* key: a semitone down (♭) or up (♯); the middle shows the shift, a click resets it */}
        <span className="flex items-center" title="key shift, in semitones">
          <Button size="icon" className="rounded-r-none font-mono text-[15px]" disabled={!pack} onClick={() => engine?.decks[id].setTranspose(deck.transpose - 1)} title="key down a semitone">♭</Button>
          <button
            className={cn(
              "border-line h-7 w-11 border-y font-mono text-[11px] tabular-nums disabled:opacity-35",
              deck.transpose ? "text-warn hover:text-bright" : "text-dim"
            )}
            disabled={!pack || !deck.transpose}
            onClick={() => engine?.decks[id].setTranspose(0)}
            title={deck.transpose ? "back to the song's own key" : "the song's own key"}
          >
            {deck.transpose ? `${deck.transpose > 0 ? "+" : ""}${deck.transpose}` : "key"}
          </button>
          <Button size="icon" className="rounded-l-none font-mono text-[15px]" disabled={!pack} onClick={() => engine?.decks[id].setTranspose(deck.transpose + 1)} title="key up a semitone">♯</Button>
        </span>
        <Button size="icon" design="ghost" disabled={!pack} onClick={() => engine?.eject(id)} title="eject"><Eject size={14} strokeWidth={1.75} /></Button>
      </span>
    </div>
  );
};

export const DeckView = ({ id }: { id: DeckId }) => {
  const engine = useEngine();
  const deck = useDeck(id);
  const other = useDeck(id === "a" ? "b" : "a");
  const focus = useFocus();
  const transport = useTransport();
  const pack = deck.pack;
  const focused = focus === id;
  const songPosition = useRef<HTMLSpanElement>(null);

  // song position readout, updated outside react
  useFrame(() => {
    const instance = engine?.decks[id];
    if (!songPosition.current || !instance?.store.get().pack) return;
    const bar = instance.songBar();
    songPosition.current.textContent = `${String(Math.floor(bar) + 1).padStart(3, "0")}.${Math.floor((bar % 1) * 4) + 1}`;
  }, !!pack);

  const compatible =
    pack && other.pack
      ? isCompatibleKey(parseKey(pack.key), parseKey(other.pack.key))
      : undefined;
  const ratio = pack ? transport.bpm / pack.bpm : 1;
  const stretched = Math.abs(ratio - 1) > 0.002;
  const { toggleSong } = useSong(id);

  return (
    <section
      data-deck={id}
      onMouseDown={() => engine?.focus(id)}
      className={cn(
        "module flex min-h-0 min-w-0 flex-col gap-2 p-2 transition-shadow",
        focused && "shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_45%,transparent),inset_0_1px_0_rgba(255,255,255,0.035)]"
      )}
    >
      {/* name plate */}
      <header className="flex h-6 shrink-0 items-center gap-2 px-1">
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-medium",
            focused ? "bg-accent text-ink shadow-[0_0_8px_var(--accent)]" : "keycap text-accent"
          )}
        >
          {id.toUpperCase()}
        </span>
        <span className="text-bright truncate text-[14px] font-light">
          {deck.loading ? "loading…" : pack ? pack.title : "empty — load a pack"}
        </span>
        {pack?.artist && <span className="legend hidden truncate xl:inline">{pack.artist}</span>}
        <Button
          size="sm"
          className="ml-auto"
          disabled={!pack}
          onClick={() => {
            engine?.focus(id);
            // the pack opens in a tab, on a deck of its own
            if (deck.packId) openPackTab(deck.packId, focusedPane());
          }}
          title="edit the pack in a tab: layers, cues, sections"
        >
          edit
        </Button>
      </header>

      <div className="screen flex min-h-0 flex-1 flex-col overflow-hidden">
        {deck.error && <div className="text-bad px-3 py-1">{deck.error}</div>}
        <DeckWaveform id={id} seek className="h-12 w-full shrink-0" />
        <div className="flex min-h-0 flex-1 items-center gap-6 px-3 pb-2">
          <DeckPlatter id={id} className="aspect-square h-full max-h-36 min-h-0" onToggle={pack && !deck.loading ? toggleSong : undefined} />
          {pack ? (
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-1">
              <div className="col-span-2 flex flex-col">
                <span className="legend !text-[8px]">bar</span>
                <span ref={songPosition} className="text-bright font-mono text-[26px] leading-none font-light tabular-nums">000.1</span>
              </div>
              <div className="flex flex-col">
                <span className="legend !text-[8px] !text-[var(--accent)]">tempo</span>
                <span className="text-text font-mono text-[14px] leading-tight tabular-nums" title="pack tempo, and the stretch to match the master">
                  {pack.bpm.toFixed(1)}
                  {stretched && <span className="text-warn text-[11px]"> ×{ratio.toFixed(3)}</span>}
                </span>
              </div>
              <div className="col-span-2 flex flex-col">
                <span className="legend !text-[8px]">infinite</span>
                <span className="text-text truncate font-mono text-[11px] tabular-nums">
                  {!deck.infinite
                    ? "off · plays straight"
                    : deck.jukebox.status === "ready"
                      ? `${deck.jukebox.arcs} arcs${deck.jukebox.lastJump ? ` · ${deck.jukebox.lastJump.from + 1}→${deck.jukebox.lastJump.to + 1}` : ""}${deck.loop?.active ? " · held by loop" : ""}`
                      : deck.jukebox.status === "analysing"
                        ? "analysing the song…"
                        : deck.jukebox.status === "unavailable"
                          ? "needs stems"
                          : deck.jukebox.status === "failed"
                            ? "analysis failed"
                            : "—"}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="legend !text-[8px] !text-code">key</span>
                <span className={cn("font-mono text-[14px] leading-tight", compatible === false ? "text-bad" : "text-text")} title={compatible === false ? "clashes with the other deck" : "key"}>
                  {pack.key}
                  {deck.transpose !== 0 && <span className="text-warn text-[11px]"> {deck.transpose > 0 ? "+" : ""}{deck.transpose}</span>}
                </span>
              </div>
            </div>
          ) : (
            <span className="legend flex-1 text-center">no pack</span>
          )}
        </div>
      </div>

      {/* keys */}
      <DeckControls id={id} />

      <div className="flex shrink-0 items-center gap-1.5">
        {Array.from({ length: 8 }, (_, index) => {
          const cue = deck.cues[index + 1];
          return (
            <button
              key={index}
              disabled={!pack}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => (event.shiftKey ? engine?.decks[id].setCue(index + 1) : engine?.decks[id].cue(index + 1))}
              title={cue ? `${cue.name} @ bar ${cue.bar + 1} (shift+click sets)` : "empty: click sets it here"}
              className="keycap relative flex h-7 flex-1 items-center justify-center text-[11px] disabled:opacity-35"
            >
              <span className={cue ? "text-bright" : "text-dim"}>{index + 1}</span>
              {cue && (
                <span
                  className="absolute top-1 right-1.5 h-1.5 w-1.5 rounded-full"
                  style={{ background: CueColors[index % 4], boxShadow: `0 0 6px ${CueColors[index % 4]}` }}
                />
              )}
            </button>
          );
        })}
      </div>

      <DeckVoiceStrip id={id} keys={VoiceKeys} />
    </section>
  );
};
