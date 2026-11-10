// The data layer: the only part of the web application that imports the Firebase SDK.
// Routes and components import from "@/data" and never from a file inside it.
export { startSession, useAccessRecord, useUserRecord } from "./account";
export {
  completeSignInLink,
  googleSignInAvailable,
  isSignInLink,
  observeSession,
  requestSignInLink,
  type SessionUser,
  SignInError,
  type SignInFailure,
  signInWithGoogle,
  signOut,
} from "./auth";
export { CallableError, type CallableErrorCode, callFunction } from "./callable";
export { DataShapeError, type WithId } from "./converter";
export { liveListenerCount, type NamedQuery, namedQuery, resetLiveData, useLiveDoc, useLiveQuery } from "./live";
export { type AccessRecord, refs, type UserRecord } from "./refs";
export type { Live, LiveError } from "./subscription-cache";
