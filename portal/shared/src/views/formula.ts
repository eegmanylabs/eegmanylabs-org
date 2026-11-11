// The formula language of views: a small parser and evaluator, with no `eval` and no access to
// anything but the values of one record. An expression refers to a property as `prop("Name")`
// and combines values with arithmetic, comparison, logic and the functions of `FUNCTIONS`.
//
// Every limit is enforced: the length of an expression, the depth of its nesting, the number of
// steps and the time one evaluation may take, and the length of a text it produces. A formula
// that breaks one, or that fails on a record, gives an error for that record alone, which the
// view shows in the cell.
import { FORMULA_MAX_LENGTH } from "./model";

/** The deepest an expression may nest. */
export const FORMULA_MAX_DEPTH = 40;
/** The most steps one evaluation may take. */
export const FORMULA_MAX_STEPS = 10_000;
/** The longest one evaluation may take, in milliseconds. */
export const FORMULA_MAX_TIME_MS = 50;
/** The longest text a formula may produce. */
export const FORMULA_MAX_TEXT = 10_000;

/** A calendar date (at midnight UTC) or an instant. */
export interface FormulaDate {
  readonly kind: "date";
  readonly time: number;
  readonly dateOnly: boolean;
}

export type FormulaValue = number | string | boolean | null | FormulaDate | readonly FormulaValue[];

export class FormulaError extends Error {
  override readonly name = "FormulaError";
}

type Expression =
  | { readonly type: "literal"; readonly value: number | string | boolean | null }
  | { readonly type: "unary"; readonly operator: "-" | "not"; readonly argument: Expression }
  | {
      readonly type: "binary";
      readonly operator: BinaryOperator;
      readonly left: Expression;
      readonly right: Expression;
    }
  | { readonly type: "call"; readonly name: string; readonly args: readonly Expression[] };

type BinaryOperator = "+" | "-" | "*" | "/" | "%" | "^" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "and" | "or";

/** A parsed formula and the names of the properties it refers to. */
export interface CompiledFormula {
  readonly source: string;
  readonly expression: Expression;
  readonly references: readonly string[];
}

// ===== Tokens =====

type Token =
  | { readonly kind: "number"; readonly value: number; readonly at: number }
  | { readonly kind: "string"; readonly value: string; readonly at: number }
  | { readonly kind: "name"; readonly value: string; readonly at: number }
  | { readonly kind: "symbol"; readonly value: string; readonly at: number }
  | { readonly kind: "end"; readonly at: number };

const SYMBOLS = ["==", "!=", "<=", ">=", "&&", "||", "+", "-", "*", "/", "%", "^", "<", ">", "!", "(", ")", ","];

function tokenise(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index] ?? "";
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    const at = index;
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(index));
    if (number !== null) {
      tokens.push({ kind: "number", value: Number(number[0]), at });
      index += number[0].length;
      continue;
    }
    if (character === '"' || character === "'") {
      let text = "";
      index += 1;
      let closed = false;
      while (index < source.length) {
        const next = source[index] ?? "";
        if (next === "\\") {
          const escaped = source[index + 1];
          if (escaped === undefined) break;
          text += escaped === "n" ? "\n" : escaped;
          index += 2;
          continue;
        }
        if (next === character) {
          closed = true;
          index += 1;
          break;
        }
        text += next;
        index += 1;
      }
      if (!closed) throw new FormulaError(`A text that starts at position ${at + 1} is not closed.`);
      tokens.push({ kind: "string", value: text, at });
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index));
    if (name !== null) {
      tokens.push({ kind: "name", value: name[0], at });
      index += name[0].length;
      continue;
    }
    const symbol = SYMBOLS.find((candidate) => source.startsWith(candidate, index));
    if (symbol === undefined) throw new FormulaError(`"${character}" at position ${at + 1} is not understood.`);
    tokens.push({ kind: "symbol", value: symbol, at });
    index += symbol.length;
  }
  tokens.push({ kind: "end", at: source.length });
  return tokens;
}

