# #EEGManyLabs Hub: test report

This document records tests that were actually run, with the command, the date, the commit and the observed result. A claim appears here only when it was observed. Anything that could not be exercised is listed as unverified with the reason, so that a reader can tell what has been proven from what has only been built.

All portal tests run against the Firebase Local Emulator Suite with the demonstration project `demo-eegml`. No real Firebase project has been contacted.

## 1. Portal scaffold

Run on 10 November 2026 on the development machine, from `portal/`, on the working tree that became commit "Complete the portal scaffold after independent review". Node 22.23.4, Java 21.

| Command | Result |
|---|---|
| `npm run typecheck` | Exit 0 |
| `npm run lint` | Exit 0. 176 files checked, no findings |
| `npm test` | Exit 0 |

| Suite within `npm test` | Files | Tests passed | Tests failed |
|---|---|---|---|
| Unit and component tests | 27 | 483 | 0 |
| Emulator-backed tests of security rules, functions and tools | 6 | 143 | 0 |
| Browser tests (Playwright, Chromium) | | 57 | 0 |

The same run was repeated by the engineer who applied the review fixes, with identical counts, and two full suites were run at the same time on port bases 9100 and 9200 with identical counts in both. An interrupted run was checked to leave no process, port or run file behind.

The browser tests cover sign-in by email link on the same device and in another browser, a link request that the service refuses, a used link, a link that survives a network failure, sign-out in one tab ending the session in another, a suspended account losing its data while the page is open, the application shell on wide, narrow and touch screens, keyboard operation of the sidebar, skip link and account menu, the absence of requests to font services and content delivery networks, enforcement of the Content Security Policy, refusal to start inside a frame on another site, the absence of box shadows, the page shown for an unknown address, and automated accessibility checks with no serious finding.

### Independent review

Two reviewers who had not written the scaffold examined it. One ran every check from a clean clone and compared the result with the brief. The other read all the source and drove the built application in a browser at three screen sizes. Together they reported 39 findings, among them one blocker (a signed-in member could be shown an error until a manual reload after a sign-out in another tab), an unknown deep address rendering a blank page, sign-in reporting success when the link request had been refused, and a suspended status that nothing enforced. All 39 were confirmed and fixed, each with a test where a test could have caught it. Three tests were replaced by stronger ones, and none was weakened.

### Continuous integration on GitHub

The workflow `Portal CI` ran on GitHub's runners for the commit "Portal scaffold: continuous integration, readme and harness refinements" on 10 November 2026 and completed successfully. It installs from the lockfile, type-checks, lints, builds and runs the full test suite. Runs on later commits are recorded on the repository's Actions page.

## 2. Data model in code and security rules

Run on 10 November 2026 on the development machine, from `portal/`, on the tree committed as "Security rules for the first slice, red-teamed and hardened; importers in progress".

| Command | Run by | Result |
|---|---|---|
| `npm run test:rules` | The orchestrating session, independently of the engineers | Exit 0. 33 files, 3,380 tests passed, 0 failed |
| `npm test` | The engineer who hardened the rules | Exit 0. Unit and component tests 1,558 passed; emulator-backed tests 3,696 passed, of which rules 3,380; browser tests 57 passed |

The rules suite is driven by the collection registry. A matrix runs fifteen kinds of caller (signed out, signed in without membership, suspended, ordinary member, laboratory member and coordinator of the owning and of another laboratory, lead of the owning and of another replication, core team, and programme administrator with and without a second factor) against every collection. Meta-tests fail the build when a collection has no fixture, when a granted operation is never allowed or never refused, and when an allow statement in the rules is never exercised both ways. The engineer who wrote the suite made 24 deliberate mutations of the rules and reported that every one was caught.

### Red-team passes

Two testers who had not written the rules attacked them through the emulator as an authenticated browser client would, writing each attack as a test that asserts the secure behaviour. One pursued reading and gaining rights, the other corruption and escaping accountability.

| | Exploits reported | Attacks that held |
|---|---|---|
| Reading and escalation | 10, of which 1 high | 22 |
| Integrity and audit | 16, of which 3 high | 26 |

