import { getDefaultStore } from "jotai";

import { recordModeAtom } from "~/utils/recorder.util";

import { DeckId } from "@/common/constants/deck.constant";

import { focusedEditor, liveEditors } from "@/components/live/editor";
import { clearInline } from "@/components/live/editor/widgets";
import { useDeck, useEngine, useTransport } from "@/hooks/engine.hook";
import { AudioFile, useCatalog, useImportSong, useOpenInEditor } from "@/hooks/import.hook";
import { useLiveState } from "@/hooks/live.hook";

/** Something the command palette can do */
export type PaletteCommand = {
  id: string;
  title: string;
  // shown on the right, eg. "deck", "set", "pack"
  group: string;
  // its keyboard shortcut, as shown
  keys?: string;
  detail?: string;
  run?: () => unknown;
  // asks for text first (a name, a tempo), then runs with it
  ask?: { placeholder: string; initial?: string; run: (text: string) => unknown };
};

const pickSong = (importSong: (file: File) => unknown) => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "audio/*";
  input.onchange = () => {
    const file = input.files?.[0];
    if (file && AudioFile.test(file.name)) importSong(file);
  };
  input.click();
};

/** The commands that make sense right now, on this screen */
export const useCommands = (): PaletteCommand[] => {
  const engine = useEngine();
  const transport = useTransport();
  const live = useLiveState();
  const catalog = useCatalog();
  const decks = { a: useDeck("a"), b: useDeck("b") };
  const openInEditor = useOpenInEditor();
  const importSong = useImportSong();
  if (!engine) return [];

  const pane = liveEditors.focused;
  const commands: PaletteCommand[] = [];
  const add = (command: PaletteCommand) => commands.push(command);

  // —— the live editor ——
  add({ id: "run.block", title: "Run block", group: "code", keys: "⌘↵", run: () => focusedEditor().runCurrent?.() });
  add({ id: "run.all", title: "Run all blocks", group: "code", keys: "⇧⌘↵", run: () => focusedEditor().runAll?.() });
  add({ id: "record.landscape", title: "Recording mode: 16:9 (YouTube)", group: "video", run: () => getDefaultStore().set(recordModeAtom, "landscape") });
  add({ id: "record.portrait", title: "Recording mode: 9:16 (Reels, TikTok, Shorts)", group: "video", run: () => getDefaultStore().set(recordModeAtom, "portrait") });
  add({ id: "panic", title: "Panic: stop decks, schedules and bindings", group: "code", keys: "⌘. ⌘.", run: () => engine.live.panic() });
  add({
    id: "inline.clear",
    title: "Clear results and components in this editor",
    group: "code",
    run: () => focusedEditor().view?.dispatch({ effects: clearInline.of(null) })
  });
  add({
    id: "split.toggle",
    title: live.right ? "Split view: close the right editor" : "Split view: open a second editor",
    group: "view",
    keys: "⌘\\",
    run: () => (live.right ? engine.live.unsplit() : engine.live.split())
  });
  const current = pane === "right" && live.right ? live.right : live.set;
  const other = pane === "right" ? live.set.id : live.right?.id;
  add({
    id: "set.save",
    title: `Set: save "${current.name}"`,
    group: "set",
    keys: "⌘S",
    run: () => engine.live.saveCode(focusedEditor().view?.state.doc.toString() ?? "", true, pane)
  });
  add({
    id: "set.new",
    title: "Set: new…",
    group: "set",
    ask: {
      placeholder: "name of the new set",
      run: async (name) => liveEditors[pane].setDoc?.(await engine.live.newSet(name, pane))
    }
  });
  add({
    id: "set.rename",
    title: `Set: rename "${current.name}"…`,
    group: "set",
    ask: { placeholder: "new name", initial: current.name, run: (name) => engine.live.renameSet(name, pane) }
  });
  for (const set of live.sets) {
    if (set.id === current.id || set.id === other) continue;
    add({
      id: `set.open.${set.id}`,
      title: `Set: open "${set.name}"`,
      group: "set",
      run: async () => liveEditors[pane].setDoc?.(await engine.live.openSet(set.id, pane))
    });
  }
  if (engine.live.layers.store.get().list.length) {
    add({ id: "visuals.full", title: "Visuals: full screen", group: "visuals", run: () => engine.live.store.set({ full: true }) });
  }
  if (live.background) {
    add({ id: "visuals.background.off", title: "Visuals: remove the background", group: "visuals", run: () => engine.live.store.set({ background: undefined }) });
  }

  // —— clock and mixer ——
  add({
    id: "clock.toggle",
    title: transport.started ? "Clock: stop" : "Clock: start",
    group: "clock",
    keys: transport.started ? "space space" : "space",
    run: () => (transport.started ? engine.stop() : engine.start())
  });
  add({
    id: "clock.bpm",
    title: `Tempo: set… (now ${transport.bpm.toFixed(1)})`,
    group: "clock",
    ask: {
      placeholder: "beats per minute",
      initial: String(transport.bpm),
      run: (text) => {
        const bpm = Number(text);
        if (Number.isFinite(bpm) && bpm > 0) engine.transport.setBpm(bpm);
      }
    }
  });
  for (const [label, value] of [["A", 0], ["the middle", 0.5], ["B", 1]] as const) {
    add({ id: `xfade.${value}`, title: `Crossfader: to ${label}`, group: "mixer", run: () => engine.audio.setCrossfade(value) });
  }
  if (engine.automix.store.get().status !== "idle") {
    add({ id: "automix.cancel", title: "Auto mix: cancel", group: "mixer", run: () => engine.automix.cancel() });
  }

  // —— decks ——
  for (const id of ["a", "b"] as DeckId[]) {
    const deck = decks[id];
    const name = `Deck ${id.toUpperCase()}`;
    if (!deck.pack) continue;
    const instance = engine.decks[id];
    const playing = instance.songPlaying();
    add({
      id: `deck.${id}.play`,
      title: `${name}: ${playing ? "stop" : "play"} ${deck.pack.title}`,
      group: "deck",
      run: async () => {
        if (playing) return instance.stopAll();
        if (!engine.transport.running) await engine.start();
        instance.startSong();
      }
    });
    add({
      id: `deck.${id}.take`,
      title: `${name}: take over from the other deck…`,
      group: "deck",
      ask: {
        placeholder: "bars of blend (16)",
        initial: "16",
        run: (text) => {
          const state = engine.automix.arm({ to: id, length: Number(text) || 16 });
          if (state.error) engine.live.say("error", state.error);
        }
      }
    });
    add({ id: `deck.${id}.infinite`, title: `${name}: infinite jukebox ${deck.infinite ? "off" : "on"}`, group: "deck", run: () => instance.setInfinite(!deck.infinite) });
    add({ id: `deck.${id}.sync`, title: `${name}: master tempo = ${deck.pack.bpm} bpm`, group: "deck", run: () => engine.syncTempo(id) });
    if (deck.transpose) {
      add({
        id: `deck.${id}.untune`,
        title: `${name}: back to its own key (${deck.pack.key})`,
        group: "deck",
        run: () => instance.glideTranspose(0, (4 * 60) / engine.transport.store.get().bpm)
      });
    }
    const other = decks[id === "a" ? "b" : "a"];
    if (other.pack) {
      add({
        id: `deck.${id}.tune`,
        title: `${name}: tune into deck ${id === "a" ? "B" : "A"}'s key (${other.pack.key})`,
        group: "deck",
        run: () => engine.syncKey(id, undefined, (4 * 60) / engine.transport.store.get().bpm)
      });
    }
    add({ id: `deck.${id}.edit`, title: `${name}: edit "${deck.pack.title}" in the pack editor`, group: "deck", run: () => openInEditor(deck.packId!) });
    add({ id: `deck.${id}.eject`, title: `${name}: eject`, group: "deck", run: () => engine.eject(id) });
  }

  // —— packs ——
  add({ id: "pack.import", title: "Import a song…", group: "pack", detail: "or drop it anywhere", run: () => pickSong(importSong) });
  for (const pack of catalog.packs) {
    for (const id of ["a", "b"] as DeckId[]) {
      add({
        id: `pack.${pack.id}.${id}`,
        title: `Load "${pack.title}" on deck ${id.toUpperCase()}`,
        group: "pack",
        detail: `${Math.round(pack.bpm * 10) / 10} · ${pack.key}${pack.source === "remote" ? " · download" : pack.source === "new" ? " · not saved" : ""}`,
        run: () => engine.load(id, pack.id)
      });
    }
    add({ id: `pack.${pack.id}.edit`, title: `Edit "${pack.title}" in the pack editor`, group: "pack", run: () => openInEditor(pack.id) });
  }

  return commands;
};
