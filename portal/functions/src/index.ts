// Entry point of the deployed functions. Every export of this file is a Cloud Function.
//
// | Kind                | Functions                                                                  |
// |---------------------|----------------------------------------------------------------------------|
// | Sessions            | `sessionStart`, `endAllSessions`                                           |
// | Account claims      | `claimProfile`, `requestAccess`, `listAccountClaims`, `reviewAccountClaim`, `unlinkAccountClaim` |
// | Roles and accounts  | `setRoleAssignment`, `setCapabilityGrant`, `setRoleCapabilityOverride`, `setUserStatus`, `listUsers` |
// | Audit trail         | `listAuditEvents`                                                          |
// | Laboratory claims   | `requestLabClaim`, `reviewLabClaim`                                        |
// | Records of people   | `resolveCorrectionRequest`, `getPersonDemographics`, `setPersonOrcid`, `confirmLaboratoryMembership`, `confirmReplicationMembership` |
// | Audit trigger       | `auditDocumentWrites`                                                      |
// | Access maintenance  | The triggers whose names begin with `accessOn`, and the scheduled `accessExpirySweep` |
// | Derived directory   | The triggers whose names begin with `personUnitsOn`                        |
import { FUNCTIONS_REGION } from "@eegml/shared";
import { setGlobalOptions } from "firebase-functions";

// Applies to every function that does not state its own options. Triggers state their region
// themselves (see `documentTrigger`), because their modules are loaded before this line runs.
setGlobalOptions({ region: FUNCTIONS_REGION, maxInstances: 10, memory: "256MiB" });

export { claimProfile } from "./callables/claimProfile";
export { confirmLaboratoryMembership } from "./callables/confirmLaboratoryMembership";
export { confirmReplicationMembership } from "./callables/confirmReplicationMembership";
export { endAllSessions } from "./callables/endAllSessions";
export { getPersonDemographics } from "./callables/getPersonDemographics";
export { listAccountClaims } from "./callables/listAccountClaims";
export { listAuditEvents } from "./callables/listAuditEvents";
export { listUsers } from "./callables/listUsers";
export { requestAccess } from "./callables/requestAccess";
export { requestLabClaim } from "./callables/requestLabClaim";
export { resolveCorrectionRequest } from "./callables/resolveCorrectionRequest";
export { reviewAccountClaim } from "./callables/reviewAccountClaim";
export { reviewLabClaim } from "./callables/reviewLabClaim";
export { sessionStart } from "./callables/sessionStart";
export { setCapabilityGrant } from "./callables/setCapabilityGrant";
export { setPersonOrcid } from "./callables/setPersonOrcid";
export { setRoleAssignment } from "./callables/setRoleAssignment";
export { setRoleCapabilityOverride } from "./callables/setRoleCapabilityOverride";
export { setUserStatus } from "./callables/setUserStatus";
export { unlinkAccountClaim } from "./callables/unlinkAccountClaim";
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
  personUnitsOnLaboratoryMemberWritten,
  personUnitsOnReplicationMembershipWritten,
} from "./triggers/person-units";
