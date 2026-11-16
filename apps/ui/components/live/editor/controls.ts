import { syntaxTree } from "@codemirror/language";
import { EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";

import { Controls } from "@/engine/modules/live/api.module";

import { blockAtPos, blockIdIn } from "./blocks";
import { addInline, removeInlineIds } from "./widgets";

export type ControlHost = {
  set: (id: string, value: number) => void;
  trigger: (id: string) => void;
  // whether the engine knows the control: its block ran since it was written
  known?: (id: string) => boolean;
};

// the warning under a line whose control was touched before its block ran
const hints = new WeakMap<EditorView, { id: string; timer: ReturnType<typeof setTimeout> }>();
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** True when the control can act; else says to run its block first */
const live = (view: EditorView, host: ControlHost, pos: number, id: string | undefined) => {
  if (id && (!host.known || host.known(id))) return true;
  const previous = hints.get(view);
  if (previous) clearTimeout(previous.timer);
  const hint = `hint-${Date.now().toString(36)}`;
  const line = view.state.doc.lineAt(pos);
  view.dispatch({
    effects: [
      ...(previous ? [removeInlineIds.of([previous.id])] : []),
      addInline.of([
        {
          blockId: "hint",
          pos: line.to,
          order: 99,
          type: "output",
          id: hint,
          kind: "hint",
          text: `not running yet — press ${isMac ? "⌘↵" : "ctrl+enter"} to activate this block`
        }
      ])
    ]
  });
  hints.set(view, { id: hint, timer: setTimeout(() => view.dispatch({ effects: removeInlineIds.of([hint]) }), 4000) });
  return false;
};

type ControlKind = "slider" | "knob" | "toggle" | "button" | "pad";

const NumberPattern = /^\s*(-?\d*\.?\d+(?:e-?\d+)?)/;
const BoolPattern = /^\s*(true|false|1|0)\b/;

/** The id the runtime gives the control at `pos`: block id and its index */
const controlId = (state: EditorState, pos: number) => {
  const block = blockAtPos(state.doc, pos);
  if (!block) return undefined;
  const blockId = blockIdIn(state, block.from, block.to);
  if (!blockId) return undefined;
  let index = 0;
  let found: number | undefined;
  syntaxTree(state).iterate({
    from: block.from,
    to: block.to,
    enter: (node) => {
      if (node.name !== "CallExpression") return;
      const callee = node.node.firstChild;
      if (!callee || callee.name !== "VariableName" || !Controls.includes(state.sliceDoc(callee.from, callee.to))) return;
      const args = node.node.getChild("ArgList");
      if (args && args.from + 1 === pos) found = index;
      index++;
    }
  });
  return found === undefined ? undefined : `${blockId}:${found}`;
};

const decimals = (min: number, max: number) => Math.max(0, Math.min(4, Math.ceil(-Math.log10(Math.abs(max - min) / 200 || 1))));

/** Rewrites the number right after the widget; returns the new value */
const writeNumber = (view: EditorView, dom: HTMLElement, value: number, min: number, max: number) => {
  const pos = view.posAtDOM(dom);
  const match = NumberPattern.exec(view.state.sliceDoc(pos, pos + 32));
  // fixed decimals for the range, without trailing zeros
  const text = String(Number(value.toFixed(decimals(min, max))));
  if (match) {
    const from = pos + match[0].length - match[1].length;
    view.dispatch({ changes: { from, to: from + match[1].length, insert: text }, userEvent: "input.control" });
  } else {
    view.dispatch({ changes: { from: pos, insert: `${text}, ` }, userEvent: "input.control" });
  }
  return { pos, id: controlId(view.state, pos) };
};

class ControlWidget extends WidgetType {
  constructor(
    readonly kind: ControlKind,
    readonly value: number,
    readonly min: number,
    readonly max: number,
    readonly label: string,
    readonly host: ControlHost
  ) {
    super();
  }

  // the dom is kept while dragging, even as the number changes
  eq(other: ControlWidget) {
    return (
      other.kind === this.kind &&
      other.min === this.min &&
      other.max === this.max &&
      other.label === this.label &&
      // a pad's value is whether it is inverted
      (this.kind !== "pad" || other.value === this.value)
    );
  }

  updateDOM(dom: HTMLElement) {
    if (dom.dataset.dragging) return true;
    // a pad keeps its dom (and its held state) while the line is edited
    if (this.kind === "pad") return true;
    this.paint(dom, this.value);
    return true;
  }

  private fraction(value: number) {
    const span = this.max - this.min || 1;
    return Math.min(1, Math.max(0, (value - this.min) / span));
  }

  private paint(dom: HTMLElement, value: number) {
    const fraction = this.fraction(value);
    if (this.kind === "slider") {
      (dom.firstChild as HTMLElement).style.width = `${fraction * 100}%`;
    } else if (this.kind === "knob") {
      dom.style.setProperty("--turn", `${-135 + fraction * 270}deg`);
      dom.style.setProperty("--fill", `${fraction * 75}%`);
    } else if (this.kind === "toggle") {
      dom.classList.toggle("cm-live-on", value > 0);
    }
  }

  toDOM(view: EditorView) {
    const dom = document.createElement("span");
    dom.className = `cm-live-control cm-live-${this.kind}`;

    if (this.kind === "button") {
      dom.textContent = this.label;
      dom.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const pos = view.posAtDOM(dom);
        const id = controlId(view.state, pos);
        if (live(view, this.host, pos, id)) this.host.trigger(id!);
        dom.classList.add("cm-live-on");
        setTimeout(() => dom.classList.remove("cm-live-on"), 160);
      });
      return dom;
    }

    if (this.kind === "pad") {
      // the text inside, so the pad can say what it does
      if (this.label) dom.textContent = this.label;
      if (this.value) dom.classList.add("cm-live-inverted");
      const press = (down: boolean) => {
        const pos = view.posAtDOM(dom);
        const id = controlId(view.state, pos);
        // warns once, on the press
        if (down ? live(view, this.host, pos, id) : id && (!this.host.known || this.host.known(id))) this.host.set(id!, down ? 1 : 0);
        dom.classList.toggle("cm-live-on", down);
      };
      dom.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        dom.setPointerCapture(event.pointerId);
        press(true);
      });
      dom.addEventListener("pointerup", () => press(false));
      dom.addEventListener("pointercancel", () => press(false));
      return dom;
    }

    if (this.kind === "toggle") {
      dom.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const pos = view.posAtDOM(dom);
        const match = BoolPattern.exec(view.state.sliceDoc(pos, pos + 8));
        const on = !(match && (match[1] === "true" || match[1] === "1"));
        const insert = match && (match[1] === "1" || match[1] === "0") ? (on ? "1" : "0") : String(on);
        if (match) {
          const from = pos + match[0].length - match[1].length;
          view.dispatch({ changes: { from, to: from + match[1].length, insert }, userEvent: "input.control" });
        } else {
          view.dispatch({ changes: { from: pos, insert }, userEvent: "input.control" });
        }
        const id = controlId(view.state, pos);
        if (live(view, this.host, pos, id)) this.host.set(id!, on ? 1 : 0);
        this.paint(dom, on ? 1 : 0);
      });
      this.paint(dom, this.value);
      return dom;
    }

    if (this.kind === "slider") {
      const fill = document.createElement("span");
      fill.className = "cm-live-fill";
      dom.appendChild(fill);
    }
    this.paint(dom, this.value);

    let start = { x: 0, y: 0, value: this.value };
    const move = (event: PointerEvent) => {
      if (!dom.dataset.dragging) return;
      let value: number;
      if (this.kind === "slider") {
        const rect = dom.getBoundingClientRect();
        value = this.min + (this.max - this.min) * Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      } else {
        // knobs turn with vertical drags, finer with shift
        const span = this.max - this.min;
        const delta = ((start.y - event.clientY) / (event.shiftKey ? 600 : 150)) * span;
        value = Math.min(this.max, Math.max(this.min, start.value + delta));
      }
      this.paint(dom, value);
      const { id } = writeNumber(view, dom, value, this.min, this.max);
      if (id && (!this.host.known || this.host.known(id))) this.host.set(id, value);
    };
    dom.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      dom.setPointerCapture(event.pointerId);
      dom.dataset.dragging = "1";
      const pos = view.posAtDOM(dom);
      live(view, this.host, pos, controlId(view.state, pos));
      const match = NumberPattern.exec(view.state.sliceDoc(pos, pos + 32));
      start = { x: event.clientX, y: event.clientY, value: match ? Number(match[1]) : this.value };
      if (this.kind === "slider") move(event);
    });
    dom.addEventListener("pointermove", move);
    const end = () => delete dom.dataset.dragging;
    dom.addEventListener("pointerup", end);
    dom.addEventListener("pointercancel", end);
    return dom;
  }

  ignoreEvent() {
    return true;
  }
}