// ===== Parser =====

/** How tightly each binary operator binds, and its canonical spelling. */
const BINARY: Readonly<Record<string, { readonly power: number; readonly operator: BinaryOperator }>> = {
  or: { power: 1, operator: "or" },
  "||": { power: 1, operator: "or" },
  and: { power: 2, operator: "and" },
  "&&": { power: 2, operator: "and" },
  "==": { power: 4, operator: "==" },
  "!=": { power: 4, operator: "!=" },
  "<": { power: 4, operator: "<" },
  "<=": { power: 4, operator: "<=" },
  ">": { power: 4, operator: ">" },
  ">=": { power: 4, operator: ">=" },
  "+": { power: 5, operator: "+" },
  "-": { power: 5, operator: "-" },
  "*": { power: 6, operator: "*" },
  "/": { power: 6, operator: "/" },
  "%": { power: 6, operator: "%" },
  "^": { power: 8, operator: "^" },
};

class Parser {
  private position = 0;
  readonly references = new Set<string>();

  constructor(private readonly tokens: readonly Token[]) {}

  private peek(): Token {
    return this.tokens[this.position] ?? { kind: "end", at: 0 };
  }

  private next(): Token {
    const token = this.peek();
    this.position += 1;
    return token;
  }

  private expectSymbol(symbol: string): void {
    const token = this.next();
    if (token.kind !== "symbol" || token.value !== symbol) {
      throw new FormulaError(`Expected "${symbol}" at position ${token.at + 1}.`);
    }
  }

  parseAll(): Expression {
    const expression = this.parse(0, 0);
    const rest = this.peek();
    if (rest.kind !== "end") throw new FormulaError(`Unexpected text at position ${rest.at + 1}.`);
    return expression;
  }

  private parse(minimumPower: number, depth: number): Expression {
    if (depth > FORMULA_MAX_DEPTH) throw new FormulaError(`A formula nests at most ${FORMULA_MAX_DEPTH} deep.`);
    let left = this.prefix(depth);
    for (;;) {
      const token = this.peek();
      const key = token.kind === "symbol" || token.kind === "name" ? token.value : "";
      const binary = BINARY[key];
      if (binary === undefined || binary.power < minimumPower) break;
      this.next();
      // `^` is right-associative; every other operator is left-associative.
      const right = this.parse(binary.operator === "^" ? binary.power : binary.power + 1, depth + 1);
      left = { type: "binary", operator: binary.operator, left, right };
    }
    return left;
  }

  private prefix(depth: number): Expression {
    const token = this.next();
    switch (token.kind) {
      case "number":
        return { type: "literal", value: token.value };
      case "string":
        return { type: "literal", value: token.value };
      case "symbol":
        if (token.value === "(") {
          const inner = this.parse(0, depth + 1);
          this.expectSymbol(")");
          return inner;
        }
        if (token.value === "-") return { type: "unary", operator: "-", argument: this.parse(7, depth + 1) };
        if (token.value === "!") return { type: "unary", operator: "not", argument: this.parse(3, depth + 1) };
        throw new FormulaError(`Unexpected "${token.value}" at position ${token.at + 1}.`);
      case "name":
        return this.name(token.value, token.at, depth);
      case "end":
        throw new FormulaError("The formula ends too early.");
    }
  }

