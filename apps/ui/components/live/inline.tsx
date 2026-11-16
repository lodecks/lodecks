import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { DeckId } from "@/common/constants/deck.constant";
import { Globals, Methods } from "@/engine/modules/live/api.module";
import { soundingKey, type ComponentSpec, type VisualSource } from "@/engine/modules/live/live.module";

import { DeckJukebox } from "@/components/deck/jukebox";
import { DeckPlatter } from "@/components/deck/platter";
import { DeckWaveform } from "@/components/deck/waveform";
import { MixerBody } from "@/components/mixer/mixer";
import { DeckCuePads, DeckFxPads } from "@/components/perform/fx-cue";
import { Colors, useCanvas } from "@/hooks/canvas.hook";
import { useAutomix, useDeck, useEngine } from "@/hooks/engine.hook";
import { useFrame } from "@/hooks/frame.hook";
import { usePacks } from "@/hooks/packs.hook";
import { useLiveState } from "@/hooks/live.hook";
import { useStore } from "@/providers/engine.provider";
import { cn } from "~/utils/classes.util";

import { DeckViz, DeckVizView, DeckVizViews } from "./deck-viz";
import { inlineContainers } from "./editor/widgets";
import { DeckPads } from "@/components/perform/pads";
import { DeckControls } from "@/components/deck/view";

// —— visuals: rendered once, mirrored into every place that shows them ——

const VisualSize = { width: 768, height: 432 };
const mirrors = new Set<(source: HTMLCanvasElement) => void>();
let output: { canvas: HTMLCanvasElement; hydra: HTMLCanvasElement } | undefined;

// previews: a line's own stack, by component id
const previews = new Map<string, (source: HTMLCanvasElement) => void>();

const drawInto = (canvas: React.RefObject<HTMLCanvasElement | null>) => (source: HTMLCanvasElement) => {
  const target = canvas.current;
  if (!target) return;
  if (target.width !== source.width) {
    target.width = source.width;
    target.height = source.height;
  }
  target.getContext("2d")?.drawImage(source, 0, 0);
};

export const useMirror = (canvas: React.RefObject<HTMLCanvasElement | null>, enabled = true) => {
  useEffect(() => {
    // a hidden mirror would keep the compositor drawing for nothing
    if (!enabled) return;
    const draw = drawInto(canvas);
    mirrors.add(draw);
    return () => {
      mirrors.delete(draw);
    };
  }, [canvas, enabled]);
};

/**
 * What one line showed, on its own: two lines that each show() a visual
 * each draw theirs, even though only the last one plays
 */
const VisualInline = ({ id, layers }: { id: string; layers?: VisualSource[] }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useEngine();
  // an old spec without layers mirrors what plays
  useMirror(canvas, !layers);
  useEffect(() => {
    if (!engine || !layers) return;
    engine.compositor.setPreview(id, layers);
    previews.set(id, drawInto(canvas));
    return () => {
      previews.delete(id);
      engine.compositor.setPreview(id, undefined);
    };
  }, [engine, id, layers]);
  return (
    <div className="group relative w-full max-w-[720px]">
      <canvas
        ref={canvas}
        className="aspect-video w-full rounded-[3px] bg-black [image-rendering:pixelated]"
        onDoubleClick={() => engine?.live.store.set({ full: true })}
      />
      <button
        className="legend absolute top-2 right-2 rounded-[2px] bg-black/60 px-1.5 py-0.5 !text-[8px] opacity-0 transition-opacity group-hover:opacity-100"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => engine?.live.store.set({ full: true })}
      >
        full · dbl click
      </button>
    </div>
  );
};

/** The visuals behind everything, while a visual is set as the background */
export const LiveBackground = () => {
  const { background } = useLiveState();
  const canvas = useRef<HTMLCanvasElement>(null);
  useMirror(canvas, !!background);
  return (
    <div className={cn("pointer-events-none absolute inset-0 z-0 overflow-hidden", !background && "hidden")} aria-hidden>
      <canvas ref={canvas} className="h-full w-full object-cover [image-rendering:pixelated]" />
      {/* darkened, so the code on top stays readable */}
      <div className="absolute inset-0" style={{ background: `rgb(7 10 16 / ${background?.dim ?? 0.6})` }} />
    </div>
  );
};

