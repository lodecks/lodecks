import { Quantize } from "@/common/constants/quantize.constant";
import { Chord, makeChord } from "@/common/utils/chord.util";
import { Key, midiToStrudel, parseKey } from "@/common/utils/music.util";

import { parseLayers } from "../utils/layers.util";
import { Store } from "../utils/store.util";
import { Analysis } from "./analysis.provider";
import { Audio } from "./audio.provider";
import { Transport } from "./transport.provider";

export type StrudelState = {
  ready: boolean;
  // evaluation waiting for the next bar
  pending: boolean;
  dirty: boolean;
  error?: string;
  layers: { name: string; muted: boolean; line: number }[];
  // evaluate on the next bar instead of right away
  quantized: boolean;
  // the set is paused, eg. while editing a pack
  suspended: boolean;
};

export { parseLayers };

export type LiveState = { chord: Chord; key: Key };

// nothing plays until something is added to the set
export const DefaultSet = "// lodecks set\n";

class StrudelProvider {
  store = new Store<StrudelState>({
    ready: false,
    pending: false,
    dirty: false,
    layers: [],
    quantized: true,
    suspended: false
  });

  live = new Store<LiveState>({
    chord: makeChord(9, "min"),
    key: parseKey("Am")
  });

  // strudel's repl: scheduler, evaluation, the master clock
  repl?: any;
  private ready?: Promise<void>;
  // the set, labelled blocks of strudel code
  private source = "";
  private core?: any;
  private instruments = new Map<string, any>();
  private playing?: any;
  private pending?: { pattern: any; at: number };
  private switchAt?: number;
  private timer?: ReturnType<typeof setTimeout>;
  // chord changes, each one heard from its cycle on
  private chords: { at: number; chord: Chord }[] = [];
  private chordTimer?: ReturnType<typeof setTimeout>;
  // pattern held back while the set is suspended
  private held?: { pattern: any };

  /**
   * Starts strudel without an editor: the repl drives the master clock and
   * plays the set, which now lives here as code.
   */
  init(code = DefaultSet) {
    if (!this.ready) this.ready = this.boot(code);
    return this.ready;
  }

  private async boot(code: string) {
    Audio.create();
    this.source = code;

    const [core, mini, tonal, webaudio, transpiler] = await Promise.all([
      import("@strudel/core"),
      import("@strudel/mini"),
      import("@strudel/tonal"),
      import("@strudel/webaudio"),
      import("@strudel/transpiler")
    ]);
    this.core = core;
    (globalThis as any).__strudelCore = core;

    const self = this;
    core.Pattern.prototype.inst = function (name: string) {
      const chain = self.instruments.get(name);
      if (!chain) {
        core.logger?.(`[lodecks] unknown instrument "${name}"`, "warning");
        return this;
      }
      return this.set(chain);
    };

    await core.evalScope(
      Promise.resolve(core),
      Promise.resolve(mini),
      Promise.resolve(tonal),
      Promise.resolve(webaudio),
      Promise.resolve(this.scope())
    );
    webaudio.registerSynthSounds();
    webaudio.registerZZFXSounds();

    this.repl = webaudio.webaudioRepl({
      audioContext: Audio.ctx,
      getTime: () => Audio.ctx.currentTime,
      transpiler: transpiler.transpiler,
      editPattern: (pattern: any) => this.splice(pattern),
      onToggle: (started: boolean) => Transport.onToggle(started),
      onEvalError: (error: Error) => this.store.set({ error: error.message }),
      afterEval: () => {
        Audio.route();
        this.store.set({ error: undefined, dirty: false });
      },
      onUpdateState: (state: any) => {
        if (state.schedulerError) {
          this.store.set({ error: state.schedulerError.message });
        }
      }
    });

    Transport.attach(this.repl.scheduler);
    this.store.set({ ready: true, layers: parseLayers(code) });
  }

  get code(): string {
    return this.source;
  }

