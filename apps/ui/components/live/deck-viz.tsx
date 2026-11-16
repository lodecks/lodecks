import { useRef } from "react";

import { DeckId } from "@/common/constants/deck.constant";
import type { Steps } from "@/engine/modules/deck/steps.module";

import { Colors, useCanvas } from "@/hooks/canvas.hook";
import { useDeck, useEngine } from "@/hooks/engine.hook";
import { useFrame } from "@/hooks/frame.hook";
import { cn } from "~/utils/classes.util";

/** The animated deck views: deck("a").show("rain") and friends */
export const DeckVizViews = ["punch", "rain", "barcode", "stairs", "eq", "ring", "sections"] as const;
export type DeckVizView = (typeof DeckVizViews)[number];

const PerBar = 16;
const Labels: Record<string, string> = { drums: "drm", bass: "bas", other: "oth", vocals: "vox" };

const rgba = (hex: string, alpha: number) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
};

const at = (values: Float32Array, step: number) => {
  const count = values.length;
  return values[((Math.floor(step) % count) + count) % count] ?? 0;
};

type Frame = {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  steps: Steps;
  // song position in steps, fractional
  step: number;
  color: string;
  playing: boolean;
  // state kept between frames, per view
  memory: Record<string, number[]>;
  cues: { bar: number; slot: number }[];
  sections: { name: string; bar: number; bars: number }[];
};

const White = "#eef3ff";

// —— punch: Strudel-like punchcard, cells sliding past the playhead ——
const punch = ({ ctx, width, height, steps, step, color }: Frame) => {
  const window = 64;
  const cell = width / window;
  const rows = steps.rows;
  const rowH = height / Math.max(1, rows.length);
  const size = Math.max(2, Math.min(cell - 2, rowH - 4));
  const playX = width * 0.5;
  const now = Math.floor(step);
  for (let k = -window / 2 - 1; k <= window / 2 + 1; k++) {
    const s = now + k;
    const x = playX + (s - step) * cell;
    if (s % PerBar === 0) {
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(Math.round(x), 0, 1, height);
    }
    rows.forEach((row, index) => {
      const v = at(row.hits, s);
      if (v < 0.35) return;
      const big = v > 0.62;
      const side = big ? size : size * 0.5;
      const y = index * rowH + (rowH - side) / 2;
      const past = s < now;
      ctx.fillStyle = s === now ? color : rgba(White, (big ? 0.92 : 0.4) * (past ? 0.45 : 1));
      ctx.fillRect(Math.round(x + (cell - side) / 2), Math.round(y), Math.ceil(side), Math.ceil(side));
    });
  }
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(playX), 0, 1.5, height);
};

// —— rain: notes falling down lanes onto a hit line ——
const rain = ({ ctx, width, height, steps, step, color }: Frame) => {
  const rows = steps.rows;
  const lane = width / Math.max(1, rows.length);
  const hitY = height * 0.82;
  const ahead = 32;
  const px = hitY / ahead;
  const now = Math.floor(step);
  rows.forEach((row, index) => {
    const centre = index * lane + lane / 2;
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(Math.round(index * lane + lane * 0.15), 0, Math.round(lane * 0.7), height);
    for (let k = -6; k <= ahead + 1; k++) {
      const s = now + k;
      const v = at(row.hits, s);
      if (v < 0.45) continue;
      const y = hitY - (s - step) * px;
      const w = lane * 0.6 * (0.45 + 0.55 * v);
      const past = s < step;
      ctx.fillStyle = past ? rgba(color, 0.5 * (1 + (s - step) / 6)) : rgba(White, 0.35 + 0.6 * v);
      ctx.fillRect(Math.round(centre - w / 2), Math.round(y - px + 1), Math.round(w), Math.max(1, Math.round(px - 2)));
    }
    // the lane lights up with what is playing now
    const live = at(row.values, step);
    ctx.fillStyle = rgba(color, live * 0.9);
    ctx.fillRect(Math.round(index * lane + lane * 0.12), Math.round(hitY - 2), Math.round(lane * 0.76), 5);
    ctx.fillStyle = "rgba(238,243,255,0.45)";
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = "center";
    ctx.fillText(Labels[row.layer] ?? row.layer, centre, height - 4);
  });
  ctx.fillStyle = rgba(color, 0.6);
  ctx.fillRect(0, Math.round(hitY + 3), width, 1);
  ctx.textAlign = "start";
};

// —— barcode: thin lines, one strip per layer ——
const barcode = ({ ctx, width, height, steps, step, color }: Frame) => {
  const window = 128;
  const px = width / window;
  const rows = steps.rows;
  const rowH = height / Math.max(1, rows.length);
  const playX = width / 3;
  const now = Math.floor(step);
  rows.forEach((row, index) => {
    const top = index * rowH + 3;
    for (let k = -Math.ceil(window / 3) - 1; k <= Math.ceil((window * 2) / 3) + 1; k++) {
      const s = now + k;
      const v = at(row.hits, s);
      if (v < 0.12) continue;
      const x = playX + (s - step) * px;
      ctx.fillStyle = s === now ? color : rgba(White, Math.pow(v, 1.4) * (s < now ? 0.45 : 0.9));
      ctx.fillRect(Math.round(x), top, Math.max(1, px * 0.55), rowH - 6);
    }
  });
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(playX), 0, 1.5, height);
};

