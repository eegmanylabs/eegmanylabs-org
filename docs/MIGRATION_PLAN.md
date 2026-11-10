# #EEGManyLabs Hub: migration plan

This document sets out how the programme's existing sources are migrated into the members' portal. It follows the decisions in `docs/DECISIONS.md`, in particular D-005, D-008, D-009, D-012 and D-013. It names entities by their logical names (Replication, StudyAlias, Hypothesis and so on) and follows the identifier conventions of `docs/DATA_MODEL.md`, which says where each entity lives in Firestore. The inventory of every source, tab by tab, is in `docs/SOURCE_REGISTRY.md`. This plan states what the importers do with it.

Every count and structural fact below was read from this repository, from exports of the sources taken on 9 November 2026 during discovery or, for Quire, from its published documentation. A statement that rests on interpretation is marked as inferred, and anything that could not be established is stated as unknown. Discovery produced a report for each inspected source and for Quire, with B and C sharing one. The reports are held outside this repository because they quote file identifiers, and they are cited below, as the D report and so on, wherever they proposed different rules.

| Source | Title | Access on 9 November 2026 | Inspected |
|---|---|---|---|
| A | Historical replication coordination workbook, an Excel file held in Drive | Refused anonymous access | No |
| B | Naming conventions | Readable by anyone with the link | Yes |
| C | Community vocabulary | Readable by anyone with the link | Yes |
| D | List of studies | Readable by anyone with the link | Yes |
| E | Prediction-market hypotheses | Readable by anyone with the link | Yes |
| F | Recruitment and contact workbook | Readable by anyone with the link | Yes |
| Contributor sheets | Five known sheets, for AmodioJost2007, AmodioMaster2008, Boksem2006, BuschVanRullen2010 and DelCul2007 | Readable by anyone with the link | Yes |
| G | Membership and contributor workbook | Refused anonymous access | No |
| H | Public website data, four TSV files in `data/` | Public, in this repository | Yes |
| I | Quire | No export and no token | Published documentation only |
| J | Linked Drive, Docs and OSF documents | Reachability samples only | No |

## 1. Principles

Original values are preserved. Every cell is captured as it stands in the source before anything interprets it: the value, its stored type, the formula text and cached result, the link target, and the formatting that the source uses to carry meaning. A normalised or parsed value is stored beside the raw one and never in its place. The importer corrects no spelling, capitalisation or spacing, keeps a blank cell distinct from an empty string and from zero, and never replaces a cached value with one it has recomputed.

Identities are stable. The identifier of a replication is the programme's existing `StudyId` and is never renamed (D-013). Document identifiers are derived from natural keys, so the same source row always lands on the same document. Row numbers, column letters, tab positions and display order are provenance and form part of no key. A record that disappears from a source is kept and marked as no longer seen.

Historical snapshots are kept apart from live records. The sources differ in age and several are mixed within themselves: source D has no single date to which its rows refer, the summary numbers in source F carry no date at all, and two tabs of D are frozen records of earlier phases. Values of this kind are written as observations bound to their source record, such as a HistoricalAggregate, with the data origin `importedHistorical`. They never become recruitment reports (D-009) and never overwrite a value that came from a live source.

Conflicts are reviewed by people. When two sources, two tabs or two cells disagree, every value is kept with its source and a ReconciliationItem is raised. The importer chooses between them in no case, matches nothing on similarity of spelling, and merges no people, institutions or terms. A reviewer's decision is stored separately from the imported values and is applied again on every later import.

Nothing private enters the repository. This repository is public. It names the sources by letter and title only, and their file identifiers and addresses, the key used for keyed hashes and all credentials are held outside it. No export, no real row and no real name or address is committed, test fixtures are synthetic and say so, and no document identifier contains a name, an address or a file identifier.

Every run is repeatable and reversible. A run on an unchanged source writes nothing except its own batch record. Every run is previewed as a diff before anything is applied, every applied change is logged with its before and after state, and a batch can be rolled back from that log.

## 2. The pipeline

Each importer is a command-line tool that uses the Firebase Admin SDK and runs from an administrator's machine or a protected workflow, never from the public site (D-012). It refuses any project other than the emulator unless an explicit production flag is given. All importers share one framework with nine stages. The boundary that matters most lies between the snapshot, which records what the source said, and the stages after it, which interpret.

| Stage | What it does | What it writes | What stops the run |
|---|---|---|---|
| 1. Fetch | Obtains the source as a file and records its SHA-256, the retrieval time and the route by which it came. | Nothing | The source is absent from the registry, or the file cannot be obtained. |
| 2. Snapshot | Captures every row of every tab, cell by cell, and hashes it. | SourceRecord, restricted and immutable, created only when absent | A tab is missing, renamed or new where the source rule requires a fixed set of tabs. |
| 3. Parse | Finds the header of each tab, classifies each row and reads typed values under the rules of section 4. | Nothing | An expected header is missing or duplicated, or a structural rule of the source fails. |
| 4. Normalise | Produces trimmed, NFC-normalised and parsed copies beside the raw values. | Nothing | Nothing. An unparseable value becomes a candidate for the queue. |
| 5. Match identities | Resolves studies, people, institutions and tabs through the lookups of section 3. | Nothing | Nothing. An unresolved identity becomes a candidate for the queue. |
| 6. Preview | Compares the planned documents with the database and presents the diff. | ImportBatch in `preview` mode, with its plan | A blocking check of the source fails. The batch cannot then be applied. |
| 7. Apply | Writes the planned changes in chunks, each with its change-log entries. | Entities with their source references, ImportChange | A target document has changed since the preview. |
| 8. Reconcile | Raises the items found in stages 3 to 5, once each. | ReconciliationItem | Nothing. |
| 9. Verify | Runs the checks of section 8 against the result. | A verification report on the batch | A check fails. The batch stays unverified. |

A workbook is fetched in one of three ways. While a sheet is readable by anyone with the link, the importer downloads an anonymous XLSX export, which is how the snapshots of 9 November 2026 were taken. Once a Google service account exists, the importer reads the same content through the Sheets API as grid data with formatting, once for values and once for formulas, takes the modification time from the Drive API, and downloads source A, an Excel file held in Drive, as a file. The exports carry no document properties, so without the Drive API the time of the last edit is unknown. In every other case an administrator supplies an export, with its export date, to a restricted location outside the repository. CSV is never accepted for a workbook. It loses hyperlink targets, hidden-row and hidden-tab flags, validation lists, formulas, strike-through, fill colours, merged ranges, the difference between text dates and true dates, the boolean cell type and header notes, and each of these carries data in at least one source. Source H is read from the repository at a named commit. A source is imported only if the registry lists it, and the operator states the export date.

The snapshot stores, for each cell, the raw value, the stored type (string, number, boolean, date or formula), the formula text and cached value, the hyperlink target, and the attributes that a source uses as data: strike-through, fill colour resolved through the workbook theme, bold and italic where rows are told apart by font, the merged range, and the hidden state of the row, column and tab. Row numbers and cell addresses are stored as provenance. Header detection runs once and serves both this stage, which needs the key column in order to name each row, and the parse stage. Content that belongs to a tab and is no data row, such as a preamble, banner, footer, footnote or stray cell, is stored as an annotation record. Filler rows, such as the unticked checkbox rows of the contributor sheets, are counted by class and are not stored one by one. Source records are written during a preview as well as an apply, because they record what the source said on that date whether or not the batch goes ahead. They are restricted, their content never changes and a rollback does not remove them. The exports stamp every archive member with the export time, so two exports of an unchanged sheet are expected to differ in file hash (inferred, not tested). Change detection therefore rests on row hashes, and the file hash serves only to identify the file that was read.

Some parsing rules hold for every workbook. All tabs are enumerated, including hidden ones, and hidden rows and columns are read as data, with visibility recorded as provenance. The declared grid size is ignored in favour of the used range. Columns are located by header text, because the same field sits at different letters in different tabs and files, and the header is stored verbatim. An expected header that is missing or appears twice blocks the tab, a new or renamed header is reported, and a column that holds data under a blank header is never mapped by guesswork. The table definitions inside the XLSX are not used for headers, because they proved unreliable in source D and in one contributor sheet. Formula cells are read for both formula text and cached value, with shared formulas expanded. A number is accepted as an integer only when its stored value is integral, since the files store `8.0`, `1.0` and `2007.0`, and its raw form is kept.

Normalisation trims, collapses runs of whitespace and applies NFC. It serves matching, display and change detection only. Matching uses exact equality after the stated normalisation and the explicit lookups of section 3. Anything that needs judgement leaves stage 5 as a candidate for the queue with its evidence attached. Preview, apply and rollback are described in section 6.

## 3. Identity and identifier rules

### 3.1 Notation

Identifiers appear in URLs, logs and security-rule paths. A Firestore document identifier may not contain `/`, may not be `.` or `..`, may not match `__.*__` and is limited to 1,500 bytes, so a bare DOI or URL can never be an identifier. The data model joins the parts of a composite identifier with two underscores and replaces a part that is unsuited to an identifier by its SHA-256 hash. Where it calls an identifier opaque, a record created by an importer takes an identifier derived deterministically from the natural key of its source record, and the rules below supply those derivations.

| Term | Definition |
|---|---|
| `fold(s)` | Unicode NFKD, combining marks removed, lower-cased, only `[a-z0-9]` kept. `Müller2003` and `Muller2003` both give `muller2003`. Used for matching only. |
| `h(s)` | The first 20 hexadecimal characters of SHA-256 over the UTF-8 bytes of the NFC string. For inputs that are not personal. |
| `hk(s)` | The first 20 hexadecimal characters of HMAC-SHA-256 of the NFC string, keyed with a secret held in private import configuration. For an identifier that is built from a personal value, such as a name, an address or an ORCID iD, because a plain hash of such a value can be reversed by guessing. |
| `rowhash` | The first 12 hexadecimal characters of SHA-256 over the compact JSON of the row's raw cell records, with `null` for an empty cell. |
| Source key | The key of the source in the registry: the lower-case letter for a lettered source, and `ctable` + `__` + `h(file identifier)` for a contributor sheet. |
| Tab key | `h(exact tab title)`. For the single-tab sources B, C and the contributor sheets, the constant `t0`. For H, the file stem. |

The reports disagreed on the source key. Those for B, C, E and F built it from the file identifier itself, the D report from the file hash, and the contributor report from a hash of the file identifier. The last form is adopted for unlettered sources and the letter for the others, because D-012 keeps file identifiers out of anything that reaches a path or a log, and several of these files can be read by anyone who holds the identifier. A folded tab title is not used as a tab key, because two tab titles in source F fold to the same string, and the slug by which the data model names a tab entry of the registry has to keep those two titles apart as well. The data model writes "SHA-256 hash" without a length. The 20 characters of the reports are used here, and the shared identifier code has to fix one length for both documents.

### 3.2 The canonical study identifier and the folded lookup