Before the hardening step, 156 of the red-team tests failed. All 26 exploits were reproduced and each one that a rule, the registry, a schema or the importer can close was closed. The 691 red-team tests now pass and remain in the normal test run as regressions. The most serious findings were that a signed scientific record could be rewritten while another person's signature stayed on it, that a lead could write into the contributor table of a replication it does not lead, that a laboratory coordinator could rewrite a deviation the lead had reported against that laboratory, and that special-category values could be recovered from the import change log by anyone able to run imports.

One residual risk was recorded and is open: a website publication identifier of exactly twenty letters and digits could be claimed by a client before the importer writes it, until the importer gives manuscripts a namespaced identifier.

The second-factor rule is proven only with sign-in tokens that the test library constructs. The Firestore emulator does not enforce composite indexes, so `firestore.indexes.json` is checked statically and has never been deployed.

## 3. Imports, identity and administration

Run on 10 November 2026 by the orchestrating session, independently of the engineers, from `portal/` on the tree committed as "Identity, profile claiming and administration console". `npm test` exited 0.

| Suite within `npm test` | Files | Tests passed | Tests failed |
|---|---|---|---|
| Unit and component tests | 82 | 1,734 | 0 |
| Emulator-backed rules and tools tests | 48 | 3,738 | 0 |
| Emulator-backed functions tests | 15 | 171 | 0 |
| Browser tests (Playwright, Chromium) | | 72 | 0 |

The functions suite includes eighteen red-team tests written by an independent security reviewer of the identity and administration functions. Seven of them failed before the fixes; among the exploits were a reviewer approving their own claim to take over an unclaimed profile and a holder of role management creating a new programme administrator.

The first real import of the accessible sources (the website data and sources B, C, D, E and F, and the five contributor sheets) was run into a local emulator by the import engineers, never into a real project. Every verification passed all eleven checks, every tab's row count equalled the source registry, and a second and a third run in a different order wrote nothing but their batch records. The run produced 8,703 documents and 521 open review items. No real programme data is in the repository: the saved state is in an ignored private directory, and a scan of every committable file against the real exports found no email address or document identifier from them.

## 4. Registry, laboratories, participation and imports console

Run on 11 November 2026 by the orchestrating session, independently of the engineers, from `portal/` with port base 9300 on the tree committed as "Registry, laboratories, participation and the imports console". `npm test` exited 0.

| Suite within `npm test` | Files | Tests passed | Tests failed |
|---|---|---|---|
| Unit and component tests | 104 | 1,858 | 0 |
| Emulator-backed rules and tools tests | 52 | 3,791 | 0 |
| Emulator-backed functions tests | 21 | 222 | 0 |
| Browser tests (Playwright, Chromium) | | 95 | 0 |

Two independent reviews examined this work. A permissions review attacked it through the client SDK and the functions emulator and wrote its attempts as tests, and a journeys review drove the built application as a new member, a lead, a coordinator, the core team and an administrator at three screen widths. They reported 27 findings, all fixed. The red-team directories now hold 730 tests across 27 files. The browser tests run only on the synthetic demonstration world, so the pages have not yet been exercised against the real imported data.

## 5. Workspace: pages, editor, databases, views and dashboards

Run on 11 November 2026 by the orchestrating session, independently of the engineers, from `portal/` with port base 9300 on the tree committed as "Workspace databases, views and dashboards; review fixes for pages and databases". `npm run typecheck` and `npm run lint` exited 0, with 700 files checked and no findings.

| Suite | Files | Tests passed | Tests failed |
|---|---|---|---|
| Unit and component tests | 117 | 1,971 | 0 |
| Emulator-backed rules and tools tests | 55 | 3,898 | 0 |
| Emulator-backed functions tests | 24 | 247 | 0 |
| Browser tests (Playwright, Chromium) | | 110 | 0 |

The figures above needed more than one run, and both failures are recorded here. In the first full run one unit test of the test harness failed: after an interrupted run it found the freed port listening again, most likely because another test had taken the same temporary port. It passed in five runs of its file on its own and in the second full run. In the second full run one functions test timed out after 30 seconds waiting for a background trigger, which is plausible now that the functions emulator also runs the workspace triggers. Both are reported as intermittent and have been given to the next engineer to make deterministic. The functions and browser suites were then run again together and passed in full, so every count in the table was observed in a passing run, though not all in a single one.

