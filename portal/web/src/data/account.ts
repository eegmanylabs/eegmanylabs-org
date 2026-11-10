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

/** Registers the signed-in account with the server. Called once after each sign-in. */
export function startSession(): Promise<SessionStartOutput> {
  return callFunction(sessionStartContract, {});
}
