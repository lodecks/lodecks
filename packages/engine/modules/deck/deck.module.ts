import { DeckId, VoiceKey } from "@/common/constants/deck.constant";
import {
  DeckFx,
  DeckFxs,
  HotCueSlots,
  LoopBars
} from "@/common/constants/fx.constant";
import { Quantize } from "@/common/constants/quantize.constant";
import {
  JukeUnit,
  JukeUnitBars,
  JukeboxVersion
} from "@/common/schemas/jukebox.schema";
import { PackTrack, parsePack } from "@/common/schemas/pack.schema";
import { unzipPack, zipPack } from "@/common/utils/zip.util";

import { Steps, buildSteps } from "./steps.module";
import { assignPad, padLayout } from "@/common/utils/pads.util";
import { DeckState, VoiceState } from "@/common/types/deck.type";
import { barSeconds, loopPosition } from "@/common/utils/quantize.util";

import { Audio, DeckBus } from "../../providers/audio.provider";
import { Strudel } from "../../providers/strudel.provider";
import { Transport } from "../../providers/transport.provider";
import { Store } from "../../utils/store.util";
import {
  LoadedPack,
  decodeTrack,
  fetchPack,
  openPack
} from "../pack/loader.module";
import { FxRack } from "../fx/fx.module";
import { Profile } from "../automix/planner.module";
import { buildProfile } from "../automix/profile.module";
import { analyseSong } from "../jukebox/jukebox.module";
import { JukeboxWalker, Varieties } from "../jukebox/walker.module";
import { Voice, VoiceHost, VoiceKind } from "../voice/voice.module";
import { Audition } from "./audition.module";

const emptyState = (id: DeckId): DeckState => ({
  id,
  loading: false,
  voices: {},
  stems: {},
  cues: {},
  origin: 0,
  volume: 0.9,
  eq: { low: 0, mid: 0, high: 0 },
  filter: 0,
  fx: Object.fromEntries(DeckFxs.map((fx) => [fx, false])) as DeckState["fx"],
  transpose: 0,
  prelisten: false,
  edited: false,
  infinite: false,
  jukeUnit: "bar",
  variety: "mid",
  jukebox: { status: "idle" }
});

const voiceState = (track: PackTrack): VoiceState => ({
  id: track.id,
  status: "loading",
  muted: false,
  gain: 1,
  fxSend: track.fxSend
});

// crossfade lengths, in seconds
const JumpFade = 0.06;
const JukeboxFade = 0.12;
// how much of the boundary to compare, and how different it may sound
const SeamWindow = 0.12;
const SeamLimit = 0.45;

// how far ahead of a loop end the jump back is scheduled
const LoopLookahead = 0.15;

// how often a pitch glide moves, in ms
const GlideStep = 40;

export class Deck implements VoiceHost {
  store: Store<DeckState>;
  voices = new Map<string, Voice>();
  stems = new Map<string, Voice>();

  private loaded?: LoadedPack;
  // the song on a 16th grid, for the inline views; built on first use
  private grid?: Steps;
  // the zip of a pack that is not on the server (an import, a browser pack),
  // kept so it can be saved again: the decoded files are let go
  private bytes?: Uint8Array;
  private token = 0;
  // the song has not been started since the pack was loaded
  private fresh = true;
  private jumping?: { at: number; origin: number };
  private rack?: FxRack;
  private previewSource?: AudioBufferSourceNode;
  private walker?: JukeboxWalker;
  // the boundary the walk last decided for, in transport cycles
  private walkAt?: number;
  private forceJump = false;
  // play() pressed while the clock was stopped: the song starts with it
  private startWithClock = false;
  // per bar levels of vocals, drums, bass, for planning transitions
  profile?: Profile;
  // no jukebox branching, eg. while a transition is playing
  holdJukebox = false;
  // the pack editor's player, on a clock of its own
  audition = new Audition({
    layers: () => [
      ...[...this.stems.values()].map((voice) => [`stems:${voice.id}`, voice] as [string, Voice]),
      ...[...this.voices.values()].map((voice) => [`voices:${voice.id}`, voice] as [string, Voice])
    ],
    barSeconds: () => barSeconds(this.pack.bpm, this.pack.timeSignature[0]),
    songBars: () => this.songBars,
    // stems start at the top of their file, gridOffset seconds before bar 0
    startOf: (voice) =>
      voice.track.bar - (voice.track.type === "stem" ? this.pack.gridOffset / barSeconds(this.pack.bpm, this.pack.timeSignature[0]) : 0)
  });

