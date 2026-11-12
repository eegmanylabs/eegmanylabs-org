// Entry point of the deployed functions. Every export of this file is a Cloud Function.
//
// | Kind                | Functions                                                                  |
// |---------------------|----------------------------------------------------------------------------|
// | Sessions            | `sessionStart`, `endAllSessions`                                           |
// | Account claims      | `claimProfile`, `requestAccess`, `listAccountClaims`, `reviewAccountClaim`, `unlinkAccountClaim` |
// | Roles and accounts  | `setRoleAssignment`, `setCapabilityGrant`, `setRoleCapabilityOverride`, `setUserStatus`, `listUsers` |
// | Audit trail         | `listAuditEvents`                                                          |
// | Laboratories        | `requestLabClaim`, `withdrawLabClaim`, `reviewLabClaim`, `createLaboratory`, `saveEquipmentConfiguration` |
// | Participations      | `createParticipation`, `setParticipationStatus`                            |
// | Imports             | `resolveReconciliationItem`, `rollbackImportBatch`                         |
// | Records of people   | `resolveCorrectionRequest`, `getPersonDemographics`, `setPersonOrcid`, `confirmLaboratoryMembership`, `confirmReplicationMembership` |
// | Replications        | `setReplicationStatus`, `editReplicationCitation`                          |
// | Workspace           | `createPage`, `openEntityPage`, `movePage`, `setPageSharing`, `getPageSharing`, `savePageVersion`, `searchWorkspace` |
// | Databases and views | `createDatabase`, `saveProperty`, `saveRecords`, `saveView`, `openDashboard`, `saveDashboard` |
// | Tasks               | `createTaskList`, `updateTaskList`, `createTask`, `updateTasks`, `moveTask`, `setTaskStatus`, `setReminder` |
// | Progress updates    | `postProgressUpdate`                                                       |
// | Recruitment         | `fileRecruitmentReports`, `saveCountCategory`, `generateForecast`, and the scheduled `recruitmentInactivitySweep` |
// | Google Drive        | `linkDriveResource`, `checkDriveLink`, `browseDriveFolder`, `previewDriveFile`, and the public receiver `driveNotifications` |
// | Sheet synchronisation | `saveSyncMapping`, `controlSyncMapping`, `requestSyncRun`, `controlSyncRun`, `resolveSyncConflict`, `resolveSyncReviewItem` |
// | Generated documents | `saveDocumentTemplate`, `generateDocument`                                  |
// | Integration health  | `controlIntegrationConnection`, and the scheduled `integrationsSweep`      |
// | Storage servers     | `saveStorageEndpoint`, `checkStorageEndpoint`, `getStorageEndpointConnection`, and the scheduled `storageSweep` |
// | Datasets            | `registerDataset`, `updateDataset`, `setDatasetStatus`, `saveDatasetWorkflow`, `importBidsReport`, `recordQcAssessment` |
// | Copies of datasets  | `addStorageRef`, `changeStorageRef`, `scanStorageRef`, `recordManifest`, `getStorageLocation`, `saveViewerLink`, `openViewerLink` |
// | Transfers           | `requestTransfer`, `advanceTransfer`, which record and approve transfers that people carry out |
// | Integration triggers | `integrationsOnRunWritten`, which runs queued jobs, and `syncOnLaboratoryWritten` and `syncOnEquipmentWritten`, which enqueue them |
// | Task triggers       | `tasksOnTaskWritten`, and the scheduled `remindersSweep`                   |
// | Workspace triggers  | `pagesOnUpdateCreated`, `pagesOnPageWritten`, `threadsOnCommentWritten`   |
// | Audit trigger       | `auditDocumentWrites`                                                      |
// | Access maintenance  | The triggers whose names begin with `accessOn`, and the scheduled `accessExpirySweep` |
// | Derived directory   | The triggers whose names begin with `personUnitsOn`                        |
// | Integrity           | The scheduled `integritySweep`                                             |
import { FUNCTIONS_REGION } from "@eegml/shared";
import { setGlobalOptions } from "firebase-functions";

