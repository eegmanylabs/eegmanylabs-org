import {
  CAPABILITY_DEFINITIONS,
  capabilityField,
  DEFAULT_ROLE_CAPABILITIES,
  GRANTABLE_CAPABILITIES,
  type GrantableCapability,
  isProgrammeRole,
  type ListedUser,
  PROGRAMME_KEY,
  ROLES,
  type Role,
  roleCanHold,
  SCOPE_TYPES_OF_ROLE,
  SENSITIVE_CAPABILITIES,
  setCapabilityGrantContract,
  setRoleAssignmentContract,
  setRoleCapabilityOverrideContract,
} from "@eegml/shared";
import { type FormEvent, type ReactNode, useState } from "react";
import { formatDate, formatDateTime, ROLE_LABELS } from "@/app/labels";
import { useSignedInUser } from "@/auth/AuthProvider";
import { useProgrammeAdministrator } from "@/auth/use-privilege";
import { ErrorState } from "@/components/feedback/error-state";
import { LiveView } from "@/components/feedback/live-view";
import { ScopeName } from "@/components/record-names";
import { byText, type TableSpec, useTableControls } from "@/components/table-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { SortHeader } from "@/components/ui/sort-header";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  CallableError,
  callFunction,
  type RecordOf,
  retryFailedLiveData,
  useLiveDataDisconnected,
  useLiveDocument,
  useLiveQuery,
} from "@/data";
import { AdminPage } from "./AdminPage";
import { AccountPicker, useAccountNames } from "./accounts";
import { PENDING_ROLE_ASSIGNMENTS, QUEUE_LIMIT } from "./queues";
import { ReasonDialog } from "./ReasonDialog";

type Assignment = RecordOf<"roleAssignments">;
type Grant = RecordOf<"capabilityGrants">;
type AssignmentSort = "account" | "role" | "since";

/** Roles that an administrator grants here. An external collaborator's access comes from shared records. */
const GRANTABLE_ROLES = ROLES.filter((role) => role !== "external_collaborator");

const isSensitive = (capability: GrantableCapability) =>
  (SENSITIVE_CAPABILITIES as readonly GrantableCapability[]).includes(capability);

/** Shown where a decision belongs to programme administrators alone, in place of its controls. */
function AdministratorsOnly() {
  return <span className="text-fg-secondary">Programme administrators decide this</span>;
}

function Panel({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="grid gap-3 rounded-card border border-border bg-surface px-5 py-4">
      <h2 id={id} className="text-lg font-medium tracking-title text-fg-strong">
        {title}
      </h2>
      <p className="text-fg-secondary">{description}</p>
      {children}
    </section>
  );
}

/** The end of a day, as the instant an expiry chosen as a date means. */
const endOfDay = (date: string) => new Date(`${date}T23:59:59Z`).toISOString();
const today = () => new Date().toISOString().slice(0, 10);

