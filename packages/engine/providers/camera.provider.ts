/**
 * The webcam, for camera() visuals: opened when a layer needs it (the
 * browser asks the user first), drawn into a small canvas the compositor
 * uploads as a texture, and closed when no layer uses it any more.
 * Frames never leave the page.
 */
const Width = 480;
const Height = 360;

class CameraProvider {
  canvas?: HTMLCanvasElement;
  private video?: HTMLVideoElement;
  private stream?: MediaStream;
  private ctx?: CanvasRenderingContext2D | null;
  private opening?: Promise<void>;
  error?: string;

  get ready() {
    return !!this.stream && !!this.video && this.video.readyState >= 2;
  }

  /** Opens the camera once; later calls wait for the same one */
  open() {
    this.opening ??= (async () => {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("this browser has no camera access");
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      } catch (error) {
        this.opening = undefined;
        const name = (error as Error).name;
        this.error = name === "NotAllowedError" ? "camera access was not allowed" : name === "NotFoundError" ? "no camera found" : (error as Error).message;
        throw new Error(this.error);
      }
      this.error = undefined;
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = this.stream;
      await video.play();
      this.video = video;
      this.canvas = document.createElement("canvas");
      this.canvas.width = Width;
      this.canvas.height = Height;
      this.ctx = this.canvas.getContext("2d");
    })();
    return this.opening;
  }

  close() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.video = undefined;
    this.opening = undefined;
  }

  /** Draws the current frame (cropped to 4:3) into the canvas */
  frame() {
    if (!this.ready || !this.ctx || !this.video || !this.canvas) return undefined;
    const { videoWidth: w, videoHeight: h } = this.video;
    const scale = Math.max(Width / w, Height / h);
    const sw = Width / scale;
    const sh = Height / scale;
    this.ctx.drawImage(this.video, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, Width, Height);
    return this.canvas;
  }
}

export const Camera = new CameraProvider();
