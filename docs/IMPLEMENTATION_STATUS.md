# #EEGManyLabs Hub: implementation status

This document records what has been built, what is under way, what is blocked and how to resume the work safely. It is updated at the end of every working session. The requirement-by-requirement view is in `docs/REQUIREMENTS_CHECKLIST.md`, the evidence for each test claim is in `docs/TEST_REPORT.md`, and the reasoning behind each choice is in `docs/DECISIONS.md`.

Last updated: 10 November 2026.

## Where the work stands

The portal is being built as a static application for GitHub Pages with Firebase as its backend, following the programme administrator's decision of 9 November 2026 (D-001). Nothing has been deployed. No Firebase project exists, no Pages site has been enabled, no DNS record or repository setting has been changed and no external document has been written to. Everything that is described below as working has been run against the Firebase Local Emulator Suite on a development machine and, for the scaffold, on GitHub's continuous integration runners.

| Phase | Scope | Status |
|---|---|---|
| 0 | Discovery, architecture assessment, source inventory, data model, security design, migration plan, integrations design | Complete, with sources A and G and Quire uninspected because access was not available |
| 1 | Portal foundation: application shell, sign-in, Firebase configuration, functions framework, test harness, design continuity, public-site entry, data model in code, security rules | Complete on the emulators. The security rules for the first slice were attacked by two red teams and hardened |
| 2 | Migration tooling, registry of members, laboratories and replications, profile and laboratory claiming, administration console | Under way. Importers are written and their first real run is in progress. Claiming and the administration console are being built |
| 3 to 9 | Workspace pages and databases, tasks, recruitment, Google Workspace, research data, scientific workflows, reporting and automation | Designed in the data model and integrations documents. Not started |
| 10 | Hardening, restore rehearsal, deployment readiness | Not started. Needs a staging Firebase project |

## What exists in the repository

| Area | Location | State |
|---|---|---|
| Decision log | `docs/DECISIONS.md` | Nineteen decisions, with the items that need an administrator's confirmation listed at the end |
| Architecture assessment | `docs/ARCHITECTURE.md` | Complete for the decided design, with evidence levels |
| Data model | `docs/DATA_MODEL.md` | Firestore document model for every phase, reviewed for completeness and for Firestore soundness |
| Security and governance | `docs/SECURITY.md` | Complete for the decided design, with a table of controls and their verification status |
| Source registry and migration plan | `docs/SOURCE_REGISTRY.md`, `docs/MIGRATION_PLAN.md` | Complete for the sources that could be opened. A, G and Quire are described from the brief and marked unverified |
| Integrations design | `docs/INTEGRATIONS.md` | Designed. Nothing has run against a live external system |
| Requirements checklist | `docs/REQUIREMENTS_CHECKLIST.md` | 394 items. Statuses and evidence are updated as phases close |
| Portal application | `portal/` | Monorepo with `shared`, `web`, `functions`, `tools` and `tests`. See `portal/README.md` |
| Continuous integration | `.github/workflows/portal-ci.yml` | Type check, lint, build and the full emulator test suite. Deploys nothing and uses no secret |
| Public-site entry | `theme/templates/settings.jinja2` and README section 5.7 | Built and verified, with the gate closed. The built public site is unchanged |

## What the portal does today

A member can open the application, ask for a sign-in link by email, complete sign-in on the same or another device, see whether the account is linked to a member profile, and sign out. Signing out clears the local copy of data in that browser. A suspended account, or one whose session has been ended, is refused by the security rules and by every callable function. The application shell has a collapsible sidebar, breadcrumbs and an account menu, works from phone width upwards and is operable by keyboard. It shows only destinations that exist.

The foundation that later phases build on is in place: a typed data layer in which the Firebase SDK is confined to one directory, live document subscriptions shared between views, a callable-function framework that validates input and output and maps errors without leaking detail, an audit helper, deny-by-default security rules, a seed tool that refuses to run outside the emulator, and a test harness in which several suites can run side by side on separate port ranges.

## Blocked items and what each one needs

| Blocked item | What is needed | What is done meanwhile |
|---|---|---|
| Import of source A (historical coordination workbook) and source G (membership workbook, including gender and ethnicity) | Read access, ideally through a Google service account that the files are shared with | Importers are built and tested against synthetic fixtures that follow the fields named in the brief, and stop with a precise report if the real layout differs |
| Laboratory profiles | No source that could be opened has a laboratory, principal investigator or institution column. Source G may supply them | Laboratories are created through the reviewed laboratory claim process or by an administrator |
| Quire migration | A Quire export or API authorisation, and the programme's Quire plan | Importer designed against the documented API shapes. Activity history cannot be migrated by any route |
| Live Google Sheets, Docs and Drive integration | A Google Cloud project, a service account and, for generated documents, a shared drive or an alternative chosen by the administrators | Adapters are designed behind interfaces with fakes for tests |
| Notification email | A mail provider and sender domain | Outgoing mail is written to an outbox collection, visible as a development mailbox under the emulator |
| Second factor by authenticator application, real identity in the audit trigger, App Check enforcement, Google sign-in pop-up, behaviour on real GitHub Pages | A staging Firebase project on the Blaze plan with the Identity Platform upgrade, and a staging Pages site | Code is written and unit tested where the emulator cannot exercise it. Each item is listed as unverified in `docs/TEST_REPORT.md` |
| Any deployment | Explicit approval, a billing account, the confirmed data location and the confirmed portal address (see the end of `docs/DECISIONS.md`) | A manual, approval-gated publishing workflow is designed and has not been added |

## How to resume safely

Work happens on the branch `claude/sweet-bohr-5r3rbz`. Pushing to it runs only the portal's continuous integration. The public site's deployment workflow runs on pull requests and on pushes to `main`, so opening a pull request from this branch redeploys the shared staging site, and merging it redeploys production. With the portal gate closed, both deployments are content-neutral for the public site, which has been verified by comparing builds.

To pick the work up, read `docs/DECISIONS.md` first, then this document, then `portal/README.md` and `portal/CONTRIBUTING.md`. From `portal/`, run `npm ci`, then `npm run typecheck`, `npm run lint` and `npm test`. All three must pass before any change is made. Tests need Node 22 or later and Java 21 and use only the demonstration project of the emulator suite.

Private material never enters the repository. Exports of the source workbooks and the configuration that holds their identifiers live in `portal/.private/`, which git ignores, or outside the repository. Test fixtures are synthetic.

Three actions always need explicit approval from a programme administrator: a production deployment, a destructive migration, and any write to a live external document or system.

## Next steps, in order

1. Complete the first real import of the accessible sources into the emulator, with its privacy and fidelity reviews, and record the counts.
2. Build profile claiming, laboratory claiming, the administration console and the audit trigger.
3. Build the member, laboratory and replication registry pages, laboratory registration, the imports console and the personal dashboard, then run the first four acceptance scenarios end to end.
4. Update the requirements checklist with statuses and evidence, and proceed to phase 3.
