// Registers a dataset through `registerDataset` (acceptance scenario 8): its replication and
// laboratory, what it holds, and optionally its first copy on a storage server of the portal,
// such as an institutional server in Bremen or Munich. Nothing is transferred, and no central
// copy is needed. Only the replications and laboratories in which the viewer may register
// datasets are offered; the function decides again.
import { type CallableInput, keySchema, registerDatasetContract, storagePathProblem } from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CallableError, callFunction, type RecordOf } from "@/data";
import type { Viewer } from "@/registry/viewer";
import { parseValues } from "./dataset-actions";
import { MODALITY_LABELS, PROTOCOL_LABELS, ROLE_LABELS, suggestedDatasetKey } from "./dataset-format";

type Registration = CallableInput<typeof registerDatasetContract>;

/** The units in which the viewer may register a dataset: each replication with the laboratories it may name. */
export function registrationUnits(
  viewer: Viewer,
  participations: readonly RecordOf<"participations">[],
): ReadonlyMap<string, readonly string[]> {
  const units = new Map<string, string[]>();
  for (const participation of participations) {
    if (participation.archivedAt !== null) continue;
    const { replicationId, laboratoryId } = participation;
    if (viewer.can("datasets.manage", { replicationId, laboratoryId })) {
      units.set(replicationId, [...(units.get(replicationId) ?? []), laboratoryId]);
    }
  }
  return units;
}

