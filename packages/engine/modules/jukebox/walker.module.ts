// Walk logic ported from InfiniteBeats.js of the Infinite Jukebox algorithm
// (https://github.com/rigdern/InfiniteJukeboxAlgorithm, MIT), derived from
// The Eternal Jukebox by UnderMybrella. See ./vendor/LICENSE.
import { JukeUnit, JukeboxGraph } from "@/common/schemas/jukebox.schema";

export const Varieties = ["low", "mid", "high"] as const;
export type Variety = (typeof Varieties)[number];

type Chances = { min: number; max: number; delta: number };

// how similar an arc must be to be used: low variety is the smoothest
export const Strictness: Record<Variety, number> = { low: 0.45, mid: 0.6, high: 0.8 };

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
    strictness = Strictness[variety]
  ) {
    const distances = graph.edges.map((edge) => edge[2]).sort((a, b) => a - b);
    const cutoff = distances.length
      ? distances[Math.min(distances.length - 1, Math.floor(distances.length * strictness))]
      : Infinity;

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
    const branch = this.random() < this.chance;
    if (branch) this.chance = min;
    return branch;
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
