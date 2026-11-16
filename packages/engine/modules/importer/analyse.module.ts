/**
 * The song's analysis (once a port of a Python script): finds the grid, key and
 * sections of a song and cuts it into pack material. Pure functions on
 * mono Float32Arrays at 44.1 kHz, so it runs in a worker (and in tests).
 * librosa's mel / CQT features are replaced by plain FFT ones, so numbers
 * differ a little; the steps and thresholds are the same.
 */
import type { Analysis } from "@/common/utils/build-pack.util";

export const SR = 44100;
const Size = 2048;
const Hop = 512;

// Krumhansl-Schmuckler key profiles
const Major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const Minor = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const Names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// —— spectra ——

/** In-place radix-2 FFT of (re, im) */
export const fft = (re: Float64Array, im: Float64Array) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < n; start += length) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < length / 2; k++) {
        const a = start + k;
        const b = a + length / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
};

const hann = (() => {
  const window = new Float64Array(Size);
  for (let i = 0; i < Size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Size);
  return window;
})();

/** Magnitude spectrum (Size/2 bins) of the frame starting at `start` */
export const spectrum = (audio: Float32Array, start: number, out = new Float64Array(Size / 2)) => {
  const re = new Float64Array(Size);
  const im = new Float64Array(Size);
  for (let i = 0; i < Size; i++) re[i] = (audio[start + i] ?? 0) * hann[i];
  fft(re, im);
  for (let k = 0; k < Size / 2; k++) out[k] = Math.hypot(re[k], im[k]);
  return out;
};

const frames = (audio: Float32Array) => Math.max(1, Math.floor(audio.length / Hop) + 1);

// log-spaced bands for the onset envelope, like a small mel scale
const Bands = (() => {
  const edges: number[] = [];
  const count = 48;
  for (let i = 0; i <= count; i++) {
    const hz = 30 * Math.pow(11000 / 30, i / count);
    edges.push(Math.max(1, Math.round((hz / SR) * Size)));
  }
  return edges;
})();

/** Onset strength per frame: positive change in log band energy */
export const onsetEnvelope = (audio: Float32Array) => {
  const count = frames(audio);
  const envelope = new Float64Array(count);
  const bins = new Float64Array(Size / 2);
  let previous: Float64Array | undefined;
  for (let frame = 0; frame < count; frame++) {
    // centred on the frame's time, as librosa does
    spectrum(audio, frame * Hop - Size / 2, bins);
    const bands = new Float64Array(Bands.length - 1);
    for (let band = 0; band < bands.length; band++) {
      let sum = 0;
      for (let k = Bands[band]; k < Math.max(Bands[band] + 1, Bands[band + 1]); k++) sum += bins[k] * bins[k];
      bands[band] = 10 * Math.log10(sum + 1e-10);
    }
    if (previous) {
      let flux = 0;
      for (let band = 0; band < bands.length; band++) flux += Math.max(0, bands[band] - previous[band]);
      envelope[frame] = flux / bands.length;
    }
    previous = bands;
  }
  return envelope;
};

const frameTime = (frame: number) => (frame * Hop) / SR;

// —— grid ——

/** Tempo from the envelope's autocorrelation, leaning towards ~120 */
export const estimateTempo = (envelope: Float64Array, hint?: number) => {
  const fps = SR / Hop;
  const minLag = Math.floor((fps * 60) / 200);
  const maxLag = Math.ceil((fps * 60) / 60);
  const centre = hint ?? 120;
  let best = { lag: Math.round((fps * 60) / centre), score: -Infinity };
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = lag; i < envelope.length; i++) sum += envelope[i] * envelope[i - lag];
    const bpm = (fps * 60) / lag;
    // log-normal prior around the centre, an octave wide (as librosa)
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / centre), 2));
    const score = (sum / (envelope.length - lag)) * prior;
    if (score > best.score) best = { lag, score };
  }
  return (fps * 60) / best.lag;
};

