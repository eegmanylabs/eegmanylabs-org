// The name of a record, read live from the directory. While the name is loading, or where the
// record cannot be read, the identifier stands in for it, so that a list never shows a blank.
import { useLiveDocument } from "@/data";

function NameOrId({ name, id }: { name: string | undefined; id: string }) {
  return name === undefined ? <span className="break-all text-fg-secondary">{id}</span> : name;
}

export function LaboratoryName({ id }: { id: string }) {
  const laboratory = useLiveDocument("laboratories", [id]);
  return <NameOrId id={id} name={laboratory.status === "ready" ? laboratory.data?.name : undefined} />;
}

export function ReplicationName({ id }: { id: string }) {
  const replication = useLiveDocument("replications", [id]);
  const title = replication.status === "ready" ? replication.data?.shortTitle : undefined;
  return <NameOrId id={id} name={title === undefined ? undefined : `${title} (${id})`} />;
}

export function PersonName({ id }: { id: string }) {
  const person = useLiveDocument("persons", [id]);
  return <NameOrId id={id} name={person.status === "ready" ? person.data?.displayName : undefined} />;
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