Two independent reviews examined the workspace. A permissions review attacked it through the client SDK and the functions emulator, and a journeys review drove the built application at three screen widths. Among their findings were that moving a page could widen or narrow who can read it without the right to share it, that comments kept a stale and wider audience after a page was restricted, that an undecodable editor update could break a page for everyone, that a file of a type a browser runs as a document could be attached, and that a member who lost access to a page saw it load forever. All were fixed with tests. The red-team tests of the workspace (eight across two files) remain in the run as regressions.

## 6. Tasks, meetings, the Quire importer, recruitment and forecasts

Run on 11 November 2026 by the orchestrating session, independently of the engineers, from `portal/` with port base 9300 on the tree committed as "Tasks, meetings, progress updates, Quire importer, recruitment and forecasts". `npm run typecheck` and `npm run lint` exited 0, with 774 files checked and no findings, and `npm test` exited 0 in a single run.

| Suite | Files | Tests passed | Tests failed |
|---|---|---|---|
| Unit and component tests | 126 | 2,084 | 0 |
| Emulator-backed rules and tools tests | 58 | 3,990 | 0 |
| Emulator-backed functions tests | 29 | 282 | 0 |
| Browser tests (Playwright, Chromium) | | 120 | 0 |

The two intermittent failures recorded in section 5 were made deterministic before this run. The harness test now waits for a greeting from the child process it watches, and the trigger waits in the functions tests keep waiting while audit events are still arriving, up to a bounded limit. Each affected file passed three consecutive runs in the engineer's hands, and both passed here.

Acceptance scenarios AS-4 and AS-5 (recruitment reported separately for the main experiment and resting state without double counting, forecasts from stated assumptions and recruitment at the end of a previous month) and AS-6 (a nested task with a dependency, a deadline and a link) have browser tests in this run. The dataset link of AS-6 waits for the dataset registry. AS-14 is met by the Quire importer against a synthetic export only.

Two independent reviews examined this work and reported 24 findings, all fixed with tests. Among them, every member could read each laboratory's recruitment figures through a stored forecast, a reminder could reveal the title of a record its owner could not read, one call could create a cycle of task dependencies, a crafted Quire export could write corrupt task trees, a completion percentage divided the tested count of some laboratories by the targets of others, and an assignee who opened a task from My tasks could not change it.

## 7. Google Workspace integration and the dataset registry

Run on 12 November 2026 by the orchestrating session, independently of the engineers, from `portal/` with port base 9300 on the tree committed as "Google Workspace sync and generated documents against fakes; distributed dataset registry". `npm run typecheck` and `npm run lint` exited 0, with 919 files checked and no findings.

| Suite | Files | Tests passed | Tests failed |
|---|---|---|---|
| Unit and component tests | 142 | 2,236 | 0 |
| Emulator-backed rules and tools tests | 60 | 4,077 | 0 |
| Emulator-backed functions tests | 34 | 376 | 0 |
| Browser tests (Playwright, Chromium) | | 128 | 0 |

In the first full run every test passed, but the functions suite was reported as failed because a clean-up hook after the tests of one file timed out after 30 seconds while it waited for the emulator to process a sentinel write. The browser tests therefore did not run. The functions and browser suites were then run again together and passed in full. The engineers saw the same hook time out twice and saw one browser test of suspending a member time out once. Both are recorded as intermittent faults of the test environment under load and have been given to the next engineer to fix at their cause.

Every Google and storage behaviour in this section was exercised against in-memory fakes. The real Google adapters and the real SFTP, FTPS, file-system and object-storage adapters have never been executed. Within that limit, acceptance scenarios AS-3 (the Sheet half), AS-9 and AS-10 have browser tests against the Google fake, AS-8 and the dataset link of AS-6 have browser tests, and the outage, quota and lost-access faults of AS-15 are injected by both fakes.

Two independent reviews examined this work and reported 24 findings, all critical, high and medium ones fixed with tests. The most serious were that a holder of a management right could make the portal's storage scanning account or its Drive account reach paths and files outside that holder's unit, that a line break in a copy's path could add a command to an SFTP listing, that the core team could move a server that names a stored secret to another host, that a transfer could be recorded as verified when no data had moved, and that every generated document was readable by all members whatever its template held.

## 8. Scientific workflows, publishing, reporting and automation

Run on 13 November 2026 by the orchestrating session, independently of the engineers, from `portal/` with port base 9300 on the tree committed as "Build scientific workflows, publishing, reporting and automation (phases 8 and 9)", with the two test harness changes described below. `npm run typecheck` and `npm run lint` exited 0, with 1,044 files checked and no findings, and `npm test` exited 0.

