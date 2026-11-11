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

export { claimProfile } from "./callables/claimProfile";
export { confirmLaboratoryMembership } from "./callables/confirmLaboratoryMembership";
export { confirmReplicationMembership } from "./callables/confirmReplicationMembership";
export { createDatabase } from "./callables/createDatabase";
export { createLaboratory } from "./callables/createLaboratory";
export { createPage } from "./callables/createPage";
export { createParticipation } from "./callables/createParticipation";
export { editReplicationCitation } from "./callables/editReplicationCitation";
export { endAllSessions } from "./callables/endAllSessions";
export { getPageSharing } from "./callables/getPageSharing";
export { getPersonDemographics } from "./callables/getPersonDemographics";
export { listAccountClaims } from "./callables/listAccountClaims";
export { listAuditEvents } from "./callables/listAuditEvents";
export { listUsers } from "./callables/listUsers";
export { movePage } from "./callables/movePage";
export { openDashboard } from "./callables/openDashboard";
export { openEntityPage } from "./callables/openEntityPage";
export { requestAccess } from "./callables/requestAccess";
export { requestLabClaim } from "./callables/requestLabClaim";
export { resolveCorrectionRequest } from "./callables/resolveCorrectionRequest";
export { resolveReconciliationItem } from "./callables/resolveReconciliationItem";
export { reviewAccountClaim } from "./callables/reviewAccountClaim";
export { reviewLabClaim } from "./callables/reviewLabClaim";
export { rollbackImportBatch } from "./callables/rollbackImportBatch";
export { saveDashboard } from "./callables/saveDashboard";
export { saveEquipmentConfiguration } from "./callables/saveEquipmentConfiguration";
export { savePageVersion } from "./callables/savePageVersion";
export { saveProperty } from "./callables/saveProperty";
export { saveRecords } from "./callables/saveRecords";
export { saveView } from "./callables/saveView";
export { searchWorkspace } from "./callables/searchWorkspace";
export { sessionStart } from "./callables/sessionStart";
export { setCapabilityGrant } from "./callables/setCapabilityGrant";
export { setPageSharing } from "./callables/setPageSharing";
export { setParticipationStatus } from "./callables/setParticipationStatus";
export { setPersonOrcid } from "./callables/setPersonOrcid";
export { setReplicationStatus } from "./callables/setReplicationStatus";
export { setRoleAssignment } from "./callables/setRoleAssignment";
export { setRoleCapabilityOverride } from "./callables/setRoleCapabilityOverride";
export { setUserStatus } from "./callables/setUserStatus";
export { unlinkAccountClaim } from "./callables/unlinkAccountClaim";
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
export { integritySweep } from "./triggers/integrity-sweep";
export { pagesOnPageWritten, pagesOnUpdateCreated, threadsOnCommentWritten } from "./triggers/pages";
export {
  personUnitsOnLaboratoryMemberWritten,
  personUnitsOnReplicationMembershipWritten,
} from "./triggers/person-units";