  /**
   * `editor`: a deck only for the pack editor. It is on no mixer channel,
   * follows no clock and registers nothing with the set; only its own
   * player (the audition) is heard. `id` then only names it.
   */
  constructor(readonly id: DeckId, readonly editor = false) {
    this.store = new Store(emptyState(id));
    if (editor) return;
    Transport.tick.on((cycle) => this.tick(cycle));
    Transport.tempo.on(() => this.resync());
    Transport.toggled.on((started) => {
      if (started && this.startWithClock) {
        // the clock's mapping is valid a tick after it starts
        Transport.ready().then(() => this.startSong());
      }
      if (!started) this.stopAll();
    });
  }

  // an editor deck's voices are never played: they connect to nothing
  private silent?: DeckBus;

  get bus() {
    if (!this.editor) return Audio.decks[this.id];
    this.silent ??= { input: new GainNode(Audio.ctx), send: new GainNode(Audio.ctx) } as DeckBus;
    return this.silent;
  }

  get fx() {
    if (!this.rack) {
      Audio.create();
      this.rack = new FxRack(this.bus);
    }
    return this.rack;
  }

  private syncFx() {
    const fx = Object.fromEntries(
      DeckFxs.map((name) => [name, this.fx.isActive(name)])
    ) as Record<DeckFx, boolean>;
    this.store.set({ fx });
  }

  engageFx(fx: DeckFx) {
    this.fx.engage(fx);
    this.syncFx();
  }

  releaseFx(fx: DeckFx) {
    this.fx.release(fx);
    this.syncFx();
  }

  toggleFx(fx: DeckFx) {
    this.fx.toggle(fx);
    this.syncFx();
  }

  get pack() {
    return this.store.get().pack!;
  }

  get transpose() {
    return this.store.get().transpose;
  }

  /** Length of the song in bars, stems wrap around it */
  get songBars() {
    const pack = this.pack;
    if (pack.bars) return pack.bars;

    const bar = barSeconds(pack.bpm, pack.timeSignature[0]);
    let longest = 1;
    for (const voice of this.all()) {
      if (voice.track.type !== "stem") continue;
      longest = Math.max(
        longest,
        Math.ceil((voice.loaded.buffer.duration - pack.gridOffset) / bar)
      );
    }
    return longest;
  }

  private *all() {
    yield* this.voices.values();
    yield* this.stems.values();
  }

  // -- voice host

  state(kind: VoiceKind, id: string) {
    return this.store.get()[kind][id];
  }

  update(kind: VoiceKind, id: string, state: Partial<VoiceState>) {
    this.store.set((deck) => ({
      [kind]: { ...deck[kind], [id]: { ...deck[kind][id], ...state } }
    }));
  }

  originAt(cycle: number) {
    const jumping = this.jumping;
    return jumping && cycle >= jumping.at ? jumping.origin : this.store.get().origin;
  }

  choke(voice: Voice, cycle: number) {
    const group = voice.track.choke;
    if (!group) return;

    for (const other of this.all()) {
      if (other !== voice && other.track.choke === group && other.active) {
        other.stop(cycle);
      }
    }
  }

  // the first stem after a load starts the song from its first bar
  onStart(voice: Voice, cycle: number) {
    if (voice.track.type !== "stem" || !this.fresh) return;
    this.fresh = false;
    this.jumping = undefined;
    // the song's first bar starts exactly where the track starts
    this.store.set({ origin: cycle });
  }

  // -- packs

