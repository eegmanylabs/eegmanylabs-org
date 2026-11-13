// The interface through which the portal sends email (docs/INTEGRATIONS.md, section 8). It has
// one operation, so a provider with an HTTP interface and one that speaks SMTP both fit behind
// it. No provider has been chosen, so only the fake exists: under the emulator it delivers
// nothing and keeps what it was given, and in a real project the outbox fills and nothing is
// sent. The outbox is the boundary; everything before it is built and tested.

export interface OutgoingMail {
  readonly to: string;
  readonly subject: string;
  readonly textBody: string;
  readonly htmlBody: string | null;
}

/**
 * | Kind          | Meaning                                                                     |
 * |---------------|-----------------------------------------------------------------------------|
 * | `rejected`    | The provider refused the address or the message for good. Not retried       |
 * | `unavailable` | The provider did not answer, or failed for a while. Retried with backoff    |
 */
export type MailErrorKind = "rejected" | "unavailable";

export class MailError extends Error {
  constructor(
    readonly kind: MailErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "MailError";
  }
}

export interface MailSender {
  /** Sends one message, and answers the provider's identifier of it. */
  send(message: OutgoingMail): Promise<string>;
}
