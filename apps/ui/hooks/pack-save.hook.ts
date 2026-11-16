import { useSetAtom } from "jotai";
import { useCallback } from "react";

import type { Deck } from "@/engine/modules/deck/deck.module";

import { packTab, replaceTab } from "@/components/live/tabs";
import { useEngine } from "@/hooks/engine.hook";
import { saveErrorAtom } from "@/utils/atoms.util";

/**
 * Saves a deck's pack (the focused one unless given) in this browser:
 * local first, nothing is ever written to the server. A pack downloaded
 * from the server is kept as your own copy; a fresh import is named after
 * its (renamed) title on its first save.
 */
export const usePackSave = () => {
  const engine = useEngine();
  const setError = useSetAtom(saveErrorAtom);

  return useCallback(
    async (on?: Deck) => {
      const deck = on ?? engine?.focused;
      const packId = deck?.store.get().packId;
      const manifest = deck?.manifest();
      if (!engine || !deck || !packId || !manifest) return;
      const fail = (text: string) => setError({ deck, text });
      const catalog = engine.catalog;
      try {
        const id = catalog.sourceOf(packId) === "new" ? catalog.freeId(manifest.title, packId) : packId;
        const zipped = deck.zip();
        if (!zipped) {
          fail("this pack's audio is not in the browser, so it can't be saved");
          return;
        }
        await catalog.saveToBrowser(id, zipped.pack, zipped.bytes);
        if (id !== packId) {
          await catalog.remove(packId).catch(() => {});
          deck.setPackId(id);
          // an editor's tab follows the pack to its new id
          if (deck.editor) {
            engine.renameEditor(packId, id);
            replaceTab(packTab(packId), packTab(id));
          }
        }
        deck.markSaved();
        setError(undefined);
      } catch (error) {
        fail(`save failed: ${(error as Error).message}`);
      }
    },
    [engine, setError]
  );
};
