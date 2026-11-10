# #EEGManyLabs Hub: security and governance

This document describes the security design of the members' portal, the data it holds, the controls that protect that data and the findings from discovery that need a decision from the programme administrators. It follows `docs/DECISIONS.md`, whose entries are cited as D-001 to D-017 and whose closing list of decisions for the administrators is cited as decision 1 to decision 8. It should be read with `docs/ARCHITECTURE.md` for the system boundary and `docs/DATA_MODEL.md` for the documents referred to here.

Three kinds of evidence are kept apart throughout. **Verified on the emulators** means that the application spike of 9 November 2026 ran the behaviour against the Firebase Local Emulator Suite with a demonstration project identifier. That run passed 177 emulator-backed tests and 15 browser tests, and no request left the machine. Its build was served by a local static server that reproduces the relevant behaviour of GitHub Pages, so no result was observed on Pages itself. **Documented** means stated in vendor documentation read on the same date and cited in the references. **Unverified until staging** means that only a real Firebase project can confirm it, and no such project exists yet. The spike was throwaway code kept outside this repository. Its results show that a mechanism works, and each control below remains a design until the portal's own tests under `portal/` re-establish it. Section 12 gives the status of each control at the end of discovery.

## 1. What changes when the portal is added

The public website is a static site. It holds no personal data beyond what has been approved for publication, has no server-side state and has no secrets at run time. The portal changes that position. It will store contact details, special-category demographic data, private notes, recruitment correspondence and the locations of research datasets.

The portal's front end is as public as the website. It is a static bundle on GitHub Pages, built from a public repository, and its HTML, JavaScript, route names, interface text and Firebase web configuration can be read by anyone. Firebase documents that this configuration may be committed and that data is protected by security rules and App Check, with no reliance on keeping the key secret.[1] The security boundary therefore sits at the Firebase project. The portal's data travels directly between the member's browser and Google's services and never passes through GitHub, which sees only the request for the static files and the visitor's IP address (section 9). Everything on the browser side of that boundary is untrusted, the portal's own code included, so each protection is enforced by Firebase Authentication, security rules and Cloud Functions.

Three rules follow from that boundary and apply to every change. Private data never enters the Git repository, the static build, a test fixture or the public site. Every read and write of private data is decided by a security rule or by a callable function, and the interface hides what a user may not do as a convenience only (D-006). The public website receives data from the portal only through the approved publishing route: an export of approved public fields, a preview, a programme administrator's approval and a pull request on the website repository, which then follows the release route in the README.

The bundle is the code that every member runs with their own session. The branch protection of this repository and the gated publishing workflow are therefore security controls in their own right, and section 8 describes them.

## 2. Data classification

| Class | Examples | Who may read it | How it is held |
|---|---|---|---|
| Public | Names and affiliations already approved for the Members and Core Team pages, replication summaries, publications, approved aggregate recruitment | Anyone, through the public website | Leaves the portal by the publishing route only |
| Member | Directory entries, replication workspaces, laboratory profiles, task lists | Signed-in members whose claim has been approved, subject to scope | Documents readable under the member rules |
| Restricted | Email addresses, postal addresses, outreach and recruitment correspondence, private notes, storage paths and server details, verbatim import rows | The person concerned, programme administrators, the core team, and scoped roles for the records of their own replication or laboratory | Separate documents with rules of their own |
| Special category | Gender and ethnicity | The person concerned, for their own record, and users holding an explicit, time-limited grant | A separate document that no client can read, served by a callable function |

Gender and ethnicity are special-category or sensitive personal data under UK GDPR. They are to be imported in full, with the original source terms preserved, as the programme requires. Firestore grants reads per document and cannot hide a field inside a document a caller may read, so the values live in a demographics document of their own, apart from the directory document and the restricted contact document of the same person.[2] The rules deny every client read of that document, whatever the caller's role (D-006). The verbatim import rows of source G are expected to carry the same values and are to be held under the same rule.

The only path to the values is a callable function. It returns a person's own values to that person. For any other caller it requires a grant that names the caller, was issued by a programme administrator with a reason and an expiry time, and has not expired, and it requires a session in which a second factor was verified. Every reader other than the person concerned needs such a grant, programme administrators included. The function writes an audit entry in the same call and then returns the data. A read through a function is the only kind of read that can be audited by the portal's own code, because Firestore triggers fire on writes alone.[3]

The values are kept out of every other place. Search indexes are built from member-class content and never contain them. They are never written to function logs, error messages, custom claims on the sign-in token, display names, email bodies, task-queue payloads or synchronised spreadsheets. Audit entries record that a demographic field changed and omit both the old and the new value. Because no client reads the document, the values never enter the browser's offline cache. Analysis screens receive aggregates computed by the function, and small cells are suppressed by default so that a filter cannot single out an individual.

