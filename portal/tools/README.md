# Portal tools

Admin SDK command-line tools for the members' portal: seeding, the tools for identity and access, and the importers that migrate the programme's sources. They run with full access to the database, outside the security rules, so they run only from a trusted environment and never from the public site. `docs/MIGRATION_PLAN.md` specifies what the importers do, and `docs/DATA_MODEL.md` specifies what they write.

Run every command from the `portal` directory, through its npm script or as `npm run -w @eegml/tools cli -- <command>`. A command writes to the Local Emulator Suite only and refuses to start when it cannot tell that its target is an emulator. `node scripts/emulators.mjs run <command>` supplies the emulator addresses of the current port base.

## Identity and access

| Command | What it does |
|---|---|
| `npm run seed:demo` | Writes the synthetic demonstration world to the emulators: persons, laboratories, institutions, replications, two demonstration accounts and a bootstrap record. Emulator only. The fixtures are in `src/fixtures/` |
| `npm run admin:bootstrap -- --email <address>` | Prepares the first programme administrator. It stores one record under the keyed hash of the address in `bootstrapAdmins`, and the function `sessionStart` makes the first account that signs in with that address, verified, a programme administrator. The address is neither stored nor printed. It does reach the history of the shell it is typed in |
| `npm run access:rebuild` | Resolves the access document of every account again from its sources and writes each one that differs. A second run writes nothing. A document that does not fit its schema confers nothing and is named on the error stream |

`admin:bootstrap` and `access:rebuild` write to the emulators unless `--production --project <identifier>` and credentials are given together, under the rules of `import run` below. For a real project `admin:bootstrap` reads the key of the hash from the private configuration, which must be the key that the functions of that project read from the secret `IDENTITY_HASH_KEY`. For the emulators it uses the public demonstration key, as the functions emulator does, unless `IDENTITY_HASH_KEY` is set in the environment.

## Backups and restore rehearsal

| Command | What it does |
|---|---|
| `npm run restore:rehearse` | The rehearsal on the emulators, in two sessions (`scripts/restore-rehearsal.mjs`). `restore:capture` seeds the demonstration world, writes an audit entry and a synthetic object in Storage, and writes the manifest; the emulators export when it ends. `restore:verify` runs in fresh emulators started from that export: it compares every document, account and object with the manifest, reads the audit trail back through its schema, asks the rules as a browser would whether an allowed read is still allowed and denied reads still denied, then changes one document, removes another and removes the object, and checks that the comparison names exactly those three. The dated report goes to `.run/<port base>/restore-rehearsal/<time>/report.md`. Exit status 3 when a check fails |
| `backup:manifest --out <file> [--database <id>] [--bucket <name>\|default] [--accounts]` | Writes a manifest: every document path with a SHA-256 of its fields, and optionally every account and every object. A manifest holds paths and hashes and never a value. It only reads, and reaches a real project only with `--production --project <identifier>` and credentials, as an import does |
| `backup:compare <backup> <restore>` | Lists what is missing, changed or unexpected in a restore. Needs no database. Exit status 3 when the two differ |

## Importing a source

```bash
npm run emulators                     # in one terminal
npm run seed:lookups                  # once, in another: the importers refer to the lookup data
node scripts/emulators.mjs run npm run --silent -w @eegml/tools cli -- import list
node scripts/emulators.mjs run npm run --silent -w @eegml/tools cli -- import run h --input ../../data --mode preview
```

