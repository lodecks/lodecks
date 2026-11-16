export const Quantizes = ["off", "16th", "beat", "bar", "phrase"] as const;
export type Quantize = (typeof Quantizes)[number];

// length of each quantize step, in cycles (1 cycle = 1 bar)
export const QuantizeCycles: Record<Quantize, number> = {
  off: 0,
  "16th": 1 / 16,
  beat: 1 / 4,
  bar: 1,
  phrase: 4
};

export const QuantizeLabels: Record<Quantize, string> = {
  off: "off",
  "16th": "1/16",
  beat: "beat",
  bar: "bar",
  phrase: "4 bars"
};

export const BeatsPerBar = 4;
