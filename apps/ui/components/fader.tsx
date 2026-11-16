import { PointerEvent, useRef } from "react";

import { cn } from "~/utils/classes.util";

type FaderProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  // value restored on double click
  reset?: number;
  orientation?: "vertical" | "horizontal";
  label?: string;
  className?: string;
  // fills from the middle, for bipolar controls
  centered?: boolean;
};

/** A slot cut into the body with a chunky ribbed cap riding in it */
export const Fader = ({
  value,
  onChange,
  min = 0,
  max = 1,
  reset,
  orientation = "vertical",
  label,
  className,
  centered
}: FaderProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const vertical = orientation === "vertical";
  const ratio = (value - min) / (max - min);

  const update = (event: PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    const position = vertical
      ? 1 - (event.clientY - rect.top) / rect.height
      : (event.clientX - rect.left) / rect.width;
    onChange(min + Math.max(0, Math.min(1, position)) * (max - min));
  };

  const center = centered ? 0.5 : 0;
  const from = Math.min(center, ratio);
  const size = Math.abs(ratio - center);

  return (
    <div
      ref={ref}
      title={label}
      className={cn(
        "group relative touch-none",
        vertical ? "h-full w-7" : "h-7 w-full",
        className
      )}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        update(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons) update(event);
      }}
      onDoubleClick={() => reset !== undefined && onChange(reset)}
      onWheel={(event) => {
        const step = (max - min) / 50;
        onChange(Math.max(min, Math.min(max, value - Math.sign(event.deltaY) * step)));
      }}
    >
      {/* the slot */}
      <div
        className={cn(
          "absolute rounded-[1px] bg-black shadow-[inset_0_0_0_1px_var(--color-line)]",
          vertical
            ? "top-1 bottom-1 left-1/2 w-[5px] -translate-x-1/2"
            : "top-1/2 right-1 left-1 h-[5px] -translate-y-1/2"
        )}
      >
        {/* lit level inside the slot */}
        <div
          className="bg-accent absolute opacity-70"
          style={
            vertical
              ? { left: 1, right: 1, bottom: `${from * 100}%`, height: `${size * 100}%` }
              : { top: 1, bottom: 1, left: `${from * 100}%`, width: `${size * 100}%` }
          }
        />
      </div>
      {/* scale printed beside the slot */}
      {vertical && (
        <div className="pointer-events-none absolute inset-y-1 left-0 flex flex-col justify-between">
          {Array.from({ length: 9 }, (_, index) => (
            <span key={index} className={cn("bg-line-strong h-px", index % 4 === 0 ? "w-1.5" : "w-1")} />
          ))}
        </div>
      )}
      {/* the cap */}
      <div
        className={cn(
          "keycap absolute flex items-center justify-center !rounded-[2px] group-active:brightness-110",
          vertical ? "left-0 h-4 w-7 -translate-y-1/2" : "top-0 h-7 w-4 -translate-x-1/2"
        )}
        style={vertical ? { top: `${(1 - ratio) * 100}%` } : { left: `${ratio * 100}%` }}
      >
        <span className={cn("bg-accent", vertical ? "h-[2px] w-4" : "h-4 w-[2px]")} />
      </div>
    </div>
  );
};
