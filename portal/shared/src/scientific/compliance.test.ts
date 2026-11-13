// Synthetic protocol versions, teams and deviations of an invented laboratory.
import { describe, expect, it } from "vitest";
import type { ReplicationProtocolVersionDoc } from "../schemas/replications";
import { currentApprovedVersion, participationCompliance } from "./compliance";
import { at, stamped } from "./test-support";

function version(id: string, status: ReplicationProtocolVersionDoc["status"], approvedIso: string | null) {
  return {
    id,
    ...stamped("2026-01-01T00:00:00Z"),
    replicationId: "SyntheticStudy2001",
    protocolId: "protocol-1",
    versionLabel: id,
    status,
    approvedBy: approvedIso === null ? null : "uid-lead",
    approvedAt: approvedIso === null ? null : at(approvedIso),
  };
}

const participation = { id: "SyntheticStudy2001__lab-1", laboratoryId: "lab-1", protocolId: "protocol-1" };
const team = [
  { personId: "p1", archivedAt: null },
  { personId: "p2", archivedAt: null },
];

describe("currentApprovedVersion", () => {
  it("is the approved version approved last, and never a draft or a superseded one", () => {
    const versions = [
      version("v1", "superseded", "2026-01-01T00:00:00Z"),
      version("v2", "approved", "2026-02-01T00:00:00Z"),
      version("v3", "draft", null),
    ];
    expect(currentApprovedVersion(versions, "protocol-1")?.id).toBe("v2");
    expect(currentApprovedVersion([version("v3", "draft", null)], "protocol-1")).toBeNull();
  });
});

describe("participationCompliance", () => {
  const versions = [version("v2", "approved", "2026-02-01T00:00:00Z")];

  it("waits for the acknowledgement of every member of the team", () => {
    const result = participationCompliance(
      participation,
      versions,
      team,
      [{ personId: "p1", protocolVersionId: "v2" }],
      [],
    );
    expect(result.state).toBe("awaitingAcknowledgement");
    expect(result.awaiting).toEqual(["p2"]);
  });

  it("counts open deviations by severity once everyone has acknowledged", () => {
    const acknowledged = team.map((member) => ({ personId: member.personId, protocolVersionId: "v2" }));
    const deviations = [
      { severity: "major" as const, status: "open" as const, archivedAt: null },
      { severity: "minor" as const, status: "resolved" as const, archivedAt: null },
    ];
    const result = participationCompliance(participation, versions, team, acknowledged, deviations);
    expect(result.state).toBe("openDeviations");
    expect(result.openDeviations).toEqual({ minor: 0, major: 1, critical: 0 });
    expect(participationCompliance(participation, versions, team, acknowledged, []).state).toBe("compliant");
  });

  it("names a laboratory that follows a superseded version, or one with nothing approved", () => {
    expect(participationCompliance({ ...participation, protocolVersionId: "v1" }, versions, team, [], []).state).toBe(
      "outdatedVersion",
    );
    expect(participationCompliance(participation, [], team, [], []).state).toBe("noApprovedVersion");
    expect(participationCompliance({ id: "x", laboratoryId: "lab-1" }, versions, team, [], []).state).toBe(
      "noProtocol",
    );
  });
});