  private name(name: string, at: number, depth: number): Expression {
    if (name === "true" || name === "false") return { type: "literal", value: name === "true" };
    if (name === "null") return { type: "literal", value: null };
    if (name === "not") return { type: "unary", operator: "not", argument: this.parse(3, depth + 1) };
    const next = this.peek();
    if (next.kind !== "symbol" || next.value !== "(") {
      throw new FormulaError(`"${name}" at position ${at + 1} is not known. Refer to a property as prop("${name}").`);
    }
    this.next();
    const args: Expression[] = [];
    const close = this.peek();
    if (!(close.kind === "symbol" && close.value === ")")) {
      for (;;) {
        args.push(this.parse(0, depth + 1));
        const separator = this.next();
        if (separator.kind === "symbol" && separator.value === ")") break;
        if (!(separator.kind === "symbol" && separator.value === ",")) {
          throw new FormulaError(`Expected "," or ")" at position ${separator.at + 1}.`);
        }
      }
    } else {
      this.next();
    }
    if (name === "prop") {
      const [argument] = args;
      if (args.length !== 1 || argument?.type !== "literal" || typeof argument.value !== "string") {
        throw new FormulaError('prop takes the name of a property in quotes, as in prop("Target").');
      }
      this.references.add(argument.value);
      return { type: "call", name, args };
    }
    const definition = FUNCTIONS[name];
    if (definition === undefined) throw new FormulaError(`There is no function called ${name}.`);
    if (args.length < definition.minimum || args.length > definition.maximum) {
      const expected =
        definition.minimum === definition.maximum
          ? `${definition.minimum}`
          : definition.maximum === Number.POSITIVE_INFINITY
            ? `at least ${definition.minimum}`
            : `${definition.minimum} to ${definition.maximum}`;
      throw new FormulaError(`${name} takes ${expected} argument${expected === "1" ? "" : "s"}.`);
    }
    return { type: "call", name, args };
  }
}

/** Parses a formula, or raises a `FormulaError` that says what is wrong in words. */
export function compileFormula(source: string): CompiledFormula {
  if (source.length > FORMULA_MAX_LENGTH) {
    throw new FormulaError(`A formula holds at most ${FORMULA_MAX_LENGTH} characters.`);
  }
  if (source.trim() === "") throw new FormulaError("The formula is empty.");
  const parser = new Parser(tokenise(source));
  const expression = parser.parseAll();
  return { source, expression, references: [...parser.references] };
}

// ===== Values =====

const DAY_MS = 86_400_000;

export function formulaDate(time: number, dateOnly: boolean): FormulaDate {
  return { kind: "date", time, dateOnly };
}

export function isFormulaDate(value: FormulaValue): value is FormulaDate {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (value as FormulaDate).kind === "date";
}

/** A date or an instant written in ISO 8601, or null where the text is neither. */
export function parseFormulaDate(text: string): FormulaDate | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const time = Date.parse(`${text}T00:00:00Z`);
    return Number.isNaN(time) ? null : formulaDate(time, true);
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const time = Date.parse(text);
    return Number.isNaN(time) ? null : formulaDate(time, false);
  }
  return null;
}

/** The ISO text of a date: the day alone for a calendar date. */
export function formatFormulaDate(value: FormulaDate): string {
  const iso = new Date(value.time).toISOString();
  return value.dateOnly ? iso.slice(0, 10) : iso;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1e10) / 1e10);
}

/** A value as text, the way `format` and the joining of texts write it. */
export function formulaText(value: FormulaValue): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.map((element) => formulaText(element)).join(", ");
  return formatFormulaDate(value as FormulaDate);
}

function kindOf(value: FormulaValue): string {
  if (value === null) return "nothing";
  if (typeof value === "string") return "a text";
  if (typeof value === "number") return "a number";
  if (typeof value === "boolean") return "a true or false value";
  if (Array.isArray(value)) return "a list";
  return "a date";
}

// ===== Evaluation =====

/** What an evaluation may consult: the values of the record and the time. */
export interface FormulaEnvironment {
  /** The value of a property of the record, by name, or undefined for a property that does not exist. */
  readonly prop: (name: string) => FormulaValue | undefined;
  readonly now: Date;
  /** Today's date in the reader's time zone, as an ISO date. */
  readonly today: string;
}

class Budget {
  private steps = 0;
  /** The clock is read every sixteen steps, which keeps the cost of the check small. */
  private nextCheck = 16;
  private readonly started = Date.now();

