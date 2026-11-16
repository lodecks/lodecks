// the strudel packages ship without types
declare module "@strudel/core";
declare module "@strudel/mini";
declare module "@strudel/tonal";
declare module "@strudel/webaudio";
declare module "@strudel/transpiler";
declare module "@strudel/draw";
declare module "hydra-synth";

declare module "signalsmith-stretch" {
  export type StretchSchedule = {
    output?: number;
    outputTime?: number;
    active?: boolean;
    input?: number;
    rate?: number;
    semitones?: number;
    tonalityHz?: number;
    formantSemitones?: number;
    formantCompensation?: boolean;
    formantBaseHz?: number;
    loopStart?: number;
    loopEnd?: number;
  };

  export type StretchNode = AudioWorkletNode & {
    inputTime: number;
    schedule(change: StretchSchedule): Promise<unknown>;
    start(when?: number): Promise<unknown>;
    stop(when?: number): Promise<unknown>;
    // the optional second argument is a transfer list for postMessage
    addBuffers(buffers: Float32Array[], transfer?: Transferable[]): Promise<number>;
    dropBuffers(toSeconds?: number): Promise<unknown>;
    latency(): Promise<number>;
    configure(options: {
      blockMs?: number | null;
      intervalMs?: number;
      splitComputation?: boolean;
      preset?: "default" | "cheaper";
    }): Promise<unknown>;
    setUpdateInterval(seconds: number, callback?: (time: number) => void): void;
  };

  const SignalsmithStretch: (
    context: BaseAudioContext,
    options?: AudioWorkletNodeOptions
  ) => Promise<StretchNode>;

  export default SignalsmithStretch;
}

// assets bundled by vite, imported as urls
declare module "*?url" {
  const url: string;
  export default url;
}
