import { Pack } from "@/common/schemas/pack.schema";

import type { Voice } from "@/engine/modules/voice/voice.module";

export const barSeconds = (pack: Pack) => (60 / pack.bpm) * pack.timeSignature[0];

/**
 * Where a track sits in the song, in bars. Stems start at the top of the
 * file, which is `gridOffset` seconds before bar 0; cut phrases start
 * exactly on their bar.
 */
export const trackSpan = (pack: Pack, voice: Voice) => {
  const bar = barSeconds(pack);
  const offset = voice.track.type === "stem" ? pack.gridOffset / bar : 0;
  return {
    start: voice.track.bar - offset,
    bars: voice.loaded.buffer.duration / bar
  };
};

// at most this many samples are read per pixel column: enough for a true
// peak when zoomed in, cheap when a whole song is on screen
const MaxReads = 48;

/**
 * Draws the part of a track a view shows, straight from its audio: each
 * column is the loudest sample under it, so zooming in shows real detail.
 * The canvas spans `width` css pixels from `left` (in lane pixels).
 */
export const drawTrackView = (
  ctx: CanvasRenderingContext2D,
  voice: Voice,
  pack: Pack,
  view: { left: number; width: number; pxPerBar: number },
  color: string
) => {
  const { width, height } = ctx.canvas;
  const ratio = width / Math.max(1, view.width);
  const { start, bars } = trackSpan(pack, voice);
  const buffer = voice.loaded.buffer;
  const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, index) => buffer.getChannelData(index));
  const samplesPerBar = buffer.length / bars;
  const middle = height / 2;

  ctx.clearRect(0, 0, width, height);
  // the clip, in canvas pixels
  const toCanvas = (bar: number) => (bar * view.pxPerBar - view.left) * ratio;
  const from = Math.max(0, Math.floor(toCanvas(start)));
  const to = Math.min(width, Math.ceil(toCanvas(start + bars)));
  if (to <= from) return;

  ctx.fillStyle = "rgba(255,255,255,0.035)";
  ctx.fillRect(from, 1, to - from, height - 2);

  ctx.fillStyle = color;
  for (let x = from; x < to; x++) {
    const barAt = (column: number) => (view.left + column / ratio) / view.pxPerBar - start;
    const first = Math.max(0, Math.floor(barAt(x) * samplesPerBar));
    const last = Math.min(buffer.length, Math.max(first + 1, Math.floor(barAt(x + 1) * samplesPerBar)));
    const stride = Math.max(1, Math.floor((last - first) / MaxReads));
    let peak = 0;
    for (const data of channels) {
      for (let index = first; index < last; index += stride) {
        const value = Math.abs(data[index]);
        if (value > peak) peak = value;
      }
    }
    const h = Math.max(1, Math.min(1, peak) * middle * 0.92);
    ctx.fillRect(x, middle - h, 1, h * 2);
  }

  // clip edges, where they are on screen
  ctx.globalAlpha = 0.6;
  if (toCanvas(start) >= 0) ctx.fillRect(from, 0, Math.max(1, ratio), height);
  if (toCanvas(start + bars) <= width) ctx.fillRect(to - Math.max(1, ratio), 0, Math.max(1, ratio), height);
  ctx.globalAlpha = 1;
};
