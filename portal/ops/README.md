# Operations runbook

Everything in this directory is written and has never been run. No project, bucket or service account exists yet, every identifier in `environments.mjs` is a placeholder (`eegml-staging-PLACEHOLDER`, `eegml-production-PLACEHOLDER` and so on, and the address of the staging site), apart from the address of the production site, `https://portal.eegmanylabs.org`, which the programme lead fixed on 13 November 2026, and the `gcloud` and Firebase flags follow the vendor documentation of November 2026 without having been tried against a real project. Nothing here is named by a workflow file, and nothing here deploys the public website, whose own `.github/workflows/deploy.yml` is left unchanged (D-004).

Every procedure acts on one project that the operator names in full:

```bash
node ops/<procedure>.mjs --environment production --project <identifier> [options]            # prints the commands
node ops/<procedure>.mjs --environment production --project <identifier> [options] \
  --approver "<name>" --approve                                                                 # the approver: prints the token
node ops/<procedure>.mjs --environment production --project <identifier> [options] \
  --operator "<name>" --approver "<name>" --approval-token <token> --execute                   # prints, asks, runs
```

A procedure refuses to start without `--project`, refuses a placeholder, a demonstration project, the project of the other environment and a project named for another environment, and runs nothing until the operator has typed the project identifier again at an interactive terminal. A plan runs only with an approval: `--operator` and `--approver` name the two people, and the printed plan ends with the approval and a one-line record of it for the private operations log. The programme lead decided on 13 November 2026 to act as both operator and approver for now, so on staging one person may be both: the plan then says that it is a single-person approval, accepted for staging alone, and the record notes it with the decision. Production waits for a second administrator. It refuses every plan while the reviewed list `approvers` of the production environment in `environments.mjs` names fewer than two people, which it does until an administrator supplies the names, and then accepts only an operator and an approver who are two different people of that list, compared without case, accents, spaces or punctuation. The approver runs the same plan with `--approver "<name>" --approve`, which runs nothing and prints a token bound to the plan and to their name, and the operator passes it with `--approval-token`; the record for the operations log keeps it. A name typed on a command line identifies nobody, so the token binds the approval to the exact plan and does not prove who ran `--approve` (tested in `tests/architecture/operations.test.ts`). Commands run in `portal/`. A command that creates something that may exist already, such as a service account or a secret, is skipped when a read-only check finds it, so an interrupted procedure can be run again. When a command fails the procedure stops, and only the clean-up commands marked "Runs even when an earlier command failed" still run. The Firebase tools always run through `scripts/fb.sh`, at the version `package.json` pins, never a global install.

| File | What it is |
|---|---|
| `environments.mjs` | The staging and production environments: project, backup bucket, Storage bucket, scratch project for restores, site origin, the reviewed list of production approvers, the region `europe-west2`, the retention of backups and the governance ledger. The web build and the preflight read it as well |
| `service-accounts.mjs` | The reviewed specification of the service account the functions run as, the accounts of the integrations, their roles and the secrets each may read |
| `secret-references.mjs` | Finds every secret the functions code asks for, for the preflight and for `tests/architecture/least-privilege.test.ts` |
| `procedure.mjs` | What every procedure shares: the explicit project, the refusals, the printed plan, the typed confirmation, the skip checks and the clean-up |
| `iam-plan.mjs` | Creates the secrets, then the service accounts with exactly the roles of the specification, lets the deployer act as the runtime account and takes the editor role from the Compute Engine default account |
| `backup-setup.mjs`, `backup-lifecycle.json` | The services, point-in-time recovery, the backup schedules, the nightly managed export, the daily copy of files with the Storage Transfer agent's access, and the locked log bucket of the governance ledger |
| `restore-scratch.mjs` | A restore of a chosen minute into the scratch project, compared with a clone of the same minute, then cleaned up |
| `restore-live.mjs` | A restore of the live database to a chosen minute, followed by the replay of the governance ledger |
| `deploy-plan.mjs` | The deployment of rules, indexes, Storage rules and functions, after the package, the preflight and the tests |

