import {
  BeatsPerBar,
  Quantize,
  Quantizes
} from "@/common/constants/quantize.constant";
import { TransportState } from "@/common/types/deck.type";
import {
  bpmToCps,
  cpsToBpm,
  nextBoundary,
  tapTempo
} from "@/common/utils/quantize.util";

import { Emitter, Store } from "../utils/store.util";
import { Audio } from "./audio.provider";

// subset of the strudel cyclist scheduler we rely on
type Scheduler = {
  started: boolean;
  cps: number;
  num_ticks_since_cps_change: number;
  num_cycles_at_cps_change: number;
  seconds_at_cps_change?: number;
  setCps(cps: number): void;
  stop(): void;
};

type Anchor = { cps: number; cycles: number; seconds: number };

// fixed offset the scheduler adds to every event
const Latency = 0.1;
// audio needs a little time to be scheduled
const LeadSeconds = 0.035;
const TickMs = 20;

class TransportProvider {
  store = new Store<TransportState>({
    started: false,
    bpm: 120,
    quantize: "bar"
  });

  // fires on every tick with the audible cycle
  tick = new Emitter<number>();
  // fires after the tempo changed and the clock mapping is valid again
  tempo = new Emitter<number>();
  toggled = new Emitter<boolean>();

  private scheduler?: Scheduler;
  private anchor?: Anchor;
  private timer?: ReturnType<typeof setInterval>;
  private taps: number[] = [];
  private waiting: (() => void)[] = [];

  attach(scheduler: Scheduler) {
    this.scheduler = scheduler;
    scheduler.setCps(bpmToCps(this.store.get().bpm));
  }

  onToggle(started: boolean) {
    this.anchor = undefined;
    this.store.set({ started });
    clearInterval(this.timer);

    if (started) {
      this.timer = setInterval(() => this.onTick(), TickMs);
      this.onTick();
    }
    this.toggled.emit(started);
  }

  private onTick() {
    const scheduler = this.scheduler;
    if (!scheduler?.started) return;

    // the scheduler re-anchors itself one tick after a tempo change,
    // until then its numbers do not describe the audible clock
    if (
      scheduler.num_ticks_since_cps_change > 0 &&
      scheduler.seconds_at_cps_change !== undefined
    ) {
      const previous = this.anchor;
      const changed =
        !previous ||
        previous.cps !== scheduler.cps ||
        previous.cycles !== scheduler.num_cycles_at_cps_change ||
        previous.seconds !== scheduler.seconds_at_cps_change;

      if (changed) {
        this.anchor = {
          cps: scheduler.cps,
          cycles: scheduler.num_cycles_at_cps_change,
          seconds: scheduler.seconds_at_cps_change
        };

        if (previous && previous.cps !== scheduler.cps) {
          const bpm = Math.round(cpsToBpm(scheduler.cps) * 100) / 100;
          this.store.set({ bpm });
          this.tempo.emit(bpm);
        }
      }
    }

    if (this.anchor) {
      this.waiting.splice(0).forEach((resolve) => resolve());
      this.tick.emit(this.now());
    }
  }

  /** Resolves once the clock runs and cycles can be mapped to audio time */
  ready() {
    if (this.running) return Promise.resolve();
    return new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  get running() {
    return !!this.anchor && !!this.scheduler?.started;
  }

  get cps() {
    return this.anchor?.cps || bpmToCps(this.store.get().bpm);
  }

  get bpm() {
    return this.store.get().bpm;
  }

  /** Cycle heard at audio time `time` (1 cycle = 1 bar) */
  cycleAt(time: number) {
    const anchor = this.anchor;
    if (!anchor) return 0;

    return (time - Latency - anchor.seconds) * anchor.cps + anchor.cycles;
  }

  /** Audio time at which `cycle` is heard */
  timeAt(cycle: number) {
    const anchor = this.anchor;
    if (!anchor) return Audio.ctx.currentTime;

    return (cycle - anchor.cycles) / anchor.cps + anchor.seconds + Latency;
  }

  now() {
    return this.running ? this.cycleAt(Audio.ctx.currentTime) : 0;
  }

  /** Next launch point for a quantize setting, in cycles */
  next(quantize: Quantize = this.store.get().quantize) {
    return nextBoundary(this.now(), quantize, LeadSeconds * this.cps);
  }

  /** bar (1 based), beat (1 based) and phase inside the beat */
  position(cycle = this.now()) {
    const bar = Math.floor(cycle);
    const beats = (cycle - bar) * BeatsPerBar;

    return {
      cycle,
      bar: bar + 1,
      beat: Math.floor(beats) + 1,
      phase: beats % 1,
      phrase: (bar % 4) + 1
    };
  }

  setBpm(value: number) {
    const bpm = Math.max(40, Math.min(300, Math.round(value * 100) / 100));
    this.store.set({ bpm });
    this.scheduler?.setCps(bpmToCps(bpm));
  }

  nudge(amount: number) {
    this.setBpm(this.bpm + amount);
  }

  tap() {
    this.taps = [...this.taps.slice(-7), performance.now()];
    const bpm = tapTempo(this.taps);
    if (bpm) this.setBpm(bpm);
    return bpm;
  }

  setQuantize(quantize: Quantize) {
    this.store.set({ quantize });
  }

  cycleQuantize() {
    const index = Quantizes.indexOf(this.store.get().quantize);
    this.setQuantize(Quantizes[(index + 1) % Quantizes.length]);
  }

  stop() {
    this.scheduler?.stop();
  }
}

export const Transport = new TransportProvider();
