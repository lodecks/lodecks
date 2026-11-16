import type { StretchNode } from "signalsmith-stretch";

import { Quantize } from "@/common/constants/quantize.constant";
import { Pack } from "@/common/schemas/pack.schema";
import { VoiceState } from "@/common/types/deck.type";
import { barSeconds, loopPosition } from "@/common/utils/quantize.util";

import { Audio, DeckBus } from "../../providers/audio.provider";
import { Stretch } from "../../providers/stretch.provider";
import { Transport } from "../../providers/transport.provider";
import { LoadedTrack } from "../pack/loader.module";

export type VoiceKind = "voices" | "stems";

// what a voice needs from the deck it belongs to
export type VoiceHost = {
  bus: DeckBus;
  pack: Pack;
  transpose: number;
  songBars: number;
  originAt(cycle: number): number;
  update(kind: VoiceKind, id: string, state: Partial<VoiceState>): void;
  state(kind: VoiceKind, id: string): VoiceState;
  choke(voice: Voice, cycle: number): void;
  onStart(voice: Voice, cycle: number): void;
};

type Source = {
  gain: GainNode;
  plain?: AudioBufferSourceNode;
  stretch?: StretchNode;
  // set when the source was ended before its stretch node arrived
  ended?: boolean;
  // its stretch node is on its way
  pending?: boolean;
  // the source it takes over from, ended once this one sounds
  replaces?: Source;
};

type Position = { offset: number; loop?: [number, number] };

const Fade = 0.006;
// how far ahead a stretch node that arrived late is started, so it starts clean
const StretchLead = 0.05;
// tempo differences below this play without the stretcher
const RateTolerance = 0.002;

export class Voice {
  private out: GainNode;
  private send: GainNode;
  private source?: Source;
  private startCycle?: number;
  private stopCycle?: number;
  // oneshots end on their own, at this audio time
  private endTime?: number;
  // where a oneshot was in its file at a known audio time
  private anchor?: { input: number; time: number; rate: number };

  constructor(
    private host: VoiceHost,
    readonly kind: VoiceKind,
    readonly loaded: LoadedTrack
  ) {
    const ctx = Audio.ctx;
    this.out = new GainNode(ctx, { gain: loaded.track.gain });
    this.send = new GainNode(ctx, { gain: loaded.track.fxSend });
    this.out.connect(host.bus.input);
    this.out.connect(this.send).connect(host.bus.send);
  }

  get track() {
    return this.loaded.track;
  }

  get id() {
    return this.track.id;
  }

  get state() {
    return this.host.state(this.kind, this.id);
  }

  get active() {
    return this.state.status !== "idle" && this.state.status !== "loading";
  }

  private get rate() {
    return Transport.bpm / this.host.pack.bpm;
  }

  private get stretched() {
    return (
      this.track.stretch &&
      (Math.abs(this.rate - 1) > RateTolerance || this.host.transpose !== 0)
    );
  }

  /** Where in the file the voice must be when the transport is at `cycle` */
  private position(cycle: number): Position {
    const { pack } = this.host;
    const bar = barSeconds(pack.bpm, pack.timeSignature[0]);
    const duration = this.loaded.buffer.duration;

    if (this.track.type === "loop") {
      const bars = Math.max(0.25, Math.round((duration / bar) * 16) / 16);
      return {
        offset: loopPosition(cycle, bars) * bar,
        loop: [0, duration]
      };
    }

    if (this.track.type === "stem") {
      const bars = this.host.songBars;
      const position = loopPosition(
        cycle - this.host.originAt(cycle) - this.track.bar,
        bars
      );
      return {
        offset: pack.gridOffset + position * bar,
        loop: [pack.gridOffset, pack.gridOffset + bars * bar]
      };
    }

    return { offset: 0 };
  }

  private wrap(offset: number, [start, end]: [number, number]) {
    const length = end - start;
    if (offset < end || length <= 0) return offset;
    return start + ((offset - start) % length);
  }

