# #EEGManyLabs Hub: integrations

This document is the design of every connection between the members' portal and a system outside it: Google Drive, Sheets and Docs, Quire, OSF and the DOI system, the website repository on GitHub, the institutional servers that hold research data, and email. It follows `docs/DECISIONS.md`, whose entries are cited as D-001 to D-021 and whose closing list is cited as decision 1 to decision 8. It should be read with `docs/ARCHITECTURE.md` for the system boundary, `docs/DATA_MODEL.md` for the documents named here, `docs/SECURITY.md` for secrets and restricted data, and `docs/SOURCE_REGISTRY.md` and `docs/MIGRATION_PLAN.md` for the sources, which are referred to by letter and title only (D-012).

> **Status.** No integration has been run against a live external system, because no credentials exist: no Google service account, no Quire authorisation, no credential for the website repository, no mail provider, no account on any research data server and no Firebase project. Google Drive, Sheets and Docs are built against an in-memory fake (phase 6): the interfaces, the fake, the synchronisation planner, the job runner, generated documents and the administration pages are under `portal/` and their tests pass on the emulators. The real Google adapters under `portal/functions/src/integrations/google/real/` are written and have never been executed, so every behaviour of Google that they rely on is unverified. Section 3.8 states what was built and where it departs from the design. The research data servers of section 7 are built the same way (phase 7): the storage interface, its fake, the scan engine and the dataset registry are under `portal/` and tested on the emulators, and the real storage adapters under `portal/functions/src/integrations/storage/real/` are written and have never been executed, so every behaviour of a server that they rely on is unverified. Section 7.1 states what was built. OSF is built the same way in phase 8: the interface, an in-memory fake and the callable function that checks a linked page are tested on the emulators, and the real adapter is written and has never been executed (section 5). Phase 9 built publishing to the website repository and the email outbox the same way: a fake of the repository, a fake mail sender, the functions that use them and the administration pages are tested on the emulators, the real GitHub adapter is written and has never been executed, and no adapter for a real mail provider exists (sections 6.1 and 8.1). Everything else below is a design. It is written in the present tense, and nothing in it exists as code unless the sentence says so. Discovery made a handful of anonymous requests to public addresses, which are cited as observed. Each integration ends by separating what can be built and tested now against a fake from what is blocked until credentials are supplied.

Five evidence levels are used, and a statement names its level wherever the context leaves it open.

| Evidence level | Meaning |
|---|---|
| Emulator | Verified by the application spike of 9 November 2026 against the Firebase Local Emulator Suite. The spike was throwaway code kept outside this repository, so the portal's own tests have to re-establish each result. |
| Documentation | Stated in vendor documentation read on 9 November 2026 and cited in the references. Vendor behaviour can change. |
| Observed | Seen during discovery in an anonymous request to a public address, made without any credential. Requests to linked documents were status-only and their content was discarded. |
| Designed | Specified here and not yet built or run. |
| Unverified | Cannot be settled until a live account or a staging Firebase project exists. |

## 1. Principles

D-014 fixes the shape of every integration. The principles below state it in full and add what discovery showed to be necessary.

**Adapters behind interfaces, with a fake for tests.** Each external system is reached through a narrow interface defined in `portal/functions`. A real implementation calls the system, and a fake held beside it implements the same interface in memory and serves every automated test (D-014, D-016). The logic that decides what to do, such as the synchronisation planner, the document generator and the Quire normaliser, depends on the interface alone and is written as pure functions of its inputs. A fake earns its place only if it reproduces the behaviour the design relies on, including the awkward parts: quotas, stale revisions, expired channels and lost access. A fake is written from vendor documentation, so a pass against it shows that the portal's logic is right and shows nothing about the vendor. Each section therefore lists both what its fake has to reproduce and the checks that wait for a live account.

**Least privilege.** Each external system is reached under an identity of its own with the smallest reach that does its job. The Google adapter reaches only the files that their owners have shared with its service account and requests only the scopes of the job in hand. A storage account for metadata scans has read-only listing rights. The publishing credential can create a branch and open a pull request on one repository. The Quire authorisation selects none of the optional permissions, which Quire then shows as read only. Secrets are held in Secret Manager, declared through function parameters and bound to the functions that need them, and a document that needs a credential stores the name of the secret and never its value.[1] On the emulators a function received a declared secret from the local secrets file that the emulator reads (Emulator). Secret Manager itself is unverified until staging.

**Dry run by default.** Every adapter that can write to an external system starts in dry run. A dry run performs every read, computes the plan, stores the plan with its differences in the run record and shows it to an administrator. It omits only the external write.

**Explicit approval before a live external write.** Moving a mapping, a document template, a publication or outbound email from dry run to live is a separate act by a programme administrator. It goes through a callable function that writes the approver, the time and the scope to the audit trail in the same transaction (D-007). Approval covers one mapping, one template or one publication at a time and can be withdrawn, which returns the adapter to dry run. An adapter that only reads has no such switch, and its first connection still waits for credentials that an administrator supplies.

**Idempotency.** Every job can run twice without doing its work twice, and three techniques provide this. Identifiers are deterministic: an external object maps to one portal document through `integrationMappings`, whose identifier is the system joined to a hash of the external identifier, and a conflict or a proposal is keyed on its mapping, row and field. Plans are computed from state: the planner compares the current values on both sides with the last synchronised value, so a repeated run finds nothing to do. Deliveries are deduplicated: a Firestore trigger is delivered at least once and a webhook can be replayed, so each consumer records the event or message identifier it has handled.[2] Imports follow the same rule under D-012, and the spike's import wrote nothing on its second run (Emulator).

**Retry with backoff through a queue held in Firestore.** Background work that calls an external system runs as a job of a queue whose records live in Firestore, and never inside the request that asked for it. The design first named Cloud Tasks for this. Phase 6 built the queue in Firestore instead, so that the emulators run it, the jobs page reads the same records and no job payload leaves the database (D-014, D-021). Each job is a `syncRuns` record whose identifier is derived from its subject and the event that started it, so a repeated event enqueues one run. A Firestore trigger runs a record that becomes `queued`, after moving it to `running` in a transaction, so of two deliveries of the trigger one runs. Retry has two layers. Inside a run the adapter retries a throttled or failing request with exponential backoff and random jitter (for Google, 1 second doubling to 32 seconds, five attempts). When it gives up the run fails, waits with a backoff of one minute doubling to an hour, and is queued again by the ten-minute `integrationsSweep`; after six attempts it is dead-lettered and shown for a person to retry. A lease in `syncLeases` keeps one run at a time on a spreadsheet. The queue carries four kinds of job: sheet synchronisation, document updates, the Drive change feed and automations (section 9). The code is in `portal/functions/src/integrations/jobs/queue.ts` and `runner.ts`, and its behaviour is tested on the emulators against the fakes in `portal/tests/functions/integrations-runner.test.ts` and `reporting.test.ts`.

Some work stays outside that queue. A short call for which a person is waiting runs in the callable function itself: the Drive reads of section 3.2, the single-cell write that resolves a conflict in section 3.3, a metadata scan of a research data server (section 7.1), a check of an OSF page (section 5), and each step of publishing (section 6.1). Email has an outbox of its own with the same pattern of a record claimed by a trigger, retried with backoff and swept on a schedule (section 8.1), and pull requests are read by an hourly sweep. Neither the queue nor the outbox has a concurrency limit of the kind Cloud Tasks would give, and the sweeps run on Cloud Scheduler, which is absent from Google's list of services with a data residency commitment;[5] a sweep carries no data of its own. The Functions emulator never retries a trigger on failure,[6] so the backoff and the sweeps are tested under a controlled clock, and how the triggers and schedules behave on a real project is unverified until staging. Task queue functions, with their limit of 1,800 seconds for one task,[3] [4] remain the option for a job that outgrows a trigger.

**Visible health and recoverable failure states.** Every connection, mapping and job has a recorded state that administrators can see (section 9). A failure ends in a named state that says what happened and offers an action: retry, pause, resume, link again or resolve. When an adapter cannot be sure, it stops and asks. A mapping whose key column has gone, a document whose managed section was edited by hand and a file to which access was lost are each paused with a reason, and nothing on either side is deleted as an automatic response. During an outage of an external system the portal's own records stay readable, with the last known external state and its time.

Integration code runs in five places. The four kinds of function run in `europe-west2` (D-014), and the import tools run in the trusted environment that D-012 names.

| Kind of work | Where it runs | Why | Evidence |
|---|---|---|---|
| An action started by a person: browse a folder, request a dry run, approve a live write, resolve a conflict | Callable function, restricted to the portal's origin | It authorises the caller and writes the audit entry with the change | Emulator for callable functions in general, which the spike ran with the default cross-origin setting. The restriction to the portal's origin is documented and designed. The integration functions are built and tested on the emulators against the fakes |
| Calls to an external system in the background: synchronisation, document generation, the Drive change feed, automations, mail | The Firestore-backed queue of `syncRuns`, or the `mail` outbox, each run by a Firestore trigger and swept by a scheduled function | Retry with backoff, one run of each job, the same records for the jobs page | Built and tested on the emulators against the fakes (sections 3.8, 8.1 and 9). Triggers and schedules on a real project are unverified until staging. Scans, OSF checks and the steps of publishing run in the callable function a person starts (sections 5, 6.1 and 7.1) |
| Timed work: polling, channel renewal, nightly reconciliation, link checks, digests | Scheduled function[7] | No request is waiting for the result | Emulator: a scheduled function was invoked over HTTP, since the emulator runs no schedule. The schedule itself is unverified until staging |
| Notifications sent by Drive | HTTPS function open to the internet | Drive needs a public HTTPS address, and GitHub Pages serves static files only | Documentation. Unverified until staging |
| Imports and the Quire migration | Command-line tools on an administrator's machine or in a protected workflow, which write through the Admin SDK | D-012. They hold wide rights and never run from the public site | Emulator: the spike's import was idempotent, had a dry run and refused a real project without an explicit flag |

## 2. Summary of integrations

The status column uses three words. Designed means specified here with no code. Built against a fake means that the adapter, its fake and its tests exist under `portal/` and pass on the emulators. Blocked names what the live connection waits for. The three Google rows, the research data servers, OSF, GitHub and the notification email have reached the second state. Their real adapters are written and unverified, except for email, which has no real adapter because no provider has been chosen. The row for sign-in links stands apart, because Firebase Authentication sends them and no adapter is involved. The table is brought up to date as adapters are built, and test results belong in `docs/TEST_REPORT.md`.

| Integration | Purpose | Direction | Authentication model | Where it runs | Status |
|---|---|---|---|---|---|
| Google Drive | Link folders and files to records, browse them, detect that a file changed | Read | A dedicated service account, with each file or folder shared to it by its owner | Callable, HTTPS, scheduled and Firestore-triggered functions | Built against a fake. Real adapter written, unverified. Blocked: no service account |
| Google Sheets | Two-way synchronisation of designated tabs, field by field | Read and write | The same service account, with edit rights on the designated sheets | A Firestore-backed job queue run by a trigger | Built against a fake. Real adapter written, unverified. Blocked: no service account. Each live mapping also needs approval |
| Excel workbook held in Drive (source A, the historical replication coordination workbook) | One-off import | Read | The same service account with read access, or a file supplied by an administrator | Import tool in a trusted environment | Designed. Blocked: source A refuses anonymous access |
| Generated Google Docs | Reports created from templates, with managed sections kept current | Write, with detection of hand edits | The service account as a member of a shared drive, or a named person's OAuth grant. The administrators choose | A Firestore-backed job queue run by a trigger | Built against a fake, in a shared drive only. Real adapter written, unverified. Blocked: no service account, and no decision on where documents are created |
| Quire (source I) | One-off migration of projects, tasks and comments | Read | OAuth 2.0 authorisation by an administrator of the Quire organisation, held on that person's machine | Command-line pull and import in a trusted environment | Designed. Blocked: no export file and no authorisation |
| OSF | Health and metadata of linked resources | Read | None. Public interface | `checkOsfLink`, on request of a lead, later a scheduled function | Built against a fake. Real adapter written, never executed and unverified. No credential is needed. Switched on by `OSF_CHECKS_ENABLED` |
| DOI resolver and Crossref | Check that a DOI resolves, and verify citations | Read | None. Public interfaces | The same | Designed. No credential is needed. Crossref's interface has still to be read |
| GitHub | Publish approved public fields to the website through a pull request | Write | A credential limited to branches and pull requests on this repository | Callable functions started by an administrator, and an hourly sweep | Built against a fake. Real adapter written, unverified. Blocked: no credential, and each pull request needs approval |
| Research data servers | Metadata scans for the dataset registry | Read | One read-only account for each endpoint, held as a secret reference | A callable function started by a person, a nightly scheduled check, or a manifest uploaded from inside the institution | Built against a fake. Real adapters for SFTP, FTPS, institutional file systems and object storage written, unverified. Blocked: no protocol or account has been agreed with any institution |
| ElectroTag | Optional link from a dataset to a viewer | Link only | None | No adapter | Built: a link for a copy that declares support, served and recorded by a function |
| Email, sign-in links | Passwordless sign-in (D-015) | Send | Firebase Authentication | Firebase Authentication | Verified on the emulators by the spike. Delivery from a real project is unverified until staging |
| Email, notifications and digests | Notification, digest and report email | Send | A mail provider key in Secret Manager | Firestore-triggered and scheduled functions over the `mail` outbox | Outbox built against a fake sender. No real adapter, because no provider has been chosen. Blocked: no mail provider |