/** Beat frames by dynamic programming (Ellis 2007, as librosa.beat_track) */
export const trackBeats = (envelope: Float64Array, bpm: number) => {
  const fps = SR / Hop;
  const period = (fps * 60) / bpm;
  const deviation = Math.sqrt(envelope.reduce((sum, value) => sum + value * value, 0) / envelope.length) || 1;
  const local = envelope.map((value) => value / deviation);
  const score = new Float64Array(envelope.length);
  const back = new Int32Array(envelope.length).fill(-1);
  const tightness = 100;
  for (let t = 0; t < envelope.length; t++) {
    let best = -Infinity;
    let from = -1;
    for (let prev = Math.max(0, Math.round(t - 2 * period)); prev <= t - Math.round(period / 2); prev++) {
      const penalty = -tightness * Math.pow(Math.log((t - prev) / period), 2);
      const candidate = score[prev] + penalty;
      if (candidate > best) {
        best = candidate;
        from = prev;
      }
    }
    score[t] = local[t] + (from >= 0 ? Math.max(0, best) : 0);
    back[t] = from >= 0 && best > 0 ? from : -1;
  }
  // end on the best of the last period's scores
  let end = envelope.length - 1;
  for (let t = Math.max(0, envelope.length - Math.round(period)); t < envelope.length; t++) {
    if (score[t] > score[end]) end = t;
  }
  const beats: number[] = [];
  for (let t = end; t >= 0; t = back[t]) {
    beats.push(t);
    if (back[t] < 0) break;
  }
  return beats.reverse();
};

/** bpm, the time of bar 0, and the raw tracker tempo */
export const grid = (mix: Float32Array, drums: Float32Array | undefined, hint?: number) => {
  const peak = (audio: Float32Array) => audio.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  const source = drums && peak(drums) > 0.01 ? drums : mix;
  const envelope = onsetEnvelope(source);
  const tracked = estimateTempo(envelope, hint);
  const beats = trackBeats(envelope, hint ?? tracked).map(frameTime);
  if (beats.length < 8) throw new Error("not enough beats found — set the bpm by hand");

  // a straight line through the beats is steadier than the tracker
  const n = beats.length;
  const meanX = (n - 1) / 2;
  const meanY = beats.reduce((sum, value) => sum + value, 0) / n;
  let cov = 0;
  let varX = 0;
  beats.forEach((time, index) => {
    cov += (index - meanX) * (time - meanY);
    varX += (index - meanX) ** 2;
  });
  const slope = cov / varX;
  const intercept = meanY - slope * meanX;
  let bpm = hint ?? 60 / slope;
  if (!hint && Math.abs(Math.round(bpm) - bpm) < 0.15) bpm = Math.round(bpm);
  const beat = 60 / bpm;
  const first = ((intercept % beat) + beat) % beat;

  // the downbeat is the beat phase with the most low end on it
  const low = new Float32Array(source.length);
  for (let i = 0; i < source.length; i++) low[i] = source[i] + 0.97 * (source[i - 1] ?? 0);
  const lowEnvelope = onsetEnvelope(low);
  const end = frameTime(lowEnvelope.length - 1);
  const at = (time: number) => {
    const position = (time * SR) / Hop;
    const index = Math.floor(position);
    const fraction = position - index;
    return (lowEnvelope[index] ?? 0) * (1 - fraction) + (lowEnvelope[index + 1] ?? 0) * fraction;
  };
  const scores = [0, 1, 2, 3].map((phase) => {
    let sum = 0;
    for (let time = first + phase * beat; time < end; time += beat * 4) sum += at(time);
    return sum;
  });
  const phase = scores.indexOf(Math.max(...scores));
  const offset = (first + phase * beat) % (beat * 4);
  return { bpm, offset, tracked };
};

// —— key ——

// the key needs finer bins than the onsets: at 2048 points the bass
// notes (55–200 Hz) fall between pitch classes
const KeySize = 8192;

