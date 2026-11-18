import { BeatsPerBar } from "@/common/constants/quantize.constant";

import { DecodedGif, GifExtension, GifPlayer, decodeGif, isVideoType, loopBeats, releaseGif } from "../modules/visual/gif.module";
import { Effect, EffectKind, GifRecord, Library } from "../modules/visual/library.module";
import { DefaultPreset, VisualPresets } from "../modules/visual/presets.module";
import {
  GifTemplate,
  HydraTemplate,
  ShaderPresets,
  ShaderTemplate
} from "../modules/visual/shader-presets.module";
import { Store } from "../utils/store.util";
import { Analysis } from "./analysis.provider";
import { Audio } from "./audio.provider";
import { Hydra } from "./hydra.provider";
import { Shader, ShaderInputs } from "./shader.provider";
import { Transport } from "./transport.provider";

export type GifInfo = {
  id: string;
  name: string;
  source?: string;
  createdAt: number;
  // object url, for thumbnails
  url: string;
  // a video (mp4, webm), shown with <video> instead of <img>
  video: boolean;
};

export type VisualsState = {
  // the library was read from the browser
  loaded: boolean;
  // built-ins first, then the user's
  effects: Effect[];
  gifs: GifInfo[];
  active: string;
  kind: EffectKind;
  // code running now
  code: string;
  // the running code differs from the saved effect
  edited: boolean;
  // gif playing now, and its loop in beats
  gifId?: string;
  beats?: number;
  // beats chosen by hand for this effect, auto when unset
  beatsSetting?: number;
  error?: string;
};

export const BuiltInEffects: Effect[] = [
  ...VisualPresets.map((preset) => ({ ...preset, kind: "hydra" as const, builtIn: true, updatedAt: 0 })),
  ...ShaderPresets.map((preset) => ({
    ...preset,
    kind: preset.code === GifTemplate ? ("gif" as const) : ("shader" as const),
    builtIn: true,
    updatedAt: 0
  }))
];

const Templates: Record<EffectKind, string> = {
  hydra: HydraTemplate,
  shader: ShaderTemplate,
  gif: GifTemplate
};

// the effect in use, remembered across reloads
const LastKey = "lodecks.visuals.active";

const remember = (id: string) => {
  try {
    localStorage.setItem(LastKey, id);
  } catch {}
};

const recall = () => {
  try {
    return localStorage.getItem(LastKey) || undefined;
  } catch {
    return undefined;
  }
};

const newId = () => `my-${crypto.randomUUID().slice(0, 8)}`;

class VisualsProvider {
  store = new Store<VisualsState>({
    loaded: false,
    effects: BuiltInEffects,
    gifs: [],
    active: DefaultPreset.id,
    kind: "hydra",
    code: DefaultPreset.code,
    edited: false
  });

  gif = new GifPlayer();
  private decoded = new Map<string, Promise<DecodedGif>>();
  private loading?: Promise<void>;
  // gif picked by hand for the active effect, kept when it is saved
  private chosenGif?: string;

  find(id: string) {
    return this.store.get().effects.find((effect) => effect.id === id);
  }

  get activeEffect() {
    return this.find(this.store.get().active);
  }

  /** Canvas showing now, for pop out */
  get canvas() {
    return this.store.get().kind === "hydra" ? Hydra.canvas : Shader.canvas;
  }

  /** Reads the library and brings back the last effect, once */
  init() {
    this.loading ??= (async () => {
      if (!Library.available) return;
      try {
        await this.refresh();
      } catch (error) {
        console.warn("[lodecks] effects library unavailable", error);
      }
      const last = recall();
      this.store.set({ loaded: true });
      if (last && this.find(last) && last !== this.store.get().active) this.select(last);
      else this.bindGif();
    })();
    return this.loading;
  }

  private async refresh() {
    const [effects, gifs] = await Promise.all([Library.effects(), Library.gifs()]);
    for (const old of this.store.get().gifs) URL.revokeObjectURL(old.url);
    this.store.set({
      effects: [...BuiltInEffects, ...effects],
      gifs: gifs.map((gif) => ({
        id: gif.id,
        name: gif.name,
        source: gif.source,
        createdAt: gif.createdAt,
        url: URL.createObjectURL(gif.blob),
        video: isVideoType(gif.blob.type)
      }))
    });
  }

  // —— running effects ——

  mountHydra(canvas: HTMLCanvasElement) {
    return Hydra.mount(canvas);
  }

  mountShader(canvas: HTMLCanvasElement) {
    const errors = Shader.mount(canvas);
    if (errors.length) this.store.set({ error: errors.join("\n") });
  }

