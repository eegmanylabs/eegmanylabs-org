// The person an account is linked to, read from the directory, which members may read. The
// console uses it where it knows only an account and may not call listUsers.
import { useLiveQuery } from "@/data";

/** The name of the person that an account has claimed, or a plain description while none is known. */
export function PersonOfAccount({ uid }: { uid: string }) {
  const persons = useLiveQuery({ collection: "persons", within: [], where: [["userId", "==", uid]], limit: 1 });
  if (persons.status === "ready" && persons.data[0] !== undefined) return <>{persons.data[0].displayName}</>;
  if (persons.status === "ready") return <span className="text-fg-secondary">An account not linked to a profile</span>;
  return <span className="text-fg-secondary">Loading the name</span>;
}