Google Workspace, the research data servers, OSF and publishing to the website are now built against fakes, the email outbox against a fake sender, and the Quire importer and the citation check have code of their own. The table below separates what exists, what its tests prove and what only a live account can settle. Every test named here runs on the Firebase emulators with project `demo-eegml`, against an in-memory fake whose fixtures are synthetic and labelled so, and no test reaches Google, GitHub, OSF, a mail provider or any server. The fakes, the planners and the job queue are evidence that the portal's own logic behaves as designed. They are no evidence of how Google or an institution's server behaves.

| System | Built | Tested against a fake | Unverified until credentials exist |
|---|---|---|---|
| Google Drive, Sheets and Docs | The interfaces in `portal/functions/src/integrations/google/types.ts`, the fake in `google/fake/`, the real REST adapters in `google/real/`, the choice of adapter in `google/adapters.ts`, the synchronisation planner and document generator in `portal/shared/src/sync/` and `portal/shared/src/docs/`, the job queue in `portal/functions/src/integrations/jobs/`, thirteen callable functions, five triggers or schedules, and the pages of `#/admin/integrations` | Drive links and their guards, browsing and file details, the change feed and push channels, two-way synchronisation of laboratories and equipment with conflicts and review items, dry runs and approval of live writes, quotas, outages and lost access, generated documents with hand edits and the designated field, and acceptance scenarios AS-3 (its synchronisation), AS-9, AS-10 and part of AS-15. The tests are in `portal/shared/src/sync/`, `portal/shared/src/docs/`, `portal/tests/functions/integrations.test.ts`, `integrations-runner.test.ts`, `redteam/google-drive-deputy.test.ts`, `portal/tests/rules/integrations-features.test.ts` and `portal/tests/e2e/integrations.spec.ts` | Every request of the real adapters, which have never been executed: authentication from the metadata server, the scopes, sharing with a service account, row metadata after a sort, named ranges after a replacement, push delivery, the listing of permissions and the real quotas (section 3.7) |
| Research data servers | The storage interface in `portal/functions/src/integrations/storage/types.ts`, the fake in `storage/fake.ts` with `storage/fixtures.ts`, real adapters for SFTP, FTPS, a mounted file system and object storage in `storage/real/`, the scan engine, the dataset registry with eighteen callable functions, the nightly `storageSweep`, and the pages of `#/datasets` | Registration, copies and relocations, path guards, scans that read checksum files only, manifest comparison, outages and recovery, transfers with approval, BIDS reports, quality control, the workflow, viewer links and acceptance scenario AS-8 and part of AS-15. The tests are in `portal/shared/src/datasets/`, `storage/scan.test.ts`, `storage/real/credentials.test.ts`, `portal/tests/functions/datasets.test.ts`, `redteam/datasets-storage-deputy.test.ts`, `portal/tests/rules/datasets-features.test.ts` and `portal/tests/e2e/research-data.spec.ts` | Every behaviour of a real server, since no institution has agreed a protocol or issued an account and the real adapters have not been run even against a local test server, and the binding of the secrets of servers added after deployment (section 7) |
| GitHub publishing | The repository interface in `portal/functions/src/integrations/github/types.ts`, the fake in `github/fake.ts`, the real REST adapter in `github/real.ts`, the allow-list, generator and difference in `portal/shared/src/publishing/`, five callable functions, the hourly `publicationsSweep`, the `publish:verify` command of `portal/tools/` and the pages of `#/admin/publishing` (section 6.1) | Preview, the staging build with Syrinx in a scratch copy, approval with a second factor, the pull request and its body, the one-open-request rule, merge detection, withdrawal, the rollback proposal, lost access and acceptance scenario AS-13. The tests are in `portal/shared/src/publishing/publishing.test.ts`, `portal/tests/architecture/website-contract.test.ts`, `portal/tests/functions/reporting.test.ts`, `portal/tests/tools/publish-verify.test.ts`, `portal/tests/rules/reporting-features.test.ts` and `portal/tests/e2e/reporting.spec.ts` | Every request of the real adapter, which has never been executed, the protection of `main`, and the redeployment of the shared staging site by a real pull request |
| Email notifications and digests | The outbox in `portal/functions/src/notifications/mail.ts`, the sender interface and its fake in `integrations/mail/`, digests in `portal/shared/src/digest/` (section 8.1). No real provider adapter | Queuing, preferences, quiet hours, retries, rejected addresses and weekly digests, in `portal/tests/functions/reporting.test.ts` and `portal/shared/src/digest/digest.test.ts` | Everything a provider does, since none has been chosen |
| OSF | The interface `OsfAdapter` in `portal/functions/src/integrations/osf/types.ts`, the fake in `osf/fake.ts`, the real adapter in `osf/real.ts`, the choice of adapter in `osf/adapters.ts`, the callable `checkOsfLink` and the Registered Reports tab of a replication (section 5) | A public page, a missing one, a private one, a withdrawn registration, rate limiting and an outage, in `portal/functions/src/integrations/osf/fake.test.ts`, `portal/tests/functions/scientific.test.ts` and `portal/tests/e2e/scientific.spec.ts` | Every request of the real adapter, which has never been executed, the fields OSF actually returns and its real limits |
| Quire and the DOI system | The Quire importer of `portal/tools/` reads a dump, and the citation check of `portal/tools/` is tested against a local stand-in for Crossref | The Quire importer against a synthetic dump | Everything that reaches the live service |

## 3. Google Workspace

Google Sheets, Docs and Drive stay fully usable on their own. The portal joins them as one named collaborator that owners can remove at any time. Nothing was run against a Google interface. What is built runs against the fake of section 3.8, section 3.7 lists the live checks on which the design still depends, and section 3.8 records where the build departs from the design.

### 3.1 The authentication model and its limits

A server can act on Workspace files in three ways.[8] [9] [10]

| | Service account with files shared to it | A person's OAuth consent | Domain-wide delegation |
|---|---|---|---|
| Who acts | The service account, as itself | A named Google account | The service account, impersonating any user of a Workspace domain |
| Set-up | Each file or folder is shared with the account's address in the ordinary sharing dialog | A consent screen, a client identifier and secret, and a stored refresh token | A super administrator of the domain authorises the client and its scopes |
| Needs a Workspace domain | No | No | Yes |
| What it can reach | Exactly what has been shared with it. Roles on the cloud project grant nothing in Workspace | What the granted scopes allow for that person | Any user's data in the domain, within the authorised scopes |
| Owner of the files it creates | It cannot own files | The person | The impersonated user |
| Stored secret | None | A refresh token, which stops working when it is revoked or unused for six months | None |
| Quota | Counted as one user | Counted for each person | Counted for each impersonated user |

The portal uses the first model. One dedicated service account is the runtime identity of the Google functions, of the user-managed kind that Google recommends for a Cloud Run service, and the owner of each designated sheet, document and folder shares it with that account's address.[11] The model fits Cloud Functions because nothing has to be stored: the function asks the platform's metadata server for a short-lived token, and Google documents that the metadata server honours requested scopes on Cloud Run functions.[12] Whether the Node.js authentication library obtains Workspace scopes that way is unverified, and the documented fallback is the IAM Credentials interface, which issues a token for a stated list of scopes.[13] There is no consent screen and no refresh token to expire. A protected GitHub Actions workflow can reach the same identity through workload identity federation with no stored key, which is the route designed for the import tools that read source A and source G, the membership and contributor workbook.[14] The identifier of a service account cannot be changed after creation, and people will type its address into sharing dialogs, so a readable one is chosen once.[8] The address is shown to file owners inside the portal and is never written in this repository.

Domain-wide delegation is rejected: it needs a Workspace domain and a super administrator, and it reaches far more than the task requires. A member's own Google sign-in (D-015) proves identity only. It requests no Drive scope, it gives the portal no access to the member's files, and the service account never acts as the member.

The model has five limits.

| Limit | Fact | Consequence |
|---|---|---|
| File ownership | "Service accounts don't have storage quota and can't own files." They upload into shared drives or act for a person through OAuth.[15] One other Drive guide says that a service account becomes the owner of a file it creates, which contradicts this.[16] | Editing files that are shared with the account is unaffected. Creating a generated document is treated as impossible outside a shared drive until a live test shows otherwise, and the administrators choose one of the routes below |
| Quota | The calls of a service account count as one user: 60 Sheets reads and 60 Sheets writes a minute.[17] | All synchronisation shares one allowance (section 3.3) |
| Sharing policy | A service account is a member of no Workspace domain.[9] An institution that forbids external sharing may therefore stop a member from sharing a file with it, which is inferred and unverified | Such a file cannot be connected. The fallback is a person's OAuth grant |
| Scopes | The narrow file scope `drive.file` is classed as non-sensitive, the Sheets and Docs scopes as sensitive and the wider Drive scopes as restricted.[18] [19] [20] Whether `drive.file` alone opens a file shared through the sharing dialog is unstated, and its wording suggests that it does not | Each job requests the Sheets or Docs scope it needs with read-only Drive metadata, and a content scope where a workbook is downloaded. The smallest working set is a live check |
| Google's verification | A service account acting as itself shows no consent screen, so there is nothing to submit. Google exempts a service account that reaches only its own data, and the page does not address files that people share with one.[21] | Unverified. The fallback is a person's OAuth grant with `drive.file`, which needs brand verification only |

Because the account cannot own files, the administrators have to choose how generated documents come into existence. The choice is theirs and the design supports all three.

| Route | What it needs | What follows |
|---|---|---|
| A shared drive with the service account as a member | A Workspace edition that offers shared drives, and a manager of the drive to add the account. A personal Google account cannot create a shared drive.[15] Whether the programme has such an edition is unknown | The portal creates documents by itself, and they sit in a drive that has no individual owner. Preferred |
| A named person's OAuth grant with `drive.file` | A consent screen, the template chosen once through Google's file picker, and the refresh token held in Secret Manager | That person owns every generated document, and generation stops if the grant lapses. Google's own guidance is that instances of a template are created with end-user credentials.[22] |
| Copies made by hand | A person copies the template, shares the copy with the service account as an editor and pastes its link into the portal | Nothing to configure. The portal then keeps the managed sections current. One manual step for each document |

### 3.2 Drive: links, browsing and change detection

**Linking.** A Drive folder or file is attached to a replication, a laboratory, a dataset, a manuscript or any other record as a `documentLinks` document of kind `driveFolder`, `googleDoc` or `googleSheet`. A member pastes the address. A callable function asks Drive for the item's name, type, shared drive, trashed flag, web address and capabilities, and stores the link with its access status. When the service account has no access, the interface shows the account's address and the exact sharing step, and the link is kept as `restricted`. Until credentials exist a link is stored as written with the status `unknown`, which is how every link found in the sources starts. The portal's account reaches more than any one person, so its reach is never lent: a link is refused for an item that is, lies in or holds a registered source, a template, the folder that receives generated documents or a generated document, and, unless the caller administers the integrations, for an item whose Drive permissions do not name the caller's verified address as an owner or editor, or that another replication's or laboratory's record links already. A link kept as `restricted` opens nothing until someone who controls the item checks it again.

**Browsing and metadata.** Opening a linked folder calls a function that lists its direct children, folders first, with one request for each page of up to 1,000 items, under a narrow field mask and with the shared-drive flags set, since a missing flag typically shows as a 404 on an item in a shared drive.[23] [24] There is no recursive crawl. The listing shows each item's name, type and modification time and, where Drive supplies them, the last modifying user and the owner. Drive leaves the owner empty for items in shared drives.[25] Results are cached briefly in Firestore and invalidated by the change feed. An item opens at Google's own address for it, so Google applies the member's own permissions and the portal never relays file content. A preview inside the portal is outside the design. The list of people with access to an item is fetched on demand and shown only to the coordinators of the workspace. Sharing a folder with the portal's account lets every member who can see that workspace see the names of the files in it, and the linking dialog says so.

**Change detection.** Drive reports that a file changed and never what changed: a change carries no difference between revisions, and an application that needs one has to keep the previous state and compare.[26] The Sheets interface has no change feed of its own.[27] Detection therefore has three layers, and the cell comparison of section 3.3 does the rest.

| Layer | Mechanism | Limits |
|---|---|---|
| Push | One notification channel on the change log of the service account, which by inference from the documentation lists what is shared with it, and one on each linked shared drive | A channel lasts at most one week and cannot be renewed, so a daily scheduled function opens a replacement and then stops the old one. A message has headers and an empty body. The delay after an edit made in the Sheets or Docs editor is undocumented.[28] |
| Polling backstop | A scheduled function reads the change feed from its stored page token every 10 to 15 minutes | 100 Drive quota units for each call.[29] It covers an expired or missed channel |
| Nightly reconciliation | Every live mapping is compared in full, whatever the file version says | One Sheets read for each mapped tab |

