import { Minus, MoreHorizontal, Pause, Pencil, Play, Plus, Square, Trash2 } from "lucide-react";
import { FavoriteIcon, TrackIcon } from "@/components/icon";
import {
  PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { Pack } from "@/common/schemas/pack.schema";
import { padLayout } from "@/common/utils/pads.util";

import type { AuditionState } from "@/engine/modules/deck/audition.module";
import type { Deck } from "@/engine/modules/deck/deck.module";
import type { Voice } from "@/engine/modules/voice/voice.module";

import { Button } from "@/components/button";
import { Colors } from "@/hooks/canvas.hook";
import { useStore } from "@/providers/engine.provider";
import { useFrame } from "@/hooks/frame.hook";
import { useCatalog } from "@/hooks/import.hook";
import { usePackSave } from "@/hooks/pack-save.hook";
import { saveErrorAtom } from "@/utils/atoms.util";
import { useAtomValue } from "jotai";
import { drawTrackView, trackSpan } from "@/utils/arrangement.util";
import { cn } from "~/utils/classes.util";

const Gutter = 230;
const MenuItem = "flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-white/[0.05] disabled:opacity-35";
const IdleAudition: AuditionState = { playing: false, bar: 0, from: 0, muted: [] };
const RulerHeight = 46;
const LaneHeight = 34;
const CueColors = ["var(--color-deck-a)", "var(--color-code)", "var(--color-gray)", "var(--color-deck-b)"];

const sectionColor = (name: string) => {
  const base = name.replace(/\s*\d+$/, "");
  const hue = [...base].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  return `hsl(${hue} 45% 55% / 0.22)`;
};

type Row = { kind: "voices" | "stems"; voice: Voice };

type View = { left: number; width: number };

/**
 * One layer where it sits in the song. Only the part on screen is drawn,
 * from the audio itself, so it stays sharp at any zoom.
 */
const Lane = ({ row, pack, view, pxPerBar, color }: { row: Row; pack: Pack; view: View; pxPerBar: number; color: string }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || view.width <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(view.width * dpr));
    canvas.height = LaneHeight * dpr;
    drawTrackView(ctx, row.voice, pack, { ...view, pxPerBar }, color);
  }, [row.voice, row.voice.loaded, pack.gridOffset, row.voice.track.bar, view.left, view.width, pxPerBar, color]);

  return <canvas ref={ref} style={{ left: view.left, width: view.width, height: LaneHeight }} className="absolute top-0 block" />;
};

/**
 * Pack edit mode: the song as an arrangement. A ruler with sections and
 * draggable cues, then one lane per layer placed where it plays in the
 * song. It plays on its own clock (play / pause / stop, Space), heard in
 * the headphones, never touching the deck or the set. Ctrl+S saves.
 */
