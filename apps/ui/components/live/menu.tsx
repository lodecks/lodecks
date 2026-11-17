import { useAtomValue, useSetAtom } from "jotai";
import { ArrowBigUp, ChevronDown, Columns2, Command, CornerDownLeft, Settings as SettingsIcon, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { DeckId } from "@/common/constants/deck.constant";

import { useDeck, useEngine, useTransport } from "@/hooks/engine.hook";
import { useFrame } from "@/hooks/frame.hook";
import { useLiveState } from "@/hooks/live.hook";
import { cn } from "~/utils/classes.util";
import { recordModeAtom } from "~/utils/recorder.util";

import { DeckView } from "@/components/deck/view";
import { DeckKey } from "@/components/partial/key-match";
import { PacksMenu } from "@/components/partial/packs-menu";
import { TempoControl } from "@/components/partial/tempo";

import type { Pane } from "@/engine/modules/live/live.module";

import { liveEditors } from "./editor";
import { EffectsMenu } from "./effects-menu";
import { HelpMenu } from "./help-menu";
import { openSettingsTab, tabsAtom } from "./tabs";
import { QuantizeLabels } from "@/common/constants/quantize.constant";

const ago = (time: number) => {
  const seconds = Math.round((Date.now() - time) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  return new Date(time).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

/** The set menu: open, new, rename, delete, history */
/** The set menu of one editor: open, new, rename, delete, history */
export const SetMenu = ({ pane = "left", className }: { pane?: Pane; className?: string }) => {
  const engine = useEngine();
  const live = useLiveState();
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState<"new" | "rename">();
  const [history, setHistory] = useState<{ id: string; code: string; updatedAt: number }[]>();
  const box = useRef<HTMLDivElement>(null);
  const current = (pane === "left" ? live.set : live.right) ?? { id: "", name: "", updatedAt: 0 };
  const other = pane === "left" ? live.right?.id : live.set.id;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) {
        setOpen(false);
        setNaming(undefined);
        setHistory(undefined);
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const load = async (code: Promise<string | undefined>) => {
    const next = await code;
    if (next !== undefined) liveEditors[pane].setDoc?.(next);
    setOpen(false);
  };

  const item = "flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-white/[0.05]";

  return (
    <div ref={box} className={cn("relative", className)}>
      <button
        className="text-bright flex items-center gap-1 rounded-[3px] px-2 py-0.5 hover:bg-white/[0.05]"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen(!open)}
      >
        {current.name || "…"}
        <ChevronDown size={12} strokeWidth={1.75} className="text-dim" />
      </button>
      {open && engine && (
        <div className="border-line-strong absolute top-7 left-0 z-50 w-72 rounded-[4px] border bg-popover py-1 shadow-[0_18px_40px_rgba(0,0,0,0.6)]">
          {naming ? (
            <input
              autoFocus
              defaultValue={naming === "rename" ? current.name : ""}
              placeholder={naming === "new" ? "name of the new set" : "new name"}
              className="bg-ink border-line mx-2 my-1 w-[calc(100%-16px)] border px-2 py-1 outline-none"
              onKeyDown={(event) => {
                if (event.key === "Escape") setNaming(undefined);
                if (event.key !== "Enter") return;
                const name = (event.target as HTMLInputElement).value;
                if (naming === "new") load(engine.live.newSet(name, pane));
                else engine.live.renameSet(name, pane).then(() => setOpen(false));
                setNaming(undefined);
              }}
            />
          ) : history ? (
            <>
              <div className="legend px-3 pt-1 pb-1 !text-[8px]">history · click to restore</div>
              {history.map((snap) => (
                <button key={snap.id} className={item} onClick={() => load(Promise.resolve(snap.code))}>
                  {ago(snap.updatedAt)}
                  <span className="text-dim ml-auto">{snap.code.split("\n").length} lines</span>
                </button>
              ))}
              {!history.length && <div className="text-dim px-3 py-1">nothing yet — ctrl+s keeps a copy</div>}
            </>
          ) : (
            <>
              <div className="legend px-3 pt-1 pb-1 !text-[8px]">sets · saved in this browser</div>
              {live.sets.map((set) => (
                <button
                  key={set.id}
                  disabled={set.id === other}
                  title={set.id === other ? "open in the other editor" : undefined}
                  className={cn(item, set.id === current.id && "text-deck-a", "disabled:opacity-35")}
                  onClick={() => load(engine.live.openSet(set.id, pane))}
                >
                  {set.name}
                  <span className="text-dim ml-auto text-[11px]">{ago(set.updatedAt)}</span>
                </button>
              ))}
              <div className="bg-line my-1 h-px" />
              <button className={item} onClick={() => setNaming("new")}>new set…</button>
              <button className={item} onClick={() => setNaming("rename")}>rename…</button>
              <button className={item} onClick={() => engine.live.history(pane).then(setHistory)}>history…</button>
              <button
                className={cn(item, "text-bad")}
                onClick={() => confirm(`Delete "${current.name}" from this browser?`) && load(engine.live.deleteSet(current.id, pane))}
              >
                delete set
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

/** A deck on the top line; clicking it opens the whole deck from / */
const DeckStatus = ({ id }: { id: DeckId }) => {
  const engine = useEngine();
  const deck = useDeck(id);
  const bar = useRef<HTMLSpanElement>(null);
  const level = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // EDIT opens the pack in a tab: the popover gets out of the way
  const tabs = useAtomValue(tabsAtom);
  useEffect(() => setOpen(false), [tabs]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  useFrame(() => {
    if (!engine) return;
    if (bar.current) bar.current.textContent = deck.pack ? String(Math.floor(engine.decks[id].songBar()) + 1).padStart(3, "0") : "---";
    if (level.current) level.current.style.width = `${Math.min(1, engine.analysis.data.decks[id] * 3) * 100}%`;
  }, !!engine);

  return (
    <div ref={box} data-deck={id} className="relative">
      <button
        className={cn("flex w-52 min-w-0 flex-col justify-center gap-[3px] rounded-[3px] px-2 py-1 text-left hover:bg-white/[0.05]", open && "bg-white/[0.05]")}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen(!open)}
        title={`deck ${id.toUpperCase()}: details and controls`}
      >
        <div className="flex w-full min-w-0 items-baseline gap-2">
          <span className={cn("font-mono text-[11px] uppercase", id === "a" ? "text-deck-a" : "text-deck-b")}>{id}</span>
          <span className="text-text min-w-0 flex-1 truncate text-[12px]">{deck.pack?.title ?? (deck.loading ? "loading…" : "—")}</span>
          <DeckKey id={id} />
          <span ref={bar} className="text-dim font-mono text-[11px] tabular-nums" />
        </div>
        <div className="h-[2px] w-full overflow-hidden rounded-full bg-white/[0.06]">
          <span ref={level} className="bg-accent block h-full" />
        </div>
      </button>
      {open && (
        <div className="absolute top-10 right-0 z-50 flex h-[330px] w-[540px] rounded-[6px] shadow-[0_18px_40px_rgba(0,0,0,0.6)] [&>section]:flex-1 [&>section]:bg-popover">
          <DeckView id={id} />
        </div>
      )}
    </div>
  );
};

/** Opens or closes the second editor (⌘\\) */
const SplitToggle = () => {
  const engine = useEngine();
  const live = useLiveState();
  return (
    <button
      className={cn("flex h-6 w-6 items-center justify-center rounded-[3px] hover:bg-white/[0.05]", live.right ? "text-code" : "text-text hover:text-bright")}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => (live.right ? engine?.live.unsplit() : engine?.live.split())}
      title="split: a second editor on the right (⌘\\)"
      aria-label="split"
    >
      <Columns2 size={14} strokeWidth={1.75} />
    </button>
  );
};

/** One line on top: name, set, tempo, bar, key, both decks */
export const LiveMenu = () => {
  const engine = useEngine();
  const transport = useTransport();
  const position = useRef<HTMLSpanElement>(null);
  const ticks = useRef<HTMLDivElement>(null);

  useFrame(() => {
    if (!engine || !position.current || !ticks.current) return;
    const running = engine.transport.running;
    const { bar, beat, phase } = engine.transport.position();
    position.current.textContent = running ? `${String(bar).padStart(3, "0")}:${beat}` : "---:-";
    const sixteenth = running ? (beat - 1) * 4 + Math.floor(phase * 4) : -1;
    const children = ticks.current.children;
    for (let index = 0; index < children.length; index++) {
      const tick = children[index] as HTMLElement;
      tick.style.opacity = index === sixteenth ? "1" : index < sixteenth ? "0.5" : "0.15";
      tick.style.background = index === sixteenth ? "var(--color-deck-b)" : "var(--color-bright)";
    }
  }, !!engine);

  return (
    <header className="border-line flex min-h-11 shrink-0 flex-wrap items-center gap-x-5 gap-y-1 border-b px-4 py-1.5 text-[12px] whitespace-nowrap">
      {/* wraps to a second row when narrow (a 9:16 recording) */}
      <div className="flex items-center gap-2">
        <img src="/logo.svg" alt="" className="h-5 w-5" />
        <span className="text-bright tracking-[0.04em]">lodecks.com</span>
      </div>
      <SetMenu />
      <PacksMenu className="h-6" />
      <EffectsMenu className="h-6" />
      <HelpMenu className="h-6" />
      {/* opens next to the set, like the pack editor */}
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => openSettingsTab()}
        title="settings: palette, deck colours, new sets"
        className="text-dim hover:text-bright flex h-6 items-center rounded-[3px] px-1.5 hover:bg-white/[0.05]"
      >
        <SettingsIcon size={14} strokeWidth={1.75} />
      </button>
      <RecordButton />

      <div className="ml-auto flex items-center gap-4 font-mono">
        <TempoControl className={cn("px-1.5 py-0.5 tabular-nums", transport.started ? "text-bright" : "text-dim")}>
          {transport.started && <span className="text-deck-b mr-1.5">●</span>}
          {transport.bpm.toFixed(1)} <span className="text-dim">bpm</span>
        </TempoControl>
        <div className="flex items-center gap-2">
          <span ref={position} className="text-bright w-14 whitespace-nowrap tabular-nums">---:-</span>
          <div ref={ticks} className="flex h-2.5 w-28 items-end gap-[2px]">
            {Array.from({ length: 16 }, (_, index) => (
              <span key={index} className={cn("flex-1 rounded-[1px]", index % 4 === 0 ? "h-full" : "h-1/2")} style={{ opacity: 0.15, background: "var(--color-bright)" }} />
            ))}
          </div>
        </div>
        <button
          className="flex items-baseline gap-1.5 rounded-[3px] px-1.5 py-0.5 hover:bg-white/[0.05]"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => engine?.transport.cycleQuantize()}
          title="launch quantize: what pads, cue jumps and loops wait for · click to change"
        >
          <span className="text-dim text-[10px] uppercase">q</span>
          <span className="text-warn">{QuantizeLabels[transport.quantize]}</span>
        </button>

      </div>

      <div className="flex items-center gap-6">
        <DeckStatus id="a" />
        <DeckStatus id="b" />
        <SplitToggle />
      </div>
    </header>
  );
};

// the editor's Mod key: ⌘ on a Mac, Ctrl elsewhere
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** A shortcut drawn with key icons: ⌘ ↵ run */
const Shortcut = ({ keys, children }: { keys: string[]; children: React.ReactNode }) => (
  <span className="flex items-center gap-1">
    <span className="text-text flex items-center gap-[3px]">
      {keys.map((key, index) =>
        key === "mod" ? (
          isMac ? <Command key={index} size={11} strokeWidth={2} /> : <span key={index}>ctrl</span>
        ) : key === "shift" ? (
          <ArrowBigUp key={index} size={12} strokeWidth={1.75} />
        ) : key === "enter" ? (
          <CornerDownLeft key={index} size={11} strokeWidth={2} />
        ) : (
          <span key={index} className="leading-none">{key}</span>
        )
      )}
    </span>
    {children}
  </span>
);

/** One line below: what the last run said */
export const LiveStatus = () => {
  const live = useLiveState();
  return (
    <footer className="border-line text-dim flex h-7 shrink-0 items-center gap-4 border-t px-4 font-mono text-[11px]">
      {live.running.length > 0 && <span className="text-deck-a">● running</span>}
      <span className={cn("min-w-0 flex-1 truncate", live.status?.kind === "error" ? "text-bad" : "text-dim")}>
        {live.status?.text ?? "ctrl+enter runs the block under the cursor · help() for the cheat sheet"}
      </span>
      <span className="flex shrink-0 items-center gap-3">
        <Shortcut keys={["mod", "enter"]}>run</Shortcut>
        <Shortcut keys={["shift", "mod", "enter"]}>all</Shortcut>
        <Shortcut keys={["mod", ".", "mod", "."]}>panic</Shortcut>
        <Shortcut keys={["mod", "S"]}>save</Shortcut>
      </span>
    </footer>
  );
};

/** Recording mode: frames the app in a video's shape, to record it */
const RecordButton = () => {
  const setMode = useSetAtom(recordModeAtom);
  const mode = useAtomValue(recordModeAtom);
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => setMode(mode ? undefined : "landscape")}
      title="recording mode: frame lodecks for a video (YouTube, Reels, TikTok, Shorts)"
      className={cn("flex h-6 items-center rounded-[3px] px-1.5 hover:bg-white/[0.05]", mode ? "text-bright" : "text-dim hover:text-bright")}
    >
      <Video size={14} strokeWidth={1.75} />
    </button>
  );
};