// —— stairs: one block per beat, its height the bass (or harmony) level ——
const stairs = ({ ctx, width, height, steps, step, color }: Frame) => {
  const beats = 32;
  // the layer with the most going on around here
  const around = (values: Float32Array) => {
    let sum = 0;
    for (let k = -beats * 2; k < beats * 2; k++) sum += at(values, step + k);
    return sum;
  };
  const row = [...steps.rows].sort((a, b) => around(b.values) - around(a.values))[0];
  const beatW = width / beats;
  const levels = 6;
  const blockH = height / (levels + 1);
  const beatNow = step / 4;
  const playX = width * 0.4;
  for (let k = -Math.ceil(beats * 0.4) - 1; k <= Math.ceil(beats * 0.6) + 1; k++) {
    const beat = Math.floor(beatNow) + k;
    let sum = 0;
    for (let i = 0; i < 4; i++) sum += at(row.values, beat * 4 + i);
    const level = Math.round((sum / 4) * (levels - 1));
    if (level <= 0) continue;
    const x = playX + (beat - beatNow) * beatW;
    const y = height - (level + 1) * blockH;
    const current = beat === Math.floor(beatNow);
    ctx.fillStyle = current ? color : rgba(White, beat < beatNow ? 0.28 : 0.55);
    ctx.fillRect(Math.round(x) + 1, Math.round(y), Math.ceil(beatW) - 1, Math.round(blockH * 0.8));
  }
  ctx.strokeStyle = rgba(White, 0.6);
  ctx.strokeRect(Math.round(playX) + 0.5, 0.5, Math.round(beatW), height - 1);
};

// —— eq: a meter per layer, bouncing with the song, peaks held ——
const eq = ({ ctx, width, height, steps, step, color, memory }: Frame) => {
  const rows = steps.rows;
  const segments = 14;
  const gap = 2;
  const barW = Math.min(64, width / (rows.length * 1.8));
  const total = rows.length * barW + (rows.length - 1) * barW * 0.8;
  const left = (width - total) / 2;
  const level = (memory.level ??= rows.map(() => 0));
  const peak = (memory.peak ??= rows.map(() => 0));
  const segH = (height - 16) / segments;
  rows.forEach((row, index) => {
    // between steps, the level eases towards the next one
    const target = at(row.values, step) * (1 - (step % 1)) + at(row.values, step + 1) * (step % 1);
    level[index] += (target - level[index]) * 0.35;
    peak[index] = Math.max(peak[index] - 0.01, level[index]);
    const x = left + index * barW * 1.8;
    const lit = Math.round(level[index] * segments);
    for (let segment = 0; segment < segments; segment++) {
      const y = height - 16 - (segment + 1) * segH;
      const on = segment < lit;
      ctx.fillStyle = on ? (segment >= segments - 3 ? color : rgba(White, 0.85)) : "rgba(255,255,255,0.06)";
      ctx.fillRect(Math.round(x), Math.round(y + gap / 2), Math.round(barW), Math.round(segH - gap));
    }
    const peakY = height - 16 - Math.max(1, Math.round(peak[index] * segments)) * segH;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(peakY), Math.round(barW), 2);
    ctx.fillStyle = "rgba(238,243,255,0.45)";
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = "center";
    ctx.fillText(Labels[row.layer] ?? row.layer, x + barW / 2, height - 3);
  });
  ctx.textAlign = "start";
};

// —— ring: this bar's 16 steps around a circle, one ring per layer ——
const ring = ({ ctx, width, height, steps, step, color }: Frame) => {
  const rows = steps.rows;
  const cx = width / 2;
  const cy = height / 2;
  const outer = height / 2 - 4;
  const inner = outer * 0.3;
  const band = (outer - inner) / Math.max(1, rows.length);
  const barStart = Math.floor(step / PerBar) * PerBar;
  const now = Math.floor(step);
  const slice = (Math.PI * 2) / PerBar;
  rows.forEach((row, index) => {
    const radius = inner + band * (index + 0.5);
    for (let i = 0; i < PerBar; i++) {
      const s = barStart + i;
      const v = at(row.hits, s);
      const start = -Math.PI / 2 + i * slice + 0.04;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, start, start + slice - 0.08);
      ctx.lineWidth = band * 0.7;
      ctx.strokeStyle = s === now ? color : rgba(White, v < 0.3 ? 0.06 : 0.25 + 0.7 * v * (s < now ? 0.6 : 1));
      ctx.stroke();
    }
  });
  // the hand, at the current step
  const angle = -Math.PI / 2 + ((step - barStart) / PerBar) * Math.PI * 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(angle) * inner * 0.6, cy + Math.sin(angle) * inner * 0.6);
  ctx.lineTo(cx + Math.cos(angle) * (outer + 2), cy + Math.sin(angle) * (outer + 2));
  ctx.stroke();
  ctx.fillStyle = rgba(White, 0.85);
  ctx.font = '11px "JetBrains Mono", monospace';
  ctx.textAlign = "center";
  ctx.fillText(String(Math.floor(step / PerBar) + 1), cx, cy + 4);
  ctx.textAlign = "start";
};