function PendingConfirmations() {
  const toast = useToast();
  const administrator = useProgrammeAdministrator();
  const offline = useLiveDataDisconnected();
  const pending = useLiveQuery(PENDING_ROLE_ASSIGNMENTS);
  const nameOf = useAccountNames(pending.status === "ready" ? pending.data.map((assignment) => assignment.uid) : []);
  const [declining, setDeclining] = useState<Assignment | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const approve = async (assignment: Assignment) => {
    setBusy(assignment.id);
    setFailure(null);
    try {
      await callFunction(setRoleAssignmentContract, { action: "approve", assignmentId: assignment.id });
      toast.show({ title: `${ROLE_LABELS[assignment.role]} confirmed for ${nameOf(assignment.uid)}.` });
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The role could not be confirmed. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      id="pending-roles-heading"
      title="Roles waiting for confirmation"
      description="Management roles that the imported records imply. Each confers nothing until you confirm it."
    >
      {failure ? <ErrorState title="Nothing was changed." description={failure} /> : null}
      <LiveView
        live={pending}
        loadingLabel="Loading the roles"
        errorTitle="The roles could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(list) =>
          list.length === 0 ? (
            <EmptyState title="No roles wait for confirmation" />
          ) : (
            <Table caption="Roles to confirm">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Account</TableHeaderCell>
                  <TableHeaderCell>Role</TableHeaderCell>
                  <TableHeaderCell>For</TableHeaderCell>
                  <TableHeaderCell>Proposed</TableHeaderCell>
                  <TableHeaderCell>Decision</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {[...list]
                  .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis())
                  .map((assignment) => (
                    <TableRow key={assignment.id}>
                      <TableCell>{nameOf(assignment.uid)}</TableCell>
                      <TableCell>{ROLE_LABELS[assignment.role]}</TableCell>
                      <TableCell>
                        <ScopeName scopeType={assignment.scopeType} scopeId={assignment.scopeId} standalone />
                      </TableCell>
                      <TableCell>{formatDate(assignment.createdAt.toDate())}</TableCell>
                      <TableCell>
                        {isProgrammeRole(assignment.role) && !administrator ? (
                          <AdministratorsOnly />
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={busy === assignment.id || offline}
                              onClick={() => void approve(assignment)}
                              aria-label={`Confirm ${ROLE_LABELS[assignment.role]} for ${nameOf(assignment.uid)}`}
                            >
                              Confirm
                            </Button>
                            <Button
                              size="sm"
                              disabled={offline}
                              onClick={() => setDeclining(assignment)}
                              aria-label={`Decline ${ROLE_LABELS[assignment.role]} for ${nameOf(assignment.uid)}`}
                            >
                              Decline
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )
        }
      </LiveView>
      <ReasonDialog
        open={declining !== null}
        onOpenChange={(open) => (open ? null : setDeclining(null))}
        title="Decline this role?"
        description="The role is revoked and confers nothing. The account is notified."
        label="Reason"
        confirmLabel="Decline"
        onConfirm={async (reason) => {
          if (declining === null) return;
          await callFunction(setRoleAssignmentContract, { action: "revoke", assignmentId: declining.id, reason });
          toast.show({ title: "The role has been declined." });
        }}
      />
    </Panel>
  );
}

const ASSIGNMENT_SPEC = (nameOf: (uid: string) => string): TableSpec<Assignment, AssignmentSort> => ({
  searchText: (assignment) => [nameOf(assignment.uid), ROLE_LABELS[assignment.role], assignment.scopeId],
  sorters: {
    account: (a, b) => byText(nameOf(a.uid), nameOf(b.uid)),
    role: (a, b) => byText(ROLE_LABELS[a.role], ROLE_LABELS[b.role]),
    since: (a, b) => (a.grantedAt?.toMillis() ?? 0) - (b.grantedAt?.toMillis() ?? 0),
  },
  initialSort: { key: "account", direction: "asc" },
  pageSize: 20,
});

function ActiveAssignmentTable({ list }: { list: readonly Assignment[] }) {
  const toast = useToast();
  const administrator = useProgrammeAdministrator();
  const offline = useLiveDataDisconnected();
  const me = useSignedInUser().uid;
  const nameOf = useAccountNames(list.map((assignment) => assignment.uid));
  // The names arrive after the list, and sorting and searching by name follow them.
  const table = useTableControls(list, ASSIGNMENT_SPEC(nameOf));
  const [revoking, setRevoking] = useState<Assignment | null>(null);
  if (list.length === 0) return <EmptyState title="No roles are active" />;
  return (
    <>
      <FormField label="Search roles" className="max-w-sm">
        {(control) => (
          <Input
            {...control}
            type="search"
            value={table.query}
            onChange={(event) => table.setQuery(event.target.value)}
          />
        )}
      </FormField>
      {table.total === 0 ? (
        <EmptyState title="No role matches your search" />
      ) : (
        <Table caption="Roles in effect">
          <TableHead>
            <TableRow>
              <SortHeader direction={table.directionOf("account")} onSort={() => table.sortBy("account")}>
                Account
              </SortHeader>
              <SortHeader direction={table.directionOf("role")} onSort={() => table.sortBy("role")}>
                Role
              </SortHeader>
              <TableHeaderCell>For</TableHeaderCell>
              <SortHeader direction={table.directionOf("since")} onSort={() => table.sortBy("since")}>
                Since
              </SortHeader>
              <TableHeaderCell>Ends</TableHeaderCell>
              <TableHeaderCell>Action</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {table.page.map((assignment) => (
              <TableRow key={assignment.id}>
                <TableCell>{nameOf(assignment.uid)}</TableCell>
                <TableCell>{ROLE_LABELS[assignment.role]}</TableCell>
                <TableCell>
                  <ScopeName scopeType={assignment.scopeType} scopeId={assignment.scopeId} standalone />
                </TableCell>
                <TableCell>
                  {assignment.grantedAt ? formatDate(assignment.grantedAt.toDate()) : "Not recorded"}
                </TableCell>
                <TableCell>{assignment.expiresAt ? formatDate(assignment.expiresAt.toDate()) : "No end"}</TableCell>
                <TableCell>
                  {assignment.role === "programme_admin" && assignment.uid === me ? (
                    <span className="text-fg-secondary">Another administrator decides this</span>
                  ) : isProgrammeRole(assignment.role) && !administrator ? (
                    <AdministratorsOnly />
                  ) : (
                    <Button
                      size="sm"
                      disabled={offline}
                      onClick={() => setRevoking(assignment)}
                      aria-label={`Revoke ${ROLE_LABELS[assignment.role]} from ${nameOf(assignment.uid)}`}
                    >
                      Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Pagination
        offset={table.offset}
        pageSize={table.pageSize}
        total={table.total}
        label="roles"
        onChange={table.setOffset}
      />
      <ReasonDialog
        open={revoking !== null}
        onOpenChange={(open) => (open ? null : setRevoking(null))}
        title="Revoke this role?"
        description="The account loses the rights of the role from its next request. The account is notified."
        label="Reason"
        confirmLabel="Revoke"
        onConfirm={async (reason) => {
          if (revoking === null) return;
          await callFunction(setRoleAssignmentContract, { action: "revoke", assignmentId: revoking.id, reason });
          toast.show({ title: "The role has been revoked." });
        }}
      />
    </>
  );
}

function ScopePicker({ role, value, onChange }: { role: Role; value: string; onChange: (value: string) => void }) {
  const scopeType = SCOPE_TYPES_OF_ROLE[role][0];
  const laboratories = useLiveQuery(
    scopeType === "laboratory" ? { collection: "laboratories", within: [], limit: 1_000 } : null,
  );
  const replications = useLiveQuery(
    scopeType === "replication" ? { collection: "replications", within: [], limit: 1_000 } : null,
  );
  if (scopeType === "programme") return <p className="text-fg-secondary">This role is held for the whole programme.</p>;
  const options =
    scopeType === "laboratory"
      ? laboratories.status === "ready"
        ? [...laboratories.data].sort((a, b) => byText(a.name, b.name)).map((lab) => ({ id: lab.id, label: lab.name }))
        : null
      : replications.status === "ready"
        ? [...replications.data]
            .sort((a, b) => byText(a.studyKey, b.studyKey))
            .map((replication) => ({
              id: replication.id,
              label: `${replication.studyKey}${replication.shortTitle ? `, ${replication.shortTitle}` : ""}`,
            }))
        : null;
  return (
    <FormField label={scopeType === "laboratory" ? "Laboratory" : "Replication"}>
      {(control) =>
        options === null ? (
          <Select {...control} disabled value="">
            <option value="">Loading</option>
          </Select>
        ) : (
          <Select {...control} value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">Choose one</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        )
      }
    </FormField>
  );
}

function GrantRoleForm() {
  const toast = useToast();
  const administrator = useProgrammeAdministrator();
  const roles = GRANTABLE_ROLES.filter((candidate) => administrator || !isProgrammeRole(candidate));
  const me = useSignedInUser().uid;
  const [account, setAccount] = useState<ListedUser | null>(null);
  const [role, setRole] = useState<Role>("lab_member");
  const [scopeId, setScopeId] = useState("");
  const [reason, setReason] = useState("");
  const [expires, setExpires] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scopeType = SCOPE_TYPES_OF_ROLE[role][0] ?? "programme";
  // A programme administrator role never ends by itself: expiry could leave the programme without one.
  const endless = role === "programme_admin";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const scope = scopeType === "programme" ? PROGRAMME_KEY : scopeId;
    if (account === null || scope === "" || reason.trim() === "") {
      setFailure("Choose an account and a scope, and give a reason.");
      return;
    }
    if (endless && account.uid === me) {
      setFailure("You cannot change your own programme administrator role. Ask another programme administrator.");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(setRoleAssignmentContract, {
        action: "grant",
        uid: account.uid,
        role,
        scopeType,
        scopeId: scope,
        reason: reason.trim(),
        ...(expires === "" || endless ? {} : { expiresAt: endOfDay(expires) }),
      });
      toast.show({ title: `${ROLE_LABELS[role]} granted.` });
      setAccount(null);
      setReason("");
      setExpires("");
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The role could not be granted. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={submit} className="grid max-w-form gap-4" aria-label="Grant a role">
      {failure ? <ErrorState title="No role was granted." description={failure} /> : null}
      <AccountPicker label="Account" value={account} onChange={setAccount} />
      <FormField label="Role">
        {(control) => (
          <Select
            {...control}
            value={role}
            onChange={(event) => {
              setRole(roles.find((candidate) => candidate === event.target.value) ?? "lab_member");
              setScopeId("");
            }}
          >
            {roles.map((candidate) => (
              <option key={candidate} value={candidate}>
                {ROLE_LABELS[candidate]}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <ScopePicker role={role} value={scopeId} onChange={setScopeId} />
      <FormField label="Reason" hint="Kept in the audit log.">
        {(control) => (
          <Textarea
            {...control}
            rows={2}
            maxLength={2000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </FormField>
      {endless ? (
        <p className="text-fg-secondary">
          A programme administrator role has no end date. Revoke it when it should end.
        </p>
      ) : (
        <FormField label="Ends on" hint="Optional. Leave empty for a role without an end.">
          {(control) => (
            <Input
              {...control}
              type="date"
              min={today()}
              value={expires}
              onChange={(event) => setExpires(event.target.value)}
            />
          )}
        </FormField>
      )}
      <div>
        <Button type="submit" variant="primary" disabled={busy}>
          Grant role
        </Button>
      </div>
    </form>
  );
}

function grantState(grant: Grant): "active" | "revoked" | "expired" {
  if (grant.revokedAt !== null) return "revoked";
  if (grant.expiresAt !== null && grant.expiresAt.toMillis() <= Date.now()) return "expired";
  return "active";
}

function CapabilityGrants() {
  const toast = useToast();
  const administrator = useProgrammeAdministrator();
  const me = useSignedInUser().uid;
  const offered = GRANTABLE_CAPABILITIES.filter((candidate) => administrator || !isSensitive(candidate));
  const grants = useLiveQuery({ collection: "capabilityGrants", within: [], limit: QUEUE_LIMIT });
  const nameOf = useAccountNames(grants.status === "ready" ? grants.data.map((grant) => grant.uid) : []);
  const [account, setAccount] = useState<ListedUser | null>(null);
  const [capability, setCapability] = useState<GrantableCapability>("audit.read");
  const [reason, setReason] = useState("");
  const [expires, setExpires] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<Grant | null>(null);
  const expiryRequired = capability === "demographics.read";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (account === null || reason.trim() === "" || (expiryRequired && expires === "")) {
      setFailure(
        expiryRequired
          ? "Choose an account, give a reason and an end date. Access to demographic data always ends."
          : "Choose an account and give a reason.",
      );
      return;
    }
    if (account.uid === me) {
      setFailure("You cannot grant a capability to your own account. Ask a programme administrator.");
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await callFunction(setCapabilityGrantContract, {
        action: "grant",
        uid: account.uid,
        capability,
        reason: reason.trim(),
        ...(expires === "" ? {} : { expiresAt: endOfDay(expires) }),
      });
      toast.show({ title: "The permission has been granted." });
      setAccount(null);
      setReason("");
      setExpires("");
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The permission could not be granted. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      id="grants-heading"
      title="Named permissions"
      description="A single capability for one account, for a reason and often for a limited time. Holders must use a second factor."
    >
      <LiveView
        live={grants}
        loadingLabel="Loading the permissions"
        errorTitle="The permissions could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(list) =>
          list.length === 0 ? (
            <EmptyState title="No named permissions yet" />
          ) : (
            <Table caption="Granted permissions">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Account</TableHeaderCell>
                  <TableHeaderCell>Capability</TableHeaderCell>
                  <TableHeaderCell>State</TableHeaderCell>
                  <TableHeaderCell>Ends</TableHeaderCell>
                  <TableHeaderCell>Action</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {[...list]
                  .sort((a, b) => byText(nameOf(a.uid), nameOf(b.uid)) || byText(a.capability, b.capability))
                  .map((grant) => {
                    const state = grantState(grant);
                    return (
                      <TableRow key={grant.id}>
                        <TableCell>{nameOf(grant.uid)}</TableCell>
                        <TableCell>
                          <span className="font-medium">{CAPABILITY_DEFINITIONS[grant.capability].allows}</span>
                          <span className="block text-fg-secondary">{grant.capability}</span>
                        </TableCell>
                        <TableCell>
                          <Badge tone={state === "active" ? "accent" : "neutral"}>
                            {state === "active" ? "Active" : state === "revoked" ? "Revoked" : "Ended"}
                          </Badge>
                        </TableCell>
                        <TableCell>{grant.expiresAt ? formatDateTime(grant.expiresAt.toDate()) : "No end"}</TableCell>
                        <TableCell>
                          {state !== "active" ? null : isSensitive(grant.capability) && !administrator ? (
                            <AdministratorsOnly />
                          ) : (
                            <Button
                              size="sm"
                              onClick={() => setRevoking(grant)}
                              aria-label={`Revoke ${grant.capability} from ${nameOf(grant.uid)}`}
                            >
                              Revoke
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          )
        }
      </LiveView>
      <h3 className="text-md font-medium text-fg-strong">Grant a permission</h3>
      <form noValidate onSubmit={submit} className="grid max-w-form gap-4" aria-label="Grant a permission">
        {failure ? <ErrorState title="No permission was granted." description={failure} /> : null}
        <AccountPicker label="Account to grant to" value={account} onChange={setAccount} />
        <FormField label="Capability">
          {(control) => (
            <Select
              {...control}
              value={capability}
              onChange={(event) =>
                setCapability(offered.find((candidate) => candidate === event.target.value) ?? "audit.read")
              }
            >
              {offered.map((candidate) => (
                <option key={candidate} value={candidate} title={candidate}>
                  {CAPABILITY_DEFINITIONS[candidate].allows}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label="Reason" hint="Kept in the audit log.">
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              maxLength={2000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </FormField>
        <FormField label="Ends on" hint={expiryRequired ? "Required for demographic data." : "Optional."}>
          {(control) => (
            <Input
              {...control}
              type="date"
              min={today()}
              value={expires}
              onChange={(event) => setExpires(event.target.value)}
            />
          )}
        </FormField>
        <div>
          <Button type="submit" variant="primary" disabled={busy}>
            Grant permission
          </Button>
        </div>
      </form>
      <ReasonDialog
        open={revoking !== null}
        onOpenChange={(open) => (open ? null : setRevoking(null))}
        title="Revoke this permission?"
        description="The account loses the capability from its next request. The earlier period stays on record."
        label="Reason"
        confirmLabel="Revoke"
        onConfirm={async (reason) => {
          if (revoking === null) return;
          await callFunction(setCapabilityGrantContract, {
            action: "revoke",
            uid: revoking.uid,
            capability: revoking.capability,
            reason,
          });
          toast.show({ title: "The permission has been revoked." });
        }}
      />
    </Panel>
  );
}

function ActiveRoles() {
  const active = useLiveQuery({
    collection: "roleAssignments",
    within: [],
    where: [["status", "==", "active"]],
    limit: 1_000,
  });
  return (
    <Panel id="active-roles-heading" title="Active roles" description="Revoke a role that someone no longer needs.">
      <LiveView
        live={active}
        loadingLabel="Loading the roles"
        errorTitle="The roles could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(list) => <ActiveAssignmentTable list={list} />}
      </LiveView>
    </Panel>
  );
}

/** The switches of the core team's capabilities: the default of the matrix, or an override either way. */
function CoreTeamSwitches() {
  const toast = useToast();
  const stored = useLiveDocument("roleCapabilities", ["core_team"]);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<GrantableCapability | null>(null);
  const capabilities = GRANTABLE_CAPABILITIES.filter((capability) => roleCanHold("core_team", capability));

  const change = async (capability: GrantableCapability, value: string) => {
    setBusy(capability);
    setFailure(null);
    try {
      await callFunction(setRoleCapabilityOverrideContract, {
        role: "core_team",
        capability,
        allowed: value === "on" ? true : value === "off" ? false : null,
      });
      toast.show({ title: `The core team setting for ${capability} has been changed.` });
    } catch (error) {
      setFailure(error instanceof CallableError ? error.message : "The switch could not be changed. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      id="core-team-heading"
      title="Core team capabilities"
      description="What the core team may do. The sensitive capabilities are off by default. A change applies to every member of the core team at once."
    >
      {failure ? <ErrorState title="Nothing was changed." description={failure} /> : null}
      <LiveView
        live={stored}
        loadingLabel="Loading the switches"
        errorTitle="The switches could not be loaded."
        onRetry={retryFailedLiveData}
      >
        {(record) => (
          <Table caption="Settings of the core team">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Capability</TableHeaderCell>
                <TableHeaderCell>By default</TableHeaderCell>
                <TableHeaderCell>Setting</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {capabilities.map((capability) => {
                const override = record?.overrides[capabilityField(capability)];
                const byDefault = DEFAULT_ROLE_CAPABILITIES.core_team.includes(capability);
                return (
                  <TableRow key={capability}>
                    <TableCell>
                      <span className="font-medium">{CAPABILITY_DEFINITIONS[capability].allows}</span>
                      <span className="block text-fg-secondary">{capability}</span>
                    </TableCell>
                    <TableCell>{byDefault ? "On" : "Off"}</TableCell>
                    <TableCell>
                      <Select
                        aria-label={`Setting of ${capability} for the core team`}
                        disabled={busy === capability}
                        value={override === undefined ? "default" : override ? "on" : "off"}
                        onChange={(event) => void change(capability, event.target.value)}
                      >
                        <option value="default">Default ({byDefault ? "on" : "off"})</option>
                        <option value="on">Always on</option>
                        <option value="off">Always off</option>
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </LiveView>
    </Panel>
  );
}

/** Roles, named permissions and the core team's capabilities. */
export function RolesPage() {
  return (
    <AdminPage
      entryId="admin-roles"
      description="Who holds which role, for which unit. Every change takes effect on the account's next request and is audited."
    >
      <PendingConfirmations />
      <ActiveRoles />
      <Panel
        id="grant-role-heading"
        title="Grant a role"
        description="The role is active at once. Programme roles need the account to use a second factor."
      >
        <GrantRoleForm />
      </Panel>
      <CapabilityGrants />
      <CoreTeamSwitches />
    </AdminPage>
  );
}
