import { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { EditorState, StateField } from "@codemirror/state";
import { EditorView, Tooltip, hoverTooltip, showTooltip } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

import type { DeckId } from "@/common/constants/deck.constant";
import { DeckFxs } from "@/common/constants/fx.constant";
import { Corners } from "@/engine/modules/live/layers.module";
import { GifFit, GifFits } from "@/engine/modules/visual/gif.module";
import { CameraEffects, cameraDoc } from "@/engine/modules/visual/camera-presets.module";
import {
  ApiDoc,
  ArgValues,
  BlendModes,
  Globals,
  Kind,
  LfoShapes,
  Methods,
  ViewGroups,
  docFor,
  returnsOf
} from "@/engine/modules/live/api.module";

/** What completion asks the engine */
export type CompletionHost = {
  kindOf: (name: string) => Kind | undefined;
  bindings: () => string[];
  packs: () => { id: string; title: string; bpm: number; key: string }[];
  effects: () => { name: string; kind: string }[];
  gifs: () => string[];
  // the deck a variable holds, once its block ran
  deckOf: (name: string) => DeckId | undefined;
  // a deck's song tracks, or both decks' when it isn't known
  tracks: (deck?: DeckId) => { id: string; deck: DeckId; muted: boolean }[];
};

const Keywords = ["const", "let", "await", "async", "function", "return", "if", "else", "for", "of", "true", "false"];

/**
 * Picking a function writes its call: name() with the cursor between the
 * parentheses when it takes arguments, after them when it does not, and
 * name`…` for the tagged ones (glsl, hydra).
 */
const insertCall = (doc: ApiDoc) => (view: EditorView, _completion: Completion, from: number, to: number) => {
  const tagged = doc.signature.includes("`");
  const takesArgs = !tagged && !doc.signature.includes("()");
  // already followed by "(": just the name
  const next = view.state.sliceDoc(to, to + 1);
  if (next === "(" || next === "`") {
    view.dispatch({ changes: { from, to, insert: doc.name }, selection: { anchor: from + doc.name.length + 1 } });
    return;
  }
  const insert = tagged ? `${doc.name}\`\`` : `${doc.name}()`;
  const cursor = from + doc.name.length + (tagged || takesArgs ? 1 : 2);
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: cursor } });
};

const option = (doc: ApiDoc, type: "function" | "method"): Completion => ({
  label: doc.name,
  type,
  detail: doc.signature.slice(doc.name.length),
  info: doc.doc,
  apply: insertCall(doc),
  boost: type === "method" ? 1 : 0
});

/**
 * What a variable holds, read from the code: `const a = deck("a")` makes
 * `a` a deck before the block has ever run.
 */
const declaredValue = (state: EditorState, name: string) => {
  let found: SyntaxNode | undefined;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (found) return false;
      if (node.name !== "VariableDefinition" || state.sliceDoc(node.from, node.to) !== name) return;
      // const name = <expression>
      let value = node.node.nextSibling;
      if (value?.name === "Equals") value = value.nextSibling;
      if (value) found = value;
    }
  });
  return found;
};

const declaredKind = (state: EditorState, name: string, host: CompletionHost, depth: number): Kind | undefined =>
  depth > 4 ? undefined : kindOfNode(state, declaredValue(state, name) ?? null, host, depth + 1);

const stringValue = (state: EditorState, node: SyntaxNode | null | undefined) =>
  node?.name === "String" ? state.sliceDoc(node.from + 1, node.to - 1) : undefined;

/**
 * Which deck an expression is: `deck("b")`, a variable holding one (from
 * the scope, or its declaration), or a chain of deck calls on either.
 */
