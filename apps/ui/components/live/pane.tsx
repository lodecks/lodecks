import { useAtomValue } from "jotai";
import { FileCode2, Package, Settings as SettingsIcon, X } from "lucide-react";
import { useEffect, useReducer, useRef } from "react";

import type { Pane } from "@/engine/modules/live/live.module";

import { PackEditor } from "@/components/pack/editor";
import { SettingsPanel } from "@/layouts/settings";
import type { DeckState } from "@/common/types/deck.type";
import type { Engine } from "@/engine/index";

import { useEngine, useVisuals } from "@/hooks/engine.hook";
import { useStore } from "@/providers/engine.provider";
import { usePackSave } from "@/hooks/pack-save.hook";
import { useLiveState } from "@/hooks/live.hook";
import { cn } from "~/utils/classes.util";

import { LiveEditor } from "./editor";
import { EffectEditor, dropEffectEditor, isDirty, onDirty } from "./effect-editor";
import { SettingsTab, closeTab, loadTabs, packOfTab, packTab, pruneTabs, showTab, tabsAtom } from "./tabs";

type EngineType = typeof Engine;
// while the engine is not there yet
const NoPack: Partial<DeckState> = {};

const KindColor = { hydra: "bg-deck-b", shader: "bg-code", gif: "bg-warn" };

const close = (pane: Pane, id: string, name: string) => {
  if (isDirty(id) && !confirm(`"${name}" has changes not saved (⌃s). Close it anyway?`)) return;
  dropEffectEditor(id);
  closeTab(pane, id);
};

/** The tabs of one editor: its set, then any effects opened next to it */
export const PaneTabStrip = ({ pane }: { pane: Pane }) => {
  const tabs = useAtomValue(tabsAtom)[pane];
  const visuals = useVisuals();
  const live = useLiveState();
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  useEffect(() => onDirty(refresh), []);

  const setName = (pane === "left" ? live.set : live.right)?.name ?? "set";
  const tab = "group flex h-7 max-w-48 shrink-0 items-center gap-1.5 border-r border-[var(--color-line)] px-3 text-[12px]";

  return (
    <div className="border-line flex h-7 shrink-0 items-stretch border-b">
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        <button
            className={cn(tab, tabs.active === "set" ? "text-bright bg-white/[0.04]" : "text-dim hover:text-text")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => showTab(pane, "set")}
            title="the set"
          >
            <FileCode2 size={12} strokeWidth={1.75} className="text-deck-a shrink-0" />
            <span className="truncate">{setName}</span>
          </button>
        {tabs.effects.map((id) => {
          const packId = packOfTab(id);
          if (packId) return <PackTabLabel key={id} pane={pane} packId={packId} active={tabs.active === id} />;
          if (id === SettingsTab) return <SettingsTabLabel key={id} pane={pane} active={tabs.active === id} />;
          const effect = visuals.effects.find((item) => item.id === id);
          const name = effect?.name ?? "…";
          const active = tabs.active === id;
          const dirty = isDirty(id);
          return (
            <div
              key={id}
              role="tab"
              className={cn(tab, "cursor-pointer pr-1.5", active ? "text-bright bg-white/[0.04]" : "text-dim hover:text-text")}
              onMouseDown={(event) => {
                event.preventDefault();
                if (event.button === 1) close(pane, id, name);
              }}
              onClick={() => showTab(pane, id)}
              title={`${name} · ${effect?.kind === "hydra" ? "hydra" : "glsl"}${effect?.builtIn ? " · built in" : ""}`}
            >
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", effect ? KindColor[effect.kind] : "bg-dim")} />
              <span className="truncate">{name}</span>
              <button
                className="hover:text-bright flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] hover:bg-white/[0.08]"
                onClick={(event) => {
                  event.stopPropagation();
                  close(pane, id, name);
                }}
                title="close (middle click)"
              >
                {dirty ? <span className="group-hover:hidden">●</span> : null}
                <X size={11} strokeWidth={1.75} className={cn(dirty ? "hidden group-hover:block" : "opacity-0 group-hover:opacity-100", active && !dirty && "opacity-60")} />
              </button>
            </div>
          );
        })}
      </div>
      {/* tabs of deleted effects close */}
      <Prune ids={visuals.effects.map((effect) => effect.id)} loaded={visuals.loaded} />
    </div>
  );
};

