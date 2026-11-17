import { ChevronDown, Cloud, Download, FileAudio, HardDrive, HardDriveDownload, MoreHorizontal, Pencil, Sparkles, Trash2 } from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";

import { PackExtension } from "@/common/constants/deck.constant";

import type { CatalogPack } from "@/engine/modules/importer/catalog.module";

import { useEngine } from "@/hooks/engine.hook";
import { AudioFile, useCatalog, useImportSong, useImporter, useOpenInEditor } from "@/hooks/import.hook";
import { cn } from "~/utils/classes.util";

const SourceIcon = { remote: Cloud, local: HardDrive, new: Sparkles };
const SourceTitle = {
  remote: "on the server: downloads into this browser when you load it",
  local: "in this browser",
  new: "just imported, not saved yet"
};

/** Hands the pack's file to the browser, which saves it to disk */
const saveToDisk = (pack: CatalogPack, bytes: Uint8Array) => {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${pack.id}${PackExtension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const MenuItem = ({ icon, children, danger, onClick }: { icon: ReactNode; children: ReactNode; danger?: boolean; onClick: () => void }) => (
  <button className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/[0.05]", danger ? "text-bad" : "text-text hover:text-bright")} onClick={onClick}>
    <span className="flex shrink-0">{icon}</span>
    {children}
  </button>
);

const Row = ({ pack, onDone }: { pack: CatalogPack; onDone: () => void }) => {
  const engine = useEngine();
  const open = useOpenInEditor();
  const catalog = useCatalog();
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ top: number; right: number }>();
  const menuBox = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuBox.current?.contains(target) && !toggle.current?.contains(target)) setMenu(undefined);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);
  const Icon = SourceIcon[pack.source];
  const downloading = catalog.downloading[pack.id];
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };
  const small = "rounded-[2px] px-1.5 text-[10px] uppercase opacity-50 hover:opacity-100 disabled:opacity-20";

  return (
    <div className="group flex items-center gap-2 px-3 py-1 hover:bg-white/[0.04]">
      <span title={SourceTitle[pack.source]} className={pack.source === "new" ? "text-warn" : pack.source === "local" ? "text-code" : "text-dim"}>
        <Icon size={12} strokeWidth={1.75} />
      </span>
      <span className="text-bright min-w-0 flex-1 truncate">{pack.title}</span>
      {downloading !== undefined ? (
        <span className="text-warn shrink-0 font-mono text-[11px] tabular-nums">{Math.round(downloading * 100)}%</span>
      ) : (
        <span className="text-dim shrink-0 font-mono text-[11px] tabular-nums">
          {Math.round(pack.bpm * 10) / 10} · {pack.key}
        </span>
      )}
      <span className="flex shrink-0 items-center gap-1">
        <button disabled={busy} className={cn(small, "bg-deck-a/20 text-deck-a")} onClick={() => act(() => engine!.load("a", pack.id))}>a</button>
        <button disabled={busy} className={cn(small, "bg-deck-b/20 text-deck-b")} onClick={() => act(() => engine!.load("b", pack.id))}>b</button>
        <button disabled={busy} className={cn(small, "text-text")} title="open in the pack editor" onClick={() => act(async () => { await open(pack.id); onDone(); })}>
          <Pencil size={10} strokeWidth={1.75} />
        </button>
        <button
          ref={toggle}
          disabled={busy}
          className={cn(small, "text-text", menu && "opacity-100")}
          title="more"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            setMenu(menu ? undefined : { top: box.bottom + 4, right: window.innerWidth - box.right });
          }}
        >
          <MoreHorizontal size={10} strokeWidth={1.75} />
        </button>
        {menu && (
          // fixed, so the list's scrolling doesn't clip it
          <div
            className="border-line-strong fixed z-[60] w-72 whitespace-nowrap rounded-[4px] border bg-popover py-1 text-[12px] shadow-[0_12px_30px_rgba(0,0,0,0.6)]"
            ref={menuBox}
            style={menu}
          >
            <MenuItem
              icon={<HardDriveDownload size={12} strokeWidth={1.75} />}
              onClick={() => {
                setMenu(undefined);
                act(async () => saveToDisk(pack, await engine!.catalog.ensureLocal(pack.id)));
              }}
            >
              download to disk <span className="text-dim ml-auto text-[11px]">{PackExtension}</span>
            </MenuItem>
            {pack.source === "remote" && (
              <MenuItem
                icon={<Download size={12} strokeWidth={1.75} />}
                onClick={() => {
                  setMenu(undefined);
                  act(() => engine!.catalog.download(pack.id));
                }}
              >
                keep in this browser
              </MenuItem>
            )}
            {pack.source !== "remote" && (
              <MenuItem
                danger
                icon={<Trash2 size={12} strokeWidth={1.75} />}
                onClick={() => {
                  setMenu(undefined);
                  if (confirm(`Remove "${pack.title}" from this browser?`)) act(() => engine!.catalog.remove(pack.id));
                }}
              >
                {pack.source === "new" ? "discard this import" : "remove from this browser"}
              </MenuItem>
            )}
          </div>
        )}
      </span>
    </div>
  );
};

/** The packs menu: import a song, and every pack with load / edit / save */
export const PacksMenu = ({ className }: { className?: string }) => {
  const catalog = useCatalog();
  const importer = useImporter();
  const importSong = useImportSong();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const running = importer.stage !== "idle" && importer.stage !== "done" && importer.stage !== "error";

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => !box.current?.contains(event.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={box} className={cn("relative", className)}>
      <button
        className="text-text hover:text-bright flex h-full items-center gap-1 rounded-[3px] px-2 hover:bg-white/[0.05]"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen(!open)}
      >
        packs
        {running && <span className="text-warn animate-armed">●</span>}
        <ChevronDown size={12} strokeWidth={1.75} className="text-dim" />
      </button>
      {open && (
        <div className="border-line-strong absolute top-8 left-0 z-50 w-[420px] rounded-[4px] border bg-popover py-1 text-[12px] shadow-[0_18px_40px_rgba(0,0,0,0.6)]">
          <button
            className="text-bright flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/[0.05] disabled:opacity-40"
            disabled={running}
            onClick={() => file.current?.click()}
          >
            <FileAudio size={13} strokeWidth={1.75} className="text-deck-a" />
            import a song…
            <span className="text-dim ml-auto text-[11px]">mp3, wav, flac · or drop it anywhere</span>
          </button>
          <input
            ref={file}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(event) => {
              const picked = event.target.files?.[0];
              event.target.value = "";
              if (picked && AudioFile.test(picked.name)) {
                setOpen(false);
                importSong(picked);
              }
            }}
          />
          <div className="bg-line my-1 h-px" />
          <div className="legend flex px-3 pb-1 !text-[8px]">
            {catalog.packs.length} packs
            {!catalog.server && <span className="text-warn ml-auto">offline: only the packs in this browser</span>}
          </div>
          <div className="max-h-[60vh] overflow-auto">
            {catalog.packs.map((pack) => (
              <Row key={pack.id} pack={pack} onDone={() => setOpen(false)} />
            ))}
            {!catalog.packs.length && <div className="text-dim px-3 py-2">no packs yet — import a song</div>}
          </div>
        </div>
      )}
    </div>
  );
};
