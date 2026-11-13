// The procedures of ops/ for backups, restores and service accounts. They are never run here:
// these tests call their planning functions with an invented environment and read the commands.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { backupSetupCommands } from "../../ops/backup-setup.mjs";
import { deployCommands } from "../../ops/deploy-plan.mjs";
import {
  BACKUP_RETENTION,
  ENVIRONMENTS,
  isPlaceholder,
  type PortalEnvironment,
  projectRefusal,
  REGION,
} from "../../ops/environments.mjs";
import { iamCommands } from "../../ops/iam-plan.mjs";
import { commandLine, ProcedureRefusal, parseArguments, requireProject } from "../../ops/procedure.mjs";
import { restoreScratchCommands } from "../../ops/restore-scratch.mjs";
import { PORTAL_ROOT, sourceFiles } from "./support";

// Invented identifiers in the shape an administrator would supply. They name no real project.
const INVENTED: PortalEnvironment = {
  ...ENVIRONMENTS.production,
  projectId: "eegml-portal-live",
  backupBucket: "eegml-portal-live-backups",
  scratchProjectId: "eegml-portal-scratch",
};

describe("the environments", () => {
  it("are placeholders until an administrator supplies them", () => {
    for (const environment of Object.values(ENVIRONMENTS)) {
      expect(isPlaceholder(environment.projectId)).toBe(true);
      expect(isPlaceholder(environment.backupBucket)).toBe(true);
      expect(isPlaceholder(environment.scratchProjectId)).toBe(true);
    }
  });

  it("refuse a project of the other environment, a demonstration project and a misnamed one", () => {
    expect(projectRefusal("production", ENVIRONMENTS.staging.projectId)).toMatch(/project of staging/);
    expect(projectRefusal("staging", ENVIRONMENTS.production.projectId)).toMatch(/project of production/);
    expect(projectRefusal("production", "demo-eegml")).toMatch(/demonstration/);
    expect(projectRefusal("production", "eegml-staging-two")).toMatch(/staging/);
    expect(projectRefusal("staging", "eegml-prod")).toMatch(/prod/);
    expect(projectRefusal("production", "eegml-portal-live")).toBeNull();
  });

  it("alias the deployed projects in .firebaserc beside the demonstration project", () => {
    const firebaserc = JSON.parse(readFileSync(path.join(PORTAL_ROOT, ".firebaserc"), "utf8"));
    expect(firebaserc.projects).toEqual({
      default: "demo-eegml",
      staging: ENVIRONMENTS.staging.projectId,
      production: ENVIRONMENTS.production.projectId,
    });
  });
});

describe("a procedure", () => {
  it("refuses to run without an explicit, real project", () => {
    expect(() => requireProject(parseArguments([]).options)).toThrow(ProcedureRefusal);
    expect(() => requireProject(parseArguments(["--project", ENVIRONMENTS.production.projectId]).options)).toThrow(
      /placeholder/,
    );
    expect(() => requireProject(parseArguments(["--project", "demo-eegml"]).options)).toThrow(/demonstration/);
    expect(requireProject(parseArguments(["--project", "eegml-portal-live", "--execute"]).options)).toBe(
      "eegml-portal-live",
    );
  });

  it("asks for a typed confirmation at a terminal before it runs anything", () => {
    const text = readFileSync(path.join(PORTAL_ROOT, "ops", "procedure.mjs"), "utf8");
    expect(text).toMatch(/process\.stdin\.isTTY/);
    expect(text).toMatch(/answer\.trim\(\) !== projectId/);
    expect(text.indexOf('flags.has("execute")')).toBeLessThan(text.indexOf("spawnSync(command.program"));
  });

  it("is named by no workflow, script or test that runs it", () => {
    const runners = sourceFiles().filter(
      (file) =>
        !file.path.startsWith("ops/") &&
        !file.path.endsWith(".md") &&
        /node\s+ops\/(backup-setup|restore-scratch|iam-plan|deploy-plan)/.test(file.text),
    );
    expect(runners.map((file) => file.path)).toEqual([]);
  });
});