## Before the first deployment

These are decisions and actions of the programme administrators (`docs/DECISIONS.md`, decisions 1 to 8). Until they are taken, the preflight fails, as it should.

1. Create the staging and production projects on the Blaze plan with Identity Platform, in `europe-west2`, and the scratch project for restore rehearsals (D-003, D-017). Prefer an organisation that enforces the policy `iam.automaticIamGrantsForDefaultServiceAccounts`, so that the default compute account never receives the editor role.
2. Replace the placeholders in `environments.mjs` and `.firebaserc` with the real identifiers, the staging site origin and the Storage bucket (`<project>.firebasestorage.app`, or `<project>.appspot.com` for a bucket made before October 2024), in a reviewed pull request.
3. Create the reCAPTCHA Enterprise key for App Check and put the web configuration in `web/.env.production.local` and `web/.env.staging.local`, which git ignores.
4. Write `functions/.env.<project>` for each project, which git ignores: `PORTAL_ORIGINS` (the site origin), `PORTAL_URL` (an address on it) and `ENFORCE_APP_CHECK=false` until App Check has been watched on staging. `MAIL_DELIVERY` is left out or set to `disabled`: by the programme's decision of 13 November 2026 no notification email is sent (`mail: "disabled"` in `ops/environments.mjs`), so no mail provider or mail secret is created, and the preflight accepts their absence and refuses `enabled`.
5. Run `node ops/iam-plan.mjs --environment staging --project <id> --project-number <number> --deployer user:<address>`, with `--integrations github,storage,google` for the integrations being switched on, and review its output before anyone runs it with `--execute`. It creates each secret in `europe-west2` before binding it; add each secret's value by hand afterwards with `gcloud secrets versions add`.
6. Run `node ops/backup-setup.mjs --environment staging --project <id> --project-number <number>`.
7. Run `npm run functions:package`, then `npm run deploy:check:staging` until every item passes, then `node ops/deploy-plan.mjs --environment staging --project <id>`.

## The order of a deployment

1. `npm run functions:package`: the package that is uploaded, with no workspace package in it.
2. `npm run deploy:check:<environment>`: every item passes. It builds the static files into `web/out/<environment>`, scans every one of them and writes their SHA-256 to `web/out/<environment>.sha256.json`.
3. `npm test` at the commit that is deployed: every test passes.
4. Rules, indexes and Storage rules, then the functions, through `scripts/fb.sh deploy --config firebase.deploy.json`. Every function runs as `eegml-functions`.
5. `npm run deploy:artefact:verify -- --environment <environment>`: the static files to publish are the ones the preflight scanned. A build made later, with other variables or from another commit, fails here and is not published.
6. Staging first, with the same commit, and the checks of `README.md`, "What has not been verified", repeated on staging. App Check is enforced on a project by setting `ENFORCE_APP_CHECK=true` in its `functions/.env.<project>` and deploying the functions again, once its metrics on staging show the portal's own requests carrying tokens.
7. Production only with the explicit approval of a programme administrator (R1.12, R21.9), through `deploy-plan.mjs`.
8. The static files of `web/out/<environment>` reach Pages through the protected, manually started workflow that `docs/SECURITY.md`, section 8, proposes, which a repository administrator has still to create. That workflow runs step 5 before it publishes.

## Backups and restore

| Copy | Where | Kept |
|---|---|---|
| Point-in-time recovery | Inside Firestore | 7 days, one version a minute |
| Scheduled backups | Inside Firestore, in the database's region | Daily for 7 days, weekly for 14 weeks |
| Managed export (Cloud Scheduler calls the Firestore export at 01:17) | The backup bucket, `europe-west2`, below `firestore/` | 98 days, by `backup-lifecycle.json` |
| Files of pages (Storage Transfer Service, daily) | The backup bucket, below `storage/` | 98 days |
| Authentication accounts | Exported by hand with `scripts/fb.sh auth:export` into the backup bucket, because the file holds every member's address | As the bucket |
| Governance ledger | The locked log bucket `eegml-governance-ledger`, `europe-west2` | 10 years, which nobody can shorten |

