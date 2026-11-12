// The templates of generated Google Docs (docs/INTEGRATIONS.md, section 3.5) and the text of
// their managed sections. A template is an ordinary document kept by people, in which each
// managed section is a paragraph holding nothing but its tag, such as `{{portal:overview}}`.
// The portal writes only inside the sections it created and still recognises, and every section
// ends with its provenance: the portal records it was drawn from, the report date and a link.
//
// Rendering is pure: the functions read the records and pass them here as plain data, so the
// text of a section is the same wherever it is produced and is tested without a document.
import type { EntityType } from "../entities";

/**
 * | Kind                  | Generated for  | Sections                                   |
 * |-----------------------|----------------|--------------------------------------------|
 * | `programmeProgress`   | The programme  | A summary, and one line for each replication |
 * | `replicationProgress` | A replication  | An overview, and its laboratories           |
 * | `laboratoryProgress`  | A laboratory   | Its profile, its participations and its equipment |
 * | `recruitment`         | A replication  | Recruitment of each laboratory, from the recruitment resolver |
 * | `meetings`            | A replication  | Its meetings                                |
 * | `milestones`          | A replication  | The milestones of its task lists            |
 */
export const DOCUMENT_TEMPLATE_KINDS = [
  "programmeProgress",
  "replicationProgress",
  "laboratoryProgress",
  "recruitment",
  "meetings",
  "milestones",
] as const;
export type DocumentTemplateKind = (typeof DOCUMENT_TEMPLATE_KINDS)[number];

export interface TemplateSection {
  readonly name: string;
  readonly label: string;
  /**
   * The one text field of the record that the section is drawn from, where a reviewer may take
   * a hand edit of the section back into the record. No other section is ever read back.
   */
  readonly designatedField?: string;
}

/**
 * Who reads a generated document of a kind, in the portal. `members` is every member as well as
 * the record's team. `team` is the record's own scope and programme staff alone, for a kind whose
 * text draws on records that members outside the team may not read: each laboratory's
 * recruitment, and meeting pages and milestones whose audience is the replication's team. The
 * sharing of the target folder in Google must not go beyond this audience
 * (docs/INTEGRATIONS.md, section 3.5).
 */
export type GeneratedDocumentAudience = "members" | "team";

export interface DocumentTemplateDefinition {
  readonly kind: DocumentTemplateKind;
  readonly name: string;
  readonly entityType: Extract<EntityType, "programme" | "replication" | "laboratory">;
  readonly audience: GeneratedDocumentAudience;
  readonly sections: readonly TemplateSection[];
}

export const DOCUMENT_TEMPLATES: Readonly<Record<DocumentTemplateKind, DocumentTemplateDefinition>> = {
  programmeProgress: {
    kind: "programmeProgress",
    name: "Programme progress",
    entityType: "programme",
    audience: "members",
    sections: [
      { name: "summary", label: "Summary" },
      { name: "replications", label: "Replications" },
    ],
  },
  replicationProgress: {
    kind: "replicationProgress",
    name: "Replication progress",
    entityType: "replication",
    audience: "members",
    sections: [
      { name: "overview", label: "Overview" },
      { name: "laboratories", label: "Laboratories" },
    ],
  },
  laboratoryProgress: {
    kind: "laboratoryProgress",
    name: "Laboratory progress",
    entityType: "laboratory",
    audience: "members",
    sections: [
      { name: "profile", label: "Profile", designatedField: "description" },
      { name: "participations", label: "Participations" },
      { name: "equipment", label: "Equipment" },
    ],
  },
  recruitment: {
    kind: "recruitment",
    name: "Recruitment",
    entityType: "replication",
    audience: "team",
    sections: [{ name: "recruitment", label: "Recruitment by laboratory" }],
  },
  meetings: {
    kind: "meetings",
    name: "Meetings",
    entityType: "replication",
    audience: "team",
    sections: [{ name: "meetings", label: "Meetings" }],
  },
  milestones: {
    kind: "milestones",
    name: "Milestones",
    entityType: "replication",
    audience: "team",
    sections: [{ name: "milestones", label: "Milestones" }],
  },
};

/** The tag that marks where a managed section goes in a template. */
export function sectionTag(name: string): string {
  return `{{portal:${name}}}`;
}

/** The name of the named range that anchors a managed section once it has been adopted. */
export function sectionRangeName(name: string): string {
  return `portal:${name}`;
}

/** Where a section's figures come from, and when. Every section ends with it. */
export interface Provenance {
  /** The calendar date the report describes. */
  readonly reportDate: string;
  /** The address of the record in the portal. */
  readonly portalUrl: string;
  /** The kinds of portal record the section is drawn from, in words. */
  readonly sources: readonly string[];
}

const PROVENANCE_PREFIX = "Source: ";

/** The last line of every managed section. */
export function provenanceLine(provenance: Provenance): string {
  return `${PROVENANCE_PREFIX}${provenance.sources.join(", ")} in the EEGManyLabs portal, as of ${provenance.reportDate}. ${provenance.portalUrl}`;
}

/**
 * The text a person wrote in a section bound to a designated field: the section without its
 * provenance line, where that line is still the last one.
 */
export function withoutProvenance(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const last = lines.at(-1) ?? "";
  return (last.startsWith(PROVENANCE_PREFIX) ? lines.slice(0, -1) : lines).join("\n").trim();
}

/** A recruitment figure of one basis. Null is unknown, which is written as such and never as zero. */
export interface BasisFigure {
  readonly reported: number | null;
  readonly verified: number | null;
}