/** The visuals over everything, while `full` is on (Esc leaves) */
export const LiveFullVisual = () => {
  const engine = useEngine();
  const { full } = useLiveState();
  const canvas = useRef<HTMLCanvasElement>(null);
  useMirror(canvas, full);

  useEffect(() => {
    if (!full) return;
    document.documentElement.requestFullscreen?.().catch(() => {});
    const leave = (event: KeyboardEvent) => event.key === "Escape" && engine?.live.store.set({ full: false });
    const exit = () => !document.fullscreenElement && engine?.live.store.set({ full: false });
    window.addEventListener("keydown", leave);
    document.addEventListener("fullscreenchange", exit);
    return () => {
      window.removeEventListener("keydown", leave);
      document.removeEventListener("fullscreenchange", exit);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, [full, engine]);

  return (
    <div className={cn("fixed inset-0 z-[70] bg-black", !full && "hidden")} onDoubleClick={() => engine?.live.store.set({ full: false })}>
      <canvas ref={canvas} className="h-full w-full object-cover [image-rendering:pixelated]" />
    </div>
  );
};

// —— decks ——

const DeckInline = ({ id, view }: { id: DeckId; view: string }) => {
  if ((DeckVizViews as readonly string[]).includes(view)) return <DeckViz id={id} view={view as DeckVizView} />;
  return <DeckPanel id={id} view={view} />;
};

const DeckPanel = ({ id, view }: { id: DeckId; view: string }) => {
  const engine = useEngine();
  const deck = useDeck(id);
  const info = useRef<HTMLSpanElement>(null);
  const level = useRef<HTMLSpanElement>(null);

  useFrame(() => {
    if (!engine) return;
    if (info.current) info.current.textContent = deck.pack ? `bar ${Math.floor(engine.decks[id].songBar()) + 1}` : "";
    if (level.current) level.current.style.width = `${Math.min(1, engine.analysis.data.decks[id] * 3) * 100}%`;
  }, !!engine);

  const header = (
    <div className="flex items-baseline gap-2 text-[12px]">
      <span className={cn("font-mono uppercase", id === "a" ? "text-deck-a" : "text-deck-b")}>deck {id}</span>
      <span className="text-bright truncate">{deck.pack ? deck.pack.title : deck.loading ? "loading…" : "empty"}</span>
      {deck.pack && <span className="text-dim font-mono text-[11px]">{deck.pack.bpm} · {soundingKey(deck.pack.key, deck.transpose)}{deck.infinite ? " · ∞" : ""}</span>}
      <span ref={info} className="text-dim ml-auto font-mono text-[11px] tabular-nums" />
    </div>
  );

  const toggle = () => {
    if (!engine) return;
    const instance = engine.decks[id];
    if (instance.songPlaying()) instance.stopAll();
    else engine.start().then(() => instance.startSong());
  };

  if (view === "graph") {
    return (
      <div data-deck={id} className="flex w-full max-w-[880px] flex-col gap-1.5">
        {header}
        <DeckJukebox id={id} className="h-40 w-full" />
      </div>
    );
  }
  if (view === "bars") {
    return (
      <div data-deck={id} className="flex w-full max-w-[880px] flex-col gap-1.5">
        {header}
        <DeckWaveform id={id} seek className="h-20 w-full" />
      </div>
    );
  }
  // the fx pads, without keyboard keys: the editor has the keyboard
  if (view === "fx") {
    return (
      <div data-deck={id} className="flex w-full max-w-[880px] flex-col gap-1.5">
        {header}
        <DeckFxPads id={id} keys={false} className="h-16" />
      </div>
    );
  }
  if (view === "cues") {
    return (
      <div data-deck={id} className="flex w-full max-w-[880px] flex-col gap-1.5">
        {header}
        <DeckCuePads id={id} keys={false} />
      </div>
    );
  }
  // the deck panel's row of buttons
  if (view === "controls") {
    return (
      <div data-deck={id} className="flex w-full max-w-[880px] flex-col gap-1.5">
        {header}
        <DeckControls id={id} />
      </div>
    );
  }
  if (view === "pads") {
    return (
      <div data-deck={id} className="flex w-full max-w-[880px] flex-col gap-1.5">
        {header}
        {/* the / screen's pads: they fire on press, light while playing */}
        <DeckPads id={id} legend={false} className="h-[190px] p-0" />
      </div>
    );
  }
  return (
    <div data-deck={id} className="flex w-full max-w-[880px] items-center gap-4">
      <DeckPlatter id={id} className="h-[92px] w-[92px] shrink-0" onToggle={toggle} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {header}
        <DeckWaveform id={id} window={8} className="h-20 w-full" />
        <div className="h-1 overflow-hidden rounded-full bg-white/5">
          <span ref={level} className="bg-accent block h-full" />
        </div>
      </div>
    </div>
  );
};

// —— the rest ——

const PacksInline = ({ filter }: { filter?: string }) => {
  const engine = useEngine();
  const { packs } = usePacks();
  const needle = filter?.toLowerCase();
  const list = needle ? packs.filter((pack) => `${pack.id} ${pack.title} ${pack.artist}`.toLowerCase().includes(needle)) : packs;

  return (
    <div className="flex w-full max-w-[720px] flex-col font-mono text-[12px]">
      {list.map((pack) => (
        <div key={pack.id} className="group flex items-center gap-3 rounded-[2px] px-1 py-0.5 hover:bg-white/[0.03]">
          <span className="text-bright w-40 truncate">{pack.id}</span>
          <span className="text-text min-w-0 flex-1 truncate">{pack.title}{pack.artist ? <span className="text-dim"> — {pack.artist}</span> : null}</span>
          <span className="text-dim w-32 shrink-0 text-right tabular-nums">{pack.bpm} · {pack.key}</span>
          {(["a", "b"] as const).map((id) => (
            <button
              key={id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => engine?.load(id, pack.id)}
              className={cn("rounded-[2px] px-1.5 text-[10px] uppercase opacity-40 group-hover:opacity-100", id === "a" ? "bg-deck-a/20 text-deck-a" : "bg-deck-b/20 text-deck-b")}
            >
              {id}
            </button>
          ))}
        </div>
      ))}
      {!list.length && <span className="text-dim">no packs{filter ? ` match "${filter}"` : ""}</span>}
    </div>
  );
};

/** A take, under the line that asked for it: waiting, blending, done */
const TakeInline = ({ deck, take }: { deck: DeckId; take?: number }) => {
  const engine = useEngine();
  const mix = useAutomix();
  const fill = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const from: DeckId = deck === "a" ? "b" : "a";
  const mine = take !== undefined && mix.id === take;
  const active = mine && mix.status !== "idle";
  const ended = take !== undefined ? mix.outcomes?.[take] : undefined;

  useFrame(() => {
    if (!engine || !active || !fill.current || !text.current) return;
    const state = engine.automix.store.get();
    const now = engine.transport.now();
    const startsAt = state.startsAt ?? now;
    const endsAt = state.endsAt ?? now;
    if (state.status === "armed") {
      const bars = Math.max(0, startsAt - now);
      fill.current.style.width = "0%";
      text.current.textContent = `starts on bar ${Math.floor(startsAt) + 1} · in ${bars < 1 ? `${Math.ceil(bars * 4)} beat${Math.ceil(bars * 4) === 1 ? "" : "s"}` : `${Math.ceil(bars)} bars`}`;
    } else {
      const progress = engine.automix.progress(now);
      fill.current.style.width = `${progress * 100}%`;
      const bar = Math.min(state.length, Math.floor(now - startsAt) + 1);
      text.current.textContent = `bar ${Math.max(1, bar)} of ${state.length}${now >= startsAt + state.length / 2 ? " · basses swapped" : ""} · ends on bar ${Math.floor(endsAt) + 1}`;
    }
  }, active);

  const label = (id: DeckId) => (
    <span className={cn("font-mono uppercase", id === "a" ? "text-deck-a" : "text-deck-b")}>deck {id}</span>
  );

  if (!active) {
    return (
      <div className="text-dim flex items-center gap-2 font-mono text-[12px]">
        {label(from)} <span>→</span> {label(deck)}
        <span className={ended === "done" ? "text-deck-a" : ended === "cancelled" ? "text-warn" : "text-dim"}>
          {ended === "done" ? `· deck ${deck} took over ✓` : ended === "cancelled" ? "· cancelled" : "· replaced by a newer take"}
        </span>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-[720px] flex-col gap-1.5 font-mono text-[12px]">
      <div className="flex items-center gap-2">
        {label(from)} <span className="text-dim">→</span> {label(deck)}
        <span className={mix.status === "mixing" ? "text-bright" : "text-dim"}>
          · {mix.status === "mixing" ? "mixing" : "armed"} · {mix.length} bars · enters at bar {(mix.plan?.entry ?? 0) + 1}
          {mix.transpose ? ` · ${mix.transpose > 0 ? "+" : ""}${mix.transpose} st` : ""}
        </span>
        <button
          className="text-bad border-bad/40 hover:bg-bad/10 ml-auto rounded-[3px] border px-2 py-px text-[10px] uppercase tracking-[0.06em]"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => engine?.automix.cancel()}
        >
          cancel
        </button>
      </div>
      {/* the blend: the crossfader moves along it, the basses swap halfway */}
      <div className="relative h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <span
          ref={fill}
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ background: `linear-gradient(90deg, var(--color-deck-${from}), var(--color-deck-${deck}))`, width: "0%" }}
        />
        <span className="absolute inset-y-0 left-1/2 w-px bg-white/30" />
      </div>
      <div className="text-dim flex gap-3 text-[11px]">
        <span ref={text} />
        {mix.plan?.reasons.length ? <span className="truncate">· {mix.plan.reasons.join(" · ")}</span> : null}
      </div>
    </div>
  );
};

