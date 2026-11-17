import SignalsmithStretch, { StretchNode } from "signalsmith-stretch";

import { Audio } from "./audio.provider";

// stretch nodes keep running once created, so the pool is capped and reused.
// Room for two decks of stems, their jukebox spares, and pads
const MaxNodes = 24;
// spares only take a node while this many stay free for what plays
const SpareHeadroom = 6;

class StretchProvider {
  private free: StretchNode[] = [];
  private total = 0;
  private waiting: ((node: StretchNode) => void)[] = [];
  broken = new WeakSet<StretchNode>();

  get size() {
    return this.total;
  }

  get busy() {
    return this.total - this.free.length;
  }

  // creates a first node ahead of time so the wasm module is compiled
  async warm() {
    if (this.total > 0) return;
    this.release(await this.acquire());
  }

  /** A node can be had right now, without waiting for one to free up */
  available() {
    return this.free.length > 0 || this.total < MaxNodes;
  }

  /** Enough nodes left that a spare (a nice-to-have) may take one */
  spareAllowed() {
    return this.free.length + (MaxNodes - this.total) > SpareHeadroom;
  }

  async acquire(): Promise<StretchNode> {
    const node = this.free.pop();
    if (node) return node;

    if (this.total >= MaxNodes) {
      return new Promise((resolve) => this.waiting.push(resolve));
    }

    // nodes are never garbage collected (their processor always returns
    // true) and each holds its own wasm memory, hence the fixed pool
    this.total++;
    // mono, as the stems are: half the work of the stereo default. It needs
    // one (unused) input: with no inputs its processor crashes (1.3.2)
    const created = await SignalsmithStretch(Audio.ctx, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit"
    });
    created.onprocessorerror = () => {
      this.broken.add(created);
      console.warn("[lodecks] a stretch node crashed, voices fall back to plain playback");
    };
    // voices are mono and many, the cheaper preset is plenty. blockMs must
    // be cleared, otherwise the preset is ignored
    await created.configure({ blockMs: null, preset: "cheaper" });
    return created;
  }

  release(node: StretchNode) {
    node.disconnect();
    if (this.broken.has(node)) {
      // a crashed node never plays again, make room for a new one
      this.total--;
      const next = this.waiting.shift();
      if (next) this.acquire().then(next);
      return;
    }
    node.schedule({ active: false });
    node.dropBuffers();

    const next = this.waiting.shift();
    if (next) next(node);
    else this.free.push(node);
  }
}

export const Stretch = new StretchProvider();
