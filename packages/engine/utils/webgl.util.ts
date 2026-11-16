import type { GifPlayer } from "../modules/visual/gif.module";
import { shaderErrors, wrapShader } from "../modules/visual/glsl.module";

/** Music and gif inputs every GLSL effect gets as uniforms */
export type ShaderInputs = {
  fft: [number, number, number, number];
  kick: number;
  beat: number;
  bar: number;
  bpm: number;
  levelA: number;
  levelB: number;
  xfade: number;
  gif?: GifPlayer;
};

// one triangle that covers the screen, no buffers needed
export const Vertex = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const Uniforms = [
  "iResolution", "iTime", "iTimeDelta", "iFrame", "iMouse", "iChannel0", "iChannel1",
  "iChannelResolution", "uFft", "uKick", "uBeat", "uBar", "uBpm", "uLevelA", "uLevelB",
  "uXfade", "uGif"
] as const;

export type Program = {
  program: WebGLProgram;
  uniforms: Record<(typeof Uniforms)[number], WebGLUniformLocation | null>;
};

export type Target = { texture: WebGLTexture; framebuffer: WebGLFramebuffer };

export class ShaderError extends Error {
  constructor(public lines: string[]) {
    super(lines.join("\n"));
  }
}

export const compileShader = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "compile failed";
    gl.deleteShader(shader);
    throw new ShaderError(shaderErrors(log));
  }
  return shader;
};

/** Links a program from a vertex shader and raw fragment source */
export const linkProgram = (gl: WebGL2RenderingContext, vertex: WebGLShader, fragmentSource: string) => {
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram()!;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || "link failed";
    gl.deleteProgram(program);
    throw new ShaderError(shaderErrors(log));
  }
  return program;
};

/** A Shadertoy-style effect, wrapped and linked; throws ShaderError */
export const effectProgram = (gl: WebGL2RenderingContext, vertex: WebGLShader, code: string): Program => {
  const program = linkProgram(gl, vertex, wrapShader(code));
  return {
    program,
    uniforms: Object.fromEntries(
      Uniforms.map((name) => [name, gl.getUniformLocation(program, name)])
    ) as Program["uniforms"]
  };
};

export const createTexture = (gl: WebGL2RenderingContext, width: number, height: number) => {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
};

export const createTarget = (gl: WebGL2RenderingContext, width: number, height: number): Target => {
  const texture = createTexture(gl, width, height);
  const framebuffer = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer };
};

export const deleteTarget = (gl: WebGL2RenderingContext, target: Target) => {
  gl.deleteTexture(target.texture);
  gl.deleteFramebuffer(target.framebuffer);
};

export const clearTarget = (gl: WebGL2RenderingContext, target: Target) => {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
};

/** Uploads a canvas as a texture, flipped so its top is at the top */
export const uploadCanvas = (gl: WebGL2RenderingContext, texture: WebGLTexture, canvas: TexImageSource) => {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
};

export type Frame = {
  width: number;
  height: number;
  time: number;
  delta: number;
  frame: number;
  gifSize: [number, number];
  gifTexture: WebGLTexture;
  previous: WebGLTexture;
};

/** Sets every uniform and binds the gif and the previous frame */
export const setUniforms = (gl: WebGL2RenderingContext, program: Program, frame: Frame, inputs: ShaderInputs) => {
  const u = program.uniforms;
  gl.useProgram(program.program);
  gl.uniform3f(u.iResolution, frame.width, frame.height, 1);
  gl.uniform1f(u.iTime, frame.time);
  gl.uniform1f(u.iTimeDelta, frame.delta);
  gl.uniform1i(u.iFrame, frame.frame);
  gl.uniform4f(u.iMouse, 0, 0, 0, 0);
  gl.uniform3fv(u.iChannelResolution, [...frame.gifSize, 1, frame.width, frame.height, 1]);
  gl.uniform4f(u.uFft, ...inputs.fft);
  gl.uniform1f(u.uKick, inputs.kick);
  gl.uniform1f(u.uBeat, inputs.beat);
  gl.uniform1f(u.uBar, inputs.bar);
  gl.uniform1f(u.uBpm, inputs.bpm);
  gl.uniform1f(u.uLevelA, inputs.levelA);
  gl.uniform1f(u.uLevelB, inputs.levelB);
  gl.uniform1f(u.uXfade, inputs.xfade);
  gl.uniform1f(u.uGif, inputs.gif?.loaded ? 1 : 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, frame.gifTexture);
  gl.uniform1i(u.iChannel0, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, frame.previous);
  gl.uniform1i(u.iChannel1, 1);
};