const deckOfNode = (state: EditorState, node: SyntaxNode | null, host: CompletionHost, depth = 0): DeckId | undefined => {
  if (!node || depth > 6) return undefined;
  if (node.name === "VariableName") {
    const name = state.sliceDoc(node.from, node.to);
    return host.deckOf(name) ?? deckOfNode(state, declaredValue(state, name) ?? null, host, depth + 1);
  }
  if (node.name === "ParenthesizedExpression") return deckOfNode(state, node.firstChild?.nextSibling ?? null, host, depth + 1);
  if (node.name !== "CallExpression") return undefined;
  const callee = node.firstChild;
  if (callee?.name === "VariableName" && state.sliceDoc(callee.from, callee.to) === "deck") {
    const id = stringValue(state, callee.nextSibling?.firstChild?.nextSibling)?.toLowerCase();
    return id === "a" || id === "b" ? id : undefined;
  }
  // deck methods give the same deck back
  if (callee?.name === "MemberExpression" && kindOfNode(state, node, host) === "deck") return deckOfNode(state, callee.firstChild, host, depth + 1);
  return undefined;
};

/** What kind of value an expression node gives, statically or from the scope */
export const kindOfNode = (state: EditorState, node: SyntaxNode | null, host: CompletionHost, depth = 0): Kind | undefined => {
  if (!node) return undefined;
  if (node.name === "VariableName") {
    const name = state.sliceDoc(node.from, node.to);
    return host.kindOf(name) ?? declaredKind(state, name, host, depth);
  }
  if (node.name === "ParenthesizedExpression") return kindOfNode(state, node.firstChild?.nextSibling ?? null, host, depth);
  if (node.name === "CallExpression") {
    const callee = node.firstChild;
    if (!callee) return undefined;
    if (callee.name === "VariableName") return returnsOf(state.sliceDoc(callee.from, callee.to));
    if (callee.name === "MemberExpression") {
      const object = callee.firstChild;
      const property = callee.lastChild;
      const kind = kindOfNode(state, object, host, depth);
      return kind && property ? returnsOf(state.sliceDoc(property.from, property.to), kind) : undefined;
    }
  }
  if (node.name === "TaggedTemplateExpression") {
    const tag = node.firstChild;
    return tag ? returnsOf(state.sliceDoc(tag.from, tag.to)) : undefined;
  }
  return undefined;
};

/** The call a string argument sits in: its doc and the argument index */
const callAround = (state: EditorState, node: SyntaxNode, host: CompletionHost) => {
  const args = node.parent;
  if (!args || args.name !== "ArgList") return undefined;
  const call = args.parent;
  const callee = call?.firstChild;
  if (!call || !callee) return undefined;
  let index = 0;
  for (let child = args.firstChild; child && child.from < node.from; child = child.nextSibling) {
    if (child.name === ",") index++;
  }
  if (callee.name === "VariableName") return { doc: docFor(state.sliceDoc(callee.from, callee.to)), index };
  if (callee.name === "MemberExpression") {
    const property = callee.lastChild;
    const kind = kindOfNode(state, callee.firstChild, host);
    const name = property ? state.sliceDoc(property.from, property.to) : "";
    const deck = kind === "deck" ? deckOfNode(state, callee.firstChild, host) : undefined;
    return { doc: docFor(name, kind), index, deck };
  }
  return undefined;
};

const FitDocs: Record<GifFit, string> = {
  cover: "fills the screen, cropping the edges (default)",
  contain: "shows all of it, with bars",
  fill: "stretched to the screen"
};