The programme has 27 study identifiers. They are byte-identical in source B, in the `list of studies` tab of D, in the hidden `review` tab of E and in the figure file names of this repository. The website data holds 23 of them. All 27 match `^[A-Z][A-Za-z]+\d{4}$` and stay distinct after folding. The canonical identifier is the website `StudyId` where one exists. For the four studies that the website no longer lists (`Carretie2004`, `DonkersvanBoxtel2004`, `Frank2005` and `Hajcak2006`) it is the spelling shared by B, D, E, F and the figure files, which the website itself used before it removed them. A `StudyId` is an assigned, opaque key. It is never regenerated from authors and year, because the naming convention is not algorithmic, and it is never invented for a paper that has none.

Every source resolves a study through one routine. The raw string is kept, then normalised to NFC and trimmed. A cell that contains ` + ` names several studies: the row is stored with a combined scope, each part is resolved separately, and the row's numbers, lead and address are never split between the parts. Otherwise the importer looks up `fold(raw)` in the folded alias lookup, and an entry that lists exactly one replication resolves the study. A tab title and the display text of a link are labels. A tab title is resolved through a reviewed alias table keyed by the exact title, and a label through the identifier column of its own row. For tab titles the F report requires the reviewed table, while the H report would accept a canonical identifier followed by a known suffix once the DOI in the tab's study line confirms it. The reviewed table is adopted, and the pattern with DOI confirmation is used to propose an entry for a reviewer when a new tab appears. Anything else stays unresolved: no Replication is created, the raw value is kept and an `unmatchedIdentifier` item is raised. A Replication is created only by the H importer or from the `list of studies` tab of D, and a study that is absent from the current website is never deleted or archived automatically.

| Alias scheme | What it holds | Sources |
|---|---|---|
| `programme` | The programme identifier, flagged as canonical, and any other spelling of it written in an identifier column | B, D, E, F |
| `website` | The `StudyId` of the website data | H |
| `cloudAccount`, `bids`, `eegnet` | The three alternative naming schemes | B only |
| `sourceTab` | A tab title that names a study | F |
| `other` | The display text of a link that names a study, and a repository name on the data host that embeds the identifier | E, H |

The reports assigned spellings to schemes in different ways. The E report filed its identifier-column spellings under the tab scheme, and the H report proposed schemes of their own for link labels and for repository names. The table uses the schemes that the data model lists, and the last row falls under `other` until the model gains the two schemes that the H report proposed.

### 3.3 Document identifiers

Each entity has one rule. The last column gives the reason and records where the discovery reports, or the reports and the data model, differ.

| Entity | Document identifier | Reason and reconciliation |
|---|---|---|
| Replication | The canonical `StudyId` verbatim, for example `AmodioJost2007` | D-013. The same string is the website anchor, the figure file name and part of the data repository names, and it is safe for Firestore. The D and H reports proposed this form. The B, E and F reports used `fold(StudyId)`, which is kept as the lookup key in the next row. |
| Folded alias lookup | `fold(spelling)`, holding the list of replications that carry the spelling | One lookup resolves every spelling from any source. It holds a list because one BIDS name and one EEGNet name each belong to two replications. |
| StudyAlias | Scheme + `__` + `h(alias)`, beneath its replication | An alias is unique only together with its replication (D-013). The E and F reports proposed scheme and hash without the replication, which the B report showed to collide for those two names. The D report proposed the study identifier with a slug of the alias and no scheme, which collides where one string serves one study in two schemes, as `Luck1996` does. A spelling that resolves to no replication gets no alias until a reviewer resolves it. |
| DOI lookup | `doi` + `__` + `h(lower-cased DOI)`, an IntegrationMapping of the system `doi` that names the replication, candidate or manuscript | DOIs contain `/`, parentheses and upper-case letters. The E and H reports used the prefix `doi_` and the D report `pub_`. The model's mapping of external identifiers already has this shape. |
| CandidateStudy | `cand` + `__` + `h(lower-cased DOI)`. Without a DOI, `cand__t__` + `h(fold(first-author surname) + year + fold(title))`, flagged for review | A candidate paper has no programme identifier, and an invented one of the `SurnameYear` form would look official (H report). The D report treats a candidate as a Replication document, which the `selectionStatus` field of the data model also implies. The H report allows a Replication only for the 27 studies. The identifier above serves either placement, and the placement is put to the maintainers in section 11. |
| Hypothesis | `h` + two-digit `hypothesis_number`, beneath its replication, for example `h03` beneath `HajcakHolroyd2005` | The pair of study and number is the natural key and is unique on all 38 rows. The D report proposed a further Hypothesis per study for the effect of interest. Those columns are Replication fields in the data model and are stored there. |
| Person | `p` + `__` + `hk(first evidence key)`, assigned once and never changed | No single key identifies a person across sources: the two website files use different name-derived schemes, addresses change, and a name is no identity. The F, contributor and H reports specify an opaque identifier that is found again through lookups, and the data model does the same. Deriving it from the keyed hash of the first accepted evidence key makes it repeatable. The D report proposed a hash of the normalised name, which would create a person from a name alone and is rejected. |
| Identity key | The hash of a key string: `web_people:` or `web_members:` + website `PersonId`, `orcid:` + bare upper-case iD, `email:` + trimmed, lower-cased address, or `name:` + folded given name and surname + `@` + folded affiliation | A repeated import resolves through these keys to the same person, and the email index of the data model serves claim matching in the same way. The data model specifies a SHA-256 hash of the key. The F and contributor reports ask for a keyed hash. No client can read either collection, the importer and the claim function must share one implementation, and the choice is put to the maintainers in section 11. |
| Institution | `inst` + `__` + `h(fold(name) + "#" + ISO country code)`, created by a reviewer, with an identity key over the same string | The model makes an institution unique on normalised name and country (H report). |
| InstitutionCandidate | `instcand` + `__` + `h(fold(affiliation string))` | The review queue for affiliation strings, which the data model does not hold yet. The H report hashed the string as written and the contributor report its folded form. The folded form is adopted so that one string from two sources meets in one candidate, and each raw string stays on its Affiliation. |
| Laboratory | `lab` + `__` + `h(institution identifier + "#" + fold(laboratory name))`, created on confirmation, with an identity key over the same string | No inspected source has a laboratory column, so this rule is untested against data. |
| Participation | Replication identifier + `__` + laboratory identifier | D-008. No inspected source creates one. |
| ReplicationMembership | Person identifier + `__` + role, beneath its replication | The D, F and H reports agree apart from separators. |
| HistoricalAggregate | Metric key + `__` + source record identifier, beneath its replication | The form of the data model. A changed row is a new source record, so it adds new aggregates and the earlier ones stay. The F report proposed study, metric and snapshot date as the key, which is not adopted because the numbers carry no date. A row that names two studies has no single parent (4.6). |
| OutreachContact | `oc` + `__` + source key + `__` + tab key + `__` + `hk(fold(contact name cell))` + `__` + ordinal of that folded name within the tab | One per source row, with no row number and no readable name (F report). The source key is added so that a tab title that occurred in both A and F would stay apart. The pair of tab and folded name is unique on all 125 rows today, so the ordinal is 1 everywhere. |
| ContributorTable | `ctable` + `__` + `h(file identifier)` | One replication may have a sign-up table and a final table, so the replication cannot be the key (contributor report). |
| Contributor | `ctr` + `__` + `h(file identifier)` + `__` + `hk(name key)` + `__` + ordinal, where the name key joins the folded first name and the folded surname | The row number and the order value change whenever the author order changes, and the address and ORCID iD are missing on 46 of 117 rows and are added later. The middle name is left out because it varies between files. |
| VocabularyTerm | For the community vocabulary, the term's own `id` as written, for example `trm_001`. For a label from any other source, kind + `__` + `fold(raw value)`, or kind + `__` + `h(raw value)` when the folded value is empty or longer than 60 characters | The data model keys a community term by its original identifier. The C report added a prefix, which is not adopted. For other labels the E, F and H reports used the folded value, the D report a hyphenated slug and the contributor report a hyphenated key for the 14 role terms. The folded form is adopted throughout, and raw spellings that share a folded value form one term that lists each spelling. |
| DocumentLink | Owner identifier + `__` + slot where the source gives the link a named place, such as `signup`, `osf` or `pmInfosheet`. Owner identifier + `__link__` + `h(normalised URL)` for a link found in free text | With a slot, a corrected URL updates the same document (E and H reports). A link inside a note has no slot (D, F and contributor reports, which hashed the URL). |
| Manuscript | The website `PublicationId` verbatim at first import, never changed afterwards | Three publication identifiers were renamed in the website's history. A later rename becomes an alias after review, and every DOI ever seen gets a DOI lookup (H report). |
| SourceRecord | `h(source key, tab key, row key, rowhash)`, the four parts joined by a line feed | The data model makes a source record unique on source, tab, row key and content. The row key is the natural key of the row given in section 4, passed through `hk` when it is personal, and a hash of the row content with an ordinal for the frozen tabs that have no key. The B, C, E and F reports embedded the file identifier, the D report keyed raw rows by row number and the F report left out the content hash. None of these is adopted. |
| ImportBatch | `run` + `__` + UTC timestamp + `__` + the first 12 hexadecimal characters of the file SHA-256 | The form of the contributor report. A preview and an apply of one file are different batches. |
| ImportChange | Sequence number, beneath its batch | Ordered within the batch, which rollback needs. |
| ReconciliationItem | The fingerprint defined in section 7 | With the fingerprint as identifier, one item cannot be raised twice. |

Provenance is carried by the documents themselves, as the data model specifies: an imported document lists in `sourceRecordIds` every source record that created, updated or matched it, and `fieldSources` names the record that supplied each reconciled field.

This plan asks seven things of the data model, each explained where it arises: a secret key for `hk` and a ruling on the hash of identity keys, the InstitutionCandidate, a decision on where a CandidateStudy lives, two further alias schemes, a verbatim sibling for three numeric fields of the Replication (4.3), fourteen further kinds of reconciliation item (section 7), and the handling of `lastSeenBatchId` (section 6).

### 3.4 People

No Person is created from a name alone. A Person is created only when a source row carries at least one of three identifiers: a website `PersonId` from either website file, an email address that is exactly one address after trimming, or an ORCID iD that passes its ISO 7064 MOD 11-2 check digit. The first evidence key of a new person is the first of these that the row carries, in that order, and resolution of an incoming row follows the same order through the identity keys.

A name together with a matching affiliation is the fourth basis, and it links without creating. The reports for the contributor sheets and for H send every match that lacks an identifier to review. This plan admits the name-and-affiliation key under a narrow definition, so that it cannot merge on a name: a row that carries a name and an affiliation, and none of the three identifiers, is attached to an existing Person when its key equals a name-and-affiliation key of exactly one existing Person, that is when the folded given name, the folded surname and the folded affiliation string are all equal. A reviewer's mapping of two affiliation strings to one Institution adds the corresponding key. The row never creates a Person on this basis, the basis is recorded on the link, and names that differ by a middle initial, by spacing or by one letter do not qualify. Everything else is queued as a `duplicatePerson` item with its candidates. On the snapshot of 9 November 2026 the rows to which this basis could apply are among the 46 contributor rows that carry neither an address nor an ORCID iD. Of the 77 people in those sheets, 20 have neither in any sheet. The queue also receives the two pairs of probable duplicates between the two website files, and the three former study leads whom the Members file lists with middle initials that sources D and F omit.

