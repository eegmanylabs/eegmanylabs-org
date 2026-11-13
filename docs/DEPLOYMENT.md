# #EEGManyLabs Hub: deployment runbook

This runbook is the procedure an administrator follows to take the members' portal from this repository to a staging project and, after explicit approval, to production. It covers the creation of the projects, the service accounts and secrets, point-in-time recovery and scheduled exports, a restore rehearsal against staging, the deployment preflight, the staging deployment, the acceptance scenarios on staging and the production deployment. Each step names the command or script, who runs it, who approves it and how it is rolled back.

Nothing in this runbook has been run. No Firebase or Google Cloud project exists for the portal, every identifier in `portal/ops/environments.mjs` and `portal/.firebaserc` is a placeholder, and the `gcloud` and Firebase commands follow the vendor documentation of November 2026 without having been tried against a real project. The procedures it calls are in `portal/ops/`, and `portal/ops/README.md` describes them file by file. The decisions it depends on are listed at the end of `docs/DECISIONS.md` and cited here as decision 1 to decision 8. The security reasoning behind each step is in `docs/SECURITY.md`.

The public website's own deployment, `.github/workflows/deploy.yml`, is separate from this runbook and is left unchanged (D-004). Opening a pull request from a branch of this repository redeploys the shared staging site of the public website, and merging it redeploys the public production site; with the portal gate closed both are content-neutral for the public site.

## Roles

| Role | Who | What the role does in this runbook |
|---|---|---|
| Programme administrator | One of the programme's administrators (D-001) | Takes the decisions, approves each step that creates, changes or deletes a project resource, and gives the written approval for production |
| Second programme administrator | Another programme administrator | Countersigns the production approval and every step marked as needing two administrators |
| Operator | A person the programme administrators name, with the Owner role on the project during set-up and the role `roles/iam.serviceAccountUser` on the runtime account afterwards (the `--deployer` of step 3) | Runs the commands from a trusted machine, with `gcloud` signed in as themselves and no service-account key |
| Repository administrator | An administrator of the GitHub organisation | Reviews the pull requests of step 2, creates the protected publishing workflow and its environment, and configures the Pages site and custom domain |
| Billing account owner | Named under decision 1 | Links the billing account and sets the budget alerts |
| DNS account holder | The holder of the DNS account of the programme's domains | Adds the record of the portal address under decision 4 |

For production, the operator and the approver of a step are two different people, and the procedures refuse a production plan until `portal/ops/environments.mjs` lists at least two approvers. For staging, the programme lead decided on 13 November 2026 that one person may act as both until a second administrator is named; the printed plan and the operations log record that single-person approval (`docs/DECISIONS.md`, "Answers given on 13 November 2026"). A step is approved before it is executed: the operator first prints the plan, the approver reads it, and only then does the operator run it with `--execute`.

## How every procedure behaves

Every script in `portal/ops/` acts on one project that the operator names in full, and is run from `portal/`.

```bash
node ops/<procedure>.mjs --environment <staging|production> --project <identifier> [options]            # prints the plan
node ops/<procedure>.mjs --environment <staging|production> --project <identifier> [options] --execute  # prints, asks, runs
```

A procedure refuses to start without `--project`, and refuses a placeholder, a demonstration project, the project of the other environment and a project whose name marks another environment. With `--execute` it runs nothing until the operator has typed the project identifier again at an interactive terminal. A command that creates something that may exist already is skipped when a read-only check finds it, so an interrupted procedure can be run again. When a command fails the procedure stops, and only the clean-up commands that the plan marks as running after a failure still run. The Firebase command-line tools always run through `scripts/fb.sh` at the version that `package.json` pins. These refusals are tested in `portal/tests/architecture/operations.test.ts`.

The plan that a procedure prints is the record of what is approved. The operator keeps it, with the date, the commit and the name of the approver, in the programme's private operations log, which lives outside this public repository.

## Summary of the steps

