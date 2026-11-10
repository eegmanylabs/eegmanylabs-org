# #EEGManyLabs Hub: source registry

## 1. What the registry is and how access was established

This registry describes every source from which the members' portal migrates data: what the source is, how far it could be inspected, what each tab holds and what an importer has to respect when it reads it. It is the written counterpart of the source registry defined in `docs/DATA_MODEL.md`, and it follows decision D-012 in `docs/DECISIONS.md`: sources are named by letter and title only, and their addresses and identifiers are held in private configuration outside this public repository. People are reported as counts. No name of a private individual, no address and no remark about an individual appears here. Study identifiers contain the surnames of authors of published papers and are public.

Access was established on 9 November 2026 in a session that held no Google credentials and no Quire authorisation. Sources A and G refused anonymous access and have not been opened, so everything said about them repeats the project brief and is unverified. Sources B, C, D, E and F and five contributor sheets were readable by anyone holding the link. Each was exported once as an Excel workbook and examined offline, with formulas and cached values loaded separately and the raw parts of each file read for hidden tabs, hidden rows and columns, validation rules, hyperlinks, comments and formatting. Source H is the TSV data of this repository at commit `b0c0f04`. For source I only Quire's published documentation was read. For source J three addresses were tested for reachability and no linked document other than those contributor sheets was opened.

Statements below are observations from those snapshots unless they are marked as inferred or unverified. The exports carry no document properties, so none of them records an author, an owner or a last-modified time (section 7).

| Source | Snapshot examined | Size in bytes | SHA-256, first 16 hex |
|---|---|---|---|
| B | Excel export, 9 November 2026 | 7,664 | `04129d2826053a7e` |
| C | Excel export, 9 November 2026 | 12,649 | `deeebabe7d9a848f` |
| D | Excel export, 9 November 2026 | 476,650 | `d2b79b77877683d5` |
| E | Excel export, 9 November 2026 | 47,583 | `82d321ce9d308547` |
| F | Excel export, 9 November 2026 | 56,517 | `b333ebbaf3d675f2` |
| Contributor sheet, AmodioJost2007 | Excel export, 9 November 2026 | 94,784 | `b51fbcba7085b474` |
| Contributor sheet, AmodioMaster2008 | Excel export, 9 November 2026 | 13,796 | `70f1aa98048e196a` |
| Contributor sheet, Boksem2006 | Excel export, 9 November 2026 | 13,002 | `2d03abb68e7735a7` |
| Contributor sheet, BuschVanRullen2010 | Excel export, 9 November 2026 | 92,154 | `3f1e7ab799446190` |
| Contributor sheet, DelCul2007 | Excel export, 9 November 2026 | 12,191 | `b6b3ddc6be0132bc` |
| H, `data/replications.tsv` | commit `b0c0f04` | | `e904e664013ef892` |
| H, `data/publications.tsv` | commit `b0c0f04` | | `b8b8c2d8105c0891` |
| H, `data/people.tsv` | commit `b0c0f04` | | `4c5a0c51bc661da6` |
| H, `data/members.tsv` | commit `b0c0f04` | | `62592ded80d962d2` |

## 2. Summary of sources

Authority says how a source relates to current truth: a historical snapshot records a past state, a live operational record is still maintained by hand, and a reference is slowly changing configuration. It is inferred from the content of each source, since no snapshot carries modification metadata, and is to be confirmed by the maintainers. The personal-data class is the highest class present: none, restricted (contact details, outreach history, private notes) or special category (gender and ethnicity). The synchronisation policies are proposals. A one-off import reads a source once and keeps it as a dated snapshot. A repeatable import is run by an administrator whenever the source has changed and writes nothing when it has not. A scheduled pull is the same import on a timer. Two-way means that the portal also writes back, which needs explicit approval under decision D-014. The source registry of the data model lists three policy values (one-off, scheduled pull and two-way) and needs a fourth for the repeatable import.

| Source | Title | Kind | Access in this session | Authority | Personal-data class | Proposed synchronisation policy | Importer status |
|---|---|---|---|---|---|---|---|
| A | Historical replication coordination workbook | Excel file held in Drive | Refused anonymous access. Not inspected. | Historical snapshot, as the brief describes it. Unverified. | Restricted, expected from the brief (study leads and outreach). Unverified. | One-off import | Blocked: no Google credentials exist ; the importer is built against synthetic fixtures only |
| B | Naming conventions | Google Sheet, 1 tab | Readable by link. Export inspected. | Reference | None | Repeatable import | Built. Run on the exports of 9 November 2026 against the local emulators only; verified and idempotent. |
| C | Community vocabulary | Google Sheet, 1 tab | Readable by link. Export inspected. | Reference, still growing | None | Scheduled pull, read-only, while the sheet stays the system of record | Built. Run on the exports of 9 November 2026 against the local emulators only; verified and idempotent. |
| D | List of studies | Google Sheet, 6 tabs, 2 hidden | Readable by link. Export inspected. | Historical snapshot. `list of studies` is a dated operational record and the authoritative copy of the extraction fields. | Restricted: names of people and free-text notes. No email address. | Repeatable import for `list of studies`, one-off import for the other five tabs | Built. Run on the exports of 9 November 2026 against the local emulators only; verified and idempotent. |
| E | Prediction-market hypotheses | Google Sheet, 3 tabs, 1 hidden | Readable by link. Export inspected. | Live operational record, edited rarely (`links_hypotheses`). The other two tabs are historical. | Restricted: one given name inside a status label, and unverified outcome labels that stay internal | Repeatable import | Built. Run on the exports of 9 November 2026 against the local emulators only; verified and idempotent. |
| F | Recruitment and contact workbook | Google Sheet, 23 tabs, 17 hidden | Readable by link. Export inspected. | Live operational record (two summary tabs). Historical log (21 outreach tabs). | Restricted: names, email addresses, correspondence dates and candid remarks about individuals | Repeatable import for the summary tabs, one-off import for the outreach tabs | Built. Run on the exports of 9 November 2026 against the local emulators only; verified and idempotent. |
| G | Membership and contributor workbook | Google Sheet, as the brief describes it | Refused anonymous access. Not inspected. Five linked contributor sheets were readable and inspected. | Live operational record, presumed. Unverified. The contributor sheets are live. | Special category (gender, ethnicity) and restricted (email addresses), as the brief describes it. Unverified. The contributor sheets are restricted. | Repeatable import, to be confirmed once the workbook can be opened | Blocked for the workbook: no Google credentials exist; its importer is built against synthetic fixtures only. Built for the contributor sheets, run on the emulators only, and withheld from production until section 11 of the migration plan is answered. |
| H | Website structured data | Four TSV files in this repository | Read from the repository | Live operational record: the published source of the public website | None beyond names, affiliations and countries that the website already publishes | Repeatable import per commit. Two-way later, once reviewed publishing writes the files. | Built. Run on the files of the checkout against the local emulators only; verified and idempotent. |
| I | Quire | External task-management workspace | No export file and no token. Published documentation only. | Live operational record, presumed. Nothing verified. | Restricted, expected: member names, addresses where granted, comments | One-off import after a freeze, rehearsed beforehand with repeatable pulls | Blocked: no export file and no API authorisation exist |
| J | Google Drive, Docs, OSF and other linked documents | Linked documents on several hosts | Reachability samples only: three addresses | Reference | Unknown: no content was read. Treated as restricted until inspected. | Scheduled pull of reachability and metadata only | Planned for link registration. Blocked for discovery behind Google sign-in: no service account exists. |

## 3. Sources in detail

Six rules hold for every workbook source and are not repeated per tab. The importer reads the Excel export or the grid data of the Sheets interface and never a CSV export, because CSV loses hyperlink targets, hidden-row and hidden-tab flags, validation lists, formulas, cell types, strike-through and fill colours, several of which carry meaning in these files. Hidden tabs, hidden rows and hidden columns are read, and their visibility is stored as provenance. Formula text and cached value are both stored. The declared grid size is ignored in favour of the used range. Columns are located by header text, a missing or duplicated header stops the import of that tab, and a new header is reported and never dropped silently. Every cell is stored verbatim in a SourceRecord before any trimming or parsing, and a row that is absent from a later snapshot is marked as missing and kept. No tab of any inspected source is very hidden.

### 3.1 Source A: historical replication coordination workbook

Source A could not be opened. The brief describes it as an Excel file held in Drive that records study leads, laboratory outreach and historical recruitment, with the seven summary fields below. Tab names, tab visibility, header positions, row counts, formulas and data quality are all unknown. Because it is an Excel file, it has to be fetched through the Drive file interface or by download and parsed as a workbook.

| Field stated in the brief | Meaning, unverified |
|---|---|
| `StudyID` | Study identifier |
| `Leader` | Study lead |
| `NLabsSigned` | Number of laboratories signed up |
| `TotalNSubjectsToBeRun` | Planned total number of participants |
| `NLabsFinished` | Number of laboratories that finished data collection |
| `TotalNMainExpCollected` | Participants collected in the main experiment |
| `TotalNRest` | Participants with a resting-state recording |

The same seven headers occur verbatim in the tab `numberOfLabsPerReplication` of source F, which was inspected (section 3.6), and the meanings above are the ones inferred there. Whether the two sources hold the same rows or the same values is unknown. The five numeric fields map to HistoricalAggregate, one metric per field, kept apart from live recruitment reports as decision D-009 requires.

### 3.2 Source B: naming conventions

| Tab | Visibility | Header | Data rows | Purpose |
|---|---|---|---|---|
| `Sheet1` | visible | row 1 | 27 (rows 2 to 28) | One row per study, giving its name in four schemes: programme identifier, cloud-account name, BIDS name and EEGNet name |

The tab name is the spreadsheet default. The tab feeds StudyAlias and is the only source of the cloud-account, BIDS and EEGNet schemes: none of those alias strings occurs in sources C, D, E, F, the contributor sheets or the repository, apart from the coincidence noted below. No Replication is created from this tab. The workbook holds no email address, no URL, no comment and no date.

| Column | Header (verbatim) | Stored as | Meaning |
|---|---|---|---|
| A | `Original Name` | literal | Programme study identifier. Natural key. Byte-identical to `StudyID` of source D on 27 of 27 rows, in the same order. |
| B | `Standardized Name - cloud accounts` | literal | Cloud-account name: four letters and the year, always eight characters. Unique. |
| C | `Explanation` | literal | Three tokens joined by ` + `. The first two give the four letters of the cloud-account name. The meaning of the third is not stated. |
| E | `Part 1` | formula | First component of the BIDS name |
| F | `Part 2` | 17 formulas, 10 literals | Second component of the BIDS name. A typed capital letter where several studies share their first three letters. |
| G | `Standardized Name - BIDS` | 25 formulas, 2 literals | `Part 1` followed by `Part 2`. 26 distinct values. |
| H | `EEGnet name` | literal | Three-letter EEGNet name. 26 distinct values. |
| J | no header | literal, one cell | Footnote in J2: `*data for both replications collected in one dataset` |

Columns D and I are empty spacers. The tab has 69 formula cells, each referring to its own row only: `=LEFT(A2, 3)` on 26 rows and `=LEFT(A8, 1)` on row 8 in column E, `=MID(A4,4,1)` on 16 rows and `=MID(A8,4,3)` on row 8 in column F, and `=CONCATENATE(E4,F4)` on rows 4 to 28 in column G. All cached results equal a recomputation. In the file, 60 of the 69 cells depend on shared formulas and carry no formula text of their own, so a reader has to expand shared formulas or rely on the cached values.