The receiver of push messages is an HTTPS function that anyone on the internet can call, because Drive needs a public HTTPS address with a valid certificate. Domain verification is no longer required for such an address.[30] The function treats a message as a hint and nothing more. It looks up the channel identifier, compares a hash of the channel token with the stored one, answers 404 to anything unknown, ignores the first synchronisation message and any message number it has already seen, enqueues a task that drains the change feed, and returns at once. The task follows the feed from the stored page token, which does not expire, saves the new token and enqueues a synchronisation for each changed file that is linked.[31] A change marked as removed does not distinguish deletion from loss of access, so the linked file is marked as lost or deleted and its mappings are paused for a person to examine.[26]

Each run begins by reading the file's `version`, a number that Drive raises on every change.[25] When it equals the version stored by the previous run and no portal change is waiting, the run ends after that one inexpensive call. Members are told that an edit in a sheet reaches the portal within minutes and are promised nothing faster. Three alternatives were set aside: a channel on a single file expires daily, creating a subscription in the Workspace Events interface typically requires a person's authorisation, and an Apps Script edit trigger needs a script installed in every spreadsheet.[28] [32] [33]

### 3.3 Sheets: two-way synchronisation

Two facts about the Sheets interface shape the whole design. It has 17 methods and none of them watches or lists changes, so a changed cell can be found only by comparing the sheet with a stored copy of what was last synchronised.[27] It has no revision identifier and no write precondition, so a write cannot be refused because the cell changed after it was read. The first fact is answered by the three-way comparison below. The second is a boundary that the design states and cannot remove (section 3.6).

#### The mapping model

A mapping is one `syncMappings` document that ties one tab of one spreadsheet to one collection of portal records. Mappings are created and edited by programme administrators in the administration console. Columns that hold gender, ethnicity or any other special-category value cannot be mapped, and which other columns are synchronised is the administrators' decision, since a synchronised sheet places data in Google Workspace under terms and location settings of its own.

| Element | Definition |
|---|---|
| Spreadsheet | A native Google Sheet. The adapter reads the Drive type first and refuses anything else (section 3.4). Its identifier is held in the mapping and never in this repository |
| Tab | Identified by its numeric sheet identifier, which stays the same when the tab is renamed, and never by its title.[34] The region is the whole tab, a named range or a table, which covers a header below row 1 and a tab that also carries notes |
| Target | A collection key such as `core:replications`, with a scope that limits which records take part |
| Row key | A key column, several columns joined, or developer metadata alone for a small tab |
| Columns | Each mapped column is found first by a metadata tag on the column and then by its header text, trimmed and compared without case. A column that cannot be found switches its field off for the run and raises an issue. The engine never guesses |
| Field type | Text, number, boolean, date, date and time, enumeration with a value map, list or link. Each type has one canonical form for comparison |
| Direction | One of the four values below, set for each field |
| Row policy | What happens when a row or a record exists on one side only |
| Limits and triggers | A ceiling on cells written in one run, the polling interval and the daily reconciliation |

Values are compared in canonical form: text is normalised and line endings unified, numbers are compared as numbers, a date is converted from the sheet's serial number with the spreadsheet's own time zone, and an empty string, a missing cell and an absent value are one value. Reads ask for unformatted values, because a formatted value depends on the spreadsheet's locale and the cell's format.[35]

| Direction | Owner of the value | Portal to sheet | Sheet to portal | When both sides changed |
|---|---|---|---|---|
| Application authoritative, `appAuthoritative` | The portal | Written | Never. An edit made in the sheet is overwritten on the next run, and the value it held is logged | The portal value stands |
| Sheet authoritative, `sheetAuthoritative` | The sheet | Never | Written. The portal shows the field as read only | The sheet value stands |
| Bidirectional with conflict review, `bidirectional` | Either | Written, or proposed for review, as the mapping says | The same | A conflict record. Neither side is written |
| Generated output, `generated` | Computed by the portal, for example a link back to the record | Written | Never read back | The computed value stands |

The requirements name a fifth arrangement, a manual document with generated sections. It applies to Google Docs and is the subject of section 3.5.

#### Row and column identity

Rows are identified by a key and never by a row number. The key column is the identity of record, because a key travels with its row through sorting, filtering, cutting and pasting, and export. People can break it by duplicating a row or clearing a cell, so every run looks for duplicate and blank keys. Rows that share a key are all left out and flagged, and a row with no key is ignored.

Developer metadata serves as a verified write address. Each data row carries its key as metadata on the row, and Google documents that such metadata stays with its row when rows are inserted above it and is deleted with the row.[36] A run compares the metadata of every row with the row's key cell. Where they agree the row is anchored. Where they differ or the metadata is missing, as after a sort, a paste or a new row, a live run rewrites the metadata from the key column in one request and continues, and a dry run records the repair in its plan. A write then addresses the row by its metadata identifier, which the server resolves to the row's position at the moment of writing.[37] A row that a person inserts or deletes between the read and the write therefore cannot shift the write onto a neighbouring row. That conclusion is inferred from the documented behaviour and is a live check. As a second guard, the write asks for the row's values in its response, which include the key cell. If the key is another row's, the engine restores the cell from the grid it read at the start, marks the mapping as needing attention and stops.

The method has limits that the design accommodates.

| Limit | Fact | What the design does |
|---|---|---|
| Storage budget | 30,000 characters of metadata for each tab and 30,000 for the spreadsheet, counting keys and values.[38] By arithmetic that is about 1,000 to 2,300 anchored rows a tab, depending on key length | Above the budget the engine addresses rows by position, reads the key column again immediately before writing, and shows the remaining risk in the mapping's status |
| Sorting, cut and paste, duplicated rows | Whether metadata follows the data is undocumented | Correctness rests on the key column. Metadata is checked against it on every run and repaired |
| Copies of a spreadsheet | Whether a copy keeps its metadata is undocumented | The spreadsheet carries a tag naming its own file. A file whose tag names another file is treated as a copy and is left alone |
| Visibility | Metadata may be visible to anyone who can view the document.[38] | It holds record keys and column tags only, never personal data. Document-level visibility is used so that a staging and a production project read the same anchors |

Columns carry a metadata tag that follows the column when columns are inserted or moved, and the header text is the fallback. A sheet that has no key column yet receives one, together with the tags, in a one-time set-up that its owner agrees to. That set-up is the only structural change the portal ever makes to a sheet maintained by people.

#### The three-way comparison

For every mapped cell the planner holds three canonical values. A is the current value in the portal. S is the current value in the sheet, where the computed value is used for comparison and the entered value shows whether the cell holds a formula. B is the base: the value both sides held when the cell was last in agreement, stored in `cellState` beneath the mapping and absent when a cell is first linked. The plan is a pure function of A, S, B and the mapping.

| Direction | Condition | Action |
|---|---|---|
| Any | A equals S | B is set to that value. Nothing is written |
| `appAuthoritative`, `generated` | A differs from S | A is written to the sheet. If S also differs from B, the overwritten sheet value is logged |
| `sheetAuthoritative` | A differs from S | S is written to the portal. If A also differs from B, the overwritten portal value is logged |
| `bidirectional` | Only A differs from B | The portal changed. The value is written to the sheet, or proposed for review |
| `bidirectional` | Only S differs from B | The sheet changed. The value is written to the portal, or proposed for review |
| `bidirectional` | A and S both differ from B and from each other | A conflict record. Neither side is written |
| `bidirectional` | B is absent and A differs from S | First link. One empty side gives a proposal to fill it. Two different values go to review in bulk |
| Any | The target cell holds a formula | No write. An issue is raised |
| Any | The cell is marked unstable | No write until a person clears the mark |

Rows follow rules of the same kind, and none of them deletes anything.

| Situation | Default |
|---|---|
| A key in the sheet with no portal record and no stored state | A proposal to create the record |
| A portal record in scope with no row and no stored state | A row is appended |
| Stored state exists and the row has gone from the sheet | Review. The record is never deleted or archived automatically |
| Stored state exists and the record is archived or gone | A status cell is written. The row is never deleted |
| A duplicate key | Every row with that key is left out and an issue is raised |
| A blank key | The row is ignored |

A run proceeds in a fixed order. It takes a lease on the spreadsheet so that one run at a time touches a file. It reads the Drive version and stops if nothing changed. It reads the tab in one request that returns entered values, computed values and the row and column metadata. It resolves columns, indexes rows by key and checks the anchors. It loads the records in scope and their base values, computes the plan, which includes any anchor repair, and stores it in the run record. A dry run ends there and has written nothing to the sheet. A live run repairs the anchors, writes the cell values in one request, checks the keys and values returned, writes the portal in transactions that each require the field still to hold A, sets the base for every cell that now agrees, stores the Drive version it read before the grid, and releases the lease. Function-only state that the data model does not yet list (push channels, the change cursor, the lease and row proposals) is added to `docs/DATA_MODEL.md` with the adapter.

#### Origin tagging and loop safety

The portal's own writes must never come back as changes. Four properties prevent it, and the first carries the weight.

| Property | How it works |
|---|---|
| Convergence | The engine's write to a sheet raises the file version and produces a Drive notification. The run that follows finds A, S and B equal and ends after one read. Storing the version read before the grid is deliberately cautious, so that an edit a person makes during a run is never skipped |
| Origin tagging | A write the engine makes to a portal record names a synchronisation actor, and its audit entry has the actor kind `sync` with the mapping and run as its origin, in the same context that automations use for loop prevention. The trigger that enqueues synchronisation ignores a write whose only origin is that mapping. On the Drive side the file's last modifying user is flagged as the caller when the last edit was the engine's own.[39] Both are savings. Correctness rests on the comparison |
| Write order | The other side is written first and the base afterwards. A run that dies between the two leaves equal values with a stale base, which the next run repairs without writing |
| Read-back check | The value returned after a write is put into canonical form. If it differs from what was written, because a formula, a validation rule, an add-on or type coercion changed it, the cell is marked unstable and is written no more. Without this a cell that Sheets rewrites would be written on every run |

Two limits bound the damage of a mistake. A ceiling on the cells written in one run turns a mass change, such as a pasted column or a wrong mapping, into a single review item. One lease for each spreadsheet, a queue with low concurrency and a pause of 30 to 60 seconds after a notification keep runs from overlapping.

#### Conflicts and their resolution

A conflict is a `syncConflicts` document that holds the base, the portal value and the sheet value of one cell, the time of detection and the file's last modifying user. That user is an approximate attribution only, since Drive names the last person to change the file and several people may have edited between two runs. The identifier of the conflict is derived from the mapping, the row key and the field, so a conflict seen on ten runs is one record. While it is open, neither side of that cell is written and every other cell of the row synchronises as usual.

An authorised user sees the three values side by side and keeps the portal value, keeps the sheet value or enters a merged value. A callable function applies the choice through the same single-cell write, sets the base and records the resolver in the audit trail. If either side changed again after the conflict was recorded, the function refuses and the conflict is refreshed with the new values. The requirement speaks of detecting conflicts by revisions and timestamps. Sheets offers neither for a cell, so detection uses the stored base, and the Drive version and modification time serve only to decide whether a run is needed.

#### Formatting, formulas and unmapped cells

The portal writes single cell values and nothing else. Five rules keep the rest of a sheet as its authors left it.

| Rule | Basis |
|---|---|
| Only the values interface is used for data. It changes values and leaves formatting alone | Documentation.[40] |
| A row write supplies a null for every cell it does not change, and the interface skips nulls. Unmapped columns, formula columns and notes are never touched. An empty string, which clears a cell, is sent only when clearing is the plan | Documentation.[40] |
| Values are written raw. They are never parsed as if typed, so no number format changes and no formula is injected. A date is written as a serial number and keeps the cell's own date format. The one parsed write is a generated hyperlink | Documentation.[40] The handling of dates is inferred |
| A cell that holds a formula is read as a computed, read-only value and is never written | Designed. Nothing in the interface refuses such a write, so the engine has to |
| No row is deleted, nothing is sorted and no structure is changed after the one-time set-up. A new row is appended only where the mapping allows | Designed |

One loss is unavoidable: rich text inside a cell is erased when the portal rewrites that cell's value.[41] How the interface answers a write into a protected range, a cell with a strict validation rule, a typed table column or the spill of an array formula is undocumented and is a live check. The read-back check catches each case in the meantime.

#### Quotas and backoff

| Interface | A minute for the project | A minute for one user | Other |
|---|---|---|---|
| Sheets | 300 reads, 300 writes | 60 reads, 60 writes | A payload of 2 MB is recommended, and a request is cut off after 180 seconds.[17] Google advises one request a second for each spreadsheet.[42] |
| Docs | 3,000 reads, 600 writes | 300 reads, 60 writes | None stated.[43] |
| Drive | 1,000,000 quota units | 325,000 quota units | A get costs 5 units, a list or a watch 100, a copy 50 and a download or export 200.[29] |

