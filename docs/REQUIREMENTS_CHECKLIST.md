# #EEGManyLabs Hub: requirements checklist

This checklist restates every distinct, testable requirement of the master build prompt for the #EEGManyLabs Hub, one table per section of that prompt. Each row carries a stable identifier, the delivery phase from section 19 that owns it, and a status. The status vocabulary is fixed: `planned` means the work has not started, `in progress` means work is under way, `implemented` means the feature exists in the codebase, `tested` means it is implemented and covered by a recorded passing test, and `blocked` means the item cannot be completed until a named dependency outside the codebase is supplied. Where a requirement spans several phases, the Phase column names the phase in which it is first delivered and the Notes column says so.

The Evidence column is empty at the start of the project. Once an item reaches `implemented` or `tested`, Evidence will point at the test, source file or document that demonstrates it, so that a reader can verify each claim independently. The seven mandatory sources are referred to by letter and title only: A historical replication coordination workbook, B naming conventions, C community vocabulary, D list of studies, E prediction-market hypotheses, F recruitment and contact workbook, and G membership and contributor workbook. Source locations and identifiers are held in the private source registry and are deliberately absent from this public file.

## 1. Role, mission and working rules

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R1.1 | A secure, maintainable, production-ready authenticated portal for the international #EEGManyLabs programme is designed and implemented, built upon the existing eegmanylabs.org website. | 1 | planned | | Spans every phase. |
| R1.2 | The portal combines Notion-style workspace flexibility, Quire-style hierarchical task management and scientific management tailored to multi-laboratory EEG replications. | 3 | planned | | Delivered across phases 3, 4 and 8. |
| R1.3 | The portal integrates the programme's existing Google Sheets, Google Docs, Google Drive, Quire records, OSF resources, GitHub repositories and distributed institutional research data servers. | 6 | planned | | Live connections are tracked row by row in sections 5, 11 and 13. |
| R1.4 | Working, persistent features, real authentication, real relationships, tested integrations, migration tooling, documentation and a staged deployment path are delivered. | 1 | planned | | Applies in every phase. |
| R1.5 | Every delivered feature is a working implementation, with no mock-up, generic dashboard or disconnected prototype substituted. | 1 | planned | | Applies in every phase. |
| R1.6 | Work proceeds in tested vertical slices. | 1 | planned | | Applies in every phase. |
| R1.7 | Persistent implementation notes are maintained. | 0 | planned | | See section 19 documentation rows. |
| R1.8 | Actual code and sources are inspected before assumptions are made. | 0 | in progress | | |
| R1.9 | Where external access is unavailable, tested adapters are built and the exact blockers are recorded. | 0 | planned | | Blockers identified so far are recorded in the blocked rows of this checklist. |
| R1.10 | Live data, imported historical records, demonstrations and projections are distinguished from one another. | 2 | planned | | |
| R1.11 | Source values, scientific findings, integrations, credentials and completed work are never invented. | 0 | planned | | Applies in every phase. |
| R1.12 | Explicit approval is obtained before production deployment. | 10 | planned | | |
| R1.13 | Explicit approval is obtained before destructive migrations. | 2 | planned | | |
| R1.14 | Explicit approval is obtained before changing live external documents. | 6 | planned | | |
| R1.15 | Explicit approval is obtained before contacting users. | 2 | planned | | |
| R1.16 | Explicit approval is obtained before moving raw research data. | 7 | planned | | |
| R1.17 | Existing work and unrelated branches are left intact. | 0 | planned | | Applies in every phase. |
| R1.18 | The initial reasoning effort is extra high where the coding environment supports it. | 0 | planned | | Session configuration set by the operator. |

## 2. The existing website is the foundation

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R2.1 | The primary repository is inspected: README, source files, data, templates, CSS, JavaScript, assets, Docker, Nginx, GitHub Actions and DigitalOcean deployment configuration. | 0 | in progress | | |
| R2.2 | The legacy `website` repository is inspected to distinguish the legacy redirect. | 0 | in progress | | |
| R2.3 | The current state of the primary website (Syrinx, Jinja, Markdown and TSV static site generated into `dist/` and served by Nginx) is confirmed from evidence. | 0 | in progress | | |
| R2.4 | The existing staging site at eegmanylabs.dev and the branch and deployment rules are reviewed. | 0 | in progress | | |
| R2.5 | Shared review branches and ongoing changes are respected. | 0 | planned | | Applies in every phase. |
| R2.6 | The authenticated application is built as an extension of the public website, preferably under `/portal` at https://eegmanylabs.org/portal. | 1 | planned | | |
| R2.7 | Routes are consistent and include `/portal/login`, `/portal/replications/[id]`, `/portal/labs/[id]`, `/portal/members/[id]`, `/portal/tasks/[id]` and `/portal/datasets/[id]`. | 1 | planned | | Task and dataset routes arrive in phases 4 and 7. |
| R2.8 | A clear members' portal and login entry is added to the existing public navigation. | 1 | planned | | |
| R2.9 | The public site stays functional and its current publishing process stays intact. | 1 | planned | | |
| R2.10 | The deployment form is chosen for maintainability; a separately deployed application service reverse-proxied under the existing domain is acceptable. | 0 | planned | | Recorded in the architecture assessment and decision log. |
| R2.11 | Private data is kept out of static HTML, public TSV files, Git repositories and browser bundles. | 1 | planned | | |
| R2.12 | The actual design system is reused, including warm graphite `#302a2a`, coral `#d84b4d`, deep coral `#a9353a`, warm-white `#fcf9f7` and white `#ffffff`. | 1 | planned | | |
| R2.13 | The existing logo, typography and spacing variables are reused. | 1 | planned | | |
| R2.14 | The design is restrained, accessible, professional, responsive and information-dense. | 1 | planned | | |
| R2.15 | Subtle borders and spacing are preferred over ornamental shadows. | 1 | planned | | |
| R2.16 | The established public website style is preserved while the portal behaves like Notion. | 3 | planned | | |
| R2.17 | An evidence-based architecture assessment covering current hosting, routing, security boundaries, deployment, existing data, public publishing and a recommended application architecture is produced before substantial changes. | 0 | in progress | | |
| R2.18 | A development branch is used for the work. | 1 | planned | | |
| R2.19 | A protected staging workflow is used. | 1 | blocked | | No DigitalOcean or GitHub deployment credentials are available and production deployment needs explicit approval. The deployment configuration will still be prepared and exercised in a local integrated stack. |

