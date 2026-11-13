# #EEGManyLabs Hub: data protection impact assessment

> **DRAFT AWAITING REVIEW BY THE DATA PROTECTION OFFICER.** This document has not been reviewed or approved. It was drafted on 13 November 2026 at the request of the programme lead, for review by the University of Leeds data protection officer. Its risk ratings are proposals for that review. Nothing in it is legal advice, and nothing in it has been signed off.

This assessment covers the #EEGManyLabs members' portal, the private application described in `docs/ARCHITECTURE.md`, `docs/SECURITY.md` and `docs/DATA_MODEL.md`. It follows the seven steps of the Information Commissioner's Office guidance on carrying out a DPIA and the headings of the ICO's sample DPIA template.[ico-how][ico-template] It describes only what the portal does as built and tested, or what the programme has decided in `docs/DECISIONS.md` and `docs/MIGRATION_PLAN.md`. Where a decision has been taken and the portal does not yet carry it out, the assessment says so.

The portal has not been deployed. No Firebase or Google Cloud project exists for it, no member has used it, and no real personal data has been imported into it (`docs/DEPLOYMENT.md`). Every control described below is verified, at most, on the Firebase Local Emulator Suite, and `docs/SECURITY.md` marks the controls that can only be confirmed on a real project as unverified until staging. This assessment is therefore made before any processing in the portal begins.

## Submitting controller details

| Item | Entry |
|---|---|
| Name of controller | **[TO BE COMPLETED BY THE PROGRAMME]** |
| Controller's address and contact details | **[TO BE COMPLETED BY THE PROGRAMME]** |
| Title of the data protection officer | Data protection officer, University of Leeds |
| Name of the data protection officer | **[TO BE COMPLETED BY THE PROGRAMME]** |
| Contact details of the data protection officer | **[TO BE COMPLETED BY THE PROGRAMME]** |
| Controller contact for this assessment | **[TO BE COMPLETED BY THE PROGRAMME]** |

The identity of the controller is left for the programme and the data protection officer to confirm. `docs/SECURITY.md`, section 9, records that the controller's obligations (lawful basis, the condition for special-category data, this assessment, retention, records of processing and breach handling) remain with the programme whatever its suppliers do.

## Step 1. Identify the need for a DPIA

#EEGManyLabs is a collaborative programme of replications of EEG studies carried out by many laboratories. Its coordination currently runs on a public static website, several shared spreadsheets, a task-management service (Quire) and correspondence. The portal replaces the private part of that coordination with one application in which members keep their own profiles, laboratories record their participation and recruitment, replication teams share pages and tasks, and the programme keeps a registry of datasets, decisions and authorship. Its design is set out in `docs/DECISIONS.md` (D-001 to D-021).

The portal changes the programme's data protection position. `docs/SECURITY.md`, section 1, states that the public website holds no personal data beyond what has been approved for publication, while the portal will store contact details, special-category demographic data, private notes, recruitment correspondence and the locations of research datasets. Profiles are created from the programme's existing sources before anyone is invited, which means personal data is collected from sources other than the people it describes.

The ICO's guidance says that a DPIA is required where processing is likely to result in a high risk, that special category data is one of the recognised risk criteria, and that where there is doubt a DPIA should be carried out.[ico-when] Three features point towards that threshold here: the portal holds gender and ethnicity, which are special category data under Article 9(1);[art9] it holds records about people who never joined the programme (the outreach correspondence of source F); and it sends sign-in account data to the United States. The programme lead decided on 13 November 2026 that an assessment is to be drafted for the data protection officer's review (`docs/DECISIONS.md`, "Answers given on 13 November 2026"). Whether the processing is large scale for the purpose of Article 35(3) is a question for the data protection officer; the programme's own estimate is about fifty daily active users (D-001), and the total number of people in the sources has not been counted in the documents this assessment draws on.

## Step 2. Describe the processing

### Nature of the processing

**Collection.** Personal data enters the portal in three ways. First, importers run by a programme administrator from a trusted machine read the programme's existing sources and write profiles before anyone is invited (D-012, `docs/MIGRATION_PLAN.md`). The programme lead decided on 13 November 2026 that sources A and G and the Quire data arrive as exported files that the programme lead supplies, imported in a private local environment and never committed to the repository, and that no Google service account is created for now. Second, members add and correct data themselves once signed in: profile links, affiliations, workspace pages, comments, tasks, recruitment reports and dataset records. Third, Firebase Authentication and the portal's own functions record account and activity data as members use the portal.

