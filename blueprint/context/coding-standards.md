# Coding Standards

Conventions for FlightScanner: a Vite + React + TypeScript single-page app that
polls the OpenSky Network REST API and renders live aircraft on a MapLibre map.
There is a small backend of our own, a stateless proxy the app cannot work
without, but no database and no server rendering.

> Tuned by `/onboard`, and rewritten on 2026-09-13 when the data source changed
> from a SkySpy WebSocket stream to polled OpenSky REST. Some sections are marked
> `> TODO` because the surface they describe does not exist yet.

## TypeScript

- Strict mode enabled
- No `any` types, use proper typing or `unknown`
- Define interfaces for props, decoded domain objects, and API responses
- Use type inference where obvious, explicit types where helpful
- **Every aircraft field except `hex` is optional.** OpenSky returns each
  aircraft as a **positional array, not an object**, and real captures have null
  entries throughout. Read every index by position, guard every read, and take
  types from the committed fixture rather than from the documentation.
- Use discriminated unions with type guards at every boundary that can fail.
  `OpenSkyResult<T>` (`found` / `missing` / `error`) is the established shape;
  an unrecognised response is classified, never thrown on.

## React

- Functional components only, no class components
- Hooks for state and side effects; extract reusable logic into custom hooks
- Keep components focused, one job per component
- **Aircraft data does not live in React state.** The aircraft store is a
  mutable `Map` mutated outside the render path and read through a
  `useSyncExternalStore`-compatible subscription. Polling is slow, but a snapshot
  replaces hundreds of aircraft at once and the render path still has to redraw
  between polls; putting that through the reconciler is the bottleneck the
  architecture avoids.
- React re-renders are reserved for poll status, selection, and counts
- Components must survive React 18 StrictMode double-mounting without leaking a
  timer, in-flight request, subscription, or map layer

## Map rendering

- **MapLibre GL JS via `react-map-gl`.** Aircraft render as one GeoJSON source
  plus a symbol layer, never as individual DOM markers or per-aircraft React
  components.
- Prefer MapLibre style expressions over recomputing styles in JS. Expressions
  evaluate on the GPU and keep the update path cheap.
- Source updates are throttled with `requestAnimationFrame` and coalesced. One
  snapshot is one `setData()`, never one update per aircraft.
- **The polled bounding box is fixed and does not follow the camera.** Panning
  and zooming never trigger a request. Leaving the box shows empty map, which the
  UI states rather than letting it read as a dead feed.
- Every layer, source, image, and event handler added to the map must be removed
  on unmount, and re-registered after a style change

## Project structure

```
src/
  config.ts        single reader of import.meta.env
  api/             browser-side clients for our own proxy (opensky.ts)
  server/          the proxy: router, handlers, token cache, server env
  store/           aircraftStore, trailBuffer, selectors. Pure, no React
  map/             FlightMap, layers, style and icon config
  ui/              panels, status, legend, modals
  types/           shared type definitions
  assets/          SVG icons
api/               Vercel function entrypoints, delegating to src/server
mock/              dev-only mock feed server (plain Node ESM)
docs/fixtures/     captured OpenSky responses used as fixtures
```

- Test files sit next to their source, for example `aircraftStore.test.ts`
- Keep `store/` free of React and map imports. If it needs either to be
  testable, the design is wrong.
- **`src/server/` never imports from the client tree and reads no `VITE_`
  variable.** It is the only place a credential exists. The function entrypoints
  under `api/` hold no logic; they delegate to the same router the dev and
  preview servers mount, so there is no deploy-only code path.

## Naming

- Components: PascalCase (`AircraftDetailPanel.tsx`)
- Hooks: `useThing.ts`
- Other modules: camelCase file names matching the main export
- Functions: camelCase. Constants: SCREAMING_SNAKE_CASE
- Types and interfaces: PascalCase, no prefix
- **`hex` is the aircraft identity key everywhere.** Never key on `flight`,
  callsigns change and repeat.

## Styling

- Plain CSS with custom properties for tokens. No Tailwind, no CSS-in-JS, no
  component library.
- Dark first. The basemap is dark and aircraft must read against it.
- Keep the colour palette in one exported module so later features extend it
  rather than hard-coding new values
- Colour is never the only signal. Stale and selected states also carry a text,
  shape, or opacity cue.

## Configuration and secrets

- `src/config.ts` is the only module that reads `import.meta.env`. Everything
  else takes parsed, validated values.
- Every `VITE_` prefixed variable is baked into the client bundle and readable by
  anyone who loads the app. Nothing belongs there that would be damaging if
  leaked.
- **No credential is ever `VITE_` prefixed.** `OPENSKY_CLIENT_ID` and
  `OPENSKY_CLIENT_SECRET` are read only by `src/server/env.ts` and never reach
  the browser. Set both or neither; half a pair is rejected rather than silently
  downgraded to the smaller anonymous quota.
- **Errors name the variable, never its value.** A secret must not appear in any
  error message, log line, thrown string, or proxy response body.
- `.env` is gitignored. `.env.example` holds placeholders only, never a real
  credential.

## Data access and API boundaries

