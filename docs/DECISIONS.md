# #EEGManyLabs Hub: decision log

Each entry records a decision, the evidence behind it and what follows from it. Entries are numbered and are never rewritten once accepted. A later entry supersedes an earlier one and says so. The status of an entry is one of `accepted`, `recommended` (the build proceeds on this basis and a programme administrator is asked to confirm) or `provisional` (awaiting evidence from a spike or a test).

## D-001 The portal is a static application on GitHub Pages with Firebase as its backend

**Status:** accepted. Decided by the programme administrator on 9 November 2026.

The members' portal is a client-rendered single-page application published as static files on GitHub Pages. Firebase provides authentication, the Firestore database, Cloud Functions for server-side logic and Cloud Storage for files. This supersedes the initial plan for a server-rendered application with PostgreSQL on DigitalOcean, which was stopped before any code was written.

Discovery confirmed that the combination is feasible, with prerequisites that only the administrators can satisfy. The free Spark plan cannot run the portal, because it limits sign-in link emails to five a day and excludes Cloud Functions and Cloud Storage. The pay-as-you-go Blaze plan with a billing account is therefore required, at an expected cost of roughly US$0 to US$10 a month for about fifty daily active users. Second-factor authentication and blocking functions require the free upgrade to Firebase Authentication with Identity Platform. Firebase Authentication processes account data in the United States and its location cannot be chosen, while Firestore, Functions and Storage can be pinned to London. GitHub Pages cannot set HTTP response headers, so the Content Security Policy is delivered by a `<meta>` element and there is no `frame-ancestors` protection, no HSTS header set by us and no policy reporting.

## D-002 The portal is served from its own subdomain, with a redirect from `eegmanylabs.org/portal`

**Status:** recommended.

GitHub Pages cannot serve a path beneath `eegmanylabs.org` while that domain is served by DigitalOcean. The recommended arrangement is a Pages site with the custom domain `portal.eegmanylabs.org`, and a small redirect page at `eegmanylabs.org/portal` added to the public site as the final step of the rollout. An origin of its own is the strongest isolation available on Pages, because sign-in state is then not shared with any other site. The interim arrangement, which needs no DNS change, is the default Pages address of the repository.

The application uses hash-based routes and relative asset URLs, so the same built artefact works at either address and deep links do not depend on a server rewrite. Routes take the form `#/replications/AmodioJost2007`, `#/labs/<id>`, `#/members/<id>`, `#/tasks/<id>`, `#/datasets/<id>` and `#/login`.

## D-003 Firestore, Standard edition, in London, holds the data

**Status:** recommended. The location is permanent once chosen and needs explicit confirmation before the production project is created.

Firestore suits this product because realtime listeners keep every linked view of a record consistent without extra machinery, user-configurable views can be computed in the browser over a few thousand documents, and security rules give per-document decisions that can be unit tested. The PostgreSQL-backed alternative inside Firebase was assessed and rejected for this product: its operations are fixed at deployment time, which fits poorly with user-defined filters and groupings, its realtime support is recent and partial, and it has a monthly cost floor.

The cost of this choice is stated plainly. Firestore has no foreign keys, no unique constraints and no joins. The logical model in `docs/DATA_MODEL.md` remains relational in its thinking, and its integrity is enforced by four mechanisms that are built and tested deliberately: natural keys used as document identifiers so that duplicates cannot exist, security rules that check references and shapes on every client write, callable functions that perform multi-document changes in transactions, and a scheduled integrity checker that reports any orphaned reference.

## D-004 Portal source lives in `portal/` in this repository, and existing deployment files are left unchanged

**Status:** accepted for the build. Whether the portal later moves to a repository of its own is a decision for the administrators.

The existing workflow redeploys the shared staging site on every pull request and production on every merge to `main`, with no path filter. A portal change therefore redeploys the public site with unchanged content. The existing `deploy.yml`, `.do/app.yml`, `Dockerfile` and `nginx.conf` are not modified. The Pages publishing workflow is triggered manually and is gated by a protected environment with required reviewers, so nothing is published without approval.

## D-005 A person record and a login are different things

**Status:** accepted.