Some sources create no Person even where a row carries an address. The outreach tabs of F hold people who mostly never joined the programme, so their rows stay OutreachContact records and are linked to a Person only when an existing identity key matches. Source D holds names only, in lead, extractor, reviewer and vote cells, and source E holds the author strings of published papers and one given name inside a status label. Neither creates a person. The summary tabs of F create none either: a lead named there is linked to a Person only when its address matches an existing identity key, and the website files hold no addresses, so on today's data no such lead resolves until a later source supplies addresses. Two existing Person documents are merged only by a reviewer's decision. An address or an ORCID iD that would attach to two people, and two different addresses for one person, raise an `ambiguousEmail` item and attach nothing. An address that is valid only when its characters are reversed is stored as a decoded candidate, flagged, and used for no matching until a reviewer confirms it.

The `slug` of a person from the website files is the website `PersonId`, which is already a public page anchor. The importer gives no name-derived slug to a person known only from a restricted source. An address read from a sheet that anyone with the link can read is sufficient evidence for an ordinary profile claim and insufficient for management rights. A role with management powers that the imported data implies starts in a pending state and is confirmed by an administrator (D-005). No importer grants a portal role.

### 3.5 Laboratories and institutions

No inspected source has a column for a laboratory, a principal investigator or an institution. What exists is free-text affiliation: 203 distinct strings in the two website files, of which a hand-maintained lookup in this repository maps every one to a city, and 65 distinct strings in the contributor sheets, with 11 pairs of near-duplicates. The outreach rows of F imply a laboratory through a person and name none.

An affiliation string is stored verbatim on an Affiliation with its slot and source. Each distinct folded string becomes an InstitutionCandidate. An Institution exists only once a reviewer has confirmed it, and the mapping from candidate to institution is a stored decision that later imports apply again. The importer never splits a string on commas, semicolons or `&`, never derives a country from the tail of a string and never turns an email domain into an institution, since a share of the addresses is on public webmail domains. Equality after folding is the only automatic grouping, and near-duplicates go to the queue as `institutionMatch` items. The `Country` column of the website files is taken as written and mapped to a country term through an explicit alias table that a maintainer can read, seeded with the one entry that the website's map script already uses, from `USA` to `United States`.

A Laboratory is created by a reviewer or through a confirmed laboratory claim, and never by an importer from the sources inspected so far. Whether the `affiliation` and `EEG_system` fields of source G allow more is unknown until G has been read. No inspected source creates a Participation. The study-level counts in F are aggregates, a vote in D is one person's expression of interest, and an accepting reply in an outreach tab is offered to a reviewer as a candidate.

## 4. Sources

The subsections follow the import order of section 5. Each gives the parsing rules, the entities and fields fed, what stays raw, and the situations that raise a reconciliation item, with the instances found on 9 November 2026. The kinds are defined in section 7.

### 4.1 H: public website data

The four files are read as UTF-8 with universal newline handling, and a trailing carriage return is stripped from the last field, because two of the files use or mix CRLF line endings. Line 1 is the header. The importer verifies the exact header list and refuses to import when a column is unknown, missing or reordered, because the first column is the key from which the public site is built. No file contains a double quote today, and if one appears the importer stops and reports. An empty cell means no value. A blank `DirectorRole` is read as false, since that column uses blank where the other role flags use `0`. `SignupUrl` holding the literal `done` is a status, stored raw. `PublicationYear` in the replications file is kept as text because two rows carry a letter suffix, and an integer year is derived beside it. The batch records the file hashes and the git commit. Earlier commits may be imported later as dated observations.

| File | Data rows | Row key | Feeds |
|---|---|---|---|
| `replications.tsv` | 23 | `fold(StudyId)` | Replication with its public fields (theme, the three stage cells, construct, sign-up), the original-study fields, the DOI lookup, a lead membership for the named lead, DocumentLink in the slots `signup` and `signupArchive`, an alias of scheme `website`, vocabulary terms |
| `publications.tsv` | 18 | `fold(PublicationId)` | Manuscript, of which 14 link to a replication, the DOI lookup, Dataset records for the 5 data addresses, DocumentLink in the slots `url`, `osf`, `code` and `pdf`, aliases for the repository names, vocabulary terms for status and journal |
| `people.tsv` | 46 | Website `PersonId` | Person with its identity key, public profile fields and role tags, Affiliation and InstitutionCandidate, lead memberships for the 29 rows that carry a lead flag |
| `members.tsv` | 300 | Website `PersonId`, the second column | Person with its identity key, Affiliation and InstitutionCandidate |

Every cell is kept verbatim in the source record, and everything in these files is public by origin. `SequenceNumber` in the Members file stays raw only and is never a key, because inserting one member renumbers every later row. The Members file has no study column, so a member is attached to no replication from this source.

A cell that names a lead is a lead claim: it says who is named, for which study and role, in which source cell. The data model stores conflicting leads as memberships marked `needsReview`. A membership needs a person, and most claims in D and F carry a name and nothing else, so the rule is applied as far as identity allows. The website's named lead resolves through the website `PersonId` and is written as a membership with the review status `confirmed`, because the programme has itself published it. Any other claim whose person resolves is written as a membership marked `needsReview`. A claim whose person does not resolve creates neither a membership nor a person. It stays in its source record and is a candidate of the queue item. Claims are compared by person where both resolve and otherwise by folded name string, and equal strings count as agreement between claims and link nothing. When claims for one study and role name different people or a further person, every membership concerned is marked `needsReview` and a `conflictingLead` item is raised. The F and H reports proposed a separate record per lead claim, from which only a reviewer writes a membership. The F report would write none before review, and the H report would let the importer write one wherever every source agrees, which holds for 13 studies. The confirmed website membership is where this plan goes beyond the F report, and section 11 puts it to the maintainers.

| Situation | On 9 November 2026 | Kind |
|---|---|---|
| The study-to-publication link disagrees between the two files | 4 studies: 2 point at a publication identifier that has no row, 2 are linked in one direction only | `valueConflict` |
| The people file marks a second lead whom the replications file does not name | 6 studies. Whether the person is a co-lead or the first author is unknown. | `conflictingLead` |
| Probable duplicate people between the two files | 2 pairs | `duplicatePerson` |
| A publication row whose identifier year, publication year and publication date disagree, or whose identifier is spelled differently from its own author string | 3 rows | `valueConflict` |
| A country spelling outside the alias table, or a member affiliation whose last part is no country | 1 alias in use, 17 rows | `vocabularyReview` |
| A sign-up address that is a form-editor link | 1 | `linkDefect` |
| Files with no record, and committed records with no source row | 6 files | `annotationReview` |
| A theme paired with an unexpected construct | 2 rows | `vocabularyReview` |

The README states 45 Core Team records and the file holds 46. The public total of 345 researchers is reproduced by 300 members plus 46 people minus the one pair that the map script merges.

### 4.2 B: naming conventions

The workbook has one tab, selected by position. The importer stops if there is more than one tab. Row 1 must contain seven headers, compared after trimming and with case preserved: `Original Name`, `Standardized Name - cloud accounts`, `Explanation`, `Part 1`, `Part 2`, `Standardized Name - BIDS` and `EEGnet name`. A column with an empty header must hold no data cell, and any cell found under one is an annotation. An annotation that begins with `*` is a footnote and applies to every cell of the tab whose value ends with `*`, whichever row it sits on. A data row has an `Original Name` that matches `^[A-Z][A-Za-z]+\d{4}$`. The workbook is imported as a whole or not at all.

The stored value of a name is authoritative. Of 69 formula cells, 60 carry no formula text of their own because they depend on shared formulas, so the reader expands these. A cached value that is missing, empty or an error token is flagged and never replaced by a recomputed one. For `Part 1`, `Part 2` and the BIDS name the importer stores whether the cell is a formula or a typed literal, with the formula text. The naming rules run as a lint that reports and corrects nothing: the formula results recomputed from `Original Name`, the shape and year of the cloud name, the first two tokens of `Explanation` against the cloud prefix, and the shapes of the BIDS and EEGNet names. No name is ever derived from a rule, since hand-typed exceptions make the rules wrong for 4 of the 27 studies. One trailing `*` is removed from a BIDS or EEGNet value to form the alias, the raw cell is kept, and case is preserved exactly.

The source feeds four StudyAlias documents per row, 108 in all with 106 distinct pairs of scheme and alias, and is the only source of the `cloudAccount`, `bids` and `eegnet` schemes. The cloud name is also offered as an intended account name whose existence is unverified. The row key is `fold(Original Name)`. The third token of `Explanation`, the component cells and the footnote stay raw, and the third token is not interpreted. An alias whose value changes produces a new document and the old one is marked as superseded. A row that disappears keeps its aliases, marked as missing from the source.

| Situation | On 9 November 2026 | Kind |
|---|---|---|
| One scheme and alias held by two replications | The BIDS name and the EEGNet name shared by the two Amodio replications, explained by the footnote that both were collected in one dataset | `aliasConfirmation` |
| `Original Name` matches no Replication | The 4 rows for the studies absent from the website data, until D has been applied | `unmatchedIdentifier` |
| A typed literal where the column otherwise holds a formula or follows the rule | 4 cells | `annotationReview` |
| A component formula that departs from the column's pattern | 2 cells, for `DelCul2007` | `annotationReview` |
| A cloud name that the token rule cannot produce, or an `Explanation` whose third token is no single capital letter | 1 and 1, both for `BuschVanRullen2010` | `annotationReview` |
| One string used in two schemes | `Luck1996`, as programme identifier and cloud name | `aliasConfirmation` |
| A duplicate within a scheme without footnote markers, a collision that differs only by case, an error value, a footnote without marked cells or marked cells without a footnote | None | `structureChange` |

### 4.3 D: list of studies

| Tab | Visibility | Header | Data rows | Row key | Treated as |
|---|---|---|---|---|---|
| `list of studies` | Visible | Rows 1 and 2 | 27 | `fold(StudyID)` | The current extraction. Stage and lead are observations bound to the source record. |
| `shortlist_archived` | Visible | Rows 1 and 2, with no header at all on the citation column | 29 | The DOI lookup key of the DOI in the citation | A historical observation of the extraction phase |
| `allranked_archived` | Visible | Rows 1 and 2, with `Votes count` in row 1 only | 139 | The DOI lookup key of the `DOI` column, or the title key for the 2 rows without a DOI | The nomination and voting record |
| `questionnaires` | Hidden | Row 1 banner, row 2 header | 12 | Content hash | Raw, with a cross-reference to the study where the text matches |
| `AlphaAsymmetry_RSSubproject` | Visible | Rows 1 and 2 | 6 | The DOI lookup key for 4 rows, the title key for 2 | Candidates of a separate subproject |
| `Sheet5` | Hidden | None | 17 | Content hash | Raw only. Its purpose is unknown. |