| Step | What | Environment | Approval before it runs |
|---|---|---|---|
| 0 | Decisions and prerequisites | Both | Programme administrators (decisions 1 to 5) |
| 1 | Create the projects | Staging, then production | Programme administrator, and the billing account owner |
| 2 | Name the projects in the repository and in local configuration | Both | Repository administrator reviews the pull request, a programme administrator confirms the identifiers |
| 3 | Service accounts and secrets | Staging, then production | Programme administrator |
| 4 | Point-in-time recovery, scheduled backups and exports | Staging, then production | Programme administrator, and a second for production because the ledger bucket is locked |
| 5 | Restore rehearsal: emulators, then the staging scratch project | Staging | Programme administrator |
| 6 | Deployment preflight | Staging | None: it contacts no project |
| 7 | Deploy the staging back end | Staging | Programme administrator |
| 8 | Publish the staging site and prepare sign-in | Staging | Programme administrator, repository administrator |
| 9 | Acceptance scenarios and the second restore rehearsal on staging | Staging | Programme administrator records the result |
| 10 | Written approval for production | Production | Two programme administrators |
| 11 | Deploy production | Production | The approval of step 10 |

## Step 0. Decisions and prerequisites

The programme administrators take decisions 1 to 5 of `docs/DECISIONS.md` before step 1: the billing account on the Blaze plan with Identity Platform, London (`europe-west2`) as the permanent location, acceptance of sign-in data processed in the United States by Firebase Authentication, the portal address, and the security posture of GitHub Pages. They also name the operator and agree the retention periods proposed in `BACKUP_RETENTION` of `portal/ops/environments.mjs` (managed exports 98 days, daily backups 7 days, weekly backups 14 weeks, governance ledger 10 years).

The operator's machine has Node 22 or later, Java 21, the Google Cloud command-line tools signed in as the operator (`gcloud auth login` and `gcloud auth application-default login`), and a clean checkout of the commit that will be deployed. From `portal/`:

```bash
npm ci
npm run typecheck
npm run lint
npm test
```

All four must pass before step 1. `npm test` ends with the emulator restore rehearsal of step 5.

Rollback: nothing is created in this step.

## Step 1. Create the projects

Four projects are created: the staging project, its scratch project for restore rehearsals, the production project and its scratch project (D-017). Staging holds synthetic data only and never a copy of production personal data. These commands sit outside the scripts of `portal/ops/`, follow the vendor documentation and are unverified.

| Command | Who runs it | Who approves it |
|---|---|---|
| `gcloud projects create <project> --organization=<organisation>` for each of the four projects | Operator | Programme administrator |
| `gcloud billing projects link <project> --billing-account=<account>` for each | Billing account owner or operator | Billing account owner, with budget alerts set in the billing console |
| `scripts/fb.sh projects:addfirebase <project>` for the staging and production projects | Operator | Programme administrator |
| `gcloud firestore databases create --location=europe-west2 --project=<project>` for each of the four | Operator | Programme administrator. The location is permanent |
| In the Firebase console: upgrade Authentication to Identity Platform, enable the email link sign-in method, enable time-based one-time passwords as a second factor, and start Cloud Storage in `europe-west2` | Operator | Programme administrator |
| In the Firebase console, App Check: register the web application with a reCAPTCHA Enterprise key, with enforcement left off for every product | Operator | Programme administrator |

Where the organisation can enforce the policy `iam.automaticIamGrantsForDefaultServiceAccounts`, the operator asks for it before the projects are created, so that the default compute account never receives the editor role. Step 3 removes that role in any case.

Rollback: `gcloud projects delete <project>` shuts a project down, and `gcloud projects undelete <project>` restores it within 30 days. A database created in the wrong location cannot be moved, so the remedy is a new project.

## Step 2. Name the projects in the repository and in local configuration

The real identifiers replace the placeholders in a pull request that changes `portal/ops/environments.mjs` (project, backup bucket, Storage bucket, scratch project and site origin of each environment) and `portal/.firebaserc` (the `staging` and `production` aliases). A Storage bucket made since October 2024 is `<project>.firebasestorage.app`, an older one `<project>.appspot.com`. The identifiers are not secret, and the repository is public, so the pull request contains nothing else.

