# Portal engineering conventions

These conventions apply to everything under `portal/`. They exist so that many contributors, human or automated, produce one coherent application. Read `docs/DECISIONS.md`, `docs/DATA_MODEL.md` and `docs/SECURITY.md` before making a substantial change. `README.md` in this directory explains how to install, run, test and build.

## Layers and where code belongs

The portal is a static single-page application with Firebase behind it. It is one npm workspace with four packages and a tests directory. Each layer has one job, and the direction of imports is fixed: the shared package imports nothing from the other layers, and the web application, the functions and the tools each import the shared package and never one another.

| Layer | Location | Responsibility |
|---|---|---|
| Shared | `portal/shared` | Pure TypeScript with no Firebase imports. Zod schemas of every stored document, collection paths, contracts of callable functions, identifier derivation, pure domain logic and the capability matrix. Fully unit tested. |
| Web routes and components | `portal/web/src` | Rendering, forms and interaction. Data access only through `src/data`, which is the only directory that imports the Firebase SDK. No authorisation decisions. |
| Security rules | `portal/firestore.rules` and `portal/storage.rules` | The enforcement point for every direct read and write from a browser. Anything the rules do not allow is denied. |
| Functions | `portal/functions` | Callable services that authorise, validate, run a transaction and write the audit entry. Triggers. Scheduled jobs. Integrations behind adapters, each with a real implementation and a fake used in tests. |
| Tools | `portal/tools` | Admin SDK command-line tools for imports, seeding, integrity checks and migrations. Run only from a trusted environment, never from the public site. |
| Tests | `portal/tests` | Security-rules tests, integration tests of functions and tools, end-to-end browser tests and architecture tests. Unit tests sit next to the code they test. |

Inside the web application, routes and components import from `@/data` and never from a file inside it or from `firebase`. Inside the functions, every callable is declared with `defineCallable`, which fixes the region and the web origins that may call, requires a signed-in caller unless told otherwise, refuses a suspended account and an ended session, validates input and output against the contract in the shared package and maps errors to codes that are safe to send to a browser. A handler raises `AppError` for a failure it wants the person to read. Only such a message reaches the interface, marked as public, and every other error becomes a general one. The region, the collection names and the document shapes are each defined once, in the shared package. Zod is imported directly in one file, `shared/src/zod.ts`, and everywhere else through `@eegml/shared`. The linter and the architecture tests enforce all of this.

New destinations, pages, panels, callable functions, audit event types, capabilities and tools are each added in one registry. `README.md` lists them.

## Rules that are never broken

Authorisation is enforced by security rules and by functions, never by the interface. A route or a component may hide what an account cannot do, and that is a convenience for the reader only. A function never trusts an identifier from the client without checking the caller's right to it, and a rule never relies on a value the client could have written for itself. What an account may do is stored in its access document, which only functions write.

A suspended account, and a session that began before the account's sessions were ended, are refused everything. In the rules every `allow` statement goes through `isActive()`, directly or through a helper that calls it. In the functions `defineCallable` makes the same decision with `accountStanding` from the shared package before a handler runs. The two change together. Text that an account supplies about itself, such as the name in its sign-in token, is self-asserted: it is normalised before it is stored and is never used to identify anyone.

The audit trail is written by trusted code. A callable function writes its audit entry with `writeAudit` in the same transaction or batch as the change, so the entry and the change succeed or fail together, and it puts the identifier that `writeAudit` returns in the `writeContext.auditEventId` of each document it writes. Clients can neither read nor write the audit collection. Special-category values (gender and ethnicity) are never written into audit entries, logs, search documents or error messages.

Restricted and special-category fields live in documents of their own. Firestore rules grant reads per document, so a field that some readers must not see is never stored next to fields they may see. Special-category data is never readable by a client through the database: it is served only by a callable function that checks the caller's grant, writes an audit entry and returns the data.

Source values are preserved. An importer stores the raw row, links every record it creates or updates to that row, and never resolves a conflict between sources by choosing a value arbitrarily. Conflicts are queued for human review.

Missing data stays missing. An unknown count is absent and is never shown or summed as zero. Fact-like documents carry a `dataOrigin` (`live`, `importedHistorical`, `demo` or `projected`), and the last three are labelled wherever their values are displayed.

Nothing private is committed. This repository is public. Real member data, source exports, the identifiers and addresses of source documents, Firebase project configuration, credentials and tokens stay out of it. Local private material belongs in `portal/.private/`, which git ignores. Test fixtures are synthetic, use obviously fictitious names and the `example.org` domain, and say so in a header comment.

No live external writes, production deployments or destructive migrations happen without explicit approval from a programme administrator. Adapters that write to external systems default to a dry-run mode. Development and tests use the emulators with the `demo-eegml` project, and a tool refuses to start when it cannot tell that its target is an emulator.

