# EEGManyLabs members' portal

The members' portal is a single-page application that is published as static files on GitHub Pages and uses Firebase as its backend: Authentication for sign-in, Firestore for data, Cloud Functions in London for trusted operations and Cloud Storage for files. The decisions behind this arrangement are recorded in `docs/DECISIONS.md`, and the conventions for working in this directory are in `CONTRIBUTING.md`.

Everything here is developed and tested against the Firebase Local Emulator Suite with the project identifier `demo-eegml`. No Firebase project, account or credential is needed, and nothing in this directory contacts a production service.

## Prerequisites

You need Node.js 22.22 or newer and a Java 21 runtime, which the Firebase emulators require. The Firebase web SDK asks for Node.js 24 in its package metadata, so `npm ci` prints engine warnings on Node.js 22. They are harmless, because the SDK runs in the browser and, under Node.js, only in tests. Continuous integration runs on Node.js 22 as well, on purpose: the functions are deployed to the `nodejs22` runtime, and their tests should run on the version that will run them. The suite has not been run on Node.js 24. The end-to-end tests need the Chromium build that matches the pinned Playwright version. On a machine that does not have it, install it once with `npx playwright install chromium`.

The first start of the emulators downloads two files of about 190 MB in total to `~/.cache/firebase/emulators`. Later starts use the cached copies.

## Install

Run every command from the `portal` directory.

```bash
npm ci
```

The portal is an npm workspace. One install at this level serves all four packages, and there is one `package-lock.json`. All versions are pinned exactly.

## Run

```bash
npm run dev
```

This starts the functions bundler in watch mode, the emulators and the Vite development server, and stops all three together when you press Ctrl-C. With the default port base the portal is at `http://127.0.0.1:9251/`. To sign in, enter any address on the sign-in page and open the link that the Authentication emulator prints in the terminal. A link works once.

`npm run seed:demo`, run in a second terminal while the emulators are up, writes a synthetic world for local development and for end-to-end tests: twelve fictitious persons with their contact documents and email index entries, four laboratories at three institutions with their member entries, four replications with their memberships, participations and what their record pages show, two demonstration accounts, of which one has claimed a person already, and a bootstrap record for a demonstration administrator. The fixtures in `tools/src/fixtures/` list every address and say which path of the claim flow each one exercises. Every fact-like document is labelled `dataOrigin: "demo"`, and every document names the command as its author (`system:seedDemo`). The command writes the lookup data first, resolves the access document of each account from what it wrote, and switches the second factor off for this world in `system/settings`, because the Authentication emulator cannot run a time-based one-time password. It refuses to run unless the emulator variables are set, so it cannot touch a real project, and it says so in one line when the emulators of the port base are not running. A second run writes nothing.

`npm run integrity:check`, run the same way, runs the referential-integrity checker of the shared package over the emulators and writes a report to `integrityReports`, as the scheduled function `integritySweep` does every night. With `--production --project <identifier>` after `--` it reads a real project from a trusted machine.

`npm run seed:lookups`, run the same way, writes the lookup data that the application depends on: the programme, the statuses of replications, datasets and tasks, the eleven categories of participant counts with their definitions, the onboarding checklist, the fourteen CRediT contributor roles and the seven reasons for excluding participants that a recruitment report names. The values are constants in `shared/src/seed/lookups.ts`. A document that already exists is never written again, so a second run performs no write, and a document whose values an administrator has changed is reported and left as it is. The command needs the Firestore emulator only and refuses any target that is not an emulator.

The development server sends no Content-Security-Policy, because its hot reloading relies on inline scripts. To see the application exactly as it will be published, use the preview:

```bash
npm run emulators   # in one terminal
npm run preview     # in another
```

The preview builds the application and serves it with `scripts/pages-server.mjs`, which behaves like GitHub Pages: no rewrites, the `404.html` body with status 404 for unknown paths at any depth, and no custom response headers. It serves the build under the path prefix `/portal/`, the way a project site is served under the name of its repository, so an address that only works at the root of a domain fails here first. With the default port base the preview is at `http://127.0.0.1:9250/portal/`.

## Test

| Command | What it runs | Needs |
|---|---|---|
| `npm run typecheck` | The TypeScript compiler over every package, the tests and the scripts | Nothing |
| `npm run lint` | Biome: lint rules, import order and formatting. `npm run format` applies the fixes | Nothing |
| `npm run test:unit` | Unit tests of the shared package, the functions framework, the tools and the scripts; architecture tests; component tests of the web application in jsdom | Nothing |
| `npm run test:rules` | Security-rules tests for Firestore and Cloud Storage | Starts the Firestore and Storage emulators |
| `npm run test:functions` | Integration tests of the functions | Bundles the functions, starts the Authentication, Firestore and Functions emulators |
| `npm run test:tools` | Integration tests of the command-line tools | Starts the Authentication and Firestore emulators |
| `npm run test:seed-lookups` | The integration test of `seed:lookups` alone, which proves that a second run writes nothing | Starts the Firestore emulator and no other |
| `npm run test:e2e` | Playwright tests against the built application, including the accessibility and security checks | Builds, starts all emulators and the preview server |
| `npm test` | All of the test commands above, with two starts of the emulators: one without the functions emulator for the rules and the tools, and one with it for the functions and the browser tests | Builds first |

Every command that needs emulators starts them through `firebase emulators:exec` and stops them when the tests finish, whether they pass or fail. A test command fails at once, with a message that names the port, if another run is already using the same port base. That check covers the emulator ports and, for the commands that start the preview server, its ports as well.

A run can be interrupted at any point. `scripts/emulators.mjs` starts the Firebase tools in a process group of their own and, on an interrupt or a termination signal, stops that whole group: the emulators, the test runner, the preview server and the browser. It asks politely first, then insists after fifteen seconds, and it only ends once nothing of the run is left. The Firestore emulator runs outside that group, because the Firebase tools start it in a session of its own. The tools stop it themselves, and the launcher follows up on it directly if they have not done so in time. `scripts/process-group.mjs` holds that logic and `scripts/process-group.test.mjs` tests it with a real process tree.

### The functions suite and the triggers

The functions emulator runs the Firestore triggers for every write to the project `demo-eegml`, whichever suite makes it, and a clear of the Firestore emulator reaches them as deletions. Three conventions keep the suites apart.

| Convention | Where |
|---|---|
| The rules and the tools are tested without the functions emulator, because the tools tests count exactly what a tool writes and a trigger would add to it. `npm test` therefore starts the emulators twice. What the triggers do with the documents of a tool is tested in the functions suite, with `seed:demo` | The `test` script in `package.json` |
| A test file of the functions suite starts each test with `resetWorld` and ends with `leaveNoTrace`, which switches the triggers off around its clear, so no file leaves documents or late deliveries to the next | `tests/functions/support.ts` |
| A caller in a functions test is a hand-made sign-in token, which states the account, whether its address is verified and whether a second factor was presented. The functions emulator decodes a token without verifying it, so this proves nothing about token verification | `tokenOf` in `tests/functions/support.ts` |

`setBackgroundTriggers` in `tests/support/emulators.ts` switches the triggers through the emulator hub. Switching them off waits for the trigger work that is queued. Switching them on makes the functions emulator load its triggers anew under new names, and the earlier names stay registered and answer nothing, which is why this is done once for a test file and never for a test, and why the test that delivers an event by hand asks the emulator for the current name.

### Security rules and their tests

`firestore.rules` implements the collection registry, `shared/src/collections.ts`, for the entries whose `enforcement` is `enforced`. Every other entry is `deniedUntilBuilt`: no rule names it, so every client is refused every read and write until the phase that builds its feature writes its rules. `storage.rules` denies everything until attachments are built.

The rules are tested from the registry, so a rule cannot drift from it unnoticed.

| File | What it proves |
|---|---|
| `tests/rules/matrix.test.ts` | Every kind of caller of `tests/rules/world.ts`, from a caller who is not signed in to a programme administrator with and without a second factor, against every entry of the registry: a read, a list with and without a constraint, a list across parents, a create, an update and a delete. The expected answer of each request comes from `tests/rules/policy.ts`, which reads the registry and never the rules file. Its closing tests fail when an entry has no fixture, when a granted operation was never allowed or never refused, and when an allow statement of the rules file was never granted or never refused |
| `tests/rules/write-envelope.test.ts` | For every entry a client may write: a forged author, time, version or context, a missing or unexpected key, the provenance of an import, and a change to each field that the registry keeps from clients, are all refused |
| `tests/rules/access-tiers.test.ts` | Suspension and ended sessions, the second factor, the split of a person into directory, contact and special-category documents, and the lists a scoped caller must constrain |
| `tests/rules/collection-rules.test.ts` | What is special to one collection: field whitelists, the shapes of laboratories, participations, checklist items, hypotheses and correction requests, references that must exist and scope that is inherited |
| `tests/rules/queries.test.ts` | Every query of the catalogue in `tests/rules/queries.ts` is accepted for its caller and refused without the clause that limits it to a scope |
| `tests/rules/storage.rules.test.ts` | Every kind of caller is refused every operation on Cloud Storage |
| `tests/rules/hardening.test.ts` | What holds for every block alike: a client creates a record with an opaque identifier only under an identifier that Firestore generated, an archived record is frozen and is restored by whoever archived it or by the programme, the verbatim source values of an imported record stay as the source gave them, the value checks agree with the shared schemas, and the largest write of each collection stays within the 1000 expressions that a request may evaluate |
| `tests/rules/redteam/` | The attacks of two red-team reviews, kept as regression tests. The files beginning with `exfiltration-and-escalation-` try to read what a caller may not read and to gain rights, and those beginning with `integrity-and-audit-` try to corrupt a record or to shed the name on it. Each test states the secure behaviour, and each attack stands beside a control that proves the honest request is accepted |
| `tests/architecture/rules-source.test.ts` | Without an emulator: every match block belongs to one enforced entry, the methods it allows are the ones the registry opens, every list of fields in the rules equals its schema, every allow statement starts by asking whether the account may act, every create of a record with an opaque identifier asks for a generated one, and every entry with verbatim source values keeps them on imported documents |
| `tests/architecture/indexes.test.ts` | `firestore.indexes.json` holds exactly the composite indexes, the collection-group indexes and the exemptions that the catalogue of queries and the registry call for. The emulator does not enforce indexes, so this is the only check they have |

