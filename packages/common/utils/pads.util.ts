import { VoiceKey, VoiceKeys } from "../constants/deck.constant";
import { PackTrack } from "../schemas/pack.schema";

/**
 * Which track sits on which number key. Tracks with a `key` are on pads,
 * the rest stay in the library. A list where no track has a key (older
 * packs) fills the pads in order instead.
 */
export const padLayout = (tracks: PackTrack[]) => {
  const pads = new Map<VoiceKey, PackTrack>();
  const keyed = tracks.some((track) => track.key);

  if (keyed) {
    for (const track of tracks) {
      if (track.key && !pads.has(track.key)) pads.set(track.key, track);
    }
    return pads;
  }

  tracks.slice(0, VoiceKeys.length).forEach((track, index) => {
    pads.set(VoiceKeys[index], track);
  });
  return pads;
};

/**
 * Puts a track on a pad. The track that was there moves to the pad the
 * moved one came from (a swap), or back to the library. `key` undefined
 * takes the track off its pad.
 */
export const assignPad = (
  tracks: PackTrack[],
  id: string,
  key: VoiceKey | undefined
): PackTrack[] => {
  // make the implicit layout of an unkeyed pack explicit first
  const layout = padLayout(tracks);
  const keyOf = new Map<string, VoiceKey>();
  layout.forEach((track, pad) => keyOf.set(track.id, pad));

  const from = keyOf.get(id);
  const occupant = key ? layout.get(key) : undefined;

  return tracks.map((track) => {
    let next = keyOf.get(track.id);
    if (track.id === id) next = key;
    else if (occupant && track.id === occupant.id) next = from;
    return { ...track, key: next };
  });
};