The spike verified the split itself: with the demographics document separate, programme administrators, the core team, replication leads, laboratory coordinators, ordinary members and anonymous callers were all refused it, and the audit trigger dropped the values of the configured sensitive fields. The spike's rule set still let the person concerned and a grant holder read the document directly. The stricter arrangement described above, with the function as the only reader, the time limit on the grant, the second-factor check and the small-cell suppression, is designed and has no test yet.

## 3. Authentication

Each person signs in as an individual. Shared passwords and shared accounts are not supported, and replication or laboratory teams work together through group workspaces in which every edit remains attributed to the individual who made it.

Sign-in is passwordless (D-015). A member enters an email address and receives a single-use link, or signs in with Google through a pop-up window. The portal has no password field. GitHub's guidance is that Pages sites "shouldn't be used for sensitive transactions like sending passwords", and a sign-in form served from Pages would fall under it even though the credentials themselves would be posted to Google.[4] Password sign-up stays disabled in the Firebase project. On the emulators the emailed link worked once only and only for the address it was issued to. The address is supplied again when the link is completed, is remembered in the browser for a same-device sign-in, and is never carried in the return address, which follows Firebase's guidance.[5] Completing a link gave the account a verified address on the emulators, and the claim flow in section 4 depends on that.

Google sign-in uses the pop-up flow because the redirect flow needs the sign-in helper to be served from the application's own site, which Pages cannot provide.[6] It sits behind a build flag. On the emulators a Google credential was accepted and attached to the same account as the email link. The pop-up window itself has not been run, and the linking of the two methods has to be repeated on staging.

A session is a pair of Firebase tokens held in the browser's storage for the portal's origin. The identity token lasts one hour. The refresh token has no fixed lifetime and ends only when the account is deleted or disabled or a major account change is detected.[7] Firebase's documentation describes no interface for listing a user's sessions or devices, so the portal provides sign-out on the current device and an "end all sessions" operation carried out by a function. The session lives in browser storage that scripts can read, without the protection of an HTTP-only cookie, which is why the portal's own origin and its strict script policy matter (section 8).

Disabling an account and revoking its refresh tokens both leave an already issued identity token usable for up to an hour, and security rules cannot see either action. The spike measured what each step achieves.

| Action | In the member's browser | In a function that checks revocation | In security rules |
|---|---|---|---|
| Disable the account | The cached identity token keeps working. Refresh and new sign-in fail | The token is rejected | No effect for up to one hour |
| Revoke the refresh tokens | The next refresh fails in production (documented). The emulator still refreshed, so this is unverified until staging | The token is rejected | No effect for up to one hour |
| Suspend the user in the access document that the rules read (section 5) | A live listener on the document forces a refresh and signs the member out (written, with no browser test yet) | A sensitive function is to read the same document (designed, with no test yet) | The very next request with the same token is denied (verified with emulator tokens) |

Offboarding and suspension are therefore one function that performs all three steps, and the third is the one that takes effect at once. The spike's access document also carried a time before which sessions are refused, which the rules compared with the sign-in time in the token. Raising that time ended every existing session at the next request without suspending the user, and the "end all sessions" operation relies on it. According to the SDK's source, a callable function in production verifies the token's signature and does not check revocation, so every sensitive function checks revocation itself or reads the access document. The functions emulator decodes tokens without verifying them, so an emulator pass is never taken as proof of token verification.

Programme administrators and the core team must enrol a time-based one-time password as a second factor. This needs the upgrade to Firebase Authentication with Identity Platform, which is free at this scale, and the factor is switched on through the Admin SDK.[8] The design withholds administrative and demographic capabilities from those accounts until a factor is enrolled and has been verified in the current session, and the enforcement point is the callable function behind each sensitive operation. Whether security rules can also test for a second factor is open. The rules reference lists no such claim, while the emulator's token carried a second-factor claim after a challenge, and the question is to be settled on staging.

The emulator cannot exercise any of this. It implements text-message factors only, and enrolling a one-time-password factor fails there. What was verified is the sequence around it: after an email link, an account with an enrolled factor is stopped, challenged, and receives a token only when the challenge is answered. That was run end to end with the emulator's text-message factor, and the enrolment and challenge code for one-time passwords is written and type-checked. The real journey is verified on the staging project once it exists (D-016), together with two points the documentation leaves implicit: that an account created by email link can enrol the factor, and that the administrative reset removes it.

Firebase provides no recovery codes. Its documentation advises enrolling more than one factor and warns that a user who loses a single factor is locked out.[9] Recovery is therefore an administrative procedure: a function restricted to programme administrators removes the lost factor and writes an audit entry. The identity checks that precede such a reset are for the programme to define, and until they are defined the procedure is incomplete.

## 4. Claiming a pre-populated profile