A person is anyone known to the programme and exists whether or not they have signed in. A user is a Firebase Authentication account. A claim links exactly one user to exactly one person. Profiles are created from the sources before anyone is invited, and a member takes ownership through the claim flow described in `docs/SECURITY.md`. Roles with management powers that are implied by imported data start in a pending state and are confirmed by an administrator, because several source spreadsheets can be read by anyone who has the link.

## D-006 Authorisation is enforced by security rules and callable functions, never by the interface

**Status:** accepted. The application spike verified the mechanism on the emulators.

Firestore security rules are the enforcement point for every direct read and write. Callable Cloud Functions are the enforcement point for privileged operations and for any change that spans several documents. The interface hides what a user may not do as a convenience only.

Because rules grant reads per document, field-level secrecy is achieved by splitting documents. A person has a directory document, a restricted contact document and a special-category demographics document. The demographics document is never readable by a client. It is served only through a callable function that checks the caller's grant and second factor, writes an audit entry and returns the data.

Roles are resolved into one access document per user, maintained by functions, which rules read with a single lookup. The spike wrote the same policy both ways and compared them. The access document was chosen over custom claims on the sign-in token because a revoked role stops working on the next request, where a claim keeps working until the token is refreshed up to an hour later, and because claims are capped at 1,000 bytes. Privileged reads and writes also require a second factor in the sign-in token whenever the access document says one is required.

## D-007 The audit trail is written by trusted code

**Status:** accepted.

Clients cannot write to the audit collection. Callable functions write an audit entry in the same transaction as the change they make. All other writes are captured by Firestore triggers that carry the identity of the writer and record the before and after state, with special-category and other configured fields omitted. Trigger delivery is at least once and may lag the write by seconds, so entries use the event identifier as their document identifier to stay idempotent.

## D-008 A laboratory and its participation in a replication are separate documents

**Status:** accepted.

A laboratory profile holds facts about the laboratory. A participation document holds everything specific to that laboratory in one replication, and its identifier is the replication identifier and the laboratory identifier joined together, which makes a duplicate participation impossible.

## D-009 Recruitment is an append-only series of reports

**Status:** accepted.

A report is created once and never edited or deleted, which security rules enforce. A correction is a new report that names the report it corrects. Counts are stored by category and by modality, where the modalities are main experiment, resting state and unique participants. A total number of participants is never produced by adding main-experiment and resting-state counts. Unknown values are absent and are never treated as zero. Replication-level figures found in historical workbooks are stored as historical aggregates and are kept apart from live reports.

## D-010 Pages use the BlockNote editor with Yjs documents stored in Firestore

**Status:** accepted. The editor spike verified the design on the emulators.

Workspace pages use BlockNote, an established block editor with slash commands, drag handles, nested blocks, tables and custom blocks. Only its packages under the Mozilla Public Licence are used. The packages whose names begin with `xl-` are licensed under the GNU General Public Licence or a commercial licence and are not used.

Concurrent editing uses Yjs, a conflict-free replicated data type. Each editor appends its updates as Firestore documents and receives the updates of others through realtime listeners, so no WebSocket service has to be operated. The spike showed two browsers typing at once in different blocks, in the same paragraph and at the same position converging on identical content, edits made offline reconciling on reconnection, and content surviving a reload. Accumulated updates are merged into a snapshot by a client transaction that any editor may run, and race tests showed that no concurrent update is lost. Version history is a series of named snapshots, and restoring one writes a new forward change.

Comments are anchored by positions stored in the Firestore thread document, because the editor's built-in anchoring writes a mark into the page content, which a person with comment-only rights is not allowed to do. Security rules give viewers read access only, let commenters write comments only, let editors append updates, and keep every update document immutable.

Two continuous typists used about 780 writes and 1,560 reads an hour at the recommended settings, well inside the daily allowance. Three matters carry into the build. Two defects in the pinned editor version can break collaboration and are covered by small tested guards that must ship with it. The formatting toolbar and side menu are not fully reachable from the keyboard and need work to meet the accessibility standard. The comment anchoring depends on a semi-internal part of the editor that must be re-checked on every upgrade.

## D-011 Views are computed in the browser over one authoritative set of documents

**Status:** accepted.

Each collection of records exists once. A view is a stored definition of filters, sorts, grouping and visible properties that the client applies to the documents it is permitted to load. The same record therefore appears in a programme dashboard, a replication page and a laboratory page as one document, and an edit in one place is visible everywhere at once. Scientific core fields keep strict schemas. Custom properties added by authorised users are stored in a dedicated map on the record, and user-created databases are collections of their own.

