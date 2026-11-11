// What a view reads (D-011): the records of one collection with their properties, the
// collections its relations and rollups point at, and what the viewer may change. Every view of
// the same documents shares the same listeners through the subscription cache, so the same
// participation is one document wherever it appears, and an edit in one view reaches every other.
import {
  CORE_SOURCES,
  type CollectionData,
  type CoreDocument,
  type CoreSourceKey,
  coreCollection,
  databaseCollection,
  databaseIdOf,
  type EngineContext,
  isCoreSourceKey,
  pageLevelFor,
  type StoredPropertyDefinition,
  type ViewProperty,
  type ViewRecord,
} from "@eegml/shared";
import { useMemo } from "react";
import {
  type Live,
  type RecordOf,
  useLiveCollection,
  useLiveDocument,
  useLiveDocumentsAt,
  useLiveQueries,
  useLiveQuery,
} from "@/data";
import { combineLive, orEmpty } from "@/registry/combine";
import {
  ALL_LABORATORIES,
  ALL_PARTICIPATIONS,
  ALL_PERSONS,
  ALL_REPLICATIONS,
  checklistsInScope,
  REPLICATION_STATUS_DEFINITIONS,
} from "@/registry/queries";
import {
  currentCategories,
  type RecruitmentData,
  recruitmentCollections,
  useRecruitmentData,
} from "@/registry/recruitment-data";
import { roleOnTask, type TaskData, taskCollection, taskLookups, useTaskData } from "@/registry/task-data";
import type { Viewer } from "@/registry/viewer";

/** The most rows of a database a view reads: ten pages of the limit of one query. */
export const DATABASE_ROWS_PAGE = 1_000;

export interface ViewData {
  readonly collection: CollectionData;
  readonly context: EngineContext;
  /** The database itself, for a collection of a database. */
  readonly database: RecordOf<"databases"> | null;
  /** Whether the viewer may change a property of a record, which the server decides again. */
  canEdit(record: ViewRecord, property: ViewProperty): boolean;
  /** Whether the viewer may add rows: the editors of a database. */
  readonly canAddRows: boolean;
  /** Whether the viewer may add and change properties. */
  readonly canManageProperties: boolean;
  /** Whether the records shown are fewer than the collection holds, because a read was cut short. */
  readonly truncated: boolean;
  /** The members who have an account, for a property of people. */
  readonly people: readonly { readonly uid: string; readonly name: string }[];
}

/** The registry entry of the restricted custom values of a core source. */
const RESTRICTED_ENTRY = {
  "core:replications": "replicationCustom",
  "core:persons": "personCustom",
  "core:laboratories": "laboratoryCustom",
  "core:participations": "participationCustom",
} as const;

