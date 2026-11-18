import { BeatsPerBar } from "@/common/constants/quantize.constant";

import { Blend, Blends, Layer, LayerOptions, LayerSource, Layers, boxRect } from "../modules/live/layers.module";
import { GifPlayer, loopBeats } from "../modules/visual/gif.module";
import { Emitter } from "../utils/store.util";
import {
  Program,
  ShaderError,
  Target,
  Vertex,
  clearTarget,
  compileShader,
  createTarget,
  createTexture,
  deleteTarget,
  effectProgram,
  linkProgram,
  setUniforms,
  uploadCanvas
} from "../utils/webgl.util";
import { Camera } from "./camera.provider";
import { Hydra } from "./hydra.provider";
import { Transport } from "./transport.provider";
import { Visuals } from "./visuals.provider";

// blends the next layer over what is below it
const BlendShader = `#version 300 es
precision highp float;
uniform sampler2D uBase;
uniform sampler2D uLayer;
uniform int uMode;
uniform float uOpacity;
uniform vec2 uSize;
// where the layer is drawn: x, y, width, height (the whole screen unboxed)
uniform vec4 uRect;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 base = texture(uBase, uv).rgb;
  vec2 inside = (uv - uRect.xy) / uRect.zw;
  // outside its box, the layer leaves what is below alone
  if (any(lessThan(inside, vec2(0.0))) || any(greaterThan(inside, vec2(1.0)))) {
    fragColor = vec4(base, 1.0);
    return;
  }
  vec3 layer = texture(uLayer, inside).rgb;
  vec3 mixed = layer;
  if (uMode == 1) mixed = base + layer;
  else if (uMode == 2) mixed = 1.0 - (1.0 - base) * (1.0 - layer);
  else if (uMode == 3) mixed = base * layer;
  fragColor = vec4(mix(base, mixed, uOpacity), 1.0);
}`;

const Modes = { normal: 0, add: 1, screen: 2, multiply: 3 };

type Pass = {
  name: string;
  code: string;
  program?: Program;
  // feedback: the pass's last two frames
  targets: Target[];
  flip: number;
  count: number;
  gifName?: string;
  gif: GifPlayer;
  gifTexture: WebGLTexture;
  gifVersion: number;
  // reads the webcam instead of a gif
  camera: boolean;
};

const Fps = 40;

/** A stack a preview shows: the layers one line made */
export type PreviewLayer = { source: LayerSource } & LayerOptions;

// what makes two stacks look the same (opacity aside)
// a box moving with a signal is the same box, wherever it is now
const boxKey = ({ box }: Layer) => (box ? `${box.corner}@${typeof box.size === "number" ? box.size : "~"}` : "");

const stackKey = (list: Layer[]) =>
  list
    .map((layer) => {
      const source = layer.source;
      return `${source.kind}:${source.code}:${source.kind === "glsl" ? `${source.gif ?? ""}:${source.camera ? 1 : 0}` : ""}:${layer.blend}:${boxKey(layer)}`;
    })
    .join("|");

/**
 * Renders the set's visual layers and blends them, on its own canvas:
 * each GLSL layer into its own target, hydra (one layer at most) from its
 * canvas, then the stack blended from the first layer up. Previews (what
 * one line showed) are stacks of their own, composited on request.
 */
class CompositorProvider {
  canvas?: HTMLCanvasElement;
  errors = new Emitter<{ layer: string; lines: string[] }>();

  private gl?: WebGL2RenderingContext;
  private vertex?: WebGLShader;
  private blend?: { program: WebGLProgram; base: any; layer: any; mode: any; opacity: any; size: any; rect: any };
  private accum: Target[] = [];
  private passes = new Map<string, Pass>();
  private hydraTexture?: WebGLTexture;
  private hydraCode?: string;
  // what hydra ran before a layer took it over, given back on dispose
  private hydraBefore?: { code: string };
  // the stack that plays (full screen, background, pop out)
  private main: Layer[] = [];
  // each preview's own stack, by component id
  private previews = new Map<string, Layer[]>();
  private unsubscribe?: () => void;
  private start = 0;
  private last = 0;
  private elapsed = 0;

  mount(canvas: HTMLCanvasElement, source: Layers) {
    this.dispose();
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error("WebGL2 is not available");
    this.canvas = canvas;
    this.gl = gl;
    this.vertex = compileShader(gl, gl.VERTEX_SHADER, Vertex);
    const program = linkProgram(gl, this.vertex, BlendShader);
    this.blend = {
      program,
      base: gl.getUniformLocation(program, "uBase"),
      layer: gl.getUniformLocation(program, "uLayer"),
      mode: gl.getUniformLocation(program, "uMode"),
      opacity: gl.getUniformLocation(program, "uOpacity"),
      rect: gl.getUniformLocation(program, "uRect"),
      size: gl.getUniformLocation(program, "uSize")
    };
    this.hydraTexture = createTexture(gl, 1, 1);
    this.resize(canvas.width, canvas.height);
    this.start = performance.now();

    this.main = source.store.get().list;
    this.sync();
    this.unsubscribe = source.store.subscribe(() => {
      this.main = source.store.get().list;
      this.sync();
    });
  }