**Use.** The data supports the coordination of replications: a directory of members, laboratories and their participation, recruitment reporting, shared pages and tasks, a registry of where datasets are held, the decision log, incidents, authorship lists and publishing of approved public fields to the website. Gender and ethnicity are used for aggregate reporting through an audited function, with small counts suppressed, and a person to whom a programme administrator has given a named, time-limited grant can also read the values of one member at a time, with an audit entry for each read (`docs/SECURITY.md`, section 2). Members see and edit their own values, and the subject access export includes them. No AI or machine-learning feature is built, and no member data is sent to any model provider, because none has been approved (D-021).

**Storage.** Every portal record, uploaded file and secret is held in Cloud Firestore, Cloud Functions, Cloud Storage and Secret Manager in London (`europe-west2`), which the programme lead confirmed on 13 November 2026 as the permanent location. Sign-in account data is held by Firebase Authentication, which processes data only in the United States, and the programme lead decided on the same date that this is acceptable and is to be stated in this assessment and in the privacy notice. The portal's front end is a static bundle served by GitHub Pages at `portal.eegmanylabs.org`; member data travels directly between the browser and Google and never passes through GitHub (`docs/SECURITY.md`, sections 1 and 9).

**Sharing.** Data leaves the portal by four routes only. Names and affiliations already approved for the public website, together with other approved public fields, are exported through an allow-list, previewed, approved by a programme administrator with a second factor and proposed as a pull request on the website repository, which a maintainer merges (D-021). The suppliers listed below process data on the controller's behalf. Members see one another's directory entries and the records of their own replications and laboratories, within the access rules described in step 6. A member can receive a subject access export of their own data. No notification email is sent for now: the programme lead decided on 13 November 2026 that notifications stay inside the portal, and the mail outbox has no sender outside the emulators (`portal/functions/src/integrations/mail/adapters.ts`). The single-use sign-in links themselves are emailed by Firebase Authentication.

**Deletion.** Deletion is described under retention below and in step 6.

**Types of processing identified as likely high risk.** Special category data (gender and ethnicity), data collected from sources other than the individual, and a transfer of account data to a third country.

### Suppliers that process data for the portal

| Supplier and service | What it processes | Where | Source of the fact |
|---|---|---|---|
| Google: Cloud Firestore, Cloud Functions, Cloud Storage, Secret Manager | Every portal record, including restricted and special-category documents, uploaded page files and secrets | London (`europe-west2`) | `docs/SECURITY.md`, section 9; decision 2 |
| Google: Firebase Authentication with Identity Platform | Email addresses, user identifiers, sign-in metadata, IP addresses, user agents and second-factor enrolment | United States only; the location cannot be chosen | `docs/SECURITY.md`, section 9; decision 3 |
| Google: Cloud Tasks and Cloud Scheduler | Job payloads carrying document identifiers only | Not covered by Google's data residency list | `docs/SECURITY.md`, section 9 |
| Google: App Check with reCAPTCHA Enterprise | Browser signals sent to Google for scoring, once enforcement is switched on | No location selection | `docs/SECURITY.md`, sections 8 and 9 |
| GitHub: Pages | Requests for the static files and each visitor's IP address, which GitHub logs for security purposes | Not examined | `docs/SECURITY.md`, section 9 |
| GitHub: the website repository | Approved public fields, through pull requests | Not examined | D-021 |

Firebase states that customers typically act as controller and Google as processor, and that the Google services named above are governed by the Google Cloud Platform Terms and the Cloud Data Processing Addendum (`docs/SECURITY.md`, section 9, references 15 and 22). Article 28 requires a binding contract with each processor;[art28] confirming that the programme has accepted those terms for its billing account, and that GitHub's terms are adequate for the visitor IP addresses it logs, is an action in step 6.

Google Workspace synchronisation, the OSF adapter, storage scans of research servers and the GitHub publishing adapter are built behind interfaces with fakes, and none has been run against a real system. Each live external write needs explicit approval (D-014). They are outside this assessment until one is switched on, at which point this assessment is to be reviewed.

### Scope of the processing

