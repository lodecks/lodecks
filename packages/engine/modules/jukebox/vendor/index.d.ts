// types for the vendored javascript
export type Quantum = {
  start: number;
  duration: number;
  confidence?: number;
  which?: number;
  indexInParent?: number;
  neighbors?: { dest: Quantum; distance: number }[];
};

export type Segment = Quantum & {
  timbre: number[];
  pitches: number[];
  loudness_start: number;
  loudness_max: number;
  confidence: number;
};

export type TrackAnalysis = {
  sections: Quantum[];
  bars: Quantum[];
  beats: Quantum[];
  tatums: Quantum[];
  segments: Segment[];
};
