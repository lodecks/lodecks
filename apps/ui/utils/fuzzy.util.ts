/**
 * Fuzzy matching for the command palette: the query's letters in order,
 * anywhere in the text. Matches at word starts and in runs score higher.
 * Returns the score and the matched positions, or undefined.
 */
export const fuzzy = (query: string, text: string) => {
  const needle = query.toLowerCase().replace(/\s+/g, "");
  if (!needle) return { score: 0, positions: [] as number[] };
  const haystack = text.toLowerCase();
  const positions: number[] = [];
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const char of needle) {
    const index = haystack.indexOf(char, from);
    if (index < 0) return undefined;
    const start = index === 0 || /[\s:"(·→\-/]/.test(text[index - 1]);
    score += 1 + (start ? 3 : 0) + (index === previous + 1 ? 2 : 0);
    positions.push(index);
    previous = index;
    from = index + 1;
  }
  // shorter texts and earlier first matches win ties
  return { score: score - positions[0] * 0.05 - text.length * 0.01, positions };
};