To write the rules of an entry that is `deniedUntilBuilt`: set its `enforcement` to `enforced`, write its match block with the worst-case number of documents it reads in a comment, add its fixture to `tests/rules/fixtures.ts`, add the queries that its scoped lists need to `tests/rules/queries.ts`, and add tests of whatever is special to it. The matrix, the envelope attacks and the checks of the rules file then cover it without further work.

A block that lets a client write holds to five principles, which the red-team reviews established and `tests/rules/hardening.test.ts` checks across collections.

| Principle | In the rules |
|---|---|
| A document that the rules accept is a document its schema accepts | Every field a client may set is checked for its type, its enumeration and its cap with the helpers of the section "Values". A rule cannot iterate: a list of texts is checked as a whole with `strings`, a map of plain values with `customValues`, and a field whose elements no rule can check (a list of maps, a free map) is entered in `functionOnlyFields` of the registry |
| A reference stays where it belongs | A reference that a write introduces names a document that exists, and a document of the same replication or laboratory wherever the record is read beyond its scope. A rule asks for a parent with `get() != null` before it reads a field of it, because `a \|\| b` holds when `a` fails and `b` is true |
| A signature covers what it signs | A review, an approval, a completion and an acknowledgement name the caller and the request time. What the signature covers changes only together with it, and whoever is under review does not sign |
| A decision belongs to whoever makes it | What the programme decides, what a machine checks and what imports find a record again by are `functionOnlyFields`: a callable function writes them with their audit entry or their identity key |
| An identifier that a client chooses is one that Firestore generated | `autoId` on every create where the registry says `auto`, so that no client takes an identifier that an importer derives. In a test, `autoId("label")` of `tests/rules/world.ts` names a new record, and `createAt` creates one under an identifier of the test's own choosing where the identifier itself is under attack |

A request may evaluate 1000 rule expressions, a documented limit of Firestore that the emulator enforces as well. Every check costs some of them whether its field is present or not, and every use of `access()` is evaluated again, which is why the helpers that decide who the caller is take the access document as an argument. The largest write of each collection is in `tests/rules/hardening.test.ts`: extend it when a block gains a field, and it fails when the block has outgrown the limit.

The emulator keeps every value of every rule expression it evaluates, so the matrix collects that record every twelve entries and makes the emulator forget it. Each of these files uses a project identifier of its own, all beginning with `demo-`.

The suites that run against emulators are Vitest projects defined in `vitest.config.ts`. To run one test file while you work on it, start the emulators with `npm run emulators` and, in a second terminal, run for example `node scripts/emulators.mjs run npx vitest run --project functions tests/functions/sessionStart.test.ts`.

## Build modes

The web application is built in one of three modes. The mode decides which Firebase project the build talks to.

| Mode | Command | Talks to | Configuration | Output directory |
|---|---|---|---|---|
| `emulator` | `npm run build` | The Local Emulator Suite | None. The emulator ports are compiled in from `PORTAL_PORT_BASE` | `web/out/emulator-<port base>/` |
| `staging` | `npm run build:staging` | The staging project | `VITE_` variables | `web/out/staging/` |
| `production` | `npm run build:production` | The production project | `VITE_` variables | `web/out/production/` |

The emulator mode is the default for development and for every test. The staging and production modes read the web configuration of the Firebase project from the variables documented in `web/.env.example`, either from the environment or from `web/.env.staging.local` and `web/.env.production.local`, which git ignores. A build in those modes stops with a message that names the missing variables when any of them is absent, and refuses a project identifier that starts with `demo-`.

`npm run build` has three steps. It compiles the shared package in isolation, with no browser, Node.js or Firebase types available, which is what keeps that package pure. It bundles the functions into `functions/out/index.js` with the shared package inside, because Cloud Functions installs only what `functions/package.json` names and cannot fetch a workspace package. Then it builds the web application. The shared package has no output of its own: the functions bundle and the web build both compile it from source.

Every web build has the same shape. Asset addresses are relative and routes are in the fragment (`#/login`), so one artefact works at any address without server rewrites. The first element of `<head>` is the character-set declaration, which HTML requires within the first 1024 bytes, and the second is a Content-Security-Policy meta element generated for the mode by `web/config/csp.ts`. The declaration loads nothing, so the policy still precedes every element that does, and the build fails if that order is ever lost. Every mode except production adds a `robots` meta element that asks search engines to stay away. The theme colour is taken from the design tokens when the page is built. `frame-guard.js` stops the application from starting inside a frame on another site, since GitHub Pages cannot send a `frame-ancestors` policy. DM Sans, the one typeface, is served from the build itself.

`404.html` is the page GitHub Pages shows for an address it does not know, at any depth below the site. It is a small page of its own: a heading, one sentence and a link to the start of the portal, with its styles inline, no script, and a policy of its own that allows nothing but those styles and the font. A page at an unknown depth cannot use relative addresses, so its link and its font are addressed from the path the portal is published under. That path is the build variable `PORTAL_PUBLIC_PATH`.

| Published at | `PORTAL_PUBLIC_PATH` |
|---|---|
| A domain of its own, such as the recommended subdomain | `/`, which is the default for staging and production |
| A default Pages address, `https://<owner>.github.io/<repository>/` | `/<repository>/` |
| The preview server and the tests | `/portal/`, which emulator builds use without being told |

## Ports

Everything that listens on a port derives it from the environment variable `PORTAL_PORT_BASE`, which defaults to 9100. The offsets are defined once, in `scripts/ports.mjs`.

| Service | Offset | Default port |
|---|---|---|
| Functions emulator | base + 1 | 9101 |
| Eventarc emulator (started with Functions) | base + 29 | 9129 |
| Emulator hub | base + 40 | 9140 |
| Emulator logging | base + 48 | 9148 |
| Cloud Tasks emulator (started with Functions) | base + 49 | 9149 |
| Firestore emulator | base + 80 | 9180 |
| Firestore emulator, web socket for tooling | base + 81 | 9181 |
| Storage emulator | base + 97 | 9197 |
| Authentication emulator | base + 99 | 9199 |
| Preview server | base + 150 | 9250 |
| Vite development server | base + 151 | 9251 |
| Second origin used by one end-to-end test | base + 152 | 9252 |

The emulator interface stays switched off. All servers bind to `127.0.0.1` only.

A port base is a multiple of 100, for example 9100, 9200 or 9300. Any other value is refused with a message that names the two nearest valid ones. The rule is what keeps runs apart: the web servers of one base sit at offsets 50 to 52 of the next base's range, and no emulator uses those three offsets, so two different bases never have a port in common.

Two runs with different bases do not interfere with each other, so two people, two agents or two test suites can work in the same checkout at once, for example `npm test` in one terminal and `PORTAL_PORT_BASE=9200 npm test` in another. Each run has its own generated Firebase configuration (`firebase.run-<base>.json`), its own directory for emulator logs and Playwright output (`.run/<base>/`), its own temporary directory for the emulators' socket and locator files (`eegml-portal-<base>` under the system temporary directory) and, for emulator builds, its own web output directory. The functions bundle is shared between runs. It is rewritten only when its content changes, and then atomically, so a rebuild in one run does not disturb the emulator of another.

When a run ends, by itself or because it was interrupted, its generated configuration and its temporary directory are removed, so what is left in the portal directory never looks like a run in progress. `.run/<base>/` stays, because it holds the emulator logs and the Playwright traces of a failed run. It is safe to delete at any time when no run is using that base.

The Firestore emulator opens two extra ports on the loopback interface and the Functions emulator briefly opens one while it loads the functions. The Firebase tools choose those themselves and they cannot be configured.

`node scripts/emulators.mjs status` shows which ports of the current base are in use.

## The firebase wrapper

`scripts/fb.sh` is the portal's `firebase` command, and every npm script goes through it. It runs the version of `firebase-tools` pinned in `package.json`, never a global install, and it skips the probe for Google Cloud credentials, which the emulators do not need. `npm run fb -- <arguments>` runs it directly.

The wrapper also works around one defect. When an outbound proxy is configured through `HTTPS_PROXY`, `firebase-tools` sends its own calls to the local emulators through that proxy and ignores `NO_PROXY`, so the calls fail and the emulators crash while starting. In that case the wrapper preloads `scripts/cli-loopback-direct.cjs`, which sends requests for loopback addresses direct and leaves the proxy in place for every other host. It never unsets the proxy and never touches certificate verification. On a machine without a proxy variable the file is not loaded and the wrapper changes nothing.

## Directory map