  async load(source: string | { id: string; bytes: Uint8Array }) {
    this.eject();
    const token = ++this.token;
    Audio.create();

    const id = typeof source === "string" ? source : source.id;
    this.bytes = typeof source === "string" ? undefined : source.bytes;
    this.grid = undefined;
    this.store.set({ loading: true, packId: id, error: undefined });

    try {
      const loaded =
        typeof source === "string"
          ? await fetchPack(source)
          : openPack(source.id, source.bytes);
      if (token !== this.token) return;

      const { pack } = loaded;
      this.loaded = loaded;
      this.fresh = true;
      this.store.set({
        pack,
        origin: 0,
        cues: Object.fromEntries(
          pack.cues.map((cue) => [cue.slot, { bar: cue.bar, name: cue.name }])
        ),
        voices: Object.fromEntries(
          pack.voices.map((track) => [track.id, voiceState(track)])
        ),
        stems: Object.fromEntries(
          pack.stems.map((track) => [track.id, voiceState(track)])
        )
      });

      // one track at a time keeps the ui responsive and memory flat
      const tracks: [VoiceKind, PackTrack][] = [
        ...pack.voices.map((track) => ["voices", track] as [VoiceKind, PackTrack]),
        ...pack.stems.map((track) => ["stems", track] as [VoiceKind, PackTrack])
      ];
      for (const [kind, track] of tracks) {
        const decoded = await decodeTrack(loaded, track);
        if (token !== this.token) return;

        this[kind].set(track.id, new Voice(this, kind, decoded));
        this.update(kind, track.id, { status: "idle" });
      }

      // the zip contents are decoded now, let them go
      loaded.files = {};
      this.store.set({ loading: false });
      // the editor needs no transitions or jukebox
      if (this.editor) return;
      const followers = this.followers();
      this.profile = followers.length
        ? buildProfile(pack, followers, this.songBars)
        : undefined;
      // loaded, not playing: the song starts when asked to
      this.prepareJukebox(token);
    } catch (error) {
      if (token !== this.token) return;
      console.error(error);
      this.store.set({ loading: false, error: (error as Error).message });
    }
  }

  eject() {
    this.token++;
    this.grid = undefined;
    this.stopPreview();
    this.audition.reset();
    this.rack?.releaseAll();
    for (const voice of this.all()) voice.dispose();
    this.voices.clear();
    this.stems.clear();
    this.loaded = undefined;
    this.jumping = undefined;
    this.walker = undefined;
    this.walkAt = undefined;
    this.forceJump = false;
    this.startWithClock = false;
    this.stopGlide();
    this.profile = undefined;
    this.holdJukebox = false;

    // mixer and infinite settings belong to the deck, not the pack
    const { volume, eq, filter, prelisten, infinite, jukeUnit, variety } = this.store.get();
    this.store.set({
      ...emptyState(this.id),
      volume,
      eq,
      filter,
      prelisten,
      infinite,
      jukeUnit,
      variety
    });
  }

  // -- playing

  find(kind: VoiceKind, key: VoiceKey) {
    const track = padLayout(this.pack[kind]).get(key);
    return track ? this[kind].get(track.id) : undefined;
  }

  /** Pad press. Starts the clock first when nothing is running yet. */
  async press(kind: VoiceKind, id: string, quantize?: Quantize) {
    const voice = this[kind].get(id);
    if (!voice) return;

    if (!Transport.running) {
      await Strudel.start();
      await Transport.ready();
      // nothing to stay in time with yet, so do not wait a whole bar
      return voice.press("beat");
    }

    voice.press(quantize || Transport.store.get().quantize);
  }

  pressKey(kind: VoiceKind, key: VoiceKey) {
    const voice = this.find(kind, key);
    if (voice) return this.press(kind, voice.id);
  }

  stopAll(cycle?: number) {
    for (const voice of this.all()) voice.stop(cycle);
  }

  private tick(cycle: number) {
    if (!this.loaded) return;

    const jumping = this.jumping;
    if (jumping && cycle >= jumping.at) {
      this.jumping = undefined;
      this.store.set({ origin: jumping.origin });
    }

    for (const voice of this.all()) {
      if (voice.active) voice.tick(cycle);
    }

    this.tickJukebox(cycle);
    this.tickLoop(cycle);
  }

  // -- infinite jukebox

  /** Tracks that follow the song position: stems and stem voices */
  followers() {
    return [...this.all()].filter((voice) => voice.track.type === "stem");
  }

  songPlaying() {
    return this.followers().some((voice) => voice.state.status === "playing");
  }

  /**
   * Switches the song's main tracks on (stems and stem voices: drums,
   * bass, vocals…). With the clock running they come in together on the
   * next 4-bar phrase, from the song's first bar; with it stopped they wait
   * and start with it.
   */
  startSong() {
    const followers = this.followers();
    if (!followers.length) return;
    if (!Transport.running) {
      this.startWithClock = true;
      return;
    }
    this.startWithClock = false;
    if (followers.some((voice) => voice.active)) return;

    // right after the clock starts there is nothing to stay in phase with
    const at = Transport.next(Transport.now() < 1 ? "beat" : "phrase");
    for (const voice of followers) voice.start(at);
  }

