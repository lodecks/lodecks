/**
 * The live language of /play: a text you run block by block. Decks, the
 * mixer, the clock, visuals and controls are plain functions; what you
 * .show() is drawn right under the line that showed it.
 */
import { DeckId } from "@/common/constants/deck.constant";
import { DeckFx, DeckFxs } from "@/common/constants/fx.constant";
import { Key, parseKey, shiftKey } from "@/common/utils/music.util";

import { Analysis } from "../../providers/analysis.provider";
import { Audio } from "../../providers/audio.provider";
import { Transport } from "../../providers/transport.provider";
import { Visuals } from "../../providers/visuals.provider";
import { Emitter, Store } from "../../utils/store.util";
import type { Automix } from "../automix/automix.module";
import type { Deck } from "../deck/deck.module";
import type { Voice } from "../voice/voice.module";
import { Catalog } from "../importer/catalog.module";
import { Library, SetRecord } from "../visual/library.module";
import { CameraEffects, cameraShader } from "../visual/camera-presets.module";
import { DefaultFit, GifFits, parseFit } from "../visual/gif.module";
import { gifShader } from "../visual/shader-presets.module";
import { Controls, Globals, Kind, KindTag } from "./api.module";
import { LayerSource, Layers } from "./layers.module";
import { RunResult, Runtime } from "./runtime.module";
import { Scheduler } from "./schedule.module";
import { Binder, Shape, Signal, isSignal, lfo, ramp } from "./signals.module";

export type LiveHost = {
  decks: Record<DeckId, Deck>;
  automix: Automix;
  load: (id: DeckId, source: string) => Promise<void>;
  start: () => Promise<void>;
  stop: () => void;
  syncTempo: (id?: DeckId) => void;
  syncKey: (id?: DeckId, to?: Key, seconds?: number) => number | undefined;
};

export type ComponentSpec =
  | { type: "deck"; deck: DeckId; view: string }
  | { type: "mixer" }
  | { type: "packs"; filter?: string }
  // `layers`: what the line that showed it made, drawn on its own
  | { type: "visual"; layers?: VisualSource[] }
  | { type: "scope" }
  | { type: "spectrum" }
  | { type: "meter"; deck: DeckId }
  // a take's progress; `take` is the auto mix id once it is armed
  | { type: "take"; deck: DeckId; take?: number }
  // read every frame, so changes from code show at once
  | { type: "marquee"; text: string; dance: number; speed: number; size: number; color: string }
  | { type: "help"; name?: string };

/** A visual's layer before it joins a stack */
export type VisualSource = { source: LayerSource; blend?: string; opacity?: number | (() => number) };

// drawn under the doc line `line`
export type Placed = { id: string; line: number; spec: ComponentSpec };
export type Output = { line: number; kind: "result" | "error" | "print"; text: string };
export type BlockResult = { components: Placed[]; outputs: Output[] };

export type Control =
  | { kind: "slider" | "knob" | "toggle" | "pad"; value: number; min: number; max: number }
  | { kind: "button"; label: string; run?: () => unknown };

export type SetInfo = { id: string; name: string; updatedAt: number };

/** The editors: the main one, and the right one of a split view */
export type Pane = "left" | "right";

export type LiveState = {
  loaded: boolean;
  // blocks running right now
  running: string[];
  // the last thing worth saying, for the status line
  status?: { kind: "info" | "error"; text: string };
  set: SetInfo;
  // the right editor's set, while the view is split
  right?: SetInfo;
  sets: SetInfo[];
  // the visuals cover the screen
  full: boolean;
  // the visuals behind everything, darkened by `dim` so the code stays readable
  background?: { dim: number };
};

type Run = { id: string; blockId: string; line: number; result: BlockResult; pending: Promise<unknown>[] };

/** The key a deck sounds in: "B", or "D# (B +4)" when transposed */
export const soundingKey = (key: string, transpose: number) => {
  const shift = Math.round(transpose);
  return shift ? `${shiftKey(parseKey(key), shift).name} (${key} ${shift > 0 ? "+" : ""}${shift})` : key;
};

// bars of 4 beats at the master tempo, in seconds
const barsToSeconds = (bars: number) => (Number.isFinite(bars) ? Math.max(0, bars) : 0) * 4 * (60 / Transport.bpm);

// other words for a song's tracks
const TrackAliases: Record<string, string> = { voice: "vocals", vox: "vocals", vocal: "vocals", drum: "drums", beat: "drums", music: "other", melody: "other" };

// stored under the old name, kept so browsers remember their sets
const LastSetKey = "lodecks.live.set";
// the right editor's last set, and whether the view is split
const RightSetKey = "lodecks.live.right";
const SplitKey = "lodecks.live.split";
const PendingCap = 15_000;

/** The first set someone sees: the intro pack on deck a, a tour in comments */
export const StarterSet = `/*
    _           _           _
   | | ___   __| | ___  ___| | _____
   | |/ _ \\ / _\` |/ _ \\/ __| |/ / __|
   | | (_) | (_| |  __/ (__|   <\\__ \\
   |_|\\___/ \\__,_|\\___|\\___|_|\\_\\___/
   ----------------------------------
   welcome to lodecks: live coding x dj, in the browser.
   put the cursor in a block and press cmd+enter (ctrl+enter); shift runs them all.
   blocks are separated by blank lines. cmd+s keeps a copy, cmd+. twice stops everything.
*/

// deck a, with the "intro" pack. show() draws it right here
const a = deck("a").load("intro").show()

// hit play: the song comes in on the next phrase, the clock with it
a.play()
xfade("a")

// jump with hot cues: 1 intro, 2 verse, 3 drop, 4 verse 2...
a.show("cues")
a.cue(3)

// get your hands on it: drag the slider and the knob, the numbers follow
a.filter(slider(0, -1, 1))
a.eq("low", knob(0, -1, 0.5))

// take the song apart: only the vocals, while the pad is held
a.solo("vocals", pad("vocals"))

// play it forever: the infinite jukebox branches between bars that sound alike
a.infinite()
a.show("graph")

// motion on its own: a slow filter sweep, once every 16 bars
a.filter(lfo(16, -0.4, 0.4))

// visuals that follow the music
viz("cyberwave").show()

// and a flash on top, on every kick
viz("portal").blend("screen").opacity(kick()).over()

// a second track on deck b, blended in at the best moment
// const b = deck("b").load("your-pack")
// b.tune()      // glide b into a's key
// b.take(16)    // 16 bars of blend, starting where both songs fit

// the mixer, your packs, and the cheat sheet
mixer().show()
packs()
help()
`;

