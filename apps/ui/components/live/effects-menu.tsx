import { ChevronDown, CodeXml, FilePlus2, ImagePlus, Pencil, Play, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Effect } from "@/engine/modules/visual/library.module";

import { useGifImport } from "@/components/visual/effects";
import { GifThumb } from "@/components/visual/gif-thumb";
import { useEngine, useVisuals } from "@/hooks/engine.hook";
import { cn } from "~/utils/classes.util";

import { focusedEditor, focusedPane } from "./editor";
import { blockAtPos } from "./editor/blocks";
import { openEffectTab } from "./tabs";

const KindTags: Record<Effect["kind"], { label: string; className: string }> = {
  hydra: { label: "hydra", className: "text-deck-b" },
  shader: { label: "glsl", className: "text-code" },
  gif: { label: "gif", className: "text-warn" }
};

/** Puts code at the cursor of the editor last typed in */
const insertAtCursor = (code: string) => {
  const view = focusedEditor().view;
  if (!view) return;
  const { from, to } = view.state.selection.main;
  view.dispatch({ changes: { from, to, insert: code }, selection: { anchor: from + code.length }, scrollIntoView: true });
  view.focus();
};

/** Adds code as its own block, after the block at the cursor, and runs it */
const loadBlock = (code: string) => {
  const handle = focusedEditor();
  const view = handle.view;
  if (!view) return;
  const doc = view.state.doc;
  const after = blockAtPos(doc, view.state.selection.main.head);
  const at = after ? after.to : 0;
  const insert = after ? `\n\n${code}` : doc.length ? `${code}\n\n` : code;
  const start = after ? at + 2 : 0;
  view.dispatch({ changes: { from: at, insert }, selection: { anchor: start + code.length }, scrollIntoView: true });
  view.focus();
  const block = blockAtPos(view.state.doc, start);
  if (block) handle.run?.(block);
};

const small = "flex h-5 items-center rounded-[2px] px-1.5 text-[10px] uppercase opacity-50 hover:opacity-100 disabled:opacity-20";