| Category | Examples | Who it describes | Where it is held |
|---|---|---|---|
| Directory data | Name, affiliation, institution, laboratory, country, ORCID iD, links to scholarly profiles, headshot file name, roles in the programme | Members and people named in the sources | `persons/{id}` and affiliations, readable by signed-in members |
| Contact data | Email addresses; postal address | Members and people named in the sources | Restricted documents of the person (`private/contact`, `private/address`) |
| Private notes | Administrators' notes about a person | Members | `private/notes`, programme administrators only |
| Special category data | Gender and ethnicity, with source terms verbatim and optional standardised categories | Members who give explicit consent | `special/demographics`, which no client reads |
| Account data | Login, sign-in method, second-factor enrolment, sessions, last sign-in | Members who sign in | Firebase Authentication; `users/{uid}` and `access/{uid}` |
| Activity and audit data | Who changed what and when, reads of special-category data, notifications, recent items | Members who sign in | Audit and activity collections; audit is readable only through an audited function |
| Collaboration content | Workspace pages, comments, tasks, progress updates, decision log, incidents, authorship entries | Members, and anyone named in the content | Scoped to the replication, laboratory or group |
| Outreach records | Names, email addresses, contact dates, responses, notes, colours and links from source F | Researchers the programme contacted, most of whom never joined | `outreachContacts`, readable by the leads of the replication and administrators |
| Contributor lists | Names, author order, roles, ORCID iDs and funding of manuscript contributors | Contributors | Readable by the team of the replication, as migration answer 10 decided, and by programme staff (programme administrators and the core team), as every scoped record is; whether staff should read them is put to the programme lead (`docs/MIGRATION_PLAN.md`, section 11, question 23). The rule is the same for published and unpublished manuscripts |
| Verbatim source rows | Every imported row as it appeared in its source | Anyone in the sources | `sourceRecords`, programme administrators alone |
| Prediction-market data and summary figures | The outcome labels and the survey and market questions of the prediction market, and the summary figures of the recruitment workbooks | None directly | Sealed: programme administrators alone (migration answers 7 and 14) |
| Dataset locations | Storage paths, server details, manifests and checksums | None directly; recordings never pass through the portal | Restricted dataset documents |
| Recruitment | Counts of participants by category and modality | Research participants, as counts only | Recruitment reports |

The portal does not hold EEG recordings or the identities of research participants. It records paths, manifests, checksums and counts, and it never requires raw recordings to pass through it (`docs/SECURITY.md`, section 7).

**Special category data.** Gender and ethnicity come from source G, the membership and contributor workbook, which has not yet been opened, and from what members enter themselves. The programme lead decided on 13 November 2026 that these values are held only for members who give explicit consent and are left blank for everyone else. The portal records that consent: a member gives, reviews and withdraws it on their account page, which shows the wording they agree to, and `setDemographicsConsent` keeps each act with its time and the version of the wording in a record that the member reads. While consent is in force the member can enter their values in their own words and confirm the terms the workbook recorded (`saveOwnDemographics`). The import of source G is released on every target, and it stores values only for a person whose consent is in force when the values are written: it reads the consent again in the transaction that writes them, and discards the cells of everyone else without storing them. A rollback of an import never writes values back for a person without consent. Withdrawal deletes the values and every copy that imports kept of them at once, and is logged to the governance ledger so that a restore of an older backup deletes them again. The exported file of source G, which the programme lead supplies, still holds every member's terms, consenting or not, and lies with the operator outside the portal.

**Volume and frequency.** The programme expects about fifty daily active users (D-001). The number of people named across the sources is not stated in the documents this assessment draws on and is left for the programme to supply: **[NUMBER OF INDIVIDUALS TO BE COMPLETED BY THE PROGRAMME]**. Imports are occasional and run by an administrator. Members' own use is continuous.

**Geographical area.** Members and laboratories are in many countries. Portal data is stored in London; account data is processed in the United States.

### Retention

The programme lead agreed the following periods on 13 November 2026.

| What | Period | How it is carried out |
|---|---|---|
| Daily scheduled backups of Firestore | 7 days | `portal/ops/backup-setup.mjs`, written and never run |
| Weekly scheduled backups of Firestore | 14 weeks | The same script |
| Managed exports of Firestore | 98 days | A lifecycle rule on the backup bucket in `europe-west2` |
| Governance ledger (identifiers of erasures, revocations, suspensions and ended sessions) | 10 years | A locked log bucket in `europe-west2`, which cannot be shortened once locked |
| Raw source records and exported files, including the outreach correspondence of source F | Until the migration is verified, then three years; after that the outreach records of people who never joined are deleted | A programme administrator marks the migration verified on the governance page (`markMigrationVerified`, with a second factor and an audit entry); a later mark moves the start later and never earlier. Three years later the retention sweep deletes the outreach contacts of people who never joined, with their raw rows, and puts a marker in place of their values in the change log. The programme lead decided that nothing else is deleted, so every other raw record is kept (`docs/MIGRATION_PLAN.md`, section 11, question 21). The exported files lie with the operator outside the portal |

