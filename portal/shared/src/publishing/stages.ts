// The stages of a replication as the public website knows them (docs/INTEGRATIONS.md, section 6).
// The site builds the class and the filter of a card from `StageNumber` and `StageName` joined by
// an underscore (`archetypes/replications.md`, `theme/templates/replication_card.jinja2`), and its
// filter chips name exactly these pairs (`theme/templates/page.jinja2`), so a value outside this
// list would give a card a class that no filter matches and an empty stage tag. `LongStageText` is
// the tag the card shows. The texts are those of the committed `data/replications.tsv`.

export interface WebsiteStage {
  readonly number: number;
  readonly key: string;
  readonly longText: string;
}

export const WEBSITE_STAGES: readonly WebsiteStage[] = [
  { number: 4, key: "stage1_prep", longText: "Stage 1 Registered report in preparation" },
  { number: 5, key: "stage1_review", longText: "Stage 1 Registered report under review" },
  { number: 6, key: "data_collection", longText: "IPA acquired. Data collection ongoing" },
  { number: 7, key: "stage2_prep", longText: "Data collected. Stage 2 RR in preparation" },
  { number: 9, key: "finished", longText: "Finished" },
];

/** The stage of the website a key names, or null where the website does not know the key. */
export function websiteStageOf(key: string | undefined): WebsiteStage | null {
  return key === undefined ? null : (WEBSITE_STAGES.find((stage) => stage.key === key) ?? null);
}

/** Whether a pair of cells of `data/replications.tsv` names a stage the website knows. */
export function isWebsiteStagePair(stageNumber: string, stageName: string): boolean {
  return WEBSITE_STAGES.some((stage) => String(stage.number) === stageNumber && stage.key === stageName);
}
