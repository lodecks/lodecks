import type { DeckId } from "@/common/constants/deck.constant";
import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";

import type { Engine } from "@/engine/index";
import type { Pane } from "@/engine/modules/live/live.module";
import type { Block } from "@/engine/modules/live/runtime.module";

import { useEngine } from "@/hooks/engine.hook";

import { blockAtPos, blocksOf, ensureBlockId, flash, flashField, markerField, clearMarkers, startTracking, trackChanges } from "./editor/blocks";
import { completeOnTrigger, liveCompletion, liveHover, parameterHints } from "./editor/completion";
import { inlineControls } from "./editor/controls";
import { clearRan, ranExtension, setRan } from "./editor/ran";
import { editorTooltips, liveHighlight, liveTheme } from "./editor/theme";
import { InlineItem, addInline, clearInline, inlineContainers, inlineField, inlineIdsIn, removeBlockInline, removeInlineIds } from "./editor/widgets";

type EngineType = typeof Engine;

// panic takes a second Ctrl/⌘+. within a moment: one stray press only warns
const ConfirmWindow = 1500;
let panicArmedAt = 0;
const confirmPanic = (live: EngineType["live"]) => {
  if (performance.now() - panicArmedAt < ConfirmWindow) {
    panicArmedAt = 0;
    live.panic();
    // nothing runs any more: no block is live
    for (const pane of ["left", "right"] as Pane[]) liveEditors[pane].view?.dispatch({ effects: clearRan.of(null) });
    return;
  }
  panicArmedAt = performance.now();
  live.say("error", "⌘. again to stop everything");
};

/** What completion and hints ask the engine: names, packs, effects, tracks */
export const completionHost = (engine: EngineType) => {
  const live = engine.live;
  return {
    kindOf: (name: string) => live.kindOf(name),
    bindings: () => live.runtime.bindings(),
    packs: () => live.packNames(),
    effects: () => engine.visuals.store.get().effects.map((effect) => ({ name: effect.name, kind: effect.kind })),
    gifs: () => engine.visuals.store.get().gifs.map((gif) => gif.name),
    deckOf: (name: string) => live.deckOf(name),
    tracks: (deck?: DeckId) => live.tracksOf(deck)
  };
};

type EditorHandle = {
  view?: EditorView;
  run?: (block: Block) => Promise<void>;
  // the block under the cursor, and every block
  runCurrent?: () => void;
  runAll?: () => void;
  setDoc?: (code: string) => void;
};

/** The editors, reachable from the menus (open set, run all…) */
export const liveEditors: Record<Pane, EditorHandle> & { focused: Pane } = { left: {}, right: {}, focused: "left" };

/** The editor last typed in (the left one when the right is closed) */
export const focusedEditor = () => (liveEditors[liveEditors.focused].view ? liveEditors[liveEditors.focused] : liveEditors.left);
export const liveEditor = liveEditors.left;

/** The pane new tabs open in: the one last typed in, while it is open */
export const focusedPane = (): Pane => (liveEditors.focused === "right" && liveEditors.right.view ? "right" : "left");

// each editor as it was when it went away (leaving /play and back, closing the split):
// code, cursor, history and what was drawn inline all come back
const kept: Partial<Record<Pane, { state: EditorState; setId: string }>> = {};

const setIdOf = (live: EngineType["live"], pane: Pane) => (pane === "left" ? live.store.get().set.id : live.store.get().right?.id);

/** Components no editor (open or kept) still shows unmount */
const collect = (live: EngineType["live"]) => {
  const alive = new Set<string>();
  for (const pane of ["left", "right"] as Pane[]) {
    const state = liveEditors[pane].view?.state ?? kept[pane]?.state;
    if (state) for (const id of inlineIdsIn(state)) alive.add(id);
  }
  const gone = inlineContainers.ids().filter((id) => !alive.has(id));
  if (gone.length) {
    inlineContainers.drop(gone);
    live.forgetComponents(gone);
  }
};

const toggleSplit = (live: EngineType["live"]) => {
  if (live.store.get().right) live.unsplit();
  else live.split();
  return true;
};

let nextOutput = 0;

/**
 * Result and error lines stay until the next run (in either editor), so
 * the code never moves while it is being read or edited.
 */
const clearOutputs = () => {
  for (const pane of ["left", "right"] as Pane[]) {
    const target = liveEditors[pane].view;
    if (!target) continue;
    const ids = inlineIdsIn(target.state).filter((id) => id.startsWith("out-"));
    if (ids.length) target.dispatch({ effects: removeInlineIds.of(ids) });
  }
};

/** Runs one block of an editor and draws what it returned under its lines */
export const runBlock = async (engine: EngineType, view: EditorView, block: Block, clear = true) => {
  if (clear) clearOutputs();
  const blockId = ensureBlockId(view, block);
  flash(view, block);
  // a "press ⌘↵" warning has done its job once the block runs
  view.dispatch({ effects: [removeBlockInline.of(blockId), removeBlockInline.of("hint")] });
  const code = view.state.sliceDoc(block.from, block.to);
  const tracking = startTracking(view);
  try {
    const result = await engine.live.run(code, blockId, block.startLine);
    const items: InlineItem[] = [];
    const run = nextOutput++;
    result.outputs.forEach((output, index) =>
      items.push({ blockId, pos: tracking.lineEnd(output.line), order: index, type: "output", id: `out-${run}-${index}`, kind: output.kind, text: output.text })
    );
    result.components.forEach((component, index) =>
      items.push({ blockId, pos: tracking.lineEnd(component.line), order: 100 + index, type: "component", id: component.id })
    );
    engine.live.placeComponents(result.components);
    const failed = result.outputs.some((output) => output.kind === "error");
    view.dispatch({
      effects: [removeBlockInline.of(blockId), addInline.of(items), setRan.of({ id: blockId, status: failed ? "error" : "ok", text: code })]
    });

  } finally {
    tracking.stop();
  }
};

