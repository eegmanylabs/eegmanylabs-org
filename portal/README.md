# EEGManyLabs members' portal

The members' portal is a single-page application that is published as static files on GitHub Pages and uses Firebase as its backend: Authentication for sign-in, Firestore for data, Cloud Functions in London for trusted operations and Cloud Storage for files. The decisions behind this arrangement are recorded in `docs/DECISIONS.md`, and the conventions for working in this directory are in `CONTRIBUTING.md`.

Everything here is developed and tested against the Firebase Local Emulator Suite with the project identifier `demo-eegml`. No Firebase project, account or credential is needed, and nothing in this directory contacts a production service.

## Prerequisites

You need Node.js 22.22 or newer and a Java 21 runtime, which the Firebase emulators require. The Firebase web SDK asks for Node.js 24 in its package metadata, so `npm ci` prints engine warnings on Node.js 22. They are harmless, because the SDK runs in the browser and, under Node.js, only in tests. The end-to-end tests need the Chromium build that matches the pinned Playwright version. On a machine that does not have it, install it once with `npx playwright install chromium`.

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

`npm run seed:demo`, run in a second terminal while the emulators are up, writes two fictitious accounts with their `users` and `access` documents. Everything it writes is labelled `dataOrigin: "demo"`, and it refuses to run unless the emulator variables are set, so it cannot touch a real project.

The development server sends no Content-Security-Policy, because its hot reloading relies on inline scripts. To see the application exactly as it will be published, use the preview:

```bash
npm run emulators   # in one terminal
npm run preview     # in another
```

The preview builds the application and serves it with `scripts/pages-server.mjs`, which behaves like GitHub Pages: no rewrites, the `404.html` body with status 404 for unknown paths, and no custom response headers. It serves the build under the path prefix `/portal/`, the way a project site is served under the name of its repository, so an address that only works at the root of a domain fails here first. With the default port base the preview is at `http://127.0.0.1:9250/portal/`.

## Test

| Command | What it runs | Needs |
|---|---|---|
| `npm run typecheck` | The TypeScript compiler over every package, the tests and the scripts | Nothing |
| `npm run lint` | Biome: lint rules, import order and formatting. `npm run format` applies the fixes | Nothing |
| `npm run test:unit` | Unit tests of the shared package, the functions framework, the tools and the scripts; architecture tests; component tests of the web application in jsdom | Nothing |
| `npm run test:rules` | Security-rules tests for Firestore and Cloud Storage | Starts the Firestore and Storage emulators |
| `npm run test:functions` | Integration tests of the functions | Bundles the functions, starts the Authentication, Firestore and Functions emulators |
| `npm run test:tools` | Integration tests of the command-line tools | Starts the Authentication and Firestore emulators |
| `npm run test:e2e` | Playwright tests against the built application, including the accessibility and security checks | Builds, starts all emulators and the preview server |
| `npm test` | All of the test commands above, with one start of the emulators | Builds first |

Every command that needs emulators starts them through `firebase emulators:exec` and stops them when the tests finish, whether they pass or fail. A test command fails at once, with a message that names the port, if another run is already using the same port base.

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

Every web build has the same shape. Asset addresses are relative and routes are in the fragment (`#/login`), so one artefact works at any address without server rewrites. The first element of `<head>` is a Content-Security-Policy meta element generated for the mode by `web/config/csp.ts`. Every mode except production adds a `robots` meta element that asks search engines to stay away. `frame-guard.js` stops the application from starting inside a frame on another site, since GitHub Pages cannot send a `frame-ancestors` policy. `404.html` is a copy of `index.html` as a safety net. Fonts are served from the build itself.

## Ports

Everything that listens on a port derives it from the environment variable `PORTAL_PORT_BASE`, which defaults to 9100. The offsets are defined once, in `scripts/ports.mjs`.

| Service | Offset | Default port |
|---|---|---|
| Functions emulator | base + 1 | 9101 |
| Eventarc emulator (started with Functions) | base + 29 | 9129 |
| Emulator hub | base + 40 | 9140 |
| Cloud Tasks emulator (started with Functions) | base + 49 | 9149 |
| Emulator logging | base + 50 | 9150 |
| Firestore emulator | base + 80 | 9180 |
| Firestore emulator, web socket for tooling | base + 81 | 9181 |
| Storage emulator | base + 97 | 9197 |
| Authentication emulator | base + 99 | 9199 |
| Preview server | base + 150 | 9250 |
| Vite development server | base + 151 | 9251 |
| Second origin used by one end-to-end test | base + 152 | 9252 |

The emulator interface stays switched off. All servers bind to `127.0.0.1` only.

Two runs with different bases do not interfere with each other, so two people, two agents or two test suites can work in the same checkout at once, for example `npm test` in one terminal and `PORTAL_PORT_BASE=9300 npm test` in another. Each run has its own generated Firebase configuration (`firebase.run-<base>.json`), its own directory for emulator logs and Playwright output (`.run/<base>/`), its own temporary directory for the emulators' socket and locator files (`eegml-portal-<base>` under the system temporary directory) and, for emulator builds, its own web output directory. The functions bundle is shared between runs. It is rewritten only when its content changes, and then atomically, so a rebuild in one run does not disturb the emulator of another. Choose bases at least 200 apart.

The Firestore emulator opens two extra ports on the loopback interface and the Functions emulator briefly opens one while it loads the functions. The Firebase tools choose those themselves and they cannot be configured.