A service account counts as one user, and a batch counts as one request.[17] By inference from those figures, one run on a tab costs one Sheets read, at most one Sheets write of values, one further write when anchors are repaired, and about ten Drive units, so the ceiling is some sixty tab runs a minute for the whole portal. The queue's concurrency limit holds the engine below it. Sheets and Docs answer an exceeded quota with 429, and Drive answers with 403 and a rate-limit reason or with 429. The adapter retries these and the 500, 502, 503 and 504 answers with the wait that all three pages prescribe, which is two to the power of the attempt in seconds plus up to a second of random jitter, capped at 32 or 64 seconds. When its attempts are spent it hands the task back to the queue. All three pages announce that exceeding a quota is planned to incur charges later in 2026, which the administrators should know.

### 3.4 Excel workbooks stored in Drive

Source A is described as an Excel file held in Drive. Drive treats such a file as binary content: it has a checksum, a size and a head revision, which native Sheets lack, and it is read by downloading it through Drive.[25] [44] The portal reads it that way and parses it as a workbook, and never calls the Sheets interface for it. What the Sheets interface returns for such a file is undocumented, so the adapter checks the Drive type before any Sheets call and fails with a clear message. The download needs a scope that covers file content, since a metadata scope does not permit it.[44]

The consequences are narrow and firm. A workbook can be linked as a file and imported. A change is detected by comparing checksums. Every mapped field is sheet authoritative, and rows need a key column, because a binary file has no developer metadata. Nothing is written back, since replacing the file would discard whatever a person saved in the meantime and nothing can be merged. The portal can offer to convert a workbook to a Google Sheet and link that. Conversion creates a new file with a new identifier and leaves the original alone, so the ownership limit of section 3.1 applies to it.[45] For source A the import is a one-off, run as a command-line tool from the downloaded file or from a file that an administrator supplies (D-012).

### 3.5 Generated Google Docs

The portal writes only inside regions that it created and still recognises. Everything else in a document belongs to the people who write it.

**Template and copy.** A template is an ordinary Google Doc kept by people. Each managed section is a paragraph that holds nothing except a tag such as `{{portal:summary}}`, and single values such as a title, a report date, a link back to the portal record and the provenance of the figures are inline tags. A document starts as a copy of its template in the target folder, made by one of the three routes of section 3.1.

**Adoption.** The engine reads the new document with every tab and with suggestions shown inline, the only mode that returns indexes usable for a write.[46] In one batch guarded by the revision identifier, working from the end of the document towards its start so that earlier indexes stay valid, it deletes each section tag, inserts the generated text and creates a named range over exactly that text. It fills the inline tags and stores each range identifier, its tab and a hash of the text in `managedSections` of the `generatedDocuments` record. Adoption works from the visible tags, so it does not depend on named ranges surviving a copy, which is undocumented.

**Named ranges as stable anchors.** The indexes of a named range are updated automatically as content is added and removed around it.[47] A named range is visible to every collaborator and application with access to the document.[48] Certain edits split a range into several, and the request that replaces the content of a range accepts plain text only and, for a split range, replaces the first part and deletes the others with their content.[49] That behaviour is the reason for the guard that follows.

**Guarded replacement.** To update a section the engine reads the document, finds the range by its identifier and extracts its current text. It writes only when the range exists as a single piece, overlaps no pending suggestion and holds text whose hash equals the hash of the text last generated. The write names the range by identifier, is limited to the range's tab and carries the required revision identifier, so that Google refuses it with a 400 if the document changed after it was read.[50] After a refusal the engine reads again and retries a bounded number of times. After a success it reads once more, confirms that the range covers the new text, recreates the range if it does not and stores the new hash. Whether the replacement request leaves the range in place is unstated, hence the confirmation. A section is never left empty, because the generator emits a placeholder line. A revision identifier is guaranteed to stay valid for 24 hours only and cannot be shared between users.[48] The record keeps the last one for diagnosis, and whether a document changed is decided from the Drive version alone.

**Audience.** A generated document is read in the portal by the audience of its kind, and the Google sharing of the folder that receives it must not go beyond that audience: a recruitment document, which states each laboratory's figures, goes to a folder that only the replication's team and programme staff can open.

**Hand edits.** When the guard fails, nothing is written. The section is marked as in conflict with the message that a managed section was edited by hand, and a reviewer either keeps the human text and detaches the section from generation, or regenerates it. Text outside the managed sections is never written and never compared: every write is addressed to a named range or to a tag in a new copy, and no request addresses any other position.

**Tables and review mode.** A managed table is a template table with a header row and one data row. The interface cannot insert a table and fill its cells in one request, so an update removes surplus rows from the bottom, inserts rows and fills cells in a second request with fresh indexes, each request carrying the revision identifier returned by the one before.[51] An edit by a person in between stops the chain, and the next run rebuilds the table. A table update is therefore not atomic as a whole. Where the administrators prefer to approve each change, the engine writes in suggestion mode, and the change arrives as a suggestion that a person accepts or rejects in Docs.[50]

**Reading back.** The portal may read a document's plain text for display or search. It never parses narrative into structured fields. One narrow path from Docs to the portal is possible within these limits: when a managed section that holds plain text was edited by hand, the reviewer may take the edited text into the one designated text field it was generated from. That is an action of a person in the review screen and never automatic. Sections whose text is drawn from a workspace page depend on how pages are stored, which is provisional under D-010 and awaits the editor spike. Sections computed from records do not.

### 3.6 Supported synchronisation boundaries

| Supported | Direction | Conditions |
|---|---|---|
| Cell values of designated tabs in native Google Sheets: text, numbers, booleans, dates and single hyperlinks | Either, set for each field | A key column, and a mapping approved for live writes |
| Formula cells | Sheet to portal, as computed read-only values | None |
| Rows inserted, deleted, moved or sorted by people, and columns inserted, moved or renamed | Followed in both directions | The key column and the column tags are in place |
| Row creation | Either, by default through a proposal | The row policy of the mapping |
| Conflict detection when both sides changed one field | Both | The base value is shown with both versions |
| Dry runs that show the plan and write nothing | Both | Always available |
| Excel workbooks held in Drive | Workbook to portal | Import only, detected by checksum. Not built yet |
| Generated Docs with managed plain-text sections. A table is written as plain-text lines whose cells are separated by " \| " | Portal to document | Hand edits are detected and never overwritten |
| A hand-edited managed section taken into one designated text field | Document to portal | By a reviewer's action only |
| Drive folder listing, links, an overview of who has access, and change detection for whole files | Drive to portal | The item is shared with the portal's account |

| Deliberately unsupported | Reason | What the portal does |
|---|---|---|
| Arbitrary rich-text round trips between a Google Doc and the portal | No request accepts a document fragment. Writing is a sequence of insert and style requests, and section replacement takes plain text only | Managed sections are plain text and simple tables. Narrative is never parsed into fields |
| Structural edits to a mapped tab made by the portal | The sheet belongs to its authors | Only the one-time set-up adds a key column and tags. The portal never deletes a row, sorts or reformats |
| Structural edits by people that remove what a mapping stands on: a deleted key column or mapped column, merged cells in the data region, a header spread over several rows, several unbounded tables in one tab | The region or the identity can no longer be established | The field or the mapping is paused with an issue. The region can be redefined as a named range or a table. Nothing is guessed |
| Simultaneous edits to one cell within seconds | Sheets has no write precondition. An edit a person makes to the same cell between the read and the write of a run is overwritten | The previous value stays in the sheet's version history and in the run log. The window is normally a few seconds, and no guarantee is given |
| Knowing who changed which cell, and cell-level history | Only the file's last modifier is known, and the portal sees values at its own run times only | Attribution is shown as approximate |
| Instant propagation | Notification delay is undocumented and channels are best effort | Minutes, with polling as the backstop |
| Transactions across the two systems | None exists | Consistency is eventual and is reached by idempotent retries |
| Automatic deletion on either side in response to the other | Too easy to lose data through a mistaken edit | Review items |
| Formatting, conditional formatting, validation rules, notes, comments, charts, pivot tables, merged cells and filters | Outside the purpose of the mapping | Left alone. Rich text inside a cell is lost if the portal rewrites that cell |
| Writing formulas, apart from a generated hyperlink | A formula belongs to the sheet's authors | Formula cells are read only |
| Writing back to an Excel workbook | The whole file would be replaced | Import only, with an offer to convert |
| Files that are not shared with the portal's account, and document creation by the service account outside a shared drive | The account reaches only what is shared with it and cannot own files | The interface names the sharing step that is missing |
| Scale beyond about 1,000 to 2,300 anchored rows a tab, 60 Sheets reads and 60 writes a minute for the whole portal, and a 10 MB export | Documented limits | Position addressing above the row budget, and a rate-limited queue |

### 3.7 What can be tested now and what is blocked

Phase 6 built the planner and the Sheets, Drive and Docs adapters against the fake of section 3.8, and the tests named in section 2 cover the behaviours of the middle column that the fake reproduces. The Excel import is not built. Nothing in the right-hand column has been checked.

| Part | Designed and testable now against a fake | Blocked until credentials are supplied |
|---|---|---|
| Synchronisation planner | All of it: every row of the cell and row tables, write order after a crash, convergence after the engine's own write, the cell ceiling, deterministic conflict identifiers | Nothing |
| Sheets adapter | Skipped nulls, raw writes, omitted trailing empty cells, metadata that follows inserted and deleted rows, the 30,000-character budget, writes resolved by metadata at write time, stable tab identifiers, a switch for whether metadata follows a sort | Every real read and write, and each documented behaviour the fake copies |
| Drive adapter | A version that rises on every change, one change-log entry for each file, removal on lost access, channels that expire, messages with headers only that arrive twice or out of order, refusal of creation outside a shared drive | Sharing, push delivery to a real function, the changes feed of a service account |
| Docs adapter | Index arithmetic in UTF-16 units, index shifts within a batch, rejection of a whole batch for one invalid request, named ranges that grow, split and vanish, refusal on a stale revision | Copying a template, adoption and replacement in a real document |
| Excel import | Parsing and import from fixture workbooks built by code | Download from Drive, and source A itself |
| All adapters | Injected 429, 403 rate-limit and 503 answers that exercise backoff | Real quotas |

Fourteen points need a live account before the design may rely on them. The most consequential are these.

| Live check | Why the design asks |
|---|---|
| Whether row metadata follows a sort, a cut and paste and a duplicated row, whether a copied spreadsheet keeps its metadata, and that a write addressed by metadata lands on the right row after an insertion | The first two decide how often anchors are repaired. The third is the reason for using metadata at all |
| Whether the Node.js authentication library obtains Sheets, Docs and Drive scopes from the metadata server with no key | Otherwise the IAM Credentials fallback is used |
| Which scopes a service account needs to open a file shared with it | Least privilege |
| Whether a copy by the service account into an ordinary folder fails, and that a copy into a shared drive works for an outside member | The ownership limit, on which the guides disagree |
| Whether the programme has a Workspace edition with shared drives, and whether members' institutions permit sharing with a service account | The choice of route for generated documents |
| Whether replacing the content of a named range keeps the range, and whether a copy keeps named ranges | The confirmation step after each write |
| Delay and merging of Drive notifications for edits made in the editors | What members are told about latency |
| The answer of the Sheets interface to a write into a protected range, a strictly validated cell, a typed table column or an array spill | The read-back check covers it meanwhile |
| That the project's policy permits an HTTPS function open to the internet, and that Drive delivers to its address | Push. Polling works without it |
| Whether Google regards files shared with a service account as user data that needs verification | The fallback is a person's OAuth grant |

### 3.8 What phase 6 built, and where it departs from the design

Everything in this section runs against the in-memory fake of `portal/functions/src/integrations/google/fake/`, whose fixtures are synthetic and labelled so. The fake reproduces quotas per minute, revisions that go stale, push channels that expire, access that is lost and restored, outages of one service, row metadata that may or may not follow a sort, and a named range that a replacement drops. The emulator's functions and the tests share its state through a file in the run's temporary directory. The real adapters under `google/real/` call the documented REST endpoints with a token from the metadata server. They have never been executed and are unverified. Which adapter runs is decided in one place, `google/adapters.ts`: the fake in the emulator, the real adapters when the parameter `GOOGLE_WORKSPACE_SERVICE_ACCOUNT` names the account, and otherwise none, in which case the integrations page says "Not connected: credentials not supplied" and no job reaches Google. Firestore holds only that parameter's name and the account's address, never a key.

