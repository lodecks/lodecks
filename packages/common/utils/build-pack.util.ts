import { VoiceKeys } from "../constants/deck.constant";
import { Pack, PackInput, parsePack } from "../schemas/pack.schema";

/** What the analysis finds: analyse.py writes it, the browser importer builds it */
export type Analysis = {
  bpm: number;
  key: string;
  gridOffset: number;
  bars: number;
  sections: { name: string; bar: number; bars: number }[];
  stems: { id: string; file: string }[];
  voices: {
    id: string;
    name: string;
    file: string;
    type: "loop" | "oneshot" | "stem";
    bars?: number;
    bar?: number;
    score: number;
  }[];
};

export type BuildOptions = { title: string; artist?: string };

const Utility = new Set(["vocals", "riser", "impact"]);

/**
 * Turns the analysis into a pack: the full vocal on 0, the strongest
 * phrases on 1–7, riser and impact on 8 and 9, stems on Shift+1…, and
 * every other phrase in the library (no key) to be put on pads from the
 * pack editor. Cues sit at section starts.
 */
export const buildPack = (analysis: Analysis, options: BuildOptions): Pack => {
  const ranked = analysis.voices
    .filter((voice) => !Utility.has(voice.id))
    .sort((a, b) => b.score - a.score);
  const phrases = ranked.slice(0, 7);
  const library = ranked.slice(7).sort((a, b) => (a.bar ?? 0) - (b.bar ?? 0));
  const find = (id: string) => analysis.voices.find((voice) => voice.id === id);

  const slots: [string | undefined, Analysis["voices"][number] | undefined][] = [
    ...phrases.map((voice, index) => [VoiceKeys[index], voice] as [string, typeof voice]),
    ["8", find("riser")],
    ["9", find("impact")],
    ["0", find("vocals")],
    ...library.map((voice) => [undefined, voice] as [undefined, typeof voice])
  ];

  const voices: NonNullable<PackInput["voices"]> = slots
    .filter(([, voice]) => voice)
    .map(([key, voice]) => ({
      id: voice!.id,
      name: voice!.name,
      file: voice!.file,
      type: voice!.type,
      bars: voice!.bars,
      bar: voice!.bar ?? 0,
      key: key as (typeof VoiceKeys)[number] | undefined,
      // phrases cut from the same vocal take cut each other off
      choke: voice!.type === "loop" ? "vocal" : undefined,
      quantize: voice!.type === "oneshot" && (voice!.bars || 1) <= 1 ? "beat" : undefined,
      fxSend: voice!.type === "oneshot" ? 0.25 : 0
    }));

  const input: PackInput = {
    format: 1,
    title: options.title,
    artist: options.artist || "",
    bpm: analysis.bpm,
    key: analysis.key,
    gridOffset: analysis.gridOffset,
    bars: analysis.bars,
    sections: analysis.sections,
    cues: analysis.sections.slice(0, 8).map((section, index) => ({
      slot: index + 1,
      name: section.name,
      bar: section.bar
    })),
    voices,
    stems: analysis.stems.map((stem, index) => ({
      id: stem.id,
      name: stem.id[0].toUpperCase() + stem.id.slice(1),
      file: stem.file,
      type: "stem" as const,
      key: VoiceKeys[index]
    }))
  };

  return parsePack(input);
};