| `Original Name` | Cloud accounts | BIDS | EEGnet |
|---|---|---|---|
| `AmodioJost2007` | `AmJo2007` | `Amod*` | `AMO*` |
| `AmodioMaster2008` | `AmMa2008` | `Amod*` | `AMO*` |
| `Boksem2006` | `Boks2006` | `Boks` | `BOK` |
| `BuschVanRullen2010` | `BuVR2010` | `Busc` | `BUS` |
| `Carretie2004` | `Carr2004` | `Carr` | `CAR` |
| `ClarkHillyard1996` | `ClHi1996` | `Clar` | `CLA` |
| `DelCul2007` | `DeCu2007` | `DCul` | `DCU` |
| `DonkersvanBoxtel2004` | `DoBo2004` | `Donk` | `DON` |
| `Eimer1993` | `Eime1993` | `EimA` | `EIA` |
| `Eimer1996` | `Eime1996` | `EimB` | `EIB` |
| `Eimer2003` | `Eime2003` | `EimC` | `EIC` |
| `Frank2005` | `Fran2005` | `Fran` | `FRA` |
| `Hajcak2003` | `Hajc2003` | `HajA` | `HAA` |
| `Hajcak2006` | `Hajc2006` | `HajB` | `HAB` |
| `HajcakFoti2008` | `HaFo2008` | `HajC` | `HAC` |
| `HajcakHolroyd2005` | `HaHo2005` | `HajD` | `HAD` |
| `HajcakMoser2005` | `HaMo2005` | `HajE` | `HAE` |
| `Inzlicht2009` | `Inzl2009` | `Inzl` | `INZ` |
| `Luck1996` | `Luck1996` | `Luck` | `LUC` |
| `Mathewson2009` | `Math2009` | `Math` | `MAT` |
| `Miltner1999` | `Milt1999` | `Milt` | `MIL` |
| `Muller2003` | `Mull2003` | `Mull` | `MUL` |
| `Onton2005` | `Onto2005` | `Onto` | `ONT` |
| `Sergent2005` | `Serg2005` | `Serg` | `SER` |
| `Vidal2000` | `Vida2000` | `Vida` | `VID` |
| `VogelMachizawa2004` | `VoMa2004` | `Voge` | `VOG` |
| `YeungSanfey2004` | `YeSa2004` | `Yeun` | `YEU` |

An importer has to respect the following. The two Amodio replications share one BIDS name and one EEGNet name, stored as `Amod*` and `AMO*` with the footnote marker inside the value, so the marker is stripped for the alias, the raw cell is kept, and the footnote is stored as a tab annotation that applies to every marked cell. An alias is therefore unique only together with its replication, as decision D-013 records. The string `Luck1996` is both the programme identifier and the cloud-account name of one study, so an alias identifies a study only together with its scheme. Stored values are authoritative and names are never recomputed from the naming rule: the rule is broken by typed exceptions on rows 2, 3, 5 and 8, which makes a recomputation wrong for 4 of 27 studies, and name particles are treated inconsistently (`VanRullen`, `vanBoxtel`, `DelCul`). Columns F and G mix typed literals with formulas, so the importer stores which kind each cell is. Cell C5 holds the only lower-case third token (`Bu + VR + a`), and the third token as a whole is kept as raw text. Case is preserved exactly, because BIDS names are distinguished partly by a capital letter. The workbook does not say which cloud service the account names belong to, whether those accounts exist, or which BIDS entity the BIDS name fills, so account names are stored as intended names with existence unverified.

### 3.3 Source C: community vocabulary

| Tab | Visibility | Header | Data rows | Purpose |
|---|---|---|---|---|
| `Sheet1` | visible | row 1, frozen | 26 (rows 2 to 27) | Controlled vocabulary of participant-level measures and dataset-level metadata |

The declared grid has 1,011 rows, of which rows 28 to 1,011 hold only 984 empty, text-formatted cells in column A prepared for future terms. The tab feeds VocabularyTerm. It has no formula, no hyperlink, no comment and no date. One validation rule covers column A: `AND(REGEXMATCH(A1, "^[A-Za-z0-9_-]+$"), COUNTIF(A:A, A1)=1)`, which constrains characters and uniqueness only and is enforced inside Google Sheets alone, so the importer validates again.

| Column | Header (verbatim) | Fill | Meaning |
|---|---|---|---|
| A | `id` | 26 of 26 | Term identifier, `trm_001` to `trm_026`, contiguous and in row order. Natural key. Never regenerated and never derived from the name, the abbreviation or the row number. |
| B | `name` | 26 of 26 | Always `<category> - <label>`. The category is `Participant` on 17 rows and `Meta` on 9. |
| C | `abbreviation` | 26 of 26 | Short code, unique also when case is ignored |
| D | `description` | 26 of 26 | One-line description |
| E | `invalid_reason` | 0 of 26 | Never used. In the curation format the sheet follows, a non-empty value retires a term while its row and identifier stay. |
| F | `same_as` | 9 of 26 | Seven distinct values, all of the form `snomed:` followed by digits. A reference to an external concept. |

By abbreviation prefix the terms fall into nine questionnaire instruments, two education items, four exclusion or screening items, two hormonal-status items, three dataset-content flags and six recording-metadata terms. That grouping is inferred, since the sheet has no kind column, and is stored as a reviewable suggestion.

`same_as` never refers to another term of the sheet, so it is stored verbatim as a reference to an external concept and is never resolved to a local term. Two targets are each shared by two terms, in each case the state and trait forms of one instrument. The mappings vary in precision, and one code belongs to a national extension of the terminology that the international edition does not resolve. Terms are therefore never merged because they share a target, a name or an abbreviation. Spelling is preserved as found: the abbreviation `HORM-Cylce` has transposed letters and one description has a double space. `HAS-EEG` is a channel count although its abbreviation family reads as a yes or no flag, and `TASK-Rep+Rest` is the conjunction of two other terms. No `trm_` identifier and no `snomed:` code occurs in sources B, D, E or F or in the contributor sheets, so linking a term to the questionnaire text of source D is a human task. A term that vanishes from the sheet is kept and reported, because the format retires terms through `invalid_reason`.

The column set, the identifier rule and the example identifiers match the community vocabulary curation table of a public neuroinformatics project (Neurobagel), whose documented workflow reads the first worksheet of each registered sheet once a day. Whether this sheet is registered there was not verified. If it is, its identifiers are frozen and the sheet has to remain the system of record or be kept in step with the portal.

### 3.4 Source D: list of studies

| # | Tab | Visibility | Header | Data rows | Purpose |
|---|---|---|---|---|---|
| 1 | `list of studies` | visible | rows 1 and 2, data from row 3 | 27 (rows 3 to 29) | One row per replication study: identifier, lead, original paper, extracted design and statistics, keywords, progress stage and sign-up link |
| 2 | `shortlist_archived` | visible | rows 1 and 2, data from row 3 | 29 (rows 3 to 31) | Shortlisted candidate studies with the same extraction fields, the data extractor, the coding reviewer and an early stage |
| 3 | `allranked_archived` | visible | rows 1 and 2, data from row 3 | 139 (rows 3 to 141) | Nominated papers with bibliographic fields, keywords and interest votes |
| 4 | `questionnaires` | hidden | row 1 banner, row 2 header, data from row 3 | 12 (rows 3 to 14) | Planning list of questionnaires to administer after data collection |
| 5 | `AlphaAsymmetry_RSSubproject` | visible | rows 1 and 2, data from row 3 | 6 (rows 3 to 8) | Candidate papers of the resting-state alpha-asymmetry subproject |
| 6 | `Sheet5` | hidden | none, data from row 1 | 17 (rows 1 to 17) | Unknown. Inferred to be a scratch list. |

The workbook has 141 formula cells: 139 vote counters in `allranked_archived` and one `HYPERLINK()` formula each in `list of studies` (C29) and `shortlist_archived` (A19). It has no merged cell, no comment, no date-typed cell and no string that looks like an email address. Each of the five larger tabs is a table that starts at row 2, with row 1 used as a coloured banner whose text sits in an arbitrary cell of its colour run, so the position of a banner says nothing about the extent of a column group. The effective header of a column is its row 2 text where that is filled and its row 1 text otherwise. `list of studies` hides columns T, U, V and Y to AV, and `shortlist_archived` hides T, U, V and AK to AV, so reading visible columns only would lose every keyword column. No tab has an archive-flag column: archival and exclusion are expressed by the `_archived` suffix of two tab names, by a second line inside a stage or study-type cell, by the stage value `Currently put on hold` and by fill colours. Fill colours contradict the stage in at least one row, are inferred to be stale and are never imported as data.

The tabs form a lineage. `allranked_archived` holds 139 nominated papers. Exactly the 32 with eight or more votes went forward, 29 to `shortlist_archived` and 3 to `AlphaAsymmetry_RSSubproject`, and 27 of the 29 shortlisted papers became the studies of `list of studies`. The DOI is the only key shared by all study tabs and it is imperfect: one typo and two blanks in `allranked_archived`, two citations without a DOI in the subproject tab, and four representations (bare DOI, DOI address in text, link object, `HYPERLINK()` formula).

The same field sits at different column letters in different tabs.

| Field | `list of studies` | `shortlist_archived` | `allranked_archived` | `AlphaAsymmetry_RSSubproject` |
|---|---|---|---|---|
| Study identifier | A | none | none | none |
| Lead | B | W | none | none |
| Original paper | C, one citation | A, one citation, no header | A to D and F, split | A, one citation, header is a single space |
| Abstract | D | B | E | B |
| Data extractor | none | C | none | C |
| Coding reviewer | none | D | none | none |
| Progress stage | W | E | none | none |
| Effect of interest, plain-language description | E, F | F, G | none | D, E |
| Original N, statistics, standardised effect size | G, H, I | H, I, J | none | F, G, H |
| Effect size converted to r | J | none | none | none |
| Bayes factor, duration, sample type | K, L, M | K, L, M | none | I, J, K |
| Minimum channels, extra equipment, power-based N | N, O, P | N, O, P | none | L, M, N |
| Questionnaires, notes, study type | Q, R, S | Q, R, S | none | O, P, Q |
| Outcome, construct, other descriptors | T, U, V | T, U, V | G, H, I | R, S, T |
| Sign-up link | X | X | none | none |
| Votes count | none | none | J | none |
| `Group1` to `Group24` | Y to AV | Y to AV | K to AH | U to AR |

#### Tab `list of studies`

This tab feeds Replication (one per row), the original-paper fields, Hypothesis and protocol text as raw values, VocabularyTerm for stage, study type and keywords, and DocumentLink. The natural key is `StudyID`: unique, alphabetical, and an assigned opaque key that is never regenerated from authors and year. The DOI inside the citation is a secondary key with 27 distinct values. The only formula is the `HYPERLINK()` in C29.

