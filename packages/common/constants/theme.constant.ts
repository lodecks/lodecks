import { DeckId } from "./deck.constant";

/**
 * The look of lodecks: a palette (the surfaces and the text, all dark) and
 * a colour per deck. Each value is a css variable from apps/ui/css/base.css.
 */
export type PaletteColors = {
  ink: string;
  chassis: string;
  panel: string;
  raised: string;
  key: string;
  screen: string;
  popover: string;
  line: string;
  lineStrong: string;
  dim: string;
  muted: string;
  text: string;
  bright: string;
  code: string;
  gray: string;
};

export type Palette = { id: string; name: string; description: string; colors: PaletteColors };

export const Palettes = [
  {
    id: "lodecks",
    name: "lodecks",
    description: "cool blue-black, the default",
    colors: {
      ink: "#070a10",
      chassis: "#0a0d14",
      panel: "#0c1018",
      raised: "#121823",
      key: "#161d2a",
      screen: "#03050a",
      popover: "#0b0f17",
      line: "#1c2433",
      lineStrong: "#2a3446",
      dim: "#56627a",
      muted: "#8491aa",
      text: "#c9d3e6",
      bright: "#eef3ff",
      code: "#a78bfa",
      gray: "#8f9bb3"
    }
  },
  {
    id: "ember",
    name: "ember",
    description: "warm, like a club after midnight",
    colors: {
      ink: "#0d0907",
      chassis: "#120d0a",
      panel: "#16100c",
      raised: "#1e1611",
      key: "#251b15",
      screen: "#070504",
      popover: "#140e0b",
      line: "#2e2219",
      lineStrong: "#403024",
      dim: "#74604f",
      muted: "#a68f7c",
      text: "#e3d4c6",
      bright: "#fdf3e9",
      code: "#f2a65e",
      gray: "#ab9786"
    }
  },
  {
    id: "abyss",
    name: "abyss",
    description: "deep ocean blue",
    colors: {
      ink: "#040a13",
      chassis: "#07101c",
      panel: "#091423",
      raised: "#0e1c30",
      key: "#122339",
      screen: "#02060c",
      popover: "#081220",
      line: "#16294a",
      lineStrong: "#213b63",
      dim: "#4d6990",
      muted: "#7d99bd",
      text: "#c3d6f0",
      bright: "#ebf4ff",
      code: "#79c2ff",
      gray: "#8aa3c4"
    }
  },
  {
    id: "contrast",
    name: "contrast",
    description: "pure black and bright text, for stages and projectors",
    colors: {
      ink: "#000000",
      chassis: "#000000",
      panel: "#050505",
      raised: "#0e0e0e",
      key: "#161616",
      screen: "#000000",
      popover: "#0a0a0a",
      line: "#3a3a3a",
      lineStrong: "#5c5c5c",
      dim: "#929292",
      muted: "#bdbdbd",
      text: "#f0f0f0",
      bright: "#ffffff",
      code: "#c9adff",
      gray: "#b4b4b4"
    }
  }
] as const satisfies readonly Palette[];

export type PaletteId = (typeof Palettes)[number]["id"];

export const DefaultPalette: PaletteId = "lodecks";

export const DefaultDeckColors: Record<DeckId, string> = { a: "#2be8a0", b: "#ff3fb4" };

/** Colours offered for a deck; any other can be picked too */
export const DeckSwatches = ["#2be8a0", "#ff3fb4", "#34c8ff", "#ffb020", "#b07cff", "#ff5a4f", "#c6f432", "#f5f5f5"];

export const paletteOf = (id: string): Palette => Palettes.find((palette) => palette.id === id) ?? Palettes[0];

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** The css variables a palette and the deck colours set */
export const themeVariables = (palette: string, decks: Record<DeckId, string>) => ({
  ...Object.fromEntries(Object.entries(paletteOf(palette).colors).map(([name, value]) => [`--color-${kebab(name)}`, value])),
  "--color-deck-a": decks.a,
  "--color-deck-b": decks.b
});

/** "#2be8a0" → [0.17, 0.91, 0.63], for shaders */
export const hexToRgb = (hex: string): [number, number, number] => {
  const value = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? "ffffff";
  return [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16) / 255) as [number, number, number];
};

export const isHexColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
