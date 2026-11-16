import { DeckFx, EchoBeats, EchoTime } from "@/common/constants/fx.constant";

import { Audio, DeckBus } from "../../providers/audio.provider";
import { Transport } from "../../providers/transport.provider";

export type FxOptions = {
  echo: { time: EchoTime; feedback: number };
  reverb: { size: number };
  // stutter slice, in bars
  stutter: number;
  // gate step, in bars
  gate: number;
};

const Smooth = 0.01;
// gate and filter steps are scheduled this far ahead
const Horizon = 0.2;

const impulse = (ctx: BaseAudioContext, seconds: number) => {
  const length = Math.round(ctx.sampleRate * seconds);
  const buffer = new AudioBuffer({
    numberOfChannels: 2,
    length,
    sampleRate: ctx.sampleRate
  });
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
    }
  }
  return buffer;
};

/**
 * Per deck effects. Echo and reverb are fed by the voice sends all the time
 * and by "throws" while held; stutter, gate, brake and the filter sweep sit
 * between the deck filter and its fader. Everything engages and releases on
 * the transport grid.
 */
export class FxRack {
  options: FxOptions = {
    echo: { time: "1/8d", feedback: 0.45 },
    reverb: { size: 2.5 },
    stutter: 1 / 8,
    gate: 1 / 16
  };

  private dry: GainNode;
  private echo: DelayNode;
  private echoFeedback: GainNode;
  private echoFilter: BiquadFilterNode;
  private echoThrow: GainNode;
  private reverb: ConvolverNode;
  private reverbThrow: GainNode;
  private repeatIn: GainNode;
  private repeat: DelayNode;
  private repeatFeedback: GainNode;
  private repeatOut: GainNode;
  private gate: GainNode;
  private brake: DelayNode;
  private sweep: BiquadFilterNode;

  private active = new Set<DeckFx>();
  // gate / sweep scheduled up to this cycle
  private scheduled = 0;