- **The browser never calls OpenSky directly, in any environment.** `states/all`
  answers every origin with `Access-Control-Allow-Origin:
  https://opensky-network.org` and the token endpoint sends no CORS header at
  all, so the proxy is required for the app to function and not merely to hide
  the credentials. Anything that adds a third-party API call adds a proxy route
  with it.
- **The proxy is same-origin only.** No route sets
  `Access-Control-Allow-Origin`: a wildcard would let any site spend this
  account's daily credit budget.
- **Proxy errors are a stable contract**, not free text. `{"error": "<code>"}`
  with the codes in `docs/proxy.md`; the polling client switches on them, so
  adding or renaming one is a breaking change to both sides at once.
- **Respect the credit budget in code, not just in review.** A bounded query
  costs one credit against 4000 a day, which is why 30 s is a hard floor rather
  than a default. Nothing may poll faster, and no code path may fire an extra
  request per pan, per component, or per retry without backoff.
- REST clients return a discriminated result (`found` / `missing` / `error`) and
  never throw into render
- Transport code owns transport only. It does not interpret domain semantics,
  hold domain state, derive staleness, or touch the map.

## Error handling

- Distinguish failure modes that look alike. Proxy unreachable, polling but
  stale, credit budget exhausted, and credentials rejected must be separately
  visible to the user; the last two are not errors to retry through.
- **A frozen map that looks healthy is worse than one that admits it is stale.**
  Aircraft that stop reporting fade, and are dropped 30 s after the last snapshot
  that held them rather than left at a stale position.
- A malformed state vector is skipped, never fatal. One bad array does not
  discard the snapshot around it.
- Absent values render as a dash, never as `0` or an empty label. A missing
  squawk must not read as squawk 0.
- Expected-empty outcomes (no airframe record, no photo) use neutral styling, not
  error styling

## Testing

The test gate is **on**. `npm test` is declared in the Commands section of
`AGENTS.md`, so logic-bearing steps ship focused tests in the same reviewable
diff.

- **What to test:** pure logic where a wrong answer is possible. Positional
  vector decoding, the aircraft store's reconciliation and its 30 s removal rule,
  the trail buffer, backoff and poll timing, config and bounding box parsing,
  proxy request validation and error classification, type-to-icon mapping.
- **What not to test:** the rendered map (jsdom cannot run WebGL) and
  integration-level surfaces. Verify those with the dev server, a screenshot, and
  the build. Extract the logic behind them into pure functions so it is still
  covered.
- **The gate:** once the test command exists, a step that adds in-scope logic
  ships a passing test in the same reviewable diff, green before approval, before
  any checkpoint commit, and before `/complete` merges.
- An empty suite must fail, not pass, so "no tests ran" never reads as "passed"
- Stack binding: Vitest, React Testing Library, `vi.useFakeTimers()` for
  timer-dependent logic (poll interval, backoff, staleness, throttling), and an
  injectable `FetchLike` rather than mocking the global `fetch`
- **Tests never call OpenSky.** They run against the committed fixture or an
  injected fake. A test that spends a credit is a broken test.

## Browser verification

- Browser automation is separately opt-in through `/browser-tests`. None is
  configured, so do not add a runner mid-feature.
- Until then, UI claims ride on the dev server, screenshots, and the build
- The mock feed server (added by feature 4) is the primary way to exercise live
  behaviour and failure modes without spending credits against the daily
  budget

## Code quality

- No commented-out code unless specified
- No unused imports or variables
- Keep functions under 50 lines when possible
- Every timer, listener, subscription, and animation frame has a matching
  teardown. Reconnect and render loops are where leaks hide.

## Comments

Write code that explains itself; comment only what the code cannot say.
Over-commenting is a common AI tell, so resist it.

- Comment the **why**, not the **what**. Delete any comment that restates the code.
- No banner or header blocks, section dividers, or narration of obvious code.
- A comment earns its place when it captures a non-obvious decision, a gotcha or
  workaround, why a value is what it is, or a link to a spec. The verified CORS
  behaviour and the 30 s poll floor are good examples: record what was measured
  and what it costs.
- Prefer self-documenting names and small functions over explanatory comments
- Keep doc comments minimal, a one-line purpose on an exported type or function
- When in doubt, leave the comment out

## Writing

- No em dashes (U+2014) in generated content: docs, comments, commit messages,
  READMEs, specs. They read as AI-generated.
- Use a hyphen for `term - description` separators; rephrase prose with commas,
  parentheses, or a colon. Avoid en dashes and the ellipsis character too.
- Attribution on third-party content is mandatory, not decorative. Aircraft
  photos render with their photographer and source, every time.

## Validation

> TODO on the client: no form input or user-supplied data exists yet, and the
> app is read-only over a live feed. Revisit if a filter, search, or settings
> surface is ever added. **Not TODO on the proxy:** every query parameter is
> already validated and rejected with `invalid-request` before any upstream call,
> because an unvalidated request spends a credit.

## Accessibility

> TODO beyond the basics until feature 11. Established now: visible keyboard
> focus on all controls, Esc closes overlays, colour is never the only signal,
> and the map canvas limitation is documented rather than hidden.
