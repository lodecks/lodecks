import { PackExtension } from "@/common/constants/deck.constant";
import { Pack, PackTrack } from "@/common/schemas/pack.schema";
import { barSeconds } from "@/common/utils/quantize.util";
import { PackFiles, unzipPack } from "@/common/utils/zip.util";

import { Audio } from "../../providers/audio.provider";

export type LoadedTrack = {
  track: PackTrack;
  buffer: AudioBuffer;
  // min/max pairs for drawing the waveform
  peaks: Float32Array;
};

export type LoadedPack = { id: string; pack: Pack; files: PackFiles };

const PeakBuckets = 1200;

export const fetchPack = async (id: string): Promise<LoadedPack> => {
  const response = await fetch(`/api/v1/packs/${id}${PackExtension}`);
  if (!response.ok) throw new Error(`Pack "${id}" could not be loaded`);

  return openPack(id, new Uint8Array(await response.arrayBuffer()));
};

export const openPack = (id: string, bytes: Uint8Array): LoadedPack => {
  const { pack, files } = unzipPack(bytes);
  return { id, pack, files };
};

export const computePeaks = (samples: Float32Array, buckets = PeakBuckets) => {
  const peaks = new Float32Array(buckets * 2);
  const size = samples.length / buckets;

  for (let bucket = 0; bucket < buckets; bucket++) {
    const from = Math.floor(bucket * size);
    const to = Math.min(samples.length, Math.floor((bucket + 1) * size));
    let min = 0;
    let max = 0;
    // a stride keeps long stems cheap, peaks do not need every sample
    const stride = Math.max(1, Math.floor((to - from) / 256));
    for (let i = from; i < to; i += stride) {
      const sample = samples[i];
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }
    peaks[bucket * 2] = min;
    peaks[bucket * 2 + 1] = max;
  }

  return peaks;
};

/** Seconds a track occupies on the grid, so loops wrap exactly on the bar */
export const gridLength = (pack: Pack, track: PackTrack, duration: number) => {
  const bar = barSeconds(pack.bpm, pack.timeSignature[0]);

  if (track.type === "loop") {
    return (track.bars || Math.max(1, Math.round(duration / bar))) * bar;
  }
  if (track.type === "stem") {
    const bars = pack.bars || Math.ceil((duration - pack.gridOffset) / bar);
    return pack.gridOffset + bars * bar;
  }
  return duration;
};

/** Decodes a track to a mono buffer padded or trimmed to its grid length */
export const decodeTrack = async (
  { pack, files }: LoadedPack,
  track: PackTrack
): Promise<LoadedTrack> => {
  const file = files[track.file];
  if (!file) throw new Error(`"${track.file}" is missing from the pack`);

  // decodeAudioData detaches its input, so it gets a copy
  const decoded = await Audio.ctx.decodeAudioData(file.slice().buffer);
  const length = Math.max(
    1,
    Math.round(gridLength(pack, track, decoded.duration) * decoded.sampleRate)
  );

  const buffer = new AudioBuffer({
    numberOfChannels: 1,
    length,
    sampleRate: decoded.sampleRate
  });
  const mono = buffer.getChannelData(0);
  const frames = Math.min(length, decoded.length);
  const scale = 1 / decoded.numberOfChannels;

  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const data = decoded.getChannelData(channel);
    for (let i = 0; i < frames; i++) mono[i] += data[i] * scale;
  }

  return { track, buffer, peaks: computePeaks(mono) };
};
