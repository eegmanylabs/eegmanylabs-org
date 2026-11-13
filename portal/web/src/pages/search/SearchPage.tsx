// Global search (requirements R15.8 and R15.9): records, pages, comments and the metadata of
// linked documents, within what the reader may read, with filters by kind and by replication,
// and searches the reader keeps. Records are found in the directory documents the reader loads
// already; pages, comments and documents are found by the search function, which returns only
// the entries whose audience the reader holds. The query and the filters live in the address, so
// a search can be shared and kept.
import {
  type EntityType,
  SEARCH_RESULT_KINDS,
  type SearchResultKind,
  searchWords,
  searchWorkspaceContract,
  type WorkspaceSearchResult,
} from "@eegml/shared";
import { Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { matchScore, type PaletteItem } from "@/app/shell/palette-search";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  CallableError,
  callFunction,
  type RecordOf,
  removeSavedSearch,
  retryFailedLiveData,
  saveSearch,
  useLiveQuery,
} from "@/data";
import { combineLive } from "@/registry/combine";
import { datasetPath, laboratoryPath, memberPath, pagePath, recordPath, replicationPath } from "@/registry/paths";
import { ALL_DATASETS, ALL_LABORATORIES, ALL_PERSONS, ALL_REPLICATIONS } from "@/registry/queries";
import { useViewer } from "@/registry/viewer";

const KIND_LABELS: Readonly<Record<SearchResultKind, string>> = {
  record: "Records",
  page: "Pages",
  comment: "Comments",
  document: "Linked documents",
};

/** The most records the page shows for one search. */
const RECORDS_SHOWN = 50;

interface RecordHit {
  readonly key: string;
  readonly label: string;
  readonly detail: string;
  readonly to: string;
  readonly score: number;
}

interface Directory {
  readonly replications: readonly RecordOf<"replications">[];
  readonly laboratories: readonly RecordOf<"laboratories">[];
  readonly persons: readonly RecordOf<"persons">[];
  readonly datasets: readonly RecordOf<"datasets">[];
}

/** The records that match a query, within one replication where one is chosen. */
function recordHits(directory: Directory, query: string, replicationId: string): RecordHit[] {
  const candidates: (PaletteItem & { to: string; replications: readonly string[] })[] = [
    ...directory.replications.map((replication) => ({
      id: `replication/${replication.id}`,
      kind: "replication" as const,
      label: replication.id,
      detail: replication.shortTitle ?? replication.originalTitle ?? "Replication",
      keywords: [replication.theme ?? "", replication.psychConstruct ?? ""],
      to: replicationPath(replication.id),
      replications: [replication.id],
    })),
    ...directory.laboratories.map((laboratory) => ({
      id: `laboratory/${laboratory.id}`,
      kind: "laboratory" as const,
      label: laboratory.name,
      detail: laboratory.city ?? "Laboratory",
      keywords: [laboratory.slug],
      to: laboratoryPath(laboratory.id),
      replications: [],
    })),
    ...directory.persons.map((person) => ({
      id: `person/${person.id}`,
      kind: "member" as const,
      label: person.displayName,
      detail: person.affiliationSummary ?? "Member",
      keywords: [person.slug],
      to: memberPath(person.id),
      replications: person.replicationIds,
    })),
    ...directory.datasets.map((dataset) => ({
      id: `dataset/${dataset.id}`,
      kind: "page" as const,
      label: dataset.title,
      detail: `Dataset ${dataset.datasetKey}`,
      keywords: [dataset.datasetKey],
      to: datasetPath(dataset.id),
      replications: [dataset.replicationId],
    })),
  ];
  return candidates
    .filter((candidate) => replicationId === "" || candidate.replications.includes(replicationId))
    .map((candidate) => ({
      key: candidate.id,
      label: candidate.label,
      detail: candidate.detail ?? "",
      to: candidate.to,
      score: matchScore(candidate, query),
    }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, "en", { sensitivity: "base" }))
    .slice(0, RECORDS_SHOWN);
}