export function RegisterDatasetDialog({
  open,
  onOpenChange,
  viewer,
  participations,
  laboratories,
  endpoints,
  fixedReplication,
  fixedLaboratory,
  onRegistered,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewer: Viewer;
  participations: readonly RecordOf<"participations">[];
  laboratories: readonly RecordOf<"laboratories">[];
  endpoints: readonly RecordOf<"storageEndpoints">[];
  fixedReplication?: string;
  fixedLaboratory?: string;
  onRegistered: (datasetKey: string) => void;
}) {
  const units = registrationUnits(viewer, participations);
  const replicationIds = [...units.keys()]
    .filter((id) => fixedReplication === undefined || id === fixedReplication)
    .filter((id) => fixedLaboratory === undefined || (units.get(id) ?? []).includes(fixedLaboratory))
    .sort();
  const [replicationId, setReplicationId] = useState(fixedReplication ?? replicationIds[0] ?? "");
  const laboratoryIds = (units.get(replicationId) ?? []).filter(
    (id) => fixedLaboratory === undefined || id === fixedLaboratory,
  );
  const [laboratoryId, setLaboratoryId] = useState(fixedLaboratory ?? laboratoryIds[0] ?? "");
  const [modality, setModality] = useState<Registration["modality"]>("main");
  const [title, setTitle] = useState("");
  const [key, setKey] = useState("");
  const [grouping, setGrouping] = useState("");
  const [participants, setParticipants] = useState("");
  const [metadata, setMetadata] = useState("");
  const openEndpoints = endpoints.filter((endpoint) => endpoint.status !== "retired" && endpoint.archivedAt === null);
  const [endpointKey, setEndpointKey] = useState("");
  const [role, setRole] = useState<"primary" | "mirror" | "backup" | "processingCopy">("primary");
  const [path, setPath] = useState("");
  const [electroTag, setElectroTag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const laboratory = laboratories.find((candidate) => candidate.id === laboratoryId);
  const suggestion = suggestedDatasetKey(replicationId, laboratory?.slug ?? null, modality);
  const datasetKey = key.trim() === "" ? suggestion : key.trim();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsedMetadata = parseValues(metadata);
    const expected = participants.trim() === "" ? null : Number(participants);
    if (replicationId === "" || laboratoryId === "" || title.trim() === "") {
      setFailure("Choose the replication and the laboratory, and give the dataset a title.");
      return;
    }
    if (!keySchema.safeParse(datasetKey).success) {
      setFailure("The key holds letters, digits, hyphens and single underscores only, up to 100 characters.");
      return;
    }
    if (parsedMetadata === null) {
      setFailure("Write the metadata as one name, a colon and a value on each line.");
      return;
    }
    if (expected !== null && (!Number.isInteger(expected) || expected < 0)) {
      setFailure("The number of participants is a whole number.");
      return;
    }
    if (endpointKey !== "" && path.trim() === "") {
      setFailure("Give the path of the copy on the server, or choose no server.");
      return;
    }
    const pathProblem = endpointKey === "" ? null : storagePathProblem(path.trim());
    if (pathProblem !== null) {
      setFailure(pathProblem);
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(registerDatasetContract, {
        datasetKey,
        replicationId,
        laboratoryId,
        title: title.trim(),
        modality,
        groupingLabel: grouping.trim() === "" ? null : grouping.trim(),
        sourceInstitutionId: laboratory?.institutionId ?? null,
        storageOwnerPersonId: null,
        protocolId: null,
        expectedFileCount: null,
        expectedParticipants: expected,
        metadata: parsedMetadata,
        storage:
          endpointKey === ""
            ? null
            : { endpointKey, role, path: path.trim(), viewerSupport: electroTag ? ["electroTag"] : [] },
      });
      onOpenChange(false);
      onRegistered(datasetKey);
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The dataset could not be registered. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Register a dataset"
        description="The registry records where the data is held. Data stays on the institution's server, and nothing is copied to the portal."
      >
        <form noValidate onSubmit={submit} className="mt-5 grid gap-4">
          {failure === null ? null : <ErrorState title="Nothing was registered." description={failure} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Replication">
              {(control) => (
                <Select
                  {...control}
                  value={replicationId}
                  disabled={fixedReplication !== undefined}
                  onChange={(event) => {
                    setReplicationId(event.target.value);
                    setLaboratoryId((units.get(event.target.value) ?? [])[0] ?? "");
                  }}
                >
                  {replicationIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label="Laboratory">
              {(control) => (
                <Select
                  {...control}
                  value={laboratoryId}
                  disabled={fixedLaboratory !== undefined}
                  onChange={(event) => setLaboratoryId(event.target.value)}
                >
                  {laboratoryIds.map((id) => (
                    <option key={id} value={id}>
                      {laboratories.find((candidate) => candidate.id === id)?.name ?? id}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>
          <FormField label="Title" hint="What the dataset holds, for example the task and the session.">
            {(control) => (
              <Input {...control} value={title} maxLength={300} onChange={(event) => setTitle(event.target.value)} />
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Modality">
              {(control) => (
                <Select
                  {...control}
                  value={modality}
                  onChange={(event) => setModality(event.target.value as Registration["modality"])}
                >
                  {(Object.keys(MODALITY_LABELS) as Registration["modality"][]).map((value) => (
                    <option key={value} value={value}>
                      {MODALITY_LABELS[value]}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label="Session or grouping" hint="Optional.">
              {(control) => (
                <Input
                  {...control}
                  value={grouping}
                  maxLength={300}
                  onChange={(event) => setGrouping(event.target.value)}
                />
              )}
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Dataset key" hint={`The permanent identifier. Left empty, it is ${suggestion}.`}>
              {(control) => (
                <Input {...control} value={key} maxLength={100} onChange={(event) => setKey(event.target.value)} />
              )}
            </FormField>
            <FormField label="Expected participants" hint="Optional.">
              {(control) => (
                <Input
                  {...control}
                  inputMode="numeric"
                  value={participants}
                  onChange={(event) => setParticipants(event.target.value)}
                />
              )}
            </FormField>
          </div>
          <FormField
            label="Metadata"
            hint="Optional. One name, a colon and a value on each line, for example Amplifier: BrainAmp. No participant identities."
          >
            {(control) => (
              <Textarea {...control} rows={3} value={metadata} onChange={(event) => setMetadata(event.target.value)} />
            )}
          </FormField>
          <fieldset className="grid gap-4 rounded-tile border border-border p-3">
            <legend className="px-1 text-sm font-medium">First copy</legend>
            <FormField label="Storage server" hint="Optional. A copy on an institutional server is enough.">
              {(control) => (
                <Select {...control} value={endpointKey} onChange={(event) => setEndpointKey(event.target.value)}>
                  <option value="">No copy yet</option>
                  {openEndpoints.map((endpoint) => (
                    <option key={endpoint.id} value={endpoint.id}>
                      {endpoint.name} ({PROTOCOL_LABELS[endpoint.protocol]})
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            {endpointKey === "" ? null : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Role of the copy">
                    {(control) => (
                      <Select
                        {...control}
                        value={role}
                        onChange={(event) => setRole(event.target.value as typeof role)}
                      >
                        {(Object.keys(ROLE_LABELS) as (typeof role)[]).map((value) => (
                          <option key={value} value={value}>
                            {ROLE_LABELS[value]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                  <FormField
                    label="Path on the server"
                    hint="Below the server's base path, inside the folder of your replication or laboratory. Only those who manage it see it."
                  >
                    {(control) => (
                      <Input
                        {...control}
                        value={path}
                        maxLength={1_024}
                        onChange={(event) => setPath(event.target.value)}
                      />
                    )}
                  </FormField>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={electroTag}
                    onChange={(event) => setElectroTag(event.target.checked)}
                  />
                  This copy can be opened in ElectroTag (optional)
                </label>
              </>
            )}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "Registering…" : "Register the dataset"}
            </Button>
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