| Part | Built | Departure from the design |
|---|---|---|
| Jobs | Every run is a `syncRuns` record. A trigger runs a record that becomes queued, after claiming it in a transaction. Requests are retried within a run with the backoff of section 3.3 (1 s doubling to 32 s, five attempts). A failed run is retried by the ten-minute sweep with a backoff of one minute doubling to an hour, six attempts, and then lands in `deadLetter`. A lease in `syncLeases` keeps one run at a time on a spreadsheet | A Firestore-backed queue replaces Cloud Tasks, so the emulator runs it and the jobs page reads the same records |
| Sheets mappings | `core:laboratories` (name, department, city, website, description) and `core:equipment` (a configuration's fields, keyed by laboratory slug and the root of its chain of successors, with the laboratory name generated). The three-way planner of `shared/src/sync/` decides each cell. A mapping starts as a dry run and writes only after an administrator approves live writes, recorded with the name and time. A run above the cell ceiling writes nothing and pauses the mapping | Sheet-only rows are proposed as review items or ignored. The portal never creates a record from a row |
| Loop safety | Writes made by synchronisation carry `writeContext.origin` "sync", and the record triggers ignore them | As designed |
| Conflicts and review | `syncConflicts` with the base, portal and sheet or document values, resolved by keeping either side or a merged value. Both sides are read again first, and a side that moved on refreshes the conflict instead. `syncReviewItems` hold the issues of section 3.3 | As designed |
| Generated Docs | Six templates, one of each kind, created in a shared drive only. Recruitment, meetings and milestones documents are read in the portal by the replication's team and programme staff alone, the others by every member; meetings list only pages that keep the replication's audience, and milestones only those of the replication's own task lists. Those who manage a record ask for a document by its kind, since they do not read the templates. Sections are found by their tag on adoption and by their named range afterwards, guarded by a hash and the revision. Every section ends with a provenance line that names the source and the date. A hand-edited section becomes a conflict: generate it again, keep the document's text and detach the section, or, for the designated field, take the text into the record | Tables are plain-text lines, not Docs tables, and suggestion mode is not built |
| Drive | Links of replications, laboratories, manuscripts and datasets, guarded as section 3.2 says; browsing and the details of a file (never its content) within the reader's own permission on the link, leaving out what the portal keeps for synchronisation or generated documents; a check of access, the change feed and push channels that are renewed before they expire. A test of a connection reads from that service alone, and the calls people wait for record Drive's health. In the emulator the fake gives every item an address on example.org, and the pages say that Google is a synthetic fake | Folder listings are read live and never stored. The real adapter's listing of permissions is unverified |

## 4. Quire

Quire is source I. Its projects, tasks and comments are migrated once, after a freeze, and the migration is rehearsed beforehand with repeatable pulls. Nothing here was verified against a real Quire workspace: no export file and no authorisation existed, and only the published documentation was read, whose changelog was current to 6 November 2026.[52] One unauthenticated request confirmed the documented error format (Observed).

### 4.1 What can and cannot be recovered

The interface documents the following as readable by a user who can see the data: projects, tasks with their names and descriptions in Markdown, the nesting of tasks, statuses with the definitions of each project, priorities, start and due dates, assignees and who assigned them, followers, tags, comments with their authors and last edits, dependencies, recurrence, custom field definitions and values, sublists and their membership, sections and milestones, estimates and time logs, reminders, documents and chat channels, external teams, the current approval state, and the name and address of each attachment.[52] The following cannot be recovered by any documented route.

| Cannot be recovered | Evidence |
|---|---|
| The activity history: who changed what, and when | None of the 210 documented operations returns it, and the export does not list it. It can be viewed only in the application, where it is kept for 5 days on the Free plan, 90 on Professional, 365 on Premium and without limit on Enterprise.[52] [53] [54] |
| Earlier values of any field, and the times of assignments, tag changes and date changes | The interface returns the current state. A task carries the time of its last edit and of its last status change only |
| Who last edited a task | The task record has the time of the edit and no editor. To be checked on a real record |
| Deleted tasks and deleted comments | They are left out of every list. The trash is kept for 7 days |
| The content of attachments | No download operation is documented, and whether the attachment address accepts the token is unstated. Files stored with another service were only ever links |
| The roles and permissions of members | No field and no operation returns them |
| The email addresses of colleagues, unless the authorising user grants access to contacts | Otherwise a colleague is returned by name and identifier only. This bears on linking assignees to people |
| Folder structure, and the conditions of a sublist built from a filter | No operation lists folders, and a sublist record has no conditions |
| The position of a task among its siblings, as a number | It is taken from the order of the returned list, which the documentation does not promise |
| Anything the authorising user cannot see | Sublists, documents and chats limited to selected members, restricted custom fields and time logs hidden from guests are left out |
| Approval history, the edit history of comments, and comment threads | Only the last state exists, and comments are a flat list |
| Read state, notification state, view settings, saved filters and the contents of dashboards | Not present in any documented record |

The activity history is the loss that matters most. The only way to keep any of it is to save the logs that matter from the application, as screenshots or printed pages, before the final run, and the plan decides how far back they reach.

### 4.2 Why the API is the contract

Quire offers three ways out, and they differ in what an importer can rely on.[52] [55]

| | CSV export | JSON export | REST interface |
|---|---|---|---|
| Identifiers | The task number only. No object identifier | The project's object identifier is documented. For a task it is unstated | An object identifier on every record |
| Dates and times | Text in the exporting user's locale | Unstated | UTC, in ISO 8601 |
| People | Display names | A list of users whose fields are unstated | Object identifier, user identifier and name |
| Hierarchy | A chain of task numbers in one cell, inferred from the sample | Nested lists | A list for each level, with a count of children |
| Comments | Only with an option added on 3 November 2026, as text with the author's name. Comments that hold only attachments are skipped | Included | Complete records |
| Dependencies, recurrence, custom fields, time logs | Absent from the documented sample | Unstated | Documented |
| Documented shape | A sample. The delimiter is a comma or a semicolon depending on the user's locale | The top-level keys only. The fields inside a task, a comment or a user are typed merely as objects | 46 named fields on a task, and every nested record |

CSV is unsuitable as a migration source: it has no stable identifier, its dates and names depend on who exported it and it omits most relations. It is kept as a human-readable cross-check. The JSON export is archived as the provenance record and as a fallback, and its inner field names are confirmed against the first real file. The documented records of the REST interface are the contract that the importer is written to.

### 4.3 Authentication and where the pull runs

Quire documents OAuth 2.0 and no personal token or key, so the token that decision 7 mentions is obtained through an authorisation by a person.[52] The standard flow needs a client secret, and a static site on GitHub Pages cannot hold one. The flow for public clients needs no secret and yields a token that lasts seven days with no means of refreshing it. Whether a browser may call the interface from another origin is undocumented, and although a test request suggested that it may (Observed), the design does not depend on it. The pull is also long and rate limited, which a browser tab suits poorly.

The pull therefore stays out of the browser. D-014 names Quire among the integrations that run in Cloud Functions, and this design treats the Quire pull as the case that D-012 covers: a one-off import that an administrator of the programme's Quire organisation runs as a command-line tool on their own machine. A rate-limited pull can also last for hours, far beyond the 1,800 seconds of a task. That reading of the two decisions is put to the programme administrators for confirmation and, once confirmed, belongs in a later entry of the decision log. The Quire client sits behind an interface with a fake all the same. Authentication is either the sign-in of Quire's own command-line client, which uses the public-client flow and needs no registered application, or a private application with no permission selected, which Quire shows as read only and whose secret never leaves that machine.[56] The authorising user grants every organisation and project, and access to contacts, because the interface returns only what that user has granted and can see.

### 4.4 The recommended route

| Step | What happens | Result |
|---|---|---|
| 1. Freeze | Quire is treated as read only by agreement for the final run, since paging over records that are still changing can skip or repeat tasks | A stable source |
| 2. Archive the raw export | For every project, archived ones included, the JSON export and the CSV export with merged columns and comments are saved unchanged with a SHA-256 and the time. The activity logs that matter are saved from the application | The provenance record and the fallback source, kept in restricted storage and never in this repository |
| 3. Pull through the interface | A read-only tool reads users, organisations and projects, then for each project its statuses, tags, members, sublists, reminders, documents and chats, then the task tree level by level, then comments for tasks that have any. It records the position of each task in its list, tries to download each attachment that Quire itself stores and records the answer, waits as told on a 429, and saves every raw response as it arrives so that a run can resume | A snapshot bundle of raw responses |
| 4. Normalise | The bundle is turned into records of the portal's task model, each carrying its raw source object | Plain files ready to import |
| 5. Import | An Admin SDK tool writes the records, first as a dry run (D-012). Each is keyed on its Quire object identifier | Tasks, comments and projects in Firestore, linked to their source records |
| 6. Cross-check | Counts are compared with the totals on each project record, with the archived JSON and with the chains of task numbers in the CSV | A verified import, or a list of differences |

The import is idempotent because the document identifier is derived from the object identifier: `quire_`, the record type and the identifier where it consists of letters, digits, full stops, underscores and hyphens, and a hash of it otherwise, since the documentation gives no alphabet and shows an identifier that contains full stops. An absent record is created. A record whose source is unchanged is skipped. A changed record updates only the fields that nobody has changed in the portal since the last import. A record that has gone from Quire is marked as missing from the source and is never deleted. References between records are resolved by object identifier alone. The task number, which is unique only within its project, is kept with the project identifier as the legacy identifier, beside the address of the task in Quire.

The level-by-level reading of the tree is chosen because it works on every plan. For a period of parallel running the same pull is repeated for records created or edited since the last run, and deletions are found by comparing complete sets of identifiers. Webhooks are not used, since they need a public address and deliver only events that happen after subscription.

### 4.5 The missing-fields report

Every run, dry runs included, produces a report as a data file and a readable summary. It is the evidence for requirement R5.I.4 and the means by which a change in Quire's undocumented export format becomes visible.

| Section | Content |
|---|---|
| Run facts | The time of the snapshot, the operator's account identifier, the plan of each organisation as the interface reports it, the request units used and the hashes of the source files |
| Counts | For each project and record type: read, created, updated, unchanged, skipped and failed, beside the totals on the project record |
| Known unrecoverable items | The table of section 4.1, with the retention of the activity log on the plan in force |
| Unmapped source keys | Every key met in a source object that is neither documented nor a custom field of the project, with a count and one example |
| Documented fields absent everywhere | For example no time log at all, or no dependency at all, with the likely cause |
| Unresolved references | Users with no address, users that are applications, assignees missing from the user list, parents and dependency targets outside the import, and tags with no definition |
| Truncation and paging signals | Any subtree marked as cropped, any sublist that returned exactly 30 results on the Free plan, any search that reached a page limit |
| Attachments | For each file: copied, kept as an external link, or failed, with the HTTP status and size |
| Lossy conversions | Recurrence rules with no standard equivalent, status names that depend on language, date-only against timed values, and sanitised HTML |
| Visibility gaps | The kinds of record that may be hidden from the operator |

### 4.6 What depends on the Quire plan

The plan of the programme's Quire organisation is unknown, and it decides much of what the pull can do.[52] [54] [57]

| Capability | Free | Professional | Premium | Enterprise |
|---|---|---|---|---|
| Request units for one organisation | 50 a minute, 200 an hour | 300 a minute, 1,250 an hour | 1,000 a minute, 5,000 an hour | 100 a minute and 500 an hour for each member, with the Premium figures as a floor |
| Export through the interface | Refused | Yes | Yes | Yes |
| Export of all projects of an organisation from the application | No | Yes | Yes | Yes |
| A whole subtree in one call | Refused | Up to 500 tasks | Up to 2,000 tasks | No cap |
| Search page size | At most 30, which also limits reading the membership of a sublist | No such cap | No such cap | No such cap |
| Activity log kept in the application | 5 days | 90 days | 365 days | Without limit |
| Task dependencies as a feature | No | Yes | Yes | Yes |

Whether the application's own export of a single project is restricted on the Free plan is unstated. An estimate from the documented cost rules puts a project of 1,500 tasks with 300 parents and 400 commented tasks at roughly 720 units: under an hour on Professional and about four hours on Free. A user who has not signed in to Quire for more than 400 days is refused by the interface unless one of their organisations is on Professional or above.

### 4.7 What can be tested now and what is blocked

| Part | Designed and testable now against a fake | Blocked until credentials are supplied |
|---|---|---|
| Pull tool | Paging by cursor, the cropped-subtree signal, waiting on a 429, resumption from saved responses, and the documented error format, against a fake server built from the documented examples | Every real request, and the plan-dependent behaviour |
| Normaliser | The documented variations: date-only and timed dates, statuses on both sides of the completion threshold, every priority, list fields that arrive as a list or as an encoded string, missing optional keys, a parent chain deeper than ten, a follower that is an application, each custom field type, each attachment type | The real field names of the JSON export, and Quire's Markdown conventions for mentions |
| Import | A second run writes nothing, one changed source field gives one update, a removed source record is marked as missing | The real import |
| Missing-fields report | Every section, from fixtures | Real counts |

On the first real token or export the following are settled, and they are carried as acceptance checks: the plan, whether the application offers a JSON export on that plan and whether it matches the documented map, the keys of exported tasks and comments, whether lists arrive in display order, whether archived and completed tasks are included by default, whether attachments can be downloaded with the token, and whether colleagues' addresses are returned once access to contacts is granted.

## 5. OSF and DOI resolution

The sources contain links to OSF pages, DOIs of original studies and programme publications, Google documents, publisher pages, data repositories and a code repository, and `docs/SOURCE_REGISTRY.md` counts them by kind. Together they are source J, the linked Drive, Docs and OSF documents. Each is a `documentLinks` record that starts with the access status `unknown`. Discovery tested three addresses, one for each host class of source E (prediction-market hypotheses), and opened no linked document.

**Link checking.** A link check sends status-only requests, discards any content and records the access status, the HTTP status and the time. It runs as a separate pass after each import and later on a schedule, through a queue that sends one request at a time to any one host and backs off when asked. It needs no credential for public addresses.

| Host class | How health is checked | Evidence |
|---|---|---|
| OSF | Through the OSF programming interface, by the resource's identifier. The page host cannot be used, because it answered success for a made-up address with an identical page | Observed: the interface answered success for one real identifier and 404 for a made-up one |
| DOI | A request to the resolver, following redirects and recording the final host | Observed: one DOI resolved to a publisher page after four redirects. No other DOI was checked |
| Google Docs, Sheets and Forms | An anonymous request shows whether a link-shared document exists. Anything behind sign-in is checked through the Drive adapter of section 3.2 | Observed: one document answered without a redirect to sign-in, and a made-up identifier returned 404. Whether an anonymous visitor can also edit was not tested |
| Publisher pages, data repositories, code repositories | A status-only request | Designed |
| Links that carry an access token or session parameters | Stored as written and never requested | Designed. Source F, the recruitment and contact workbook, holds three |

**Metadata retrieval.** For an OSF resource that is public, the title and the modification time are read from the same interface and stored on the link, so that a record shows what it points to without a member opening it. The fields that interface returns were not read during discovery, so the list of stored fields is fixed when the adapter is built. Nothing is retrieved from a resource that is not public, and unreachable content is never made up.

**Verification of citations.** A replication carries the citation of its original study with a bare DOI, and a manuscript carries its own. Each has a `citationStatus` of `unverified`, `verified`, `mismatch` or `notFound`, and the metadata that a check returns is stored beside it. The adapter looks the DOI up in Crossref and compares the registered authors, year, title and journal with the stored citation after normalisation. Agreement gives `verified`. A registered DOI whose details differ gives `mismatch`, with the differences listed for a reviewer and the stored values left exactly as the source had them (D-012). A DOI that is not found gives `notFound`. Every citation starts as `unverified`, and the interface labels it so wherever it appears until a check has passed (requirement R12.2). Three properties of the data matter to the comparison: several DOIs contain parentheses and capital letters, a publication year is stored as text and reads `2005a` and `2005b` on two rows, and a DOI changes when a preprint is published, so it is no stable key for a manuscript.

**As built in phase 8.** The OSF check of a linked page sits behind the interface `OsfAdapter` in `portal/functions/src/integrations/osf/types.ts`. The callable `checkOsfLink` asks it for the resource named by the link (by the identifier that `osfIdentifierOf` reads from the address), stores the access status, title, kind and modification time it returns, and leaves the link as it was when OSF is unavailable or limits the rate, retrying once after a short wait in the second case. The emulator and every test use the in-memory fake in `fake.ts`, which reproduces the awkward answers: a missing resource, a private one, a withdrawn registration, rate limiting and an outage, each switchable by a test. The real adapter in `real.ts` reads `https://api.osf.io/v2/guids/<id>/` without credentials. It has never been run: its request, the fields it maps and its handling of errors are unverified until staging, and it is switched on only by the parameter `OSF_CHECKS_ENABLED`. A withdrawn registration stays public on OSF, so the portal keeps the time it was first seen withdrawn as `withdrawnAt` on the link until a later check finds the registration standing; the Registered Reports tab shows it as "Withdrawn on OSF" and lists it under "Needs attention". A page that OSF no longer has reads "Not found on OSF (deleted or wrong address)".

Crossref's interface was not read during discovery. Its query form, its limits, the DOIs it covers and what it asks of automated clients are read before the adapter is built, and a contact detail is sent to any public interface only if the administrators provide one for that purpose.

| Part | Designed and testable now against a fake | Blocked |
|---|---|---|
| Link checker | Classification of answers for each host class, backoff, the rule for tokens, against a fake HTTP client | Nothing by credentials. The pass over the real links has not been built or run |
| OSF metadata | Built behind `OsfAdapter`, tested against the in-memory fake (phase 8) | Nothing by credentials. The real adapter is written but unverified until staging |
| Citation check | Normalisation and comparison, and the four outcomes, from fixtures | Nothing by credentials. Crossref's interface has still to be read |

## 6. GitHub: publishing to the public website

The public website is built from four TSV files in `data/`, and a change reaches it by one route: a branch, a pull request that deploys the shared staging site, a check of `eegmanylabs.dev`, a merge and the production deployment that the merge triggers. The portal feeds that route and adds no other. Phase 9 built it against a fake of the repository; section 6.1 records what was built and where it departs from this design.

**What is published.** A publication is assembled from a fixed list of approved public fields: people whose `publicListing` is `member` or `coreTeam`, the public stage and sign-up fields of a replication, and the public fields of a publication. The generator reads directory documents and never the private or special documents beneath them, so contact details, demographics, private notes and participant data have no path into the output. Because trusted code bypasses security rules, that property is held by a test, which plants marker values in restricted documents and asserts that none reaches a generated file, and by a check that fails the batch if the output contains anything shaped like an email address.

**The column contract.** The files are regenerated in exactly the form the site's build reads today.

| File | Key | Columns | Order of rows | Line endings today |
|---|---|---|---|---|
| `data/replications.tsv` | `StudyId`, first column | 17 | Ascending by key | LF, no final newline |
| `data/publications.tsv` | `PublicationId`, first column | 15 | No detectable sort | CRLF, no final newline |
| `data/people.tsv` | `PersonId`, first column | 17 | A curated display order | CRLF, with LF alone on the last line |
| `data/members.tsv` | `PersonId`, second column, after `SequenceNumber` | 5 | Roughly by surname | LF, with a final newline |

The generator keeps the existing column names and their order, the first column as the build's key, `SequenceNumber` first in `members.tsv`, the literal `done` in `SignupUrl`, an empty cell for an absent value, and bare DOIs. It also keeps each file's row order and line endings, so that the difference shown for a batch contains the intended changes and nothing else. A contract test regenerates the four files from an import of the committed ones and requires the result to match them byte for byte. That test can be written today, since the files are public and in this repository. Before a batch is offered for approval the generator repeats the checks the README asks of a maintainer: a member who is also in the Core Team file is left out, role tags and stage labels come from the established vocabularies, and an image that a row names exists in the repository. Images are added by a maintainer through the ordinary route and never by the adapter.

**The route.** A batch is a `publicationBatches` record and moves through the states that the data model defines.

| State | What has happened | Who acts |
|---|---|---|
| `draft` | The fields approved for publication were assembled into the four files | A programme administrator starts the batch |
| `previewed` | The administrator saw the differences from the files on `main`, row by row. This is the dry run, and nothing has left the portal | The same |
| `staged` | After explicit approval of the live write, the adapter created a branch, committed the files and opened a pull request to `main`, with the purpose, the files changed, the data implications and the pages to test in its description. The existing workflow deployed the shared staging site | A programme administrator approves. The adapter writes |
| `approved` | The change was checked on `eegmanylabs.dev`. A programme administrator recorded approval in the portal, and the pull request was approved as the README describes | A programme administrator and the site's maintainers |
| `published` | The pull request was merged and production was deployed. The batch stores the pull request address and the commit | A maintainer merges. The adapter never merges |
| `rolledBack` | The publication was reversed | A maintainer |

Two facts about the existing workflow shape the adapter. Opening or updating any pull request redeploys the single shared staging site, and the last writer wins, so the adapter keeps at most one publishing pull request open and a live pull request needs approval each time. Secrets are not passed to workflows from forks, so the branch is created in this repository.[58] The adapter learns of the merge by reading the state of the pull request on a schedule, since nothing in the portal receives notifications from GitHub. The next import of source H, the website data in this repository, is repeatable for each commit. It reconciles the portal with what the website actually says, and that is how source H becomes two-way.

**Log and rollback.** The batch record is the publishing log: what was requested and by whom, the differences, who approved the live write, the pull request and the commit. Rollback follows section 7.4 of the README, a revert commit on `main` made by a maintainer, which the existing workflow then deploys. The history of `main` shows that pull requests in this repository are merged with merge commits, so the README's caution about reverting a merge applies. A new batch that restores the previous contents of the files is the alternative that needs no special knowledge of Git, and the stored differences make it possible.

**Credential.** The adapter needs a credential that can push a new branch and open a pull request on this one repository and can do nothing else, held in Secret Manager. Its form is for an organisation owner to choose. Whether `main` is protected could not be read during discovery. Protection of `main` is what keeps such a credential from writing to it directly, so a repository administrator confirms it before the credential is issued.

| Part | Built and tested against a fake in phase 9 | Blocked until credentials are supplied |
|---|---|---|
| Generator | The byte-for-byte contract test on the committed files, the approved-field list, the marker test, the email check and the README checks | Nothing |
| Preview | Differences against the files of `main`, and a build of the site in a scratch copy with the site's own build command | Nothing |
| Website adapter | Branch, commit, pull request, the one-open-request rule, merge detection, withdrawal and the rollback proposal, against the in-memory repository | The first real pull request, which needs the credential and approval because it redeploys staging. The real adapter has never been executed |

### 6.1 What phase 9 built, and where it departs from the design

Everything in this section runs against `functions/src/integrations/github/fake.ts`, an in-memory repository seeded from the checked-out website and kept in a file under the run's temporary directory, so that the functions emulator, the tests and the browser tests share it. The real adapter, `functions/src/integrations/github/real.ts`, calls the GitHub REST interface for branches, commits and pull requests. It is written and unverified: it has never been executed. Outside the emulator it is used only where the parameter `PUBLISHING_REPOSITORY` names the repository and the secret `PUBLISHING_GITHUB_TOKEN` holds a credential; until both exist, approval stops before the live write with a message that says so. The fake answers on the reserved host `github.example.invalid`, so an address it produces can never reach a real repository, and the publishing page shows its pull request as "Pull request N on the fake repository (not on GitHub)", as text without a link, and says that no site is deployed. The site's five stages, with the long text each card shows, are defined once in `shared/src/publishing/stages.ts`, and a contract test compares them with the filter chips of the site. A replication whose stage the site does not know keeps its existing row unchanged with a note, and a new one without a known stage is left out; `publish:verify` checks the stages as well.

| Part | Where | What it does |
|---|---|---|
| Allow-list and generator | `shared/src/publishing/allow-list.ts`, `generate.ts`, `tsv.ts` | Each output is projected field by field from a named list and parsed with a strict schema, so a field the schema gains later never reaches a file. Rows keep their order, cells and line endings, and `tests/architecture/website-contract.test.ts` regenerates the committed files byte for byte |
| Preview | `preparePublication`, `shared/src/publishing/diff.ts` | The files are compared with the files of `main` at a recorded commit, row by row, and kept with the export. An export in which text shaped like an email address appears is refused and logged |
| Staging build | `npm run publish:verify -- --batch <id>` (`tools/src/commands/publish-verify.ts`) | Run by a person from a trusted machine. Copies the website to a scratch directory outside the repository, writes the export's files, builds with Syrinx 0.0.15 (installed into `portal/.run/site-venv` from the site's `requirements.txt` by `npm run site:setup`) and checks the payload hash, the build, its output, pages, feeds, images, the absence of private values and that the repository itself is unchanged. The report is recorded on the export |
| Approval | `approvePublication` | Needs `publishing.approve` and the second factor, an export whose staging build passed, and the hash of the files the approver saw, which must be the files that were built. Then a branch is made from the previewed commit, the files committed and a pull request opened with the purpose, files, data implications and pages to check in its body |
| Log, merge and rollback | `refreshPublication`, `publicationsSweep`, `withdrawPublication`, `proposePublicationRollback` | The hourly sweep and a manual refresh read the pull request and record a merge or a closing. A rollback is proposed as a new pull request that restores the files the export replaced. The portal never merges |

