import { useCallback, useEffect } from "react";

import type { CatalogPack } from "@/engine/modules/importer/catalog.module";
import type { ImportState } from "@/engine/modules/importer/importer.module";

import { useEngine } from "@/hooks/engine.hook";
import { useStore } from "@/providers/engine.provider";
import { focusedPane } from "@/components/live/editor";
import { openPackTab } from "@/components/live/tabs";

const ImportIdle: ImportState = { stage: "idle", title: "", progress: 0, detail: "", log: [] };
const CatalogEmpty: { packs: CatalogPack[]; server: boolean; downloading: Record<string, number> } = { packs: [], server: true, downloading: {} };

export const useImporter = () => {
  const engine = useEngine();
  return useStore(engine?.importer.store, ImportIdle);
};

/** Every pack: server, browser, fresh imports; read once the engine is up */
export const useCatalog = () => {
  const engine = useEngine();
  useEffect(() => {
    if (engine && !engine.catalog.list().length) engine.catalog.refresh();
  }, [engine]);
  return useStore(engine?.catalog.store, CatalogEmpty);
};

export const AudioFile = /\.(mp3|wav|flac|ogg|m4a|aac|aiff?)$/i;

/** Opens a pack in the pack editor, a tab on a deck of its own: A and B are left alone */
export const useOpenInEditor = () => {
  return useCallback((packId: string) => openPackTab(packId, focusedPane()), []);
};

/** Starts an import; when it is done the pack opens in the editor */
export const useImportSong = () => {
  const engine = useEngine();
  const open = useOpenInEditor();
  return useCallback(
    async (file: File) => {
      if (!engine || engine.importer.busy) return;
      const id = await engine.importer.run(file);
      if (id) await open(id);
    },
    [engine, open]
  );
};

/** Dropping a song anywhere on the page imports it */
export const useDropToImport = () => {
  const importSong = useImportSong();
  useEffect(() => {
    const over = (event: DragEvent) => {
      if ([...(event.dataTransfer?.items ?? [])].some((item) => item.kind === "file")) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      // a panel that took the drop (gifs, packs) keeps it
      if (event.defaultPrevented) return;
      const song = [...(event.dataTransfer?.files ?? [])].find((file) => AudioFile.test(file.name));
      if (!song) return;
      event.preventDefault();
      importSong(song);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [importSong]);
};