Point-in-time recovery, once enabled, keeps versions for 7 days. Firebase Authentication removes deleted account data within 180 days of deletion and keeps logged IP addresses for a few weeks (`docs/SECURITY.md`, sections 6 and 9).

The portal's retention sweep (`runRetentionSweep` and the scheduled `retentionSweep`) applies periods only to the operational collections for which an administrator has set one: automatic page versions, recent items, notifications, the mail outbox, activity, automation runs, synchronisation runs and resolved event failures. No default period exists, and a target without a period is never swept. The sweep never touches the audit trail. It touches source records only for the decision of question 20: the raw rows behind the outreach contacts it deletes. A contact counts as someone who never joined only when it names no person, its address resolves to no person through the email index when the sweep runs, and no open review item names its row; the programme lead confirmed this reading (`docs/MIGRATION_PLAN.md`, section 11, question 21). The periods for the operational collections have not been decided, which is an action in step 6.

### Context of the processing

The people concerned are researchers who take part in, or were invited to take part in, an academic collaboration. They are not children and are not, as a group, vulnerable. Members can be expected to anticipate that a coordination tool holds their name, affiliation, contact details and contributions. They are less likely to anticipate that gender and ethnicity are held, which is why the programme decided to hold these only with explicit consent. People who were contacted and never joined are unlikely to expect that their correspondence is held in a new system.

Members have substantial control over their own profile: they claim it, correct it, see their own claim and roles, end their sessions and can request a copy of their data. They have no control over what the sources already recorded about them before the portal existed.

Discovery found that several of the programme's source spreadsheets, including source F and the contributor sheets, can be read by anyone who has the link (`docs/SECURITY.md`, section 11). That exposure predates the portal and is a prior concern relevant to this assessment. The programme lead decided that link sharing on those files is to be restricted once the import has been verified.

The technology is established: Firebase is a widely used Google platform, and the collaborative editor uses established open-source libraries (D-010). The hosting on GitHub Pages limits the security headers the portal can send, a posture the programme lead accepted on 13 November 2026 (D-001, decision 5).

### Purposes of the processing

The purpose is to coordinate a multi-laboratory research programme: to know who takes part and in what role, to let replication and laboratory teams work together, to track recruitment and datasets, to keep a reliable record of scientific decisions and authorship, and to publish approved information on the public website. Demographic data serves aggregate reporting on the diversity of the programme's membership, under explicit consent, and a named, time-limited grant lets a person check one member's values. The intended effect on members is that they keep one profile of their own, see only what their roles allow, and have their contributions recorded accurately.

## Step 3. Consultation process

No consultation with members or with the people named in the sources has taken place. Whether and how to seek their views before launch is for the programme to decide with the data protection officer: **[CONSULTATION PLAN TO BE COMPLETED BY THE PROGRAMME]**.

Within the programme, the programme lead answered the open questions on governance, retention, location and suppliers on 13 November 2026, and those answers are the basis of this draft. The security design was reviewed in repeated internal red-team passes recorded in `docs/SECURITY.md`, section 12. This draft was prepared by Claude, an AI model made by Anthropic, at the programme lead's request, from the repository documents named above; it processed no member data in doing so. Google's and GitHub's roles as processors are described in their published terms; neither has been asked to assist with this assessment. Article 35(2) requires the controller to seek the data protection officer's advice, and step 7 records it.[art35]

## Step 4. Assess necessity and proportionality

### Lawful basis

The programme lead decided on 13 November 2026 that the lawful basis for members' personal data is public task, Article 6(1)(e) of the UK GDPR.[art6] Article 6(3) requires the basis for that task to be laid down by domestic law,[art6] and the ICO's guidance explains that the controller must be able to identify the task and show its basis in law, which may be a clear common law function, and that the processing must be necessary, so that public task does not apply where a reasonable and less intrusive way to achieve the same result exists.[ico-public-task] Section 8 of the Data Protection Act 2018 lists, among the tasks covered, the exercise of a function conferred on a person by an enactment or rule of law.[dpa-s8] Identifying the specific task and its legal basis for this controller is a question for the data protection officer: **[TASK AND ITS BASIS IN LAW TO BE CONFIRMED BY THE DATA PROTECTION OFFICER]**.