  /** Moves the song to `bar` at transport `cycle`, crossfading */
  scheduleJump(bar: number, cycle: number, fade = JukeboxFade) {
    if (!this.store.get().pack) return;
    this.fresh = false;
    this.jumpAt(bar, cycle, fade);
  }

  /** Starts the song's main tracks at transport `cycle`, from song `bar` */
  startSongAt(bar: number, cycle: number) {
    const followers = this.followers();
    if (!followers.length) return;
    if (followers.some((voice) => voice.active)) return this.scheduleJump(bar, cycle);

    this.fresh = false;
    this.startWithClock = false;
    this.jumping = undefined;
    this.store.set({ origin: cycle - bar });
    for (const voice of followers) voice.start(cycle);
  }

  /** Uses the pack's saved graphs, or analyses the song in a worker */
  private async prepareJukebox(token: number) {
    const pack = this.store.get().pack;
    const followers = this.followers();
    if (!pack || !followers.length) {
      this.setJukebox({ status: "unavailable" });
      return;
    }

    if (pack.jukebox?.version === JukeboxVersion) {
      this.setJukebox({ status: "ready" });
      this.buildWalker();
      return;
    }

    this.setJukebox({ status: "analysing" });
    try {
      const { jukebox, ms } = await analyseSong(pack, followers, this.songBars);
      if (token !== this.token) return;
      // kept in the pack: saving it skips the analysis next time
      this.store.set((deck) => ({ pack: deck.pack ? { ...deck.pack, jukebox } : deck.pack, edited: true }));
      this.setJukebox({ status: "ready", ms: ms.total });
      this.buildWalker();
    } catch (error) {
      if (token !== this.token) return;
      console.warn("[lodecks] jukebox analysis failed", error);
      this.setJukebox({ status: "failed", error: (error as Error).message });
    }
  }

  private setJukebox(patch: Partial<DeckState["jukebox"]>) {
    this.store.set((deck) => ({ jukebox: { ...deck.jukebox, ...patch } }));
  }

  private buildWalker() {
    const { pack, jukeUnit, variety } = this.store.get();
    const graph = pack?.jukebox?.[jukeUnit];
    this.walkAt = undefined;
    this.walker = graph ? new JukeboxWalker(graph, jukeUnit, variety) : undefined;
    this.setJukebox({ arcs: this.walker?.arcs ?? 0 });
  }

  /** The graph in use, for drawing */
  get graph() {
    return this.walker?.graph;
  }

  setInfinite(infinite: boolean) {
    this.walkAt = undefined;
    this.store.set({ infinite });
  }

  setJukeUnit(jukeUnit: JukeUnit) {
    this.store.set({ jukeUnit });
    this.buildWalker();
  }

  setVariety(variety: (typeof Varieties)[number]) {
    if (this.store.get().variety === variety) return;
    this.store.set({ variety });
    this.buildWalker();
  }

  cycleVariety() {
    const index = Varieties.indexOf(this.store.get().variety);
    const variety = Varieties[(index + 1) % Varieties.length];
    this.store.set({ variety });
    // variety also sets how similar arcs must be, so the graph is rebuilt
    this.buildWalker();
  }

  /** Branches at the next boundary, wherever there is an arc to take */
  jumpNow() {
    this.forceJump = true;
    this.walkAt = undefined;
    this.setJukebox({ forced: true });
  }

  /**
   * Shortly before each bar (or beat) of the song, asks the walker what
   * plays next and jumps there on the boundary. Works in song time, so it
   * stays right after beat jumps moved the song off the transport's bars.
   */
  private tickJukebox(cycle: number) {
    const state = this.store.get();
    const walker = this.walker;
    if (!state.infinite || !walker || state.loop?.active || this.jumping || this.holdJukebox) return;
    if (!walker.graph.count || !this.songPlaying()) return;

    const unit = JukeUnitBars[state.jukeUnit];
    const song = cycle - this.originAt(cycle);
    const next = Math.ceil(song / unit - 1e-6);
    const at = cycle + (next * unit - song);
    if (this.walkAt !== undefined && Math.abs(this.walkAt - at) < 1e-6) return;

    const lead = (at - cycle) / Transport.cps;
    if (lead > 0.2) return;
    this.walkAt = at;
    // too close to schedule a clean seek, wait for the next one
    if (lead < 0.03) return;

    const count = walker.graph.count;
    const index = ((next % count) + count) % count;
    if (!walker.wantsBranch(index, this.forceJump)) return;

    // of the similar spots, take the one with the cleanest seam
    let dest: number | undefined;
    let best = Infinity;
    for (const option of walker.candidates(index)) {
      const cost = this.seamCost(index * unit, option * unit);
      if (cost < best) {
        best = cost;
        dest = option;
      }
    }
    const limit = walker.isLastBranchPoint(index) ? Infinity : this.forceJump ? 0.8 : SeamLimit;
    if (dest === undefined || dest === index || best > limit) return;

    if (this.forceJump) this.forceJump = false;
    this.jumpAt(dest * unit, at, JukeboxFade);
    this.setJukebox({ lastJump: { from: index, to: dest, at, seam: Math.round(best * 100) / 100 }, forced: false });
  }

