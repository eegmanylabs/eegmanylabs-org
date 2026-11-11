// What a notification says, and where it leads, from its type and its payload. A notification
// leads only to a page that exists. Pure, so that it is tested by itself.
import type { Role } from "@eegml/shared";
import { ROLE_LABELS } from "@/app/labels";
import { pagePath, participationRecruitmentPath } from "@/registry/paths";

export interface NotificationText {
  readonly title: string;
  readonly detail: string | null;
  /** The route of the page the notification is about, or null where no such page exists. */
  readonly to: string | null;
}

type Payload = Readonly<Record<string, unknown>>;

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const roleLabel = (value: unknown): string =>
  typeof value === "string" && value in ROLE_LABELS ? ROLE_LABELS[value as Role] : "a role";

/** The address of the task a notification is about, which the notification names beside its payload. */
function taskPath(payload: Payload): string | null {
  const taskId = text(payload.entityId);
  return taskId === null ? "/tasks" : `/tasks?task=${encodeURIComponent(taskId)}`;
}

/** The page of the record whose feed of progress updates a notification is about. */
function recordPath(payload: Payload): string | null {
  const entityId = text(payload.entityId);
  if (entityId === null) return null;
  switch (payload.entityType) {
    case "replication":
      return `/replications/${encodeURIComponent(entityId)}?tab=updates`;
    case "laboratory":
      return `/labs/${encodeURIComponent(entityId)}?tab=updates`;
    case "person":
      return `/members/${encodeURIComponent(entityId)}?tab=updates`;
    default:
      return null;
  }
}

export function describeNotification(payload: Payload): NotificationText {
  switch (payload.kind) {
    case "accountClaimAwaitsReview":
      return { title: "An account claim waits for review", detail: null, to: "/admin/claims" };
    case "accessRequestAwaitsReview":
      return { title: "A request for access waits for review", detail: null, to: "/admin/claims" };
    case "rolesAwaitApproval": {
      const count = typeof payload.count === "number" ? payload.count : 0;
      return {
        title: count === 1 ? "A role waits for confirmation" : `${count} roles wait for confirmation`,
        detail: "A member has claimed a profile that the records give a management role.",
        to: "/admin/roles",
      };
    }
    case "labClaimAwaitsReview":
      return { title: "A request to represent a laboratory waits for review", detail: null, to: "/admin/lab-claims" };
    case "laboratoryRegistrationAwaitsReview":
      return { title: "A new laboratory waits for review", detail: null, to: "/admin/lab-claims" };
    case "accountClaimApproved":
      return { title: "Your account is linked to your profile", detail: null, to: "/" };
    case "accountClaimRejected":
      return {
        title: "Your account was not linked to a profile",
        detail: "You can ask for access again.",
        to: "/claim",
      };
    case "accountUnlinked":
      return {
        title: "Your account is no longer linked to a profile",
        detail: "An administrator removed the link.",
        to: "/claim",
      };
    case "labClaimApproved":
      return { title: "Your request to represent a laboratory was approved", detail: null, to: "/account" };
    case "labClaimRejected":
      return { title: "Your request to represent a laboratory was not approved", detail: null, to: null };
    case "roleGranted":
      return { title: `You now hold the role ${roleLabel(payload.role)}`, detail: null, to: "/account" };
    case "roleRevoked":
      return { title: `You no longer hold the role ${roleLabel(payload.role)}`, detail: null, to: "/account" };
    case "capabilityGranted":
      return {
        title: "You have been given an additional permission",
        detail: text(payload.capability),
        to: "/account",
      };
    case "capabilityRevoked":
      return { title: "A permission of yours has ended", detail: text(payload.capability), to: "/account" };
    case "correctionResolved":
      return {
        title:
          payload.outcome !== "accepted"
            ? "Your report of a wrong detail was not accepted"
            : payload.applied === true
              ? "Your report of a wrong detail was accepted and your record corrected"
              : "Your report of a wrong detail was accepted. The record will be corrected where the detail comes from",
        detail: text(payload.message),
        to: "/",
      };
    case "personMerged":
      return {
        title: "Another record of you was merged into your profile",
        detail: "Its laboratory and replication entries wait for confirmation before they give you any role.",
        to: "/",
      };
    case "laboratoryMembershipConfirmed":
      return { title: "Your entry in a laboratory was confirmed", detail: null, to: "/" };
    case "replicationMembershipConfirmed":
      return { title: "Your membership of a replication was reviewed", detail: null, to: "/" };
    case "pageMention":
      return {
        title: `${text(payload.authorName) ?? "A member"} mentioned you on a page`,
        detail: text(payload.title),
        to: text(payload.pageId) === null ? null : pagePath(String(payload.pageId)),
      };
    case "commentMention":
    case "commentReply": {
      const pageId = text(payload.pageId);
      const threadId = text(payload.threadId);
      return {
        title:
          payload.kind === "commentMention"
            ? `${text(payload.authorName) ?? "A member"} mentioned you in a comment`
            : `${text(payload.authorName) ?? "A member"} replied in a discussion you took part in`,
        detail: text(payload.title),
        to: pageId === null ? null : pagePath(pageId, threadId ?? undefined),
      };
    }
    case "taskAssigned":
      return { title: "A task was assigned to you", detail: text(payload.title), to: taskPath(payload) };
    case "taskStatusChanged":
      return {
        title: `A task you follow is now ${(text(payload.statusLabel) ?? "changed").toLowerCase()}`,
        detail: text(payload.title),
        to: taskPath(payload),
      };
    case "reminderDue":
      return { title: "A reminder you set is due", detail: text(payload.title), to: taskPath(payload) };
    case "progressUpdatePosted":
      return {
        title: payload.pinned === true ? "A pinned progress update was posted" : "A progress update was posted",
        detail: text(payload.title),
        to: recordPath(payload),
      };
    case "recruitmentInactive": {
      const days = typeof payload.silentDays === "number" ? payload.silentDays : null;
      const participationId = text(payload.participationId);
      return {
        title:
          days === null
            ? "A laboratory has not reported its recruitment for a while"
            : `A laboratory has not reported its recruitment for ${days} days`,
        detail: text(payload.title),
        to: participationId === null ? null : participationRecruitmentPath(participationId),
      };
    }
    default:
      return { title: "Something changed that concerns you", detail: null, to: null };
  }
}