| Command | What it does |
|---|---|
| `import list` | Lists the sources of the registry and the importer of each. Needs no database. |
| `import fetch <source>` | Downloads the Excel export of a sheet that anyone with the link can read, from the address in the private configuration, into `portal/.private/exports/`, and writes a record beside it with the SHA-256, the size and the retrieval time. Needs no database. |
| `import run <source> --input <path> --mode preview` | Reads the input, stores every row as a source record, plans the documents and the review items, and prints what an apply would write. No entity is written. |
| `import run <source> --input <path> --mode apply` | The same, and then writes the plan in bounded pieces, each change with its entry in the change log of the batch. `--preview <batch>` makes the apply carry out one previewed batch and stop if the file or the database has changed since. |
| `import show <batch>` | Prints the state of a batch, its counts, what its change log holds and its log entries. |
| `import rollback <batch>` | Reverses an applied batch from its change log. It refuses as a whole, and lists the documents, when a document has changed since the batch wrote it. Source records stay. |
| `import verify <source> --input <path>` | Reads the input again and checks the import against the database: structure, row accounting, the rows of each tab against the baseline that the private configuration states, fidelity of the raw rows, that a second run would write nothing, trace to source, references, the registry of studies, derived values, blank and zero, and that no document members can read holds an address. It writes one thing, its report, on the latest applied batch of the source, which counts as verified only while every check has passed. |
| `import purge-special (--source <source> \| --batch <batch>)` | Removes the special-category copies that imports keep where no client reads them: the cells of rows that wait in the queue, and the states that the change log keeps for a rollback. A batch whose kept states are removed can no longer be rolled back. Prints counts only. |

`--sheet <name>` names one member of a family of sources. The contributor sheets are such a family: each sheet is a source of its own, and `import run ctable --sheet <name> --input <path> --mode preview` reads the sheet that the private configuration registers under that name. `import list` shows the families below the sources.

`--observed-on <date>` states the day of the export. `--commit <hash>` states the commit of a source held in a repository, and is found by itself when the input is a clean directory of a git checkout. `--config <file>` names another private configuration than `portal/.private/sources.json`.

| Exit status | Meaning |
|---|---|
| 0 | Done |
| 1 | The tool failed unexpectedly. `--verbose` prints where |
| 2 | Refused: wrong usage, missing configuration, or a target that is no emulator |
| 3 | Blocked: a check of the source failed, a verification failed, or a rollback was refused |
| 4 | Stopped: the database changed while the import was running. Run it again |

A run prints counts, field names and identifiers of documents. It never prints a name, an address or the content of a cell. The batch record names an input file `input.xlsx` (or `input.tsv`) with its SHA-256 and never the name under which the operator keeps it, and an input whose file name holds the identifier of a source document is refused. `import fetch` refuses an `--out` directory that git would offer for a commit. A second apply of an unchanged input writes its own batch record and nothing else, and says so. An apply that is interrupted is safe to run again: the next run writes what remains, as a batch of its own.

A review item is raised once, under its fingerprint. Two things keep the queue and the leads in step with it, whichever source is read first:

| What an import finds | What it does |
|---|---|
| A question that every source of a family states as far as it knows it, such as whether the rows of one name in several contributor sheets are one person | The item carries the key of the question (`subjectKey`). When a later source states the question with further candidates, the earlier statements are closed as superseded in the same run, whichever source raised them. A statement with a candidate that the new one lacks is left alone. A family of sources therefore settles in one pass, in any order. |
| A `conflictingLead` item about a replication that is open after the run | Every lead of that replication whose confirmation an import wrote is lowered to `needsReview`, and the row behind the question is named as the source of that one field. The membership and the person stay. A confirmation that a person has set, and one whose question a reviewer has decided, is never lowered. |
| An identifier or a tab title that resolves to no study and differs from exactly one study identifier by its year alone | The study is named in the item about the identifier as a proposal (`proposal/otherYear`), and in no other place. Nothing is matched or compared: the study gets no alias, no figure, no contact and no lead from those rows, and no lead of it is lowered. |
| A cell that names several studies, such as `A + B` | Every item about the row names every study of the cell, each marked as a part (`combined/part`) or a proposal, and nothing is written to any of them on its strength. |

The sources are imported in the order of `docs/MIGRATION_PLAN.md`, section 5, and the order is enforced: a run is refused while a source that the plan puts ahead of it (`after` in its definition) has no applied batch. B, D, the contributor sheets and G follow H; E and F follow H and D; A follows F.