// Applies to every function that does not state its own options. Triggers state their region
// themselves (see `documentTrigger`), because their modules are loaded before this line runs.
setGlobalOptions({ region: FUNCTIONS_REGION, maxInstances: 10, memory: "256MiB" });

export { addStorageRef } from "./callables/addStorageRef";
export { advanceTransfer } from "./callables/advanceTransfer";
export { browseDriveFolder } from "./callables/browseDriveFolder";
export { changeStorageRef } from "./callables/changeStorageRef";
export { checkDriveLink } from "./callables/checkDriveLink";
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
export { fileRecruitmentReports } from "./callables/fileRecruitmentReports";
export { generateDocument } from "./callables/generateDocument";
export { generateForecast } from "./callables/generateForecast";
export { getPageSharing } from "./callables/getPageSharing";
export { getPersonDemographics } from "./callables/getPersonDemographics";
export { getStorageEndpointConnection } from "./callables/getStorageEndpointConnection";
export { getStorageLocation } from "./callables/getStorageLocation";
export { importBidsReport } from "./callables/importBidsReport";
export { linkDriveResource } from "./callables/linkDriveResource";
export { listAccountClaims } from "./callables/listAccountClaims";
export { listAuditEvents } from "./callables/listAuditEvents";
export { listUsers } from "./callables/listUsers";
export { movePage } from "./callables/movePage";
export { moveTask } from "./callables/moveTask";
export { openDashboard } from "./callables/openDashboard";
export { openEntityPage } from "./callables/openEntityPage";
export { openViewerLink } from "./callables/openViewerLink";
export { postProgressUpdate } from "./callables/postProgressUpdate";
export { previewDriveFile } from "./callables/previewDriveFile";
export { recordManifest } from "./callables/recordManifest";
export { recordQcAssessment } from "./callables/recordQcAssessment";
export { registerDataset } from "./callables/registerDataset";
export { requestAccess } from "./callables/requestAccess";
export { requestLabClaim } from "./callables/requestLabClaim";
export { requestSyncRun } from "./callables/requestSyncRun";
export { requestTransfer } from "./callables/requestTransfer";
export { resolveCorrectionRequest } from "./callables/resolveCorrectionRequest";
export { resolveReconciliationItem } from "./callables/resolveReconciliationItem";
export { resolveSyncConflict } from "./callables/resolveSyncConflict";
export { resolveSyncReviewItem } from "./callables/resolveSyncReviewItem";
export { reviewAccountClaim } from "./callables/reviewAccountClaim";
export { reviewLabClaim } from "./callables/reviewLabClaim";
export { rollbackImportBatch } from "./callables/rollbackImportBatch";
export { saveCountCategory } from "./callables/saveCountCategory";
export { saveDashboard } from "./callables/saveDashboard";
export { saveDatasetWorkflow } from "./callables/saveDatasetWorkflow";
export { saveDocumentTemplate } from "./callables/saveDocumentTemplate";
export { saveEquipmentConfiguration } from "./callables/saveEquipmentConfiguration";
export { savePageVersion } from "./callables/savePageVersion";
export { saveProperty } from "./callables/saveProperty";
export { saveRecords } from "./callables/saveRecords";
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
export { storageSweep } from "./triggers/datasets";
export {
  driveNotifications,
  integrationsOnRunWritten,
  integrationsSweep,
  syncOnEquipmentWritten,
  syncOnLaboratoryWritten,
} from "./triggers/integrations";
export { integritySweep } from "./triggers/integrity-sweep";
export { pagesOnPageWritten, pagesOnUpdateCreated, threadsOnCommentWritten } from "./triggers/pages";
export {
  personUnitsOnLaboratoryMemberWritten,
  personUnitsOnReplicationMembershipWritten,
} from "./triggers/person-units";
export { recruitmentInactivitySweep } from "./triggers/recruitment";
export { remindersSweep, tasksOnTaskWritten } from "./triggers/tasks";
