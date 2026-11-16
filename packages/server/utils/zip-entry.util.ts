import { inflateSync } from "fflate";

/** Reads `length` bytes of a file from `start`, as a store can (R2 ranges, a slice of a file) */
export type ReadRange = (start: number, length: number) => Promise<Uint8Array>;

const EndOfDirectory = 0x06054b50;
const DirectoryEntry = 0x02014b50;
const LocalEntry = 0x04034b50;
// the end record is 22 bytes, plus a comment of up to 64 KB
const Tail = 22 + 0xffff;

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/**
 * One file out of a zip, reading only the end of it, the directory and that
 * file: a pack's manifest without downloading its audio. Stored and deflated
 * entries, no zip64 (packs stay far below 4 GB).
 */
export const readZipEntry = async (read: ReadRange, size: number, name: string) => {
  const tailStart = Math.max(0, size - Tail);
  const tail = await read(tailStart, size - tailStart);
  const tailView = view(tail);
  let end = -1;
  for (let at = tail.length - 22; at >= 0; at--) {
    if (tailView.getUint32(at, true) === EndOfDirectory) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip");

  const directorySize = tailView.getUint32(end + 12, true);
  const directoryStart = tailView.getUint32(end + 16, true);
  const directory =
    directoryStart >= tailStart
      ? tail.subarray(directoryStart - tailStart, directoryStart - tailStart + directorySize)
      : await read(directoryStart, directorySize);
  const entries = view(directory);
  const decoder = new TextDecoder();

  for (let at = 0; at + 46 <= directory.length; ) {
    if (entries.getUint32(at, true) !== DirectoryEntry) break;
    const method = entries.getUint16(at + 10, true);
    const compressed = entries.getUint32(at + 20, true);
    const nameLength = entries.getUint16(at + 28, true);
    const extraLength = entries.getUint16(at + 30, true);
    const commentLength = entries.getUint16(at + 32, true);
    const offset = entries.getUint32(at + 42, true);
    const entryName = decoder.decode(directory.subarray(at + 46, at + 46 + nameLength));

    if (entryName === name) {
      const header = view(await read(offset, 30));
      if (header.getUint32(0, true) !== LocalEntry) throw new Error("broken zip entry");
      const dataStart = offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
      const data = await read(dataStart, compressed);
      if (method === 0) return data;
      if (method === 8) return inflateSync(data);
      throw new Error(`unsupported zip method ${method}`);
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return undefined;
};
