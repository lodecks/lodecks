import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { PaletteCommand, useCommands } from "@/hooks/commands.hook";
import { useEngine } from "@/hooks/engine.hook";
import { fuzzy } from "@/utils/fuzzy.util";
import { cn } from "~/utils/classes.util";

const RecentKey = "lodecks.palette.recent";

const recent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RecentKey) || "[]");
  } catch {
    return [];
  }
};

const remember = (id: string) => {
  try {
    localStorage.setItem(RecentKey, JSON.stringify([id, ...recent().filter((item) => item !== id)].slice(0, 8)));
  } catch {}
};

const Highlight = ({ text, positions }: { text: string; positions: number[] }) => {
  const marked = new Set(positions);
  return (
    <>
      {[...text].map((char, index) => (
        <span key={index} className={marked.has(index) ? "text-deck-a" : undefined}>
          {char}
        </span>
      ))}
    </>
  );
};

/**
 * The command palette, ⌘⇧P (Ctrl+Shift+P): every command of this screen,
 * found by typing a few letters. Commands that need a name or a number ask
 * for it in the same box.
 */
export const CommandPalette = () => {
  const engine = useEngine();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [asking, setAsking] = useState<PaletteCommand>();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const commands = useCommands();

  // opened from anywhere, before the editors and the deck keys see the keys
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === "KeyP") {
        event.preventDefault();
        event.stopPropagation();
        setOpen((value) => !value);
        setQuery("");
        setAsking(undefined);
        setSelected(0);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
  }, [open, asking]);

  const results = useMemo(() => {
    if (asking) return [];
    const order = recent();
    if (!query.trim()) {
      const recents = order.map((id) => commands.find((command) => command.id === id)).filter(Boolean) as PaletteCommand[];
      const rest = commands.filter((command) => !order.includes(command.id));
      return [...recents, ...rest].map((command) => ({ command, positions: [] as number[], recent: order.includes(command.id) }));
    }
    return commands
      .map((command) => {
        const match = fuzzy(query, command.title);
        return match && { command, positions: match.positions, recent: false, score: match.score + (order.includes(command.id) ? 2 : 0) };
      })
      .filter(Boolean)
      .sort((a, b) => b!.score - a!.score)
      .slice(0, 60) as { command: PaletteCommand; positions: number[]; recent: boolean }[];
  }, [commands, query, asking]);

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const close = () => {
    setOpen(false);
    setAsking(undefined);
    setQuery("");
  };

  const perform = async (command: PaletteCommand) => {
    remember(command.id);
    if (command.ask) {
      setAsking(command);
      setQuery(command.ask.initial ?? "");
      return;
    }
    close();
    try {
      await command.run?.();
    } catch (error) {
      engine?.live.say("error", (error as Error).message);
    }
  };

  const submit = async () => {
    if (asking) {
      const command = asking;
      const text = query.trim();
      close();
      if (!text) return;
      try {
        await command.ask!.run(text);
      } catch (error) {
        engine?.live.say("error", (error as Error).message);
      }
      return;
    }
    const chosen = results[selected];
    if (chosen) perform(chosen.command);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex justify-center bg-black/30 pt-[12vh]" onMouseDown={close}>
      <div
        className="border-line-strong flex h-fit max-h-[60vh] w-[620px] flex-col overflow-hidden rounded-[6px] border bg-popover shadow-[0_24px_60px_rgba(0,0,0,0.7)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-line flex items-center gap-2 border-b px-3">
          <ChevronRight size={14} strokeWidth={2} className="text-code shrink-0" />
          {asking && <span className="text-dim shrink-0 text-[12px]">{asking.title.replace(/…$/, "")}</span>}
          <input
            ref={input}
            value={query}
            spellCheck={false}
            placeholder={asking ? asking.ask!.placeholder : "type a command"}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") return asking ? (setAsking(undefined), setQuery("")) : close();
              if (event.key === "Enter") return void submit();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((index) => Math.min(results.length - 1, index + 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((index) => Math.max(0, index - 1));
              }
            }}
            className="text-bright placeholder:text-dim/70 h-11 min-w-0 flex-1 bg-transparent font-mono text-[14px] outline-none"
          />
        </div>
        {!asking && (
          <div ref={list} className="min-h-0 overflow-auto py-1">
            {results.map(({ command, positions, recent: isRecent }, index) => (
              <div
                key={command.id}
                data-index={index}
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-3 py-1.5 text-[13px]",
                  index === selected ? "text-bright bg-[color-mix(in_srgb,var(--color-code)_22%,transparent)]" : "text-text"
                )}
                onMouseMove={() => setSelected(index)}
                onClick={() => perform(command)}
              >
                <span className="min-w-0 flex-1 truncate">
                  <Highlight text={command.title} positions={positions} />
                  {command.detail && <span className="text-dim ml-2 text-[11px]">{command.detail}</span>}
                </span>
                {isRecent && !query && <span className="text-dim text-[10px]">recent</span>}
                <span className="legend shrink-0 !text-[8px]">{command.group}</span>
                {command.keys && (
                  <kbd className="text-dim border-line shrink-0 rounded-[3px] border px-1.5 font-mono text-[10px]">{command.keys}</kbd>
                )}
              </div>
            ))}
            {!results.length && <div className="text-dim px-3 py-2 text-[12px]">no command matches</div>}
          </div>
        )}
        {asking && <div className="text-dim px-3 py-2 text-[11px]">enter to confirm · esc to go back</div>}
      </div>
    </div>
  );
};
