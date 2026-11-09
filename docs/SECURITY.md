# #EEGManyLabs Hub: security and governance

This document describes the security design of the members' portal, the data it holds, the controls that protect that data and the findings from the discovery phase that need a decision from the programme administrators. It should be read with `docs/ARCHITECTURE.md` for the system boundary and `docs/DATA_MODEL.md` for the tables referred to here.

## 1. What changes when the portal is added

The public website is a static site. It holds no personal data beyond what has been approved for publication, has no server-side state and has no secrets at run time. The portal changes that position. It is a stateful service that stores contact details, special-category demographic data, private notes, recruitment correspondence and the locations of research datasets. The security boundary therefore sits between the static site, which stays exactly as public as it is now, and the portal service and its database, which are private and reachable only through authenticated, authorised requests.

Three rules follow from that boundary and apply to every change. Private data never enters the Git repository, the static build, public TSV files or a browser bundle. Every read and write of private data passes through the service layer, which enforces authorisation on the server. The public website receives data from the portal only through the publishing workflow, which exports approved public fields after a preview and an administrator's approval.

## 2. Data classification

| Class | Examples | Who may read it |
|---|---|---|
| Public | Names and affiliations already approved for the Members and Core Team pages, replication summaries, publications, approved aggregate recruitment | Anyone, through the public website |
| Member | Replication workspaces, laboratory profiles, task lists, programme directory | Signed-in members, subject to scope |
| Restricted | Email addresses, postal addresses, outreach and recruitment correspondence, private notes, storage paths and server details | The person concerned, programme administrators, the core team, and scoped roles for the records in their own replication or laboratory |
| Special category | Gender and ethnicity | The person concerned, programme administrators, and users holding an explicit, time-limited `demographics.read` grant |

Gender and ethnicity are special-category or sensitive personal data under UK GDPR. They are imported in full, with the original source terms preserved, as the programme requires. They are stored in a dedicated table, excluded from general queries and search indexes, omitted from exports unless the export is specifically a demographic analysis by an authorised user, and never included in audit payloads in clear text. Every read of that table through the service layer writes an audit event. Analysis screens present aggregates and suppress small cells by default so that a filter cannot be used to single out an individual.

## 3. Authentication

Each person signs in as an individual. Shared passwords and shared accounts are not supported, and replication or laboratory teams work together through group workspaces in which every edit remains attributed to the individual who made it.

Sign-in is by a single-use link or code sent to the person's email address, with optional Google sign-in for accounts whose Google address has already been verified against the same person. Links and codes expire after a short period, can be used once and are stored only as hashes. Sessions are stored in the database, are bound to secure, HTTP-only cookies scoped to the portal, can be listed and revoked by the user, and are revoked by an administrator when a user is suspended.

Programme administrators and the core team must enrol a time-based one-time password as a second factor. Until the second factor is enrolled and verified in the current session, those accounts hold only ordinary member permissions, and administrative and demographic capabilities are withheld. Recovery uses single-use backup codes, and an administrator can reset a second factor for another user, which is audited.

## 4. Claiming a pre-populated profile

Profiles for existing members, laboratories and replications are created from the programme's sources before anyone is invited. A member takes ownership of their existing profile through the claim flow, which is designed to resist account enumeration and takeover.

The request form accepts an email address and always returns the same response, at the same speed, whatever the address. A sign-in link is sent only when the address is attached to a person record as a claim-eligible address, belongs to an existing user, or has a pending invitation. Nothing is sent to an unknown address, and no account is created until a link has been used. Requests are rate limited by address and by network origin.

After the link has been used, the member is shown the person record or records matched by that verified address, with their affiliations, laboratories and replications, and confirms that the record is theirs. A single unclaimed match is approved automatically and grants ordinary member access. Anything else goes to an administrator: an address attached to more than one person, a person who has already been claimed, or a member who reports that the match is wrong. A person can be linked to one user only, which prevents duplicate claims.

Roles that carry management powers are handled with more caution. When the imported data says a person leads a replication or coordinates a laboratory, the corresponding role is created in a pending state at the moment of the claim, and an administrator confirms it. This is deliberate. Several of the source spreadsheets can currently be read by anyone who has the link, so an email address found in them is sufficient evidence for ordinary membership and is insufficient evidence, on its own, for management rights.

Laboratory claiming is a separate request by a claimed member. The request records the evidence, such as an imported affiliation with the laboratory or a verified address in the institution's domain, and is approved by an administrator or by an existing authorised representative of that laboratory. A laboratory may have several authorised representatives.

## 5. Authorisation

Authorisation is enforced on the server in one place, the policy module, which every service function calls before reading or writing. The user interface hides what a user may not do, and that is a convenience. The decision is made by the server.

