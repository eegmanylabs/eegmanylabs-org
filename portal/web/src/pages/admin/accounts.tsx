// Accounts as the console names them. No rule lets anyone read another account's profile, so
// names come from listUsers, which a holder of users.suspend or roles.manage may call.
import { type ListedUser, listUsersContract } from "@eegml/shared";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useCallResult } from "@/data";
import { cn } from "@/utils/cn";

/** How the console marks a name that an account gave itself, which nobody has verified. */
export function selfAssertedName(displayName: string): string {
  return `${displayName} (unverified name)`;
}

/**
 * How an account is named: the linked person's name, else the name it gives itself marked as
 * unverified, else its address, else its identifier.
 */
export function accountLabel(user: Pick<ListedUser, "personName" | "displayName" | "emailLower" | "uid">): string {
  if (user.personName !== null) return user.personName;
  if (user.displayName !== null) return selfAssertedName(user.displayName);
  return user.emailLower ?? user.uid;
}

/** The names of up to 100 accounts. While they load, or for an account that is not found, the identifier stands in. */
export function useAccountNames(uids: readonly string[]): (uid: string) => string {
  const wanted = [...new Set(uids)].sort().slice(0, 100);
  const { live } = useCallResult(
    listUsersContract,
    wanted.length === 0 ? null : { uids: wanted, limit: 100 },
    wanted.join(","),
  );
  const names = new Map(live.status === "ready" ? live.data.users.map((user) => [user.uid, accountLabel(user)]) : []);
  return (uid) => names.get(uid) ?? uid;
}

/** Waits until the value has stopped changing for a moment, so that typing does not call the server on every key. */
export function useSettled<T>(value: T, delayMs = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

export interface AccountPickerProps {
  label: string;
  value: ListedUser | null;
  onChange: (user: ListedUser | null) => void;
}

/** Finds an account by name, or by address for whoever may see addresses, and picks it. */
export function AccountPicker({ label, value, onChange }: AccountPickerProps) {
  const [search, setSearch] = useState("");
  const settled = useSettled(search.trim());
  const { live } = useCallResult(
    listUsersContract,
    settled === "" ? null : { search: settled, limit: 8 },
    `pick:${settled}`,
  );
  const id = `picker-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;

  if (value !== null) {
    return (
      <div className="grid gap-1.5">
        <span className="text-sm font-medium text-fg-strong">{label}</span>
        <div className="flex flex-wrap items-center gap-2 rounded-control border border-border-strong bg-background px-3 py-2">
          <span className="font-medium">{accountLabel(value)}</span>
          {value.emailLower && value.emailLower !== accountLabel(value) ? (
            <span className="break-all text-fg-secondary">{value.emailLower}</span>
          ) : null}
          <button
            type="button"
            onClick={() => onChange(null)}
            className="ml-auto cursor-pointer rounded-control px-1 text-fg-accent underline underline-offset-2"
          >
            Choose another account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="search"
        placeholder="Search by name"
        value={search}
        aria-describedby={`${id}-results`}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div id={`${id}-results`} aria-live="polite" className="text-fg-secondary">
        {settled === "" ? (
          "Type part of a name to find an account."
        ) : live.status === "ready" ? (
          live.data.users.length === 0 ? (
            "No account matches."
          ) : (
            <ul className="grid gap-1" aria-label="Matching accounts">
              {live.data.users.map((user) => (
                <li key={user.uid}>
                  <button
                    type="button"
                    onClick={() => onChange(user)}
                    className={cn(
                      "flex w-full cursor-pointer flex-wrap items-center gap-2 rounded-control border border-border bg-background px-3 py-2 text-left hover:border-border-emphasis pointer-coarse:min-h-11",
                    )}
                  >
                    <span className="font-medium text-fg">{accountLabel(user)}</span>
                    {user.emailLower ? <span className="break-all">{user.emailLower}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : live.status === "error" ? (
          live.error.message
        ) : (
          <Spinner label="Searching" />
        )}
      </div>
    </div>
  );
}
