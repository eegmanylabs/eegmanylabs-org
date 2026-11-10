import { useCallback, useRef, useSyncExternalStore } from "react";
import { IDLE, type Live, type StartSubscription, type SubscriptionCache } from "./subscription-cache";

const unsubscribed = () => {};

/**
 * Reads a live value from a subscription cache. Components that pass the same key share one
 * subscription. Pass a null key to watch nothing.
 */
export function useSubscription<T>(cache: SubscriptionCache, key: string | null, start: StartSubscription<T>): Live<T> {
  // The cache calls `start` only when it opens a subscription, so the latest one is enough.
  const latestStart = useRef(start);
  latestStart.current = start;

  const subscribe = useCallback(
    (notify: () => void) => {
      if (key === null) return unsubscribed;
      return cache.subscribe<T>(key, (publish) => latestStart.current(publish), notify);
    },
    [cache, key],
  );
  const read = useCallback((): Live<T> => (key === null ? IDLE : cache.read<T>(key)), [cache, key]);
  return useSyncExternalStore(subscribe, read);
}
