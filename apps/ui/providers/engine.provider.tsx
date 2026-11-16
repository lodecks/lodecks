import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore
} from "react";

import type { Engine as EngineType } from "@/engine/index";
import type { Store } from "@/engine/utils/store.util";

export type EngineInstance = typeof EngineType;

export type EngineContextType = { engine?: EngineInstance };

export const EngineContext = createContext<EngineContextType>({});

/**
 * The engine touches Web Audio and the DOM, so it is only ever
 * loaded in the browser, after the server render has hydrated.
 */
export const EngineContextProvider = ({ children }: { children: ReactNode }) => {
  const [engine, setEngine] = useState<EngineInstance>();

  useEffect(() => {
    let mounted = true;
    import("@/engine/index").then(({ Engine }) => {
      if (!mounted) return;
      (window as any).lodecks = Engine;
      setEngine(Engine);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <EngineContext.Provider value={{ engine }}>
      {children}
    </EngineContext.Provider>
  );
};

export const useEngineContext = () => {
  return useContext(EngineContext);
};

const noop = () => () => {};

/** Reads an engine store, `fallback` is used until the engine is loaded */
export const useStore = <T extends object>(
  store: Store<T> | undefined,
  fallback: T
): T => {
  return useSyncExternalStore(
    store?.subscribe || noop,
    () => (store ? store.get() : fallback),
    () => fallback
  );
};
