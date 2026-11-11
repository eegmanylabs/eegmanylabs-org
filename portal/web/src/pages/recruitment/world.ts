// Everything the pages of recruitment read, live, joined once: the reports and pauses the viewer
// may read, the categories and reasons, and the directory records that name what they count.
import type { ParticipationFacts } from "@eegml/shared";
import { useMemo } from "react";
import type { Live, RecordOf } from "@/data";
import { combineLive } from "@/registry/combine";
import { useInstitutions, useLaboratories, useParticipations, useReplications } from "@/registry/queries";
import { participationFacts, type RecruitmentData, useRecruitmentData } from "@/registry/recruitment-data";
import type { Viewer } from "@/registry/viewer";

export interface RecruitmentWorld {
  readonly data: RecruitmentData;
  readonly participations: readonly RecordOf<"participations">[];
  readonly replications: readonly RecordOf<"replications">[];
  readonly facts: readonly ParticipationFacts[];
  laboratoryName(laboratoryId: string): string;
  institutionName(institutionId: string): string;
  /** "Replication at laboratory", the name of a participation. */
  participationLabel(participationId: string): string;
}

export function useRecruitmentWorld(viewer: Viewer | null): Live<RecruitmentWorld> {
  const data = useRecruitmentData(viewer);
  const participations = useParticipations();
  const laboratories = useLaboratories();
  const replications = useReplications();
  const institutions = useInstitutions();
  return useMemo(
    () =>
      combineLive(
        [data, participations, laboratories, replications, institutions] as const,
        (recruitment, participationList, laboratoryList, replicationList, institutionList): RecruitmentWorld => {
          const labNames = new Map(laboratoryList.map((laboratory) => [laboratory.id, laboratory.name]));
          const institutionNames = new Map(institutionList.map((institution) => [institution.id, institution.name]));
          const byId = new Map(participationList.map((participation) => [participation.id, participation]));
          const laboratoryName = (id: string) => labNames.get(id) ?? id;
          return {
            data: recruitment,
            participations: participationList.filter((participation) => participation.archivedAt === null),
            replications: replicationList,
            facts: participationFacts(participationList, laboratoryList),
            laboratoryName,
            institutionName: (id) => institutionNames.get(id) ?? id,
            participationLabel: (id) => {
              const participation = byId.get(id);
              return participation === undefined
                ? id
                : `${participation.replicationId} at ${laboratoryName(participation.laboratoryId)}`;
            },
          };
        },
      ),
    [data, participations, laboratories, replications, institutions],
  );
}