const Prune = ({ ids, loaded }: { ids: string[]; loaded: boolean }) => {
  const key = ids.join(",");
  useEffect(() => {
    if (loaded) pruneTabs((id) => !!packOfTab(id) || id === SettingsTab || ids.includes(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loaded]);
  return null;
};

/** Closes a pack's tab; its editor lets the pack go (asks when edited) */
const closePack = (engine: EngineType | undefined, pane: Pane, packId: string) => {
  const deck = engine?.editors.get(packId);
  const title = deck?.store.get().pack?.title ?? packId;
  if (deck?.store.get().edited && !confirm(`"${title}" has edits not saved (⌃s). Close it anyway?`)) return;
  closeTab(pane, packTab(packId));
  engine?.closeEditor(packId);
};

/** A pack's tab: its title, a dot while it has edits not saved */
const PackTabLabel = ({ pane, packId, active }: { pane: Pane; packId: string; active: boolean }) => {
  const engine = useEngine();
  const deck = engine?.openEditor(packId);
  const state = useStore<Partial<DeckState>>(deck?.store, NoPack);
  const id = packTab(packId);
  return (
    <div
      role="tab"
      className={cn(
        "group flex h-7 max-w-56 shrink-0 cursor-pointer items-center gap-1.5 border-r border-[var(--color-line)] pr-1.5 pl-3 text-[12px]",
        active ? "text-bright bg-white/[0.04]" : "text-dim hover:text-text"
      )}
      onMouseDown={(event) => {
        event.preventDefault();
        if (event.button === 1) closePack(engine, pane, packId);
      }}
      onClick={() => showTab(pane, id)}
      title={`${state.pack?.title ?? packId} · the pack editor · cues, layers, names`}
    >
      <Package size={12} strokeWidth={1.75} className="text-code shrink-0" />
      <span className="truncate">{state.pack?.title ?? packId}</span>
      <button
        className="hover:text-bright flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] hover:bg-white/[0.08]"
        onClick={(event) => {
          event.stopPropagation();
          closePack(engine, pane, packId);
        }}
        title="close (middle click)"
      >
        {state.edited ? <span className="group-hover:hidden">●</span> : null}
        <X size={11} strokeWidth={1.75} className={cn(state.edited ? "hidden group-hover:block" : "opacity-0 group-hover:opacity-100", active && !state.edited && "opacity-60")} />
      </button>
    </div>
  );
};

/** The settings' tab: nothing to save, they apply as they change */
const SettingsTabLabel = ({ pane, active }: { pane: Pane; active: boolean }) => (
  <div
    role="tab"
    className={cn(
      "group flex h-7 shrink-0 cursor-pointer items-center gap-1.5 border-r border-[var(--color-line)] pr-1.5 pl-3 text-[12px]",
      active ? "text-bright bg-white/[0.04]" : "text-dim hover:text-text"
    )}
    onMouseDown={(event) => {
      event.preventDefault();
      if (event.button === 1) closeTab(pane, SettingsTab);
    }}
    onClick={() => showTab(pane, SettingsTab)}
    title="settings · palette, deck colours, new sets"
  >
    <SettingsIcon size={12} strokeWidth={1.75} className="text-muted shrink-0" />
    <span className="truncate">settings</span>
    <button
      className="hover:text-bright flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] hover:bg-white/[0.08]"
      onClick={(event) => {
        event.stopPropagation();
        closeTab(pane, SettingsTab);
      }}
      title="close (middle click)"
    >
      <X size={11} strokeWidth={1.75} className={cn("opacity-0 group-hover:opacity-100", active && "opacity-60")} />
    </button>
  </div>
);

/** The pack editor in a tab, on a deck of its own; Ctrl+S saves it */
const PackTab = ({ pane, packId }: { pane: Pane; packId: string }) => {
  const save = usePackSave();
  const engine = useEngine();
  const box = useRef<HTMLDivElement>(null);
  const deck = engine?.openEditor(packId);
  useEffect(() => box.current?.focus(), []);
  if (!deck) return null;
  return (
    <div
      ref={box}
      tabIndex={-1}
      className="min-h-0 min-w-0 flex-1 overflow-hidden p-1.5 outline-none"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          save(deck);
        }
      }}
    >
      <PackEditor instance={deck} onClose={() => closePack(engine, pane, packId)} />
    </div>
  );
};

/** One editor and its tabs: the set's code, or the open effect's */
export const EditorPane = ({ pane }: { pane: Pane }) => {
  useEffect(loadTabs, []);
  const tabs = useAtomValue(tabsAtom)[pane];
  const live = useLiveState();
  const open = tabs.active !== "set" && tabs.effects.includes(tabs.active);
  const packId = open ? packOfTab(tabs.active) : undefined;

  return (
    <>
      {/* only once an effect is open: a set alone needs no tabs */}
      {tabs.effects.length > 0 && <PaneTabStrip pane={pane} />}
      {packId ? (
        <PackTab key={tabs.active} pane={pane} packId={packId} />
      ) : tabs.active === SettingsTab && open ? (
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <SettingsPanel />
        </div>
      ) : open ? (
        <EffectEditor key={tabs.active} id={tabs.active} />
      ) : null}
      {/* the set's editor stays mounted behind other tabs: it is what loads the set */}
      <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", open && "hidden")}>
        {pane === "right" ? (
          // keyed by the set, so opening another set starts a fresh editor
          <LiveEditor key={live.right?.id} pane="right" />
        ) : (
          <LiveEditor pane="left" />
        )}
      </div>
    </>
  );
};