| Column | Header (verbatim) | Meaning and stored form |
|---|---|---|
| A | `StudyID` | Programme study identifier, 27 distinct |
| B | `Lead Replicating Lab` | Name of the lead. Every value is a person, none a laboratory. 27 of 27 filled, one with a trailing space. |
| C | `Study` | Citation of the original paper ending in a DOI address |
| D | `Abstract` | Abstract of the original paper |
| E | `The effect of interest. (EEG findings are a combination of spatial, [frequency], and temporal features. The effect should be localized in all relevant to the study dimensions.)` | Effect targeted by the replication, long text |
| F | `The effect of interest in plain language` | Plain-language description |
| G | `original N` | Sample size of the original study: 16 numeric cells and 11 text cells |
| H | `Statistics from the original paper (t, F, p values, effect sizes including µV effect size where available)` | Text. The `µ` is U+00B5. |
| I | `Standardized effect size (d, r, partial eta)` | 26 text cells and 1 numeric cell |
| J | `Original effect sizes converted to r` | 22 numbers, 3 text cells, 2 empty. Exists in this tab only. |
| K | `BF10` | Bayes factor: 21 text cells, 4 numeric, 2 empty |
| L | `Your estimation of the time to complete the study in min (without preparation time)`, ending in a line feed | Duration as free text, never numeric |
| M | `Type of the sample (community, college students, etc)` | Sample type, mostly multi-line |
| N | `minimal number of channels to obtain the effect (e.g. 1 channel if the main effect was analyzed in Cz channel only)` | 25 text cells and 2 numeric |
| O | `additional requirements to the equipment (e.g., eye-tracker, EDA sensor, etc)` | 23 of 27 filled, with many null-like tokens |
| P | `Required N to have 90% power to detect the effect, assuming that the effect size is 50% of that in the original study` | Power-based N: 24 text cells and 3 numeric |
| Q | `Questionnaires. If there were any` | 16 of 27 filled |
| R | `Notes. Comments`, ending in a line feed | Free text, 18 of 27 filled. Some cells attribute remarks to named individuals. Restricted. |
| S | `Correlational/experimental study` | `1_Experimental` on 22 rows, `2_Correlational` on 5 |
| T | `Main outcome variable (ERP component, EEG phenomenon)` | Hidden. Comma-separated terms. |
| U | `Psychological Construct` | Hidden. Comma-separated terms. |
| V | `Other Descriptors` | Hidden. 19 of 27 filled. |
| W | `Progress stage`, ending in a line feed, in row 1 only | Seven distinct values, validated by a list on every data row except rows 10 and 14 |
| X | `Link to the sign-up form`, in row 1 only | 27 distinct links |
| Y to AV | `Group1` to `Group24` | Hidden. Five cells filled, all in row 3. |

The stage values are `Looking for replicating labs (stage 3)` on 9 rows, `IPA acquired. Data collection (stage 6)` on 7, `Team is assembled. Registered report Stage 1 preparation (stage 4)` on 5, `Registered report Stage 1 submitted/under review/revision (stage 5)` on 2, `Currently put on hold` on 2, `Data collection completed. Stage 2 RR submitted.` on 1 and `Completed` on 1. Three of the validated values end in a space, and `Currently put on hold` is outside the validation list. A stage number is derived only from the pattern `(stage N)`.

Numeric-looking fields are mostly text, several cells hold more than one experiment or effect, and one `BF10` cell holds a `BF01` value, so a parsed number is offered only for a numeric cell or a cell containing exactly one number, and multi-experiment cells are never split automatically. Empty cells cannot be read as "none": equipment and questionnaire cells use the tokens `-`, `no`, `none`, `None`, `N/A`, `n/A` and `not included` beside truly empty and whitespace-only cells. The three keyword cells of `Luck1996` are character-identical to those of `AmodioJost2007` while `allranked_archived` has different keywords for the same paper, which looks like a copy or sort error and goes to review. The citation of `AmodioMaster2008` says 2008 here while its DOI contains 2007 (section 4). One sign-up link is a form-editor address, two link targets end in a stray closing parenthesis, and one citation has its DOI as text only. The five filled Group cells sit in the same positions as the votes of the same paper in `allranked_archived` and are inferred to be vote leftovers, so no membership or Participation is created from them. Value cells in several columns contain reviewer remarks, dates and names of individuals, and these are kept as restricted raw text.

Stage and lead in this tab are dated observations and never overwrite a newer source. Against `data/replications.tsv`, all 23 website studies match a row here with identical DOI, reference, construct and sign-up link, while the website stage is later for 16 studies, equivalent for 7 and never earlier. This tab is treated as the authoritative copy of the extraction columns E to V: the archived tabs hold older generations of them, and the repository holds none of them except the construct keywords.

#### Tab `shortlist_archived`

Column A holds the citation and has no header in either row. Headers that exist in row 1 only are `Abstract` (B), `Data extractor` (C), `Coding reviewer` ending in a line feed (D), `Progress stage` ending in a line feed (E), `Lead Replicating Lab` (W) and `Link to the sign-up form` (X). Columns F to V carry the same row 2 headers as `list of studies`, without `Original effect sizes converted to r`. The tab has no identifier column: the only key is the DOI inside the citation, which is present and distinct on all 29 rows and maps 27 of them to a `StudyID`. The two rows without a `StudyID` carry the DOIs `10.1038/nn1197` and `10.1016/j.clinph.2005.07.005`. The single formula is the `HYPERLINK()` in A19.

`Data extractor` is filled on 29 rows with 20 distinct strings, and five cells name more than one person. `Coding reviewer` is filled on 28 rows with 11 distinct strings. The lead is filled on 14 rows and the sign-up link on 1. The stage values are `Data verified (stage 2)` on 21 rows, `Data extracted (stage 1)` on 3, `Data extraction is ongoing (stage 0)` on 2 and `Open call for Replicating Labs (stage 3)` on 1, plus two cells that append a second line to the stage: one states that the study is on hold because of an infeasible sample size and one that it is excluded because the main testable outcome is lacking. Those second lines are the only record of the archive reason.

For the 27 studies shared with `list of studies` the two tabs hold two generations of the same extraction. The power-based N differs in every comparable row, the standardised effect size in 12, the effect of interest in 13 and the original N in 4, and the lead differs for 3 studies. This tab is imported as a historical observation attached to the existing Replication, and its values never fill gaps in the newer tab without review. Multi-person cells are kept unsplit, and the five residual Group cells in row 21 are treated as in tab 1.

#### Tab `allranked_archived`

| Column | Header (verbatim) | Meaning and stored form |
|---|---|---|
| A | `Authors` | Author list in three formats. 139 of 139 filled. |
| B | `Year` | Number stored as a float, 1976 to 2018 |
| C | `Title` | All distinct. 15 rows in capitals. |
| D | `Journal` | 45 distinct, 39 when case is ignored |
| E | `Abstract` | Long text |
| F | `DOI` | Bare DOI. 137 filled, all distinct. |
| G | `Main outcome variable (ERP component, EEG phenomenon)` | Comma-separated terms |
| H | `Psychological Construct` | Comma-separated terms |
| I | `Other Descriptors` | 77 of 139 filled |
| J | `Votes count`, in row 1 only | Formula, 22 down to 3 |
| K to AH | `Group1` to `Group24` | One vote per cell: 780 filled cells holding names of people |

The banner over the vote cells invites readers to type their name beside a study they would consider replicating. Column J holds `=SUMPRODUCT((TRIM(K3:AH3)<>"")*1)` on each of the 139 rows, and every cached value equals a recount. The natural key is the DOI, with three defects: rows 79 and 115 have none, and row 7 has a one-digit typo, so that row (the paper of `HajcakMoser2005`) is found only by title. First author and year are not unique (7 collisions), so no identifier of the programme's form can be generated for these rows. Titles are all distinct and serve as a reviewed fallback key.

A vote cell can hold more than one person: 30 cells hold two names and 2 hold a name with an annotation, while the formula counts each as one vote. After splitting there are 84 distinct normalised names, and 5 people appear under two spellings. Votes are imported as historical expressions of interest, restricted, and never create a membership or a Participation: only 8 of the 27 current leads voted for the study they lead. Keyword cells are split on commas only, since `/` and `+` occur inside terms, and spelling variants are kept as separate raw terms. Row order is the vote ranking.

#### Tab `questionnaires` (hidden)

Row 1 is a banner in A1 and row 2 holds the headers `Name` followed by a space, `Duration, min` and `In which study from the list it was used`. The 12 rows have no key. Rows 3 to 9 copy questionnaire text together with its citation: 5 rows that of a study of `list of studies` and 2 that of a paper of the subproject tab. Rows 10 to 14 match no study, and rows 11 to 14 are free suggestions, each attributed to a named person in column C. `Duration, min` is filled on 3 rows. The tab has no formula. It is inferred to be an abandoned planning aid: the questionnaire text is kept on the matched study, the five rows that match no study are kept as restricted raw records only, and no Person is created from them.

#### Tab `AlphaAsymmetry_RSSubproject`

The layout is that of the shortlist without stage, coding reviewer, lead and sign-up columns. A1 contains a single space, `Abstract` and `Data extractor` are headed in row 1 only, and the Group columns have no banner. Three of the six rows carry full extraction data and three carry only a citation, an abstract and an exclusion remark. The study-type cell holds `3_Correlational (resting state, separate subproject)` on 3 rows and `3_Correlational` followed by two line feeds and `Excluded: longitudinal study` on 3 rows. Neither value occurs in the other tabs, so the exclusion flag and its reason are derived from that cell and confirmed by a curator. There is no identifier column and no formula. A DOI is present in the citation on 4 rows. All six papers are in `allranked_archived`, and the 32 filled Group cells are an exact copy of the votes for three of them, so they are recorded as a copy and are not imported a second time. Whether the subproject is still active cannot be determined from the workbook.

#### Tab `Sheet5` (hidden)

One column without a header holds 17 abbreviated citations, 15 of them with a trailing space. All 17 match a `shortlist_archived` row by title and 15 of them map to a `StudyID`. No rule explaining the subset was found. The rows are kept as raw SourceRecord entries and create or update no entity.

### 3.5 Source E: prediction-market hypotheses

| Tab | Visibility | Header | Data rows | Purpose |
|---|---|---|---|---|
| `links_hypotheses` | visible | row 1 | 38 (rows 2 to 39), plus footer cells in rows 40, 42 and 45 | One row per hypothesis offered in the prediction market, with the original paper and three links per study repeated on each row |
| `review` | hidden | row 1, with B1 empty | 27 (rows 2 to 28) | Checking log of the hypothesis selection, one row per study. Inferred. |
| `questions4MarketsNSurvey` | visible | row 1 | 34 content rows | Draft list of survey and market questions. An instrument definition with no responses. Inferred. |

The workbook contains no email address. It has one formula cell and 115 cell hyperlinks to 82 distinct targets, all in `links_hypotheses`, and three validation lists, two in that tab and one in `review`.

#### Tab `links_hypotheses`

| Column | Header (verbatim) | Meaning and stored form |
|---|---|---|
| A | `study_id` | Study identifier, repeated on each hypothesis row. 27 distinct. One is written with a diacritic (`Müller2003`). |
| B | `studyDescr_pdf` | Address of the study description on OSF. Cell text equals the hyperlink target. |
| C | `infosheet_link` | A label with a hyperlink to a Google Doc. The address exists only as the hyperlink target. |
| D | `hypothesis_number` | 1, 2 or 3, stored as a float |
| E | `hypothesis_text` | Wording of the hypothesis, 38 distinct |
| F | `null-sig` | `sig` on 29 rows and `null` on 9, from a validated list. Inferred to record whether the original paper reported the effect as significant. |
| G | `replicated` | Blank on 23 rows, `no` on 7, `cancelled` on 6 and `yes` on 2, from a validated list |
| H | `authors` | Authors of the original paper, as bibliographic text |
| I | `year` | Year stored as a float. Equals the year in `study_id` for all 27 studies. |
| J | `title` | Title of the original paper |
| K | `citation` | Full reference with a hyperlink to the DOI |

Columns L to AE have no header and no value, and the preview fails if one of them gains a value. The natural key is the pair of `study_id` and `hypothesis_number`, unique on 38 rows, numbered from 1 without gaps within each study. Seventeen studies have one hypothesis, nine have two and one has three. The study-level columns are identical on every row of a study today, which the preview enforces. The tab feeds Hypothesis and DocumentLink, supplies candidate values for the original-study fields of a Replication, and never creates a Replication.