## D-012 Imports run from a trusted environment and preserve every source value

**Status:** accepted.

Importers are command-line tools that use the Firebase Admin SDK and run from an administrator's machine or a protected workflow, never from the public site. Each imported row is stored verbatim in a restricted collection, and every record created or updated is linked to the rows it came from. Document identifiers are derived deterministically from natural keys, so running an import twice changes nothing. Conflicts between sources are queued for human review and are never resolved by choosing a value arbitrarily. The identifiers and addresses of the source documents are held in private configuration, and this public repository refers to the sources by letter and title only.

## D-013 The replication identifier is the programme's existing study identifier, unchanged

**Status:** accepted.

The canonical identifier of a replication is the `StudyId` already used on the public website, in the list of studies and in the naming conventions, for example `AmodioJost2007`. All twenty-seven identifiers are identical across those sources. Every other spelling that appears in a source, such as a tab name with a trailing underscore or a spelling with a diacritic, is stored as an alias and resolved through a case-folded and diacritic-folded lookup. Existing identifiers are never renamed. An alias is unique only together with its replication, because the two Amodio replications share one BIDS name and one EEGNet name in the naming conventions.

## D-014 Background work runs in Cloud Functions in London, behind adapters

**Status:** accepted.

Scheduled jobs, retrying task queues and integrations with Google Workspace, Quire, storage servers and the public website run in second-generation Cloud Functions in `europe-west2`. Each external system sits behind an interface with a real implementation and a fake used in tests. Any adapter that writes to an external system defaults to a dry run, and a live external write needs explicit approval.

## D-015 Sign-in is passwordless

**Status:** accepted.

Members sign in with a single-use link sent to their email address, or with Google through a pop-up window. The portal has no password field, which follows GitHub's guidance that Pages should not be used for sending passwords. Programme administrators and the core team must enrol a time-based one-time password as a second factor.

## D-016 Tests run against the Firebase Emulator Suite

**Status:** accepted.

Development and automated tests use the local emulators for Authentication, Firestore, Functions and Storage with a demonstration project identifier, so no test contacts a real project. Security rules have unit tests that prove each denial. Functions have integration tests. Critical journeys have browser tests. The emulator does not implement time-based one-time passwords, so the second-factor journey is verified on the staging project once it exists.

## D-017 Staging is a second Firebase project and a second Pages site

**Status:** recommended.

Staging uses its own Firebase project holding synthetic data only, and a separate Pages site so that it shares the header, cache and routing behaviour of production. Creating the second repository and its domain records needs an organisation owner.

## D-018 The portal follows the typography and contrast of the public site as it is actually rendered

**Status:** accepted.

Measurement of the built public site showed that DM Sans is the only typeface rendered, including in headings, and that Fraunces is declared in the stylesheet without being used. The portal therefore sets all text, including page titles, in DM Sans, self-hosted. White text on the coral `#d84b4d` measures 4.17 to 1, which meets the contrast requirement for large text only. Dense controls in the portal, where labels are small, use the deep coral `#a9353a`, on which white measures 6.45 to 1. The coral remains the accent for focus rings, indicators and large calls to action.

## D-019 Recruitment reports and status changes are written by callable functions

**Status:** accepted. This refines D-009.

A recruitment report is submitted through a callable function that checks the caller's scope, validates every category and count against the configured categories, writes the report, updates the replication's summary and writes the audit entry in one transaction. A change of a replication's status is likewise a callable function that writes the status history entry in the same transaction. Clients can read these records within their scope and can never create, edit or delete them directly, which gives stronger validation than security rules can express and keeps the history complete.

## D-020 The scientific records are append-only and written by callable functions

**Status:** accepted. This refines D-009 and D-019.

Analysis runs, the methodological decision log, incidents and their actions, authorship lists and their entries, and the findings of a hypothesis are written only by callable functions, which check the caller's capability in the scope of the record, validate references to datasets, deviations and manuscripts of the same replication, and write the audit entry in the same transaction. The decision log and the incident registry are append-only: a correction, a replacement, a corrective action or a change of status is a new document that names what it follows, and views read each record as it stands after them. An original statistic or a result of a hypothesis is never stored without its provenance (source, locator, recorder and time), so nothing is presented as a finding that nobody vouched for. Each contributor answers only their own authorship entry, for the revision they read. External services such as OSF are reached through an interface with an in-memory fake; the real adapter is written but unverified until staging.

