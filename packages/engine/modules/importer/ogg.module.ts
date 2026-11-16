/**
 * Opus in an Ogg file, the format packs use for long tracks (about a tenth
 * of a WAV). The browser's AudioEncoder makes the Opus packets; this wraps
 * them in Ogg pages with the right granule positions, so decoders trim the
 * encoder delay and the audio stays on the grid.
 */

// —— ogg pages ——

const CrcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    table[i] = r >>> 0;
  }
  return table;
})();

export const oggCrc = (bytes: Uint8Array) => {
  let crc = 0;
  for (const byte of bytes) crc = ((crc << 8) ^ CrcTable[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
  return crc >>> 0;
};

export const PageFlags = { continued: 1, first: 2, last: 4 } as const;

/** One Ogg page holding whole packets (each under 255 * 255 bytes) */
export const oggPage = (packets: Uint8Array[], granule: bigint, serial: number, sequence: number, flags: number) => {
  const lacing: number[] = [];
  for (const packet of packets) {
    let size = packet.length;
    while (size >= 255) {
      lacing.push(255);
      size -= 255;
    }
    lacing.push(size);
  }
  if (lacing.length > 255) throw new Error("too many packets for one ogg page");
  const body = packets.reduce((total, packet) => total + packet.length, 0);
  const page = new Uint8Array(27 + lacing.length + body);
  const view = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53]); // "OggS"
  page[4] = 0;
  page[5] = flags;
  view.setBigInt64(6, granule, true);
  view.setUint32(14, serial, true);
  view.setUint32(18, sequence, true);
  view.setUint32(22, 0, true);
  page[26] = lacing.length;
  page.set(lacing, 27);
  let offset = 27 + lacing.length;
  for (const packet of packets) {
    page.set(packet, offset);
    offset += packet.length;
  }
  view.setUint32(22, oggCrc(page), true);
  return page;
};

// —— opus headers ——

export const opusHead = (channels: number, preSkip: number, inputRate: number) => {
  const head = new Uint8Array(19);
  const view = new DataView(head.buffer);
  head.set(new TextEncoder().encode("OpusHead"));
  head[8] = 1;
  head[9] = channels;
  view.setUint16(10, preSkip, true);
  view.setUint32(12, inputRate, true);
  view.setInt16(16, 0, true);
  head[18] = 0;
  return head;
};

const opusTags = () => {
  const vendor = new TextEncoder().encode("lodecks");
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  const view = new DataView(tags.buffer);
  tags.set(new TextEncoder().encode("OpusTags"));
  view.setUint32(8, vendor.length, true);
  tags.set(vendor, 12);
  view.setUint32(12 + vendor.length, 0, true);
  return tags;
};

/**
 * Wraps Opus packets (48 kHz granules) in an Ogg file. `samples` is the
 * real length at 48 kHz, so the last page trims the encoder's padding.
 */
export const muxOggOpus = (
  packets: { data: Uint8Array; samples: number }[],
  options: { channels: number; preSkip: number; inputRate: number; samples: number }
) => {
  const serial = 0x63796264; // "cybd"
  const pages: Uint8Array[] = [];
  let sequence = 0;
  pages.push(oggPage([opusHead(options.channels, options.preSkip, options.inputRate)], 0n, serial, sequence++, PageFlags.first));
  pages.push(oggPage([opusTags()], 0n, serial, sequence++, 0));

  let granule = 0;
  let batch: Uint8Array[] = [];
  let lacing = 0;
  const end = options.preSkip + options.samples;
  const flush = (last: boolean) => {
    if (!batch.length) return;
    const position = last ? end : Math.min(granule, end);
    pages.push(oggPage(batch, BigInt(position), serial, sequence++, last ? PageFlags.last : 0));
    batch = [];
    lacing = 0;
  };
  packets.forEach((packet, index) => {
    const segments = Math.floor(packet.data.length / 255) + 1;
    // about a second of audio per page, never over 255 lacing values
    if (lacing + segments > 255 || batch.length >= 50) flush(false);
    batch.push(packet.data);
    lacing += segments;
    granule += packet.samples;
    if (index === packets.length - 1) flush(true);
  });

  const size = pages.reduce((total, page) => total + page.length, 0);
  const file = new Uint8Array(size);
  let offset = 0;
  for (const page of pages) {
    file.set(page, offset);
    offset += page.length;
  }
  return file;
};

// —— encoding, in the browser ——

const OpusRate = 48000;
// libopus' default lookahead at 48 kHz, used when the encoder does not say
const DefaultPreSkip = 312;

export const canEncodeOpus = async () => {
  if (typeof AudioEncoder === "undefined") return false;
  try {
    const { supported } = await AudioEncoder.isConfigSupported({ codec: "opus", sampleRate: OpusRate, numberOfChannels: 1, bitrate: 96000 });
    return !!supported;
  } catch {
    return false;
  }
};

/** Mono audio at `rate` → .ogg (Opus, 96 kbit/s); resampled to 48 kHz first */
export const encodeOggOpus = async (audio: Float32Array, rate: number) => {
  // resample with the browser's own resampler
  const frames = Math.ceil((audio.length * OpusRate) / rate);
  const offline = new OfflineAudioContext(1, frames, OpusRate);
  const buffer = offline.createBuffer(1, audio.length, rate);
  buffer.copyToChannel(audio as Float32Array<ArrayBuffer>, 0);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const pcm = (await offline.startRendering()).getChannelData(0);

  const packets: { data: Uint8Array; samples: number }[] = [];
  let preSkip = DefaultPreSkip;
  let failure: Error | undefined;
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      packets.push({ data, samples: Math.round(((chunk.duration ?? 20000) * OpusRate) / 1e6) });
      // the encoder may hand over its own OpusHead, with the real pre-skip
      const description = metadata?.decoderConfig?.description;
      if (description) {
        const head = new Uint8Array(description instanceof ArrayBuffer ? description : (description as ArrayBufferView).buffer);
        if (head.length >= 12 && new TextDecoder().decode(head.subarray(0, 8)) === "OpusHead") {
          preSkip = new DataView(head.buffer, head.byteOffset).getUint16(10, true);
        }
      }
    },
    error: (error) => (failure = error)
  });
  encoder.configure({ codec: "opus", sampleRate: OpusRate, numberOfChannels: 1, bitrate: 96000 });

  // feed it in 1 s pieces
  const step = OpusRate;
  for (let start = 0; start < pcm.length; start += step) {
    const piece = pcm.slice(start, Math.min(pcm.length, start + step));
    encoder.encode(
      new AudioData({ format: "f32-planar", sampleRate: OpusRate, numberOfFrames: piece.length, numberOfChannels: 1, timestamp: Math.round((start * 1e6) / OpusRate), data: piece })
    );
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  return muxOggOpus(packets, { channels: 1, preSkip, inputRate: rate, samples: pcm.length });
};
