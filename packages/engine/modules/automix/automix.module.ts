import { DeckId } from "@/common/constants/deck.constant";
import { isCompatibleKey, parseKey, transposeBetween } from "@/common/utils/music.util";

import { Audio } from "../../providers/audio.provider";
import { Transport } from "../../providers/transport.provider";
import { Store } from "../../utils/store.util";
import type { Deck } from "../deck/deck.module";
import { MixPlan, planTransition } from "./planner.module";

export type AutomixState = {
  status: "idle" | "armed" | "mixing";
  // blend length in bars
  length: number;
  from?: DeckId;
  to?: DeckId;
  plan?: MixPlan;
  // transport cycles the blend starts and ends on
  startsAt?: number;
  endsAt?: number;
  // semitones the incoming song is shifted to match keys
  transpose?: number;
  error?: string;
  // which arming this is, so a view can follow its own mix
  id?: number;
  // how each mix ended, by id
  outcomes?: Record<number, "done" | "cancelled">;
};

// the incoming song is set up this long before the blend starts
const Lead = 0.25;

/**
 * Transitions from the playing deck into the other one at the best moment
 * the planner finds: the incoming song enters on its entry bar with its
 * bass cut, the crossfader glides across, halfway through the basses swap,
 * and at the end the old deck stops. Jukebox branching holds meanwhile.
 */
export class Automix {
  store = new Store<AutomixState>({ status: "idle", length: 16 });

  private savedLow = { a: 0, b: 0 };
  private crossfadeFrom = 0.5;
  private entered = false;
  private swapped = false;

  private nextId = 0;

  constructor(private decks: Record<DeckId, Deck>) {
    Transport.tick.on((cycle) => this.tick(cycle));
    Transport.toggled.on((started) => {
      if (!started) this.cancel();
    });
  }

  setLength(length: 8 | 16) {
    if (this.store.get().status === "idle") this.store.set({ length });
  }

  /** The deck being heard most is the one to leave */
  private direction(): { from: DeckId; to: DeckId } | undefined {
    const a = this.decks.a;
    const b = this.decks.b;
    const playingA = a.songPlaying();
    const playingB = b.songPlaying();
    if (playingA && !playingB) return { from: "a", to: "b" };
    if (playingB && !playingA) return { from: "b", to: "a" };
    if (!playingA && !playingB) return undefined;
    return Audio.store.get().crossfade <= 0.5 ? { from: "a", to: "b" } : { from: "b", to: "a" };
  }

  /**
   * Plans the transition and arms it; it then runs by itself. `to` picks
   * the deck that takes over, `length` the blend in bars, and `entry` the
   * bar the incoming song comes in on (eg. a cue's) instead of the best one.
   */
  arm(options: { to?: DeckId; length?: number; entry?: number } = {}) {
    if (this.store.get().status !== "idle") return this.store.get();
    if (!Transport.running) return this.fail("start the clock first");
    if (options.length !== undefined) {
      this.store.set({ length: Math.max(4, Math.round(options.length / 4) * 4) });
    }

    const direction = options.to ? { from: options.to === "a" ? ("b" as DeckId) : ("a" as DeckId), to: options.to } : this.direction();
    if (!direction) return this.fail("nothing is playing to mix out of");
    if (options.to && !this.decks[direction.from].songPlaying()) {
      return this.fail(`deck ${direction.from} is not playing — nothing to mix out of`);
    }
    const from = this.decks[direction.from];
    const to = this.decks[direction.to];
    const fromPack = from.store.get().pack;
    const toPack = to.store.get().pack;
    if (!toPack || !to.profile) return this.fail(`load a pack with stems on deck ${direction.to}`);
    if (!fromPack || !from.profile) return this.fail(`deck ${direction.from} has no stems to mix out of`);

    const length = this.store.get().length;
    const now = Transport.now();
    const position = from.songBar(now);
    // the outgoing song's closer arcs, in bars, so it can take a shortcut
    const graph = fromPack.jukebox?.bar;
    const distances = (graph?.edges || []).map((edge) => edge[2]).sort((x, y) => x - y);
    const median = distances[Math.floor(distances.length / 2)] ?? Infinity;
    const arcs = (graph?.edges || [])
      .filter((edge) => edge[2] <= median)
      .map(([source, target]) => [source, target] as [number, number]);

    const plan = planTransition(from.profile, to.profile, { position, length, lookahead: 32, arcs, entry: options.entry });
    if (!plan) return this.fail("no spot fits a blend of that length");

    // when the blend starts, in transport cycles
    let startsAt: number;
    if (plan.exit.via) {
      const jumpAt = now + (plan.exit.via.from - position);
      from.scheduleJump(plan.exit.via.to, jumpAt);
      startsAt = jumpAt + (plan.exit.bar - plan.exit.via.to);
    } else {
      startsAt = now + (plan.exit.bar - position);
    }

    // shift the incoming song when the keys clash and a small shift fixes it
    let transpose: number | undefined;
    const fromKey = parseKey(fromPack.key);
    const toKey = parseKey(toPack.key);
    if (!isCompatibleKey(fromKey, toKey)) {
      const shift = transposeBetween(toKey, fromKey);
      if (Math.abs(shift) <= 2) {
        transpose = shift;
        plan.reasons.push(`shifts ${direction.to.toUpperCase()} ${shift > 0 ? "+" : ""}${shift} to match keys`);
      } else {
        plan.reasons.push(`keys clash (${fromPack.key} / ${toPack.key})`);
      }
    } else {
      plan.reasons.push("keys match");
    }

    from.holdJukebox = true;
    to.holdJukebox = true;
    this.nextId++;
    this.entered = false;
    this.swapped = false;
    this.store.set({
      status: "armed",
      from: direction.from,
      to: direction.to,
      plan,
      startsAt,
      endsAt: startsAt + length,
      transpose,
      error: undefined,
      id: this.nextId
    });
    return this.store.get();
  }

