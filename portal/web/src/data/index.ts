// The data layer: the only part of the web application that imports the Firebase SDK.
// Routes and components import from "@/data" and never from a file inside it.
export { type AccessRecord, startSession, type UserRecord, useAccessRecord, useUserRecord } from "./account";
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
export { callFunction } from "./callable";
export { CallableError, type CallableErrorCode } from "./callable-error";
export { DataShapeError, type RecordOf, type WithId } from "./converter";
export { liveListenerCount, retryFailedLiveData, useLiveDocument, useLiveQuery } from "./live";
export { discardLocalData } from "./local-data";
export {
  type FieldOf,
  type LiveQuery,
  LiveQueryError,
  type QueryFilter,
  type QueryOperator,
  type QueryOrder,
  type QueryValue,
} from "./query-spec";
export type { Live, LiveError } from "./subscription-cache";
