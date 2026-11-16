export const DeckFxs = [
  "filter",
  "echo",
  "reverb",
  "stutter",
  "gate",
  "brake"
] as const;
export type DeckFx = (typeof DeckFxs)[number];

export const EchoTimes = ["1/4", "1/8", "1/8d", "1/16"] as const;
export type EchoTime = (typeof EchoTimes)[number];

// echo time in beats
export const EchoBeats: Record<EchoTime, number> = {
  "1/4": 1,
  "1/8": 0.5,
  "1/8d": 0.75,
  "1/16": 0.25
};

export const LoopBars = [0.25, 0.5, 1, 2, 4, 8, 16] as const;
export const HotCueSlots = 8;
