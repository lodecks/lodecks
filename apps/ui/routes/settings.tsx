import { LayoutSettings } from "@/layouts/settings";
import { defineHead } from "@/utils/route.util";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/settings")({
  ...defineHead({ title: "settings" }),
  component: LayoutSettings
});
