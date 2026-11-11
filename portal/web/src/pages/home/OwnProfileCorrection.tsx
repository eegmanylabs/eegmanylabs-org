import { CORRECTABLE_PERSON_FIELDS, CorrectionRequestDialog } from "./CorrectionRequestDialog";

/** Reports a wrong detail of the member's own profile. */
export function OwnProfileCorrection({ uid, personId }: { uid: string; personId: string }) {
  return (
    <CorrectionRequestDialog
      uid={uid}
      entityType="person"
      entityId={personId}
      fields={CORRECTABLE_PERSON_FIELDS}
      description="Tell the administrators which detail of your profile is wrong and what it should say. They correct the record."
    />
  );
}
