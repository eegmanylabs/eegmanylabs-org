// defineCallable: the one way a callable function is declared.
//
// It fixes the region and the origins that may call, requires a signed-in caller unless told
// otherwise, refuses suspended accounts and ended sessions, validates the input and the output
// against the contract in @eegml/shared, and turns every failure into an error that is safe to
// send to a browser.
import type { AccessDoc, CallableContract, CallableInput, CallableOutput } from "@eegml/shared";
import { accountStanding, FUNCTIONS_REGION, isFirestoreTimestamp, normaliseDisplayName, paths } from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import { logger as functionsLogger } from "firebase-functions";
import { type CallableFunction, onCall } from "firebase-functions/https";
import { defineList } from "firebase-functions/params";
import { firestore } from "./admin";
import { type AuthenticatedContext, type CallableContext, type Clock, type Logger, systemClock } from "./context";
import {
  ACCOUNT_SUSPENDED_MESSAGE,
  AppError,
  INTERNAL_ERROR_MESSAGE,
  INVALID_REQUEST_MESSAGE,
  publicError,
  SESSION_ENDED_MESSAGE,
  SIGN_IN_REQUIRED_MESSAGE,
} from "./errors";

interface CommonDefinition {
  /**
   * Refuse calls that carry no valid App Check token. Off by default and always off in the
   * emulator, which cannot issue or verify App Check tokens.
   */
  readonly enforceAppCheck?: boolean;
  /**
   * `active`, the default, refuses a signed-in caller whose account is suspended or whose
   * session has been ended, before the handler runs. `any` lets such a caller through, for the
   * rare function that must serve them. Say why in a comment wherever `any` is used.
   */
  readonly callerStanding?: "active" | "any";
}

/** A function for signed-in callers. This is the default. */
export interface AuthenticatedDefinition<C extends CallableContract> extends CommonDefinition {
  readonly auth?: "required";
  handler(input: ValidatedInput<C>, context: AuthenticatedContext): Promise<CallableOutput<C>>;
}

/** A function that signed-out callers may use. `context.uid` can be null. */
export interface PublicDefinition<C extends CallableContract> extends CommonDefinition {
  readonly auth: "optional";
  handler(input: ValidatedInput<C>, context: CallableContext): Promise<CallableOutput<C>>;
}

export type CallableDefinition<C extends CallableContract> = AuthenticatedDefinition<C> | PublicDefinition<C>;

/** The input as the handler sees it: after validation and any transformation in the schema. */
type ValidatedInput<C extends CallableContract> = ReturnType<C["input"]["parse"]>;

/** The parts of a callable request the pipeline reads. */
export interface IncomingCall {
  readonly data: unknown;
  readonly auth?: {
    readonly uid: string;
    readonly token: {
      readonly email?: string;
      readonly email_verified?: boolean;
      readonly name?: unknown;
      /** When the caller signed in, in seconds since the epoch. */
      readonly auth_time?: unknown;
    };
  };
}

/** What the pipeline needs to know from a caller's access document. */
export type CallerAccess = Pick<AccessDoc, "suspended" | "sessionsValidAfter">;

export interface CallableDependencies {
  readonly db: CallableContext["db"];
  readonly clock: Clock;
  readonly logger: Logger;
  /** Reads the caller's access document. Null when the account has none yet. */
  readAccess(uid: string): Promise<CallerAccess | null>;
}

export function runningInEmulator(env: Record<string, string | undefined> = process.env): boolean {
  return env.FUNCTIONS_EMULATOR === "true";
}

/**
 * Reads `access/{uid}` the way portal/firestore.rules reads it: a missing field counts as
 * "not suspended" and "no boundary", so a document written before a field existed is never
 * the reason an account is locked out or let in.
 */
export async function readCallerAccess(db: Firestore, uid: string): Promise<CallerAccess | null> {
  const snapshot = await db.doc(paths.access(uid)).get();
  if (!snapshot.exists) return null;
  const boundary: unknown = snapshot.get("sessionsValidAfter");
  return {
    suspended: snapshot.get("suspended") === true,
    sessionsValidAfter: isFirestoreTimestamp(boundary) ? boundary : null,
  };
}

