# Feature: Project scaffold

**From build-plan:** feature 1
**Build attempt:** 1
**Branch:** feature/project-scaffold
**Status:** verified

Primary source: `blueprint/context/features/01-scaffold-spec.md`. Wider context:
`docs/flight-map-plan.md` section 6 step 1.

## Goal

A running Vite + React + TypeScript app with linting, formatting, a test runner,
validated environment configuration, and one `verify` command, so every later
feature has somewhere to land and one gate to pass.

## In scope

- Vite React-TS app overlaid onto this repository
- ESLint + Prettier configured and runnable
- Vitest configured with one passing example test
- `verify` script chaining typecheck, tests, build
- `.env.example` and `src/config.ts` with validation
- Commands section of `AGENTS.md` updated to the real commands

## Out of scope

- Any map, WebSocket, SkySpy, or aircraft code (features 2 and later)
- Tailwind, shadcn/ui, Prisma, Next.js patterns. The untuned standards file
  names these; this project uses none of them. See Open questions.
- CI workflow and GitHub checks (`/ci` owns that)
- Deployment configuration (`/release` owns that)
- Browser test harness (`/browser-tests` owns that)

## Build loop

`workflow.stepReview: "feature"` - implement every step, verify each, then
present one feature-level review packet with the complete diff and done-when
evidence.

`workflow.checkpointCommits: "disabled"` - no per-step commits. `/complete`
creates the single feature commit.

## Build steps

- [x] **Scaffold in an empty sibling folder, then overlay.** Run
  `npm create vite@latest <tmp-name> -- --template react-ts` in an empty
  directory outside this repository, then copy the generated files in. Never run
  a scaffolder inside this folder: it already holds `AGENTS.md`, `CLAUDE.md`,
  `ONBOARDING.md`, `.agents/`, `.claude/`, `blueprint/`, and `docs/`, and the
  scaffolder fails on a non-empty directory. Merge `.gitignore` rather than
  overwriting it, keeping any existing entries.
  **Done when:** `npm run dev` serves the default Vite page, and `git status`
  (or a directory listing) shows no Blueprint file moved, overwritten, or
  deleted.

- [x] **Strip the Vite demo content.** Remove the counter, logos, demo CSS, and
  unused assets. Leave a minimal shell rendering an empty dark viewport with no
  page scrollbars.
  **Done when:** the page is an empty dark viewport, no Vite or React branding
  remains, and no unused asset or import is left behind.

- [x] **Add ESLint and Prettier.** TypeScript and React Hooks rules, Prettier for
  formatting with no rule conflicts between them. Add `lint` and `format`
  scripts. Enable TypeScript strict mode and disallow `any`.
  **Done when:** `npm run lint` exits zero with no warnings on the stripped
  scaffold, and `npm run format` leaves the tree unchanged on a second run.

- [x] **Add Vitest.** jsdom environment, React Testing Library, `test` and
  `test:watch` scripts, and one trivial passing test proving the harness runs.
  Configure the suite so an empty run fails rather than passing, so "no tests
  ran" can never read as "passed".
  **Done when:** `npm test` reports one passing test, and temporarily pointing
  the include glob at nothing fails instead of passing.

- [x] **Add `src/config.ts` and `.env.example`.** Variables, all `VITE_`
  prefixed: `VITE_SKYSPY_HTTP` and `VITE_SKYSPY_WS` (required, no default),
  `VITE_SKYSPY_TOKEN` (optional, absent means SkySpy public mode),
  `VITE_MAP_STYLE_URL`, `VITE_DEFAULT_CENTER`, `VITE_DEFAULT_ZOOM` (all three
  optional with defaults). `config.ts` parses and validates once at module load
  and is the only module in the project that reads `import.meta.env`. Validation
  rules and error behavior are specified under Data / contracts.
  **Done when:** the app starts with a valid `.env`; removing `VITE_SKYSPY_WS`
  produces a startup error naming that variable; a malformed
  `VITE_DEFAULT_CENTER` produces an error naming that variable; and no error
  message or log contains the token value.

- [x] **Add the `verify` script.** `tsc --noEmit && vitest run && vite build`, in
  that order: typecheck, tests, build.
  **Done when:** `npm run verify` passes end to end from a clean checkout with
  `.env` present, and fails if any one of the three stages fails.

- [x] **Update the Commands section of `AGENTS.md`.** Replace the Next.js
  defaults (`npm run dev` on port 3000, `npm run start`) with this project's real
  dev, build, lint, format, test, and verify commands, including the actual dev
  server port. Declaring `test` here deliberately turns on the project test gate
  described in `coding-standards.md`.
  **Done when:** every command listed in that section runs successfully exactly
  as written, and the stale Next.js entries are gone.

## Files / areas

Created by the scaffold and this feature:

- `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`
- `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`
- `src/config.ts`, `src/config.test.ts`
- `.eslintrc.cjs` or `eslint.config.js`, `.prettierrc`, `.gitignore`
- `.env.example`

Edited:

- `AGENTS.md` - Commands section only. Do not touch other sections.

Untouched: `blueprint/`, `.claude/`, `.agents/`, `docs/`, `CLAUDE.md`,
`ONBOARDING.md`.

## Data / contracts

**`src/config.ts` is the single reader of `import.meta.env`.** No other module
reads environment variables directly. This keeps validation in one place and
makes config mockable in tests.

Exported shape, frozen here because features 2, 5, and 10 consume it:

| Variable | Required | Type / format | Default | Invalid behavior |
| --- | --- | --- | --- | --- |
| `VITE_SKYSPY_HTTP` | yes | absolute `http(s)` URL, trailing slash trimmed | none | throw, naming the variable |
| `VITE_SKYSPY_WS` | yes | absolute `ws(s)` URL, trailing slash trimmed | none | throw, naming the variable |
| `VITE_SKYSPY_TOKEN` | no | non-empty string | `undefined` | empty or whitespace is treated as absent |
| `VITE_MAP_STYLE_URL` | no | absolute `https` URL | keyless dark style constant | throw, naming the variable |
| `VITE_DEFAULT_CENTER` | no | `"lat,lon"`, lat -90..90, lon -180..180 | `"0,0"` | throw, naming the variable |
| `VITE_DEFAULT_ZOOM` | no | finite number 0..22 | `6` | throw, naming the variable |

- The two SkySpy URLs are **required with no default** on purpose. A silent
  default pointing at `localhost:8000` would let a misconfigured app look like it
  is working while connecting nowhere. `.env.example` supplies working values so
  a fresh clone still runs after copying it.
- Parsed center is exposed as `{ lat, lon }`, not the raw string. Zoom is exposed
  as a number. Callers never reparse.
- **Errors name the variable, never its value.** The token must not appear in any
  error message, log line, or thrown string. It is the only secret-shaped value
  in the project.
- Every `VITE_` prefixed variable is baked into the client bundle and readable by
  anyone who loads the app. This is accepted for local and trusted-network use;
  a public deployment needs a backend proxy holding the token. Record this in
  `.env.example` as a comment.
- `.env` is gitignored. `.env.example` is committed with placeholder values only
  and one comment per variable. No real host, token, or internal hostname is
  committed.

## Testing

`AGENTS.md` declares no `test` command yet, so the test gate is off at the start
of this feature and on at its end. `src/config.ts` is exactly the kind of pure
logic the standards say to cover: a parser with real edge cases.

`src/config.test.ts` covers:

- a fully valid environment parses, with URLs trailing-slash trimmed
- each missing required variable throws an error naming that variable
- malformed `VITE_DEFAULT_CENTER` (not two parts, non-numeric, out of range)
  throws naming the variable
- out-of-range `VITE_DEFAULT_ZOOM` throws naming the variable
- absent, empty, and whitespace-only token all resolve to `undefined`
- defaults apply when optional variables are absent
- no thrown message contains the token value

Not unit tested: the Vite scaffold itself and the rendered shell. Those ride on
`npm run verify` passing and the dev server rendering, per the standards' scope
rule.

## Notes for the AI

- **Node 20 or newer.**
- The overlay rule is not optional. Running a scaffolder in this directory fails
  and risks the Blueprint files. Scaffold outside, then copy in.
- Do not add Tailwind, shadcn/ui, Prisma, Zod, or any state library. None is in
  the plans for this feature. Plain CSS is sufficient for an empty shell.
- Do not add a map, a WebSocket, or aircraft types. Feature 2 starts the map.
- No em dashes in any generated content, per the Writing section of
  `coding-standards.md`. Use a hyphen for `term - description`.
- Keep `config.ts` free of side effects beyond parsing, so tests can import it
  with a stubbed `import.meta.env`.

## Change log

Pre-implementation changes made in this feature's working tree. No code has been
written yet; every entry below is workflow or documentation setup.

### 2026-09-09 - pre-implementation setup