  step(cost = 1): void {
    this.steps += cost;
    if (this.steps > FORMULA_MAX_STEPS) throw new FormulaError("The formula takes too many steps.");
    if (this.steps >= this.nextCheck) {
      this.nextCheck = this.steps + 16;
      if (Date.now() - this.started > FORMULA_MAX_TIME_MS) throw new FormulaError("The formula takes too long.");
    }
  }
}

function number(value: FormulaValue, name: string): number {
  if (typeof value !== "number") throw new FormulaError(`${name} needs a number, and was given ${kindOf(value)}.`);
  return value;
}

function text(value: FormulaValue, name: string): string {
  if (typeof value !== "string") throw new FormulaError(`${name} needs a text, and was given ${kindOf(value)}.`);
  return value;
}

function date(value: FormulaValue, name: string): FormulaDate {
  if (typeof value === "string") {
    const parsed = parseFormulaDate(value);
    if (parsed !== null) return parsed;
  }
  if (!isFormulaDate(value)) throw new FormulaError(`${name} needs a date, and was given ${kindOf(value)}.`);
  return value;
}

function finite(value: number): number {
  if (!Number.isFinite(value)) throw new FormulaError("The result is not a finite number.");
  return value;
}

function checkedText(value: string): string {
  if (value.length > FORMULA_MAX_TEXT) throw new FormulaError(`A text holds at most ${FORMULA_MAX_TEXT} characters.`);
  return value;
}

function truthy(value: FormulaValue, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new FormulaError(`${name} needs true or false, and was given ${kindOf(value)}.`);
  }
  return value;
}

/** Whether a value is empty: nothing, an empty text or an empty list. Zero and false are values. */
export function formulaEmpty(value: FormulaValue): boolean {
  return value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function equal(left: FormulaValue, right: FormulaValue): boolean {
  if (isFormulaDate(left) && isFormulaDate(right)) return left.time === right.time;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((element, index) => equal(element, right[index] ?? null));
  }
  return left === right;
}

function compare(left: FormulaValue, right: FormulaValue): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "string" && typeof right === "string") return left < right ? -1 : left > right ? 1 : 0;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  if (isFormulaDate(left) && isFormulaDate(right)) return left.time - right.time;
  throw new FormulaError(`${kindOf(left)} cannot be compared with ${kindOf(right)}.`);
}

const UNITS = ["years", "months", "weeks", "days", "hours", "minutes"] as const;
type Unit = (typeof UNITS)[number];

function unitOf(value: FormulaValue, name: string): Unit {
  const given = text(value, name).toLowerCase();
  const unit = UNITS.find((candidate) => candidate === given || candidate === `${given}s`);
  if (unit === undefined) throw new FormulaError(`${name} takes one of the units ${UNITS.join(", ")}.`);
  return unit;
}

function addToDate(value: FormulaDate, amount: number, unit: Unit): FormulaDate {
  if (!Number.isInteger(amount)) throw new FormulaError("A date moves by a whole number of units.");
  const moved = new Date(value.time);
  switch (unit) {
    case "years":
      moved.setUTCFullYear(moved.getUTCFullYear() + amount);
      break;
    case "months":
      moved.setUTCMonth(moved.getUTCMonth() + amount);
      break;
    case "weeks":
      moved.setTime(moved.getTime() + amount * 7 * DAY_MS);
      break;
    case "days":
      moved.setTime(moved.getTime() + amount * DAY_MS);
      break;
    case "hours":
      moved.setTime(moved.getTime() + amount * 3_600_000);
      break;
    case "minutes":
      moved.setTime(moved.getTime() + amount * 60_000);
      break;
  }
  if (Number.isNaN(moved.getTime())) throw new FormulaError("The date is out of range.");
  return formulaDate(
    moved.getTime(),
    value.dateOnly && (unit === "years" || unit === "months" || unit === "weeks" || unit === "days"),
  );
}

