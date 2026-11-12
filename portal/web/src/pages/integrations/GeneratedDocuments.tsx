// The Google Docs generated for a record: each with the state of its managed sections, its report
// date and an open link, and the request to create or update one. Whoever manages the record may
// ask, and the function decides. The document opens at Google's own address, where Google
// applies the reader's own permissions.
import {
  DOCUMENT_TEMPLATE_KINDS,
  DOCUMENT_TEMPLATES,
  type DocumentTemplateKind,
  generateDocumentContract,
} from "@eegml/shared";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { formatDate, formatDateTime } from "@/app/labels";
import { LiveView } from "@/components/feedback/live-view";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { CallableError, callFunction, type RecordOf, retryFailedLiveData, useLiveQuery } from "@/data";
import { GENERATED_STATUS_LABELS, SECTION_STATUS_LABELS } from "@/pages/admin/integrations/integration-format";
import { orEmpty } from "@/registry/combine";
import { generatedDocumentsOf } from "@/registry/queries";
import { SyntheticGoogleNotice } from "./synthetic-google";

type Generated = RecordOf<"generatedDocuments">;

/** The label of a managed section, whichever template it belongs to. */
function sectionLabel(section: string): string {
  for (const template of Object.values(DOCUMENT_TEMPLATES)) {
    const found = template.sections.find((item) => item.name === section);
    if (found !== undefined) return found.label;
  }
  return section;
}

/** One generated document as a card: its title and link, its state, and its sections. */
export function GeneratedDocumentCard({ document, canUpdate }: { document: Generated; canUpdate: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const update = async () => {
    setBusy(true);
    try {
      const entityType =
        document.entityType === "replication" || document.entityType === "laboratory"
          ? document.entityType
          : "programme";
      await callFunction(generateDocumentContract, {
        templateKey: document.templateKey,
        entityType,
        entityId: document.entityId,
      });
      toast.show({ title: "The document will be updated in a moment." });
    } catch (error) {
      toast.show({
        title: "The document could not be updated.",
        description: error instanceof CallableError ? error.message : "",
      });
    } finally {
      setBusy(false);
    }
  };
  const sections = Object.entries(document.managedSections).sort(([a], [b]) => a.localeCompare(b));
  return (
    <article
      className="grid gap-2 rounded-tile border border-border bg-surface px-4 py-3"
      data-testid="generated-document"
      aria-label={document.title}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-md font-medium text-fg-strong">
          {document.url === undefined ? (
            document.title
          ) : (
            <a
              href={document.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-fg-accent underline"
            >
              {document.title}
              <ExternalLink aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </h3>
        <Badge tone={document.status === "edited" || document.status === "failed" ? "accent" : "neutral"}>
          {GENERATED_STATUS_LABELS[document.status]}
        </Badge>
      </header>
      <p className="text-sm text-fg-secondary">
        {document.reportDate === undefined ? "Not generated yet." : `Report date ${formatDate(document.reportDate)}.`}{" "}
        {document.lastGeneratedAt === null
          ? null
          : `Last written ${formatDateTime(document.lastGeneratedAt.toDate())}.`}
      </p>
      {document.statusReason === undefined || document.status === "current" ? null : (
        <p className="text-sm text-fg-secondary">{document.statusReason}</p>
      )}
      {sections.length === 0 ? null : (
        <ul className="flex flex-wrap gap-1.5" aria-label="Managed sections">
          {sections.map(([name, section]) => (
            <li key={name}>
              <Badge tone={section.status === "current" ? "outline" : "accent"}>
                {sectionLabel(name)}: {SECTION_STATUS_LABELS[section.status].toLowerCase()}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {canUpdate ? (
        <div>
          <Button size="sm" disabled={busy} onClick={() => void update()}>
            {busy ? "Asking…" : "Update now"}
            <span className="sr-only"> {document.title}</span>
          </Button>
        </div>
      ) : null}
    </article>
  );
}

/** The generated documents of a replication or a laboratory, and the kinds that may still be generated for it. */
export function GeneratedDocuments({
  entityType,
  entityId,
  scopeKeys,
  canGenerate,
}: {
  entityType: "replication" | "laboratory";
  entityId: string;
  scopeKeys: readonly string[];
  /** Whether the reader may ask for a document of this record. */
  canGenerate: boolean;
}) {
  const toast = useToast();
  const documents = useLiveQuery(scopeKeys.length === 0 ? null : generatedDocumentsOf(entityType, entityId, scopeKeys));
  const [asking, setAsking] = useState<DocumentTemplateKind | null>(null);
  // Those who manage a record do not read the registered templates: they ask for a kind, and the
  // function finds the template of that kind in use, or says why there is none.
  const generate = async (kind: DocumentTemplateKind) => {
    setAsking(kind);
    try {
      await callFunction(generateDocumentContract, { kind, entityType, entityId });
      toast.show({ title: `${DOCUMENT_TEMPLATES[kind].name} will be created in a moment.` });
    } catch (error) {
      toast.show({
        title: "The document could not be created.",
        description: error instanceof CallableError ? error.message : "",
      });
    } finally {
      setAsking(null);
    }
  };
  return (
    <section aria-labelledby="generated-documents" className="grid gap-3">
      <h2 id="generated-documents" className="text-lg text-fg-strong">
        Generated documents
      </h2>
      <SyntheticGoogleNotice />
      <LiveView
        live={orEmpty(documents)}
        loadingLabel="Loading the generated documents"
        errorTitle="The generated documents could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(list) => {
          const generated = new Set(list.map((document) => document.templateKind));
          const available = DOCUMENT_TEMPLATE_KINDS.filter(
            (kind) => DOCUMENT_TEMPLATES[kind].entityType === entityType && !generated.has(kind),
          );
          return (
            <div className="grid gap-3">
              {list.length === 0 ? (
                <EmptyState
                  title="No document is generated for this record"
                  description="A generated Google Doc keeps its managed sections current from the portal and leaves the text people write around them alone."
                />
              ) : (
                list
                  .slice()
                  .sort((a, b) => a.title.localeCompare(b.title))
                  .map((document) => (
                    <GeneratedDocumentCard key={document.id} document={document} canUpdate={canGenerate} />
                  ))
              )}
              {canGenerate && available.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {available.map((kind) => (
                    <Button key={kind} size="sm" disabled={asking !== null} onClick={() => void generate(kind)}>
                      {asking === kind ? "Asking…" : `Generate ${DOCUMENT_TEMPLATES[kind].name.toLowerCase()}`}
                    </Button>
                  ))}
                </div>
              ) : null}
              {list.some((document) => document.status === "edited") ? (
                <p className="text-sm text-fg-secondary">
                  A section edited by hand is never overwritten.{" "}
                  <Unknown>An administrator decides on the integrations page.</Unknown>
                </p>
              ) : null}
            </div>
          );
        }}
      </LiveView>
    </section>
  );
}
