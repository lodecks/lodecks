import { useEngineContext, useStore } from "@/providers/engine.provider";

import { DeckId } from "@/common/constants/deck.constant";
import {
  DeckState,
  MixerState,
  TransportState
} from "@/common/types/deck.type";

import type { AutomixState } from "@/engine/modules/automix/automix.module";
import type { CueMode } from "@/engine/providers/audio.provider";
import type { HydraState } from "@/engine/providers/hydra.provider";
import type { VisualsState } from "@/engine/providers/visuals.provider";
import type {
  LiveState,
  StrudelState
} from "@/engine/providers/strudel.provider";

export const useEngine = () => useEngineContext().engine;

const TransportFallback: TransportState = {
  started: false,
  bpm: 120,
  quantize: "bar"
};

export const useTransport = () => {
  const engine = useEngine();
  return useStore(engine?.transport.store, TransportFallback);
};

const MixerFallback: MixerState & { ready: boolean; cueMode: CueMode } = {
  crossfade: 0.5,
  master: 0.9,
  instruments: 0.8,
  ready: false,
  cueMode: "off"
};

export const useMixer = () => {
  const engine = useEngine();
  return useStore(engine?.audio.store, MixerFallback);
};

const DeckFallbacks: Record<DeckId, DeckState> = {
  a: deckFallback("a"),
  b: deckFallback("b")
};

function deckFallback(id: DeckId): DeckState {
  return {
    id,
    loading: false,
    voices: {},
    stems: {},
    cues: {},
    origin: 0,
    volume: 0.9,
    eq: { low: 0, mid: 0, high: 0 },
    filter: 0,
    fx: {
      filter: false,
      echo: false,
      reverb: false,
      stutter: false,
      gate: false,
      brake: false
    },
    transpose: 0,
    prelisten: false,
    edited: false,
    infinite: true,
    jukeUnit: "bar",
    variety: "mid",
    jukebox: { status: "idle" }
  };
}

export const useDeck = (id: DeckId) => {
  const engine = useEngine();
  return useStore(engine?.decks[id].store, DeckFallbacks[id]);
};

const FocusFallback = { focus: "a" as DeckId };

export const useFocus = () => {
  const engine = useEngine();
  return useStore(engine?.store, FocusFallback).focus;
};

const StrudelFallback: StrudelState = {
  ready: false,
  pending: false,
  dirty: false,
  layers: [],
  quantized: true,
  suspended: false
};

export const useStrudel = () => {
  const engine = useEngine();
  return useStore(engine?.strudel.store, StrudelFallback);
};

const LiveFallback: LiveState = {
  chord: { root: 9, quality: "min", symbol: "Am", strudel: "Am" },
  key: { root: 9, scale: "minor", name: "Am" }
};

export const useLive = () => {
  const engine = useEngine();
  return useStore(engine?.strudel.live, LiveFallback);
};

const HydraFallback: HydraState = { ready: false, code: "" };

export const useHydra = () => {
  const engine = useEngine();
  return useStore(engine?.hydra.store, HydraFallback);
};

const VisualsFallback: VisualsState = {
  loaded: false,
  effects: [],
  gifs: [],
  active: "",
  kind: "hydra",
  code: "",
  edited: false
};

export const useVisuals = () => {
  const engine = useEngine();
  return useStore(engine?.visuals.store, VisualsFallback);
};

const AutomixFallback: AutomixState = { status: "idle", length: 16 };

export const useAutomix = () => {
  const engine = useEngine();
  return useStore(engine?.automix.store, AutomixFallback);
};