  /** Loads an effect and runs it */
  select(id: string) {
    const effect = this.find(id);
    if (!effect) return;
    this.store.set({
      active: effect.id,
      kind: effect.kind,
      beatsSetting: effect.beats,
      error: undefined
    });
    remember(effect.id);
    this.chosenGif = undefined;
    this.run(effect.code);
    this.bindGif(effect.gifId);
    return effect;
  }

  /** Runs code in the active effect's language, keeping the saved version */
  run(code: string) {
    const { kind } = this.store.get();
    const saved = this.activeEffect;
    let error: string | undefined;

    if (kind === "hydra") {
      Hydra.setCode(code);
      error = Hydra.store.get().error;
    } else {
      const errors = Shader.compile(code);
      error = errors.length ? errors.join("\n") : undefined;
    }
    this.store.set({
      // a shader that fails to compile keeps the last one running
      code: error && kind !== "hydra" ? this.store.get().code : code,
      edited: !!saved && saved.code !== code,
      error
    });
    return !error;
  }

  /** Steps through every effect, for a key binding */
  cycle(direction: 1 | -1 = 1) {
    const { effects, active } = this.store.get();
    const index = effects.findIndex((effect) => effect.id === active);
    const next = effects[(index + direction + effects.length) % effects.length];
    return this.select(next.id)!;
  }

  // —— gifs ——

  /** Decoded frames of a stored gif, cached */
  decode(id: string) {
    let decoded = this.decoded.get(id);
    if (!decoded) {
      decoded = Library.gif(id).then((record) => {
        if (!record) throw new Error("gif not found");
        return decodeGif(record.blob);
      });
      decoded.catch(() => this.decoded.delete(id));
      this.decoded.set(id, decoded);
    }
    return decoded;
  }

  /**
   * Plays a gif: the effect's own, else the latest import. Hydra reads it
   * as gif(), the shaders as iChannel0.
   */
  async bindGif(id = this.activeEffect?.gifId) {
    const gifs = this.store.get().gifs;
    const gifId = id && gifs.some((gif) => gif.id === id) ? id : gifs[0]?.id;
    if (!gifId) {
      this.gif.set(undefined, undefined, 4);
      this.store.set({ gifId: undefined, beats: undefined });
      return;
    }
    if (gifId === this.gif.id && this.gif.loaded) {
      this.setLoop(this.store.get().beatsSetting);
      this.store.set({ gifId });
      return;
    }
    try {
      const decoded = await this.decode(gifId);
      const beats = this.store.get().beatsSetting ?? loopBeats(decoded.duration, Transport.bpm);
      this.gif.set(gifId, decoded, beats);
      Hydra.bindGif(this.gif.canvas);
      this.store.set({ gifId, beats });
    } catch (error) {
      this.store.set({ error: `gif: ${(error as Error).message}` });
    }
  }

  /** Loop length in beats for the gif, auto when unset */
  async setLoop(beats?: number) {
    this.store.set({ beatsSetting: beats });
    const gifId = this.gif.id;
    if (!gifId) return;
    const decoded = await this.decode(gifId);
    this.gif.beats = beats ?? loopBeats(decoded.duration, Transport.bpm);
    this.store.set({ beats: this.gif.beats });
  }

  /** Imports a gif (or other animated image, or a video) and makes a gif effect of it */
  async importGif(blob: Blob, name: string, source?: string) {
    // decode first, so broken files are refused before they are stored
    const decoded = await decodeGif(blob);
    const record: GifRecord = {
      id: `gif-${crypto.randomUUID().slice(0, 8)}`,
      name: name.replace(GifExtension, "").slice(0, 60) || "gif",
      blob,
      source,
      createdAt: Date.now()
    };
    await Library.saveGif(record);
    this.decoded.set(record.id, Promise.resolve(decoded));

    const effect: Effect = {
      id: newId(),
      name: record.name,
      kind: "gif",
      code: GifTemplate,
      gifId: record.id,
      updatedAt: Date.now()
    };
    await Library.saveEffect(effect);
    await this.refresh();
    this.select(effect.id);
    return effect;
  }

  async removeGif(id: string) {
    await Library.deleteGif(id);
    const decoded = await this.decoded.get(id)?.catch(() => undefined);
    if (decoded) releaseGif(decoded);
    this.decoded.delete(id);
    await this.refresh();
    if (this.gif.id === id) {
      this.gif.set(undefined, undefined, 4);
      this.bindGif();
    }
  }

  // —— the library ——

