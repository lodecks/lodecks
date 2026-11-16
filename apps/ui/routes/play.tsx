import { LayoutLive } from "@/layouts/live";
import { defineHead, defineRoute } from "@/utils/route.util";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/play")({
  ...defineRoute(),
  ...defineHead({ title: "play" }),
  component: Play
});

function Play() {
  return <LayoutLive />;
}
