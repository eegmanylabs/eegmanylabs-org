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

Inside the web application, routes and components import from `@/data` and never from a file inside it or from `firebase`. Inside the functions, every callable is declared with `defineCallable`, which fixes the region, requires a signed-in caller unless told otherwise, validates input and output against the contract in the shared package and maps errors to codes that are safe to send to a browser. The region, the collection names and the document shapes are each defined once, in the shared package. Zod is imported directly in one file, `shared/src/zod.ts`, and everywhere else through `@eegml/shared`. The linter and the architecture tests enforce all of this.

New destinations, pages, panels, callable functions, audit event types, capabilities and tools are each added in one registry. `README.md` lists them.

## Rules that are never broken

Authorisation is enforced by security rules and by functions, never by the interface. A route or a component may hide what an account cannot do, and that is a convenience for the reader only. A function never trusts an identifier from the client without checking the caller's right to it, and a rule never relies on a value the client could have written for itself. What an account may do is stored in its access document, which only functions write.

The audit trail is written by trusted code. A callable function writes its audit entry with `writeAudit` in the same transaction or batch as the change, so the entry and the change succeed or fail together. Clients can neither read nor write the audit collection. Special-category values (gender and ethnicity) are never written into audit entries, logs, search documents or error messages.

Restricted and special-category fields live in documents of their own. Firestore rules grant reads per document, so a field that some readers must not see is never stored next to fields they may see. Special-category data is never readable by a client through the database: it is served only by a callable function that checks the caller's grant, writes an audit entry and returns the data.

Source values are preserved. An importer stores the raw row, links every record it creates or updates to that row, and never resolves a conflict between sources by choosing a value arbitrarily. Conflicts are queued for human review.

Missing data stays missing. An unknown count is absent and is never shown or summed as zero. Every document carries a `dataOrigin`, and values are labelled as live, imported historical, demonstration or projected wherever they are displayed.

Nothing private is committed. This repository is public. Real member data, source exports, the identifiers and addresses of source documents, Firebase project configuration, credentials and tokens stay out of it. Local private material belongs in `portal/.private/`, which git ignores. Test fixtures are synthetic, use obviously fictitious names and the `example.org` domain, and say so in a header comment.

No live external writes, production deployments or destructive migrations happen without explicit approval from a programme administrator. Adapters that write to external systems default to a dry-run mode. Development and tests use the emulators with the `demo-eegml` project, and a tool refuses to start when it cannot tell that its target is an emulator.

Every visible control does something real. A feature that is unfinished is left out of the interface and recorded in `docs/IMPLEMENTATION_STATUS.md` instead of being shown as a placeholder. A navigation entry, a button or a page appears only when what it leads to exists.

## Database changes

The shape of every stored document is a zod schema in `portal/shared/src/schemas/`, and its path is in `portal/shared/src/paths.ts`. The web application validates every document it reads against the schema, and functions and tools validate every document they write. A change to a document therefore starts in the shared package.

Security rules and indexes change in the same pull request as the schema. A new collection is denied by default until a rule allows it, and every `allow` statement gets a test that proves it and tests that prove the matching denials, including a signed-out caller and a different signed-in caller.

Every document carries a `schemaVersion`. A change that only adds an optional field keeps the version, because readers ignore fields they do not know. A change that removes, renames or reinterprets a field raises the version and comes with a migration: an idempotent command in `portal/tools` that can be run twice with the same result and reports what it changed. A destructive migration needs approval and a documented way back. Lookup data that the application depends on is installed by an idempotent seeding command.

Document identifiers are derived deterministically from natural keys wherever a natural key exists, so that a duplicate cannot be created and an import can be repeated safely.

## Interface and writing rules

The portal reuses the public website's visual system: warm graphite `#302a2a`, coral `#d84b4d`, deep coral `#a9353a`, warm white `#fcf9f7` and white, with DM Sans for interface text and Fraunces for page titles. Both typefaces are served from the portal itself. Design tokens are defined once, in `portal/web/src/styles/tokens.css`, and components use the utilities generated from them and never a raw value.

There are no shadows. Structure comes from 1px borders and spacing. Green is not used. Controls on a coral background have white labels and icons, and small labels sit on the deep coral so that they meet the contrast requirement. The portal is information-dense: the base text size is 14px and controls are compact.

Labels, headings and buttons are in sentence case. Interface copy and documentation are in UK English, are plain and specific, and avoid em dashes. Documentation is written as prose, with a table wherever a registry is needed.

Every interactive element is reachable and operable by keyboard, has a visible focus state and an accessible name. Focus is drawn with an outline. Pages have landmarks and a skip link, respect a preference for reduced motion and meet WCAG 2.2 at level AA. Loading, empty and error states are designed for every data view, using the shared components so that they look and read the same everywhere. Long lists are paginated or virtualised.

New interface primitives go in `portal/web/src/components/ui`, are built on Radix where Radix has the pattern, and are used through that directory everywhere else.

## Testing

Pure logic has unit tests next to the code. Every security rule has a test that proves an unauthorised caller is refused. Functions have integration tests that run against the emulators, and a function that changes state has a test that proves its audit entry. Importers have tests that prove a second run creates no duplicates. Critical journeys have end-to-end browser tests against the built application, and every end-to-end test fails if a page violates its Content-Security-Policy, contacts a host that is not local or throws an uncaught error. New pages are added to the accessibility test, which fails on serious and critical findings.

Everything that listens on a port derives the port from `PORTAL_PORT_BASE`, so that several contributors can run suites side by side. A test never contacts a production service.

A change is complete when `npm run typecheck`, `npm run lint`, `npm run build` and `npm test` pass, and the result is recorded in `docs/TEST_REPORT.md` when it closes a requirement.
