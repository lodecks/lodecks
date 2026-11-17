/**
 * GLSL effects are Shadertoy style: the code defines
 * `mainImage(out vec4 fragColor, in vec2 fragCoord)` and gets these
 * uniforms. A full `void main()` writing `fragColor` works too.
 */
export const ShaderHeader = `#version 300 es
precision highp float;
precision highp int;
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform int iFrame;
uniform vec4 iMouse;
// iChannel0: the gif, iChannel1: the previous frame (for trails)
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform vec3 iChannelResolution[2];
// music: fft bands (bass, low mid, high mid, air), kick 1 → 0,
// beat phase 0..1, running bar count, tempo, deck levels, crossfader,
// and each deck's colour (from the settings)
uniform vec4 uFft;
uniform float uKick;
uniform float uBeat;
uniform float uBar;
uniform float uBpm;
uniform float uLevelA;
uniform float uLevelB;
uniform float uXfade;
uniform float uGif;
uniform vec3 uDeckA;
uniform vec3 uDeckB;
out vec4 fragColor;
`;

const MainCall = `
void main() {
  fragColor = vec4(0.0, 0.0, 0.0, 1.0);
  mainImage(fragColor, gl_FragCoord.xy);
  fragColor.a = 1.0;
}
`;

const definesMain = (code: string) => /\bvoid\s+main\s*\(/.test(code);

/** Full fragment source; `#line 1` keeps error lines on the user's code */
export const wrapShader = (code: string) =>
  `${ShaderHeader}#line 1\n${code}\n${definesMain(code) ? "" : MainCall}`;

/** Turns the driver's log into short messages with the user's line numbers */
export const shaderErrors = (log: string) =>
  log
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/.exec(line);
      return match ? `line ${match[1]}: ${match[2].replace(/\s+/g, " ")}` : line;
    })
    .filter((line) => !/compilation terminated/i.test(line));

export const UniformsHelp =
  "iTime iResolution iChannel0=gif iChannel1=last frame uFft uKick uBeat uBar uBpm uLevelA uLevelB uXfade uDeckA uDeckB";