## 3. Fundamental product model: Notion for research

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R3.1 | The portal is one coherent collaborative workspace in which records, pages and views are connected. | 3 | planned | | |
| R3.2 | Every major entity is a first-class editable page: programme, replication, laboratory, person, replication participation, task, dataset, hypothesis, protocol, manuscript, publication, meeting, progress report, scientific decision, risk, incident and custom page. | 3 | planned | | |
| R3.3 | Nested pages are supported. | 3 | planned | | |
| R3.4 | Pages and records have stable URLs. | 3 | planned | | |
| R3.5 | Breadcrumbs are shown. | 3 | planned | | |
| R3.6 | Favourites are supported. | 3 | planned | | |
| R3.7 | Recents are supported. | 3 | planned | | |
| R3.8 | A persistent, collapsible sidebar is provided. | 3 | planned | | First version arrives with the phase 1 shell. |
| R3.9 | Global search is provided. | 3 | planned | | See R15.8. |
| R3.10 | A command palette is provided. | 3 | planned | | |
| R3.11 | A personalised landing page is provided. | 3 | planned | | First version arrives in phase 2. |
| R3.12 | Records open as full pages or side panels. | 3 | planned | | |
| R3.13 | A mature block-based editor is implemented on a proven editor library. | 3 | planned | | |
| R3.14 | The editor supports paragraphs, headings, ordered and unordered lists, checklists, tables, callouts, quotes, dividers, code blocks, images, attachments, links, embedded documents and linked database views. | 3 | planned | | |
| R3.15 | Slash commands are supported. | 3 | planned | | |
| R3.16 | Markdown shortcuts are supported. | 3 | planned | | |
| R3.17 | Keyboard navigation is supported in the editor. | 3 | planned | | |
| R3.18 | Drag-and-drop block ordering is supported. | 3 | planned | | |
| R3.19 | Autosave is supported. | 3 | planned | | |
| R3.20 | Undo and redo are supported. | 3 | planned | | |
| R3.21 | @mentions are supported. | 3 | planned | | |
| R3.22 | Comments and threaded discussions are supported. | 3 | planned | | |
| R3.23 | Page and block activity and edit attribution are recorded and shown. | 3 | planned | | |
| R3.24 | Version history and restoration are supported. | 3 | planned | | |
| R3.25 | Concurrent editing is reliable, with conflict handling. | 3 | planned | | |
| R3.26 | Configurable relational databases support text, rich text, number, date and date range, email, URL, checkbox, person, status, select, multiselect, file, relation, rollup, formula, created and edited time, and author properties. | 3 | planned | | |
| R3.27 | Scientific core fields retain strict schemas and validation. | 3 | planned | | |
| R3.28 | Authorised users can add custom properties and custom databases. | 3 | planned | | |
| R3.29 | Table, list, Kanban, calendar, timeline or Gantt, gallery and dashboard views are supported. | 3 | planned | | |
| R3.30 | Every view supports relevant filtering, sorting, grouping, search, property visibility, column sizing and reordering, and bulk editing. | 3 | planned | | |
| R3.31 | View configurations can be saved as personal or shared. | 3 | planned | | |
| R3.32 | Large tables use virtualisation. | 3 | planned | | |
| R3.33 | Linked views of one authoritative database appear on multiple pages and update consistently everywhere (for example, the same recruitment record in the programme dashboard, the replication page and the laboratory page). | 3 | planned | | |
| R3.34 | Relational rollups and formulas compute targets, completion percentages, remaining participants, active labs, outstanding tasks, datasets awaiting QC and projected dates. | 3 | planned | | |
| R3.35 | Configurable dashboards offer draggable and resizable linked views, KPI widgets, charts, timelines, calendars, activity feeds, notes and embedded documents. | 3 | planned | | |
| R3.36 | Page and database templates are provided. | 3 | planned | | |
| R3.37 | Contextual workflow buttons are provided. | 3 | planned | | |
| R3.38 | Rule-based automations are triggered by record changes or schedules. | 9 | planned | | |
| R3.39 | Automations have permissions, idempotency, logs, retries and loop prevention. | 9 | planned | | |

## 4. Data architecture and identity

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R4.1 | Programme, Replication, Study Alias or Identifier, Hypothesis and Protocol or Version are modelled explicitly. | 1 | planned | | |
| R4.2 | Laboratory, Institution, Person, Affiliation, Replication Membership or Role, Laboratory-Replication Participation and Equipment Configuration are modelled explicitly. | 1 | planned | | |
| R4.3 | Recruitment Report and Participant Count Category are modelled explicitly. | 1 | planned | | |
| R4.4 | Dataset, Storage Location, File Manifest, Data Transfer, QC Assessment and Processing or Analysis Run are modelled explicitly. | 1 | planned | | |
| R4.5 | Manuscript or Publication and Contributor are modelled explicitly. | 1 | planned | | |
| R4.6 | Task, Milestone, Comment, Workspace Page and Document Link are modelled explicitly. | 1 | planned | | |
| R4.7 | Integration Mapping, Import Batch, Source Record, Audit Event and Notification are modelled explicitly. | 1 | planned | | |
| R4.8 | Decision, Risk and Incident are modelled explicitly. | 1 | planned | | |
| R4.9 | User, Role and Permission are modelled explicitly. | 1 | planned | | |
| R4.10 | Records carry stable internal IDs, source IDs, provenance, timestamps and relationships. | 1 | planned | | |
| R4.11 | A laboratory is kept distinct from its participation in one particular replication. | 1 | planned | | |
| R4.12 | A laboratory may participate in several replications. | 1 | planned | | |
| R4.13 | A person may have multiple affiliations and project roles. | 1 | planned | | |
| R4.14 | A dataset may have several verified storage references. | 1 | planned | | |
| R4.15 | Tasks may link to multiple research entities. | 1 | planned | | |
| R4.16 | Each replication may have multiple leads, hypotheses, protocols, manuscripts and datasets. | 1 | planned | | |
| R4.17 | Storage is normalised and relational, with explicit migrations, constraints, indexes and referential integrity (PostgreSQL by default, subject to infrastructure review). | 1 | planned | | |
| R4.18 | An API is defined. | 1 | planned | | |
| R4.19 | Frontend, domain logic, persistence, authentication, integrations, background jobs, reporting and public publishing are clearly separated. | 1 | planned | | |

## 5. Mandatory source inventory and migration

### General migration requirements

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R5.0.1 | All tabs are inspected, including hidden and archived tabs where access permits. | 0 | in progress | | Sources A and G await access (see R5.A.1 and R5.G.1). |
| R5.0.2 | Original identifiers, source rows, original values, timestamps, formulas, historical context and document links are preserved. | 2 | planned | | |
| R5.0.3 | Historical snapshots are kept apart from current truth, because some sources contain stale or conflicting information. | 2 | planned | | |
| R5.0.4 | Source ownership, field mappings, authority, record counts, update cadence and sync policy are inventoried. | 0 | in progress | | |
| R5.0.5 | Import previews are provided. | 2 | planned | | |
| R5.0.6 | Deduplication is provided. | 2 | planned | | |
| R5.0.7 | Reconciliation and conflict queues are provided. | 2 | planned | | |
| R5.0.8 | Import logs are kept. | 2 | planned | | |
| R5.0.9 | Imports are idempotent. | 2 | planned | | |
| R5.0.10 | Imports can be rolled back safely. | 2 | planned | | |
| R5.0.11 | A source registry is built. | 2 | planned | | |
| R5.0.12 | A migration administration UI is built. | 2 | planned | | |