/**
 * The whole request pipeline, independent of the Functions runtime so that it can be unit
 * tested: authenticate, check the caller's standing, validate input, run the handler, validate
 * output, map errors.
 */
export async function runCallable<C extends CallableContract>(
  contract: C,
  definition: CallableDefinition<C>,
  call: IncomingCall,
  dependencies: CallableDependencies,
): Promise<CallableOutput<C>> {
  const { logger } = dependencies;
  const uid = call.auth?.uid ?? null;
  const token = call.auth?.token;

  if (definition.auth !== "optional" && uid === null) {
    throw publicError("unauthenticated", SIGN_IN_REQUIRED_MESSAGE);
  }

  if (uid !== null && definition.callerStanding !== "any") {
    let standing: ReturnType<typeof accountStanding>;
    try {
      standing = accountStanding(await dependencies.readAccess(uid), {
        authTimeSeconds: typeof token?.auth_time === "number" ? token.auth_time : null,
      });
    } catch (error) {
      // Without the access document nothing can be authorised: refuse, and say it is our fault.
      logger.error("caller standing could not be read", {
        function: contract.name,
        uid,
        error: describeError(error),
      });
      throw publicError("internal", INTERNAL_ERROR_MESSAGE);
    }
    if (standing !== "active") {
      logger.warn("callable refused", { function: contract.name, uid, standing });
      throw standing === "suspended"
        ? publicError("permission-denied", ACCOUNT_SUSPENDED_MESSAGE)
        : publicError("unauthenticated", SESSION_ENDED_MESSAGE);
    }
  }

  const input = contract.input.safeParse(call.data);
  if (!input.success) {
    // Log where the input was wrong, never what it contained.
    logger.warn("callable input rejected", {
      function: contract.name,
      uid,
      issues: input.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })),
    });
    throw publicError("invalid-argument", INVALID_REQUEST_MESSAGE);
  }

  const context: CallableContext = {
    uid,
    verifiedEmail: token?.email_verified === true && typeof token.email === "string" ? token.email : null,
    selfAssertedName: normaliseDisplayName(token?.name),
    db: dependencies.db,
    clock: dependencies.clock,
    logger,
  };

  let result: unknown;
  try {
    // The check above guarantees a uid whenever the definition requires one.
    result = await (definition.handler as PublicDefinition<C>["handler"])(input.data as ValidatedInput<C>, context);
  } catch (error) {
    if (error instanceof AppError) throw publicError(error.code, error.publicMessage);
    // Everything else is a fault, including an HttpsError that a library raised: its message
    // was not written for the person using the portal.
    logger.error("callable failed", { function: contract.name, uid, error: describeError(error) });
    throw publicError("internal", INTERNAL_ERROR_MESSAGE);
  }

  const output = contract.output.safeParse(result);
  if (!output.success) {
    logger.error("callable produced an invalid result", {
      function: contract.name,
      uid,
      issues: output.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })),
    });
    throw publicError("internal", INTERNAL_ERROR_MESSAGE);
  }
  return output.data as CallableOutput<C>;
}

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { value: String(error) };
}

/**
 * The web origins that may call the functions, for example the address of the portal on GitHub
 * Pages. Set per project when the functions are deployed. With no value, browsers on every
 * origin are refused, so a deployment that forgets it fails closed.
 */
export const PORTAL_ORIGINS = defineList("PORTAL_ORIGINS", {
  default: [],
  description: "Origins of the portal's web application that may call the functions, for example https://portal.example.org",
});

export function defineCallable<C extends CallableContract>(
  contract: C,
  definition: CallableDefinition<C>,
): CallableFunction<CallableInput<C>, Promise<CallableOutput<C>>> {
  const emulated = runningInEmulator();
  return onCall<CallableInput<C>, Promise<CallableOutput<C>>>(
    {
      region: FUNCTIONS_REGION,
      // The emulator serves builds on any local port (PORTAL_PORT_BASE), so it accepts every origin.
      cors: emulated ? true : PORTAL_ORIGINS,
      enforceAppCheck: definition.enforceAppCheck === true && !emulated,
    },
    (request) => {
      const db = firestore();
      return runCallable(contract, definition, request, {
        db,
        clock: systemClock,
        logger: functionsLogger,
        readAccess: (uid) => readCallerAccess(db, uid),
      });
    },
  );
}
