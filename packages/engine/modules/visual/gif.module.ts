/**
 * GIFs as visuals. The file is decoded once into frames (with the
 * browser's ImageDecoder), then played back locked to the transport: a
 * loop lasts a whole number of beats, so frame changes land on the beat
 * and follow the tempo.
 */
export type DecodedGif = {
  frames: ImageBitmap[];
  // per frame, in ms
  durations: number[];
  width: number;
  height: number;
  // natural length of one loop, in ms
  duration: number;
};

/**
 * How a gif sits on the screen, like css object-fit: cover fills it
 * (cropping), contain shows all of it (bars), fill stretches it
 */
export const GifFits = ["cover", "contain", "fill"] as const;
export type GifFit = (typeof GifFits)[number];
export const DefaultFit: GifFit = "cover";

export const parseFit = (value: unknown): GifFit | undefined => {
  const fit = String(value).toLowerCase();
  return (GifFits as readonly string[]).includes(fit) ? (fit as GifFit) : undefined;
};

/**
 * Scale from screen to image coordinates around the centre:
 * image uv = (screen uv - 0.5) * scale + 0.5. Aspects are width / height.
 */
export const fitScale = (fit: GifFit, screen: number, image: number): [number, number] => {
  if (fit === "fill" || !(screen > 0) || !(image > 0)) return [1, 1];
  const wider = screen > image;
  if (fit === "cover") return wider ? [1, image / screen] : [screen / image, 1];
  return wider ? [screen / image, 1] : [1, image / screen];
};

// loops that sit well in 4/4
export const LoopBeats = [1, 2, 4, 8, 16] as const;

// browsers play frames shorter than this at 100 ms, like the gif spec says
const MinFrame = 20;
const DefaultFrame = 100;

// keeps memory in check: frames are scaled down and capped
const MaxSize = 480;
const MaxFrames = 300;

/** Beats per loop: the nearest of LoopBeats to the gif's natural length */
export const loopBeats = (duration: number, bpm: number) => {
  const beats = Math.max(1e-3, duration / (60000 / bpm));
  let best: number = LoopBeats[0];
  for (const option of LoopBeats) {
    if (Math.abs(Math.log2(beats / option)) < Math.abs(Math.log2(beats / best))) best = option;
  }
  return best;
};

/** Frame shown at `progress` through the loop (any number, wraps) */
export const frameAt = (durations: number[], progress: number) => {
  const total = durations.reduce((sum, value) => sum + value, 0);
  if (!total) return 0;
  let time = (progress - Math.floor(progress)) * total;
  for (let index = 0; index < durations.length; index++) {
    if (time < durations[index]) return index;
    time -= durations[index];
  }
  return durations.length - 1;
};

export const frameDuration = (microseconds?: number | null) => {
  const ms = (microseconds ?? 0) / 1000;
  return ms < MinFrame ? DefaultFrame : ms;
};

export const decodeGif = async (blob: Blob): Promise<DecodedGif> => {
  if (typeof ImageDecoder === "undefined") {
    throw new Error("this browser cannot decode gifs (no ImageDecoder)");
  }
  const type = blob.type || "image/gif";
  if (!(await ImageDecoder.isTypeSupported(type))) throw new Error(`unsupported image type ${type}`);

  const decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type });
  try {
    await decoder.tracks.ready;
    await decoder.completed;
    const track = decoder.tracks.selectedTrack;
    const count = Math.min(MaxFrames, track?.frameCount || 1);

    const frames: ImageBitmap[] = [];
    const durations: number[] = [];
    let width = 0;
    let height = 0;
    for (let index = 0; index < count; index++) {
      const { image } = await decoder.decode({ frameIndex: index });
      const scale = Math.min(1, MaxSize / Math.max(image.displayWidth, image.displayHeight));
      width = Math.max(1, Math.round(image.displayWidth * scale));
      height = Math.max(1, Math.round(image.displayHeight * scale));
      frames.push(await createImageBitmap(image, { resizeWidth: width, resizeHeight: height }));
      durations.push(frameDuration(image.duration));
      image.close();
    }
    return {
      frames,
      durations,
      width,
      height,
      duration: durations.reduce((sum, value) => sum + value, 0)
    };
  } finally {
    decoder.close();
  }
};

/**
 * Plays one gif into a small canvas, which hydra (`gif()`) and the shaders
 * (`iChannel0`) read. `version` changes whenever a new frame was drawn.
 */
export class GifPlayer {
  canvas?: HTMLCanvasElement;
  version = 0;
  id?: string;
  beats = 4;
  private gif?: DecodedGif;
  private shown = -1;
  private ctx?: CanvasRenderingContext2D | null;

  get loaded() {
    return !!this.gif;
  }

  get size() {
    return this.gif ? [this.gif.width, this.gif.height] : [1, 1];
  }

  private surface() {
    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = this.canvas.height = 1;
      this.ctx = this.canvas.getContext("2d");
    }
    return this.canvas;
  }

  set(id: string | undefined, gif: DecodedGif | undefined, beats: number) {
    const canvas = this.surface();
    this.id = id;
    this.gif = gif;
    this.beats = beats;
    this.shown = -1;
    canvas.width = gif?.width || 1;
    canvas.height = gif?.height || 1;
    this.ctx?.clearRect(0, 0, canvas.width, canvas.height);
    this.version++;
  }

  /** `beat`: running beat count when the transport plays, else undefined */
  tick(beat: number | undefined, time: number) {
    const gif = this.gif;
    if (!gif || !this.ctx) return;
    const progress = beat === undefined ? time / gif.duration : beat / this.beats;
    const index = frameAt(gif.durations, progress);
    if (index === this.shown) return;
    this.shown = index;
    this.ctx.clearRect(0, 0, gif.width, gif.height);
    this.ctx.drawImage(gif.frames[index], 0, 0);
    this.version++;
  }
}
