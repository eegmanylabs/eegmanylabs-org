// The name of a record, read live from the directory, one document at a time. While the name is
// loading it is marked as loading, and where the record cannot be read the identifier stands in
// for it, so that a list never shows a blank and never shows an identifier as if it were a name.
import type { Live } from "@/data";
import { useLiveDocument } from "@/data";

function NameOrId({ live, name, id }: { live: Live<unknown>; name: string | undefined; id: string }) {
  if (name !== undefined) return name;
  if (live.status === "loading") {
    return (
      <span className="text-fg-muted" aria-busy="true">
        Loading the name
      </span>
    );
  }
  return <span className="break-all text-fg-secondary">{id}</span>;
}

export function LaboratoryName({ id }: { id: string }) {
  const laboratory = useLiveDocument("laboratories", [id]);
  return (
    <NameOrId live={laboratory} id={id} name={laboratory.status === "ready" ? laboratory.data?.name : undefined} />
  );
}

export function ReplicationName({ id }: { id: string }) {
  const replication = useLiveDocument("replications", [id]);
  const title = replication.status === "ready" ? replication.data?.shortTitle : undefined;
  return <NameOrId live={replication} id={id} name={title === undefined ? undefined : `${title} (${id})`} />;
}

export function PersonName({ id }: { id: string }) {
  const person = useLiveDocument("persons", [id]);
  return <NameOrId live={person} id={id} name={person.status === "ready" ? person.data?.displayName : undefined} />;
}

/**
 * The name of the unit a role is held for. `standalone` is for a name that stands on its own,
 * as in a table cell, where it starts with a capital letter.
 */
export function ScopeName({
  scopeType,
  scopeId,
  standalone = false,
}: {
  scopeType: string;
  scopeId: string;
  standalone?: boolean;
}) {
  if (scopeType === "laboratory") return <LaboratoryName id={scopeId} />;
  if (scopeType === "replication") return <ReplicationName id={scopeId} />;
  if (scopeType === "programme") return <>{standalone ? "The programme" : "the programme"}</>;
  return <span className="break-all">{scopeId}</span>;
}