Rows 8, 9, 14, 18, 20 and 21 are hidden. They are real data rows, they are exactly the six rows labelled `cancelled`, and they cover exactly the four studies that are absent from the website data (section 4). The footer holds a typed counter `9/38` in F40, the only formula in G40 (`=COUNTIF(G2:G39,"yes") & "/" & (COUNTIF(G2:G39,"no")+COUNTIF(G2:G39,"yes"))`, cached as the text `2/9` under a date number format), a typed note `32 hypotheses left (08.2026)` in F42, and in row 45 a label and link to a programme-level information document. Footer cells are stored as tab annotations and are never parsed into numbers or dates.

`replicated` is a hand-entered label without evidence, date or author. It mixes an outcome with a lifecycle state, a blank is distinct from `no`, and the meaning of `yes` or `no` on a `null` hypothesis is undefined in the file. Three of the six studies that carry `yes` or `no` are not at the finished stage on the website. The value is stored verbatim as an unverified source label, stays internal, is never converted to a boolean and never sets a result, a review status or a replication status. Its per-study values are deliberately not reproduced here. The string `null` in `null-sig` is a real value and is never read as missing. Two link labels in column C are misspelled (`Hajack2006`, `HajackHolroyd2005`) and one differs from column A by the diacritic. The citation text of `Carretie2004` contains no DOI, which exists only as the hyperlink target. One hypothesis text has a trailing space and one has runs of double spaces.

#### Tab `review` (hidden)

Column A is `study_id` (27 of 27, unique, the natural key, with `Muller2003` written without the diacritic), column B has an empty header and holds a status from a validated list, and column C is `notes`, filled in two cells. All 27 rows hold the same status, which embeds the given name of a reviewer and is written here as `checked_<GivenName>`. The list also allows `checked_pass1` and `checked_pass2`, which are unused. One of the two notes states a general selection rule although it sits on the first study's row. The tab has no formula. It joins to `links_hypotheses` on the folded identifier and is kept as an internal historical record. The status is stored under a synthetic field name with a note that its header was blank, and it is never shown publicly.

#### Tab `questions4MarketsNSurvey`

The two headers are `Question about the specific paper` and `Choices`. Column A mixes question text, answer options and section headings, distinguished only by position, blank separator rows and bold or italic type, so the importer stores row order and font flags and classifies no further. `Choices` is filled on 25 of 34 rows: `tickbox` on 18, `extremely - not at all` on 2, `yes/no` on 2, `field` on 1, `number` on 1 and one comma-separated option list. There is no key, no formula and no link to a hypothesis or a study, and the question text of rows 35 and 36 is identical. The tab includes a demographics section (age, sex, country, career stage) as questions only.

### 3.6 Source F: recruitment and contact workbook

The workbook has 23 tabs, where the brief expected 25: two summary tabs with one row per study and 21 outreach tabs with one row per contacted or candidate person. Six tabs are visible and 17 are hidden. Nothing in the summary tabs is computed from the outreach tabs. Tab colour, fill colour and strike-through carry meaning, and merged cells occur in `Miltner1999` only.

| # | Tab (verbatim) | Visibility | Kind | Header row | Data rows | Study |
|---|---|---|---|---|---|---|
| 1 | `Vidal2000` | hidden | outreach, lead search | 3 | 5 | `Vidal2000` |
| 2 | `DonkersvanBoxtel2004 lead` | hidden | outreach, lead search | 3 | 15 | `DonkersvanBoxtel2004` |
| 3 | `Frank2005 lead` | hidden | outreach, lead search | 3 | 1 | `Frank2005` |
| 4 | `Boksem2006` | hidden | outreach, lead search | 3 | 12 | `Boksem2006` |
| 5 | `Miltner1999` | hidden | outreach, purpose not stated, inferred lead search | 3 | 13 | `Miltner1999` |
| 6 | `Miltner1999 replicating labs se` | hidden | outreach, laboratory search | 3 | 7 | `Miltner1999` |
| 7 | `Onton2005 lead` | hidden | outreach, lead search | 3 | 10 | `Onton2005` |
| 8 | `BuschVanRullen2010` | hidden | outreach, laboratory search | 4 | 4 | `BuschVanRullen2010` |
| 9 | `numberOfLabsPerReplication` | visible | summary | 1 | 26 | all |
| 10 | `leadsEmails` | visible | summary | 1 | 26 | all |
| 11 | `Luck1996` | visible | outreach, laboratory search | 4 | 2 | `Luck1996` |
| 12 | `Carretie2004` | hidden | outreach, laboratory search | 4 | 0 | `Carretie2004` |
| 13 | `Frank2005` | hidden | outreach, laboratory search | 4 | 0 | `Frank2005` |
| 14 | `DonkersvanBoxtel2004` | hidden | outreach, laboratory search | 4 | 7 | `DonkersvanBoxtel2004` |
| 15 | `Müller2003 replicating labs sea` | hidden | outreach, laboratory search | 4 | 2 | `Muller2003` |
| 16 | `Onton2005` | visible | outreach, laboratory search | 4 | 4 | `Onton2005` |
| 17 | `AmodioMaster20072008` | hidden | outreach, laboratory search | 4 | 1 | unresolved (section 4) |
| 18 | `Vidal2000_` | visible | outreach, laboratory search | 4 | 1 | `Vidal2000`, with a contradicting study line |
| 19 | `Boksem2006_labs` | visible | outreach, laboratory search | 3 | 16 | `Boksem2006` |
| 20 | `DelCul2007` | hidden | outreach, laboratory search | 4 | 9 | `DelCul2007` |
| 21 | `Inzlicht2009` | hidden | outreach, laboratory search | 4 | 1 | `Inzlicht2009` |
| 22 | `Hajcak2006` | hidden | outreach, laboratory search | 4 | 6 | `Hajcak2006` |
| 23 | `HajcakMoser2005` | hidden | outreach, laboratory search | 4 | 9 | `HajcakMoser2005` |

#### The 21 outreach tabs

Every outreach tab has a preamble of two or three lines in column A, then a header row, then data. The header row is the first row whose column A reads `contact name`, which is row 3 in 8 tabs and row 4 in 13. Preamble lines are recognised by fixed prefixes: `Lead Replicating Lab:` followed by a person's name (14 tabs), `A search of Lead Replicating Lab` (5 tabs), `A search of Replicating Labs` (14 tabs, two of them with a remark that only laboratories in the United States are wanted) and `Study:` followed by the reference of the original paper (21 tabs). The title line is the reliable statement of purpose, since tab names do not tell it: `Boksem2006` is a lead search while `Frank2005`, `Onton2005` and `DonkersvanBoxtel2004` without a suffix are laboratory searches. Tab colour agrees with the purpose (red for lead searches, blue for laboratory searches) and is stored without being used. The tab name is a label that cannot serve as a key: `Vidal2000` and `Vidal2000_` fold to the same string, two names are cut at the 31-character limit, and one carries a diacritic that the study identifier lacks. A tab is resolved to a study through a reviewed table keyed by the exact tab title and cross-checked against the DOI in its study line, which 17 of the 21 tabs contain.

| Column | Header (verbatim) | Fill over 125 rows | Meaning and stored form |
|---|---|---|---|
| A | `contact name` | 125 | Name of the contacted or candidate person. 119 cells look like a name and 6 are something else. |
| B | `contact email` | 64 | Email address: 60 in valid form and 4 character-reversed |
| C | `date email sent first time` | 58 | Text `dd.mm.yy` in 29 cells, text `dd.mm.yyyy` in 25, true date in 4 |
| D | `date follow-up email sent` | 18 | Text in 17 cells, true date in 1 |
| E | `result` | 51 | Free text, 25 distinct values. Status is also expressed by fill colour. |
| F | `notes` | 50 | Free text, 28 distinct values. 12 cells are a bare web address. |
| G | no header | 2 | Stray cells in two tabs |

There is no column for laboratory, institution, country, role or sample size: the unit of every row is a person. The natural key of a row within its tab is the folded `contact name`, which is unique in every tab today. The outreach tabs contain no formula. Typed dates run from 11 October 2021 to 20 April 2023. The 119 name-like rows feed OutreachContact, one record per source row, with classification restricted, and the other six rows are kept as restricted annotations of their tab. They create no Person, no Laboratory, no Participation and no membership: the six rows with an accepting result and one row whose acceptance exists only as a green fill are offered to a reviewer as candidates. No real row of these tabs may be used as a test fixture.

The people involved are reported as counts. The 119 name-like cells hold 81 distinct person strings after folding, 30 of which appear in more than one tab, and 56 name-like rows have no email address. Among the six cells that are not one person's name are a pasted recipient list of 15 entries in a merged cell, a literature pointer that appears in two tabs, a to-do note, a section label and a cell naming two people with a role annotation. Five names end in `?` to mark a tentative candidate.

An importer has to respect the following. Blank rows occur inside the data area of five tabs, so reading continues to the end of the used range. Dates are day-first in three representations, two true dates have a day of 12 or less and stay ambiguous, and one follow-up date precedes its first-contact date. Reversed addresses are stored as found with a decoded candidate that is unused until confirmed. Fill colour is bucketed into red, green and none after theme colours are resolved, and it never contradicts the result text, although 9 rows with a result have no colour. Strike-through marks one candidate who is inferred to have been ruled out. Twenty-seven rows are exact copies of a row in a sibling tab and four people have differing content in two tabs, so copies are linked and nothing is merged. The stub study line `Study: Amodio` appears in `AmodioMaster20072008` and, contradicting the tab name, in `Vidal2000_`. Free text includes candid assessments of named people, one quoted private email reply and three links that carry access or session parameters, all of which stay restricted, with the parameters removed from any normalised address.

#### Tab `numberOfLabsPerReplication`

| Column | Header (verbatim) | Fill over 26 rows | Meaning and stored form |
|---|---|---|---|
| A | `StudyID` | 26, unique | Study identifier. Natural key. Row 2 holds the combined value `AmodioJost2007 + AmodioMaster2007`, so 26 rows stand for 27 studies. |
| B | `Leader` | 25 | Name of the lead. Blank on the combined row. |
| C | `NLabsSigned` | 22 | Number of laboratories signed up. Inferred. |
| D | `TotalNSubjectsToBeRun` | 22 | Planned total number of participants. Inferred. |
| E | `NLabsFinished` | 7 | Number of laboratories that finished data collection. Inferred. |
| F | `TotalNMainExpCollected` | 7 | Participants collected in the main experiment. Inferred. |
| G | `TotalNRest` | 5 | Participants with a resting-state recording. Inferred. |
| I, J | no row 1 header | 22 cells and 1 cell | A programme timeline in I5 to I26 under the label `Project's general timeline:`, and one note in J16 |

The study rows are rows 2 to 27, and the one table object of the workbook covers A1 to G27. Rows 30, 32 and 34 are derived and are never imported as data. They hold the eight formulas of the workbook: `=SUM(C2:C27)` and its counterparts for columns D to G in row 30, `=MEDIAN(C2:C27)` and `=MEDIAN(D2:D27)` in row 32, and `=SUM(D26,D20,D18,D13,F16,F10,D2)` in D34 under the label `projected by the end 2025`, a hand-built projection that mixes planned and collected numbers under an outdated label. All numeric cells are typed numbers stored as integral floats.

