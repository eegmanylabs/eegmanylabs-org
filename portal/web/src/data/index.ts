// The data layer: the only part of the web application that imports the Firebase SDK.
// Routes and components import from "@/data" and never from a file inside it.
export { type AccessRecord, startSession, type UserRecord, useAccessRecord, useUserRecord } from "./account";
export {
  completeSignInLink,
  googleSignInAvailable,
  isSignInLink,
  observeSession,
  requestSignInLink,
  type SecondFactorChallenge,
  SecondFactorChallengeError,
  type SessionUser,
  SignInError,
  type SignInFailure,
  signInWithGoogle,
  signOut,
} from "./auth";
export { callFunction } from "./callable";
export { CallableError, type CallableErrorCode } from "./callable-error";
export { DataShapeError, type RecordOf, type WithId } from "./converter";
export {
  LIVE_COLLECTION_MAX_PAGES,
  liveListenerCount,
  reconnectLiveData,
  retryFailedLiveData,
  useLiveCollection,
  useLiveDataDisconnected,
  useLiveDocument,
  useLiveQuery,
} from "./live";
export { discardLocalData } from "./local-data";
export type { PagedItems } from "./paged";
export {
  type FieldOf,
  type LiveQuery,
  LiveQueryError,
  type QueryFilter,
  type QueryOperator,
  type QueryOrder,
  type QueryValue,
} from "./query-spec";
export { secondFactor } from "./second-factor";
export {
  type EnrolledFactor,
  normaliseCode,
  SECOND_FACTOR_MESSAGES,
  type SecondFactorApi,
  SecondFactorError,
  type SecondFactorFailure,
  SUPPORTED_FACTOR_IDS,
  type TotpEnrolment,
} from "./second-factor-model";
export type { Live, LiveError } from "./subscription-cache";
export { type CallResult, useCallResult } from "./use-call";
export {
  type ChecklistChange,
  type CorrectionRequestInput,
  createCorrectionRequest,
  endLaboratoryMember,
  type FieldPatch,
  markNotificationRead,
  proposeLaboratoryMember,
  recordRecentVisit,
  saveLaboratoryDetail,
  setFavourite,
  updateChecklistItem,
  updateLaboratoryFields,
  updateOwnPersonLinks,
  updateParticipationDetail,
  updateReplicationFields,
} from "./writes";