The effective header of a column is the row-2 text when that is non-blank after trimming, otherwise the row-1 text, otherwise none. A row-1 text above a column that has its own row-2 header is a group banner. Banner text does not sit in the first column of its group, so the extent of a group is never inferred from its position. The citation column has no usable header in two tabs and is identified by position and by content, a year in parentheses with a DOI. Headers are matched after trimming and collapsing whitespace, on the full text or a stable prefix, with the micro sign U+00B5 taken literally. Data ends at the last row that holds any non-blank cell. The 24 consecutive headers that match `^Group\d+$` are the group columns. Hidden columns are read: the keyword and group columns are hidden in two tabs, and a reader of visible columns only would lose them. The workbook holds 141 formulas, of which 139 are vote counters, and each is stored with its cached value.

A DOI is extracted with a pattern that respects balanced parentheses, keeps internal ones and strips a trailing full stop, comma, semicolon or unbalanced closing parenthesis. It is lower-cased for the key only. The order of preference is the citation text, the link target, the argument of a `HYPERLINK` formula, and the `DOI` column of the matching ranked row. Where a DOI is missing or does not match, titles are compared after folding, and a title match with a DOI mismatch goes to review with no link written. Keyword cells are split on commas only, because `/`, `+` and `-` occur inside terms.

The `list of studies` tab creates the four replications that H does not hold and feeds the following fields of all 27. Its extraction columns exist in no other source.

| Columns | Stored on the Replication as | Parsed value |
|---|---|---|
| `Study`, `Abstract` | `originalReference`, `originalDoi`, `abstract` | The DOI. A difference from H raises a conflict. |
| Effect of interest, plain-language description, statistics, standardised effect size, `BF10` | `effectOfInterest`, `plainLanguageDescription`, `originalStatistics`, `originalEffectSizeSource`, `originalBayesFactorSource` | None. Text only. |
| `original N`, required N, minimal number of channels, effect size converted to r | `originalN`, `powerBasedN` with `powerAssumptions`, `minEegChannels`, `originalEffectSizeValue` with the metric r, each with its raw text beside it | A number only when the cell is numeric or contains exactly one number |
| Duration, sample type, extra equipment | `durationSource`, `sampleType`, `extraEquipment` | For null-like tokens, one of `noneStated`, `unknownStated` or `empty` |
| Study type, outcome variable, construct, other descriptors | `studyType`, `outcome`, `psychConstruct`, and vocabulary terms | Terms split on commas |
| `Progress stage`, `Lead Replicating Lab`, sign-up link | The stage text stays in the source record as an observation. The lead is a lead claim. The link is compared with the DocumentLink from H. | A stage number only from the pattern `(stage N)` |

The data model lists `originalN`, `powerBasedN` and `minEegChannels` without a verbatim sibling. Each needs one, because many of these cells are text: 11, 24 and 25 of the 27.

The D report treats the website as ahead of this tab, on the evidence that the website stage is later for 16 of the 23 shared studies and never earlier. The H report found the tab ahead of the website's history on one lead and behind it on another, and concluded that neither can be called newer as a whole. Both findings stand. Stage and lead from D are therefore observations that never overwrite H, and a difference is reviewed field by field. A stage number also has no stable meaning over time, so a stage text from D is never mapped to a status automatically.

Several kinds of content stay in the source record only. The `Notes. Comments` column and the remarks embedded in value cells are restricted free text, and no person, date or decision is extracted from them. The names of data extractors and coding reviewers stay raw, including the 6 cells that hold several people. The 780 vote cells stay raw, with the cached vote count and the rank kept for the candidate. The D report proposed an OutreachContact per vote cell. That is not adopted, because a vote names a person only, 112 of the 139 ranked papers never became a replication, and an OutreachContact belongs to a replication. Until the placement of candidates is decided (section 11), the three candidate tabs are stored as source records and no candidate document is written. Cell colours are not imported as data, since the one documented colour meaning contradicts the stage in one of the two rows that carry it.

| Situation | On 9 November 2026 | Kind |
|---|---|---|
| The four studies absent from the website data | 2 rows with the stage `Currently put on hold` and 2 with `Looking for replicating labs (stage 3)` | `statusQuestion` |
| Free text in a numeric column | In `list of studies`: original N 11 of 27 cells, required N 24, channels 25, `BF10` 21, effect size 26, converted r 3. Duration is never numeric. | `unparsedValue` |
| Several experiments or effects in one cell | For example 4 cells of original N and 5 of statistics. No cell is split into several records. | `unparsedValue` |
| A value conflict between `list of studies` and `shortlist_archived` | At least 26 of the 27 shared studies differ in an extraction field. Required N differs in all 26 comparable rows. One item is raised per study and lists the fields. | `valueConflict` |
| A different lead in the two tabs | 3 studies. A further cell differs by a trailing space only, which is trimmed without an item. | `conflictingLead` |
| Keywords that conflict between tabs | `Luck1996`, whose keywords equal those of another study in two tabs, and `Vidal2000` | `valueConflict` |
| The year of one paper differs between tabs | `AmodioMaster2008`, cited with 2008 and with 2007. The D and H reports differ on which of the archived and hidden tabs carry 2007. | `valueConflict` |
| A DOI that is missing or does not match | 1 typing error in the ranked list, matched by title, and 4 rows without a DOI | `unmatchedIdentifier` |
| A stage outside the validation list, or a stage or type cell with an appended line | 5 cells with unlisted wording and 5 cells with an appended on-hold or exclusion line | `statusQuestion` |
| A study type other than the two listed values | 6 cells in the subproject tab | `vocabularyReview` |
| A `BF10` cell labelled as `BF01` | 1 cell | `unparsedValue` |
| A link defect | 1 form-editor address, 2 targets ending in a stray parenthesis, and addresses present as text only | `linkDefect` |
| Group cells under a banner about confirmed laboratories | 5 cells in each of two tabs, which repeat votes from the ranked list | `annotationReview` |

### 4.4 E: prediction-market hypotheses

The three tabs are addressed by exact name, and the preview fails if one is missing, renamed or new. In `links_hypotheses` row 1 must contain eleven headers in any order: `study_id`, `studyDescr_pdf`, `infosheet_link`, `hypothesis_number`, `hypothesis_text`, `null-sig`, `replicated`, `authors`, `year`, `title` and `citation`. The 20 trailing columns are empty, and the preview fails if one of them gains a value or a header. A data row has a `study_id` whose folded form matches `^[a-z]+[0-9]{4}[a-z]?$` and a numeric `hypothesis_number`. Data rows end at the first row that fails this test, and the validation ranges of the two status columns cross-check the extent. Any later non-blank row is a footer annotation, stored with its cell reference, raw value and formula. Footer counters are never parsed. One of them is formatted as a date, so a type-guessing reader would misread it, and the importer recomputes the counts from the data and reports a mismatch. Hidden rows are data: 6 of the 38 data rows are hidden, and a reader that skips them loses 6 hypotheses and 4 studies. The hidden state of every row is stored as a field.

In the hidden `review` tab the status column has no header. It is identified by a stored override, keyed to the tab and to the observed content, as the column between `study_id` and `notes` whose values all begin with `checked_`, and it is stored under the synthetic name `review_status` with a note that the header was blank. The override is validated again on every run. In `questions4MarketsNSurvey` headings, questions and answer options share one column and are told apart by position, blank rows and font. A row with text and no `Choices` value is classed by font only, bold for a section heading and italic for a group heading or open question, and the flags are stored.

`hypothesis_number` and `year` are accepted only when integral. `null-sig` is stored verbatim, and the string `null` is a real value that no layer may read as missing. `replicated` is kept verbatim and a blank stays absent. It is never mapped to a boolean, a blank never becomes `no`, and no value sets a hypothesis result, a review status above `unverified` or a replication status. The URL of a link is its hyperlink target. For the infosheet column the cell text is a label only and the address exists nowhere else. The DOI is taken from the link target of the citation and compared with the citation text. The preview blocks the apply unless the pair of folded study and number is unique, numbering starts at 1 without gaps within each study, the study-level values are identical on every row of a study, and the year equals the suffix of the identifier.

| Tab | Data rows | Row key | Feeds |
|---|---|---|---|
| `links_hypotheses` | 38, for 27 studies, with 5 footer cells in 3 rows | `fold(study_id)` + `__h` + number | Hypothesis; candidate values for the original-study fields of the Replication; aliases; three DocumentLink records per study and one for the programme, 82 in all; vocabulary terms including the validation lists |
| `review` | 27 | `fold(study_id)` | Source records only |
| `questions4MarketsNSurvey` | 34 | Hash of section heading and question text, with an ordinal for an exact repeat | PredictionMarketItem, with no link to a hypothesis |

The data model places `replicatedSource` on the Hypothesis, which every member can read. The E report asks that the label, the review status and the review notes never reach the public site without an explicit decision, and it observes that the survey of the prediction market asks participants whether they already know the results. Whether members should see the label before scientific review is therefore put in section 11, and until it is answered the importer leaves `replicatedSource` unset on production and the labels stay in the source records. The review status, which embeds a given name, and the review notes stay in the source records in any case. The link targets that are Google documents stay inside the portal and are not published until a maintainer confirms how they are shared.

| Situation | On 9 November 2026 | Kind |
|---|---|---|
| Any non-blank `replicated` value | 15 rows: `no` 7, `cancelled` 6, `yes` 2 | `unverifiedLabel` |
| `yes` or `no` on a hypothesis marked `null`, where the meaning is undefined | 2 rows | `unverifiedLabel` |
| `replicated` filled while the public stage of the study is not finished | 3 studies | `valueConflict` |
| Hidden rows, the label `cancelled`, and absence from the website data | 6 rows, exactly the hidden ones, for the same 4 studies | `statusQuestion` |
| A hidden row without `cancelled`, or `cancelled` on a visible row | None | `formattingSignal` |
| An identifier spelled differently from the canonical form | 1, with a diacritic | `aliasConfirmation` |
| A link label that differs from the identifier of its row | 6 rows: 2 misspelled labels on 5 rows, and the diacritic row | `aliasConfirmation` |
| An original-study field that differs from another source | 1 title, and the year of 2 studies, which the website writes with a letter suffix | `valueConflict` |
| A value outside a validation list, or a new list option | None | `vocabularyReview` |
| A status label that embeds a person's given name | 27 rows, 1 distinct value | `privacyReview` |
| A general note stored on one study's row | 1 of the 2 note cells | `annotationReview` |
| A repeated question text | 1 pair | `annotationReview` |
| A footer counter that disagrees with the recomputed count | None | `annotationReview` |

### 4.5 C: community vocabulary

The workbook has one tab, selected by position, and the importer stops if there is more than one. The external tool chain whose curation format the sheet follows reads the first tab of such sheets in the same way. Whether this sheet is registered with that tool chain is unknown. Row 1 is compared after trimming and lower-casing. `id`, `name`, `abbreviation` and `description` are required, `invalid_reason` and `same_as` are optional, and an unknown extra column is imported as a raw extra with a warning. A data row has a non-empty `id`. The whole used range is read, since 984 pre-formatted empty rows follow the data. An `id` must match `^[A-Za-z0-9_-]+$`, must not both begin and end with two underscores, and must be unique both exactly and without regard to case. A failure stops the import, because the sheet's own validation rule has then been bypassed.