Profiles for existing members, laboratories and replications are created from the programme's sources before anyone is invited. A person record and a login are different things, and a claim links exactly one Firebase account to exactly one person (D-005). The claim flow is designed to resist account enumeration and takeover.

The sign-in form gives the same response for every address. Firebase's email enumeration protection is on by default for new projects, and the documentation and the emulator's source indicate that a request for a link succeeds identically for known and unknown addresses; the production behaviour is unverified until staging.[10] With Firebase's own sending, a link does reach any address that is entered, and its owner could create an account. That account alone opens nothing, because no rule grants access to a caller who is merely signed in. A blocking function that runs before an account is created is the second line. On the emulators it refused accounts from a configured domain, in the email-link flow included. Refusing every address that has neither a claim-eligible person record nor a pending invitation is the designed production rule, and it needs Identity Platform. Sending the link from a function through the programme's mail provider would also allow nothing to be sent to an unknown address, and that option depends on the mail provider in decision 7. The emulator applies no rate limiting, so throttling is untested. Firebase's own limits apply in production.[11]

After sign-in the application calls the claim function. The function takes no arguments and refuses a call that carries any. The only address it ever looks up is the one in the caller's own token, and only when Firebase has verified it, so a caller cannot use it to ask about anyone else. The lookup goes through an index keyed by a hash of the normalised address, which no client can read, programme administrators included. Every document the function changes is written in one transaction.

A single unclaimed match is approved automatically and grants ordinary member access. Everything else goes to review: an address attached to more than one person and a person who is already claimed both receive the same "pending review" answer with no further detail, and one review record per account is opened for a programme administrator. A member who reports that an automatic match is wrong reaches the same queue. An address with no match leaves the account without access. A person can be linked to one user only.

Roles that carry management powers are handled with more caution. When the imported data says that a person leads a replication or coordinates a laboratory, the role is created in a pending state at the moment of the claim, and a programme administrator confirms it. Several of the source spreadsheets can be read by anyone who has the link (section 11), so an email address found in them is sufficient evidence for ordinary membership and is insufficient evidence, on its own, for management rights.

Laboratory claiming is a separate request by a claimed member, made through a function. The request records the evidence, such as an imported affiliation with the laboratory or a verified address in the institution's domain, and is approved by a programme administrator or by an existing authorised representative of that laboratory. A laboratory may have several authorised representatives. The email address is the key of a claim. The index used for matching is therefore written by functions only, and a change to a claim-eligible address takes effect through a function. In the spike the rules refused every client write to the contact document.

The spike's nine tests of the claim function proved the following on the emulators. An unauthenticated caller is refused. A caller with an unverified address receives the identical error whether or not the address is in the registry. A call with arguments is refused. A single unclaimed person is linked in one transaction, and a repeated call changes nothing. Several matches and an already-claimed person both produce the pending-review answer and a review record. When two accounts race for one person, exactly one is linked. The spike's function granted the lead and coordinator scopes immediately, which suited synthetic data. The pending state for management roles, the administrator's review screens and laboratory claiming are designed and have no test yet.

## 5. Authorisation

| Role | Scope | Summary of rights |
|---|---|---|
| Programme administrator | Programme | Full operational read and write, user and role management, imports, integrations, publishing approval, audit |
| Core team | Programme | Broad operational read and write. Sensitive operations (role management, demographic data, import rollback, credentials, publishing approval) are controlled by a capability matrix that administrators can adjust |
| Replication lead | One replication | Manages that replication, its participations, hypotheses, protocols, tasks and datasets, and may read contact details of its participants |
| Laboratory coordinator | One laboratory | Maintains the laboratory profile, equipment, members and the laboratory's participation and recruitment records |
| Laboratory member | One laboratory | Reads the laboratory and its participations, and submits recruitment updates where the coordinator allows |
| External collaborator | Explicit grants | Reads or edits only the pages and records shared with them |

Security rules decide every direct read and write, and callable functions decide every privileged operation and every change that spans several documents (D-006). Rules deny by default, so a collection without a rule is closed. Functions and importers use the Admin SDK, which bypasses rules entirely, so each function checks its caller before it acts. In production callable functions are to accept requests from the portal's origin only; the spike used the default, which accepts every origin.

Roles are carried by one access document per user, `access/{uid}`. Functions resolve it from the user's role assignments, the capability matrix and any named grants, clients can read their own and can never write it, and the rules read it on each request. The spike implemented this and the alternative of custom claims on the sign-in token from one shared policy, ran the same 66 policy tests against both, and its result is the evidence for confirming the mechanism that D-006 records as provisional.

