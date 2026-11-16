import { defineConfig } from "fumadocs-mdx/config";
import { createCssVariablesTheme } from "shiki";

const token = (name: string) => `var(--shiki-token-${name})`;

// code in the docs is coloured like the live editor: see css/docs.css
const theme = {
  ...createCssVariablesTheme({ name: "lodecks", variablePrefix: "--shiki-", fontStyle: true }),
  tokenColors: [
    { scope: ["keyword", "storage", "constant.language", "variable.language"], settings: { foreground: token("keyword") } },
    { scope: ["keyword.operator", "punctuation", "meta.brace"], settings: { foreground: token("punctuation") } },
    { scope: ["entity.name.function", "support.function", "entity.name.type", "support.class"], settings: { foreground: token("function") } },
    { scope: ["string", "punctuation.definition.string"], settings: { foreground: token("string") } },
    { scope: ["constant.numeric", "constant.character"], settings: { foreground: token("constant") } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: token("comment") } }
  ]
};

// the docs collection is in constants/docs.source.constant.ts; this runs at build time
export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: { themes: { light: theme, dark: theme } }
  }
});
