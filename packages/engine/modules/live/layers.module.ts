/**
 * Visual layers declared by the set: GLSL, gifs, hydra or saved effects,
 * stacked in the order they are declared and blended together.
 */
import { Store } from "../../utils/store.util";

export const Blends = ["normal", "add", "screen", "multiply"] as const;
export type Blend = (typeof Blends)[number];

export type LayerSource =
  // a Shadertoy-style shader; `gif` names the gif it reads as iChannel0
  // `camera`: iChannel0 is the webcam instead
  | { kind: "glsl"; code: string; gif?: string; camera?: boolean }
  | { kind: "hydra"; code: string };

/** Where a boxed layer sits, like a picture in picture */
export const Corners = ["bottom-right", "bottom-left", "top-right", "top-left", "center"] as const;
export type Corner = (typeof Corners)[number];

// a layer drawn small, in the screen's shape: size is its width (and
// height) as a share of the screen's, a number or read every frame
export type Box = { corner: Corner; size: number | (() => number) };

// room between a boxed layer and the edges, as a share of the screen
const Inset = 0.025;
const MinSize = 0.05;

export type Layer = {
  name: string;
  source: LayerSource;
  blend: Blend;
  // a number, or read every frame
  opacity: number | (() => number);
  // drawn in a box instead of over the whole screen
  box?: Box;
  order: number;
};

export type LayerOptions = { blend?: string; opacity?: number | (() => number); box?: Box };

export const parseCorner = (value: unknown): Corner | undefined => {
  const corner = String(value).toLowerCase().replace(/[\s_]+/g, "-");
  return (Corners as readonly string[]).includes(corner) ? (corner as Corner) : undefined;
};

/**
 * The box on screen, in 0…1 with y up (as WebGL reads it): x, y of its
 * lower left corner, then width and height. The whole screen when unboxed.
 */
export const boxRect = (box?: Box): [number, number, number, number] => {
  if (!box) return [0, 0, 1, 1];
  let size: number;
  try {
    size = Number(typeof box.size === "function" ? box.size() : box.size);
  } catch {
    size = 1;
  }
  if (!Number.isFinite(size)) size = 1;
  size = Math.max(MinSize, Math.min(1, size));
  // a full-size box has no room for the inset
  const inset = Math.min(Inset, (1 - size) / 2);
  const far = 1 - inset - size;
  const centre = (1 - size) / 2;
  const [x, y] = {
    "bottom-right": [far, inset],
    "bottom-left": [inset, inset],
    "top-right": [far, far],
    "top-left": [inset, far],
    center: [centre, centre]
  }[box.corner];
  return [x, y, size, size];
};

// the compositor blends at most this many
export const MaxLayers = 6;

export class Layers {
  store = new Store<{ list: Layer[]; warning?: string }>({ list: [] });
  private draft?: Layer[];

  begin() {
    this.draft = [];
  }

  commit() {
    if (!this.draft) return;
    const list = this.draft;
    this.draft = undefined;
    const hydra = list.filter((layer) => layer.source.kind === "hydra");
    const warnings = [
      list.length > MaxLayers && `only the first ${MaxLayers} layers are shown`,
      hydra.length > 1 && "only one hydra layer can play, the last one wins"
    ].filter(Boolean);
    const kept = list
      .filter((layer) => layer.source.kind !== "hydra" || layer === hydra[hydra.length - 1])
      .slice(0, MaxLayers);
    this.store.set({ list: kept, warning: warnings.join(" · ") || undefined });
  }

  abort() {
    this.draft = undefined;
  }

  declare(name: string, source: LayerSource, options: LayerOptions = {}) {
    const blend = (Blends as readonly string[]).includes(options.blend ?? "")
      ? (options.blend as Blend)
      : "normal";
    const layer: Layer = {
      name,
      source,
      blend,
      opacity: options.opacity ?? 1,
      box: options.box,
      order: 0
    };
    if (this.draft) {
      const existing = this.draft.findIndex((item) => item.name === name);
      if (existing >= 0) this.draft.splice(existing, 1);
      layer.order = this.draft.length;
      this.draft.push(layer);
      return layer;
    }
    // outside an evaluation (eg. a button): replace or add right away
    const list = this.store.get().list.filter((item) => item.name !== name);
    layer.order = list.length;
    this.store.set({ list: [...list, layer].slice(0, MaxLayers) });
    return layer;
  }

  /** Replaces the whole stack */
  set(layers: ({ source: LayerSource } & LayerOptions)[]) {
    this.begin();
    layers.forEach((layer, index) => this.declare(`l${index}`, layer.source, layer));
    this.commit();
  }

  remove(name: string) {
    this.store.set({ list: this.store.get().list.filter((item) => item.name !== name) });
  }

  /** Opacity right now, 0…1 */
  static opacity(layer: Layer) {
    try {
      const value = typeof layer.opacity === "function" ? Number(layer.opacity()) : layer.opacity;
      return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
    } catch {
      return 0;
    }
  }
}