| | Access document read by the rules | Custom claims on the token |
|---|---|---|
| Delay before a removed role or a disabled account stops working | None. The next request with the same token is denied (verified) | Up to one hour. A token issued before the change keeps its access (verified) |
| Limits | None met. The costliest request in the spike read 3 documents in rules against a documented limit of 10 | 1,000 bytes for all claims. Sixty-four replication identifiers of twelve characters fitted and the sixty-fifth was refused (verified) |
| Disabled or revoked account | Detectable | Invisible to rules |
| Cost | One extra billed document read per evaluated request, charged even when the request is denied (documented, and the emulator cannot measure it) | No read |

The access document is the authority because revocation is immediate and scope lists have no ceiling.[12] The spike recommends mirroring a few programme-level flags into custom claims for interface gating and Storage rules. A sensitive read is never authorised from claims alone.

Scope is expressed in the data. Records carry the identifiers of their replication and laboratory, together with the scope keys defined in `docs/DATA_MODEL.md`, and a rule compares them with the scope lists in the caller's access document. In the spike a coordinator could update their own laboratory and a lead their own replication and its participations, while the same writes to another unit, any change to who leads or coordinates, and any attempt at self-promotion were refused.

Rules are not filters. Firestore evaluates a list query against everything it could return, so a query must itself carry constraints that satisfy the rule.[13] Lists of scoped records are therefore queried by a scope the caller holds, with a bounded size. The spike accepted such a query and refused the same list with no constraint, with another laboratory's identifier, with no limit and with a limit above the permitted maximum.

Field-level secrecy is achieved by splitting documents, as section 2 describes for a person. For the contact document the spike allowed the person, programme administrators, the core team, a lead of a replication the person takes part in and a coordinator of the person's laboratory. It refused ordinary members, leads and coordinators of other units, holders of a demographics grant, pending members, anonymous callers, every listing and every attempt to harvest contact documents across people.

The capability matrix restricts sensitive operations for the core team. It is configuration that only a programme administrator can change, and the function behind each sensitive operation consults it. Grants to external collaborators are explicit and attach to individual pages and records. The matrix, those grants and the rules for workspace pages are designed. The rules for page content and for the stored editor updates and snapshots are provisional and pending the editor spike (D-010).

Every rule is to have a test that proves the denial. In the spike 45 of the 66 policy tests were denials, and every statement that allows something had at least one test in which an unauthorised caller was refused. The spike's rules covered persons, contact and demographics documents, laboratories, replications, participations, recruitment reports, access documents and the audit collection. The remainder of the model is written to the same standard before any real data is loaded (D-016). Storage rules were tested in the same way: an upload was accepted from its owner only, within a size limit, for permitted file types and as a file that cannot be overwritten, listed or deleted by a client.

## 6. Audit, logging and retention

The audit trail is written by trusted code (D-007). A callable function writes its audit entry in the same transaction as the change it makes. Every other write is captured by a Firestore trigger that records the path, the operation and a field-by-field difference with the configured sensitive fields omitted. Trigger delivery is at least once, unordered and may lag the write by seconds, so each entry uses the event identifier as its document identifier.[3] On the emulators three deliveries of one event produced one entry, the difference was correct and sensitive values were dropped.

Clients cannot write the audit collection, which the spike verified for create, update and delete in every role. Direct reads are designed to be closed to clients as well, with a programme administrator consulting the trail through a callable function. The spike's rule set still allowed an administrator to read the collection, and that rule is to be tightened in the build.

The acting user in a trigger entry is unverified until staging. The emulator supplies fixed placeholders in place of the writer's identity, and the documentation does not describe what production supplies for a Firebase Authentication user. The actor is therefore also recorded in the data: rules require each client-written document to carry the writer's own user identifier and the server's time, and the spike refused a forged author and a client-supplied timestamp.

Claims, role changes, imports, synchronisation runs, exports, publishing, second-factor resets and reads of special-category data are audited by the functions that perform them. Sign-in itself happens inside Firebase Authentication. Identity Platform can log user activity, a feature that is off by default and may affect billing, and Firestore's Data Access audit logs can record reads as a backstop.[14] Turning either on is a decision for the administrators.

Logs never contain secrets, tokens, sign-in links, email bodies or special-category values. Function logs and task-queue payloads carry document identifiers only. A document that fails validation in the browser raises an error that names its path and never its content.

Retention periods, the lawful basis for holding demographic data, and the process for subject access and erasure requests are governance decisions for the programme. The portal provides the mechanisms: a per-person export of everything held about them, correction requests, archival, and an erasure procedure that removes personal fields while keeping the scientific record and the audit trail intact. These mechanisms are designed and unbuilt. Erasure has to account for copies outside the live database: scheduled backups are retained for up to 14 weeks,[25] point-in-time recovery reaches back 7 days,[24] and Firebase Authentication removes deleted account data within 180 days.[15] The periods themselves are recorded in this document once the programme has approved them.

## 7. Secrets, integrations and research data