  /** Seconds into the file at `cycle`, for drawing the playhead */
  playhead(cycle: number) {
    if (this.state.status !== "playing" && this.state.status !== "stopping") {
      return undefined;
    }
    if (this.track.type === "oneshot") {
      const anchor = this.anchor;
      if (!anchor) return undefined;
      return anchor.input + (Transport.timeAt(cycle) - anchor.time) * anchor.rate;
    }
    return this.position(cycle).offset;
  }

  /**
   * Starts the audio at `time`. A stretched source needs a stretch node
   * first, which takes a moment: it starts when the node is there, at the
   * song's place by then, and `replaces` keeps playing until it does.
   */
  private begin(cycle: number, time: number, position = this.position(cycle), replaces?: Source) {
    const ctx = Audio.ctx;
    const rate = this.rate;
    const source: Source = { gain: new GainNode(ctx, { gain: 0 }) };
    const when = Math.max(time, ctx.currentTime);

    source.gain.connect(this.out);
    source.gain.gain.setValueAtTime(0, when);
    source.gain.gain.linearRampToValueAtTime(1, when + Fade);

    const plain = () => {
      const node = new AudioBufferSourceNode(ctx, {
        buffer: this.loaded.buffer,
        playbackRate: rate
      });
      if (position.loop) {
        node.loop = true;
        node.loopStart = position.loop[0];
        node.loopEnd = position.loop[1];
      }
      node.connect(source.gain);
      // a start in the past must skip what was missed to stay on the grid
      const late = Math.max(0, ctx.currentTime - time);
      const offset = position.offset + late * rate;
      node.start(
        Math.max(time, ctx.currentTime),
        position.loop ? this.wrap(offset, position.loop) : offset
      );
      source.plain = node;
    };

    if (this.stretched) {
      source.pending = true;
      source.replaces = replaces;
      const samples = this.loaded.buffer.getChannelData(0).slice();
      Stretch.acquire().then((node) => {
        source.pending = false;
        if (source.ended) return Stretch.release(node);
        if (Stretch.broken.has(node)) {
          Stretch.release(node);
          this.handOver(source, time);
          return plain();
        }
        source.stretch = node;
        // transferred, not copied: cloning a whole stem into the audio
        // thread stalls it long enough to drop audio
        node.addBuffers([samples], [samples.buffer]);
        node.connect(source.gain);
        // the node may come after `time`: start where the song is by then,
        // with the pitch and rate as they are by then (eg. mid glide)
        const at = Math.max(time, ctx.currentTime + StretchLead);
        let place = position;
        if (at > time) {
          place =
            this.track.type === "oneshot"
              ? { offset: position.offset + (at - time) * rate }
              : this.position(Transport.cycleAt(at));
          source.gain.gain.cancelScheduledValues(0);
          source.gain.gain.setValueAtTime(0, at);
          source.gain.gain.linearRampToValueAtTime(1, at + Fade);
        }
        node.schedule({
          output: at,
          outputTime: at,
          active: true,
          input: place.offset,
          rate: this.rate,
          semitones: this.host.transpose,
          loopStart: place.loop?.[0] ?? 0,
          loopEnd: place.loop?.[1] ?? 0
        });
        this.handOver(source, at);
      });
    } else {
      plain();
      this.end(replaces, time);
    }

    if (this.track.type === "oneshot") {
      this.anchor = { input: position.offset, time, rate };
      this.endTime =
        time + (this.loaded.buffer.duration - position.offset) / rate;
    }

    return source;
  }

  /** Ends the source a new one took over from, now that the new one sounds */
  private handOver(source: Source, time: number) {
    const replaced = source.replaces;
    source.replaces = undefined;
    this.end(replaced, time);
  }

  private end(source: Source | undefined, time: number) {
    if (!source) return;
    const ctx = Audio.ctx;
    const when = Math.max(time, ctx.currentTime);
    // ended before its stretch node came: what it was taking over goes too
    this.handOver(source, time);

    source.ended = true;
    source.gain.gain.cancelScheduledValues(when);
    source.gain.gain.setValueAtTime(source.gain.gain.value, when);
    source.gain.gain.linearRampToValueAtTime(0, when + Fade);
    source.plain?.stop(when + Fade * 2);
    source.stretch?.schedule({
      output: when + Fade * 2,
      outputTime: when + Fade * 2,
      active: false
    });

    setTimeout(
      () => {
        source.gain.disconnect();
        source.plain?.disconnect();
        if (source.stretch) Stretch.release(source.stretch);
      },
      (when - ctx.currentTime) * 1000 + 120
    );
  }