The periods are a proposal for the administrators to confirm (`BACKUP_RETENTION` in `environments.mjs`). An erased person stays in the first five copies until they expire (`docs/SECURITY.md`, section 6). A restore from any of them would bring back an erased person, a revoked role or grant, a suspended account and ended sessions. That is what the governance ledger is for: every erasure, revocation, suspension and end of sessions is logged with identifiers only, routed outside Firestore, and applied again by `governance:replay` after every restore.

A restore is rehearsed before any production rollout and repeated each quarter. `npm run restore:rehearse` does it on the emulators, the replay of the ledger included.

### Rehearsing a restore in the scratch project

`node ops/restore-scratch.mjs --environment <name> --project <id> --scratch-project <id> --scratch-project-number <number> --snapshot-time <minute> [--work-directory <directory>]` exports the governance ledger, exports the chosen minute from point-in-time recovery, clones the same minute into a temporary second database of the live project (`restore-reference`) as the reference, grants the scratch project's Firestore agent read access to that one export through a condition on its prefix, imports the export into the scratch project, copies the latest daily copy of the files, deploys the rules of this repository to the scratch project, and compares the two with `backup:manifest` and `backup:compare`, files included. A file changed since the last daily copy shows as a difference, which the record explains. It then applies the governance ledger to the restored copy. At the end, even after a failure, it deletes the clone from the live project, takes back the read access, and deletes the restored database and files from the scratch project, so that no copy of production outlives the rehearsal.

So the procedure does write to the live project: the temporary clone, which is a full copy of live data, special-category documents included, and a binding on the backup bucket. Both are removed at the end. The live database itself is only read. The work directory, by default a new directory in the system's temporary directory and never inside the repository, receives the ledger export and the two manifests, which list every document path of production; delete it once the result is recorded beside the emulator rehearsal.

### Restoring the live project

`node ops/restore-live.mjs --environment <name> --project <id> --snapshot-time <minute> [--work-directory <directory>]` is for a recovery that the programme administrators have decided on, after the same minute has been rehearsed in the scratch project. Its steps, all mandatory and in this order:

1. Export the governance ledger, which the restore cannot touch.
2. Export the chosen minute from point-in-time recovery and import it into the live database. Every document that existed then returns to its state then; a document created later stays.
3. `governance:replay --production --project <id> --ledger <export> --after <minute>`: every erasure, revocation of a role or a grant and suspension after the minute is applied again, every access document is resolved again from its sources, and every session that began before the replay is ended, so that no token issued before the restore outlives it.

For a moment older than the 7 days of point-in-time recovery the scheduled backups are restored into a new database instead, which is a decision of its own; the replay of the ledger applies to it in the same way.

## Encryption in transit

Every endpoint the application and the functions use outside the emulators is HTTPS. The preflight checks the policy of the build (every `connect-src`, `script-src` and `frame-src` source is HTTPS, and `upgrade-insecure-requests` is set) and the functions code (no plain HTTP address apart from namespace names and the metadata server of Google Cloud, which never leaves the machine). GitHub Pages cannot send an HSTS header of our own. On the default `github.io` address the domain is on the browsers' HSTS preload list; on a custom domain, "Enforce HTTPS" must be switched on in the Pages settings, and `frame-guard.js` repeats the redirect to HTTPS for any address that is not this machine. Whether Pages sends HSTS for a custom domain is unverified.

## When the migration is marked verified

Marking the migration verified on the governance page of the console starts the year of question 20 of `docs/MIGRATION_PLAN.md`, section 11. The same moment is the one that decision 8 of `docs/DECISIONS.md` names: the owners of source F and of the contributor sheets restrict their link sharing then, and record the date in the private operations log. The portal cannot do this for them, because those files live outside it.
