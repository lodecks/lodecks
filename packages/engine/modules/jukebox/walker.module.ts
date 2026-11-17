// Walk logic ported from InfiniteBeats.js of the Infinite Jukebox algorithm
// (https://github.com/rigdern/InfiniteJukeboxAlgorithm, MIT), derived from
// The Eternal Jukebox by UnderMybrella. See ./vendor/LICENSE.
import { JukeUnit, JukeboxGraph } from "@/common/schemas/jukebox.schema";

export const Varieties = ["low", "mid", "high"] as const;
export type Variety = (typeof Varieties)[number];

type Chances = { min: number; max: number; delta: number };

// how similar an arc must be to be used: low variety is the smoothest
export const Strictness: Record<Variety, number> = { low: 0.45, mid: 0.6, high: 0.8 };

// on top of that, arcs further than this many times the song's median
// distance go too: in a song where every arc is poor, the percentile alone
// would still keep the poor ones
export const Ceiling: Record<Variety, number> = { low: 1.15, mid: 1.3, high: 1.6 };

/**
 * Where the song's phrases are, in quanta: `phrase` is how many quanta make
 * 8 bars, `starts` are the sections' first quanta. With them, jumps prefer
 * phrase starts and keep to the same place in a phrase, like a dj would.
 */
export type Phrasing = { phrase: number; starts?: number[] };

// branch chance at a phrase or section start, and anywhere else
const PhraseBoost = 2.5;
const InsideDamp = 0.5;

// the original numbers are per beat; bars get calmer ones, since a jump
// every couple of bars sounds restless in a dj set
const Chance: Record<JukeUnit, Record<Variety, Chances>> = {
  beat: {
    low: { min: 0.08, max: 0.3, delta: 0.01 },
    mid: { min: 0.18, max: 0.5, delta: 0.018 },
    high: { min: 0.3, max: 0.7, delta: 0.03 }
  },
  bar: {
    low: { min: 0.03, max: 0.2, delta: 0.01 },
    mid: { min: 0.06, max: 0.35, delta: 0.02 },
    high: { min: 0.12, max: 0.55, delta: 0.035 }
  }
};

export class JukeboxWalker {
  private neighbors: number[][];
  private chance: number;
  private starts: Set<number>;
  // arcs kept after dropping the least similar ones
  readonly kept: number;

  /**
   * `strictness` keeps only arcs at least this similar: 0.6 drops the 40%
   * of arcs with the largest distance, which are the ones that sound like
   * a cut. The last branch point keeps all of its arcs, so the song can
   * always loop back.
   */
  constructor(
    readonly graph: JukeboxGraph,
    private unit: JukeUnit,
    public variety: Variety = "mid",
    private random: () => number = Math.random,
    strictness = Strictness[variety],
    private phrasing?: Phrasing
  ) {
    const distances = graph.edges.map((edge) => edge[2]).sort((a, b) => a - b);
    const percentile = distances.length
      ? distances[Math.min(distances.length - 1, Math.floor(distances.length * strictness))]
      : Infinity;
    const median = distances[Math.floor(distances.length / 2)];
    const cutoff = median > 0 ? Math.min(percentile, median * Ceiling[variety]) : percentile;
    this.starts = new Set(phrasing?.starts ?? []);

    this.neighbors = Array.from({ length: graph.count }, () => []);
    let kept = 0;
    // edges are stored nearest first, which is the order the original tries
    for (const [from, to, distance] of graph.edges) {
      if (from < 0 || from >= graph.count) continue;
      if (distance > cutoff && from !== graph.lastBranchPoint) continue;
      this.neighbors[from].push(to);
      kept++;
    }
    this.kept = kept;
    this.chance = this.chances.min;
  }

  private get chances() {
    return Chance[this.unit][this.variety];
  }

  get arcs() {
    return this.kept;
  }

  hasBranch(index: number) {
    return (this.neighbors[index]?.length || 0) > 0;
  }

  private shouldBranch(index: number) {
    // the last branch point always branches, so the song never ends
    if (index === this.graph.lastBranchPoint) return true;

    const { min, max, delta } = this.chances;
    this.chance = Math.min(max, this.chance + delta);
    const branch = this.random() < this.chance * this.weight(index);
    if (branch) this.chance = min;
    return branch;
  }

  /** Whether `index` starts a phrase (every 8 bars) or a section */
  isPhraseStart(index: number) {
    const phrase = this.phrasing?.phrase;
    return !!phrase && (index % phrase === 0 || this.starts.has(index));
  }

  // jumps are likelier where a phrase starts, rarer inside one
  private weight(index: number) {
    if (!this.phrasing) return 1;
    return this.isPhraseStart(index) ? PhraseBoost : InsideDamp;
  }

  /**
   * Arcs from `index` that keep the place in an 8-bar phrase first, then
   * the rest (which keep the place in 4 bars, as every arc does)
   */
  ranked(index: number) {
    const list = this.candidates(index);
    const phrase = this.phrasing?.phrase;
    if (!phrase) return { aligned: list, rest: [] as number[] };
    const aligned = list.filter((dest) => (dest - index) % phrase === 0);
    return { aligned, rest: list.filter((dest) => (dest - index) % phrase !== 0) };
  }

  /**
   * Every earlier quantum at the same place in an 8-bar phrase: where the
   * last branch point may go when none of its arcs sounds clean
   */
  phraseMates(index: number) {
    const phrase = this.phrasing?.phrase;
    if (!phrase) return [];
    const mates: number[] = [];
    for (let at = index - phrase; at >= 0; at -= phrase) mates.push(at);
    return mates;
  }

  /** Whether to branch before `index`; ramps and resets the chance */
  wantsBranch(index: number, force = false) {
    if (!this.neighbors[index]?.length) return false;
    if (force) {
      this.chance = this.chances.min;
      return true;
    }
    return this.shouldBranch(index);
  }

  /** Where `index` may branch to, rotated so repeated visits differ */
  candidates(index: number) {
    const options = this.neighbors[index];
    if (!options?.length) return [];
    const list = [...options];
    options.push(options.shift()!);
    return list;
  }

  isLastBranchPoint(index: number) {
    return index === this.graph.lastBranchPoint;
  }

  /**
   * The quantum to play when `index` is next: itself, or a similar one.
   * `force` branches whenever there is somewhere to go.
   */
  choose(index: number, force = false) {
    const options = this.neighbors[index];
    if (!options?.length) return index;
    if (!force && !this.shouldBranch(index)) return index;
    if (force) this.chance = this.chances.min;

    // rotate, so repeated visits take different arcs
    const next = options.shift()!;
    options.push(next);
    return next;
  }
}