No secret is stored in the repository, in the bundle or in the database. The front-end deployment needs no secret in GitHub, because Pages publishing uses the workflow run's own identity. Secrets used by functions are held in Google Secret Manager, declared through function parameters and bound to the individual functions that need them.[16] On the emulators a function received a declared secret from a local secrets file and proved its presence without returning the value. The deprecated function configuration store is not used.

Functions run as a service account, and each integration receives the least privilege that its job needs (D-014). The Google Workspace adapter reaches only the files that have been shared with its account and requests only the scopes of the job in hand. A storage account for metadata scans has read-only listing rights. The publishing token is limited to opening pull requests on the website repository. The Quire migration is designed as a read-only pull run from a trusted environment, because a static site cannot hold an OAuth client secret. Every adapter that writes to an external system defaults to a dry run, and a live external write needs explicit approval.

Imports and deployments run from an administrator's machine or a protected workflow (D-012). From GitHub Actions they are designed to authenticate with workload identity federation, which issues short-lived credentials, so that no service-account key is stored. The spike's import scripts refused to touch anything other than the emulator unless an explicit production flag was given.

The portal is a registry of where EEG data is held. It records paths, manifests, checksums and status, and it never requires raw recordings to pass through it. Metadata scans read file listings and checksums only. A storage endpoint stores a reference to its credential, which is the name of a secret, and never the credential. Storage paths and server details are restricted data. Cloud Storage for Firebase holds only documents uploaded to the portal under the rules described in section 5.

## 8. Application hardening on GitHub Pages

GitHub Pages serves files and cannot set HTTP response headers (D-001). The Content Security Policy is therefore generated at build time and delivered by a `<meta>` element placed at the top of the document head, directly after the character-set declaration, because a policy in a meta element applies only to what follows it.[17] The policy starts from `default-src 'none'`. It allows scripts, fonts and manifests from the portal's own origin only, with no inline script and no `eval`, lists each Firebase endpoint the application connects to, forbids frames and plugins, and restricts the base address and form targets to the origin. On the emulators no online flow of the main browser suite produced a violation, and the policy was shown to be enforced: a request to an unlisted address was blocked and an injected inline script did not run. The production policy is generated by the same code from the hosts named in the Firebase SDK and has not been exercised against production. Accepting the posture described in this section, or asking for the portal's files to be served another way, is decision 5.

The spike found three adjustments necessary. The validation library probes for dynamic code generation on its first use, which the script policy blocks and reports, so it is configured once to run without it. The dialog component injects one inline style element, so `style-src` keeps `'unsafe-inline'` for styles while scripts stay strict. Firestore requests one fixed image from a Google address when its connection fails, to tell a network fault from a server fault, so the production policy lists that exact address under `img-src`. Google sign-in and App Check each widen the policy with Google script and frame hosts when they are switched on, which is part of their cost.

| Control | On GitHub Pages | Compensation |
|---|---|---|
| Script, style, connection, image, frame, form and base restrictions | Available through the meta policy, without nonces | None needed |
| `frame-ancestors` and `X-Frame-Options` (clickjacking protection) | Unavailable. The spike showed the application rendering inside a foreign frame | A frame check in the bundled script that refuses to run inside a frame. This is weaker than the header and is designed, with no test yet |
| Violation reporting and a report-only trial of a policy | Unavailable | A policy change is tested enforced, on staging. Violations can be observed only inside the page |
| An HSTS header of our own | Unavailable. HTTPS is enforced by GitHub's redirect | The policy upgrades insecure requests. No full substitute exists |
| `X-Content-Type-Options`, `Permissions-Policy`, cross-origin opener and embedder policies | Unavailable | None |
| Referrer policy | Available through a meta element | None needed |

Four further measures compensate for what headers would have given. The portal has an origin of its own on a subdomain (D-002), so its sign-in state is shared with no other site, and the third-party scripts that the public website loads from content delivery networks never run where members' tokens are held. On the interim default Pages address that isolation is absent, because every project site of the organisation without a custom domain shares one origin. No other project site is published there today. All third-party code is bundled and the fonts are self-hosted: in the spike's browser tests the only host contacted for page resources was the site itself. The published artefact contains no source maps, environment files or keys. The spike's build emitted source maps, so the production build switches them off, and the proposed publishing workflow refuses an artefact that contains any. Publishing is triggered manually and waits in a protected environment for a named reviewer (D-004). The workflow is a proposal that is absent from the repository so far, and the environment has to be created and protected by a repository administrator before the workflow file reaches `main`, because GitHub creates an unprotected environment for any workflow that names a missing one.[18]

Pages serves `index.html` with a fixed ten-minute cache, which was observed and is undocumented, so a front-end fix can take that long to reach a browser and an open tab keeps the bundle it loaded. Enforcement never depends on the bundle, for the reasons in section 1. On the Firebase side, sign-in completes only for the authorised domains listed in the project's settings, and the portal's addresses are the only ones added to that list.

