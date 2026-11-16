import { atom } from "jotai";

import type { Deck } from "@/engine/modules/deck/deck.module";

// keys currently held, for lighting up the on-screen pads
export const heldAtom = atom<ReadonlySet<string>>(new Set<string>());
// why a pack editor's last save failed, shown in that editor
export const saveErrorAtom = atom<{ deck: Deck; text: string } | undefined>(undefined);
