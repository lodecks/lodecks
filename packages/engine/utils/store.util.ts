type Listener = () => void;

/** Minimal observable state, readable from React with useSyncExternalStore */
export class Store<T extends object> {
  private listeners = new Set<Listener>();

  constructor(private state: T) {}

  get = () => this.state;

  set = (update: Partial<T> | ((state: T) => Partial<T>)) => {
    const partial = typeof update === "function" ? update(this.state) : update;
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((listener) => listener());
  };

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();

  emit(value: T) {
    this.listeners.forEach((listener) => listener(value));
  }

  on(listener: (value: T) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
