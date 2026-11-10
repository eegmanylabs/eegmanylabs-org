import { describe, expect, it } from "vitest";
import { auditEventId } from "./audit";

describe("auditEventId", () => {
  it("always gives the same identifier for the same key", () => {
    expect(auditEventId("account.created:uid-1")).toBe(auditEventId("account.created:uid-1"));
  });

  it("gives different identifiers for different keys", () => {
    expect(auditEventId("account.created:uid-1")).not.toBe(auditEventId("account.created:uid-2"));
  });

  it("gives an identifier that is valid as a Firestore document identifier", () => {
    expect(auditEventId("any key / with a slash")).toMatch(/^[0-9a-f]{64}$/);
  });
});