| Path | Contents |
|---|---|
| `shared/` | `@eegml/shared`. Pure TypeScript with no Firebase imports: a zod schema for every stored document (`src/schemas/`, one file for each section of the data model), the collection registry (`src/collections.ts`), identifier derivation (`src/ids.ts`), roles, capabilities and the resolution of `access/{uid}` (`src/capabilities.ts`, `src/access.ts`), lookup data (`src/seed/`), contracts of callable functions and constants such as the functions region |
| `web/` | `@eegml/web`. The single-page application: Vite, React, Tailwind CSS and Radix primitives |
| `web/config/` | Build-time code: the build modes, the Content-Security-Policy, the reader of the design tokens and the Vite plugin that completes `index.html` and writes `404.html` |
| `web/src/app/` | The shell, the route table, the navigation registry and the build configuration as the application sees it |
| `web/src/auth/` | The authentication provider, the guard for signed-in pages and the handling of sign-in links |
| `web/src/components/ui/` | Interface primitives built on Radix with the design tokens |
| `web/src/components/feedback/` | The standard loading and error states, and `LiveView`, which applies them to live data |
| `web/src/data/` | The data layer, and the only directory that may import the Firebase SDK |
| `web/src/views/` | The view of a collection: the data it reads, the toolbar, the six layouts, the editors of values and properties, saved views, dashboards and their widgets |
| `web/src/editor/` | The page editor: the BlockNote schema with the callout, mention and linked view, the guards, comment anchors, keyboard access and the version preview. It is loaded on demand: outside it, `host.tsx` is loaded lazily, `shortcuts.ts` is imported, and the rest only for its types |
| `web/src/pages/` | One directory per page. `pages/dev/` holds the page of interface components, which exists in emulator builds only and is what the browser tests check the primitives on |
| `web/src/styles/tokens.css` | The single source of design tokens |
| `functions/` | `@eegml/functions`. Cloud Functions, second generation, in `europe-west2` |
| `functions/src/framework/` | `defineCallable`, the audit helper, the error type and the Admin SDK set-up |
| `functions/src/callables/` | One file per callable function |
| `functions/src/triggers/` | The Firestore triggers: the audit trigger, the triggers that keep `access/{uid}` in line with its sources, and the trigger that derives the units of a person |
| `functions/src/access/` | Maintenance of `access/{uid}`: the draft that a callable function resolves and writes in its own transaction, and the rebuild that the triggers run |
| `functions/src/claims/`, `functions/src/roles/`, `functions/src/people/`, `functions/src/notifications/` | What several functions share: the link between an account and a person, role assignments as documents, the confirmation of an entry, and notifications |
| `tools/` | `@eegml/tools`. Admin SDK command-line tools, run with `tsx` from a trusted environment |
| `tests/rules/` | Security-rules tests: the registry-driven matrix with its policy model, fixtures and synthetic world, the hand-written tests of special rules, the catalogue of scoped queries, and the test of the registry-driven references and queries of the web data layer against the Firestore emulator |
| `tests/functions/` | Integration tests of the functions, run against the emulators |
| `tests/tools/` | Integration tests of the tools |
| `tests/e2e/` | Playwright tests of the built application |
| `tests/architecture/` | Tests that read the source tree: import boundaries, design rules, the contrast of every colour pair in use, the standard fields of every document schema, the agreement of the collection registry with `docs/DATA_MODEL.md`, the agreement of the rules file and the index file with the registry, rules about what may be committed, and a production build whose output is read for anything that belongs to the emulators only |
| `tests/editor/` | Tests that need BlockNote's types, compiled by `tsconfig.editor.json`: the text extraction of the functions against `@blocknote/server-util` |
| `tests/support/` | Helpers shared by the suites that use the emulators |
| `scripts/` | Port derivation, the emulator launcher, the stopping of whole process groups, the `firebase` wrapper, the development launcher and the preview server |
| `firestore.rules`, `storage.rules`, `firestore.indexes.json` | Security rules and indexes |
| `firebase.template.json` | The Firebase configuration without emulator addresses. `scripts/firebase-config.mjs` generates the configuration of each run from it |
| `.firebaserc` | The project alias. It names the demonstration project only |

Generated files are kept out of git: `node_modules/`, `web/out/`, `functions/out/`, `.run/` and `firebase.run-*.json`. The directory `portal/.private/` is ignored as well and is the place for local source exports and private configuration.

The repository's `.gitignore` began as a Python template and ignores directories named `lib`, `build`, `dist`, `env`, `venv`, `var`, `parts`, `eggs`, `downloads`, `wheels`, `target` and `instance` anywhere in the tree. Do not give a source directory one of those names. An architecture test fails if git would ignore any source file.

## Where things are added

Each kind of change has one place where it starts. The registries below are that place.

| To add | Start in |
|---|---|
| A stored document or a field | `docs/DATA_MODEL.md`, the schema in `shared/src/schemas/`, built on the standard fields in `base.ts`, and the entry in the collection registry in `shared/src/collections.ts`, then the rules and their tests |
| The rules of a collection | `firestore.rules`, after setting `enforcement` to `enforced` in the registry, with a fixture in `tests/rules/fixtures.ts`. "Security rules and their tests" above lists the steps |
| A list query that is limited to a scope, or that filters on one field and sorts on another | The catalogue in `tests/rules/queries.ts`, and the index it calls for in `firestore.indexes.json` |
| A document identifier that is derived from a natural key | A builder in `shared/src/ids.ts`, with a golden value in `shared/src/ids.test.ts` |
| A kind of record that a polymorphic reference can point at | The registry in `shared/src/entities.ts` |
| A callable function | A contract in `shared/src/callables.ts`, a file in `functions/src/callables/` that uses `defineCallable`, an export in `functions/src/index.ts`, and an integration test |
| A kind of audit event | The registry in `shared/src/schemas/system.ts` |
| A Firestore trigger | A file in `functions/src/triggers/` that takes its options from `documentTrigger`, an export in `functions/src/index.ts`, and an integration test that proves a second delivery changes nothing |
| A reason that a function gives for a refusal, for the interface to act on | The registry `CALLABLE_ERROR_REASONS` in `shared/src/callables.ts` |
| A notification | `writeNotification` in `functions/src/notifications/notify.ts`, in the transaction of the change. The owner marks it as read under the security rules |
| A capability | The registry and the default matrix in `shared/src/capabilities.ts`. `shared/src/access.ts` resolves them into `access/{uid}` and answers `can` |
| Lookup data that a new database starts with | `shared/src/seed/lookups.ts`, which `npm run seed:lookups` writes |
| A page | The route table in `web/src/app/router.tsx` |
| A sidebar entry | The registry in `web/src/app/navigation.ts` |
| A panel on Home | The registry in `web/src/pages/home/panels.ts` |
| An action of the command palette on a page | `usePaletteActions` of `web/src/app/shell/palette-actions.tsx`, called by the page with the actions the account may take |
| A live read of the registry that several views share | `web/src/registry/queries.ts`, and the catalogue in `tests/rules/queries.ts` where the query needs more than a plain read |
| A read of live data | Nothing new: `useLiveDocument` and `useLiveQuery` in `web/src/data/live.ts` serve every entry of the collection registry, with the converter built from its schema. A query is described as data (`web/src/data/query-spec.ts`), which is also its key in the subscription cache |
| An interface primitive | `web/src/components/ui/`, and in the same change the page of interface components in `web/src/pages/dev/`, so the browser tests see it |
| A colour, or a new combination of two colours | `web/src/styles/tokens.css`, and the table of pairs in `tests/architecture/contrast.test.ts` |
| A collection that views can show, or a built-in property of one | `shared/src/views/sources.ts` |
| A command-line tool | A file in `tools/src/commands/` and an entry in the registry in `tools/src/cli.ts` |
| A port | The offsets in `scripts/ports.mjs` |

## Identity, claiming and administration

The functions under `functions/src` are the trusted side of identity. Each callable function is declared with `defineCallable`, validates its input and output against its contract in `shared/src/callables.ts`, reads the caller's access document inside the function, authorises with `can`, asks for the second factor wherever that document requires one, and writes its audit entry in the transaction of its change. The comment above each function says who may call it and what it writes.

| Area | Functions |
|---|---|
| Sessions and the first administrators | `sessionStart`, which also uses a bootstrap record and records the enrolment of a second factor, and `endAllSessions`, which ends every session of the caller's own account |
| Account claims | `claimProfile`, `requestAccess`, `listAccountClaims`, `reviewAccountClaim`, which also admits someone whom no record names as a new member for holders of `people.manage`, `unlinkAccountClaim` |
| Roles and accounts | `setRoleAssignment`, `setCapabilityGrant`, `setRoleCapabilityOverride`, `setUserStatus`, and `listUsers`, the list of accounts of the console, which gives and searches addresses only for a holder of `people.contact.read` |
| Audit trail | `listAuditEvents`, the only way to read the trail, newest first, filtered by actor, record type, action and dates. One equality filter goes to Firestore with an index of `firestore.indexes.json`, and the others are applied to what it returns |
| Laboratories | `requestLabClaim`, which also registers a new laboratory, `withdrawLabClaim`, by which a member withdraws their own request while it waits, `reviewLabClaim`, which creates a registered laboratory on approval, `createLaboratory` and `saveEquipmentConfiguration` |
| Participations | `createParticipation`, the only way a participation is created, as `invited` by the replication or `interested` by the laboratory, and `setParticipationStatus`, which follows the moves of `PARTICIPATION_TRANSITIONS` in the shared package |
| Imports | `resolveReconciliationItem`, `rollbackImportBatch` |
| Records of people | `resolveCorrectionRequest`, `getPersonDemographics`, `setPersonOrcid`, `confirmLaboratoryMembership`, `confirmReplicationMembership` |
| Replications | `setReplicationStatus`, the only way the status of a replication changes (D-019): it checks `replications.manage` for the replication, requires a reason and the status the caller saw, and writes the status, the history entry and the audit entry in one transaction; `editReplicationCitation`, the only way a citation that has been checked changes, which returns it to unverified |
| Triggers | `auditDocumentWrites`, the eight triggers whose names begin with `accessOn`, and the two whose names begin with `personUnitsOn` |
| Scheduled | `accessExpirySweep`, which every fifteen minutes marks a role assignment that has run out as expired and resolves the access document of an account whose assignment or named grant has run out, and `integritySweep`, which runs the integrity checker every night and writes its report |

