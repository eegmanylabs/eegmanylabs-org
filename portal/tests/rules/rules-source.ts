// Reads the text of a security-rules file: its allow statements, its match blocks and the
// lists it declares. Tests use it to compare the rules file with the collection registry and
// with the record the emulator keeps of what it evaluated.

/** Replaces the text of every comment and of every string with spaces, so that offsets stay where they are. */
export function withoutCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\/[^\n]*/g, (comment) => " ".repeat(comment.length))
    .replace(/'[^'\n]*'/g, (text) => `'${" ".repeat(text.length - 2)}'`);
}

/** Replaces the text of every comment with spaces. */
function withoutComments(source: string): string {
  return source.replace(/\/\/[^\n]*/g, (comment) => " ".repeat(comment.length));
}

export interface AllowStatement {
  /** The line of the statement, counted from one. */
  readonly line: number;
  /** The offset of the word `allow`. */
  readonly offset: number;
  /** The methods the statement names, for example `["create", "update"]`. */
  readonly methods: readonly string[];
  /** The offset at which the condition starts. */
  readonly conditionOffset: number;
  /** The condition, without the semicolon that ends it. */
  readonly condition: string;
}

/** Every allow statement of a rules file. */
export function allowStatements(source: string): AllowStatement[] {
  const code = withoutComments(source);
  const statements: AllowStatement[] = [];
  for (const match of code.matchAll(/\ballow\s+([a-z]+(?:\s*,\s*[a-z]+)*)\s*:\s*if\s+/g)) {
    const conditionOffset = match.index + match[0].length;
    statements.push({
      line: code.slice(0, match.index).split("\n").length,
      offset: match.index,
      methods: (match[1] ?? "").split(",").map((method) => method.trim()),
      conditionOffset,
      condition: code.slice(conditionOffset, code.indexOf(";", conditionOffset)).trim(),
    });
  }
  return statements;
}

export interface MatchBlock {
  /** The whole path of the block beneath the documents of the database, for example `/persons/{personId}/private/contact`. */
  readonly path: string;
  /** The path with its parameter names removed: `/persons/{}/private/contact`, or `/{**}/members/{}`. */
  readonly shape: string;
  /** The allow statements that sit in the block itself, and not in a block inside it. */
  readonly statements: readonly AllowStatement[];
  /** The text of the block itself, without its comments and without the blocks inside it. */
  readonly body: string;
}

/** A path with its parameter names removed, so that two spellings of one path compare equal. */
export function shapeOfPath(path: string): string {
  return path.replace(/\{[^{}=/]+=\*\*\}/g, "{**}").replace(/\{[^{}*/]+\}/g, "{}");
}

/** Every match block of a rules file that holds an allow statement of its own. */
export function matchBlocks(source: string): MatchBlock[] {
  const code = withoutCommentsAndStrings(source);
  const statements = allowStatements(source);
  const open: { path: string; depth: number; start: number }[] = [];
  const spans: { path: string; start: number; end: number }[] = [];
  const matchAt = new Map<number, string>();
  for (const match of code.matchAll(/\bmatch\s+(\/[^\s{]*(?:\{[^{}]*\}[^\s{]*)*)\s*\{/g)) {
    matchAt.set(match.index + match[0].length - 1, match[1] ?? "");
  }
  let depth = 0;
  for (let index = 0; index < code.length; index += 1) {
    const character = code[index];
    if (character === "{") {
      const path = matchAt.get(index);
      if (path !== undefined) {
        // The block of the database itself is the root: its path is no part of a document path.
        // A block inside it may match a collection named `databases`, which is no root.
        const parent = open.at(-1);
        const isRoot = parent === undefined && path.startsWith("/databases/");
        open.push({ path: isRoot ? "" : `${parent?.path ?? ""}${path}`, depth, start: index });
      }
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      const innermost = open.at(-1);
      if (innermost !== undefined && innermost.depth === depth) {
        open.pop();
        spans.push({ path: innermost.path, start: innermost.start, end: index });
      }
    }
  }
  const uncommented = withoutComments(source);
  /** The text between two offsets, with the blocks that lie inside them left out. */
  const bodyOf = (start: number, end: number) => {
    const inner = spans
      .filter((span) => span.start > start && span.end < end)
      // Only the outermost of the inner blocks: a block inside one of them goes with it.
      .filter((span, _index, all) => !all.some((other) => other.start < span.start && other.end > span.end))
      .sort((a, b) => a.start - b.start);
    let text = "";
    let from = start;
    for (const span of inner) {
      text += uncommented.slice(from, span.start);
      from = span.end + 1;
    }
    return text + uncommented.slice(from, end);
  };
  return spans
    .map(({ path, start, end }) => ({
      path,
      shape: shapeOfPath(path),
      body: bodyOf(start, end),
      statements: statements.filter(
        (statement) =>
          statement.offset > start &&
          statement.offset < end &&
          // Not inside a block that this block contains.
          !spans.some(
            (inner) =>
              inner.start > start && inner.end < end && statement.offset > inner.start && statement.offset < inner.end,
          ),
      ),
    }))
    .filter((block) => block.statements.length > 0);
}

/** The lists that a rules file declares as `function name() { return ['a', 'b']; }`, by name. */
export function declaredLists(source: string): Map<string, string[]> {
  const lists = new Map<string, string[]>();
  for (const match of withoutComments(source).matchAll(/function\s+(\w+)\(\)\s*\{\s*return\s*\[([^\]]*)\];\s*\}/g)) {
    lists.set(
      match[1] ?? "",
      [...(match[2] ?? "").matchAll(/'([^']*)'/g)].map((item) => item[1] ?? ""),
    );
  }
  return lists;
}
