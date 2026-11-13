// Authorship and acknowledgement (requirement R12.9): the list of a manuscript that its leads
// prepare from the imported contributor tables, the confirmation each person gives of their own
// entry, the ordering rule the list records, and the text a journal asks for.
import type {
  AuthorshipEntryDoc,
  AuthorshipListDoc,
  AuthorshipOrderingRule,
  ContributionRole,
  ContributorDoc,
  CreditRoleKey,
} from "../schemas/outputs";
import { CREDIT_ROLES } from "../seed/lookups";

/** The name of each CRediT role, in the order of the taxonomy. */
export const CREDIT_ROLE_NAMES: Readonly<Record<CreditRoleKey, string>> = Object.fromEntries(
  CREDIT_ROLES.map((role) => [role.key, role.name]),
) as Record<CreditRoleKey, string>;

/** The roles in the programme that a list records beside CRediT. */
export const CONTRIBUTION_ROLE_LABELS: Readonly<Record<ContributionRole, string>> = {
  dataCollection: "Data collection",
  recruitment: "Recruitment",
  analysis: "Analysis",
  writing: "Writing",
};

/** The ordering rules a list can state, in words. */
export const ORDERING_RULE_LABELS: Readonly<Record<AuthorshipOrderingRule, string>> = {
  contribution: "By contribution, as the leads ordered it",
  alphabetical: "Alphabetical by surname",
  leadsFirstThenAlphabetical: "Leads first, then alphabetical by surname",
  laboratoryGroups: "Grouped by laboratory",
  custom: "Another rule, stated in the note",
};

/**
 * What an imported contributor row says of its CRediT roles. A cell that the source stores as a
 * tick (the boolean true) gives the role. Any other value, such as a word or a note, is a source
 * value that nobody has interpreted, so it is listed for a lead to decide and never taken as a
 * role. An empty cell gives nothing.
 */
export function creditRolesFromRow(row: Pick<ContributorDoc, "creditRoles">): {
  readonly roles: readonly CreditRoleKey[];
  readonly toReview: readonly { readonly role: CreditRoleKey; readonly valueSource: string }[];
} {
  const roles: CreditRoleKey[] = [];
  const toReview: { role: CreditRoleKey; valueSource: string }[] = [];
  for (const { key } of CREDIT_ROLES) {
    const cell = row.creditRoles[key];
    if (cell === undefined || cell === false || cell === "") continue;
    if (cell === true) roles.push(key);
    else toReview.push({ role: key, valueSource: String(cell) });
  }
  return { roles, toReview };
}

/** The name of a contributor row from its verbatim parts, or null where the row names nobody. */
export function contributorRowName(
  row: Pick<ContributorDoc, "firstNameSource" | "middleNameSource" | "surnameSource">,
): string | null {
  const name = [row.firstNameSource, row.middleNameSource, row.surnameSource]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(" ");
  return name === "" ? null : name;
}

/** The surname of a display name: its last word, for alphabetical rules. */
export function surnameOf(displayName: string): string {
  const words = displayName.trim().split(/\s+/u);
  return words.at(-1) ?? displayName;
}

type Orderable = Pick<AuthorshipEntryDoc, "displayName" | "position">;

/**
 * Orders entries by an ordering rule. `contribution`, `laboratoryGroups` and `custom` keep the
 * positions the leads gave. `alphabetical` orders by surname, then by the whole name.
 * `leadsFirstThenAlphabetical` keeps the entries marked as leads first, in their positions, and
 * orders the others by surname.
 */
export function orderEntries<T extends Orderable>(
  entries: readonly T[],
  rule: AuthorshipOrderingRule,
  isLead: (entry: T) => boolean = () => false,
): T[] {
  const byPosition = [...entries].sort((a, b) => a.position - b.position);
  const alphabetical = (list: readonly T[]) =>
    [...list].sort(
      (a, b) =>
        surnameOf(a.displayName).localeCompare(surnameOf(b.displayName), "en-GB", { sensitivity: "base" }) ||
        a.displayName.localeCompare(b.displayName, "en-GB"),
    );
  if (rule === "alphabetical") return alphabetical(byPosition);
  if (rule === "leadsFirstThenAlphabetical") {
    return [...byPosition.filter(isLead), ...alphabetical(byPosition.filter((entry) => !isLead(entry)))];
  }
  return byPosition;
}

/** The state of a list's confirmations: how many entries are confirmed, pending or contested. */
export interface ConfirmationSummary {
  readonly total: number;
  readonly confirmed: number;
  readonly pending: number;
  readonly changesRequested: number;
}

/**
 * Counts the confirmations of a list. An entry counts as confirmed only while its confirmation
 * names its current revision: a confirmation of an earlier revision says nothing of the entry as
 * it reads now.
 */
export function confirmationSummary(
  entries: readonly Pick<AuthorshipEntryDoc, "entryRevision" | "confirmation">[],
): ConfirmationSummary {
  let confirmed = 0;
  let changesRequested = 0;
  for (const entry of entries) {
    const state = entryConfirmation(entry);
    if (state === "confirmed") confirmed += 1;
    else if (state === "changesRequested") changesRequested += 1;
  }
  return { total: entries.length, confirmed, pending: entries.length - confirmed - changesRequested, changesRequested };
}

