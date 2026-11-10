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

`npm run seed:demo`, run in a second terminal while the emulators are up, writes two fictitious accounts with their `users` and `access` documents. Each profile is labelled `dataOrigin: "demo"`, and every document names the command as its author (`system:seedDemo`). The command refuses to run unless the emulator variables are set, so it cannot touch a real project, and it says so in one line when the emulators of the port base are not running.

`npm run seed:lookups`, run the same way, writes the lookup data that the application depends on: the programme, the statuses of replications, datasets and tasks, the eleven categories of participant counts with their definitions, the onboarding checklist and the fourteen CRediT contributor roles. The values are constants in `shared/src/seed/lookups.ts`. A document that already exists is never written again, so a second run performs no write, and a document whose values an administrator has changed is reported and left as it is. The command needs the Firestore emulator only and refuses any target that is not an emulator.

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
| `npm test` | All of the test commands above, with one start of the emulators | Builds first |

Every command that needs emulators starts them through `firebase emulators:exec` and stops them when the tests finish, whether they pass or fail. A test command fails at once, with a message that names the port, if another run is already using the same port base. That check covers the emulator ports and, for the commands that start the preview server, its ports as well.

A run can be interrupted at any point. `scripts/emulators.mjs` starts the Firebase tools in a process group of their own and, on an interrupt or a termination signal, stops that whole group: the emulators, the test runner, the preview server and the browser. It asks politely first, then insists after fifteen seconds, and it only ends once nothing of the run is left. The Firestore emulator runs outside that group, because the Firebase tools start it in a session of its own. The tools stop it themselves, and the launcher follows up on it directly if they have not done so in time. `scripts/process-group.mjs` holds that logic and `scripts/process-group.test.mjs` tests it with a real process tree.

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
| `web/src/pages/` | One directory per page. `pages/dev/` holds the page of interface components, which exists in emulator builds only and is what the browser tests check the primitives on |
| `web/src/styles/tokens.css` | The single source of design tokens |
| `functions/` | `@eegml/functions`. Cloud Functions, second generation, in `europe-west2` |
| `functions/src/framework/` | `defineCallable`, the audit helper, the error type and the Admin SDK set-up |
| `functions/src/callables/` | One file per callable function |
| `tools/` | `@eegml/tools`. Admin SDK command-line tools, run with `tsx` from a trusted environment |
| `tests/rules/` | Security-rules tests: the registry-driven matrix with its policy model, fixtures and synthetic world, the hand-written tests of special rules, the catalogue of scoped queries, and the test of the registry-driven references and queries of the web data layer against the Firestore emulator |
| `tests/functions/` | Integration tests of the functions, run against the emulators |
| `tests/tools/` | Integration tests of the tools |
| `tests/e2e/` | Playwright tests of the built application |
| `tests/architecture/` | Tests that read the source tree: import boundaries, design rules, the contrast of every colour pair in use, the standard fields of every document schema, the agreement of the collection registry with `docs/DATA_MODEL.md`, the agreement of the rules file and the index file with the registry, rules about what may be committed, and a production build whose output is read for anything that belongs to the emulators only |
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
| A capability | The registry and the default matrix in `shared/src/capabilities.ts`. `shared/src/access.ts` resolves them into `access/{uid}` and answers `can` |
| Lookup data that a new database starts with | `shared/src/seed/lookups.ts`, which `npm run seed:lookups` writes |
| A page | The route table in `web/src/app/router.tsx` |
| A sidebar entry | The registry in `web/src/app/navigation.ts` |
| A panel on Home | The registry in `web/src/pages/home/panels.ts` |
| A read of live data | Nothing new: `useLiveDocument` and `useLiveQuery` in `web/src/data/live.ts` serve every entry of the collection registry, with the converter built from its schema. A query is described as data (`web/src/data/query-spec.ts`), which is also its key in the subscription cache |
| An interface primitive | `web/src/components/ui/`, and in the same change the page of interface components in `web/src/pages/dev/`, so the browser tests see it |
| A colour, or a new combination of two colours | `web/src/styles/tokens.css`, and the table of pairs in `tests/architecture/contrast.test.ts` |
| A command-line tool | A file in `tools/src/commands/` and an entry in the registry in `tools/src/cli.ts` |
| A port | The offsets in `scripts/ports.mjs` |

## Sessions, tabs and what stays in the browser

Firestore keeps a copy of the documents an account has read in IndexedDB, shared between the tabs of one browser. One tab at a time talks to the server for all of them. Three rules follow from that, and `web/src/auth/AuthProvider.tsx` and `web/src/data/local-data.ts` implement them.

When the account goes away, the page lets go of everything. That covers a sign-out in the tab itself, a sign-out seen from another tab and another account taking its place. The page stops its listeners, ends its Firestore client, deletes the local copy of the documents and loads itself afresh. A fresh page starts no Firestore client until someone is signed in. A signed-out tab therefore never stays the tab that talks to the server, which is what once made a newly signed-in tab fail.

A listener that the server ends is opened again. The subscription cache waits half a second, then one, two and four seconds, shows the loading state meanwhile and reports the failure only when the last attempt has failed too. The error state then offers "Try again".

An account can be stopped while a page is open, by a suspension or by ending all its sessions (`suspended` and `sessionsValidAfter` in `access/{uid}`). The security rules and `defineCallable` both refuse such an account on its next request. The page notices because it is refused its own access document, asks the server once more to start the session, shows the reason the server gives and deletes the local copy of the data.

The address typed into the sign-in form is remembered in `localStorage` only until the link is opened, for six hours at most, and is removed by "Use a different address" and on sign-out.

## What has not been verified

Some things cannot be proven with the emulators and wait for a staging project. The Google sign-in pop-up needs a script from Google that the tests do not load, so the button is switched off by default and only its presence behind the build flag is tested. App Check has no emulator: `defineCallable` carries the option to enforce it, and the option is always off in the emulator. The production Content-Security-Policy is generated and unit tested, and has not yet been exercised against production hosts. Time-based one-time passwords are not implemented by the Authentication emulator.

Three further behaviours are verified on the emulators only. The Firestore emulator ends an open listener as soon as the rules refuse its account. Whether production does the same, or goes on delivering until the listener reconnects, is not known, and the page handles both: the second case is covered by unit tests alone. Callable functions accept browser calls only from the origins in the parameter `PORTAL_ORIGINS`, which is empty by default so that a deployment that forgets it fails closed. The emulator accepts every origin, so the restriction itself has not been exercised. The lifetime of six hours for a remembered sign-in request is a conservative reading of how long a link lasts. When it is too short, a link that still works asks for the address again, and nothing worse.

The web application is currently one JavaScript file of about 1.3 MB, most of which is the Firestore SDK, so Vite prints a warning about its size. Splitting it by route becomes worthwhile when more pages exist.

## Known advisories

`npm audit` on 10 November 2026 reports 19 advisories, 14 moderate and 5 high, for the pinned versions. All five high ones have one cause: `@grpc/grpc-js` 1.9.x, which the Node.js build of `@firebase/firestore` in `firebase` 13.2.0 depends on. That code runs here only when a test or a tool uses the web SDK under Node.js against the local emulators. It is in neither artefact that is deployed. The web build takes the browser build of Firestore, which has no such dependency, and the functions bundle leaves `firebase-admin` to the platform and never imports the web SDK, which an architecture test enforces. The versions stay pinned to the set that was verified together. Run the audit again at each upgrade of the Firebase SDKs and update this paragraph.