  // values the set and the visuals can read while playing
  private scope() {
    const { ref } = this.core;
    const live = this.live;

    return {
      ...Analysis.scope(),
      live: {
        // chord(live.chord).voicing(), live.chord.rootNotes(2).note()
        chord: this.timeline((chord) => chord.strudel),
        // note(live.root)
        root: this.timeline((chord) => midiToStrudel(36 + chord.root)),
        // n("0 2 4").scale(live.scale)
        scale: ref(
          () =>
            `${midiToStrudel(60 + live.get().key.root).slice(0, -1)}:${live.get().key.scale}`
        )
      }
    };
  }

  private chordAt(cycle: number) {
    let chord = this.live.get().chord;
    for (const change of this.chords) {
      if (change.at <= cycle + 1e-9) chord = change.chord;
    }
    return chord;
  }

  /**
   * A pattern holding the live chord for a bar, split exactly where a
   * chord change was committed, so changes are heard on the beat.
   */
  private timeline(value: (chord: Chord) => string) {
    const { Pattern, TimeSpan, Hap, Fraction } = this.core;

    return new Pattern((state: any) => {
      const begin = state.span.begin.valueOf();
      const end = state.span.end.valueOf();
      const haps = [];
      let cursor = begin;

      while (cursor < end - 1e-9) {
        let start = Math.floor(cursor + 1e-9);
        let stop = start + 1;
        for (const change of this.chords) {
          if (change.at <= cursor + 1e-9 && change.at > start) start = change.at;
          if (change.at > cursor + 1e-9 && change.at < stop) stop = change.at;
        }

        const whole = new TimeSpan(Fraction(start), Fraction(stop));
        const part = new TimeSpan(
          Fraction(Math.max(cursor, start)),
          Fraction(Math.min(end, stop))
        );
        haps.push(new Hap(whole, part, value(this.chordAt(cursor))));
        cursor = Math.min(end, stop);
      }

      return haps;
    });
  }

  /** Changes the live chord on the next beat (or other quantize point) */
  commitChord(chord: Chord, quantize: Quantize = "beat") {
    if (!Transport.running) {
      this.chords = [];
      this.live.set({ chord });
      return;
    }

    const at = Transport.next(quantize);
    const now = Transport.now();
    // keep only what the scheduler may still be asking about
    this.chords = [
      ...this.chords.filter((change) => change.at < at && change.at > now - 4),
      { at, chord }
    ];

    clearTimeout(this.chordTimer);
    const wait = (Transport.timeAt(at) - Audio.ctx.currentTime) * 1000;
    this.chordTimer = setTimeout(
      () => this.live.set({ chord }),
      Math.max(0, wait)
    );
  }

  /**
   * Keeps the playing pattern until `switchAt`, then plays the new one,
   * so edits land exactly on a bar line.
   */
  private splice(pattern: any) {
    // while suspended, a new evaluation is kept for later and stays silent
    if (this.held) {
      this.held.pattern = pattern;
      this.switchAt = undefined;
      return this.core.silence;
    }

    const now = Transport.now();
    if (this.pending && now >= this.pending.at) {
      this.playing = this.pending.pattern;
      this.pending = undefined;
    }

    const at = this.switchAt;
    this.switchAt = undefined;
    const previous = this.playing;

    if (at === undefined || !previous || !Transport.running) {
      this.playing = pattern;
      this.pending = undefined;
      return pattern;
    }

    this.pending = { pattern, at };
    const { Pattern, TimeSpan } = this.core;

    return new Pattern((state: any) => {
      const { begin, end } = state.span;
      if (end.lte(at)) return previous.query(state);
      if (begin.gte(at)) return pattern.query(state);

      return [
        ...previous.query(state.setSpan(new TimeSpan(begin, at))),
        ...pattern.query(state.setSpan(new TimeSpan(at, end)))
      ];
    });
  }

