import { Copy, Download, FileCode, Film, Pencil, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

import type { Effect } from "@/engine/modules/visual/library.module";

import { Button } from "@/components/button";
import { ErrorIcon } from "@/components/icon";
import { useEngine, useVisuals } from "@/hooks/engine.hook";
import { api } from "@/utils/client.util";
import { cn } from "~/utils/classes.util";

const ImageType = /^image\/(gif|webp|png|apng)$/;

/** Gif import from a url (through the api) or a file, shared with drop */
export const useGifImport = () => {
  const engine = useEngine();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const run = async (work: () => Promise<unknown>) => {
    if (!engine) return;
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return {
    busy,
    error,
    fromUrl: (url: string) =>
      run(async () => {
        const { blob, name } = await api.images.fetch(url.trim());
        await engine!.visuals.importGif(blob, name, url.trim());
      }),
    fromFile: (file: File) =>
      run(async () => {
        if (!ImageType.test(file.type)) throw new Error(`${file.name} is not a gif`);
        await engine!.visuals.importGif(file, file.name);
      })
  };
};

const KindBadges = {
  hydra: { label: "hydra", className: "text-deck-b" },
  shader: { label: "glsl", className: "text-code" },
  gif: { label: "gif", className: "text-warn" }
};

const EffectRow = ({ effect, active, thumb }: { effect: Effect; active: boolean; thumb?: string }) => {
  const engine = useEngine();
  const [renaming, setRenaming] = useState(false);
  const badge = KindBadges[effect.kind];

  return (
    <li
      className={cn(
        "group border-line flex h-8 cursor-pointer items-center gap-2 border-b px-2",
        active ? "bg-white/[0.06] text-bright" : "hover:bg-white/[0.03]"
      )}
      onClick={() => engine?.visuals.select(effect.id)}
      title={effect.description}
    >
      <span className="flex h-6 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[2px] bg-black">
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover [image-rendering:pixelated]" />
        ) : effect.kind === "hydra" ? (
          <Sparkles size={11} strokeWidth={1.75} className="text-deck-b" />
        ) : (
          <FileCode size={11} strokeWidth={1.75} className="text-code" />
        )}
      </span>
      <span className={cn("legend w-8 shrink-0 !text-[8px]", badge.className)}>{badge.label}</span>
      {renaming ? (
        <input
          autoFocus
          defaultValue={effect.name}
          onClick={(event) => event.stopPropagation()}
          onBlur={(event) => {
            engine?.visuals.rename(effect.id, event.target.value);
            setRenaming(false);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            if (event.key === "Escape") setRenaming(false);
          }}
          className="bg-ink border-line min-w-0 flex-1 border px-1 text-[12px] outline-none"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-[12px]">
          {effect.name}
          {effect.description && <span className="text-dim"> — {effect.description}</span>}
        </span>
      )}
      <span className="hidden shrink-0 items-center gap-1 group-hover:flex" onClick={(event) => event.stopPropagation()}>
        {!effect.builtIn && (
          <Button size="sm" design="ghost" title="rename" onClick={() => setRenaming(true)}>
            <Pencil size={11} strokeWidth={1.75} />
          </Button>
        )}
        <Button size="sm" design="ghost" title="duplicate" onClick={() => engine?.visuals.duplicate(effect.id)}>
          <Copy size={11} strokeWidth={1.75} />
        </Button>
        {!effect.builtIn && (
          <Button
            size="sm"
            design="ghost"
            title="delete from this browser"
            onClick={() => confirm(`Delete "${effect.name}" from this browser?`) && engine?.visuals.remove(effect.id)}
          >
            <Trash2 size={11} strokeWidth={1.75} />
          </Button>
        )}
      </span>
    </li>
  );
};