/** The whole number of units from `to` to `from`: positive when `from` is later. */
function between(from: FormulaDate, to: FormulaDate, unit: Unit): number {
  const difference = from.time - to.time;
  const truncate = (value: number) => (value < 0 ? Math.ceil(value) : Math.floor(value));
  switch (unit) {
    case "minutes":
      return truncate(difference / 60_000);
    case "hours":
      return truncate(difference / 3_600_000);
    case "days":
      return truncate(difference / DAY_MS);
    case "weeks":
      return truncate(difference / (7 * DAY_MS));
    case "months":
    case "years": {
      const a = new Date(from.time);
      const b = new Date(to.time);
      let months = (a.getUTCFullYear() - b.getUTCFullYear()) * 12 + (a.getUTCMonth() - b.getUTCMonth());
      const restA = a.getTime() - Date.UTC(a.getUTCFullYear(), a.getUTCMonth());
      const restB = b.getTime() - Date.UTC(b.getUTCFullYear(), b.getUTCMonth());
      if (months > 0 && restA < restB) months -= 1;
      if (months < 0 && restA > restB) months += 1;
      return unit === "months" ? months : truncate(months / 12);
    }
  }
}

interface FunctionDefinition {
  readonly minimum: number;
  readonly maximum: number;
  readonly call: (args: readonly FormulaValue[], environment: FormulaEnvironment, budget: Budget) => FormulaValue;
}

const fixed = (
  count: number,
  call: (args: readonly FormulaValue[], environment: FormulaEnvironment, budget: Budget) => FormulaValue,
): FunctionDefinition => ({ minimum: count, maximum: count, call });

const arg = (args: readonly FormulaValue[], index: number): FormulaValue => args[index] ?? null;

function numbersOf(args: readonly FormulaValue[], name: string): number[] {
  return args
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value) => value !== null)
    .map((value) => number(value as FormulaValue, name));
}

/**
 * The functions of the language. `if`, `and` and `or` are evaluated lazily by the evaluator and
 * appear here for their number of arguments only.
 */
