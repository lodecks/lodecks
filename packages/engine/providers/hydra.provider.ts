import { DefaultFit, GifFits, fitScale, parseFit } from "../modules/visual/gif.module";
import { DefaultPreset } from "../modules/visual/presets.module";
import { Store } from "../utils/store.util";
import { Analysis } from "./analysis.provider";
import { Transport } from "./transport.provider";

export type HydraState = {
  ready: boolean;
  error?: string;
  // the code running
  code: string;
};

export const DefaultVisual = DefaultPreset.code;

// steps rendered per second, visuals do not need more
const Fps = 40;

class HydraProvider {
  store = new Store<HydraState>({
    ready: false,
    code: DefaultPreset.code
  });

  hydra?: any;
  canvas?: HTMLCanvasElement;
  private elapsed = 0;
  private last = 0;
  // the gif player's canvas, read by gif() through source s1
  private gif?: HTMLCanvasElement;

  async mount(canvas: HTMLCanvasElement) {
    if (this.hydra) {
      if (this.canvas === canvas) return;
      this.dispose();
    }
    this.canvas = canvas;

    // a dependency of hydra-synth still expects node's `global`
    (globalThis as any).global ??= globalThis;
    const { default: Hydra } = await import("hydra-synth");
    this.hydra = new Hydra({
      canvas,
      width: canvas.width,
      height: canvas.height,
      makeGlobal: false,
      autoLoop: false,
      detectAudio: false,
      enableStreamCapture: false,
      precision: "mediump"
    });
    this.hydra.synth.bpm = Transport.bpm;
    Transport.tempo.on((bpm) => {
      if (this.hydra) this.hydra.synth.bpm = bpm;
    });

    // the gif fitted to the screen, black outside it (src() would tile it)
    this.hydra.synth.setFunction({
      name: "gifFit",
      type: "src",
      inputs: [
        { type: "sampler2D", name: "tex", default: NaN },
        { type: "float", name: "scaleX", default: 1 },
        { type: "float", name: "scaleY", default: 1 }
      ],
      glsl: `   vec2 uv = (_st - 0.5) * vec2(scaleX, scaleY) + 0.5;
   if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
   return texture2D(tex, uv);`
    });

    this.store.set({ ready: true });
    this.bindGif(this.gif);
    this.apply();
  }

  dispose() {
    this.hydra?.regl?.destroy?.();
    this.hydra = undefined;
    this.canvas = undefined;
    this.store.set({ ready: false });
  }

  resize(width: number, height: number) {
    this.hydra?.setResolution(width, height);
  }

  /** Steps the visuals; called from the shared animation frame loop */
  frame(time: number) {
    if (!this.hydra) return false;
    const delta = this.last ? Math.min(100, time - this.last) : 16;
    this.last = time;
    this.elapsed += delta;
    if (this.elapsed < 1000 / Fps) return false;

    Analysis.update(Math.floor(time));
    this.hydra.tick(this.elapsed);
    this.elapsed = 0;
    return true;
  }

  // hydra functions are passed in as arguments, so they never touch the
  // globals strudel relies on (noise, shape, speed...)
  private run(code: string) {
    const synth = this.hydra.synth;
    const helpers = {
      ...Analysis.scope(),
      H: (pattern: string) => () => this.query(pattern),
      // height / width: shape(…).scale(1, aspect(), 1) keeps circles round
      aspect: () => (this.canvas ? this.canvas.height / this.canvas.width : 1),
      // the effect's gif as a source: gif().kaleid(4).out(), gif("contain")
      gif: (fit: unknown = DefaultFit) => {
        const mode = parseFit(fit);
        if (!mode) throw new Error(`gif(fit): ${GifFits.join(", ")}`);
        const scale = () => {
          const screen = this.canvas ? this.canvas.width / this.canvas.height : 1;
          const image = this.gif ? this.gif.width / this.gif.height : 1;
          return fitScale(mode, screen, image);
        };
        return synth.gifFit(synth.s1, () => scale()[0], () => scale()[1]);
      }
    };
    const scope: Record<string, unknown> = { ...synth, ...helpers };
    const names = Object.keys(scope).filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));

    const run = new Function(...names, `"use strict";\n${code}`);
    run(...names.map((name) => scope[name]));
  }

  private query(pattern: string) {
    const core = (globalThis as any).__strudelCore;
    if (!core) return 0;
    const cycle = Transport.now();
    const hap = core.reify(pattern).queryArc(cycle, cycle)[0];
    return hap ? Number(hap.value) || 0 : 0;
  }

  /** Points s1 at the gif canvas; called again when its size changes */
  bindGif(canvas?: HTMLCanvasElement) {
    this.gif = canvas;
    if (!this.hydra || !canvas) return;
    this.hydra.synth.s1.init(
      { src: canvas, dynamic: true },
      { min: "linear", mag: "linear", wrapS: "clamp", wrapT: "clamp" }
    );
  }

  /** Runs code from the visuals tab */
  setCode(code: string) {
    this.store.set({ code });
    this.apply();
  }

  apply() {
    if (!this.hydra) return;
    const code = this.store.get().code;

    try {
      // hush clears every source, the gif included
      this.hydra.synth.hush();
      this.bindGif(this.gif);
      this.run(code);
      this.store.set({ error: undefined });
    } catch (error) {
      this.store.set({ error: (error as Error).message });
    }
  }
}

export const Hydra = new HydraProvider();
