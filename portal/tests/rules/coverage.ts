// Reads the record that the Firestore emulator keeps of which rule expressions it evaluated,
// and with what result, so that a test can show that every allow statement of the rules file
// was both granted and refused.
import { FIRESTORE_URL } from "../support/emulators";
import type { AllowStatement } from "./rules-source";

interface CoverageValue {
  readonly value: { readonly boolValue?: boolean };
  readonly count: number;
}

interface CoverageNode {
  readonly sourcePosition?: { readonly currentOffset?: number };
  readonly values?: readonly CoverageValue[];
}

/** How often an expression was true and how often it was false. */
export interface Tally {
  granted: number;
  refused: number;
}

export interface RuleCoverage {
  /** The rules as the emulator holds them. */
  readonly source: string;
  /** The tally of the expression that starts at each offset of the source. */
  readonly byOffset: Map<number, Tally>;
}

/**
 * Adds the rule coverage that the Firestore emulator holds for a project to a running record.
 * The emulator keeps every distinct value of every expression, which grows without bound over
 * thousands of requests, so a long suite collects in steps and resets in between.
 */
export async function collectRuleCoverage(projectId: string, into: RuleCoverage | null = null): Promise<RuleCoverage> {
  const response = await fetch(`${FIRESTORE_URL}/emulator/v1/projects/${projectId}:ruleCoverage`);
  if (!response.ok) throw new Error(`The Firestore emulator gave no rule coverage: ${response.status}`);
  const body = (await response.json()) as {
    readonly rules?: { readonly files?: readonly { readonly content?: string }[] };
    readonly report?: readonly CoverageNode[];
  };
  const source = body.rules?.files?.[0]?.content ?? "";
  if (into !== null && into.source !== source) throw new Error("The rules changed while their coverage was collected.");
  const coverage = into ?? { source, byOffset: new Map<number, Tally>() };
  // The report holds one node for each allow condition and for the body of each function, and
  // beneath each the nodes of its parts. Only the outermost nodes are read here.
  for (const node of body.report ?? []) {
    const offset = node.sourcePosition?.currentOffset ?? 0;
    const tally = coverage.byOffset.get(offset) ?? { granted: 0, refused: 0 };
    for (const { value, count } of node.values ?? []) {
      if (value.boolValue === true) tally.granted += count;
      if (value.boolValue === false) tally.refused += count;
    }
    coverage.byOffset.set(offset, tally);
  }
  return coverage;
}

/** Loads the rules again, which is how the emulator is made to forget the coverage it holds. */
export async function resetRuleCoverage(projectId: string, source: string): Promise<void> {
  const response = await fetch(`${FIRESTORE_URL}/emulator/v1/projects/${projectId}:securityRules`, {
    method: "PUT",
    body: JSON.stringify({ rules: { files: [{ content: source }] } }),
  });
  if (!response.ok) throw new Error(`The Firestore emulator refused the rules: ${await response.text()}`);
}

/** How often the condition of a statement was true, and how often it was false. */
export function coverageOf(report: RuleCoverage, statement: AllowStatement): Tally {
  return report.byOffset.get(statement.conditionOffset) ?? { granted: 0, refused: 0 };
}
