/**
 * GIFs as visuals. The file is decoded once into frames (with the
 * browser's ImageDecoder), then played back locked to the transport: a
 * loop lasts a whole number of beats, so frame changes land on the beat
 * and follow the tempo.
 *
 * Videos (mp4, webm) go the same way, but are not decoded into frames: a
 * muted video element loops on its own, at its own speed, and is drawn
 * into the same canvas, so gif(), iChannel0 and the layers read it alike.
 */
export type DecodedGif = {
  frames: ImageBitmap[];
  // per frame, in ms
  durations: number[];
  width: number;
  height: number;
  // natural length of one loop, in ms
  duration: number;
  // a video plays here instead of the frames
  video?: HTMLVideoElement;
};

/** File types imported as gifs: animated images, and videos */
export const GifTypes = ["image/gif", "image/webp", "image/png", "image/apng", "video/mp4", "video/webm"];
export const isVideoType = (type: string) => type.startsWith("video/");
// the extensions a name loses when it becomes the gif's name
export const GifExtension = /\.(gif|webp|png|apng|mp4|m4v|webm)$/i;

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

// videos are drawn larger than gif frames: they are often backgrounds
const MaxVideoSize = 1280;
const VideoTimeout = 10_000;

/**
 * A video, ready to play: muted, looping, inline and without controls, so
 * it only ever plays, endlessly. Its sound is never heard.
 */
export const decodeVideo = async (blob: Blob): Promise<DecodedGif> => {
  const video = document.createElement("video");
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.autoplay = true;
  video.controls = false;
  video.preload = "auto";
  const url = URL.createObjectURL(blob);
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      // a load that never comes fails, so running the line again retries
      const timer = setTimeout(() => reject(new Error("the video did not load, run the line again")), VideoTimeout);
      video.onloadeddata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`this browser cannot play ${blob.type || "this video"}`));
      };
    });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  video.onerror = null;
  await video.play().catch(() => {});
  const scale = Math.min(1, MaxVideoSize / Math.max(video.videoWidth, video.videoHeight));
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration * 1000 : DefaultFrame;
  return {
    frames: [],
    durations: [duration],
    width: Math.max(1, Math.round(video.videoWidth * scale)),
    height: Math.max(1, Math.round(video.videoHeight * scale)),
    duration,
    video
  };
};

/** Lets go of what a decoded gif holds: its frames, or its video */
export const releaseGif = (gif: DecodedGif) => {
  gif.frames.forEach((frame) => frame.close());
  if (gif.video) {
    const url = gif.video.src;
    gif.video.pause();
    gif.video.removeAttribute("src");
    gif.video.load();
    URL.revokeObjectURL(url);
  }
};

export const decodeGif = async (blob: Blob): Promise<DecodedGif> => {
  if (isVideoType(blob.type)) return decodeVideo(blob);
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
    this.shownTime = -1;
    canvas.width = gif?.width || 1;
    canvas.height = gif?.height || 1;
    this.ctx?.clearRect(0, 0, canvas.width, canvas.height);
    this.version++;
  }

  /** `beat`: running beat count when the transport plays, else undefined */
  tick(beat: number | undefined, time: number) {
    const gif = this.gif;
    if (!gif || !this.ctx) return;
    if (gif.video) return this.tickVideo(gif.video, gif);
    const progress = beat === undefined ? time / gif.duration : beat / this.beats;
    const index = frameAt(gif.durations, progress);
    if (index === this.shown) return;
    this.shown = index;
    this.ctx.clearRect(0, 0, gif.width, gif.height);
    this.ctx.drawImage(gif.frames[index], 0, 0);
    this.version++;
  }

  // a video keeps playing by itself: draws it whenever it moved on
  private shownTime = -1;
  private tickVideo(video: HTMLVideoElement, gif: DecodedGif) {
    // a browser may pause a hidden video; it only ever plays
    if (video.paused) video.play().catch(() => {});
    if (video.readyState < 2 || video.currentTime === this.shownTime) return;
    this.shownTime = video.currentTime;
    this.ctx!.drawImage(video, 0, 0, gif.width, gif.height);
    this.version++;
  }
}
