// Contracts of the callable functions of automations, scheduled reports and demographic
// analysis (requirements R15.7, R15.10, R16.9 and R16.10). The conventions of callables.ts hold.
//
// | Function                    | Capability, for the programme                       | Does |
// |-----------------------------|-----------------------------------------------------|------|
// | `saveAutomationRule`        | `automations.manage`                                | Creates or changes a rule, or switches a built-in rule off or on |
// | `runAutomationRule`         | `automations.manage`                                | Runs a rule of a schedule or of the manual event now, with its run logged |
// | `saveScheduledReport`       | `automations.manage`                                | Creates or changes a scheduled progress report |
// | `getDemographicAggregates`  | `demographics.read`, a named grant and a second factor | Serves counts of a special-category field for a scope, with small cells suppressed and the read audited |
import type { CallableContract } from "../callables";
import { entityTypeSchema } from "../entities";
import { idSchema, keySchema, uidSchema } from "../schemas/base";
import {
  automationActionSchema,
  automationConditionSchema,
  automationEventSchema,
  automationScopeTypeSchema,
  scheduledReportScheduleSchema,
} from "../schemas/system";
import { z } from "../zod";

const nameSchema = z.string().trim().min(1).max(100);

export const saveAutomationRuleContract = {
  name: "saveAutomationRule",
  input: z.strictObject({
    /** Absent for a new rule. The key of a built-in rule changes only `enabled` and `conditions`. */
    ruleId: idSchema.optional(),
    name: nameSchema,
    enabled: z.boolean(),
    event: automationEventSchema,
    conditions: z.array(automationConditionSchema).max(20),
    actions: z.array(automationActionSchema).min(1).max(10),
    scopeType: automationScopeTypeSchema.exclude(["group"]),
    scopeId: idSchema,
    /** True to archive a rule of an administrator's own. A built-in rule is switched off instead. */
    archive: z.boolean().optional(),
  }),
  output: z.strictObject({ ruleId: idSchema }),
} as const satisfies CallableContract;

export const runAutomationRuleContract = {
  name: "runAutomationRule",
  input: z.strictObject({ ruleId: idSchema }),
  output: z.strictObject({ runId: idSchema, status: z.enum(["queued", "skipped"]), reason: z.string().max(500) }),
} as const satisfies CallableContract;

export const saveScheduledReportContract = {
  name: "saveScheduledReport",
  input: z.strictObject({
    reportId: idSchema.optional(),
    name: nameSchema,
    templateKey: keySchema,
    entityType: entityTypeSchema.extract(["programme", "replication", "laboratory"]),
    entityId: idSchema,
    schedule: scheduledReportScheduleSchema,
    recipients: z.array(uidSchema).max(200),
    enabled: z.boolean(),
  }),
  output: z.strictObject({ reportId: idSchema }),
} as const satisfies CallableContract;

/** The special-category fields that may be counted, never read one by one in an analysis. */
export const DEMOGRAPHIC_AGGREGATE_FIELDS = ["genderCategory", "ethnicityCategory"] as const;

export const getDemographicAggregatesContract = {
  name: "getDemographicAggregates",
  input: z.strictObject({
    field: z.enum(DEMOGRAPHIC_AGGREGATE_FIELDS),
    scopeType: z.enum(["programme", "replication", "laboratory"]),
    scopeId: idSchema,
  }),
  output: z.strictObject({
    /** The threshold below which a count is suppressed. */
    threshold: z.number().int().min(1),
    /**
     * The people the scope holds, of whom some may have nothing recorded, or null wherever a
     * group is suppressed or the scope is smaller than the threshold.
     */
    people: z.number().int().min(0).nullable(),
    cells: z
      .array(
        z.strictObject({
          category: z.string().max(100),
          /** Null where the count is suppressed. */
          count: z.number().int().min(0).nullable(),
        }),
      )
      .max(100),
    /** Null where any cell is suppressed. */
    total: z.number().int().min(0).nullable(),
    /**
     * True when nothing is released because the scope differs from an overlapping scope (a
     * laboratory within a replication, a replication sharing laboratories, the programme) by
     * fewer than the threshold of people with a recorded value, so that the difference of the
     * two releases could point at someone.
     */
    overlapWithheld: z.boolean(),
  }),
} as const satisfies CallableContract;