Some outputs are withheld until the maintainers have answered a question of the plan (`src/import/withheld.ts`): the candidate documents of D (question 9), the `replicated` labels of E (question 7), the apply of a contributor sheet (question 10) and the apply of G (question 20). A preview is always possible. A real project never receives a withheld output; an emulator receives one only where `rehearse` in the private configuration names it.

A guard reads every planned document before anything is compared or written (`src/import/privacy-guard.ts`). It blocks the batch, at the preview already, where a document that members can read would hold an email-shaped text, where an identifier would hold a word of a name or an address of its own row, or where a special-category cell would stand outside a special-category document or in an item.

An import against a real project is not possible by accident. It needs `--production`, `--project <identifier>` and credentials in `GOOGLE_APPLICATION_CREDENTIALS` together, it is refused while an emulator address is set, and an apply must name its previewed batch. No real project exists yet.

## Checking citations

```bash
node scripts/emulators.mjs run npm run --silent -w @eegml/tools cli -- citations:verify --dry-run
node scripts/emulators.mjs run npm run --silent -w @eegml/tools cli -- citations:verify
```

`citations:verify` looks up the DOI of the original study of every replication, and the DOI of every manuscript, at Crossref (`api.crossref.org`), and compares title, year and first author with the stored reference. A request names the DOI and a generic client name, and carries no address, no name and no credential. One DOI is asked once, and requests follow one another a quarter of a second apart.

| Result | Status recorded | What else is recorded |
|---|---|---|
| Title, year and first author all agree | `verified` | The retrieved title, years, first author, journal and type, and the comparison field by field |
| One of them differs | `mismatch` | The same. The command prints the path and the names of the fields that differ |
| No registry holds the DOI | `notFound` | The DOI that was asked |
| Another agency registered the DOI, as DataCite does for a data repository | stays `unverified` | The DOI and the agency |
| Nothing differs and a field could not be compared | stays `unverified` | What was retrieved, and the comparison |
| Crossref could not be asked | nothing is written | The command ends with status 3 and says how many citations to try again |

A title agrees when the two are equal without regard to case, diacritics, punctuation and markup, with or without the subtitle that Crossref keeps apart. A year agrees when it is one of the years that Crossref gives for the work. The command writes `citationStatus`, `citationCheckedAt`, `citationSource` and `citationMetadata` of a replication, and `citationStatus` and `citationMetadata` of a manuscript, where the metadata names the source and the time. It never writes a field of the reference itself: a mismatch is for a person to settle. An importer sets the status when it creates a record and never afterwards, so a later import leaves the result of the check alone, and a second run of the check writes nothing unless Crossref has changed. `--dry-run` compares and prints without writing.

## Keeping the imported state

The state of the emulators can be saved and started from again, so that the import does not have to be repeated for every session of development. Both commands run in the `portal` directory. The saved state holds real data once real sources have been imported, so it belongs in `portal/.private/`, which git ignores, and nowhere else.

```bash
# Save, while `npm run emulators` is running. The hub of the emulators listens at the port base plus 40.
curl -X POST "http://127.0.0.1:$(( ${PORTAL_PORT_BASE:-9100} + 40 ))/_admin/export" \
  -H 'Content-Type: application/json' \
  -d "{\"path\":\"$PWD/.private/emulator-data\",\"initiatedBy\":\"import\"}"

# Start the emulators from the saved state, in place of `npm run emulators`.
node --input-type=module -e 'import { writeFirebaseConfig } from "./scripts/firebase-config.mjs"; import { resolvePortBase } from "./scripts/ports.mjs"; writeFirebaseConfig(resolvePortBase());'
npm run fb -- emulators:start --project demo-eegml --config "firebase.run-${PORTAL_PORT_BASE:-9100}.json" \
  --only auth,firestore --import .private/emulator-data
```

