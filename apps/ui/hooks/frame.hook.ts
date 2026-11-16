import { useEffect, useRef } from "react";

type Callback = (time: number) => void;

const callbacks = new Set<Callback>();
let running = false;

const loop = (time: number) => {
  if (!callbacks.size) {
    running = false;
    return;
  }
  callbacks.forEach((callback) => callback(time));
  requestAnimationFrame(loop);
};

/**
 * Runs `callback` on every animation frame. All users share one loop,
 * which stops when nothing is subscribed and while the tab is hidden.
 */
export const useFrame = (callback: Callback, enabled = true) => {
  const latest = useRef(callback);
  latest.current = callback;

  useEffect(() => {
    if (!enabled) return;

    const run: Callback = (time) => latest.current(time);
    callbacks.add(run);
    if (!running) {
      running = true;
      requestAnimationFrame(loop);
    }

    return () => {
      callbacks.delete(run);
    };
  }, [enabled]);
};
