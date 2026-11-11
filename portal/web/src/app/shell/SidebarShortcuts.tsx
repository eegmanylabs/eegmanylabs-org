import { NavLink } from "react-router";
import { useAuth } from "@/auth/AuthProvider";
import { LaboratoryName, PersonName } from "@/components/record-names";
import { type RecordOf, useLiveQuery } from "@/data";
import { recordPath } from "@/registry/paths";
import { favouritesOf, recentsOf } from "@/registry/queries";
import { cn } from "@/utils/cn";

type Shortcut = RecordOf<"userFavourites"> | RecordOf<"userRecents">;

function ShortcutList({
  title,
  entries,
  onNavigate,
}: {
  title: string;
  entries: readonly Shortcut[];
  onNavigate: (() => void) | undefined;
}) {
  const linked = entries.flatMap((entry) => {
    const path = recordPath(entry.entityType, entry.entityId);
    return path === null ? [] : [{ entry, path }];
  });
  if (linked.length === 0) return null;
  const headingId = `shortcuts-${title.toLowerCase()}`;
  return (
    <div className="grid gap-1">
      <h2 id={headingId} className="mt-5 mb-1 px-3 text-micro font-medium tracking-label text-fg-muted">
        {title}
      </h2>
      <ul aria-labelledby={headingId} className="grid gap-0.5">
        {linked.map(({ entry, path }) => (
          <li key={entry.id}>
            <NavLink
              to={path}
              end
              {...(onNavigate === undefined ? {} : { onClick: onNavigate })}
              className={cn(
                "flex h-8 items-center truncate rounded-control px-3 text-fg-secondary hover:bg-surface hover:text-fg pointer-coarse:h-11",
                "aria-[current=page]:bg-surface aria-[current=page]:text-fg",
              )}
            >
              <span className="truncate">
                {entry.entityType === "person" ? (
                  <PersonName id={entry.entityId} />
                ) : entry.entityType === "laboratory" ? (
                  <LaboratoryName id={entry.entityId} />
                ) : (
                  entry.entityId
                )}
              </span>
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The records the member has starred and those visited last, as links. Shown only while there are any. */
export function SidebarShortcuts({ onNavigate }: { onNavigate?: () => void }) {
  const { session, access } = useAuth();
  const uid =
    session.status === "signed-in" && access.status === "ready" && access.data?.member === true
      ? session.user.uid
      : null;
  const favourites = useLiveQuery(uid === null ? null : favouritesOf(uid));
  const recents = useLiveQuery(uid === null ? null : recentsOf(uid));
  if (uid === null) return null;
  return (
    <nav aria-label="Starred and recent" data-testid="sidebar-shortcuts">
      {favourites.status === "ready" ? (
        <ShortcutList title="Starred" entries={favourites.data} onNavigate={onNavigate} />
      ) : null}
      {recents.status === "ready" ? (
        <ShortcutList title="Recent" entries={recents.data} onNavigate={onNavigate} />
      ) : null}
    </nav>
  );
}