The first line of the second block writes the Firebase configuration of the port base, which `npm run emulators` otherwise writes and removes by itself. Remove `firebase.run-<base>.json` again after the emulators have stopped. Add `functions,storage` to `--only`, after `npm run build -w @eegml/functions`, when the application is to run against the state. Identifiers of people, contributors and outreach contacts in a saved state are derived with the hash key of `portal/.private/sources.json`, so a later import into that state needs the same key.

## Private configuration

The repository is public, so it names a source by letter and title only (`src/import/registry.ts`). The identifier and the addresses of each source document, and the secret of the keyed hashes, are read from `portal/.private/sources.json`, which git ignores. `sources.example.json` shows the format with placeholders:

| Field | Meaning |
|---|---|
| `hashKey` | The secret of the keyed hash, at least 32 bytes. Identifiers of people and identity keys are derived with it, so that they cannot be reversed by guessing. Each environment has its own, and a lost key makes later imports write new documents beside the old ones. |
| `sources.<key>.externalId` | The identifier that the host gives the document. The key is the lower-case letter of the source. |
| `sources.<key>.url` | The address at which a person opens the document. |
| `sources.<key>.exportUrl` | The address of the anonymous Excel export, which `import fetch` downloads. |
| `contributorSheets.<name>.externalId` | The identifier that the host gives a contributor sheet. The key of the sheet in the registry, `ctable-` and a hash, is derived from it, so the identifier itself reaches no path and no log. |
| `contributorSheets.<name>.replicationId` | The replication whose manuscript the sheet lists the contributors of. Nothing inside a sheet names it, and a sheet that is not registered here is refused. |
| `contributorSheets.<name>.url`, `.exportUrl` | As for a lettered source. |
| `rehearse` | The withheld outputs that an emulator writes all the same, for a rehearsal: `candidateStudies`, `replicatedLabels`, `contributorLists`, `demographics`. Ignored for a real project. |
| `expectedStudies` | The number of studies of the programme, which `import verify` compares once the list of studies is applied. |
| `sources.<key>.baseline`, `contributorSheets.<name>.baseline` | The rows of each class that each tab holds, by tab title or tab key. `import verify` fails until the reading equals it, so a change of the source is explained by stating the new numbers. |
| `sources.g.confirmedHeaders` | The header list of a tab whose columns no description states, as a maintainer has confirmed it. |
| `contributorSheets.<name>.columnOverrides` | Decisions of a maintainer about columns that the importer never maps by itself: `{ "header": "", "position": 1, "field": "orderInPublication" }` for a column of order numbers without a header, and `{ "header": "Funding 2", "field": "orcid" }` for a column of ORCID iDs under another header. Without an override such a column is queued for review. An override is checked against the content of its column on every run and is not applied where the content no longer fits. |

The location of a source is written to `sources/<key>/private/location`, which no client can read, and to no other document. Nothing read from the file is printed or logged.

## Sources that could not be opened

The historical replication coordination workbook (source A) and the membership and contributor workbook (source G) refused access when their importers were written. Both importers are built against synthetic fixtures that encode only what the project brief states: the seven summary fields of A, and the three tab titles and the field names of G. The registry entry of each source says so in its `notes`. Each importer checks the structure of the workbook first and stops, with exit status 3, where it differs: a missing tab or column, a column or a tab that the brief does not name, data under a blank header. Headers are matched without regard to case, spacing and punctuation, and the report names every header as it was found. For source G the workbook fails closed as a whole: where any tab differs, only the header row of every tab is stored, because an unknown column may hold special-category data. A row above the header that holds more than a title stops the import too. The tab `study_description`, whose columns the brief does not state, is read only once a maintainer has entered its header list under `sources.g.confirmedHeaders`, and a header that names names, addresses, gender or ethnicity refuses it whatever is confirmed. A row of unticked boxes is filler. The first run against a real file is therefore a preview of its structure.

