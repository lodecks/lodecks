import { createFileRoute, redirect } from "@tanstack/react-router";

// lodecks plays at /play
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/play", replace: true });
  }
});
