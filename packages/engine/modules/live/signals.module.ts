/**
 * Live values: anything that can be read every frame. The music (kick,
 * fft…), generators (lfo, ramp) and the inline controls are signals; a
 * setter given a signal keeps following it.
 */
export class Signal {
  constructor(readonly read: () => number) {}

  mul(value: number | Signal) {
    const other = toSignal(value);
    return new Signal(() => this.read() * other.read());
  }

  add(value: number | Signal) {
    const other = toSignal(value);
    return new Signal(() => this.read() + other.read());
  }

  /** Maps 0…1 onto min…max */
  range(min: number, max: number) {
    return new Signal(() => min + (max - min) * this.read());
  }

  /** Smooths changes, `amount` 0 (none) … 1 (frozen) */
  smooth(amount = 0.8) {
    let value: number | undefined;
    return new Signal(() => {
      const next = this.read();
      value = value === undefined ? next : value + (next - value) * (1 - Math.min(0.99, amount));
      return value;
    });
  }

  valueOf() {
    return this.read();
  }

  toString() {
    return `~${Math.round(this.read() * 1000) / 1000}`;
  }
}

export const isSignal = (value: unknown): value is Signal => value instanceof Signal;

export const toSignal = (value: number | Signal) =>
  isSignal(value) ? value : new Signal(() => Number(value));

export const Shapes = ["sine", "tri", "saw", "square"] as const;
export type Shape = (typeof Shapes)[number];

/** One cycle of a shape at phase 0…1, as 0…1 */
export const shape = (kind: Shape, phase: number) => {
  const p = phase - Math.floor(phase);
  switch (kind) {
    case "tri":
      return 1 - Math.abs(p * 2 - 1);
    case "saw":
      return p;
    case "square":
      return p < 0.5 ? 1 : 0;
    default:
      return 0.5 - 0.5 * Math.cos(p * Math.PI * 2);
  }
};

/** Swings between min and max once every `bars`, on the clock */
export const lfo = (clock: () => number, bars: number, min = 0, max = 1, kind: Shape = "sine") =>
  new Signal(() => min + (max - min) * shape(kind, clock() / Math.max(1e-3, bars)));

/** Goes from `from` to `to` over `bars` from now, then stays */
export const ramp = (clock: () => number, bars: number, from: number, to: number) => {
  const start = clock();
  return new Signal(() => {
    const progress = bars <= 0 ? 1 : Math.min(1, Math.max(0, (clock() - start) / bars));
    return from + (to - from) * progress;
  });
};

type Binding = { signal: Signal; apply: (value: number) => void; last?: number };

/**
 * Keeps parameters following their signals: one binding per parameter, a
 * plain value given to the same parameter ends it.
 */
export class Binder {
  private bindings = new Map<string, Binding>();

  get size() {
    return this.bindings.size;
  }

  has(key: string) {
    return this.bindings.has(key);
  }

  /** Applies `value` now; a signal stays bound and is read every tick */
  set(key: string, value: number | Signal, apply: (value: number) => void) {
    if (isSignal(value)) {
      const binding: Binding = { signal: value, apply };
      this.bindings.set(key, binding);
      this.apply(binding);
      return;
    }
    this.bindings.delete(key);
    apply(Number(value));
  }

  clear(key?: string) {
    if (key) this.bindings.delete(key);
    else this.bindings.clear();
  }

  private apply(binding: Binding) {
    let value: number;
    try {
      value = binding.signal.read();
    } catch {
      return;
    }
    if (!Number.isFinite(value)) return;
    // small changes are not worth an audio param ramp
    if (binding.last !== undefined && Math.abs(value - binding.last) < 1e-4) return;
    binding.last = value;
    binding.apply(value);
  }

  tick() {
    for (const binding of this.bindings.values()) this.apply(binding);
  }
}