const keyWindow = (() => {
  const window = new Float64Array(KeySize);
  for (let i = 0; i < KeySize; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / KeySize);
  return window;
})();

const keyClass = (() => {
  const classes = new Int8Array(KeySize / 2).fill(-1);
  for (let k = 1; k < KeySize / 2; k++) {
    const hz = (k * SR) / KeySize;
    if (hz < 55 || hz > 5000) continue;
    classes[k] = ((Math.round(12 * Math.log2(hz / 440) + 69) % 12) + 12) % 12;
  }
  return classes;
})();

/** Average 12-bin chroma, from long frames; `step` skips frames to save time */
export const chroma = (audio: Float32Array, step = 1) => {
  const sums = new Float64Array(12);
  const re = new Float64Array(KeySize);
  const im = new Float64Array(KeySize);
  const hop = KeySize / 2;
  for (let start = 0; start + KeySize <= Math.max(audio.length, KeySize); start += hop * step) {
    im.fill(0);
    for (let i = 0; i < KeySize; i++) re[i] = (audio[start + i] ?? 0) * keyWindow[i];
    fft(re, im);
    for (let k = 1; k < KeySize / 2; k++) if (keyClass[k] >= 0) sums[keyClass[k]] += Math.hypot(re[k], im[k]);
  }
  return sums;
};

const pitchClass = (() => {
  const classes = new Int8Array(Size / 2).fill(-1);
  for (let k = 1; k < Size / 2; k++) {
    const hz = (k * SR) / Size;
    if (hz < 55 || hz > 5000) continue;
    classes[k] = ((Math.round(12 * Math.log2(hz / 440) + 69) % 12) + 12) % 12;
  }
  return classes;
})();

const addChroma = (bins: Float64Array, sums: Float64Array) => {
  for (let k = 0; k < bins.length; k++) if (pitchClass[k] >= 0) sums[pitchClass[k]] += bins[k];
};

const correlation = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  const n = Math.min(a.length, b.length);
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return va && vb ? cov / Math.sqrt(va * vb) : 0;
};

export const detectKey = (profile: ArrayLike<number>) => {
  let best = { score: -2, name: "C" };
  for (let root = 0; root < 12; root++) {
    for (const [weights, suffix] of [[Major, ""], [Minor, "m"]] as const) {
      const rolled = weights.map((_, index) => weights[(index - root + 12) % 12]);
      const score = correlation(rolled, profile);
      if (score > best.score) best = { score, name: `${Names[root]}${suffix}` };
    }
  }
  return best.name;
};

// —— bars and sections ——

export const barRms = (audio: Float32Array, offset: number, bar: number, bars: number) => {
  const values = new Float64Array(bars);
  for (let index = 0; index < bars; index++) {
    const start = Math.floor((offset + index * bar) * SR);
    const end = Math.min(audio.length, Math.floor((offset + (index + 1) * bar) * SR));
    let sum = 0;
    for (let i = start; i < end; i++) sum += audio[i] * audio[i];
    values[index] = end > start ? Math.sqrt(sum / (end - start)) : 0;
  }
  return values;
};

const mean = (values: ArrayLike<number>, from = 0, to = values.length) => {
  let sum = 0;
  let count = 0;
  for (let i = from; i < Math.min(to, values.length); i++) {
    sum += values[i];
    count++;
  }
  return count ? sum / count : 0;
};

