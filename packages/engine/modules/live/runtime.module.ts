/**
 * Runs blocks of code REPL style: top-level declarations become bindings
 * in one scope that outlives the run, so a later block can use what an
 * earlier one made. The last expression is the block's result.
 */
import { parse } from "acorn";

export type Block = { from: number; to: number; startLine: number; endLine: number };

/** Runs of non-blank lines */
export const splitBlocks = (doc: string): Block[] => {
  const blocks: Block[] = [];
  let offset = 0;
  let current: Block | undefined;
  doc.split("\n").forEach((text, index) => {
    const line = index + 1;
    const end = offset + text.length;
    if (text.trim()) {
      if (current) {
        current.to = end;
        current.endLine = line;
      } else {
        current = { from: offset, to: end, startLine: line, endLine: line };
        blocks.push(current);
      }
    } else {
      current = undefined;
    }
    offset = end + 1;
  });
  return blocks;
};

/** The block at `pos`, or the nearest one above when on a blank line */
export const blockAt = (doc: string, pos: number) => {
  const blocks = splitBlocks(doc);
  return blocks.find((block) => pos >= block.from && pos <= block.to) ?? [...blocks].reverse().find((block) => block.to < pos);
};

export type TransformOptions = {
  // doc line the code starts on
  line: number;
  // passed to __at(tag, line) so concurrent runs stay apart
  tag?: string;
  // calls that get a hidden id as first argument (inline controls)
  controls?: string[];
  controlId?: (index: number) => string;
};

export class LiveSyntaxError extends Error {
  constructor(message: string, readonly line: number) {
    super(message);
  }
}

type Node = { type: string; start: number; end: number; loc?: any; [key: string]: any };

const children = (node: Node): Node[] => {
  const out: Node[] = [];
  for (const key of Object.keys(node)) {
    if (key === "loc") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item.type === "string") out.push(item);
    } else if (value && typeof value.type === "string") {
      out.push(value);
    }
  }
  return out;
};

const patternNames = (node: Node, names: string[]) => {
  switch (node.type) {
    case "Identifier":
      names.push(node.name);
      break;
    case "ObjectPattern":
      for (const property of node.properties) patternNames(property.type === "RestElement" ? property.argument : property.value, names);
      break;
    case "ArrayPattern":
      for (const element of node.elements) if (element) patternNames(element, names);
      break;
    case "RestElement":
      patternNames(node.argument, names);
      break;
    case "AssignmentPattern":
      patternNames(node.left, names);
      break;
  }
  return names;
};

/**
 * Rewrites a block for the shared scope:
 * - `const a = x` → `a = x` (and the same for let, var, functions, classes)
 * - the last expression is kept in `__result`
 * - `__at(line)` before each statement, so components know their line
 * - inline controls get their id: `slider(0.3)` → `slider("id", 0.3)`
 * Line structure is kept, so error lines still match.
 */