/**
 * What a new set starts with: a deck, its filter and eq on controls, a
 * little motion. The side editor's sets use deck b, so the two don't fight
 * over one deck.
 */
export const SampleSet = (name: string, pack: string, id: DeckId = "a") => `// ${name} — ctrl+enter runs the block under the cursor

<<<<<<< Updated upstream
// a deck, drawn right here
const a = deck("a").load("${pack}").infinite().show()
=======
// deck ${id}, drawn right here
const ${id} = deck("${id}").load("${pack}").infinite().show()
>>>>>>> Stashed changes

// play it and listen to it
${id}.play()
xfade("${id}")

// filter and eq on controls: drag them, the numbers follow
${id}.filter(slider(0, -1, 1))
${id}.eq("low", knob(0, -1, 0.5))
${id}.eq("high", knob(0, -1, 0.5))
${id}.vol(slider(0.9, 0, 1))

// switch effects on and off
${id}.fx("echo", toggle(false))
button("drop", () => ${id}.jump(1))

// a slow sweep, on its own — run it, then run the slider line to take over again
${id}.filter(lfo(16, -0.4, 0.4))
`;

const storage = {
  get: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {}
  }
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const brief = (value: unknown): string => {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(Math.round(value * 1000) / 1000);
  if (typeof value === "boolean") return String(value);
  if (isSignal(value)) return `signal ${value.toString()}`;
  if (typeof value === "function") return `ƒ ${value.name || "function"}`;
  if (value && typeof (value as any).label === "function") return (value as any).label();
  try {
    return JSON.stringify(value, (_, item) => (typeof item === "function" ? "ƒ" : item))?.slice(0, 400) ?? String(value);
  } catch {
    return String(value);
  }
};

export class LiveError extends Error {}

export class Live {
  store = new Store<LiveState>({
    loaded: false,
    running: [],
    set: { id: "", name: "", updatedAt: 0 },
    sets: [],
    full: false
  });

  // components hidden from code (handle.hide()), for the editor to drop
  hidden = new Emitter<string[]>();
  // what each inline component shows, by id, while it is on screen
  components = new Store<{ specs: Record<string, ComponentSpec> }>({ specs: {} });

  layers = new Layers();
  binder = new Binder();
  scheduler = new Scheduler((job, error) => this.say("error", `${job.label}: ${error.message}`));
  controls = new Map<string, Control>();
  runtime: Runtime;

  private runs = new Map<string, Run>();
  private current?: Run;
  private nextId = 0;
  // each deck's actions run in order, after its loads
  private deckQueue: Record<DeckId, Promise<unknown>> = { a: Promise.resolve(), b: Promise.resolve() };
  private saveTimer?: ReturnType<typeof setTimeout>;
  private loading?: Promise<void>;
  // each open set's code as last typed, so the editors can come back to it
  private code: Record<Pane, string> = { left: "", right: "" };
  private rightTimer?: ReturnType<typeof setTimeout>;

