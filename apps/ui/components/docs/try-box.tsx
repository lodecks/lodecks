import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { bracketMatching } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { Loader2, Play, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { completionHost, runBlock } from "@/components/live/editor";
import { blocksOf, flashField, markerField, trackChanges } from "@/components/live/editor/blocks";
import { completeOnTrigger, liveCompletion, liveHover, parameterHints } from "@/components/live/editor/completion";
import { inlineControls } from "@/components/live/editor/controls";
import { ranExtension } from "@/components/live/editor/ran";
import { editorTooltips, liveHighlight, liveTheme } from "@/components/live/editor/theme";
import { clearInline, inlineContainers, inlineField, inlineIdsIn } from "@/components/live/editor/widgets";
import { useEngine } from "@/hooks/engine.hook";
import { cn } from "~/utils/classes.util";

import type { Engine } from "@/engine/index";

type EngineType = typeof Engine;

/** The pack every example plays: a is it, b only when the code uses b */
export const DocsPack = "intro";
const DocsPackB = "demo-b";

// —— one example plays at a time ——

let playing: string | undefined;
const listeners = new Set<() => void>();
const setPlaying = (id: string | undefined) => {
  playing = id;
  for (const listener of listeners) listener();
};
const usePlaying = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => playing,
    () => undefined
  );

/**
 * Silences whatever an example started: decks, schedules, bindings,
 * visuals, and the clock, so the next example's play() starts at once
 * instead of waiting for the next phrase
 */
const silence = (engine: EngineType) => {
  engine.live.panic();
  engine.live.layers.set([]);
  engine.stop();
  setPlaying(undefined);
};

let nextId = 0;

/**
 * An example you can play, like Strudel's: the code is editable, ▶ (or
 * ⌘↵ inside it) runs it, and what it draws appears under its lines. Only
 * one plays at a time: starting one stops the one before.
 */
const TryBox = ({ code, label = "try it" }: { code: string; label?: string }) => {
  const engine = useEngine();
  const root = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(undefined);
  const id = useRef(`try-${nextId++}`).current;
  const active = usePlaying() === id;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [edited, setEdited] = useState(false);

  const run = async () => {
    const target = view.current;
    if (!engine || !target || busy) return;
    setBusy(true);
    setProblem(undefined);
    // the example before stops: one plays at a time
    if (playing && playing !== id) silence(engine);
    try {
      engine.visuals.init();
      const text = target.state.doc.toString();
      const prelude = [`const a = deck("a", "${DocsPack}")`, /\bb\s*\./.test(text) ? `const b = deck("b", "${DocsPackB}")` : ""].filter(Boolean).join("\n");
      const loaded = await engine.live.run(prelude, `${id}-prelude`, 1);
      const failed = loaded.outputs.find((output) => output.kind === "error");
      if (failed) {
        setProblem(`could not load ${DocsPack}: ${failed.text}`);
        return;
      }
      target.dispatch({ effects: clearInline.of(null) });
      for (const block of blocksOf(target.state.doc)) await runBlock(engine, target, block, false);
      setPlaying(id);
    } finally {
      setBusy(false);
    }
  };

  // ⌘↵ inside the editor calls the latest run
  const runLatest = useRef(run);
  runLatest.current = run;

  const stop = () => engine && silence(engine);
  const reset = () => {
    const target = view.current;
    if (!target) return;
    target.dispatch({ changes: { from: 0, to: target.state.doc.length, insert: code }, effects: clearInline.of(null) });
    setEdited(false);
  };

  useEffect(() => {
    if (!engine || !root.current) return;
    const live = engine.live;
    const host = completionHost(engine);
    const created = new EditorView({
      parent: root.current,
      state: EditorState.create({
        doc: code,
        extensions: [
          history(),
          drawSelection(),
          bracketMatching(),
          closeBrackets(),
          javascript(),
          liveTheme,
          liveHighlight,
          editorTooltips,
          markerField,
          flashField,
          inlineField,
          trackChanges,
          inlineControls({ set: (control, value) => live.setControl(control, value), trigger: (control) => live.trigger(control), known: (control) => live.controls.has(control) }),
          ranExtension,
          autocompletion({ override: [liveCompletion(host)], icons: false, activateOnTypingDelay: 40 }),
          completeOnTrigger,
          parameterHints(host),
          liveHover(host),
          keymap.of([
            { key: "Mod-Enter", run: () => (runLatest.current(), true), preventDefault: true },
            { key: "Tab", run: acceptCompletion },
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...historyKeymap,
            indentWithTab,
            ...defaultKeymap
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setEdited(update.state.doc.toString() !== code);
          })
        ]
      })
    });
    view.current = created;
    return () => {
      // what it drew goes with it
      const ids = inlineIdsIn(created.state);
      inlineContainers.drop(ids);
      live.forgetComponents(ids);
      created.destroy();
      view.current = undefined;
      if (playing === id) silence(engine);
    };
    // the editor is made once; run reads the latest state through refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  return (
    <div
      className={cn(
        "not-prose my-5 overflow-hidden rounded-[6px] border bg-[#03050a] font-mono text-[12px] transition-colors",
        active ? "border-[#2be8a0]/60 shadow-[0_0_0_1px_rgba(43,232,160,0.15)]" : "border-[#1c2433]"
      )}
    >
      <div className="flex h-9 items-center gap-2 border-b border-[#1c2433] px-2">
        {active ? (
          <button onClick={stop} className="flex h-6 items-center gap-1.5 rounded-[3px] bg-[#2be8a0] px-2 text-[11px] text-[#070a10]" title="stop">
            <Square size={10} strokeWidth={2.5} /> stop
          </button>
        ) : (
          <button
            onClick={run}
            disabled={!engine || busy}
            className="flex h-6 items-center gap-1.5 rounded-[3px] bg-[#161d2a] px-2 text-[11px] text-[#eef3ff] hover:bg-[#1f2838] disabled:opacity-50"
            title="play (⌘↵ inside the code)"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} strokeWidth={2.25} />} {busy ? "loading" : "play"}
          </button>
        )}
        {active && busy === false && (
          <button onClick={run} className="text-[11px] text-[#8491aa] hover:text-[#eef3ff]" title="run it again (⌘↵)">
            run again
          </button>
        )}
        <span className="text-[11px] text-[#56627a]">{label} · a is {DocsPack}</span>
        {edited && (
          <button onClick={reset} className="ml-auto flex items-center gap-1 text-[11px] text-[#8491aa] hover:text-[#eef3ff]" title="back to the example">
            <RotateCcw size={10} strokeWidth={2} /> reset
          </button>
        )}
      </div>
      <div ref={root} className="[&_.cm-content]:min-h-0! [&_.cm-content]:py-3! [&_.cm-scroller]:p-0!" />
      {problem && <div className="border-t border-[#1c2433] px-3 py-2 text-[11px] text-[#ff3b30]">{problem}</div>}
      {!engine && <div className="px-3 py-2 text-[11px] text-[#56627a]">starting the engine…</div>}
    </div>
  );
};

export default TryBox;