`access/{uid}` is written in two ways, and both go through `functions/src/access/maintain.ts`. A callable function that changes a role, a grant, a link or a suspension resolves the access document in its own transaction, so the change holds from the account's next request. The triggers resolve it after every other change, such as an import, and write only where the result differs, which is also why a second delivery of an event changes nothing. `npm run access:rebuild` does the same for every account, for a change to how access is resolved.

The audit trigger is one function for every document. It records a write to any collection that the registry flags as audited and lets clients write. A callable function names its audit entry in `writeContext.auditEventId` of each document it writes, and the security rules refuse a client write that names one, so the trigger passes over a write whose named entry is new with that write and exists. Everything else it records under the identifier of the event.

Three settings belong to a deployment and have no value in this repository.

| Setting | Meaning |
|---|---|
| The secret `IDENTITY_HASH_KEY` | The key of the keyed hashes behind `personEmailIndex`, `identityKeys` and `bootstrapAdmins`. It must be the `hashKey` that the importers of the same project use. The emulator uses a public demonstration key instead, and so do the tools when they write to the emulator |
| `requireSecondFactor` in `system/settings` | Whether holders of a programme role or of a named grant must enrol and present a second factor. Absent means true. Only `seed:demo` switches it off, for the emulator |
| A record in `bootstrapAdmins` | Written by `npm run admin:bootstrap -- --email <address>`. The first account that signs in with that address, verified, becomes a programme administrator. Only the keyed hash of the address is stored |

## Identity in the browser

After sign-in, Home sends an account that is not linked to a member profile to `#/claim`, and the navigation offers that page in place of Home until the account is linked. That page calls `claimProfile`, which reads the address from the sign-in token, so nothing typed on the page is used to look anyone up. An account that a match links goes on to Home, which says once that it is now linked. Otherwise the page shows one outcome: a notice that an administrator will review the account, with an optional statement for the reviewer sent through `requestAccess`, or a short request for access with a button that signs out to use another address. It follows `access/{uid}` and `accountClaims/{uid}` live, so an administrator's decision appears without a reload, and `claimProfile` marks the account's notifications about its claim as read, because an account that is not linked may write nothing. A linked member sees the profile, its laboratories and replications on Home, and reports a wrong detail there as a correction request, which the rules let a member create.

Some operations stay with programme administrators whatever the capability matrix gives the core team: changing a programme role (`setRoleAssignment` for `programme_admin` or `core_team`), granting or revoking a sensitive capability (`setCapabilityGrant`), suspending, reinstating or unlinking the account of programme staff (`setUserStatus`, `unlinkAccountClaim`), changing an override (`setRoleCapabilityOverride`) and linking an account to a person who is not among its claim's candidates (`reviewAccountClaim`). Nobody decides the claim of their own account or grants a capability to their own account, and a `programme_admin` assignment never carries an expiry time. Email addresses are compared with ASCII letters lower-cased and every other character kept, so an address that only folds to another never matches it. The audit log names an acting account only by the person it is linked to, and the console marks a name that an account gives itself as unverified. Accepting a correction request can set a name or a country on the person in the same transaction; any other detail is corrected where it comes from, and the member sees the report as accepted and not yet corrected until then. Live views keep their loading state until the database has answered once, and the shell says when the database cannot be reached. Google sign-in is built in only with the build flag `VITE_ENABLE_GOOGLE_SIGN_IN`, which is off by default.

`#/account` shows the signed-in address, the linked profile, the roles in effect from the access document, signing out here and everywhere (`endAllSessions`), and the second factor. A time-based one-time password is enrolled with the Firebase SDK's multi-factor API through `web/src/data/second-factor.ts`: the secret is shown as a QR code drawn in the browser (the `uqr` package) and as text, and the first code confirms it. A sign-in of an account with a factor stops at a second step that asks for the code. The bell in the top bar counts the unread notifications of `users/{uid}/notifications` and lists the latest, each with a link where its page exists. A member marks one as read under the rules.

The administration console is the group "Administration" of the navigation registry. Each of its pages is wrapped in `AdminPage`, which checks the capability of its navigation entry against the access document, so typing an address opens no more than the sidebar shows, and the rules and functions behind each page refuse everyone else anyway. While the access document requires a second factor that is not enrolled, or that this session did not present, a page of the console is replaced by a prompt to enrol one or to sign in again with it (`web/src/auth/privilege.ts`).

| Page | Reads | Acts with |
|---|---|---|
| `#/admin/claims` | `listAccountClaims` | `reviewAccountClaim` |
| `#/admin/lab-claims` | `labClaims` and their review documents, for the programme or for a coordinator's laboratories | `reviewLabClaim` |
| `#/admin/corrections` | Open `correctionRequests` | `resolveCorrectionRequest` |
| `#/admin/users` | `listUsers` | `setUserStatus` |
| `#/admin/roles` | `roleAssignments`, `capabilityGrants`, `roleCapabilities/core_team` | `setRoleAssignment`, `setCapabilityGrant`, `setRoleCapabilityOverride` |
| `#/admin/audit` | `listAuditEvents` | Nothing |
| `#/admin/imports` | `sources` and `importBatches`, for holders of `imports.run`. A source is named by its key and title, never by the address of its document | Nothing |
| `#/admin/imports/batches/:batchId` | The batch, its `log` and its `changes`. The values of restricted and special-category documents are withheld | `rollbackImportBatch`, offered to holders of `imports.rollback` behind a confirmation that lists what would change |
| `#/admin/review-queue` | Open `reconciliationItems`, for holders of `reconciliation.resolve` | `resolveReconciliationItem` |
| `#/admin/integrity` | The latest of `integrityReports` and its findings, for holders of `audit.read` | Nothing |

The browser tests start from the synthetic world of `seed:demo`, which `tests/e2e/global-setup.ts` writes after it has emptied the emulators. With `PORTAL_REVIEW_SCREENSHOTS` set to a directory, the tests of identity and administration also save a screenshot of each page they check at 1440 by 900 and 390 by 844 pixels.

## The registry of replications and members

The registry pages read the directory collections as a whole, which every member may read, and search, filter and sort them in the browser (D-011). The queries are described once in `web/src/registry/queries.ts`, so that every view of the same documents shares one listener. Each query stays within the limit of 1,000 documents that the rules allow a list, and a top-level directory is read in pages of that size (`useLiveCollection`), each after the last document of the one before, so that more than 1,000 members are read whole. The registry pages are for an account linked to a member profile (`RequireLinked`): any other account that follows a link to one is asked to link itself first. Search folds text in any script (`searchFold`), and a query that holds no letter or digit matches nothing. What a page shows to whom is decided in `web/src/registry/viewer.ts` from the access document, the way the rules decide it, and the rules and the functions refuse whatever the page asks: `tests/rules/registry-features.test.ts` proves each refusal that the pages rely on.

| Page | Shows | Writes |
|---|---|---|
| `#/replications` | Every replication in a sortable table with search, filters for status, public stage, theme, listing on the public website and the status of a publication, a count, and a preview beside the list. The state of the list, the open preview included, is in the address | Nothing |
| `#/replications/:studyKey` | The header and the tabs Overview, Leadership, Laboratories, Hypotheses, Publications, Contributors, Documents and Activity, each present only when it has content, and Notes and Dashboard, which every replication has. Imported historical figures sit in a panel of their own, with main experiment and resting state side by side and never added. The historical labels of hypotheses are shown as unverified source values, and the "replicated" label only to the team and the programme | Descriptive fields in place, for the leads, the core team and administrators, checked against the shared schema; the status through `setReplicationStatus`; a correction request for an extraction field |
| `#/members` | Every person in a virtualised table with search across name and affiliation, filters for country, replication, laboratory and core team, a count and a preview. Whether a profile is claimed is shown to holders of `claims.review` or `people.manage` | Nothing |
| `#/members/:personId` | Directory fields, affiliations, replications with roles and laboratories. The contact document is read only where the rules allow it, and a refusal shows nothing. Demographic details are asked of `getPersonDemographics` on request, by the person or a holder of `demographics.read` | The profile addresses for the person and `people.manage`; the ORCID iD through `setPersonOrcid`; a correction request |
| `#/admin/memberships` | The memberships that wait for review, such as leads on which the sources disagree | `confirmReplicationMembership` |

Home adds the member's pending laboratory entries, a snapshot of the programme counted from live documents, whose every figure links to the filtered list behind it and has a table view, and the count of memberships to review for the programme. The top bar has a search control, also opened with Control or Command and K, that finds replications by identifier, other spellings, title and authors, members by name and affiliation, laboratories, destinations and the actions of the current page. It loads only the directory documents and never a restricted field, and remembers chosen records in `users/{uid}/recents`. The sidebar lists the account's favourites and recent records.

`seed:demo` writes a fourth replication, removed from the public website and without a status, with aliases, hypotheses, manuscripts, a contributor table, historical aggregates, document links and an entry of status history, so that every tab has something to show in the browser tests. The browser tests of the registry are the files `tests/e2e/registry-*.spec.ts`. One of them adds 988 synthetic persons, checks that the directory of 1,000 scrolls without a long task above 200 milliseconds, and removes them again.

## Laboratories, participations and the imports console