  constructor(readonly host: LiveHost) {
    this.runtime = new Runtime(this.scope());
    // live values keep moving whatever screen is open (v1 included)
    if (typeof window !== "undefined") {
      const loop = (time: number) => {
        if (this.binder.size) this.frame(time);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
    Transport.tick.on((cycle) => this.scheduler.tick(cycle));
    // starting over from the clock: schedules wait for their bar again
    Transport.toggled.on((started) => {
      if (!started) this.scheduler.cancel();
    });
  }

  // —— status ——

  say(kind: "info" | "error", text: string) {
    this.store.set({ status: { kind, text } });
  }

  /** Something went wrong after the run was over */
  private report(error: unknown, run?: Run, line?: number) {
    const message = (error as Error)?.message ?? String(error);
    if (run && this.runs.has(run.id)) run.result.outputs.push({ line: line ?? run.line, kind: "error", text: message });
    else this.say("error", message);
  }

  // —— running ——

  /**
   * Runs a block. `blockId` identifies it across edits: what it showed and
   * scheduled before is replaced. `line` is the doc line it starts on.
   */
  async run(code: string, blockId: string, line: number): Promise<BlockResult> {
    const run: Run = { id: `r${this.nextId++}`, blockId, line, result: { components: [], outputs: [] }, pending: [] };
    this.runs.set(run.id, run);
    this.scheduler.cancelOwner(blockId);
    this.store.set({ running: [...this.store.get().running, blockId] });

    let result: RunResult | undefined;
    try {
      result = await this.runtime.run(code, {
        line,
        tag: run.id,
        controls: Controls,
        controlId: (index) => `${blockId}:${index}`
      });
      if (result.error) {
        run.result.outputs.push({ line: result.error.line ?? line, kind: "error", text: result.error.message });
      } else {
        // what the block started (loads, plays…) gets a moment to finish
        const value = result.value;
        const settle = Promise.allSettled([...run.pending, value instanceof Promise ? value : Promise.resolve()]);
        await Promise.race([settle, new Promise((resolve) => setTimeout(resolve, PendingCap))]);
        const shown = value instanceof Promise ? await value.catch((error: Error) => error) : value;
        const text = shown instanceof Error ? undefined : brief(shown);
        if (shown instanceof Error) run.result.outputs.push({ line: run.line, kind: "error", text: shown.message });
        else if (text) run.result.outputs.push({ line: run.line, kind: "result", text });
      }
    } finally {
      this.runs.delete(run.id);
      if (this.current === run) this.current = undefined;
      this.store.set({ running: this.store.get().running.filter((id) => id !== blockId) });
    }
    const errors = run.result.outputs.filter((output) => output.kind === "error");
    this.say(errors.length ? "error" : "info", errors.length ? errors[0].text : `ran block at line ${line}`);
    return run.result;
  }

  /** Tracks an action a run started, so the run can wait for it */
  private track(promise: Promise<unknown>) {
    const run = this.current;
    const line = run?.line;
    const tracked = promise.catch((error) => this.report(error, run, line));
    run?.pending.push(tracked);
    return tracked;
  }

  private show(spec: ComponentSpec) {
    const run = this.current;
    if (!run) {
      this.say("info", "show() draws when its block runs");
      return undefined;
    }
    const id = `c${this.nextId++}`;
    run.result.components.push({ id, line: run.line, spec });
    return id;
  }

  private hide(ids: string[]) {
    if (ids.length) this.hidden.emit(ids);
  }

  placeComponents(list: Placed[]) {
    if (!list.length) return;
    const next = { ...this.components.get().specs };
    for (const item of list) next[item.id] = item.spec;
    this.components.set({ specs: next });
  }

  forgetComponents(ids: string[]) {
    const next = { ...this.components.get().specs };
    for (const id of ids) delete next[id];
    this.components.set({ specs: next });
  }

  /** Frame loop: live values follow their signals */
  frame(time: number) {
    Analysis.update(Math.floor(time));
    this.binder.tick();
  }

  panic() {
    for (const deck of Object.values(this.host.decks)) deck.stopAll();
    this.scheduler.cancel();
    this.binder.clear();
    if (this.host.automix.store.get().status !== "idle") this.host.automix.cancel();
    this.say("info", "panic: decks stopped, schedules and bindings cleared");
  }

  // —— controls ——

  setControl(id: string, value: number) {
    const control = this.controls.get(id);
    if (control && control.kind !== "button") control.value = value;
  }

  trigger(id: string) {
    const control = this.controls.get(id);
    if (control?.kind !== "button" || !control.run) return false;
    try {
      const result = control.run();
      if (result instanceof Promise) result.catch((error) => this.report(error));
    } catch (error) {
      this.report(error);
    }
    return true;
  }

  // —— packs ——

  async packList(fresh = false) {
    if (fresh || !Catalog.list().length) await Catalog.refresh();
    const list = Catalog.list();
    if (!list.length && !Catalog.store.get().server) throw new LiveError("no packs — the api is not running and none are kept in this browser");
    return list;
  }

  /** Pack ids for completion */
  packNames() {
    if (!Catalog.list().length) Catalog.refresh().catch(() => {});
    return Catalog.list();
  }

  /** A deck's song tracks (drums, bass, vocals…), or both decks', for completion */
  tracksOf(deck?: DeckId) {
    const decks = deck ? [this.host.decks[deck]] : Object.values(this.host.decks);
    const tracks = new Map<string, { id: string; deck: DeckId; muted: boolean }>();
    for (const item of decks) {
      for (const voice of item.followers()) {
        if (!tracks.has(voice.id)) tracks.set(voice.id, { id: voice.id, deck: item.id, muted: !!voice.state.muted });
      }
    }
    return [...tracks.values()];
  }

  /** The deck a variable holds, once its block has run */
  deckOf(name: string): DeckId | undefined {
    const value = this.runtime.scope[name] as Record<string, unknown> | undefined;
    return value && typeof value === "object" && value[KindTag] === "deck" ? (value.id as DeckId) : undefined;
  }

  private async findPack(name: string) {
    const list = await this.packList();
    const needle = name.toLowerCase();
    const pack =
      list.find((item) => item.id === name) ||
      list.find((item) => item.title.toLowerCase() === needle) ||
      list.find((item) => item.id.toLowerCase().startsWith(needle) || item.title.toLowerCase().startsWith(needle)) ||
      list.find((item) => item.title.toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle));
    if (!pack) throw new LiveError(`no pack matches "${name}" — packs() lists them`);
    return pack;
  }

  // —— time ——

  /** Bars, from the clock when it runs, else from the wall clock */
  clock = () => (Transport.running ? Transport.now() : (performance.now() / 1000) * (Transport.bpm / 60 / 4));

  private owner() {
    return this.current?.blockId ?? "callback";
  }

  // —— the language ——

  private deckHandle(id: DeckId) {
    const live = this;
    const deck = () => this.host.decks[id];
    const shown: string[] = [];
    // runs after what was queued on this deck before (eg. a load)
    const queue = (action: () => unknown) => {
      const next = this.deckQueue[id].then(action);
      this.deckQueue[id] = next.catch(() => {});
      this.track(next);
      return handle;
    };
    const needPack = () => {
      if (!deck().store.get().pack) throw new LiveError(`deck ${id} is empty — deck("${id}").load("pack") loads one`);
    };
    const bind = (param: string, value: unknown, apply: (value: number) => void) =>
      queue(() => this.binder.set(`${id}.${param}`, isSignal(value) ? value : Number(value), apply));
    // the song's own tracks: stems, and voices that play along the song
    // (an imported pack keeps vocals as a voice)
    const findTrack = (name: string) => {
      const tracks = deck().followers();
      const word = String(name).toLowerCase();
      const needle = TrackAliases[word] ?? word;
      const found =
        tracks.find((voice) => voice.id.toLowerCase() === needle || voice.track.name.toLowerCase() === needle) ||
        tracks.find((voice) => voice.id.toLowerCase().includes(needle) || voice.track.name.toLowerCase().includes(needle));
      if (!found) throw new LiveError(`no track "${name}" — ${tracks.map((voice) => voice.id).join(", ")}`);
      return found;
    };
    // a signal (eg. toggle()) keeps switching it: above 0.5 is muted
    // looked up on every change: a new pack brings new voices
    const bindMute = ({ kind, id: track }: Voice, value: number | Signal) =>
      this.binder.set(`${id}.mute.${track}`, value, (level) => {
        const voice = deck()[kind].get(track);
        const muted = level > 0.5;
        if (voice && voice.state.muted !== muted) voice.setMuted(muted);
      });

    const handle = {
      [KindTag]: "deck" as Kind,
      id,
      label: () => {
        const state = deck().store.get();
        if (state.loading) return `deck ${id} · loading…`;
        if (!state.pack) return `deck ${id} · empty`;
        return `deck ${id} · ${state.pack.title} · ${state.pack.bpm} bpm · ${soundingKey(state.pack.key, state.transpose)}${state.infinite ? " · ∞" : ""}`;
      },
      load(pack: string) {
        return queue(async () => {
          const found = await live.findPack(String(pack));
          if (deck().store.get().packId === found.id && deck().store.get().pack) return;
          await live.host.load(id, found.id);
          const error = deck().store.get().error;
          if (error) throw new LiveError(error);
        });
      },
      play() {
        return queue(async () => {
          needPack();
          if (deck().songPlaying()) return;
          if (!Transport.running) await live.host.start();
          deck().startSong();
        });
      },
      stop() {
        return queue(() => deck().stopAll());
      },
      sync() {
        return queue(() => live.host.syncTempo(id));
      },
      jump(bar: number) {
        return queue(() => {
          needPack();
          deck().jump(Math.max(0, Number(bar) - 1));
        });
      },
      cue(slot: number) {
        return queue(() => {
          needPack();
          deck().cue(Number(slot));
        });
      },
      loop(bars: number) {
        return queue(() => {
          const loop = deck().store.get().loop;
          if (!bars) {
            if (loop?.active) deck().toggleLoop();
            return;
          }
          if (!(loop?.active && loop.bars === bars)) deck().setLoop(Number(bars));
        });
      },
      // infinite(), infinite(false), infinite("beat", "high"): on, with its
      // branch unit (bar | beat) and variety (low | mid | high)
      infinite(...options: unknown[]) {
        let on = true;
        let unit: "bar" | "beat" | undefined;
        let variety: "low" | "mid" | "high" | undefined;
        for (const option of options) {
          const word = typeof option === "string" ? option.toLowerCase() : option;
          if (word === false || word === "off" || word === 0) on = false;
          else if (word === true || word === "on" || word === 1 || word === undefined) on = true;
          else if (word === "bar" || word === "beat") unit = word;
          else if (word === "low" || word === "mid" || word === "high") variety = word;
          else throw new LiveError(`infinite: on / off, "bar" | "beat", "low" | "mid" | "high"`);
        }
        return queue(() => {
          if (unit && deck().store.get().jukeUnit !== unit) deck().setJukeUnit(unit);
          if (variety) deck().setVariety(variety);
          if (deck().store.get().infinite !== on) deck().setInfinite(on);
        });
      },
      // branches to a similar spot at the next boundary
      branch() {
        return queue(() => {
          needPack();
          const state = deck().store.get();
          if (!state.infinite) throw new LiveError(`deck ${id} is not infinite — infinite() first`);
          if (state.jukebox.status !== "ready") throw new LiveError(`deck ${id}: the jukebox is ${state.jukebox.status === "analysing" ? "still analysing the song" : "not ready"}`);
          deck().jumpNow();
        });
      },
      transpose(semitones: number, bars = 0) {
        return queue(() => deck().glideTranspose(Math.round(Number(semitones)), barsToSeconds(Number(bars))));
      },
      // tune(): onto the other deck's key; tune("Am") or tune("b") to aim
      tune(to?: unknown, bars: number = 1) {
        return queue(() => {
          needPack();
          let key: Key | undefined;
          const word = to === undefined ? undefined : String(to).trim();
          // back to the song's own pitch
          if (to === false || /^(off|reset|original|own)$/i.test(word ?? "")) {
            deck().glideTranspose(0, barsToSeconds(Number(bars)));
            return;
          }
          if (word && word.toLowerCase() !== "a" && word.toLowerCase() !== "b") {
            if (!/^[A-Ga-g][#b]?\s*(m|min|minor|maj|major)?$/.test(word)) throw new LiveError(`tune: a deck ("a", "b") or a key like "Am", "F#" — not "${word}"`);
            key = parseKey(word);
          } else if (word) {
            const other = live.host.decks[word.toLowerCase() as DeckId].store.get();
            if (!other.pack) throw new LiveError(`deck ${word} is empty, nothing to tune to`);
            key = shiftKey(parseKey(other.pack.key), other.transpose);
          }
          const shift = live.host.syncKey(id, key, barsToSeconds(Number(bars)));
          if (shift === undefined) throw new LiveError(`deck ${id === "a" ? "b" : "a"} is empty, nothing to tune to — tune("Am") aims at a key`);
          live.say("info", `deck ${id} ${shift === 0 ? "is already in key" : `${shift > 0 ? "+" : ""}${shift} semitone${Math.abs(shift) === 1 ? "" : "s"}`}`);
        });
      },
      vol(level: number | Signal) {
        return bind("vol", level, (value) => deck().setVolume(clamp(value, 0, 1)));
      },
      eq(band: string, gain: number | Signal) {
        const name = String(band).toLowerCase();
        if (name !== "low" && name !== "mid" && name !== "high") throw new LiveError('eq bands: "low", "mid", "high"');
        return bind(`eq.${name}`, gain, (value) => deck().setEq(name, clamp(value, -1, 1)));
      },
      filter(amount: number | Signal) {
        return bind("filter", amount, (value) => deck().setFilter(clamp(value, -1, 1)));
      },
      fx(name: string, on: unknown = true) {
        const fx = String(name).toLowerCase() as DeckFx;
        if (!DeckFxs.includes(fx)) throw new LiveError(`fx: ${DeckFxs.join(", ")}`);
        // a toggle() (or any signal) keeps switching it: above 0.5 is on
        const apply = (value: number) => {
          const next = value > 0.5;
          if (deck().store.get().fx[fx] === next) return;
          if (next) deck().engageFx(fx);
          else deck().releaseFx(fx);
        };
        return bind(`fx.${fx}`, isSignal(on) ? on : on ? 1 : 0, apply);
      },
      stem(name: string, on: unknown = true) {
        return queue(() => {
          needPack();
          const voice = findTrack(name);
          const playing = voice.state.status === "playing" || voice.state.status === "armed";
          if (playing !== !!on) deck().press(voice.kind, voice.id);
        });
      },
      mute(name?: string, on: unknown = true) {
        return queue(() => {
          needPack();
          const voices = name === undefined ? deck().followers() : [findTrack(name)];
          for (const voice of voices) bindMute(voice, isSignal(on) ? on : on ? 1 : 0);
        });
      },
      unmute(name?: string) {
        return handle.mute(name, false);
      },
      // solo("vocals", "bass"), or with a switch last: solo("vocals", pad())
      solo(...args: unknown[]) {
        const last = args.at(-1);
        const on = isSignal(last) || typeof last === "boolean" ? (args.pop() as Signal | boolean) : true;
        return queue(() => {
          needPack();
          const kept = new Set(args.map((name) => findTrack(String(name))));
          // solo() with nothing lets every track play again
          for (const voice of deck().followers()) {
            if (!kept.size || kept.has(voice)) bindMute(voice, 0);
            // the others follow the switch: muted while it is on
            else bindMute(voice, isSignal(on) ? on : on ? 1 : 0);
          }
        });
      },
      // glides back to the song's own pitch
      untune(bars: number = 1) {
        return queue(() => deck().glideTranspose(0, barsToSeconds(Number(bars))));
      },
      take(bars: number = 16, cue?: number) {
        // drawn under the line; it learns which mix it follows once armed
        const spec: ComponentSpec = { type: "take", deck: id };
        const run = live.current;
        const shown = live.show(spec);
        // a take that fails draws nothing, its error says why
        const drop = () => {
          if (run) run.result.components = run.result.components.filter((item) => item.id !== shown);
        };
        return queue(() => {
          try {
            arm();
          } catch (error) {
            drop();
            throw error;
          }
        });
        function arm() {
          needPack();
          const automix = live.host.automix;
          const current = automix.store.get();
          if (current.status === "mixing") throw new LiveError(`already mixing into deck ${current.to}`);
          // taking again re-plans
          if (current.status === "armed") automix.cancel();
          let entry: number | undefined;
          if (cue !== undefined) {
            const found = deck().store.get().cues[Number(cue)];
            if (!found) throw new LiveError(`deck ${id} has no cue ${cue} — set one with .cue(${cue}) where it should land`);
            entry = found.bar;
          }
          // the mix moves the crossfader itself
          live.binder.clear("xfade");
          const state = automix.arm({ to: id, length: Number(bars), entry });
          if (state.error) throw new LiveError(state.error);
          if (spec.type === "take") spec.take = state.id;
          live.say("info", `deck ${id} takes over at bar ${Math.floor(state.startsAt ?? 0) + 1}${state.plan?.reasons.length ? ` · ${state.plan.reasons.join(", ")}` : ""}`);
        }
      },
      show(view: string = "deck") {
        const id2 = live.show({ type: "deck", deck: id, view: String(view) });
        if (id2) shown.push(id2);
        return handle;
      },
      hide() {
        live.hide(shown.splice(0));
        return handle;
      }
    };
    return handle;
  }

  private crossfadeTarget(value: unknown) {
    if (isSignal(value)) return value;
    const word = String(value).toLowerCase();
    const target = word === "a" ? 0 : word === "b" ? 1 : word === "mid" ? 0.5 : Number(word);
    if (!Number.isFinite(target)) throw new LiveError('xfade: "a", "b", "mid", 0…1 or a signal');
    return clamp(target, 0, 1);
  }

  private mixerHandle() {
    const live = this;
    const shown: string[] = [];
    const handle = {
      [KindTag]: "mixer" as Kind,
      label: () => `mixer · xfade ${Audio.store.get().crossfade.toFixed(2)} · auto mix ${live.host.automix.store.get().status}`,
      xfade(to: unknown, bars?: number) {
        const target = live.crossfadeTarget(to);
        const apply = (value: number) => Audio.setCrossfade(clamp(value, 0, 1));
        if (isSignal(target) || !bars) {
          live.binder.set("xfade", target, apply);
        } else {
          live.binder.set("xfade", ramp(live.clock, Number(bars), Audio.store.get().crossfade, target), apply);
        }
        return handle;
      },
      master(level: number | Signal) {
        live.binder.set("master", isSignal(level) ? level : Number(level), (value) => Audio.setMaster(clamp(value, 0, 1)));
        return handle;
      },
      show() {
        const id = live.show({ type: "mixer" });
        if (id) shown.push(id);
        return handle;
      },
      hide() {
        live.hide(shown.splice(0));
        return handle;
      }
    };
    return handle;
  }

  private findEffect(name: string) {
    const effects = Visuals.store.get().effects;
    const needle = name.toLowerCase();
    const effect =
      effects.find((item) => item.id === name) ||
      effects.find((item) => item.name.toLowerCase() === needle) ||
      effects.find((item) => item.name.toLowerCase().startsWith(needle));
    if (!effect) throw new LiveError(`no effect "${name}" — try ${effects.slice(0, 6).map((item) => item.name).join(", ")}`);
    return effect;
  }

  // the code each effect tab last ran, to find its layers again
  private previewed = new Map<string, string>();

  /**
   * Runs an effect's draft (v2's effect tabs): in place where the set's
   * layers already use the effect, else on its own.
   */
  previewEffect(id: string, code: string) {
    const effect = Visuals.find(id);
    if (!effect) throw new LiveError(`no effect ${id}`);
    const known = new Set([effect.code, this.previewed.get(id)].filter(Boolean));
    this.previewed.set(id, code);
    const list = this.layers.store.get().list;
    const kind = effect.kind === "hydra" ? "hydra" : "glsl";
    const using = list.filter((layer) => layer.source.kind === kind && known.has(layer.source.code));
    if (using.length) {
      this.layers.store.set({ list: list.map((layer) => (using.includes(layer) ? { ...layer, source: { ...layer.source, code } } : layer)) });
      return "updated";
    }
    const source: LayerSource = kind === "hydra" ? { kind: "hydra", code } : { kind: "glsl", code, gif: effect.gifId };
    this.layers.set([{ source }]);
    return "shown";
  }

  /** After a save the tab may edit a new copy: its layers follow */
  renamePreview(from: string, to: string) {
    const code = this.previewed.get(from);
    if (code === undefined) return;
    this.previewed.delete(from);
    this.previewed.set(to, code);
  }

  private visualHandle(sources: { source: LayerSource; blend?: string; opacity?: number | (() => number) }[]) {
    const live = this;
    const shown: string[] = [];
    // layers over() put on top of the stack, to take off again with hide()
    const added: string[] = [];
    // the same visual keeps the same name, so running its line again
    // updates it instead of stacking another
    const keyOf = (source: LayerSource) => {
      const text = `${source.kind}:${source.code}:${source.kind === "glsl" ? `${source.gif ?? ""}:${source.camera ? 1 : 0}` : ""}`;
      let hash = 5381;
      for (let index = 0; index < text.length; index++) hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
      return `over:${(hash >>> 0).toString(36)}`;
    };
    const handle = {
      [KindTag]: "visual" as Kind,
      layers: sources,
      label: () => `visual · ${sources.length} layer${sources.length === 1 ? "" : "s"}`,
      blend(mode: string) {
        for (const layer of sources) layer.blend = String(mode);
        return handle;
      },
      opacity(amount: number | Signal) {
        const value = isSignal(amount) ? amount.read : Number(amount);
        for (const layer of sources) layer.opacity = value;
        return handle;
      },
      show() {
        live.layers.set(sources);
        const id = live.show({ type: "visual", layers: sources });
        if (id) shown.push(id);
        return handle;
      },
      // on top of what already plays, keeping the rest of the stack
      over() {
        for (const layer of sources) {
          const name = keyOf(layer.source);
          live.layers.declare(name, layer.source, layer);
          if (!added.includes(name)) added.push(name);
        }
        const id = live.show({ type: "visual", layers: sources });
        if (id) shown.push(id);
        return handle;
      },
      full() {
        live.layers.set(sources);
        live.store.set({ full: true });
        return handle;
      },
      background(dim: number | boolean = 0.6) {
        if (dim === false) {
          live.store.set({ background: undefined });
          return handle;
        }
        live.layers.set(sources);
        live.store.set({ background: { dim: dim === true ? 0.6 : Math.min(0.95, Math.max(0, Number(dim))) } });
        return handle;
      },
      hide() {
        live.hide(shown.splice(0));
        for (const name of added.splice(0)) live.layers.remove(name);
        return handle;
      }
    };
    return handle;
  }

  private viewHandle(spec: ComponentSpec, name: string) {
    const live = this;
    const shown: string[] = [];
    const handle = {
      [KindTag]: "view" as Kind,
      label: () => name,
      show() {
        const id = live.show(spec);
        if (id) shown.push(id);
        return handle;
      },
      hide() {
        live.hide(shown.splice(0));
        return handle;
      }
    };
    return handle;
  }

  private marqueeHandle(words: string) {
    const live = this;
    const shown: string[] = [];
    const spec: Extract<ComponentSpec, { type: "marquee" }> = { type: "marquee", text: words, dance: 0, speed: 2, size: 56, color: "" };
    const handle = {
      [KindTag]: "text" as Kind,
      label: () => `marquee · "${spec.text}"`,
      dance(amount: number = 1) {
        spec.dance = Math.max(0, Math.min(2, Number(amount)));
        return handle;
      },
      speed(bars: number) {
        spec.speed = Number(bars) || 2;
        return handle;
      },
      size(px: number) {
        spec.size = Math.max(10, Math.min(240, Number(px) || 56));
        return handle;
      },
      color(value: string) {
        spec.color = String(value);
        return handle;
      },
      text(value: unknown) {
        spec.text = String(value);
        return handle;
      },
      show() {
        const id = live.show(spec);
        if (id) shown.push(id);
        return handle;
      },
      hide() {
        live.hide(shown.splice(0));
        return handle;
      }
    };
    return handle;
  }

  private jobHandle(id: number, label: string) {
    return {
      [KindTag]: "job" as Kind,
      label: () => label,
      cancel: () => this.scheduler.cancel(id)
    };
  }

  private scope(): Record<string, unknown> {
    const live = this;
    const text = (strings: unknown, values: unknown[]) =>
      Array.isArray(strings) && "raw" in (strings as object)
        ? (strings as string[]).reduce((out, part, index) => out + part + (index < values.length ? String(values[index]) : ""), "")
        : String(strings);
    const deckId = (value: unknown): DeckId => {
      const id = String(value).toLowerCase();
      if (id !== "a" && id !== "b") throw new LiveError('decks are "a" and "b"');
      return id;
    };
    const control = (kind: "slider" | "knob") => (id: string, value = 0.5, min = 0, max = 1) => {
      live.controls.set(id, { kind, value: Number(value), min: Number(min), max: Number(max) });
      return new Signal(() => {
        const current = live.controls.get(id);
        return current && current.kind !== "button" ? current.value : Number(value);
      });
    };

    const api: Record<string, unknown> = {
      // statements report their line, so show() knows where to draw
      __at: (tag: string, line: number) => {
        const run = live.runs.get(tag);
        if (run) {
          run.line = line;
          live.current = run;
        }
      },
      deck: (id: unknown, pack?: unknown) => {
        // a pack goes on with .load(), so loading always reads the same
        if (pack !== undefined) throw new LiveError(`deck() takes only the deck — load a pack with deck("${deckId(id)}").load("${pack}")`);
        return live.deckHandle(deckId(id));
      },
      mixer: () => live.mixerHandle(),
      xfade: (to: unknown, bars?: number) => live.mixerHandle().xfade(to, bars),
      bpm: (tempo?: number) => {
        if (tempo === undefined) return Transport.bpm;
        Transport.setBpm(Number(tempo));
        return Transport.bpm;
      },
      start: () => live.track(live.host.start()),
      stop: () => live.host.stop(),
      packs: async (filter?: string) => {
        live.show({ type: "packs", filter: filter === undefined ? undefined : String(filter) });
        const list = await live.packList(true);
        return `${list.length} packs`;
      },

      every: (bars: number, fn: () => unknown) => {
        if (typeof fn !== "function") throw new LiveError("every(bars, () => …)");
        const id = live.scheduler.every(live.owner(), live.clock(), Number(bars), fn);
        return live.jobHandle(id, `every ${bars} bars`);
      },
      at: (bar: number, fn: () => unknown) => {
        if (typeof fn !== "function") throw new LiveError("at(bar, () => …)");
        return live.jobHandle(live.scheduler.at(live.owner(), live.clock(), Number(bar), fn), `at bar ${bar}`);
      },
      next: (fn: () => unknown, bars = 1) => {
        if (typeof fn !== "function") throw new LiveError("next(() => …)");
        return live.jobHandle(live.scheduler.next(live.owner(), live.clock(), fn, Number(bars)), "next bar");
      },
      cancel: () => live.scheduler.cancel(),
      panic: () => live.panic(),

      kick: () => new Signal(() => Analysis.data.kick),
      fft: (band = 0) => new Signal(() => Analysis.data.bands[clamp(Math.floor(Number(band)), 0, 3)]),
      level: (id: unknown) => {
        const deck = deckId(id);
        return new Signal(() => Analysis.data.decks[deck]);
      },
      beat: () => new Signal(() => Transport.position().phase),
      bar: () => new Signal(() => live.clock()),
      lfo: (bars = 4, min = 0, max = 1, shape: Shape = "sine") => lfo(live.clock, Number(bars), Number(min), Number(max), shape),
      ramp: (bars: number, from: number, to: number) => ramp(live.clock, Number(bars), Number(from), Number(to)),

      slider: control("slider"),
      knob: control("knob"),
      toggle: (id: string, on: unknown = false) => {
        live.controls.set(id, { kind: "toggle", value: on ? 1 : 0, min: 0, max: 1 });
        return new Signal(() => {
          const current = live.controls.get(id);
          return current && current.kind !== "button" ? current.value : 0;
        });
      },
      // pad("drop"), pad(true) or pad("drop", true): held is 1, or 0 inverted
      pad: (id: string, label?: unknown, invert?: unknown) => {
        const inverted = typeof label === "boolean" ? label : !!invert;
        // running the block again keeps a pad that is being held down
        const held = live.controls.get(id);
        live.controls.set(id, { kind: "pad", value: held?.kind === "pad" ? held.value : 0, min: 0, max: 1 });
        return new Signal(() => {
          const current = live.controls.get(id);
          const down = current && current.kind !== "button" ? current.value : 0;
          return inverted ? 1 - down : down;
        });
      },
      button: (id: string, label: unknown = "go", fn?: () => unknown) => {
        live.controls.set(id, { kind: "button", label: String(label), run: fn });
      },

      viz: (name: unknown) => {
        const effect = live.findEffect(String(name));
        const source: LayerSource =
          effect.kind === "hydra" ? { kind: "hydra", code: effect.code } : { kind: "glsl", code: effect.code, gif: effect.gifId };
        return live.visualHandle([{ source }]);
      },
      glsl: (strings: unknown, ...values: unknown[]) => live.visualHandle([{ source: { kind: "glsl", code: text(strings, values) } }]),
      hydra: (strings: unknown, ...values: unknown[]) => live.visualHandle([{ source: { kind: "hydra", code: text(strings, values) } }]),
      camera: (effect: unknown = "raw") => {
        const name = String(effect).toLowerCase();
        const code = cameraShader(name);
        if (!code) throw new LiveError(`camera effects: ${CameraEffects.join(", ")}`);
        return live.visualHandle([{ source: { kind: "glsl", code, camera: true } }]);
      },
      // gif("name", "contain"); gif("contain") alone fits the latest gif
      gif: (name?: unknown, fit?: unknown) => {
        let gif = name === undefined ? undefined : String(name);
        if (gif !== undefined && fit === undefined && parseFit(gif) && !Visuals.findGif(gif)) [gif, fit] = [undefined, gif];
        const mode = fit === undefined ? DefaultFit : parseFit(fit);
        if (!mode) throw new LiveError(`gif(name, fit): fit is ${GifFits.join(", ")}`);
        return live.visualHandle([{ source: { kind: "glsl", code: gifShader(mode), gif } }]);
      },
      layers: (...visuals: { layers?: { source: LayerSource }[] }[]) => {
        const all = visuals.flatMap((visual) => {
          if (!visual?.layers) throw new LiveError("layers(…) takes visuals: viz(), glsl``, hydra``, gif()");
          return visual.layers;
        });
        return live.visualHandle(all);
      },

      scope: () => live.viewHandle({ type: "scope" }, "scope"),
      spectrum: () => live.viewHandle({ type: "spectrum" }, "spectrum"),
      meter: (id: unknown) => live.viewHandle({ type: "meter", deck: deckId(id) }, `meter ${id}`),
      marquee: (words: unknown = "lodecks") => live.marqueeHandle(String(words)),

      print: (...values: unknown[]) => {
        const run = live.current;
        const text = values.map(brief).join(" ");
        if (run) run.result.outputs.push({ line: run.line, kind: "print", text });
        else live.say("info", text);
      },
      help: (name?: unknown) => {
        live.show({ type: "help", name: name === undefined ? undefined : String(name) });
      },
      reset: () => {
        live.runtime.reset();
        return "variables cleared";
      }
    };
    // every documented global must exist
    for (const doc of Globals) if (!(doc.name in api)) throw new Error(`live: ${doc.name} is documented but missing`);
    return api;
  }

  /** What a variable holds, for completion */
  kindOf(name: string): Kind | undefined {
    const value = this.runtime.scope[name] as Record<string, unknown> | undefined;
    if (isSignal(value)) return "signal";
    return value && typeof value === "object" ? (value[KindTag] as Kind | undefined) : undefined;
  }

  // —— sets ——

  /** Opens the last set (or makes the first one); returns its code */
  init() {
    this.loading ??= (async () => {
      Visuals.init();
      let sets: SetRecord[] = [];
      try {
        sets = await Library.sets();
      } catch (error) {
        this.say("error", `library: ${(error as Error).message}`);
      }
      const last = storage.get(LastSetKey);
      let set = sets.find((item) => item.id === last) ?? sets[0];
      if (!set) {
        set = { id: `set-${Date.now().toString(36)}`, name: "first set", code: StarterSet, updatedAt: Date.now() };
        await Library.saveSet(set).catch(() => {});
        sets = [set];
      }
      this.code.left = set.code;
      this.use(set, sets, "left");
      // the split view comes back as it was left
      const right = storage.get(SplitKey) === "1" ? sets.find((item) => item.id === storage.get(RightSetKey) && item.id !== set!.id) : undefined;
      if (right) {
        this.code.right = right.code;
        this.use(right, sets, "right");
      }
      this.store.set({ loaded: true });
      this.packList().catch(() => {});
    })();
    // the code as it is now, not as it was first loaded
    return this.loading.then(() => this.code.left);
  }

  /** The code an editor opens with */
  async paneCode(pane: Pane) {
    await this.init();
    return this.code[pane];
  }

  private setOf(pane: Pane) {
    return pane === "left" ? this.store.get().set : this.store.get().right;
  }

  private other(pane: Pane): Pane {
    return pane === "left" ? "right" : "left";
  }

  private use(set: SetRecord, sets: SetRecord[], pane: Pane) {
    storage.set(pane === "left" ? LastSetKey : RightSetKey, set.id);
    const info = { id: set.id, name: set.name, updatedAt: set.updatedAt };
    this.store.set({
      ...(pane === "left" ? { set: info } : { right: info }),
      sets: sets.map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
    });
  }

  private async refreshSets() {
    const sets = await Library.sets();
    this.store.set({ sets: sets.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })) });
    return sets;
  }