/** The confirmation of an entry as it reads now: one of an earlier revision is pending again. */
export function entryConfirmation(
  entry: Pick<AuthorshipEntryDoc, "entryRevision" | "confirmation">,
): "pending" | "confirmed" | "changesRequested" {
  if (entry.confirmation.status === "pending" || entry.confirmation.revision !== entry.entryRevision) return "pending";
  return entry.confirmation.status;
}

/** The fields of an entry that its person confirms. A change to any of them asks for a new confirmation. */
export const CONFIRMED_ENTRY_FIELDS = [
  "kind",
  "displayName",
  "affiliations",
  "orcid",
  "creditRoles",
  "contributionRoles",
  "isCorresponding",
  "position",
] as const satisfies readonly (keyof AuthorshipEntryDoc)[];

/** Whether two versions of an entry differ in what its person confirms. */
export function entryChanged(
  before: Pick<AuthorshipEntryDoc, (typeof CONFIRMED_ENTRY_FIELDS)[number]>,
  after: Pick<AuthorshipEntryDoc, (typeof CONFIRMED_ENTRY_FIELDS)[number]>,
): boolean {
  return CONFIRMED_ENTRY_FIELDS.some((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
}

export interface AuthorshipTextOptions {
  /** The title of the manuscript, which heads the text. */
  readonly title: string;
}

/**
 * The authorship of a manuscript as plain text that a journal's submission system accepts: the
 * author line with numbered affiliations and the corresponding author marked, the affiliations,
 * the ORCID iDs, a CRediT statement, the contributions in the programme, and the
 * acknowledgements. Entries keep their stored positions, which the save sets by the list's rule. Nothing is added that the list
 * does not hold: an author without an affiliation has no number, and one without an iD is left
 * out of the iDs.
 */
export function authorshipText(
  list: Pick<AuthorshipListDoc, "orderingRule" | "orderingNote">,
  entries: readonly AuthorshipEntryDoc[],
  options: AuthorshipTextOptions,
): string {
  // The save stores each position as the list's rule places the person (the replication's leads
  // first where the rule says so), so the stored order is the order to export.
  const inOrder = (kind: AuthorshipEntryDoc["kind"]) =>
    entries.filter((entry) => entry.kind === kind).sort((a, b) => a.position - b.position);
  const authors = inOrder("author");
  const acknowledged = inOrder("acknowledgement");

  const affiliations: string[] = [];
  const numberOf = (affiliation: string) => {
    const index = affiliations.indexOf(affiliation);
    if (index >= 0) return index + 1;
    affiliations.push(affiliation);
    return affiliations.length;
  };
  const authorLine = authors
    .map((author) => {
      const numbers = author.affiliations.map(numberOf);
      const marks = [...(numbers.length === 0 ? [] : [numbers.join(",")]), ...(author.isCorresponding ? ["*"] : [])];
      return marks.length === 0 ? author.displayName : `${author.displayName} [${marks.join(" ")}]`;
    })
    .join(", ");

  const lines: string[] = [options.title, "", "Authors", authorLine === "" ? "No authors are listed." : authorLine];
  if (affiliations.length > 0) {
    lines.push("", "Affiliations", ...affiliations.map((affiliation, index) => `${index + 1}. ${affiliation}`));
  }
  const corresponding = authors.filter((author) => author.isCorresponding);
  if (corresponding.length > 0) {
    lines.push(
      "",
      `* Corresponding ${corresponding.length === 1 ? "author" : "authors"}: ${corresponding.map((author) => author.displayName).join(", ")}`,
    );
  }
  const identified = authors.filter((author) => author.orcid !== undefined);
  if (identified.length > 0) {
    lines.push(
      "",
      "ORCID iDs",
      ...identified.map((author) => `${author.displayName}: https://orcid.org/${author.orcid}`),
    );
  }
  const credited = authors.filter((author) => author.creditRoles.length > 0);
  if (credited.length > 0) {
    lines.push(
      "",
      "Author contributions (CRediT)",
      ...credited.map(
        (author) =>
          `${author.displayName}: ${CREDIT_ROLES.filter((role) => author.creditRoles.includes(role.key))
            .map((role) => role.name)
            .join(", ")}.`,
      ),
    );
  }
  const contributing = authors.filter((author) => author.contributionRoles.length > 0);
  if (contributing.length > 0) {
    lines.push(
      "",
      "Contributions to the replication",
      ...contributing.map(
        (author) =>
          `${author.displayName}: ${author.contributionRoles.map((role) => CONTRIBUTION_ROLE_LABELS[role].toLowerCase()).join(", ")}.`,
      ),
    );
  }
  if (acknowledged.length > 0) {
    const names = acknowledged.map((entry) => {
      const roles = entry.contributionRoles.map((role) => CONTRIBUTION_ROLE_LABELS[role].toLowerCase());
      return roles.length === 0 ? entry.displayName : `${entry.displayName} (${roles.join(", ")})`;
    });
    lines.push("", "Acknowledgements", `We thank ${joinNames(names)} for their contributions.`);
  }
  lines.push(
    "",
    `Author order: ${ORDERING_RULE_LABELS[list.orderingRule]}.${list.orderingNote === undefined ? "" : ` ${list.orderingNote}`}`,
  );
  return `${lines.join("\n")}\n`;
}

/** Names joined as a sentence: "A", "A and B", "A, B and C". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