For gender and ethnicity, the condition under Article 9(2)(a) is explicit consent for one or more specified purposes.[art9] Consent must be as easy to withdraw as to give, and withdrawal does not affect processing before it.[art7] The programme decided that the values are blank for anyone who has not consented. The portal records consent and its withdrawal on the member's account page, and holds values only while consent is in force, as step 2 describes. The wording that members agree to names the purposes and states that explicit consent is the condition.

### Does the processing achieve the purpose, and is there a less intrusive way?

The portal consolidates processing that already takes place across spreadsheets and correspondence, several of which are readable by anyone with the link. Holding the same data under per-document access rules, with an audit trail, is less intrusive than the present arrangement. Within the portal, each data class is held in a separate document so that each audience reads only what it needs (D-006): a member sees directory entries, a lead sees the contact details of the people in their replication, and nobody reads demographic values directly.

### Function creep, data quality and minimisation

Function creep is limited by design decisions that the portal enforces in code: the website export reads only fields named on an allow-list and a test finds no planted private value in its output (D-021); automations are five built-in rules with no user-written scripts (D-021); no AI feature is built (D-021); and any new collection is closed to every client until its rules are written and tested (`docs/SECURITY.md`, section 5).

Data quality rests on the importer and the claim flow. Every imported value is kept with the row it came from, conflicts between sources are queued for human review and never resolved by picking a value (D-012), unknown values are left absent and never treated as zero (D-009), and members correct their own records or file a correction request.

Minimisation applies to demographic data in particular: it never enters search indexes, logs, sign-in tokens, email bodies, task payloads, synchronised spreadsheets or the browser's offline cache, and audit entries record that a demographic field changed without its value (`docs/SECURITY.md`, section 2).

### Information to individuals

A privacy notice for members has been drafted alongside this assessment (`docs/PRIVACY_NOTICE_DRAFT.md`), following the items that Articles 13 and 14 require.[art13][art14] Because most profiles are created from the sources before anyone is invited, Article 14 applies to them: the information is due within a reasonable period and at the latest within one month, or at the first communication with the person if earlier.[art14] With no notification email for now, the portal has no means of reaching a person who has not yet signed in, and people who were contacted and never joined will receive nothing from the portal at all. How the programme provides the information to those people is an open action in step 6.

The public website's Privacy page states that the site "does not provide user accounts" and needs revisiting when an entry point to the portal appears (`docs/SECURITY.md`, section 9).

### Supporting individuals' rights

| Right | How the portal supports it |
|---|---|
| Access (Article 15)[art15] | `exportPersonData` produces everything held about one person as one file. It needs a programme administrator with a second factor and writes an audit entry. Special-category values are included only under the administrator's own unexpired grant, and only while the person's consent is in force. The record of consent, with each act and its wording, is always included |
| Rectification | Members edit their own profile links and affiliations, and file correction requests for imported values, which administrators resolve. A correction request can never name a special-category field |
| Erasure (Article 17)[art17] | `requestErasure` and `decideErasure`: one administrator requests and a second decides. It removes restricted and special-category documents, anonymises the directory entry and authorship entries, tombstones identity keys, replaces the person's values in source records with a marker, and deletes linked accounts. The ICO notes that the right to erasure does not apply where public task is the basis;[ico-public-task] it does apply to demographic data on withdrawal of consent under Article 17(1)(b)[art17] |
| Objection (Article 21)[art21] | Applies to processing under Article 6(1)(e). Objections are handled by the programme by hand; the portal has no dedicated mechanism |
| Withdrawal of consent (Article 7(3))[art7] | The member withdraws on their account page, as easily as they gave consent. Withdrawal deletes the values and every copy that imports kept of them at once, leaves the rest of the profile, and is logged to the governance ledger, so that a restore of a backup taken before it deletes the values again. A later import or rollback writes nothing back while consent is not in force |

Erasure has to account for copies outside the live database. An erased person remains in backups for up to 14 weeks, in managed exports for 98 days and in Firebase Authentication's deletion window of 180 days, and the governance ledger stops a restore from bringing them back (`docs/SECURITY.md`, section 6).

The two-person rule for erasure needs two administrators who did not appoint each other within the last 14 days. The programme lead currently acts alone as operator and approver, and production deployment waits for a second administrator to be named (`docs/DECISIONS.md`, "Answers given on 13 November 2026"). Until then no erasure can be decided in the portal.