Departures from the design above:

- The states are `previewed`, `verified`, `staged`, `published`, `rolledBack`, `withdrawn` and `failed`. There is no `draft`, because preparing an export is its preview, and the approval of the live write comes after the staging build, which `verified` records, and before the pull request.
- Three outputs that the site does not yet show (laboratories, milestones and aggregate recruitment) are written to `assets/data/`, outside `data/`, because Syrinx refuses a TSV file in `data/` that has no archetype. Showing them on the site needs a change to its templates, which is outside the portal.
- Rollback takes the alternative this section names: a pull request that restores the previous contents. It needs no knowledge of Git, and a maintainer can still make a revert commit by hand.
- An export is refused where `main` has moved since its preview, and a new export is needed, so a change made meanwhile is never overwritten.
- A lost credential, lost access or a rate limit fails the step with a plain message and alerts whoever manages the integrations once, through `functions/src/notifications/alerts.ts`.

## 7. Distributed research data servers

The portal is a registry of where data is held. A dataset, its storage references and a manifest of its files can be entered by hand or uploaded, so the registry is complete without any adapter, and raw EEG never passes through the portal. Adapters add one thing: a scheduled metadata scan of a server that an institution has agreed to open for that purpose.

**Protocols.** No protocol has been approved by any institution. The data model lists the candidates as values of `protocol` on a storage endpoint (`sftp`, `ftps`, `filesystem`, `s3`, `webdav`, `gin`, `osf` and `other`), and none is confirmed. Each approved protocol gets one adapter behind a single storage interface with three operations: check that the endpoint answers, list a path, and read the checksums that the server itself holds. Adapters are built in the order in which institutions confirm, and each is tested against a local server of its protocol before it meets a real one. The following has to be agreed with each institution before its server is connected.