/** Splits the song where the 4 bar energy changes, on 4 bar lines */
export const sections = (energy: Float64Array) => {
  const blocks: number[] = [];
  for (let i = 0; i < energy.length; i += 4) blocks.push(mean(energy, i, i + 4));
  if (!blocks.length) return [];
  const peak = Math.max(...blocks) || 1;
  const levels = blocks.map((value) => Math.round((3 * value) / peak));

  const found: [number, number, number][] = [];
  let start = 0;
  for (let index = 1; index <= levels.length; index++) {
    if (index === levels.length || levels[index] !== levels[start]) {
      found.push([start * 4, (index - start) * 4, levels[start]]);
      start = index;
    }
  }
  const counts: Record<string, number> = {};
  return found.map(([bar, length, level], position) => {
    const base =
      position === 0 && level < 2
        ? "intro"
        : position === found.length - 1 && level < 2
          ? "outro"
          : ["break", "build", "verse", "drop"][Math.min(3, level)];
    counts[base] = (counts[base] ?? 0) + 1;
    return { name: counts[base] === 1 ? base : `${base} ${counts[base]}`, bar, bars: Math.min(length, energy.length - bar) };
  });
};

export const cut = (audio: Float32Array, offset: number, bar: number, start: number, bars: number) => {
  const begin = Math.floor((offset + start * bar) * SR);
  const length = Math.floor(bars * bar * SR);
  const chunk = new Float32Array(length);
  chunk.set(audio.subarray(Math.max(0, begin), Math.max(0, Math.min(audio.length, begin + length))), Math.max(0, -begin));
  return chunk;
};

export const fade = (audio: Float32Array, ms = 4) => {
  const n = Math.min(Math.floor(audio.length / 2), Math.floor((SR * ms) / 1000));
  const out = audio.slice();
  for (let i = 0; i < n; i++) {
    const gain = i / Math.max(1, n - 1);
    out[i] *= gain;
    out[out.length - 1 - i] *= gain;
  }
  return out;
};

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  const position = ((sorted.length - 1) * p) / 100;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
};

/** Vocal phrases: runs of sung bars, cut into 1, 2, 4 or 8 bar pieces */
export const phrases = (energy: Float64Array) => {
  const sung = [...energy].filter((value) => value > 0);
  if (!sung.length) return [];
  const threshold = Math.max(0.015, percentile(sung, 40) * 0.6);
  const pieces: [number, number, number][] = [];
  let index = 0;
  while (index < energy.length) {
    if (energy[index] <= threshold) {
      index++;
      continue;
    }
    const start = index;
    while (index < energy.length && energy[index] > threshold) index++;
    let position = start;
    let remaining = index - start;
    while (remaining > 0) {
      const size = [8, 4, 2, 1].find((value) => value <= remaining)!;
      pieces.push([position, size, mean(energy, position, position + size)]);
      position += size;
      remaining -= size;
    }
  }
  return pieces;
};

/** Chroma over time, flattened like librosa's (pitch-major), for comparing */
const chromaSequence = (audio: Float32Array) => {
  const count = frames(audio);
  const out = new Float64Array(12 * count);
  const bins = new Float64Array(Size / 2);
  const sums = new Float64Array(12);
  for (let frame = 0; frame < count; frame++) {
    spectrum(audio, frame * Hop, bins);
    sums.fill(0);
    addChroma(bins, sums);
    const max = Math.max(...sums) || 1;
    for (let pitch = 0; pitch < 12; pitch++) out[pitch * count + frame] = sums[pitch] / max;
  }
  return out;
};

/** Repeated choruses are not worth two pads */
export const similar = (a: Float64Array, b: Float64Array) => a.length === b.length && correlation(a, b) > 0.93;

// —— the whole analysis ——

export type AnalyseInput = {
  mix: Float32Array;
  // mono stems by name: drums, bass, other, vocals
  stems: Record<string, Float32Array>;
  bpm?: number;
  key?: string;
};

export type AnalyseResult = {
  analysis: Analysis;
  // audio for every file the analysis names, mono 44.1 kHz
  files: Record<string, Float32Array>;
};

const peakOf = (audio?: Float32Array) => (audio ? audio.reduce((max, value) => Math.max(max, Math.abs(value)), 0) : 0);

const sum = (parts: (Float32Array | undefined)[]) => {
  const present = parts.filter(Boolean) as Float32Array[];
  if (!present.length) return undefined;
  const out = new Float32Array(Math.max(...present.map((part) => part.length)));
  for (const part of present) for (let i = 0; i < part.length; i++) out[i] += part[i];
  return out;
};

