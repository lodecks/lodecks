import type { GifPlayer } from "../modules/visual/gif.module";
import {
  Program,
  ShaderError,
  ShaderInputs,
  Target,
  Vertex,
  clearTarget,
  compileShader,
  createTarget,
  createTexture,
  deleteTarget,
  effectProgram,
  setUniforms,
  uploadCanvas
} from "../utils/webgl.util";

export type { ShaderInputs };

// same cap as hydra, visuals do not need more
const Fps = 40;

/**
 * A tiny WebGL2 renderer for GLSL effects. Each frame renders into one of
 * two textures, the other holds the previous frame (iChannel1), and the
 * result is copied to the canvas.
 */
class ShaderProvider {
  canvas?: HTMLCanvasElement;
  private gl?: WebGL2RenderingContext;
  private vertex?: WebGLShader;
  private current?: Program;
  private targets: Target[] = [];
  private flip = 0;
  private gifTexture?: WebGLTexture;
  private gifVersion = -1;
  private gifSize: [number, number] = [1, 1];
  private pending?: string;
  private start = 0;
  private last = 0;
  private elapsed = 0;
  private count = 0;

  get ready() {
    return !!this.gl;
  }

  mount(canvas: HTMLCanvasElement) {
    if (this.canvas === canvas && this.gl) return [];
    this.canvas = canvas;
    this.current = undefined;
    this.targets = [];
    this.gifVersion = -1;

    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    this.vertex = compileShader(gl, gl.VERTEX_SHADER, Vertex);
    this.gifTexture = createTexture(gl, 1, 1);
    this.resize(canvas.width, canvas.height);
    this.start = performance.now();

    // code set before the canvas existed
    if (this.pending) {
      const code = this.pending;
      this.pending = undefined;
      return this.compile(code);
    }
    return [];
  }

  resize(width: number, height: number) {
    const gl = this.gl;
    if (!gl || !this.canvas) return;
    this.canvas.width = width;
    this.canvas.height = height;
    for (const target of this.targets) deleteTarget(gl, target);
    this.targets = [createTarget(gl, width, height), createTarget(gl, width, height)];
  }

  /**
   * Compiles an effect. Returns its errors; on errors the previous effect
   * keeps running.
   */
  compile(code: string): string[] {
    const gl = this.gl;
    if (!gl || !this.vertex) {
      this.pending = code;
      return [];
    }
    let next: Program;
    try {
      next = effectProgram(gl, this.vertex, code);
    } catch (error) {
      return error instanceof ShaderError ? error.lines : [(error as Error).message];
    }
    if (this.current) gl.deleteProgram(this.current.program);
    this.current = next;
    // a new effect starts from black, not the last one's trails
    for (const target of this.targets) clearTarget(gl, target);
    this.count = 0;
    return [];
  }

  private uploadGif(gif?: GifPlayer) {
    if (!gif?.canvas || !gif.loaded || gif.version === this.gifVersion) return;
    this.gifVersion = gif.version;
    uploadCanvas(this.gl!, this.gifTexture!, gif.canvas);
    this.gifSize = [gif.canvas.width, gif.canvas.height];
  }

  /** Renders a frame; called from the visuals frame loop */
  frame(time: number, inputs: ShaderInputs) {
    const gl = this.gl;
    const program = this.current;
    if (!gl || !program || this.targets.length < 2 || gl.isContextLost()) return;

    const delta = this.last ? Math.min(100, time - this.last) : 16;
    this.last = time;
    this.elapsed += delta;
    if (this.elapsed < 1000 / Fps) return;
    const step = this.elapsed / 1000;
    this.elapsed = 0;

    this.uploadGif(inputs.gif);
    const width = this.canvas!.width;
    const height = this.canvas!.height;
    const target = this.targets[this.flip];
    const previous = this.targets[1 - this.flip];

    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, width, height);
    setUniforms(gl, program, {
      width,
      height,
      time: (performance.now() - this.start) / 1000,
      delta: step,
      frame: this.count++,
      gifSize: this.gifSize,
      gifTexture: this.gifTexture!,
      previous: previous.texture
    }, inputs);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // copy to the canvas
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.flip = 1 - this.flip;
  }
}

export const Shader = new ShaderProvider();
