import { EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";

import { blockIdIn, blocksOf } from "./blocks";

/**
 * Which blocks are live: a bar on the left of every line of a block that
 * ran (green), ran into an error (red), or was edited since it ran
 * (amber: ⌘↵ again to apply it). Panic clears them.
 */
type Ran = { status: "ok" | "error"; text: string };

export const setRan = StateEffect.define<{ id: string } & Ran>();
export const clearRan = StateEffect.define<null>();

const ranField = StateField.define<Map<string, Ran>>({
  create: () => new Map(),
  update(ran, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setRan)) {
        ran = new Map(ran);
        ran.set(effect.value.id, { status: effect.value.status, text: effect.value.text });
      }
      if (effect.is(clearRan)) ran = new Map();
    }
    return ran;
  }
});

const Lines = {
  ok: Decoration.line({ class: "cm-live-ran" }),
  error: Decoration.line({ class: "cm-live-ran cm-live-ran-error" }),
  changed: Decoration.line({ class: "cm-live-ran cm-live-ran-changed" })
};

const decorate = (state: EditorState) => {
  const ran = state.field(ranField);
  const builder = new RangeSetBuilder<Decoration>();
  if (!ran.size) return builder.finish();
  for (const block of blocksOf(state.doc)) {
    const id = blockIdIn(state, block.from, block.to);
    const entry = id ? ran.get(id) : undefined;
    if (!entry) continue;
    const text = state.sliceDoc(block.from, block.to);
    const mark = text !== entry.text ? Lines.changed : entry.status === "error" ? Lines.error : Lines.ok;
    for (let line = state.doc.lineAt(block.from).number; line <= state.doc.lineAt(block.to).number; line++) {
      const from = state.doc.line(line).from;
      builder.add(from, from, mark);
    }
  }
  return builder.finish();
};

const ranLines = StateField.define<DecorationSet>({
  create: decorate,
  update: (lines, tr) => (tr.docChanged || tr.effects.some((effect) => effect.is(setRan) || effect.is(clearRan)) ? decorate(tr.state) : lines),
  provide: (field) => EditorView.decorations.from(field)
});

/** The live-block bars, for an editor that runs blocks */
export const ranExtension = [ranField, ranLines];
