# #EEGManyLabs Hub: implementation status

This document records what has been built, what is under way, what is blocked and how to resume the work safely. It is updated at the end of every working session. The requirement-by-requirement view is in `docs/REQUIREMENTS_CHECKLIST.md`, the evidence for each test claim is in `docs/TEST_REPORT.md`, and the reasoning behind each choice is in `docs/DECISIONS.md`.

Last updated: 11 November 2026, at the close of phase 2.

## Where the work stands

The portal is being built as a static application for GitHub Pages with Firebase as its backend, following the programme administrator's decision of 9 November 2026 (D-001). Nothing has been deployed. No Firebase project exists, no Pages site has been enabled, no DNS record or repository setting has been changed and no external document has been written to. Everything that is described below as working has been run against the Firebase Local Emulator Suite on a development machine and, for the scaffold, on GitHub's continuous integration runners. The browser tests run on a synthetic demonstration world, so the pages have not yet been exercised against the real imported data.

| Phase | Scope | Status |
|---|---|---|
| 0 | Discovery, architecture assessment, source inventory, data model, security design, migration plan, integrations design | Complete, with sources A and G and Quire uninspected because access was not available |
| 1 | Portal foundation: application shell, sign-in, Firebase configuration, functions framework, test harness, design continuity, public-site entry, data model in code, security rules | Complete on the emulators. The security rules were attacked by two red teams and hardened. Protected staging is blocked (see below) |
| 2 | Migration tooling, registry of members, laboratories and replications, profile and laboratory claiming, participation and onboarding, imports console, administration console | Complete on the emulators for the accessible sources. The importers ran on the real accessible sources into a local emulator. Sources A and G remain blocked, and the pages have not yet been run against the real imported data |
| 3 | Notion-style workspace: pages, the block editor, comments and mentions, version history, linked databases and views | Under way. Design work has started from the editor spike (D-010). No workspace code is in the repository yet |
| 4 to 9 | Tasks, recruitment, Google Workspace, research data, scientific workflows, reporting and automation | Designed in the data model and integrations documents, and modelled in code with every collection closed to clients. Not started |
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
| Requirements checklist | `docs/REQUIREMENTS_CHECKLIST.md` | 394 items, reviewed at the close of phase 2: 103 tested, 42 implemented, 62 in progress, 29 blocked and 158 planned. Each tested or implemented item names its evidence |
| Portal application | `portal/` | Monorepo with `shared`, `web`, `functions`, `tools` and `tests`. See `portal/README.md` |
| Continuous integration | `.github/workflows/portal-ci.yml` | Type check, lint, build and the full emulator test suite. Deploys nothing and uses no secret |
| Public-site entry | `theme/templates/settings.jinja2` and README section 5.7 | Built and verified, with the gate closed. The built public site is unchanged |

## What the portal does today

A member asks for a sign-in link by email and completes sign-in on the same or another device. On first sign-in the portal looks for a profile whose primary or secondary address matches the verified address. A single unclaimed match is linked at once. Any other match, such as an address that two people share, waits for an administrator, and a management role that comes with a profile stays pending until an administrator confirms it. An address that matches nobody can send a request for access. A second sign-in creates no duplicate account, link or role. A linked member can report a wrong detail of their profile as a correction request. Signing out clears the local copy of data in that browser, and a suspended account, or one whose sessions have been ended, loses its data while the page is open.

Home shows the member's own profile, laboratories and replications, anything waiting for them and a live snapshot of the programme. The registry lists replications, members and laboratories with search, filters and sorting kept in the address, a preview panel beside the list and record pages whose tabs appear only when they have content. Every value is labelled with its origin, historical labels from the sources are shown as unverified, an unknown is never shown as zero, and main-experiment and resting-state figures are never added together. A command palette, favourites and recent items work across the registry. Leads, the core team and administrators edit replication records in place, and a status change needs a reason and is kept as dated history.

Laboratories are registered by a member or claimed by a representative, and an administrator reviews each request with the evidence the server computed. A registration that duplicates an existing laboratory is caught before it is sent, and a laboratory can have several representatives. Coordinators keep equipment configurations, with their earlier versions, and each participation shows whether the current equipment meets the replication's requirements. An equipment edit updates the laboratory and replication views without a reload and writes an audit entry. A lead adds a laboratory to a replication, the laboratory works through the nine-item onboarding checklist, readiness is approved by the leads, and a readiness matrix shows every laboratory against every replication.

Administrators have a console for account claims, laboratory claims, users and suspension, roles, capability grants and overrides, the audit log and correction requests. The imports console shows the sources, each batch with restricted values withheld, and a rollback that shows what it would change before it is confirmed. Its review queue settles lead conflicts, value conflicts and possible duplicate people. A nightly integrity sweep checks references across the database and its latest report is shown in the console. Gender and ethnicity are readable only through one audited function that needs a named grant and a second factor. Members receive in-app notifications of decisions about their claims, roles and correction requests.