export type TemplateData =
  | {
      readonly kind: "programmeProgress";
      readonly replications: readonly {
        readonly studyKey: string;
        readonly title: string | null;
        readonly status: string | null;
        readonly laboratories: number;
      }[];
    }
  | {
      readonly kind: "replicationProgress";
      readonly studyKey: string;
      readonly title: string | null;
      readonly status: string | null;
      readonly publicStage: string | null;
      readonly participations: readonly { readonly laboratory: string; readonly status: string }[];
    }
  | {
      readonly kind: "laboratoryProgress";
      readonly name: string;
      readonly description: string | null;
      readonly participations: readonly { readonly replication: string; readonly status: string }[];
      readonly equipment: readonly {
        readonly name: string;
        readonly channelCount: number | null;
        readonly samplingRatesHz: readonly number[];
      }[];
    }
  | {
      readonly kind: "recruitment";
      readonly asOfDate: string;
      /** The category the figures count, by its label. */
      readonly category: string;
      readonly sites: readonly {
        readonly laboratory: string;
        readonly main: BasisFigure;
        readonly rest: BasisFigure;
        readonly participants: BasisFigure;
      }[];
    }
  | {
      readonly kind: "meetings";
      readonly meetings: readonly { readonly title: string; readonly date: string | null; readonly url: string }[];
    }
  | {
      readonly kind: "milestones";
      readonly milestones: readonly {
        readonly title: string;
        readonly dueDate: string | null;
        readonly status: string;
      }[];
    };

const UNKNOWN = "unknown";
const orUnknown = (value: string | number | null): string => (value === null ? UNKNOWN : String(value));

function figure(value: BasisFigure): string {
  return `reported ${orUnknown(value.reported)}, verified ${orUnknown(value.verified)}`;
}

/** A managed table: a header line and one line for each row, with cells separated by a vertical bar. */
function table(header: readonly string[], rows: readonly (readonly string[])[], empty: string): string {
  if (rows.length === 0) return empty;
  return [header, ...rows].map((cells) => cells.join(" | ")).join("\n");
}

function bodies(data: TemplateData): Readonly<Record<string, string>> {
  switch (data.kind) {
    case "programmeProgress": {
      const statuses = new Map<string, number>();
      for (const replication of data.replications) {
        const status = replication.status ?? "No status";
        statuses.set(status, (statuses.get(status) ?? 0) + 1);
      }
      const summary = [
        `${data.replications.length} ${data.replications.length === 1 ? "replication" : "replications"} in the programme.`,
        ...[...statuses].sort(([a], [b]) => a.localeCompare(b)).map(([status, count]) => `${status}: ${count}`),
      ].join("\n");
      return {
        summary,
        replications: table(
          ["Replication", "Status", "Laboratories"],
          data.replications.map((replication) => [
            replication.title === null ? replication.studyKey : `${replication.studyKey}, ${replication.title}`,
            replication.status ?? "No status",
            String(replication.laboratories),
          ]),
          "No replication is recorded.",
        ),
      };
    }
    case "replicationProgress":
      return {
        overview: [
          data.title === null ? data.studyKey : `${data.studyKey}: ${data.title}`,
          `Status: ${data.status ?? "No status"}`,
          `Public stage: ${data.publicStage ?? UNKNOWN}`,
          `Laboratories taking part: ${data.participations.length}`,
        ].join("\n"),
        laboratories: table(
          ["Laboratory", "Participation"],
          data.participations.map((participation) => [participation.laboratory, participation.status]),
          "No laboratory takes part yet.",
        ),
      };
    case "laboratoryProgress":
      return {
        profile: data.description ?? "No description is recorded.",
        participations: table(
          ["Replication", "Participation"],
          data.participations.map((participation) => [participation.replication, participation.status]),
          "The laboratory takes part in no replication yet.",
        ),
        equipment: table(
          ["Configuration", "EEG channels", "Sampling rates in hertz"],
          data.equipment.map((configuration) => [
            configuration.name,
            orUnknown(configuration.channelCount),
            configuration.samplingRatesHz.length === 0 ? UNKNOWN : configuration.samplingRatesHz.join(", "),
          ]),
          "No current equipment configuration is recorded.",
        ),
      };
    case "recruitment":
      return {
        recruitment: [
          `${data.category} as of ${data.asOfDate}. Main experiment, resting state and unique participants are separate counts and are never added together.`,
          table(
            ["Laboratory", "Main experiment", "Resting state", "Unique participants"],
            data.sites.map((site) => [
              site.laboratory,
              figure(site.main),
              figure(site.rest),
              figure(site.participants),
            ]),
            "No laboratory reports recruitment yet.",
          ),
        ].join("\n"),
      };
    case "meetings":
      return {
        meetings: table(
          ["Date", "Meeting", "Notes"],
          [...data.meetings]
            .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
            .map((meeting) => [meeting.date ?? "No date", meeting.title, meeting.url]),
          "No meeting is recorded.",
        ),
      };
    case "milestones":
      return {
        milestones: table(
          ["Due", "Milestone", "Status"],
          [...data.milestones]
            .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
            .map((milestone) => [milestone.dueDate ?? "No date", milestone.title, milestone.status]),
          "No milestone is recorded.",
        ),
      };
  }
}

/**
 * The text of every managed section of a template, each ending with its provenance line. A
 * section is never empty: one without content says so in words.
 */
export function renderSections(data: TemplateData, provenance: Provenance): Readonly<Record<string, string>> {
  const definition = DOCUMENT_TEMPLATES[data.kind];
  const texts = bodies(data);
  return Object.fromEntries(
    definition.sections.map((section) => [
      section.name,
      `${texts[section.name] ?? "Nothing is recorded."}\n${provenanceLine(provenance)}`,
    ]),
  );
}
