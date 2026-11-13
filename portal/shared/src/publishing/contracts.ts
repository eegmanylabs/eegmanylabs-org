// Contracts of the callable functions of public website publishing (requirements R14.1 to
// R14.5, docs/INTEGRATIONS.md, section 6). The conventions of callables.ts hold.
//
// | Function                      | Capability, for the programme                       | Does |
// |-------------------------------|-----------------------------------------------------|------|
// | `preparePublication`          | `publishing.prepare`                                | Assembles the approved public fields into files and compares them with the website's main branch: the preview |
// | `approvePublication`          | `publishing.approve`, with a second factor          | Approves the live write of a verified export: a branch, a commit and a pull request through the website adapter |
// | `refreshPublication`          | `publishing.prepare`                                | Reads the state of the pull request of an export, or of its rollback, again |
// | `withdrawPublication`         | `publishing.prepare`                                | Withdraws an export that is not published, and closes its pull request |
// | `proposePublicationRollback`  | `publishing.approve`, with a second factor          | Opens a pull request that restores the files a published export replaced |
//
// Staging verification is no callable function: the site's build command runs in a scratch copy
// of the repository from a trusted environment, with `npm run publish:verify`, which records its
// report on the batch.
import type { CallableContract } from "../callables";
import { idSchema } from "../schemas/base";
import { publicationBatchStatusSchema } from "../schemas/provenance";
import { z } from "../zod";
import { PUBLIC_OUTPUT_KEYS, type PublicOutput } from "./generate";

const outputSchema = z.enum(PUBLIC_OUTPUT_KEYS as [PublicOutput, ...PublicOutput[]]);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, { error: "Expected a SHA-256 hash in hexadecimal" });

export const preparePublicationContract = {
  name: "preparePublication",
  input: z.strictObject({
    outputs: z
      .array(outputSchema)
      .min(1)
      .max(PUBLIC_OUTPUT_KEYS.length)
      .refine((outputs) => new Set(outputs).size === outputs.length, { error: "Each output is named once" }),
  }),
  output: z.strictObject({ batchId: idSchema, filesChanged: z.number().int().min(0) }),
} as const satisfies CallableContract;

export const approvePublicationContract = {
  name: "approvePublication",
  input: z.strictObject({
    batchId: idSchema,
    /** The hash of the files the approver saw, which must be the files that were verified. */
    payloadSha256: sha256Schema,
  }),
  output: z.strictObject({ pullRequestUrl: z.url(), pullRequestNumber: z.number().int().min(1) }),
} as const satisfies CallableContract;

export const refreshPublicationContract = {
  name: "refreshPublication",
  input: z.strictObject({ batchId: idSchema }),
  output: z.strictObject({ status: publicationBatchStatusSchema }),
} as const satisfies CallableContract;

export const withdrawPublicationContract = {
  name: "withdrawPublication",
  input: z.strictObject({ batchId: idSchema, reason: z.string().trim().min(1).max(500) }),
  output: z.strictObject({ status: publicationBatchStatusSchema }),
} as const satisfies CallableContract;

export const proposePublicationRollbackContract = {
  name: "proposePublicationRollback",
  input: z.strictObject({ batchId: idSchema, reason: z.string().trim().min(1).max(500) }),
  output: z.strictObject({ pullRequestUrl: z.url(), pullRequestNumber: z.number().int().min(1) }),
} as const satisfies CallableContract;