const valuesFor = (values: ArgValues, host: CompletionHost, deck?: DeckId): Completion[] => {
  switch (values) {
    case "deck":
      return ["a", "b"].map((label) => ({ label, type: "constant" }));
    case "pack":
      return host.packs().map((pack) => ({ label: pack.id, type: "constant", detail: `${pack.title} · ${pack.bpm} · ${pack.key}` }));
    case "effect":
      return host.effects().map((effect) => ({ label: effect.name, type: "constant", detail: effect.kind }));
    case "gif":
      return host.gifs().map((label) => ({ label, type: "constant" }));
    case "fx":
      return DeckFxs.map((label) => ({ label, type: "constant" }));
    case "band":
      return ["low", "mid", "high"].map((label) => ({ label, type: "constant" }));
    case "stem":
      // the tracks of the deck it's called on
      return host.tracks(deck).map((track) => ({
        label: track.id,
        type: "constant",
        detail: `deck ${track.deck}${track.muted ? " · muted" : ""}`
      }));
    case "view":
      // grouped: controls, the song, moving with the music
      return ViewGroups.flatMap((group, rank) =>
        // boost keeps each group in its own order, not alphabetical
        group.views.map(({ view, doc }, index) => ({ label: view, type: "constant", detail: doc, boost: -index, section: { name: group.name, rank } }))
      );
    case "blend":
      return BlendModes.map((label) => ({ label, type: "constant" }));
    case "shape":
      return LfoShapes.map((label) => ({ label, type: "constant" }));
    case "xfade":
      return ["a", "b", "mid"].map((label) => ({ label, type: "constant" }));
    case "camera":
      return CameraEffects.map((label) => ({ label, type: "constant", info: cameraDoc(label) }));
    case "jukebox":
      return [
        { label: "bar", type: "constant", info: "branch on bar lines (default)" },
        { label: "beat", type: "constant", info: "branch on beats, like the classic jukebox" },
        { label: "low", type: "constant", info: "branch rarely, only to the closest matches" },
        { label: "mid", type: "constant", info: "the default" },
        { label: "high", type: "constant", info: "branch often, to looser matches" },
        { label: "off", type: "constant", info: "play the song straight" }
      ];
    case "fit":
      return GifFits.map((label) => ({ label, type: "constant", info: FitDocs[label] }));
    case "corner":
      return Corners.map((label) => ({ label, type: "constant" }));
  }
};

export const liveCompletion = (host: CompletionHost) => (context: CompletionContext): CompletionResult | null => {
  const { state, pos } = context;
  const node = syntaxTree(state).resolveInner(pos, -1);

  // inside a string: packs, effects, decks… depending on the call
  if (node.name === "String") {
    const call = callAround(state, node, host);
    const args = call?.doc?.args;
    if (!call) return null;
    const values = args?.[call.index] ?? (call.doc?.rest ? args?.at(-1) : undefined);
    if (!values) return null;
    return {
      from: node.from + 1,
      to: Math.max(node.from + 1, node.to - 1 >= pos ? node.to - 1 : pos),
      options: valuesFor(values, host, call?.deck),
      validFor: /^[\w\- .]*$/
    };
  }

  // after a dot: the methods of what is on the left
  const member = node.name === "PropertyName" ? node.parent : node.name === "." ? node.parent : null;
  if (member?.name === "MemberExpression") {
    const kind = kindOfNode(state, member.firstChild, host);
    if (!kind) return null;
    return {
      from: node.name === "PropertyName" ? node.from : pos,
      options: Methods[kind].map((doc) => option(doc, "method")),
      validFor: /^\w*$/
    };
  }

  // a name: the language, then what the code made
  const word = context.matchBefore(/[\w$]+/);
  if (!word && !context.explicit) return null;
  if (node.name === "LineComment" || node.name === "BlockComment") return null;
  const declared = new Set<string>(host.bindings());
  for (const match of state.doc.toString().matchAll(/\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)) declared.add(match[1]);
  return {
    from: word ? word.from : pos,
    options: [
      ...Globals.map((doc) => option(doc, "function")),
      ...[...declared].map((name) => {
        const kind = host.kindOf(name) ?? declaredKind(state, name, host, 0);
        return { label: name, type: "variable", detail: kind ?? "", boost: 2 } satisfies Completion;
      }),
      ...Keywords.map((label) => ({ label, type: "keyword", boost: -2 }))
    ],
    validFor: /^[\w$]*$/
  };
};

