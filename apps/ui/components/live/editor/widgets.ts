import { Range, StateEffect, StateField, Transaction } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";

// —— containers React renders the inline components into (portals) ——

const containers = new Map<string, HTMLElement>();
const listeners = new Set<() => void>();
// a stable list between changes, as useSyncExternalStore needs
let snapshot: string[] = [];
const notify = () => {
  snapshot = [...containers.keys()];
  listeners.forEach((listener) => listener());
};

export const inlineContainers = {
  get: (id: string) => {
    let element = containers.get(id);
    if (!element) {
      element = document.createElement("div");
      element.className = "cm-live-inline";
      containers.set(id, element);
      notify();
    }
    return element;
  },
  drop: (ids: string[]) => {
    for (const id of ids) containers.delete(id);
    notify();
  },
  ids: () => snapshot,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
};

class InlineWidget extends WidgetType {
  constructor(readonly id: string) {
    super();
  }
  eq(other: InlineWidget) {
    return other.id === this.id;
  }
  toDOM() {
    return inlineContainers.get(this.id);
  }
  // the component handles its own pointer and keys
  ignoreEvent() {
    return true;
  }
  destroy() {}
}

// lucide's corner-down-right, circle-x and chevron-right, drawn like the rest
const OutputIcons = {
  result: '<polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/>',
  error: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  print: '<path d="m9 18 6-6-6-6"/>',
  // a keyboard: press something
  hint: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="M6 8h.01"/><path d="M10 8h.01"/><path d="M14 8h.01"/><path d="M18 8h.01"/><path d="M7 16h10"/>'
};
const outputIcon = (kind: keyof typeof OutputIcons) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${OutputIcons[kind]}</svg>`;

class OutputWidget extends WidgetType {
  constructor(
    readonly kind: "result" | "error" | "print" | "hint",
    readonly text: string
  ) {
    super();
  }
  eq(other: OutputWidget) {
    return other.kind === this.kind && other.text === this.text;
  }
  toDOM() {
    const element = document.createElement("div");
    element.className = `cm-live-output cm-live-output-${this.kind}`;
    const icon = document.createElement("span");
    icon.className = "cm-live-output-icon";
    icon.innerHTML = outputIcon(this.kind);
    const text = document.createElement("span");
    text.textContent = this.text;
    element.append(icon, text);
    return element;
  }
}

/**
 * Moves each widget with the line it belongs to: it stays at the end of
 * that line. Mapped the usual way, a widget at a line's end would follow
 * text typed there — Enter at the end of the line would push it down, and
 * there would be no way to write below it. When the line is deleted (or
 * emptied), its widget goes with it.
 */
const keepOnTheirLines = (decorations: DecorationSet, tr: Transaction) => {
  const moved: Range<Decoration>[] = [];
  decorations.between(0, tr.startState.doc.length, (from, _to, value) => {
    // its line, as it was: gone when a deletion covered all of it
    const old = tr.startState.doc.lineAt(from);
    let deleted = false;
    tr.changes.iterChangedRanges((fromA, toA) => {
      if (toA > fromA && fromA <= old.from && toA >= old.to) deleted = true;
    });
    if (deleted) return;
    const line = tr.state.doc.lineAt(tr.changes.mapPos(from, -1));
    if (!line.text.trim()) return;
    moved.push(value.range(line.to));
  });
  return Decoration.set(moved, true);
};

export type InlineItem =
  | { blockId: string; pos: number; order: number; type: "component"; id: string }
  | { blockId: string; pos: number; order: number; type: "output"; id: string; kind: "result" | "error" | "print" | "hint"; text: string };

export const addInline = StateEffect.define<InlineItem[]>();
export const removeBlockInline = StateEffect.define<string>();
export const removeInlineIds = StateEffect.define<string[]>();
export const clearInline = StateEffect.define<null>();

/** Components and results drawn under the lines that made them */
export const inlineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    if (tr.docChanged) decorations = keepOnTheirLines(decorations, tr);
    for (const effect of tr.effects) {
      if (effect.is(clearInline)) decorations = Decoration.none;
      if (effect.is(removeBlockInline)) {
        decorations = decorations.update({ filter: (_from, _to, value) => value.spec.blockId !== effect.value });
      }
      if (effect.is(removeInlineIds)) {
        const ids = new Set(effect.value);
        decorations = decorations.update({ filter: (_from, _to, value) => !ids.has(value.spec.id) });
      }
      if (effect.is(addInline)) {
        const ranges = effect.value
          .filter((item) => item.pos <= tr.state.doc.length)
          .map((item) =>
            Decoration.widget({
              widget: item.type === "component" ? new InlineWidget(item.id) : new OutputWidget(item.kind, item.text),
              block: true,
              side: 1 + item.order,
              blockId: item.blockId,
              id: item.id
            }).range(item.pos)
          );
        decorations = decorations.update({ add: ranges, sort: true });
      }
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field)
});

/** Component ids still in the document */
export const inlineIdsIn = (state: EditorView["state"]) => {
  const ids: string[] = [];
  state.field(inlineField).between(0, state.doc.length, (_from, _to, value) => {
    if (value.spec.id) ids.push(value.spec.id);
  });
  return ids;
};
