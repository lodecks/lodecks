import { useEffect } from "react";

import { DeckId } from "@/common/constants/deck.constant";
import { Palettes, paletteOf, themeVariables } from "@/common/constants/theme.constant";
import { DefaultSettings, Settings, SettingsKey } from "@/engine/providers/settings.provider";

import { Colors } from "./canvas.hook";

/** Sets a palette and the deck colours: css variables on the page, and the canvas colours */
export const applyTheme = (palette: string, decks: Record<DeckId, string>) => {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(themeVariables(palette, decks))) root.style.setProperty(name, value);
  const colors = paletteOf(palette).colors;
  Object.assign(Colors, {
    a: decks.a,
    b: decks.b,
    tan: colors.code,
    gray: colors.gray,
    line: colors.line,
    dim: colors.dim,
    text: colors.text,
    ink: colors.screen
  });
};

/** Keeps the page in step with the settings, on this tab and on others */
export const useTheme = () => {
  useEffect(() => {
    const apply = () => {
      const { palette, deckColors } = Settings.store.get();
      applyTheme(palette, deckColors);
    };
    apply();
    const unsubscribe = Settings.store.subscribe(apply);
    // another tab changed them
    const sync = (event: StorageEvent) => {
      if (event.key === SettingsKey) Settings.store.set(JSON.parse(event.newValue ?? "null") ?? DefaultSettings);
    };
    window.addEventListener("storage", sync);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", sync);
    };
  }, []);
};

/**
 * Runs in <head> before the page paints, so a saved palette shows without
 * a flash of the default one. Kept small: no imports, just the variables.
 */
export const themeScript = () => {
  const palettes = Object.fromEntries(Palettes.map((palette) => [palette.id, themeVariables(palette.id, DefaultSettings.deckColors)]));
  return `(function(){try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(SettingsKey)})||"null");if(!s)return;var p=${JSON.stringify(palettes)};var v=p[s.palette]||p.lodecks;var d=s.deckColors||{};var h=/^#[0-9a-f]{6}$/i;if(h.test(d.a))v["--color-deck-a"]=d.a;if(h.test(d.b))v["--color-deck-b"]=d.b;var r=document.documentElement.style;for(var k in v)r.setProperty(k,v[k]);}catch(e){}})();`;
};
