import { describe, expect, test } from "bun:test";

import { PackTrack, PackTrackSchema } from "@/common/schemas/pack.schema";
import { assignPad, padLayout } from "@/common/utils/pads.util";

const track = (id: string, key?: string) =>
  PackTrackSchema.parse({ id, name: id, file: `${id}.wav`, type: "loop", key });

const keys = (tracks: PackTrack[]) =>
  Object.fromEntries(tracks.map((item) => [item.id, item.key ?? "-"]));

describe("padLayout", () => {
  test("keyed tracks only, the rest stay in the library", () => {
    const layout = padLayout([track("a", "1"), track("b"), track("c", "3")]);
    expect([...layout].map(([key, item]) => `${key}:${item.id}`)).toEqual(["1:a", "3:c"]);
  });

  test("a pack without any key fills the pads in order", () => {
    const layout = padLayout([track("a"), track("b")]);
    expect(layout.get("1")?.id).toBe("a");
    expect(layout.get("2")?.id).toBe("b");
  });
});

describe("assignPad", () => {
  const tracks = [track("a", "1"), track("b", "2"), track("c")];

  test("library track onto an empty pad", () => {
    expect(keys(assignPad(tracks, "c", "5"))).toEqual({ a: "1", b: "2", c: "5" });
  });

  test("onto a taken pad swaps the two", () => {
    expect(keys(assignPad(tracks, "a", "2"))).toEqual({ a: "2", b: "1", c: "-" });
  });

  test("library track onto a taken pad sends the occupant to the library", () => {
    expect(keys(assignPad(tracks, "c", "1"))).toEqual({ a: "-", b: "2", c: "1" });
  });

  test("off its pad", () => {
    expect(keys(assignPad(tracks, "b", undefined))).toEqual({ a: "1", b: "-", c: "-" });
  });

  test("an unkeyed pack keeps its implicit layout when one pad changes", () => {
    expect(keys(assignPad([track("a"), track("b"), track("c")], "c", "1"))).toEqual({
      a: "3",
      b: "2",
      c: "1"
    });
  });
});
