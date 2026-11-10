import { useAuth } from "@/auth/AuthProvider";
import { PendingRoleList } from "./ProfileSummary";

/** The roles of the account that wait for an administrator's confirmation. Shown only while there are any. */
export function PendingRolesPanel() {
  const { access } = useAuth();
  const roles = access.status === "ready" ? (access.data?.pendingRoles ?? []) : [];
  if (roles.length === 0) return null;
  return (
    <section
      aria-labelledby="pending-roles-heading"
      className="grid gap-3 rounded-card border border-border bg-surface px-5 py-4"
    >
      <h2 id="pending-roles-heading" className="text-lg font-medium tracking-title text-fg-strong">
        Roles waiting for confirmation
      </h2>
      <p className="text-fg-secondary">
        An administrator confirms each of these roles before it gives you any rights. You will get a notification when
        they do.
      </p>
      <PendingRoleList roles={roles} />
    </section>
  );
}
