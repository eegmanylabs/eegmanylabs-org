// Global search and commands, opened with Control or Command and K or from the search control of
// the top bar. It follows the combobox pattern of WAI-ARIA: the text field keeps focus, the
// arrow keys move the active option of the list below it, Enter chooses it and Escape closes.
import type { EntityType } from "@eegml/shared";
import { Search } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import { type KeyboardEvent, useEffect, useId, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { visibleNavigation } from "@/app/navigation";
import { useAuth } from "@/auth/AuthProvider";
import { useNavigableCapabilities } from "@/auth/use-privilege";
import { Button } from "@/components/ui/button";
import { recordRecentVisit, useLiveQuery } from "@/data";
import { orEmpty } from "@/registry/combine";
import { countOf } from "@/registry/labels";
import { laboratoryPath, memberPath, recordPath, replicationPath } from "@/registry/paths";
import {
  ALL_ALIASES,
  ALL_LABORATORIES,
  ALL_PERSONS,
  ALL_REPLICATIONS,
  recentsOf,
  useDirectoryItems,
} from "@/registry/queries";
import { cn } from "@/utils/cn";
import { useRegisteredActions } from "./palette-actions";
import { PALETTE_KIND_LABELS, type PaletteItem, searchPalette } from "./palette-search";

interface Choice extends PaletteItem {
  /** Where the choice leads, for a record or a destination. */
  readonly path?: string;
  /** The record behind the choice, remembered among the account's recent items. */
  readonly record?: { readonly entityType: EntityType; readonly entityId: string };
  readonly run?: () => void;
}

/** Whether a key press is the shortcut that opens the palette. */
export function isPaletteShortcut(event: Pick<globalThis.KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">) {
  return event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey) && !event.altKey;
}

