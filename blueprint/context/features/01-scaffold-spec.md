# Feature: Project scaffold

**From build-plan:** feature 01
**Build attempt:** 1
**Branch:** feature/01-scaffold

## Goal

A running Vite + React + TypeScript app with linting, formatting, testing, and
environment configuration in place, so every later feature has somewhere to land.

## In scope

- Vite React-TS app in this repository
- ESLint + Prettier + Vitest configured and runnable
- `.env.example` with every variable the project will need
- `config.ts` reading and validating environment variables
- `AGENTS.md` Commands section updated with the real commands

## Out of scope

- Any map, WebSocket, or SkySpy code
- CI workflow (that is `/ci`, a separate explicit step)
- Deployment configuration

## Build loop

`workflow.stepReview: "feature"` - implement all steps, then one review packet.
`checkpointCommits: "disabled"` - no per-step commits. `/complete` makes the
feature commit.

## Build steps

- [ ] **Scaffold in an empty sibling folder, then overlay.** Run
  `npm create vite@latest flightscanner-app -- --template react-ts` in an empty
  directory *outside* this repo, then copy the generated files in. Never run a
  scaffolder inside this folder - it holds `AGENTS.md`, `CLAUDE.md`, `.agents/`,
  `.claude/`, and `blueprint/`, and the scaffolder fails on a non-empty
  directory. Merge `.gitignore` rather than overwriting; keep `blueprint/.state/`
  ignored.
  **Done when:** `npm run dev` serves the default Vite page and no Blueprint file
  was moved, overwritten, or deleted.
- [ ] **Add ESLint and Prettier.** TypeScript + React Hooks rules, Prettier for
  formatting with no rule conflicts. Add `lint` and `format` scripts.
  **Done when:** `npm run lint` passes on the scaffold with zero warnings.
- [ ] **Add Vitest.** jsdom environment, React Testing Library, `test` and
  `test:watch` scripts, and one trivial passing test proving the harness runs.
  **Done when:** `npm test` runs and reports one passing test.
- [ ] **Add a `verify` script.** `tsc --noEmit && vitest run && vite build`, in
  that order - typecheck, tests, build.
  **Done when:** `npm run verify` passes end to end.
- [ ] **Add `.env.example` and `src/config.ts`.** Variables:
  `VITE_SKYSPY_HTTP`, `VITE_SKYSPY_WS`, `VITE_SKYSPY_TOKEN`,
  `VITE_MAP_STYLE_URL`, `VITE_DEFAULT_CENTER`, `VITE_DEFAULT_ZOOM`. `config.ts`
  parses these once, applies defaults, and throws a readable error naming the
  missing variable when a required one is absent. `.env` is gitignored;
  `.env.example` is committed with placeholder values and a comment per variable.
  **Done when:** the app starts with `.env` present, and removing a required
  variable produces an error naming it rather than a runtime crash later.
- [ ] **Strip the Vite demo content.** Remove the counter, logos, and demo CSS.
  Leave a minimal dark-background shell.
  **Done when:** the page is an empty dark viewport with no Vite branding.
- [ ] **Update the Commands section in `AGENTS.md`** with the real dev, build,
  lint, test, and verify commands.
  **Done when:** every command listed there runs successfully as written.

## Files / areas

- `package.json`, `vite.config.ts`, `tsconfig.json`
- `.eslintrc.cjs` (or flat config), `.prettierrc`, `.gitignore`
- `.env.example`, `src/config.ts`, `src/main.tsx`, `src/App.tsx`, `src/index.css`
- `AGENTS.md` - Commands section only

## Data / contracts

`config.ts` is the single reader of `import.meta.env`. No other module reads
environment variables directly - this keeps validation in one place and makes
config trivially mockable in tests.

`VITE_SKYSPY_TOKEN` is optional: SkySpy's default deployment is public mode.
Absent means connect without auth.

## Testing

- One `config.ts` test: valid input parses; a missing required variable throws an
  error naming the variable.

## Notes for the AI

- Node 20+.
- Every `VITE_`-prefixed variable is baked into the client bundle and readable by
  anyone using the app. Never put a secret behind that prefix that would matter
  if leaked.
- `VITE_DEFAULT_CENTER` is a `"lat,lon"` string; parse and validate it, don't
  trust it.