Gender and ethnicity are special-category data. The importer of source G takes those cells out of every row of the member tab before it is stored: the source record holds a marker with a keyed hash in their place. An apply writes the terms verbatim to the demographics document of the person, and keeps them beneath the source record in `special/raw` only for a row that waits in the queue, until the batch that writes them to the person removes that copy. A preview writes neither. No client can read either document. No item, log entry or count holds a term, the key of a conflict about a term covers the document as well, and the change log names the collection of a demographics document and not the person. A row linked by name and affiliation alone writes nothing to that person and waits.

## Adding an importer

An importer is one module in `src/import/sources/` that exports its definition as `importer`. The command line finds it there, so adding an importer adds one file and edits no other. An importer that serves a family of sources, as the one of the contributor sheets does, names the family as its source and exports `select`, which binds it to the member that the operator names and gives that member its entry in the registry. A row may carry `special`, its special-category cells, which the framework stores apart from the source record where no client can read them. The module names the source it reads by its key in `src/import/registry.ts`, where the committed, non-private entry of every source is. An importer never writes. Its `read` turns the input into tabs of classified rows, and its `plan` states the documents it intends and the items for review through the plan builder. `read` is given the secret of the keyed hash, because the key of a row that is built from a personal value, such as the name of a contact, is a keyed hash and never the value. The framework stores the rows, compares the plan with the database, applies it and keeps the change log.

| Module | Responsibility |
|---|---|
| `workbook.ts`, `ooxml.ts`, `cells.ts` | The workbook reader: every sheet, hidden ones included, with values, formulas, hyperlinks, validated lists, the notes of cells and the formatting that carries meaning |
| `workbook-rows.ts`, `doi.ts` | What the importers of workbooks share: opening the file, capturing a row, reading a stored cell again, the lists that a sheet validates its cells against, and the reading of a DOI out of a citation, a link or a formula |
| `tsv.ts` | The reader of tab-separated files, which keeps every field verbatim |
| `snapshot.ts` | Source records: one immutable record for each revision of a row |
| `plan.ts`, `records.ts` | The plan builder, and the documents that several importers write alike |
| `ownership.ts` | What an import may set: a field that is empty or still holds what the same source wrote |
| `identity.ts`, `studies.ts` | Resolution of people, institutions, laboratories and studies |
| `reconcile.ts` | The builders of review items, with their fingerprints |
| `preview.ts`, `apply.ts`, `rollback.ts`, `verify.ts`, `run.ts` | The stages of a run |
| `registry.ts`, `config.ts`, `fetch.ts`, `discover.ts` | The source registry, the private configuration, the fetch stage and the discovery of importers |
| `codes.ts` | Checks of external codes by shape and check digit, without any lookup |
| `../citations/compare.ts`, `../citations/crossref.ts` | The citation check: the comparison of a stored reference with a retrieved one, and the look-up of a DOI at Crossref |
| `contributor-values.ts` | The readings of a contributor sheet: the mapping from header text to field, the classes of a row, a checkbox, an order value, and the screen for affiliation strings that may name one institution |
| `workbook-structure.ts` | The structure check for a workbook whose layout is known from a description only: the tolerant match of a header, with everything that was not recognised named |
| `recruitment-workbook.ts`, `recruitment-plan.ts`, `recruitment-values.ts` | The reader and the planner of a recruitment and contact workbook, with the source key and the reviewed table of tabs as parameters, so that a second workbook of that layout uses them unchanged |

The workbook reader parses the parts of an `.xlsx` file itself, with the strict XML parser `saxes`, because the spreadsheet libraries that were assessed convert values while they read. `exceljs` is a development dependency that the tests use to build synthetic workbooks, so that the reader is never tested against its own output.

Test fixtures are synthetic. The builders in `src/import/fixtures/` write invented studies, people and addresses on `example.org`, and reproduce the awkward cases of the real sources. No real row of any source is ever committed.
