import { useEffect, useRef, useState } from "react";

import { useDeck, useEngine, useTransport } from "@/hooks/engine.hook";
import { cn } from "~/utils/classes.util";

// taps further apart than this start a new count
const TapGap = 2000;

/**
 * The master tempo, and a popover to change it on purpose: type it, step
 * it, tap it, or take a deck's. Nothing changes it by accident (no scroll).
 */
export const TempoControl = ({ className, children }: { className?: string; children: React.ReactNode }) => {
  const engine = useEngine();
  const transport = useTransport();
  const a = useDeck("a");
  const b = useDeck("b");
  const [open, setOpen] = useState(false);
  const [taps, setTaps] = useState<number[]>([]);
  const [tapped, setTapped] = useState<number>();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => !box.current?.contains(event.target as Node) && setOpen(false);
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  useEffect(() => {
    if (input.current && document.activeElement !== input.current) input.current.value = transport.bpm.toFixed(1);
  }, [transport.bpm, open]);

  const set = (bpm: number) => Number.isFinite(bpm) && bpm > 0 && engine?.transport.setBpm(bpm);
  const tap = () => {
    const now = performance.now();
    const recent = taps.length && now - taps[taps.length - 1] > TapGap ? [now] : [...taps, now];
    setTaps(recent);
    const bpm = engine?.transport.tap();
    setTapped(bpm ?? undefined);
  };
  const step = "keycap h-6 min-w-9 px-1.5 font-mono text-[11px] tabular-nums";

  return (
    <div ref={box} className="relative">
      <button
        className={cn("rounded-[3px] hover:bg-white/[0.05]", open && "bg-white/[0.05]", className)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen(!open)}
        title="master tempo · click to change it"
      >
        {children}
      </button>
      {open && engine && (
        <div className="border-line-strong absolute top-8 left-0 z-50 flex w-64 flex-col gap-2 rounded-[4px] border bg-popover p-3 text-[12px] shadow-[0_18px_40px_rgba(0,0,0,0.6)]">
          <div className="flex items-baseline gap-2">
            <input
              ref={input}
              autoFocus
              defaultValue={transport.bpm.toFixed(1)}
              inputMode="decimal"
              className="bg-ink border-line text-bright w-24 border px-2 py-1 font-mono text-[18px] tabular-nums outline-none"
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") set(parseFloat((event.target as HTMLInputElement).value));
                if (event.key === "Escape") setOpen(false);
              }}
              onBlur={(event) => set(parseFloat(event.target.value))}
            />
            <span className="text-dim">bpm · enter sets it</span>
          </div>
          <div className="flex gap-1">
            {[-1, -0.1, 0.1, 1].map((amount) => (
              <button key={amount} className={step} onMouseDown={(event) => event.preventDefault()} onClick={() => engine.transport.nudge(amount)}>
                {amount > 0 ? "+" : "−"}
                {Math.abs(amount)}
              </button>
            ))}
          </div>
          <button
            className="keycap flex h-9 items-center justify-center gap-2 font-mono text-[12px] tracking-[0.1em] uppercase active:brightness-150"
            onMouseDown={(event) => {
              // fires on press, so taps land on the beat
              event.preventDefault();
              tap();
            }}
            title="press it in time with the music, three times or more"
          >
            tap
            <span className="text-dim normal-case tracking-normal">
              {tapped ? `${tapped.toFixed(1)} bpm` : taps.length ? `${Math.max(0, 3 - taps.length)} more` : "in time, 3+ times"}
            </span>
          </button>
          {(a.pack || b.pack) && (
            <div className="flex gap-1">
              {(["a", "b"] as const).map((id) => {
                const pack = id === "a" ? a.pack : b.pack;
                if (!pack) return null;
                return (
                  <button
                    key={id}
                    className={cn(step, "flex flex-1 items-center justify-center gap-1.5")}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => set(pack.bpm)}
                    title={`the tempo of ${pack.title}`}
                  >
                    <span className={id === "a" ? "text-deck-a" : "text-deck-b"}>{id.toUpperCase()}</span>
                    {pack.bpm.toFixed(1)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