const literal = (state: EditorState, node: { from: number; to: number; name: string } | null) => {
  if (!node) return undefined;
  if (node.name === "Number") return Number(state.sliceDoc(node.from, node.to));
  if (node.name === "UnaryExpression") {
    const value = Number(state.sliceDoc(node.from, node.to).replace(/\s+/g, ""));
    return Number.isFinite(value) ? value : undefined;
  }
  if (node.name === "BooleanLiteral") return state.sliceDoc(node.from, node.to) === "true" ? 1 : 0;
  return undefined;
};

const build = (view: EditorView, host: ControlHost) => {
  const builder = new RangeSetBuilder<Decoration>();
  const state = view.state;
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== "CallExpression") return;
        const callee = node.node.firstChild;
        if (!callee || callee.name !== "VariableName") return;
        const kind = state.sliceDoc(callee.from, callee.to) as ControlKind;
        if (!Controls.includes(kind)) return;
        const args = node.node.getChild("ArgList");
        if (!args) return;
        // arguments without the punctuation
        const values: { from: number; to: number; name: string }[] = [];
        for (let child = args.firstChild; child; child = child.nextSibling) {
          if (child.name !== "(" && child.name !== ")" && child.name !== ",") values.push(child);
        }
        let widget: ControlWidget;
        if (kind === "button") {
          const label = values[0] && values[0].name === "String" ? state.sliceDoc(values[0].from + 1, values[0].to - 1) : "go";
          widget = new ControlWidget(kind, 0, 0, 1, label, host);
        } else if (kind === "pad") {
          // pad("label"?, invert?): the value carries the inversion
          const label = values[0]?.name === "String" ? state.sliceDoc(values[0].from + 1, values[0].to - 1) : "";
          const invert = literal(state, values[0]?.name === "String" ? values[1] : values[0]) ?? 0;
          widget = new ControlWidget(kind, invert, 0, 1, label, host);
        } else if (kind === "toggle") {
          widget = new ControlWidget(kind, literal(state, values[0]) ?? 0, 0, 1, "", host);
        } else {
          const min = literal(state, values[1]) ?? 0;
          const max = literal(state, values[2]) ?? 1;
          widget = new ControlWidget(kind, literal(state, values[0]) ?? (min + max) / 2, min, max, "", host);
        }
        builder.add(args.from + 1, args.from + 1, Decoration.widget({ widget, side: -1 }));
      }
    });
  }
  return builder.finish();
};

/** slider(), knob(), toggle(), button() and pad() drawn inside their own line */
export const inlineControls = (host: ControlHost) =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, host);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
          this.decorations = build(update.view, host);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations }
  );