### Processors and international transfers

Article 28 requires processors to give sufficient guarantees and to act under a binding contract.[art28] The Google services are governed by the Cloud Data Processing Addendum, which handles restricted transfers through standard contractual clauses or an alternative transfer solution, and Firebase states that Google is certified under the EU-U.S. Data Privacy Framework and its UK Extension (`docs/SECURITY.md`, section 9).

Under Article 44A of the UK GDPR, a transfer to a third country is permitted where it is approved by regulations under Article 45A, is subject to appropriate safeguards under Article 46, or relies on a derogation under Article 49.[art44a] Article 46 lists the forms of appropriate safeguards and requires the controller to consider, reasonably and proportionately, that the data protection test is met.[art46] Which route applies to the transfer of sign-in account data to Firebase Authentication in the United States, and whether its conditions are met, is for the data protection officer to confirm: **[TRANSFER ROUTE TO BE CONFIRMED BY THE DATA PROTECTION OFFICER]**. The data transferred is limited to what sign-in needs; gender and ethnicity never enter Authentication (`docs/SECURITY.md`, section 9).

## Step 5. Identify and assess risks

The ratings use the scales of the ICO template: likelihood remote, possible or probable; severity minimal, significant or severe; overall risk low, medium or high.[ico-template] The ICO says that harm must be more than remote to be counted and that a high probability of widespread minor harm may still be high risk.[ico-how] These ratings are proposals for the data protection officer's review.

| # | Source of risk and potential impact on individuals | Likelihood of harm | Severity of harm | Overall risk |
|---|---|---|---|---|
| R1 | Unauthorised disclosure of gender or ethnicity, causing distress or discrimination | Remote | Severe | Medium |
| R2 | Gender or ethnicity held without valid explicit consent, or kept after consent is withdrawn | Possible | Significant | Medium |
| R3 | People named in the sources, especially those who were contacted and never joined, do not know the portal holds their data and cannot exercise their rights | Probable | Significant | High |
| R4 | Outreach correspondence and contributor email addresses remain readable by anyone with the link to the source spreadsheets | Probable | Significant | High |
| R5 | Sign-in account data processed in the United States without an adequate transfer route | Possible | Significant | Medium |
| R6 | A person takes over another member's profile through a wrong claim match, or gains management rights from imported data | Possible | Significant | Medium |
| R7 | Private data reaches the public website through publishing | Remote | Significant | Low |
| R8 | Data kept longer than decided: operational collections have no periods set, the exported files lie with the operator, and the raw records other than outreach are kept with no end date | Probable | Minimal | Medium |
| R9 | A person is re-identified from demographic counts | Remote | Significant | Low |
| R10 | Script injection or a compromised dependency reads a member's session, given that GitHub Pages cannot send security headers and the session lives in browser storage | Possible | Significant | Medium |
| R11 | Restricted documents persist in the browser's offline cache on a shared computer | Possible | Significant | Medium |
| R12 | A request for erasure cannot be decided while only one administrator exists, and with a single administrator no second person checks deployments | Probable | Minimal | Medium |
| R13 | A restore from backup brings back an erased person or a revoked role | Remote | Significant | Low |
| R14 | Controls behave differently on a real project from the emulators on which they were tested | Possible | Significant | Medium |

## Step 6. Identify measures to reduce risk

The first table records the measures already built or decided. The second records the further actions that this draft proposes for the programme to approve.

