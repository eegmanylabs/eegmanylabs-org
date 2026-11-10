// The signed-in account's own records.
import { type SessionStartOutput, sessionStartContract } from "@eegml/shared";
import { callFunction } from "./callable";
import { useLiveDoc } from "./live";
import { type AccessRecord, refs, type UserRecord } from "./refs";
import type { Live } from "./subscription-cache";

/** `users/{uid}` of an account, live. Null data means the document does not exist yet. */
export function useUserRecord(uid: string | null): Live<UserRecord | null> {
  return useLiveDoc(uid === null ? null : refs.user(uid));
}

/** `access/{uid}` of an account, live. Null data means the document does not exist yet. */
export function useAccessRecord(uid: string | null): Live<AccessRecord | null> {
  return useLiveDoc(uid === null ? null : refs.access(uid));
}

/**
 * Tells the server that the portal has started with this account signed in. The first call for
 * an account registers it. The application calls this once each time it starts, so once for
 * every page load and in every tab, and the server writes only when something has changed.
 */
export function startSession(): Promise<SessionStartOutput> {
  return callFunction(sessionStartContract, {});
}
