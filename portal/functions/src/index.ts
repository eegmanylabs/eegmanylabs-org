// Entry point of the deployed functions. Every export of this file is a Cloud Function.
//
// | Kind                | Functions                                                                  |
// |---------------------|----------------------------------------------------------------------------|
// | Sessions            | `sessionStart`, `endAllSessions`                                           |
// | Account claims      | `claimProfile`, `requestAccess`, `listAccountClaims`, `reviewAccountClaim`, `unlinkAccountClaim`, `recoverAccount` |
// | Roles and accounts  | `setRoleAssignment`, `setCapabilityGrant`, `setRoleCapabilityOverride`, `setUserStatus`, `listUsers` |
// | Audit trail         | `listAuditEvents`                                                          |
// | Governance          | `exportPersonData`, `requestErasure`, `decideErasure`, `listErasureRequests`, `getAccessReview`, `attestAccessReview`, `getRetention`, `setRetentionPeriod`, `runRetentionSweep`, and the scheduled `retentionSweep` |
// | Laboratories        | `requestLabClaim`, `withdrawLabClaim`, `reviewLabClaim`, `createLaboratory`, `saveEquipmentConfiguration` |
// | Participations      | `createParticipation`, `setParticipationStatus`                            |
// | Imports             | `resolveReconciliationItem`, `rollbackImportBatch`                         |
// | Records of people   | `resolveCorrectionRequest`, `getPersonDemographics`, `setPersonOrcid`, `confirmLaboratoryMembership`, `confirmReplicationMembership` |
// | Replications        | `setReplicationStatus`, `editReplicationCitation`                          |
// | Workspace           | `createPage`, `openEntityPage`, `movePage`, `setPageSharing`, `getPageSharing`, `savePageVersion`, `searchWorkspace` |
// | Databases and views | `createDatabase`, `saveProperty`, `saveRecords`, `saveView`, `openDashboard`, `saveDashboard` |
// | Tasks               | `createTaskList`, `updateTaskList`, `createTask`, `updateTasks`, `moveTask`, `setTaskStatus`, `setReminder` |
// | Progress updates    | `postProgressUpdate`                                                       |
// | Recruitment         | `fileRecruitmentReports`, `saveCountCategory`, `generateForecast`; overdue updates are flagged by the built-in automation `overdueUpdatesDaily` |
// | Google Drive        | `linkDriveResource`, `checkDriveLink`, `browseDriveFolder`, `previewDriveFile`, and the public receiver `driveNotifications` |
// | Sheet synchronisation | `saveSyncMapping`, `controlSyncMapping`, `requestSyncRun`, `controlSyncRun`, `resolveSyncConflict`, `resolveSyncReviewItem` |
// | Generated documents | `saveDocumentTemplate`, `generateDocument`                                  |
// | Integration health  | `controlIntegrationConnection`, and the scheduled `integrationsSweep`      |
// | Storage servers     | `saveStorageEndpoint`, `checkStorageEndpoint`, `getStorageEndpointConnection`, and the scheduled `storageSweep` |
// | Datasets            | `registerDataset`, `updateDataset`, `setDatasetStatus`, `saveDatasetWorkflow`, `importBidsReport`, `recordQcAssessment` |
// | Copies of datasets  | `addStorageRef`, `changeStorageRef`, `scanStorageRef`, `recordManifest`, `getStorageLocation`, `saveViewerLink`, `openViewerLink` |
// | Transfers           | `requestTransfer`, `advanceTransfer`, which record and approve transfers that people carry out |
// | Hypotheses          | `recordHypothesisFinding`, which records an original statistic or a result with its provenance |
// | Analysis runs       | `saveAnalysisRun`                                                          |
// | Decisions and incidents | `recordDecision`, `reportIncident`, `recordIncidentAction`             |
// | Authorship          | `saveAuthorshipList`, `respondToAuthorshipEntry`, `listMyAuthorshipEntries` |
// | Outputs             | `saveManuscript`, `recordManuscriptEvent`, `planManuscriptMilestone`, `checkOsfLink` |
// | Integration triggers | `integrationsOnRunWritten`, which runs queued jobs, and `syncOnLaboratoryWritten` and `syncOnEquipmentWritten`, which enqueue them |
// | Task triggers       | `tasksOnTaskWritten`, and the scheduled `remindersSweep`                   |
// | Workspace triggers  | `pagesOnUpdateCreated`, `pagesOnPageWritten`, `threadsOnCommentWritten`   |
// | Publishing          | `preparePublication`, `approvePublication`, `refreshPublication`, `withdrawPublication`, `proposePublicationRollback`, and the scheduled `publicationsSweep` |
// | Automations         | `saveAutomationRule`, `runAutomationRule`, `saveScheduledReport`, the triggers whose names begin with `automationsOn`, and the scheduled `automationsSchedule` |
// | Analysis            | `getDemographicAggregates`, beside `getPersonDemographics` in the same audited module |
// | Mail                | `mailOnNotificationCreated`, `mailOnQueued` and the scheduled `mailSweep` |
// | Search and followers | `searchOnCommentWritten`, `searchOnDocumentLinkWritten`, `followersOnActivityCreated`, `notifyOnProtocolVersionWritten`, `notifyOnManuscriptWritten` |
// | Audit trigger       | `auditDocumentWrites`                                                      |
// | Access maintenance  | The triggers whose names begin with `accessOn`, and the scheduled `accessExpirySweep` |
// | Derived directory   | The triggers whose names begin with `personUnitsOn`                        |
// | Integrity           | The scheduled `integritySweep`                                             |
import { FUNCTIONS_REGION } from "@eegml/shared";
import { setGlobalOptions } from "firebase-functions";

