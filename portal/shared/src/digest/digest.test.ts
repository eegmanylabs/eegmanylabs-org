// Synthetic preferences and notifications; the address of the portal is invented.
import { describe, expect, it } from "vitest";
import { buildDigest, dueDigestPeriod, emailDecision, endOfQuietHours, inQuietHours, isoWeek } from "./digest";

const night = { start: "22:00", end: "07:00", timeZone: "Europe/London" };
const preferences = {
  channels: { inApp: true, email: true },
  digestFrequency: "off" as const,
  quietHours: night,
  typeSwitches: {},
};

describe("quiet hours", () => {
  it("hold a span that passes midnight on the member's own clock", () => {
    // 23:30 in London in November is 23:30 UTC; in June it is 22:30 UTC.
    expect(inQuietHours(new Date("2026-11-12T23:30:00Z"), night)).toBe(true);
    expect(inQuietHours(new Date("2026-06-12T22:30:00Z"), night)).toBe(true);
    expect(inQuietHours(new Date("2026-11-12T12:00:00Z"), night)).toBe(false);
    expect(inQuietHours(new Date("2026-11-12T06:59:00Z"), night)).toBe(true);
  });

  it("end at the first minute after them, and an unknown zone holds none", () => {
    expect(endOfQuietHours(new Date("2026-11-12T23:30:00Z"), night).toISOString()).toBe("2026-11-13T07:00:00.000Z");
    expect(inQuietHours(new Date("2026-11-12T23:30:00Z"), { ...night, timeZone: "Nowhere/Invented" })).toBe(false);
  });
});

describe("the email decision", () => {
  it("sends nothing without saved preferences, with email off or with the type switched off", () => {
    const at = new Date("2026-11-12T12:00:00Z");
    expect(emailDecision(null, "mention", at)).toEqual({ outcome: "none" });
    expect(emailDecision({ ...preferences, channels: { inApp: true, email: false } }, "mention", at)).toEqual({
      outcome: "none",
    });
    expect(emailDecision({ ...preferences, typeSwitches: { mention: false } }, "mention", at)).toEqual({
      outcome: "none",
    });
  });

  it("gathers a notification into the digest, or holds a message to the end of the quiet hours", () => {
    expect(emailDecision({ ...preferences, digestFrequency: "weekly" }, "mention", new Date())).toEqual({
      outcome: "digest",
    });
    expect(emailDecision(preferences, "mention", new Date("2026-11-12T23:30:00Z"))).toEqual({
      outcome: "immediate",
      notBefore: new Date("2026-11-13T07:00:00Z"),
    });
  });
});

describe("digest periods", () => {
  it("name ISO weeks", () => {
    expect(isoWeek("2026-11-12")).toBe("2026-W46");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(isoWeek("2026-01-01")).toBe("2026-W01");
  });

  it("are due each morning for a daily digest and on Monday morning for a weekly one", () => {
    const daily = { ...preferences, digestFrequency: "daily" as const };
    const weekly = { ...preferences, digestFrequency: "weekly" as const };
    expect(dueDigestPeriod(new Date("2026-11-12T06:30:00Z"), daily)).toBeNull();
    expect(dueDigestPeriod(new Date("2026-11-12T08:00:00Z"), daily)).toBe("2026-11-12");
    expect(dueDigestPeriod(new Date("2026-11-12T08:00:00Z"), weekly)).toBeNull();
    expect(dueDigestPeriod(new Date("2026-11-16T08:00:00Z"), weekly)).toBe("2026-W47");
    expect(
      dueDigestPeriod(new Date("2026-11-16T08:00:00Z"), { ...weekly, channels: { inApp: true, email: false } }),
    ).toBeNull();
  });
});

describe("the digest", () => {
  it("lists each notification by its type and record with a link, escapes the markup and counts what it leaves out", () => {
    const items = Array.from({ length: 52 }, (_, index) => ({
      type: "assignment" as const,
      title: index === 0 ? "<Synthetic> task" : `Task ${index}`,
      link: `https://portal.example.org/#/tasks/${index}`,
    }));
    const mail = buildDigest({
      period: "2026-W47",
      frequency: "weekly",
      items,
      portalUrl: "https://portal.example.org/",
    });
    expect(mail.subject).toBe("#EEGManyLabs: your weekly digest for 2026-W47");
    expect(mail.textBody).toContain("Work was assigned to you: <Synthetic> task");
    expect(mail.textBody).toContain("2 more in the portal.");
    expect(mail.htmlBody).toContain("&#60;Synthetic&#62; task");
    expect(mail.htmlBody).not.toContain("<Synthetic>");
  });
});