export const PackEditor = ({ instance, onClose }: { instance: Deck; onClose: () => void }) => {
  // the deck it edits: a deck of its own, in a tab
  const deck = useStore(instance.store, instance.store.get());
  const id = instance.id;
  const close = onClose;
  const savePack = usePackSave();
  const save = () => savePack(instance);
  const saveError = useAtomValue(saveErrorAtom);
  const catalog = useCatalog();
  const [titling, setTitling] = useState(false);
  const source = catalog.packs.find((item) => item.id === deck.packId)?.source ?? "local";
  const pack = deck.pack;
  const scroller = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const scrollFrame = useRef(0);
  const [zoom, setZoom] = useState<number>();
  const [follow, setFollow] = useState(true);
  const [renaming, setRenaming] = useState<number>();
  const [dragging, setDragging] = useState<number>();
  // a layer's menu, or its name being edited ("kind:id")
  const [layerMenu, setLayerMenu] = useState<string>();
  const [renamingLayer, setRenamingLayer] = useState<string>();
  const audition = useStore(instance?.audition.store, IdleAudition);
  const position = useRef<HTMLSpanElement>(null);

  // the editor's player stops when it closes
  useEffect(() => () => instance?.audition.pause(), [instance]);
  useEffect(() => {
    if (!layerMenu) return;
    const close = () => setLayerMenu(undefined);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [layerMenu]);

  const songBars = instance && pack ? instance.songBars : 1;
  const fit = Math.max(4, (width - Gutter - 16) / songBars);
  const pxPerBar = zoom ?? fit;
  const total = songBars * pxPerBar;
  // the stretch of the lanes on screen, past the names on the left
  const view = { left: Math.min(scrollLeft, Math.max(0, total - 1)), width: Math.max(0, Math.min(width - Gutter, total - Math.min(scrollLeft, total))) };

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    setScrollLeft(element.scrollLeft);
    return () => observer.disconnect();
    // the scroller only exists once a pack is on the deck
  }, [!!deck.pack]);

  const rows = useMemo<Row[]>(() => {
    if (!instance || !pack) return [];
    const stems = pack.stems.map((track) => instance.stems.get(track.id)).filter(Boolean) as Voice[];
    const voices = pack.voices
      .map((track) => instance.voices.get(track.id))
      .filter(Boolean)
      .sort((a, b) => a!.track.bar - b!.track.bar || a!.track.id.localeCompare(b!.track.id)) as Voice[];
    return [
      ...stems.map((voice) => ({ kind: "stems" as const, voice })),
      ...voices.map((voice) => ({ kind: "voices" as const, voice }))
    ];
    // tracks are re-read when the pack (names, pads) or loading changes
  }, [instance, pack, deck.loading]);

  const keys = useMemo(() => {
    const map = new Map<string, string>();
    if (!pack) return map;
    padLayout(pack.voices).forEach((track, key) => map.set(`voices:${track.id}`, key));
    padLayout(pack.stems).forEach((track, key) => map.set(`stems:${track.id}`, `⇧${key}`));
    return map;
  }, [pack]);

  // the editor's own playhead, and keeping it in view while following
  useFrame(() => {
    const element = playhead.current;
    const box = scroller.current;
    if (!element || !box || !instance?.store.get().pack) return;
    const running = instance.audition.store.get().playing;
    const bar = instance.audition.position();
    const x = Gutter + bar * pxPerBar;
    element.style.transform = `translateX(${x}px)`;
    if (position.current) position.current.textContent = `${String(Math.floor(bar) + 1).padStart(3, "0")}.${Math.floor((bar % 1) * 4) + 1}`;

    if (follow && running) {
      const visible = x - box.scrollLeft;
      if (visible > box.clientWidth * 0.8 || visible < Gutter) {
        box.scrollLeft = Math.max(0, x - Gutter - (box.clientWidth - Gutter) * 0.2);
      }
    }
  });

  if (!pack || !instance) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="legend">{instance.editor ? (deck.error ? `could not open it: ${deck.error}` : "opening the pack…") : `deck ${id.toUpperCase()} is empty — load a pack to edit it`}</span>
      </div>
    );
  }

  const barAt = (clientX: number) => {
    const box = scroller.current!;
    const rect = box.getBoundingClientRect();
    return (clientX - rect.left + box.scrollLeft - Gutter) / pxPerBar;
  };

  // zoom around the pointer, so the bar under it stays put
  const zoomTo = (next: number, clientX?: number) => {
    const box = scroller.current;
    const clamped = Math.max(fit, Math.min(240, next));
    if (!box) return setZoom(clamped);
    const anchor = clientX ?? box.getBoundingClientRect().left + Gutter + (box.clientWidth - Gutter) / 2;
    const bar = barAt(anchor);
    setZoom(clamped <= fit + 0.01 ? undefined : clamped);
    requestAnimationFrame(() => {
      const rect = box.getBoundingClientRect();
      box.scrollLeft = Math.max(0, Gutter + bar * clamped - (anchor - rect.left));
    });
  };

  const step = [1, 2, 4, 8, 16, 32, 64].find((value) => value * pxPerBar >= 34) || 64;
  const bars = Array.from({ length: Math.ceil(songBars / step) + 1 }, (_, index) => index * step).filter((bar) => bar <= songBars);

  const onRuler = (event: ReactPointerEvent) => {
    if (event.target !== event.currentTarget) return;
    const bar = barAt(event.clientX);
    if (bar < 0) return;
    if (event.shiftKey) {
      const slot = instance.freeCueSlot();
      if (slot) instance.setCue(slot, Math.round(bar));
      return;
    }
    instance.audition.seek(Math.floor(bar));
  };

  const dragCue = (slot: number) => (event: ReactPointerEvent) => {
    event.stopPropagation();
    if (event.altKey) return instance.clearCue(slot);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(slot);
  };

  const moveCue = (slot: number) => (event: ReactPointerEvent) => {
    if (dragging !== slot || !event.buttons) return;
    const bar = barAt(event.clientX);
    // snaps to the bar; shift snaps to the beat
    const snapped = event.shiftKey ? Math.round(bar * 4) / 4 : Math.round(bar);
    if (snapped !== deck.cues[slot]?.bar) instance.setCue(slot, snapped);
  };

  return (
    <div
      data-deck={id}
      tabIndex={-1}
      className="flex h-full min-h-0 flex-col gap-1.5 outline-none"
      onKeyDown={(event) => {
        // Space plays / pauses the editor, not the main clock
        if (event.code !== "Space" || (event.target as HTMLElement).tagName === "INPUT") return;
        event.preventDefault();
        event.stopPropagation();
        instance.audition.toggle();
      }}
    >
      {/* header */}
      <header className="flex h-8 shrink-0 items-center gap-2 px-1">
        {/* on / it edits a deck's pack; in a tab it stands alone */}
        {!instance.editor && (
          <>
            <span className="bg-accent text-ink flex h-6 w-6 items-center justify-center rounded-full font-medium">{id.toUpperCase()}</span>
            <span className="legend !text-accent">edit</span>
          </>
        )}
        {titling ? (
          <input
            autoFocus
            defaultValue={pack.title}
            className="bg-ink border-line text-bright w-64 border px-1.5 text-[14px] outline-none"
            onBlur={(event) => {
              instance?.renamePack(event.target.value);
              setTitling(false);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
              if (event.key === "Escape") setTitling(false);
            }}
          />
        ) : (
          <span className="text-bright cursor-text truncate text-[14px]" title="double click to rename" onDoubleClick={() => setTitling(true)}>
            {pack.title}
          </span>
        )}
        {source === "new" && <span className="legend !text-warn">new import · not saved</span>}
        <span className="legend">
          {pack.bpm.toFixed(2)} bpm · {pack.key} · {songBars} bars · {rows.length} layers
        </span>
        {/* the editor's own clock: the deck and the set are left alone */}
        <span className="flex items-center gap-1" title="plays the pack as arranged, in the headphones, on its own clock (Space)">
          <Button size="icon" design={audition.playing ? "active" : "default"} onClick={() => instance.audition.toggle()} title={audition.playing ? "pause (Space)" : "play (Space)"}>
            {audition.playing ? <Pause size={13} strokeWidth={1.75} /> : <Play size={13} strokeWidth={1.75} />}
          </Button>
          <Button size="icon" onClick={() => instance.audition.stop()} title="stop: back to where play started">
            <Square size={11} strokeWidth={1.75} />
          </Button>
          <span ref={position} className="text-bright w-12 font-mono text-[12px] tabular-nums">001.1</span>
          {(audition.solo || audition.muted.length > 0) && (
            <span className="legend !text-warn">{audition.solo ? "solo" : `${audition.muted.length} muted`}</span>
          )}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="legend hidden xl:inline">drag cues · shift: beat · shift+click ruler adds · alt+click removes · dbl-click renames</span>
          <Button size="sm" onClick={() => zoomTo(pxPerBar / 1.5)} title="zoom out (ctrl+scroll)"><Minus size={12} strokeWidth={1.75} /></Button>
          <Button size="sm" onClick={() => setZoom(undefined)} design={zoom ? "default" : "active"} title="fit the song">fit</Button>
          <Button size="sm" onClick={() => zoomTo(pxPerBar * 1.5)} title="zoom in (ctrl+scroll)"><Plus size={12} strokeWidth={1.75} /></Button>
          <Button size="sm" design={follow ? "active" : "default"} onClick={() => setFollow(!follow)} title="keep the playhead in view">follow</Button>
          {saveError?.deck === instance && <span className="legend !text-bad max-w-64 truncate" title={saveError.text}>{saveError.text}</span>}
          {/* saving keeps the pack in this browser, never on the server */}
          <Button
            size="sm"
            design={deck.edited || source === "new" ? "accent" : "default"}
            onClick={save}
            title="keep cues, pads and names in this browser (Ctrl+S)"
          >
            {deck.edited || source === "new" ? "● save" : "saved"}
          </Button>
          <Button size="sm" onClick={close} title="close (Esc)">close</Button>
        </span>
      </header>

      {/* arrangement */}
      <div
        ref={scroller}
        onScroll={(event) => {
          const left = event.currentTarget.scrollLeft;
          cancelAnimationFrame(scrollFrame.current);
          scrollFrame.current = requestAnimationFrame(() => setScrollLeft(left));
        }}
        className="screen relative min-h-0 flex-1 overflow-auto"
        onWheel={(event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          zoomTo(pxPerBar * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event.clientX);
        }}
      >
        <div className="relative" style={{ width: Gutter + total + 16, minHeight: "100%" }}>
          {/* ruler: sections, bar numbers, cue handles */}
          <div className="sticky top-0 z-[35] flex bg-[var(--color-screen)]" style={{ height: RulerHeight }}>
            <div className="sticky left-0 z-40 flex shrink-0 items-end border-r border-b border-[var(--color-line)] bg-[var(--color-screen)] px-2 pb-1" style={{ width: Gutter }}>
              <span className="legend !text-[9px]">layers</span>
            </div>
            <div className="relative cursor-pointer border-b border-[var(--color-line)]" style={{ width: total }} onPointerDown={onRuler}>
              {pack.sections.map((section) => (
                <div
                  key={`${section.name}-${section.bar}`}
                  className="pointer-events-none absolute top-0 flex h-4 items-center truncate border-l border-white/20 px-1 text-[9px] text-white/70"
                  style={{ left: section.bar * pxPerBar, width: section.bars * pxPerBar, background: sectionColor(section.name) }}
                >
                  {section.name}
                </div>
              ))}
              {bars.map((bar) => (
                <span key={bar} className="pointer-events-none absolute bottom-1 text-[9px] text-[var(--color-dim)]" style={{ left: bar * pxPerBar + 3 }}>
                  {bar + 1}
                </span>
              ))}
              {Object.entries(deck.cues).map(([key, cue]) => {
                const slot = Number(key);
                const color = CueColors[(slot - 1) % 4];
                return (
                  <div
                    key={slot}
                    className={cn("absolute top-4 z-10 flex cursor-ew-resize items-center gap-1 px-1 text-[10px] text-[var(--color-ink)]", dragging === slot && "ring-1 ring-white")}
                    style={{ left: cue.bar * pxPerBar, background: color, transform: "translateX(-1px)" }}
                    onPointerDown={dragCue(slot)}
                    onPointerMove={moveCue(slot)}
                    onPointerUp={() => setDragging(undefined)}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      setRenaming(slot);
                    }}
                    title={`cue ${slot} · ${cue.name} · bar ${cue.bar + 1}`}
                  >
                    <span className="font-medium">{slot}</span>
                    {renaming === slot ? (
                      <input
                        autoFocus
                        defaultValue={cue.name}
                        className="w-24 bg-black/30 px-1 text-[10px] text-white outline-none"
                        onPointerDown={(event) => event.stopPropagation()}
                        onBlur={(event) => {
                          instance.renameCue(slot, event.target.value);
                          setRenaming(undefined);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                          if (event.key === "Escape") setRenaming(undefined);
                        }}
                      />
                    ) : (
                      pxPerBar > 14 && <span className="max-w-28 truncate">{cue.name}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* lanes, over a bar grid painted by css */}
          <div
            className="relative"
            style={{
              backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px)`,
              backgroundSize: `${pxPerBar * 4}px 100%, ${pxPerBar}px 100%`,
              backgroundPosition: `${Gutter}px 0, ${Gutter}px 0`
            }}
          >
            {rows.map((row) => {
              const { voice, kind } = row;
              const state = deck[kind][voice.id];
              const active = state && state.status !== "idle" && state.status !== "loading";
              const key = keys.get(`${kind}:${voice.id}`);
              const color = kind === "stems" ? Colors.paper : Colors[id];
              const span = trackSpan(pack, voice);
              const layer = `${kind}:${voice.id}`;
              return (
                <div key={`${kind}:${voice.id}`} className={cn("flex border-b border-[var(--color-line)]/60", active && "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]")} style={{ height: LaneHeight }}>
                  <div
                    className="sticky left-0 z-40 flex shrink-0 items-center gap-1.5 border-r border-[var(--color-line)] bg-[var(--color-screen)] px-2"
                    style={{ width: Gutter }}
                  >
                    <span className={cn("w-6 shrink-0 text-center text-[10px]", key ? "text-accent" : "text-[var(--color-line-strong)]")} title={key ? "pad key" : "in the library, not on a pad"}>
                      {key || "·"}
                    </span>
                    {renamingLayer === layer ? (
                      <input
                        autoFocus
                        defaultValue={voice.track.name}
                        className="bg-ink border-line text-bright min-w-0 flex-1 border px-1 text-[11px] outline-none"
                        onBlur={(event) => {
                          const name = event.target.value.trim();
                          if (name && name !== voice.track.name) instance.updateTrack(kind, voice.id, { name });
                          setRenamingLayer(undefined);
                        }}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                          if (event.key === "Escape") setRenamingLayer(undefined);
                        }}
                      />
                    ) : (
                      <button
                        className={cn("min-w-0 flex-1 truncate text-left text-[11px]", active ? "text-accent" : "text-text hover:text-bright")}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => instance.audition.play(Math.max(0, Math.floor(span.start)))}
                        onDoubleClick={() => setRenamingLayer(layer)}
                        title="click: play from where it starts · double click: rename"
                      >
                        {voice.track.favorite && <FavoriteIcon on size={10} className="mr-1 align-[-1px]" />}
                        {voice.track.name}
                      </button>
                    )}
                    <span className="legend flex items-center gap-0.5 !text-[8px]"><TrackIcon type={voice.track.type} size={10} />{voice.track.bars ?? Math.round(span.bars)}</span>
                    <button
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => instance.audition.toggleMute(layer)}
                      className={cn("w-4 text-[10px]", audition.muted.includes(layer) ? "text-bad" : "text-[var(--color-dim)] hover:text-text")}
                      title="mute it in the editor"
                    >
                      M
                    </button>
                    <button
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => instance.audition.toggleSolo(layer)}
                      className={cn("w-4 text-[10px]", audition.solo === layer ? "text-warn" : "text-[var(--color-dim)] hover:text-text")}
                      title="hear only this one in the editor"
                    >
                      S
                    </button>
                    <span className="relative">
                      <button
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={() => setLayerMenu(layerMenu === layer ? undefined : layer)}
                        className="text-[var(--color-dim)] hover:text-text flex w-4 justify-center"
                        title="rename, star, delete"
                      >
                        <MoreHorizontal size={12} strokeWidth={1.75} />
                      </button>
                      {layerMenu === layer && (
                        <div
                          className="border-line-strong absolute top-5 left-0 z-50 w-40 rounded-[4px] border bg-popover py-1 text-[11px] shadow-[0_18px_40px_rgba(0,0,0,0.6)]"
                          onMouseDown={(event) => event.stopPropagation()}
                        >
                          <button className={MenuItem} onClick={() => { setLayerMenu(undefined); setRenamingLayer(layer); }}>
                            <Pencil size={11} strokeWidth={1.75} /> rename
                          </button>
                          <button className={MenuItem} onClick={() => { setLayerMenu(undefined); instance.updateTrack(kind, voice.id, { favorite: !voice.track.favorite }); }}>
                            <FavoriteIcon on={!voice.track.favorite} size={11} /> {voice.track.favorite ? "unstar" : "star"}
                          </button>
                          <div className="bg-line my-1 h-px" />
                          <button
                            className={cn(MenuItem, "text-bad")}
                            disabled={rows.length <= 1}
                            onClick={() => {
                              setLayerMenu(undefined);
                              if (confirm(`Remove "${voice.track.name}" from the pack? It goes for good once the pack is saved.`)) instance.removeTrack(kind, voice.id);
                            }}
                          >
                            <Trash2 size={11} strokeWidth={1.75} /> delete layer
                          </button>
                        </div>
                      )}
                    </span>
                  </div>
                  <div
                    className="relative cursor-pointer"
                    style={{ width: total, height: LaneHeight }}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      instance.audition.seek(Math.max(0, barAt(event.clientX)));
                    }}
                    title={`${voice.track.name} — bars ${Math.floor(span.start) + 1}–${Math.ceil(span.start + span.bars)} · click moves the playhead`}
                  >
                    <Lane row={row} pack={pack} view={view} pxPerBar={pxPerBar} color={color} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* cue lines through every lane */}
          {Object.entries(deck.cues).map(([key, cue]) => (
            <div
              key={key}
              className="pointer-events-none absolute bottom-0 z-[5] w-px opacity-60"
              style={{ left: Gutter + cue.bar * pxPerBar, top: RulerHeight, background: CueColors[(Number(key) - 1) % 4] }}
            />
          ))}

          {/* loop band */}
          {deck.loop && (
            <div
              className="pointer-events-none absolute bottom-0 z-[4]"
              style={{
                left: Gutter + deck.loop.start * pxPerBar,
                width: deck.loop.bars * pxPerBar,
                top: RulerHeight,
                background: deck.loop.active ? "rgba(143,155,179,0.12)" : "rgba(143,155,179,0.05)"
              }}
            />
          )}

          <div ref={playhead} className="pointer-events-none absolute top-0 bottom-0 left-0 z-30 w-0.5 bg-[var(--color-deck-b)]" />
        </div>
      </div>
    </div>
  );
};