No source that could be opened lists laboratories, so the registry of laboratories starts empty in a real project. A laboratory comes into being in two ways. A member with a linked profile registers one from `#/labs`, with its institution chosen from those that exist or entered as new with its country and city, and asks to be its coordinator or representative: `requestLabClaim` stores the request with the proposal, under the identifier that the laboratory will take. A programme administrator or a member of the core team approves it on `#/admin/lab-claims`, and `reviewLabClaim` then creates, in one transaction, the laboratory, the institution where it is new, their identity keys, the member entry and the role assignment, with an audit entry for each record. An administrator can also create a laboratory directly with `createLaboratory`. A registered laboratory takes `lab__` and the hash of its name key at its institution (`registeredLaboratoryId`), and a new institution takes `inst__` and the hash of its name and country (`registeredInstitutionId`), so the same laboratory proposed twice, however its name is spelt, has one identifier: the second request is marked as a duplicate and the reviewer sees it beside the laboratory that exists, and its approval gives the role in that laboratory without creating anything. The form says so before anything is sent. A member asks to represent a laboratory that exists with "I represent this laboratory" on its page, through the claim flow that was there before.

| Page | Shows | Writes |
|---|---|---|
| `#/labs` | Every laboratory with search, filters for country and replication, sort, a count and a preview, all in the address, and an empty state that explains how laboratories are added | `requestLabClaim` with a proposal; `createLaboratory` for holders of `labs.manage` for the programme |
| `#/labs/:laboratoryId` | Profile with institution, department, country, city, website, principal investigator, coordinators and authorised representatives; members; equipment with the history of each chain; participations; activity. The address and internal notes are read only where the rules allow | The profile in place, for the coordinators, the core team and administrators; the address and notes; `saveEquipmentConfiguration`; `requestLabClaim` |
| `#/readiness` | Laboratories by replications, with the status, readiness and checklist progress of each participation, filtered by replication, country and status; a cell opens the participation beside the matrix | What the participation offers |
| The tab Laboratories of `#/replications/:studyKey` | Each participation with its status, local lead, the targets of the main experiment and the resting state apart, the compatibility of the laboratory's current equipment, the checklist and the restricted detail for those in scope | `createParticipation` for its leads, the core team and administrators; `setParticipationStatus`; the checklist; the onboarding details and an equipment override |

An equipment configuration changes only through `saveEquipmentConfiguration`: editing the current one closes it and opens its successor, which names it in `supersedesId`, in one transaction, so a closed configuration is never rewritten and each chain has one current configuration. The compatibility of a laboratory with a replication is computed by `equipmentCompatibility` of the shared package from the replication's equipment requirements: each requirement is met, missing with the capability and both values named, or unknown where the configuration does not say. An override is a justification in the restricted detail of the participation. `createParticipation` refuses a second participation of the same pair, and writes the participation, its detail, one checklist item for each item of the onboarding template, the first entry of the status history and the audit entry. The security rules let the members of the laboratory change the items of the checklist that they may, and only the replication's side the item of readiness approval.

The imports console is two entries of the administration group. Imports lists the sources and the batches, and a batch page shows its statistics, log and changes, with the rollback for holders of `imports.rollback`: `rollbackImportBatch` first answers what it would change, and the interface shows that for confirmation. It uses `planBatchRollback` of the shared package, the logic that the command `import rollback` of the tools uses as well. The review queue decides items through `resolveReconciliationItem`: leads in conflict are marked as current, former or wrong, a value in conflict is chosen or the current one kept, and a possible duplicate person is marked as distinct or merged, where the merge moves the references through the identity keys, keeps every source link on the kept record and refuses to merge away a record that an account has claimed. A decided item never reopens. The integrity checker, `checkIntegrity` of the shared package, finds references that name no document, identifiers that disagree with their fields, persons linked to more than one account, denormalised values that disagree with their source and equipment chains with two current configurations.

Home shows the member's laboratories and, for a coordinator, what needs attention: requests to represent the laboratory, missing equipment, unanswered invitations and open onboarding items. The command palette finds laboratories and opens their pages.

`seed:demo` adds to its world three equipment configurations, one of which replaced another, equipment requirements for three replications, the checklist and restricted detail of each participation, two sources, one applied batch with its changes and log, and three items of the review queue. The functions tests are `tests/functions/laboratories.test.ts`, `participations.test.ts` and `imports-console.test.ts`, the rules tests `tests/rules/laboratory-features.test.ts`, and the browser tests `tests/e2e/laboratories.spec.ts` and `imports-console.spec.ts`.

## The workspace

The workspace holds the pages of the programme (D-010, D-011, `docs/DATA_MODEL.md` section 9). A page lives at `#/pages/:pageId`, with breadcrumbs through the pages that contain it, and `#/pages` lists the pages at the top of the workspace, its templates and the archived pages. The sidebar shows the same tree under Workspace; which branches are folded, and whether the whole group is folded, is remembered in `localStorage`. Every replication, laboratory and member has one page for its notes, on the tab Notes of its record, which `openEntityPage` creates the first time anyone opens it, with the audience of the record.

| Action | Where it is decided |
|---|---|
| Create a page, inside another or from a template | `createPage`, which copies the template's content and resolves the audience of the parent |
| Rename, give an icon, reorder among siblings | The rules, as a client update by an editor: `title`, `icon`, `order` (an order key between its neighbours, `shared/src/order.ts`) and `isTemplate` |
| Move to another parent | `movePage`, which rewrites the audience of the page and of every page inside it |
| Archive and restore | The rules, as a client update by an editor of `archivedAt` |
| Share: inherit, or restricted with view, comment, edit and full access for named members, laboratories or teams | `setPageSharing` and `getPageSharing`, for holders of full access. `pageLevelFor` of `shared/src/page-access.ts` is the one statement of the levels, and the helpers `readsPage`, `holdsLevel` and their `At` forms in `firestore.rules` mirror it |

The editor is BlockNote 0.57 with its MPL packages only (`@blocknote/core`, `react`, `mantine`, `code-block`), never `@blocknote/xl-*`. It is loaded on demand: `web/src/editor/` is a chunk of its own, and the rest of the application does not grow with it. It offers paragraphs, headings, bulleted, numbered and check lists, tables, quotes, dividers, code with highlighting, callouts, images and files, the slash menu, the Markdown shortcuts of BlockNote, drag handles, undo and redo, and mentions of members. The slash menu also offers a linked view, which shows a live view of a collection inside the page (see the next section). Images and files are stored under `pages/{pageId}/files/` in Cloud Storage: the Storage rules let the readers of the page read them and its editors add them, 20 MB at most, never replace them.

The content is one Yjs document per page. `web/src/data/page-sync.ts` is the provider that the spike verified: changes are merged and written every two seconds at most (ten while typing goes on) as update documents, every editor follows the updates of the others, applying an update twice changes nothing, and after fifty updates, or a quiet spell, an editor compacts them into chunks of a later generation in one transaction that the rules check step by step. The page shows Saving, Saved, Not saved or Read only. Offline, changes stay in the browser and are sent when the connection is back; the convergence of two editors, a reload and an offline edit are tested in `tests/e2e/workspace.spec.ts`. The two guards of `web/src/editor/guards.ts` work around two defects of BlockNote 0.57 that the spike found: a code block whose language is unknown, and a position that a remote change moved.

Comments are threads anchored to a selection of the text, by Yjs relative positions, or about the page as a whole, with replies, mentions, resolve and reopen, in the panel beside the page. Those with comment access write there and never in the page body. Version history saves a version automatically after a quiet spell of editing when the content changed, and by name on request; a version is shown read only, and restoring it writes a new change that every collaborator receives. Activity lists who edited the page and when, one entry for each spell of editing, from the update documents, with no content.

Three triggers work from the stored documents, and each is idempotent. `pagesOnUpdateCreated` notifies the members newly mentioned in the page who may read it, records the spell of editing and indexes the text. `pagesOnPageWritten` keeps the index and the scope of the threads in line with the page. `threadsOnCommentWritten` notifies the members mentioned in a comment and those who wrote earlier in the thread. The index (`searchIndex`) is scoped like the page, and `searchWorkspace` answers the command palette and the search of the workspace with the pages the account may read. The text is extracted on the server by walking the Yjs document; `tests/editor/page-text.test.ts` proves it gives the same text as the converter of `@blocknote/server-util`.

BlockNote's types do not compile under `exactOptionalPropertyTypes`, so the web package and `tsconfig.editor.json`, which covers `tests/editor/`, leave that option off; every other package keeps it on.

The keyboard reaches everything in the editor except dragging a block with the side menu, which BlockNote offers to the pointer only. The equivalents are Control Shift Up and Down to move a block, Tab and Shift Tab to nest it, Alt F10 to move into the formatting toolbar (the arrow keys move within it and Escape returns to the text), and Control Alt M to comment on the selection. The page lists them under More actions, Keyboard shortcuts. One further limit remains: the tree and the list of archived pages are not virtualised, which matters only beyond a few hundred pages. Who else has a page open is shown in its header, and their carets in the text, through one small document per open tab beneath the page (`pages/{pageId}/presence`), written at most every two seconds and as a heartbeat every minute, as the editor spike measured. The build variable `VITE_PRESENCE` chooses `cursor` (names and carets, the default), `presence` (names only) or `off`. Pages are for members: an external collaborator cannot be given access to one.

The tests are `tests/rules/workspace-features.test.ts` and the matrix for every collection of the workspace, the page files in `tests/rules/storage.rules.test.ts`, `tests/functions/workspace.test.ts` for the callables and triggers, `tests/editor/page-text.test.ts`, and `tests/e2e/workspace.spec.ts` for acceptance scenario AS-7, convergence, offline editing, the keyboard and axe on the page view.

## Databases, views and dashboards

Views are computed in the browser over one authoritative set of documents (D-011, `docs/DATA_MODEL.md` sections 9 and 15). The engine is pure TypeScript in `shared/src/views/`, unit tested beside its code, and the browser applies it to the documents the account may read. The same participation is therefore one document on the programme's dashboard, on the tab Dashboard of its replication and of its laboratory, and in any linked view, and an edit made in one reaches the others through the shared listeners of `web/src/data/live.ts`.