The source feeds 26 VocabularyTerm documents, keyed by the `id` as written and never by name, abbreviation or row. The `name` is split at the first ` - ` into a category and a label, and the two categories present are `Participant` on 17 rows and `Meta` on 9. An empty `invalid_reason` means the term is valid. Any other value marks the term as deprecated, keeps the raw text, hides the term from selection lists and keeps the document and every reference to it. `same_as` is parsed as a prefix and a code, accepted for the prefix `snomed` with a code of 6 to 18 digits and a correct Verhoeff check digit, and stored verbatim. It is never resolved to a local term, and no label is fetched as source data. Terms are never merged because they share a target, a name or an abbreviation. Row order is stored as a display position. The inferred finer kind of a term and any hint about its value type are stored as suggestions for review. No value is corrected, including the one misspelled abbreviation. A term that disappears from the sheet is kept and marked as missing, and is not treated as deprecated.

| Situation | On 9 November 2026 | Kind |
|---|---|---|
| The first occurrence of each distinct `invalid_reason` value | None. The column is empty on all 26 rows. | `vocabularyReview` |
| A `same_as` value of another shape, with a failing check digit, or that looks like a local identifier | None | `vocabularyReview` |
| One `same_as` target shared by several terms, or a mapping whose precision is inexact | 2 targets shared by 2 terms each. 9 references to 7 concepts in all. | `vocabularyReview` |
| A code from a national extension | 1 | `vocabularyReview` |
| A suspected misspelling or stray whitespace, to be reported to the sheet owner | 1 abbreviation and 1 description | `annotationReview` |
| An identifier whose category changes, or whose name and abbreviation both change in one import | None | `valueConflict` |
| A valid identifier that departs from the pattern `trm_` plus three digits | None. Such a term is imported with a warning. | `vocabularyReview` |
| A term that has vanished from the sheet | None | `missingFromSource` |
| A proposed link between a term and questionnaire text in D | None raised yet. Links are proposed and never made automatically. | `vocabularyReview` |

### 4.6 F: recruitment and contact workbook

The export holds 23 tabs: 2 summary tabs and 21 outreach tabs. Discovery had expected 25, and the difference is unexplained. The preview fails if a tab is missing, renamed or new.

In `numberOfLabsPerReplication` row 1 must contain `StudyID`, `Leader`, `NLabsSigned`, `TotalNSubjectsToBeRun`, `NLabsFinished`, `TotalNMainExpCollected` and `TotalNRest`. Study rows run from row 2 to the first blank `StudyID`: 26 rows that stand for 27 identifiers, because one cell names both Amodio studies. The rows below, labelled as a total, a median and a projection, are derived and are never imported as data. Their formulas are recomputed and a difference from the cached value is reported. The columns without a header in row 1 hold a programme timeline of 22 entries and one note. They are stored verbatim as restricted annotations, and the counts inside them are not parsed. A number is accepted only from a numeric cell with an integral value. A blank cell is stored as absent and never as 0, and an explicit 0 is stored as 0: the tab has exactly one explicit zero among 67 blank numeric cells. The main-experiment and resting-state counts are separate metrics and are never added. Strike-through on a `StudyID` or `Leader` cell is stored as a boolean and changes no status.

The numbers carry no date. The data model lets the snapshot date of an aggregate be absent for that reason, and the F report proposed to stamp each value with the export date. The model is followed: the snapshot date stays absent, and the export date that the operator supplies is recorded on the batch and the source record as the day on which the value was observed. An aggregate is stored beneath one replication. The combined Amodio row names two, so its five values are written beneath neither. They stay in the source record and in the queue item until a maintainer says which study or studies they describe.

In `leadsEmails` row 1 must contain `StudyID`, `Old leader`, `Leader` and `Email`. A `Leader` cell that holds two names separated by a comma gives two claims marked as co-lead candidates. A value in the unheaded column after `Email` is stored as an additional address and paired with the second name as a suggestion only.

Any other tab is an outreach tab only if, within rows 1 to 10, it has a row whose first six cells, trimmed and case-folded, read `contact name`, `contact email`, `date email sent first time`, `date follow-up email sent`, `result` and `notes`. Today that is row 3 in 8 tabs and row 4 in 13. A tab with no such row goes to review and is not imported. Each non-blank cell in the first column above the header is classed by its prefix: `Lead Replicating Lab:` gives a lead claim, `A search of Lead Replicating Lab` and `A search of Replicating Labs` give the purpose, with any text after the second prefix kept as a scope remark, and `Study:` gives the study line. Rich text is flattened. Without a title line the purpose is taken from the tab title only when it contains `replicating labs` or ends in ` lead`, and is otherwise unknown. The tab colour is stored and decides nothing. The study comes from the reviewed alias table. As a cross-check, a DOI in the study line is compared, lower-cased, with the original-study DOI of the replication. A mismatch blocks the tab, and a missing DOI, in 4 tabs, is informational.

Every row below the header is read to the end of the used range, since blank rows occur inside the data of 5 tabs. The first cell is classed before the row counts as a contact. A cell that ends with `:` in a row with no other value is a section label for the rows below it. A cell with two or more addresses or a line break is a recipient list. A cell of more than 5 words or 60 characters without an address is a free-text annotation. Everything else is a contact row. A name is kept verbatim, marked tentative when it ends with `?`, and split into people on `;` only. A merged range is unmerged, its value goes to the anchor cell, the range is stored and the lower row is linked to the upper one. A value in a column beyond `notes` is stored as an extra cell.

An address is kept raw and is trimmed and lower-cased for matching only. A pasted recipient list is never expanded. Dates are accepted as text in the forms `dd.mm.yy` and `dd.mm.yyyy`, day first, and as true date cells, and are stored raw, as an ISO date and with the kind of source. No date is parsed out of `result` or `notes`. A `result` is stored verbatim and looked up, trimmed and case-folded, in the vocabulary of outreach results, whose normalised statuses are proposals awaiting confirmation. No result creates a participation, a membership or an invitation. Fill colour is resolved through the workbook theme and bucketed as red, green, none or other, with the raw colour of the name and result cells stored. A note is stored verbatim. Its URLs become restricted links, the hyperlink target is preferred over the text, and a normalised URL is stored without the `casa_token`, `login` and `via` parameters and without a trailing `#`.

| Tab group | Data rows | Row key | Feeds |
|---|---|---|---|
| `numberOfLabsPerReplication` | 26 study rows, 3 derived rows, a timeline of 22 entries and 1 note | `fold(StudyID cell)` | HistoricalAggregate with the metric keys `nLabsSigned`, `totalNToBeRun`, `nLabsFinished`, `totalNMainCollected` and `totalNRest`: 58 of the 63 values at first import, the other 5 being those of the combined row. Lead claims from 25 cells. |
| `leadsEmails` | 26 | `fold(StudyID cell)` | Lead claims: 27 names in the 26 `Leader` cells and 4 former leads. The addresses stay in the source record until the person resolves. |
| 21 outreach tabs | 125 | `hk(fold(contact name cell))` with an ordinal | OutreachContact for the 119 contact rows, annotations for the other 6, lead claims from the 14 lead lines, aliases of scheme `sourceTab` for the resolved tab titles, restricted DocumentLink records, vocabulary terms |

Everything from the outreach tabs is restricted: names, addresses, dates, results, notes, colours and links. Copies of one contact across sibling tabs share a group key and are never merged, and 27 rows are exact copies of a row in a sibling tab. The F report counts 15 studies with an outreach tab and the H report 14. The difference is the tab `AmodioMaster20072008`, which the F report counts towards a study and the H report leaves unresolved.

| Situation | On 9 November 2026 | Kind |
|---|---|---|
| The combined Amodio rows | 1 row in each summary tab. Its numbers, lead and address are never apportioned between the two studies. | `unmatchedIdentifier` |
| An identifier or tab title that resolves to nothing | `AmodioMaster2007`, which occurs in no other source, and the tab `AmodioMaster20072008` | `unmatchedIdentifier` |
| A study line that contradicts its tab | `Vidal2000_`, whose study line names another study | `aliasConfirmation` |
| `Old leader` filled | 4 rows, all struck through, each naming a different person from `Leader` | `conflictingLead` |
| The two summary tabs name different leads | 3 rows: a different person, one name against two, and blank against filled | `conflictingLead` |
| A lead line that names someone other than the current `Leader` | 2 tabs of 14 | `conflictingLead` |
| A lead that differs from the one held from H | 2 studies | `conflictingLead` |
| Strike-through on a study row, also where a lead is still listed for it | 4 rows, for the four studies absent from the website data. These are exactly the rows without sign-up numbers. | `statusQuestion` |
| Struck rows and rows without sign-up numbers no longer coincide | None | `formattingSignal` |
| A fill colour with no result text, or a colour that contradicts the text | 1 row, and none | `formattingSignal` |
| An accepting result | 6 rows, and the 1 row marked by colour alone | `candidateLink` |
| A result outside the vocabulary, or a long narrative | 11 distinct values in 15 cells | `vocabularyReview` |
| One person with different content in two tabs, and lead-search rows copied into a lab-search tab | 4 people, and 12 rows | `valueConflict` |
| Labs finished exceed labs signed | 2 rows | `valueConflict` |
| A blank resting-state count where the main count exists | 2 rows | `unparsedValue` |
| Free text or a fraction in a numeric column | None | `unparsedValue` |
| Several people in one cell, a tentative name, a name in the form of an address | 4, 5 and 1 cells | `unparsedValue` |
| A true date whose day is 12 or less, or a follow-up before the first contact | 2 cells, and 1 row | `unparsedValue` |
| A reversed address, or a suspected truncated one | 4 cells with 2 distinct addresses, and 1 cell that no rule can detect | `identifierDefect` |
| A quoted private email, a pasted recipient list, a candid remark in a stray column, timeline entries that name individuals | 1, 1, 1 and 5 cells | `privacyReview` |
| A tab with no stated purpose, non-contact text in the name column, a stale projection formula | 1 tab, 6 cells, 1 cell | `annotationReview` |
| A URL that carries an access token or session parameters | 3 links | `linkDefect` |

### 4.7 Contributor sheets

Each of the five sheets has one tab and names no study anywhere inside the file. The replication comes from the registry, and a sheet whose file identifier is not registered is refused. The mapping used so far was supplied with the build request and is corroborated only by the presence of each publicly listed lead in the mapped sheet. The requirements place the authoritative mapping in source G, which has not been seen.

Row 1 is the header and must contain `Firstname`, `Surname` and all 14 CRediT role headers. For matching only, a header is trimmed, its inner whitespace collapsed, case-folded, and an en dash or em dash treated as a hyphen. Whole headers are matched, so `Funding acquisition`, `Funding` and `Funding 2` are three columns. `Primary affiliation` and `Secondary affiliation` are accepted as `Affiliation 1` and `Affiliation 2`, and any `Affiliation N` keeps N as its slot. Column order and the set of columns differ in every file. A column with data under a blank header is kept as unmapped raw cells and raises an item. A maintainer may then store an override for that sheet, keyed to the sheet and to the observed type of content, which is validated again on every run. A header that does not fit its content is never remapped automatically. It is found by content sniffing: when a column that is mapped to neither field consists only of ORCID iDs or only of addresses, or when an address or ORCID column holds anything else, an item names the header. The 14 header notes are compared with the stored role definitions, and a changed note is reported.

