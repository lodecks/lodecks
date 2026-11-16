import { ChangeSet, RangeSet, RangeValue, StateEffect, StateField, Text } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";

import { Block, splitBlocks } from "@/engine/modules/live/runtime.module";

/** Blocks of the document, by position */
export const blocksOf = (doc: Text) => splitBlocks(doc.toString());

export const blockAtPos = (doc: Text, pos: number): Block | undefined => {
  const blocks = blocksOf(doc);
  return blocks.find((block) => pos >= block.from && pos <= block.to) ?? [...blocks].reverse().find((block) => block.to < pos);
};

// —— block ids: a marker at each block's start that follows edits ——

class BlockMarker extends RangeValue {
  constructor(readonly id: string) {
    super();
  }
  eq(other: BlockMarker) {
    return other.id === this.id;
  }
}

const addMarker = StateEffect.define<{ pos: number; id: string }>();
export const clearMarkers = StateEffect.define<null>();

export const markerField = StateField.define<RangeSet<BlockMarker>>({
  create: () => RangeSet.empty,
  update(markers, tr) {
    markers = markers.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(addMarker)) markers = markers.update({ add: [new BlockMarker(effect.value.id).range(effect.value.pos)] });
      if (effect.is(clearMarkers)) markers = RangeSet.empty;
    }
    return markers;
  }
});

/** The id of the block in [from, to], if it ran before */
export const blockIdIn = (state: EditorView["state"], from: number, to: number) => {
  let found: string | undefined;
  state.field(markerField).between(from, to, (_from, _to, marker) => {
    found = marker.id;
    return false;
  });
  return found;
};

let nextBlock = 0;

export const ensureBlockId = (view: EditorView, block: Block) => {
  const existing = blockIdIn(view.state, block.from, block.to);
  if (existing) return existing;
  const id = `b${Date.now().toString(36)}${nextBlock++}`;
  view.dispatch({ effects: addMarker.of({ pos: block.from, id }) });
  return id;
};

// —— the flash when a block runs ——

const flashEffect = StateEffect.define<{ from: number; to: number } | null>();
const flashLine = Decoration.line({ class: "cm-live-flash" });

export const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(flashEffect)) continue;
      if (!effect.value) {
        decorations = Decoration.none;
        continue;
      }
      const lines = [];
      const doc = tr.state.doc;
      for (let line = doc.lineAt(effect.value.from).number; line <= doc.lineAt(effect.value.to).number; line++) {
        lines.push(flashLine.range(doc.line(line).from));
      }
      decorations = Decoration.set(lines);
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field)
});

export const flash = (view: EditorView, block: Block) => {
  view.dispatch({ effects: flashEffect.of({ from: block.from, to: block.to }) });
  setTimeout(() => view.dispatch({ effects: flashEffect.of(null) }), 260);
};

// —— edits made while a block runs, to place its results correctly ——

type Tracker = { view: EditorView; changes: ChangeSet; doc: Text };
const trackers = new Set<Tracker>();

export const trackChanges = EditorView.updateListener.of((update) => {
  if (!update.docChanged) return;
  // each run follows the edits of its own editor only
  for (const tracker of trackers) if (tracker.view === update.view) tracker.changes = tracker.changes.compose(update.changes);
});

export const startTracking = (view: EditorView) => {
  const tracker: Tracker = { view, changes: ChangeSet.empty(view.state.doc.length), doc: view.state.doc };
  trackers.add(tracker);
  return {
    // end of `line` as it was when tracking started, where it is now
    lineEnd(line: number) {
      const at = tracker.doc.line(Math.min(Math.max(1, line), tracker.doc.lines)).to;
      return tracker.changes.mapPos(at, 1);
    },
    stop() {
      trackers.delete(tracker);
    }
  };
};
