// What the migration plan withholds until the maintainers have answered a question
// (docs/MIGRATION_PLAN.md, section 11), and where a run may write it all the same.
//
// | Output             | Question | What is withheld                                                              |
// |--------------------|----------|-------------------------------------------------------------------------------|
// | `candidateStudies` | 9        | The candidate documents of the three candidate tabs of the list of studies    |
// | `replicatedLabels` | 7        | The unverified outcome labels of the prediction-market hypotheses              |
// | `contributorLists` | 10       | The apply of a contributor sheet, whose lists every member could then read    |
// | `demographics`     | 20       | The apply of the membership workbook, which holds special-category data       |
//
// A real project never receives a withheld output. An answer of the maintainers lifts an entry
// here, in a reviewed change to this table, and nowhere else. An emulator receives one only when
// the private configuration of that emulator names it for rehearsal, so that a rehearsal with real
// exports is a decision of the operator and no accident.
import { ToolRefusal } from "../environment";

export const WITHHELD_OUTPUTS = {
  candidateStudies: { question: 9, what: "the candidate documents of the list of studies" },
  replicatedLabels: { question: 7, what: "the unverified outcome labels of the prediction-market hypotheses" },
  contributorLists: { question: 10, what: "the contributor lists, which every member could read," },
  demographics: { question: 20, what: "the member rows with their special-category data" },
} as const;

export type WithheldOutput = keyof typeof WITHHELD_OUTPUTS;

export const WITHHELD_OUTPUT_KEYS = Object.keys(WITHHELD_OUTPUTS) as readonly WithheldOutput[];

/** Where a run writes. */
export interface RunTarget {
  /** True for a real project, false for the emulators. */
  readonly production: boolean;
  /** The withheld outputs that the private configuration of an emulator names for rehearsal. */
  readonly rehearse: readonly WithheldOutput[];
}

/** The target of a run that names none: the emulators, with nothing rehearsed. */
export const DEFAULT_TARGET: RunTarget = { production: false, rehearse: [] };

/** Whether a run against a target writes a withheld output. */
export function writesWithheld(target: RunTarget, output: WithheldOutput): boolean {
  return !target.production && target.rehearse.includes(output);
}

/** Refuses the apply of an importer whose output as a whole is withheld from the target. */
export function requireReleased(target: RunTarget, output: WithheldOutput, sourceKey: string): void {
  if (writesWithheld(target, output)) return;
  const { question, what } = WITHHELD_OUTPUTS[output];
  throw new ToolRefusal(
    `Refusing to apply source ${sourceKey}: ${what} are withheld until the maintainers have answered question ${question} ` +
      "of docs/MIGRATION_PLAN.md, section 11. A preview is possible. " +
      (target.production
        ? "A real project receives them only after a reviewed change to the table of withheld outputs."
        : `An emulator receives them when its private configuration names "${output}" under "rehearse".`),
  );
}