Every row of the used range is evaluated. The count of non-empty rows is meaningless here, because checkbox columns hold a stored `FALSE` in every row of a table left at its default length.

| Row class | Test, on trimmed values | Handling | On 9 November 2026 |
|---|---|---|---|
| Contributor | First name and surname both present | Imported | 117 rows: 37, 34, 21, 14 and 11 |
| Half-named | Exactly one of the two present | Review, no import | None |
| Placeholder | No name, and a value that is no boolean | Table annotation and review | 2 rows that hold an order number only |
| Stray tick | No name, no other data, at least one `TRUE` | Review | None |
| Filler | No name and nothing except `FALSE` | Skipped and counted | 1,968 rows |
| Blank | Nothing | Skipped and counted | 27 rows |

A checkbox is read from a stored boolean or from the exact strings `TRUE` and `FALSE`, and its verbatim value is kept per role. A blank cell in a contributor row is read as unknown and never as false, and any other value is kept verbatim, read as unknown and reviewed. An unticked role is shown as not ticked in the source, never as a statement that the person did not contribute, and a tick in the agreement column is kept as evidence from the sheet, while consent given in the portal is recorded separately. The order in publication is an integer when the cell holds an integral number. The keywords `alphabetical` and `last` are stored as an order rule with no order number, and a blank stays absent. Order is never derived from row position and is never renumbered. The three name cells are stored verbatim and are never split, merged or re-cased. An ORCID iD is accepted bare or as an address on `orcid.org`, and one that fails its check digit is stored verbatim and used for no matching. Each affiliation slot holds one raw string that is never split. The address and the funding statement go to the restricted contact document of the contributor, and an unmapped cell stays in the source record.

The sheets feed five ContributorTable documents and 117 Contributor documents. A person who appears in two sheets has two Contributor documents, because roles, order and affiliation differ per manuscript. By folded name the 117 rows are 77 people, of whom 57 have an address in some sheet, 26 an ORCID iD and 20 neither. The 65 distinct affiliation strings become institution candidates. The role headers and their notes seed the vocabulary of CRediT roles. A contributor row grants no portal role, no replication membership and no access. If one name key occurs twice in a sheet, neither row is imported.

The data model makes a Contributor readable by every member. The contributor report asks that names, order, roles and affiliations of an unpublished manuscript be shown to the replication team and the coordinators only, until a maintainer marks the table as published. Section 11 puts the question, and until it is answered the contributor sheets are previewed and are not applied on production.

| Situation | On 9 November 2026 | Kind |
|---|---|---|
| Blank headers over data | 2 columns in one sheet: one holds the integers 1 to 34 and is probably the order, the other holds `FALSE` in every row and its meaning is unknown | `structureChange` |
| A header that does not fit its content | 1 column headed `Funding 2` that holds only ORCID iDs, in a sheet with no ORCID header | `structureChange` |
| More than one tab, a renamed tab, or a header that is new, missing or renamed since the last run | None | `structureChange` |
| Free text in the order column, or contributor rows without an order | 2 keyword cells and 7 rows, in one sheet | `unparsedValue` |
| A blank checkbox in a contributor row, or a contributor row with no role ticked | 1 cell, and 4 rows in one sheet | `unparsedValue` |
| A semicolon inside an affiliation cell | 1 | `unparsedValue` |
| An ORCID iD that fails its check digit, or an address with a non-ASCII letter | 1 and 1 | `identifierDefect` |
| No corresponding author flagged, or two flagged | 1 sheet and 1 sheet | `valueConflict` |
| A whole-row highlight outside the template colours | 1 row | `formattingSignal` |
| A link from a contributor to a person that would rest on a name | 20 people | `duplicatePerson` |
| A probable variant of one first name between two sheets | 1 pair | `duplicatePerson` |
| One person with different addresses in two sheets | 2 people | `ambiguousEmail` |
| An affiliation string to be mapped to an institution | 65 strings, 11 near-duplicate pairs, and 16 people whose first affiliation differs between sheets | `institutionMatch` |
| Whether a sheet is a sign-up table or a final list, whether it is published, and which manuscript it belongs to | 5 sheets | `statusQuestion` |
| A row that disappears while one with the same address, ORCID iD, or surname and first initial appears | Not applicable on a first import | `missingFromSource` |

### 4.8 G: membership and contributor workbook

Nothing is known about this workbook beyond the names in the requirements: the tabs `list_members`, `study_description` and `contibutor_tables`, with that spelling, the member fields `name`, `surname`, `email`, `secondary_email`, `affiliation`, `country`, `EEG_system`, `gender`, `ethnicity`, `whichReplication (Tags)` and `isCoauthor`, and the contributor-table fields `ReplicationID`, `TableLink`, `IsOnlySignUpTable`, `IsPublished`, `PubLink` and `PDFLink`. Header rows, hidden tabs, row counts and value vocabularies are unknown. The planned targets follow from those names. A member row feeds a Person, the restricted contact document for the addresses, the special-category demographics document for gender and ethnicity with the source terms verbatim, an Affiliation with its institution candidate, and the equipment text as a raw value. The replication tags become membership candidates for review. The contributor-table tab confirms or corrects the registry of contributor sheets and may reveal further sheets. The first real run is a preview, and every difference from the expected headers is a `structureChange` that blocks the tab.

### 4.9 A: historical replication coordination workbook

The requirements describe an Excel file held in Drive that covers study leads, laboratory outreach and historical recruitment, with the summary fields `StudyID`, `Leader`, `NLabsSigned`, `TotalNSubjectsToBeRun`, `NLabsFinished`, `TotalNMainExpCollected` and `TotalNRest`. These are the seven headers of the summary tab of F. Whether A is an earlier copy of F, and what else it holds, is unknown. The summary and outreach parsers of 4.6 recognise a tab by its headers and take the source key as a parameter, so A can use them unchanged if its tabs match. Its values are stored as a separate historical snapshot bound to its own source records and are compared with F in the queue, never merged with it.

### 4.10 I: Quire

Nothing has been verified against a real Quire workspace. The published documentation gives the migration its shape. A local pull through the API, run by an organisation administrator, produces one snapshot bundle, the JSON and CSV exports are archived unchanged beside it as the provenance record, and an idempotent import follows. The documented API record shapes are the contract, because the field names inside an exported task are undocumented. A task or comment created by the import takes an identifier derived from a hash of its Quire object identifier, and an IntegrationMapping of the system `quire` records the pair. The integer task number, which is unique only within its project, is kept with the project identifier as the legacy identifier, together with the source URL and the raw record. References are resolved by object identifier only. Every run produces a missing-fields report. The documentation already shows that the activity history, earlier values of any field, deleted tasks and comments, member roles and the content of attachments by any documented route cannot be recovered, and that a colleague's address is returned only when contact access has been granted, which bears on linking assignees to people. The plan of the programme's Quire organisation is unknown, and it decides whether the export endpoints, subtree listing and dependencies are available at all. An assignee is linked to a Person through the email identity key and is otherwise queued.

### 4.11 J: linked documents

Each importer writes a DocumentLink for every link it meets, with the address as written, the cell text and the link target where they differ. No linked content has been read. Discovery sampled one address per host from source E, 3 of its 82 distinct targets. The sample showed that the OSF page host answers 200 for any path of the right shape, so OSF links must be checked through the OSF API host, that the sampled Google document was readable without sign-in, and that the sampled DOI resolved. Whether an anonymous visitor can also edit the linked Google documents was not tested, and the stored addresses are edit links. A link check is a separate pass after each import. It sends status-only requests, discards content, and records the access status, the HTTP status and the time. Documents behind Google sign-in need the Drive access that is still missing. Content that cannot be reached is never fabricated.

## 5. Import order

| Step | Source | Why at this point |
|---|---|---|
| 1 | H: public website data | Public by origin, with a git history that dates its changes. The H report calls it the only source maintained into 2026, which the F and E reports contradict: the summary tab of F carries timeline entries up to October 2026 and E a footer dated August 2026. It creates 23 of the 27 replications under their canonical identifiers, the 346 people who carry a website identifier, and the DOI of each original study, against which later sources are checked. Everything after it is compared with this baseline. |
| 2 | B: naming conventions | Loads every programme spelling and the three alias schemes before any source with variant spellings is read. Its rows for the four studies that H no longer lists wait for step 3. |
| 3 | D: list of studies | Creates the four remaining replications and adds the extraction data, which exists in no other source. B is then run a second time and completes its aliases, from 92 to 108. |
| 4 | E: prediction-market hypotheses | Needs all 27 replications and the folded lookup, since one identifier carries a diacritic. Its original-study fields are compared with H and D. |
| 5 | C: community vocabulary | Depends on nothing, and nothing depends on it at import time. It follows the study-level sources so that questionnaire text from D is present when a curator begins to propose links to terms. |
| 6 | F: recruitment and contact workbook | Needs the replications, the DOIs for the tab cross-check, the reviewed tab alias table and the website people. Its lead and status signals are compared with H, D and E. |
| 7 | Contributor sheets | Need the registry entry that names each sheet's replication, and the people from H as link targets. The website files hold neither addresses nor ORCID iDs, so a contributor row meets a person from H only through the name-and-affiliation rule of 3.4 or in the queue. |
| 8 | G: membership and contributor workbook | When access exists. According to the requirements it holds the list of contributor tables, the member contact details and the special-category data. The contributor sheets and F are run again afterwards, against the confirmed registry and any addresses that G brings. |
| 9 | A: historical replication coordination workbook | When access exists. It is read as a further historical snapshot and compared with F, which must therefore be present. |
| 10 | I: Quire | When an export or a token exists. Task assignees are linked to people, and the set of people is expected to be most complete after G. |

The link checks of J run after each step over the DocumentLink records that the step created. The order moves broadly from public to restricted and from reference data to personal data, so that the registry of studies, the lookups and the queue are proven on low-risk sources before any restricted row is written. The second run of B in step 3 and the repeated runs in step 8 are planned, and they are the first proof of idempotency on real data.

## 6. Idempotency, preview and rollback on Firestore

Idempotency rests on three mechanisms. Document identifiers are deterministic, so a row maps to the same documents on every run. A source record is created only when its identifier, which covers the row hash, does not yet exist, so an unchanged row writes nothing and a changed row adds a record while the earlier one is kept. Each imported entity carries a content hash over the fields the import owns, and the importer writes the entity only when that hash changes.

The data model gives a source record a `lastSeenBatchId` that advances with each import. Advancing it on every record at every run would rewrite the whole snapshot each time and defeat the requirement that a second run writes nothing. In this plan the batch keeps a manifest of the source records it saw, and `lastSeenBatchId` is written at the three moments when presence changes: when the record is created, when its row is first missing from a snapshot, at which point it names the last batch that saw the row, and when the row reappears.