export const transform = (code: string, options: TransformOptions) => {
  let program: Node;
  try {
    program = parse(code, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowAwaitOutsideFunction: true,
      locations: true
    }) as unknown as Node;
  } catch (error) {
    const loc = (error as { loc?: { line: number } }).loc;
    const message = (error as Error).message.replace(/\s*\(\d+:\d+\)$/, "");
    throw new LiveSyntaxError(message, options.line + (loc ? loc.line - 1 : 0));
  }

  // replacements of [from, to); at the same spot, earlier edits come first
  const edits: { from: number; to: number; text: string; order: number }[] = [];
  const replace = (from: number, to: number, text: string) => edits.push({ from, to, text, order: edits.length });
  const insert = (at: number, text: string) => replace(at, at, text);
  const names: string[] = [];
  const body = program.body as Node[];

  body.forEach((statement, index) => {
    const endLine = options.line + statement.loc.end.line - 1;
    insert(statement.start, `__at(${options.tag === undefined ? "" : `${JSON.stringify(options.tag)}, `}${endLine});`);

    if (statement.type === "VariableDeclaration") {
      const declarations = statement.declarations as Node[];
      const patterns = declarations.some((item) => item.id.type !== "Identifier");
      // the keyword goes; patterns need parens to be an assignment
      replace(statement.start, declarations[0].start, patterns ? "(" : "");
      for (const declaration of declarations) {
        patternNames(declaration.id, names);
        if (!declaration.init) insert(declaration.id.end, " = undefined");
      }
      if (patterns) insert(declarations[declarations.length - 1].end, ")");
      return;
    }
    if ((statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") && statement.id) {
      names.push(statement.id.name);
      insert(statement.start, `${statement.id.name} = `);
      return;
    }
    if (index === body.length - 1 && statement.type === "ExpressionStatement") {
      insert(statement.expression.start, "__result = (");
      insert(statement.expression.end, ")");
    }
  });

  // inline controls, wherever they are
  const controls = new Set(options.controls ?? []);
  let controlIndex = 0;
  const visit = (node: Node) => {
    if (node.type === "CallExpression" && node.callee.type === "Identifier" && controls.has(node.callee.name)) {
      const open = code.indexOf("(", node.callee.end);
      const id = options.controlId?.(controlIndex) ?? String(controlIndex);
      controlIndex++;
      insert(open + 1, node.arguments.length ? `${JSON.stringify(id)}, ` : JSON.stringify(id));
    }
    for (const child of children(node)) visit(child);
  };
  visit(program);

  // from the end backwards, so offsets stay valid
  let output = code;
  edits.sort((a, b) => b.from - a.from || b.order - a.order);
  for (const edit of edits) output = output.slice(0, edit.from) + edit.text + output.slice(edit.to);
  return { code: output, names, controls: controlIndex };
};

// lines the function wrapper adds before the code (chrome numbering)
const WrapperLines = 3;

/** Doc line of a runtime error, read from its stack when possible */
export const errorLine = (error: unknown, line: number) => {
  const stack = (error as Error)?.stack ?? "";
  const match = /<anonymous>:(\d+):\d+/.exec(stack);
  if (!match) return undefined;
  const local = Number(match[1]) - WrapperLines;
  return local >= 1 ? line + local - 1 : undefined;
};

export type RunResult = {
  value?: unknown;
  error?: { message: string; line?: number };
  names: string[];
};

export class Runtime {
  scope: Record<string, unknown>;
  private builtins: Set<string>;

  constructor(api: Record<string, unknown>) {
    this.scope = { ...api, __result: undefined };
    this.builtins = new Set([...Object.keys(api), "__result"]);
  }

  /** Names the code made, for completion */
  bindings() {
    return Object.keys(this.scope).filter((name) => !this.builtins.has(name));
  }

  reset() {
    for (const name of this.bindings()) delete this.scope[name];
  }

  async run(code: string, options: TransformOptions): Promise<RunResult> {
    let transformed: ReturnType<typeof transform>;
    try {
      transformed = transform(code, options);
    } catch (error) {
      if (error instanceof LiveSyntaxError) return { error: { message: error.message, line: error.line }, names: [] };
      throw error;
    }
    const clash = transformed.names.find((name) => this.builtins.has(name));
    if (clash) {
      return { error: { message: `${clash} is part of lodecks, pick another name`, line: options.line }, names: [] };
    }
    for (const name of transformed.names) if (!(name in this.scope)) this.scope[name] = undefined;
    this.scope.__result = undefined;

    try {
      // sloppy mode on purpose: `with` resolves names in the scope
      const run = new Function("__scope", `with (__scope) { return (async () => {\n${transformed.code}\n})(); }`);
      await run(this.scope);
      return { value: this.scope.__result, names: transformed.names };
    } catch (error) {
      return {
        error: { message: (error as Error)?.message ?? String(error), line: errorLine(error, options.line) },
        names: transformed.names
      };
    }
  }
}
