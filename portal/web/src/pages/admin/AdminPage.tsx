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
  title,
  description,
  children,
}: {
  entryId: string;
  /** The title of a page below the entry, such as the conflicts of the integrations. The entry's label otherwise. */
  title?: string;
  description: string;
  children: ReactNode;
}) {
  const entry = navigationEntry(entryId);
  return (
    <RequireCapability capability={entry.requires} title={title ?? entry.label}>
      <PageHeader title={title ?? entry.label} description={description} />
      <div className="grid gap-6 *:min-w-0">{children}</div>
    </RequireCapability>
  );
}