| Part | Where | What it does |
|---|---|---|
| Model | `shared/src/views/model.ts` | Values of each property type, the configuration of a property and of a view (filter tree, sorts, grouping, order, hidden properties, widths, search, board, calendar and timeline properties), and the fixed scope of a view |
| Filters | `shared/src/views/filter.ts` | `and`, `or` and `not` to six levels, operators for each type including empty and not empty, dates relative to today and windows such as the next month. A negated condition holds for an unknown value, and no unknown value counts as zero |
| Sorting, grouping, rollups, the pipeline | `shared/src/views/compute.ts` | Several sort keys with empty values last, groups in option order with folded groups, rollups through a relation or a backlink (count, count values, sum, average, smallest, largest, percentage ticked, earliest, latest, show values), formulas, search, and the figures of dashboards |
| Formulas | `shared/src/views/formula.ts` | A tokenizer, a Pratt parser and an evaluator: arithmetic, comparison, `and`, `or`, `not`, `if`, and functions on texts, numbers, lists and dates, referring to a property as `prop("Name")`. No `eval`. An expression holds 2,000 characters and nests 40 deep at most, and an evaluation takes 10,000 steps and 50 milliseconds at most; a failure is the error of that cell |
| Collections | `shared/src/views/sources.ts` | The registry of collections that views read: `core:replications`, `core:persons` (Members), `core:laboratories`, `core:participations` with the rollup of checklist completion, and `db:<id>` for every database. A custom property never takes the place of a core field |
| Dashboards | `shared/src/views/dashboard.ts` | The widgets (view, figure, chart, activity, note), the twelve-column grid with moving, resizing and compaction, and the default widgets of the programme, a replication and a laboratory |

Every value that a view writes goes through a callable function, because a value of a property may be a list or a map that no security rule can check element by element.

| Function | Who may call it | What it writes |
|---|---|---|
| `createDatabase` | An editor of the parent page | The database, with the audience of the page and a status property |
| `saveProperty` | An editor of the database; for a core collection, holders of `lookups.manage`, who say whether the values are for every member or restricted to the scope of the record | One property definition, checked: unique options, a relation to a collection that exists, a rollup of a property that exists and a formula that parses. Its type and audience do not change |
| `saveRecords` | An editor of the database; for a core record, whoever may change it (`replications.manage`, `labs.manage`, `participations.manage` or `people.manage` in its scope) | Rows and their values, custom values in `custom`, restricted ones in `private/custom`, and the core fields that the registry lets a client change, all checked against their property and the strict schema of the record, up to 100 records in one transaction with an audit entry for each |
| `saveView` | The owner of a view; programme administrators and the core team for a shared one | A personal or shared view |
| `openDashboard` | Any member | The dashboard of the programme, a replication or a laboratory, created on first use under `scopeType__scopeId` |
| `saveDashboard` | The owner of a personal dashboard; holders of `pages.manage` in the scope of any other | The widgets that changed, each replaced or removed whole |

The rules read databases as their page (a copy of its audience, which `pagesOnPageWritten` keeps current), rows through their database, collection schemas by every member, restricted custom values within the scope of the record, a view by its owner until it is shared, and a dashboard of a user by that user. The tests are `tests/rules/views-features.test.ts` and the matrix, `tests/functions/views.test.ts`, `tests/e2e/views.spec.ts`, and `tests/e2e/workspace.table-performance.spec.ts`, which runs last because its 5,000 rows queue ten thousand runs of the audit trigger.

| Page | Shows | Writes |
|---|---|---|
| `#/databases/:databaseId` | A database in a table, a list, a board, a calendar, a timeline or a gallery, with search, filter, sorts, grouping, the properties shown and saved views | Rows and values in place and in bulk, properties, the name, archiving |
| `#/dashboards` | The programme's dashboard, the dashboards of replications and laboratories that were opened, and the member's own | A personal dashboard |
| `#/dashboards/:dashboardId`, the tab Dashboard of a replication and of a laboratory | The widgets on the grid | Widgets added, removed, moved and resized |
| A page of the workspace | Its databases, and linked view blocks | A database beneath the page; the records and the view of a linked view block, kept in the block |

The table renders only the rows in view (`ROW_HEIGHT` 36 pixels), so 5,000 rows scroll without a long task above 200 milliseconds, which the browser tests measure. Its columns are resized with the pointer or with the arrow keys on their handle and reordered by dragging their header or with Move left and Move right in its menu. A board moves a card by dragging it or with its Move to control, and a dashboard moves and resizes a widget by dragging its handle or, with the handle focused, with Enter, the arrow keys and Shift with the arrow keys. A value of the type `file` is a list of links, each a name and a web address: files of pages stay in Cloud Storage.

What is left out: a relation or a rollup to a database is read for the databases that the viewed database points at, one level deep; a rollup reads the stored values of the related records and not their formulas; the timeline draws 300 records at most, the list 500 and the gallery 300, each saying so; and the widgets for embedded content, calendars and timelines of the data model are views of the type calendar or timeline.

## Tasks

Tasks replace Quire (D-019, `docs/DATA_MODEL.md` section 8). A task list belongs to a person (personal), to the programme, a replication, a laboratory or a group (project), or is a template from which project lists are made. Lists and tasks are written only by functions, because a move rewrites a subtree and a status change writes its history; the rules let a reader read a list of their scope and a task of such a list, and the participants of a task read the task itself. Tags, reminders and progress updates are enforced as well.

| Action | Where it is decided |
|---|---|
| Create a list, empty or from a template, and rename or archive it | `createTaskList`, `updateTaskList`: the owner of a personal list, or `tasks.manage` for the scope |
| Create a task and change its fields, alone or in bulk | `createTask`, `updateTasks`: managers change every field, assignees and collaborators the status, progress, estimate and checklist ticks (`PARTICIPANT_TASK_FIELDS` of `shared/src/task-access.ts`) |
| Move a task with its subtasks, within a list or to another | `moveTask`, which refuses a move beneath the task itself, a tree deeper than 20 levels or a subtree of more than 400 tasks, and places it with a fractional order key (`shared/src/order.ts`) |
| Change a status | `setTaskStatus`, which checks the status each task had, writes `completedAt` and the history entry, and tells the followers |
| Post a progress update | `postProgressUpdate`, by the team of a replication, the members of a laboratory or the member, once a minute on one record and with at most ten mentions, of which only active members are told; updates never change, and the followers of the record are told |
| Set a reminder | `setReminder`, for a task the caller reads, at a time between an hour ago and two years ahead, with at most 200 waiting per user; its owner moves or removes it directly |

A dependency is one of finish to start, start to start, finish to finish and blocks. The interface offers no dependency that would close a cycle (`wouldCreateCycle` of `shared/src/task-tree.ts`), the functions refuse one, and `integrity:check` reports any cycle that an import brought in. An assignee or collaborator without an account is kept as an unclaimed participant and becomes an assignee when the person claims their profile (`functions/src/tasks/claims.ts`). A recurring task follows a subset of RFC 5545 (daily, weekly on chosen days, monthly on a day of the month, with an interval and an end by date or count, `shared/src/recurrence.ts`): when it is finished, `tasksOnTaskWritten` creates the next occurrence under an identifier derived from the series, so a second delivery creates nothing. Reminders are in-app notifications about a task that `remindersSweep` sends every five minutes, page after page until none is due, to an owner who still reads the task. The functions also refuse a dependency or a link to a record the caller may not open with the same words as one that does not exist, check the dependencies of every task of one call together, and copy a template only when its dependencies hold no cycle. A recurring task brings its next occurrence only when that falls within two intervals of today. A link to a dataset names one of the registry and opens its page.

The page `#/tasks` shows My tasks, every task the account may read, and each list. A list is a tree, which follows the WAI-ARIA tree pattern: the arrow keys move between tasks and open and close subtasks, Enter opens one, and Alt with an arrow moves a task up, down, beneath the task above or out of its parent. Its views are those of the view engine on the collection `core:tasks`: a nested list, a board by status, a calendar by due date and a timeline with the lines of dependencies and the diamonds of milestones, with saved views and bulk edit. Workload by assignee and week, risks and blockers, the roadmap of milestones and the dependencies between replications are computed by `shared/src/task-planning.ts`. Replications, laboratories and members have a Tasks tab and an Updates tab, and a linked view in a page can show tasks. A meeting is a page of the kind `meeting` with its sections, and a line of it becomes an action item: a task linked to the page, which the line then shows live.

`npm run --silent -w @eegml/tools cli -- import run quire --input <dump.json> --mode preview|apply` imports a Quire export: projects become lists, tasks keep their tree, order, statuses, dates, tags, assignees matched to members by address, dependencies, descriptions and comments, under hashed identifiers, so a second run changes nothing. It writes a report of what it could not map beside the input (`<input>.report.json` and `.report.txt`). It writes past the functions, so it keeps their promises itself: a task that is its own parent, sits in a cycle of parents or lies too deep is imported at the top, a dependency that would close a cycle is left out, and each is raised for review and named among the lossy conversions of the report. The fixture `tools/src/import/fixtures/quire.ts` is synthetic.

The tests are `shared/src/recurrence.test.ts`, `task-tree.test.ts` and `task-planning.test.ts`, `tests/rules/tasks-features.test.ts` and the matrix, `tests/functions/tasks.test.ts` for the callables, recurrence, reminders and the hand-over at a claim, `tests/tools/import-quire.test.ts`, and `tests/e2e/tasks.spec.ts` for acceptance scenario AS-6, the action items of a meeting, progress updates, the keyboard on the tree and the board, and axe on each new page.

## Recruitment