Imported values and values edited in the portal are kept distinguishable. Each imported entity keeps the last imported value of every field the import owns beside the live value. On a later import, a field whose live value still equals the last imported value follows the source. A field that has since been edited in the portal keeps its live value, the new source value is recorded beside it, and the preview shows the difference. Reviewers' decisions, such as a person match, an institution mapping, a column override or a tab alias, are stored apart from imported values and survive every re-import.

A preview computes the full plan and stores it with an ImportBatch in `preview` mode: every create and update with field-level before and after values, the count of unchanged rows, the records no longer seen, the items that would be raised and the result of every blocking check. Blocking is scoped by source rule. Sources B and C import as a whole or not at all, a failed check in E blocks its apply, a contributor sheet with a structural change blocks only itself, and an outreach tab of F with a DOI mismatch blocks only that tab. A plan that contains restricted values is readable only by those who may run an import.

An apply is a second batch that carries out one previewed batch whose source manifest is unchanged. It writes in chunks. Each chunk is one batched write that carries the entity changes together with their ImportChange entries, so no change exists without its log entry. Each planned write records the content hash of the document it expects to find, and when a document has changed since the preview the chunk is not written and the batch stops for a new preview. A batch that fails part-way is marked `failed` with the last committed sequence number, and running it again resumes from there. An ImportChange holds the document path, the operation, and the complete state of the imported fields before and after. For a special-category document the entry holds a marker and a hash, and the two states are kept where no client can read them. Import writes are also captured by the audit triggers of D-007, with the importer as the actor. The change log exists beside the audit trail because rollback needs complete states, which the audit trail deliberately omits for configured fields.

A rollback is carried out by the callable function that the data model assigns to it, and is logged as a batch of its own. It walks the ImportChange entries of the target batch in reverse order. Where the current content hash of a document equals the logged after state, it restores the before state, or removes the document if the batch created it. Where the document has changed since, it leaves the document alone and raises an item. Source records are not removed, because they remain true statements of what the source said. Open reconciliation items raised by the batch are closed as withdrawn, and items that a reviewer has already resolved are reported and left in place. The target batch ends in the state `rolledBack`.

| Run | What it must show |
|---|---|
| A second run on the same file | No new source record, no entity created or updated, no ImportChange entry, no new reconciliation item. One write: the batch record. |
| A run on a fresh export of an unchanged source | The same, even where the file hash differs. |
| A run after one cell has changed | One new source record for that row. Changes only on entities linked to that row, each with before and after values. The earlier source record is kept. |
| A run after one row has been removed | Nothing deleted. The linked records are marked as no longer seen and a `missingFromSource` item is raised. |
| A run after one natural key has been renamed | One record no longer seen and one new record, presented together as a probable rename when the other cells are equal. |
| A rollback followed by a new apply | The state after the first apply, document for document. |

## 7. The reconciliation queue

A ReconciliationItem carries its kind, the entity or source key it concerns, the candidates with a reference to the source record behind each, a status and, once decided, the resolution, the reviewer and the time. The data model lists six kinds. Discovery found situations that need the fourteen further kinds below, which the shared schema has to take up. The queue is open to programme administrators, and to the core team where the capability matrix allows. In the last column A stands for a programme administrator and C for a core-team member who holds the capability. These are proposed defaults.

| Kind | Raised when | Resolved by |
|---|---|---|
| `unmatchedIdentifier` | A study identifier, tab title or DOI resolves to nothing, to several studies, or only by a title match | A, C |
| `aliasConfirmation` | A spelling, link label or study line differs from the canonical identifier, or one alias is shared by two replications | A, C |
| `conflictingLead` | Two lead claims for one study and role differ, a former lead is recorded, or a second lead is named | A |
| `valueConflict` | Two sources, two tabs or two cells give different values for one field, or numbers within one source are inconsistent | A, C |
| `statusQuestion` | A source signals a change of status of a replication, candidate or table: strike-through, hidden rows, a `cancelled` label, an on-hold or exclusion line, absence from the website | A |
| `unverifiedLabel` | An outcome label arrives with no evidence, date or author | A, C |
| `duplicatePerson` | A person could be matched only by name, or two person records may be one person | A |
| `ambiguousEmail` | One address or ORCID iD would attach to two people, or one person has two different addresses | A |
| `identifierDefect` | An address or ORCID iD is malformed, reversed, truncated or fails its check digit | A |
| `ambiguousLaboratory` | A row may belong to one of several laboratories. No inspected source raises it yet. | A |
| `institutionMatch` | An affiliation string awaits mapping to an institution, or two strings may name one institution | A, C |
| `candidateLink` | A source suggests a participation or a lead that only a reviewer may create | A |
| `structureChange` | A tab or header is missing, renamed or new, data sits under a blank header, or a header does not fit its content | A, C |
| `unparsedValue` | A cell cannot be read mechanically: free text in a numeric or date column, a blank whose meaning is open, several values or people in one cell | A, C |
| `formattingSignal` | Meaning exists only as colour, strike-through, a highlight or a hidden state, or such a signal contradicts the cell text | A, C |
| `annotationReview` | A note, footnote, footer, stray cell, residual copy or stale derived cell needs its meaning or placement confirmed | A, C |
| `vocabularyReview` | A value lies outside a known list, a new term or deprecation reason appears, or a mapping to an external concept is inexact | A, C |
| `linkDefect` | A link is an editor address, has a malformed target, carries a token, or cannot be reached | A, C |
| `privacyReview` | A cell holds quoted correspondence, a recipient list, a candid remark about a person or a label that identifies a person | A |
| `missingFromSource` | A record imported earlier is absent from the latest snapshot, alone or as half of a probable rename | A, C |

The fingerprint of an item is a hash over three parts: the kind, the subject (the entity identifier or folded source key, with the field where one applies), and the sorted list of candidate keys, each made of the claim source and the hash of the normalised value. It is computed with `hk` when a candidate value is personal and with `h` otherwise. Row numbers, batch identifiers and retrieval times are left out. The same disagreement therefore yields the same fingerprint on every run and is raised once, whether the earlier item is open, resolved or dismissed. When a source value changes, the fingerprint changes and a new item is raised. The importer closes the earlier item as superseded if it is still open, and closes an item whose condition has disappeared from the source as cleared. These two closures are the only ones the importer makes. Every decision between values is made by a person.

A resolution is a stored decision, and the change it causes is made by a callable function in a transaction with an audit entry (D-006, D-007), outside any import batch. A decision is never undone by a later import or by the rollback of one. The preview shows how many items of each kind a run would add, and the items are written when the batch is applied. The exception is an item that explains why a batch cannot be applied, such as a `structureChange`, which is written at preview so that a reviewer can act on it.

## 8. Verification

A batch is verified only when every check below passes. The report is stored on the batch and an administrator signs it off.

| Check | What it proves |
|---|---|
| Row accounting | Every non-empty row of every tab falls into exactly one class (header, banner, data, annotation, derived, placeholder, filler, blank), and the counts per class equal the baseline table below or a difference that the operator has explained. |
| Records against rows | For every tab, the data rows equal the sum of records created, updated, unchanged, held in the queue and kept as raw only. No row is dropped silently. |
| Fidelity of raw values | The raw cells stored in the source records hash to the same values as a fresh parse of the same file. |
| Second run | A second run on the same file produces the single write of section 6. |
| Trace to source | Every imported document names at least one existing source record in `sourceRecordIds`. Every source record of a data row is named by a document, by an open item or by an explicit raw-only disposition. |
| No orphaned references | Every reference to a replication, person, institution, laboratory, vocabulary term, hypothesis or source record resolves. The scheduled integrity checker of D-003 runs over the result. |
| Study registry | Exactly 27 replications carry a programme identifier after step 3, their folded keys are distinct, and for the 23 website studies the DOI is equal, without regard to case, in H, D and E. |
| Derived values | The totals and medians of F, the footer counts of E and the formula results of B, recomputed from the data, equal the cached values, or the difference is reported. |
| Blank and zero | Every blank numeric source cell is absent in the target and every explicit zero is 0. In F that is 67 blanks and 1 zero. |
| No private value in the wrong place | No document that members can read contains an email-shaped string or a value that came from a restricted column. No document identifier contains a name token or an address taken from the source. |
| Rollback rehearsal | On staging, with synthetic data, a rollback followed by a new apply reproduces the same documents. |

The baseline for row accounting is the snapshot of 9 November 2026, whose rows per tab are also listed in `docs/SOURCE_REGISTRY.md`.

| Source and tab | Data rows | Records expected at first import |
|---|---|---|
| H `replications.tsv` | 23 | 23 Replication, 23 lead memberships |
| H `publications.tsv` | 18 | 18 Manuscript |
| H `people.tsv` | 46 | 46 Person, and 6 further lead memberships marked `needsReview` |
| H `members.tsv` | 300 | 300 Person |
| B | 27, and 1 footnote cell | 108 StudyAlias once all 27 replications exist |
| C | 26 | 26 VocabularyTerm |
| D `list of studies` | 27 | 4 Replication created and 23 updated, 27 lead claims |
| D `shortlist_archived`, `allranked_archived`, `AlphaAsymmetry_RSSubproject` | 29, 139 with 780 vote cells, and 6 | Source records only, until the placement of candidates is decided. 27 shortlist rows and 26 ranked rows link to a replication by DOI. |
| D `questionnaires`, `Sheet5` | 12 and 17 | Source records only |
| E `links_hypotheses` | 38, and 3 footer rows | 38 Hypothesis, 82 DocumentLink |
| E `review` | 27 | Source records only |
| E `questions4MarketsNSurvey` | 34 | 34 PredictionMarketItem |
| F `numberOfLabsPerReplication` | 26, and 3 derived rows | 58 HistoricalAggregate, 5 values held in the queue, 25 lead claims |
| F `leadsEmails` | 26 | 31 lead claims |
| F outreach tabs | 125 in 21 tabs | 119 OutreachContact, 6 annotations, 14 lead claims |
| Contributor sheets | 117 in 5 sheets | 5 ContributorTable, 117 Contributor, once their apply is released |

## 9. What is blocked, and how it is still built

| Blocked | By what | What is known | What unblocks it |
|---|---|---|---|
| Source A | Anonymous access is refused and no Google credentials exist | The description and the seven summary field names in the requirements | A service account with read access to the file, or a file supplied by an administrator |
| Source G | The same | The three tab names and the field names in the requirements | The same |
| The registry of contributor tables, their status and any further tables | The requirements place it in G | The five known sheets and a mapping that is corroborated but unverified | Access to G |
| Demographics | No inspected source holds gender or ethnicity, and the requirements name both as fields of G | The two field names | Access to G, and the decisions listed in section 11 |
| Source I | No export file and no API token | The published API reference and export guides, read on 9 November 2026 | A JSON export of each project, or an authorisation by an organisation administrator |
| Source J behind sign-in | No Drive access | The addresses found in the readable sources | A service account, or folders shared with it |
| Scheduled reading of B to F | No service account, and the planned restriction of link sharing | Anonymous export works today | A service account before sharing is restricted |