App Check attests that a request comes from the genuine site, using reCAPTCHA Enterprise. Enforcement is switched on per product, and Firebase describes the protection as one that "prevents some, but not all, abuse vectors".[19] It raises the cost of scripted abuse of the public configuration. It does not identify a user or authorise anything, and it is never a substitute for a rule. On the emulators the client wiring was verified, the token was attached to Authentication, Firestore and Functions calls, and a function with enforcement refused a call without a token. Issue and verification of real tokens, enforcement in Firestore, Storage and Authentication, scoring and replay protection cannot be tested locally, because App Check has no emulator and the functions emulator accepts unsigned tokens. reCAPTCHA sends browser signals to Google for scoring, which the administrators weigh in section 9, and Firebase advises observing the metrics of a product before enforcement is switched on for it. Debug tokens are kept in the secret store of the test pipeline and are never built into a published bundle.

Input is validated in three places. In the browser every document kind has a schema, every document read from Firestore is parsed against it, and a build check fails if a route or component reaches Firestore, Storage, Functions or the validation library without going through the data layer; the spike ran all three. In functions every input is to be validated with a schema before any work is done, and users are shown messages chosen by error code and never the raw error text. The spike's claim function took no input and refused any, so schema validation in functions is designed. In the rules every client-writable collection has a shape floor: required keys, no unexpected keys, types, ranges, the writer's own identifier, the server's time and immutable fields. The spike refused a missing key, an unexpected key, a wrong type, an out-of-range number, a forged author, a client timestamp and a dangling reference. Rule-level validation becomes impractical for nested maps, arrays of objects and many optional fields, so complex writes go through a callable function.

Firestore's offline cache in the browser persists between sessions, and Google advises asking whether a device is trusted before enabling it for sensitive data.[20] The spike ran with the cache on. Special-category data never enters it, while restricted documents a member may read would. The behaviour on shared machines is a build decision to be recorded here.

## 9. Data location and compliance facts

These are facts for the programme administrators to decide on, under decisions 2, 3 and 5. This section gives no legal advice.

| Service | Where data is stored or processed | What it holds for the portal |
|---|---|---|
| Cloud Firestore, Cloud Functions, Cloud Storage, Secret Manager | London (`europe-west2`) as recommended in D-003, chosen when each resource is created. For Firestore the choice is permanent. Google commits to storing customer data at rest only within the selected region | All portal records, including restricted and special-category documents, uploaded files and secrets |
| Firebase Authentication with Identity Platform | The United States only. The location cannot be chosen, and the service is absent from Google's list of services with data residency | Email addresses, user identifiers, sign-in metadata, IP addresses, user agents and second-factor enrolment |
| Cloud Tasks and Cloud Scheduler | Absent from the data residency list | Job payloads, which carry document identifiers only |
| App Check with reCAPTCHA Enterprise | No location selection | Browser signals sent to Google for scoring. Optional per product |
| GitHub Pages | GitHub's infrastructure. Its location was not examined | Static files only. GitHub logs and stores each visitor's IP address for security purposes |
| Google Workspace (synchronised Sheets, generated Docs) | Under Workspace terms and location settings, separate from Google Cloud | Whatever columns the administrators choose to synchronise |

Firebase Authentication "processes data exclusively in the United States", keeps logged IP addresses for a few weeks and removes other account data within 180 days of deletion.[15] Every member's email address and sign-in metadata is therefore processed there whatever region Firestore uses, and this cannot be configured away within Firebase. Gender and ethnicity never need to enter Authentication, and section 2 keeps them out of it. Google's location commitment covers storage at rest, and its terms add that the services do not limit the locations from which data may be accessed.[21]

Firestore, Functions, Storage, Authentication and App Check are governed by the Google Cloud Platform Terms and the Cloud Data Processing Addendum, which defines UK GDPR and handles restricted transfers through standard contractual clauses or an alternative transfer solution.[22] Firebase states that customers typically act as the data controller and Google as the processor, that Google is certified under the EU-U.S. Data Privacy Framework and its UK Extension, and that its services have completed the ISO 27001 and SOC 1, SOC 2 and SOC 3 evaluations.[15] GitHub's statement on visitor IP addresses is in its Pages documentation.[23]

The controller's obligations stay with the programme: the lawful basis and the condition for special-category data, a data protection impact assessment, retention, records of processing and breach handling. Nothing above discharges them. The public website's Privacy page currently states that the site "does not provide user accounts". That wording needs revisiting when an entry point to the portal appears, and the portal needs a privacy notice of its own that names GitHub's IP logging and the Google services in use.

## 10. Backups and recovery

