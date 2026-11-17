import { themeScript, useTheme } from "@/hooks/theme.hook";
import { EngineContextProvider } from "@/providers/engine.provider";
import { RouterContext } from "@/router";
import { defineRoute, getTitle } from "@/utils/route.util";
import {
  HeadContent,
  Scripts,
  createRootRouteWithContext
} from "@tanstack/react-router";
import { ReactNode, useEffect } from "react";

import { startAnalytics } from "~/utils/analytics.util";

import appCss from "~/css/base.css?url";

const Site = "https://lodecks.com";
const Slogan = "Don't play the music. Hack it.";
const Description = "A live coding DJ playground. Remix tracks, manipulate stems, and create reactive visuals (all from code).";

export const Route = createRootRouteWithContext<RouterContext>()({
  ...defineRoute(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1"
      },
      { title: getTitle() },
      { name: "description", content: Description },
      // the link preview: an absolute image url, as crawlers need
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "lodecks" },
      { property: "og:title", content: `lodecks · ${Slogan}` },
      { property: "og:description", content: Description },
      { property: "og:url", content: Site },
      { property: "og:image", content: `${Site}/og.png` },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "The lodecks editor: a deck drawn under its code, with the song's graph and effect pads" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: `lodecks · ${Slogan}` },
      { name: "twitter:description", content: Description },
      { name: "twitter:image", content: `${Site}/og.png` }
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" }
    ]
  }),
  shellComponent: RootDocument
});

// the saved palette and deck colours, before the first paint
const ThemeScript = themeScript();

/** Keeps the theme in step with the settings */
const Theme = () => {
  useTheme();
  return null;
};

/** PostHog, when the build has a key */
const Analytics = () => {
  useEffect(() => void startAnalytics(), []);
  return null;
};

function RootDocument({ children }: { children: ReactNode }) {
  return (
    // the theme script sets <html>'s style before react hydrates it
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: ThemeScript }} />
        <HeadContent />
      </head>
      <body>
        <Theme />
        <Analytics />
        <EngineContextProvider>{children}</EngineContextProvider>
        <Scripts />
      </body>
    </html>
  );
}
