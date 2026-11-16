import type { Deck } from "@/engine/index";

const cache = new WeakMap<object, Float32Array>();
export const BucketsPerBar = 48;

/**
 * Peaks of everything that plays along the song (stems, and voices of the
 * stem type) merged on a bar grid, so both decks can be drawn bar for bar.
 */
export const songPeaks = (deck: Deck) => {
  const pack = deck.store.get().pack;
  if (!pack) return undefined;

  const tracks = [...deck.stems.values(), ...deck.voices.values()].filter(
    (voice) => voice.track.type === "stem"
  );
  const fallback = [...deck.voices.values()];
  const source = tracks.length ? tracks : fallback.slice(0, 1);
  if (!source.length) return undefined;

  const key = source[0].loaded;
  const cached = cache.get(key);
  if (cached && cached.length === deck.songBars * BucketsPerBar * 2) return cached;

  const bars = deck.songBars;
  const peaks = new Float32Array(bars * BucketsPerBar * 2);
  const bar = (60 / pack.bpm) * pack.timeSignature[0];

  for (const voice of source) {
    const { peaks: trackPeaks, buffer } = voice.loaded;
    const buckets = trackPeaks.length / 2;
    const offset = voice.track.type === "stem" ? pack.gridOffset + 0 : 0;

    for (let i = 0; i < bars * BucketsPerBar; i++) {
      const position = i / BucketsPerBar - (voice.track.bar || 0);
      const seconds = offset + position * bar;
      if (seconds < 0 || seconds >= buffer.duration) continue;
      const index = Math.floor((seconds / buffer.duration) * buckets);
      peaks[i * 2] = Math.min(peaks[i * 2], trackPeaks[index * 2]);
      peaks[i * 2 + 1] = Math.max(peaks[i * 2 + 1], trackPeaks[index * 2 + 1]);
    }
  }

  cache.set(key, peaks);
  return peaks;
};
