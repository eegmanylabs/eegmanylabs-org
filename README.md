# EEGManyLabs website

> **Purpose.** This guide explains how to maintain, review, and publish the EEGManyLabs website without needing prior familiarity with the project. It is intended for researchers, project coordinators, designers, and developers who need to make safe, auditable updates.

The website is a static, data-driven site for the international EEGManyLabs replication initiative. It presents the project’s purpose, coordinated replications, Core Team, Members network, publications, related projects, partners, contact routes, and supporting resources. The source code is built with Syrinx and Jinja templates, then deployed as static files behind Nginx. The production deployment process is defined in the repository’s GitHub Actions workflow.[1]

## 1. Working safely

The website has separate review and public environments. Use the review environment for all visual and content checks before publishing to the public website. The `main` branch is the public release branch. The `review/repository-inspection` branch is the current shared review branch used for the active redesign work. Treat this shared branch as review infrastructure rather than a personal working branch unless a project lead has explicitly asked you to update it.

| Environment | URL | Typical purpose | How it updates |
|---|---|---|---|
| Local preview | `http://localhost:8000` | Development and first-pass review | You build and serve the files on your computer. |
| Staging | [eegmanylabs.dev](https://eegmanylabs.dev) | Shared review before release | An open or updated pull request triggers the staging deployment. |
| Production | [eegmanylabs.org](https://eegmanylabs.org) | Public website | A push to `main` triggers the production deployment. |

Always make a focused branch for a new piece of work, build the site locally, review the staging deployment, and merge only after the change has been approved. Avoid editing the generated `dist/` directory. Syrinx recreates that folder on every build.

> **Release principle.** A content update should be traceable from the source file, through a pull request and staging review, to the final production commit.

### The safest update route

Follow this sequence for every ordinary content or design change. If one step gives an error, stop at that step, keep the error message, and ask the project maintainer for help rather than trying unrelated commands.

| Step | Action | Stop when |
|---|---|---|
| 1 | Update your local copy of `main`, then create a clearly named working branch. | `git status --short` shows no unexpected changes. |
| 2 | Change only the relevant source files. | The content, data, asset, or template has been saved. |
| 3 | Build the site locally and inspect it in a browser. | The intended page looks correct at `http://localhost:8000`. |
| 4 | Check the changed-file list and stage only the intended source files. | `git diff --cached --stat` shows exactly the files you expect. |
| 5 | Commit, push, and open a pull request to `main`. | GitHub Actions starts the Deploy workflow for the pull request. |
| 6 | Wait for the staging deployment to finish, then check `eegmanylabs.dev`. | The staging site shows the intended change. |
| 7 | Merge the approved pull request into `main`. | A second successful Deploy workflow completes for `main`. |
| 8 | Verify the public site at `eegmanylabs.org`. | The production change is visible and working. |

### Plain-language glossary

| Term | Meaning in this project |
|---|---|
| Repository | The shared folder of website source files stored on GitHub. |
| Branch | A safe parallel copy of the source files for one change. It protects the public website while work is in progress. |
| Commit | A saved, named checkpoint of a set of file changes. |
| Pull request, or PR | A request to review a branch and merge it into `main`. It is also what triggers the shared staging deployment. |
| Staging | The review website at `eegmanylabs.dev`. It is safe to inspect before public release. |
| Production | The public website at `eegmanylabs.org`. It is updated only after a change reaches `main`. |
| Build | The process that converts source files into static website files in `dist/`. |
| Deployment | The process that puts a successful built website online. |

## 2. Technology and repository architecture

The site is built from Markdown content, TSV datasets, Jinja templates, CSS, JavaScript, images, and PDFs. Syrinx version `0.0.15` is the only Python dependency specified by the project.[2] The build creates static HTML in `dist/`. A minimal Docker image then copies this generated output into Nginx for delivery.[3]

| Layer | Location | Responsibility |
|---|---|---|
| Site configuration | `syrinx.cfg` | Domain and Syrinx build configuration. |
| Content branches | `content/` | Markdown pages, page introductions, detail pages, footer source content, and public utility pages. |
| Structured data | `data/` | TSV source datasets for Core Team, Members, Replications, and Publications. |
| Record generators | `archetypes/` | Defines how each TSV row is converted into a content record during a build. |
| Page structure | `theme/templates/` | Jinja templates for page layouts, navigation, cards, maps, footer, and contact interface. |
| Styling | `theme/assets/css/index.css` | Global visual system, responsive layout, controls, cards, map, footer, and accessibility states. |
| Interaction code | `theme/assets/js/site.js` | Hero-video playback, client-side filters, Contact mail composer, and mobile navigation. |
| Network map code | `theme/assets/js/network-map.js` | Deduplicated network data, Leaflet map, map search, country filtering, and member-detail panel. |
| Visual assets | `assets/images/` | Logo, portraits, Cappy illustrations, publication previews, partners, figures, and project imagery. |
| Documents | `assets/pdfs/` | Publication PDFs and supporting files shown through the site. |
| Deployment | `.github/workflows/deploy.yml`, `.do/app.yml`, `Dockerfile` | Build, containerisation, and DigitalOcean deployment. |

The root page is composed in `theme/templates/root.jinja2`. Most section pages are routed through `theme/templates/page.jinja2`. A small set of pages use dedicated layouts, including About, Contact, Members and Network Map, Partners, Privacy, Sitemap, and related-project detail pages.[4]

## 3. Visual system and non-negotiable design rules

The current identity combines a warm-graphite interface with coral red and warm-white surfaces. The original red EEGManyLabs logo is retained in the header without recolouring. The homepage hero uses a transparent white version of the logo and white copy over the electrode-preparation video.

| Element | Required treatment |
|---|---|
| Dark interface colour | `--ink-950: #302a2a` |
| Main coral-red action colour | `--aqua: #d84b4d` |
| Deeper coral-red accent | `--aqua-deep: #a9353a` |
| Main page surface | `--paper: #fcf9f7` |
| High-contrast white | `--paper-strong: #ffffff` |
| Typography | Use the project tokens `--sans` and `--serif`. Avoid introducing ad hoc web fonts. |
| Buttons on coral red | Use white labels and icons. Dark brown or black text is not permitted on coral-red backgrounds. |
| Shadows | Do not add shadows. The visual system relies on borders, spacing, restrained hover movement, and colour. |
| Sentence case | Navigation labels, headings, filter labels, role tags, and button copy should use sentence case. |
| Green | Do not introduce green into the public-facing interface. |

The Cappy mascot is defined in `cappy-mascot-spec.md`. When commissioning or generating an illustration, use that document and `assets/images/cappy-canonical-red.png` as the reference. Cappy has a neutral round white face, two black oval eyes, a simple curved smile, no hair, skin-tone treatment, glasses, or gender-specific features. Cap and clothing colours may vary only within the established visual system. The 100 Years card is an approved historical exception that preserves the requested cake character in the coral-and-graphite palette.

## 4. Local setup and preview

### 4.1 Before you begin

You need a GitHub account with access to `eegmanylabs/eegmanylabs-org`, a code editor, Git, Python 3.11 or later, and permission to create branches and pull requests. Ordinary maintenance does **not** require a DigitalOcean login, a GitHub token, Docker, or access to deployment secrets. If you cannot create a branch or pull request, pause and ask a repository administrator to grant access.

Open a terminal and confirm the core tools are available:

```bash
git --version
python3 --version
```

### 4.2 First-time setup

Clone the repository and create an isolated Python environment. The commands below use macOS or Linux syntax. On Windows, activate the virtual environment with `.venv\Scripts\activate`.

```bash
git clone https://github.com/eegmanylabs/eegmanylabs-org.git
cd eegmanylabs-org
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

To work on the current review branch, fetch the latest remote state and check it out.

```bash
git fetch origin
git switch review/repository-inspection
git pull --ff-only origin review/repository-inspection
```

For a production-facing update, begin from the latest `main` branch and create a dedicated feature branch.

```bash
git switch main
git pull --ff-only origin main
git switch -c content/short-description-of-change
```

### 4.3 Build and inspect

Use the same build command as the deployment workflow when possible.[1] If `syrinx` is reported as unavailable, activate the virtual environment again and run `python -m pip install -r requirements.txt`.

```bash
syrinx -c -e staging .
python -m http.server 8000 --directory dist
```

Open `http://localhost:8000` in a browser. Stop the preview server with `Ctrl+C`. For a production-equivalent build, use:

```bash
syrinx -c -e production .
```

Before committing, run the following checks:

```bash
git diff --check
git status --short
```

The first command detects whitespace problems. The second lists every changed or untracked file. Only stage source files that belong to the planned update. Do not stage `dist/`, temporary exports, browser screenshots, audit scratch files, or locally generated diagnostics.

### 4.4 Generated files and safe cleanup

A Syrinx build can create untracked record files under `content/people/`, `content/publications/`, and `content/replications/`. These are build intermediates. They are not the source of truth and should not be committed. First inspect what would be removed:

```bash
git clean -nd content/people content/publications content/replications
```

If the preview lists only generated files, remove them with:

```bash
git clean -fd content/people content/publications content/replications
```

The `-n` command is a dry run. Use it before the deletion command every time. `git clean` removes only untracked files. If `git pull --ff-only` stops because another person has changed the branch, do not force it. Save your work with a normal commit or ask the project maintainer for help, then repeat the update step. If `git status --short` shows a tracked file marked `D`, restore it before continuing:

```bash
git restore path/to/file
```

To remove a file from the staging area while keeping your local edit, use:

```bash
git restore --staged path/to/file
```

## 5. Content maintenance workflows

### 5.1 General pages

General page content lives under `content/`. Each `index.md` usually contains TOML front matter followed by Markdown. The front matter controls ordering, card image, and short summaries. The Markdown controls the visible page copy.

| Page or content area | Primary source |
|---|---|
| Homepage | `content/index.md` and `theme/templates/root.jinja2` |
| About | `content/about/index.md` and `content/about/more.md` |
| Core Team introduction | `content/people/index.md` |
| Members introduction | `content/members/index.md` |
| Related Projects introduction | `content/related_projects/index.md` |
| Contact interface copy | `theme/templates/contact_page.jinja2` |
| Partners | `theme/templates/partners_page.jinja2` |
| Privacy notice | `theme/templates/privacy_page.jinja2` |
| Visual Sitemap | `theme/templates/site_map_page.jinja2` |
| Footer resources | `content/resources.md`, `content/contact_links.md`, and `content/funders.md` |

Keep prose concise, evidence-based, and written in UK English. Preserve existing factual claims unless their source has been checked. Do not introduce promotional statistics, invented claims, or generic statements solely to fill visual space.

### 5.2 Core Team

The Core Team data source is `data/people.tsv`. The associated generator is `archetypes/people.md`, and the card template is `theme/templates/people_card.jinja2`. The generated records appear under `content/people/` during a build.

Each person should have a stable identifier, full name, affiliation, country, role tags, and relevant outward-facing URLs. Portrait files belong in `assets/images/headshots/` and must match the image filename stored in the dataset. Images should be appropriate professional portraits and require meaningful alternative text, which the template derives from the person’s name.

Use the established role vocabulary so filter controls remain meaningful and card layouts remain consistent:

| Stored tag | Public label |
|---|---|
| `directors` | Director |
| `coordinator` | Coordinator |
| `founder` | Founder |
| `advisor` | Advisor |
| `study_lead` | Study lead |
| `co-investigator` | Co-investigator |
| `spin-off` | Spin-off |
| `contributor` | Contributor |

The recognised roles are displayed in the order shown above. Do not create near-duplicate spellings such as `study lead`, `StudyLead`, or `co investigator` in the dataset. The role area reserves space for the fullest current tag combination, so standardising tags protects the visual rhythm of the directory.

### 5.3 Members and the network map

The Members source is `data/members.tsv`, with records generated through `archetypes/members.md`. The public Members page embeds the same interactive map as the dedicated `/network-map/` route. Members are described as co-authors of the registered report.

Do not publish email addresses in `data/members.tsv`, generated content, map data, or screenshots. The current public network is deduplicated against the Core Team. A person already represented in `data/people.tsv` must be excluded from the Members TSV. The map performs an additional client-side identity deduplication and gives the Core Team record precedence, but this is a safeguard rather than a replacement for keeping the datasets clean.

After a Membership update, validate all three figures together:

| Check | Current expected value |
|---|---|
| Core Team records | 45 |
| Members records | 300 |
| Combined deduplicated map total | 345 researchers across 30 countries |

The Network Map search is designed to search names, affiliations, categories, and countries. When a named person or institution produces a single country match, the detail panel should foreground matching researchers instead of presenting the entire country roster. Test one named Core Team member and one ordinary Member after every map-data refresh.

### 5.4 Replications

Replication records are maintained in `data/replications.tsv` and generated by `archetypes/replications.md`. The visual summary image for a study belongs in `assets/images/figures/` and must match the study identifier exactly. The relevant card template is `theme/templates/replication_card.jinja2`.

Use the standard stage labels and themes so the visible chip filters work. Update the replication data, figure, and any linked external resources as one reviewed change. The live Replications page has separate Stage and Theme filters, which combine together. Test the All stages, Completed, and at least one theme state before publication.

### 5.5 Publications

Publication records are maintained in `data/publications.tsv`, generated with `archetypes/publications.md`, and rendered using `theme/templates/publication_card.jinja2`. Publication preview images are stored in `assets/images/previews/`. PDFs are stored in `assets/pdfs/`.

The `DOI` field must contain a **bare DOI**, for example `10.31234/osf.io/27atx_v3`. Do not paste a complete `https://doi.org/` URL into that field because the archetype constructs the DOI destination automatically. Place complete external destinations, such as journal pages, PsyArXiv, Europe PMC, or OSF links, in the appropriate URL fields. After any update, test the card’s DOI, PDF, OSF, data, and study links where present.

### 5.6 Related Projects and Partners

Related Project entries are Markdown pages beneath `content/related_projects/`. Their card imagery is declared in page front matter and lives under `assets/images/stock/` or `assets/images/related_projects/`. Detail-page presentation is handled by `theme/templates/related_project_page.jinja2`.

Partner names, descriptions, logos, and URLs currently live in `theme/templates/partners_page.jinja2`. Partner logos are kept in `assets/images/partners/`. All partner links open in a new tab and carry a screen-reader label that makes this explicit. Keep descriptions factual and short enough to maintain aligned cards.

## 6. Interaction and accessibility checklist

The site is intentionally light on client-side code. Before merging, confirm that every interaction remains usable with mouse, keyboard, touch, and assistive technology.

| Feature | What to verify |
|---|---|
| Skip link | Tab from the page top. The Skip to content control should appear with white text on a coral-red background and move focus to the main content. |
| Desktop navigation | The active page has an underline and `aria-current="page"`. |
| Mobile navigation | Open the menu, use Tab and Shift+Tab, then Escape. Focus should stay within the dialog and return to the original trigger on close. |
| Hero video | It should autoplay muted, loop, have no visible controls, and retain readable white text. Reduced-motion users receive a static dark hero treatment. |
| Filter chips | Selected chips must show the dark active state, update the visible cards, and announce the changed number of items to screen readers. |
| Core Team cards | Profiles with different tag counts must retain a shared role area and contact-control baseline. |
| Contact form | Compose email opens the visitor’s own email application. It does not submit data through the website. The button uses white text on coral red. |
| Network Map | Search by a person, institution, and country. Confirm marker count, country dropdown, reset, direct-match detail panel, and public total. |
| External links | Check the destination and confirm that an outbound link does not accidentally point to a staging route or malformed DOI. |

Use browser developer tools or an accessibility audit extension to check keyboard focus, colour contrast, heading order, alternative text, form labels, and console errors. A manual test on a narrow mobile viewport is required for navigation, filter chips, map controls, card wrapping, and footer spacing.

## 7. Deployment and release process

The GitHub Actions workflow installs dependencies with Python 3.11, builds the site with Syrinx, creates a container image, and deploys it to DigitalOcean App Platform.[1] The Docker runtime serves only the pre-built static output through Nginx.[3]

### 7.1 Exact release steps

The following is the ordinary safe route. Replace `type/short-description` with a simple name such as `content/add-new-partner` or `fix/map-count`.

```bash
# Start from a clean, current copy of the public branch.
git switch main
git pull --ff-only origin main
git status --short

# Create an isolated working branch.
git switch -c type/short-description

# Make your edits, then build and inspect them locally.
syrinx -c -e staging .
python -m http.server 8000 --directory dist
```

After reviewing the local site, stop the preview server with `Ctrl+C`. Then check and stage only the intended files:

```bash
git diff --check
git status --short
git add path/to/changed-file path/to/another-changed-file
git diff --cached --stat
git commit -m "Describe the visible change clearly"
git push -u origin type/short-description
```

Go to the repository on GitHub and open the **Pull requests** tab. Select **New pull request**, choose `main` as the **base** branch, and choose your `type/short-description` branch as the **compare** branch. Confirm that GitHub shows the intended files. Give the pull request a clear title and write a short description stating the purpose, source files changed, data implications, and pages tested. Select **Create pull request**. Opening the pull request, or pushing further commits to it, triggers the staging deployment automatically.[1]

If GitHub reports a merge conflict, do not merge. Tell the project maintainer which files are conflicted. Resolve conflicts only when you understand both versions of the content and have rebuilt the result locally.

### 7.2 Staging verification

Open the Actions tab in GitHub and select the latest **Deploy** workflow for your pull request. Wait until every step is green, especially **Build site**, **Build and push Docker image**, and **Deploy the app**. A red workflow means staging is not ready for review. Open the first failed step, copy its exact error message, and resolve that specific issue before pushing another change.

When the workflow succeeds, inspect [eegmanylabs.dev](https://eegmanylabs.dev). Verify every page affected by your change, including mobile layout and any links or interactive controls. Browsers can retain an earlier static asset after a deployment. If staging appears unchanged, first hard-refresh the page. If the earlier version remains visible, add a harmless cache-busting query to the URL, for example `https://eegmanylabs.dev/?release=your-commit-short-id`.

> **Important.** A branch without an open pull request does not create the shared staging deployment. Opening or updating the pull request is the required staging step.

### 7.3 Production release

Merge a pull request only after the staging checks are complete and the change has been approved. Merging into `main` creates a push to the public release branch and automatically deploys [eegmanylabs.org](https://eegmanylabs.org).[1]

After the production workflow is green, open the public website in a private browser window or after a hard refresh. Check the changed route and one unrelated route, such as the homepage, to confirm that global navigation, styling, and assets have not been affected.

### 7.4 Rollback

For a safe rollback of a normal production commit, create a revert commit rather than force-pushing or deleting history:

```bash
git switch main
git pull --ff-only origin main
git revert --no-edit COMMIT_TO_REVERT
git push origin main
```

GitHub will automatically deploy the revert. If Git reports that the target is a merge commit, stop and ask a project maintainer for help before proceeding, because the revert requires selecting the correct parent. Avoid force pushes to shared branches.

### 7.5 Information that must remain private

Use concise, truthful commit messages. Do not mention external design references in code comments or commit messages. Never add deployment secrets, tokens, passwords, personal email addresses, or private spreadsheets to the repository. GitHub and DigitalOcean secrets are configured outside the source tree and should never be copied into local documentation.

## 8. Troubleshooting

| Symptom | Likely cause | Recommended response |
|---|---|---|
| The site does not build | Invalid TSV, TOML, Markdown, or Jinja syntax | Read the build error, correct the source record, then rebuild from a clean `dist/`. |
| A new person or study does not appear | Data source, archetype, or identifier mismatch | Check the TSV row, the relevant archetype, and the generated content path. |
| A portrait, figure, logo, or preview is missing | Filename does not match the source field or asset is in the wrong directory | Check exact case, extension, and asset directory. Build again. |
| A filter shows no results | A tag differs from the controlled vocabulary | Correct the TSV tag to the standard stored value. |
| A DOI destination is incorrect | The DOI column contains a full URL rather than a bare DOI | Store only the DOI string in `data/publications.tsv`. |
| A Member appears twice | The person is also in Core Team or name normalisation differs | Remove the Member record when a Core Team profile exists. Check full names and middle initials. |
| Map totals are unexpected | Dataset totals, countries, or duplicate names changed | Compare Members, Core Team, and deduplicated map totals before release. |
| The hero appears static | Autoplay policy, video encoding, or reduced-motion preference | Verify the muted and playsinline attributes, test on a second device, and respect reduced-motion behaviour. |
| The Contact form does not send | This is expected if no email client is configured | The form opens a `mailto:` link. It does not send messages through the site. |
| Staging does not change | The pull request workflow did not run or deploy is still in progress | Check GitHub Actions, then refresh staging after the deployment has succeeded. |

## 9. Quality standard before every release

A finished update must be accurate, coherent, visually aligned, accessible, responsive, and easy to maintain. Read the changed content as a visitor would. Check all modified routes on desktop and mobile. Confirm that the warm-graphite and coral-red system remains consistent, that coral controls have white foregrounds, that there are no unintended green elements, and that card grids remain stable with long and short source content.

For a substantive change, include a short pull-request summary covering the purpose, files changed, data implications, visual routes reviewed, and any follow-up content that remains to be supplied. This makes the next maintainer’s work substantially easier.

## References

[1]: .github/workflows/deploy.yml "GitHub Actions deployment workflow"
[2]: requirements.txt "Project dependency manifest"
[3]: Dockerfile "Static Nginx runtime container"
[4]: theme/templates/page.jinja2 "Section page router"
[5]: theme/assets/css/index.css "Global visual system and responsive styles"
[6]: theme/assets/js/site.js "Global interaction controller"
[7]: theme/assets/js/network-map.js "Network Map controller"
[8]: cappy-mascot-spec.md "Cappy mascot specification"
