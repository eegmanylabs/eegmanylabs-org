// How the automation pages name events and actions.
import type { AutomationActionKind, AutomationEventKey } from "@eegml/shared";

export const EVENT_LABELS: Readonly<Record<AutomationEventKey, string>> = {
  "dataset.dataArrived": "The data of a dataset first arrives",
  "laboratory.activated": "A laboratory is approved and becomes active",
  "recruitment.targetMet": "The usable participants of a replication reach its target",
  "schedule.daily": "Every day",
  "schedule.weekly": "Every Monday",
  manual: "When an administrator runs it",
};

export const ACTION_LABELS: Readonly<Record<AutomationActionKind, string>> = {
  createOnboardingChecklist: "Create the onboarding checklist",
  createQcTask: "Open a quality-control task",
  notifyLeads: "Tell the leads of the replication",
  generateProgressReport: "Update the progress reports",
  flagOverdueUpdates: "Flag overdue recruitment updates",
};
