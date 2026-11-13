import { AUTOMATION_SKIP_TEXT, runAutomationRuleContract } from "@eegml/shared";
import { dispatchEvent, plainEvent, rulesInForce } from "../automation/dispatch";
import { AppError, defineCallable, readAccessDocument, requireCapability, writeAudit } from "../framework";

/**
 * Runs an automation rule now (requirement R16.10), as its schedule would. Capability:
 * `automations.manage` for the programme. Only a rule of a schedule or of the manual event can
 * run by hand, since every other event is about a record that a write names. The run is logged
 * like every other, and its actions go through the job queue with its retries.
 */
export const runAutomationRule = defineCallable(runAutomationRuleContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const at = context.clock.now();
    const access = await readAccessDocument(db, uid);
    requireCapability(context, access, "automations.manage", "programme");
    const rule = (await rulesInForce(db)).find((candidate) => candidate.id === input.ruleId)?.rule;
    if (rule === undefined) throw new AppError("not-found", "This rule does not exist.");
    const event = rule.triggerConfig.event;
    if (event !== "manual" && !event.startsWith("schedule.")) {
      throw new AppError("failed-precondition", "Only a rule of a schedule or a manual rule can be run by hand.");
    }
    const eventId = `manual:${input.ruleId}:${at.getTime()}`;
    await db.runTransaction(async (transaction) => {
      writeAudit(
        transaction,
        {
          action: "automationRule.run",
          actor: { kind: "user", uid },
          entityType: "automationRule",
          entityId: input.ruleId,
          changes: [{ field: "eventId", after: eventId }],
          at,
        },
        db,
      );
    });
    const result = await dispatchEvent(
      db,
      { ...plainEvent(event, eventId) },
      { entityType: null, entityId: null },
      at,
      { onlyRule: input.ruleId },
    );
    const queued = result.queued[0];
    if (queued !== undefined) return { runId: queued, status: "queued" as const, reason: "The actions are queued." };
    const skipped = result.skipped[0];
    return {
      runId: skipped ?? eventId,
      status: "skipped" as const,
      reason: rule.enabled ? AUTOMATION_SKIP_TEXT.conditions : AUTOMATION_SKIP_TEXT.disabled,
    };
  },
});