| Question for the institution | Why it matters |
|---|---|
| Which protocol and port, and is the server reachable from the internet or only from inside the institution's network? | It decides whether a scan from Cloud Functions is possible at all |
| Does the server admit connections only from listed source IP addresses? | The fixed egress address discussed below |
| Who issues a read-only account, by what kind of credential, and for which paths? | Least privilege |
| Does the server hold checksum files or expose checksums through the protocol? | Whether manifests can carry checksums without reading recordings |
| How often may a scan run, and how much load is acceptable? | The schedule and the concurrency limit |
| Under what conditions may file names be listed and stored? | A path may contain participant labels, so a manifest is restricted data |

**Metadata scans.** A scan lists files and records, for each, the relative path, the size and the modification time. It takes a checksum, with its algorithm, only where the server supplies one, and it never downloads a recording, so it never computes a checksum itself. Where none is available the checksum is absent and the manifest says so. The result is a manifest of the storage reference at that time, stored in numbered chunks of up to 2,000 files in the scoped subcollections of the dataset. It is compared with what is expected, and each file is marked as `expected`, `present`, `missing`, `unexpected` or `duplicate`. A scan runs in a task queue function with a limit of 1,800 seconds, so a large tree is scanned directory by directory in pieces that can resume.[4] In this design the portal moves no data. A transfer between servers is carried out by people with their institutions' own tools, and the portal records its states and marks it as verified when a later manifest of the destination matches.

**Credentials.** A storage endpoint holds `credentialRef`, the name of a secret in Secret Manager, and never the credential. The name begins with `STORAGE_`, so it can name no other secret or setting of the functions, and the secret names the `host`, and where the institution fixed one the `basePath`, it is for: an adapter refuses to send it anywhere else. Naming the secret, and changing the protocol, host, port or base path of a server that names one, needs `integrations.credentials`. The account of a server reads every folder below its base path, so the connection names the folder of each replication or laboratory (`allowedPrefixes`), and those who manage the datasets of a unit name a copy only inside its folder; a path that is empty, `.`, holds `..` or a control character, or starts with a slash is refused, and no copy may share, hold or lie in another dataset's folder on the same server. An administrator places the value in Secret Manager, and no function returns it. Declared secrets are bound to a function at deployment, so how the scan function is given the secrets of endpoints that are added later, by a declared parameter for each or by access to a named set, is settled when the first endpoint is connected. Storage paths and server details are restricted data, and each view of a path is recorded in the dataset's access events.

**Behaviour during an outage.** A failed check sets the endpoint to `unreachable` with the time and the result, and the availability of its storage references to `unavailable`. The registry record, the last manifest and the BIDS and quality-control status stay readable, labelled with the time of the last successful scan. The queue retries with backoff and then leaves the scan visibly failed for a person to retry. No file is marked as missing because a server could not be reached: `missing` means that a successful listing lacked the file. One notification goes to the endpoint's owner and the administrators.

**A fixed egress address.** A server that admits connections only from listed source IP addresses has to be given an address to list, so the functions that scan it need a fixed egress address. Discovery did not examine how that is arranged for second-generation functions or what it costs. Both are established, and the cost is approved by the administrators, before the first such server is connected. A server that can be reached only from inside its institution cannot be scanned from the cloud at all. For it, and for an endpoint of protocol `filesystem`, the manifest is produced inside the institution and uploaded, which the data model already provides for.

**ElectroTag.** ElectroTag is an optional viewer. The integration is a link and nothing more: a dataset may carry `viewerLinks` records with the name of the tool and an address, and a request for the link is recorded in the dataset's access events. There is no adapter, no call to any ElectroTag interface and no credential, and no such interface was examined during discovery. Access to data and every registry function work without it.

| Part | Designed and testable now against a fake | Blocked until credentials are supplied |
|---|---|---|
| Registry, manual and uploaded manifests, comparison and file states | All of it, with no adapter | Nothing |
| Scan engine | Chunking, resumption, outage handling and the rule for missing files, against an in-memory storage fake with injected outages and slow listings | Nothing |
| Protocol adapters | One adapter against a local test server, once a protocol is confirmed | The protocols, a read-only account for each server, and a fixed egress address where a server filters by source address |
| Built in phase 7 | The registry, manifests, comparison, outages, transfers, BIDS reports and viewer links against the fake (section 7.1). The real adapters are written and have not been run against a local test server either | Every behaviour of a real server, and the binding of the secrets of endpoints added after deployment |

### 7.1 What phase 7 built, and where it departs from the design

Everything in this section runs against the in-memory fake of `portal/functions/src/integrations/storage/fake.ts`, whose servers and files in `storage/fixtures.ts` are synthetic and labelled so: an SFTP server in Bremen, an FTPS server in Munich, an object store for an optional central copy and an institutional file system that only uploaded listings describe, all on the example.org domain, with BIDS-shaped file names and made-up digests. The fake reproduces a server that is down, a server that answers slowly, an account refused everywhere or below one path, a path that does not exist, listings in pages, checksums that only object storage states for each file and checksum files that a laboratory keeps beside its data, and it records every file whose content is read, so a test proves that only checksum files are. The emulator's functions and the tests share its state through a file in the run's temporary directory. The real adapters under `storage/real/` (SFTP through the OpenSSH client in batch mode, explicit FTPS over TLS with `MLSD`, a mounted file system, and object storage with Signature Version 4) were written from the protocols' documentation, have never been executed and are unverified. Which adapter runs is decided in `storage/adapters.ts`: the fake in the emulator, the real adapters only where the parameter `STORAGE_SCANS_ENABLED` is "true", and otherwise none. Firestore holds the name of the secret of an endpoint and never a credential.

| Part | Built | Departure from the design |
|---|---|---|
| Registry | `portal/shared/src/schemas/datasets.ts` and `docs/DATA_MODEL.md`, section 10. Every write is a callable function with its audit entry, and the rules only grant reads | The data model let clients write datasets, copies, manifests, transfers and assessments directly. Callable functions write them instead, which keeps the workflow, the history, the summaries of the registry document and the audit entry in one transaction |
| Scans | `storage/scan.ts`: the listing page by page, a time limit for each call, one retry of a call that found the server unreachable, checksum files joined to their directory, and at most 10,000 files, beyond which a listing is uploaded. A scan runs in the callable function that a person starts, and the nightly `storageSweep` checks every scanned server | No task queue: a scan of metadata finishes within one call. A scan that resumes over several calls is not built |
| Comparison | `portal/shared/src/datasets/manifest.ts`: present, missing, unexpected, duplicate (the same path, whatever its case, or the checksum of a file listed before) and mismatch (another size or checksum of the same algorithm), against the latest expected manifest. Manifests are read from `sha256sum` or `md5sum` output or comma-separated values | Adds the status `mismatch` and the kind of a manifest, expected or listing |
| Outages | A check that finds a server out of reach makes its current copies unavailable and their datasets follow, and the next check that reaches it restores the copies its outage alone had made unavailable. A failed scan writes no listing; the copy becomes unavailable with the reason and keeps its last listing and the time it was last seen; a server that is down or too slow becomes unreachable and one notification goes to its owner and to those who manage the integrations; the next check or scan that reaches it restores both | As designed |
| Transfers | Recorded only: requested, approved or refused by someone other than the requester, started, completed or failed as people carry them out, and verified when the latest listing of the destination, made from that copy after completion, matches the latest listing of the source. Two copies in the same folder of one server cannot be the ends of a transfer | Adds approval, which the brief requires before raw research data moves |
| BIDS | `portal/shared/src/datasets/bids.ts` reads the `--json` output of the 1.x validator and of the schema-based 2.x validator into counts, issues by code with their first locations, and missing metadata. The portal never runs the validator | Tested against synthetic reports written from the validator's documentation; the shape of a real report is unverified |
| Viewer links | A link to ElectroTag for a copy that declares support for it, served by `openViewerLink`, which records the request. No call is made to ElectroTag | As designed |

## 8. Email

The portal sends email by two separate paths.

| | Sign-in links | Notifications and digests |
|---|---|---|
| Sent by | Firebase Authentication | A function that works through the `mail` outbox with a mail provider |
| Started by | A member asking to sign in (D-015) | A notification, a digest schedule or a scheduled report |
| Limit | 25,000 a day on the Blaze plan and 5 a day on Spark.[59] | The provider's |
| Sender and link | Firebase's default sender, and a link on the project's default Firebase address, unless a custom domain is configured with a TXT and a CNAME record on the programme's domain.[60] [61] | The programme's domain, with the DNS records the provider asks for |
| Under the emulator | No email is sent. The link is printed in the emulator's log and can be read from its out-of-band endpoint.[62] | Nothing leaves the machine. The fake sender keeps what would have been sent, and the tests read it |
| Evidence | Emulator: the spike completed sign-in by link in Node tests and through the real form in a browser, and the link was single use and bound to its address. Delivery from a real project to the portal's address is unverified until staging | The outbox is built and tested on the emulators against a fake sender (section 8.1). No provider adapter exists, so no message has been sent |

**Sign-in links.** Firebase Authentication composes and sends the message, and the portal's code never sees it. Account data, the address included, is processed by Firebase Authentication in the United States (D-001, decision 3). Whether the body of the sign-in message can be edited in the Firebase console was not verified. The documented route to full control is to generate the link with the Admin SDK and send it through the portal's own provider, which would also give one place for an allow-list check and a rate limit.[63] That is an option for later and is outside the first build.

**The outbox.** Every other message is a `mail` document, which only functions can read or write: the recipient's address, a subject, text and HTML bodies, a template key, a status, the number of attempts, the time of sending and the last error. A notification is always written first to the member's own notifications in the portal, which need no email at all. A function then decides from the member's preferences (channels, digest frequency, quiet hours and the switch for each type) whether a message is due, and writes the outbox document under an identifier derived from the notification, or from the member and the digest period, so that a trigger delivered twice cannot queue the same message twice. A Firestore trigger on the outbox, with a sweep every fifteen minutes behind it, sends it through the mail interface. A success records the time on the outbox document and on the notification. A temporary failure is retried with backoff. A permanent failure, such as a rejected address, is marked as failed with the provider's reason and appears in the health view.

A message carries a title, a short text and a link back to the portal. It never contains a special-category value, and restricted detail stays behind sign-in. Function logs carry document identifiers and never a body or an address (see `docs/SECURITY.md`).

**The provider.** No mail provider has been chosen (decision 7). The mail interface has one operation, so a provider with an HTTP interface and one that speaks SMTP both fit behind it, and the key or password is a secret bound to the sending function. The provider receives members' addresses and the text of each message, so the choice, including where it processes data, belongs to the administrators. Sending from the programme's domain needs DNS records that only the holder of the DNS account can add.

**Development mailbox and dry run.** Under the emulator the fake transport delivers nothing, and a page that exists only in emulator builds lists the outbox with each rendered subject and body, so that developers and browser tests can read what would have been sent. Sending is an external write, so in a real project the outbox fills and nothing is sent until an administrator approves live sending (D-014). On staging, which holds synthetic data only (D-017), recipients are further limited to a list of test addresses.

| Part | Tested now | Blocked until credentials are supplied |
|---|---|---|
| Sign-in links | The whole flow on the emulators | Real delivery, the sender domain and the appearance of the message, until staging |
| Outbox, preferences, digests | Built and tested against the fake sender in phase 9: queuing, deduplication, quiet hours, retry and the failed state | Nothing |
| Mail adapter | The interface and its fake are built | A provider, its account and key, the adapter for it, and the DNS records for the sending domain |

### 8.1 What phase 9 built, and where it departs from the design

The outbox is built in `functions/src/notifications/mail.ts` with the interface in `functions/src/integrations/mail/types.ts` and an in-memory fake sender in `functions/src/integrations/mail/fake.ts`. No real provider adapter exists, because no provider has been chosen, so outside the emulator messages stay queued and nothing is sent. Every test of email ran against the fake.

- A notification queues at most one message, named after it, when the member's preferences allow email for its type. Quiet hours hold the message until they end, an outage is retried with backoff up to five attempts, and an address the provider rejects fails once without retry. `mailOnNotificationCreated`, `mailOnQueued` and the fifteen-minute `mailSweep` drive it.
- Daily and weekly digests of unread notifications are queued once per period, on the member's own clock, by `queueDueDigests`. Scheduled reports (`functions/src/reports/scheduled.ts`) ask for a generated document through the queue of section 3.5 and tell their recipients in the portal; they send no email of their own.
- The text of a message is a title, a short sentence and a link back to the portal. Logs carry identifiers, never an address or a body.
- The email preferences of a member's account page say that delivery by email is not connected, so nobody expects a message that cannot arrive.
- The development mailbox page that this section describes is not built. Under the emulator the fake keeps what would have been sent, which the tests read, and the outbox is not yet listed in the health view of section 9.