Recruitment is an append-only series of reports (D-009, D-019, `docs/DATA_MODEL.md` sections 7 and 15). A report counts by category and by modality, and the main experiment, the resting state and unique participants are always separate columns: nothing in the portal adds one to another. A value that no report states is unknown, and every figure says so in words instead of showing zero. A correction or a withdrawal is a new report that names the one it replaces, and a central verification is a new report beside the laboratory's, so the laboratory's figures are never overwritten.

| Action | Where it is decided |
|---|---|
| File reports: new, a correction, a withdrawal, one for each changed row of a table | `fileRecruitmentReports`: `recruitment.report` for the laboratory or the replication (its members, coordinators and leads); every category current and global or of the replication, every reason a term of the exclusion reasons, a date that has come, and a report to replace that nothing has replaced yet. It recomputes `replications/{studyKey}/summaries/recruitment` in the same transaction |
| Verify a report centrally | `fileRecruitmentReports` with the basis `centrallyVerified`, for holders of `recruitment.verify` (administrators and the core team) |
| Add or change a category | `saveCountCategory`: `lookups.manage` for a global category, `replications.manage` for a category of one replication. A key is never reused and a core category is never archived |
| Plan a pause | A client write under the rules, by those who manage the participation |
| Store a forecast | `generateForecast`: `replications.manage` for the replication; it reads the reports and pauses itself |
| Flag silent laboratories | `recruitmentInactivitySweep`, every morning: a collecting participation without a report for `recruitmentInactivityDays` of `system/settings` (30 where it is not set) is flagged once for each spell, with an in-app notification to the coordinators of its laboratory and the leads of its replication and one follow-up task in the list "Recruitment follow-up" of the laboratory (`functions/src/recruitment/inactivity.ts`) |

Every figure comes from one resolver, `resolveParticipation` of `shared/src/recruitment-effective.ts`: for a participation and a date it takes, key by key, the latest live cumulative report on or before that date, where a correction or a void removes what it names and of two reports of one date the one filed later holds; lab-reported and verified values are kept apart, and the effective value prefers the verified one while it holds for the same or a later date. Period reports feed trends and are never added to a cumulative value. `shared/src/recruitment-rollup.ts` sums the effective values by laboratory, replication, country, institution and the programme, each figure naming its bases (reported, verified, imported, projected) and how many of the participations expected to report state it. The imported historical aggregates are listed apart, labelled imported, and never added to live reports.

| Page | Shows | Writes |
|---|---|---|
| `#/recruitment` | The latest totals of every replication from the summaries every member reads, lab-reported and verified apart; then, as of a chosen date (with "End of last month"), from the reports the account may read: target against actual, completion, active sites, attrition from recorded to usable, usable N, the rate over 90 days, a rollup by any dimension, the figure at the end of each of twelve months, each participation with its reported and verified values, the imported history and the milestones of the task lists | Nothing |
| `#/recruitment/participations/:participationId` | The values of each category and modality on a date, reported and verified side by side, the exclusions, every report with what replaced it, and the planned pauses | A report, a correction, a withdrawal or a verification; planned pauses |
| The tab Recruitment of a replication | The same figures for the replication, and its laboratories in a table that its leads edit in place: each changed row is filed as one report | `fileRecruitmentReports` |
| `#/recruitment/forecast/:studyKey` | The assumptions beside the result, recalculated in the browser on every change, every figure labelled projected, and the stored runs | `generateForecast` |
| `#/recruitment/categories` | The global categories with their definitions and the categories of each replication | `saveCountCategory` |

Views and dashboards read recruitment through two sources of the view engine: `core:recruitmentReports`, every report the account may read, and `core:recruitment`, one record for each participation with its effective values today, one number property for each modality and category. The default dashboards of the programme, a replication and a laboratory show tested participants for the main experiment, the resting state and unique participants as three separate figures.

### The forecast method

The forecast is an extrapolation from stated assumptions and not a statistical model, and the page and `docs/DATA_MODEL.md` section 15 say the same. For each active laboratory it takes the change of its effective cumulative count of the chosen category and modality between the value that held at the start of the window, or the earliest value within the window where none held, and the value at `inputsAsOf`, divided by the days between the dates of the two reports. It assumes the laboratory goes on at that rate, with nothing added on the days of its planned pauses, and never stops at a target of its own. It aims at the target divided by one minus the expected exclusion rate. The optimistic and conservative scenarios multiply every rate by one plus and one minus the spread. The range of each scenario repeats the projection with the slower and the faster of the rates of the two halves of the window; it shows how uneven recruitment has been, and is not a confidence interval. A laboratory with fewer than two dated values in the window adds nothing, and where no laboratory has a rate the rate and the completion of every scenario are unknown, never zero; a negative rate counts as zero, a participation with no current value counts as nothing, and the result lists each of these limits. Projected counts are whole people: the aim is rounded up and the series down. The method is `forecastRecruitment` of `shared/src/recruitment-forecast.ts`, version `recruitment-forecast/2`, and both the page and `generateForecast` run it. A stored run, which every member reads, holds the figures of the replication as a whole and none of a single laboratory; the page works out each laboratory's figures again from the reports its viewer may read. A summary or a forecast of a replication with more reports than one transaction reads is refused rather than worked out from part of them, and one participation holds at most 400 reports.

### Master projection spreadsheets (R9.13)

They stay blocked. The synchronisation engine of the next section exists, against a fake of Google, but no master spreadsheet has been designated and no service account exists, so no mapping of recruitment is registered: the registered targets are laboratories and equipment. When the sheets are designated, a mapping of the master projection sheet would be a `syncMappings` document with the direction `sheetAuthoritative` for the projected columns and `appAuthoritative` for the reported columns, keyed by participation; a row read from the sheet would become a report with `source` `sheetSync` through `fileRecruitmentReports`, so that it is validated and audited like any other, and a projection would become a forecast run labelled projected. No control for it is shown until then.

The tests are `shared/src/recruitment-effective.test.ts`, `recruitment-rollup.test.ts` and `recruitment-forecast.test.ts`, `tests/rules/recruitment-features.test.ts` and the matrix, `tests/functions/recruitment.test.ts` for the callables, the summary and the inactivity sweep, and `tests/e2e/recruitment.spec.ts` for acceptance scenarios AS-4 and AS-5, the inline table, axe on each new page and the layout at 360 pixels. `seed:demo` adds a history of reports at one participation, with a correction and a verification, its summary, a planned pause and a category of one replication.

## Google Workspace

Drive, Sheets and Docs are built against an in-memory fake of Google and never against Google itself (`docs/INTEGRATIONS.md`, sections 3 and 3.8, and `docs/DATA_MODEL.md` section 12). The interfaces are in `functions/src/integrations/google/types.ts`. The fake, with its synthetic fixtures, is in `google/fake/`, and reproduces quotas, stale revisions, expired channels, lost access and outages; the emulator's functions and the tests share its state through a file in the run's temporary directory, so a test edits the same sheet that a function reads. The real adapters in `google/real/` are written, have never been executed, and are unverified. `google/adapters.ts` chooses: the fake in the emulator, the real adapters when the parameter `GOOGLE_WORKSPACE_SERVICE_ACCOUNT` is set, and otherwise none, which the integrations page shows as "Not connected: credentials not supplied". Firestore holds the name of that parameter and never a key.