export const analyse = (input: AnalyseInput, log: (message: string) => void = () => {}): AnalyseResult => {
  const { mix, stems } = input;
  const { bpm, offset, tracked } = grid(mix, stems.drums, input.bpm);
  const bar = 240 / bpm;
  const bars = Math.floor((mix.length / SR - offset) / bar);
  log(`bpm ${bpm.toFixed(2)} (tracker said ${tracked.toFixed(1)}), bar 0 at ${offset.toFixed(3)}s, ${bars} bars`);

  const harmonic = sum(Object.entries(stems).filter(([name]) => name !== "drums" && name !== "vocals").map(([, audio]) => audio));
  const key = input.key ?? detectKey(chroma(harmonic ?? mix, 2));
  log(`key ${key}`);

  const found = sections(barRms(mix, offset, bar, bars));
  const files: Record<string, Float32Array> = {};
  const analysis: Analysis = { bpm: Math.round(bpm * 1000) / 1000, key, gridOffset: Math.round(offset * 10000) / 10000, bars, sections: found, stems: [], voices: [] };

  // backing stems; guitar and piano join "other" to keep pads free
  const backing: Record<string, Float32Array | undefined> = {
    drums: stems.drums,
    bass: stems.bass,
    other: sum([stems.other, stems.guitar, stems.piano])
  };
  for (const [name, audio] of Object.entries(backing)) {
    if (audio && peakOf(audio) > 0.005) {
      files[`stems/${name}.wav`] = audio;
      analysis.stems.push({ id: name, file: `stems/${name}.wav` });
    }
  }

  const vocals = stems.vocals;
  if (vocals && peakOf(vocals) > 0.005) {
    files["voices/vocals.wav"] = vocals;
    analysis.voices.push({ id: "vocals", name: "Vocals", file: "voices/vocals.wav", type: "stem", score: 1e9 });

    const kept: Float64Array[] = [];
    const ranked = phrases(barRms(vocals, offset, bar, bars)).sort((a, b) => b[2] * b[1] - a[2] * a[1]);
    for (const [start, size, energy] of ranked) {
      const chunk = cut(vocals, offset, bar, start, size);
      const fingerprint = chromaSequence(chunk);
      if (kept.some((other) => similar(fingerprint, other))) continue;
      kept.push(fingerprint);
      const name = `v${String(kept.length).padStart(2, "0")}_bar${start + 1}`;
      files[`voices/${name}.wav`] = fade(chunk);
      analysis.voices.push({
        id: name,
        name: `${size === 1 ? "shout" : "phrase"} @${start + 1}`,
        file: `voices/${name}.wav`,
        type: size === 1 ? "oneshot" : "loop",
        bars: size,
        bar: start,
        score: energy * size
      });
      // the best ones go on pads, the rest wait in the explorer
      if (kept.length >= 32) break;
    }
  }

  // a riser and an impact around the biggest energy jump
  const other = backing.other;
  if (other && found.length > 1) {
    const energy = barRms(other, offset, bar, bars);
    const jumps = found.slice(1).map((section) => [section.bar, mean(energy, section.bar, section.bar + 2)] as const);
    const drop = jumps.reduce((best, item) => (item[1] > best[1] ? item : best))[0];
    if (drop >= 2) {
      files["voices/riser.wav"] = fade(cut(other, offset, bar, drop - 2, 2));
      analysis.voices.push({ id: "riser", name: "Riser", file: "voices/riser.wav", type: "oneshot", bars: 2, score: 0 });
    }
    files["voices/impact.wav"] = fade(cut(other, offset, bar, drop, 1));
    analysis.voices.push({ id: "impact", name: "Impact", file: "voices/impact.wav", type: "oneshot", bars: 1, score: 0 });
  }

  log(`${analysis.voices.length} voices, ${analysis.stems.length} stems`);
  return { analysis, files };
};
