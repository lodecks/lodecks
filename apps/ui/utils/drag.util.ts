import { DragEvent } from "react";

export type DragTrack = { kind: "voices" | "stems"; id: string };

const Type = "application/x-lodecks-track";

export const startTrackDrag = (event: DragEvent, track: DragTrack) => {
  event.dataTransfer.setData(Type, JSON.stringify(track));
  event.dataTransfer.effectAllowed = "move";
};

export const isTrackDrag = (event: DragEvent) =>
  event.dataTransfer.types.includes(Type);

export const readTrackDrag = (event: DragEvent): DragTrack | undefined => {
  try {
    return JSON.parse(event.dataTransfer.getData(Type));
  } catch {
    return undefined;
  }
};
