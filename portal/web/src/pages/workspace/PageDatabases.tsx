// The databases beneath a page (D-011): each a collection of rows of its own, with the audience
// of the page, which its editors create here through the function createDatabase.
import { createDatabaseContract } from "@eegml/shared";
import { Database } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { LiveView } from "@/components/feedback/live-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CallableError, callFunction, type RecordOf, retryFailedLiveData, useLiveQuery } from "@/data";
import type { Viewer } from "@/registry/viewer";

export function PageDatabases({
  page,
  viewer,
  editable,
}: {
  readonly page: RecordOf<"pages">;
  readonly viewer: Viewer;
  readonly editable: boolean;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const databases = useLiveQuery({
    collection: "databases",
    within: [],
    where: viewer.staff
      ? [["parentPageId", "==", page.id]]
      : [
          ["parentPageId", "==", page.id],
          ["scopeKeys", "array-contains-any", [...viewer.queryScopeKeys]],
        ],
    limit: 200,
  });
  const create = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name?.trim() ?? "";
    if (trimmed === "") return;
    setError(null);
    callFunction(createDatabaseContract, { parentPageId: page.id, name: trimmed })
      .then(({ databaseId }) => navigate(`/databases/${databaseId}`))
      .catch((failure: unknown) =>
        setError(failure instanceof CallableError ? failure.message : "The database was not created."),
      );
  };
  return (
    <section aria-labelledby={`databases-${page.id}`} className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`databases-${page.id}`} className="text-lg text-fg">
          Databases
        </h2>
        {editable && name === null ? (
          <Button size="sm" variant="outline" onClick={() => setName("")}>
            <Database aria-hidden="true" strokeWidth={1.8} />
            Add a database
          </Button>
        ) : null}
      </div>
      {editable && name !== null ? (
        <form className="flex flex-wrap items-center gap-2" onSubmit={create}>
          <Input
            className="w-64"
            aria-label="Name of the new database"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button size="sm" type="submit" variant="primary" disabled={name.trim() === ""}>
            Create
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setName(null)}>
            Cancel
          </Button>
        </form>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="text-sm text-fg-accent">
          {error}
        </p>
      )}
      <LiveView
        live={databases}
        loadingLabel="Loading the databases"
        errorTitle="The databases could not be loaded"
        onRetry={retryFailedLiveData}
      >
        {(list) => {
          const shown = list.filter((database) => database.archivedAt === null);
          return shown.length === 0 ? (
            <p className="text-fg-muted">No database belongs to this page.</p>
          ) : (
            <ul className="grid gap-1">
              {shown.map((database) => (
                <li key={database.id}>
                  <Link className="text-fg-accent underline" to={`/databases/${database.id}`}>
                    {database.name}
                  </Link>
                </li>
              ))}
            </ul>
          );
        }}
      </LiveView>
    </section>
  );
}