/** Docs on hover, for any name of the language */
export const liveHover = (host: CompletionHost) =>
  hoverTooltip((view, pos) => {
    const { state } = view;
    const node = syntaxTree(state).resolveInner(pos, 1);
    if (node.name !== "VariableName" && node.name !== "PropertyName") return null;
    const name = state.sliceDoc(node.from, node.to);
    let doc: ApiDoc | undefined;
    if (node.name === "PropertyName" && node.parent?.name === "MemberExpression") {
      doc = docFor(name, kindOfNode(state, node.parent.firstChild, host));
    } else {
      doc = Globals.find((item) => item.name === name);
      const kind = doc ? undefined : kindOfNode(state, node, host);
      if (!doc && kind) doc = { name, signature: `${name}: ${kind}`, doc: `a ${kind} — type ${name}. to see what it can do` };
    }
    if (!doc) return null;
    const found = doc;
    return {
      pos: node.from,
      end: node.to,
      above: true,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "cm-live-doc";
        const signature = document.createElement("div");
        signature.className = "cm-live-doc-signature";
        signature.textContent = found.signature;
        const text = document.createElement("div");
        text.textContent = found.doc;
        dom.append(signature, text);
        return { dom };
      }
    };
  });

/** Lets completion open by itself after a dot or an opening quote */
export const completeOnTrigger = EditorView.inputHandler.of((view, _from, _to, text) => {
  if (text === "." || text === '"' || text === "'") {
    setTimeout(() => {
      import("@codemirror/autocomplete").then(({ startCompletion }) => startCompletion(view));
    }, 0);
  }
  return false;
});

// —— parameter hints ——

/** The signature's parameters, split at the top-level commas */
const parameters = (signature: string) => {
  const open = signature.indexOf("(");
  const close = signature.lastIndexOf(")");
  if (open < 0 || close <= open + 1) return [];
  const inner = signature.slice(open + 1, close);
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (char === "(" || char === "[") depth++;
    if (char === ")" || char === "]") depth--;
    if (char === "," && depth === 0) {
      out.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(inner.slice(start).trim());
  return out;
};

const hintAt = (state: EditorState, host: CompletionHost): readonly Tooltip[] => {
  const selection = state.selection.main;
  if (!selection.empty) return [];
  const pos = selection.head;
  // the innermost call whose parentheses the cursor is in
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (node.name !== "ArgList") continue;
    const closed = state.sliceDoc(node.to - 1, node.to) === ")";
    if (pos <= node.from || (closed && pos >= node.to)) continue;
    const call = node.parent;
    const callee = call?.firstChild;
    if (!callee) return [];
    let doc: ApiDoc | undefined;
    if (callee.name === "VariableName") doc = Globals.find((item) => item.name === state.sliceDoc(callee.from, callee.to));
    else if (callee.name === "MemberExpression" && callee.lastChild) {
      doc = docFor(state.sliceDoc(callee.lastChild.from, callee.lastChild.to), kindOfNode(state, callee.firstChild, host));
    }
    const params = doc ? parameters(doc.signature) : [];
    if (!doc || !params.length) return [];
    let index = 0;
    for (let child = node.firstChild; child && child.from < pos; child = child.nextSibling) if (child.name === ",") index++;
    const found = doc;
    return [
      {
        pos: node.from,
        // above the line; below it on the first lines, where there is no room
        above: true,
        arrow: false,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "cm-live-hint";
          dom.append(found.name, "(");
          params.forEach((param, position) => {
            if (position) dom.append(", ");
            const span = document.createElement("span");
            span.textContent = param;
            if (position === Math.min(index, params.length - 1)) span.className = "cm-live-hint-active";
            dom.append(span);
          });
          dom.append(")");
          const text = document.createElement("div");
          text.className = "cm-live-hint-doc";
          text.textContent = found.doc;
          dom.append(text);
          return { dom };
        }
      }
    ];
  }
  return [];
};

/** The signature of the call being typed, its current argument lit */
export const parameterHints = (host: CompletionHost) =>
  StateField.define<readonly Tooltip[]>({
    create: (state) => hintAt(state, host),
    update: (tooltips, tr) => (tr.docChanged || tr.selection ? hintAt(tr.state, host) : tooltips),
    provide: (field) => showTooltip.computeN([field], (state) => state.field(field))
  });