// —— sections: the whole song, its parts, cues and where it is ——
const sections = ({ ctx, width, height, steps, step, color, cues, sections: parts }: Frame) => {
  const bars = steps.bars;
  const barW = width / bars;
  const top = 14;
  const area = height - top;
  parts.forEach((part, index) => {
    ctx.fillStyle = index % 2 ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.06)";
    ctx.fillRect(Math.round(part.bar * barW), top, Math.round(part.bars * barW), area);
    ctx.fillStyle = "rgba(238,243,255,0.5)";
    ctx.font = '10px "JetBrains Mono", monospace';
    if (part.bars * barW > 30) ctx.fillText(part.name, Math.round(part.bar * barW) + 3, 10);
  });
  const nowBar = step / PerBar;
  for (let b = 0; b < bars; b++) {
    let sum = 0;
    for (let i = 0; i < PerBar; i++) sum += steps.energy[b * PerBar + i] ?? 0;
    const v = sum / PerBar;
    const h = Math.max(1, v * area * 0.95);
    ctx.fillStyle = b < Math.floor(nowBar) ? rgba(color, 0.55) : rgba(White, 0.25 + 0.6 * v);
    ctx.fillRect(Math.round(b * barW), Math.round(height - h), Math.max(1, Math.ceil(barW) - 1), Math.round(h));
  }
  for (const cue of cues) {
    const x = cue.bar * barW;
    ctx.fillStyle = Colors.warn;
    ctx.beginPath();
    ctx.moveTo(x - 4, top);
    ctx.lineTo(x + 4, top);
    ctx.lineTo(x, top + 6);
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(nowBar * barW), top, 2, area);
};

const Draw: Record<DeckVizView, (frame: Frame) => void> = { punch, rain, barcode, stairs, eq, ring, sections };

const heightOf = (view: DeckVizView, rows: number) => {
  switch (view) {
    case "punch":
      return Math.max(1, rows) * 18 + 4;
    case "barcode":
      return Math.max(1, rows) * 16 + 4;
    case "rain":
      return 170;
    case "stairs":
      return 84;
    case "eq":
      return 130;
    case "ring":
      return 170;
    case "sections":
      return 70;
  }
};

/** One of the animated deck views, moving with the song */
export const DeckViz = ({ id, view }: { id: DeckId; view: DeckVizView }) => {
  const engine = useEngine();
  const deck = useDeck(id);
  const memory = useRef<Record<string, number[]>>({});
  const info = useRef<HTMLSpanElement>(null);
  const instance = engine?.decks[id];
  const rows = instance?.steps()?.rows.length ?? 4;

  const ref = useCanvas((ctx, width, height) => {
    ctx.clearRect(0, 0, width, height);
    const steps = instance?.steps();
    if (!steps || !engine) {
      ctx.fillStyle = "rgba(238,243,255,0.4)";
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.fillText(deck.loading ? "loading…" : "no pack on this deck", 4, 14);
      return;
    }
    // the song position, fractional: the views slide with it
    const bar = instance!.songBar();
    Draw[view]({
      ctx,
      width,
      height,
      steps,
      step: bar * PerBar,
      color: id === "a" ? Colors.a : Colors.b,
      playing: instance!.songPlaying(),
      memory: memory.current,
      cues: Object.entries(deck.cues).map(([slot, cue]) => ({ slot: Number(slot), bar: cue.bar })),
      sections: deck.pack?.sections ?? []
    });
  });

  useFrame(() => {
    if (!info.current || !instance || !deck.pack) return;
    info.current.textContent = `bar ${Math.floor(instance.songBar()) + 1}`;
  }, !!engine);

  return (
    <div data-deck={id} className="flex w-full max-w-[880px] flex-col gap-1.5">
      <div className="flex items-baseline gap-2 text-[12px]">
        <span className={cn("font-mono uppercase", id === "a" ? "text-deck-a" : "text-deck-b")}>deck {id}</span>
        <span className="text-bright truncate">{deck.pack ? deck.pack.title : "empty"}</span>
        <span className="legend !text-[8px]">{view}</span>
        <span ref={info} className="text-dim ml-auto font-mono text-[11px] tabular-nums" />
      </div>
      <canvas
        ref={ref}
        className={cn(view === "ring" ? "aspect-square self-start" : "w-full")}
        style={{ height: heightOf(view, rows), width: view === "ring" ? heightOf(view, rows) : undefined }}
      />
    </div>
  );
};