  /**
   * Saves the running code: over the user's effect, or as a new copy when
   * the active one is built in. The gif and loop setting go with it.
   */
  async save(code = this.store.get().code, name?: string) {
    const state = this.store.get();
    const current = this.activeEffect;
    const copy = !current || current.builtIn;
    const effect: Effect = {
      id: copy ? newId() : current.id,
      name: name || (copy ? `${current?.name || "effect"} copy` : current.name),
      kind: state.kind,
      code,
      description: current?.description,
      // a gif effect keeps the gif it shows, others only one picked by hand
      gifId: this.chosenGif ?? current?.gifId ?? (state.kind === "gif" ? state.gifId : undefined),
      beats: state.beatsSetting,
      updatedAt: Date.now()
    };
    await Library.saveEffect(effect);
    await this.refresh();
    this.store.set({ active: effect.id, edited: false });
    remember(effect.id);
    if (code !== state.code) this.run(code);
    return effect;
  }

  /** A new effect from a template */
  async create(kind: EffectKind) {
    const count = this.store.get().effects.filter((effect) => !effect.builtIn && effect.kind === kind).length;
    const effect: Effect = {
      id: newId(),
      name: `my ${kind === "shader" ? "shader" : kind} ${count + 1}`,
      kind,
      code: Templates[kind],
      updatedAt: Date.now()
    };
    await Library.saveEffect(effect);
    await this.refresh();
    return this.select(effect.id);
  }

  async duplicate(id: string) {
    const source = this.find(id);
    if (!source) return;
    const effect: Effect = {
      ...source,
      id: newId(),
      name: `${source.name} copy`,
      builtIn: undefined,
      updatedAt: Date.now()
    };
    await Library.saveEffect(effect);
    await this.refresh();
    return this.select(effect.id);
  }

  /**
   * Saves code for one effect, wherever it is edited (v2's effect tabs).
   * A built-in effect is never changed: the code becomes your own copy.
   */
  async saveCode(id: string, code: string) {
    const current = this.find(id);
    if (!current) return;
    const effect: Effect = current.builtIn
      ? { ...current, id: newId(), name: `${current.name} copy`, code, builtIn: undefined, updatedAt: Date.now() }
      : { ...current, code, updatedAt: Date.now() };
    await Library.saveEffect(effect);
    await this.refresh();
    // the / screen shows it: keep it showing the saved code
    if (this.store.get().active === id && !current.builtIn) this.run(code);
    return effect;
  }

  async rename(id: string, name: string) {
    const effect = this.find(id);
    if (!effect || effect.builtIn || !name.trim()) return;
    await Library.saveEffect({ ...effect, name: name.trim(), updatedAt: Date.now() });
    await this.refresh();
  }

  async remove(id: string) {
    const effect = this.find(id);
    if (!effect || effect.builtIn) return;
    await Library.deleteEffect(id);
    await this.refresh();
    if (this.store.get().active === id) this.select(DefaultPreset.id);
  }

  /** Binds a gif to the active effect (saved with it on the next save) */
  async useGif(id: string) {
    this.chosenGif = id;
    const effect = this.activeEffect;
    if (effect && !effect.builtIn) {
      await Library.saveEffect({ ...effect, gifId: id, updatedAt: Date.now() });
      await this.refresh();
    }
    await this.bindGif(id);
  }

  // —— frames ——

  /** A gif by id or name; the latest import when none is given */
  findGif(name?: string) {
    const gifs = this.store.get().gifs;
    if (name === undefined) return gifs[0];
    const needle = name.toLowerCase();
    return gifs.find((gif) => gif.id === name) || gifs.find((gif) => gif.name.toLowerCase() === needle);
  }

  /** The music, as shader uniforms */
  inputs(time: number, gif?: GifPlayer): ShaderInputs {
    const cycle = Transport.now();
    const data = Analysis.update(Math.floor(time));
    return {
      fft: data.bands,
      kick: data.kick,
      beat: Transport.position(cycle).phase,
      bar: cycle,
      bpm: Transport.bpm,
      levelA: data.decks.a,
      levelB: data.decks.b,
      xfade: Audio.store.get().crossfade,
      gif
    };
  }

  /** Steps the gif, then the effect showing; from the shared frame loop */
  frame(time: number) {
    const running = Transport.running;
    const cycle = Transport.now();
    this.gif.tick(running ? cycle * BeatsPerBar : undefined, time);

    if (this.store.get().kind === "hydra") {
      Hydra.frame(time);
      return;
    }
    Shader.frame(time, this.inputs(time, this.gif));
  }

  resize(width: number, height: number) {
    Hydra.resize(width, height);
    Shader.resize(width, height);
  }
}

export const Visuals = new VisualsProvider();
