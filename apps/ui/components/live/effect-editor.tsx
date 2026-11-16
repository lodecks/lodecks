import { autocompletion, closeBrackets, closeBracketsKeymap, completeFromList, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { UniformsHelp } from "@/engine/modules/visual/glsl.module";

import { ErrorIcon } from "@/components/icon";
import { useEngine, useHydra, useVisuals } from "@/hooks/engine.hook";
import { cn } from "~/utils/classes.util";

import { editorTooltips, liveHighlight, liveTheme } from "./editor/theme";
import { useMirror } from "./inline";
import { replaceTab } from "./tabs";

// what each language offers while typing
const HydraWords = [
  "osc", "noise", "voronoi", "shape", "gradient", "solid", "src", "gif", "out", "render",
  "rotate", "scale", "pixelate", "repeat", "repeatX", "repeatY", "kaleid", "scroll", "scrollX", "scrollY",
  "modulate", "modulateScale", "modulateRotate", "modulatePixelate", "modulateKaleid", "modulateHue",
  "blend", "add", "sub", "mult", "diff", "layer", "mask", "luma", "thresh", "color", "saturate",
  "contrast", "brightness", "invert", "posterize", "shift", "colorama", "hue",
  "fft", "kick", "beat", "bar", "xfade", "H", "aspect", "o0", "o1", "o2", "o3", "s0", "s1"
];
const GlslWords = [
  ...UniformsHelp.split(" ").map((word) => word.split("=")[0]),
  "mainImage", "fragColor", "fragCoord", "texture", "vec2", "vec3", "vec4", "float", "int", "mat2", "mat3",
  "uniform", "const", "sin", "cos", "tan", "atan", "pow", "exp", "log", "sqrt", "abs", "sign", "floor", "fract",
  "mod", "min", "max", "clamp", "mix", "step", "smoothstep", "length", "distance", "dot", "cross", "normalize", "reflect"
];

// each tab's editor as it was, so switching tabs keeps code, cursor and undo
const kept = new Map<string, EditorState>();

// a built-in saved as a copy: its editor (made for the built-in) edits the copy
const moves = new Map<string, string>();
const follow = (id: string) => {
  let at = id;
  while (moves.has(at)) at = moves.get(at)!;
  return at;
};

// the tab showing an effect now, for what its editor reports
type TabUi = { setDirty: (dirty: boolean) => void; setNote: (note?: string) => void; setError: (error?: string) => void };
const tabUi = new Map<string, TabUi>();
const ui = (id: string) => tabUi.get(follow(id));

/** Forgets a closed tab's editor */
export const dropEffectEditor = (id: string) => kept.delete(id);

/** One effect's code in a tab: Ctrl+Enter runs it, Ctrl+S saves it */
export const EffectEditor = ({ id }: { id: string }) => {
  const engine = useEngine();
  const visuals = useVisuals();
  const hydra = useHydra();
  const root = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const effect = visuals.effects.find((item) => item.id === id);
  const kind = effect?.kind === "hydra" ? "hydra" : "glsl";
  useMirror(preview, showPreview);
  useEffect(() => {
    tabUi.set(id, { setDirty, setNote, setError });
    return () => {
      tabUi.delete(id);
    };
  }, [id]);

  // errors of the layers it runs in
  useEffect(() => {
    if (!engine) return;
    return engine.compositor.errors.on(({ lines }) => setError(lines.join("\n")));
  }, [engine]);
  useEffect(() => {
    if (kind === "hydra" && hydra.error) setError(hydra.error);
  }, [hydra.error, kind]);

  useEffect(() => {
    if (!engine || !root.current || !effect) return;
    // the keys live in the editor's state, which outlives this component
    const made = id;
    const run = (view: EditorView) => {
      ui(made)?.setError(undefined);
      try {
        const how = engine.live.previewEffect(follow(made), view.state.doc.toString());
        ui(made)?.setNote(how === "updated" ? "running in the set's visuals" : "showing on its own");
      } catch (cause) {
        ui(made)?.setError((cause as Error).message);
      }
      return true;
    };
    const save = (view: EditorView) => {
      const code = view.state.doc.toString();
      const from = follow(made);
      engine.visuals.saveCode(from, code).then((saved) => {
        if (!saved) return;
        if (saved.id !== from) {
          // a built-in was saved as your copy: the tab now edits the copy
          moves.set(from, saved.id);
          kept.set(saved.id, view.state);
          engine.live.renamePreview(from, saved.id);
          replaceTab(from, saved.id);
          ui(made)?.setNote(`saved as "${saved.name}"`);
        } else ui(made)?.setNote("saved");
        ui(made)?.setDirty(false);
      });
      return true;
    };

    const words = kind === "hydra" ? HydraWords : GlslWords;
    const state =
      kept.get(id) ??
      EditorState.create({
        doc: effect.code,
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
          // close enough for glsl too: comments, numbers, calls, brackets
          javascript(),
          liveTheme,
          liveHighlight,
          editorTooltips,
          autocompletion({ override: [completeFromList(words.map((label) => ({ label, type: "function" })))], icons: false }),
          keymap.of([
            { key: "Mod-Enter", run, preventDefault: true },
            { key: "Mod-s", run: save, preventDefault: true },
            ...closeBracketsKeymap,
            ...completionKeymap,
            ...searchKeymap,
            ...historyKeymap,
            indentWithTab,
            ...defaultKeymap
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) ui(made)?.setDirty(update.state.doc.toString() !== engine.visuals.find(follow(made))?.code);
          })
        ]
      });
    const view = new EditorView({ parent: root.current, state });
    setDirty(view.state.doc.toString() !== effect.code);
    view.focus();
    return () => {
      // a tab that moved to a copy hands its editor to the copy
      kept.set(follow(id), view.state);
      view.destroy();
    };
    // the editor is made once per tab; the effect's later saves don't rebuild it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, id, !!effect]);

  useEffect(() => {
    dirtyTabs.set(id, dirty);
    for (const listener of dirtyListeners) listener();
  }, [id, dirty]);

  if (!effect) return <div className="text-dim p-4">this effect is gone</div>;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={root} className="min-h-0 flex-1 overflow-hidden" />
      {showPreview && (
        <canvas
          ref={preview}
          className="border-line-strong pointer-events-none absolute top-3 right-4 aspect-video w-[300px] rounded-[3px] border bg-black shadow-[0_10px_30px_rgba(0,0,0,0.5)] [image-rendering:pixelated]"
        />
      )}
      <footer className="border-line flex h-7 shrink-0 items-center gap-3 border-t px-3 font-mono text-[11px]">
        <span className={cn("uppercase", kind === "hydra" ? "text-deck-b" : "text-code")}>{kind}</span>
        <span className="text-dim">{effect.builtIn ? "built in · ⌃s saves your copy" : "yours · ⌃s saves"}</span>
        {error ? (
          <span className="text-bad min-w-0 flex-1 truncate" title={error}>
            <ErrorIcon /> {error.split("\n")[0]}
          </span>
        ) : (
          <span className="text-dim min-w-0 flex-1 truncate">{note ?? "⌃↵ runs it"}</span>
        )}
        <button
          className="text-dim hover:text-bright flex items-center gap-1"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setShowPreview(!showPreview)}
          title="the preview in the corner"
        >
          {showPreview ? <EyeOff size={12} strokeWidth={1.75} /> : <Eye size={12} strokeWidth={1.75} />}
          preview
        </button>
      </footer>
    </div>
  );
};

// unsaved tabs, for the dot on the tab
const dirtyTabs = new Map<string, boolean>();
const dirtyListeners = new Set<() => void>();
export const isDirty = (id: string) => !!dirtyTabs.get(id);
export const onDirty = (listener: () => void) => {
  dirtyListeners.add(listener);
  return () => {
    dirtyListeners.delete(listener);
  };
};
