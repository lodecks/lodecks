import {
  getSuperdoughAudioController,
  initAudio,
  setAudioContext
} from "@strudel/webaudio";

import { DeckId, DeckIds } from "@/common/constants/deck.constant";
import { MixerState } from "@/common/types/deck.type";

import { Store } from "../utils/store.util";

export type DeckBus = {
  // voices connect here
  input: GainNode;
  // signal sent into the deck fx rack
  send: GainNode;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  highpass: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  // the fx module patches itself between these two
  insertIn: GainNode;
  insertOut: GainNode;
  fader: GainNode;
  cross: GainNode;
  prelisten: GainNode;
  analyser: AnalyserNode;
};

export type CueMode = "off" | "split" | "multi";

const Ramp = 0.015;

class AudioProvider {
  ctx!: AudioContext;
  master!: GainNode;
  limiter!: DynamicsCompressorNode;
  instruments!: GainNode;
  cue!: GainNode;
  analyser!: AnalyserNode;
  decks!: Record<DeckId, DeckBus>;

  store = new Store<MixerState & { ready: boolean; cueMode: CueMode }>({
    crossfade: 0.5,
    master: 0.9,
    instruments: 0.8,
    ready: false,
    cueMode: "off"
  });

  private created = false;
  private routed?: AudioNode;
  private output?: AudioNode[];

  // builds the graph; the context stays suspended until resume()
  create() {
    if (this.created) return;
    this.created = true;

    const ctx = new AudioContext({ latencyHint: "interactive" });
    setAudioContext(ctx);
    this.ctx = ctx;

    this.master = new GainNode(ctx, { gain: this.store.get().master });
    this.limiter = new DynamicsCompressorNode(ctx, {
      threshold: -2,
      knee: 0,
      ratio: 20,
      attack: 0.002,
      release: 0.12
    });
    this.analyser = new AnalyserNode(ctx, {
      fftSize: 1024,
      smoothingTimeConstant: 0.6
    });
    this.instruments = new GainNode(ctx, {
      gain: this.store.get().instruments
    });
    this.cue = new GainNode(ctx, { gain: 1 });

    this.instruments.connect(this.master);
    this.master.connect(this.limiter);
    this.limiter.connect(this.analyser);

    this.decks = Object.fromEntries(
      DeckIds.map((id) => [id, this.createDeck()])
    ) as Record<DeckId, DeckBus>;

    this.setCrossfade(this.store.get().crossfade);
    this.setCueMode("off");
  }

  private createDeck(): DeckBus {
    const ctx = this.ctx;
    const bus: DeckBus = {
      input: new GainNode(ctx),
      send: new GainNode(ctx),
      low: new BiquadFilterNode(ctx, { type: "lowshelf", frequency: 220 }),
      mid: new BiquadFilterNode(ctx, { type: "peaking", frequency: 1100, Q: 0.7 }),
      high: new BiquadFilterNode(ctx, { type: "highshelf", frequency: 4200 }),
      highpass: new BiquadFilterNode(ctx, { type: "highpass", frequency: 10, Q: 0.9 }),
      lowpass: new BiquadFilterNode(ctx, { type: "lowpass", frequency: 22000, Q: 0.9 }),
      insertIn: new GainNode(ctx),
      insertOut: new GainNode(ctx),
      fader: new GainNode(ctx, { gain: 0.9 }),
      cross: new GainNode(ctx),
      prelisten: new GainNode(ctx, { gain: 0 }),
      analyser: new AnalyserNode(ctx, { fftSize: 256, smoothingTimeConstant: 0.5 })
    };

    bus.input
      .connect(bus.low)
      .connect(bus.mid)
      .connect(bus.high)
      .connect(bus.highpass)
      .connect(bus.lowpass)
      .connect(bus.insertIn);
    bus.insertIn.connect(bus.insertOut);
    bus.insertOut.connect(bus.fader).connect(bus.cross).connect(this.master);
    bus.insertOut.connect(bus.prelisten).connect(this.cue);
    bus.fader.connect(bus.analyser);

    return bus;
  }

  // must be called from a user gesture
  async resume() {
    this.create();
    if (this.ctx.state !== "running") await this.ctx.resume();
    if (!this.store.get().ready) {
      await initAudio({ maxPolyphony: 48 });
      this.store.set({ ready: true });
    }
    this.route();
  }

  // superdough plays straight to the speakers, bring it into our mixer instead
  route() {
    if (!this.created) return;
    const output = getSuperdoughAudioController().output;
    const gain = output?.destinationGain as GainNode | undefined;
    if (!gain || gain === this.routed) return;

    gain.disconnect();
    gain.connect(this.instruments);
    this.routed = gain;
    // superdough widens the destination to every channel of the device
    this.setCueMode(this.store.get().cueMode);
  }

  get channels() {
    return this.created ? this.ctx.destination.maxChannelCount : 2;
  }

