/**
 * Picks where to leave one song and where to enter the next so the blend
 * sounds right: on phrase starts, without two vocals on top of each other,
 * with drums carrying the beat and with similar energy on both sides.
 */

export type Section = { name: string; bar: number; bars: number };

/** Per bar 0..1 levels of a song's layers */
export type Profile = {
  bars: number;
  vocals: number[];
  drums: number[];
  bass: number[];
  energy: number[];
  sections: Section[];
};

export type Exit = {
  // bar the blend starts on in the outgoing song
  bar: number;
  // a jukebox arc taken first to get there: at bar `from`, play `to`
  via?: { from: number; to: number };
  // bars from now until the blend starts
  wait: number;
};

export type MixPlan = {
  exit: Exit;
  // bar the incoming song starts on
  entry: number;
  length: number;
  score: number;
  reasons: string[];
};

export type PlanOptions = {
  // where the outgoing song is now, in bars
  position: number;
  // blend length in bars, a multiple of 4
  length: number;
  // how far ahead to look for an exit, in bars
  lookahead?: number;
  // jukebox arcs of the outgoing song, in bars: [from, to]
  arcs?: [number, number][];
  // bars of notice before the blend can start
  lead?: number;
  // the incoming song enters on this bar (eg. a cue), instead of the best one
  entry?: number;
};

const Phrase = 4;

const mean = (values: number[], from: number, length: number) => {
  let sum = 0;
  let count = 0;
  for (let i = Math.max(0, from); i < Math.min(values.length, from + length); i++) {
    sum += values[i] || 0;
    count++;
  }
  return count ? sum / count : 0;
};

const isSectionStart = (profile: Profile, bar: number) =>
  profile.sections.some((section) => section.bar === bar);

const sectionAt = (profile: Profile, bar: number) =>
  profile.sections.find((section) => section.bar <= bar && bar < section.bar + section.bars);

/** Phrase starts at or after `bar` */
const nextPhrase = (bar: number) => Math.ceil(bar / Phrase - 1e-9) * Phrase;

/**
 * Vocals of both songs sounding at once, weighted by the crossfade: the old
 * song fades out while the new one fades in. 0 = never together.
 */
export const vocalClash = (from: Profile, exit: number, to: Profile, entry: number, length: number) => {
  let clash = 0;
  for (let k = 0; k < length; k++) {
    const t = (k + 0.5) / length;
    const outgoing = (from.vocals[exit + k] || 0) * Math.cos((t * Math.PI) / 2);
    const incoming = (to.vocals[entry + k] || 0) * Math.sin((t * Math.PI) / 2);
    clash += outgoing * incoming;
  }
  return clash / length;
};

/** Lower is better: how fit a bar is to start leaving the song from */
export const exitCost = (profile: Profile, bar: number, length: number) => {
  // the old song is loudest early in the blend, so its vocals count most there
  const vocals = mean(profile.vocals, bar, length / 2) + 0.4 * mean(profile.vocals, bar + length / 2, length / 2);
  const drums = mean(profile.drums, bar, length);
  // rising into a drop is a bad moment to leave
  const rise = Math.max(0, mean(profile.energy, bar, length) - mean(profile.energy, bar - length, length));
  const section = sectionAt(profile, bar)?.name || "";

  return (
    vocals * 1.2 +
    Math.max(0, 0.3 - drums) * 2 +
    rise * 0.8 -
    (isSectionStart(profile, bar) ? 0.15 : 0) -
    (/outro|break/.test(section) ? 0.2 : 0)
  );
};

/** Lower is better: how fit a bar is to bring the next song in on */
export const entryCost = (profile: Profile, bar: number, length: number) => {
  // the new song is loudest late in the blend
  const vocals = 0.4 * mean(profile.vocals, bar, length / 2) + mean(profile.vocals, bar + length / 2, length / 2);
  const drums = mean(profile.drums, bar, length / 2);
  const section = sectionAt(profile, bar)?.name || "";

  return (
    vocals * 1.2 +
    Math.max(0, 0.3 - drums) * 1.5 -
    (isSectionStart(profile, bar) ? 0.1 : 0) -
    (bar === 0 || /intro|break/.test(section) ? 0.2 : 0)
  );
};

/** Exits the outgoing song can reach: straight ahead, or after one arc */
export const exitCandidates = (profile: Profile, options: PlanOptions): Exit[] => {
  const { position, length, lookahead = 32, arcs = [], lead = 2 } = options;
  const exits: Exit[] = [];
  const fits = (bar: number) => bar + length <= profile.bars;

  for (let bar = nextPhrase(position + lead); bar <= position + lookahead; bar += Phrase) {
    if (fits(bar)) exits.push({ bar, wait: bar - position });
  }

  for (const [from, to] of arcs) {
    const ahead = from - position;
    if (ahead < lead || ahead > 8) continue;
    for (let bar = nextPhrase(to); bar <= to + 16; bar += Phrase) {
      if (fits(bar)) exits.push({ bar, via: { from, to }, wait: ahead + (bar - to) });
    }
  }

  return exits;
};

/** The best exit / entry pair, or undefined when nothing fits */
export const planTransition = (from: Profile, to: Profile, options: PlanOptions): MixPlan | undefined => {
  const { length } = options;
  const exits = exitCandidates(from, options);
  let best: MixPlan | undefined;

  for (const exit of exits) {
    const leaving = exitCost(from, exit.bar, length);
    const energyOut = mean(from.energy, exit.bar, length);

    const entries =
      options.entry !== undefined
        ? [Math.max(0, Math.min(Math.floor(options.entry), Math.max(0, to.bars - 1)))]
        : Array.from({ length: Math.max(0, Math.floor((to.bars - length) / Phrase) + 1) }, (_, index) => index * Phrase);
    for (const entry of entries) {
      const entering = entryCost(to, entry, length);
      const clash = vocalClash(from, exit.bar, to, entry, length);
      const energy = Math.abs(energyOut - mean(to.energy, entry, length));
      // a short wait is nice; a jump to get there has to be worth it
      const score = leaving + entering + clash * 3 + energy * 0.6 + exit.wait * 0.01 + (exit.via ? 0.2 : 0);

      if (!best || score < best.score) {
        best = { exit, entry, length, score, reasons: [] };
      }
    }
  }

  if (best) {
    const reasons = best.reasons;
    const clash = vocalClash(from, best.exit.bar, to, best.entry, length);
    reasons.push(clash < 0.05 ? "vocals don't overlap" : "some vocal overlap");
    if (isSectionStart(from, best.exit.bar)) reasons.push(`leaves at ${sectionAt(from, best.exit.bar)?.name}`);
    const entrySection = sectionAt(to, best.entry)?.name;
    if (best.entry === 0) reasons.push("enters at the top");
    else if (entrySection) reasons.push(`enters at ${entrySection}`);
    if (best.exit.via) reasons.push(`jumps ${best.exit.via.from + 1}→${best.exit.via.to + 1} first`);
  }
  return best;
};