The five numeric columns feed HistoricalAggregate at replication level. They are imported append-only without a snapshot date, because the tab states no date for which its numbers hold; the export date is recorded on the batch and on the source record as the day on which the values were observed. A blank is stored as absent and never as zero: the tab contains exactly one explicit zero, in `TotalNRest`, and blanks have at least three inferred meanings. `TotalNMainExpCollected` and `TotalNRest` are separate counts that are never added. The combined Amodio row is stored with combined scope and its numbers are never apportioned between the two studies. The identifier and leader cells of four rows are struck through (`Carretie2004`, `DonkersvanBoxtel2004`, `Frank2005`, `Hajcak2006`), and these are exactly the rows without numbers. Strike-through is stored as a raw attribute and raises a status question without changing a status. `NLabsFinished` exceeds `NLabsSigned` in two rows, which is reviewed. The timeline has 22 entries from 2019 to `2026.10`. Four of them and the note name individuals, so the block is kept as a restricted programme annotation and its counts are never parsed. The per-study values are internal until a maintainer approves showing them and are therefore omitted here.

#### Tab `leadsEmails`

| Column | Header (verbatim) | Fill over 26 rows | Meaning and stored form |
|---|---|---|---|
| A | `StudyID` | 26, unique | The same 26 values in the same order as the other summary tab |
| B | `Old leader` | 4 | Former lead. All four cells are struck through. |
| C | `Leader` | 26 | Current lead. One cell holds two names separated by a comma. |
| D | `Email` | 23 | Email address of the lead, all distinct |
| E | no header | 1 | A second address on the row that names two leads |

The tab has no formula. It is a live roster that is partly stale: one row names a different lead from the other summary tab and the website, and leads are still listed for the four struck-through studies, three of them with an address. Leader values are imported as lead claims that a reviewer turns into memberships (section 5). The addresses are restricted contact details.

### 3.7 Source G: membership and contributor workbook

Source G could not be opened. The brief names three tabs, `list_members`, `study_description` and `contibutor_tables`, the last with its existing spelling, which is preserved wherever the tab is referred to. Tab visibility, header positions, row counts, formulas and data quality are unknown, and so are the fields of `study_description`. The brief does not say which tab holds the membership fields. `list_members` is the likely one by its name, which is unverified.

| Field group | Fields stated in the brief | Target and class, unverified |
|---|---|---|
| Membership | `name`, `surname`, `email`, `secondary_email`, `affiliation`, `country`, `EEG_system`, `whichReplication (Tags)`, `isCoauthor` | Person, with email addresses in the restricted contact record |
| Membership, special category | `gender`, `ethnicity` | The special-category demographics record of a Person, which decision D-006 keeps unreadable by any client |
| `contibutor_tables` | `ReplicationID`, `TableLink`, `IsOnlySignUpTable`, `IsPublished`, `PubLink`, `PDFLink` | The contributor-table registry of the logical model, and DocumentLink |

Until the workbook is read, three things stay open: the authoritative mapping from a contributor table to its replication, whether a table is a sign-up table or a published list, and whether contributor tables exist beyond the five below.

#### Contributor sheets linked from source G

Five contributor sheets were known and readable. Each is a separate workbook with one visible tab named `Sheet1`, a single header row in row 1 and no formula, merged cell, validation rule or hidden content. Nothing inside a file names its study, so the mapping to a replication comes from the brief and is corroborated only by the presence of the publicly listed lead in each mapped file. Each feeds Contributor, one record per row and workbook, with the 14 role values held on that record.

| Replication | Columns | Rows in the grid | Contributor rows | Filler or blank rows | Rows with email | Rows with ORCID | Role ticks | Corresponding-author flags |
|---|---|---|---|---|---|---|---|---|
| AmodioJost2007 | 25 | 1,028 | 37 (rows 2 to 38) | 963 filler, 27 blank | 23 | 4 | 124 | 1 |
| AmodioMaster2008 | 25 | 35 | 34 (rows 2 to 35) | 0 | 8 | 1 | 99 | 1 |
| Boksem2006 | 25 | 22 | 21 (rows 2 to 22) | 0 | 21 | 9 | 73 | 1 |
| BuschVanRullen2010 | 25 | 1,018 | 14 (rows 2 to 12 and 15 to 17) | 1,001 filler, 2 placeholder | 10 | 6 | 43 | 0 |
| DelCul2007 | 26 | 16 | 11 (rows 2 to 12) | 4 filler | 9 | 7 | 32 | 2 |

The two large files hold 37 and 14 contributors. Their filler rows contain nothing except unticked checkboxes stored as the boolean `FALSE`, so the only reliable test for a contributor row is the presence of a first name and a surname, and every row of the used range is evaluated: BuschVanRullen2010 has two numbered placeholder rows between contributor rows.

| Canonical field | Header variants (verbatim) | Notes |
|---|---|---|
| Order in publication | `Order in publication` | Header blank in AmodioMaster2008. DelCul2007 mixes numbers with the words `alphabetical` and `last` and leaves 7 rows blank. |
| First name, middle name, surname | `Firstname`, `Middle name`, `Surname` | Three columns in every file. Stored verbatim and never split, merged or re-cased. |
| Agreement | `I agree with the current version of the manuscript to be submitted` | AmodioJost2007 only. Boolean, 1 of 37 ticked. |
| Email | `Email address` | 71 cells over the five files, 59 distinct addresses. Restricted. |
| Affiliation | `Primary affiliation`, `Secondary affiliation`, or `Affiliation 1`, `Affiliation 2`, `Affiliation 3` | Free text. 136 cells, 65 distinct strings. |
| Funding statement | `Funding` | Free text, 15 cells. Restricted. |
| ORCID | `ORCID iD` | 27 cells, 26 distinct. In BuschVanRullen2010 the 6 identifiers sit under the header `Funding 2` and stay unmapped until a column override is stored, so 21 of the 27 reach a contributor on the first import. |
| Corresponding author | `Corresponding author?` | Boolean |
| Conflict of interest | `Conflict of interest` | Three files. One statement only: `no competing interest`. |
| Unmapped | blank header | AmodioMaster2008, last column: a boolean that is `FALSE` on all rows, of unknown meaning |

The 14 role headers are character-identical in all five files: `Conceptualization`, `Data curation`, `Formal analysis`, `Funding acquisition`, `Investigation`, `Methodology`, `Project administration`, `Resources`, `Software`, `Supervision`, `Validation`, `Visualization`, `Writing - original draft` and `Writing - review & editing`. Each carries a cell note with the role definition, and the 14 notes are identical across the files. Every role cell of every contributor row is a stored boolean.

No file states a natural key. First name with surname is unique within each workbook, which the importer uses under a keyed hash. Row number and order value are never part of a key, since both change with the author order. Column positions differ in every file: AmodioJost2007 inserts the agreement column, BuschVanRullen2010 orders the role columns differently, and the two template generations name and place the contact columns differently. Whole headers are matched, since `Funding acquisition`, `Funding` and `Funding 2` are three different columns. A blank header with data and a header that contradicts its content are never mapped by guesswork: each needs a stored, reviewed override per sheet. An unticked box means "not ticked in the source" and cannot be read as "did not contribute" or "disagrees": four contributor rows of DelCul2007 have no role at all. One ORCID fails its check digit, one email address contains a non-ASCII letter, one row of AmodioMaster2008 is highlighted in yellow without explanation, and one corresponding-author cell is blank.

Across the five files there are 117 contributor rows for 77 distinct people by folded first name and surname: 44 appear in one workbook, 30 in two, 1 in three and 2 in all five. The two Amodio lists share 33 people and differ in roles, order, affiliations and, for 2 people, email address. Of the 117 rows, 46 have neither an email address nor an ORCID, and 20 of the 77 people are known by name and affiliation only, so no Person is created or matched on a name alone. A contributor row grants no portal role, membership or access. All five are inferred to be working author lists for manuscripts in preparation and live records. Whether each is a sign-up table or a final list, and which manuscript it belongs to, is taken from source G or a maintainer and is never inferred from completeness.

### 3.8 Source H: website structured data

Source H is the set of four TSV files in `data/` from which the public website is built. They are flat UTF-8 text with one header line and a constant field count, so tab visibility and formulas do not apply. The build tool takes the first column of each file as the record key.

| File | Header | Data rows | Columns | Natural key | Last content change in git |
|---|---|---|---|---|---|
| `data/replications.tsv` | line 1 | 23 | 17 | `StudyId` | 23 April 2026 |
| `data/publications.tsv` | line 1 | 18 | 15 | `PublicationId` | 22 August 2026 |
| `data/people.tsv` | line 1 | 46 | 17 | `PersonId` | 23 September 2026 |
| `data/members.tsv` | line 1 | 300 | 5 | `PersonId`, in column 2 | 20 August 2026 |

Everything in the four files is public by origin. The public git history of the files is a dated record of what the website said, from 14 April 2024 onwards, and it is the evidence for the removal dates and lead changes cited in sections 4 and 5. If the portal later regenerates these files, the output has to keep the first column as key, `SequenceNumber` first in `members.tsv`, the literal `done` in `SignupUrl`, blank for "none", bare DOIs and the existing column names.

#### File `data/replications.tsv`

| Header | Meaning |
|---|---|
| `StudyId` | Record key, page anchor and figure file name |
| `PublicationId` | Link to `publications.tsv`. Filled on 12 rows, 2 of which point to no existing row. |
| `LeadFullName` | One lead per study. Equals the name of `PersonId` in `people.tsv` on 23 of 23 rows. |
| `Theme` | Filter value, 9 distinct |
| `LongStageText`, `StageNumber`, `StageName` | The stage stored three times, strictly one-to-one. Numbers in use: 4, 5, 6, 7 and 9. |
| `PersonId` | Link to the lead in `people.tsv`. Resolves on 23 of 23 rows. |
| `Authors`, `PublicationYear`, `Title`, `Reference`, `Doi` | The original study. `PublicationYear` is text and holds `2005a` and `2005b` on two rows. `Doi` is bare and unique. |
| `PsychConstruct` | Free text, 4 cells with a comma-separated list |
| `SignupUrl` | A form address on 11 rows and the literal `done` on 12 |
| `SignUpActive` | 1 on 11 rows and 0 on 12, duplicating the previous column |
| `allSignUpLinks` | Sign-up form of every study, including closed ones |

The stage coding has changed over time: the number 7 has meant three different things and the finished stage has been both 8 and 9, so a stage number has no stable meaning across the history. The study-to-publication link is stored in both files and the two copies disagree for 4 studies. One `allSignUpLinks` value is a form-editor address. The file names only one lead per study while `people.tsv` marks two leads for 6 studies.

#### File `data/publications.tsv`

| Header | Meaning |
|---|---|
| `PublicationId` | Record key, page anchor and file name of the PDF and preview |
| `ReplicationId` | Link to `StudyId`. Filled on 14 rows, all of which resolve. |
| `URLs` | Exactly one address per cell |
| `Status`, `StatusText` | `stage1` on 11 rows, `published` on 5, `preprint` on 2, with four display labels |
| `Journal` | Journal or preprint server, 6 distinct, two of them case variants of one server |
| `AuthorsShort`, `PublicationYear`, `Title` | Short author string, year (2021 to 2026) and title of the output |
| `DatePublishedNumber` | Date as a `YYYYMMDD` integer, used as sort key |
| `OSF` | Project page, 9 rows |
| `DataUrl`, `Data2Url` | Data locations, 3 and 2 rows |
| `Code` | Code repository, 1 row |
| `DOI` | Bare DOI, 18 rows, 5 with a version suffix |

`PublicationId` is unstable: three identifiers were renamed in the history, which is the cause of the two dangling links in `replications.tsv`. A DOI changes when a preprint is published, so it is no stable key for a manuscript either. Four publications belong to no study. Three data addresses embed the study identifier in the form `EEGManyLabs_Replication_<StudyId>_Raw` or `_Processed`. The file ends its lines with a carriage return and line feed.

#### File `data/people.tsv`

