// Finding a person of the directory by name, which members may read, for the console.
import { useState } from "react";
import { LiveView } from "@/components/feedback/live-view";
import { Badge } from "@/components/ui/badge";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { useLiveQuery } from "@/data";

/**
 * Finds a person of the directory by name and chooses one. `groupName` names the radio group.
 * `onChoose` also receives the account the person is linked to, or null.
 */
export function PersonSearch({
  groupName,
  chosen,
  onChoose,
}: {
  groupName: string;
  chosen: string | null;
  onChoose: (id: string, linkedUid: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const persons = useLiveQuery(search.trim().length < 2 ? null : { collection: "persons", within: [], limit: 1_000 });
  const query = search.trim().toLowerCase();
  return (
    <div className="grid gap-2">
      <FormField label="Find the person in the directory" hint="Type at least two letters of the name.">
        {(control) => (
          <Input {...control} type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        )}
      </FormField>
      <LiveView live={persons} loadingLabel="Searching the directory" errorTitle="The directory could not be searched.">
        {(list) => {
          const matches = list.filter((person) => person.displayName.toLowerCase().includes(query)).slice(0, 8);
          if (matches.length === 0) return <p className="text-fg-secondary">Nobody in the directory matches.</p>;
          return (
            <fieldset className="grid gap-1">
              <legend className="sr-only">People who match</legend>
              {matches.map((person) => (
                <label
                  key={person.id}
                  className="flex cursor-pointer items-center gap-2 rounded-control border border-border bg-background px-3 py-2 pointer-coarse:min-h-11"
                >
                  <input
                    type="radio"
                    name={groupName}
                    value={person.id}
                    checked={chosen === person.id}
                    onChange={() => onChoose(person.id, person.userId)}
                  />
                  <span className="font-medium">{person.displayName}</span>
                  {person.affiliationSummary ? (
                    <span className="text-fg-secondary">{person.affiliationSummary}</span>
                  ) : null}
                  {person.userId === null ? null : <Badge tone="neutral">Already claimed</Badge>}
                </label>
              ))}
            </fieldset>
          );
        }}
      </LiveView>
    </div>
  );
}