| # | Change | Files | Status |
| --- | --- | --- | --- |
| 1 | Git repository initialized by the user | `.git/` | Done, no commits yet, on `master` |
| 2 | Tune `coding-standards.md` to the real stack | `blueprint/context/coding-standards.md` | Done in `/onboard`, rewritten for Vite + React + MapLibre |
| 3 | Replace em dashes, en dashes, ellipses with the standard's `term - description` hyphen form | 19 generated markdown files, listed below | Done, 221 characters replaced, 0 remaining |
| 4 | This change log | `blueprint/context/current-feature.md` | Done |
| 5 | Root `.gitignore` created before any Git operation | `.gitignore` | Done |
| 6 | `/onboard`: project name, Commands block, onboarding marker removed, Efficient style kept, adapters confirmed `claude` + `codex` | `AGENTS.md`, `CLAUDE.md`, `blueprint/context/coding-standards.md` | Done |
| 7 | Initial commit `0cd4972` on `master`, 20 files, no AI attribution per project policy | `.gitignore`, `ONBOARDING.md`, `context/`, `docs/` | Done, local only, never pushed |
| 8 | User restructure: root `context/` deleted, `context/features/` moved to `blueprint/context/features/` | 15 spec files relocated | Done by the user |
| 9 | Repoint every reference to the moved spec files | `AGENTS.md`, `blueprint/build-plan.md`, `blueprint/project-plan.md`, `blueprint/context/project-overview.md`, `blueprint/context/current-feature.md` | Done, 24 references updated, 0 stale remaining |

**Punctuation pass (item 3) touched:** `docs/flight-map-plan.md`,
`blueprint/project-plan.md`, `blueprint/build-plan.md`,
`blueprint/context/project-overview.md`, and all 15 files in
`blueprint/context/features/`. Replacements were character-level only: em dash
(U+2014) and en dash (U+2013) to a hyphen, ellipsis (U+2026) to three dots. No
wording, structure, or meaning changed.
`blueprint/context/current-feature.md` and `AGENTS.md` already had none.

**Fingerprint follow-up:** the punctuation pass changed the bytes of
`project-plan.md` and `build-plan.md`, which would have made `/status` report
false overview drift. The `blueprint:source-hash` marker in
`project-overview.md` was recomputed mechanically from the new plan bytes:
`308c6323...` to `097296cc...`. Overview content was not regenerated because no
plan content changed. Re-run `/overview` if that assumption is ever wrong.

**`.gitignore` (item 5) covers:** `node_modules/`, `dist/`, `.env` with
`!.env.example` preserved, coverage and log output, editor and OS files, the
Blueprint generated state (`run.json`, `backups/`, `staging/`), and
`docs/fixtures/*.raw.json` so unscrubbed SkySpy captures cannot be committed by
accident.

**Restructure follow-up (items 8 and 9):** the feature specs now live at
`blueprint/context/features/`, so all Blueprint context sits under one root.
Prose references use the repo-root path; markdown links inside `blueprint/*.md`
use the relative `context/features/`. The root `context/` folder and the separate
tracking file that lived in it are gone, so this change log is the single record
of pre-implementation changes.

**Git state:** commit `0cd4972` still contains the specs at their old
`context/features/` paths. Those deletions and the new
`blueprint/context/features/` files are uncommitted, along with `AGENTS.md`,
`CLAUDE.md`, `.agents/`, `.claude/`, and `blueprint/`. Nothing has been pushed
and no remote is configured.

| 10 | Vite React-TS scaffold overlaid, demo content stripped to a dark shell | `index.html`, `src/`, `vite.config.ts`, `tsconfig*.json`, `package.json` | Done, steps 1 and 2 |
| 11 | ESLint flat config, Prettier, TypeScript strict mode, `no-explicit-any` | `eslint.config.js`, `.prettierrc`, `.prettierignore`, `tsconfig.app.json`, `tsconfig.node.json` | Done, step 3. Replaced the oxlint the Vite 9 template ships with, per spec |
| 12 | Vitest with jsdom and React Testing Library, `passWithNoTests: false` | `vite.config.ts`, `src/App.test.tsx` | Done, step 4 |
| 13 | Validated environment config and its tests | `src/config.ts`, `src/config.test.ts`, `.env.example`, `src/main.tsx` | Done, step 5. 25 focused tests |
| 14 | `verify` script chaining typecheck, tests, build | `package.json` | Done, step 6 |
| 15 | Commands section rewritten to the real commands; test gate turned ON | `AGENTS.md` | Done, step 7 |

> Update this table as implementation proceeds, one row per reviewable change.

## Open questions

None. Both previously recorded items are resolved:

1. ~~`coding-standards.md` is the untuned default.~~ Resolved by `/onboard`. It
   now describes the real stack, and its Out of scope line above about Tailwind,
   shadcn/ui, Prisma, and Next.js reflects deliberate exclusions rather than a
   stale template.
2. ~~No initial commit exists.~~ Resolved. `HEAD` is `0cd4972` on `master`, so
   `/implement` can create `feature/project-scaffold`.

Implementation can begin.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":14000,"specSha256":"381e36691864f2ee3cf967e07b309731b8c213885f31f22a9963aa3e3d20bfa9","branch":"refs/heads/feature/project-scaffold","head":"5c3a61de5fa1cbdc922083faa308bb65fe2f7995","baseRef":"refs/heads/master","baseCommit":"5c3a61de5fa1cbdc922083faa308bb65fe2f7995","sourceTree":"e5d80784b81b9a1acb7f7ef80344540e92e8f104","absentOptional":[]} -->