| Header | Meaning |
|---|---|
| `PersonId` | Record key and page anchor, first initial and surname in lower case |
| `FullName`, `HeadShotFilename` | Display name and portrait file |
| `Affiliation`, `Country` | Short institution name and country (15 distinct values) |
| `StudyId` | The study this person leads. Filled on 29 rows, 23 distinct, all of which resolve. |
| `SpinOffId` | Slug of a related-project page, 1 row |
| `LeadRole`, `SpinOffRole`, `CoordinatorRole`, `AdvisorRole`, `CoInvestigatorRole` | Role flags stored as 1 or 0 |
| `OtherRole` | Free-text tag, 5 rows |
| `DirectorRole` | 1 or blank, never 0 |
| `ScholarUrl`, `UniUrl`, `LabUrl` | Public profile addresses on 37, 37 and 16 rows |

The file has 46 rows where the README states an expected count of 45. Twenty-nine people lead the 23 studies. `Country` is `USA` on 1 row and `United States` on 7. The file mixes line endings.

#### File `data/members.tsv`

| Header | Meaning |
|---|---|
| `SequenceNumber` | Running number 1 to 300 in file order. It is the build key and is never used as a key by the importer. |
| `PersonId` | Hyphenated slug of the full name |
| `FullName` | Display name |
| `Affiliation` | Free text with 1 to 7 comma-separated parts, 168 distinct |
| `Country` | 28 distinct values |

The file has no study, role or link column, so a member cannot be attached to a replication from this source. The two people files use different identifier schemes, both derived from the name, and share no identifier. Two pairs of records look like the same person listed in both files, which goes to review, and the README total of 345 researchers equals 300 plus 46 less the one pair that the map script merges. On 283 of the 300 rows the last part of the affiliation repeats the country, in a different spelling on 101 of them, and institutions cannot be derived by exact string equality, so every grouping of affiliation strings into an institution is a reviewed decision.

### 3.9 Source I: Quire

Nothing about the programme's Quire workspace has been observed. The number of organisations, projects, tasks and comments, the subscription plan and the user list are all unknown, and this section rests on Quire's published documentation as read on 9 November 2026.

According to that documentation a project can be exported from the interface as CSV or JSON. The CSV form is lossy: it carries display names, locale-formatted dates and task numbers, and no object identifiers. The JSON form is a tree of tasks with their comments, together with the project's tags, users, sublists, documents and chats, and the field names inside an exported task are undocumented. The programming interface uses OAuth 2.0 only, is rate-limited per organisation according to the plan, and reserves project export and subtree listing for the Professional plan and above. Projects, tasks, comments, users and tags carry an object identifier (`oid`), which is the natural key, while a status is keyed by a number within its project and an attachment has no identifier. A task also has an integer `id` that is unique only within its project and is preserved, together with the project identifier, as the legacy number that users know.

Several things cannot be recovered by any documented route: the activity history and with it earlier values and the time of each change, deleted tasks and comments, attachment file content, member roles, folder structure and the position of a task in the tree as a number. Email addresses of colleagues are returned only when the authorising user grants contact access, which matters for account claiming.

The proposed route is a pull run locally by an organisation administrator after the workspace has been frozen. It archives the raw JSON and CSV exports with their hashes, reads the documented interface, and imports the result idempotently into the task entities of the data model with the Quire identifiers as provenance and a report of every field that could not be recovered. Until an export or an authorisation exists the importer is built against fixtures derived from the documented examples.

### 3.10 Source J: Google Drive, Docs, OSF and other linked documents

Source J is the set of documents that the other sources link to: sign-up forms, information sheets, a power-calculation document, study descriptions and project pages on OSF, data and code repositories, and the contributor sheets. It has no tabs. Each link becomes a DocumentLink with its address as written, its access status and the SourceRecord it came from. Section 6 gives the inventory by kind and host class. No content of any linked document was read, apart from the five contributor sheets described in section 3.7, and nothing behind Google sign-in could be discovered.

## 4. Cross-source study-identifier reconciliation

The canonical identifier of a replication is the programme's study identifier, unchanged, as decision D-013 records. There are 27. The set is byte-identical in four places: column `Original Name` of source B, column `StudyID` of the tab `list of studies` in source D, column `study_id` of the hidden tab `review` in source E, and the file names in `assets/images/figures/`. The current `data/replications.tsv` holds 23 of the 27, and the earliest public version of that file (14 April 2024) held all 27. Source C and the contributor sheets contain no study identifier. The other tabs of source D have no identifier column and are matched by DOI.

Matching was done in four steps and nothing was matched on similarity of spelling alone: exact equality, then equality after folding (decomposition, removal of diacritics, lower case, letters and digits only), then, for tab names, a canonical identifier as prefix with a known suffix confirmed by the DOI in the tab's study line, and, for the link labels of source E, the identifier in column A of the same row. The 27 identifiers stay distinct after folding. In the table, "yes" means that the canonical spelling occurs exactly, a quoted string is a different spelling found in that place, and a dash means absent.

| # | Canonical identifier | H `replications.tsv` | H `publications.tsv` | E `study_id` (rows) | E link label | F outreach tabs | F summary tabs |
|---|---|---|---|---|---|---|---|
| 1 | `AmodioJost2007` | yes | yes | yes (1) | yes | - | inside the combined cell only |
| 2 | `AmodioMaster2008` | yes | yes | yes (2) | yes | - | - |
| 3 | `Boksem2006` | yes | - | yes (2) | yes | `Boksem2006`, `Boksem2006_labs` | yes |
| 4 | `BuschVanRullen2010` | yes | - | yes (1) | yes | `BuschVanRullen2010` | yes |
| 5 | `Carretie2004` | - | - | yes (2) | yes | `Carretie2004` | yes, struck through |
| 6 | `ClarkHillyard1996` | yes | yes | yes (2) | yes | - | yes |
| 7 | `DelCul2007` | yes | - | yes (2) | yes | `DelCul2007` | yes |
| 8 | `DonkersvanBoxtel2004` | - | - | yes (1) | yes | `DonkersvanBoxtel2004 lead`, `DonkersvanBoxtel2004` | yes, struck through |
| 9 | `Eimer1993` | yes | yes | yes (1) | yes | - | yes |
| 10 | `Eimer1996` | yes | yes | yes (1) | yes | - | yes |
| 11 | `Eimer2003` | yes | yes | yes (1) | yes | - | yes |
| 12 | `Frank2005` | - | - | yes (1) | yes | `Frank2005 lead`, `Frank2005` | yes, struck through |
| 13 | `Hajcak2003` | yes | yes | yes (1) | yes | - | yes |
| 14 | `Hajcak2006` | - | - | yes (2) | `Hajack2006` | `Hajcak2006` | yes, struck through |
| 15 | `HajcakFoti2008` | yes | yes | yes (1) | yes | - | yes |
| 16 | `HajcakHolroyd2005` | yes | yes | yes (3) | `HajackHolroyd2005` | - | yes |
| 17 | `HajcakMoser2005` | yes | yes | yes (2) | yes | `HajcakMoser2005` | yes |
| 18 | `Inzlicht2009` | yes | yes | yes (1) | yes | `Inzlicht2009` | yes |
| 19 | `Luck1996` | yes | - | yes (1) | yes | `Luck1996` | yes |
| 20 | `Mathewson2009` | yes | yes | yes (1) | yes | - | yes |
| 21 | `Miltner1999` | yes | yes | yes (1) | yes | `Miltner1999`, `Miltner1999 replicating labs se` | yes |
| 22 | `Muller2003` | yes | - | `Müller2003` (1) | yes | `Müller2003 replicating labs sea` | yes |
| 23 | `Onton2005` | yes | - | yes (1) | yes | `Onton2005 lead`, `Onton2005` | yes |
| 24 | `Sergent2005` | yes | - | yes (2) | yes | - | yes |
| 25 | `Vidal2000` | yes | - | yes (1) | yes | `Vidal2000`, `Vidal2000_` | yes |
| 26 | `VogelMachizawa2004` | yes | yes | yes (1) | yes | - | yes |
| 27 | `YeungSanfey2004` | yes | - | yes (2) | yes | - | yes |

The summary tabs of source F hold 25 identifiers exactly, plus one combined cell that stands for the two Amodio studies. Twenty of the 21 outreach tab names resolve, to 14 studies, six of which have two tabs.

| Variant as written | Canonical identifier | Where it occurs | Kind of variant |
|---|---|---|---|
| `Müller2003` | `Muller2003` | E `links_hypotheses`, cell A32 | Diacritic |
| `Hajack2006` | `Hajcak2006` | E `links_hypotheses`, link labels in C20 and C21 | Transposed letters |
| `HajackHolroyd2005` | `HajcakHolroyd2005` | E `links_hypotheses`, link labels in C23 to C25 | Transposed letters |
| `Müller2003 replicating labs sea` | `Muller2003` | F tab name | Diacritic, suffix, cut at 31 characters |
| `Miltner1999 replicating labs se` | `Miltner1999` | F tab name | Suffix, cut at 31 characters. The study line has no DOI. |
| `DonkersvanBoxtel2004 lead`, `Frank2005 lead`, `Onton2005 lead` | the identifier before the suffix | F tab names | Suffix ` lead` |
| `Boksem2006_labs` | `Boksem2006` | F tab name | Suffix `_labs` |
| `Vidal2000_` | `Vidal2000` | F tab name | Trailing underscore. Resolved with a review flag, see below. |

In source E, column A and the link label of the same row disagree on 6 of 38 rows. Two further notations explain several variants without being identifier variants themselves. The paper of `AmodioMaster2008` has a DOI that contains 2007. It is cited with the year 2008 in D `list of studies`, in D `allranked_archived` and in source E, and with 2007 in other tabs of source D (section 7 records which). Source F writes `AmodioMaster2007` and `AmodioMaster20072008`. The website gives `PublicationYear` as `2005a` and `2005b` for `HajcakHolroyd2005` and `HajcakMoser2005`, where the identifiers and every other source say 2005. Beyond spellings, each study has three deliberate alternative names in source B (section 3.2) and, for two studies, a fifth form in the names of the data repositories listed in `data/publications.tsv`.

Four identifiers are present in the workbooks and absent from the current website data. Their spelling is identical in every source that has them, so the match is certain and only their status is open. None of them is deleted or archived automatically: each is imported with its source statuses side by side and a ReconciliationItem asking for the programme's decision.

| Identifier | B | D `list of studies`, stage | E `links_hypotheses` | F `numberOfLabsPerReplication` | F `leadsEmails` | Removed from `data/replications.tsv` | Figure file |
|---|---|---|---|---|---|---|---|
| `Carretie2004` | present | `Looking for replicating labs (stage 3)` | 2 rows, hidden, `cancelled` | struck through, no numbers | listed, no strike-through | after 19 December 2025, by 23 April 2026 | still present |
| `DonkersvanBoxtel2004` | present | `Currently put on hold` | 1 row, hidden, `cancelled` | struck through, no numbers | listed, no strike-through | after 16 January 2025, by 7 April 2025 | still present |
| `Frank2005` | present | `Currently put on hold` | 1 row, hidden, `cancelled` | struck through, no numbers | listed, no strike-through | after 16 January 2025, by 7 April 2025 | still present |
| `Hajcak2006` | present | `Looking for replicating labs (stage 3)` | 2 rows, hidden, `cancelled` | struck through, no numbers | listed, no strike-through | 7 August 2025 | still present |

The following identifiers could not be matched and are left unresolved. Each is stored as written, creates no Replication and raises a ReconciliationItem for an unmatched identifier, with the evidence.