Three Firestore mechanisms are used together, and all three need the Blaze plan. Point-in-time recovery is off by default and, once on, keeps one version per minute for 7 days, from which the database can be cloned or exported at a chosen moment.[24] Scheduled backups allow at most one daily and one weekly schedule per database with retention of up to 14 weeks. A backup stays in the database's location, and a restore writes into a new database.[25] A managed export writes the database to a storage bucket. It has no scheduler of its own, so a scheduled function starts it, and it is tied to a point in time only when it is taken from point-in-time recovery data.[26] All of these copies stay inside Google and inside the same location. A readable copy that is independent of Google is a separate job that the portal has to build, and where that copy would be kept is a decision for the administrators.

Security rules, indexes and function code are deployed from this repository and are recovered from it. The mechanisms above cover Firestore. Discovery did not examine backup of Authentication accounts or of Storage objects, and the rehearsal has to cover both.

A restore is rehearsed before any production rollout and the result is recorded in `docs/TEST_REPORT.md`. Because these are features of a real project, nothing in this section has been exercised yet. Staging and production are separate Firebase projects with separate credentials and separate Pages sites (D-017). Staging holds synthetic data only and never a copy of production personal data.

## 11. Findings from discovery that need a decision

These findings come from inspecting the sources and the hosting during discovery. They are stated here so that the administrators can act on them. No setting on any external document, repository, domain or account has been changed.

**Several source spreadsheets are readable by anyone who has the link, without signing in.** Sources B (naming conventions), C (community vocabulary), D (list of studies), E (prediction-market hypotheses) and F (recruitment and contact workbook), and the five known contributor sheets, were all obtained during discovery by a session that held no Google credentials. Source F is mostly personal data: names, email addresses, contact dates, responses and free-text remarks about named researchers. The contributor sheets contain email addresses. Sources A (historical replication coordination workbook) and G (membership and contributor workbook, which the project brief describes as holding gender and ethnicity) correctly refused anonymous access and have not been inspected. Discovery was read-only and did not test whether any of these sheets can also be edited through the link. The recommended action is to restrict F and the contributor sheets to named accounts, or to the portal's service account, once the import has been verified (decision 8). For that reason this repository refers to the sources by letter and title only, and the identifiers and addresses of the documents are kept in private configuration (D-012).

**The repository is public, and so is everything the portal publishes.** Everything committed here is world-readable, and the built portal on Pages is readable by anyone even though its data is protected. Test fixtures are synthetic and labelled as such. Beyond the data already published on the public website, no real member data, source export, row of an outreach tab or credential is committed.

**Staging of the public site is a single shared environment that every pull request redeploys.** The existing workflow has no path filter, so a pull request that touches only `portal/` or `docs/` rebuilds and redeploys the staging site, and its merge redeploys production. Discovery built both branches and found such a redeploy to be content-neutral today. The choice between staging and production is an expression inside the workflow file, and the deployment token is a repository secret, so the separation of the two environments is a convention that any branch of this repository can edit. This property predates the portal. The existing `deploy.yml`, `.do/app.yml`, `Dockerfile` and `nginx.conf` are left unchanged (D-004), and whether the portal source moves to a repository of its own is decision 6.

**Both domains have wildcard DNS records.** Any label under `eegmanylabs.org` or `eegmanylabs.dev` resolves to the corresponding public-site application. `portal.eegmanylabs.org` already resolves that way and fails in the TLS handshake, so the name is unused. GitHub advises against wildcard records for Pages because of domain takeover.[27] The existing wildcards point away from GitHub and create no Pages takeover risk as they stand, and the domain is not yet verified for GitHub Pages. Three safeguards apply when the portal address is created: an organisation owner verifies the domain and keeps the verification record, the custom domain is entered on GitHub before the DNS record is added, and the record is removed if Pages is ever disabled.[28] The holder of the DNS account is asked to say whether the wildcards are intentional and whether a manually added record survives a deployment of the public site.

**GitHub Pages is still enabled on the legacy website repository and holds the `www` address.** Visitors never reach it, because public DNS sends that name to the current host. A registration guide published there in September 2026 is consequently unreachable at any working address. The legacy site does not obstruct the portal. Its state was inferred from HTTP responses, because the Pages settings were not readable. The administrators decide whether to keep it, and removing its custom domain would be required before the public site could ever move to Pages.

**The public website sends no security headers and loads third-party scripts without integrity attributes.** This was observed during discovery and is unchanged by the portal. It adds weight to giving the portal an origin of its own, and it is relevant to the redirect page at `eegmanylabs.org/portal`, which is added to the public site as the final step of the rollout (D-002).

## 12. Security controls and their verification status

"Verified on emulator" refers to the spike and has to be repeated by the portal's own tests. "Designed" means specified here with no test yet. "Blocked until staging" means that only a real project or a repository setting can confirm it.

