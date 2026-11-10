# Portal engineering conventions

These conventions apply to everything under `portal/`. They exist so that many contributors, human or automated, produce one coherent application. Read `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md` and `docs/SECURITY.md` before making a substantial change.

## Layers and where code belongs

The application is one TypeScript codebase with strict internal layers. A layer may import from the layers listed after it and never from the layers before it.

| Layer                 | Location                            | Responsibility                                                                                                                                                                                                                      |
| --------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routes and components | `src/app/`, `src/components/`       | Rendering, forms and interaction. Server components obtain data by calling services. Client components call the typed API. No database access, no authorisation decisions.                                                          |
| API                   | `src/server/api/`                   | Thin typed procedures. Validate input with a schema, build the service context, call one service function, return its result.                                                                                                       |
| Services              | `src/server/services/<module>/`     | Use cases. Every exported function takes the service context first and an input object second. A service authorises, validates business rules, runs the change in a transaction, writes the audit event and emits the domain event. |
| Policy                | `src/server/policy/`                | The single place where authorisation and field-level visibility are decided. Pure functions over an actor and a resource description.                                                                                               |
| Domain                | `src/server/domain/`                | Pure logic with no input or output: recruitment rollups, forecasting, identity matching, formula evaluation, fractional ordering. Fully unit tested.                                                                                |
| Persistence           | `src/server/db/`                    | Drizzle schema, the database client and migrations.                                                                                                                                                                                 |
| Integrations          | `src/server/integrations/<system>/` | Adapters behind interfaces, each with a real implementation and a fake used in tests.                                                                                                                                               |
| Importers             | `src/server/importers/`             | Source adapters built on the import framework.                                                                                                                                                                                      |
| Jobs                  | `src/server/jobs/`                  | Background workers. A job handler calls services and holds no business logic of its own.                                                                                                                                            |

## Rules that are never broken

Authorisation happens on the server, in the service, through the policy module. A route, a component or an API procedure never decides access by itself, and a service never trusts an identifier from the client without checking the actor's right to it.

Every state change is audited in the same transaction as the change, through the audit helper. Special-category values (gender and ethnicity) are never written into audit payloads, logs, search documents or error messages.

Restricted and special-category fields are removed on the server by the policy module's field filters before data leaves a service. A response never contains a field the actor may not read, even if the interface would not display it.

Source values are preserved. An importer stores the raw row, links every entity it creates or updates to that row, and never resolves a conflict between sources by choosing a value arbitrarily. Conflicts are queued for human review.

Missing data stays missing. Unknown counts are `NULL` or absent and are never shown or summed as zero. Values are labelled as live, imported historical, demonstration or projected wherever they are displayed.

Nothing private is committed. Real member data, source exports, document identifiers and addresses, credentials and tokens stay out of the repository. Test fixtures are synthetic, use obviously fictitious names and the `example.org` domain, and say so in a header comment.

No live external writes, production deployments or destructive migrations happen without explicit approval from a programme administrator. Adapters that write to external systems default to a dry-run mode.

Every visible control does something real. A feature that is unfinished is left out of the interface and recorded in `docs/IMPLEMENTATION_STATUS.md` instead of being shown as a placeholder.

## Database changes

The schema is defined in `src/server/db/schema/`, one file per module, and migrations are generated from it into `drizzle/`. A migration is additive wherever possible. A destructive migration needs approval and a documented rollback. Generated migration files are committed and never edited after they have been applied to a shared environment. Lookup data that the application depends on is installed by the idempotent seed script.

## Interface and writing rules

The portal reuses the public website's visual system: warm graphite `#302a2a`, coral `#d84b4d`, deep coral `#a9353a`, warm white `#fcf9f7` and white, with the DM Sans and Fraunces typefaces. There are no shadows. Structure comes from borders and spacing. Green is not used. Controls on a coral background have white labels and icons. Labels, headings and buttons are in sentence case. Interface copy is in UK English, is plain and specific, and avoids em dashes.

Every interactive element is reachable and operable by keyboard, has a visible focus state and an accessible name. Loading, empty and error states are designed for every data view. Long lists are paginated or virtualised.

## Testing

Pure logic has unit tests. Services have integration tests that run against a real PostgreSQL database. Every permission rule has a test that proves an unauthorised actor is refused. Importers have tests that prove a second run creates no duplicates. Critical journeys have end-to-end browser tests. A change is complete when its tests pass, the type check and lint pass, and the result is recorded in `docs/TEST_REPORT.md` when it closes a requirement.