  /** Starts at `cycle`, anything in the same choke group stops there */
  start(cycle: number) {
    if (this.source) this.end(this.source, Transport.timeAt(cycle));

    this.host.onStart(this, cycle);
    this.host.choke(this, cycle);
    this.startCycle = cycle;
    this.stopCycle = undefined;
    this.endTime = undefined;
    this.source = this.begin(cycle, Transport.timeAt(cycle));
    this.host.update(this.kind, this.id, { status: "armed", at: cycle });
  }

  stop(cycle?: number) {
    if (!this.active) return;

    if (cycle === undefined || this.state.status === "armed") {
      this.end(this.source, Audio.ctx.currentTime);
      this.reset();
      return;
    }

    this.stopCycle = cycle;
    this.end(this.source, Transport.timeAt(cycle));
    this.source = undefined;
    this.host.update(this.kind, this.id, { status: "stopping", at: cycle });
  }

  private reset() {
    this.source = undefined;
    this.startCycle = this.stopCycle = this.endTime = this.anchor = undefined;
    this.host.update(this.kind, this.id, { status: "idle", at: undefined });
  }

  /** Pad press: loops and stems toggle, oneshots fire again */
  press(quantize: Quantize) {
    const status = this.state.status;
    if (status === "loading" || status === "stopping") return;

    if (status === "armed") return this.stop();
    if (status === "playing" && this.track.type !== "oneshot") {
      // a stop never waits longer than a bar
      return this.stop(Transport.next(quantize === "phrase" ? "bar" : quantize));
    }

    this.start(Transport.next(this.track.quantize || quantize));
  }

  /** Follows the transport from one tick to the next */
  tick(cycle: number) {
    const status = this.state.status;

    if (status === "armed" && cycle >= this.startCycle!) {
      this.host.update(this.kind, this.id, { status: "playing", at: undefined });
    } else if (status === "stopping" && cycle >= this.stopCycle!) {
      this.reset();
    } else if (
      status === "playing" &&
      this.endTime !== undefined &&
      Audio.ctx.currentTime >= this.endTime
    ) {
      this.end(this.source, Audio.ctx.currentTime);
      this.reset();
    }
  }

  /**
   * Moves to where the song is at `time` with a crossfade: the new audio
   * starts exactly on time, so the downbeat keeps its attack, while the old
   * audio keeps ringing and fades out over `fade` seconds. Smoother than
   * `resync` for jumps. Plain playback only: it shares the decoded buffer,
   * so overlapping costs nothing. Stretched stems seek instead.
   */
  crossfade(time: number, fade: number) {
    const source = this.source;
    if (
      !source ||
      fade <= 0 ||
      this.state.status !== "playing" ||
      this.track.type === "oneshot" ||
      // a stretched stem seeks inside its own stretcher, which smooths the
      // seek itself; a second stretcher would mean loading the whole stem again
      this.stretched ||
      !!source.stretch
    ) {
      return this.resync(time);
    }

    const cycle = Transport.cycleAt(time);
    this.source = this.begin(cycle, time, this.position(cycle));
    this.fadeOut(source, time, fade);
  }

  // equal power fade, so the overlap does not dip or bulge in level
  private fadeOut(source: Source, time: number, fade: number) {
    const ctx = Audio.ctx;
    const when = Math.max(time, ctx.currentTime + 0.005);
    const gain = source.gain.gain;
    const steps = 24;
    const curve = new Float32Array(steps);
    for (let i = 0; i < steps; i++) curve[i] = Math.cos((i / (steps - 1)) * (Math.PI / 2));

    source.ended = true;
    gain.cancelScheduledValues(when);
    gain.setValueAtTime(1, when);
    gain.setValueCurveAtTime(curve, when, fade);
    source.plain?.stop(when + fade + 0.01);
    source.stretch?.schedule({
      output: when + fade + 0.01,
      outputTime: when + fade + 0.01,
      active: false
    });

    setTimeout(
      () => {
        source.gain.disconnect();
        source.plain?.disconnect();
        if (source.stretch) Stretch.release(source.stretch);
      },
      (when - ctx.currentTime + fade) * 1000 + 150
    );
  }