| Suite | Files | Tests passed | Tests failed |
|---|---|---|---|
| Unit and component tests | 154 | 2,338 | 0 |
| Emulator-backed rules and tools tests | 64 | 4,234 | 0 |
| Emulator-backed functions tests | 39 | 416 | 0 |
| Browser tests (Playwright, Chromium), in three batches | | 138 (48, 53 and 37) | 0 |

The first independent run of the committed tree passed every suite except the browser tests, where 127 passed and 11 failed late in the run, in `tasks.spec.ts`, `views.spec.ts` and the table-performance test. A browser-only run with the memory of each process sampled every 45 seconds found the cause. The functions emulator keeps one idle worker process of about 220 MB for every function it has run and never stops it (`RuntimeWorkerPool` in firebase-tools 15.35.0 keeps an idle worker per trigger), so memory in use rose from under 1 GB to 14.3 GB of the 16 GB available while the Firestore emulator stayed at about 1.2 GB, and the browser renderer crashed ("Target crashed"). The machine had no other test run in progress, so the memory exhaustion that the engineers saw is a property of a single run. The fix leaves the tests themselves unchanged: `npm test` and `npm run test:e2e` now run the browser files in three contiguous Playwright shards, each with freshly started emulators and a fresh seed. In the passing run memory in use peaked at 12.9 GB, during the functions suite, and stayed lower through each browser batch.

That browser-only run also ended abnormally and left its preview server running, because Playwright starts that server in a process group of its own; the next run then refused to start on the occupied port. The preview server now takes `--stop-with-emulators` from the Playwright configuration and exits once the emulator hub has been unreachable for three checks in a row, which was checked by starting it with no emulators running (it exited after 15 seconds).

`workspace.table-performance.spec.ts`, recorded as open in the engineer's run of phase 9 below, now allows the one Firestore connectivity probe to `https://www.google.com/images/cleardot.gif` that the offline test of `workspace.spec.ts` already allows, and still fails on every other policy violation, foreign host or uncaught error. It passed as the last test of the third batch.

Two independent reviews examined phases 8 and 9 before this run and reported 34 findings, all fixed with tests. The most serious were that nobody could acknowledge a protocol version, because nothing could name a laboratory's protocol or record its team; that a coordinator of one laboratory could rewrite another unit's analysis run; that an exported author line ignored the ordering rule and put the lead last; that the fake GitHub adapter linked to the real public repository; that a withdrawn OSF registration kept its "checked" badge; that the small-cell suppression of demographic counts still named each category of a scope smaller than the threshold; and that a lead could write a Stage 1 acceptance date that could reach the public website.

OSF, GitHub and the mail sender were reached only through their in-memory fakes. The real OSF and GitHub adapters have never been executed, and no mail provider adapter exists.

### Run by the engineer after phase 8

Run on 12 November 2026 by the engineer, from `portal/` with port base 9200, on the working tree of phase 8 (uncommitted). `npm run typecheck`, `npm run lint` (968 files, no findings) and `npm run build` exited 0.

| Suite | Files | Tests passed | Tests failed |
|---|---|---|---|
| Unit and component tests | 148 | 2,277 | 0 |
| Emulator-backed rules and tools tests | 61 | 4,192 | 0 |
| Emulator-backed functions tests | 35 | 387 | 0 |
| Browser tests (Playwright, Chromium) | | 132 | 0 |

The functions suite was run in full three times after its fix: once on its own (34 files, 376 tests, 10 minutes 50 seconds, before the scientific tests were added) and twice inside `npm test` (35 files, 387 tests, about 11 minutes each). Before the fix it took about 22 minutes and its last files timed out waiting for the audit trigger. The cause was measured: each time the tests switched the triggers on, the functions emulator registered them again under new names and the Firestore emulator went on posting every write to every earlier registration, so a burst of 200 writes took 3.2 seconds at first and 13.9 seconds after twelve switches. The tests now switch the triggers off once and on once per run (`tests/support/triggers.ts`, `vitest.config.ts`).

