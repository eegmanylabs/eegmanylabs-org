// Email notifications and digests (requirements R15.7, R16.6 and R16.7, docs/INTEGRATIONS.md,
// section 8). A notification is always written to the member's notifications in the portal
// first. These functions decide from the member's preferences whether, and when, it also goes to
// the mail outbox, and build the text of a digest. The outbox is the boundary: what happens after
// it belongs to the mail adapter.
//
// A message carries a title, a short text and a link back to the portal. It never carries a
// special-category value or restricted detail, which stays behind sign-in: the text of each
// notification is made from its type and the title of the record alone.
import type { NotificationType, UserPreferencesDoc } from "../schemas/identity";

export type QuietHours = NonNullable<UserPreferencesDoc["quietHours"]>;

/** The minutes since midnight of an instant on the clock of a time zone, or null for a zone that is not known. */
export function localMinutes(at: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
  } catch {
    return null;
  }
}

const minutesOf = (clock: string): number => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

/**
 * Whether an instant falls in a member's quiet hours. A span that passes midnight, such as 22:00
 * to 07:00, holds both ends of the night. A span whose start equals its end is empty. A time zone
 * that is not known holds no quiet hours, so nothing is held back for ever.
 */
export function inQuietHours(at: Date, quietHours: QuietHours | null): boolean {
  if (quietHours === null) return false;
  const now = localMinutes(at, quietHours.timeZone);
  if (now === null) return false;
  const start = minutesOf(quietHours.start);
  const end = minutesOf(quietHours.end);
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/** The first minute after an instant that is outside the quiet hours, to the minute. */
export function endOfQuietHours(at: Date, quietHours: QuietHours | null): Date {
  if (!inQuietHours(at, quietHours)) return at;
  let probe = new Date(Math.ceil(at.getTime() / 60_000) * 60_000);
  for (let step = 0; step < 24 * 60 && inQuietHours(probe, quietHours); step += 1) {
    probe = new Date(probe.getTime() + 60_000);
  }
  return probe;
}

/**
 * What happens to a notification by email.
 *
 * | Outcome     | When                                                                            |
 * |-------------|---------------------------------------------------------------------------------|
 * | `none`      | Email is off, or the member switched this type of notification off               |
 * | `digest`    | The member asked for a daily or weekly digest, which gathers it                  |
 * | `immediate` | A message of its own, at once or at the end of the member's quiet hours          |
 */
export type EmailDecision =
  | { readonly outcome: "none" }
  | { readonly outcome: "digest" }
  | { readonly outcome: "immediate"; readonly notBefore: Date };

export function emailDecision(
  preferences: Pick<UserPreferencesDoc, "channels" | "digestFrequency" | "quietHours" | "typeSwitches"> | null,
  type: NotificationType,
  at: Date,
): EmailDecision {
  // A member who has saved no preferences receives notifications in the portal alone.
  if (preferences === null || !preferences.channels.email) return { outcome: "none" };
  if (preferences.typeSwitches[type] === false) return { outcome: "none" };
  if (preferences.digestFrequency !== "off") return { outcome: "digest" };
  return { outcome: "immediate", notBefore: endOfQuietHours(at, preferences.quietHours) };
}

/** The calendar day of an instant in a time zone, as an ISO 8601 date, in UTC where the zone is not known. */
export function localDay(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** The ISO 8601 week of a calendar date, such as `2026-W46`. */
export function isoWeek(day: string): string {
  const thursday = new Date(`${day}T00:00:00Z`);
  thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7));
  const year = thursday.getUTCFullYear();
  const week = Math.ceil(((thursday.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The hour of the member's morning from which a digest is due. */
export const DIGEST_HOUR = 7;

/**
 * The period whose digest is due at an instant, or null where none is due: a daily digest each
 * morning from seven, a weekly digest on Monday morning from seven, on the member's clock and
 * outside their quiet hours. The period names the outbox message, so a period sends once.
 */
export function dueDigestPeriod(
  at: Date,
  preferences: Pick<UserPreferencesDoc, "channels" | "digestFrequency" | "quietHours">,
): string | null {
  if (!preferences.channels.email || preferences.digestFrequency === "off") return null;
  const timeZone = preferences.quietHours?.timeZone ?? "Europe/London";
  const minutes = localMinutes(at, timeZone) ?? at.getUTCHours() * 60 + at.getUTCMinutes();
  if (minutes < DIGEST_HOUR * 60 || inQuietHours(at, preferences.quietHours)) return null;
  const day = localDay(at, timeZone);
  if (preferences.digestFrequency === "daily") return day;
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday === 1 ? isoWeek(day) : null;
}

/** How each type of notification reads in a digest or a message. */
export const NOTIFICATION_EMAIL_TEXT: Readonly<Record<NotificationType, string>> = {
  mention: "You were mentioned",
  assignment: "Work was assigned to you",
  comment: "A new comment",
  statusChange: "A status changed",
  dueSoon: "Due soon",
  overdue: "Overdue",
  reminder: "A reminder you set",
  claimDecision: "A decision on your account",
  roleDecision: "A decision on a role",
  protocolUpdate: "A protocol was updated",
  milestone: "A milestone",
  integrationFailure: "An integration needs attention",
  progressUpdate: "A progress update",
  recruitmentInactive: "Recruitment updates are overdue",
};

export interface DigestItem {
  readonly type: NotificationType;
  /** The title of the record, where the notification names one. */
  readonly title: string | null;
  /** The address of the record in the portal. */
  readonly link: string;
}

export interface MailContent {
  readonly subject: string;
  readonly textBody: string;
  readonly htmlBody: string;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/** The most items a digest lists. The rest are counted, and wait in the portal. */
export const DIGEST_ITEMS_MAX = 50;

/** A digest of the notifications of a period. */
export function buildDigest(input: {
  readonly period: string;
  readonly frequency: "daily" | "weekly";
  readonly items: readonly DigestItem[];
  readonly portalUrl: string;
}): MailContent {
  const shown = input.items.slice(0, DIGEST_ITEMS_MAX);
  const more = input.items.length - shown.length;
  const heading =
    input.frequency === "daily" ? `Your daily digest for ${input.period}` : `Your weekly digest for ${input.period}`;
  const lineOf = (item: DigestItem) =>
    `${NOTIFICATION_EMAIL_TEXT[item.type]}${item.title === null ? "" : `: ${item.title}`}`;
  const text = [
    heading,
    "",
    `${input.items.length} ${input.items.length === 1 ? "notification" : "notifications"} in the #EEGManyLabs portal.`,
    "",
    ...shown.map((item) => `- ${lineOf(item)}\n  ${item.link}`),
    ...(more > 0 ? ["", `${more} more in the portal.`] : []),
    "",
    `Open the portal: ${input.portalUrl}`,
    "You can change how often you receive this digest on your account page.",
  ].join("\n");
  const html = [
    `<h1>${escapeHtml(heading)}</h1>`,
    "<ul>",
    ...shown.map((item) => `<li><a href="${escapeHtml(item.link)}">${escapeHtml(lineOf(item))}</a></li>`),
    "</ul>",
    more > 0 ? `<p>${more} more in the portal.</p>` : "",
    `<p><a href="${escapeHtml(input.portalUrl)}">Open the portal</a>. You can change how often you receive this digest on your account page.</p>`,
  ].join("");
  return {
    subject: `#EEGManyLabs: ${heading.charAt(0).toLowerCase()}${heading.slice(1)}`,
    textBody: text,
    htmlBody: html,
  };
}

/** A message of its own for one notification. */
export function buildNotificationMail(item: DigestItem, portalUrl: string): MailContent {
  const line = `${NOTIFICATION_EMAIL_TEXT[item.type]}${item.title === null ? "" : `: ${item.title}`}`;
  return {
    subject: `#EEGManyLabs: ${line}`,
    textBody: `${line}\n\nOpen it in the portal: ${item.link}\n\nYou can change which notifications reach you by email on your account page (${portalUrl}).`,
    htmlBody: `<p>${escapeHtml(line)}</p><p><a href="${escapeHtml(item.link)}">Open it in the portal</a>.</p><p>You can change which notifications reach you by email on your account page.</p>`,
  };
}