  /** Level (rms) of the track around a song position, for judging a seam */
  levelAt(songBar: number, from: number, to: number) {
    const pack = this.host.pack;
    const bar = (60 / pack.bpm) * pack.timeSignature[0];
    const data = this.loaded.buffer.getChannelData(0);
    const rate = this.loaded.buffer.sampleRate;
    const zero = this.track.type === "stem" ? pack.gridOffset : 0;
    const center = (zero + (songBar - this.track.bar) * bar) * rate;
    const start = Math.max(0, Math.floor(center + from * rate));
    const end = Math.min(data.length, Math.floor(center + to * rate));
    if (end <= start) return 0;

    let sum = 0;
    let count = 0;
    for (let i = start; i < end; i += 4) {
      sum += data[i] * data[i];
      count++;
    }
    return Math.sqrt(sum / count) * this.track.gain;
  }

  /**
   * Puts the voice back on the grid at `time`, after the tempo,
   * the song position or the transposition changed.
   */
  resync(time: number) {
    const source = this.source;
    if (!source || this.state.status === "stopping") return;

    const cycle = Transport.cycleAt(time);
    const rate = this.rate;

    if (this.state.status === "armed") {
      // not audible yet, schedule it again against the new clock
      this.end(source, Audio.ctx.currentTime);
      this.source = this.begin(this.startCycle!, Transport.timeAt(this.startCycle!));
      return;
    }

    let position: Position;
    if (this.track.type === "oneshot" && this.anchor) {
      const input =
        this.anchor.input + (time - this.anchor.time) * this.anchor.rate;
      position = { offset: Math.max(0, input) };
    } else {
      position = this.position(cycle);
    }

    // a stretch node on its way reads the newest pitch and place itself
    if (source.pending && this.stretched) return;

    if (source.stretch && this.stretched) {
      source.stretch.schedule({
        output: time,
        outputTime: time,
        active: true,
        input: position.offset,
        rate,
        semitones: this.host.transpose,
        loopStart: position.loop?.[0] ?? 0,
        loopEnd: position.loop?.[1] ?? 0
      });
      if (this.track.type === "oneshot") {
        this.anchor = { input: position.offset, time, rate };
        this.endTime =
          time + (this.loaded.buffer.duration - position.offset) / rate;
      }
      return;
    }

    // switching between plain and stretched playback, or moving a plain
    // source: the old one plays on until the new one sounds
    this.source = this.begin(cycle, time, position, source);
  }

  setGain(gain: number) {
    this.host.update(this.kind, this.id, { gain });
    this.applyGain();
  }

  setMuted(muted: boolean) {
    this.host.update(this.kind, this.id, { muted });
    this.applyGain();
  }

  setSend(fxSend: number) {
    this.host.update(this.kind, this.id, { fxSend });
    this.send.gain.setTargetAtTime(fxSend, Audio.ctx.currentTime, 0.02);
  }

  /** Re-reads gain and send after the track was edited */
  refresh() {
    this.applyGain();
    this.send.gain.setTargetAtTime(
      this.state.fxSend,
      Audio.ctx.currentTime,
      0.02
    );
  }

  private applyGain() {
    const { gain, muted } = this.state;
    this.out.gain.setTargetAtTime(
      muted ? 0 : gain * this.track.gain,
      Audio.ctx.currentTime,
      0.015
    );
  }

  dispose() {
    this.end(this.source, Audio.ctx.currentTime);
    this.source = undefined;
    setTimeout(() => {
      this.out.disconnect();
      this.send.disconnect();
    }, 200);
  }
}
