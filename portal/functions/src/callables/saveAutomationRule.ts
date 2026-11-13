import {
  AUTOMATION_EVENTS,
  automationRuleDocSchema,
  BUILT_IN_AUTOMATION_RULES,
  COLLECTIONS,
  ruleProblems,
  saveAutomationRuleContract,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  requireCapability,
  touchedFields,
  writeAudit,
} from "../framework";

/**
 * Creates or changes an automation rule (requirement R16.9). Capability: `automations.manage`
 * for the programme. A rule pairs one event of a fixed list with actions of a fixed list, and an
 * action that cannot follow its event is refused. A built-in rule keeps its event and its actions:
 * an administrator switches it off or on and narrows it with conditions or a scope, which a
 * document under its key records. A rule of an administrator's own is archived, never deleted,
 * so the log of its runs keeps its name.
 */
export const saveAutomationRule = defineCallable(saveAutomationRuleContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const at = context.clock.now();
    const access = await readAccessDocument(db, uid);
    requireCapability(context, access, "automations.manage", "programme");
    const builtIn = input.ruleId === undefined ? undefined : BUILT_IN_AUTOMATION_RULES[input.ruleId];
    if (builtIn !== undefined) {
      const sameActions = JSON.stringify(builtIn.actions) === JSON.stringify(input.actions);
      if (builtIn.triggerConfig.event !== input.event || !sameActions) {
        throw new AppError(
          "invalid-argument",
          "A rule that ships with the portal keeps its event and its actions. Switch it off and add a rule of your own instead.",
        );
      }
      if (input.archive === true) {
        throw new AppError("invalid-argument", "A rule that ships with the portal is switched off, not archived.");
      }
    }
    const problems = ruleProblems({
      triggerConfig: { event: input.event },
      actions: input.actions,
      conditions: input.conditions,
    });
    if (problems.length > 0) throw new AppError("invalid-argument", problems.join(" "));

    const collection = db.collection(COLLECTIONS.automationRules.collectionPath());
    const reference = input.ruleId === undefined ? collection.doc() : collection.doc(input.ruleId);
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(reference);
      if (input.ruleId !== undefined && builtIn === undefined && !existing.exists) {
        throw new AppError("not-found", "This rule does not exist.");
      }
      const auditEventId = writeAudit(
        transaction,
        {
          action: "automationRule.saved",
          actor: { kind: "user", uid },
          entityType: "automationRule",
          entityId: reference.id,
          changes: [
            { field: "enabled", after: input.enabled },
            { field: "event", after: input.event },
            { field: "actions", after: input.actions.map((action) => action.kind) },
            ...(input.archive === true ? [{ field: "archivedAt", after: at.toISOString() }] : []),
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      const fields = {
        name: builtIn?.name ?? input.name,
        enabled: input.enabled,
        builtIn: builtIn !== undefined,
        triggerType: AUTOMATION_EVENTS[input.event],
        triggerConfig: { event: input.event },
        conditions: input.conditions,
        actions: builtIn?.actions ?? input.actions,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
      };
      if (existing.exists) {
        transaction.update(reference, {
          ...automationRuleDocSchema
            .pick({
              name: true,
              enabled: true,
              builtIn: true,
              triggerType: true,
              triggerConfig: true,
              conditions: true,
              actions: true,
              scopeType: true,
              scopeId: true,
            })
            .parse(fields),
          ...(input.archive === true ? { archivedAt: Timestamp.fromDate(at) } : {}),
          ...touchedFields(stamp),
        });
      } else {
        transaction.create(
          reference,
          automationRuleDocSchema.parse({
            ...createdFields("automationRules", stamp),
            ...fields,
            ...(input.archive === true ? { archivedAt: Timestamp.fromDate(at) } : {}),
          }),
        );
      }
    });
    return { ruleId: reference.id };
  },
});
