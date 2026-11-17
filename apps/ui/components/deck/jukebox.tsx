import { useRef } from "react";

import { DeckId } from "@/common/constants/deck.constant";
import { JukeUnitBars, JukeboxGraph } from "@/common/schemas/jukebox.schema";

import { Colors, useCanvas } from "@/hooks/canvas.hook";
import { useDeck, useEngine } from "@/hooks/engine.hook";

type Static = { canvas: HTMLCanvasElement; graph: JukeboxGraph; width: number; height: number; cues: string };

// hue of each deck's colour (green a, rose b)
const DeckHue = { a: 157, b: 323 };

/**
 * A bar's shade in the deck colour: the timbre value the analysis stored as
 * a hue (110–280) becomes lightness, so similar sounding bars share a shade.
 */
const shade = (id: DeckId, timbre: number, alpha = 1) => {
  const t = Math.max(0, Math.min(1, (timbre - 110) / 170));
  return `hsl(${DeckHue[id]} ${60 + t * 25}% ${38 + t * 40}% / ${alpha})`;
};

// the cue colours of the waveform and the cue pads, by slot
// read on each draw: the colours follow the settings
const cueColors = () => [Colors.a, Colors.tan, Colors.gray, Colors.b];

/**
 * The song as the infinite jukebox draws it: loudness bars coloured by
 * timbre, a strip of the hot cues (each one's stretch, up to the next), and
 * below it an arc for every branch.
 * The arcs are drawn once; the cursor and the jumps are redrawn per frame.
 */