  // puts every sounding voice back on the grid, shortly from now; with
  // `fade` the old audio overlaps the new one (jumps), otherwise it cuts
  private resync(time = Audio.ctx.currentTime + 0.08, stemsOnly = false, fade = 0) {
    for (const voice of this.all()) {
      if (!voice.active) continue;
      if (stemsOnly && voice.track.type !== "stem") continue;
      if (fade > 0) voice.crossfade(time, fade);
      else voice.resync(time);
    }
  }

  // -- song position, cues and loops

  /** Song position in bars at `cycle` */
  songBar(cycle = Transport.now()) {
    if (!this.store.get().pack) return 0;
    return loopPosition(cycle - this.originAt(cycle), this.songBars);
  }

  /** Moves the song to `bar` on the next quantize point, staying in phase */
  jump(bar: number, quantize?: Quantize) {
    if (!this.store.get().pack) return;
    this.fresh = false;

    if (!Transport.running) {
      this.store.set({ origin: -bar });
      return;
    }

    const setting = quantize || Transport.store.get().quantize;
    const at = Transport.next(setting === "phrase" ? "bar" : setting);
    this.jumpAt(bar, at);
  }

  // song jumps (cues, loops, the jukebox) crossfade instead of cutting
  private jumpAt(bar: number, at: number, fade = JumpFade) {
    this.jumping = { at, origin: at - bar };
    this.resync(Transport.timeAt(at), true, fade);
  }

  /**
   * How audible a jump from song bar `from` to `to` would be, 0..1: per
   * track, the level that should have played next against the level that
   * will play instead, just after the boundary. Catches cutting a vocal
   * mid-word or slamming loud material into a quiet moment.
   */
  private seamCost(from: number, to: number) {
    let difference = 0;
    let total = 0;
    for (const voice of this.followers()) {
      if (!voice.active || voice.state.muted) continue;
      const before = voice.levelAt(from, -0.06, 0);
      const next = voice.levelAt(from, 0, SeamWindow);
      const landing = voice.levelAt(to, 0, SeamWindow);
      difference += Math.abs(next - landing);
      total += Math.max(before, next, landing);
    }
    return total > 0.001 ? difference / total : 0;
  }

  /** Jumps by whole bars from where the song is */
  beatJump(bars: number) {
    const loop = this.store.get().loop;
    if (loop?.active) {
      this.store.set({ loop: { ...loop, start: loop.start + bars } });
    }
    const at = Transport.running ? Transport.next("beat") : 0;
    const target = this.songBar(at) + bars;
    if (!Transport.running) return this.jump(loopPosition(target, this.songBars));
    this.jumpAt(target, at);
  }

  setCue(slot: number, bar = this.songBar()) {
    if (slot < 1 || slot > HotCueSlots) return;
    // cues sit on beats, inside the song
    const snapped = Math.max(0, Math.min(this.songBars - 0.25, Math.round(bar * 4) / 4));
    this.store.set((deck) => ({
      cues: {
        ...deck.cues,
        [slot]: { bar: snapped, name: deck.cues[slot]?.name || `cue ${slot}` }
      },
      edited: true
    }));
  }

  renameCue(slot: number, name: string) {
    const cue = this.store.get().cues[slot];
    if (!cue || !name.trim()) return;
    this.store.set((deck) => ({
      cues: { ...deck.cues, [slot]: { ...cue, name: name.trim() } },
      edited: true
    }));
  }

  /** First free cue slot, for adding a cue */
  freeCueSlot() {
    const cues = this.store.get().cues;
    for (let slot = 1; slot <= HotCueSlots; slot++) if (!cues[slot]) return slot;
    return undefined;
  }

