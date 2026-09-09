# Feature: Documentation and polish

**From build-plan:** feature 11
**Build attempt:** 1
**Branch:** feature/11-docs-and-polish

Source: `docs/flight-map-plan.md` §6 Step 11.

## Goal

Close v1: someone else can clone the repository, point it at their own SkySpy
instance or the mock, and run it - and the app handles small screens, first load,
and errors without embarrassment.

## In scope

- `README.md`: setup, environment variables, real instance vs mock, known gaps
- Loading and error states across the app
- Responsive layout down to mobile widths
- Basic accessibility pass
- Final `npm run verify` green

## Out of scope

- Deployment or hosting (that is `/release`)
- CI workflow (that is `/ci`)
- Any new product capability

## Build loop

Implement all steps, then one review packet.

## Build steps

- [ ] **Write `README.md`:** what the app is, screenshot, prerequisites, install,
  every environment variable with an example, how to run against a real SkySpy
  instance, how to run against the mock, and all available commands.
  **Done when:** following it from a clean clone produces a running app against
  the mock without reading any other file.
- [ ] **Document known gaps and constraints** in the README: SkySpy is
  self-hosted so coverage is one receiver's radius and a sparse map is normal;
  no route or origin/destination data exists; trails start at selection and are
  not flight history; `VITE_`-prefixed tokens are readable by anyone using the
  app, so a public deployment needs a backend proxy holding the token
  server-side.
  **Done when:** each constraint is stated plainly enough that a new user is not
  surprised by it.
- [ ] **Add a first-load state.** Before the seed or first snapshot lands, show
  an unobtrusive loading indicator rather than an empty map that looks broken.
  **Done when:** a cold start shows loading, then aircraft, with no blank
  ambiguous gap.
- [ ] **Add an error boundary** around the map and panel so a render error shows
  a readable message with a reload action instead of a white screen.
  **Done when:** a deliberately thrown render error produces the fallback UI.
- [ ] **Make the layout responsive.** At narrow widths the detail panel becomes a
  bottom sheet or overlay instead of a fixed sidebar; the stats bar stays
  readable; nothing overflows horizontally.
  **Done when:** the app is usable at 375 px wide with no horizontal scrolling.
- [ ] **Accessibility pass.** Keyboard focus visible on all controls; Esc
  deselects (already in feature 09); the panel is reachable and readable by
  screen reader; colour is never the only signal - stale and selected also carry
  a text or shape cue. The map canvas itself is not fully keyboard-navigable and
  that limitation is documented rather than hidden.
  **Done when:** controls are keyboard-operable with visible focus, and the
  known map limitation is written down.
- [ ] **Final pass:** remove dead code, stray `console.log`s, and unused
  dependencies; confirm `npm run verify` is green.
  **Done when:** `npm run verify` passes with no warnings and no debug output in
  the console during normal use.

## Files / areas

- `README.md`
- `src/ui/ErrorBoundary.tsx`, `src/ui/LoadingState.tsx`
- `src/App.tsx`, `src/index.css` - responsive layout
- Small edits across existing components

## Data / contracts

No new data. Documentation must match the code as built - if implementation
diverged from `docs/flight-map-plan.md`, the README describes reality and the
divergence is noted.

## Testing

- RTL: error boundary renders its fallback on a thrown error; loading state shows
  before data and hides after.
- Manual: cold start; narrow viewport; keyboard-only navigation.
- `npm run verify` green.

## Notes for the AI

- Take the README screenshot against the mock with a healthy fleet - do not
  publish a screenshot containing a real token or an internal hostname.
- Scrub any real host or token from committed examples; `.env.example` uses
  placeholders only.
- This feature closes v1. Features 12-15 are the v2 identity and photo layer and
  are not part of this branch.