const FUNCTIONS: Readonly<Record<string, FunctionDefinition>> = {
  if: fixed(3, () => null),
  and: { minimum: 2, maximum: Number.POSITIVE_INFINITY, call: () => null },
  or: { minimum: 2, maximum: Number.POSITIVE_INFINITY, call: () => null },
  not: fixed(1, (args) => !truthy(arg(args, 0), "not")),
  empty: fixed(1, (args) => formulaEmpty(arg(args, 0))),
  // Numbers.
  abs: fixed(1, (args) => Math.abs(number(arg(args, 0), "abs"))),
  round: {
    minimum: 1,
    maximum: 2,
    call: (args) => {
      const places = args.length > 1 ? number(arg(args, 1), "round") : 0;
      if (!Number.isInteger(places) || places < 0 || places > 10) {
        throw new FormulaError("round keeps between 0 and 10 decimal places.");
      }
      const factor = 10 ** places;
      return finite(Math.round(number(arg(args, 0), "round") * factor) / factor);
    },
  },
  floor: fixed(1, (args) => Math.floor(number(arg(args, 0), "floor"))),
  ceil: fixed(1, (args) => Math.ceil(number(arg(args, 0), "ceil"))),
  sqrt: fixed(1, (args) => {
    const value = number(arg(args, 0), "sqrt");
    if (value < 0) throw new FormulaError("sqrt needs a number that is not negative.");
    return Math.sqrt(value);
  }),
  min: {
    minimum: 1,
    maximum: Number.POSITIVE_INFINITY,
    call: (args) => {
      const values = numbersOf(args, "min");
      return values.length === 0 ? null : Math.min(...values);
    },
  },
  max: {
    minimum: 1,
    maximum: Number.POSITIVE_INFINITY,
    call: (args) => {
      const values = numbersOf(args, "max");
      return values.length === 0 ? null : Math.max(...values);
    },
  },
  sum: {
    minimum: 1,
    maximum: Number.POSITIVE_INFINITY,
    call: (args) => finite(numbersOf(args, "sum").reduce((total, value) => total + value, 0)),
  },
  toNumber: fixed(1, (args) => {
    const value = arg(args, 0);
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    const parsed = Number(text(value, "toNumber").trim());
    if (text(value, "toNumber").trim() === "" || !Number.isFinite(parsed)) {
      throw new FormulaError(`"${formulaText(value)}" is not a number.`);
    }
    return parsed;
  }),
  // Texts.
  format: fixed(1, (args) => checkedText(formulaText(arg(args, 0)))),
  concat: {
    minimum: 1,
    maximum: Number.POSITIVE_INFINITY,
    call: (args) => checkedText(args.map((value) => formulaText(value)).join("")),
  },
  length: fixed(1, (args) => {
    const value = arg(args, 0);
    if (Array.isArray(value)) return value.length;
    return text(value, "length").length;
  }),
  lower: fixed(1, (args) => text(arg(args, 0), "lower").toLowerCase()),
  upper: fixed(1, (args) => text(arg(args, 0), "upper").toUpperCase()),
  trim: fixed(1, (args) => text(arg(args, 0), "trim").trim()),
  contains: fixed(2, (args) => {
    const haystack = arg(args, 0);
    const needle = arg(args, 1);
    if (Array.isArray(haystack)) return haystack.some((element) => equal(element, needle));
    return text(haystack, "contains").toLowerCase().includes(text(needle, "contains").toLowerCase());
  }),
  replace: fixed(3, (args, _environment, budget) => {
    const source = text(arg(args, 0), "replace");
    budget.step(Math.ceil(source.length / 100));
    const find = text(arg(args, 1), "replace");
    if (find === "") return source;
    return checkedText(source.split(find).join(text(arg(args, 2), "replace")));
  }),
  slice: {
    minimum: 2,
    maximum: 3,
    call: (args) => {
      const source = text(arg(args, 0), "slice");
      const start = number(arg(args, 1), "slice");
      return args.length > 2 ? source.slice(start, number(arg(args, 2), "slice")) : source.slice(start);
    },
  },
  // Dates.
  now: fixed(0, (_args, environment) => formulaDate(environment.now.getTime(), false)),
  today: fixed(0, (_args, environment) => {
    const parsed = parseFormulaDate(environment.today);
    if (parsed === null) throw new FormulaError("Today's date is not known.");
    return parsed;
  }),
  date: fixed(1, (args) => {
    const value = arg(args, 0);
    if (isFormulaDate(value)) return value;
    const parsed = parseFormulaDate(text(value, "date"));
    if (parsed === null) throw new FormulaError(`"${formulaText(value)}" is not a date such as 2026-11-11.`);
    return parsed;
  }),
  dateAdd: fixed(3, (args) =>
    addToDate(date(arg(args, 0), "dateAdd"), number(arg(args, 1), "dateAdd"), unitOf(arg(args, 2), "dateAdd")),
  ),
  dateSubtract: fixed(3, (args) =>
    addToDate(
      date(arg(args, 0), "dateSubtract"),
      -number(arg(args, 1), "dateSubtract"),
      unitOf(arg(args, 2), "dateSubtract"),
    ),
  ),
  dateBetween: fixed(3, (args) =>
    between(date(arg(args, 0), "dateBetween"), date(arg(args, 1), "dateBetween"), unitOf(arg(args, 2), "dateBetween")),
  ),
  year: fixed(1, (args) => new Date(date(arg(args, 0), "year").time).getUTCFullYear()),
  month: fixed(1, (args) => new Date(date(arg(args, 0), "month").time).getUTCMonth() + 1),
  day: fixed(1, (args) => new Date(date(arg(args, 0), "day").time).getUTCDate()),
};

