// What the migration plan withheld until the maintainers had answered a question
// (docs/MIGRATION_PLAN.md, section 11), and where a run may write it all the same. The programme
// lead answered on 13 November 2026, and an answer that lets an output through releases it here.
//
// | Output             | Question | What                                                                    | Since the answers                     |
// |--------------------|----------|-------------------------------------------------------------------------|---------------------------------------|
// | `candidateStudies` | 9        | The candidate documents of the three candidate tabs of the list of studies | Withheld: the candidates stay archived in the source records |
// | `replicatedLabels` | 7        | The unverified outcome labels of the prediction-market hypotheses       | Released, sealed for programme administrators |
// | `predictionMarketMaterial` | 7 | The links to the market's study description and information sheet, and the null-significance labels of the hypotheses | Withheld: whether these are prediction-market data, which no one may see, is asked of the programme lead |
// | `contributorLists` | 10       | The apply of a contributor sheet                                         | Released, read by the team of the replication |
// | `demographics`     | 20       | The apply of the membership workbook, which holds special-category data | Released: values are stored only for a person whose consent the portal records, and discarded for everyone else |
//
// A real project never receives a withheld output. An answer of the maintainers lifts an entry
// here, in a reviewed change to this table, and nowhere else. An emulator receives one only when
// the private configuration of that emulator names it for rehearsal, so that a rehearsal with real
// exports is a decision of the operator and no accident. A released output is written by every run.
import {
  CONTRIBUTOR_LISTS_DECISION,
  DEMOGRAPHICS_CONSENT_DECISION,
  type ProgrammeDecision,
  SEALED_OUTCOMES_DECISION,
} from "@eegml/shared";
import { ToolRefusal } from "../environment";

interface WithheldOutputEntry {
  readonly question: number;
  readonly what: string;
  /** The decision that released the output, where one has. */
  readonly releasedBy: ProgrammeDecision | null;
}

export const WITHHELD_OUTPUTS = {
  candidateStudies: { question: 9, what: "the candidate documents of the list of studies", releasedBy: null },
  replicatedLabels: {
    question: 7,
    what: "the unverified outcome labels of the prediction-market hypotheses",
    releasedBy: SEALED_OUTCOMES_DECISION,
  },
  predictionMarketMaterial: {
    question: 7,
    what: "the links to the study descriptions and information sheets of the prediction market and the null-significance labels of its hypotheses",
    releasedBy: null,
  },
  contributorLists: { question: 10, what: "the contributor lists", releasedBy: CONTRIBUTOR_LISTS_DECISION },
  demographics: {
    question: 20,
    what: "the member rows with their special-category data",
    releasedBy: DEMOGRAPHICS_CONSENT_DECISION,
  },
} as const satisfies Record<string, WithheldOutputEntry>;

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

/** Whether a run against a target writes a withheld output. A released output is written by every run. */
export function writesWithheld(target: RunTarget, output: WithheldOutput): boolean {
  if (WITHHELD_OUTPUTS[output].releasedBy !== null) return true;
  return !target.production && target.rehearse.includes(output);
}

/** Refuses the apply of an importer whose output as a whole is withheld from the target. */
export function requireReleased(target: RunTarget, output: WithheldOutput, sourceKey: string): void {
  if (writesWithheld(target, output)) return;
  const { question, what } = WITHHELD_OUTPUTS[output];
  throw new ToolRefusal(
    `Refusing to apply source ${sourceKey}: ${what} are withheld under the answer to question ${question} ` +
      "of docs/MIGRATION_PLAN.md, section 11. A preview is possible. " +
      (target.production
        ? "A real project receives them only after a reviewed change to the table of withheld outputs."
        : `An emulator receives them when its private configuration names "${output}" under "rehearse".`),
  );
}
