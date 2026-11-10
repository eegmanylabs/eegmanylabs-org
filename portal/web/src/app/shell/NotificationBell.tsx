import { Bell } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { formatDateTime } from "@/app/labels";
import { useAuth, useSignedInUser } from "@/auth/AuthProvider";
import { LiveView } from "@/components/feedback/live-view";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/components/ui/toast";
import { markNotificationRead, type RecordOf, retryFailedLiveData, useLiveQuery } from "@/data";
import { cn } from "@/utils/cn";
import { describeNotification } from "./notification-text";

/** The most notifications the panel lists, and the most unread ones the bell counts exactly. */
const LISTED = 30;
const COUNTED = 99;

function NotificationItem({
  notification,
  canMark,
  onOpen,
}: {
  notification: RecordOf<"userNotifications">;
  canMark: boolean;
  onOpen: () => void;
}) {
  const user = useSignedInUser();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { title, detail, to } = describeNotification(notification.payload);
  const unread = notification.readAt === null;
  const created = notification.createdAt.toDate();

  const markRead = async () => {
    setBusy(true);
    try {
      await markNotificationRead(user.uid, notification.id);
    } catch {
      toast.show({ tone: "error", title: "The notification was not marked as read.", description: "Try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={cn("grid gap-1 rounded-control px-2.5 py-2", unread && "bg-surface-muted")}>
      <span className="flex items-start justify-between gap-2">
        <span className="grid gap-0.5">
          <span className={cn("text-fg", unread && "font-medium")}>
            {unread ? <span className="sr-only">Unread: </span> : null}
            {to === null ? (
              title
            ) : (
              <Link
                to={to}
                onClick={() => {
                  onOpen();
                  if (unread && canMark) void markRead();
                }}
                className="underline underline-offset-2 hover:text-fg-accent"
              >
                {title}
              </Link>
            )}
          </span>
          {detail === null ? null : <span className="text-fg-secondary">{detail}</span>}
          <time dateTime={created.toISOString()} className="text-xs text-fg-muted">
            {formatDateTime(created)}
          </time>
        </span>
        {unread && canMark ? (
          <Button variant="ghost" size="sm" disabled={busy} onClick={markRead} aria-label={`Mark as read: ${title}`}>
            Mark as read
          </Button>
        ) : null}
      </span>
    </li>
  );
}

/** The bell of the top bar: how many notifications are unread, and the list of the latest ones. */
export function NotificationBell() {
  const user = useSignedInUser();
  const { access } = useAuth();
  const [open, setOpen] = useState(false);
  // The rules let only an approved member mark a notification as read.
  const canMark = access.status === "ready" && access.data?.member === true;
  const unread = useLiveQuery({
    collection: "userNotifications",
    within: [user.uid],
    where: [["readAt", "==", null]],
    orderBy: [["createdAt", "desc"]],
    limit: COUNTED + 1,
  });
  const latest = useLiveQuery(
    open
      ? { collection: "userNotifications", within: [user.uid], orderBy: [["createdAt", "desc"]], limit: LISTED }
      : null,
  );
  const count = unread.status === "ready" ? unread.data.length : 0;
  const label =
    count === 0 ? "Notifications" : `Notifications, ${count > COUNTED ? `more than ${COUNTED}` : count} unread`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={label} className="relative w-8.5 px-0 pointer-coarse:w-11">
          <Bell aria-hidden="true" strokeWidth={1.8} />
          {count === 0 ? null : (
            <span
              aria-hidden="true"
              data-testid="unread-count"
              className="absolute -top-1 -right-1 min-w-4.5 rounded-pill border border-accent-strong bg-accent-strong px-1 text-micro leading-4 text-fg-on-accent"
            >
              {count > COUNTED ? `${COUNTED}+` : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Notifications" align="end">
        <h2 className="px-2.5 pt-1 pb-2 text-md font-medium text-fg-strong">Notifications</h2>
        <div className="max-h-[min(28rem,70dvh)] overflow-y-auto">
          <LiveView
            live={latest}
            loadingLabel="Loading notifications"
            errorTitle="Your notifications could not be loaded."
            onRetry={retryFailedLiveData}
          >
            {(list) =>
              list.length === 0 ? (
                <EmptyState
                  title="No notifications"
                  description="When something needs your attention, it appears here."
                />
              ) : (
                <ul className="grid gap-1" data-testid="notification-list">
                  {list.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      canMark={canMark}
                      onOpen={() => setOpen(false)}
                    />
                  ))}
                </ul>
              )
            }
          </LiveView>
        </div>
      </PopoverContent>
    </Popover>
  );
}