## 9. The administration health view

One page of the administration console shows the state of every integration to programme administrators. It reads documents that functions maintain and calls no external system itself, so it works during an outage. Phase 6 built it for Google at `#/admin/integrations`, with tabs for the connections and their health, the mappings, the jobs with the plan of each run, review items, documents and templates, and Drive channels, and a page for conflicts at `#/admin/integrations/conflicts`; browser tests in `portal/tests/e2e/integrations.spec.ts` exercise it against the fake. Phase 7 shows storage servers, their status and their last check at `#/datasets/servers`. Phase 9 added the publishing log and the integration errors of the programme overview, as the last paragraph of this section describes. The rows for links and citations and for email, and imports beside publishing on one page, are designed and not built.

| Shown | Read from | Actions offered |
|---|---|---|
| Connected services: each system, its state, whether it is in dry run or live, the identity it acts under, its last success and its last error | `integrationConnections` | Test the connection, pause, resume, request or withdraw live approval |
| Mappings: each mapped tab with its direction summary, the time and outcome of its last run and the number of cells changed | `syncMappings` and the latest `syncRuns` | Run a dry run now, pause, open the sheet |
| Last success | The connection record, and the latest successful run of each mapping, template, scan and link check | None |
| Pending jobs | Run records in a queued or running state. A run record is written when its task is enqueued, because the depth of a queue cannot be read from Firestore | Cancel a queued run |
| Errors | Failed runs with their attempts and the last error, grouped by connection | Retry now, pause the mapping |
| Conflicts | Open `syncConflicts` with their age, generated documents with a section in conflict, row proposals awaiting review, and open reconciliation items from imports | Open the resolution screen |
| Retries | The attempt count on each run and on each outbox message, and tasks waiting for their next attempt | None |
| Drive notifications | The expiry of each push channel, the time of the last message and of the last poll | Renew the channel |
| Links and citations | Counts of `documentLinks` by access status and of citations by status | Check again |
| Storage endpoints | Status, the time of the last check and its result | Check now |
| Email | Queued, sent and failed messages, with the provider's reason for a failure | Retry, or dismiss a failed message |
| Publishing and imports | `publicationBatches` and `importBatches` by state | Open the batch |

A connection is always in one of six states, and each state other than live names what clears it.

| State | Meaning | Cleared by |
|---|---|---|
| Not configured | No credential or identity exists for the system | Supplying the item in section 10 |
| Dry run | The connection reads and plans and writes nothing externally | A programme administrator's approval |
| Live | Approved external writes are made | Not applicable |
| Degraded | The last attempt failed and retries are under way, or a quota is being respected | A successful retry |
| Needs attention | Retries are exhausted, access was lost, or a guard stopped a write | A person: share the file again, fix the mapping, resolve the conflict, then retry |
| Paused | An administrator, or a guard such as the cell ceiling, stopped the connection or the mapping | Resume |

A move to degraded or to needs attention raises an in-portal notification to the programme administrators and to the owner of the mapping or endpoint, and the programme dashboard carries the count of integrations that need attention. Every action on the page goes through a callable function and is audited.

Phase 9 added the publishing log at `#/admin/publishing` and the automations page at `#/admin/automations`, which lists the rules, their runs with their chains and the event failures, and the jobs of automations appear among the jobs of the integrations page. A failure of GitHub, of the mail sender or of an automation alerts those who manage the integrations once (`functions/src/notifications/alerts.ts`), and the programme overview at `#/overview` carries the integration errors. The email row of the table above is not built: the outbox is not yet listed on any page.

## 10. Credentials and decisions needed

Nothing in this table has been supplied. The fakes, the planners and the tests described above need none of it.

| Item | Who provides it | What it unblocks |
|---|---|---|
| A staging Firebase project on the Blaze plan (decision 1, D-017) | The programme administrators and the owner of the Firebase projects | Every check marked as unverified until staging: the triggers that run the job queue and the outbox, their retries and schedules, Secret Manager, the public HTTPS receiver |
| A dedicated service account for Google Workspace, with a readable identifier that cannot be changed later | The owner of the Firebase projects | Every live Google call |
| Read access for that account to sources A and G, or the files themselves (decision 7) | The owners of the two workbooks | The import of A and G, and with G the register of contributor tables and the demographics |
| Access for that account to sources B to F (naming conventions, community vocabulary, list of studies, prediction-market hypotheses, and the recruitment and contact workbook) and to the contributor sheets, in place before link sharing on source F and the contributor sheets is restricted (decision 8) | The owners of those documents | Repeatable imports once anonymous access is closed |
| Designated sheets, documents and folders shared with that account, with edit rights where the portal is to write | The owner of each file | Drive browsing, two-way synchronisation and updates to generated documents |
| A choice of how generated documents are created: a shared drive, a named person's grant or copies made by hand | The programme administrators. A shared drive needs a Workspace edition that offers one | Creation of generated Docs |
| Which fields of which sheets are synchronised, and in which direction | The programme administrators with the owners of the sheets | The first mapping |
| Approval of each live mapping, template, publication and of live email (D-014) | A programme administrator | Any external write |
| Permission for an HTTPS function open to the internet in the project | The owner of the Firebase projects | Drive push notifications. Polling works without it |
| The plan of the programme's Quire organisation | An administrator of that organisation | Knowing which rows of section 4.6 apply |
| A Quire authorisation by an administrator of the organisation, granting every project and access to contacts, or a JSON export of every project (decision 7) | That administrator | The task migration |
| Agreement to freeze Quire for the final run, and to save the activity logs that matter beforehand | The programme administrators | A complete final import |
| A credential limited to branches and pull requests on this repository, and confirmation that `main` is protected against it | An organisation owner and a repository administrator | Live publishing pull requests |
| Approval to open publishing pull requests, each of which redeploys the shared staging site | The programme administrators and the site's maintainers | The first publication |
| For each research data server: the approved protocol, the host, a read-only account, the permitted paths, and the answers to the questions of section 7 | Each institution, through the programme administrators | Metadata scans of that server |
| A fixed egress address for the scanning functions and approval of its cost, if any server filters by source address | The owner of the Firebase projects and the programme administrators | Scans of such a server |
| A mail provider, its key or password, and DNS records for the sending domain (decision 7) | The programme administrators and the holder of the DNS account | Notification and digest email |
| Optionally, a custom sender domain for sign-in messages | The holder of the DNS account | Sign-in messages that show the programme's domain |
| Optionally, a contact detail to send to public scholarly interfaces | The programme administrators | Identified requests to those interfaces |

## References

[1]: https://firebase.google.com/docs/functions/config-env "Cloud Functions: configure your environment"
[2]: https://firebase.google.com/docs/functions/firestore-events "Cloud Functions: Firestore triggers"
[3]: https://firebase.google.com/docs/functions/task-functions "Cloud Functions: enqueue functions with Cloud Tasks"
[4]: https://firebase.google.com/docs/functions/quotas "Cloud Functions: quotas and limits"
[5]: https://cloud.google.com/terms/data-residency "Google Cloud: data residency"
[6]: https://firebase.google.com/docs/emulator-suite/connect_functions "Firebase Local Emulator Suite: Cloud Functions emulator"
[7]: https://firebase.google.com/docs/functions/schedule-functions "Cloud Functions: schedule functions"
[8]: https://developers.google.com/workspace/guides/create-credentials "Google Workspace: create access credentials"
[9]: https://developers.google.com/identity/protocols/oauth2/service-account "Google Identity: OAuth 2.0 for server-to-server applications"
[10]: https://developers.google.com/identity/protocols/oauth2 "Google Identity: using OAuth 2.0 to access Google APIs"
[11]: https://docs.cloud.google.com/run/docs/securing/service-identity "Cloud Run: service identity"
[12]: https://docs.cloud.google.com/kubernetes-engine/enterprise/knative-serving/docs/securing/service-identity "Google Cloud: service identity and access scopes from the metadata server"
[13]: https://docs.cloud.google.com/iam/docs/reference/credentials/rest/v1/projects.serviceAccounts/generateAccessToken "IAM Credentials API: generateAccessToken"
[14]: https://github.com/google-github-actions/auth "google-github-actions/auth: authentication with workload identity federation"
[15]: https://developers.google.com/workspace/drive/api/guides/about-shareddrives "Drive API: shared drives overview"
[16]: https://developers.google.com/workspace/drive/api/guides/create-file "Drive API: create files"
[17]: https://developers.google.com/workspace/sheets/api/limits "Sheets API: usage limits"
[18]: https://developers.google.com/workspace/drive/api/guides/api-specific-auth "Drive API: choose scopes"
[19]: https://developers.google.com/workspace/sheets/api/scopes "Sheets API: choose scopes"
[20]: https://developers.google.com/workspace/docs/api/auth "Docs API: choose scopes"
[21]: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification "Google Identity: sensitive scope verification"
[22]: https://developers.google.com/workspace/docs/api/how-tos/merge "Docs API: merge text into a document"
[23]: https://developers.google.com/workspace/drive/api/guides/enable-shareddrives "Drive API: implement shared drive support"
[24]: https://developers.google.com/workspace/drive/api/guides/handle-errors "Drive API: resolve errors"
[25]: https://developers.google.com/workspace/drive/api/reference/rest/v3/files "Drive API: files resource"
[26]: https://developers.google.com/workspace/drive/api/guides/about-changes "Drive API: changes and revisions overview"
[27]: https://developers.google.com/workspace/sheets/api/reference/rest "Sheets API: REST reference"
[28]: https://developers.google.com/workspace/drive/api/guides/push "Drive API: notifications for resource changes"
[29]: https://developers.google.com/workspace/drive/api/guides/limits "Drive API: usage limits"
[30]: https://support.google.com/googleapi/answer/7072069 "Google API Console help: domain verification"
[31]: https://developers.google.com/workspace/drive/api/guides/manage-changes "Drive API: retrieve changes"
[32]: https://developers.google.com/workspace/events/guides/create-subscription "Google Workspace Events API: create a subscription"
[33]: https://developers.google.com/apps-script/guides/triggers/installable "Apps Script: installable triggers"
[34]: https://developers.google.com/workspace/sheets/api/guides/concepts "Sheets API: overview and concepts"
[35]: https://developers.google.com/workspace/sheets/api/reference/rest/v4/ValueRenderOption "Sheets API: ValueRenderOption"
[36]: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.developerMetadata "Sheets API: developer metadata resource"
[37]: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchUpdateByDataFilter "Sheets API: values.batchUpdateByDataFilter"
[38]: https://developers.google.com/workspace/sheets/api/guides/metadata "Sheets API: read and write developer metadata"
[39]: https://developers.google.com/workspace/drive/api/reference/rest/v3/User "Drive API: User resource"
[40]: https://developers.google.com/workspace/sheets/api/guides/values "Sheets API: read and write cell values"
[41]: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/cells "Sheets API: cells"
[42]: https://developers.google.com/workspace/sheets/api/troubleshoot-api-errors "Sheets API: troubleshoot errors"
[43]: https://developers.google.com/workspace/docs/api/limits "Docs API: usage limits"
[44]: https://developers.google.com/workspace/drive/api/guides/manage-downloads "Drive API: download and export files"
[45]: https://developers.google.com/workspace/drive/api/guides/manage-uploads "Drive API: upload file data"
[46]: https://developers.google.com/workspace/docs/api/how-tos/suggestions "Docs API: work with suggestions"
[47]: https://developers.google.com/workspace/docs/api/how-tos/named-ranges "Docs API: work with named ranges"
[48]: https://developers.google.com/workspace/docs/api/reference/rest/v1/documents "Docs API: documents resource"
[49]: https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/request "Docs API: batch update requests"
[50]: https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate "Docs API: documents.batchUpdate"
[51]: https://developers.google.com/workspace/docs/api/how-tos/tables "Docs API: work with tables"
[52]: https://quire.io/dev/api/ "Quire API reference"
[53]: https://quire.io/guide/activity-log/ "Quire guide: activity log"
[54]: https://quire.io/pricing "Quire pricing"
[55]: https://quire.io/guide/export-to-csv-json/ "Quire guide: export projects to CSV or JSON"
[56]: https://github.com/quire-io/quire-cli "Quire CLI"
[57]: https://quire.io/guide/task-dependency/ "Quire guide: task dependencies"
[58]: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows "GitHub Actions: events that trigger workflows"
[59]: https://firebase.google.com/docs/auth/limits "Firebase Authentication limits"
[60]: https://firebase.google.com/docs/auth/web/email-link-auth "Firebase Authentication: email link sign-in"
[61]: https://firebase.google.com/docs/auth/email-custom-domain "Firebase Authentication: custom email domain"
[62]: https://firebase.google.com/docs/emulator-suite/connect_auth "Firebase Local Emulator Suite: Authentication emulator"
[63]: https://firebase.google.com/docs/auth/admin/email-action-links "Firebase Authentication: generate email action links"