### A. Historical replication coordination workbook

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R5.A.1 | The workbook is inspected and imported: study leads, laboratory outreach, historical recruitment and the summary fields `StudyID`, `Leader`, `NLabsSigned`, `TotalNSubjectsToBeRun`, `NLabsFinished`, `TotalNMainExpCollected` and `TotalNRest`. | 2 | blocked | | Source A refuses anonymous access and no Google credentials or Google connector exist in this session. The importer will still be built and tested against synthetic, clearly labelled fixtures. |
| R5.A.2 | The workbook is handled as an Excel file stored in Drive, using Drive file APIs or download where native Sheets APIs do not apply. | 2 | blocked | | Source A refuses anonymous access and no Google credentials or Google connector exist in this session. The adapter will still be built and tested against synthetic, clearly labelled fixtures. |
| R5.A.3 | Historical snapshots are preserved separately from live counts. | 2 | planned | | The separation is exercised first with the equivalent summary tab of source F. Source A values await access. |

### B. Naming conventions

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R5.B.1 | The sheet is inspected, including the fields `Original Name`, `Standardized Name - cloud accounts`, `Explanation`, `Part 1`, `Part 2`, `Standardized Name - BIDS` and `EEGnet name`. | 0 | in progress | | |
| R5.B.2 | Canonical identifiers and aliases are maintained across programme, BIDS, EEGNet and server or account naming. | 2 | planned | | |
| R5.B.3 | Existing identifiers are never silently renamed. | 2 | planned | | |

### C. Community vocabulary

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R5.C.1 | The sheet is inspected, including the fields `id`, `name`, `abbreviation`, `description`, `invalid_reason` and `same_as`. | 0 | in progress | | |
| R5.C.2 | The vocabulary is used for controlled scientific terminology, questionnaires, exclusions, synonyms and deprecated terms. | 2 | planned | | Used further in phases 5 and 8. |
| R5.C.3 | Original vocabulary entries are preserved. | 2 | planned | | |

### D. List of studies

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R5.D.1 | All tabs are inspected: `list of studies`, `shortlist_archived`, `allranked_archived`, `questionnaires`, `AlphaAsymmetry_RSSubproject` and other hidden sheets. | 0 | in progress | | |
| R5.D.2 | Study ID, lead, original paper, abstract, effect of interest, plain-language description, original N, statistics, standardised effect size, Bayes factor, duration, sample type, minimum EEG channels, extra equipment, power-based N, questionnaires, study type, outcome and construct are imported. | 2 | planned | | |
| R5.D.3 | Historical candidate studies and archive flags are retained. | 2 | planned | | |

### E. Prediction-market hypotheses

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R5.E.1 | The tabs `links_hypotheses`, `review` and `questions4MarketsNSurvey` are inspected. | 0 | in progress | | |
| R5.E.2 | Hypothesis records and links are created from `study_id`, `studyDescr_pdf`, `infosheet_link`, `hypothesis_number`, `hypothesis_text`, `null-sig`, `replicated`, `authors`, `year`, `title` and `citation`. | 2 | planned | | Extended in phase 8. |
| R5.E.3 | Historical `replicated` and `cancelled` labels are treated as unverified source values pending scientific review, never as definitive conclusions. | 2 | planned | | |

### F. Recruitment and contact workbook

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R5.F.1 | All tabs are inspected, including `numberOfLabsPerReplication`, `leadsEmails`, `Luck1996`, `Onton2005`, `Vidal2000_`, `Boksem2006_labs` and the hidden historical contact sheets. | 0 | in progress | | |
| R5.F.2 | Outreach and contact history and participation are imported. | 2 | planned | | |
| R5.F.3 | Imported outreach and contact data has restricted access. | 2 | planned | | |
| R5.F.4 | The `leadsEmails` tab (`StudyID`, `Old leader`, `Leader`, `Email`) is imported. | 2 | planned | | |
| R5.F.5 | Conflicting leads are flagged for human review and are never resolved arbitrarily. | 2 | planned | | |

### G. Membership and contributor workbook

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R5.G.1 | The tabs `list_members`, `study_description` and `contibutor_tables` (existing spelling preserved) are inspected. | 0 | blocked | | Source G refuses anonymous access and no Google credentials or Google connector exist in this session. The importer will still be built and tested against synthetic, clearly labelled fixtures. |
| R5.G.2 | Every membership field is imported: `name`, `surname`, `email`, `secondary_email`, `affiliation`, `country`, `EEG_system`, `gender`, `ethnicity`, `whichReplication (Tags)` and `isCoauthor`. | 2 | blocked | | Source G refuses anonymous access and no Google credentials or Google connector exist in this session. The importer will still be built and tested against synthetic, clearly labelled fixtures. |
| R5.G.3 | Gender and ethnicity are explicitly imported. | 2 | blocked | | Source G refuses anonymous access and no Google credentials or Google connector exist in this session. The importer will still be built and tested against synthetic, clearly labelled fixtures. |
| R5.G.4 | Original membership values are retained, with appropriately permissioned analysis and reporting. | 2 | blocked | | Source G refuses anonymous access and no Google credentials or Google connector exist in this session. The importer and the permissioned reporting will still be built and tested against synthetic, clearly labelled fixtures. |
| R5.G.5 | The `contibutor_tables` fields `ReplicationID`, `TableLink`, `IsOnlySignUpTable`, `IsPublished`, `PubLink` and `PDFLink` are imported. | 2 | blocked | | Source G refuses anonymous access and no Google credentials or Google connector exist in this session. The importer will still be built and tested against synthetic, clearly labelled fixtures. |
| R5.G.6 | Contributor-table links are followed to discover more spreadsheets, and all additional accessible links are discovered. | 0 | blocked | | The list of contributor tables lives in source G, which refuses anonymous access, and no Google credentials or Google connector exist in this session. Links found in the accessible sources are followed in the meantime, and the importer will still be built and tested against synthetic, clearly labelled fixtures. |
| R5.G.7 | The known linked contributor sheets for AmodioJost2007, AmodioMaster2008, Boksem2006, BuschVanRullen2010 and DelCul2007 are inspected. | 0 | in progress | | These five sheets are readable in this session. |
| R5.G.8 | The known linked contributor sheets for AmodioJost2007, AmodioMaster2008, Boksem2006, BuschVanRullen2010 and DelCul2007 are imported. | 2 | planned | | Extended in phase 8. |

### H. Website structured data

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R5.H.1 | The `data/` TSV files and other records in the primary repository are inspected, including Members, Replications, Core Team and Publications. | 0 | in progress | | |
| R5.H.2 | Website records are reconciled with the seven spreadsheets. | 2 | planned | | Reconciliation against sources A and G follows once access is granted. |
| R5.H.3 | Public approved data is distinguished from internal records. | 2 | planned | | |

### I. Quire

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R5.I.1 | The available Quire exports and API are inspected. | 0 | blocked | | No Quire export file or Quire API token is available in this session. The published Quire documentation is being reviewed, and the importer will still be built and tested against synthetic, clearly labelled fixtures. |
| R5.I.2 | Projects, nested tasks, assignees, comments, dates, dependencies, statuses and history are migrated where available. | 4 | blocked | | No Quire export file or Quire API token is available in this session. The importer will still be built and tested against synthetic, clearly labelled fixtures. |
| R5.I.3 | Legacy Quire IDs and import provenance are preserved. | 4 | planned | | Verified on synthetic fixtures until a real export is supplied. |
| R5.I.4 | Fields that cannot be recovered from Quire are identified. | 4 | planned | | Derived from the published documentation and confirmed against a real export once supplied. |

