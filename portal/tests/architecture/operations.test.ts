// The procedures of ops/ for backups, restores and service accounts. They are never run here:
// these tests call their planning functions with an invented environment and read the commands.
import { spawnSync } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { backupSetupCommands } from "../../ops/backup-setup.mjs";
import { DEPLOY_CONFIG, deployCommands } from "../../ops/deploy-plan.mjs";
import {
  BACKUP_RETENTION,
  ENVIRONMENTS,
  isPlaceholder,
  type PortalEnvironment,
  projectRefusal,
  REGION,
} from "../../ops/environments.mjs";
import { iamCommands } from "../../ops/iam-plan.mjs";
import {
  approvalLines,
  approvalOf,
  approvalRecord,
  approvalToken,
  approversOf,
  canonicalName,
  carryOut,
  commandLine,
  type PlannedCommand,
  PROGRAMS,
  ProcedureRefusal,
  parseArguments,
  requireApproval,
  requireProject,
  SINGLE_PERSON_STAGING_DECISION,
} from "../../ops/procedure.mjs";
import { restoreLiveCommands } from "../../ops/restore-live.mjs";
import { restoreScratchCommands } from "../../ops/restore-scratch.mjs";
import { PORTAL_ROOT, sourceFiles } from "./support";

// Invented identifiers in the shape an administrator would supply. They name no real project.
const INVENTED: PortalEnvironment = {
  ...ENVIRONMENTS.production,
  projectId: "eegml-portal-live",
  backupBucket: "eegml-portal-live-backups",
  storageBucket: "eegml-portal-live.firebasestorage.app",
  scratchProjectId: "eegml-portal-scratch",
};
const WORK = path.join(os.tmpdir(), "eegml-restore-invented");

describe("the environments", () => {
  it("are placeholders until an administrator supplies them", () => {
    for (const environment of Object.values(ENVIRONMENTS)) {
      expect(isPlaceholder(environment.projectId)).toBe(true);
      expect(isPlaceholder(environment.backupBucket)).toBe(true);
      expect(isPlaceholder(environment.scratchProjectId)).toBe(true);
      expect(isPlaceholder(environment.storageBucket)).toBe(true);
    }
  });

  it("publish production at the address that the programme lead fixed, and keep staging a placeholder", () => {
    // docs/DECISIONS.md, answers of 13 November 2026, decision 4. The project identifiers stay placeholders.
    expect(ENVIRONMENTS.production.siteOrigin).toBe("https://portal.eegmanylabs.org");
    expect(isPlaceholder(ENVIRONMENTS.staging.siteOrigin)).toBe(true);
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
    expect(text.indexOf('flags.has("execute")')).toBeLessThan(text.indexOf("const status = run(command)"));
  });

  it("is named by no workflow, script or test that runs it", () => {
    const runners = sourceFiles().filter(
      (file) =>
        !file.path.startsWith("ops/") &&
        !file.path.endsWith(".md") &&
        /node\s+ops\/(backup-setup|restore-scratch|restore-live|iam-plan|deploy-plan)/.test(file.text),
    );
    expect(runners.map((file) => file.path)).toEqual([]);
  });
});