/** Where an indexed result leads: a page itself, or the record a comment or a document belongs to. */
function indexedPath(result: WorkspaceSearchResult): string | null {
  if (result.entityType === "page") return pagePath(result.entityId);
  if (result.targetEntityType !== undefined && result.targetEntityId !== undefined) {
    if (result.entityType === "comment" && result.targetEntityType === "page") {
      return pagePath(result.targetEntityId, result.entityId.split("__")[0]);
    }
    return recordPath(result.targetEntityType as EntityType, result.targetEntityId);
  }
  return null;
}

const indexedKind = (result: WorkspaceSearchResult): SearchResultKind =>
  result.kind === "comment" ? "comment" : result.kind === "document" ? "document" : "page";

function useIndexedResults(query: string, kinds: readonly SearchResultKind[], replicationId: string) {
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; results: readonly WorkspaceSearchResult[] }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const indexed = kinds.filter((kind): kind is "page" | "comment" | "document" => kind !== "record");
  const wanted = kinds.length === 0 ? (["page", "comment", "document"] as const) : indexed;
  const key = `${query}|${wanted.join(",")}|${replicationId}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key names everything the search depends on.
  useEffect(() => {
    if (searchWords(query) === null || wanted.length === 0) {
      setState({ status: "idle" });
      return;
    }
    let current = true;
    setState({ status: "loading" });
    callFunction(searchWorkspaceContract, {
      query,
      kinds: [...wanted],
      ...(replicationId === "" ? {} : { replicationId }),
    })
      .then((answer) => {
        if (current) setState({ status: "ready", results: answer.results });
      })
      .catch((error: unknown) => {
        if (current) {
          setState({
            status: "error",
            message: error instanceof CallableError ? error.message : "The search could not be completed.",
          });
        }
      });
    return () => {
      current = false;
    };
  }, [key]);
  return state;
}

function SavedSearches({ uid }: { uid: string }) {
  const saved = useLiveQuery({ collection: "userSavedSearches", within: [uid], limit: 50 });
  // The search removed last, which can be put back until another is removed.
  const [removed, setRemoved] = useState<RecordOf<"userSavedSearches"> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const remove = (search: RecordOf<"userSavedSearches">) => {
    setFailure(null);
    removeSavedSearch(uid, search.id)
      .then(() => setRemoved(search))
      .catch(() => setFailure(`The saved search ${search.name} could not be removed. Try again.`));
  };
  const undo = (search: RecordOf<"userSavedSearches">) => {
    setFailure(null);
    saveSearch(uid, {
      name: search.name,
      query: search.query,
      kinds: search.kinds,
      replicationId: search.replicationId,
    })
      .then(() => setRemoved(null))
      .catch(() => setFailure(`The saved search ${search.name} could not be put back. Try again.`));
  };
  return (
    <section className="grid gap-2" aria-label="Your saved searches">
      <h2 className="text-md font-medium text-fg-strong">Your saved searches</h2>
      <div role="status" className="text-sm" data-testid="saved-search-status">
        {removed === null ? null : (
          <span className="flex flex-wrap items-center gap-2">
            The saved search {removed.name} is removed.
            <Button size="sm" variant="ghost" onClick={() => undo(removed)}>
              Undo<span className="sr-only"> the removal of {removed.name}</span>
            </Button>
          </span>
        )}
        {failure === null ? null : <span className="text-fg-accent">{failure}</span>}
      </div>
      <LiveView
        live={saved}
        loadingLabel="Loading your searches"
        errorTitle="Your saved searches could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(list) =>
          list.length === 0 ? (
            <p className="text-sm text-fg-secondary">Save a search to run it again from here.</p>
          ) : (
            <ul className="grid gap-1">
              {[...list]
                .sort((a, b) => a.name.localeCompare(b.name, "en-GB"))
                .map((search) => {
                  const parameters = new URLSearchParams({ q: search.query });
                  if (search.kinds.length > 0) parameters.set("kinds", search.kinds.join(","));
                  if (search.replicationId !== null) parameters.set("replication", search.replicationId);
                  return (
                    <li key={search.id} className="flex items-center gap-2" data-testid="saved-search">
                      <Link className="text-fg-accent underline" to={`/search?${parameters.toString()}`}>
                        {search.name}
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove the saved search ${search.name}`}
                        onClick={() => remove(search)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </li>
                  );
                })}
            </ul>
          )
        }
      </LiveView>
    </section>
  );
}