/** The names of the functions, for the help that the editor of a formula shows. */
export const FORMULA_FUNCTIONS: readonly string[] = ["prop", ...Object.keys(FUNCTIONS)];

function arithmetic(operator: "-" | "*" | "/" | "%" | "^", left: number, right: number): number {
  switch (operator) {
    case "-":
      return finite(left - right);
    case "*":
      return finite(left * right);
    case "/":
      if (right === 0) throw new FormulaError("Division by zero.");
      return finite(left / right);
    case "%":
      if (right === 0) throw new FormulaError("Division by zero.");
      return finite(left % right);
    case "^":
      return finite(left ** right);
  }
}

function evaluate(expression: Expression, environment: FormulaEnvironment, budget: Budget): FormulaValue {
  budget.step();
  switch (expression.type) {
    case "literal":
      return expression.value;
    case "unary": {
      const value = evaluate(expression.argument, environment, budget);
      return expression.operator === "-" ? finite(-number(value, "-")) : !truthy(value, "not");
    }
    case "binary": {
      const { operator } = expression;
      if (operator === "and" || operator === "or") {
        const left = truthy(evaluate(expression.left, environment, budget), operator);
        if (operator === "and" ? !left : left) return left;
        return truthy(evaluate(expression.right, environment, budget), operator);
      }
      const left = evaluate(expression.left, environment, budget);
      const right = evaluate(expression.right, environment, budget);
      switch (operator) {
        case "==":
          return equal(left, right);
        case "!=":
          return !equal(left, right);
        case "<":
          return compare(left, right) < 0;
        case "<=":
          return compare(left, right) <= 0;
        case ">":
          return compare(left, right) > 0;
        case ">=":
          return compare(left, right) >= 0;
        case "+":
          if (typeof left === "string" || typeof right === "string") {
            return checkedText(formulaText(left) + formulaText(right));
          }
          return finite(number(left, "+") + number(right, "+"));
        default:
          return arithmetic(operator, number(left, operator), number(right, operator));
      }
    }
    case "call": {
      const { name, args } = expression;
      if (name === "prop") {
        const [argument] = args;
        const property = argument?.type === "literal" && typeof argument.value === "string" ? argument.value : "";
        const value = environment.prop(property);
        if (value === undefined) throw new FormulaError(`There is no property called "${property}".`);
        return value;
      }
      if (name === "if") {
        const [condition, then, otherwise] = args;
        if (condition === undefined || then === undefined || otherwise === undefined) return null;
        return truthy(evaluate(condition, environment, budget), "if")
          ? evaluate(then, environment, budget)
          : evaluate(otherwise, environment, budget);
      }
      if (name === "and" || name === "or") {
        for (const argument of args) {
          const value = truthy(evaluate(argument, environment, budget), name);
          if (name === "and" ? !value : value) return value;
        }
        return name === "and";
      }
      const definition = FUNCTIONS[name];
      if (definition === undefined) throw new FormulaError(`There is no function called ${name}.`);
      const evaluated = args.map((argument) => evaluate(argument, environment, budget));
      // A function works through every element of a list it is given, one step for each.
      budget.step(evaluated.reduce<number>((total, value) => total + (Array.isArray(value) ? value.length : 0), 0));
      return definition.call(evaluated, environment, budget);
    }
  }
}

export type FormulaResult =
  | { readonly ok: true; readonly value: FormulaValue }
  | { readonly ok: false; readonly error: string };

/** Evaluates a compiled formula for one record. Never throws: a failure is the error of the result. */
export function evaluateFormula(formula: CompiledFormula, environment: FormulaEnvironment): FormulaResult {
  try {
    return { ok: true, value: evaluate(formula.expression, environment, new Budget()) };
  } catch (error) {
    if (error instanceof FormulaError) return { ok: false, error: error.message };
    if (error instanceof RangeError) return { ok: false, error: "The formula nests too deeply." };
    throw error;
  }
}