type MarqueeSpec = Extract<ComponentSpec, { type: "marquee" }>;

// what people see as one character: emoji with skin tones, flags, joined
// families… are several code points each
const graphemes = (() => {
  const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : undefined;
  return (text: string) => (segmenter ? [...segmenter.segment(text)].map((part) => part.segment) : [...text]);
})();

const marqueeColor = (value: string) =>
  value === "a" ? Colors.a : value === "b" ? Colors.b : value === "code" ? Colors.tan : /^#[0-9a-f]{3,8}$/i.test(value) ? value : Colors.paper;

/**
 * Text sliding past forever, one pass every `speed` bars. Dancing, the
 * letters ride a wave on the beat and jump on the kick. The spec is read
 * every frame, so the code can change it while it plays.
 */
const MarqueeInline = ({ spec }: { spec: MarqueeSpec }) => {
  const engine = useEngine();
  const holder = useRef<HTMLDivElement>(null);
  const ref = useCanvas((ctx, width, height) => {
    ctx.clearRect(0, 0, width, height);
    if (!engine) return;
    const size = spec.size;
    // the canvas follows the size, with room for the dance
    const wanted = Math.round(size * (1.3 + spec.dance * 0.6));
    if (holder.current && holder.current.style.height !== `${wanted}px`) holder.current.style.height = `${wanted}px`;

    const transport = engine.transport;
    const beats = transport.running ? transport.now() * 4 : (performance.now() / 1000) * (transport.bpm / 60);
    const kick = engine.analysis.data.kick;
    const color = marqueeColor(spec.color);
    // emoji come from the system's emoji font, so each character is
    // measured: they are wider than the mono letters
    ctx.font = `600 ${size}px "JetBrains Mono", ui-monospace, monospace, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    const chars = graphemes(`${spec.text}   ·   `);
    const widths = chars.map((char) => ctx.measureText(char).width);
    const starts: number[] = [];
    let unitW = 0;
    for (const width of widths) {
      starts.push(unitW);
      unitW += width;
    }
    unitW = Math.max(1, unitW);
    const pass = beats / 4 / (spec.speed || 2);
    const offset = ((pass * unitW) % unitW + unitW) % unitW;
    const mid = height / 2;
    ctx.shadowColor = color;

    for (let x = -offset - unitW; x < width + unitW; x += unitW) {
      for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        if (char === " ") continue;
        const charW = widths[i];
        const cx = x + starts[i];
        if (cx < -charW || cx > width + charW) continue;
        let y = mid;
        let angle = 0;
        let alpha = 1;
        if (spec.dance > 0) {
          const wave = Math.sin((beats * 0.5 + i * 0.12) * Math.PI * 2);
          y += wave * spec.dance * size * 0.16 - kick * spec.dance * size * 0.18 * ((i % 2) * 2 - 1);
          angle = Math.sin((beats + i * 0.3) * Math.PI) * 0.12 * spec.dance;
          alpha = 0.75 + 0.25 * Math.abs(wave);
        }
        ctx.save();
        ctx.translate(cx + charW / 2, y);
        ctx.rotate(angle);
        ctx.globalAlpha = alpha;
        ctx.shadowBlur = 6 + kick * 22 * Math.max(0.3, spec.dance);
        ctx.fillStyle = color;
        ctx.fillText(char, 0, 0);
        ctx.restore();
      }
    }
  });
  return (
    <div ref={holder} className="w-full max-w-[880px] overflow-hidden" style={{ height: Math.round(spec.size * (1.3 + spec.dance * 0.6)) }}>
      <canvas ref={ref} className="h-full w-full" />
    </div>
  );
};

const ScopeInline = ({ kind, deck }: { kind: "scope" | "spectrum" | "meter"; deck?: DeckId }) => {
  const engine = useEngine();
  const ref = useCanvas((ctx, width, height) => {
    ctx.clearRect(0, 0, width, height);
    if (!engine?.audio.store.get().ready) return;
    const data = engine.analysis.data;
    if (kind === "meter") {
      const value = Math.min(1, data.decks[deck ?? "a"] * 3);
      ctx.fillStyle = deck === "b" ? Colors.b : Colors.a;
      ctx.fillRect(0, 0, value * width, height);
      return;
    }
    if (kind === "spectrum") {
      const bars = 64;
      for (let index = 0; index < bars; index++) {
        const bin = Math.floor(Math.pow(data.spectrum.length, index / bars));
        const value = data.spectrum[bin] / 255;
        ctx.fillStyle = index / bars < engine.audio.store.get().crossfade ? Colors.a : Colors.b;
        const w = width / bars;
        ctx.fillRect(index * w, height - value * height, w - 1, value * height);
      }
      return;
    }
    ctx.strokeStyle = Colors.text;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let index = 0; index < data.wave.length; index += 2) {
      const x = (index / data.wave.length) * width;
      const y = (data.wave[index] / 255) * height;
      if (index) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
  });
  return <canvas ref={ref} className={cn("w-full max-w-[720px]", kind === "meter" ? "h-2 rounded-full bg-white/5" : "h-20")} />;
};

const HelpInline = ({ name }: { name?: string }) => {
  const entries = name
    ? [...Globals, ...Object.values(Methods).flat()].filter((doc) => doc.name === name)
    : Globals;
  return (
    <div className="flex w-full max-w-[880px] flex-col gap-3 font-mono text-[12px]">
      <div className="grid grid-cols-[minmax(0,260px)_minmax(0,1fr)] gap-x-6 gap-y-0.5">
        {entries.map((doc) => (
          <div key={doc.signature} className="contents">
            <span className="text-deck-a truncate">{doc.signature}</span>
            <span className="text-dim truncate">{doc.doc}</span>
          </div>
        ))}
      </div>
      {!name && (
        <div className="text-dim">
          type a name and a dot to see its methods · hover any name for its docs · ctrl+enter runs the block ·
          ctrl+shift+enter runs all · ctrl+. twice panics · ctrl+s saves · alt+↑↓ moves between blocks
        </div>
      )}
      {name && !entries.length && <span className="text-bad">nothing called {name}</span>}
    </div>
  );
};

const Inline = ({ id, spec }: { id: string; spec: ComponentSpec }) => {
  switch (spec.type) {
    case "deck":
      return <DeckInline id={spec.deck} view={spec.view} />;
    case "mixer":
      return (
        <div className="module h-[230px] w-[440px] p-2">
          <MixerBody className="h-full" />
        </div>
      );
    case "packs":
      return <PacksInline filter={spec.filter} />;
    case "visual":
      return <VisualInline id={id} layers={spec.layers} />;
    case "scope":
    case "spectrum":
      return <ScopeInline kind={spec.type} />;
    case "meter":
      return <ScopeInline kind="meter" deck={spec.deck} />;
    case "help":
      return <HelpInline name={spec.name} />;
    case "take":
      return <TakeInline deck={spec.deck} take={spec.take} />;
    case "marquee":
      return <MarqueeInline spec={spec} />;
  }
};

const NoSpecs: { specs: Record<string, ComponentSpec> } = { specs: {} };

/**
 * Renders every inline component into its spot in the editor (portals, so
 * they share the app's context), and draws the visuals into every mirror.
 */
export const InlineHost = () => {
  const engine = useEngine();
  const ids = useSyncExternalStore(inlineContainers.subscribe, inlineContainers.ids, inlineContainers.ids);
  const components = useStore(engine?.live.components, NoSpecs);
  const [ready, setReady] = useState(false);

  // one compositor for the page, on canvases kept out of the layout
  useEffect(() => {
    if (!engine) return;
    output ??= (() => {
      const canvas = document.createElement("canvas");
      const hydra = document.createElement("canvas");
      for (const target of [canvas, hydra]) {
        target.width = VisualSize.width;
        target.height = VisualSize.height;
      }
      return { canvas, hydra };
    })();
    let disposed = false;
    engine.hydra.mount(output.hydra).then(() => {
      if (disposed || !output) return;
      try {
        engine.compositor.mount(output.canvas, engine.live.layers);
        setReady(true);
      } catch (error) {
        engine.live.say("error", `visuals: ${(error as Error).message}`);
      }
    });
    const off = engine.compositor.errors.on(({ layer, lines }) => engine.live.say("error", `visual ${layer}: ${lines.join(" · ")}`));
    return () => {
      disposed = true;
      off();
      engine.compositor.dispose();
      setReady(false);
    };
  }, [engine]);

  useFrame((time) => {
    // live values run in the engine's own loop; this draws the visuals
    if (!engine) return;
    if (!ready || !output || (!mirrors.size && !previews.size)) return;
    if (!engine.live.layers.store.get().list.length && !previews.size) return;
    // copies only frames that were drawn: a skipped one reads as black
    if (!engine.compositor.frame(time)) return;
    // what plays, then each preview that shows something else
    for (const draw of mirrors) draw(output.canvas);
    const own: [string, (source: HTMLCanvasElement) => void][] = [];
    for (const [id, draw] of previews) {
      if (engine.compositor.isMain(id)) draw(output.canvas);
      else own.push([id, draw]);
    }
    for (const [id, draw] of own) if (engine.compositor.drawPreview(id)) draw(output.canvas);
  }, !!engine);

  return (
    <>
      {ids.map((id) => {
        const spec = components.specs[id];
        return spec ? createPortal(<Inline id={id} spec={spec} />, inlineContainers.get(id), id) : null;
      })}
    </>
  );
};
