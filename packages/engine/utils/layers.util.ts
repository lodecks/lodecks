const LabelPattern = /^[ \t]*(_?)(\$|[A-Za-z][\w]*)\s*:(?!:)/;

/** Labelled pattern blocks in a set, `name: pattern` */
export const parseLayers = (code: string) => {
  const layers: { name: string; muted: boolean; line: number }[] = [];
  code.split("\n").forEach((line, index) => {
    const match = line.match(LabelPattern);
    if (match) {
      layers.push({ name: match[2], muted: match[1] === "_", line: index });
    }
  });
  return layers;
};