| Control | Status |
|---|---|
| Role and scope rules, each with a test that proves the denial (spike subset of the model) | Verified on emulator |
| Immediate revocation through the access document | Verified on emulator |
| Contact document readable only by the permitted roles | Verified on emulator |
| Demographics document refused to every role without a grant | Verified on emulator |
| Demographics served only by a function, with a time-limited grant, a second factor, an audit entry and small-cell suppression | Designed |
| List queries constrained to the caller's scope and bounded | Verified on emulator |
| Rule-level shape validation and append-only recruitment reports | Verified on emulator |
| Claim function: no arguments, uniform refusal, single match linked, review for the rest, one person to one user | Verified on emulator |
| Pending management roles, review screens and laboratory claiming | Designed |
| Email-link sign-in, single use and bound to its address | Verified on emulator. Delivery from a real project to the Pages address is blocked until staging |
| Google sign-in pop-up | Blocked until staging |
| One-time-password enrolment and challenge, and its administrative reset | Blocked until staging |
| Blocking function before account creation | Verified on emulator with a simple rule. The registry rule is designed |
| Audit trigger: difference, redaction, idempotency | Verified on emulator |
| Acting identity in trigger audit entries | Blocked until staging |
| Audit entry in the same transaction as each function's change, and audit reads through a function | Designed |
| Callable functions restricted to the portal's origin, with schema validation of every input | Designed |
| Secrets through function parameters | Verified on emulator. Secret Manager itself is blocked until staging |
| Storage upload rules | Verified on emulator |
| Content Security Policy by meta element | Verified on emulator. The production host list is blocked until staging |
| Frame check in the bundle | Designed |
| No third-party requests, self-hosted fonts | Verified on emulator |
| Artefact check for source maps and environment files, protected publishing environment | Designed. Needs a repository administrator |
| App Check | Client wiring verified on emulator. Enforcement is blocked until staging |
| Import scripts refuse a real project without an explicit flag | Verified on emulator |
| Rules for workspace pages and editor documents | Provisional, pending the editor spike |
| Subject-access export, correction and erasure | Designed |
| Point-in-time recovery, scheduled backups, managed export and restore rehearsal | Blocked until staging |

## References

[1]: https://firebase.google.com/docs/projects/api-keys "Firebase: API keys"
[2]: https://firebase.google.com/docs/firestore/security/rules-fields "Firestore: control access to specific fields"
[3]: https://firebase.google.com/docs/functions/firestore-events "Cloud Functions: Firestore triggers"
[4]: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits "GitHub Pages limits"
[5]: https://firebase.google.com/docs/auth/web/email-link-auth "Firebase Authentication: email link sign-in"
[6]: https://firebase.google.com/docs/auth/web/redirect-best-practices "Firebase Authentication: redirect best practices"
[7]: https://firebase.google.com/docs/auth/admin/manage-sessions "Firebase Authentication: manage user sessions"
[8]: https://firebase.google.com/docs/auth/web/totp-mfa "Firebase Authentication: TOTP multi-factor authentication"
[9]: https://docs.cloud.google.com/identity-platform/docs/web/mfa "Identity Platform: multi-factor authentication"
[10]: https://docs.cloud.google.com/identity-platform/docs/admin/email-enumeration-protection "Identity Platform: email enumeration protection"
[11]: https://firebase.google.com/docs/auth/limits "Firebase Authentication limits"
[12]: https://firebase.google.com/docs/auth/admin/custom-claims "Firebase Authentication: custom claims"
[13]: https://firebase.google.com/docs/firestore/security/rules-query "Firestore: securely query data"
[14]: https://docs.cloud.google.com/firestore/native/docs/audit-logging "Firestore: audit logging"
[15]: https://firebase.google.com/support/privacy "Privacy and security in Firebase"
[16]: https://firebase.google.com/docs/functions/config-env "Cloud Functions: configure your environment"
[17]: https://www.w3.org/TR/CSP3/#meta-element "Content Security Policy Level 3: the meta element"
[18]: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments "GitHub Actions: manage environments"
[19]: https://firebase.google.com/docs/app-check "Firebase App Check"
[20]: https://firebase.google.com/docs/firestore/manage-data/enable-offline "Firestore: access data offline"
[21]: https://cloud.google.com/terms/data-residency "Google Cloud: data residency"
[22]: https://cloud.google.com/terms/data-processing-addendum "Google Cloud: Cloud Data Processing Addendum"
[23]: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages "What is GitHub Pages"
[24]: https://firebase.google.com/docs/firestore/pitr "Firestore: point-in-time recovery"
[25]: https://firebase.google.com/docs/firestore/backups "Firestore: scheduled backups"
[26]: https://firebase.google.com/docs/firestore/manage-data/export-import "Firestore: export and import data"
[27]: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site "GitHub Pages: managing a custom domain"
[28]: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages "GitHub Pages: about custom domains"