Each blocked importer is built now. The reader of every external system sits behind an interface with a real implementation and a fake used in tests (D-014), and all tests run against the Firebase emulators (D-016). The fixtures are produced by builder code that writes workbooks with formatting, so that strike-through, fills, hidden rows and tabs, merged cells, checkboxes, text dates and true dates, formulas and header notes can all be exercised. Every fixture uses obviously fictitious names and the `example.org` domain and says in a header comment that it is synthetic, as `portal/CONTRIBUTING.md` requires. No real row of any source is ever used as a fixture.

For A and G the fixtures encode only what the requirements state, the tab and field names, and they are labelled as assumptions about structure. Nothing a fixture contains counts as a fact about either workbook. The importers fail closed: a header set that differs from the expected one blocks the tab, so the first run against the real file is a preview that reveals the true structure before anything is written. The summary parser that A is expected to share is exercised first on the real summary tab of F, which is how the separation of historical snapshots from live counts is proven before A can be read.

The fixtures for F and the contributor sheets reproduce the patterns that discovery found, because no real row of those files may be committed: a header on row 3 and on row 4, a missing title line, a stub study line, a combined identifier, tab titles with a suffix, a truncation and a diacritic, blank rows inside data, a section label, a tentative name, two names in one cell, a reversed address, both text date forms and a true date, a follow-up before the first contact, red, green, theme-coloured and colour-only rows, strike-through, merged cells, a stray cell beyond the last header, a blank beside an explicit zero, an old leader, a two-name leader cell, blank headers, a mislabelled column, filler rows, placeholder rows and order keywords.

The Quire fixtures are built from the documented example records, with the documented variations: date-only and timed dates, status values on both sides of the completion threshold, every priority, list-valued fields that arrive as an array or as an encoded string, missing optional keys, a parent chain deeper than ten, a truncated subtree, a paginated list, a follower that is an application, a custom field of each type, an attachment of each storage type and a comment that holds only attachments. The same idempotency tests apply as to every other importer. The first real export or token must settle what the documentation leaves open: the actual keys of exported task, comment and user objects, whether arrays arrive in display order, whether archived tasks are included by default, whether attachment addresses can be downloaded with the token, and whether colleagues' addresses are returned once contact access is granted.

## 10. Data protection during migration

Firestore grants reads per document, so secrecy is achieved by where a value is stored (D-006). The importer writes each value to the document that matches its classification and to no other. The table follows the access tiers of the data model.

| Data | Stored in | Readable by |
|---|---|---|
| Raw rows of every source | SourceRecord | Programme administrators, and the core team where the capability matrix allows |
| Gender and ethnicity cells of G | The person's special-category demographics document, verbatim. The general source record holds a marker and a hash in their place, and a row whose person is not yet resolved keeps the cells in a document that no client can read. | No client. Served only by the callable function that checks the grant and the second factor and writes an audit entry (D-006). |
| Email addresses | The person's restricted contact document, the restricted contact document of a Contributor, the OutreachContact | The person concerned, administrators, and scoped leads and coordinators |
| Outreach names, dates, results, notes, colours and links from F | OutreachContact | The leads of the replication and administrators |
| Lead claims from D and F whose person does not resolve | Source records and queue items | Those who work the queue |
| Review status and review notes from E, and the `replicated` labels until section 11 is answered | Source records | Those who work the queue |
| Preview plans and change-log entries | With the batch | Those who may run an import |
| Identity keys and the email index | Lookup documents | No client |
| Values from the four website files | Public and member documents | Members, and the public through the website |
| File identifiers and addresses of the sources | Private configuration, and the location document of the registry, which no client can read | The import operator |
| The key for `hk` and credentials | The secret store | The import operator |
| Export files | A restricted location outside the repository | The import operator |

An import is run by a programme administrator, from the administrator's own machine or from a protected workflow with required reviewers, and never from the public site (D-012). The Admin SDK bypasses the security rules, so custody of its credential is the control. On a protected workflow the tool obtains short-lived credentials through workload identity federation, so no service-account key is stored, and nothing of the kind is ever committed. Rollback is among the sensitive operations that the capability matrix controls. The tool prints counts, document identifiers and hashes, and no name, address, note or special-category value reaches its output or any log. Staging holds synthetic data only (D-017), and no real export is ever loaded there.

No real data is imported before the production project exists in its confirmed location, because the location of Firestore is permanent once chosen (D-003). The key for `hk` is created once for production and kept with the credentials. If it were lost, a later import could not reproduce the identifiers of contributors and outreach contacts or the row keys of personal source rows, and would write those rows again as new documents. Persons would still resolve through the stored identity keys only where those keys are plain hashes (question 17). A different key is used on staging.

Cells that hold quoted correspondence, a recipient list or a candid remark about a person stay in the source record and under `privacyReview`, and reach no entity until a reviewer decides. Restricting link sharing on source F and the contributor sheets is an action for the owners of those files, recommended once the import has been verified. Until then the files stay exposed whatever the portal does. Retention periods for source records and export files, and the lawful basis for holding demographic data, are governance decisions that `docs/SECURITY.md` leaves to the programme. Until they are taken the importer deletes nothing.

## 11. Open questions for the maintainers

| # | Question | Why it matters | Until it is answered |
|---|---|---|---|
| 1 | Are `Carretie2004`, `DonkersvanBoxtel2004`, `Frank2005` and `Hajcak2006` cancelled, paused or only unlisted? | The website removed them, D shows two on hold and two still recruiting, E labels them `cancelled` on hidden rows, and F strikes them through in one tab while still listing leads for them. | The four are imported as replications with no status set from any of these signals, the source statuses shown side by side, and a `statusQuestion` open on each. |
| 2 | Does `AmodioMaster2007` in F mean `AmodioMaster2008`, does the tab `AmodioMaster20072008` cover one study or both, and which study do the combined numbers describe? | The combined row holds the only sign-up and collection counts for these studies, and one lead and one address for two replications. | The identifier and the tab stay unresolved. The five combined values stay in the source record and the queue, and are written beneath neither replication. |
| 3 | Do the two Amodio replications share one dataset, and are the cloud-account, BIDS and EEGNet names in use? | Shared aliases decide how datasets and external accounts are modelled, and the workbook does not say which service or which BIDS entity is meant. | The shared alias is stored beneath each of the two replications with the footnote, and the account names as intended names of unverified existence. |
| 4 | Who leads each of the 8 studies on which the sources disagree, and are the 6 second leads in the people file co-leads or first authors? | Leads receive management rights after confirmation, and a replication whose lead memberships are all marked `needsReview` has no confirmed lead in the portal. | Every claim is kept with its source, every membership concerned is marked `needsReview`, and no role is granted. |
| 5 | May the importer write the website's named lead as a confirmed membership before any review? | The F report says no membership should exist before review, and the H report allows one where every source agrees. | The rule of 4.1 applies. |
| 6 | When D and the website differ on stage, lead, reference or sign-up link, which is authoritative for each field? | Neither is newer as a whole. Rows of D were updated one at a time. | Website values stand as the live baseline, D values are observations, and each difference is queued. |
| 7 | What do a blank, a `yes` or `no` on a null hypothesis, and `cancelled` mean in the `replicated` column of E, and should members see the labels before scientific review? | The column mixes an outcome with a lifecycle state and has no evidence attached. The data model places it on a document that every member can read, and members may take part in the prediction market, whose survey asks whether they already know the results (inferred). | The labels stay in the source records and `replicatedSource` is left unset on production. |
| 8 | Is the community vocabulary sheet the system of record, and is it registered with the external tool chain that reads such sheets daily? | If it is, its identifiers are frozen and the sheet must stay authoritative or be kept in step with the portal. | The portal imports the sheet read-only, never regenerates an identifier and writes nothing back. |
| 9 | Are candidate papers Replication documents with a selection status, as the D report and the data model imply, or records of their own, as the H report's rule for the 27 studies requires? And should the 780 interest votes and the names of extractors and reviewers become structured records? | The answer decides whether 112 papers that never became a study sit among the replications. Votes and credits hold names only, so each would need a person match by hand. | The candidate tabs stay in the source records with their DOI keys, and no candidate document is written. |
| 10 | May every member read the contributor lists of unpublished manuscripts, as the data model allows, or only the replication team, as the contributor report asks? | The lists hold names, author order and roles of manuscripts that are still in preparation. | The contributor sheets are previewed and are not applied on production. |
| 11 | Is the mapping of the five contributor sheets to replications right, which manuscript does each belong to, is each a sign-up table or a final list, and do further tables exist? | The files name no study, and the requirements place the authoritative list in G. | The supplied mapping is used and marked as unverified, and the table status fields stay empty. |
| 12 | In the contributor sheets, is the column headed `Funding 2` the ORCID column, is the unheaded first column the order in publication, what are the unheaded boolean column and the highlighted row, and are the two reserved positions still wanted? | Each needs a stored override or a decision before the affected cells can be mapped. | The cells are kept as unmapped raw values with an open item, and no override is applied. |
| 13 | Source F was expected to hold 25 tabs and the export holds 23. Were two tabs removed, or was the expectation wrong? | Outreach history may be missing. | The 23 tabs are imported, and the importer fails its preview if the set of tabs changes. |
| 14 | Which date do the summary numbers in F describe, and may the study-level aggregates be published? | The tab states no date, holds a stale projection, and is maintained by hand. The data model lets every member read an aggregate. | Each value is stored without a snapshot date, bound to its source record and labelled as imported historical, and none is published. |
| 15 | Is the alpha-asymmetry subproject still active, and is it the related project that the website lists under the slug `asymmetry`? | Its 6 candidate papers would otherwise remain archived candidates with no home. | They stay with the other candidates, and no link to the related-project page is made. |
| 16 | Which of the two disagreeing study-to-publication links is right for the 4 affected studies, and should the 3 inconsistent publication rows be corrected at the source? | The public site builds a link to a publication that does not exist for 2 studies. | Both values are kept and a `valueConflict` is open for each. The website files are not changed by the importer. |
| 17 | Are identity keys and the email index hashed with a secret key, as the F and contributor reports ask, or with plain SHA-256, as the data model specifies? | A plain hash of an address can be reversed by guessing if the lookup ever leaks, and the importer and the claim function must agree. | The importer uses the shared identifier code of the portal, whichever form that code implements, and builds person, contributor and outreach identifiers with the keyed hash. |
| 18 | Who provides the service account for A and G, with access to which files, and will it exist before link sharing on F and the contributor sheets is restricted? | Without it A, G and the documents behind sign-in cannot be read, and restricting sharing would end anonymous export. | A and G are built against synthetic fixtures. B to F are fetched by anonymous export, or from a file that an administrator supplies. |
| 19 | Which plan is the Quire organisation on, and who will authorise the pull or supply the exports? | The plan decides which endpoints work and how long the activity log is kept, and the log can be saved only from inside the application before the migration. | The Quire importer is built against fixtures made from the published documentation, and nothing is assumed about the real workspace. |
| 20 | How long are raw source records and export files kept, in particular the outreach correspondence in F, and must the lawful basis for holding the demographics of G be recorded before they are imported? | Outreach rows describe people who mostly never joined the programme, and gender and ethnicity are special-category data. | Everything is stored restricted and nothing is deleted. No demographic value can be imported yet in any case, because G is inaccessible. |
