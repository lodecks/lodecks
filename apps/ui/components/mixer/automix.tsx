import { useRef } from "react";

import { Button } from "@/components/button";
import { useAutomix, useEngine } from "@/hooks/engine.hook";
import { useFrame } from "@/hooks/frame.hook";
import { cn } from "~/utils/classes.util";

/** Auto mix: finds the best moment and blends into the other deck */
export const MixerAutomix = () => {
  const engine = useEngine();
  const automix = useAutomix();
  const bar = useRef<HTMLDivElement>(null);
  const countdown = useRef<HTMLSpanElement>(null);
  const { status, plan, from, to } = automix;
  const busy = status !== "idle";

  useFrame(() => {
    if (!engine || !busy) return;
    const now = engine.transport.now();
    if (bar.current) bar.current.style.width = `${engine.automix.progress(now) * 100}%`;
    if (countdown.current && automix.startsAt !== undefined) {
      const bars = automix.startsAt - now;
      countdown.current.textContent =
        bars > 0 ? `in ${Math.ceil(bars)} bar${Math.ceil(bars) === 1 ? "" : "s"}` : "blending";
    }
  }, busy);

  const summary = plan && from && to
    ? `${from.toUpperCase()} bar ${plan.exit.bar + 1} → ${to.toUpperCase()} bar ${plan.entry + 1} · ${plan.length} bars${
        automix.transpose ? ` · ${to.toUpperCase()} ${automix.transpose > 0 ? "+" : ""}${automix.transpose}st` : ""
      }`
    : automix.error || "finds the best moment to blend into the other deck";

  return (
    <div data-deck={to || "b"} className="flex flex-col gap-1 px-1">
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          design={busy ? "active" : "accent"}
          onClick={() => (busy ? engine?.automix.cancel() : engine?.automix.arm())}
          title="auto mix into the other deck (Ctrl+M); press again to cancel"
        >
          {busy ? "cancel" : "auto mix"}
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => engine?.automix.setLength(automix.length === 16 ? 8 : 16)}
          title="blend length in bars"
        >
          {automix.length} bars
        </Button>
        {busy && <span ref={countdown} className="text-accent text-[10px]" />}
        <span className={cn("min-w-0 flex-1 truncate text-right text-[10px]", automix.error && !busy ? "text-bad" : "text-dim")} title={plan?.reasons.join(" · ")}>
          {summary}
        </span>
      </div>
      {busy && (
        <div className="h-[3px] bg-[var(--color-line)]">
          <div ref={bar} className="bg-accent h-full w-0" />
        </div>
      )}
      {busy && plan && <span className="legend truncate !text-[8px]">{plan.reasons.join(" · ")}</span>}
    </div>
  );
};