Three kinds of file are written on the operator's machine only, and git ignores them:

| File | What it holds |
|---|---|
| `web/.env.staging.local`, `web/.env.production.local` | The web configuration of each project from the Firebase console (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_APP_ID`), the App Check site key `VITE_APP_CHECK_SITE_KEY`, and `PORTAL_PUBLIC_PATH` (`/` on a domain of its own). `web/.env.example` describes each variable |
| `functions/.env.<project>` | `PORTAL_ORIGINS` (the site origin), `PORTAL_URL` (an address on it) and `ENFORCE_APP_CHECK=false` |
| The private configuration of the tools, `portal/.private/` | The identity hash key for `admin:bootstrap` in step 8, which must equal the value stored in the secret `IDENTITY_HASH_KEY` of the same project |

| Action | Who | Approval |
|---|---|---|
| Open the pull request | Operator | A repository administrator reviews it and a programme administrator confirms that the identifiers are those created in step 1 |
| Write the local files | Operator | None. They never leave the operator's machine |

The web build then refuses to mix the environments: a staging or production build refuses any emulator setting, a production build refuses the staging and scratch projects and refuses to start without `VITE_APP_CHECK_SITE_KEY`, and a staging build refuses the production project (`web/config/build-config.ts`, tested in `web/config/build-config.test.ts`).

Rollback: revert the pull request and delete the local files.

## Step 3. Service accounts and secrets

`portal/ops/iam-plan.mjs` creates the accounts of the reviewed specification in `portal/ops/service-accounts.mjs`. The runtime account `eegml-functions` is the only one with project roles. The accounts of the integrations hold none, and each secret is bound one by one. The plan creates each secret in `europe-west2` before it binds it, lets the deployer act as the runtime account, and removes the editor role from the default compute account. `--integrations` names only the integrations being switched on; leave it out until an integration is approved.

```bash
node ops/iam-plan.mjs --environment staging --project <staging> --project-number <number> --deployer user:<operator address>
node ops/iam-plan.mjs --environment staging --project <staging> --project-number <number> --deployer user:<operator address> --execute
```

The operator then adds the value of each secret by hand, from a file outside the repository, and deletes the file:

```bash
gcloud secrets versions add IDENTITY_HASH_KEY --data-file=<file> --project=<staging>
```

The same two commands are repeated for production with `--environment production`. The identity hash key of production is generated afresh and never reused from staging.

| Action | Who | Approval |
|---|---|---|
| Print and review the plan | Operator | Programme administrator reads the printed plan |
| Run it with `--execute` and add secret values | Operator | Programme administrator, for each environment |
| Add an integration later (`--integrations github`, `storage` or `google`) | Operator | Programme administrator, once the integration's own conditions in `docs/INTEGRATIONS.md` are met |

Rollback: `gcloud projects remove-iam-policy-binding <project> --member=serviceAccount:<account> --role=<role>` for each binding, `gcloud iam service-accounts delete <account> --project=<project>`, and `gcloud secrets delete <secret> --project=<project>`. Should the default compute account need the editor role again, which nothing in the portal requires, `gcloud projects add-iam-policy-binding` restores it.

## Step 4. Point-in-time recovery, scheduled backups and exports

`portal/ops/backup-setup.mjs` enables the services it uses, creates the backup bucket in `europe-west2` with uniform access, public access prevention and the 98-day lifecycle rule of `portal/ops/backup-lifecycle.json`, enables point-in-time recovery, creates a daily backup schedule kept 7 days and a weekly one kept 14 weeks, creates the export account and a nightly managed export at 01:17 London time through Cloud Scheduler, gives the Storage Transfer agent access and starts a daily copy of the files of pages, and creates the log bucket and sink of the governance ledger, then locks that bucket.

```bash
node ops/backup-setup.mjs --environment staging --project <staging> --project-number <number>
node ops/backup-setup.mjs --environment staging --project <staging> --project-number <number> --execute
```

Authentication accounts are no part of these copies. After the first members exist, the operator exports them by hand into the backup bucket, because the file holds every member's address:

```bash
scripts/fb.sh auth:export <file outside the repository> --project <project>
gcloud storage cp <file> gs://<backup bucket>/auth/
```

The same is repeated for production.

| Action | Who | Approval |
|---|---|---|
| Staging | Operator | Programme administrator |
| Production | Operator | Two programme administrators, because the lock of the ledger bucket cannot be undone and the bucket keeps its entries for 10 years |

Rollback: `gcloud firestore databases update --database='(default)' --no-enable-pitr --project=<project>`, `gcloud firestore backups schedules delete --database='(default)' --backup-schedule=<schedule> --project=<project>`, `gcloud scheduler jobs delete <job> --location=europe-west2 --project=<project>`, `gcloud transfer jobs delete <job> --project=<project>` and `gcloud logging sinks delete eegml-governance-ledger --project=<project>`. The locked ledger bucket cannot be unlocked, shortened or deleted before its entries reach their retention. The procedure stops before the lock if an earlier command fails, so a failed staging run can be cleaned up and repeated.

## Step 5. Restore rehearsal

The rehearsal runs twice before staging is approved: once on the emulators, and once against staging through its scratch project.

**On the emulators.** `npm run restore:rehearse` runs three emulator sessions. The first seeds the demonstration world, a page with a Yjs update, an uploaded file, a further account and a grant of special-category data, and exports. The second starts from that export, erases a person and revokes the grant after the backup moment, and writes both to a governance ledger. The third starts from the export again, compares every document, account and object with a manifest of paths and SHA-256 hashes, asks the rules as a browser would, damages three items on purpose to show that the comparison names exactly those, and runs `governance:replay` to show that the erasure and the revocation are applied again. The dated report is written under `.run/<port base>/restore-rehearsal/<time>/report.md`, outside the repository. This rehearsal is the last step of `npm test` and needs no approval.

**Against staging.** `portal/ops/restore-scratch.mjs` exports the governance ledger, exports the chosen minute from point-in-time recovery, clones the same minute into a temporary second database of the staging project as the reference, lets the scratch project read that one export, imports it into the scratch project, copies the latest daily copy of the files, deploys the rules of this repository to the scratch project, compares the two with the `backup:manifest` and `backup:compare` tools, files included, and applies the governance ledger to the restored copy. At the end, even after a failure, it deletes the clone, takes back the read access, and deletes the restored database and files from the scratch project.

```bash
node ops/restore-scratch.mjs --environment staging --project <staging> --scratch-project <staging scratch> \
  --scratch-project-number <number> --snapshot-time 2026-12-01T09:00:00Z
```

The snapshot time is a whole minute in UTC, within the last 7 days and after point-in-time recovery was enabled. The work directory defaults to a new directory in the system's temporary directory and is refused inside the repository; it holds the ledger export and two manifests, which list every document path, and is deleted once the result has been recorded.

Before step 7 the staging database holds little, so this first run proves the mechanics: the export, the import, the clone, the access of the scratch project and the clean-up. Step 9 repeats it once the acceptance scenarios have filled staging with synthetic records, and that second run is the evidence for acceptance scenario AS-16.

| Action | Who | Approval |
|---|---|---|
| Emulator rehearsal | Operator | None. Its report is attached to the record of step 9 |
| Staging rehearsal | Operator | Programme administrator, because the procedure writes a temporary clone into the staging project |

Rollback: the procedure cleans up after itself. Should the clean-up itself fail, the operator runs the clean-up commands that the plan prints at its end, in order, and checks with `gcloud firestore databases list --project=<staging>` that no `restore-reference` database remains.

## Step 6. Deployment preflight

The preflight contacts no project. It compiles the rules on the local emulators under a separate project identifier, checks the indexes against the query catalogue, every secret the code names against the specification, the deployment configuration `firebase.deploy.json`, the package of the functions, the service account every function names and the parameters in `functions/.env.<project>`. It builds the static files into `web/out/staging`, scans every file apart from typefaces and images for emulator hosts, test accounts, demonstration fixtures, email addresses, secret-shaped strings, plain HTTP endpoints, source maps and environment files, and checks the Content-Security-Policy, App Check and the region. When every item passes it writes the SHA-256 of every file to `web/out/staging.sha256.json`.

```bash
npm run functions:package
npm run deploy:check:staging
```

It prints a checklist and exits with status 1 on any failure. While the identifiers are placeholders, the first item, the build and the parameters fail, which is the expected state today.

Who runs it: the operator. Approval: none, since it changes nothing outside the operator's machine. Rollback: none needed; `web/out/` and `.run/deploy/` can be deleted.

## Step 7. Deploy the staging back end

`portal/ops/deploy-plan.mjs` packages the functions, runs the preflight and the full test suite, deploys the Firestore rules, indexes and Storage rules, then the functions, all in `europe-west2` and running as `eegml-functions`, and last checks that the static files to publish are those the preflight scanned.

```bash
node ops/deploy-plan.mjs --environment staging --project <staging>
node ops/deploy-plan.mjs --environment staging --project <staging> --execute
```

| Action | Who | Approval |
|---|---|---|
| Print and review the plan | Operator | Programme administrator reads the plan and the preflight checklist |
| Run it | Operator | Programme administrator |

Rollback: check out the previously deployed commit and run the same plan, which deploys its rules, indexes and functions. A function that the new commit added and the old one lacks is removed with `scripts/fb.sh functions:delete <name> --region europe-west2 --project <staging>`. Indexes are only added by a deployment; an index the old commit lacks is removed in the console once nothing uses it.

## Step 8. Publish the staging site and prepare sign-in

The static files of `web/out/staging` reach GitHub Pages through a protected, manually started workflow that waits for a named reviewer (`docs/SECURITY.md`, section 8). That workflow is not in the repository. A repository administrator creates the protected environment first and then adds the workflow, because GitHub creates an unprotected environment for any workflow that names a missing one. The workflow runs `npm run deploy:artefact:verify -- --environment staging` before it publishes, so that a build made later, with other variables or from another commit, is refused.

Before anyone signs in, the operator completes the configuration of the project:

| Action | Command or place | Who | Approval |
|---|---|---|---|
| Add the staging site origin to the authorised domains of Authentication | Firebase console, Authentication, Settings | Operator | Programme administrator |
| Allow the site origin to read the files of pages from the Storage bucket (CORS for `GET`) | `gcloud storage buckets update gs://<bucket> --cors-file=<file>`. No CORS file exists in the repository yet; it is to be added to `portal/ops/` and reviewed before this step | Operator | Programme administrator |
| Bootstrap the first programme administrator of staging | `npm run --silent -w @eegml/tools cli -- admin:bootstrap --email <address> --production --project <staging>`, outside the emulator wrapper, with the identity hash key of step 2 in the environment | Operator | Programme administrator whose address is used |
| Configure the custom domain, if decision 4 chose one | Pages settings, then the DNS record, then "Enforce HTTPS" | Repository administrator and DNS account holder | Programme administrator |

The seed tools refuse any target that is not an emulator, and so does `seed:lookups`. The lookup data that the portal relies on (status definitions, count categories and the onboarding checklist template) therefore needs either a reviewed `--production --project` mode for `seed:lookups` or entry by hand on staging. This gap has to be closed before step 9.

Rollback: run the publishing workflow on the previously published commit, or switch Pages off for the staging site. Remove the authorised domain and the CORS rule if the site is withdrawn.

## Step 9. Acceptance scenarios on staging

Staging holds synthetic records only, created through the portal by test accounts that the programme administrator invites; no real source data is imported into staging. The browser suite of `npm test` runs against the emulators and has no staging mode, so the scenarios on staging are walked through by hand from `docs/REQUIREMENTS_CHECKLIST.md`, section 20, and each result is recorded in `docs/TEST_REPORT.md` with the date, the commit and the tester.

| Scenarios | What staging needs |
|---|---|
| AS-1, AS-2, AS-4, AS-5, AS-6, AS-7, AS-12 | Synthetic test accounts and records only |
| AS-8 | A synthetic dataset registration. A metadata scan needs an approved storage server (R11.5) |
| AS-11 | Repeated imports of synthetic fixtures, if the administrators decide that staging receives them |
| AS-3, AS-9, AS-10 | A Google service account and an approved test spreadsheet and shared drive (decision 7) |
| AS-13 | A credential limited to pull requests on a test copy of the website repository |
| AS-14 | A Quire export |
| AS-15 | Faults are injected only through the fakes; on staging the health pages are checked after a deliberate outage of a test endpoint |
| AS-16 | The second run of the staging restore rehearsal of step 5, after the scenarios above |

The checks that only a real project can settle are repeated in the same pass, as `portal/README.md`, "What has not been verified", lists them: enrolment and challenge of a one-time-password factor and the second-factor claim of the resulting token, an account created by email link enrolling a factor, the acting identity in audit trigger entries, the origin restriction of callable functions, the Content-Security-Policy against the production hosts, the behaviour of an open listener when an account is suspended, the composite indexes in use, and the files of pages read through the CORS rule. App Check metrics are watched for at least a week. Once the portal's own requests all carry tokens, the operator sets `ENFORCE_APP_CHECK=true` in `functions/.env.<staging>` and deploys the functions again (step 7).

Who runs it: testers named by the programme administrators, with the operator. Approval: a programme administrator signs the record of the results. Rollback: none needed; a failure returns the work to the repository, and steps 6 to 9 are repeated with the fixed commit.

## Step 10. Written approval for production

Production is deployed only with the explicit approval of a programme administrator (R1.12, R21.9), countersigned by a second one. The approval names the commit, refers to the preflight checklist of step 6 and the records of steps 5 and 9 for that commit, and states which integrations are switched on. It is given in writing in the programme's private operations log. A commit that differs from the one that passed on staging needs a new pass of steps 6, 7 and 9 on staging first.

## Step 11. Deploy production

With the approval of step 10, the operator repeats steps 6 to 8 for production with the same commit:

```bash
npm run functions:package
npm run deploy:check:production
node ops/deploy-plan.mjs --environment production --project <production>
node ops/deploy-plan.mjs --environment production --project <production> --execute
```

The production plan refuses the staging project, and the production build refuses to start without the App Check site key. The static files of `web/out/production` are published through the protected workflow after `npm run deploy:artefact:verify -- --environment production`. The first programme administrators are bootstrapped with `admin:bootstrap` as in step 8, against production. App Check enforcement follows the same observation period as on staging. The redirect page at `eegmanylabs.org/portal` is added to the public site as the last step of the rollout (D-002), through the public site's own release route.

| Action | Who | Approval |
|---|---|---|
| Preflight and plan | Operator | Recorded in step 10 |
| Back-end deployment | Operator | Step 10 |
| Publication of the static files | Repository administrator, as the named reviewer of the protected environment | Step 10 |
| Redirect from the public site | Maintainer of the public site | Programme administrator |

Rollback: the previously deployed commit is deployed again through `deploy-plan.mjs` and the publishing workflow, as in steps 7 and 8. Data is never rolled back by a redeployment. A recovery of data is a separate decision of the programme administrators, rehearsed first in the scratch project and then carried out with `node ops/restore-live.mjs --environment production --project <production> --snapshot-time <minute>`, which exports the governance ledger, restores the minute and applies the ledger again (`portal/ops/README.md`, "Restoring the live project").

## After deployment

A restore is rehearsed in the scratch project each quarter, and the access review of `/admin/governance` is attested each quarter by the programme administrators. Retention sweeps delete nothing until the administrators set a period for each target. Every secret, binding and integration added later goes through step 3 with its own approval.
