// The protocol of a replication (requirement R12.3): its versions with their approval, the
// acknowledgement of the current version by the team of each laboratory, the deviations each
// laboratory reports, and the compliance of each laboratory that follows from them. Versions,
// acknowledgements and deviations are written directly under the security rules, which decide
// who may write each.
import { COMPLIANCE_STATE_LABELS, currentApprovedVersion, participationCompliance } from "@eegml/shared";
import { type FormEvent, useState } from "react";
import { Unknown } from "@/components/registry/unknown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  acknowledgeProtocolVersion,
  approveProtocolVersion,
  createProtocol,
  createProtocolVersion,
  followUpDeviation,
  type RecordOf,
  removeTeamMember,
  reportDeviation,
  saveTeamMember,
  setParticipationProtocol,
} from "@/data";
import { Section } from "@/pages/replications/tabs/OverviewTab";
import type { Viewer } from "@/registry/viewer";
import {
  DEVIATION_SEVERITY_LABELS,
  DEVIATION_STATUS_LABELS,
  readableDate,
  readableInstant,
  todayIsoDate,
} from "./science-format";

type Version = RecordOf<"replicationProtocolVersions">;
type Deviation = RecordOf<"participationDeviations">;
type TeamMember = RecordOf<"participationTeamMembers">;
type TeamRole = TeamMember["role"];

const TEAM_ROLE_LABELS: Readonly<Record<TeamRole, string>> = {
  localLead: "Local lead",
  experimenter: "Experimenter",
  analyst: "Analyst",
  dataManager: "Data manager",
  member: "Member",
};

const VERSION_STATUS_LABELS = { draft: "Draft", approved: "Approved", superseded: "Superseded" } as const;

/** Runs a write and says how it went, in words. */
function useWrite(): (work: () => Promise<unknown>, done: string) => Promise<boolean> {
  const toast = useToast();
  return async (work, done) => {
    try {
      await work();
      toast.show({ title: done });
      return true;
    } catch {
      toast.show({
        title: "The change was not saved.",
        description: "Your account may not make it, or the record changed meanwhile. Reload the page and try again.",
      });
      return false;
    }
  };
}