| Identifier or record | Where | Evidence | Why it stays unresolved |
|---|---|---|---|
| `AmodioMaster2007`, inside the combined cell `AmodioJost2007 + AmodioMaster2007` | F `numberOfLabsPerReplication` A2 and `leadsEmails` A2 | The spelling occurs nowhere else in any source or in the website history. `AmodioMaster2008` is the candidate, since the same paper is cited with both years and no source lists a third Amodio study. | The match rests on a year correction, which is not a spelling rule, and the row is an aggregate for two studies. |
| `AmodioMaster20072008` | F tab name, hidden | The study line reads `Study: Amodio` with no reference and no DOI. The lead line names the former lead recorded on the combined row. | It could mean one paper with both year notations or both Amodio studies. Nothing in the workbook decides this. |
| `Vidal2000_` | F tab name, visible | Tab name and lead line point to `Vidal2000`, while the study line reads `Study: Amodio`. | Resolved to `Vidal2000` with medium confidence. The contradiction is shown to a reviewer. |
| Two shortlisted papers without a study identifier | D `shortlist_archived`, rows 30 and 31, and `Sheet5` | DOIs `10.1038/nn1197` and `10.1016/j.clinph.2005.07.005` | They never received an identifier. They are keyed by DOI, and no identifier of the programme's form is invented for them. |
| Six papers of the alpha-asymmetry subproject | D `AlphaAsymmetry_RSSubproject`, rows 3 to 8 | Four have a DOI in the citation and two are matched to `allranked_archived` by title. | No identifier exists. |
| 104 further nominated papers | D `allranked_archived` | Never shortlisted. Two of them have no DOI. | No identifier exists. They are kept as archived candidates keyed by DOI or by a reviewed title match. |

## 5. Lead conflicts

Eight places name a study lead. Two are in the website data: `LeadFullName` of `data/replications.tsv` (23 studies) and the rows of `data/people.tsv` with `LeadRole` 1 (29 people for the same 23 studies, with two people for 6 of them). Two are in source D: column `Lead Replicating Lab` of `list of studies` (27 rows) and of `shortlist_archived` (14 of 29 rows). Four are in source F: `Leader` of `numberOfLabsPerReplication` (25 of 26 rows), `Leader` of `leadsEmails` (26 rows), `Old leader` of `leadsEmails` (4 rows) and the lead line of an outreach tab (14 tabs). Source A is expected to name leads as well and could not be compared.

In the table the reference lead is the person named in `data/replications.tsv` or, for the four studies absent from the website, in D `list of studies`. "same" means that the place names the reference lead, "same +1" that it names the reference lead and one further person, "other" that it names a different person, and a dash that the cell is blank or the place has no row or tab for the study. Names are withheld throughout.

| Study | H replications | H people | D list | D shortlist | F numberOfLabs | F leadsEmails | F Old leader | F lead line | Places naming a lead | People named | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `AmodioJost2007` | same | same +1 | same | - | - | same (combined row) | other (combined row) | - | 5 | 3 | disagree |
| `AmodioMaster2008` | same | same | same | - | - | other (combined row) | other (combined row) | other (unresolved tab) | 6 | 3 | disagree |
| `Boksem2006` | same | same | other | - | same, spaced differently | other | - | - | 5 | 2 | disagree |
| `BuschVanRullen2010` | same | same | same | - | same | same | - | same | 6 | 1 | agree |
| `Carretie2004` | - | - | same | other | same | same | other | same | 6 | 3 | disagree |
| `ClarkHillyard1996` | same | same | same | same | same | same | - | - | 6 | 1 | agree |
| `DelCul2007` | same | same | same | - | same | same | other | other | 7 | 2 | disagree |
| `DonkersvanBoxtel2004` | - | - | same | - | same | same | - | same | 4 | 1 | agree, D and F only |
| `Eimer1993` | same | same | same | - | same | same | - | - | 5 | 1 | agree |
| `Eimer1996` | same | same +1 | same | same | same | same | - | - | 6 | 2 | agree on the named lead |
| `Eimer2003` | same | same | same | same | same | same | - | - | 6 | 1 | agree |
| `Frank2005` | - | - | same | - | same | same | - | same | 4 | 1 | agree, D and F only |
| `Hajcak2003` | same | same +1 | same | same | same | same +1 | - | - | 6 | 2 | disagree: one lead or two |
| `Hajcak2006` | - | - | same | same | same | same | - | same | 5 | 1 | agree, trailing space only |
| `HajcakFoti2008` | same | same | same | other | same | same | other | - | 7 | 2 | disagree |
| `HajcakHolroyd2005` | same | same +1 | same | same | same | same | - | - | 6 | 2 | agree on the named lead |
| `HajcakMoser2005` | same | same | same | same | same | same | - | same | 7 | 1 | agree |
| `Inzlicht2009` | same | same | same | - | same | same | - | same | 6 | 1 | agree |
| `Luck1996` | same | same | same | - | same | same | - | same | 6 | 1 | agree |
| `Mathewson2009` | same | same | same | same | same | same | - | - | 6 | 1 | agree |
| `Miltner1999` | same | same +1 | same | other | same | same | - | same | 7 | 3 | disagree |
| `Muller2003` | same | same | same | - | same | same | - | same | 6 | 1 | agree |
| `Onton2005` | same | same | same | - | same | same | - | same | 6 | 1 | agree |
| `Sergent2005` | same | same | same | same | same | same | - | - | 6 | 1 | agree |
| `Vidal2000` | same | same | same | - | same | same | - | same | 6 | 1 | agree |
| `VogelMachizawa2004` | same | same +1 | same | same | same | same | - | - | 6 | 2 | agree on the named lead |
| `YeungSanfey2004` | same | same | same | same | same | same | - | - | 6 | 1 | agree |

Thirteen studies agree in every place that names a lead. Three more agree on the named lead and have a second lead in `data/people.tsv` only, where no source says whether the second person is a co-lead or the first author of the report. Two agree between D and F and are absent from the website. One differs by a trailing space only. Eight studies have a substantive disagreement.

| Study | Nature of the disagreement | What the public website history adds |
|---|---|---|
| `AmodioJost2007` | The website, D and `leadsEmails` agree on the current lead, the other F summary tab is blank, `Old leader` names a former lead, and `people.tsv` adds a second lead. The F row covers two studies. | The website lead changed on 30 July 2025. |
| `AmodioMaster2008` | The website and D name one person. The combined F row names the lead of the other Amodio study. `Old leader` and the lead line of the unresolved tab name a third person. The website lead appears nowhere in source F. | The website lead is unchanged since 14 April 2024. |
| `Boksem2006` | The website and one F tab name one person. D and the other F tab name another. | The website lead changed on 14 April 2025. D and `leadsEmails` are inferred to be stale. |
| `Carretie2004` | Three different people: D `list of studies` and three F places, D `shortlist_archived`, and `Old leader`. The shortlist names the person whom `list of studies` gives as lead of another study, so a misplaced cell cannot be excluded. | The website named the first of the three from 14 April 2024 until the study was removed. |
| `DelCul2007` | Five places agree on the current lead. `Old leader` and the tab's lead line name a former lead. | The website lead is unchanged since 14 April 2024. The lead line is inferred to be stale. |
| `Hajcak2003` | Four places name one lead. `leadsEmails` holds two names in one cell, and `people.tsv` marks both as leads. | The second lead was added to `people.tsv` by 18 June 2025. |
| `HajcakFoti2008` | Five places agree on the current lead. D `shortlist_archived` and `Old leader` name an earlier lead. | Both people were listed for the study in 2024 and early 2025, and only the current lead by 18 June 2025. |
| `Miltner1999` | Six places name the current lead. D `shortlist_archived` names a different, earlier person, and `people.tsv` adds a second lead. | The website lead is unchanged since 14 April 2024. |

Within source F, `Old leader` differs from `Leader` on all four rows where it is filled, the two summary tabs agree on the leader string on 23 of 26 rows, and 12 of the 14 lead lines equal the current `Leader`. No source dates a lead change recorded only in `Old leader`, and for two studies the former lead appears in no tracked version of the website TSV files. Neither D `list of studies` nor the website can be declared newer as a whole, because the rows of D were updated one at a time (inferred), so a conflict between them is reviewed field by field.

A lead is never resolved by choosing a value. The reports on F and H propose to import lead names as dated lead claims, one per source cell, from which a reviewer writes the membership, and the report on H lets the importer write a membership as confirmed by agreement only where every place agrees. The data model stores conflicting leads as memberships marked as needing review. Under either form a ReconciliationItem for conflicting leads is raised, and the choice between the two forms is open. A lead claim from D or F is internal even when the same name is public elsewhere, and under decision D-005 a role with management powers that is implied by imported data starts in a pending state.

## 6. Linked documents discovered

The inventory below counts the links found in the accessible sources. Sources B and C contain no link. Addresses are deliberately not reproduced. Hosts of personal websites and of institutional pages about one person are withheld and counted.

| Kind | Host class | Where found | Occurrences | Distinct | Probed |
|---|---|---|---|---|---|
| Sign-up form | Google Forms, as short links and as full form addresses | D `list of studies` X (27), D `shortlist_archived` X (1), H `allSignUpLinks` (23) and `SignupUrl` (11) | 62 | 27. One is a form-editor address. | none |
| Information sheet for a study | Google Docs | E `links_hypotheses` C | 38 | 27 | 1 |
| General information on the prediction markets | Google Docs | E `links_hypotheses` C45 | 1 | 1 | none |
| Power-calculation document | Google Docs | D `list of studies` P | 1 | 1 | none |
| Contributor sheet | Google Sheets | Known list of five. The brief places the authoritative list in G `contibutor_tables`, which was not opened. | 5 | 5 | all five opened and inspected |
| Drive folder | Google Drive | none found in the accessible sources | 0 | 0 | not applicable |
| Study description | OSF | E `links_hypotheses` B | 38 | 27 | 1 |
| Project page | OSF | H `publications.tsv` `OSF` (9, one of them through the DOI resolver), D text cells (4) | 13 | not established | none |
| DOI of a published paper, mostly the original studies | DOI resolver | D, all six tabs (71 links or addresses in text, and 138 bare DOIs), E `citation` (38), F study lines (17), H `Reference` and `Doi` (23 each) | 310 | 27 for the 27 studies, and 137 in D `allranked_archived` | 1 |
| Programme publication | DOI resolver, Europe PMC, OSF and publisher pages | H `publications.tsv` `URLs` (18, of which 3 on OSF) and `DOI` (18) | 36 | 18 publications | none |
| Data repository | GIN and its DOI prefix | H `publications.tsv` `DataUrl` and `Data2Url` | 5 | 5 | none |
| Code repository | GitHub | H `publications.tsv` `Code` | 1 | 1 | none |
| Article page | Publisher sites | F `notes` and one stray cell (7), D `list of studies` R (1) | 8 | not established | none |
| Web calculator | Two application hosts | D `list of studies` I and K, D `shortlist_archived` K | 4 | not established | none |
| Shared file | A file-sharing service | D `list of studies` Q, `shortlist_archived` Q, `questionnaires` A | 3 | 1 | none |
| Page about one person | Institutional staff pages, personal websites and a thesis repository, withheld | F `notes` (6 links and 2 text cells) | 8 | 7 hosts | none |
| Public profile of a core-team member | Scholar profiles, university pages and laboratory websites | H `people.tsv` `ScholarUrl` (37), `UniUrl` (37), `LabUrl` (16) | 90 | 37, 37 and 16 | none |
| Person identifier | ORCID | Contributor sheets: 27 cells, 6 of them hyperlinks | 27 | 26 | none |

