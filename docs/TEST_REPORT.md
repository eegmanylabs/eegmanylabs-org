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

## 3. Public-site entry

The gated Members' portal entry was verified by building the public site in scratch copies, never inside the repository.

| Check | Result |
|---|---|
| Build of this branch compared with a build of `main`, production environment, gate closed | 167 files in each. None added, removed or different once build timestamps are normalised. No `/portal/` page |
| The same comparison for the staging environment | Identical in the same way |
| Thirteen malformed gate values (no scheme, `http://`, a bare scheme, an inner space and others), run by the engineer who made the gate fail closed | Each left the build identical to the baseline |
| Gate open with a test address | Entry present in the desktop navigation, mobile menu, footer and Sitemap page. `/portal/` redirects, carries `noindex` and a canonical link, and is absent from `sitemap.xml` |
| Layout at 375, 760, 1019, 1020, 1219, 1220 and 1440 pixels wide | No overflow or overlap |

The comparison with `main` was run twice by the orchestrating session, before the first commit of the entry and again after the review fixes, and independently by the reviewer.

## 4. Architecture spikes

Two throwaway spikes were run before the build to prove the architecture. Their code is not in the repository. Their results are summarised in `docs/ARCHITECTURE.md` section 10 and `docs/DECISIONS.md` D-010.

| Spike | Result |
|---|---|
| Application stack | 177 emulator-backed tests and 15 browser tests passed |
| Collaborative editor on Firestore | All suites passed: security rules 28, provider 15, two-browser collaboration 10, editor features 18, versions 9, comments 11, presence 7 |

## 5. Not yet verified

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
| Any import of sources A, G or Quire | No access | Access as described in `docs/IMPLEMENTATION_STATUS.md` |