### J. Google Drive, Docs, OSF and other linked documents

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R5.J.1 | Stage 1 reports, protocols, drafts, contributor tables, analyses and project folders referenced in the accessible sources are discovered. | 0 | in progress | | |
| R5.J.2 | Documents and folders that sit behind Google sign-in are discovered through Drive. | 0 | blocked | | No Google Workspace service account or OAuth client exists, so live Sheets, Docs and Drive calls cannot be made. The adapter will still be built and tested against synthetic, clearly labelled fixtures. |
| R5.J.3 | Source URLs and access restrictions are preserved for every linked document. | 2 | planned | | |
| R5.J.4 | Inaccessible content is never fabricated. | 0 | planned | | Applies in every phase. |

## 6. Pre-populated accounts, claiming and permissions

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R6.1 | All existing member, laboratory and replication profiles are prepopulated from the sources before users are invited. | 2 | planned | | Member contact details and demographics held only in source G follow once access is granted. |
| R6.2 | Claim my account: a user enters an existing email, verifies ownership securely, reviews the matched person, affiliation, laboratory and replication records, and claims the existing profile. | 2 | planned | | |
| R6.3 | Claiming supports secondary emails. | 2 | planned | | |
| R6.4 | Claiming supports multiple affiliations. | 2 | planned | | |
| R6.5 | Claiming handles ambiguous matches. | 2 | planned | | |
| R6.6 | Unclaimed records are supported. | 2 | planned | | |
| R6.7 | Invitations are supported. | 2 | planned | | Sending an invitation needs explicit approval (R1.15). |
| R6.8 | Claim review is supported. | 2 | planned | | |
| R6.9 | Correction requests are supported. | 2 | planned | | |
| R6.10 | Duplicate accounts and profiles are prevented. | 2 | planned | | |
| R6.11 | Claiming resists account enumeration, insecure email matching and account takeover. | 2 | planned | | |
| R6.12 | A separate, verified laboratory-claiming process with administrator review is provided. | 2 | planned | | |
| R6.13 | A laboratory can have multiple authorised representatives. | 2 | planned | | |
| R6.14 | Secure individual email-based authentication is provided. | 1 | planned | | Exercised through a development mailbox until SMTP credentials exist (see R16.6). |
| R6.15 | Optional Google or institutional sign-in is provided. | 1 | blocked | | No Google Workspace service account or OAuth client exists, so live Google calls cannot be made. The adapter will still be built and tested against synthetic, clearly labelled fixtures. |
| R6.16 | MFA is required for privileged accounts. | 1 | planned | | |
| R6.17 | Session controls are provided. | 1 | planned | | |
| R6.18 | Account recovery is provided. | 1 | planned | | |
| R6.19 | Replication-level group workspaces and stable group identifiers let teams operate together without a separate identity for each project. | 2 | planned | | |
| R6.20 | Individual attribution is preserved for edits and audit trails, with no reliance on shared passwords. | 1 | planned | | |
| R6.21 | External system account mappings are allowed when needed. | 2 | planned | | |
| R6.22 | The initial roles exist: programme administrators (Faisal Mushtaq and Yuri Pavlov), core team, replication leads, laboratory coordinators, laboratory members and authorised external collaborators. | 1 | planned | | |
| R6.23 | Administrators have full operational read and write access. | 1 | planned | | |
| R6.24 | The core team has broad operational read and write access, with configurable restrictions on sensitive operations. | 1 | planned | | |
| R6.25 | Replication leads manage their assigned replications. | 2 | planned | | |
| R6.26 | Laboratory coordinators maintain their laboratory and participation records. | 2 | planned | | |
| R6.27 | Permissions are enforced server-side at programme, replication, laboratory, page, record and field levels. | 1 | planned | | Page-level rules arrive in phase 3. |
| R6.28 | Administrator and core-team accounts always have write access and are never treated as read-only. | 1 | planned | | |
| R6.29 | User suspension, revocation, role changes and permission audit are provided. | 2 | planned | | |
| R6.30 | Demographic information such as gender and ethnicity is preserved and available for authorised administrative filtering and analysis. | 2 | planned | | The real values are held in source G and follow once access is granted. |
| R6.31 | Original source terms, optional standardised reporting categories, and missing and self-described values are retained for demographics. | 2 | planned | | |
| R6.32 | Demographics are protected by field-level access controls, audit, minimisation in exports and appropriate governance. | 2 | planned | | |
| R6.33 | Sensitive demographics are kept out of public view by default. | 2 | planned | | |

## 7. Replication management

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R7.1 | Full replication records hold: permanent identifier, aliases, original paper and verified citation, abstract and rationale, leads and emails, hypotheses, effect of interest, original sample size, statistics, effect size and Bayes factor, power assumptions, target N, required EEG equipment, questionnaires, protocols, Stage 1 and Stage 2 Registered Reports, participating labs, recruitment, datasets, analyses, manuscripts, milestones, tasks, notes and linked folders. | 2 | planned | | Completed across phases 2 to 8. |
| R7.2 | Each replication has a configurable workspace with Overview, Leadership, Laboratories, Recruitment, Datasets, Protocols, Hypotheses, Tasks, Documents, Analyses, Publications, Activity and Reports. | 3 | planned | | Navigation skeleton arrives in phase 2. |
| R7.3 | Replications support custom properties, multiple leads and multiple hypotheses. | 3 | planned | | |
| R7.4 | Statuses are configurable: proposed, planning, recruiting labs, site preparation, collecting, collection complete, processing, analysing, writing, submitted, published, paused and archived. | 2 | planned | | |
| R7.5 | Status transitions are timestamped, with author, reason and history. | 2 | planned | | |
| R7.6 | Historical status can be reconstructed for a past date. | 2 | planned | | |
| R7.7 | Project milestones, dependencies and timelines are supported. | 4 | planned | | |
| R7.8 | Blockers and a risk register are supported. | 4 | planned | | |
| R7.9 | Decisions are recorded per replication. | 8 | planned | | |
| R7.10 | Protocol deviations are recorded per replication. | 8 | planned | | |
| R7.11 | Follow-up notes are supported. | 3 | planned | | |