describe("the approval of a plan", () => {
  // Invented names of people. They name nobody.
  const options = (...argv: string[]) => parseArguments(argv).options;
  const commands = deployCommands(INVENTED, "eegml-portal-live");

  it("accepts one person as operator and approver on staging, as the programme lead decided, and says so in the plan and the record", () => {
    const approval = requireApproval("staging", options("--operator", "Pat Example", "--approver", "pat example"));
    expect(approval).toMatchObject({ singlePerson: true, basis: SINGLE_PERSON_STAGING_DECISION });
    expect(SINGLE_PERSON_STAGING_DECISION).toEqual({
      decidedBy: "programmeLead",
      decidedOn: "2026-11-13",
      reference: "docs/DECISIONS.md, answers of 13 November 2026, deployment roles",
    });
    const lines = approvalLines(approval, "eegml-staging-live", commands).join("\n");
    expect(lines).toContain("Single-person approval");
    expect(lines).toContain("accepted for staging alone");
    expect(lines).toContain("Production still needs a second named approver");
    const record = approvalRecord(approval, "eegml-staging-live", commands);
    expect(record).toEqual({
      environment: "staging",
      projectId: "eegml-staging-live",
      operator: "Pat Example",
      approver: "pat example",
      singlePersonApproval: true,
      basis: SINGLE_PERSON_STAGING_DECISION,
      commands: commands.length,
    });
    expect(lines).toContain(`Record for the operations log: ${JSON.stringify(record)}`);
  });

  it("keeps refusing a single-person approval for production, which needs a second named approver", () => {
    const reviewed = ["Pat Example", "Sam Sample"];
    expect(() =>
      requireApproval("production", options("--operator", "Pat Example", "--approver", "Pat  Example"), reviewed),
    ).toThrow(/production needs a second named approver/);
    const approval = requireApproval(
      "production",
      options("--operator", "Pat Example", "--approver", "Sam Sample"),
      reviewed,
    );
    expect(approval).toMatchObject({ singlePerson: false, basis: null, token: null });
    const lines = approvalLines(approval, "eegml-portal-live", commands).join("\n");
    expect(lines).not.toContain("Single-person");
    expect(approvalRecord(approval, "eegml-portal-live", commands)).toMatchObject({ singlePersonApproval: false });
  });

  it("refuses every production plan while the reviewed list of approvers names fewer than two people", () => {
    expect(approversOf("production")).toEqual([]);
    expect(() =>
      requireApproval("production", options("--operator", "Pat Example", "--approver", "Sam Sample")),
    ).toThrow(/second named approver/);
    // A name that is not on the list is refused, however different from the operator's it is.
    expect(() =>
      requireApproval("production", options("--operator", "Pat Example", "--approver", "Lee Other"), [
        "Pat Example",
        "Sam Sample",
      ]),
    ).toThrow(/second named approver/);
    // Accents, case, spaces and punctuation make no second person.
    expect(canonicalName("Pát-Example.")).toBe(canonicalName("pat example"));
  });

  it("runs a production plan only with the token that the approver printed for that exact plan", async () => {
    const reviewed = ["Pat Example", "Sam Sample"];
    const token = approvalToken("Sam Sample", "eegml-portal-live", commands);
    expect(token).toMatch(/^samsample-[0-9a-f]{20}$/);
    // Another plan, or another approver, gives another token.
    expect(approvalToken("Sam Sample", "eegml-portal-other", commands)).not.toBe(token);
    expect(approvalToken("Pat Example", "eegml-portal-live", commands)).not.toBe(token);
    const without = requireApproval(
      "production",
      options("--operator", "Pat Example", "--approver", "Sam Sample"),
      reviewed,
    );
    await expect(carryOut("eegml-portal-live", commands, new Set(["execute"]), without)).rejects.toThrow(
      /--approval-token/,
    );
    const wrong = requireApproval(
      "production",
      options("--operator", "Pat Example", "--approver", "Sam Sample", "--approval-token", "samsample-0000"),
      reviewed,
    );
    await expect(carryOut("eegml-portal-live", commands, new Set(["execute"]), wrong)).rejects.toThrow(
      /--approval-token/,
    );
    const given = requireApproval(
      "production",
      options("--operator", "Pat Example", "--approver", "Sam Sample", "--approval-token", token),
      reviewed,
    );
    expect(approvalRecord(given, "eegml-portal-live", commands)).toMatchObject({ approvalToken: token });
  });

  it("needs both names to run, refuses an address in their place, and prints a plan without them as unapproved", async () => {
    expect(() => requireApproval("staging", options("--operator", "Pat Example"))).toThrow(/--approver/);
    expect(() =>
      requireApproval("staging", options("--operator", "pat@example.org", "--approver", "pat@example.org")),
    ).toThrow(/name of a person/);
    // Printing alone needs no approval; --execute does, and refuses before it asks for anything.
    expect(approvalOf("staging", parseArguments([]))).toBeNull();
    expect(() => approvalOf("production", parseArguments(["--execute"]))).toThrow(/--operator/);
    expect(approvalLines(null, "eegml-portal-live", commands).join()).toMatch(/not recorded/);
    // The plan is printed with the approval it lacks before anything else happens, and nothing is asked or run.
    await expect(carryOut("eegml-portal-live", commands, new Set(["execute"]), null)).rejects.toThrow(
      /needs a recorded approval/,
    );
    const text = readFileSync(path.join(PORTAL_ROOT, "ops", "procedure.mjs"), "utf8");
    expect(text.indexOf("approvalLines(approval, projectId, commands)")).toBeLessThan(
      text.indexOf("process.stdin.isTTY || !process.stdout.isTTY"),
    );
  });
});

