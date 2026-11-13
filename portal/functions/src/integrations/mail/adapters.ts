// Which sender serves the outbox. In the emulator it is the fake. Elsewhere there is none until
// the administrators choose a provider (decision 7 of docs/DECISIONS.md): messages wait in the
// outbox as queued and nothing is sent. The outbox is not yet listed in the health view.
import { runningInEmulator } from "../../framework";
import { emulatorMailFake } from "./fake";
import type { MailSender } from "./types";

export function mailSender(): MailSender | null {
  return runningInEmulator() ? emulatorMailFake().sender() : null;
}
