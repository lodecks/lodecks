/**
 * The pack editor's own player: the song as it is arranged, every layer at
 * its bar, at the pack's own tempo, on a clock of its own. It never
 * touches the deck, the transport or the set; it is heard in the
 * headphones (the cue bus), or on the master when cueing is off.
 */
import { Audio } from "../../providers/audio.provider";
import { Store } from "../../utils/store.util";
import type { Voice } from "../voice/voice.module";

export type AuditionState = {
  playing: boolean;
  // where it is when paused, and where play last started (stop goes back)
  bar: number;
  from: number;
  // layers muted or soloed in the editor, as "kind:id"
  muted: string[];
  solo?: string;
};

export type AuditionHost = {
  // every layer, keyed "kind:id"
  layers(): [string, Voice][];
  barSeconds(): number;
  songBars(): number;
  // where a layer starts, in bars
  startOf(voice: Voice): number;
};

const Lead = 0.04;

export class Audition {
  store = new Store<AuditionState>({ playing: false, bar: 0, from: 0, muted: [] });
  private sources: AudioBufferSourceNode[] = [];
  private gains = new Map<string, GainNode>();
  private out?: GainNode;
  private startedAt = 0;
  private startBar = 0;
  private ending?: ReturnType<typeof setTimeout>;

  constructor(private host: AuditionHost) {}

  /** Bar under the playhead now */
  position() {
    const { playing, bar } = this.store.get();
    if (!playing) return bar;
    return this.startBar + (Audio.ctx.currentTime - this.startedAt) / this.host.barSeconds();
  }

  play(from = this.store.get().bar) {
    this.halt();
    Audio.create();
    const ctx = Audio.ctx;
    const barSeconds = this.host.barSeconds();
    const songBars = this.host.songBars();
    const bar = Math.max(0, Math.min(from, songBars - 0.01));
    const when = ctx.currentTime + Lead;

    this.out = new GainNode(ctx, { gain: 0.9 });
    this.out.connect(Audio.store.get().cueMode === "off" ? Audio.master : Audio.cue);
    for (const [key, voice] of this.host.layers()) {
      const buffer = voice.loaded.buffer;
      const start = this.host.startOf(voice);
      // seconds into the layer at the playhead; negative: it starts later
      const into = (bar - start) * barSeconds;
      if (into >= buffer.duration) continue;
      const gain = new GainNode(ctx, { gain: this.audible(key) ? voice.track.gain : 0 });
      gain.connect(this.out);
      this.gains.set(key, gain);
      const source = new AudioBufferSourceNode(ctx, { buffer });
      source.connect(gain);
      source.start(when + Math.max(0, -into), Math.max(0, into));
      this.sources.push(source);
    }

    this.startedAt = when;
    this.startBar = bar;
    this.store.set({ playing: true, bar, from: bar });
    this.ending = setTimeout(() => this.pause(songBars), ((songBars - bar) * barSeconds + Lead) * 1000);
  }

  /** Stops where it is; play goes on from there */
  pause(at = this.position()) {
    this.halt();
    this.store.set({ playing: false, bar: at });
  }

  /** Back to where play started, to try it again */
  stop() {
    this.halt();
    this.store.set({ playing: false, bar: this.store.get().from });
  }

  toggle() {
    if (this.store.get().playing) this.pause();
    else this.play();
  }

  /** Moves the playhead; playing goes on from the new bar */
  seek(bar: number) {
    const clamped = Math.max(0, Math.min(bar, this.host.songBars()));
    if (this.store.get().playing) this.play(clamped);
    else this.store.set({ bar: clamped, from: clamped });
  }

  toggleMute(key: string) {
    const muted = this.store.get().muted;
    this.store.set({ muted: muted.includes(key) ? muted.filter((item) => item !== key) : [...muted, key] });
    this.applyGains();
  }

  toggleSolo(key: string) {
    this.store.set({ solo: this.store.get().solo === key ? undefined : key });
    this.applyGains();
  }

  /** A pack was loaded or ejected: everything starts over */
  reset() {
    this.halt();
    this.store.set({ playing: false, bar: 0, from: 0, muted: [], solo: undefined });
  }

  /** A layer was removed from the pack */
  forget(key: string) {
    const { muted, solo } = this.store.get();
    this.store.set({ muted: muted.filter((item) => item !== key), solo: solo === key ? undefined : solo });
    if (this.store.get().playing) this.play(this.position());
  }

  private audible(key: string) {
    const { muted, solo } = this.store.get();
    return solo ? solo === key : !muted.includes(key);
  }

  private applyGains() {
    const ctx = Audio.ctx;
    for (const [key, voice] of this.host.layers()) {
      const gain = this.gains.get(key);
      gain?.gain.setTargetAtTime(this.audible(key) ? voice.track.gain : 0, ctx.currentTime, 0.01);
    }
  }

  private halt() {
    clearTimeout(this.ending);
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {}
      source.disconnect();
    }
    this.sources = [];
    for (const gain of this.gains.values()) gain.disconnect();
    this.gains.clear();
    this.out?.disconnect();
    this.out = undefined;
  }
}