  dispose() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    Camera.close();
    const gl = this.gl;
    if (gl) {
      for (const pass of this.passes.values()) this.dropPass(pass);
      for (const target of this.accum) deleteTarget(gl, target);
    }
    this.passes.clear();
    this.accum = [];
    this.hydraCode = undefined;
    this.restoreHydra();
    this.gl = undefined;
    this.canvas = undefined;
  }

  resize(width: number, height: number) {
    const gl = this.gl;
    if (!gl || !this.canvas) return;
    this.canvas.width = width;
    this.canvas.height = height;
    for (const target of this.accum) deleteTarget(gl, target);
    this.accum = [createTarget(gl, width, height), createTarget(gl, width, height)];
    for (const pass of this.passes.values()) {
      for (const target of pass.targets) deleteTarget(gl, target);
      pass.targets = [createTarget(gl, width, height), createTarget(gl, width, height)];
    }
  }

  private restoreHydra() {
    const before = this.hydraBefore;
    if (!before) return;
    this.hydraBefore = undefined;
    Hydra.setCode(before.code);
  }

  private dropPass(pass: Pass) {
    const gl = this.gl!;
    if (pass.program) gl.deleteProgram(pass.program.program);
    for (const target of pass.targets) deleteTarget(gl, target);
    gl.deleteTexture(pass.gifTexture);
  }

  /**
   * A preview's own stack, drawn under the line that showed it; none
   * when it went away. Its layers render alongside the main ones.
   */
  setPreview(id: string, layers?: PreviewLayer[]) {
    if (!layers?.length) this.previews.delete(id);
    else
      this.previews.set(
        id,
        layers.map((layer, order) => ({
          name: `p:${id}:${order}`,
          source: layer.source,
          blend: (Blends as readonly string[]).includes(layer.blend ?? "") ? (layer.blend as Blend) : "normal",
          opacity: layer.opacity ?? 1,
          box: layer.box,
          order
        }))
      );
    this.sync();
  }

  /** Whether a preview shows what plays anyway (then it mirrors that) */
  isMain(id: string) {
    const preview = this.previews.get(id);
    return !preview || stackKey(preview) === stackKey(this.main);
  }

  /** Composites a preview's stack onto the canvas, after frame() drew */
  drawPreview(id: string) {
    const preview = this.previews.get(id);
    if (!preview || !this.gl || !this.canvas) return false;
    this.composite(preview);
    return true;
  }

  /** Follows the declared layers: new code compiles, gone layers go */
  private sync() {
    const gl = this.gl;
    if (!gl || !this.canvas) return;
    const list = [...this.main, ...[...this.previews.values()].flat()];
    for (const [name, pass] of this.passes) {
      const layer = list.find((item) => item.name === name);
      if (!layer || layer.source.kind !== "glsl") {
        this.dropPass(pass);
        this.passes.delete(name);
      }
    }

    // one hydra runs: the stack's, else a preview's
    const hydra = this.main.find((layer) => layer.source.kind === "hydra") ?? list.find((layer) => layer.source.kind === "hydra");
    for (const layer of list) {
      const source = layer.source;
      if (source.kind === "hydra") {
        if (layer === hydra && source.code !== this.hydraCode) {
          this.hydraCode = source.code;
          this.hydraBefore ??= { code: Hydra.store.get().code };
          Hydra.setCode(source.code);
          const error = Hydra.store.get().error;
          if (error) this.errors.emit({ layer: layer.name, lines: [error] });
        }
        continue;
      }

      let pass = this.passes.get(layer.name);
      if (!pass) {
        pass = {
          name: layer.name,
          code: "",
          targets: [createTarget(gl, this.canvas.width, this.canvas.height), createTarget(gl, this.canvas.width, this.canvas.height)],
          flip: 0,
          count: 0,
          gif: new GifPlayer(),
          gifTexture: createTexture(gl, 1, 1),
          gifVersion: -1,
          camera: false
        };
        this.passes.set(layer.name, pass);
      }
      if (pass.code !== source.code) {
        try {
          const program = effectProgram(gl, this.vertex!, source.code);
          if (pass.program) gl.deleteProgram(pass.program.program);
          pass.program = program;
          pass.code = source.code;
          pass.count = 0;
          for (const target of pass.targets) clearTarget(gl, target);
        } catch (error) {
          // the layer keeps its last working shader
          pass.code = source.code;
          this.errors.emit({
            layer: layer.name,
            lines: error instanceof ShaderError ? error.lines : [(error as Error).message]
          });
        }
      }
      pass.camera = !!source.camera;
      if (pass.camera) {
        Camera.open().catch((error) => this.errors.emit({ layer: layer.name, lines: [(error as Error).message] }));
      } else {
        this.bindGif(pass, source.gif);
      }
    }
    // the camera light goes off when nothing shows it
    if (!list.some((layer) => layer.source.kind === "glsl" && layer.source.camera)) Camera.close();
    if (!list.some((layer) => layer.source.kind === "hydra")) {
      this.hydraCode = undefined;
      this.restoreHydra();
    }
  }

  private async bindGif(pass: Pass, name?: string) {
    const gif = Visuals.findGif(name);
    if (!gif) {
      if (name !== undefined) this.errors.emit({ layer: pass.name, lines: [`no gif "${name}" — import one from the effects menu`] });
      return;
    }
    if (pass.gif.id === gif.id) return;
    try {
      const decoded = await Visuals.decode(gif.id);
      pass.gif.set(gif.id, decoded, loopBeats(decoded.duration, Transport.bpm));
      pass.gifVersion = -1;
    } catch (error) {
      this.errors.emit({ layer: pass.name, lines: [`gif: ${(error as Error).message}`] });
    }
  }

  /** Renders every layer and blends them; true when a frame was drawn */
  frame(time: number) {
    const gl = this.gl;
    if (!gl || !this.blend || this.accum.length < 2 || gl.isContextLost()) return false;

    // hydra keeps its own pace; its canvas is read right after it drew
    const hydraLayer = [...this.main, ...[...this.previews.values()].flat()].find((layer) => layer.source.kind === "hydra");
    if (hydraLayer) {
      // gif() inside hydra plays the gif of the / screen
      Visuals.gif.tick(Transport.running ? Transport.now() * BeatsPerBar : undefined, time);
    }
    if (hydraLayer && Hydra.frame(time) && Hydra.canvas) {
      uploadCanvas(gl, this.hydraTexture!, Hydra.canvas);
    }

    const delta = this.last ? Math.min(100, time - this.last) : 16;
    this.last = time;
    this.elapsed += delta;
    if (this.elapsed < 1000 / Fps) return false;
    const step = this.elapsed / 1000;
    this.elapsed = 0;

    const width = this.canvas!.width;
    const height = this.canvas!.height;
    const running = Transport.running;
    const beat = running ? Transport.now() * BeatsPerBar : undefined;
    const seconds = (performance.now() - this.start) / 1000;
    gl.viewport(0, 0, width, height);

    // the webcam's frame, once for every layer that reads it
    let cameraFrame: HTMLCanvasElement | undefined | null = null;

    // each glsl layer renders into its own target
    for (const pass of this.passes.values()) {
      if (!pass.program) continue;
      if (pass.camera) {
        if (cameraFrame === null) cameraFrame = Camera.frame();
        if (cameraFrame) uploadCanvas(gl, pass.gifTexture, cameraFrame);
      } else {
        pass.gif.tick(beat, time);
        if (pass.gif.canvas && pass.gif.loaded && pass.gif.version !== pass.gifVersion) {
          pass.gifVersion = pass.gif.version;
          uploadCanvas(gl, pass.gifTexture, pass.gif.canvas);
        }
      }
      const target = pass.targets[pass.flip];
      const previous = pass.targets[1 - pass.flip];
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      const [gifWidth, gifHeight] = pass.camera ? [cameraFrame?.width ?? 1, cameraFrame?.height ?? 1] : pass.gif.size;
      setUniforms(gl, pass.program, {
        width,
        height,
        time: seconds,
        delta: step,
        frame: pass.count++,
        gifSize: [gifWidth, gifHeight],
        gifTexture: pass.gifTexture,
        previous: previous.texture
      }, Visuals.inputs(time, pass.gif));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      pass.flip = 1 - pass.flip;
    }

    this.composite(this.main);
    return true;
  }

  /** Blends a stack from black, first layer up, onto the canvas */
  private composite(stack: Layer[]) {
    const gl = this.gl!;
    const blend = this.blend!;
    const width = this.canvas!.width;
    const height = this.canvas!.height;
    gl.viewport(0, 0, width, height);
    clearTarget(gl, this.accum[0]);
    let read = 0;
    gl.useProgram(blend.program);
    gl.uniform2f(blend.size, width, height);
    gl.uniform1i(blend.base, 0);
    gl.uniform1i(blend.layer, 1);
    for (const layer of stack) {
      const texture =
        layer.source.kind === "hydra"
          ? this.hydraTexture
          : (() => {
              const pass = this.passes.get(layer.name);
              // the target just drawn is the one before the flip
              return pass?.program ? pass.targets[1 - pass.flip].texture : undefined;
            })();
      if (!texture) continue;
      const write = 1 - read;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.accum[write].framebuffer);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.accum[read].texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(blend.mode, Modes[layer.blend]);
      gl.uniform1f(blend.opacity, Layers.opacity(layer));
      gl.uniform4f(blend.rect, ...boxRect(layer.box));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      read = write;
    }

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.accum[read].framebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}

export const Compositor = new CompositorProvider();