`tests/e2e/identity-admin.spec.ts`, whose test of suspending a member had timed out on "Loading your account", was run three times on its own after the browser tests began to drain the trigger work of the seed before the first test: 5 of 5 passed each time. In the first full `npm test` one tools test failed because it still named a manuscript by its bare identifier, which phase 8 replaced; the test was corrected. In the second, 131 of 132 browser tests passed and one, "a personal view is its owner's alone until it is shared" in `tests/e2e/views.spec.ts`, timed out waiting for the sign-in page in a second browser; that file then passed twice on its own, and the failure is recorded as intermittent and unexplained. The third full `npm test`, whose counts the table gives, exited 0 with every suite passing (41 minutes).

`tests/e2e/scientific.spec.ts` covers a lead preparing the authorship list of a report from its contributor table with a member added from the directory, the member confirming her own entry from Home and the export for the journal; a Stage 1 Registered Report linked to its OSF registration and checked through the OSF fake, followed by a Stage 2 report with a milestone in a task list, a submission, a decision of a review round and the acceptance that reaches the milestone; an analysis run recorded against a dataset of the registry with its provenance exported as JSON-LD and its bundle manifest; and an incident reported for a laboratory, given a corrective action and resolved. Each page was checked with axe and for sideways scrolling at every supported width. OSF was reached only through the in-memory fake; the real OSF adapter has never been executed.

### Run by the engineer after phase 9

Run on 12 November 2026 by the engineer, from `portal/` with port base 9200, on the working tree of phase 9 (uncommitted). `npm run typecheck`, `npm run lint` (1,038 files, no findings) and `npm run build` exited 0.

| Suite | Files | Tests passed | Tests failed |
|---|---|---|---|
| Unit and component tests | 154 | 2,324 | 0 |
| Emulator-backed rules and tools tests | 63 | 4,231 | 0 |
| Emulator-backed functions tests | 36 | 405 | 0 |
| Browser tests (Playwright, Chromium) | | 137 in all; see below | |

No full `npm test` run passed from start to finish. The unit, rules, tools and functions suites passed in full in each of the last two runs. The browser tests did not:

- In the first of those runs, 133 of 137 browser tests passed. Two failures were defects of the new tests and were fixed: a locator in the drill-down test also matched the label of a region, and the automation test registered a dataset in the folder of the Munich fake that AS-8 registers next, so AS-8 was refused. The automation test now has a synthetic folder of its own. The other two failures were in `tests/e2e/views.spec.ts`, one of them "Target crashed", while the kernel was killing processes for lack of memory.
- In the last run the kernel killed the Firestore emulator part-way through the browser tests, and the log records "Firestore Emulator has exited upon receiving signal: SIGKILL". 122 tests had passed. The 8 that failed after that point were one test of `tasks.spec.ts` and seven of `views.spec.ts`, and the seven tests of the two workspace files did not run.
- The affected files were then run on their own: `reporting.spec.ts` and `research-data.spec.ts` (7 of 7 passed), `tasks.spec.ts` and `views.spec.ts` (12 of 12), and `workspace.spec.ts` (6 of 6).
- `workspace.table-performance.spec.ts` passed as the last test of the first run. It failed twice when run on its own straight after the emulators started, both times on a Content-Security-Policy report: the Firestore SDK's own connectivity probe asked for `https://www.google.com/images/cleardot.gif`, and the policy blocked it. The SDK sends that probe when one of its channel requests fails. The cause on a cold emulator was not established in this run; the test was changed afterwards, as described at the start of this section.

`tests/e2e/reporting.spec.ts` covers AS-13 against the GitHub fake: an administrator prepares an export, sees the difference, the staging build is run with Syrinx in a scratch copy through `publish:verify`, the approval with a second factor opens a pull request, and neither the files nor the body hold a planted private value. It also covers a view exported as CSV and Excel, drill-down from a dashboard figure and the programme overview with a past date, a change of digest preferences with a search and a saved search, and an automation that opens the quality-control task when data arrives, with its run logged. axe ran on each page and the absence of sideways scrolling was checked at every supported width.

`tests/functions/reporting.test.ts` (18 tests) covers the publishing route against the GitHub fake, including the one-open-request rule, a moved `main`, lost access, the merge, the rollback proposal and the withdrawal; the mail outbox against the fake sender, with quiet hours, an outage, a rejected address and a weekly digest; automations with the depth limit and a chain; demographic aggregates with suppression and the audit entry; the search of comments and linked documents; notifications to followers, of protocol updates and of milestones; and a scheduled report run once in its period. `tests/tools/publish-verify.test.ts` builds with a stand-in for Syrinx, so that the tools suite does not need Python, and `tests/architecture/website-contract.test.ts` regenerates the committed website files byte for byte.

