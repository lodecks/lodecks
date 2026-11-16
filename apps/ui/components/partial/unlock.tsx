import { useEffect } from "react";

import { useEngine, useMixer } from "@/hooks/engine.hook";

/**
 * Browsers only start audio after a gesture: the first click or key
 * anywhere starts it, quietly, and goes on to do what it was meant for.
 */
export const Unlock = () => {
  const engine = useEngine();
  const mixer = useMixer();

  useEffect(() => {
    if (!engine || mixer.ready) return;
    // modifier keys alone do not count as a gesture for the browser, so keep
    // listening until audio has actually started
    const unlock = (event: Event) => {
      if (event instanceof KeyboardEvent && ["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      engine.audio.resume();
    };
    // capture, so it runs before whatever the gesture was aimed at
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, [engine, mixer.ready]);

  return null;
};
