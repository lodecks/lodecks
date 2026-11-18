import { DeckId } from "@/common/constants/deck.constant";

import { Colors, useCanvas } from "@/hooks/canvas.hook";
import { useEngine } from "@/hooks/engine.hook";
import { BucketsPerBar, songPeaks } from "@/utils/waveform.util";

type WaveformProps = {
  id: DeckId;
  // bars shown around the playhead; the whole song when omitted
  window?: number;
  className?: string;
  // clicking jumps there (whole song view only)
  seek?: boolean;
};

// read on each draw: the colours follow the settings
const cueColors = () => [Colors.a, Colors.tan, Colors.gray, Colors.b];

// each song's loudest peak, so the cells use their whole height
const loudest = new WeakMap<Float32Array, number>();
const loudestOf = (peaks: Float32Array) => {
  let max = loudest.get(peaks);
  if (max === undefined) {
    max = 0;
    for (let index = 0; index < peaks.length; index++) max = Math.max(max, Math.abs(peaks[index]));
    loudest.set(peaks, max || 1);
  }
  return max || 1;
};

/**
 * Song waveform drawn like a sample editor screen: warm white wave on
 * black, the part already played dimmed, cues as coloured markers with
 * caps top and bottom, the loop as a grey band. Zoomed in (`window`),
 * it becomes columns of square cells, one per 16th, like an led meter.
 */
export const DeckWaveform = ({ id, window, className, seek }: WaveformProps) => {
  const engine = useEngine();

  const ref = useCanvas((ctx, width, height) => {
    ctx.clearRect(0, 0, width, height);
    const deck = engine?.decks[id];
    const state = deck?.store.get();
    const peaks = deck && state?.pack && !state.loading ? songPeaks(deck) : undefined;
    const middle = height / 2;
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);

    // the centre line, where there is no square grid to read it from
    if (!window) {
      ctx.fillStyle = Colors.line;
      ctx.fillRect(0, Math.round(middle), width, ratio);
    }
    if (!deck || !state?.pack || !peaks) return;

    const bars = deck.songBars;
    const position = deck.songBar();
    const span = window || bars;
    const from = window ? position - span / 2 : 0;
    const x = (bar: number) => ((bar - from) / span) * width;

    // bar ticks along the bottom edge, taller every 4
    for (let bar = Math.ceil(from); bar <= from + span; bar++) {
      if (span > 32 && bar % 4) continue;
      const tall = bar % 4 === 0;
      ctx.fillStyle = tall ? "#4a4d54" : "#2b2d32";
      ctx.fillRect(Math.round(x(bar)), height - (tall ? 6 : 3) * ratio, ratio, (tall ? 6 : 3) * ratio);
    }

    // loop band
    const loop = state.loop;
    if (loop) {
      ctx.fillStyle = loop.active ? "rgba(169,173,180,0.22)" : "rgba(169,173,180,0.08)";
      ctx.fillRect(x(loop.start), 0, x(loop.start + loop.bars) - x(loop.start), height);
    }

    // the wave, wrapped so the song repeats in the window
    const total = bars * BucketsPerBar;
    const peakAt = (index: number) => {
      const wrapped = ((index % total) + total) % total;
      return Math.max(Math.abs(peaks[wrapped * 2]), peaks[wrapped * 2 + 1]);
    };
    if (window) {
      // zoomed in: a column of square cells per 16th, like an led meter
      const steps = Math.round(span * 16);
      const pitch = width / steps;
      // six cells each way from the middle, square, never wider than a 16th
      const rows = 6;
      const slot = middle / rows;
      const cell = Math.max(2 * ratio, Math.floor(Math.min(slot * 0.74, pitch * 0.72)));
      const gap = Math.max(ratio, Math.floor(slot - cell));
      const per = BucketsPerBar / 16;
      const top = loudestOf(peaks);
      const first = Math.floor(from * 16);
      for (let step = first; step <= first + steps; step++) {
        const left = x(step / 16) + (pitch - cell) / 2;
        if (left + cell < 0 || left > width) continue;
        // the loudest moment in this 16th
        let amp = 0;
        const start = Math.floor((step / 16) * BucketsPerBar);
        for (let bucket = start; bucket < start + Math.max(1, per); bucket++) amp = Math.max(amp, peakAt(bucket));
        // a curve, so quiet parts sit clearly lower than loud ones
        const lit = Math.max(1, Math.round(Math.pow(Math.min(1, amp / top), 1.25) * rows));
        const now = step / 16 <= position && position < (step + 1) / 16;
        ctx.fillStyle = now ? Colors[id] : step / 16 < position ? "#3d4048" : Colors.paper;
        for (let row = 0; row < lit; row++) {
          const offset = gap / 2 + row * (cell + gap);
          ctx.fillRect(Math.round(left), Math.round(middle - offset - cell), cell, cell);
          ctx.fillRect(Math.round(left), Math.round(middle + offset), cell, cell);
        }
      }
    } else {
      const columns = Math.min(width, 1400);
      const columnWidth = width / columns;
      for (let column = 0; column < columns; column++) {
        const bar = from + (column / columns) * span;
        const amp = peakAt(Math.floor(bar * BucketsPerBar));
        ctx.fillStyle = bar < position ? "#55585e" : Colors.paper;
        const h = Math.max(ratio, amp * middle * 0.9);
        ctx.fillRect(column * columnWidth, middle - h, Math.max(1, columnWidth), h * 2);
      }
    }

    // cues: a line with caps, numbered, coloured in turn
    ctx.font = `500 ${Math.round(9 * ratio)}px "JetBrains Mono Variable", monospace`;
    ctx.textBaseline = "top";
    for (const [slot, cue] of Object.entries(state.cues)) {
      const color = cueColors()[(Number(slot) - 1) % 4];
      for (let offset = -bars; offset <= bars; offset += bars) {
        const cx = Math.round(x(cue.bar + offset));
        if (cx < -10 || cx > width + 10) continue;
        ctx.fillStyle = color;
        ctx.fillRect(cx - ratio / 2, 0, ratio * 1.2, height);
        ctx.fillRect(cx - 5 * ratio, 0, 10 * ratio, 2.5 * ratio);
        ctx.fillRect(cx - 5 * ratio, height - 2.5 * ratio, 10 * ratio, 2.5 * ratio);
        ctx.fillText(slot, cx + 3 * ratio, 4 * ratio);
      }
    }

    // playhead
    const px = Math.round(x(position));
    ctx.fillStyle = Colors.b;
    ctx.fillRect(px - ratio, 0, ratio * 2, height);
  });

  return (
    <canvas
      ref={ref}
      className={className}
      onMouseDown={(event) => {
        if (!seek || !engine) return;
        const deck = engine.decks[id];
        if (!deck.store.get().pack) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const bar = Math.floor(((event.clientX - rect.left) / rect.width) * deck.songBars);
        deck.jump(bar);
      }}
    />
  );
};