GitHub and the mail sender were reached only through their in-memory fakes. The real GitHub adapter has never been executed, and no mail provider adapter exists.

### Run by the engineer after the review fixes

Run on 13 November 2026 by the engineer with port base 9200. Type checking, lint (1,044 files) and the build passed, as did the unit (2,338), rules and tools (4,234) and functions (416) suites. `npm test` exited 1: the kernel killed the Firestore emulator late in the browser tests, 120 passed, 11 in `tasks.spec.ts` and `views.spec.ts` failed after that point, and the workspace files did not run. Those files then passed on their own except the table-performance test. The independent run at the start of this section, after the harness changes, supersedes this one.

## 9. Recovery, governance and deployment readiness (phase 10)

Run on 13 November 2026 by the orchestrating session, independently of the engineers, from `portal/` with port base 9300 on the tree committed as "Phase 10: recovery, environments, governance, deployment preflight and review fixes", with no change to it. `npm run typecheck` and `npm run lint` exited 0, with 1,112 files checked and no findings, and `npm test` exited 0 in one uninterrupted run, which the engineers had not achieved: they had passed every part in separate runs.

| Suite | Files | Tests passed | Tests failed |
|---|---|---|---|
| Unit and component tests | 166 | 2,454 | 0 |
| Emulator-backed rules and tools tests | 66 | 4,311 | 0 |
| Emulator-backed functions tests, in two batches | 42 (21 and 21) | 452 (240 and 212) | 0 |
| Browser tests (Playwright, Chromium), in three batches | | 148 (54, 54 and 40) | 0 |
| Restore rehearsal (`npm run restore:rehearse`) | | 10 checks | 0 |

The functions suite now runs in two batches with freshly started emulators, for the same reason as the browser tests in section 8: run whole, it exhausted the 16 GB of the machine in an engineer's run. In this run memory in use peaked at 10.6 GB, against 12.9 GB in section 8.

The restore rehearsal seeded the demonstration world on fresh emulators, took a manifest of 320 documents, 3 accounts and 1 Storage object, exported the emulators, started fresh ones from the export and found every document, account and object present and identical. It confirmed that the audit trail reads back through its schema, that the security rules still allow and refuse the same reads, and that a deliberately corrupted restore (one changed document, one removed document and one removed object) is detected with exactly those differences. It also replays the governance ledger, so that an erasure or a revocation recorded after the moment a backup was taken is applied again to the restored data. The report stays in `portal/.run/`, outside the repository. This proves the procedure on the emulators. The production procedures in `portal/ops/` print their commands and have never been run, so a restore of a real Firestore database has not been rehearsed.

The deployment preflight was then run for both environments with `npm run deploy:check:staging` and `npm run deploy:check:production`, after `npm run functions:package`, as `docs/DEPLOYMENT.md` prescribes. It contacts no project; it compiles the rules on the local emulators. Each run reported 8 of 11 items passing and exited 1. The rules compile, the indexes cover the 130 catalogued queries, every secret is declared, every endpoint is HTTPS, the deployment configuration is complete, the functions package installs without workspace packages, every function runs as its own least-privilege account and the region is europe-west2 throughout. The three failures are expected and need the administrators: the project, bucket and scratch-project identifiers in `portal/ops/environments.mjs` are placeholders, the functions parameter file for the project does not exist, and the web build has no configuration because no Firebase project exists.

Two independent reviews examined phase 10 before this run, a security red team and a deployment-readiness review, and reported 27 findings (3 critical, 6 high, 10 medium and 8 low). All were fixed with tests or, for procedures that can only run against a real project, with checks added to the preflight. The critical findings were all deployment blockers: the staging preflight could not start, the planned `firebase deploy` had no configuration file to use, and the deployed functions package depended on a private workspace package that Cloud Build cannot install. The most serious security findings were that a restore to an earlier moment would silently undo later erasures and revocations, now closed by the governance ledger; that one programme administrator could appoint a second and so satisfy the two-person rule alone, now closed by a check of recent appointment chains; that the restore procedure wrote to production; and that differencing two overlapping demographic scopes could recover one person's value without an audit entry.

