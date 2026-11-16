import { PointerEvent, useRef } from "react";

import { cn } from "~/utils/classes.util";

export const KnobColors = {
  // names are the slots, colours follow the theme: green, rose, purple
  blue: "var(--color-deck-a)",
  orange: "var(--color-deck-b)",
  tan: "var(--color-code)",
  gray: "var(--color-gray)"
} as const;

// the ring, in the 44 × 44 box
const Ring = 18.5;
const RingWidth = 7;

/** An arc around the centre; angles in degrees, 0 up, clockwise */
const arc = (radius: number, from: number, to: number) => {
  const point = (angle: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return `${22 + radius * Math.cos(rad)} ${22 + radius * Math.sin(rad)}`;
  };
  return `M ${point(from)} A ${radius} ${radius} 0 ${to - from > 180 ? 1 : 0} 1 ${point(to)}`;
};

type KnobProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  reset?: number;
  label: string;
  // colour of the cap
  color?: keyof typeof KnobColors;
  size?: "sm" | "md";
  className?: string;
};

/**
 * An encoder drawn like the knob in code: a ring lit from zero to the
 * value around a dark cap. Drag up / down, scroll, double click resets.
 */
export const Knob = ({
  value,
  onChange,
  min = -1,
  max = 1,
  reset = 0,
  label,
  color = "gray",
  size = "md",
  className
}: KnobProps) => {
  const start = useRef<{ y: number; value: number }>(undefined);
  const ratio = (value - min) / (max - min);
  const angle = -135 + ratio * 270;
  const killed = value <= min + 0.001 && min < 0;
  const zero = -135 + ((reset - min) / (max - min)) * 270;
  const px = size === "sm" ? 34 : 44;
  const cap = KnobColors[color];

  const clamp = (next: number) => Math.max(min, Math.min(max, next));

  return (
    <div
      className={cn("flex touch-none flex-col items-center gap-1", className)}
      title={`${label}: ${value.toFixed(2)} — drag, scroll, double click resets`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { y: event.clientY, value };
      }}
      onPointerMove={(event: PointerEvent) => {
        if (!start.current || !event.buttons) return;
        const delta = (start.current.y - event.clientY) / 140;
        onChange(clamp(start.current.value + delta * (max - min)));
      }}
      onPointerUp={() => (start.current = undefined)}
      onWheel={(event) => onChange(clamp(value - Math.sign(event.deltaY) * (max - min) / 40))}
      onDoubleClick={() => onChange(reset)}
    >
      <svg viewBox="0 0 44 44" width={px} height={px} className="overflow-visible">
        {/* like the knob drawn in code: a ring lit from zero to the value, a dark cap with a pointer */}
        <path d={arc(Ring, -135, 135)} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth={RingWidth} />
        {Math.abs(angle - zero) > 0.5 && (
          <path
            d={arc(Ring, Math.min(zero, angle), Math.max(zero, angle))}
            fill="none"
            stroke={killed ? "var(--color-bad)" : cap}
            strokeWidth={RingWidth}
          />
        )}
        <circle cx="22" cy="22" r={Ring - RingWidth / 2} fill="var(--color-ink)" />
        <g transform={`rotate(${angle} 22 22)`}>
          <line x1="22" y1={22 - Ring + RingWidth / 2 + 1.5} x2="22" y2="17" stroke="var(--color-bright)" strokeWidth="2.6" strokeLinecap="round" />
        </g>
      </svg>
      <span className={cn("legend !text-[9px]", killed && "!text-bad")}>{label}</span>
    </div>
  );
};