  private fail(error: string) {
    this.store.set({ error });
    return this.store.get();
  }

  cancel() {
    const { status, from, to, id } = this.store.get();
    if (status === "idle") return;
    if (from) this.decks[from].holdJukebox = false;
    if (to) this.decks[to].holdJukebox = false;
    // put back any bass that was cut
    if (from && this.swapped) this.decks[from].setEq("low", this.savedLow[from]);
    if (to && this.entered && !this.swapped) this.decks[to].setEq("low", this.savedLow[to]);
    this.store.set({
      status: "idle",
      plan: undefined,
      startsAt: undefined,
      endsAt: undefined,
      outcomes: id !== undefined ? { ...this.store.get().outcomes, [id]: "cancelled" } : this.store.get().outcomes
    });
  }

  /** 0..1 through the blend, for the ui */
  progress(cycle = Transport.now()) {
    const { startsAt, endsAt } = this.store.get();
    if (startsAt === undefined || endsAt === undefined) return 0;
    return Math.max(0, Math.min(1, (cycle - startsAt) / (endsAt - startsAt)));
  }

  private tick(cycle: number) {
    const state = this.store.get();
    if (state.status === "idle" || !state.plan || !state.from || !state.to) return;
    const from = this.decks[state.from];
    const to = this.decks[state.to];
    const startsAt = state.startsAt!;
    const endsAt = state.endsAt!;
    const half = startsAt + state.plan.length / 2;
    const target = state.to === "b" ? 1 : 0;

    // set the incoming song up just before the blend starts
    if (!this.entered && cycle >= startsAt - Lead * Transport.cps) {
      this.entered = true;
      this.savedLow[state.from] = from.store.get().eq.low;
      this.savedLow[state.to] = to.store.get().eq.low;
      this.crossfadeFrom = Audio.store.get().crossfade;
      if (state.transpose !== undefined) to.setTranspose(state.transpose, false);
      // the incoming bass stays out until the swap
      to.setEq("low", -1);
      to.startSongAt(state.plan.entry, startsAt);
      this.store.set({ status: "mixing" });
    }

    if (state.status !== "mixing" && !this.entered) return;

    // the crossfader glides across the blend
    if (cycle >= startsAt && cycle < endsAt) {
      const t = (cycle - startsAt) / (endsAt - startsAt);
      Audio.setCrossfade(this.crossfadeFrom + (target - this.crossfadeFrom) * t);
    }

    // halfway, on a phrase line: the basses swap
    if (!this.swapped && cycle >= half) {
      this.swapped = true;
      from.setEq("low", -1);
      to.setEq("low", this.savedLow[state.to]);
    }

    // done: the old deck stops, its eq comes back, the new one takes over
    if (cycle >= endsAt) {
      Audio.setCrossfade(target);
      from.stopAll(Transport.next("beat"));
      from.setEq("low", this.savedLow[state.from]);
      from.holdJukebox = false;
      to.holdJukebox = false;
      this.store.set({
        status: "idle",
        plan: undefined,
        startsAt: undefined,
        endsAt: undefined,
        from: state.to,
        to: state.from,
        outcomes: state.id !== undefined ? { ...state.outcomes, [state.id]: "done" } : state.outcomes
      });
      this.onDone?.(state.to);
    }
  }

  // set by the engine to move the focus to the new deck
  onDone?: (deck: DeckId) => void;
}