## 8. Laboratory and participation management

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R8.1 | One authoritative laboratory profile exists per laboratory or institutional unit, including institution, department, country, city, appropriate address, contacts, PI, coordinator, members, website and equipment. | 2 | planned | | |
| R8.2 | EEG amplifiers, caps and electrodes, channel count, sampling rates, triggers, presentation software, stimulus computers, eye trackers and other equipment are tracked. | 2 | planned | | |
| R8.3 | A laboratory can hold multiple equipment configurations, with historical changes. | 2 | planned | | |
| R8.4 | Equipment is compared against replication requirements, showing compatibility and missing capabilities. | 2 | planned | | |
| R8.5 | Justified equipment overrides are supported. | 2 | planned | | |
| R8.6 | Separate laboratory-replication participation records hold local leads, ethics, training, readiness, target sample size, progress, protocol version, submissions, notes and tasks. | 2 | planned | | |
| R8.7 | An onboarding checklist covers participation confirmation, verified contacts, equipment confirmation, ethics, protocol review, training, technical checks, pilot and readiness approval. | 2 | planned | | |
| R8.8 | A lab-by-replication readiness matrix is provided. | 2 | planned | | |
| R8.9 | A central laboratory dashboard is provided. | 2 | planned | | |
| R8.10 | Laboratory profile self-service is provided. | 2 | planned | | |
| R8.11 | An approval workflow with timestamps is provided. | 2 | planned | | |
| R8.12 | A laboratory's equipment updates propagate to the relevant replication views while project-specific details are left unchanged. | 2 | planned | | |

## 9. Recruitment and sample-size projections

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R9.1 | For each laboratory-replication participation, target, planned, scheduled, recruited, tested, recorded, submitted, received, validated, usable and excluded counts are tracked. | 5 | planned | | |
| R9.2 | Count categories have explicit definitions and replication-specific extensions. | 5 | planned | | |
| R9.3 | Main experiment and resting-state recording counts are tracked separately. | 5 | planned | | |
| R9.4 | Participants who contribute to both main experiment and resting state are counted once. | 5 | planned | | |
| R9.5 | Lab-reported values are distinguished from centrally verified values. | 5 | planned | | |
| R9.6 | Period-specific counts are distinguished from cumulative counts. | 5 | planned | | |
| R9.7 | Corrections are distinguished from new recruitment. | 5 | planned | | |
| R9.8 | Dates, authors, sources, notes, exclusion reasons where appropriate and a complete audit history are stored. | 5 | planned | | |
| R9.9 | Missing updates are stored as unknown and are never coerced to zero. | 5 | planned | | |
| R9.10 | Simple laboratory entry forms and inline editable tables are provided. | 5 | planned | | |
| R9.11 | Counts roll up by laboratory, replication, country, institution, period and programme. | 5 | planned | | |
| R9.12 | Target versus actual, completion percentage, active sites, QC attrition, usable N, trends, recruitment rates and milestone achievement are shown. | 5 | planned | | |
| R9.13 | Designated master projection spreadsheets are integrated. | 5 | blocked | | No Google Workspace service account or OAuth client exists, so live Sheets, Docs and Drive calls cannot be made, and the master projection spreadsheets have yet to be designated. The adapter will still be built and tested against synthetic, clearly labelled fixtures. |
| R9.14 | Completion is forecast using lab-specific rates, active labs, expected exclusions and planned pauses. | 5 | planned | | |
| R9.15 | Forecasts display their assumptions, optimistic, central and conservative scenarios, and uncertainty. | 5 | planned | | |
| R9.16 | Inactivity alerts and follow-up tasks are shown. | 5 | planned | | |
| R9.17 | Historical snapshots and queries, such as recruitment at the end of a previous month, are supported. | 5 | planned | | |
| R9.18 | Approved aggregate figures can feed the public website. | 5 | planned | | Publishing path arrives in phase 9. |

## 10. Quire-grade tasks, notes and project oversight

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R10.1 | Tasks and subtasks nest to any practical depth. | 4 | planned | | |
| R10.2 | Tasks have assignees and collaborators. | 4 | planned | | |
| R10.3 | Tasks have start and due dates, priorities and statuses. | 4 | planned | | |
| R10.4 | Tasks have dependencies. | 4 | planned | | |
| R10.5 | Tasks have recurring schedules. | 4 | planned | | |
| R10.6 | Tasks have reminders. | 4 | planned | | |
| R10.7 | Tasks have checklists, attachments and comments. | 4 | planned | | |
| R10.8 | Tasks have milestones, estimates and progress. | 4 | planned | | |
| R10.9 | Tasks have an audit history. | 4 | planned | | |
| R10.10 | Tasks link to programme, replication, laboratory, dataset, protocol, hypothesis, manuscript, meeting or other pages. | 4 | planned | | |
| R10.11 | Personal lists and project lists are supported. | 4 | planned | | |
| R10.12 | Kanban, calendar, timeline or Gantt, and workload views are supported. | 4 | planned | | |
| R10.13 | Saved views and bulk edits are supported. | 4 | planned | | |
| R10.14 | Risks and blockers, workload summaries, programme roadmaps and cross-project dependencies are provided. | 4 | planned | | |
| R10.15 | Available Quire history is migrated with source provenance preserved. | 4 | blocked | | No Quire export file or Quire API token is available in this session. The importer will still be built and tested against synthetic, clearly labelled fixtures. |
| R10.16 | Rich notes and progress logs are supported on every major entity. | 4 | planned | | Builds on the phase 3 page editor. |
| R10.17 | Comments, mentions, pinned updates, attachments, chronological feeds and notifications are supported on every major entity. | 4 | planned | | |
| R10.18 | Meeting pages support agendas, attendees, notes, decisions and the creation of linked action items. | 4 | planned | | |

## 11. Distributed EEG data infrastructure

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R11.1 | A dataset registry is built in which data may remain on servers in Bremen, Munich and other institutions, with central storage optional. | 7 | planned | | |
| R11.2 | The registry tracks dataset identifier, replication, laboratory, session or grouping where appropriate, source institution, server, protocol, path or URI, storage owner, expected and received files, metadata, checksums, size, timestamps, transfer history, BIDS status, QC status, preprocessing, analysis readiness and provenance. | 7 | planned | | |
| R11.3 | A dataset supports multiple references: primary, mirror, backup and processing copy. | 7 | planned | | |
| R11.4 | Relocations and availability are tracked. | 7 | planned | | |
| R11.5 | Secure adapters are designed for the actual approved protocols (potentially SFTP, FTPS, institutional filesystems or object storage), using secret management and least privilege. | 7 | planned | | The approved protocols and credentials for the institutional servers have yet to be supplied. Adapters are verified against local test servers in the meantime. |
| R11.6 | Authorised metadata scans run without unnecessary raw EEG transfer. | 7 | planned | | |
| R11.7 | Missing, duplicate and unexpected files are identified, and manifests and checksums are validated. | 7 | planned | | |
| R11.8 | Transfer initiated, completed, failed and verified states are recorded. | 7 | planned | | |
| R11.9 | The portal remains useful during remote server outages. | 7 | planned | | |
| R11.10 | Participant data is protected and access is recorded. | 7 | planned | | |
| R11.11 | BIDS conversion and validation, missing metadata and naming mappings are tracked. | 7 | planned | | |
| R11.12 | Recording-level and dataset-level QC, pipeline versions, parameters, exclusions, deviations and analysis readiness are tracked. | 7 | planned | | |
| R11.13 | A configurable workflow is supported, for example: received, integrity checked, BIDS validated, QC pending, QC completed, accepted or flagged, preprocessing, analysis ready. | 7 | planned | | |
| R11.14 | Existing BIDS and QC tools are integrated where appropriate. | 7 | planned | | |
| R11.15 | ElectroTag is treated as an optional viewer and annotation tool, and data access and storage work without it. | 7 | planned | | |
| R11.16 | Optional secure viewing links and workflows are provided only where supported. | 7 | planned | | |

