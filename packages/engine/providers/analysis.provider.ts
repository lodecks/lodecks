import { DeckId } from "@/common/constants/deck.constant";

import { Audio } from "./audio.provider";
import { Transport } from "./transport.provider";

export type Analysis = {
  // smoothed 0..1 energy: bass, low mid, high mid, air
  bands: [number, number, number, number];
  level: number;
  // 1 on a detected kick, decaying to 0
  kick: number;
  decks: Record<DeckId, number>;
  spectrum: Uint8Array<ArrayBuffer>;
  wave: Uint8Array<ArrayBuffer>;
};

// band edges in hz
const Edges = [20, 150, 800, 4000, 16000];

class AnalysisProvider {
  data: Analysis = {
    bands: [0, 0, 0, 0],
    level: 0,
    kick: 0,
    decks: { a: 0, b: 0 },
    spectrum: new Uint8Array(512),
    wave: new Uint8Array(1024)
  };

  private frame = -1;
  private bassAverage = 0;
  private deckWave = new Uint8Array(256);
  private users = 0;

  // analysers are only read while something on screen needs them
  retain() {
    this.users++;
    return () => {
      this.users--;
    };
  }

  /** Reads the analysers at most once per animation frame */
  update(frame: number) {
    if (frame === this.frame || !Audio.store.get().ready) return this.data;
    const elapsed = Math.min(0.1, Math.max(0.001, (frame - this.frame) / 1000));
    this.frame = frame;

    const data = this.data;
    Audio.analyser.getByteFrequencyData(data.spectrum);
    Audio.analyser.getByteTimeDomainData(data.wave);

    const binHz = Audio.ctx.sampleRate / Audio.analyser.fftSize;
    for (let band = 0; band < 4; band++) {
      const from = Math.max(1, Math.floor(Edges[band] / binHz));
      const to = Math.min(data.spectrum.length, Math.ceil(Edges[band + 1] / binHz));
      let sum = 0;
      for (let bin = from; bin < to; bin++) sum += data.spectrum[bin];
      const value = sum / Math.max(1, to - from) / 255;
      // fast attack, slower release
      data.bands[band] =
        value > data.bands[band]
          ? value
          : data.bands[band] + (value - data.bands[band]) * Math.min(1, elapsed * 12);
    }

    data.level = this.rms(data.wave);
    data.decks.a = this.deckLevel("a");
    data.decks.b = this.deckLevel("b");

    // a kick is bass energy jumping well above its running average
    const bass = data.bands[0];
    if (bass > 0.25 && bass > this.bassAverage * 1.35 && data.kick < 0.4) {
      data.kick = 1;
    } else {
      data.kick = Math.max(0, data.kick - elapsed * 6);
    }
    this.bassAverage += (bass - this.bassAverage) * Math.min(1, elapsed * 4);

    return data;
  }

  private rms(wave: Uint8Array<ArrayBuffer>) {
    let sum = 0;
    for (let i = 0; i < wave.length; i++) {
      const sample = (wave[i] - 128) / 128;
      sum += sample * sample;
    }
    return Math.sqrt(sum / wave.length);
  }

  private deckLevel(id: DeckId) {
    Audio.decks[id].analyser.getByteTimeDomainData(this.deckWave);
    return this.rms(this.deckWave) * Audio.decks[id].cross.gain.value;
  }

  private current() {
    return this.update(Math.floor(performance.now()));
  }

  // functions exposed to strudel and hydra code
  scope() {
    return {
      fft: (band = 0) => this.current().bands[Math.max(0, Math.min(3, band | 0))],
      level: () => this.current().level,
      kick: () => this.current().kick,
      // saw 0..1 over each beat, locked to the transport
      beat: () => Transport.position().phase,
      // current bar, with the fraction inside it
      bar: () => Transport.now(),
      xfade: () => Audio.store.get().crossfade,
      deck: {
        a: { level: () => this.current().decks.a },
        b: { level: () => this.current().decks.b }
      }
    };
  }
}

export const Analysis = new AnalysisProvider();