Every visible control does something real. A feature that is unfinished is left out of the interface instead of being shown as a placeholder, and its state is kept in the Status column of `docs/REQUIREMENTS_CHECKLIST.md`. A navigation entry, a button or a page appears only when what it leads to exists. The one page that is no feature is the page of interface components at `#/dev/components`. It exists in emulator builds only, is linked from nowhere, and is there so that the browser tests can check every primitive.

## Database changes

The shape of every stored document is a zod schema in `portal/shared/src/schemas/`, one file for each section of `docs/DATA_MODEL.md`, and its path is in the collection registry, `portal/shared/src/collections.ts`. Every schema extends the standard fields of the data model in `base.ts` (`schemaVersion`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `archivedAt` and `writeContext`, or the shorter set of an append-only collection) and is entered in the registry, which also states how the identifier is formed, who may read and write, the data class and whether the security rules for the collection are written yet. Every object in a schema is strict, so a document with a field the schema does not name is refused when it is written. Architecture tests fail when a schema leaves a standard field out or stays out of the registry, and when the registry and the tables of `docs/DATA_MODEL.md` disagree. The web application validates every document it reads against the schema, leaving out fields it does not know, and functions and tools validate every document they write. A change to a document therefore starts in the shared package.

Security rules and indexes change in the same pull request as the schema. A new collection is denied by default until a rule allows it, and every `allow` statement gets a test that proves it and tests that prove the matching denials, including a signed-out caller and a different signed-in caller.

Every document carries a `schemaVersion`. A change that only adds an optional field keeps the version, because readers ignore fields they do not know. A change that removes, renames or reinterprets a field raises the version and comes with a migration: an idempotent command in `portal/tools` that can be run twice with the same result and reports what it changed. A destructive migration needs approval and a documented way back. Lookup data that the application depends on is installed by an idempotent seeding command.

Document identifiers are derived deterministically from natural keys wherever a natural key exists, so that a duplicate cannot be created and an import can be repeated safely. Every derivation is a function in `portal/shared/src/ids.ts` and is pinned to golden values in `ids.test.ts`, because a changed derivation would make a repeated import write new documents beside the old ones. A changed golden value is therefore a migration and never a routine test update.

## Interface and writing rules

The portal reuses the public website's visual system as that site is actually rendered (decision D-018): warm graphite `#302a2a`, coral `#d84b4d`, deep coral `#a9353a`, warm white `#fcf9f7` and white, with DM Sans for all text, page titles included. The typeface is served from the portal itself. Design tokens are defined once, in `portal/web/src/styles/tokens.css`, and components use the utilities generated from them and never a raw value. The few places outside the stylesheet that need a colour read it from that file when the page is built.

There are no shadows. Structure comes from 1px borders and spacing. Green is not used. A control with a white label is deep coral, on which white measures 6.45 to 1. Coral itself, on which white measures 4.17 to 1, is for focus outlines and indicators. `portal/tests/architecture/contrast.test.ts` computes the contrast of every pair of colours in use from the token values and fails below 4.5 to 1 for text and 3 to 1 for large text and for the boundaries of components. A new combination of colours is entered in the table of that test. The portal is information-dense: the base text size is 14px and controls are compact, and wherever the pointer is coarse every control is at least 44px high and wide.

Labels, headings and buttons are in sentence case. Interface copy and documentation are in UK English, are plain and specific, and avoid em dashes. Documentation is written as prose, with a table wherever a registry is needed.

Every interactive element is reachable and operable by keyboard, has a visible focus state and an accessible name. Focus is drawn with an outline. Pages have landmarks and a skip link, respect a preference for reduced motion and meet WCAG 2.2 at level AA. Loading, empty and error states are designed for every data view, using the shared components so that they look and read the same everywhere. Long lists are paginated or virtualised.

New interface primitives go in `portal/web/src/components/ui`, are built on Radix where Radix has the pattern, and are used through that directory everywhere else. Each one is also shown on the page of interface components, in the same change, so that `portal/tests/e2e/components.spec.ts` checks it in a browser before a page relies on it.

## Testing

Pure logic has unit tests next to the code. Every security rule has a test that proves an unauthorised caller is refused. Functions have integration tests that run against the emulators, and a function that changes state has a test that proves its audit entry. Importers have tests that prove a second run creates no duplicates. Critical journeys have end-to-end browser tests against the built application, and every end-to-end test fails if a page violates its Content-Security-Policy, contacts a host that is not local or throws an uncaught error. New pages are added to the accessibility test, which fails on serious and critical findings.

Everything that listens on a port derives the port from `PORTAL_PORT_BASE`, which is a multiple of 100, so that several contributors can run suites side by side. A test never contacts a production service. A test file that contains an address says in its header that its data is synthetic, and an architecture test checks that.

A change is complete when `npm run typecheck`, `npm run lint`, `npm run build` and `npm test` pass. When it closes a requirement, the test or file that shows it is entered in the Evidence column of `docs/REQUIREMENTS_CHECKLIST.md`.
