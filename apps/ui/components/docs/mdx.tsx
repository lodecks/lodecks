import { Step, Steps } from "fumadocs-ui/components/steps";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

import { Try } from "./try";

/** What the docs' MDX can use: fumadocs' own (cards, callouts), steps, tabs, and Try (examples that play) */
export function getMDXComponents(components?: MDXComponents) {
  return { ...defaultMdxComponents, Steps, Step, Tabs, Tab, Try, ...components } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
