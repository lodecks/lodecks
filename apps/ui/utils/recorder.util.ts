import { atom, getDefaultStore } from "jotai";

/** The shapes a video can be recorded in */
export const VideoFormats = {
  landscape: { label: "16:9", hint: "YouTube", width: 1920, height: 1080 },
  portrait: { label: "9:16", hint: "Reels, TikTok, Shorts", width: 1080, height: 1920 }
} as const;
export type VideoFormat = keyof typeof VideoFormats;

export type RecorderState =
  | { status: "idle" }
  | { status: "asking" }
  // lag: how far the sound is held back to meet the picture, in ms, and
  // whether it was measured or guessed
  | { status: "recording"; started: number; lag: number; measured: boolean }
  | { status: "saving" }
  | { status: "failed"; error: string };

// recording mode: the app framed in a video's shape, undefined when off
export const recordModeAtom = atom<VideoFormat | undefined>(undefined);
export const recorderAtom = atom<RecorderState>({ status: "idle" });

const store = getDefaultStore();
const setState = (state: RecorderState) => store.set(recorderAtom, state);

const Fps = 30;
// about what YouTube asks for 1080p at 30 fps, with room for busy visuals
const VideoBits = 12_000_000;
const AudioBits = 256_000;

// mp4 plays everywhere it gets posted; webm where mp4 can't be recorded
const MimeTypes = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];

// Region Capture, Chrome only: crops a tab capture to one element
type CropTargetType = { fromElement(element: Element): Promise<unknown> };
type CroppableTrack = MediaStreamTrack & { cropTo(target: unknown): Promise<void> };
const CropTarget = (globalThis as unknown as { CropTarget?: CropTargetType }).CropTarget;

/** Whether this browser can record the framed tab */
export const canRecord = () =>
  typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia && !!CropTarget;

let active: { stop: () => void } | undefined;

/**
 * Records `frame` (an element) with the master audio: asks to share this
 * tab, crops the capture to the frame, scales it to the format's exact size
 * and saves the video when stopped (or when sharing ends).
 */
export type RecordAudio = { stream: MediaStream; delay: (seconds: number) => void };

// how long to watch the capture before recording, to measure its lag
const MeasureMs = 700;
// when the browser doesn't say when frames were captured
const DefaultLag = 0.12;

export const startRecording = async (frame: HTMLElement, format: VideoFormat, audio: RecordAudio, name = "lodecks") => {
  if (active) return;
  if (!canRecord()) {
    setState({ status: "failed", error: "recording needs Chrome or Edge (it crops the tab to the frame)" });
    return;
  }
  const { width, height } = VideoFormats[format];
  setState({ status: "asking" });

  let display: MediaStream;
  try {
    display = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser", frameRate: { ideal: 60 } },
      audio: false,
      // offers this tab first, and nothing to switch to midway
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      surfaceSwitching: "exclude",
      monitorTypeSurfaces: "exclude"
    } as DisplayMediaStreamOptions);
  } catch {
    // the prompt was dismissed
    setState({ status: "idle" });
    return;
  }

  const track = display.getVideoTracks()[0] as CroppableTrack;
  try {
    await track.cropTo(await CropTarget!.fromElement(frame));
  } catch {
    display.getTracks().forEach((item) => item.stop());
    setState({ status: "failed", error: "share this tab (lodecks), not another one or the whole screen" });
    return;
  }

  // the cropped capture, drawn at the format's exact size
  const video = document.createElement("video");
  video.muted = true;
  video.srcObject = display;
  await video.play();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false })!;
  context.imageSmoothingQuality = "high";
  let drawing = true;
  // how long each frame took from the screen to this canvas, in seconds
  const lags: number[] = [];
  const draw = (now: number, frameInfo: VideoFrameCallbackMetadata) => {
    if (!drawing) return;
    if (video.videoWidth) context.drawImage(video, 0, 0, width, height);
    if (frameInfo.captureTime !== undefined && lags.length < 200) lags.push((now - frameInfo.captureTime) / 1000);
    video.requestVideoFrameCallback(draw);
  };
  video.requestVideoFrameCallback(draw);

  // the picture reaches the file later than the sound: the page draws, the
  // screen composites it, the capture grabs it, it is drawn again here and
  // sampled for the encoder. The sound is held back by as much
  setState({ status: "asking" });
  await new Promise((resolve) => setTimeout(resolve, MeasureMs));
  lags.sort((a, b) => a - b);
  const measured = lags.length >= 5 ? lags[Math.floor(lags.length / 2)] : DefaultLag;
  // + a screen frame before the capture, + half a frame of the canvas sampling
  const lag = measured + 1 / 60 + 0.5 / Fps;
  audio.delay(lag);

  const stream = new MediaStream([...canvas.captureStream(Fps).getVideoTracks(), ...audio.stream.getAudioTracks()]);
  const mimeType = MimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: VideoBits, audioBitsPerSecond: AudioBits });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };

  const started = Date.now();
  recorder.onstop = () => {
    drawing = false;
    display.getTracks().forEach((item) => item.stop());
    stream.getVideoTracks().forEach((item) => item.stop());
    video.srcObject = null;
    active = undefined;
    const type = recorder.mimeType || mimeType || "video/webm";
    const blob = new Blob(chunks, { type });
    if (!blob.size) {
      setState({ status: "failed", error: "nothing was recorded" });
      return;
    }
    save(blob, `${fileName(name, format, started)}.${type.includes("mp4") ? "mp4" : "webm"}`);
    setState({ status: "idle" });
  };

  const stop = () => {
    if (recorder.state === "inactive") return;
    setState({ status: "saving" });
    recorder.stop();
  };
  // "stop sharing" in the browser's bar stops the recording too
  track.addEventListener("ended", stop);
  active = { stop };

  // chunks every second, so a long take doesn't sit in one buffer
  recorder.start(1000);
  setState({ status: "recording", started, lag: Math.round(lag * 1000), measured: lags.length >= 5 });
};

export const stopRecording = () => active?.stop();

export const isRecording = () => !!active;

const fileName = (name: string, format: VideoFormat, time: number) => {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "lodecks";
  return `${slug} ${VideoFormats[format].label.replace(":", "x")} ${stamp}`;
};

const save = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};
