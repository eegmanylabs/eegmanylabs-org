// defineCallable: the one way a callable function is declared.
//
// It fixes the region, requires a signed-in caller unless told otherwise, validates the input
// and the output against the contract in @eegml/shared, and turns every failure into an error
// code that is safe to send to a browser.
import type { CallableContract, CallableInput, CallableOutput } from "@eegml/shared";
import { FUNCTIONS_REGION } from "@eegml/shared";
import { logger as functionsLogger } from "firebase-functions";
import { type CallableFunction, HttpsError, onCall } from "firebase-functions/https";
import { firestore } from "./admin";
import { type AuthenticatedContext, type CallableContext, type Clock, type Logger, systemClock } from "./context";
import { AppError, INTERNAL_ERROR_MESSAGE, INVALID_REQUEST_MESSAGE, SIGN_IN_REQUIRED_MESSAGE } from "./errors";

interface CommonDefinition {
  /**
   * Refuse calls that carry no valid App Check token. Off by default and always off in the
   * emulator, which cannot issue or verify App Check tokens.
   */
  readonly enforceAppCheck?: boolean;
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
    readonly token: { readonly email?: string; readonly email_verified?: boolean; readonly name?: unknown };
  };
}

export interface CallableDependencies {
  readonly db: CallableContext["db"];
  readonly clock: Clock;
  readonly logger: Logger;
}

export function runningInEmulator(env: Record<string, string | undefined> = process.env): boolean {
  return env.FUNCTIONS_EMULATOR === "true";
}

/**
 * The whole request pipeline, independent of the Functions runtime so that it can be unit
 * tested: authenticate, validate input, run the handler, validate output, map errors.
 */
export async function runCallable<C extends CallableContract>(
  contract: C,
  definition: CallableDefinition<C>,
  call: IncomingCall,
  dependencies: CallableDependencies,
): Promise<CallableOutput<C>> {
  const { logger } = dependencies;
  const uid = call.auth?.uid ?? null;

  if (definition.auth !== "optional" && uid === null) {
    throw new HttpsError("unauthenticated", SIGN_IN_REQUIRED_MESSAGE);
  }

  const input = contract.input.safeParse(call.data);
  if (!input.success) {
    // Log where the input was wrong, never what it contained.
    logger.warn("callable input rejected", {
      function: contract.name,
      uid,
      issues: input.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })),
    });
    throw new HttpsError("invalid-argument", INVALID_REQUEST_MESSAGE);
  }

  const token = call.auth?.token;
  const context: CallableContext = {
    uid,
    verifiedEmail: token?.email_verified === true && typeof token.email === "string" ? token.email : null,
    providerDisplayName: typeof token?.name === "string" && token.name.trim() !== "" ? token.name.trim() : null,
    db: dependencies.db,
    clock: dependencies.clock,
    logger,
  };

  let result: unknown;
  try {
    // The check above guarantees a uid whenever the definition requires one.
    result = await (definition.handler as PublicDefinition<C>["handler"])(input.data as ValidatedInput<C>, context);
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof AppError) throw new HttpsError(error.code, error.publicMessage);
    logger.error("callable failed", { function: contract.name, uid, error: describeError(error) });
    throw new HttpsError("internal", INTERNAL_ERROR_MESSAGE);
  }

  const output = contract.output.safeParse(result);
  if (!output.success) {
    logger.error("callable produced an invalid result", {
      function: contract.name,
      uid,
      issues: output.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })),
    });
    throw new HttpsError("internal", INTERNAL_ERROR_MESSAGE);
  }
  return output.data as CallableOutput<C>;
}

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { value: String(error) };
}

export function defineCallable<C extends CallableContract>(
  contract: C,
  definition: CallableDefinition<C>,
): CallableFunction<CallableInput<C>, Promise<CallableOutput<C>>> {
  return onCall<CallableInput<C>, Promise<CallableOutput<C>>>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: definition.enforceAppCheck === true && !runningInEmulator(),
    },
    (request) =>
      runCallable(contract, definition, request, {
        db: firestore(),
        clock: systemClock,
        logger: functionsLogger,
      }),
  );
}