// Applies to every function that does not state its own options. Triggers state their region
// themselves (see `documentTrigger`), because their modules are loaded before this line runs.
setGlobalOptions({ region: FUNCTIONS_REGION, maxInstances: 10, memory: "256MiB" });

export { attestAccessReview, getAccessReview } from "./callables/accessReview";
export { addStorageRef } from "./callables/addStorageRef";
export { advanceTransfer } from "./callables/advanceTransfer";
export { approvePublication } from "./callables/approvePublication";
export { browseDriveFolder } from "./callables/browseDriveFolder";
export { changeStorageRef } from "./callables/changeStorageRef";
export { checkDriveLink } from "./callables/checkDriveLink";
export { checkOsfLink } from "./callables/checkOsfLink";
export { checkStorageEndpoint } from "./callables/checkStorageEndpoint";
export { claimProfile } from "./callables/claimProfile";
export { confirmLaboratoryMembership } from "./callables/confirmLaboratoryMembership";
export { confirmReplicationMembership } from "./callables/confirmReplicationMembership";
export { controlIntegrationConnection } from "./callables/controlIntegrationConnection";
export { controlSyncMapping } from "./callables/controlSyncMapping";
export { controlSyncRun } from "./callables/controlSyncRun";
export { createDatabase } from "./callables/createDatabase";
export { createLaboratory } from "./callables/createLaboratory";
export { createPage } from "./callables/createPage";
export { createParticipation } from "./callables/createParticipation";
export { createTask } from "./callables/createTask";
export { createTaskList } from "./callables/createTaskList";
export { editReplicationCitation } from "./callables/editReplicationCitation";
export { endAllSessions } from "./callables/endAllSessions";
export { decideErasure, listErasureRequests, requestErasure } from "./callables/erasure";
export { exportPersonData } from "./callables/exportPersonData";
export { fileRecruitmentReports } from "./callables/fileRecruitmentReports";
export { generateDocument } from "./callables/generateDocument";
export { generateForecast } from "./callables/generateForecast";
export { getPageSharing } from "./callables/getPageSharing";
export { getDemographicAggregates, getPersonDemographics } from "./callables/getPersonDemographics";
export { getStorageEndpointConnection } from "./callables/getStorageEndpointConnection";
export { getStorageLocation } from "./callables/getStorageLocation";
export { importBidsReport } from "./callables/importBidsReport";
export { linkDriveResource } from "./callables/linkDriveResource";
export { listAccountClaims } from "./callables/listAccountClaims";
export { listAuditEvents } from "./callables/listAuditEvents";
export { listMyAuthorshipEntries } from "./callables/listMyAuthorshipEntries";
export { listUsers } from "./callables/listUsers";
export { movePage } from "./callables/movePage";
export { moveTask } from "./callables/moveTask";
export { openDashboard } from "./callables/openDashboard";
export { openEntityPage } from "./callables/openEntityPage";
export { openViewerLink } from "./callables/openViewerLink";
export { planManuscriptMilestone } from "./callables/planManuscriptMilestone";
export { postProgressUpdate } from "./callables/postProgressUpdate";
export { preparePublication } from "./callables/preparePublication";
export { previewDriveFile } from "./callables/previewDriveFile";
export { proposePublicationRollback } from "./callables/proposePublicationRollback";
export { recordDecision } from "./callables/recordDecision";
export { recordHypothesisFinding } from "./callables/recordHypothesisFinding";
export { recordIncidentAction } from "./callables/recordIncidentAction";
export { recordManifest } from "./callables/recordManifest";
export { recordManuscriptEvent } from "./callables/recordManuscriptEvent";
export { recordQcAssessment } from "./callables/recordQcAssessment";
export { recoverAccount } from "./callables/recoverAccount";
export { refreshPublication } from "./callables/refreshPublication";
export { registerDataset } from "./callables/registerDataset";
export { reportIncident } from "./callables/reportIncident";
export { requestAccess } from "./callables/requestAccess";
export { requestLabClaim } from "./callables/requestLabClaim";
export { requestSyncRun } from "./callables/requestSyncRun";
export { requestTransfer } from "./callables/requestTransfer";
export { resolveCorrectionRequest } from "./callables/resolveCorrectionRequest";
export { resolveReconciliationItem } from "./callables/resolveReconciliationItem";
export { resolveSyncConflict } from "./callables/resolveSyncConflict";
export { resolveSyncReviewItem } from "./callables/resolveSyncReviewItem";
export { respondToAuthorshipEntry } from "./callables/respondToAuthorshipEntry";
export { getRetention, runRetentionSweep, setRetentionPeriod } from "./callables/retention";
export { reviewAccountClaim } from "./callables/reviewAccountClaim";
export { reviewLabClaim } from "./callables/reviewLabClaim";
export { rollbackImportBatch } from "./callables/rollbackImportBatch";
export { runAutomationRule } from "./callables/runAutomationRule";
export { saveAnalysisRun } from "./callables/saveAnalysisRun";
export { saveAuthorshipList } from "./callables/saveAuthorshipList";
export { saveAutomationRule } from "./callables/saveAutomationRule";
export { saveCountCategory } from "./callables/saveCountCategory";
export { saveDashboard } from "./callables/saveDashboard";
export { saveDatasetWorkflow } from "./callables/saveDatasetWorkflow";
export { saveDocumentTemplate } from "./callables/saveDocumentTemplate";
export { saveEquipmentConfiguration } from "./callables/saveEquipmentConfiguration";
export { saveManuscript } from "./callables/saveManuscript";
export { savePageVersion } from "./callables/savePageVersion";
export { saveProperty } from "./callables/saveProperty";
export { saveRecords } from "./callables/saveRecords";
export { saveScheduledReport } from "./callables/saveScheduledReport";
export { saveStorageEndpoint } from "./callables/saveStorageEndpoint";
export { saveSyncMapping } from "./callables/saveSyncMapping";
export { saveView } from "./callables/saveView";
export { saveViewerLink } from "./callables/saveViewerLink";
export { scanStorageRef } from "./callables/scanStorageRef";
export { searchWorkspace } from "./callables/searchWorkspace";
export { sessionStart } from "./callables/sessionStart";
export { setCapabilityGrant } from "./callables/setCapabilityGrant";
export { setDatasetStatus } from "./callables/setDatasetStatus";
export { setPageSharing } from "./callables/setPageSharing";
export { setParticipationStatus } from "./callables/setParticipationStatus";
export { setPersonOrcid } from "./callables/setPersonOrcid";
export { setReminder } from "./callables/setReminder";
export { setReplicationStatus } from "./callables/setReplicationStatus";
export { setRoleAssignment } from "./callables/setRoleAssignment";
export { setRoleCapabilityOverride } from "./callables/setRoleCapabilityOverride";
export { setTaskStatus } from "./callables/setTaskStatus";
export { setUserStatus } from "./callables/setUserStatus";
export { unlinkAccountClaim } from "./callables/unlinkAccountClaim";
export { updateDataset } from "./callables/updateDataset";
export { updateTaskList } from "./callables/updateTaskList";
export { updateTasks } from "./callables/updateTasks";
export { withdrawLabClaim } from "./callables/withdrawLabClaim";
export { withdrawPublication } from "./callables/withdrawPublication";
export {
  accessOnCapabilityGrantWritten,
  accessOnGroupWritten,
  accessOnPersonWritten,
  accessOnRecordGrantWritten,
  accessOnRoleAssignmentWritten,
  accessOnRoleCapabilitiesWritten,
  accessOnSystemSettingsWritten,
  accessOnUserWritten,
} from "./triggers/access";
export { accessExpirySweep } from "./triggers/access-expiry";
export { auditDocumentWrites } from "./triggers/audit";
export {
  automationsOnDatasetWritten,
  automationsOnLaboratoryWritten,
  automationsOnSummaryWritten,
  automationsSchedule,
} from "./triggers/automations";
export { storageSweep } from "./triggers/datasets";
export {
  driveNotifications,
  integrationsOnRunWritten,
  integrationsSweep,
  syncOnEquipmentWritten,
  syncOnLaboratoryWritten,
} from "./triggers/integrations";
export { integritySweep } from "./triggers/integrity-sweep";
export { mailOnNotificationCreated, mailOnQueued, mailSweep } from "./triggers/mail";
export { pagesOnPageWritten, pagesOnUpdateCreated, threadsOnCommentWritten } from "./triggers/pages";
export {
  personUnitsOnLaboratoryMemberWritten,
  personUnitsOnReplicationMembershipWritten,
} from "./triggers/person-units";
export { publicationsSweep } from "./triggers/publishing";
export { retentionSweep } from "./triggers/retention";
export {
  followersOnActivityCreated,
  notifyOnManuscriptWritten,
  notifyOnProtocolVersionWritten,
  searchOnCommentWritten,
  searchOnDocumentLinkWritten,
} from "./triggers/search";
export { remindersSweep, tasksOnTaskWritten } from "./triggers/tasks";