function usePaletteChoices(open: boolean): readonly Choice[] {
  const { session, access } = useAuth();
  const capabilities = useNavigableCapabilities();
  const actions = useRegisteredActions();
  const linked = access.status !== "ready" || access.data?.personId != null;
  const member = access.status === "ready" && access.data?.member === true;
  const uid = session.status === "signed-in" ? session.user.uid : null;
  // The directory is loaded only while the palette is open, and only for a member, who may read it.
  const load = open && member;
  const replications = orEmpty(useDirectoryItems(load ? ALL_REPLICATIONS : null));
  const aliases = orEmpty(useLiveQuery(load ? ALL_ALIASES : null));
  const persons = orEmpty(useDirectoryItems(load ? ALL_PERSONS : null));
  const laboratories = orEmpty(useDirectoryItems(load ? ALL_LABORATORIES : null));
  const recents = orEmpty(useLiveQuery(load && uid !== null ? recentsOf(uid) : null));

  return useMemo(() => {
    const list = <T,>(live: { status: string; data?: readonly T[] }): readonly T[] =>
      live.status === "ready" && live.data !== undefined ? live.data : [];
    const aliasesOf = new Map<string, string[]>();
    for (const alias of list(aliases))
      aliasesOf.set(alias.replicationId, [...(aliasesOf.get(alias.replicationId) ?? []), alias.alias]);
    const personNames = new Map(list(persons).map((person) => [person.id, person.displayName]));
    const laboratoryNames = new Map(list(laboratories).map((laboratory) => [laboratory.id, laboratory.name]));
    const choices: Choice[] = [
      ...actions.map((action) => ({
        id: `action:${action.id}`,
        kind: "action" as const,
        label: action.label,
        keywords: [],
        run: action.run,
      })),
      ...visibleNavigation(capabilities, undefined, linked).map((entry) => ({
        id: `destination:${entry.id}`,
        kind: "destination" as const,
        label: entry.label,
        keywords: [],
        path: entry.to,
      })),
      ...list(replications)
        .filter((replication) => replication.archivedAt === null)
        .map((replication) => ({
          id: `replication:${replication.studyKey}`,
          kind: "replication" as const,
          label: replication.studyKey,
          ...(replication.shortTitle === undefined ? {} : { detail: replication.shortTitle }),
          keywords: [
            ...(aliasesOf.get(replication.studyKey) ?? []),
            ...[replication.originalTitle, replication.originalAuthors].filter(
              (text): text is string => text !== undefined,
            ),
          ],
          path: replicationPath(replication.studyKey),
          record: { entityType: "replication" as const, entityId: replication.studyKey },
        })),
      ...list(persons)
        .filter((person) => person.archivedAt === null)
        .map((person) => ({
          id: `person:${person.id}`,
          kind: "member" as const,
          label: person.displayName,
          ...(person.affiliationSummary === undefined ? {} : { detail: person.affiliationSummary }),
          keywords: [],
          path: memberPath(person.id),
          record: { entityType: "person" as const, entityId: person.id },
        })),
      ...list(laboratories)
        .filter((laboratory) => laboratory.archivedAt === null)
        .map((laboratory) => ({
          id: `laboratory:${laboratory.id}`,
          kind: "laboratory" as const,
          label: laboratory.name,
          ...(laboratory.city === undefined ? {} : { detail: laboratory.city }),
          keywords: [laboratory.department, laboratory.city].filter((text): text is string => text !== undefined),
          path: laboratoryPath(laboratory.id),
          record: { entityType: "laboratory" as const, entityId: laboratory.id },
        })),
      ...list(recents).flatMap((recent) => {
        const path = recordPath(recent.entityType, recent.entityId);
        if (path === null) return [];
        const label =
          recent.entityType === "person"
            ? (personNames.get(recent.entityId) ?? recent.entityId)
            : recent.entityType === "laboratory"
              ? (laboratoryNames.get(recent.entityId) ?? recent.entityId)
              : recent.entityId;
        return [
          {
            id: `recent:${recent.id}`,
            kind: "recent" as const,
            label,
            keywords: [],
            path,
            record: { entityType: recent.entityType, entityId: recent.entityId },
          },
        ];
      }),
    ];
    return choices;
  }, [actions, capabilities, linked, replications, aliases, persons, laboratories, recents]);
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const { session } = useAuth();
  const uid = session.status === "signed-in" ? session.user.uid : null;
  const listboxId = useId();
  const choices = usePaletteChoices(open);
  const groups = useMemo(() => searchPalette(choices, query), [choices, query]);
  const flat = groups.flatMap((group) => group.items);
  const activeIndex = Math.min(active, Math.max(0, flat.length - 1));
  const optionId = (index: number) => `${listboxId}-option-${index}`;

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
  });

  const choose = (choice: Choice) => {
    setOpen(false);
    if (choice.record !== undefined && uid !== null) {
      recordRecentVisit(uid, choice.record.entityType, choice.record.entityId).catch(() => undefined);
    }
    if (choice.run !== undefined) choice.run();
    else if (choice.path !== undefined) navigate(choice.path);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (flat.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + flat.length) % flat.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const choice = flat[activeIndex];
      if (choice !== undefined) choose(choice);
    }
  };

  let index = -1;
  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Trigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-keyshortcuts="Control+K Meta+K"
          className="gap-2 text-fg-secondary"
          data-testid="open-search"
        >
          <Search aria-hidden="true" strokeWidth={1.8} />
          <span className="sr-only sm:not-sr-only">Search</span>
          <kbd className="hidden rounded-control border border-border px-1.5 text-micro text-fg-muted sm:inline">
            Ctrl K
          </kbd>
        </Button>
      </RadixDialog.Trigger>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="fixed top-[10vh] left-1/2 z-50 grid max-h-[75vh] w-[calc(100%-2rem)] max-w-reading -translate-x-1/2 grid-rows-[auto_1fr] overflow-hidden rounded-card border border-border bg-surface"
        >
          <RadixDialog.Title className="sr-only">Search the portal</RadixDialog.Title>
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search aria-hidden="true" className="size-4 shrink-0 text-fg-secondary" strokeWidth={1.8} />
            <input
              role="combobox"
              aria-expanded={flat.length > 0}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={flat.length > 0 ? optionId(activeIndex) : undefined}
              aria-label="Search replications, members and pages"
              placeholder="Search replications, members and pages"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              className="h-12 w-full bg-transparent text-md text-fg placeholder:text-fg-muted focus-visible:outline-none"
            />
          </div>
          <div className="overflow-y-auto p-2">
            <div id={listboxId} role="listbox" aria-label="Results">
              {groups.map((group) => (
                // biome-ignore lint/a11y/useSemanticElements: the combobox pattern of WAI-ARIA groups the options of a listbox with the group role
                <div key={group.kind} role="group" aria-labelledby={`${listboxId}-${group.kind}`} className="mb-2">
                  <div
                    id={`${listboxId}-${group.kind}`}
                    role="presentation"
                    className="px-2 py-1 text-micro font-medium tracking-label text-fg-muted"
                  >
                    {PALETTE_KIND_LABELS[group.kind]}
                  </div>
                  {group.items.map((choice) => {
                    index += 1;
                    const position = index;
                    const selected = position === activeIndex;
                    return (
                      <div
                        key={choice.id}
                        id={optionId(position)}
                        role="option"
                        aria-selected={selected}
                        tabIndex={-1}
                        onMouseMove={() => setActive(position)}
                        onClick={() => choose(choice)}
                        onKeyDown={() => undefined}
                        className={cn(
                          "grid cursor-pointer gap-0.5 rounded-control px-2 py-1.5",
                          selected ? "bg-surface-accent text-fg" : "text-fg-secondary",
                        )}
                      >
                        <span className="truncate font-medium text-fg">{choice.label}</span>
                        {choice.detail === undefined ? null : (
                          <span className="truncate text-xs text-fg-secondary">{choice.detail}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {flat.length === 0 ? (
              <p role="status" className="px-2 py-3 text-fg-secondary">
                {query.trim() === ""
                  ? "Type to search replications, members and pages."
                  : "Nothing matches. Try another spelling or fewer words."}
              </p>
            ) : (
              <p role="status" className="sr-only">
                {countOf(flat.length, "result")}
              </p>
            )}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