  /** Autosaves an editor's code into its set */
  saveCode(code: string, snapshot = false, pane: Pane = "left") {
    this.code[pane] = code;
    const timer = pane === "left" ? this.saveTimer : this.rightTimer;
    clearTimeout(timer);
    const write = async () => {
      const set = this.setOf(pane);
      if (!set?.id) return;
      const record = { id: set.id, name: set.name, code, updatedAt: Date.now() };
      await Library.saveSet(record);
      if (snapshot) await Library.snapshot(record);
      await this.refreshSets();
    };
    if (snapshot) return write().then(() => this.say("info", `saved ${this.setOf(pane)?.name ?? ""}`));
    const next = setTimeout(() => write().catch(() => {}), 700);
    if (pane === "left") this.saveTimer = next;
    else this.rightTimer = next;
    return Promise.resolve();
  }

  async openSet(id: string, pane: Pane = "left") {
    if (this.setOf(this.other(pane))?.id === id) throw new LiveError("that set is open in the other editor");
    const set = await Library.set(id);
    if (!set) throw new LiveError("that set is gone");
    this.code[pane] = set.code;
    this.use(set, await Library.sets(), pane);
    return set.code;
  }

  async newSet(name: string, pane: Pane = "left") {
    const title = name.trim() || "untitled";
    // the sample uses a pack that exists, when the list can be read; the
    // side editor plays deck b, with another pack than the first when it can
    const deck: DeckId = pane === "right" ? "b" : "a";
    const packs = await this.packList().catch(() => []);
    const pack = (deck === "b" ? packs[1] : undefined)?.id ?? packs[0]?.id ?? "my-pack";
    const set = { id: `set-${Date.now().toString(36)}`, name: title, code: SampleSet(title, pack, deck), updatedAt: Date.now() };
    await Library.saveSet(set);
    this.code[pane] = set.code;
    this.use(set, await this.refreshSets(), pane);
    return set.code;
  }

