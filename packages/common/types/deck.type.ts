import { DeckId } from "../constants/deck.constant";
import { DeckFx } from "../constants/fx.constant";
import { Quantize } from "../constants/quantize.constant";
import { JukeUnit } from "../schemas/jukebox.schema";
import { Pack } from "../schemas/pack.schema";

export type VoiceStatus = "idle" | "loading" | "armed" | "playing" | "stopping";

export type VoiceState = {
  id: string;
  status: VoiceStatus;
  // cycle the pending start / stop lands on
  at?: number;
  muted: boolean;
  gain: number;
  fxSend: number;
};

export type DeckLoop = { start: number; bars: number; active: boolean };

export type DeckState = {
  id: DeckId;
  pack?: Pack;
  packId?: string;
  loading: boolean;
  error?: string;
  voices: Record<string, VoiceState>;
  stems: Record<string, VoiceState>;
  cues: Record<number, { bar: number; name: string }>;
  loop?: DeckLoop;
  // song position in bars = transport cycle - origin
  origin: number;
  volume: number;
  eq: { low: number; mid: number; high: number };
  filter: number;
  fx: Record<DeckFx, boolean>;
  transpose: number;
  prelisten: boolean;
  // tracks were edited in the explorer and not saved into the pack yet
  edited: boolean;
  // track being previewed in the headphones
  previewing?: string;
  // infinite jukebox: the song branches between similar bars / beats
  infinite: boolean;
  jukeUnit: JukeUnit;
  variety: "low" | "mid" | "high";
  jukebox: JukeboxState;
};

export type JukeboxState = {
  status: "idle" | "analysing" | "ready" | "failed" | "unavailable";
  arcs?: number;
  // analysis time, when it ran in this session
  ms?: number;
  error?: string;
  // the last branch taken: quantum indexes and the cycle it landed on
  lastJump?: { from: number; to: number; at: number; seam?: number };
  // a jump was requested for the next boundary
  forced?: boolean;
};

export type TransportState = {
  started: boolean;
  bpm: number;
  quantize: Quantize;
};

export type MixerState = {
  crossfade: number;
  master: number;
  instruments: number;
};