  /**
   * off: master on 1/2. multi: master on 1/2, cue on 3/4 (needs an interface
   * with 4 outputs). split: cue on the left ear, master on the right.
   */
  setCueMode(mode: CueMode, manual = false) {
    const ctx = this.ctx;
    // chosen by hand: pre-listen will not switch it back off
    if (manual) this.autoCue = false;
    if (mode === "multi" && this.channels < 4) mode = "split";

    this.output?.forEach((node) => node.disconnect());
    this.limiter.disconnect();
    this.limiter.connect(this.analyser);
    this.cue.disconnect();
    this.output = [];

    if (mode === "off") {
      this.limiter.connect(ctx.destination);
    } else {
      const channels = mode === "multi" ? 4 : 2;
      ctx.destination.channelCount = Math.max(
        channels,
        ctx.destination.channelCount
      );
      const merger = new ChannelMergerNode(ctx, {
        numberOfInputs: ctx.destination.channelCount
      });
      merger.connect(ctx.destination);

      if (mode === "multi") {
        const master = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
        const cue = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
        this.limiter.connect(master);
        this.cue.connect(cue);
        master.connect(merger, 0, 0);
        master.connect(merger, 1, 1);
        cue.connect(merger, 0, 2);
        cue.connect(merger, 1, 3);
        this.output = [merger, master, cue];
      } else {
        const master = new GainNode(ctx, {
          channelCount: 1,
          channelCountMode: "explicit"
        });
        const cue = new GainNode(ctx, {
          channelCount: 1,
          channelCountMode: "explicit"
        });
        this.limiter.connect(master);
        this.cue.connect(cue);
        cue.connect(merger, 0, 0);
        master.connect(merger, 0, 1);
        this.output = [merger, master, cue];
      }
    }

    this.store.set({ cueMode: mode });
  }

  private ramp(param: AudioParam, value: number, time = Ramp) {
    param.setTargetAtTime(value, this.ctx.currentTime, time);
  }

  // equal power crossfade, 0 = deck a, 1 = deck b
  setCrossfade(value: number) {
    const crossfade = Math.max(0, Math.min(1, value));
    this.store.set({ crossfade });
    if (!this.created) return;

    this.ramp(this.decks.a.cross.gain, Math.cos((crossfade * Math.PI) / 2));
    this.ramp(this.decks.b.cross.gain, Math.sin((crossfade * Math.PI) / 2));
  }

  setMaster(value: number) {
    this.store.set({ master: value });
    if (this.created) this.ramp(this.master.gain, value);
  }

  setInstruments(value: number) {
    this.store.set({ instruments: value });
    if (this.created) this.ramp(this.instruments.gain, value);
  }

  setDeckVolume(id: DeckId, value: number) {
    this.ramp(this.decks[id].fader.gain, value);
  }

  // -1 kills the band, 0 is flat, 1 boosts by 6dB
  setDeckEq(id: DeckId, band: "low" | "mid" | "high", value: number) {
    const db = value < 0 ? value * 40 : value * 6;
    this.ramp(this.decks[id][band].gain, db);
  }

  // one knob filter: below 0 closes a lowpass, above 0 opens a highpass
  setDeckFilter(id: DeckId, value: number) {
    const bus = this.decks[id];
    const lowpass = value < 0 ? 22000 * Math.pow(180 / 22000, -value) : 22000;
    const highpass = value > 0 ? 10 * Math.pow(6000 / 10, value) : 10;

    this.ramp(bus.lowpass.frequency, lowpass, 0.03);
    this.ramp(bus.highpass.frequency, highpass, 0.03);
  }

  // decks sending to the headphones, and whether that turned the cue on
  private prelistening = new Set<DeckId>();
  private autoCue = false;

  /**
   * Sends a deck to the headphones. With no cue output set up yet this
   * turns one on (outputs 3/4, or split: cue left, main right), and turns
   * it back off once no deck is pre-listening, so the main mix is stereo
   * again. A cue mode chosen by hand is left alone.
   */
  setPrelisten(id: DeckId, on: boolean) {
    this.ramp(this.decks[id].prelisten.gain, on ? 1 : 0);
    if (on) this.prelistening.add(id);
    else this.prelistening.delete(id);

    if (on && this.store.get().cueMode === "off") {
      this.setCueMode(this.channels >= 4 ? "multi" : "split");
      this.autoCue = true;
    } else if (!this.prelistening.size && this.autoCue) {
      this.setCueMode("off");
      this.autoCue = false;
    }
  }

  // fades everything out and back, for when a set goes wrong
  panic() {
    if (!this.created) return;
    const now = this.ctx.currentTime;
    const level = this.store.get().master;

    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(0, now, 0.08);
    this.master.gain.setTargetAtTime(level, now + 0.6, 0.05);
  }
}

export const Audio = new AudioProvider();