No Firebase or Google Cloud project was contacted, no `gcloud` command or deploying `firebase` command was run, and `.github/workflows/deploy.yml` was not touched.

## 10. Public-site entry

The gated Members' portal entry was verified by building the public site in scratch copies, never inside the repository.

| Check | Result |
|---|---|
| Build of this branch compared with a build of `main`, production environment, gate closed | 167 files in each. None added, removed or different once build timestamps are normalised. No `/portal/` page |
| The same comparison for the staging environment | Identical in the same way |
| Thirteen malformed gate values (no scheme, `http://`, a bare scheme, an inner space and others), run by the engineer who made the gate fail closed | Each left the build identical to the baseline |
| Gate open with a test address | Entry present in the desktop navigation, mobile menu, footer and Sitemap page. `/portal/` redirects, carries `noindex` and a canonical link, and is absent from `sitemap.xml` |
| Layout at 375, 760, 1019, 1020, 1219, 1220 and 1440 pixels wide | No overflow or overlap |

The comparison with `main` was run twice by the orchestrating session, before the first commit of the entry and again after the review fixes, and independently by the reviewer.

## 11. Architecture spikes

Two throwaway spikes were run before the build to prove the architecture. Their code is not in the repository. Their results are summarised in `docs/ARCHITECTURE.md` section 10 and `docs/DECISIONS.md` D-010.

| Spike | Result |
|---|---|
| Application stack | 177 emulator-backed tests and 15 browser tests passed |
| Collaborative editor on Firestore | All suites passed: security rules 28, provider 15, two-browser collaboration 10, editor features 18, versions 9, comments 11, presence 7 |

## 12. Not yet verified

| Item | Why it is unverified | What will verify it |
|---|---|---|
| Second factor by authenticator application | The Authentication emulator implements only the SMS second factor | A staging Firebase project with the Identity Platform upgrade |
| The acting identity delivered to the audit trigger | The Firestore emulator sends a placeholder identity | The staging project |
| App Check enforcement | App Check has no emulator | The staging project |
| Google sign-in pop-up | Needs Google's hosted loader | The staging project |
| Behaviour on real GitHub Pages | Pages was reproduced by a local static server with no rewrites and no custom headers | A staging Pages site |
| Whether production Firestore ends an open listener when a user's access document changes | Observed on the emulator only | The staging project |
| Whether a production sign-in token carries the second-factor claim that the rules read | Proven only with constructed test tokens | The staging project |
| Composite indexes | The emulator does not enforce them | Deployment of the indexes to the staging project |
| The test suite on Node 24 | Node 24 was not available on the development machine | Continuous integration once a Node 24 job is added |
| Firefox, Safari, touch devices and screen readers | Browser tests run in Chromium only | Manual and cross-browser testing before rollout |
| Collaborative editing, file storage and presence on production Firebase, including cross-origin access to the storage bucket and the 1,000-document cap on page sync queries under load | Run on the emulators only | The staging project |
| Recruitment forecasts against real recruitment histories | The method has been tested with fixed synthetic inputs only | Use with programme data after deployment, reviewed by the leads |
| Every call of the real Google Drive, Sheets and Docs adapters and of the real storage adapters | No service account and no server account exist, so the adapters have never run | Credentials for a staging project and a test server, with an administrator's approval |
| The scheduled sweeps of the job queue and of storage scans firing on their schedule | The emulator suite has no Pub/Sub emulator in this configuration, so the sweeps are tested by calling them directly | The staging project |
| Any import of sources A, G or Quire | No access | Access as described in `docs/IMPLEMENTATION_STATUS.md` |
| Every call of the real OSF adapter | No OSF token has been issued, so the adapter has never run; `OSF_CHECKS_ENABLED` is off | A run against the staging project before the parameter is switched on |
| Every call of the real GitHub adapter, the protection of `main`, and a real pull request redeploying the shared staging site | No repository credential exists, so the adapter has never run | A credential limited to branches and pull requests, a test repository first, and an administrator's approval of each live pull request |
| Email delivery, digests by email and the provider's handling of rejected addresses | No mail provider has been chosen, and no provider adapter exists | A provider, its key and the DNS records of the sending domain |
| The scheduled sweeps of publishing, mail, automations and reports firing on their schedule | Tested by calling them directly, as for the sweeps of phases 6 and 7 | The staging project |
