import type { RecordOf } from "@/data";
import { managesDataset } from "@/pages/datasets/dataset-format";
import { DriveLinks, type LinkTargetOption } from "@/pages/integrations/DriveLinks";
import { GeneratedDocuments } from "@/pages/integrations/GeneratedDocuments";
import type { Viewer } from "@/registry/viewer";

/**
 * The documents of a replication: the documents linked to it and to its manuscripts and
 * datasets, which its managers link from Google Drive, and the Google Docs generated for it.
 */
export function DocumentsTab({
  studyKey,
  links,
  manuscripts,
  datasets,
  viewer,
}: {
  studyKey: string;
  links: readonly RecordOf<"documentLinks">[];
  manuscripts: readonly RecordOf<"manuscripts">[];
  /** The datasets of the replication, of which the reader may link to those it manages. */
  datasets: readonly RecordOf<"datasets">[];
  viewer: Viewer;
}) {
  const manages = viewer.access.member && viewer.can("replications.manage", { replicationId: studyKey });
  const datasetTargets: LinkTargetOption[] = datasets
    .filter((dataset) => dataset.archivedAt === null && managesDataset(viewer, dataset))
    .map((dataset) => ({
      value: `dataset:${dataset.id}`,
      label: `The dataset ${dataset.datasetKey}`,
      entityType: "dataset",
      entityId: dataset.id,
    }));
  // The managers of the replication link to it and its manuscripts; those who manage a dataset of it link to the dataset.
  const targets: LinkTargetOption[] = [
    { value: "replication", label: `The replication ${studyKey}`, entityType: "replication", entityId: studyKey },
    ...manuscripts
      .filter((manuscript) => manuscript.archivedAt === null)
      .map((manuscript) => ({
        value: `manuscript:${manuscript.id}`,
        label: `The manuscript ${manuscript.title}`,
        entityType: "manuscript" as const,
        entityId: manuscript.id,
      })),
    ...datasetTargets,
  ];
  return (
    <div className="grid gap-8">
      <DriveLinks
        links={links}
        canLink={manages || datasetTargets.length > 0}
        targets={manages ? targets : datasetTargets}
        caption="Documents linked to the replication and its records"
      />
      <GeneratedDocuments
        entityType="replication"
        entityId={studyKey}
        scopeKeys={viewer.queryScopeKeys}
        canGenerate={manages || viewer.can("integrations.manage", "programme")}
      />
    </div>
  );
}
