// The fake mail sender. It delivers nothing: it keeps each message it is given, for a test to
// read, and reproduces what the outbox must survive: an address the provider rejects for good,
// and an outage during which every message waits for its retry. Its state lives in memory for
// unit tests and in a file of the emulator run otherwise. Every address in it is synthetic.
import os from "node:os";
import path from "node:path";
import { type FakeStore, FileStore, MemoryStore } from "../google/fake/store";
import { MailError, type MailSender, type OutgoingMail } from "./types";

export interface MailFakeState {
  schema: 1;
  mode: "up" | "down";
  /** Addresses the provider rejects for good, as for an inbox that does not exist. */
  rejected: string[];
  sent: (OutgoingMail & { id: string })[];
}

export function initialMailState(): MailFakeState {
  return { schema: 1, mode: "up", rejected: [], sent: [] };
}

export class MailFake {
  constructor(private readonly store: FakeStore<MailFakeState>) {}

  setMode(mode: MailFakeState["mode"]): void {
    this.store.transact((state) => {
      state.mode = mode;
    });
  }

  reject(address: string): void {
    this.store.transact((state) => {
      state.rejected.push(address.toLowerCase());
    });
  }

  sent(): (OutgoingMail & { id: string })[] {
    return this.store.transact((state) => [...state.sent]);
  }

  sender(): MailSender {
    return {
      send: async (message) => {
        const answer = this.store.transact((state): string | MailError => {
          if (state.mode === "down") return new MailError("unavailable", "The mail provider did not answer.");
          if (state.rejected.includes(message.to.toLowerCase())) {
            return new MailError("rejected", "The mail provider rejected the address.");
          }
          const id = `fake-${state.sent.length + 1}`;
          state.sent.push({ ...message, id });
          return id;
        });
        if (answer instanceof MailError) throw answer;
        return answer;
      },
    };
  }
}

export function memoryMailFake(): MailFake {
  return new MailFake(new MemoryStore(initialMailState()));
}

export function mailFakeStatePath(): string {
  return path.join(os.tmpdir(), "eegml-mail-fake", "state.json");
}

export function emulatorMailFake(): MailFake {
  return new MailFake(new FileStore(mailFakeStatePath(), initialMailState));
}
