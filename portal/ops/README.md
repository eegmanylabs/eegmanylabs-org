# Operations runbook

Everything in this directory is written and has never been run. No project, bucket or service account exists yet, every identifier in `environments.mjs` is a placeholder (`eegml-staging-PLACEHOLDER`, `eegml-production-PLACEHOLDER` and so on), and the `gcloud` and `firebase` flags follow the vendor documentation of November 2026 without having been tried against a real project. Nothing here is named by a workflow file, and nothing here deploys the public website, whose own `.github/workflows/deploy.yml` is left unchanged (D-004).

Every procedure acts on one project that the operator names in full:

```bash
node ops/<procedure>.mjs --environment production --project <identifier> [options]            # prints the commands
node ops/<procedure>.mjs --environment production --project <identifier> [options] --execute  # prints, asks, runs
```

A procedure refuses to start without `--project`, refuses a placeholder, a demonstration project, the project of the other environment and a project named for another environment, and runs nothing until the operator has typed the project identifier again at an interactive terminal. It stops at the first command that fails.

| File | What it is |
|---|---|
| `environments.mjs` | The staging and production environments: project, backup bucket, scratch project for restores, site origin, and the region `europe-west2`. The web build and the preflight read it as well |
| `service-accounts.mjs` | The reviewed specification of the service accounts of the functions, their project roles and the secrets each may read |
| `secret-references.mjs` | Finds every secret the functions code asks for, for the preflight and for `tests/architecture/least-privilege.test.ts` |
| `procedure.mjs` | What every procedure shares: the explicit project, the refusals, the printed plan and the typed confirmation |
| `iam-plan.mjs` | Creates the service accounts with exactly the roles of the specification |
| `backup-setup.mjs`, `backup-lifecycle.json` | Point-in-time recovery, the backup schedules, the nightly managed export and the daily copy of files |
| `restore-scratch.mjs` | A restore of a chosen minute into the scratch project, compared with a clone of the same minute |
| `deploy-plan.mjs` | The deployment of rules, indexes, Storage rules and functions, after the preflight and the tests |

## Before the first deployment

These are decisions and actions of the programme administrators (`docs/DECISIONS.md`, decisions 1 to 8). Until they are taken, `npm run deploy:check` fails, as it should.

1. Create the staging and production projects on the Blaze plan with Identity Platform, in `europe-west2`, and the scratch project for restore rehearsals (D-003, D-017).
2. Replace the placeholders in `environments.mjs` and `.firebaserc` with the real identifiers, in a reviewed pull request.
3. Create the reCAPTCHA Enterprise key for App Check and put the web configuration in `web/.env.production.local` and `web/.env.staging.local`, which git ignores.
4. Run `node ops/iam-plan.mjs` and review its output before anyone runs it. Create the secrets of the specification in Secret Manager (`IDENTITY_HASH_KEY` always; `PUBLISHING_GITHUB_TOKEN` and `STORAGE_*` secrets only when those integrations are switched on).
5. Run `node ops/backup-setup.mjs`, and set the parameter `PORTAL_ORIGINS` of the functions to the origin of the site.
6. Run `npm run deploy:check -- --environment staging` until every item passes, then `node ops/deploy-plan.mjs --environment staging`.

## The order of a deployment

1. `npm run deploy:check -- --environment <name>`: every item passes.
2. `npm test` at the commit that is deployed: every test passes.
3. Staging first, with the same commit, and the checks of `README.md`, "What has not been verified", repeated on staging.
4. Production only with the explicit approval of a programme administrator (R1.12, R21.9), through `deploy-plan.mjs`.
5. The static files reach Pages through the protected, manually started workflow that `docs/SECURITY.md`, section 8, proposes, which a repository administrator has still to create.

## Backups and restore

| Copy | Where | Kept |
|---|---|---|
| Point-in-time recovery | Inside Firestore | 7 days, one version a minute |
| Scheduled backups | Inside Firestore, in the database's region | Daily for 7 days, weekly for 14 weeks |
| Managed export (Cloud Scheduler calls the Firestore export at 01:17) | The backup bucket, `europe-west2`, below `firestore/` | 98 days, by `backup-lifecycle.json` |
| Files of pages (Storage Transfer Service, daily) | The backup bucket, below `storage/` | 98 days |
| Authentication accounts | Exported by hand with `firebase auth:export` into the backup bucket, because the file holds every member's address | As the bucket |

The periods are a proposal for the administrators to confirm (`BACKUP_RETENTION` in `environments.mjs`). Erasure has to reach these copies too: an erased person stays in backups until they expire (`docs/SECURITY.md`, section 6).

A restore is rehearsed before any production rollout and repeated each quarter. `npm run restore:rehearse` does it on the emulators. `restore-scratch.mjs` does the same against the real projects: it exports the chosen minute from point-in-time recovery, clones the same minute into a second database of the live project as the reference, imports the export into the scratch project, copies the files, deploys the rules of this repository to the scratch project, and compares the two with `backup:manifest` and `backup:compare`. The live database is only read, and the reference clone is deleted at the end. Record the result beside the emulator rehearsal.

## Encryption in transit

Every endpoint the application and the functions use outside the emulators is HTTPS. The preflight checks the policy of the build (every `connect-src`, `script-src` and `frame-src` source is HTTPS, and `upgrade-insecure-requests` is set) and the functions code (no plain HTTP address apart from namespace names and the metadata server of Google Cloud, which never leaves the machine). GitHub Pages cannot send an HSTS header of our own. On the default `github.io` address the domain is on the browsers' HSTS preload list; on a custom domain, "Enforce HTTPS" must be switched on in the Pages settings, and `frame-guard.js` repeats the redirect to HTTPS for any address that is not this machine. Whether Pages sends HSTS for a custom domain is unverified.