  constructor(bus: DeckBus) {
    const ctx = Audio.ctx;

    this.sweep = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 22000, Q: 4 });
    this.brake = new DelayNode(ctx, { maxDelayTime: 4, delayTime: 0 });
    this.gate = new GainNode(ctx);
    this.dry = new GainNode(ctx);

    this.repeatIn = new GainNode(ctx, { gain: 0 });
    this.repeat = new DelayNode(ctx, { maxDelayTime: 2, delayTime: 0.1 });
    this.repeatFeedback = new GainNode(ctx, { gain: 0 });
    this.repeatOut = new GainNode(ctx, { gain: 0 });

    this.echo = new DelayNode(ctx, { maxDelayTime: 3, delayTime: 0.3 });
    this.echoFeedback = new GainNode(ctx, { gain: this.options.echo.feedback });
    this.echoFilter = new BiquadFilterNode(ctx, { type: "bandpass", frequency: 1600, Q: 0.5 });
    this.echoThrow = new GainNode(ctx, { gain: 0 });
    this.reverb = new ConvolverNode(ctx, { buffer: impulse(ctx, this.options.reverb.size) });
    this.reverbThrow = new GainNode(ctx, { gain: 0 });

    // insert chain: sweep -> brake -> gate -> (dry | repeat)
    bus.insertIn.disconnect();
    bus.insertIn.connect(this.sweep).connect(this.brake).connect(this.gate);
    this.gate.connect(this.dry).connect(bus.insertOut);
    this.gate.connect(this.repeatIn).connect(this.repeat);
    this.repeat.connect(this.repeatFeedback).connect(this.repeat);
    this.repeat.connect(this.repeatOut).connect(bus.insertOut);

    // sends: voice sends plus throws feed echo and reverb
    const sends = new GainNode(ctx);
    bus.send.connect(sends);
    this.gate.connect(this.echoThrow).connect(sends);
    sends.connect(this.echo);
    this.echo.connect(this.echoFilter).connect(this.echoFeedback).connect(this.echo);
    this.echo.connect(bus.fader);

    bus.send.connect(this.reverb);
    this.gate.connect(this.reverbThrow).connect(this.reverb);
    this.reverb.connect(bus.fader);

    this.retime();
    Transport.tempo.on(() => this.retime());
    Transport.tick.on((cycle) => this.tick(cycle));
  }

  isActive(fx: DeckFx) {
    return this.active.has(fx);
  }

  private beatSeconds() {
    return 60 / Transport.bpm;
  }

  private retime() {
    const ctx = Audio.ctx;
    const echo = EchoBeats[this.options.echo.time] * this.beatSeconds();
    this.echo.delayTime.setTargetAtTime(Math.min(2.9, echo), ctx.currentTime, 0.05);
  }

  setEcho(time: EchoTime, feedback = this.options.echo.feedback) {
    this.options.echo = { time, feedback };
    this.echoFeedback.gain.setTargetAtTime(feedback, Audio.ctx.currentTime, 0.02);
    this.retime();
  }

  setReverb(size: number) {
    this.options.reverb = { size };
    this.reverb.buffer = impulse(Audio.ctx, size);
  }

  /** When an effect engages: the next 16th, or now when the clock is stopped */
  private when() {
    return Transport.running
      ? Transport.timeAt(Transport.next("16th"))
      : Audio.ctx.currentTime;
  }

  private set(param: AudioParam, value: number, time: number, smooth = Smooth) {
    param.cancelScheduledValues(time);
    param.setTargetAtTime(value, time, smooth);
  }

  engage(fx: DeckFx) {
    if (this.active.has(fx)) return;
    this.active.add(fx);
    const time = this.when();

    switch (fx) {
      case "echo":
        this.set(this.echoThrow.gain, 1, time);
        break;
      case "reverb":
        this.set(this.reverbThrow.gain, 1.2, time);
        break;
      case "stutter": {
        // record one slice, then repeat it while the dry signal is muted
        const slice = this.options.stutter / Transport.cps;
        this.repeat.delayTime.setValueAtTime(Math.min(1.9, slice), time);
        this.repeatIn.gain.cancelScheduledValues(time);
        this.repeatIn.gain.setValueAtTime(1, time);
        this.repeatIn.gain.setValueAtTime(0, time + slice);
        this.repeatFeedback.gain.cancelScheduledValues(time);
        this.repeatFeedback.gain.setValueAtTime(0, time);
        this.repeatFeedback.gain.setValueAtTime(1, time + slice);
        this.repeatOut.gain.cancelScheduledValues(time);
        this.repeatOut.gain.setValueAtTime(0, time);
        this.repeatOut.gain.setValueAtTime(1, time + slice);
        this.dry.gain.cancelScheduledValues(time);
        this.dry.gain.setValueAtTime(1, time + slice - 0.002);
        this.dry.gain.linearRampToValueAtTime(0, time + slice);
        break;
      }
      case "brake": {
        // a delay growing at speed v plays at pitch 1 - v; ramp v to 1 over a bar
        const seconds = Math.min(3, 1 / Transport.cps);
        const steps = 32;
        this.brake.delayTime.cancelScheduledValues(time);
        this.brake.delayTime.setValueAtTime(0, time);
        const curve = new Float32Array(steps);
        for (let i = 0; i < steps; i++) {
          const t = (i / (steps - 1)) * seconds;
          curve[i] = (t * t) / (2 * seconds);
        }
        this.brake.delayTime.setValueCurveAtTime(curve, time, seconds);
        this.gate.gain.cancelScheduledValues(time);
        this.gate.gain.setValueAtTime(1, time);
        this.gate.gain.linearRampToValueAtTime(0, time + seconds);
        break;
      }
      case "gate":
      case "filter":
        this.scheduled = Transport.next("16th");
        break;
    }
  }

  release(fx: DeckFx) {
    if (!this.active.has(fx)) return;
    this.active.delete(fx);
    // effects let go on the beat so the deck comes back in time
    const time = Transport.running
      ? Transport.timeAt(Transport.next(fx === "brake" ? "beat" : "16th"))
      : Audio.ctx.currentTime;

    switch (fx) {
      case "echo":
        // the tail keeps ringing and dies out on its own
        this.set(this.echoThrow.gain, 0, time);
        break;
      case "reverb":
        this.set(this.reverbThrow.gain, 0, time);
        break;
      case "stutter":
        this.repeatIn.gain.cancelScheduledValues(time);
        this.repeatIn.gain.setValueAtTime(0, time);
        this.set(this.repeatFeedback.gain, 0, time, 0.002);
        this.set(this.repeatOut.gain, 0, time, 0.002);
        this.set(this.dry.gain, 1, time, 0.002);
        break;
      case "brake":
        this.brake.delayTime.cancelScheduledValues(time);
        this.brake.delayTime.setValueAtTime(0, time);
        this.set(this.gate.gain, 1, time, 0.005);
        break;
      case "gate":
        this.set(this.gate.gain, 1, time, 0.003);
        break;
      case "filter":
        this.set(this.sweep.frequency, 22000, time, 0.02);
        break;
    }
  }

  toggle(fx: DeckFx) {
    if (this.active.has(fx)) this.release(fx);
    else this.engage(fx);
  }

  releaseAll() {
    [...this.active].forEach((fx) => this.release(fx));
  }

  // gate and filter sweep follow the grid, a few steps at a time
  private tick(cycle: number) {
    const gate = this.active.has("gate");
    const filter = this.active.has("filter");
    if (!gate && !filter) return;

    const horizon = cycle + Horizon * Transport.cps;
    const step = gate ? this.options.gate : 1 / 16;
    let at = Math.max(this.scheduled, Math.ceil(cycle / step) * step);

    while (at < horizon) {
      const time = Transport.timeAt(at);
      const index = Math.round(at / step);

      if (gate) {
        const open = index % 2 === 0;
        this.gate.gain.setTargetAtTime(open ? 1 : 0, time, 0.003);
      }
      if (filter) {
        // a wobble across each beat
        const phase = (at * 4) % 1;
        const frequency = 300 * Math.pow(2, 5 * (0.5 + 0.5 * Math.cos(phase * 2 * Math.PI)));
        this.sweep.frequency.setTargetAtTime(frequency, time, 0.02);
      }
      at += step;
    }
    this.scheduled = at;
  }
}