## 12. Scientific workflows and outputs

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R12.1 | Hypothesis-level records are linked to original studies, expected effects, outcome measures, analysis specifications, preregistration, prediction-market claims, original statistics, analysis status, results and reporting. | 8 | planned | | |
| R12.2 | Citations are verified against authoritative publication sources before they are presented as confirmed. | 8 | planned | | First verification pass runs with the phase 2 import. |
| R12.3 | Protocol versions, laboratory acknowledgements, deviations and compliance are tracked. | 8 | planned | | |
| R12.4 | Stage 1 and Stage 2 Registered Reports, Google Docs and OSF links, drafts, review rounds, decisions, revisions and submission milestones are tracked. | 8 | planned | | |
| R12.5 | Analysis runs, code and pipeline versions, parameters, inputs and outputs, QC and reproducibility are tracked. | 8 | planned | | |
| R12.6 | A methodological decision log is maintained. | 8 | planned | | |
| R12.7 | An incident and corrective-action registry is maintained. | 8 | planned | | |
| R12.8 | Contributor tables are imported, and roles in data collection, recruitment, analysis and writing are recorded. | 8 | planned | | The five known contributor sheets are readable. Further tables listed only in source G follow once access is granted. |
| R12.9 | Authorship and acknowledgement preparation and review are supported. | 8 | planned | | |
| R12.10 | Manuscripts, preprints, journals, submissions, reviews, revisions, acceptance, publication, DOI, OSF, and software and dataset outputs are tracked. | 8 | planned | | |
| R12.11 | Reproducibility and provenance exports are provided. | 8 | planned | | |

## 13. Google Drive, Sheets and Docs: continuing two-way collaboration

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R13.1 | Google Workspace remains a core, continuing operational environment, and independent access through Google Docs and Sheets is preserved. | 6 | planned | | |
| R13.2 | Drive folders are linked to replications, laboratories, datasets and manuscripts. | 6 | planned | | |
| R13.3 | Authorised resources can be browsed, previewed and opened, with ownership and last-modified data shown. | 6 | blocked | | No Google Workspace service account or OAuth client exists, so live Sheets, Docs and Drive calls cannot be made. The adapter will still be built and tested against synthetic, clearly labelled fixtures. |
| R13.4 | Existing Stage 1 reports, drafts, protocols and contributor sheets are integrated. | 6 | planned | | Documents that sit behind Google sign-in follow once credentials are supplied. |
| R13.5 | Field-level mappings between authoritative application records and designated Google Sheets are configurable. | 6 | planned | | |
| R13.6 | Edits made in the application update the designated Sheets. | 6 | blocked | | No Google Workspace service account or OAuth client exists, so live Sheets, Docs and Drive calls cannot be made. The adapter will still be built and tested against synthetic, clearly labelled fixtures. |
| R13.7 | Edits made in a configured Sheet update the application. | 6 | blocked | | No Google Workspace service account or OAuth client exists, so live Sheets, Docs and Drive calls cannot be made. The adapter will still be built and tested against synthetic, clearly labelled fixtures. |
| R13.8 | Synchronisation uses stable IDs in place of row numbers, so that row insertion and reordering are handled. | 6 | planned | | Verified against a fake Sheets service until credentials are supplied. |
| R13.9 | Duplicate imports and feedback loops are avoided. | 6 | planned | | |
| R13.10 | The source of truth is configurable per field or document: application authoritative, Sheet authoritative, bidirectional with conflict review, generated output, or manual document with generated sections. | 6 | planned | | |
| R13.11 | Conflicts are detected using revisions and timestamps, both versions are shown, and authorised users can merge or resolve them. | 6 | planned | | |
| R13.12 | Formatting, unrelated cells, formulas and manually managed columns are preserved in synchronised Sheets. | 6 | blocked | | No Google Workspace service account or OAuth client exists, so live Sheets, Docs and Drive calls cannot be made. The adapter will still be built and tested against synthetic, clearly labelled fixtures. |
| R13.13 | Standard Google Docs are created and updated from templates for programme, replication and laboratory progress, recruitment, meetings and scientific milestones. | 6 | blocked | | No Google Workspace service account or OAuth client exists, so live Sheets, Docs and Drive calls cannot be made. The adapter will still be built and tested against synthetic, clearly labelled fixtures. |
| R13.14 | Generated Docs use clearly identified generated sections, managed tables and stable anchors, and human-authored narrative is preserved. | 6 | blocked | | No Google Workspace service account or OAuth client exists, so live Sheets, Docs and Drive calls cannot be made. The adapter will still be built and tested against synthetic, clearly labelled fixtures. |
| R13.15 | Generated Docs include portal links, report dates and source provenance. | 6 | planned | | |
| R13.16 | Where configured, structured Docs-to-app updates are supported for designated fields only. | 6 | blocked | | No Google Workspace service account or OAuth client exists, so live Sheets, Docs and Drive calls cannot be made. The adapter will still be built and tested against synthetic, clearly labelled fixtures. |
| R13.17 | An admin dashboard shows connected services, mappings, last success, pending jobs, errors, conflicts, retries and health. | 6 | planned | | |
| R13.18 | Synchronisation uses background jobs, idempotency, retries, backoff and respect for API quotas. | 6 | planned | | |
| R13.19 | The supported sync boundaries are documented, and promises of arbitrary two-way rich-text fidelity are limited to what the APIs can support. | 6 | planned | | |

## 14. Public website publishing

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R14.1 | Only approved public fields are published to the existing eegmanylabs.org website, using its current static data and build workflow or an equivalent controlled mechanism. | 9 | planned | | |
| R14.2 | Candidate outputs are supported: approved member and laboratory listings, replication summaries, publications, milestones and aggregate recruitment. | 9 | planned | | |
| R14.3 | Publishing requires preview, staging verification and administrator approval. | 9 | planned | | Staging verification runs through the existing pull-request workflow and needs approval before it is triggered. |
| R14.4 | Internal contact details, demographics, private notes, credentials and research participant data are kept out of public feeds. | 9 | planned | | |
| R14.5 | Publishing logs and rollback are maintained. | 9 | planned | | |

