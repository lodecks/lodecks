import { RefObject, useEffect, useRef } from "react";

import { useFrame } from "@/hooks/frame.hook";

export type Draw = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number
) => void;

/**
 * A canvas redrawn on the shared frame loop, sized to its box and
 * skipped while scrolled out of view.
 */
export const useCanvas = (draw: Draw, enabled = true) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = useRef({ width: 0, height: 0, visible: true });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const resize = new ResizeObserver(([entry]) => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const { width, height } = entry.contentRect;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      size.current.width = canvas.width;
      size.current.height = canvas.height;
    });
    const visible = new IntersectionObserver(([entry]) => {
      size.current.visible = entry.isIntersecting;
    });
    resize.observe(canvas);
    visible.observe(canvas);

    return () => {
      resize.disconnect();
      visible.disconnect();
    };
  }, []);

  useFrame((time) => {
    const canvas = ref.current;
    const { width, height, visible } = size.current;
    if (!canvas || !visible || !width) return;
    const ctx = canvas.getContext("2d");
    if (ctx) draw(ctx, width, height, time);
  }, enabled);

  return ref as RefObject<HTMLCanvasElement>;
};

// screen colours, kept in step with css/base.css; the theme updates them
// (see theme.hook.ts), so read them when drawing, not once
export const Colors = {
  a: "#2be8a0",
  b: "#ff3fb4",
  tan: "#a78bfa",
  gray: "#8f9bb3",
  line: "#1c2433",
  dim: "#56627a",
  text: "#c9d3e6",
  // cool white of the screen graphics
  paper: "#dfe7f5",
  warn: "#ffb347",
  ink: "#03050a"
};