export function ProtocolTab({
  studyKey,
  viewer,
  protocols,
  versions,
  participations,
  laboratoryNames,
  teamMembers,
  acknowledgements,
  deviations,
  persons,
}: {
  studyKey: string;
  viewer: Viewer;
  protocols: readonly RecordOf<"replicationProtocols">[];
  versions: readonly Version[];
  participations: readonly RecordOf<"participations">[];
  laboratoryNames: ReadonlyMap<string, string>;
  teamMembers: readonly RecordOf<"participationTeamMembers">[];
  acknowledgements: readonly RecordOf<"participationAcknowledgements">[];
  deviations: readonly Deviation[];
  /** The people of the directory, for those who manage a team; empty for everyone else. */
  persons: readonly RecordOf<"persons">[];
}) {
  const write = useWrite();
  const leads = viewer.access.member && viewer.can("replications.manage", { replicationId: studyKey });
  const [dialog, setDialog] = useState<
    | { kind: "protocol" }
    | { kind: "version"; protocolId: string }
    | { kind: "deviation"; participation: RecordOf<"participations"> }
    | { kind: "team"; participation: RecordOf<"participations"> }
    | null
  >(null);
  const current = protocols.filter((protocol) => protocol.archivedAt === null);
  const managedParticipations = participations.filter(
    (participation) =>
      viewer.access.member &&
      viewer.can("participations.manage", { replicationId: studyKey, laboratoryId: participation.laboratoryId }),
  );
  return (
    <div className="grid gap-6">
      <Section
        title="Protocols and versions"
        aside={
          leads ? (
            <Button size="sm" onClick={() => setDialog({ kind: "protocol" })}>
              New protocol
            </Button>
          ) : null
        }
      >
        {current.length === 0 ? (
          <p className="text-fg-muted">No protocol is recorded for this replication yet.</p>
        ) : (
          <div className="grid min-w-0 gap-4">
            {current.map((protocol) => {
              const ofProtocol = versions
                .filter((version) => version.protocolId === protocol.id && version.archivedAt === null)
                .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
              const approved = currentApprovedVersion(versions, protocol.id);
              return (
                <div key={protocol.id} className="grid min-w-0 gap-2" data-testid="protocol">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-medium text-fg-strong">{protocol.title}</h3>
                    {leads ? (
                      <Button size="sm" onClick={() => setDialog({ kind: "version", protocolId: protocol.id })}>
                        Add a version<span className="sr-only"> of {protocol.title}</span>
                      </Button>
                    ) : null}
                  </div>
                  {protocol.description === undefined ? null : (
                    <p className="text-fg-secondary">{protocol.description}</p>
                  )}
                  {ofProtocol.length === 0 ? (
                    <p className="text-sm text-fg-muted">No version yet.</p>
                  ) : (
                    <Table caption={`Versions of ${protocol.title}`}>
                      <TableHead>
                        <TableRow>
                          <TableHeaderCell>Version</TableHeaderCell>
                          <TableHeaderCell>Status</TableHeaderCell>
                          <TableHeaderCell>Effective</TableHeaderCell>
                          <TableHeaderCell>Approved</TableHeaderCell>
                          <TableHeaderCell>Changes</TableHeaderCell>
                          <TableHeaderCell>Actions</TableHeaderCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {ofProtocol.map((version) => (
                          <TableRow key={version.id}>
                            <TableCell>{version.versionLabel}</TableCell>
                            <TableCell>
                              {version.id === approved?.id ? (
                                <Badge tone="solid">Current</Badge>
                              ) : (
                                VERSION_STATUS_LABELS[version.status]
                              )}
                            </TableCell>
                            <TableCell>
                              {version.effectiveDate === undefined ? <Unknown /> : readableDate(version.effectiveDate)}
                            </TableCell>
                            <TableCell>
                              {version.approvedAt === null ? (
                                <Unknown>Not approved</Unknown>
                              ) : (
                                readableInstant(version.approvedAt)
                              )}
                            </TableCell>
                            <TableCell>{version.changeSummary ?? <Unknown />}</TableCell>
                            <TableCell>
                              {leads && version.status === "draft" ? (
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    void write(
                                      () =>
                                        approveProtocolVersion(
                                          viewer.uid,
                                          studyKey,
                                          protocol.id,
                                          version.id,
                                          ofProtocol
                                            .filter((other) => other.status === "approved")
                                            .map((other) => other.id),
                                        ),
                                      `Version ${version.versionLabel} approved.`,
                                    )
                                  }
                                >
                                  Approve version {version.versionLabel}
                                </Button>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Compliance of each laboratory">
        {participations.length === 0 ? (
          <p className="text-fg-muted">No laboratory takes part yet.</p>
        ) : (
          <Table caption="Compliance with the protocol, by laboratory">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Laboratory</TableHeaderCell>
                <TableHeaderCell>Compliance</TableHeaderCell>
                <TableHeaderCell>Acknowledged</TableHeaderCell>
                <TableHeaderCell>Open deviations</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {participations.map((participation) => {
                const team = teamMembers.filter((member) => member.participationId === participation.id);
                const result = participationCompliance(
                  participation,
                  versions,
                  team,
                  acknowledgements.filter((ack) => ack.participationId === participation.id),
                  deviations.filter((deviation) => deviation.participationId === participation.id),
                );
                const open = result.openDeviations.minor + result.openDeviations.major + result.openDeviations.critical;
                const mine =
                  viewer.personId !== null &&
                  result.currentVersionId !== null &&
                  result.awaiting.includes(viewer.personId);
                const name = laboratoryNames.get(participation.laboratoryId) ?? participation.laboratoryId;
                return (
                  <TableRow key={participation.id}>
                    <TableCell>{name}</TableCell>
                    <TableCell>
                      {result.state === "compliant" ? (
                        COMPLIANCE_STATE_LABELS.compliant
                      ) : (
                        <Badge tone="accent">{COMPLIANCE_STATE_LABELS[result.state]}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {result.teamSize === 0 ? (
                        <Unknown>No team recorded</Unknown>
                      ) : (
                        `${result.acknowledgedBy.length} of ${result.teamSize}`
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">{open}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-2">
                        {mine &&
                        viewer.personId !== null &&
                        result.currentVersionId !== null &&
                        participation.protocolId !== undefined ? (
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() =>
                              void write(
                                () =>
                                  acknowledgeProtocolVersion(viewer.uid, {
                                    participationId: participation.id,
                                    replicationId: participation.replicationId,
                                    laboratoryId: participation.laboratoryId,
                                    personId: viewer.personId as string,
                                    protocolId: participation.protocolId as string,
                                    protocolVersionId: result.currentVersionId as string,
                                  }),
                                "Your acknowledgement is recorded.",
                              )
                            }
                          >
                            Acknowledge the current version for {name}
                          </Button>
                        ) : null}
                        {managedParticipations.includes(participation) ? (
                          <>
                            <Select
                              aria-label={`Protocol that ${name} follows`}
                              className="w-auto min-w-44"
                              value={participation.protocolId ?? ""}
                              onChange={(event) =>
                                void write(
                                  () =>
                                    setParticipationProtocol(
                                      viewer.uid,
                                      participation.id,
                                      event.target.value === "" ? null : event.target.value,
                                    ),
                                  event.target.value === ""
                                    ? `${name} follows no protocol now.`
                                    : `${name} now follows ${current.find((protocol) => protocol.id === event.target.value)?.title ?? "the protocol"}.`,
                                )
                              }
                            >
                              <option value="">No protocol named</option>
                              {current.map((protocol) => (
                                <option key={protocol.id} value={protocol.id}>
                                  {protocol.title}
                                </option>
                              ))}
                            </Select>
                            <Button size="sm" onClick={() => setDialog({ kind: "team", participation })}>
                              Team of {name}
                            </Button>
                            <Button size="sm" onClick={() => setDialog({ kind: "deviation", participation })}>
                              Report a deviation for {name}
                            </Button>
                          </>
                        ) : null}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Deviations from the protocol">
        {deviations.length === 0 ? (
          <EmptyState
            title="No deviations reported"
            description="Deviations that the laboratories report appear here."
          />
        ) : (
          <ul className="grid gap-2" data-testid="deviations">
            {[...deviations]
              .filter((deviation) => deviation.archivedAt === null)
              .sort((a, b) => b.occurredAt.toMillis() - a.occurredAt.toMillis())
              .map((deviation) => (
                <DeviationItem
                  key={`${deviation.participationId}/${deviation.id}`}
                  deviation={deviation}
                  viewer={viewer}
                  laboratoryName={laboratoryNames.get(deviation.laboratoryId) ?? deviation.laboratoryId}
                  write={write}
                />
              ))}
          </ul>
        )}
      </Section>

      {dialog?.kind === "protocol" ? (
        <ProtocolDialog studyKey={studyKey} viewer={viewer} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "version" ? (
        <VersionDialog
          studyKey={studyKey}
          viewer={viewer}
          protocolId={dialog.protocolId}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "team" ? (
        <TeamDialog
          viewer={viewer}
          participation={dialog.participation}
          name={laboratoryNames.get(dialog.participation.laboratoryId) ?? dialog.participation.laboratoryId}
          team={teamMembers.filter((member) => member.participationId === dialog.participation.id)}
          persons={persons}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "deviation" ? (
        <DeviationDialog viewer={viewer} participation={dialog.participation} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

function DeviationItem({
  deviation,
  viewer,
  laboratoryName,
  write,
}: {
  deviation: Deviation;
  viewer: Viewer;
  laboratoryName: string;
  write: ReturnType<typeof useWrite>;
}) {
  const [action, setAction] = useState(deviation.correctiveAction ?? "");
  const manages =
    viewer.access.member &&
    viewer.can("participations.manage", {
      replicationId: deviation.replicationId,
      laboratoryId: deviation.laboratoryId,
    });
  const reporter = deviation.reportedBy === viewer.uid;
  return (
    <li className="grid gap-2 rounded-tile border border-border px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{deviation.description}</span>
        <span className="flex flex-wrap gap-2">
          <Badge tone={deviation.severity === "minor" ? "neutral" : "accent"}>
            {DEVIATION_SEVERITY_LABELS[deviation.severity]}
          </Badge>
          <Badge tone="outline">{DEVIATION_STATUS_LABELS[deviation.status]}</Badge>
        </span>
      </div>
      <p className="text-xs text-fg-muted">
        {laboratoryName}, {readableInstant(deviation.occurredAt)}
      </p>
      {deviation.correctiveAction === undefined ? null : (
        <p className="text-sm">Corrective action: {deviation.correctiveAction}</p>
      )}
      {manages && deviation.status !== "resolved" ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void write(
              () =>
                followUpDeviation(viewer.uid, deviation.participationId, deviation.id, {
                  correctiveAction: action.trim() === "" ? null : action.trim(),
                  status: reporter ? deviation.status : "underReview",
                }),
              "Corrective action saved.",
            );
          }}
        >
          <FormField label="Corrective action" className="min-w-64 flex-1">
            {(control) => <Input {...control} value={action} onChange={(event) => setAction(event.target.value)} />}
          </FormField>
          <Button type="submit" size="sm">
            Save the corrective action
          </Button>
          {reporter ? (
            <Button
              type="button"
              size="sm"
              onClick={() =>
                void write(
                  () =>
                    followUpDeviation(viewer.uid, deviation.participationId, deviation.id, {
                      correctiveAction: action.trim() === "" ? null : action.trim(),
                      status: "resolved",
                    }),
                  "Deviation resolved.",
                )
              }
            >
              Resolve
            </Button>
          ) : null}
        </form>
      ) : null}
    </li>
  );
}

function DialogButtons({ busy, label }: { busy: boolean; label: string }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <DialogClose asChild>
        <Button type="button" variant="ghost">
          Cancel
        </Button>
      </DialogClose>
      <Button type="submit" variant="primary" disabled={busy}>
        {label}
      </Button>
    </div>
  );
}

function ProtocolDialog({ studyKey, viewer, onClose }: { studyKey: string; viewer: Viewer; onClose: () => void }) {
  const write = useWrite();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (title.trim() === "") return setFailure("Give the protocol a title.");
    setBusy(true);
    const done = await write(
      () =>
        createProtocol(viewer.uid, studyKey, {
          title: title.trim(),
          description: description.trim() === "" ? null : description.trim(),
        }),
      "Protocol created.",
    );
    setBusy(false);
    if (done) onClose();
  };
  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent
        title="New protocol"
        description="Its content is held in its versions, which are approved one by one."
      >
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <FormField label="Title" error={failure}>
            {(control) => <Input {...control} value={title} onChange={(event) => setTitle(event.target.value)} />}
          </FormField>
          <FormField label="Description" hint="Optional.">
            {(control) => (
              <Textarea {...control} value={description} onChange={(event) => setDescription(event.target.value)} />
            )}
          </FormField>
          <DialogButtons busy={busy} label="Create the protocol" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VersionDialog({
  studyKey,
  viewer,
  protocolId,
  onClose,
}: {
  studyKey: string;
  viewer: Viewer;
  protocolId: string;
  onClose: () => void;
}) {
  const write = useWrite();
  const [label, setLabel] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (label.trim() === "") return setFailure("Name the version, for example 1.1.");
    setBusy(true);
    const done = await write(
      () =>
        createProtocolVersion(viewer.uid, studyKey, {
          protocolId,
          versionLabel: label.trim(),
          effectiveDate: effectiveDate === "" ? null : effectiveDate,
          changeSummary: summary.trim() === "" ? null : summary.trim(),
        }),
      "Draft version added.",
    );
    setBusy(false);
    if (done) onClose();
  };
  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent
        title="Add a version"
        description="A version starts as a draft. Its approval is a signature in your name."
      >
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <FormField label="Version" error={failure}>
            {(control) => <Input {...control} value={label} onChange={(event) => setLabel(event.target.value)} />}
          </FormField>
          <FormField label="Effective from" hint="Optional.">
            {(control) => (
              <Input
                {...control}
                type="date"
                value={effectiveDate}
                onChange={(event) => setEffectiveDate(event.target.value)}
              />
            )}
          </FormField>
          <FormField label="What changed" hint="Optional.">
            {(control) => (
              <Textarea {...control} value={summary} onChange={(event) => setSummary(event.target.value)} />
            )}
          </FormField>
          <DialogButtons busy={busy} label="Add the version" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The team of a participation: the people at the laboratory who work on the replication, each in
 * a role, who are asked to acknowledge the protocol it follows. Someone taken off the team keeps
 * their entry, archived, and is put back by adding them again.
 */
function TeamDialog({
  viewer,
  participation,
  name,
  team,
  persons,
  onClose,
}: {
  viewer: Viewer;
  participation: RecordOf<"participations">;
  name: string;
  team: readonly TeamMember[];
  persons: readonly RecordOf<"persons">[];
  onClose: () => void;
}) {
  const write = useWrite();
  const [personId, setPersonId] = useState("");
  const [role, setRole] = useState<TeamRole>("member");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const nameOf = (id: string) => persons.find((person) => person.id === id)?.displayName ?? id;
  const active = team
    .filter((member) => member.archivedAt === null)
    .sort((a, b) => nameOf(a.personId).localeCompare(nameOf(b.personId), "en-GB"));
  const candidates = persons
    .filter(
      (person) =>
        person.archivedAt === null &&
        person.laboratoryIds.includes(participation.laboratoryId) &&
        !active.some((member) => member.personId === person.id),
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "en-GB"));
  const unit = {
    participationId: participation.id,
    replicationId: participation.replicationId,
    laboratoryId: participation.laboratoryId,
  };
  const stateOf = (id: string): "absent" | "active" | "archived" => {
    const entry = team.find((member) => member.personId === id);
    return entry === undefined ? "absent" : entry.archivedAt === null ? "active" : "archived";
  };
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (personId === "") return setFailure("Choose a person of the laboratory.");
    setBusy(true);
    setFailure(null);
    const done = await write(
      () => saveTeamMember(viewer.uid, { ...unit, personId, role }, stateOf(personId)),
      `${nameOf(personId)} is on the team of ${name}.`,
    );
    setBusy(false);
    if (done) setPersonId("");
  };
  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent
        title={`Team of ${name}`}
        description="The people at the laboratory who work on this replication. Each of them acknowledges the protocol the laboratory follows."
      >
        <div className="grid gap-4">
          {active.length === 0 ? (
            <p className="text-sm text-fg-muted">Nobody is on the team yet.</p>
          ) : (
            <ul className="grid gap-2" data-testid="team-members">
              {active.map((member) => (
                <li key={member.personId} className="grid gap-1">
                  <span className="font-medium">{nameOf(member.personId)}</span>
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <Select
                      aria-label={`Role of ${nameOf(member.personId)}`}
                      className="w-auto"
                      value={member.role}
                      onChange={(event) =>
                        void write(
                          () =>
                            saveTeamMember(
                              viewer.uid,
                              { ...unit, personId: member.personId, role: event.target.value as TeamRole },
                              "active",
                            ),
                          `The role of ${nameOf(member.personId)} is saved.`,
                        )
                      }
                    >
                      {Object.entries(TEAM_ROLE_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      onClick={() =>
                        void write(
                          () => removeTeamMember(viewer.uid, participation.id, member.personId),
                          `${nameOf(member.personId)} is no longer on the team.`,
                        )
                      }
                    >
                      Remove<span className="sr-only"> {nameOf(member.personId)}</span>
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <form className="grid gap-3" onSubmit={add} noValidate>
            {candidates.length === 0 ? (
              <p className="text-sm text-fg-muted">
                Everyone listed at the laboratory is on the team. A person joins the laboratory on its page first.
              </p>
            ) : (
              <>
                <FormField label="Person of the laboratory" error={failure}>
                  {(control) => (
                    <Select {...control} value={personId} onChange={(event) => setPersonId(event.target.value)}>
                      <option value="">Choose a person</option>
                      {candidates.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.displayName}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
                <FormField label="Role">
                  {(control) => (
                    <Select {...control} value={role} onChange={(event) => setRole(event.target.value as TeamRole)}>
                      {Object.entries(TEAM_ROLE_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="submit" variant="primary" disabled={busy}>
                    Add to the team
                  </Button>
                </div>
              </>
            )}
            <div className="flex justify-end">
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Close
                </Button>
              </DialogClose>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeviationDialog({
  viewer,
  participation,
  onClose,
}: {
  viewer: Viewer;
  participation: RecordOf<"participations">;
  onClose: () => void;
}) {
  const write = useWrite();
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<"minor" | "major" | "critical">("minor");
  const [occurredAt, setOccurredAt] = useState(todayIsoDate());
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (description.trim() === "") return setFailure("Describe the deviation.");
    setBusy(true);
    const done = await write(
      () =>
        reportDeviation(viewer.uid, {
          participationId: participation.id,
          replicationId: participation.replicationId,
          laboratoryId: participation.laboratoryId,
          description: description.trim(),
          severity,
          occurredAt: new Date(`${occurredAt}T12:00:00`),
        }),
      "Deviation reported.",
    );
    setBusy(false);
    if (done) onClose();
  };
  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : onClose())}>
      <DialogContent
        title="Report a deviation"
        description="A deviation from the protocol, which the replication's leads review."
      >
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <FormField label="What deviated" error={failure}>
            {(control) => (
              <Textarea {...control} value={description} onChange={(event) => setDescription(event.target.value)} />
            )}
          </FormField>
          <FormField label="Severity">
            {(control) => (
              <Select
                {...control}
                value={severity}
                onChange={(event) => setSeverity(event.target.value as typeof severity)}
              >
                {Object.entries(DEVIATION_SEVERITY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Date it happened">
            {(control) => (
              <Input
                {...control}
                type="date"
                value={occurredAt}
                onChange={(event) => setOccurredAt(event.target.value)}
              />
            )}
          </FormField>
          <DialogButtons busy={busy} label="Report the deviation" />
        </form>
      </DialogContent>
    </Dialog>
  );
}
