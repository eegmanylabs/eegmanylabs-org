// Whether notification email is sent, and which sender serves the outbox.
//
// The programme lead decided on 13 November 2026 that no notification email is sent for now
// (docs/DECISIONS.md, decision 7 of the answers): notifications and digests stay in the portal.
// The parameter `MAIL_DELIVERY` therefore defaults to `disabled` in every project, and
// ops/environments.mjs records the same for staging and production; the deployment preflight
// refuses `enabled` while no mail provider and no mail secret exist. With mail disabled no
// message is queued, no digest is gathered and nothing is sent. Firebase's own sign-in links
// are not sent through here and are unaffected.
//
// The emulator keeps the outbox working against the fake sender, so that the code which will
// send once a provider is chosen stays tested; it never delivers anything.
import { defineString } from "firebase-functions/params";
import { runningInEmulator } from "../../framework";
import { emulatorMailFake } from "./fake";
import type { MailSender } from "./types";

/** The parameter of the functions that switches notification email on, once a provider exists. */
export const MAIL_DELIVERY_PARAMETER = "MAIL_DELIVERY";

let mailDeliveryParameter: ReturnType<typeof defineString> | undefined;

/** Whether notification email is sent: `disabled` unless the project's parameters say `enabled`. */
export function mailDelivery(): "disabled" | "enabled" {
  if (runningInEmulator()) return "enabled";
  mailDeliveryParameter ??= defineString(MAIL_DELIVERY_PARAMETER, {
    default: "disabled",
    description: "Whether notification email is sent: disabled until the programme chooses a mail provider.",
  });
  return mailDeliveryParameter.value().trim() === "enabled" ? "enabled" : "disabled";
}

/** The sender of the outbox, or null where mail is disabled or no provider exists. */
export function mailSender(): MailSender | null {
  if (mailDelivery() === "disabled") return null;
  return runningInEmulator() ? emulatorMailFake().sender() : null;
}