/** The effects library: built-ins, your own (saved in this browser), gifs */
export const VisualsEffects = () => {
  const engine = useEngine();
  const visuals = useVisuals();
  const gifs = useGifImport();
  const [url, setUrl] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const mine = visuals.effects.filter((effect) => !effect.builtIn);
  const builtIn = visuals.effects.filter((effect) => effect.builtIn);
  const thumbs = Object.fromEntries(visuals.gifs.map((gif) => [gif.id, gif.url]));
  const latest = visuals.gifs[0]?.url;
  const thumb = (effect: Effect) =>
    effect.gifId ? thumbs[effect.gifId] : effect.kind === "gif" ? latest : undefined;

  const importUrl = () => {
    if (!url.trim() || gifs.busy) return;
    gifs.fromUrl(url).then(() => setUrl(""));
  };

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="border-line flex h-9 shrink-0 items-center gap-1.5 border-b px-2">
        <Film size={12} strokeWidth={1.75} className="text-warn shrink-0" />
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") importUrl();
          }}
          placeholder="https://… .gif — import a gif from a url"
          className="bg-ink border-line text-text min-w-0 flex-1 border px-2 py-0.5 text-[12px] outline-none select-text"
        />
        <Button size="sm" data-deck="b" design="accent" onClick={importUrl} disabled={!url.trim() || gifs.busy}>
          <Download size={11} strokeWidth={1.75} />
          {gifs.busy ? "importing" : "import"}
        </Button>
        <Button size="sm" onClick={() => file.current?.click()} disabled={gifs.busy} title="import a gif file (or drop one on the visuals)">
          <Upload size={11} strokeWidth={1.75} />
          file
        </Button>
        <input
          ref={file}
          type="file"
          accept="image/gif,image/webp,image/png"
          className="hidden"
          onChange={(event) => {
            const picked = event.target.files?.[0];
            if (picked) gifs.fromFile(picked);
            event.target.value = "";
          }}
        />
        <span className="bg-line mx-1 h-4 w-px" />
        <Button size="sm" data-deck="b" onClick={() => engine?.visuals.create("shader")} disabled={!visuals.loaded}>
          <Plus size={11} strokeWidth={1.75} />
          glsl
        </Button>
        <Button size="sm" data-deck="b" onClick={() => engine?.visuals.create("hydra")} disabled={!visuals.loaded}>
          <Plus size={11} strokeWidth={1.75} />
          hydra
        </Button>
      </div>
      {gifs.error && (
        <div className="text-bad border-line truncate border-b px-3 py-1 text-[11px]">
          <ErrorIcon /> {gifs.error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="legend px-2 pt-2 pb-1 !text-[8px]">
          mine · saved in this browser
        </div>
        {mine.length ? (
          <ul>
            {mine.map((effect) => (
              <EffectRow key={effect.id} effect={effect} active={effect.id === visuals.active} thumb={thumb(effect)} />
            ))}
          </ul>
        ) : (
          <div className="text-dim px-3 py-2 text-[11px]">
            {visuals.loaded
              ? "nothing yet — import a gif, start a new effect, or save an edited one (Ctrl+S in code)"
              : "reading the library…"}
          </div>
        )}

        {visuals.gifs.length > 0 && (
          <>
            <div className="legend px-2 pt-3 pb-1 !text-[8px]">gifs</div>
            <div className="flex flex-wrap gap-1.5 px-2 pb-1">
              {visuals.gifs.map((gif) => (
                <div
                  key={gif.id}
                  className={cn(
                    "group relative h-12 w-16 cursor-pointer overflow-hidden rounded-[2px] border bg-black",
                    gif.id === visuals.gifId ? "border-warn" : "border-line"
                  )}
                  onClick={() => engine?.visuals.useGif(gif.id)}
                  title={`${gif.name}${gif.source ? `\n${gif.source}` : ""}\nclick: use with this effect`}
                >
                  <img src={gif.url} alt={gif.name} className="h-full w-full object-cover" />
                  <button
                    className="text-bad absolute top-0.5 right-0.5 hidden rounded-[2px] bg-black/70 p-0.5 group-hover:block"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (confirm(`Delete the gif "${gif.name}" from this browser?`)) engine?.visuals.removeGif(gif.id);
                    }}
                    title="delete"
                  >
                    <Trash2 size={10} strokeWidth={1.75} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="legend px-2 pt-3 pb-1 !text-[8px]">built in</div>
        <ul>
          {builtIn.map((effect) => (
            <EffectRow key={effect.id} effect={effect} active={effect.id === visuals.active} thumb={thumb(effect)} />
          ))}
        </ul>
      </div>
    </div>
  );
};
