import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView, tooltips } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/**
 * Tooltips (hints, completion, docs) stay inside the editor: on the first
 * lines a hint goes below instead of over the tabs and the top line
 */
export const editorTooltips = tooltips({ tooltipSpace: (view) => view.scrollDOM.getBoundingClientRect() });

/** The text interface, in the colours of the rest of lodecks */
export const liveTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "transparent",
      color: "var(--color-text)",
      fontSize: "14px"
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      lineHeight: "1.75",
      paddingTop: "18px"
    },
    // the room below the code is part of the content, so clicking it puts
    // the cursor on the last line (it would be dead scroller padding)
    ".cm-content": { caretColor: "var(--color-deck-a)", paddingRight: "24px", paddingBottom: "40vh", minHeight: "100%", boxSizing: "border-box" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-deck-a)", borderLeftWidth: "2px" },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "color-mix(in srgb, var(--color-code) 26%, transparent) !important"
    },
    ".cm-activeLine": { backgroundColor: "rgb(255 255 255 / 0.022)" },
    ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "color-mix(in srgb, var(--color-dim) 70%, transparent)", paddingLeft: "12px" },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 14px 0 0", minWidth: "28px" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--color-text)" },
    ".cm-matchingBracket": { backgroundColor: "rgb(255 255 255 / 0.08)", outline: "none" },
    // a block that just ran
    ".cm-live-flash": { backgroundColor: "color-mix(in srgb, var(--color-deck-a) 14%, transparent)", transition: "background-color 0.25s" },
    // results under the code, until the next run
    ".cm-live-output": {
      display: "flex",
      alignItems: "flex-start",
      gap: "6px",
      fontSize: "12px",
      padding: "1px 0 3px 10px",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word"
    },
    ".cm-live-output-icon": { flex: "none", display: "inline-flex", height: "1.5em", alignItems: "center", opacity: "0.8" },
    ".cm-live-output-print .cm-live-output-icon": { color: "var(--color-dim)" },
    ".cm-live-output-result": { color: "var(--color-dim)" },
    ".cm-live-output-print": { color: "var(--color-text)" },
    ".cm-live-output-error": { color: "var(--color-bad)" },
    ".cm-live-output-hint": { color: "var(--color-warn)" },
    // blocks that ran: a bar on the left of their lines
    ".cm-line.cm-live-ran": { boxShadow: "inset 2px 0 0 color-mix(in srgb, var(--color-deck-a) 70%, transparent)" },
    ".cm-line.cm-live-ran-changed": { boxShadow: "inset 2px 0 0 color-mix(in srgb, var(--color-warn) 75%, transparent)" },
    ".cm-line.cm-live-ran-error": { boxShadow: "inset 2px 0 0 color-mix(in srgb, var(--color-bad) 75%, transparent)" },
    ".cm-live-inline": { padding: "6px 0 10px", cursor: "default" },
    // controls inside the line
    ".cm-live-control": { display: "inline-block", verticalAlign: "middle", margin: "0 6px 0 2px", cursor: "ew-resize", userSelect: "none" },
    ".cm-live-slider": {
      position: "relative",
      width: "92px",
      height: "6px",
      borderRadius: "3px",
      background: "rgb(255 255 255 / 0.1)",
      overflow: "hidden"
    },
    ".cm-live-slider .cm-live-fill": { position: "absolute", inset: "0 auto 0 0", background: "var(--color-deck-a)", borderRadius: "3px" },
    ".cm-live-knob": {
      width: "15px",
      height: "15px",
      borderRadius: "50%",
      cursor: "ns-resize",
      background: "conic-gradient(from 225deg, var(--color-code) 0 var(--fill), rgb(255 255 255 / 0.1) var(--fill) 75%, transparent 75%)",
      position: "relative"
    },
    ".cm-live-knob::after": {
      content: '""',
      position: "absolute",
      inset: "3px",
      borderRadius: "50%",
      background: "var(--color-ink)",
      transform: "rotate(var(--turn))",
      backgroundImage: "linear-gradient(var(--color-bright), var(--color-bright))",
      backgroundSize: "1.5px 5px",
      backgroundPosition: "center 0",
      backgroundRepeat: "no-repeat"
    },
    ".cm-live-toggle": {
      width: "24px",
      height: "12px",
      borderRadius: "6px",
      cursor: "pointer",
      background: "rgb(255 255 255 / 0.12)",
      position: "relative",
      transition: "background 0.15s"
    },
    ".cm-live-toggle::after": {
      content: '""',
      position: "absolute",
      top: "2px",
      left: "2px",
      width: "8px",
      height: "8px",
      borderRadius: "50%",
      background: "var(--color-text)",
      transition: "left 0.15s"
    },
    ".cm-live-toggle.cm-live-on": { background: "var(--color-deck-a)" },
    ".cm-live-toggle.cm-live-on::after": { left: "14px", background: "var(--color-ink)" },
    ".cm-live-button": {
      cursor: "pointer",
      padding: "0 8px",
      borderRadius: "3px",
      fontSize: "11px",
      lineHeight: "18px",
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: "var(--color-ink)",
      background: "var(--color-deck-b)"
    },
    ".cm-live-button.cm-live-on": { filter: "brightness(1.5)" },
    ".cm-live-pad": {
      cursor: "pointer",
      minWidth: "18px",
      height: "18px",
      padding: "0 6px",
      boxSizing: "border-box",
      borderRadius: "3px",
      fontSize: "10px",
      lineHeight: "16px",
      textAlign: "center",
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: "var(--color-dim)",
      border: "1px solid color-mix(in srgb, var(--color-deck-a) 55%, transparent)",
      background: "color-mix(in srgb, var(--color-deck-a) 12%, transparent)",
      transition: "background 0.06s, transform 0.06s"
    },
    // inverted: lit at rest, dark while held
    ".cm-live-pad.cm-live-inverted": { background: "color-mix(in srgb, var(--color-deck-a) 45%, transparent)", color: "var(--color-text)" },
    ".cm-live-pad.cm-live-on": { background: "var(--color-deck-a)", color: "var(--color-ink)", transform: "scale(0.94)" },
    ".cm-live-pad.cm-live-inverted.cm-live-on": { background: "transparent", color: "var(--color-dim)" },
    // completion and docs
    ".cm-tooltip": {
      backgroundColor: "#0b0f17",
      border: "1px solid var(--color-line-strong)",
      borderRadius: "4px",
      color: "var(--color-text)",
      fontSize: "12.5px"
    },
    ".cm-tooltip-autocomplete > ul": { fontFamily: '"JetBrains Mono", monospace', maxHeight: "18em" },
    ".cm-tooltip-autocomplete > ul > li": { padding: "2px 10px 2px 6px" },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "color-mix(in srgb, var(--color-code) 30%, transparent)",
      color: "var(--color-bright)"
    },
    ".cm-completionDetail": { color: "var(--color-dim)", fontStyle: "normal", marginLeft: "8px" },
    ".cm-completionMatchedText": { textDecoration: "none", color: "var(--color-deck-a)" },
    ".cm-completionInfo": { padding: "6px 10px", maxWidth: "320px" },
    ".cm-live-hint": { padding: "4px 9px", fontFamily: '"JetBrains Mono", monospace', fontSize: "12px", color: "var(--color-dim)", maxWidth: "460px" },
    ".cm-live-hint-active": { color: "var(--color-deck-a)", fontWeight: "600" },
    ".cm-live-hint-doc": { color: "var(--color-text)", fontFamily: "inherit", marginTop: "2px", fontSize: "11.5px", whiteSpace: "normal" },
    ".cm-live-doc": { padding: "6px 10px", maxWidth: "380px", lineHeight: "1.5" },
    ".cm-live-doc-signature": { color: "var(--color-deck-a)", marginBottom: "2px", fontFamily: '"JetBrains Mono", monospace' },
    ".cm-panels": { backgroundColor: "#0b0f17", color: "var(--color-text)" }
  },
  { dark: true }
);

export const liveHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.keyword, tags.definitionKeyword, tags.modifier, tags.controlKeyword], color: "var(--color-code)" },
    { tag: [tags.string, tags.special(tags.string)], color: "var(--color-deck-b)" },
    { tag: [tags.number, tags.bool, tags.null], color: "var(--color-deck-a)" },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--color-dim)", fontStyle: "italic" },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--color-bright)" },
    { tag: [tags.definition(tags.variableName)], color: "var(--color-warn)" },
    { tag: [tags.propertyName], color: "var(--color-text)" },
    { tag: [tags.operator, tags.punctuation, tags.bracket, tags.separator], color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }
  ])
);
