import type { TrackAnalysis } from "./index";
export default function calculateNearestNeighbors(
  track: { analysis: TrackAnalysis },
  type?: "beats" | "bars"
): { lastBranchPoint: number };
