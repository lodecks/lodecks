import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import { Suspense, use } from "react";

import { useMDXComponents } from "@/components/docs/mdx";
import { TryHost } from "@/components/docs/try";
import { docs, source } from "@/constants/docs.source.constant";
import { getTitle } from "@/utils/route.util";

import docsCss from "~/css/docs.css?url";

export const Route = createFileRoute("/docs/$")({
  component: RouteComponent,
  loader: async ({ params }) => {
    const slugs = params._splat?.split("/").filter(Boolean) ?? [];
    const data = await serverLoader({ data: slugs });
    await docs.getPage(data.path)?.preload();
    const page = source.getPage(slugs);
    return { data, title: page?.data.title, description: page?.data.description };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: getTitle(loaderData?.title ? `${loaderData.title} · docs` : "docs") },
      ...(loaderData?.description ? [{ name: "description", content: loaderData.description }] : [])
    ],
    links: [
      // General Sans, from Fontshare: its licence lets sites use it, not repos ship it
      { rel: "preconnect", href: "https://api.fontshare.com" },
      { rel: "preconnect", href: "https://cdn.fontshare.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap" },
      { rel: "stylesheet", href: docsCss }
    ]
  })
});

const serverLoader = createServerFn({ method: "GET" })
  .validator((slugs: string[]) => slugs)
  .handler(async ({ data: slugs }) => {
    const page = source.getPage(slugs);
    if (!page) throw notFound();
    return { path: page.path, pageTree: await source.serializePageTree(source.getPageTree()) };
  });

function Content({ path }: { path: string }) {
  const page = docs.getPage(path);
  if (!page) throw new Error(`unknown page: ${path}`);
  const MDX = page.body;
  const { toc } = use(page.load());

  return (
    <DocsPage toc={toc}>
      <DocsTitle>{page.title}</DocsTitle>
      <DocsDescription>{page.description}</DocsDescription>
      <DocsBody>
        <MDX components={useMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

function RouteComponent() {
  // turns the serialized page tree back into one
  const data = useFumadocsLoader(Route.useLoaderData().data);

  return (
    // lodecks is dark only: no theme switch
    <RootProvider search={{ enabled: false }} theme={{ enabled: false }}>
      <DocsLayout
        tree={data.pageTree}
        nav={{
          title: (
            <span className="flex items-center gap-2 font-mono text-[15px]">
              <img src="/logo.svg" alt="" className="h-6 w-6" />
              lodecks <span className="text-fd-muted-foreground text-[12px]">docs</span>
            </span>
          ),
          url: "/docs"
        }}
        links={[{ text: "open lodecks", url: "/play", external: false }]}
        themeSwitch={{ enabled: false }}
      >
        <Suspense>
          <Content path={data.path} />
        </Suspense>
      </DocsLayout>
      {/* what the examples draw (decks, pads, visuals) renders here into their lines */}
      <TryHost />
    </RootProvider>
  );
}
