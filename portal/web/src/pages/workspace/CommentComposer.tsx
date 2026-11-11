// A comment as a member types it, with mentions of members. Typing @ and the first letters of a
// name offers the members whose name begins so, in a list that follows the combobox pattern of
// WAI-ARIA: the text field keeps focus, the arrow keys move through the list, Enter or Tab
// chooses and Escape closes it. A chosen name is stored as a mention (`commentMention` of the
// shared package), which notifies the member.
import { COMMENT_MENTIONS_MAX, commentMention, commentSegments } from "@eegml/shared";
import { type FormEvent, type KeyboardEvent, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils/cn";
import type { MentionCandidate } from "./members";

export interface CommentComposerProps {
  readonly label: string;
  readonly submitLabel: string;
  readonly members: readonly MentionCandidate[];
  /** The body to start from, when a comment is edited. */
  readonly initialBody?: string;
  readonly onSubmit: (body: string, mentionUids: readonly string[]) => Promise<void>;
  readonly onCancel?: () => void;
  readonly autoFocus?: boolean;
}

/** The text of a stored body as the person sees it, with the mentions it holds. */
function editable(body: string): { readonly text: string; readonly mentions: MentionCandidate[] } {
  const mentions: MentionCandidate[] = [];
  const text = commentSegments(body)
    .map((segment) => {
      if (segment.kind === "text") return segment.text;
      mentions.push({ uid: segment.uid, name: segment.label });
      return `@${segment.label}`;
    })
    .join("");
  return { text, mentions };
}

/** The stored body of what the person typed: each chosen name that is still in the text becomes a mention. */
function stored(text: string, chosen: readonly MentionCandidate[]): { readonly body: string; readonly uids: string[] } {
  let body = text.trim();
  const uids: string[] = [];
  for (const member of [...chosen].sort((a, b) => b.name.length - a.name.length)) {
    const typed = `@${member.name}`;
    if (!body.includes(typed) || uids.length >= COMMENT_MENTIONS_MAX) continue;
    body = body.split(typed).join(commentMention(member.uid, member.name));
    if (!uids.includes(member.uid)) uids.push(member.uid);
  }
  return { body, uids };
}

export function CommentComposer({
  label,
  submitLabel,
  members,
  initialBody,
  onSubmit,
  onCancel,
  autoFocus = false,
}: CommentComposerProps) {
  const start = useMemo(() => editable(initialBody ?? ""), [initialBody]);
  const [text, setText] = useState(start.text);
  const [chosen, setChosen] = useState<readonly MentionCandidate[]>(start.mentions);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const listId = `${id}-mentions`;

  const suggestions = useMemo(() => {
    if (query === null) return [];
    const typed = query.toLowerCase();
    return members
      .filter((member) =>
        member.name
          .toLowerCase()
          .split(/\s+/)
          .some((part) => part.startsWith(typed)),
      )
      .slice(0, 6);
  }, [members, query]);
  const open = query !== null && suggestions.length > 0;

  const track = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const match = /(?:^|\s)@([^\s@]{0,40})$/.exec(before);
    setQuery(match === null ? null : (match[1] ?? ""));
    setActive(0);
  };

  const choose = (member: MentionCandidate) => {
    const element = field.current;
    const caret = element?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([^\s@]{0,40})$/, `@${member.name} `);
    const next = before + text.slice(caret);
    setText(next);
    setChosen((current) => (current.some((entry) => entry.uid === member.uid) ? current : [...current, member]));
    setQuery(null);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(before.length, before.length);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive((active + (event.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      const member = suggestions[active];
      if (member === undefined) return;
      event.preventDefault();
      choose(member);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setQuery(null);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const { body, uids } = stored(text, chosen);
    if (body === "") {
      setError("Write a comment first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(body, uids);
      setText("");
      setChosen([]);
    } catch {
      setError("The comment was not saved. Your account may not comment here, or the connection was lost.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="grid gap-2" onSubmit={submit}>
      <label htmlFor={`${id}-text`} className="text-xs font-medium text-fg-secondary">
        {label}
      </label>
      <div className="relative">
        <textarea
          ref={field}
          id={`${id}-text`}
          rows={3}
          value={text}
          // biome-ignore lint/a11y/noAutofocus: the composer opens because the person asked to write
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          aria-invalid={error === null ? undefined : true}
          aria-describedby={`${id}-hint`}
          onChange={(event) => {
            setText(event.target.value);
            track(event.target.value, event.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          className="w-full resize-y rounded-control border border-border-strong bg-background px-3 py-2 text-sm text-fg placeholder:text-fg-muted aria-invalid:border-accent-strong"
          placeholder="Write a comment. Type @ to mention a member."
        />
        <div
          id={listId}
          role="listbox"
          aria-label="Members to mention"
          className={cn(
            "absolute top-full left-0 z-20 mt-1 w-64 rounded-tile border border-border-strong bg-surface p-1",
            !open && "hidden",
          )}
        >
          {suggestions.map((member, index) => (
            <div
              key={member.uid}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              tabIndex={-1}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(member);
              }}
              onKeyDown={() => undefined}
              className={cn(
                "cursor-pointer rounded-control px-2 py-1.5 text-sm",
                index === active ? "bg-surface-accent text-fg" : "text-fg-secondary",
              )}
            >
              {member.name}
            </div>
          ))}
        </div>
      </div>
      <p id={`${id}-hint`} className="text-xs text-fg-muted">
        A member you mention is notified.
      </p>
      {error === null ? null : (
        <p role="alert" className="text-xs text-fg-accent">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? "Saving" : submitLabel}
        </Button>
        {onCancel === undefined ? null : (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
