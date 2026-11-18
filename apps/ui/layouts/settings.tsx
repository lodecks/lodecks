import { Check, RotateCcw } from "lucide-react";
import { ReactNode } from "react";

import { DeckId, DeckIds } from "@/common/constants/deck.constant";
import { DeckSwatches, DefaultDeckColors, Palette, Palettes } from "@/common/constants/theme.constant";
import { Button } from "@/components/button";
import { DefaultSettings, Settings } from "@/engine/providers/settings.provider";
import { useStore } from "@/providers/engine.provider";
import { cn } from "~/utils/classes.util";

const Section = ({ title, hint, children }: { title: string; hint: string; children: ReactNode }) => (
  <section className="border-line border-t py-8">
    <h2 className="text-bright text-[15px] tracking-[0.04em]">{title}</h2>
    <p className="text-muted mt-1 mb-5 text-[12px]">{hint}</p>
    {children}
  </section>
);

/** A palette as a tiny editor: its surfaces, a few lines of code, the decks */
const PaletteCard = ({ palette, decks, chosen }: { palette: Palette; decks: Record<DeckId, string>; chosen: boolean }) => {
  const c = palette.colors;
  return (
    <button
      type="button"
      onClick={() => Settings.set({ palette: palette.id as (typeof Palettes)[number]["id"] })}
      className={cn(
        "group flex flex-col overflow-hidden rounded-[6px] border text-left transition-colors",
        chosen ? "border-[var(--color-deck-a)]" : "border-line hover:border-line-strong"
      )}
      style={chosen ? { boxShadow: "0 0 0 1px var(--color-deck-a)" } : undefined}
    >
      <div className="flex h-24 flex-col gap-1.5 p-3 font-mono text-[9px]" style={{ background: c.ink, color: c.text }}>
        <div className="flex items-center gap-1.5" style={{ color: c.dim }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: decks.a }} />
          <span>deck a</span>
          <span className="ml-auto h-1.5 w-1.5 rounded-full" style={{ background: decks.b }} />
          <span>deck b</span>
        </div>
        <div>
          <span style={{ color: c.code }}>const</span> a = deck(<span style={{ color: decks.a }}>"a"</span>)
        </div>
        <div style={{ color: c.dim }}>// the song keeps going</div>
        <div className="mt-auto flex h-4 items-end gap-[2px]">
          {[5, 8, 6, 9, 4, 7, 9, 5, 8, 6, 7, 4].map((height, index) => (
            <span key={index} className="block flex-1 rounded-[1px]" style={{ height: height * 1.7, background: index < 6 ? decks.a : decks.b, opacity: 0.8 }} />
          ))}
        </div>
      </div>
      <div className="border-line flex items-center gap-2 border-t px-3 py-2" style={{ background: c.panel }}>
        <span className="flex-1">
          <span className="block text-[12px]" style={{ color: c.bright }}>
            {palette.name}
          </span>
          <span className="block text-[11px]" style={{ color: c.muted }}>
            {palette.description}
          </span>
        </span>
        {chosen && <Check size={14} strokeWidth={2} className="text-deck-a shrink-0" />}
      </div>
    </button>
  );
};

