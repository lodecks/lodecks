/**
 * Usage analytics, with PostHog. Only on when the build has a key
 * (VITE_POSTHOG_KEY, see apps/ui/.env.example): a build without one, like a
 * local or self-hosted one, loads nothing and sends nothing.
 */
const Key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const Host = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) || "https://us.i.posthog.com";

let started = false;

/** Starts PostHog in the browser, once; a no-op without a key */
export const startAnalytics = async () => {
  if (started || !Key || typeof window === "undefined") return;
  started = true;
  // loaded only when there is a key, so other builds don't carry it
  const { default: posthog } = await import("posthog-js");
  posthog.init(Key, {
    api_host: Host,
    // the router changes pages without reloading
    capture_pageview: "history_change",
    // no profiles for anonymous visitors
    person_profiles: "identified_only",
    // no screen recordings: the code typed in the editor is the user's own
    disable_session_recording: true,
    // clicks are counted, the text of what was clicked (code, names) is not
    mask_all_text: true
  });
};
