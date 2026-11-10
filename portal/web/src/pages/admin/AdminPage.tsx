import type { ReactNode } from "react";
import { navigationEntry } from "@/app/navigation";
import { RequireCapability } from "@/auth/RequireCapability";
import { PageHeader } from "@/components/page-header";

/**
 * The frame of a page of the administration console. The page opens only for an account whose
 * access document holds the capability of its entry in the navigation registry, whatever
 * address was typed. The rules and the functions behind it refuse everyone else anyway.
 */
export function AdminPage({
  entryId,
  description,
  children,
}: {
  entryId: string;
  description: string;
  children: ReactNode;
}) {
  const entry = navigationEntry(entryId);
  return (
    <RequireCapability capability={entry.requires} title={entry.label}>
      <PageHeader title={entry.label} description={description} />
      <div className="grid gap-6">{children}</div>
    </RequireCapability>
  );
}