export function SearchPage() {
  const viewer = useViewer();
  const [parameters, setParameters] = useSearchParams();
  const query = parameters.get("q") ?? "";
  const kinds = (parameters.get("kinds") ?? "")
    .split(",")
    .filter((kind): kind is SearchResultKind => (SEARCH_RESULT_KINDS as readonly string[]).includes(kind));
  const replicationId = parameters.get("replication") ?? "";
  const [draft, setDraft] = useState(query);
  // The box shows the search the page runs, also when a saved search or a link changes it.
  useEffect(() => setDraft(query), [query]);
  const [saveName, setSaveName] = useState("");
  const [saveFailure, setSaveFailure] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const directory = combineLive(
    [
      useLiveQuery(ALL_REPLICATIONS),
      useLiveQuery(ALL_LABORATORIES),
      useLiveQuery(ALL_PERSONS),
      useLiveQuery(ALL_DATASETS),
    ] as const,
    (replications, laboratories, persons, datasets) => ({ replications, laboratories, persons, datasets }),
  );
  const indexed = useIndexedResults(query, kinds, replicationId);
  const wantsRecords = kinds.length === 0 || kinds.includes("record");
  const update = (changes: Readonly<Record<string, string>>) => {
    const next = new URLSearchParams(parameters);
    for (const [name, value] of Object.entries(changes)) {
      if (value === "") next.delete(name);
      else next.set(name, value);
    }
    setParameters(next, { replace: true });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    update({ q: draft.trim() });
  };
  const toggleKind = (kind: SearchResultKind, on: boolean) => {
    const next = on ? [...kinds, kind] : kinds.filter((candidate) => candidate !== kind);
    update({ kinds: next.join(",") });
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (viewer === null || query === "") return;
    setSaveFailure(null);
    setSavedNote(false);
    saveSearch(viewer.uid, {
      name: saveName.trim(),
      query,
      kinds,
      replicationId: replicationId === "" ? null : replicationId,
    })
      .then(() => {
        setSaveName("");
        setSavedNote(true);
      })
      .catch(() => setSaveFailure("The search was not saved. Try again."));
  };
  const typed = searchWords(query) !== null;
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Search"
        description="Records, pages, comments and linked documents of the programme, within what your account may read."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <div className="grid content-start gap-4">
          <form aria-label="Search the programme" className="flex flex-wrap items-end gap-2" onSubmit={submit}>
            <FormField label="Search for" className="min-w-0 flex-1">
              {(control) => (
                <Input {...control} value={draft} maxLength={200} onChange={(event) => setDraft(event.target.value)} />
              )}
            </FormField>
            <Button type="submit" variant="primary">
              Search
            </Button>
          </form>
          <div className="flex flex-wrap items-end gap-4">
            <fieldset className="flex flex-wrap gap-3">
              <legend className="mb-1 text-sm font-medium text-fg-strong">Kinds</legend>
              {SEARCH_RESULT_KINDS.map((kind) => (
                <label key={kind} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={kinds.includes(kind)}
                    onChange={(event) => toggleKind(kind, event.target.checked)}
                  />
                  {KIND_LABELS[kind]}
                </label>
              ))}
            </fieldset>
            <LiveView
              live={directory}
              loadingLabel="Loading the replications"
              errorTitle="The replications could not be loaded."
              onRetry={retryFailedLiveData}
            >
              {({ replications }) => (
                <FormField label="Replication" className="min-w-48">
                  {(control) => (
                    <Select
                      {...control}
                      value={replicationId}
                      onChange={(event) => update({ replication: event.target.value })}
                    >
                      <option value="">Every replication</option>
                      {replications.map((replication) => (
                        <option key={replication.id} value={replication.id}>
                          {replication.id}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
              )}
            </LiveView>
          </div>
          {!typed ? (
            <EmptyState
              title="Type what you are looking for"
              description="A study identifier, a name, a laboratory, words of a page or a comment, or the title of a linked document."
            />
          ) : (
            <div className="grid gap-5">
              {wantsRecords ? (
                <LiveView
                  live={directory}
                  loadingLabel="Searching the records"
                  errorTitle="The records could not be searched."
                  onRetry={retryFailedLiveData}
                >
                  {(data) => <RecordResults hits={recordHits(data, query, replicationId)} />}
                </LiveView>
              ) : null}
              <IndexedResults state={indexed} />
            </div>
          )}
        </div>
        <aside className="grid content-start gap-4">
          {viewer === null ? null : <SavedSearches uid={viewer.uid} />}
          {typed && viewer !== null ? (
            <form className="grid gap-2" onSubmit={save} aria-label="Save this search">
              <FormField label="Save this search as">
                {(control) => (
                  <Input
                    {...control}
                    value={saveName}
                    maxLength={100}
                    onChange={(event) => setSaveName(event.target.value)}
                  />
                )}
              </FormField>
              <Button type="submit" disabled={saveName.trim() === ""}>
                Save the search
              </Button>
              {savedNote ? (
                <p role="status" className="text-sm">
                  The search is saved.
                </p>
              ) : null}
              {saveFailure === null ? null : (
                <p role="alert" className="text-sm text-fg-accent">
                  {saveFailure}
                </p>
              )}
            </form>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function RecordResults({ hits }: { hits: readonly RecordHit[] }) {
  return (
    <section className="grid gap-2" aria-label="Records found">
      <h2 className="text-md font-medium text-fg-strong">Records</h2>
      {hits.length === 0 ? (
        <p className="text-sm text-fg-secondary">No record matches.</p>
      ) : (
        <ul className="grid gap-1">
          {hits.map((hit) => (
            <li key={hit.key} data-testid="search-record">
              <Link className="text-fg-accent underline" to={hit.to}>
                {hit.label}
              </Link>{" "}
              <span className="text-sm text-fg-secondary">{hit.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function IndexedResults({ state }: { state: ReturnType<typeof useIndexedResults> }) {
  const grouped = useMemo(() => {
    if (state.status !== "ready") return [];
    return (["page", "comment", "document"] as const)
      .map((kind) => ({ kind, results: state.results.filter((result) => indexedKind(result) === kind) }))
      .filter((group) => group.results.length > 0);
  }, [state]);
  if (state.status === "idle") return null;
  if (state.status === "loading") {
    return (
      <p className="flex items-center gap-2 text-sm text-fg-secondary">
        <Spinner label="Searching" /> Searching pages, comments and documents
      </p>
    );
  }
  if (state.status === "error")
    return <ErrorState title="Pages, comments and documents could not be searched." description={state.message} />;
  if (grouped.length === 0)
    return <p className="text-sm text-fg-secondary">No page, comment or linked document matches.</p>;
  return (
    <>
      {grouped.map((group) => (
        <section key={group.kind} className="grid gap-2" aria-label={`${KIND_LABELS[group.kind]} found`}>
          <h2 className="text-md font-medium text-fg-strong">{KIND_LABELS[group.kind]}</h2>
          <ul className="grid gap-1">
            {group.results.map((result) => {
              const to = indexedPath(result);
              return (
                <li key={`${result.entityType}/${result.entityId}`} data-testid="search-indexed">
                  {to === null ? (
                    <span>{result.title}</span>
                  ) : (
                    <Link className="text-fg-accent underline" to={to}>
                      {result.title}
                    </Link>
                  )}{" "}
                  <Badge tone="outline">{KIND_LABELS[group.kind]}</Badge>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