## 15. Dashboards, analytics, search and reports

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R15.1 | A programme dashboard shows active replications, labs, members, recruitment targets and usable N, the dataset and QC pipeline, overdue tasks, milestones, stalled projects, pending claims, integration errors and recent activity. | 9 | planned | | |
| R15.2 | A replication dashboard shows leads, participating labs, readiness, recruitment, forecasts, datasets, tasks, hypotheses, manuscripts and risks. | 9 | planned | | |
| R15.3 | A laboratory dashboard shows equipment, members, projects, recruitment, datasets, onboarding and tasks. | 9 | planned | | |
| R15.4 | A personal dashboard shows assigned work, mentions, notifications, deadlines and recent pages. | 9 | planned | | First version arrives in phase 2. |
| R15.5 | Dashboards are configurable, with drill-down, historical snapshots and charts. | 9 | planned | | |
| R15.6 | Export to CSV, Excel and PDF is provided where appropriate. | 9 | planned | | |
| R15.7 | Scheduled reports and controlled email digests are supported. | 9 | planned | | Real email delivery awaits SMTP credentials (see R16.6). |
| R15.8 | Permission-aware global search covers records, pages, comments and indexed document metadata and content where authorised. | 9 | planned | | First version arrives in phase 3. |
| R15.9 | Advanced filters, saved searches, command palette and quick navigation are supported. | 9 | planned | | |
| R15.10 | Authorised demographic, geographic, equipment, participation and scientific-progress analysis is available. | 9 | planned | | Demographic analysis on real values follows access to source G. |
| R15.11 | Observed, imported historical and projected values are clearly labelled. | 9 | planned | | |
| R15.12 | Optional AI features (natural-language search, summaries, document assistance and stalled-project detection) cite underlying workspace records, respect permissions and avoid unsupported claims. | 9 | planned | | Optional. |

## 16. Notifications, collaboration and automation

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R16.1 | Page and record subscriptions are provided. | 9 | planned | | |
| R16.2 | Threaded comments and @mentions are provided. | 3 | planned | | |
| R16.3 | Assignment alerts, status-change notifications and reminders are provided. | 9 | planned | | |
| R16.4 | Integration failure alerts, protocol updates and milestone notifications are provided. | 9 | planned | | |
| R16.5 | In-app notifications are supported. | 9 | planned | | First version arrives in phase 3. |
| R16.6 | Email notifications are supported. | 9 | blocked | | No SMTP credentials exist, so real email delivery cannot be exercised. The mail adapter will still be built and tested against a development mailbox with synthetic, clearly labelled fixtures. |
| R16.7 | Digest preferences and quiet settings are supported. | 9 | planned | | |
| R16.8 | Historical recruitment correspondence is preserved where available, with restricted visibility. | 2 | planned | | |
| R16.9 | Configurable actions are supported: create a laboratory onboarding checklist on approval, create a QC task when data arrives, notify leads when recruitment targets are met, generate progress reports and flag overdue updates. | 9 | planned | | |
| R16.10 | Each automation is logged, loops are prevented, and retry and recovery are supported. | 9 | planned | | |

## 17. Administration, security and governance

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R17.1 | An admin console covers users, claims, labs, replications, roles, custom fields, templates, imports, integrations, sync conflicts, storage endpoints, audit logs, backups and publishing. | 2 | planned | | Grows with each phase. |
| R17.2 | Established authentication is used. | 1 | planned | | |
| R17.3 | MFA is used for privileged users. | 1 | planned | | |
| R17.4 | Sessions are secure. | 1 | planned | | |
| R17.5 | Authorisation is enforced server-side. | 1 | planned | | |
| R17.6 | Input is validated. | 1 | planned | | |
| R17.7 | Data is encrypted in transit. | 10 | planned | | |
| R17.8 | Secrets are managed outside the source tree. | 1 | planned | | |
| R17.9 | Rate limits are applied. | 1 | planned | | |
| R17.10 | Logging is in place. | 1 | planned | | |
| R17.11 | Appropriate security headers are set. | 1 | planned | | |
| R17.12 | UK GDPR and the programme's approved governance are applied, including retention, subject access, access review, audit and restricted demographic fields. | 10 | planned | | |
| R17.13 | Personal and participant data are protected from public disclosure. | 1 | planned | | Applies in every phase. |
| R17.14 | Backups are secure and restoration is tested. | 10 | planned | | |
| R17.15 | Environments are separated. | 10 | planned | | |
| R17.16 | Service accounts follow least privilege. | 10 | planned | | |

## 18. Engineering standards

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R18.1 | The stack is chosen after the repository review. | 0 | in progress | | |
| R18.2 | A mature TypeScript frontend and backend with PostgreSQL is preferred if suitable. | 1 | planned | | |
| R18.3 | A proven rich-text editor is used. | 3 | planned | | |
| R18.4 | Virtualised grids are used. | 3 | planned | | |
| R18.5 | Background job processing is in place. | 1 | planned | | |
| R18.6 | Database migrations are in place. | 1 | planned | | |
| R18.7 | Typed API contracts are in place. | 1 | planned | | |
| R18.8 | Adapters are documented. | 6 | planned | | |
| R18.9 | Accessibility is aligned with WCAG 2.2 AA where practicable. | 10 | planned | | Applies in every phase. |
| R18.10 | Layouts are responsive on desktop, tablet and mobile. | 1 | planned | | |
| R18.11 | Keyboard navigation is supported across the portal. | 3 | planned | | |
| R18.12 | Loading, empty and error states are clear. | 1 | planned | | |
| R18.13 | Performance and pagination are addressed. | 10 | planned | | |
| R18.14 | Unit, integration, migration, permission, sync, security and end-to-end tests are implemented. | 10 | planned | | Tests are added with each slice. |
| R18.15 | Every visible control has a real function. | 1 | planned | | Applies in every phase. |
| R18.16 | Demo data is labelled. | 1 | planned | | |
| R18.17 | Actual test results and unresolved limitations are recorded. | 1 | planned | | Applies in every phase. |

## 19. Delivery phases and persistent documentation

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R19.1 | Phase 0, discovery: the repository, deployment, public data, all seven Sheets, linked contributor files and Quire export possibilities are inspected, and the architecture, source registry, data model, security and migration plan are documented. | 0 | in progress | | Sources A and G and a Quire export await access. |
| R19.2 | Phase 1, integrated portal foundation: `/portal`, navigation, login, database, roles and protected staging with visual continuity are implemented. | 1 | planned | | Protected staging is tracked in R2.19. |
| R19.3 | Phase 2, migration and claims: members, labs, studies, aliases and participation are imported and reconciled, and secure member and laboratory claiming with admin review is implemented. | 2 | planned | | |
| R19.4 | Phase 3, Notion-style workspace: rich pages, linked relational databases, saved views, templates, collaboration, version history and custom dashboards are implemented. | 3 | planned | | |
| R19.5 | Phase 4, tasks and Quire migration: nested tasks, dependencies, boards, timelines, reminders, project oversight and import tools are implemented. | 4 | planned | | |
| R19.6 | Phase 5, recruitment: separate main and resting counts, verified statuses, laboratory updates, projections, historical reporting and public aggregates are implemented. | 5 | planned | | |
| R19.7 | Phase 6, Google Workspace: Drive links, Sheets field mappings and two-way sync, generated Docs, conflicts, health and retries are implemented. | 6 | planned | | Live verification is tracked in section 13. |
| R19.8 | Phase 7, research data: the distributed registry, secure server adapters, manifests, transfers, BIDS and QC, and optional ElectroTag integration are implemented. | 7 | planned | | |
| R19.9 | Phase 8, scientific workflows: hypotheses, protocols, Registered Reports, analysis provenance, contributors and publications are implemented. | 8 | planned | | |
| R19.10 | Phase 9, reporting and automations: configurable dashboards, notifications, workflows, scheduled reports, optional AI and public publishing are implemented. | 9 | planned | | |
| R19.11 | Phase 10, hardening: security review, performance, accessibility, migration verification, recovery tests, documentation and deployment readiness are completed. | 10 | planned | | |
| R19.12 | `docs/ARCHITECTURE.md` is maintained. | 0 | planned | | |
| R19.13 | `docs/DATA_MODEL.md` is maintained. | 0 | planned | | A first draft exists. |
| R19.14 | `docs/SOURCE_REGISTRY.md` is maintained. | 0 | planned | | |
| R19.15 | `docs/MIGRATION_PLAN.md` is maintained. | 0 | planned | | |
| R19.16 | `docs/INTEGRATIONS.md` is maintained. | 0 | planned | | |
| R19.17 | `docs/SECURITY.md` is maintained. | 0 | planned | | |
| R19.18 | `docs/DECISIONS.md` is maintained. | 0 | planned | | |
| R19.19 | `docs/IMPLEMENTATION_STATUS.md` is maintained. | 0 | planned | | |
| R19.20 | `docs/TEST_REPORT.md` is maintained. | 0 | planned | | |
| R19.21 | A comprehensive requirements checklist is maintained. | 0 | planned | | This document. |
| R19.22 | Each item is tracked as planned, in progress, implemented, tested or blocked. | 0 | planned | | |
| R19.23 | Decisions, test evidence, blockers, exact next steps and safe resumption instructions are recorded after each session. | 0 | planned | | Applies in every phase. |
| R19.24 | Completion is declared only after verification. | 10 | planned | | Applies in every phase. |

