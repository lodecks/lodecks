import { z } from "zod";

export const JukeboxVersion = 1;

/**
 * Branch graph for one quantum size. Edge = [from, to, distance]: when the
 * song is about to play `from`, it may play `to` instead.
 */
export const JukeboxGraphSchema = z.object({
  count: z.number().int().min(0),
  lastBranchPoint: z.number().int(),
  edges: z.array(z.tuple([z.number().int(), z.number().int(), z.number()])),
  // per quantum, for drawing
  loudness: z.array(z.number()),
  hue: z.array(z.number())
});

export const JukeboxSchema = z.object({
  version: z.number().int(),
  bar: JukeboxGraphSchema,
  beat: JukeboxGraphSchema
});

export type JukeboxGraph = z.infer<typeof JukeboxGraphSchema>;
export type Jukebox = z.infer<typeof JukeboxSchema>;
export type JukeUnit = "bar" | "beat";
export const JukeUnitBars: Record<JukeUnit, number> = { bar: 1, beat: 0.25 };
