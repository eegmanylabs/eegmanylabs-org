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
export { namesOfOthers } from "./awareness-wire";
export { callFunction } from "./callable";
export { CallableError, type CallableErrorCode } from "./callable-error";
export { DataShapeError, type RecordOf, type WithId } from "./converter";
export {
  LIVE_COLLECTION_MAX_PAGES,
  liveListenerCount,
  liveWatchedKeys,
  reconnectLiveData,
  retryFailedLiveData,
  useLiveCollection,
  useLiveDataDisconnected,
  useLiveDocument,
  useLiveDocuments,
  useLiveDocumentsAt,
  useLiveQueries,
  useLiveQuery,
} from "./live";
export { discardLocalData } from "./local-data";
export { PageFileError, pageFileUrl, uploadPageFile } from "./page-files";
export { PresenceSync, type PresenceSyncMode } from "./page-presence";
export { type CompactionResult, PageSync, type PageSyncOptions, type SaveState } from "./page-sync";
export {
  addComment,
  createThread,
  editComment,
  type PageFieldsChange,
  readPageVersion,
  removeComment,
  setPageArchived,
  setThreadResolved,
  type ThreadAnchor,
  type ThreadScope,
  updatePageFields,
} from "./page-writes";
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
export { isDenied, type Live, type LiveError } from "./subscription-cache";
export { type CallResult, useCallResult } from "./use-call";
export {
  acknowledgeProtocolVersion,
  approveProtocolVersion,
  type ChecklistChange,
  type CorrectionRequestInput,
  createCorrectionRequest,
  createPlannedPause,
  createProtocol,
  createProtocolVersion,
  deleteView,
  endLaboratoryMember,
  ensureTag,
  type FieldPatch,
  followUpDeviation,
  linkDocumentToManuscript,
  markNotificationRead,
  type PlannedPauseInput,
  type PreferencesInput,
  proposeLaboratoryMember,
  recordRecentVisit,
  removeReminder,
  removeSavedSearch,
  removeTeamMember,
  reportDeviation,
  type SavedSearchInput,
  saveLaboratoryDetail,
  savePreferences,
  saveSearch,
  saveTeamMember,
  setFavourite,
  setFollowing,
  setParticipationProtocol,
  updateChecklistItem,
  updateDatabaseFields,
  updateLaboratoryFields,
  updateOwnPersonLinks,
  updateParticipationDetail,
  updatePlannedPause,
  updateReplicationFields,
} from "./writes";