## 20. End-to-end acceptance scenarios

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| AS-1 | An imported member securely claims their pre-existing profile by verified email and sees correct laboratory and replication associations without duplication. | 2 | planned | | |
| AS-2 | A laboratory representative claims an existing laboratory through verified affiliation and admin review, and another authorised representative can be added. | 2 | planned | | |
| AS-3 | A coordinator edits equipment, all linked laboratory and replication views update, and a designated Google Sheet synchronises with an audit entry. | 6 | blocked | | No Google Workspace service account or OAuth client exists, so live Sheets, Docs and Drive calls cannot be made. The in-app propagation is tested directly, and the Sheets adapter will still be built and tested against synthetic, clearly labelled fixtures. |
| AS-4 | A coordinator reports main experiment and resting-state counts separately, programme and project dashboards update without participant double counting, and verified versus reported counts are preserved. | 5 | planned | | |
| AS-5 | Forecasts recalculate using documented assumptions, and historical reports reconstruct the actual status at a prior date. | 5 | planned | | |
| AS-6 | A replication lead creates a nested task with a dependency, a deadline and a dataset link, the assignee receives it, and views update consistently. | 4 | planned | | The dataset link depends on the phase 7 registry. |
| AS-7 | A user edits a rich replication page, inserts a linked database, comments and @mentions another user, and autosave, history and notifications work. | 3 | planned | | |
| AS-8 | An authorised researcher registers an EEG dataset stored on a Bremen or Munich server, and metadata, paths, BIDS and QC status are visible with no compulsory central transfer and no dependence on ElectroTag. | 7 | planned | | |
| AS-9 | A generated Google Doc updates its managed sections from application data while manually written text is left untouched. | 6 | blocked | | No Google Workspace service account or OAuth client exists, so live Sheets, Docs and Drive calls cannot be made. The adapter will still be built and tested against synthetic, clearly labelled fixtures. |
| AS-10 | An external Google Sheet edit updates the mapped application field, and simultaneous conflicting edits are flagged and resolved with an audit trail. | 6 | blocked | | No Google Workspace service account or OAuth client exists, so live Sheets, Docs and Drive calls cannot be made. The adapter will still be built and tested against synthetic, clearly labelled fixtures. |
| AS-11 | Re-running imports yields stable identities and no duplicates, and conflicting historical leads remain flagged for review. | 2 | planned | | |
| AS-12 | A programme administrator can manage the full system, the core team can edit their permitted operational records, and laboratory users have no access to unrelated private records or restricted demographics. | 2 | planned | | |
| AS-13 | An approved public summary passes through staging and publishes to eegmanylabs.org without exposing private information. | 9 | blocked | | No DigitalOcean or GitHub deployment credentials are available and production deployment needs explicit approval. The publishing adapter will still be built and tested against synthetic, clearly labelled fixtures and a local copy of the site build. |
| AS-14 | A Quire export migrates available nested tasks, dates and comments with source IDs and an explicit missing-fields report. | 4 | blocked | | No Quire export file or Quire API token is available in this session. The importer will still be built and tested against synthetic, clearly labelled fixtures. |
| AS-15 | A server outage, a Google API quota error and a failed sync each produce visible, recoverable states without corrupting authoritative records. | 10 | planned | | Faults are simulated against fake services until live credentials are supplied. |
| AS-16 | Backups can be restored and audited, and tests pass in staging before any approved production rollout. | 10 | blocked | | No DigitalOcean or GitHub deployment credentials are available and production deployment needs explicit approval. Backup and restore will still be exercised locally, and the test suite will run against a local integrated stack. |

## 21. Immediate execution instructions

| ID | Requirement | Phase | Status | Evidence | Notes |
|---|---|---|---|---|---|
| R21.1 | Work starts with inspection of the primary repository's README, architecture, styles, structured data and deployment configuration. | 0 | in progress | | |
| R21.2 | All seven source documents and their linked contributor files are inspected where access is available. | 0 | in progress | | Sources B, C, D, E and F and five contributor sheets are readable. Sources A and G await access. |
| R21.3 | A concise, evidence-based architecture and migration assessment is reported. | 0 | in progress | | |
| R21.4 | A development branch is created. | 1 | planned | | |
| R21.5 | The portal service and database are established. | 1 | planned | | |
| R21.6 | The first working vertical slice is implemented: existing website integration, secure login, imported member, laboratory and replication registry, account claiming, personalised dashboard, and replication and laboratory navigation. | 2 | planned | | Spans phases 1 and 2. |
| R21.7 | The first slice is tested and its results are documented before the next stage begins. | 2 | planned | | |
| R21.8 | Implementation continues in coherent, verified increments beyond planning and mock-up. | 3 | planned | | Applies from phase 3 onwards. |
| R21.9 | Explicit approval is requested before production deployment, destructive migration or live external writes. | 10 | planned | | See R1.12 to R1.16. |
| R21.10 | Success criterion: one cohesive, authenticated extension of eegmanylabs.org with Notion-like workspace behaviour, Quire-quality project management, faithful migration of existing records including demographics, independent and synchronised Google Workspace documents, distributed EEG dataset tracking, scientific provenance, historical reporting and permissioned collaboration across the entire programme. | 10 | planned | | Migration of demographics and live Google synchronisation depend on the blocked items above. |

## Summary counts

| Status | Items |
|---|---|
| planned | 344 |
| in progress | 21 |
| implemented | 0 |
| tested | 0 |
| blocked | 29 |
| Total | 394 |