const DeckColor = ({ id, color, other }: { id: DeckId; color: string; other: string }) => {
  const set = (value: string) => Settings.set({ deckColors: { ...Settings.store.get().deckColors, [id]: value } });
  return (
    <div className="flex flex-wrap items-center gap-4 py-2">
      <span className="flex w-24 items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium text-[var(--color-ink)]" style={{ background: color, boxShadow: `0 0 10px ${color}66` }}>
          {id.toUpperCase()}
        </span>
        <span className="text-bright text-[13px]">deck {id}</span>
      </span>
      <span className="flex items-center gap-1.5">
        {DeckSwatches.map((swatch) => (
          <button
            key={swatch}
            type="button"
            title={swatch}
            onClick={() => set(swatch)}
            className={cn("h-6 w-6 rounded-full border-2 transition-transform hover:scale-110", swatch === color ? "border-[var(--color-bright)]" : "border-transparent")}
            style={{ background: swatch }}
          />
        ))}
        {/* any colour */}
        <label className="border-line-strong relative ml-1 flex h-6 cursor-pointer items-center gap-1.5 rounded-full border px-2 text-[11px]" title="pick any colour">
          <input type="color" value={color} onChange={(event) => set(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
          <span className="h-3 w-3 rounded-full" style={{ background: color }} />
          <span className="text-muted font-mono">{color}</span>
        </label>
      </span>
      {color.toLowerCase() === other.toLowerCase() && <span className="text-warn text-[11px]">same as the other deck: they'll be hard to tell apart</span>}
      {color !== DefaultDeckColors[id] && (
        <Button size="sm" design="ghost" onClick={() => set(DefaultDeckColors[id])} title="back to the default colour">
          <RotateCcw size={10} /> default
        </Button>
      )}
    </div>
  );
};

const Toggle = ({ on, onChange, label, hint }: { on: boolean; onChange: (on: boolean) => void; label: string; hint: string }) => (
  <label className="flex cursor-pointer items-start gap-3">
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn("relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-[var(--color-deck-a)]" : "bg-line-strong")}
    >
      <span className={cn("bg-bright absolute top-0.5 h-4 w-4 rounded-full transition-[left]", on ? "left-[18px]" : "left-0.5")} />
    </button>
    <span>
      <span className="text-bright block text-[13px]">{label}</span>
      <span className="text-muted block text-[12px]">{hint}</span>
    </span>
  </label>
);

/** The settings themselves: on the /settings page, and in a tab next to the set */
export const SettingsPanel = () => {
  const settings = useStore(Settings.store, DefaultSettings);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-bright font-display text-[26px] font-light">Settings</h1>
      <p className="text-muted mt-1 mb-6 text-[13px]">Saved in this browser as you change them. Other open lodecks tabs follow along.</p>

      <Section title="Palette" hint="The colours of the surfaces and the text. All dark, so they stay easy on the eyes in a dark room.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Palettes.map((palette) => (
            <PaletteCard key={palette.id} palette={palette} decks={settings.deckColors} chosen={palette.id === settings.palette} />
          ))}
        </div>
      </Section>

      <Section title="Deck colours" hint="Each deck's colour, everywhere: the decks, the waveforms, the mixer, and the visuals that follow the decks.">
        {DeckIds.map((id) => (
          <DeckColor key={id} id={id} color={settings.deckColors[id]} other={settings.deckColors[id === "a" ? "b" : "a"]} />
        ))}
      </Section>

      <Section title="New sets" hint="What a set you create starts with.">
        <Toggle
          on={settings.starterCode}
          onChange={(starterCode) => Settings.set({ starterCode })}
          label="Start with example code"
          hint={settings.starterCode ? "New sets come with a deck, its controls and a few comments to get going." : "New sets start empty."}
        />
      </Section>

      <Section title="Editor" hint="How much the code editor tells you while you type.">
        <Toggle
          on={settings.editorDocs}
          onChange={(editorDocs) => Settings.set({ editorDocs })}
          label="Docs while typing"
          hint={
            settings.editorDocs
              ? "Suggestions come with what each one does, hovering a name shows its docs, and the call you type shows its arguments and what it does. Handy while learning."
              : "Quiet, for playing a set: suggestions are names only, no docs on hover, and the call you type shows just its arguments."
          }
        />
      </Section>

      <section className="border-line border-t pt-8">
        <Button design="ghost" onClick={() => Settings.reset()}>
          <RotateCcw size={11} /> reset all settings
        </Button>
      </section>
    </div>
  );
};

/** /settings: the same settings as a page of their own */
export const LayoutSettings = () => (
  <div className="bg-ink min-h-screen">
    <header className="border-line flex h-11 items-center gap-3 border-b px-4 text-[12px]">
      <a href="/play" className="flex items-center gap-2">
        <img src="/logo.svg" alt="" className="h-5 w-5" />
        <span className="text-bright tracking-[0.04em]">lodecks</span>
      </a>
      <span className="text-dim">/</span>
      <span className="text-text">settings</span>
      <a href="/play" className="text-muted hover:text-bright ml-auto">
        open lodecks →
      </a>
    </header>
    <main>
      <SettingsPanel />
    </main>
  </div>
);