| Role | Scope | Summary of rights |
|---|---|---|
| Programme administrator | Programme | Full operational read and write, user and role management, imports, integrations, publishing approval, audit |
| Core team | Programme | Broad operational read and write. Sensitive operations (role management, demographic data, import rollback, credentials, publishing approval) are controlled by a capability matrix that administrators can adjust |
| Replication lead | One replication | Manages that replication, its participations, hypotheses, protocols, tasks and datasets, and may read contact details of its participants |
| Laboratory coordinator | One laboratory | Maintains the laboratory profile, equipment, members and the laboratory's participation and recruitment records |
| Laboratory member | One laboratory | Reads the laboratory and its participations, and submits recruitment updates where the coordinator allows |
| External collaborator | Explicit grants | Reads or edits only the pages and records shared with them |

Permissions are evaluated at programme, replication, laboratory, page, record and field level. Field-level rules implement the classification in section 2, so a laboratory member who can open a person's profile sees the member-class fields and does not receive the restricted or special-category fields in the response at all. Role changes, suspensions and revocations take effect on the next request and are audited.

## 6. Audit, logging and retention

Every state-changing operation writes an append-only audit event in the same database transaction as the change, recording who acted, what changed and the request context. The audit table rejects updates and deletes at the database level. Authentication events, permission changes, imports, synchronisation runs, exports and reads of special-category data are all audited. Application logs carry request identifiers and never contain secrets, tokens, email bodies or special-category values.

Retention periods, the lawful basis for holding demographic data, and the process for subject access and erasure requests are governance decisions for the programme. The portal provides the mechanisms: a per-person export of everything held about them, correction requests, archival, and an erasure procedure that removes personal fields while keeping the scientific record and audit trail intact. The periods themselves are recorded in this document once the programme has approved them.

## 7. Secrets, integrations and research data

Secrets are supplied through the hosting platform's encrypted environment variables and are never stored in the repository or in the database. The database stores only the name of a secret, for example the credential reference of a storage endpoint. Integration credentials follow least privilege: a Google service account that can reach only the files shared with it, a storage account with read-only listing rights for metadata scans, and a publishing token limited to opening pull requests on the website repository.

The portal is a registry of where EEG data is held. It records paths, manifests, checksums and status. It does not need raw recordings to pass through it, and metadata scans read file listings and checksums only. Storage paths and server details are restricted data, and views of them are recorded.

## 8. Transport and application hardening

All traffic is served over HTTPS behind the existing edge. The portal sets a strict Content Security Policy with nonces, `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, a restrictive `Permissions-Policy` and frame-ancestor protection. All input is validated with schemas at the API boundary, all database access uses parameterised queries through the ORM, uploads are size-limited and content-type checked, and authentication and claim endpoints are rate limited. Development-only conveniences, such as the development mailbox that shows sign-in emails, are compiled out or disabled outside development and test environments.

## 9. Backups and recovery

Production uses managed PostgreSQL with automated daily backups and point-in-time recovery. A scheduled logical backup is also taken so that a restore can be rehearsed outside the managed service. Restoration is tested before any production rollout and the result is recorded in `docs/TEST_REPORT.md`. Staging and production use separate databases and separate credentials, and staging never holds a copy of production personal data unless the administrators have approved it.

## 10. Findings from discovery that need a decision

These findings come from inspecting the sources during discovery. They are stated here so that the administrators can act on them. No setting on any external document has been changed.

**Several source spreadsheets are readable by anyone who has the link, without signing in.** Sources B (naming conventions), C (community vocabulary), D (list of studies), E (prediction-market hypotheses) and F (recruitment and contact workbook), and the five known contributor sheets, were all downloaded anonymously during discovery. Source F and the contributor sheets contain email addresses and correspondence about named researchers. Sources A (historical coordination workbook) and G (membership workbook, which holds gender and ethnicity) correctly refused anonymous access. The recommended action is to restrict F and the contributor sheets to named accounts, or to the portal's service account, once the import has been verified. For that reason this repository refers to the sources by letter and title only, and the identifiers and addresses of the documents are kept in private configuration.

**The website repository is public.** Everything committed here is world-readable. The portal's test fixtures are synthetic and labelled as such, and no real member data, source export or credential is committed.

**Staging is a single shared environment that any pull request redeploys.** The deployment workflow rebuilds and deploys the staging application on every pull request, using the application specification in the repository. A change to that specification would therefore alter the staging application as soon as a pull request is opened. The portal's deployment specification is delivered as a separate proposal file for review, and the existing specification and workflow are left unchanged until the administrators approve a rollout.