/** A set: write, put the cursor in a block, Ctrl+Enter */
export const LiveEditor = ({ pane = "left" }: { pane?: Pane }) => {
  const engine = useEngine();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!engine || !root.current) return;
    let disposed = false;
    let view: EditorView | undefined;
    const live = engine.live;

    const runCurrent = (target: EditorView) => {
      const block = blockAtPos(target.state.doc, target.state.selection.main.head);
      if (block) runBlock(engine, target, block);
      return true;
    };
    const runAll = (target: EditorView) => {
      (async () => {
        // one run: the lines from every block stay together
        clearOutputs();
        for (const block of blocksOf(target.state.doc)) await runBlock(engine, target, block, false);
      })();
      return true;
    };
    const jumpBlock = (direction: 1 | -1) => (target: EditorView) => {
      const blocks = blocksOf(target.state.doc);
      const head = target.state.selection.main.head;
      const next = direction > 0 ? blocks.find((block) => block.from > head) : [...blocks].reverse().find((block) => block.to < head && !(head >= block.from && head <= block.to));
      if (next) target.dispatch({ selection: { anchor: next.from }, scrollIntoView: true });
      return true;
    };

    const host = completionHost(engine);

    const handle = liveEditors[pane];
    live.paneCode(pane).then((code) => {
      if (disposed || !root.current) return;
      const setId = setIdOf(live, pane);
      const before = kept[pane];
      const restore = before && before.setId === setId && before.state.doc.toString() === code ? before.state : undefined;
      kept[pane] = undefined;
      view = new EditorView({
        parent: root.current,
        state: restore ?? EditorState.create({
          doc: code,
          extensions: [
            lineNumbers(),
            highlightActiveLineGutter(),
            history(),
            drawSelection(),
            indentOnInput(),
            bracketMatching(),
            closeBrackets(),
            highlightActiveLine(),
            highlightSelectionMatches(),
            javascript(),
            liveTheme,
            liveHighlight,
            editorTooltips,
            markerField,
            flashField,
            inlineField,
            trackChanges,
            inlineControls({ set: (id, value) => live.setControl(id, value), trigger: (id) => live.trigger(id), known: (id) => live.controls.has(id) }),
            ranExtension,
            autocompletion({ override: [liveCompletion(host)], icons: false, activateOnTypingDelay: 40 }),
            completeOnTrigger,
            parameterHints(host),
            liveHover(host),
            keymap.of([
              { key: "Mod-Enter", run: runCurrent, preventDefault: true },
              { key: "Shift-Mod-Enter", run: runAll, preventDefault: true },
              { key: "Mod-.", run: () => (confirmPanic(live), true), preventDefault: true },
              {
                key: "Mod-s",
                run: (target) => {
                  live.saveCode(target.state.doc.toString(), true, pane);
                  return true;
                },
                preventDefault: true
              },
              { key: "Mod-\\", run: () => toggleSplit(live), preventDefault: true },
              { key: "Alt-ArrowDown", run: jumpBlock(1) },
              { key: "Alt-ArrowUp", run: jumpBlock(-1) },
              // Tab takes the suggestion when one is open, else it indents
              { key: "Tab", run: acceptCompletion },
              ...closeBracketsKeymap,
              ...completionKeymap,
              ...searchKeymap,
              ...historyKeymap,
              indentWithTab,
              ...defaultKeymap
            ]),
            EditorView.domEventHandlers({
              focus: () => {
                liveEditors.focused = pane;
              }
            }),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) live.saveCode(update.state.doc.toString(), false, pane);
              // components whose widget left every editor unmount
              collect(live);
            })
          ]
        })
      });
      handle.view = view;
      // reachable from the console while developing, like the engine
      if (import.meta.env.DEV) {
        (window as any).lodecksEditor = liveEditors.left;
        (window as any).lodecksEditors = liveEditors;
      }
      handle.run = (block) => runBlock(engine, view!, block);
      handle.runCurrent = () => runCurrent(view!);
      handle.runAll = () => runAll(view!);
      handle.setDoc = (next) => {
        view!.dispatch({
          changes: { from: 0, to: view!.state.doc.length, insert: next },
          effects: [clearInline.of(null), clearMarkers.of(null)],
          selection: { anchor: 0 }
        });
      };
      if (pane === "left" || !restore) view.focus();
    });

    // components hidden from code (handle.hide())
    const off = live.hidden.on((ids) => view?.dispatch({ effects: removeInlineIds.of(ids) }));

    return () => {
      disposed = true;
      off();
      const setId = setIdOf(live, pane);
      if (view && setId) kept[pane] = { state: view.state, setId };
      view?.destroy();
      handle.view = undefined;
      handle.run = undefined;
      handle.runCurrent = undefined;
      handle.runAll = undefined;
      handle.setDoc = undefined;
    };
  }, [engine, pane]);

  return <div ref={root} className="min-h-0 flex-1 overflow-hidden" />;
};