| What | Where |
|---|---|
| The three-way planner, value canonicalisation, backoff and the registered targets | `shared/src/sync/`, pure and unit tested |
| Templates, managed sections and provenance of generated documents | `shared/src/docs/` |
| The job queue: a `syncRuns` record is the job, claimed in a transaction, retried in the run and then by the sweep, and dead-lettered when its attempts are spent; one lease for each spreadsheet | `functions/src/integrations/jobs/` |
| Callables | `linkDriveResource`, `checkDriveLink`, `browseDriveFolder`, `previewDriveFile`, `saveSyncMapping`, `controlSyncMapping`, `requestSyncRun`, `controlSyncRun`, `resolveSyncConflict`, `resolveSyncReviewItem`, `controlIntegrationConnection`, `saveDocumentTemplate`, `generateDocument` |
| Triggers | `integrationsOnRunWritten` runs a queued run; `syncOnLaboratoryWritten` and `syncOnEquipmentWritten` queue runs for a change that did not come from synchronisation; `integrationsSweep` every ten minutes; `driveNotifications`, the public receiver of Drive push messages |
| Pages | `#/admin/integrations` (overview with the health of each service, mappings, jobs with each run's plan, review items, documents and templates, Drive channels) and `#/admin/integrations/conflicts`, for holders of `integrations.manage`; the tab Documents of a replication and of a laboratory, with linked Drive items, browsing, preview and generated documents |

A mapping starts as a dry run, which computes and shows its plan and writes nothing, and writes only after a programme administrator approves live writes. Synchronisation writes carry the origin `sync`, and the triggers ignore them, so the engine never starts a run from its own write. `seed:demo` adds the three connections on the fake, two sheets (the equipment register, live, and the laboratory directory, a dry run), their mappings and one template of each of the six kinds.

The tests are `shared/src/sync/*.test.ts` and `shared/src/docs/docs.test.ts`, `functions/src/integrations/google/fake/workspace.test.ts` for the fake, `tests/functions/integrations-runner.test.ts` for the runner in the test's own process (quotas, outages, lost access, stale revisions, anchors, ceilings, dead letters), `tests/functions/integrations.test.ts` for the callables and triggers on the emulators (acceptance scenarios AS-9 and AS-10, and outage and lost access of AS-15), `tests/rules/integrations-features.test.ts` and the matrix, and `tests/e2e/integrations.spec.ts` for AS-10, the synchronisation half of AS-3, AS-9, the conflicts screen, Drive linking and browsing, axe and the layout at 360 pixels.

## Datasets

The dataset registry records where the EEG data of the programme is held, and no recording ever passes through the portal (`docs/DATA_MODEL.md`, section 10, and `docs/INTEGRATIONS.md`, section 7). A copy on an institutional server, such as one in Bremen or Munich, is a complete storage reference, and a central copy is optional. Every write is a callable function that checks `datasets.manage` for the dataset's replication or laboratory and writes its audit entry; no client writes any document of the registry. Every member reads the registry document of a dataset, which names no path and no participant. Copies, transfers and quality assessments are read within the dataset's scope. Listings, the BIDS report and the record of reads are read only by holders of `datasets.paths.read` (the leads of the replication, the coordinators of the laboratory, programme administrators and the core team), and a path or a connection is served only by a function that records each read in the dataset's access events.

| Action | Where it is decided |
|---|---|
| Register, change or archive a dataset | `registerDataset`, `updateDataset`: the first state of the replication's workflow and its history entry, free metadata in the restricted detail |
| Move a dataset through its workflow | `setDatasetStatus`, against the workflow of the replication (`saveDatasetWorkflow`, for `replications.manage`) or the default of `shared/src/datasets/workflow.ts` |
| Add, change, retire or relocate a copy | `addStorageRef`, `changeStorageRef`; a relocation closes the copy and opens a new one that names it |
| List a copy | `scanStorageRef` through the storage adapters, or `recordManifest` for a listing made inside the institution; the expected files are a manifest too, and each listing is compared with them (`shared/src/datasets/manifest.ts`) |
| Read where a copy is | `getStorageLocation`, which writes two access events and an audit entry |
| Record and approve a transfer | `requestTransfer`, `advanceTransfer`: approval by someone other than the requester, then start, completion or failure as people carry it out, and verification against the listings. The portal moves nothing |
| Import a bids-validator report, record the conversion | `importBidsReport` (`shared/src/datasets/bids.ts` reads the output of the 1.x and the schema-based validators), `updateDataset` |
| Record quality control | `recordQcAssessment`, with exclusions that name the exclusion reasons of recruitment and deviations of the participation; the latest assessment of the dataset as a whole sets its QC status |
| Link a viewer | `saveViewerLink`, `openViewerLink`, only for a copy that declares support for the viewer; ElectroTag is optional and nothing depends on it |
| Register and check storage servers | `saveStorageEndpoint`, `checkStorageEndpoint`, `getStorageEndpointConnection` for `datasets.manage` of the programme; naming a secret also needs `integrations.credentials`, and a credential is never stored. The scheduled `storageSweep` checks every scanned server each night |

The storage interface is in `functions/src/integrations/storage/types.ts`: check a server, list a path page by page, and read a small text file, which a scan uses only for the checksum files beside the data. The fake in `storage/fake.ts`, with the synthetic servers of `storage/fixtures.ts`, serves the emulator and every test; it reproduces servers that are down, slow, refuse the account everywhere or below a path, paths that do not exist, paged listings, checksums held per object and checksum files. The emulator's functions and the tests share its state through a file in the run's temporary directory, as with the fake of Google. The real adapters for SFTP (the OpenSSH client in batch mode), FTPS, institutional file systems and object storage are in `storage/real/`, have never been executed and are unverified. `storage/adapters.ts` chooses: the fake in the emulator, the real adapters only where the parameter `STORAGE_SCANS_ENABLED` is "true", and otherwise none, in which case a scan says that scans are not switched on and a listing can be uploaded instead.

A scan that cannot reach a server writes no listing: the copy is marked unavailable with the reason and keeps its last listing and the time it was last seen, the server becomes unreachable and its owner and those who manage the integrations are told once, and the next scan or check that reaches it restores both. No file is ever reported missing because of an outage. The first listing that finds files sets the time the data arrived and opens the quality-control task of the dataset, under an identifier derived from its key, in the list "Dataset quality control" of the replication.

| Page | Shows |
|---|---|
| `#/datasets` | The pipeline of the programme's datasets by state and QC status, and every dataset, searchable and filtered, with a preview beside the list and the registration of a dataset |
| `#/datasets/:datasetKey` | The overview with the workflow and the metadata, the copies with their availability and last sighting, the files against the expected files, transfers, quality control, BIDS, the history, the record of reads and linked Drive documents |
| `#/datasets/servers` | The storage servers with their state and the time each was last seen, and their registration and check for the programme |
| The tab Datasets of a replication and of a laboratory | Its datasets and pipeline, their registration and, for a replication, its workflow |

Views and dashboards read the registry through the source `core:datasets` of the view engine, and the default dashboards of the programme, a replication and a laboratory chart their datasets by state and by QC status. Links from tasks and from Google Drive to a dataset name a dataset of the registry and open its page. `seed:demo` adds the four synthetic servers of the fake and one dataset of DemoAlpha2001 held on the Bremen server alone.

The tests are `shared/src/datasets/*.test.ts` for the comparison of manifests, the workflow and the BIDS report, `functions/src/integrations/storage/scan.test.ts` for the scan against the fake, `tests/functions/datasets.test.ts` for the callables with the outage, the refused account and the slow server, `tests/rules/datasets-features.test.ts` and the matrix, and `tests/e2e/research-data.spec.ts` for acceptance scenario AS-8, the outage and recovery of a server, and axe on each new page; `tests/e2e/tasks.spec.ts` opens the dataset link of AS-6.

## Sessions, tabs and what stays in the browser

Firestore keeps a copy of the documents an account has read in IndexedDB, shared between the tabs of one browser. One tab at a time talks to the server for all of them. Three rules follow from that, and `web/src/auth/AuthProvider.tsx` and `web/src/data/local-data.ts` implement them.

When the account goes away, the page lets go of everything. That covers a sign-out in the tab itself, a sign-out seen from another tab and another account taking its place. The page stops its listeners, ends its Firestore client, deletes the local copy of the documents and loads itself afresh. A fresh page starts no Firestore client until someone is signed in. A signed-out tab therefore never stays the tab that talks to the server, which is what once made a newly signed-in tab fail.

A listener that the server ends is opened again. The subscription cache waits half a second, then one, two and four seconds, shows the loading state meanwhile and reports the failure only when the last attempt has failed too. The error state then offers "Try again".

An account can be stopped while a page is open, by a suspension or by ending all its sessions (`suspended` and `sessionsValidAfter` in `access/{uid}`). The security rules and `defineCallable` both refuse such an account on its next request. The page notices because it is refused its own access document, asks the server once more to start the session, shows the reason the server gives and deletes the local copy of the data.

The address typed into the sign-in form is remembered in `localStorage` only until the link is opened, for six hours at most, and is removed by "Use a different address" and on sign-out.

## What has not been verified

Some things cannot be proven with the emulators and wait for a staging project. The functions emulator accepts a sign-in token without verifying it, and the functions tests rely on that to state what a token claims, so no test here proves token verification or the second-factor claim of a real sign-in. The principal that the platform names for a write is a placeholder in the emulator: the audit trigger takes the actor from the document, treats the principal `app_user` as a signed-in person because that is what the event format defines, and has to be checked against a real event on staging. A deletion by a client is therefore recorded without its actor in the emulator. The audit trigger matches every document with the pattern `{document=**}`, which the emulator supports and production has yet to confirm. The Google sign-in pop-up needs a script from Google that the tests do not load, so the button is switched off by default and only its presence behind the build flag is tested. App Check has no emulator: `defineCallable` carries the option to enforce it, and the option is always off in the emulator. The production Content-Security-Policy is generated and unit tested, and has not yet been exercised against production hosts. Time-based one-time passwords are not implemented by the Authentication emulator. The enrolment, the list and removal of factors and the second step of a sign-in are therefore tested in jsdom against a fake of the multi-factor API, and the state in which a role requires a factor that is missing is tested in the browser with a seeded access document. Whether a real enrolment and challenge work, whether the token then names the factor, and whether an account created by email link can enrol one wait for the staging project.

Three further behaviours are verified on the emulators only. The Firestore emulator ends an open listener as soon as the rules refuse its account. Whether production does the same, or goes on delivering until the listener reconnects, is not known, and the page handles both: the second case is covered by unit tests alone. Callable functions accept browser calls only from the origins in the parameter `PORTAL_ORIGINS`, which is empty by default so that a deployment that forgets it fails closed. The emulator accepts every origin, so the restriction itself has not been exercised. The lifetime of six hours for a remembered sign-in request is a conservative reading of how long a link lasts. When it is too short, a link that still works asks for the address again, and nothing worse.

The web application's main file is about 1.3 MB, most of which is the Firestore SDK, and the editor is a separate chunk loaded with the first page, so Vite prints warnings about their size.

Two behaviours of the workspace wait for staging too. The browser reads images and files of pages with `getBlob`, which needs a CORS configuration on the production bucket that allows the portal's origin; the Storage emulator needs none. The list queries of the editor's synchronisation are limited to 1,000 documents, as the rules require of every list; compaction keeps far fewer updates than that, and a page whose updates outgrew it would be complete again after the next compaction.

## Known advisories

`npm audit` on 10 November 2026 reports 19 advisories, 14 moderate and 5 high, for the pinned versions. All five high ones have one cause: `@grpc/grpc-js` 1.9.x, which the Node.js build of `@firebase/firestore` in `firebase` 13.2.0 depends on. That code runs here only when a test or a tool uses the web SDK under Node.js against the local emulators. It is in neither artefact that is deployed. The web build takes the browser build of Firestore, which has no such dependency, and the functions bundle leaves `firebase-admin` to the platform and never imports the web SDK, which an architecture test enforces. The versions stay pinned to the set that was verified together. Run the audit again at each upgrade of the Firebase SDKs and update this paragraph.