describe("the backup procedure", () => {
  const commands = backupSetupCommands(INVENTED, "eegml-portal-live", "123456789").map(commandLine);

  it("keeps the export in a bucket of its own in London, deleted after the stated period", () => {
    expect(commands[0]).toContain(`--location=${REGION}`);
    expect(commands[0]).toContain("gs://eegml-portal-live-backups");
    const lifecycle = JSON.parse(readFileSync(path.join(PORTAL_ROOT, "ops", "backup-lifecycle.json"), "utf8"));
    expect(lifecycle.rule[0].condition.age).toBe(BACKUP_RETENTION.managedExportDays);
  });

  it("enables point-in-time recovery, two backup schedules and a nightly managed export", () => {
    expect(commands.some((line) => line.includes("--enable-pitr"))).toBe(true);
    expect(commands.filter((line) => line.includes("backups schedules create"))).toHaveLength(2);
    expect(commands.some((line) => line.includes("--retention=14w"))).toBe(true);
    const job = commands.find((line) => line.includes("scheduler jobs create")) ?? "";
    expect(job).toContain(`--location=${REGION}`);
    expect(job).toContain(":exportDocuments");
  });

  it("refuses the placeholder environment and a project that is not the environment's", () => {
    expect(() => backupSetupCommands(ENVIRONMENTS.production, "eegml-portal-live", "123456789")).toThrow(
      ProcedureRefusal,
    );
    expect(() => backupSetupCommands(INVENTED, "eegml-other", "123456789")).toThrow(/not the production project/);
  });
});

describe("the restore procedure", () => {
  const request = {
    projectId: "eegml-portal-live",
    scratchProjectId: "eegml-portal-scratch",
    scratchProjectNumber: "987654321",
    snapshotTime: "2026-11-20T09:00:00Z",
  };

  it("restores into the scratch project and compares with a clone of the same moment", () => {
    const commands = restoreScratchCommands(INVENTED, request).map(commandLine);
    expect(commands.some((line) => line.includes("firestore import") && line.includes("eegml-portal-scratch"))).toBe(
      true,
    );
    expect(
      commands.some(
        (line) => line.includes("databases clone") && line.includes("--snapshot-time=2026-11-20T09:00:00Z"),
      ),
    ).toBe(true);
    expect(commands.some((line) => line.includes("backup:compare"))).toBe(true);
    expect(commands.filter((line) => line.includes("import") && line.includes("--project=eegml-portal-live"))).toEqual(
      [],
    );
  });

  it("never writes into the live project and refuses another scratch project", () => {
    expect(() => restoreScratchCommands(INVENTED, { ...request, scratchProjectId: "eegml-portal-live" })).toThrow(
      ProcedureRefusal,
    );
    expect(() => restoreScratchCommands(INVENTED, { ...request, snapshotTime: "yesterday" })).toThrow(/snapshot-time/);
  });
});

describe("the service-account procedure", () => {
  const commands = iamCommands(INVENTED, "eegml-portal-live").map(commandLine);

  it("grants project roles to the runtime account alone and secrets one by one", () => {
    const projectBindings = commands.filter((line) => line.includes("projects add-iam-policy-binding"));
    expect(projectBindings.every((line) => line.includes("eegml-functions@"))).toBe(true);
    expect(commands.some((line) => line.includes("roles/owner") || line.includes("roles/editor"))).toBe(false);
    expect(
      commands
        .filter((line) => line.includes("secretmanager.secretAccessor"))
        .every((line) => line.includes("secrets add-iam-policy-binding")),
    ).toBe(true);
  });
});

describe("the deployment procedure", () => {
  it("runs the preflight and the tests before it deploys rules ahead of functions", () => {
    const commands = deployCommands(INVENTED, "eegml-portal-live").map(commandLine);
    expect(commands[0]).toContain("deploy:check");
    expect(commands[1]).toBe("npm test");
    expect(commands.findIndex((line) => line.includes("firestore:rules"))).toBeLessThan(
      commands.findIndex((line) => line.includes("--only functions")),
    );
    expect(
      commands.every(
        (line) => !line.includes("deploy") || line.includes("eegml-portal-live") || line.includes("deploy:check"),
      ),
    ).toBe(true);
  });

  it("refuses the staging project for production", () => {
    expect(() => deployCommands(INVENTED, ENVIRONMENTS.staging.projectId)).toThrow(/project of staging/);
  });
});

describe("the operations directory", () => {
  it("holds no workflow file that could deploy anything", () => {
    expect(sourceFiles().filter((file) => /\.ya?ml$/.test(file.path))).toEqual([]);
  });
});