Source F also contains five mail links, which are addresses of people and are left out of the inventory, and it contains no Google Drive, Google Docs, OSF or form link at all. Three of its links carry an access token or session parameters.

Three addresses were probed without credentials, one per host class of source E, and their content was discarded. The information sheet answered with success and without a redirect to a sign-in page, so that document is readable anonymously. Whether an anonymous visitor can also edit it was not tested, and the stored addresses are edit links. The DOI resolved to a publisher page after four redirects. The OSF page answered with success, but a made-up address on the same host returned the identical page, so the status of an OSF page proves nothing. A status-only request through the OSF programming interface distinguished the real identifier from the made-up one, and link health for OSF has to be checked there.

Everything else is unprobed: 79 of the 82 distinct targets of source E, and every link of sources D, F and H and of the contributor sheets. Apart from the one DOI that was probed, no DOI was checked against a resolver, and the one known typo was found by comparing tabs. No further linked document was opened, so the owner, title, modification time and content of each are unknown. Documents and folders behind Google sign-in could not be discovered at all, and the tab `contibutor_tables` of source G, which is expected to list further spreadsheets, was out of reach. Each DocumentLink therefore starts with an access status of unknown, and the Google Docs targets are treated as internal links until a maintainer confirms their sharing mode.

## 7. Known gaps and unknowns

No export records when its sheet was last changed, and no export carries an author, an owner, sharing settings, a revision history or discussion comments. The modification time has to come from the Drive interface once credentials exist. Until then the only dating evidence is what the content happens to contain.

| Source | Modification time in the snapshot | Dating evidence in the content |
|---|---|---|
| A, G | not obtained | none |
| B, C | none. The archive members carry the export time only. | none in either sheet |
| D | none | No date-typed cell. The stage wording of `list of studies` matches the 2024 wording of the website, and its rows were updated one at a time (inferred). |
| E | none | One typed footer note dated `08.2026` |
| F | none | Outreach dates from 11 October 2021 to 20 April 2023. Timeline entries up to `2026.10`. A projection labelled for the end of 2025. |
| Contributor sheets | none | none |
| H | git history | Last content changes between 23 April 2026 and 23 September 2026 (section 3.8) |
| I | not obtained | none |
| J | not obtained | none |

The remaining unknowns are listed by source with what would settle each.

| Source | Unknown | What would settle it |
|---|---|---|
| A | Every tab, header, row count, formula and value. Whether it duplicates the summary tab of source F. | Read access through a Google service account |
| G | Every tab, header, row count and value, including the fields of `study_description`, the mapping of contributor tables to replications, and whether further contributor tables exist | Read access through a Google service account |
| B | Which cloud service the account names belong to, whether the accounts exist, which BIDS entity the BIDS name fills, the meaning of the third `Explanation` token, and whether the two Amodio replications share one dataset record | The maintainers |
| C | Whether the sheet is registered with the external vocabulary tool chain, which `invalid_reason` values are allowed, whether the validation rule rejects or only warns, and whether the sheet or the portal is the system of record | The sheet owner |
| D | The purpose of `Sheet5` and the rule behind its 17 entries, whether the alpha-asymmetry subproject is active, whether DOIs other than the detected typo resolve, and whether the sheet can be edited by anyone with the link | The maintainers and a resolver check |
| E | What a blank `replicated` means, what `yes` or `no` means on a `null` hypothesis, and whether `cancelled` refers to the study, the market item or both | The owners of the prediction market |
| F | The date for which the summary numbers hold, whether the lead laboratory is included in `NLabsSigned`, whether resting-state participants are a subset of main-experiment participants, which study the timeline counts as inspired by the programme, whether the visible outreach tabs are still edited, and why the workbook has 23 tabs where 25 were expected | The maintainers |
| F and contributor sheets | Sharing settings. Both hold email addresses and were readable by link. Decision item 8 in `docs/DECISIONS.md` asks for link sharing to be restricted once the import is verified. | The sheet owners |
| Contributor sheets | Which manuscript each list belongs to, whether it is a sign-up table or a final list, the meaning of one unlabelled boolean column and of one highlighted row, and whether `Funding 2` was meant to be the ORCID column | Source G and the maintainers |
| H | Whether any external address in the files still resolves, why four studies were removed and whether they are cancelled, paused or unlisted, and whether the six second leads are co-leads | A link check and the maintainers |
| F | Whether `AmodioMaster2007` means `AmodioMaster2008`, and whether the tab `AmodioMaster20072008` covers one study or two | The maintainers |
| I | Plan, projects, tasks, users, the real field names of an export, and whether attachments and colleague addresses can be retrieved | An export file or an authorisation |
| J | Owner, title, modification time, sharing mode and content of every linked document | Credentials and a link check |

The discovery reports differ from each other on the points below. Each is stated as found.

| Point | What the reports say | Status |
|---|---|---|
| Number of studies with an outreach tab in source F | The report on F counts 15 studies with a tab and 12 without. The reconciliation report counts 14 and 13. The difference is the unresolved tab `AmodioMaster20072008`, which the first count attributes to `AmodioMaster2008`. | Open until the tab is resolved |
| Where source D cites the paper of `AmodioMaster2008` with the year 2007 | The report on D names `shortlist_archived` and `questionnaires`. The reconciliation report names `shortlist_archived` and `Sheet5`. Both agree that `list of studies` says 2008. | Settled by the first real import: `shortlist_archived` and `questionnaires` date the paper 2007, and both Amodio citations of `Sheet5` say 2007; `list of studies` and `allranked_archived` say 2008. Both reports were right in part. |
| Identifier of a Replication document | The reports on D and H use the study identifier verbatim. The reports on B, E and F use the folded form as match key. | Settled by decision D-013: the identifier is used unchanged and other spellings resolve through a folded lookup. |
| Identity of a StudyAlias | The reports on E and F derive it from scheme and alias. The reports on B and H add the replication, because `Amod` and `AMO` each name two studies. | Settled by decision D-013, which follows B and H: an alias is unique only together with its replication. |
| Key of an original paper | The report on D uses the prefix `pub_` with a hash of the DOI. The reports on E and H use `doi_`, and the H report describes that form as the one used by D. | Open |
| Identifier of a source record | The reports on B, C, E and F embed the spreadsheet identifier. The contributor report uses a hash of it. The report on D uses a batch key from the file hash and, for raw rows, the row number, which the other reports exclude from keys. | Open. Decision D-012 keeps source identifiers in private configuration, which argues for the hashed form. |
| Key of a vocabulary term | The report on D joins vocabulary and slug with a double underscore. The other reports join kind and folded value with a single underscore. | Open |
| How a lead named by a source is stored | The report on D maps the lead column to a membership directly, with the shortlist value as a historical one. The reports on F and H propose lead claims that become memberships only through review. The data model stores conflicting leads as memberships marked as needing review. | Open (section 5) |
| Whether a name alone identifies a person | The report on D resolves the name of a lead, extractor or reviewer against the person registry by normalised name and gives an unresolved name a placeholder key derived from that name. The reports on F and H and the contributor report match a person on a verified identifier and never on a name alone. | Open |

## 8. Record counts per source and tab

Counts are data rows as defined in section 3, taken from the snapshots of 9 November 2026 and, for source H, from commit `b0c0f04`.

| Source | Tab or file | Unit of a record | Data rows | Notes |
|---|---|---|---|---|
| A | unknown | unknown | unknown | Not inspected |
| B | `Sheet1` | study | 27 | 4 alias schemes per row, 108 aliases |
| C | `Sheet1` | vocabulary term | 26 | 9 terms with an external concept reference |
| D | `list of studies` | study | 27 | |
| D | `shortlist_archived` | candidate study | 29 | 27 map to a study identifier |
| D | `allranked_archived` | nominated paper | 139 | 780 vote cells |
| D | `questionnaires` | questionnaire entry | 12 | Hidden |
| D | `AlphaAsymmetry_RSSubproject` | candidate paper | 6 | 3 marked excluded |
| D | `Sheet5` | abbreviated citation | 17 | Hidden. No entity created. |
| E | `links_hypotheses` | hypothesis | 38 | 27 studies. 6 rows hidden. 3 footer rows excluded. |
| E | `review` | study | 27 | Hidden |
| E | `questions4MarketsNSurvey` | question, option or heading | 34 | |
| F | `numberOfLabsPerReplication` | study row | 26 | Stands for 27 studies. 3 derived rows excluded. |
| F | `leadsEmails` | study row | 26 | Stands for 27 studies |
| F | `Vidal2000` | contacted or candidate person | 5 | |
| F | `DonkersvanBoxtel2004 lead` | contacted or candidate person | 15 | |
| F | `Frank2005 lead` | contacted or candidate person | 1 | |
| F | `Boksem2006` | contacted or candidate person | 12 | |
| F | `Miltner1999` | contacted or candidate person | 13 | |
| F | `Miltner1999 replicating labs se` | contacted or candidate person | 7 | |
| F | `Onton2005 lead` | contacted or candidate person | 10 | |
| F | `BuschVanRullen2010` | contacted or candidate person | 4 | |
| F | `Luck1996` | contacted or candidate person | 2 | |
| F | `Carretie2004` | contacted or candidate person | 0 | Preamble and header only |
| F | `Frank2005` | contacted or candidate person | 0 | Preamble and header only |
| F | `DonkersvanBoxtel2004` | contacted or candidate person | 7 | |
| F | `Müller2003 replicating labs sea` | contacted or candidate person | 2 | |
| F | `Onton2005` | contacted or candidate person | 4 | |
| F | `AmodioMaster20072008` | contacted or candidate person | 1 | |
| F | `Vidal2000_` | contacted or candidate person | 1 | |
| F | `Boksem2006_labs` | contacted or candidate person | 16 | 12 rows copied from `Boksem2006` |
| F | `DelCul2007` | contacted or candidate person | 9 | |
| F | `Inzlicht2009` | contacted or candidate person | 1 | |
| F | `Hajcak2006` | contacted or candidate person | 6 | |
| F | `HajcakMoser2005` | contacted or candidate person | 9 | |
| F | all 21 outreach tabs | contacted or candidate person | 125 | 119 name-like rows, 81 distinct person strings. The importer classes them as 119 data rows and 6 annotation rows. |
| G | `list_members`, `study_description`, `contibutor_tables` | unknown | unknown | Not inspected. Tab names as the brief gives them. |
| G, linked | Contributor sheet AmodioJost2007, `Sheet1` | contributor | 37 | 1,028 rows in the grid |
| G, linked | Contributor sheet AmodioMaster2008, `Sheet1` | contributor | 34 | |
| G, linked | Contributor sheet Boksem2006, `Sheet1` | contributor | 21 | |
| G, linked | Contributor sheet BuschVanRullen2010, `Sheet1` | contributor | 14 | 1,018 rows in the grid. 2 placeholder rows. |
| G, linked | Contributor sheet DelCul2007, `Sheet1` | contributor | 11 | |
| G, linked | all five contributor sheets | contributor | 117 | 77 distinct people |
| H | `data/replications.tsv` | replication | 23 | |
| H | `data/publications.tsv` | publication | 18 | 14 linked to a study |
| H | `data/people.tsv` | core-team member | 46 | 29 lead a study |
| H | `data/members.tsv` | member | 300 | |
| H | files of the checkout | committed file | 76 | Read when the data sits in a checkout: PDFs, previews, portraits and people pages. 18 are named by a record, 52 are kept raw and 6 have no record. |
| I | unknown | project, task, comment | unknown | No export and no token |
| J | not applicable | linked document | see section 6 | 27 sign-up forms, 29 Google Docs, 5 contributor sheets and 27 OSF study descriptions among them |