  async renameSet(name: string, pane: Pane = "left") {
    const current = await Library.set(this.setOf(pane)?.id ?? "");
    if (!current || !name.trim()) return;
    const set = { ...current, name: name.trim(), updatedAt: Date.now() };
    await Library.saveSet(set);
    this.use(set, await this.refreshSets(), pane);
  }

  /** Deletes a set; the editor that had it open moves to another one */
  async deleteSet(id: string, pane: Pane = "left") {
    await Library.deleteSet(id);
    const sets = await this.refreshSets();
    if (this.setOf(pane)?.id !== id) return undefined;
    const next = sets.find((item) => item.id !== this.setOf(this.other(pane))?.id);
    if (next) return this.openSet(next.id, pane);
    return this.newSet("untitled", pane);
  }

  history(pane: Pane = "left") {
    return Library.snapshots(this.setOf(pane)?.id ?? "");
  }

  // —— split view ——

  /** Opens the right editor: its last set, another one, or a fresh one */
  async split() {
    await this.init();
    storage.set(SplitKey, "1");
    if (this.store.get().right) return this.code.right;
    const left = this.store.get().set.id;
    const sets = await Library.sets();
    const last = sets.find((item) => item.id === storage.get(RightSetKey) && item.id !== left);
    if (last) return this.openSet(last.id, "right");
    return this.newSet("side", "right");
  }

  /** Closes the right editor, saving what was typed there first */
  async unsplit() {
    clearTimeout(this.rightTimer);
    const right = this.store.get().right;
    if (right) await Library.saveSet({ id: right.id, name: right.name, code: this.code.right, updatedAt: Date.now() }).catch(() => {});
    storage.set(SplitKey, "");
    this.store.set({ right: undefined });
  }
}