The command-line tools import the accessible sources, verify citations against Crossref (tested against a local stand-in), seed lookup data and a demonstration world, bootstrap the first administrators by a keyed hash of their address, and check integrity. The seed tools refuse any target that is not an emulator, and the other tools reach a real project only when they are explicitly pointed at one from a trusted machine.

The first real import of the website data, sources B to F and the five contributor sheets produced 8,703 documents and 521 open review items in a local emulator, and repeated runs wrote nothing new. That state is kept outside the repository.

| Evidence | Result |
|---|---|
| Independent run of the full suite on 11 November 2026 (`docs/TEST_REPORT.md` section 4) | 1,858 unit and component tests, 3,791 rules and tools tests, 222 functions tests and 95 browser tests passed, with none failing |
| Red-team regression tests | 730 tests across 27 files |
| Acceptance scenarios | AS-1 and AS-2 have browser tests that run end to end on the demonstration world. AS-11 is tested by the importer suites and the imports console tests, and AS-12 by the rules matrix and the browser tests of the record pages. AS-3 is partly met: the equipment edit and its propagation are tested, and the Google Sheet synchronisation is blocked |

## Blocked items and what each one needs

| Blocked item | What is needed | What is done meanwhile |
|---|---|---|
| Import of source A (historical coordination workbook) and source G (membership workbook, including gender and ethnicity) | Read access, ideally through a Google service account that the files are shared with | Importers are built and tested against synthetic fixtures that follow the fields named in the brief, and stop with a precise report if the real layout differs |
| Imported laboratory profiles | No source that could be opened has a laboratory, principal investigator or institution column. Source G may supply them | Laboratories are registered by members and approved by an administrator, which is built and tested |
| Quire migration | A Quire export or API authorisation, and the programme's Quire plan | Importer designed against the documented API shapes. Activity history cannot be migrated by any route |
| Live Google Sheets, Docs and Drive integration, including the Sheet synchronisation of acceptance scenario AS-3 | A Google Cloud project, a service account and, for generated documents, a shared drive or an alternative chosen by the administrators | Adapters are designed behind interfaces with fakes for tests. The in-app part of AS-3 is tested |
| Notification email | A mail provider and sender domain | In-app notifications are built. The mail outbox is modelled and readable only by trusted code, and nothing writes to it yet |
| Second factor by authenticator application, real identity in the audit trigger, App Check enforcement, Google sign-in pop-up, behaviour on real GitHub Pages | A staging Firebase project on the Blaze plan with the Identity Platform upgrade, and a staging Pages site | Code is written and unit tested where the emulator cannot exercise it. Each item is listed as unverified in `docs/TEST_REPORT.md` |
| Protected staging and any deployment | Explicit approval, a billing account, the confirmed data location and the confirmed portal address (see the end of `docs/DECISIONS.md`) | A manual, approval-gated publishing workflow is designed and has not been added |

The residual risks that the security work left open, among them a manuscript identifier that a client could take before the importer writes it, are listed in `docs/SECURITY.md`. None of them is exposed while nothing is deployed.

## How to resume safely

Work happens on the branch `claude/sweet-bohr-5r3rbz`. Pushing to it runs only the portal's continuous integration. The public site's deployment workflow runs on pull requests and on pushes to `main`, so opening a pull request from this branch redeploys the shared staging site, and merging it redeploys production. With the portal gate closed, both deployments are content-neutral for the public site, which has been verified by comparing builds.

To pick the work up, read `docs/DECISIONS.md` first, then this document, then `portal/README.md` and `portal/CONTRIBUTING.md`. From `portal/`, run `npm ci`, then `npm run typecheck`, `npm run lint` and `npm test`. All three must pass before any change is made. Tests need Node 22 or later and Java 21 and use only the demonstration project of the emulator suite.

Private material never enters the repository. Exports of the source workbooks and the configuration that holds their identifiers live in `portal/.private/`, which git ignores, or outside the repository. Test fixtures are synthetic.

Three actions always need explicit approval from a programme administrator: a production deployment, a destructive migration, and any write to a live external document or system.

## Next steps, in order

1. Build the first increment of the phase 3 workspace: the shared schemas and access resolution for pages, security rules for the workspace collections with fixtures in the rules matrix, functions for mentions, the search index and activity, the editor from the spike (D-010) with comments and version history, and the page interface. Close it with browser tests of concurrent editing, offline editing and acceptance scenario AS-7, and an independent run of the full suite.
2. Run the registry, laboratory and imports pages against the real imported data in a private local emulator, and record what is found without committing any of it.
3. Close the residual risk of the manuscript identifier before any deployment, as described in `docs/SECURITY.md`.
4. Close the gaps that keep phase 2 items in progress: a test of a claim by a member with several affiliations, the status of a replication at a chosen past date, saved searches, and recovery for a member who has lost their address.
5. Ask the programme administrators for the decisions and access listed at the end of `docs/DECISIONS.md`, which unblock sources A and G, staging and the Google integration.