| Risk | Measures built or decided | Effect on risk | Residual risk |
|---|---|---|---|
| R1 | Values held in a document that no client can read; served only by `getPersonDemographics` to the person or to a holder of a named, time-limited grant with a second factor, with an audit entry naming the fields read; values kept out of logs, indexes, tokens, emails, payloads and the offline cache (`docs/SECURITY.md`, section 2) | Reduced | Low |
| R2 | Explicit consent recorded with its wording, given, reviewed and withdrawn on the account page; values stored only while consent is in force, the apply reading it again as it writes; withdrawal deletes the values and every kept copy and is replayed after a restore; a rollback never writes values back without consent; values served to another person only under a named, time-limited grant with an audit entry (`docs/SECURITY.md`, section 2) | Reduced | Low in the portal. The exported file of source G, which holds every member's terms, lies with the operator outside the portal, and its handling is an action below |
| R3 | Privacy notice drafted; members see and claim their own profile; outreach records of people who never joined are deleted by the retention sweep three years after the migration is marked verified | Reduced | Medium until the actions below are complete |
| R4 | Link sharing on source F and the contributor sheets to be restricted once the import is verified (decision 8); sources referred to by letter only in the public repository (D-012) | Reduced once carried out | Low after restriction; high until then |
| R5 | Decision 3 accepts the processing; only sign-in data goes to Authentication; Google's Cloud Data Processing Addendum and its Data Privacy Framework certification (`docs/SECURITY.md`, section 9) | Reduced, subject to the DPO's confirmation of the route | Low if confirmed |
| R6 | Claims use only a verified address from the caller's own token; ambiguous and already-claimed matches go to review; management roles start pending and need an administrator's approval; second factor required for programme roles (`docs/SECURITY.md`, sections 3 and 4) | Reduced | Low |
| R7 | Allow-list export with a strict schema, preview, approval with a second factor bound to the hash of the files, and a pull request merged by a maintainer; a test plants private values and finds none (D-021) | Reduced | Low |
| R8 | Backup periods agreed and written into `BACKUP_RETENTION`; retention sweep available for operational collections; the mark of the verified migration and the deletion of the outreach records of people who never joined are built (`markMigrationVerified`, `runRetentionSweep`) | Reduced for backups and outreach records | Medium until the actions below are complete |
| R9 | No release for a scope under five people; groups under five folded; differencing between overlapping scopes withheld; each release audited (`docs/SECURITY.md`, section 2) | Reduced | Low |
| R10 | Strict Content Security Policy delivered by a meta element, no inline script; the portal on its own origin; all third-party code bundled; a frame guard; deployment preflight that scans the artefact; App Check (`docs/SECURITY.md`, section 8); posture accepted by the programme lead (decision 5) | Reduced | Medium; no full substitute for the missing headers exists |
| R11 | Special-category data never enters the cache | Reduced for special category data only | Medium until the action below is taken |
| R12 | Production deployment waits for a second administrator (`docs/DECISIONS.md`, 13 November 2026) | Reduced | Low once a second administrator is named |
| R13 | Governance ledger in a locked bucket for 10 years, replayed after every restore; restore rehearsed on the emulators (`docs/SECURITY.md`, sections 6 and 10) | Reduced | Low, once verified on staging |
| R14 | Staging project with synthetic data only, acceptance scenarios and a second restore rehearsal before written approval for production (`docs/DEPLOYMENT.md`, steps 5 to 10) | Reduced | Low after staging |

| Risk | Further action proposed for approval | Owner | Measure approved |
|---|---|---|---|
| R2 | Keep the exported file of source G outside every repository and delete it once the import has been verified, since it holds the terms of members who have not consented | **[OWNER]** | **[YES/NO]** |
| R3 | Decide how the privacy notice reaches people with pre-populated profiles within the Article 14 time limits, including people who never joined, given that no notification email is sent | **[OWNER]** | **[YES/NO]** |
| R3 | Update the Privacy page of the public website before an entry point to the portal is published | **[OWNER]** | **[YES/NO]** |
| R4 | Restrict link sharing on source F and the contributor sheets as soon as the import is verified, and record the date | **[OWNER]** | **[YES/NO]** |
| R5 | Confirm the transfer route for Firebase Authentication data and that the Google Cloud terms and Data Processing Addendum have been accepted for the programme's billing account | Data protection officer and **[OWNER]** | **[YES/NO]** |
| R8 | Set periods for the operational collections the retention sweep covers, review whether keeping the raw records other than outreach with no end date remains necessary, and delete the exported files under the same rule | **[OWNER]** | **[YES/NO]** |
| R8 | Mark the migration verified in the portal when it is, which records the date and starts the three years, and at that moment restrict link sharing on source F and the contributor sheets (decision 8) | **[OWNER]** | **[YES/NO]** |
| R11 | Decide whether the browser's offline cache stays on, or is offered only on a device the member says is trusted | **[OWNER]** | **[YES/NO]** |
| R12 | Name a second programme administrator | **[OWNER]** | **[YES/NO]** |
| All | Define the identity checks before an administrator resets a member's second factor (`docs/SECURITY.md`, section 3) and a procedure for handling objections and breaches | **[OWNER]** | **[YES/NO]** |
| All | Review this assessment when any external integration (Google Workspace, OSF, storage scans, mail) is switched on or an AI feature is proposed | **[OWNER]** | **[YES/NO]** |

## Step 7. Sign off and record outcomes