export const DeckJukebox = ({ id, className }: { id: DeckId; className?: string }) => {
  const engine = useEngine();
  const deck = useDeck(id);
  const cache = useRef<Static>(undefined);

  const ref = useCanvas((ctx, width, height) => {
    ctx.clearRect(0, 0, width, height);
    const instance = engine?.decks[id];
    const state = instance?.store.get();
    const graph = instance?.graph;
    const pack = state?.pack;
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);

    if (!instance || !state || !pack || !graph?.count) {
      ctx.fillStyle = Colors.dim;
      ctx.font = `${10 * ratio}px "JetBrains Mono", monospace`;
      ctx.textBaseline = "middle";
      const text = !pack
        ? `deck ${id} · empty`
        : state.jukebox.status === "analysing"
          ? `deck ${id} · analysing the song…`
          : state.jukebox.status === "unavailable"
            ? `deck ${id} · no stems, nothing to branch`
            : state.jukebox.status === "failed"
              ? `deck ${id} · analysis failed`
              : `deck ${id}`;
      ctx.fillText(text, 8 * ratio, height / 2);
      return;
    }

    const count = graph.count;
    const pad = 6 * ratio;
    const x = (index: number) => pad + ((index + 0.5) / count) * (width - pad * 2);
    const top = height * 0.5;
    const strip = 10 * ratio;
    // how far an arc dips below the strip: deeper for longer arcs, kept low
    const arcDepth = (x1: number, x2: number) => Math.min((height - top - strip - 2) * 0.6, Math.abs(x2 - x1) * 0.2 + 3 * ratio);

    // static layer: bars, sections and every arc
    let layer = cache.current;
    // cues move live: the strip follows them
    const cues = Object.entries(state.cues)
      .map(([slot, cue]) => ({ slot: Number(slot), bar: cue.bar }))
      .sort((a, b) => a.bar - b.bar);
    const cuesKey = cues.map((cue) => `${cue.slot}@${cue.bar}`).join(",");
    if (!layer || layer.graph !== graph || layer.width !== width || layer.height !== height || layer.cues !== cuesKey) {
      const canvas = layer?.canvas || document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const g = canvas.getContext("2d")!;
      g.clearRect(0, 0, width, height);

      const column = (width - pad * 2) / count;
      for (let index = 0; index < count; index++) {
        const h = Math.max(1, graph.loudness[index] * (top - pad));
        g.fillStyle = shade(id, graph.hue[index]);
        g.fillRect(x(index) - column / 2, top - h, Math.max(1, column - (column > 3 ? 0.5 : 0)), h);
      }

      // the hot cues: each one's stretch of the song, up to the next cue
      const unit = JukeUnitBars[state.jukeUnit];
      const at = (bar: number) => pad + (Math.max(0, Math.min(bar / unit, count)) / count) * (width - pad * 2);
      g.fillStyle = "rgba(255,255,255,0.06)";
      g.fillRect(pad, top + 1, width - pad * 2, strip);
      g.font = `${8 * ratio}px "JetBrains Mono", monospace`;
      g.textBaseline = "middle";
      cues.forEach((cue, index) => {
        const from = at(cue.bar);
        const to = at(cues[index + 1]?.bar ?? count * unit);
        const color = cueColors()[(cue.slot - 1) % 4];
        g.globalAlpha = 0.45;
        g.fillStyle = color;
        g.fillRect(from, top + 1, Math.max(1, to - from - 1), strip);
        g.globalAlpha = 1;
        g.fillRect(from, top + 1, 1.5 * ratio, strip);
        if (to - from > 12 * ratio) {
          g.fillStyle = Colors.paper;
          g.fillText(String(cue.slot), from + 3 * ratio, top + 1 + strip / 2);
        }
      });

      g.lineWidth = 1.2 * ratio;
      for (const [from, to] of graph.edges) {
        const x1 = x(from);
        const x2 = x(to);
        const depth = arcDepth(x1, x2);
        g.strokeStyle = shade(id, graph.hue[from], 0.5);
        g.beginPath();
        g.moveTo(x1, top + strip + 1);
        g.bezierCurveTo(x1, top + strip + depth * 1.33, x2, top + strip + depth * 1.33, x2, top + strip + 1);
        g.stroke();
      }
      layer = { canvas, graph, width, height, cues: cuesKey };
      cache.current = layer;
    }
    ctx.drawImage(layer.canvas, 0, 0);

    // where the song is
    const unit = JukeUnitBars[state.jukeUnit];
    const running = engine!.transport.running;
    const position = running ? instance.songBar() / unit : -state.origin / unit;
    const current = Math.floor(position) % count;
    ctx.fillStyle = Colors.paper;
    ctx.fillRect(x(current) - ratio, 0, 2 * ratio, top + strip);

    // the last jump, bright for a couple of quanta after it landed
    const jump = state.jukebox.lastJump;
    if (jump && running) {
      const age = (engine!.transport.now() - jump.at) / unit;
      if (age > -1 && age < 2) {
        const x1 = x(jump.from);
        const x2 = x(jump.to);
        const depth = arcDepth(x1, x2);
        ctx.strokeStyle = Colors[id];
        ctx.globalAlpha = age < 0 ? 0.5 : 1 - age / 2;
        ctx.lineWidth = 2.5 * ratio;
        if (age < 0) ctx.setLineDash([4 * ratio, 4 * ratio]);
        ctx.beginPath();
        ctx.moveTo(x1, top + strip + 1);
        ctx.bezierCurveTo(x1, top + strip + depth * 1.33, x2, top + strip + depth * 1.33, x2, top + strip + 1);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }

    // an armed or running auto mix: where this song is left or entered
    const mix = engine!.automix.store.get();
    if (mix.plan && (mix.from === id || mix.to === id)) {
      const leaving = mix.from === id;
      const start = (leaving ? mix.plan.exit.bar : mix.plan.entry) / unit;
      const end = start + mix.plan.length / unit;
      ctx.fillStyle = leaving ? "rgba(255,63,180,0.18)" : "rgba(43,232,160,0.18)";
      ctx.fillRect(x(start) - 1, 0, x(end) - x(start), top + strip);
      ctx.fillStyle = leaving ? Colors.b : Colors.a;
      ctx.fillRect(x(start) - ratio, 0, 2 * ratio, top + strip);
      ctx.font = `${9 * ratio}px "JetBrains Mono", monospace`;
      ctx.textBaseline = "top";
      ctx.fillText(leaving ? "out" : "in", x(start) + 3 * ratio, 3 * ratio);
      if (leaving && mix.plan.exit.via) {
        const x1 = x(mix.plan.exit.via.from / unit);
        const x2 = x(mix.plan.exit.via.to / unit);
        const depth = arcDepth(x1, x2);
        ctx.strokeStyle = Colors.b;
        ctx.lineWidth = 2 * ratio;
        ctx.setLineDash([3 * ratio, 3 * ratio]);
        ctx.beginPath();
        ctx.moveTo(x1, top + strip + 1);
        ctx.bezierCurveTo(x1, top + strip + depth * 1.33, x2, top + strip + depth * 1.33, x2, top + strip + 1);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // a forced jump is waiting
    if (state.jukebox.forced) {
      ctx.fillStyle = Colors[id];
      ctx.beginPath();
      ctx.arc(x(current), top + strip + 4 * ratio, 3 * ratio, 0, Math.PI * 2);
      ctx.fill();
    }

    if (!state.infinite) {
      ctx.fillStyle = "rgba(3,5,10,0.55)";
      ctx.fillRect(0, top + strip + 1, width, height - top - strip);
      ctx.fillStyle = Colors.dim;
      ctx.font = `${9 * ratio}px "JetBrains Mono", monospace`;
      ctx.fillText("∞ off — plays straight", 8 * ratio, height - 6 * ratio);
    }
  });

  // redraw the static layer when the graph changes
  void deck.jukebox.arcs;
  return <canvas ref={ref} className={className} />;
};
