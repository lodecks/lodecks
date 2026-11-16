import { z } from "zod";

import { VoiceKeys } from "../constants/deck.constant";
import { Quantizes } from "../constants/quantize.constant";
import { JukeboxSchema } from "./jukebox.schema";

export const TrackTypes = ["loop", "oneshot", "stem"] as const;

const File = z
  .string()
  .min(1)
  .refine((v) => !v.startsWith("/") && !v.split("/").includes(".."), {
    message: "file must be a relative path inside the pack"
  });

const Id = z.string().regex(/^[a-z0-9_]+$/i, "id must be alphanumeric");

export const PackTrackSchema = z.object({
  id: Id,
  name: z.string(),
  file: File,
  type: z.enum(TrackTypes),
  // length in bars, required for loops so they can be phase locked
  bars: z.number().positive().optional(),
  // where the track sits in the song, in bars (stems and song-placed phrases)
  bar: z.number().min(0).default(0),
  key: z.enum(VoiceKeys).optional(),
  gain: z.number().min(0).max(4).default(1),
  quantize: z.enum(Quantizes).optional(),
  // tracks sharing a choke group stop each other
  choke: z.string().optional(),
  stretch: z.boolean().default(true),
  fxSend: z.number().min(0).max(1).default(0),
  color: z.string().optional(),
  // starred in the explorer
  favorite: z.boolean().default(false)
});

/**
 * A pack's manifest. Keys it doesn't list are dropped when a pack is read,
 * so fields of older packs (samples, instruments, patterns, visuals, fx)
 * are never written back.
 */
export const PackSchema = z.object({
  format: z.literal(1),
  title: z.string().min(1),
  artist: z.string().default(""),
  bpm: z.number().min(40).max(300),
  key: z.string().default("C"),
  timeSignature: z.tuple([z.number().int(), z.number().int()]).default([4, 4]),
  // seconds from the start of every stem to bar 0
  gridOffset: z.number().default(0),
  bars: z.number().positive().optional(),
  sections: z
    .array(
      z.object({ name: z.string(), bar: z.number().min(0), bars: z.number() })
    )
    .default([]),
  cues: z
    .array(
      z.object({
        slot: z.number().int().min(1).max(8),
        name: z.string().default(""),
        bar: z.number().min(0),
        color: z.string().optional()
      })
    )
    .default([]),
  voices: z.array(PackTrackSchema).default([]),
  stems: z.array(PackTrackSchema).default([]),
  // infinite jukebox branch graphs, computed on first load and saved
  jukebox: JukeboxSchema.optional()
});

export type Pack = z.infer<typeof PackSchema>;
export type PackInput = z.input<typeof PackSchema>;
export type PackTrack = z.infer<typeof PackTrackSchema>;
export type TrackType = (typeof TrackTypes)[number];

export const parsePack = (data: unknown): Pack => PackSchema.parse(data);

export const PackSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  bpm: z.number(),
  key: z.string(),
  voices: z.number(),
  stems: z.number(),
  size: z.number()
});
export type PackSummary = z.infer<typeof PackSummarySchema>;
