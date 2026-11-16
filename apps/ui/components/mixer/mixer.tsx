import { DeckId } from "@/common/constants/deck.constant";

import { Button } from "@/components/button";
import { Fader } from "@/components/fader";
import { Knob } from "@/components/knob";
import { MixerAutomix } from "@/components/mixer/automix";
import { Panel } from "@/components/panel";
import { Colors, useCanvas } from "@/hooks/canvas.hook";
import { useDeck, useEngine, useMixer } from "@/hooks/engine.hook";
import { cn } from "~/utils/classes.util";

/** A column of small LEDs, green to amber to red */
const Meter = ({ level, className }: { level: () => number; className?: string }) => {
  const ref = useCanvas((ctx, width, height) => {
    const value = Math.min(1, level() * 2.2);
    const cells = 12;
    const cell = height / cells;
    ctx.clearRect(0, 0, width, height);
    for (let index = 0; index < cells; index++) {
      const lit = index / cells < value;
      const color = index > cells - 2 ? "#ff3b30" : index > cells - 4 ? Colors.warn : "#7fd69c";
      ctx.fillStyle = lit ? color : "#1f2023";
      ctx.beginPath();
      ctx.roundRect(0, height - (index + 1) * cell + 1.5, width, cell - 3, width / 2);
      ctx.fill();
    }
  });
  return <canvas ref={ref} className={cn("w-1.5", className)} />;
};

const Channel = ({ id, mirror }: { id: DeckId; mirror?: boolean }) => {
  const engine = useEngine();
  const deck = useDeck(id);
  const instance = engine?.decks[id];

  // encoders in a 2×2 block beside the fader; deck B mirrors deck A
  const knobs = (
    <div className="flex flex-col items-center gap-1">
      <span className="text-accent text-[15px] leading-none font-light">{id.toUpperCase()}</span>
      <div className="grid grid-cols-2 gap-x-1 gap-y-0.5">
        <Knob size="sm" color="blue" label="hi" value={deck.eq.high} onChange={(value) => instance?.setEq("high", value)} />
        <Knob size="sm" color="tan" label="mid" value={deck.eq.mid} onChange={(value) => instance?.setEq("mid", value)} />
        <Knob size="sm" color="gray" label="low" value={deck.eq.low} onChange={(value) => instance?.setEq("low", value)} />
        <Knob size="sm" color="orange" label="filter" value={deck.filter} onChange={(value) => instance?.setFilter(value)} />
      </div>
      <Button size="sm" design={deck.prelisten ? "active" : "default"} onClick={() => instance?.setPrelisten(!deck.prelisten)} title="pre-listen in headphones">
        cue
      </Button>
    </div>
  );

  const fader = (
    <div className="flex min-h-0 gap-1.5 py-1">
      {mirror && <Meter level={() => engine?.analysis.data.decks[id] ?? 0} />}
      <Fader value={deck.volume} reset={0.9} onChange={(value) => instance?.setVolume(value)} label={`deck ${id} volume`} />
      {!mirror && <Meter level={() => engine?.analysis.data.decks[id] ?? 0} />}
    </div>
  );

  return (
    <div data-deck={id} className="flex min-h-0 items-stretch gap-2">
      {mirror ? fader : knobs}
      {mirror ? knobs : fader}
    </div>
  );
};

/** Two deck channels, instruments, master and the crossfader */
/** Channels, master and crossfader, without the panel around them */
export const MixerBody = ({ className }: { className?: string }) => {
  const engine = useEngine();
  const mixer = useMixer();

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex min-h-0 flex-1 justify-between gap-2 px-2">
        <Channel id="a" />
        <div className="flex min-h-0 flex-col items-center gap-1">
          <span className="text-bright text-[15px] font-light">M</span>
          <div className="flex min-h-12 flex-1 gap-1.5 py-1">
            <Fader className="[--accent:var(--color-gray)]" value={mixer.master} reset={0.9} onChange={(value) => engine?.audio.setMaster(value)} label="master volume" />
            <Meter level={() => engine?.analysis.data.level ?? 0} />
          </div>
          <span className="legend !text-[8px]">main</span>
        </div>
        <Channel id="b" mirror />
      </div>
      {/* crossfader in its own slot, like the one on a controller */}
      <div className="flex items-center gap-3 px-2">
        <span className="text-deck-a text-[13px] font-light">A</span>
        <Fader orientation="horizontal" value={mixer.crossfade} reset={0.5} onChange={(value) => engine?.audio.setCrossfade(value)} label="crossfader" className="[--accent:var(--color-gray)]" />
        <span className="text-deck-b text-[13px] font-light">B</span>
      </div>
      <MixerAutomix />
    </div>
  );
};

export const Mixer = () => {
  const mixer = useMixer();

  return (
    <Panel title="mixer" bodyClassName="flex flex-col gap-2 px-1 pb-1" actions={<span className="legend">cue {mixer.cueMode}</span>}>
      <MixerBody className="min-h-0 flex-1" />
    </Panel>
  );
};