describe("the backup procedure", () => {
  const commands = backupSetupCommands(INVENTED, "eegml-portal-live", "123456789").map(commandLine);

  it("enables the services it uses before anything else", () => {
    expect(commands[0]).toMatch(
      /^gcloud services enable .*cloudscheduler\.googleapis\.com .*storagetransfer\.googleapis\.com/,
    );
  });

  it("lets the Storage Transfer agent read the files and write the copy, and names the bucket of the environment", () => {
    // Joined at run time, so that the source of this test holds no address outside example.org.
    const agent = ["project-123456789", "storage-transfer-service.iam.gserviceaccount.com"].join("@");
    const bindings = commands.filter((line) => line.includes(agent));
    expect(bindings.filter((line) => line.includes("gs://eegml-portal-live.firebasestorage.app"))).toHaveLength(2);
    expect(bindings.filter((line) => line.includes("gs://eegml-portal-live-backups"))).toHaveLength(2);
    expect(commands.find((line) => line.includes("transfer jobs create"))).toContain(
      "gs://eegml-portal-live.firebasestorage.app",
    );
  });

  it("keeps the governance ledger in a locked log bucket of its own", () => {
    expect(commands.some((line) => line.includes("logging buckets create eegml-governance-ledger"))).toBe(true);
    expect(commands.some((line) => line.includes("logging sinks create") && line.includes("governanceLedger"))).toBe(
      true,
    );
    expect(commands.at(-1)).toContain("--locked");
  });

  it("keeps the export in a bucket of its own in London, deleted after the stated period", () => {
    const create = commands.find((line) => line.includes("storage buckets create")) ?? "";
    expect(create).toContain(`--location=${REGION}`);
    expect(create).toContain("gs://eegml-portal-live-backups");
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
    workDirectory: WORK,
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

  it("limits the scratch project's access to the one export, and always takes it back with the clone and the copy", () => {
    const planned = restoreScratchCommands(INVENTED, request);
    const lines = planned.map(commandLine);
    const grant = lines.find((line) => line.includes("add-iam-policy-binding")) ?? "";
    expect(grant).toContain("objects/restore/2026-11-20T090000Z/");
    const cleanUp = planned.filter((command) => command.always === true).map(commandLine);
    expect(
      cleanUp.some(
        (line) => line.includes("remove-iam-policy-binding") && line.includes("restore/2026-11-20T090000Z/"),
      ),
    ).toBe(true);
    expect(
      cleanUp.some((line) => line.includes("databases delete") && line.includes("--project=eegml-portal-live")),
    ).toBe(true);
    expect(
      cleanUp.some((line) => line.includes("databases delete") && line.includes("--project=eegml-portal-scratch")),
    ).toBe(true);
    expect(
      planned.slice(planned.findIndex((command) => command.always === true)).every((command) => command.always),
    ).toBe(true);
  });

  it("compares the files too, keeps the manifests outside the repository and applies the ledger to the copy", () => {
    const planned = restoreScratchCommands(INVENTED, request);
    const manifests = planned.filter((command) => command.args.includes("backup:manifest"));
    expect(manifests.every((command) => command.args.includes("--bucket"))).toBe(true);
    for (const command of manifests) expect(command.args.at(-1)?.startsWith(WORK)).toBe(true);
    expect(planned[0]?.stdoutFile).toBe(path.join(WORK, "governance-ledger.json"));
    const compare = planned.findIndex((command) => command.args.includes("backup:compare"));
    const replay = planned.findIndex((command) => command.args.includes("governance:replay"));
    expect(replay).toBeGreaterThan(compare);
    expect(() =>
      restoreScratchCommands(INVENTED, { ...request, workDirectory: path.join(PORTAL_ROOT, "tmp") }),
    ).toThrow(/inside the repository/);
  });

  it("never writes into the live project and refuses another scratch project", () => {
    expect(() => restoreScratchCommands(INVENTED, { ...request, scratchProjectId: "eegml-portal-live" })).toThrow(
      ProcedureRefusal,
    );
    expect(() => restoreScratchCommands(INVENTED, { ...request, snapshotTime: "yesterday" })).toThrow(/snapshot-time/);
  });
});

describe("the restore of the live project", () => {
  const request = { projectId: "eegml-portal-live", snapshotTime: "2026-11-20T09:00:00Z", workDirectory: WORK };

  it("exports the ledger before the restore and applies it again after", () => {
    const planned = restoreLiveCommands(INVENTED, request);
    const ledger = planned.findIndex((command) => command.stdoutFile !== undefined);
    const restore = planned.findIndex((command) => command.args.includes("import"));
    const replay = planned.findIndex((command) => command.args.includes("governance:replay"));
    expect(ledger).toBe(0);
    expect(restore).toBeGreaterThan(ledger);
    expect(replay).toBeGreaterThan(restore);
    expect(planned[replay]?.args).toEqual(expect.arrayContaining(["--after", "2026-11-20T09:00:00Z", "--production"]));
  });

  it("refuses another project and a moment that is no whole minute", () => {
    expect(() => restoreLiveCommands(INVENTED, { ...request, projectId: "eegml-other" })).toThrow(ProcedureRefusal);
    expect(() => restoreLiveCommands(INVENTED, { ...request, snapshotTime: "now" })).toThrow(/snapshot-time/);
  });
});

describe("the service-account procedure", () => {
  const iamRequest = {
    projectId: "eegml-portal-live",
    projectNumber: "123456789",
    deployer: "user:deployer@example.org",
    integrations: [] as string[],
  };
  const commands = iamCommands(INVENTED, iamRequest).map(commandLine);

  it("creates each secret in London before it binds it, only for the integrations named, and safely twice", () => {
    const planned = iamCommands(INVENTED, iamRequest);
    const create = planned.findIndex((command) =>
      command.args.join(" ").startsWith("secrets create IDENTITY_HASH_KEY"),
    );
    const bind = planned.findIndex((command) =>
      command.args.join(" ").startsWith("secrets add-iam-policy-binding IDENTITY_HASH_KEY"),
    );
    expect(create).toBeGreaterThan(-1);
    expect(create).toBeLessThan(bind);
    expect(commandLine(planned[create] as PlannedCommand)).toContain(`--locations=${REGION}`);
    expect(planned[create]?.unlessSucceeds?.args.slice(0, 2)).toEqual(["secrets", "describe"]);
    expect(commands.some((line) => line.includes("PUBLISHING_GITHUB_TOKEN"))).toBe(false);
    const withGitHub = iamCommands(INVENTED, { ...iamRequest, integrations: ["github"] }).map(commandLine);
    expect(withGitHub.some((line) => line.includes("secrets create PUBLISHING_GITHUB_TOKEN"))).toBe(true);
    expect(
      planned
        .filter((command) => command.args.slice(0, 3).join(" ") === "iam service-accounts create")
        .every((command) => command.unlessSucceeds !== undefined),
    ).toBe(true);
  });

  it("lets the deployer act as the runtime account, gives it the bucket of files, and takes the editor role from the default account", () => {
    expect(
      commands.some(
        (line) => line.includes("roles/iam.serviceAccountUser") && line.includes("user:deployer@example.org"),
      ),
    ).toBe(true);
    expect(
      commands.some(
        (line) =>
          line.includes("gs://eegml-portal-live.firebasestorage.app") && line.includes("roles/storage.objectAdmin"),
      ),
    ).toBe(true);
    expect(commands.at(-1)).toContain("remove-iam-policy-binding");
    expect(commands.at(-1)).toContain(["123456789-compute", "developer.gserviceaccount.com"].join("@"));
    expect(() => iamCommands(INVENTED, { ...iamRequest, deployer: "" })).toThrow(/deployer/);
    expect(() => iamCommands(INVENTED, { ...iamRequest, integrations: ["everything"] })).toThrow(/integrations/);
  });

  it("grants project roles to the runtime account alone and secrets one by one", () => {
    const projectBindings = commands.filter((line) => line.includes("projects add-iam-policy-binding"));
    expect(projectBindings.every((line) => line.includes("eegml-functions@"))).toBe(true);
    expect(
      commands.some(
        (line) =>
          (line.includes("roles/owner") || line.includes("roles/editor")) && line.includes("add-iam-policy-binding"),
      ),
    ).toBe(false);
    expect(
      commands
        .filter((line) => line.includes("secretmanager.secretAccessor"))
        .every((line) => line.includes("secrets add-iam-policy-binding")),
    ).toBe(true);
  });
});

describe("the deployment procedure", () => {
  it("packages the functions, runs the preflight and the tests before it deploys rules ahead of functions", () => {
    const commands = deployCommands(INVENTED, "eegml-portal-live").map(commandLine);
    expect(commands[0]).toBe("npm run functions:package");
    expect(commands[1]).toBe("npm run deploy:check:production");
    expect(commands[2]).toBe("npm test");
    expect(commands.filter((line) => line.startsWith("scripts/fb.sh deploy"))).toHaveLength(2);
    expect(
      commands.filter((line) => line.includes("deploy --config")).every((line) => line.includes(DEPLOY_CONFIG)),
    ).toBe(true);
    expect(commands.at(-1)).toContain("deploy:artefact:verify");
    expect(commands.findIndex((line) => line.includes("firestore:rules"))).toBeLessThan(
      commands.findIndex((line) => line.includes("--only functions")),
    );
    expect(
      commands
        .filter((line) => line.startsWith("scripts/fb.sh deploy"))
        .every((line) => line.includes("eegml-portal-live")),
    ).toBe(true);
  });

  it("refuses the staging project for production", () => {
    expect(() => deployCommands(INVENTED, ENVIRONMENTS.staging.projectId)).toThrow(/project of staging/);
  });
});

describe("every command a plan names", () => {
  const planned: PlannedCommand[] = [
    ...deployCommands(INVENTED, "eegml-portal-live"),
    ...restoreScratchCommands(INVENTED, {
      projectId: "eegml-portal-live",
      scratchProjectId: "eegml-portal-scratch",
      scratchProjectNumber: "987654321",
      snapshotTime: "2026-11-20T09:00:00Z",
      workDirectory: WORK,
    }),
  ];
  const scripts = (
    JSON.parse(readFileSync(path.join(PORTAL_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }
  ).scripts;

  it("runs a program of the repository or an npm script that exists", () => {
    accessSync(PROGRAMS.fb, constants.X_OK);
    for (const command of planned.filter((entry) => entry.program === "npm" && entry.args[0] === "run")) {
      const script = command.args[1] === "--silent" ? null : command.args[1];
      if (script !== null && script !== undefined) expect(Object.keys(scripts)).toContain(script);
    }
    expect(readFileSync(path.join(PORTAL_ROOT, DEPLOY_CONFIG), "utf8")).not.toContain("emulators");
  });

  it.each([
    ["deploy:check:staging", []],
    ["deploy:check:production", ["--dist", "web/out/production"]],
    ["deploy:artefact:verify", ["--environment", "staging"]],
  ])(
    "accepts the arguments the plan gives %s",
    (script, extra) => {
      // The dry run starts no emulator and builds nothing: the script checks its arguments and stops.
      const result = spawnSync("npm", ["run", "--silent", script, ...(extra.length > 0 ? ["--", ...extra] : [])], {
        cwd: PORTAL_ROOT,
        env: { ...process.env, PORTAL_EXEC_DRY_RUN: "1" },
        encoding: "utf8",
      });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/accepts its arguments/);
    },
    60_000,
  );
});

describe("the operations directory", () => {
  it("holds no workflow file that could deploy anything", () => {
    expect(sourceFiles().filter((file) => /\.ya?ml$/.test(file.path))).toEqual([]);
  });
});