`node scripts/emulators.mjs status` shows which ports of the current base are in use.

## The firebase wrapper

`scripts/fb.sh` is the portal's `firebase` command, and every npm script goes through it. It runs the version of `firebase-tools` pinned in `package.json`, never a global install, and it skips the probe for Google Cloud credentials, which the emulators do not need. `npm run fb -- <arguments>` runs it directly.

The wrapper also works around one defect. When an outbound proxy is configured through `HTTPS_PROXY`, `firebase-tools` sends its own calls to the local emulators through that proxy and ignores `NO_PROXY`, so the calls fail and the emulators crash while starting. In that case the wrapper preloads `scripts/cli-loopback-direct.cjs`, which sends requests for loopback addresses direct and leaves the proxy in place for every other host. It never unsets the proxy and never touches certificate verification. On a machine without a proxy variable the file is not loaded and the wrapper changes nothing.

## Directory map

| Path | Contents |
|---|---|
| `shared/` | `@eegml/shared`. Pure TypeScript with no Firebase imports: zod schemas of stored documents, collection paths, contracts of callable functions, identifier derivation, the capability matrix and constants such as the functions region |
| `web/` | `@eegml/web`. The single-page application: Vite, React, Tailwind CSS and Radix primitives |
| `web/config/` | Build-time code: the build modes, the Content-Security-Policy and the Vite plugin for `index.html` |
| `web/src/app/` | The shell, the route table, the navigation registry and the build configuration as the application sees it |
| `web/src/auth/` | The authentication provider, the guard for signed-in pages and the handling of sign-in links |
| `web/src/components/ui/` | Interface primitives built on Radix with the design tokens |
| `web/src/components/feedback/` | The standard loading and error states, and `LiveView`, which applies them to live data |
| `web/src/data/` | The data layer, and the only directory that may import the Firebase SDK |
| `web/src/pages/` | One directory per page |
| `web/src/styles/tokens.css` | The single source of design tokens |
| `functions/` | `@eegml/functions`. Cloud Functions, second generation, in `europe-west2` |
| `functions/src/framework/` | `defineCallable`, the audit helper, the error type and the Admin SDK set-up |
| `functions/src/callables/` | One file per callable function |
| `tools/` | `@eegml/tools`. Admin SDK command-line tools, run with `tsx` from a trusted environment |
| `tests/rules/` | Security-rules tests |
| `tests/functions/` | Integration tests of the functions, run against the emulators |
| `tests/tools/` | Integration tests of the tools |
| `tests/e2e/` | Playwright tests of the built application |
| `tests/architecture/` | Tests that read the source tree: import boundaries, design rules and rules about what may be committed |
| `tests/support/` | Helpers shared by the suites that use the emulators |
| `scripts/` | Port derivation, the emulator launcher, the `firebase` wrapper, the development launcher and the preview server |
| `firestore.rules`, `storage.rules`, `firestore.indexes.json` | Security rules and indexes |
| `firebase.template.json` | The Firebase configuration without emulator addresses. `scripts/firebase-config.mjs` generates the configuration of each run from it |
| `.firebaserc` | The project alias. It names the demonstration project only |

Generated files are kept out of git: `node_modules/`, `web/out/`, `functions/out/`, `.run/` and `firebase.run-*.json`. The directory `portal/.private/` is ignored as well and is the place for local source exports and private configuration.

The repository's `.gitignore` began as a Python template and ignores directories named `lib`, `build`, `dist`, `env`, `venv`, `var`, `parts`, `eggs`, `downloads`, `wheels`, `target` and `instance` anywhere in the tree. Do not give a source directory one of those names. An architecture test fails if git would ignore any source file.

## Where things are added

Each kind of change has one place where it starts. The registries below are that place.

| To add | Start in |
|---|---|
| A stored document or a field | The schema in `shared/src/schemas/`, the path in `shared/src/paths.ts`, then the rules and their tests |
| A callable function | A contract in `shared/src/callables.ts`, a file in `functions/src/callables/` that uses `defineCallable`, an export in `functions/src/index.ts`, and an integration test |
| A kind of audit event | The registry in `shared/src/schemas/audit.ts` |
| A capability | The matrix in `shared/src/capabilities.ts` |
| A page | The route table in `web/src/app/router.tsx` |
| A sidebar entry | The registry in `web/src/app/navigation.ts` |
| A panel on Home | The registry in `web/src/pages/home/panels.ts` |
| A read of live data | A typed reference in `web/src/data/refs.ts`, used through `useLiveDoc` or `useLiveQuery` |
| A command-line tool | A file in `tools/src/commands/` and an entry in the registry in `tools/src/cli.ts` |
| A port | The offsets in `scripts/ports.mjs` |

## What has not been verified

Some things cannot be proven with the emulators and wait for a staging project. The Google sign-in pop-up needs a script from Google that the tests do not load, so the button is switched off by default and only its presence behind the build flag is tested. App Check has no emulator: `defineCallable` carries the option to enforce it, and the option is always off in the emulator. The production Content-Security-Policy is generated and unit tested, and has not yet been exercised against production hosts. Time-based one-time passwords are not implemented by the Authentication emulator.

The web application is currently one JavaScript file of about 1.2 MB, most of which is the Firestore SDK, so Vite prints a warning about its size. Splitting it by route becomes worthwhile when more pages exist. The local Firestore cache is not cleared on sign-out, which should be revisited before the cache holds data about other members.
