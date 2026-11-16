/** Encodes float channels (-1..1) as a 16 bit PCM wav file */
export const encodeWav = (channels: Float32Array[], sampleRate: number) => {
  const frames = channels[0].length;
  const blockAlign = channels.length * 2;
  const buffer = new ArrayBuffer(44 + frames * blockAlign);
  const view = new DataView(buffer);

  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  text(0, "RIFF");
  view.setUint32(4, 36 + frames * blockAlign, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * blockAlign, true);

  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, channel[frame]));
      view.setInt16(offset, sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Uint8Array(buffer);
};

export type WavData = { sampleRate: number; channels: Float32Array[] };

/** Decodes 16 bit PCM or 32 bit float wav files */
export const decodeWav = (bytes: Uint8Array): WavData => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + 4));

  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    throw new Error("Not a wav file");
  }

  let format = 1;
  let channelCount = 1;
  let sampleRate = 44100;
  let bits = 16;
  let offset = 12;

  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channelCount = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    }

    if (id === "data") {
      const bytesPerSample = bits / 8;
      const frames = Math.floor(size / (bytesPerSample * channelCount));
      const channels = Array.from(
        { length: channelCount },
        () => new Float32Array(frames)
      );

      for (let frame = 0; frame < frames; frame++) {
        for (let channel = 0; channel < channelCount; channel++) {
          const at = body + (frame * channelCount + channel) * bytesPerSample;
          channels[channel][frame] =
            format === 3
              ? view.getFloat32(at, true)
              : bits === 24
                ? ((view.getUint8(at) |
                    (view.getUint8(at + 1) << 8) |
                    (view.getInt8(at + 2) << 16)) /
                  0x800000)
                : view.getInt16(at, true) / 0x8000;
        }
      }

      return { sampleRate, channels };
    }

    offset = body + size + (size % 2);
  }

  throw new Error("Wav file has no data chunk");
};
