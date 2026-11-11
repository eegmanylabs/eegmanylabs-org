// The formula language: parsing, every operator and function, the errors a person can make, and
// the limits that keep one formula from holding up a view. The values are synthetic.
import { describe, expect, it } from "vitest";
import {
  compileFormula,
  evaluateFormula,
  FORMULA_MAX_DEPTH,
  FORMULA_MAX_STEPS,
  FORMULA_MAX_TEXT,
  FormulaError,
  type FormulaValue,
  formatFormulaDate,
  formulaText,
  isFormulaDate,
  parseFormulaDate,
} from "./formula";
import { FORMULA_MAX_LENGTH } from "./model";

const values: Readonly<Record<string, FormulaValue>> = {
  Target: 40,
  Recruited: 25,
  Done: 3,
  Total: 12,
  Name: "Synthetic Laboratory",
  Due: parseFormulaDate("2026-11-21"),
  Started: parseFormulaDate("2026-01-31"),
  Ticked: true,
  Tags: ["eeg", "pilot"],
  Nothing: null,
};

const environment = {
  prop: (name: string) => values[name],
  now: new Date("2026-11-11T09:30:00Z"),
  today: "2026-11-11",
};

function run(source: string): FormulaValue {
  const result = evaluateFormula(compileFormula(source), environment);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function failure(source: string): string {
  const result = evaluateFormula(compileFormula(source), environment);
  if (result.ok) throw new Error(`Expected an error, got ${formulaText(result.value)}`);
  return result.error;
}

function parseError(source: string): string {
  try {
    compileFormula(source);
  } catch (error) {
    if (error instanceof FormulaError) return error.message;
    throw error;
  }
  throw new Error("Expected a parse error");
}

describe("the formulas the programme needs", () => {
  it("computes a completion percentage", () => {
    expect(run('round(prop("Done") / prop("Total") * 100)')).toBe(25);
    expect(run('round(prop("Done") / prop("Total") * 100, 1)')).toBe(25);
  });

  it("computes the remaining participants, never below zero", () => {
    expect(run('max(prop("Target") - prop("Recruited"), 0)')).toBe(15);
    expect(run('if(empty(prop("Nothing")), null, prop("Target") - prop("Nothing"))')).toBeNull();
  });

  it("computes the days to a due date", () => {
    expect(run('dateBetween(prop("Due"), today(), "days")')).toBe(10);
    expect(run('dateBetween(today(), prop("Due"), "days")')).toBe(-10);
  });
});

describe("parsing", () => {
  it("respects precedence and associativity", () => {
    expect(run("1 + 2 * 3")).toBe(7);
    expect(run("(1 + 2) * 3")).toBe(9);
    expect(run("2 ^ 3 ^ 2")).toBe(512);
    expect(run("-2 ^ 2")).toBe(-4);
    expect(run("10 - 4 - 3")).toBe(3);
    expect(run("7 % 4")).toBe(3);
    expect(run("1 < 2 and 2 < 3 or false")).toBe(true);
    expect(run("not 1 == 2")).toBe(true);
    expect(run("!false && true || false")).toBe(true);
  });

  it("reads numbers, texts with escapes, and the literal names", () => {
    expect(run("1.5e2")).toBe(150);
    expect(run(".5")).toBe(0.5);
    expect(run('"a \\"quoted\\" word"')).toBe('a "quoted" word');
    expect(run("'single'")).toBe("single");
    expect(run('"line\\nbreak"')).toBe("line\nbreak");
    expect(run("true")).toBe(true);
    expect(run("null")).toBeNull();
  });

  it("collects the properties a formula refers to", () => {
    expect(compileFormula('prop("Done") / prop("Total") + prop("Done")').references).toEqual(["Done", "Total"]);
  });

  it("explains each mistake in words", () => {
    expect(parseError("")).toBe("The formula is empty.");
    expect(parseError("1 +")).toBe("The formula ends too early.");
    expect(parseError("(1 + 2")).toMatch(/Expected "\)"/);
    expect(parseError('"open')).toMatch(/is not closed/);
    expect(parseError("1 $ 2")).toMatch(/"\$" at position 3/);
    expect(parseError("Target + 1")).toMatch(/prop\("Target"\)/);
    expect(parseError("nosuch(1)")).toBe("There is no function called nosuch.");
    expect(parseError("round()")).toBe("round takes 1 to 2 arguments.");
    expect(parseError("if(true, 1)")).toBe("if takes 3 arguments.");
    expect(parseError("prop(Target)")).toMatch(/Refer to a property|prop takes/);
    expect(parseError('prop("a", "b")')).toMatch(/prop takes the name/);
    expect(parseError("1 2")).toMatch(/Unexpected text/);
    expect(parseError("max(1 2)")).toMatch(/Expected "," or "\)"/);
    expect(parseError(")")).toMatch(/Unexpected "\)"/);
  });

  it("refuses an expression that is too long or nests too deeply", () => {
    expect(parseError("1".repeat(FORMULA_MAX_LENGTH + 1))).toMatch(/at most/);
    const deep = `${"(".repeat(FORMULA_MAX_DEPTH + 2)}1${")".repeat(FORMULA_MAX_DEPTH + 2)}`;
    expect(parseError(deep)).toMatch(/nests at most/);
    const shallow = `${"(".repeat(10)}1${")".repeat(10)}`;
    expect(run(shallow)).toBe(1);
  });
});

describe("evaluation", () => {
  it("compares values of the same kind and refuses to compare different kinds", () => {
    expect(run('"a" < "b"')).toBe(true);
    expect(run('prop("Due") > prop("Started")')).toBe(true);
    expect(run("true > false")).toBe(true);
    expect(run('prop("Tags") == prop("Tags")')).toBe(true);
    expect(run('1 != "1"')).toBe(true);
    expect(failure('1 < "2"')).toBe("a number cannot be compared with a text.");
  });

  it("joins texts with + and adds numbers", () => {
    expect(run('"Lab " + 3')).toBe("Lab 3");
    expect(run('prop("Name") + ": " + prop("Ticked")')).toBe("Synthetic Laboratory: true");
    expect(run("0.1 + 0.2")).toBeCloseTo(0.3);
    expect(failure("true + 1")).toMatch(/needs a number/);
  });

  it("reports arithmetic that has no answer", () => {
    expect(failure("1 / 0")).toBe("Division by zero.");
    expect(failure("1 % 0")).toBe("Division by zero.");
    expect(failure("10 ^ 400")).toBe("The result is not a finite number.");
    expect(failure("sqrt(-1)")).toMatch(/not negative/);
  });

  it("evaluates if, and and or lazily", () => {
    expect(run("if(true, 1, 1 / 0)")).toBe(1);
    expect(run("false and 1 / 0 == 1")).toBe(false);
    expect(run("true or 1 / 0 == 1")).toBe(true);
    expect(run("and(true, true, false)")).toBe(false);
    expect(run("or(false, false, true)")).toBe(true);
    expect(failure('if("yes", 1, 2)')).toMatch(/needs true or false/);
  });

  it("offers the functions on numbers", () => {
    expect(run("abs(-3)")).toBe(3);
    expect(run("floor(2.7) + ceil(2.1)")).toBe(5);
    expect(run("round(2.345, 2)")).toBe(2.35);
    expect(run("min(3, 1, 2)")).toBe(1);
    expect(run("max(3, 1, 2)")).toBe(3);
    expect(run("sum(1, 2, 3)")).toBe(6);
    expect(run("sqrt(9)")).toBe(3);
    expect(run('toNumber("42")')).toBe(42);
    expect(run("toNumber(true)")).toBe(1);
    expect(failure('toNumber("many")')).toMatch(/is not a number/);
    expect(failure("round(1, 11)")).toMatch(/decimal places/);
    expect(run('min(prop("Nothing"))')).toBeNull();
  });

  it("offers the functions on texts and lists", () => {
    expect(run('concat("a", 1, true)')).toBe("a1true");
    expect(run('length("abcd")')).toBe(4);
    expect(run('length(prop("Tags"))')).toBe(2);
    expect(run('lower("ABC") + upper("def")')).toBe("abcDEF");
    expect(run('trim("  x  ")')).toBe("x");
    expect(run('contains(prop("Name"), "laboratory")')).toBe(true);
    expect(run('contains(prop("Tags"), "pilot")')).toBe(true);
    expect(run('replace("a-b-c", "-", "+")')).toBe("a+b+c");
    expect(run('replace("abc", "", "+")')).toBe("abc");
    expect(run('slice("abcdef", 1, 3)')).toBe("bc");
    expect(run('slice("abcdef", 4)')).toBe("ef");
    expect(run('format(prop("Tags"))')).toBe("eeg, pilot");
    expect(run("format(1 / 3)")).toBe("0.3333333333");
    expect(run('empty("")')).toBe(true);
    expect(run("empty(0)")).toBe(false);
    expect(failure("lower(1)")).toBe("lower needs a text, and was given a number.");
  });

  it("offers the functions on dates", () => {
    const due = run('dateAdd(prop("Started"), 1, "months")');
    expect(isFormulaDate(due) && formatFormulaDate(due)).toBe("2026-03-03");
    const back = run('dateSubtract(date("2026-03-31"), 1, "month")');
    expect(isFormulaDate(back) && formatFormulaDate(back)).toBe("2026-03-03");
    expect(run('dateBetween(date("2026-11-11"), date("2025-11-12"), "years")')).toBe(0);
    expect(run('dateBetween(date("2026-11-11"), date("2025-11-11"), "years")')).toBe(1);
    expect(run('dateBetween(date("2026-11-11"), date("2026-09-12"), "months")')).toBe(1);
    expect(run('dateBetween(date("2026-11-11"), date("2026-10-28"), "weeks")')).toBe(2);
    expect(run('dateBetween(now(), date("2026-11-11"), "hours")')).toBe(9);
    expect(run('dateBetween(now(), date("2026-11-11"), "minutes")')).toBe(570);
    expect(run('year(prop("Due")) * 100 + month(prop("Due"))')).toBe(202611);
    expect(run('day("2026-11-21")')).toBe(21);
    expect(run('format(dateAdd(today(), 2, "days"))')).toBe("2026-11-13");
    expect(run('format(dateAdd(now(), 30, "minutes"))')).toBe("2026-11-11T10:00:00.000Z");
    expect(failure('dateAdd(today(), 1.5, "days")')).toMatch(/whole number/);
    expect(failure('dateAdd(today(), 1, "fortnights")')).toMatch(/units/);
    expect(failure('date("tomorrow")')).toMatch(/is not a date/);
    expect(failure("year(5)")).toMatch(/needs a date/);
  });

  it("reports a property that does not exist", () => {
    expect(failure('prop("Missing")')).toBe('There is no property called "Missing".');
  });
});

describe("limits", () => {
  it("stops a formula that takes too many steps", () => {
    // A list costs one step for each of its elements wherever a function is given it.
    const huge = Array.from({ length: FORMULA_MAX_STEPS + 1 }, (_, index) => index);
    const listing = { ...environment, prop: () => huge };
    expect(evaluateFormula(compileFormula('length(prop("L"))'), listing)).toEqual({
      ok: false,
      error: "The formula takes too many steps.",
    });
    const small = { ...environment, prop: () => huge.slice(0, 100) };
    expect(evaluateFormula(compileFormula('length(prop("L"))'), small)).toEqual({ ok: true, value: 100 });
  });

  it("stops a formula that takes too long", () => {
    const slow = {
      ...environment,
      prop: () => {
        const until = Date.now() + 2;
        while (Date.now() < until) {
          // Waits for two milliseconds, as a slow lookup would.
        }
        return 1;
      },
    };
    const source = `sum(${Array.from({ length: 150 }, () => 'prop("S")').join(", ")})`;
    expect(evaluateFormula(compileFormula(source), slow)).toEqual({ ok: false, error: "The formula takes too long." });
  });

  it("stops a formula whose text grows beyond the limit", () => {
    const source = `concat(${Array.from({ length: 11 }, () => 'prop("Big")').join(", ")})`;
    const big = { ...environment, prop: (name: string) => (name === "Big" ? "y".repeat(1_000) : values[name]) };
    const result = evaluateFormula(compileFormula(source), big);
    expect(result).toEqual({ ok: false, error: `A text holds at most ${FORMULA_MAX_TEXT} characters.` });
  });
});

describe("dates as values", () => {
  it("reads ISO dates and instants and nothing else", () => {
    expect(parseFormulaDate("2026-11-11")).toEqual({ kind: "date", time: Date.UTC(2026, 10, 11), dateOnly: true });
    expect(parseFormulaDate("2026-11-11T12:00:00Z")?.dateOnly).toBe(false);
    expect(parseFormulaDate("11/11/2026")).toBeNull();
    expect(parseFormulaDate("2026-13-45")).toBeNull();
  });
});
