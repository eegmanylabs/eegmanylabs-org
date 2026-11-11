import { type CitationField, citationFieldSchema, editReplicationCitationContract } from "@eegml/shared";
import type { ReactNode } from "react";
import { CitationBadge } from "@/components/registry/citation-badge";
import { Detail, Details } from "@/components/registry/details";
import { EditableField, type EditableValue } from "@/components/registry/editable-field";
import { OriginBadge } from "@/components/registry/origin-badge";
import { Unknown } from "@/components/registry/unknown";
import { callFunction, type RecordOf, updateReplicationFields } from "@/data";
import { CORRECTABLE_REPLICATION_FIELDS, CorrectionRequestDialog } from "@/pages/home/CorrectionRequestDialog";
import { ALIAS_SCHEME_LABELS } from "@/registry/labels";
import {
  DESCRIPTION_FIELDS,
  EXTRACTION_FIELDS,
  ORIGINAL_STUDY_FIELDS,
  type ReplicationFieldSpec,
  SIGN_UP_FIELDS,
  schemaOf,
} from "../replication-fields";

export function Section({
  title,
  aside,
  children,
  testId,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  const id = `section-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section
      aria-labelledby={id}
      className="grid gap-2 rounded-tile border border-border bg-surface px-4 py-3"
      data-testid={testId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={id} className="text-md font-medium text-fg-strong">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function doiLink(value: EditableValue) {
  return (
    <a
      href={`https://doi.org/${String(value)}`}
      rel="noopener noreferrer"
      target="_blank"
      className="break-all text-fg-accent underline"
    >
      {String(value)}
    </a>
  );
}

function urlLink(value: EditableValue) {
  return (
    <a href={String(value)} rel="noopener noreferrer" target="_blank" className="break-all text-fg-accent underline">
      {String(value)}
    </a>
  );
}

const DISPLAY: Partial<Record<ReplicationFieldSpec["field"], (value: EditableValue) => ReactNode>> = {
  originalDoi: doiLink,
  signupUrl: urlLink,
  signupActive: (value) => (value === true ? "Open" : "Closed"),
};

export interface OverviewTabProps {
  replication: RecordOf<"replications">;
  aliases: readonly RecordOf<"replicationAliases">[];
  /** The signed-in account, which is named as the author of an edit. */
  uid: string;
  /**
   * Whether the account may edit the replication, which shows the controls. The security rules
   * decide whether an edit is accepted, also when the right has changed since the page opened.
   */
  canEdit: boolean;
  /** The signed-in member, who may report a wrong value, or null for an account that is no member. */
  reporter: string | null;
}

export function OverviewTab({ replication, aliases, uid, canEdit, reporter }: OverviewTabProps) {
  const checked = replication.citationStatus !== "unverified";
  /**
   * A field of a citation that has been checked changes through the function that marks the
   * citation as unverified again, which the security rules require. Every other field is
   * written directly.
   */
  const save = async (spec: ReplicationFieldSpec, value: EditableValue | null): Promise<void> => {
    const citation = citationFieldSchema.safeParse(spec.field);
    if (checked && citation.success && typeof value !== "boolean") {
      const field: CitationField = citation.data;
      await callFunction(editReplicationCitationContract, { replicationId: replication.studyKey, field, value });
      return;
    }
    await updateReplicationFields(uid, replication.studyKey, { [spec.field]: value });
  };
  const field = (spec: ReplicationFieldSpec) => (
    <EditableField
      key={spec.field}
      label={spec.label}
      value={replication[spec.field] as EditableValue | undefined}
      kind={spec.kind}
      schema={schemaOf(spec)}
      invalidMessage={spec.invalidMessage}
      canEdit={canEdit}
      {...(DISPLAY[spec.field] === undefined ? {} : { display: DISPLAY[spec.field] })}
      onSave={(value) => save(spec, value)}
    />
  );

  const extraction = EXTRACTION_FIELDS.filter(([key]) => replication[key] !== undefined);
  const schemes = [...new Set(aliases.map((alias) => alias.scheme))];

  return (
    <div className="grid gap-4">
      <Section title="Original study" aside={<CitationBadge status={replication.citationStatus} />}>
        {canEdit && checked ? (
          <p className="text-fg-secondary" data-testid="citation-edit-note">
            This citation has been checked. Saving a change to it marks it as unverified until it is checked again.
          </p>
        ) : null}
        <Details>{ORIGINAL_STUDY_FIELDS.map(field)}</Details>
      </Section>
      <Section title="About this replication">
        <Details>{DESCRIPTION_FIELDS.map(field)}</Details>
      </Section>
      <Section
        title="Extraction fields as recorded"
        aside={<OriginBadge origin={replication.dataOrigin} showLive />}
        testId="extraction-fields"
      >
        <p className="text-fg-secondary">
          These values are kept exactly as the source wrote them and have not been reviewed. To correct one, report it
          to the administrators.
        </p>
        {reporter === null ? null : (
          <div>
            <CorrectionRequestDialog
              uid={reporter}
              entityType="replication"
              entityId={replication.studyKey}
              fields={CORRECTABLE_REPLICATION_FIELDS}
              description="Tell the administrators which recorded value of this replication is wrong and what it should say. They correct the record."
            />
          </div>
        )}
        {extraction.length === 0 ? (
          <Unknown>No extraction field is recorded for this replication.</Unknown>
        ) : (
          <Details>
            {extraction.map(([key, label]) => (
              <Detail key={key} term={label}>
                <span className="whitespace-pre-wrap">{String(replication[key])}</span>
              </Detail>
            ))}
          </Details>
        )}
      </Section>
      <Section title="Other names of this study">
        {aliases.length === 0 ? (
          <Unknown>No other name is recorded.</Unknown>
        ) : (
          <Details>
            {schemes.map((scheme) => (
              <Detail key={scheme} term={ALIAS_SCHEME_LABELS[scheme]}>
                {aliases
                  .filter((alias) => alias.scheme === scheme)
                  .map((alias) => alias.alias)
                  .join(", ")}
              </Detail>
            ))}
          </Details>
        )}
      </Section>
      <Section title="Signing up">
        <Details>{SIGN_UP_FIELDS.map(field)}</Details>
      </Section>
    </div>
  );
}
