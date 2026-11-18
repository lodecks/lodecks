import { DeckId } from "@/common/constants/deck.constant";
import {
  DefaultDeckColors,
  DefaultPalette,
  PaletteId,
  Palettes,
  hexToRgb,
  isHexColor
} from "@/common/constants/theme.constant";

import { Store } from "../utils/store.util";

/**
 * The player's settings, kept in this browser. Light on purpose: the
 * settings page and the page's first paint read it before the engine loads.
 */
export type Settings = {
  palette: PaletteId;
  deckColors: Record<DeckId, string>;
  // new sets start with example code; off, they start empty
  starterCode: boolean;
  // the editor's docs while typing: descriptions and signatures in the
  // suggestions, docs on hover, the argument hint's text. Off, it stays
  // quiet: names only, for playing a set
  editorDocs: boolean;
};

export const SettingsKey = "lodecks.settings";

export const DefaultSettings: Settings = { palette: DefaultPalette, deckColors: DefaultDeckColors, starterCode: true, editorDocs: true };

/** Whatever was saved, with anything unknown or broken back to its default */
export const readSettings = (raw: unknown): Settings => {
  const saved = (raw && typeof raw === "object" ? raw : {}) as Partial<Settings>;
  const colors = (saved.deckColors ?? {}) as Partial<Record<DeckId, unknown>>;
  return {
    palette: Palettes.some((palette) => palette.id === saved.palette) ? (saved.palette as PaletteId) : DefaultPalette,
    deckColors: {
      a: isHexColor(colors.a) ? colors.a : DefaultDeckColors.a,
      b: isHexColor(colors.b) ? colors.b : DefaultDeckColors.b
    },
    starterCode: typeof saved.starterCode === "boolean" ? saved.starterCode : true,
    editorDocs: typeof saved.editorDocs === "boolean" ? saved.editorDocs : true
  };
};

const load = (): Settings => {
  try {
    return readSettings(JSON.parse(localStorage.getItem(SettingsKey) ?? "null"));
  } catch {
    return DefaultSettings;
  }
};

class SettingsProvider {
  store = new Store<Settings>(typeof window === "undefined" ? DefaultSettings : load());
  private rgb?: { a: [number, number, number]; b: [number, number, number]; from: Record<DeckId, string> };

  set(update: Partial<Settings>) {
    this.store.set(readSettings({ ...this.store.get(), ...update }));
    try {
      localStorage.setItem(SettingsKey, JSON.stringify(this.store.get()));
    } catch {
      // storage blocked: the settings last until the page closes
    }
  }

  reset() {
    this.set(DefaultSettings);
  }

  /** Deck colours as 0..1 rgb, for shaders; cached until they change */
  deckRgb() {
    const colors = this.store.get().deckColors;
    if (this.rgb?.from !== colors) this.rgb = { a: hexToRgb(colors.a), b: hexToRgb(colors.b), from: colors };
    return this.rgb;
  }
}

export const Settings = new SettingsProvider();