/** The reader's calendar day of an instant. */
function localDayOf(instant: string): string {
  const date = new Date(instant);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function todayIso(now: Date = new Date()): string {
  return localDayOf(now.toISOString());
}

const asDocuments = (records: readonly { readonly id: string }[]): CoreDocument[] =>
  records.map((record) => ({ id: record.id, data: record as unknown as Readonly<Record<string, unknown>> }));

/** Whether the viewer may change a core record of a source, as the functions decide it. */
function mayChangeCore(
  viewer: Viewer,
  key: CoreSourceKey,
  record: ViewRecord,
  data: Readonly<Record<string, unknown>> | undefined,
): boolean {
  switch (key) {
    case "core:replications":
      return viewer.can("replications.manage", { replicationId: record.id });
    case "core:laboratories":
      return viewer.can("labs.manage", { laboratoryId: record.id });
    case "core:participations":
      return viewer.can("participations.manage", {
        replicationId: typeof data?.replicationId === "string" ? data.replicationId : null,
        laboratoryId: typeof data?.laboratoryId === "string" ? data.laboratoryId : null,
      });
    case "core:persons":
      return viewer.can("people.manage", "programme");
    case "core:checklistItems":
    case "core:tasks":
    case "core:recruitmentReports":
    case "core:recruitment":
      // The functions of tasks decide who changes a task, which `taskEditable` asks, and a
      // recruitment report is never changed: a correction is a new report.
      return false;
  }
}

/** The core sources that take no custom properties, and so no restricted values either. */
const WITHOUT_CUSTOM: ReadonlySet<CoreSourceKey> = new Set([
  "core:checklistItems",
  "core:tasks",
  "core:recruitmentReports",
  "core:recruitment",
]);

/** The sources of recruitment, which read the reports. */
const RECRUITMENT_SOURCES: ReadonlySet<string> = new Set(["core:recruitmentReports", "core:recruitment"]);

/** The properties of a task that a participant changes beside its managers. */
const PARTICIPANT_PROPERTIES: ReadonlySet<string> = new Set(["status", "progressPercent", "estimateMinutes"]);

/** Whether the viewer may change a property of a task, as the functions of tasks decide it. */
function taskEditable(viewer: Viewer, tasks: TaskData, recordId: string, property: ViewProperty): boolean {
  if (property.source !== "coreEditable") return false;
  const task = tasks.tasks.find((candidate) => candidate.id === recordId);
  if (task === undefined || task.archivedAt !== null) return false;
  const list = tasks.lists.find((candidate) => candidate.id === task.listId);
  if (list?.archivedAt !== null) return false;
  const role = roleOnTask(viewer, list, task);
  return role === "manager" || (role === "participant" && PARTICIPANT_PROPERTIES.has(property.id));
}

/**
 * The data of a view of a collection, live. `secondFactor` is whether the session presented the
 * second factor, which the levels of a page depend on for programme staff.
 */
export function useViewData(collectionKey: string | null, viewer: Viewer, secondFactor: boolean): Live<ViewData> {
  const databaseId = collectionKey === null ? null : databaseIdOf(collectionKey);
  const coreKey = collectionKey !== null && isCoreSourceKey(collectionKey) ? collectionKey : null;
  const coreSource = coreKey === null ? null : CORE_SOURCES[coreKey];

  const persons = useLiveCollection(ALL_PERSONS);
  const replications = useLiveCollection(ALL_REPLICATIONS);
  const laboratories = useLiveCollection(ALL_LABORATORIES);
  const participations = useLiveCollection(ALL_PARTICIPATIONS);
  const statuses = useLiveQuery(REPLICATION_STATUS_DEFINITIONS);
  const checklists = orEmpty(useLiveQuery(checklistsInScope(viewer.staff ? "all" : viewer.queryScopeKeys)));
  const taskData = useTaskData(coreKey === "core:tasks" ? viewer : null);
  const recruitmentData = useRecruitmentData(coreKey !== null && RECRUITMENT_SOURCES.has(coreKey) ? viewer : null);
  const schema = useLiveDocument(
    "collectionSchemas",
    coreSource?.customKey === null || coreSource === null ? null : [coreSource.customKey],
  );

  const database = useLiveDocument("databases", databaseId === null ? null : [databaseId]);
  const rows = useLiveCollection(
    databaseId === null ? null : { collection: "databaseRows", within: [databaseId], limit: DATABASE_ROWS_PAGE },
  );
  const parentPageId = database.status === "ready" ? (database.data?.parentPageId ?? null) : null;
  const page = useLiveDocument("pages", parentPageId === null ? null : [parentPageId]);

  // The databases that relations and rollups of this one point at.
  const relatedIds = useMemo(() => {
    if (database.status !== "ready" || database.data === null) return [];
    const targets = Object.values(database.data.properties).flatMap((definition) => {
      const config = definition.config as {
        relation?: { target?: unknown };
        rollup?: { source?: { backlink?: { collection?: unknown } } };
      };
      return [config.relation?.target, config.rollup?.source?.backlink?.collection];
    });
    return [
      ...new Set(
        targets
          .filter((target): target is string => typeof target === "string")
          .map((target) => databaseIdOf(target))
          .filter((id): id is string => id !== null && id !== databaseId),
      ),
    ].sort();
  }, [database, databaseId]);
  const relatedDatabases = useLiveDocumentsAt(
    "databases",
    relatedIds.map((id) => [id] as [string]),
  );
  const relatedRows = useLiveQueries(
    relatedIds.map((id) => ({
      collection: "databaseRows" as const,
      within: [id] as [string],
      limit: DATABASE_ROWS_PAGE,
    })),
  );

  // The restricted custom values, of the records whose scope the viewer holds.
  const schemaData = schema.status === "ready" ? schema.data : null;
  const restrictedIds = useMemo((): [string][] => {
    if (coreKey === null || WITHOUT_CUSTOM.has(coreKey) || schemaData === null) return [];
    const hasRestricted = Object.values(schemaData.properties).some(
      (definition) => definition.audience === "restricted" && definition.archivedAt === null,
    );
    if (!hasRestricted) return [];
    const ids: string[] = [];
    if (coreKey === "core:participations" && participations.status === "ready") {
      for (const record of participations.data.items) {
        if (viewer.participationScope(record) !== null) ids.push(record.id);
      }
    } else if (coreKey === "core:replications" && replications.status === "ready") {
      for (const record of replications.data.items) if (viewer.readsTeamOf(record.id)) ids.push(record.id);
    } else if (coreKey === "core:laboratories" && laboratories.status === "ready") {
      for (const record of laboratories.data.items) if (viewer.readsLaboratoryDetail(record.id)) ids.push(record.id);
    } else if (coreKey === "core:persons" && viewer.personId !== null) {
      ids.push(viewer.personId);
    }
    return ids.map((id) => [id]);
  }, [coreKey, schemaData, participations, replications, laboratories, viewer]);
  const restricted = useLiveDocumentsAt(
    coreKey === null || WITHOUT_CUSTOM.has(coreKey)
      ? "participationCustom"
      : RESTRICTED_ENTRY[coreKey as keyof typeof RESTRICTED_ENTRY],
    restrictedIds,
  );

  const ready = combineLive(
    [
      persons,
      replications,
      laboratories,
      participations,
      statuses,
      checklists,
      orIdleTasks(taskData),
      orIdleRecruitment(recruitmentData),
    ] as const,
    (...values) => values,
  );
  const ownReady = combineLive(
    databaseId === null
      ? ([schemaOrEmpty(schema), orIdleMap(restricted)] as const)
      : ([
          database,
          orEmptyPaged(rows),
          orIdlePage(page),
          orIdleMap(relatedDatabases),
          orEmptyLists(relatedRows),
        ] as const),
    (...values) => values,
  );

  return useMemo((): Live<ViewData> => {
    if (collectionKey === null) return { status: "idle" };
    if (ready.status !== "ready") return ready;
    if (ownReady.status !== "ready") return ownReady;
    const [
      personList,
      replicationList,
      laboratoryList,
      participationList,
      statusList,
      checklistList,
      tasks,
      recruitment,
    ] = ready.data;
    const names = new Map<string, string>();
    for (const person of personList.items) if (person.userId !== null) names.set(person.userId, person.displayName);
    const people = [...names]
      .map(([uid, name]) => ({ uid, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
    const labNames = new Map(laboratoryList.items.map((laboratory) => [laboratory.id, laboratory.name]));
    const lookups = {
      laboratoryName: (id: string) => labNames.get(id) ?? null,
      replicationStatuses: [...statusList]
        .sort((a, b) => a.position - b.position)
        .map((status) => ({ key: status.key, label: status.label })),
      ...(tasks === null ? {} : taskLookups(tasks)),
      ...(recruitment === null
        ? {}
        : {
            countCategories: currentCategories(recruitment.categories, "all").map((category) => ({
              key: category.key,
              label: category.label,
            })),
          }),
    };
    const customOf = (key: CoreSourceKey): Readonly<Record<string, StoredPropertyDefinition>> =>
      key === coreKey && schemaData !== null
        ? (schemaData.properties as Readonly<Record<string, StoredPropertyDefinition>>)
        : {};
    const restrictedValues =
      databaseId === null && ownReady.data[1] instanceof Map
        ? (ownReady.data[1] as ReadonlyMap<string, RecordOf<"participationCustom">>)
        : new Map();
    const withRestricted = (records: readonly { readonly id: string }[]) =>
      asDocuments(records).map((document) => {
        const values = restrictedValues.get(document.id);
        return values === undefined ? document : { ...document, restricted: values.custom };
      });
    const core = (key: CoreSourceKey, records: readonly { readonly id: string }[]) =>
      coreCollection(
        CORE_SOURCES[key],
        key === coreKey ? withRestricted(records) : asDocuments(records),
        customOf(key),
        lookups,
      );
    const collections = new Map<string, CollectionData>([
      ["core:replications", core("core:replications", replicationList.items)],
      ["core:persons", core("core:persons", personList.items)],
      ["core:laboratories", core("core:laboratories", laboratoryList.items)],
      ["core:participations", core("core:participations", participationList.items)],
      ["core:checklistItems", core("core:checklistItems", checklistList)],
    ]);
    if (tasks !== null) collections.set("core:tasks", taskCollection(tasks, lookups));
    const now = new Date();
    if (recruitment !== null) {
      const built = recruitmentCollections(recruitment, participationList.items, lookups, todayIso(now));
      collections.set("core:recruitmentReports", built.reports);
      collections.set("core:recruitment", built.states);
    }
    const context: EngineContext = {
      today: todayIso(now),
      now,
      dayOf: localDayOf,
      personName: (uid) => names.get(uid) ?? null,
      collections,
    };

    if (databaseId !== null) {
      const [databaseDoc, rowItems, pageDoc, relatedDocs, relatedLists] = ownReady.data as unknown as [
        RecordOf<"databases"> | null,
        { readonly items: readonly RecordOf<"databaseRows">[]; readonly truncated: boolean },
        RecordOf<"pages"> | null,
        ReadonlyMap<string, RecordOf<"databases">>,
        readonly (readonly RecordOf<"databaseRows">[])[],
      ];
      if (databaseDoc === null) return { status: "error", error: { code: "not-found", message: "No such database." } };
      relatedIds.forEach((id, index) => {
        const related = relatedDocs.get(id);
        if (related === undefined) return;
        collections.set(
          `db:${id}`,
          databaseCollection(
            id,
            {
              name: related.name,
              properties: related.properties as Readonly<Record<string, StoredPropertyDefinition>>,
            },
            (relatedLists[index] ?? []).map((row) => ({
              id: row.id,
              data: row as unknown as Readonly<Record<string, unknown>>,
            })),
          ),
        );
      });
      const collection = databaseCollection(
        databaseId,
        {
          name: databaseDoc.name,
          properties: databaseDoc.properties as Readonly<Record<string, StoredPropertyDefinition>>,
        },
        rowItems.items.map((row) => ({ id: row.id, data: row as unknown as Readonly<Record<string, unknown>> })),
      );
      collections.set(collection.key, collection);
      const level =
        pageDoc === null ? "none" : pageLevelFor(viewer.access, { secondFactorVerified: secondFactor }, pageDoc);
      const editor = (level === "edit" || level === "full") && databaseDoc.archivedAt === null;
      return {
        status: "ready",
        fromCache: false,
        hasPendingWrites: false,
        data: {
          collection,
          context,
          database: databaseDoc,
          canEdit: (_record, property) => editor && (property.source === "row" || property.source === "title"),
          canAddRows: editor,
          canManageProperties: editor,
          truncated: rowItems.truncated,
          people,
        },
      };
    }

    if (coreKey === null) return { status: "error", error: { code: "not-found", message: "No such collection." } };
    const collection = collections.get(coreKey) as CollectionData;
    if (coreKey === "core:recruitmentReports" || coreKey === "core:recruitment") {
      return {
        status: "ready",
        fromCache: false,
        hasPendingWrites: false,
        data: {
          collection,
          context,
          database: null,
          canEdit: () => false,
          canAddRows: false,
          canManageProperties: false,
          truncated: recruitment?.truncated ?? false,
          people,
        },
      };
    }
    if (coreKey === "core:tasks") {
      return {
        status: "ready",
        fromCache: false,
        hasPendingWrites: false,
        data: {
          collection,
          context,
          database: null,
          canEdit: (record, property) => tasks !== null && taskEditable(viewer, tasks, record.id, property),
          canAddRows: false,
          canManageProperties: false,
          truncated: tasks?.truncated ?? false,
          people,
        },
      };
    }
    const sourceData = new Map(
      {
        "core:replications": replicationList.items,
        "core:persons": personList.items,
        "core:laboratories": laboratoryList.items,
        "core:participations": participationList.items,
        "core:checklistItems": checklistList,
      }[coreKey].map((record) => [record.id, record as unknown as Readonly<Record<string, unknown>>]),
    );
    return {
      status: "ready",
      fromCache: false,
      hasPendingWrites: false,
      data: {
        collection,
        context,
        database: null,
        canEdit: (record, property) =>
          (property.source === "custom" || property.source === "restricted" || property.source === "coreEditable") &&
          mayChangeCore(viewer, coreKey, record, sourceData.get(record.id)),
        canAddRows: false,
        canManageProperties: CORE_SOURCES[coreKey].customKey !== null && viewer.can("lookups.manage", "programme"),
        truncated: [personList, replicationList, laboratoryList, participationList].some((list) => list.truncated),
        people,
      },
    };
  }, [collectionKey, coreKey, databaseId, ready, ownReady, schemaData, relatedIds, viewer, secondFactor]);
}

/** The recruitment data where it was asked for, and null where it was not. */
function orIdleRecruitment(live: Live<RecruitmentData>): Live<RecruitmentData | null> {
  return live.status === "idle" ? { status: "ready", data: null, ...READY } : live;
}

/** The tasks where they were asked for, and null where they were not. */
function orIdleTasks(live: Live<TaskData>): Live<TaskData | null> {
  return live.status === "idle" ? { status: "ready", data: null, ...READY } : live;
}

// An idle value stands for "nothing asked for", which these views read as empty.
const READY = { fromCache: false, hasPendingWrites: false } as const;

function schemaOrEmpty(live: Live<RecordOf<"collectionSchemas"> | null>): Live<RecordOf<"collectionSchemas"> | null> {
  return live.status === "idle" || (live.status === "error" && live.error.code === "permission-denied")
    ? { status: "ready", data: null, ...READY }
    : live;
}

function orIdleMap<T>(live: Live<ReadonlyMap<string, T>>): Live<ReadonlyMap<string, T>> {
  return live.status === "idle" ? { status: "ready", data: new Map(), ...READY } : live;
}

function orIdlePage(live: Live<RecordOf<"pages"> | null>): Live<RecordOf<"pages"> | null> {
  return live.status === "idle" || (live.status === "error" && live.error.code === "permission-denied")
    ? { status: "ready", data: null, ...READY }
    : live;
}

function orEmptyPaged<T>(
  live: Live<{ readonly items: readonly T[]; readonly truncated: boolean }>,
): Live<{ readonly items: readonly T[]; readonly truncated: boolean }> {
  return live.status === "idle" ? { status: "ready", data: { items: [], truncated: false }, ...READY } : live;
}

function orEmptyLists<T>(live: Live<readonly (readonly T[])[]>): Live<readonly (readonly T[])[]> {
  return live.status === "idle" ? { status: "ready", data: [], ...READY } : live;
}
