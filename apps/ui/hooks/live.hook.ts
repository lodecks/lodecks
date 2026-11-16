import type { LiveState } from "@/engine/modules/live/live.module";

import { useEngine } from "@/hooks/engine.hook";
import { useStore } from "@/providers/engine.provider";

const LiveFallback: LiveState = {
  loaded: false,
  running: [],
  set: { id: "", name: "", updatedAt: 0 },
  sets: [],
  full: false
};

/** The live screen: open set, what runs, the last status */
export const useLiveState = () => {
  const engine = useEngine();
  return useStore(engine?.live.store, LiveFallback);
};
