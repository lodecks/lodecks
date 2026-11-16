export const DeckIds = ["a", "b"] as const;
export type DeckId = (typeof DeckIds)[number];

export const VoiceKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;
export type VoiceKey = (typeof VoiceKeys)[number];

export const PackExtension = ".lopack";
// what packs were called before; still opened, renamed when found
export const PackManifest = "pack.json";