  clearCue(slot: number) {
    this.store.set((deck) => {
      const cues = { ...deck.cues };
      delete cues[slot];
      return { cues, edited: true };
    });
  }

  /** Jumps to a cue, or sets it where the song is when the slot is empty */
  cue(slot: number) {
    const cue = this.store.get().cues[slot];
    if (!cue) return this.setCue(slot);
    this.jump(cue.bar);
  }

  /** Loops the song over `bars`, starting from the bar it is in */
  setLoop(bars: number) {
    const position = this.songBar();
    const step = Math.min(1, bars);
    const start = Math.floor(position / step) * step;
    this.store.set({ loop: { start, bars, active: true } });
  }

  toggleLoop(bars = 4) {
    const loop = this.store.get().loop;
    if (loop?.active) return this.store.set({ loop: { ...loop, active: false } });
    this.setLoop(loop?.bars || bars);
  }

  resizeLoop(direction: 1 | -1) {
    const loop = this.store.get().loop;
    const current = loop?.bars || 4;
    const index = LoopBars.indexOf(current as (typeof LoopBars)[number]);
    const next =
      LoopBars[Math.max(0, Math.min(LoopBars.length - 1, index + direction))];

    if (loop?.active) this.store.set({ loop: { ...loop, bars: next } });
    else this.store.set({ loop: { start: loop?.start || 0, bars: next, active: false } });
  }

  private tickLoop(cycle: number) {
    const loop = this.store.get().loop;
    if (!loop?.active || this.jumping) return;

    const origin = this.store.get().origin;
    // unwrapped song position, the loop end is compared in transport cycles
    const position = cycle - origin;
    const wraps = Math.floor(position / this.songBars) * this.songBars;
    const end = origin + wraps + loop.start + loop.bars;
    const lookahead = LoopLookahead * Transport.cps;

    if (cycle + lookahead >= end && cycle < end + loop.bars) {
      this.jumpAt(loop.start, Math.max(end, cycle + 0.03 * Transport.cps));
    }
  }

  // -- mixer

  setVolume(volume: number) {
    this.store.set({ volume });
    Audio.setDeckVolume(this.id, volume);
  }

  setEq(band: "low" | "mid" | "high", value: number) {
    this.store.set((deck) => ({ eq: { ...deck.eq, [band]: value } }));
    Audio.setDeckEq(this.id, band, value);
  }

  setFilter(filter: number) {
    this.store.set({ filter });
    Audio.setDeckFilter(this.id, filter);
  }

  setPrelisten(prelisten: boolean) {
    this.store.set({ prelisten });
    Audio.setPrelisten(this.id, prelisten);
  }

  /**
   * Shifts the pitch of every stretched voice, in semitones. Without
   * `resync` the change is picked up by the next jump or start.
   */
  setTranspose(transpose: number, resync = true) {
    this.stopGlide();
    this.applyTranspose(transpose, resync);
  }

  private applyTranspose(transpose: number, resync = true) {
    this.store.set({ transpose: Math.max(-12, Math.min(12, transpose)) });
    if (resync) this.resync();
  }

  private glide?: ReturnType<typeof setTimeout>;

  private stopGlide() {
    clearTimeout(this.glide);
    this.glide = undefined;
  }

  /**
   * Bends the pitch to `target` semitones over `seconds`, in small steps:
   * the stretcher takes fractional semitones, so it sounds like a glide.
   */
  glideTranspose(target: number, seconds: number) {
    this.stopGlide();
    const from = this.store.get().transpose;
    if (seconds <= 0 || from === target) return this.applyTranspose(target);
    const start = Audio.ctx.currentTime;
    const step = () => {
      const t = Math.min(1, (Audio.ctx.currentTime - start) / seconds);
      // eased at both ends, no audible corner
      const eased = t * t * (3 - 2 * t);
      this.applyTranspose(t >= 1 ? target : from + (target - from) * eased);
      if (t < 1) this.glide = setTimeout(step, GlideStep);
      else this.glide = undefined;
    };
    step();
  }

  // -- explorer edits

  private setTracks(kind: VoiceKind, tracks: PackTrack[]) {
    const pack = this.store.get().pack;
    if (!pack) return;

    for (const track of tracks) {
      const voice = this[kind].get(track.id);
      if (voice) voice.loaded.track = track;
    }
    this.store.set({ pack: { ...pack, [kind]: tracks }, edited: true });
  }