If a high residual risk remains that the controller has not mitigated, Article 36 requires the controller to consult the regulator before processing begins.[art36] On this draft's ratings, R3 and R4 remain at medium or high until the actions above are carried out.

| Item | Name, position and date | Notes |
|---|---|---|
| Measures approved by | **[NAME, POSITION, DATE]** | Actions to be integrated into the project plan with a date and a person responsible |
| Residual risks approved by | **[NAME, POSITION, DATE]** | If any residual high risk is accepted, consult the regulator before going ahead |
| DPO advice provided | **[NAME, POSITION, DATE]** | The DPO advises on compliance, the step 6 measures and whether processing can proceed |
| Summary of DPO advice | **[TO BE COMPLETED BY THE DATA PROTECTION OFFICER]** | |
| DPO advice accepted or overruled by | **[NAME, POSITION, DATE]** | If overruled, the reasons must be given |
| Comments | **[BLANK]** | |
| Consultation responses reviewed by | **[NAME, POSITION, DATE]** | If the decision departs from individuals' views, the reasons must be given |
| Comments | **[BLANK]** | |
| This DPIA will be kept under review by | **[NAME, POSITION]** | The DPO should also review ongoing compliance with this DPIA |

## References

Each page below was opened on 13 November 2026 and its content checked against the point it supports.

[ico-how]: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/how-do-we-do-a-dpia/ "ICO: How do we do a DPIA?"
[ico-when]: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/when-do-we-need-to-do-a-dpia/ "ICO: When do we need to do a DPIA?"
[ico-template]: https://ico.org.uk/media2/migrated/2553993/dpia-template.docx "ICO: sample DPIA template"
[ico-public-task]: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/public-task/ "ICO: Public task"
[art6]: https://www.legislation.gov.uk/eur/2016/679/article/6 "UK GDPR Article 6: lawfulness of processing"
[art7]: https://www.legislation.gov.uk/eur/2016/679/article/7 "UK GDPR Article 7: conditions for consent"
[art9]: https://www.legislation.gov.uk/eur/2016/679/article/9 "UK GDPR Article 9: special categories of personal data"
[art13]: https://www.legislation.gov.uk/eur/2016/679/article/13 "UK GDPR Article 13: information where data are collected from the data subject"
[art14]: https://www.legislation.gov.uk/eur/2016/679/article/14 "UK GDPR Article 14: information where data have not been obtained from the data subject"
[art15]: https://www.legislation.gov.uk/eur/2016/679/article/15 "UK GDPR Article 15: right of access"
[art17]: https://www.legislation.gov.uk/eur/2016/679/article/17 "UK GDPR Article 17: right to erasure"
[art21]: https://www.legislation.gov.uk/eur/2016/679/article/21 "UK GDPR Article 21: right to object"
[art28]: https://www.legislation.gov.uk/eur/2016/679/article/28 "UK GDPR Article 28: processor"
[art35]: https://www.legislation.gov.uk/eur/2016/679/article/35 "UK GDPR Article 35: data protection impact assessment"
[art36]: https://www.legislation.gov.uk/eur/2016/679/article/36 "UK GDPR Article 36: prior consultation"
[art44a]: https://www.legislation.gov.uk/eur/2016/679/article/44A "UK GDPR Article 44A: general principles for transfers"
[art46]: https://www.legislation.gov.uk/eur/2016/679/article/46 "UK GDPR Article 46: transfers subject to appropriate safeguards"
[dpa-s8]: https://www.legislation.gov.uk/ukpga/2018/12/section/8 "Data Protection Act 2018, section 8: lawfulness of processing, public interest"

| Reference | Page |
|---|---|
| ICO, How do we do a DPIA? | https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/how-do-we-do-a-dpia/ |
| ICO, When do we need to do a DPIA? | https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/data-protection-impact-assessments-dpias/when-do-we-need-to-do-a-dpia/ |
| ICO, sample DPIA template | https://ico.org.uk/media2/migrated/2553993/dpia-template.docx |
| ICO, Public task | https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/public-task/ |
| UK GDPR Articles 6, 7, 9, 13, 14, 15, 17, 21, 28, 35, 36, 44A and 46 | https://www.legislation.gov.uk/eur/2016/679/article/6 and the corresponding `/article/<number>` pages |
| Data Protection Act 2018, section 8 | https://www.legislation.gov.uk/ukpga/2018/12/section/8 |

The facts about Google, Firebase and GitHub are taken from `docs/SECURITY.md`, whose own references list the vendor pages read on 9 November 2026.
