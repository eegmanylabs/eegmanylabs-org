// The second factor of the signed-in account, with the Firebase SDK's multi-factor API: a
// time-based one-time password from an authenticator app (decision D-015).
//
// The Authentication emulator implements no one-time passwords, so this file is exercised on
// the staging project only. The components that use it are tested against a fake of
// `SecondFactorApi`, and the decisions it makes are in second-factor-model.ts.
import { multiFactor, TotpMultiFactorGenerator, type User } from "firebase/auth";
import { auth } from "./firebase";
import {
  factorOf,
  type SecondFactorApi,
  SecondFactorError,
  secondFactorFailureOf,
  TOTP_ISSUER,
} from "./second-factor-model";

function signedInUser(): User {
  const user = auth.currentUser;
  if (user === null) throw new SecondFactorError("requires-recent-login");
  return user;
}

async function attempt<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new SecondFactorError(secondFactorFailureOf(error));
  }
}

export const secondFactor: SecondFactorApi = {
  listFactors() {
    const user = auth.currentUser;
    return user === null ? [] : multiFactor(user).enrolledFactors.map(factorOf);
  },

  startTotpEnrolment(accountName) {
    return attempt(async () => {
      const user = signedInUser();
      const session = await multiFactor(user).getSession();
      const secret = await TotpMultiFactorGenerator.generateSecret(session);
      return {
        secretKey: secret.secretKey,
        otpauthUrl: secret.generateQrCodeUrl(accountName, TOTP_ISSUER),
        codeLength: secret.codeLength,
        complete: (code, displayName) =>
          attempt(async () => {
            const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, code);
            await multiFactor(user).enroll(assertion, displayName);
            // The enrolment issues a token that names the factor. Reading it now lets the
            // session, the server and the security rules see it straight away.
            await user.getIdToken(true);
          }),
      };
    });
  },

  removeFactor(factorUid) {
    return attempt(async () => {
      await multiFactor(signedInUser()).unenroll(factorUid);
    });
  },
};
