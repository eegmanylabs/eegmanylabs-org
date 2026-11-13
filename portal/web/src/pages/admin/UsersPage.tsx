import { type ListedUser, listUsersContract, setUserStatusContract, type UserStatus } from "@eegml/shared";
import { useState } from "react";
import { formatDate, ROLE_LABELS } from "@/app/labels";
import { useSignedInUser } from "@/auth/AuthProvider";
import { LiveView } from "@/components/feedback/live-view";
import { ScopeName } from "@/components/record-names";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { callFunction, useCallResult } from "@/data";
import { AdminPage } from "./AdminPage";
import { accountLabel, useSettled } from "./accounts";
import { ReasonDialog } from "./ReasonDialog";

const PAGE_SIZE = 25;

function Roles({ user }: { user: ListedUser }) {
  if (user.roles.length === 0) return <span className="text-fg-secondary">No role</span>;
  return (
    <ul className="grid gap-1">
      {user.roles.map((role) => (
        <li key={role.assignmentId} className="flex flex-wrap items-center gap-1">
          <span>
            {ROLE_LABELS[role.role]}
            {role.scopeType === "programme" ? null : (
              <>
                {", "}
                <ScopeName scopeType={role.scopeType} scopeId={role.scopeId} />
              </>
            )}
          </span>
          {role.status === "pendingApproval" ? <Badge tone="accent">Waiting for confirmation</Badge> : null}
        </li>
      ))}
    </ul>
  );
}

function AccountStatus({ user }: { user: Pick<ListedUser, "status"> }) {
  return user.status === "active" ? <Badge tone="neutral">Active</Badge> : <Badge tone="solid">Suspended</Badge>;
}

function StatusChange({ user, onChanged }: { user: ListedUser; onChanged: () => void }) {
  const me = useSignedInUser();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  if (user.uid === me.uid) return <span className="text-fg-secondary">Your account</span>;
  const next: UserStatus = user.status === "active" ? "suspended" : "active";
  const name = accountLabel(user);
  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`${next === "suspended" ? "Suspend" : "Reinstate"} ${name}`}
      >
        {next === "suspended" ? "Suspend" : "Reinstate"}
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title={next === "suspended" ? `Suspend ${name}?` : `Reinstate ${name}?`}
        description={
          next === "suspended"
            ? "The account loses access at once, on every device, including pages that are open now. Its roles stay recorded and come back when it is reinstated."
            : "The account can sign in and use the portal again, with the roles it held."
        }
        label="Reason"
        hint="Kept in the audit log."
        confirmLabel={next === "suspended" ? "Suspend" : "Reinstate"}
        onConfirm={async (reason) => {
          await callFunction(setUserStatusContract, { uid: user.uid, status: next, reason });
          toast.show({ title: next === "suspended" ? `${name} has been suspended.` : `${name} has been reinstated.` });
          onChanged();
        }}
      />
    </>
  );
}

/** Every account of the portal, searchable, with its status and roles, and suspension. */
export function UsersPage() {
  return (
    <AdminPage
      entryId="admin-users"
      description="Every account that has signed in to the portal, sorted by name. Suspending an account stops it at once on every device."
    >
      <UserList />
    </AdminPage>
  );
}

function UserList() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<UserStatus | "all">("all");
  const [offset, setOffset] = useState(0);
  const settled = useSettled(search.trim());
  const input = {
    search: settled,
    offset,
    limit: PAGE_SIZE,
    ...(status === "all" ? {} : { status }),
  };
  const { live, reload } = useCallResult(listUsersContract, input, JSON.stringify(input));
  const addresses = live.status === "ready" && live.data.addressesShown;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <FormField
          label="Search accounts"
          hint={addresses ? "By name or address." : "By name. Your role does not show addresses."}
          className="w-full max-w-sm"
        >
          {(control) => (
            <Input
              {...control}
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setOffset(0);
              }}
            />
          )}
        </FormField>
        <FormField label="Status" className="w-44">
          {(control) => (
            <Select
              {...control}
              value={status}
              onChange={(event) => {
                const value = event.target.value;
                setStatus(value === "active" || value === "suspended" ? value : "all");
                setOffset(0);
              }}
            >
              <option value="all">All accounts</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </Select>
          )}
        </FormField>
      </div>
      <LiveView
        live={live}
        loadingLabel="Loading the accounts"
        errorTitle="The accounts could not be loaded."
        onRetry={reload}
      >
        {(result) =>
          result.users.length === 0 ? (
            <EmptyState
              title={settled === "" && status === "all" ? "No accounts yet" : "No account matches"}
              {...(settled === "" ? {} : { description: "Check the spelling, or search for part of the name." })}
            />
          ) : (
            <>
              {/* At phone width each account is a card. The table needs room for its columns. */}
              <ul className="grid gap-3 sm:hidden" aria-label="Accounts">
                {result.users.map((user) => (
                  <li key={user.uid} className="grid gap-2 rounded-tile border border-border bg-surface p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{accountLabel(user)}</span>
                      <AccountStatus user={user} />
                    </div>
                    {result.addressesShown ? (
                      <span className="text-fg-secondary [overflow-wrap:anywhere]">{user.emailLower}</span>
                    ) : null}
                    {user.personId === null ? <span className="text-fg-secondary">Not linked</span> : null}
                    <Roles user={user} />
                    <span className="text-fg-secondary">
                      Last seen <time dateTime={user.lastSeenAt}>{formatDate(user.lastSeenAt)}</time>
                    </span>
                    <div>
                      <StatusChange user={user} onChanged={reload} />
                    </div>
                  </li>
                ))}
              </ul>
              <div className="hidden min-w-0 sm:block">
                <Table caption="Accounts">
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell aria-sort="ascending">Name</TableHeaderCell>
                      {result.addressesShown ? <TableHeaderCell>Address</TableHeaderCell> : null}
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell>Roles</TableHeaderCell>
                      <TableHeaderCell>Last seen</TableHeaderCell>
                      <TableHeaderCell>Action</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {result.users.map((user) => (
                      <TableRow key={user.uid} className="align-top">
                        <TableCell>
                          <span className="font-medium">{accountLabel(user)}</span>
                          {user.personId === null ? <span className="block text-fg-secondary">Not linked</span> : null}
                        </TableCell>
                        {result.addressesShown ? (
                          <TableCell className="min-w-48 [overflow-wrap:anywhere]">{user.emailLower}</TableCell>
                        ) : null}
                        <TableCell>
                          <AccountStatus user={user} />
                        </TableCell>
                        <TableCell>
                          <Roles user={user} />
                        </TableCell>
                        <TableCell>
                          <time dateTime={user.lastSeenAt}>{formatDate(user.lastSeenAt)}</time>
                        </TableCell>
                        <TableCell>
                          <StatusChange user={user} onChanged={reload} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Pagination
                offset={offset}
                pageSize={PAGE_SIZE}
                total={result.total}
                label="accounts"
                onChange={setOffset}
              />
            </>
          )
        }
      </LiveView>
    </div>
  );
}