  /** Renames, stars or retunes a track; saved into the pack with save() */
  updateTrack(kind: VoiceKind, id: string, patch: Partial<PackTrack>) {
    const pack = this.store.get().pack;
    if (!pack) return;

    this.setTracks(
      kind,
      pack[kind].map((track) => (track.id === id ? { ...track, ...patch } : track))
    );
    if (patch.fxSend !== undefined) this.update(kind, id, { fxSend: patch.fxSend });
    this[kind].get(id)?.refresh();
  }

  /**
   * Takes a layer out of the pack (saved with the next save). It stops
   * where it plays; its file stays in the zip, unused.
   */
  removeTrack(kind: VoiceKind, id: string) {
    const pack = this.store.get().pack;
    const voice = this[kind].get(id);
    if (!pack || !voice) return;
    if (pack.stems.length + pack.voices.length <= 1) return;
    if (this.store.get().previewing === `${kind}:${id}`) this.stopPreview();
    voice.dispose();
    this[kind].delete(id);
    const { [id]: _, ...rest } = this.store.get()[kind];
    this.store.set({ [kind]: rest } as Partial<DeckState>);
    this.grid = undefined;
    this.setTracks(kind, pack[kind].filter((track) => track.id !== id));
    this.audition.forget(`${kind}:${id}`);
  }

  /** Puts a track on a pad (swapping with what was there) or off the pads */
  assignPad(kind: VoiceKind, id: string, key: VoiceKey | undefined) {
    const pack = this.store.get().pack;
    if (!pack) return;
    this.setTracks(kind, assignPad(pack[kind], id, key));
  }

  /**
   * Plays a track once from its start in the headphones (the cue bus), or
   * on the master when pre-listen is off, without touching the deck.
   */
  preview(kind: VoiceKind, id: string) {
    this.stopPreview();
    const voice = this[kind].get(id);
    if (!voice) return;

    Audio.create();
    const ctx = Audio.ctx;
    const source = new AudioBufferSourceNode(ctx, { buffer: voice.loaded.buffer });
    const gain = new GainNode(ctx, { gain: voice.track.gain * 0.8 });
    source.connect(gain);
    gain.connect(Audio.store.get().cueMode === "off" ? Audio.master : Audio.cue);
    source.onended = () => {
      gain.disconnect();
      if (this.previewSource === source) {
        this.previewSource = undefined;
        this.store.set({ previewing: undefined });
      }
    };
    source.start();
    this.previewSource = source;
    this.store.set({ previewing: `${kind}:${id}` });
  }

  stopPreview() {
    const source = this.previewSource;
    this.previewSource = undefined;
    source?.stop();
    this.store.set({ previewing: undefined });
  }

  markSaved() {
    this.store.set({ edited: false });
  }

  /** The song on a 16th-note grid, per layer (built once, when asked) */
  steps() {
    if (this.grid) return this.grid;
    if (this.store.get().loading || !this.store.get().pack) return undefined;
    const followers = this.followers();
    if (!followers.length) return undefined;
    this.grid = buildSteps(this.pack, followers, Math.ceil(this.songBars));
    return this.grid;
  }

  /** Renames the pack (saved with the next save) */
  renamePack(title: string) {
    const pack = this.store.get().pack;
    if (!pack || !title.trim() || title.trim() === pack.title) return;
    this.store.set({ pack: { ...pack, title: title.trim() }, edited: true });
  }

  /** After a pack was saved under a new id (a fresh import's first save) */
  setPackId(id: string) {
    if (this.loaded) this.loaded = { ...this.loaded, id };
    this.store.set({ packId: id });
  }

  /** The whole pack as a .lopack, with the cues set live: for saving it anew */
  zip(title?: string) {
    const manifest = this.manifest();
    if (!manifest || !this.loaded) return undefined;
    const pack = parsePack({ ...manifest, title: title ?? manifest.title });
    // files come from the kept zip; a server pack's are fetched again
    const files = this.bytes ? unzipPack(this.bytes).files : this.loaded.files;
    if (!Object.keys(files).length) return undefined;
    return { pack, bytes: zipPack(pack, files) };
  }

  /** The pack with the cues that were set live, ready to be saved */
  manifest() {
    const { pack, cues } = this.store.get();
    if (!pack) return undefined;

    return {
      ...pack,
      cues: Object.entries(cues).map(([slot, cue]) => ({
        slot: Number(slot),
        name: cue.name,
        bar: cue.bar
      }))
    };
  }
}
