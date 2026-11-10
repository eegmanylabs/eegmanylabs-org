// Source F: the recruitment and contact workbook (docs/MIGRATION_PLAN.md, section 4.6). Two
// summary tabs with one row for each study, and 21 outreach tabs with one row for each person
// who was contacted, most of them hidden. Nearly all of it is personal data: the outreach rows
// are written as restricted outreach contacts, an address reaches a restricted document or the
// email index and nothing else, and no name, address or cell content is ever printed.
//
// The reading and the planning are in recruitment-workbook.ts and recruitment-plan.ts, which
// take the source key as a parameter. What belongs to this source alone is the reviewed table
// of its tabs below.
import type { ImporterDefinition } from "../model";
import { planRecruitmentWorkbook, type RecruitmentWorkbookDefinition, type ReviewedTab } from "../recruitment-plan";
import { readRecruitmentWorkbook } from "../recruitment-workbook";

const outreach = (title: string, studyId: string | null): ReviewedTab => ({ title, kind: "outreach", studyId });

/**
 * The reviewed table of tabs, keyed by the exact title (docs/SOURCE_REGISTRY.md, section 3.6).
 * A title is a label that cannot be resolved by its spelling: two titles differ by an underscore
 * alone, two are cut at 31 characters, one carries a diacritic that its study identifier lacks,
 * and one runs two years together. The workbook must hold exactly these tabs. A tab that is
 * missing, renamed or new stops the import, and a reviewer adds it here.
 *
 * | Title that departs from its study identifier | Study                          |
 * |----------------------------------------------|--------------------------------|
 * | A suffix ` lead`, `_labs` or `_`             | The identifier before it       |
 * | A title cut at 31 characters                 | The identifier it begins with  |
 * | `Müller2003 replicating labs sea`            | `Muller2003`                   |
 * | `AmodioMaster20072008`                       | None: it waits for a maintainer |
 */
const TABS: readonly ReviewedTab[] = [
  { title: "numberOfLabsPerReplication", kind: "counts" },
  { title: "leadsEmails", kind: "leads" },
  outreach("Vidal2000", "Vidal2000"),
  outreach("Vidal2000_", "Vidal2000"),
  outreach("DonkersvanBoxtel2004 lead", "DonkersvanBoxtel2004"),
  outreach("DonkersvanBoxtel2004", "DonkersvanBoxtel2004"),
  outreach("Frank2005 lead", "Frank2005"),
  outreach("Frank2005", "Frank2005"),
  outreach("Boksem2006", "Boksem2006"),
  outreach("Boksem2006_labs", "Boksem2006"),
  outreach("Miltner1999", "Miltner1999"),
  outreach("Miltner1999 replicating labs se", "Miltner1999"),
  outreach("Onton2005 lead", "Onton2005"),
  outreach("Onton2005", "Onton2005"),
  outreach("BuschVanRullen2010", "BuschVanRullen2010"),
  outreach("Luck1996", "Luck1996"),
  outreach("Carretie2004", "Carretie2004"),
  outreach("Müller2003 replicating labs sea", "Muller2003"),
  outreach("AmodioMaster20072008", null),
  outreach("DelCul2007", "DelCul2007"),
  outreach("Inzlicht2009", "Inzlicht2009"),
  outreach("Hajcak2006", "Hajcak2006"),
  outreach("HajcakMoser2005", "HajcakMoser2005"),
];

export const RECRUITMENT_WORKBOOK: RecruitmentWorkbookDefinition = { sourceKey: "f", tabs: TABS };

export const importer: ImporterDefinition = {
  key: "recruitmentContacts",
  sourceKey: RECRUITMENT_WORKBOOK.sourceKey,
  summary:
    "Recruitment and contact workbook: study-level figures, lead claims and the restricted outreach correspondence.",
  inputDescription: "the Excel export of the workbook",
  // Its figures, leads and tabs are those of studies, all of which exist once the list of studies has been applied.
  after: ["h", "d"],
  read: readRecruitmentWorkbook,
  plan: (context) => planRecruitmentWorkbook(RECRUITMENT_WORKBOOK, context),
};
