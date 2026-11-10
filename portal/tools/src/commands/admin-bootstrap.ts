// admin:bootstrap --email <address> [--production --project <identifier>] [--config <file>]
//
// Prepares the first programme administrator of a project. A new project has no administrator
// who could grant the first role, so this command stores one record under the keyed hash of an
// address. The first account that signs in with that address, verified, is made a programme
// administrator by the function `sessionStart`, and the record is marked as used.
//
// The address is hashed and forgotten: it is neither stored nor printed, and neither is its
// hash. The key of the hash is the key of the environment, which the functions read from the
// secret store: the private configuration for a real project, the demonstration key for the
// emulators.
import {
  bootstrapAdminId,
  bootstrapAdminPath,
  bootstrapAdminRecordSchema,
  INITIAL_SCHEMA_VERSION,
  systemActor,
  systemWriteContext,
  z,
} from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { connectToEmulators, connectToProject } from "../admin";
import type { Command } from "../command";
import { requireImportTarget, requireRunningEmulators, ToolRefusal } from "../environment";
import { emulatorHashKey } from "../hash-key";
import { DEFAULT_CONFIG_PATH, loadPrivateConfig } from "../import/config";

/** The actor recorded on a bootstrap record. */
export const ADMIN_BOOTSTRAP_ACTOR = systemActor("adminBootstrap");

/**
 * | Outcome   | The record of the address                                         |
 * |-----------|-------------------------------------------------------------------|
 * | `created` | Was written                                                       |
 * | `waiting` | Exists already and has not been used: nothing was written         |
 * | `used`    | Exists already and has made an account an administrator: nothing was written |
 */
export type BootstrapOutcome = "created" | "waiting" | "used";

/** Stores the bootstrap record of an address, unless one exists. Only the keyed hash of the address reaches the database. */
export async function bootstrapAdministrator(
  db: Firestore,
  email: string,
  hashKey: string,
  now: Date = new Date(),
): Promise<BootstrapOutcome> {
  const reference = db.doc(bootstrapAdminPath(bootstrapAdminId(email, hashKey)));
  const timestamp = Timestamp.fromDate(now);
  return db.runTransaction(async (transaction) => {
    const stored = await transaction.get(reference);
    if (stored.exists) return stored.get("usedAt") == null ? "waiting" : "used";
    transaction.create(
      reference,
      bootstrapAdminRecordSchema.parse({
        schemaVersion: INITIAL_SCHEMA_VERSION,
        createdAt: timestamp,
        updatedAt: timestamp,
        createdBy: ADMIN_BOOTSTRAP_ACTOR,
        updatedBy: ADMIN_BOOTSTRAP_ACTOR,
        archivedAt: null,
        writeContext: systemWriteContext(),
        usedAt: null,
        usedBy: null,
      }),
    );
    return "created";
  });
}

const USAGE = "Usage: admin:bootstrap --email <address> [--production --project <identifier>] [--config <file>]";
const VALUE_OPTIONS = ["--email", "--project", "--config"];

const MESSAGES: Record<BootstrapOutcome, string> = {
  created:
    "stored one bootstrap record. The first account that signs in with that address, verified, becomes a programme administrator.",
  waiting: "found a bootstrap record for that address that has not been used yet, and wrote nothing.",
  used: "found a bootstrap record for that address that has been used already, and wrote nothing. Grant further roles in the portal.",
};

export const adminBootstrapCommand: Command = {
  name: "admin:bootstrap",
  summary: "Prepare the first programme administrator: store the keyed hash of an address, never the address.",
  async run(args) {
    const values = new Map<string, string>();
    let production = false;
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index] ?? "";
      if (argument === "--production") production = true;
      else if (VALUE_OPTIONS.includes(argument)) {
        const value = args[index + 1];
        if (value === undefined || value.startsWith("--"))
          throw new ToolRefusal(`${argument} needs a value.\n\n${USAGE}`);
        values.set(argument, value);
        index += 1;
      } else throw new ToolRefusal(USAGE);
    }
    const email = z.email().max(320).safeParse(values.get("--email")?.trim());
    // The refusal never repeats what was typed, because it may be most of an address.
    if (!email.success) throw new ToolRefusal(`--email needs one email address.\n\n${USAGE}`);

    const projectId = values.get("--project");
    const target = requireImportTarget({ production, ...(projectId === undefined ? {} : { projectId }) });
    let db: Firestore;
    let hashKey: string;
    if (target.kind === "production") {
      hashKey = loadPrivateConfig(values.get("--config") ?? DEFAULT_CONFIG_PATH).hashKey;
      db = connectToProject(target.projectId).db;
    } else {
      if (values.has("--config")) {
        throw new ToolRefusal(
          `--config names the key of a real project and is read only together with --production.\n\n${USAGE}`,
        );
      }
      hashKey = emulatorHashKey();
      await requireRunningEmulators(target, process.env, 1_000, ["firestore"]);
      db = connectToEmulators(target).db;
    }
    const outcome = await bootstrapAdministrator(db, email.data, hashKey);
    console.log(
      `admin:bootstrap in ${target.projectId} (${target.kind === "production" ? "a real project" : "emulator"}) ${MESSAGES[outcome]}`,
    );
    console.log("The address was not stored and is not shown.");
    return undefined;
  },
};