  /** Runs the set. While playing, the change lands on the next bar. */
  async evaluate({ immediate = false }: { immediate?: boolean } = {}) {
    if (!this.repl) return;
    await Audio.resume();

    const quantized =
      !immediate && this.store.get().quantized && Transport.running;
    this.switchAt = quantized ? Transport.next("bar") : undefined;
    this.store.set({ layers: parseLayers(this.code) });

    if (quantized) {
      this.store.set({ pending: true });
      clearTimeout(this.timer);
      const wait =
        (Transport.timeAt(this.switchAt!) - Audio.ctx.currentTime) * 1000;
      this.timer = setTimeout(
        () => this.store.set({ pending: false }),
        Math.max(0, wait)
      );
    }

    await this.repl.evaluate(this.source || DefaultSet);
  }

  // starts the clock with whatever is in the set
  async start() {
    if (Transport.store.get().started) return;
    // the repl is the master clock: boot it on first start
    await this.init();
    await this.evaluate({ immediate: true });
  }

  /** Silences the instruments, the clock and the voices keep running */
  hush() {
    const scheduler = this.repl?.scheduler;
    if (!scheduler) return;

    this.playing = this.core.silence;
    this.pending = undefined;
    if (this.held) this.held.pattern = this.core.silence;
    scheduler.setPattern(this.core.silence, false);
    this.store.set({ dirty: true });
  }

  /**
   * Pauses the set while the clock keeps running for the decks. Patterns
   * follow the cycle count, so resuming brings them back in phase.
   */
  suspend() {
    const scheduler = this.repl?.scheduler;
    if (!scheduler || this.held) return;

    this.held = { pattern: this.pending?.pattern ?? this.playing ?? this.core.silence };
    this.pending = undefined;
    scheduler.setPattern(this.core.silence, false);
    this.store.set({ suspended: true });
  }

  resume() {
    const scheduler = this.repl?.scheduler;
    const held = this.held;
    if (!scheduler || !held) return;

    this.held = undefined;
    this.playing = held.pattern;
    scheduler.setPattern(held.pattern, false);
    this.store.set({ suspended: false });
  }

  setCode(code: string) {
    this.source = code;
    this.store.set({ layers: parseLayers(code), dirty: true });
  }

  /** Adds a labelled block, or replaces the one with the same label */
  setBlock(name: string, code: string, { muted = false } = {}) {
    const lines = this.code.split("\n");
    const layer = parseLayers(this.code).find((item) => item.name === name);
    const block = `${muted ? "_" : ""}${name}: ${code}`;

    if (layer) {
      let end = layer.line + 1;
      while (end < lines.length && lines[end].trim() !== "") end++;
      lines.splice(layer.line, end - layer.line, block);
    } else {
      if (lines[lines.length - 1]?.trim() !== "") lines.push("");
      lines.push(block);
    }

    this.setCode(lines.join("\n"));
  }

  hasBlock(name: string) {
    return parseLayers(this.code).find((item) => item.name === name);
  }

  /** Mutes or unmutes a block by toggling the `_` in front of its label */
  toggleBlock(name: string) {
    const layer = this.hasBlock(name);
    if (!layer) return false;

    const lines = this.code.split("\n");
    lines[layer.line] = layer.muted
      ? lines[layer.line].replace(/^(\s*)_/, "$1")
      : lines[layer.line].replace(/^(\s*)/, "$1_");

    this.setCode(lines.join("\n"));
    return true;
  }

  /** Plays notes right away through an instrument, outside of the set */
  async play(
    notes: number[],
    { instrument, at, duration = 0.4 }: { instrument?: string; at?: number; duration?: number } = {}
  ) {
    if (!this.repl) return;
    await Audio.resume();
    const { superdough } = await import("@strudel/webaudio");
    const chain = instrument ? this.instruments.get(instrument) : undefined;
    const controls = chain?.firstCycle?.()[0]?.value || {
      s: "triangle",
      decay: 0.3,
      sustain: 0.2
    };
    const time = at ?? Audio.ctx.currentTime + 0.01;

    for (const note of notes) {
      superdough({ ...controls, note }, time, duration);
    }
    Audio.route();
  }

  setChord(chord: Chord) {
    this.chords = [];
    this.live.set({ chord });
  }

  setKey(key: string) {
    this.live.set({ key: parseKey(key) });
  }
}

export const Strudel = new StrudelProvider();