## D-021 Publishing goes through an allow-list and a pull request, and automations are built-in rules run through the job queue

**Status:** recommended. This applies D-014 to publishing and automation.

An export to the public website reads only the fields named on an allow-list for each output and parses the result with a strict schema, so a field the data model gains later is never published, and a test plants private values and finds none in any file, the pull request or its body. The files are previewed against `main`, built with the site's own Syrinx build in a scratch copy by a person on a trusted machine (`npm run publish:verify`), and approved with a second factor against the hash of the files that were built. The portal then opens a pull request, which deploys the shared staging site, and never merges: a maintainer does, as today. A rollback is proposed as a pull request that restores the previous files. The GitHub adapter is reached only through an interface with an in-memory fake; the real adapter is written and has never been executed.

Automations are five built-in rules defined in code (onboarding checklist, QC task, leads told when a target is met, progress reports and overdue updates), which an administrator switches on or off, limits to a replication or runs on demand. Administrators choose among fixed events and actions and never write a trigger or a script. Each run is a logged document and a job of the existing queue, so retries, backoff and failures follow phase 6. A chain of automations stops at depth 3 and never runs a rule twice in one chain. Email leaves only through the `mail` outbox, behind a sender interface with a fake; no provider exists until decision 7 is taken. Counts of people in an analysis are suppressed below five, and demographic counts are served only by the audited function to holders of a named grant. No AI feature is built, because no model provider has been approved.

## Decisions needed from the programme administrators

1. Confirm a billing account on the Firebase Blaze plan, with a named owner and budget alerts, and the upgrade to Authentication with Identity Platform.
2. Confirm London (`europe-west2`) as the permanent location for Firestore, Functions and Storage.
3. Decide whether processing of sign-in account data in the United States by Firebase Authentication is acceptable for the programme.
4. Confirm `portal.eegmanylabs.org` as the portal address, or choose the default Pages address.
5. Accept the security posture of GitHub Pages described in D-001, or ask for the portal's static files to be served another way.
6. Decide whether the portal source stays in this repository or moves to one of its own.
7. Provide read access to sources A and G through a Google service account, a Quire export or API token, and a mail provider for notification email.
8. Restrict link sharing on source F and the contributor sheets once the import has been verified.

### Answers given on 13 November 2026

The programme lead answered the questions above, and those of `docs/MIGRATION_PLAN.md` section 11, on 13 November 2026. These answers authorise the work they describe. They authorise no deployment, live external write or contact with users, and each of those still needs its own approval.

Decisions 1 to 5 are taken. The programme lead owns the billing account on the Blaze plan, with Identity Platform and budget alerts. London (`europe-west2`) is the permanent location. Processing of sign-in account data in the United States by Firebase Authentication is acceptable and is to be stated in the privacy notice and the impact assessment. The portal address is `portal.eegmanylabs.org`, which needs a DNS record. The security posture of GitHub Pages in D-001 is accepted. On decision 6, the portal moves to a repository of its own, with its history. On the deployment roles, the programme lead acts as both operator and approver for now, which removes the two-person check of `docs/DEPLOYMENT.md` until a second administrator is named; production still waits for that second person. The backup retention in `BACKUP_RETENTION` is agreed: daily backups 7 days, weekly backups 14 weeks, managed exports 98 days and the governance ledger 10 years.

On governance, the lawful basis for members' personal data is public task. Gender and ethnicity from source G are held only for members who give explicit consent, and are left blank for everyone else. Claude drafts the data protection impact assessment and the privacy notice from `docs/SECURITY.md` for review by the University's data protection officer. Raw source records and exported files, including the outreach correspondence of source F, are kept until the migration is verified and then for one year, after which the outreach records of people who never joined are deleted.

On decision 7, sources A and G and the Quire data arrive as exported files that the programme lead supplies, imported in a private local environment and never committed, so no service account is created for now. No notification email is sent for now, and notifications stay inside the portal. On decision 8, link sharing on source F and the contributor sheets is to be restricted once the import has been verified.