/** The effects menu of v2: every effect and gif, to load, insert or edit */
export const EffectsMenu = ({ className }: { className?: string }) => {
  const engine = useEngine();
  const visuals = useVisuals();
  const gifs = useGifImport();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => !box.current?.contains(event.target as Node) && setOpen(false);
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const run = (code: string) => {
    setOpen(false);
    loadBlock(code);
  };
  const insert = (code: string) => {
    setOpen(false);
    insertAtCursor(code);
  };
  // effects open as tabs of the editor last typed in
  const edit = (id: string) => {
    setOpen(false);
    openEffectTab(focusedPane(), id);
  };
  const create = async (kind: "hydra" | "shader") => {
    const effect = await engine?.visuals.create(kind);
    if (effect) edit(effect.id);
  };

  const builtIn = visuals.effects.filter((effect) => effect.builtIn);
  const mine = visuals.effects.filter((effect) => !effect.builtIn);

  const effectRow = (effect: Effect) => {
    const code = `viz(${JSON.stringify(effect.name)})`;
    const tag = KindTags[effect.kind];
    return (
      <div key={effect.id} className="group flex items-center gap-2 px-3 py-1 hover:bg-white/[0.04]" title={effect.description}>
        <span className="text-bright min-w-0 flex-1 truncate">{effect.name}</span>
        <span className={cn("shrink-0 font-mono text-[10px]", tag.className)}>{tag.label}</span>
        <span className="flex shrink-0 items-center gap-1">
          <button className={cn(small, "bg-deck-a/20 text-deck-a")} title={`adds ${code}.show() below the cursor and runs it`} onClick={() => run(`${code}.show()`)}>
            <Play size={10} strokeWidth={1.75} />
          </button>
          <button className={cn(small, "text-text")} title={`puts ${code} at the cursor`} onClick={() => insert(code)}>
            <CodeXml size={11} strokeWidth={1.75} />
          </button>
          {/* gif effects are a picture, not code to write: nothing to edit */}
          {effect.kind !== "gif" ? (
            <button className={cn(small, "text-text")} title="edit its code in a tab" onClick={() => edit(effect.id)}>
              <Pencil size={10} strokeWidth={1.75} />
            </button>
          ) : (
            // keeps the buttons of every row in line
            <span className="w-[22px]" />
          )}
          {!effect.builtIn && (
            <button
              className={cn(small, "text-bad")}
              title="delete from this browser"
              onClick={() => confirm(`Delete the effect "${effect.name}" from this browser?`) && engine?.visuals.remove(effect.id)}
            >
              <Trash2 size={10} strokeWidth={1.75} />
            </button>
          )}
        </span>
      </div>
    );
  };

  return (
    <div ref={box} className={cn("relative", className)}>
      <button
        className="text-text hover:text-bright flex h-full items-center gap-1 rounded-[3px] px-2 hover:bg-white/[0.05]"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen(!open)}
      >
        effects
        {gifs.busy && <span className="text-warn animate-armed">●</span>}
        <ChevronDown size={12} strokeWidth={1.75} className="text-dim" />
      </button>
      {open && engine && (
        <div className="border-line-strong absolute top-8 left-0 z-50 w-[400px] rounded-[4px] border bg-popover py-1 text-[12px] shadow-[0_18px_40px_rgba(0,0,0,0.6)]">
          <button
            className="text-bright flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/[0.05] disabled:opacity-40"
            disabled={gifs.busy}
            onClick={() => file.current?.click()}
          >
            <ImagePlus size={13} strokeWidth={1.75} className="text-warn" />
            import a gif or video…
            <span className="text-dim ml-auto text-[11px]">gif, webp, png, mp4</span>
          </button>
          <input
            ref={file}
            type="file"
            accept="image/gif,image/webp,image/png,video/mp4,video/webm"
            className="hidden"
            onChange={(event) => {
              const picked = event.target.files?.[0];
              event.target.value = "";
              if (picked) gifs.fromFile(picked);
            }}
          />
          <form
            className="flex items-center gap-2 px-3 pb-1"
            onSubmit={(event) => {
              event.preventDefault();
              if (url.trim() && !gifs.busy) gifs.fromUrl(url).then(() => setUrl(""));
            }}
          >
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="or a gif or mp4 url…"
              className="bg-ink border-line min-w-0 flex-1 border px-2 py-0.5 text-[11px] outline-none"
            />
            <button type="submit" className={cn(small, "text-text opacity-80")} disabled={!url.trim() || gifs.busy}>
              {gifs.busy ? "importing" : "import"}
            </button>
          </form>
          {gifs.error && <div className="text-bad truncate px-3 pb-1 text-[11px]">{gifs.error}</div>}
          <div className="bg-line my-1 h-px" />
          <button className="text-bright flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-white/[0.05]" onClick={() => create("hydra")}>
            <FilePlus2 size={13} strokeWidth={1.75} className="text-deck-b" />
            new hydra effect
            <span className="text-dim ml-auto text-[11px]">opens in a tab</span>
          </button>
          <button className="text-bright flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-white/[0.05]" onClick={() => create("shader")}>
            <FilePlus2 size={13} strokeWidth={1.75} className="text-code" />
            new glsl shader
            <span className="text-dim ml-auto text-[11px]">opens in a tab</span>
          </button>

          <div className="max-h-[60vh] overflow-auto">
            {visuals.gifs.length > 0 && (
              <>
                <div className="bg-line my-1 h-px" />
                <div className="legend px-3 pb-1 !text-[8px]">gifs · gif("name", fit?)</div>
                {visuals.gifs.map((gif) => {
                  const code = `gif(${JSON.stringify(gif.name)})`;
                  return (
                    <div key={gif.id} className="flex items-center gap-2 px-3 py-1 hover:bg-white/[0.04]" title={gif.source}>
                      <GifThumb gif={gif} className="border-line h-5 w-8 shrink-0 border object-cover" />
                      <span className="text-bright min-w-0 flex-1 truncate">{gif.name}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          className={cn(small, "bg-deck-a/20 text-deck-a")}
                          title={`adds ${code} over the visuals playing, below the cursor, and runs it`}
                          onClick={() => run(`${code}.blend("screen").over()`)}
                        >
                          <Play size={10} strokeWidth={1.75} />
                        </button>
                        <button className={cn(small, "text-text")} title={`puts ${code} at the cursor`} onClick={() => insert(code)}>
                          <CodeXml size={11} strokeWidth={1.75} />
                        </button>
                        <button
                          className={cn(small, "text-bad")}
                          title="delete from this browser"
                          onClick={() => confirm(`Delete the gif "${gif.name}" from this browser?`) && engine.visuals.removeGif(gif.id)}
                        >
                          <Trash2 size={10} strokeWidth={1.75} />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </>
            )}
            {mine.length > 0 && (
              <>
                <div className="bg-line my-1 h-px" />
                <div className="legend px-3 pb-1 !text-[8px]">yours · saved in this browser</div>
                {mine.map(effectRow)}
              </>
            )}
            <div className="bg-line my-1 h-px" />
            <div className="legend px-3 pb-1 !text-[8px]">built in · viz("name")</div>
            {builtIn.map(effectRow)}
          </div>
        </div>
      )}
    </div>
  );
};
