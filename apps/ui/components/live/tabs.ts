import { atom, getDefaultStore } from "jotai";

import type { Pane } from "@/engine/modules/live/live.module";

/**
 * Each editor's tabs: the set is always there, effects (hydra, glsl) and
 * packs being edited ("pack:<id>") open next to it. `active` is "set" or
 * one of them.
 */
export type PaneTabs = { effects: string[]; active: string };
export type Tabs = Record<Pane, PaneTabs>;

const TabsKey = "lodecks.live.tabs";
const Empty: Tabs = { left: { effects: [], active: "set" }, right: { effects: [], active: "set" } };

const read = (): Tabs => {
  try {
    const saved = JSON.parse(localStorage.getItem(TabsKey) ?? "null");
    if (saved?.left && saved?.right) {
      // pack tabs used to be per deck ("pack:a"); now they are per pack
      const clean = (pane: PaneTabs): PaneTabs => {
        const effects = pane.effects.filter((id) => id !== "pack:a" && id !== "pack:b");
        return { effects, active: effects.includes(pane.active) ? pane.active : "set" };
      };
      return { left: clean(saved.left), right: clean(saved.right) };
    }
  } catch {}
  return Empty;
};

export const tabsAtom = atom<Tabs>(Empty);
const store = getDefaultStore();
let loaded = false;

/** The saved tabs, once, after the page is in the browser */
export const loadTabs = () => {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  store.set(tabsAtom, read());
};

const update = (change: (tabs: Tabs) => Tabs) => {
  const next = change(store.get(tabsAtom));
  store.set(tabsAtom, next);
  try {
    localStorage.setItem(TabsKey, JSON.stringify(next));
  } catch {}
};

/** Opens an effect as a tab of the pane (or shows it where it is open) */
export const openEffectTab = (pane: Pane, id: string) =>
  update((tabs) => {
    const other: Pane = pane === "left" ? "right" : "left";
    if (tabs[other].effects.includes(id) && !tabs[pane].effects.includes(id)) {
      return { ...tabs, [other]: { ...tabs[other], active: id } };
    }
    const effects = tabs[pane].effects.includes(id) ? tabs[pane].effects : [...tabs[pane].effects, id];
    return { ...tabs, [pane]: { effects, active: id } };
  });

/** A pack, edited in a tab on a deck of its own */
export const packTab = (packId: string) => `pack:${packId}`;
export const packOfTab = (id: string) => (id.startsWith("pack:") ? id.slice(5) : undefined);

/** The settings, as a tab: palette, deck colours, new sets */
export const SettingsTab = "settings";
export const openSettingsTab = (pane: Pane = "left") => openEffectTab(pane, SettingsTab);

/** Opens a pack in the pack editor, as a tab */
export const openPackTab = (packId: string, pane: Pane = "left") => openEffectTab(pane, packTab(packId));

export const showTab = (pane: Pane, active: string) => update((tabs) => ({ ...tabs, [pane]: { ...tabs[pane], active } }));

export const closeTab = (pane: Pane, id: string) =>
  update((tabs) => {
    const effects = tabs[pane].effects.filter((item) => item !== id);
    const index = tabs[pane].effects.indexOf(id);
    const active = tabs[pane].active !== id ? tabs[pane].active : (effects[Math.min(index, effects.length - 1)] ?? "set");
    return { ...tabs, [pane]: { effects, active } };
  });

/** A saved built-in becomes a copy: its tabs follow the new id */
export const replaceTab = (from: string, to: string) =>
  update((tabs) => {
    const swap = (pane: PaneTabs): PaneTabs => ({
      effects: pane.effects.map((item) => (item === from ? to : item)),
      active: pane.active === from ? to : pane.active
    });
    return { left: swap(tabs.left), right: swap(tabs.right) };
  });

/** Tabs of effects that no longer exist close */
export const pruneTabs = (exists: (id: string) => boolean) =>
  update((tabs) => {
    const prune = (pane: PaneTabs): PaneTabs => {
      const effects = pane.effects.filter(exists);
      return { effects, active: pane.active === "set" || effects.includes(pane.active) ? pane.active : "set" };
    };
    const next = { left: prune(tabs.left), right: prune(tabs.right) };
    return JSON.stringify(next) === JSON.stringify(tabs) ? tabs : next;
  });
