# Coding Standards

Conventions for FlightScanner: a Vite + React + TypeScript single-page app that
renders live aircraft from the SkySpy WebSocket API on a MapLibre map. There is
no backend, no database, and no server rendering.

> Tuned by `/onboard`. Some sections are marked `> TODO` because the application
> code does not exist yet; fill them in as feature 1 and feature 2 land.

## TypeScript

- Strict mode enabled
- No `any` types, use proper typing or `unknown`
- Define interfaces for props, message payloads, and API responses
- Use type inference where obvious, explicit types where helpful
- **Every SkySpy payload field except `hex` is optional.** The aircraft object is
  declared `additionalProperties: {}` in SkySpy's OpenAPI schema, so its real
  shape is deployment-specific. Types come from captured fixtures, not from the
  documentation, and every read is guarded.
- Use discriminated unions with type guards for WebSocket message types. An
  unknown message type is ignored, never thrown on.

## React

- Functional components only, no class components
- Hooks for state and side effects; extract reusable logic into custom hooks
- Keep components focused, one job per component
- **High-frequency data does not live in React state.** The aircraft store is a
  mutable `Map` mutated outside the render path and read through a
  `useSyncExternalStore`-compatible subscription. At up to 10 Hz across hundreds
  of aircraft, reconciliation is the bottleneck the architecture avoids.
- React re-renders are reserved for connection status, selection, and counts
- Components must survive React 18 StrictMode double-mounting without leaking a
  socket, timer, subscription, or map layer

## Map rendering

- **MapLibre GL JS via `react-map-gl`.** Aircraft render as one GeoJSON source
  plus a symbol layer, never as individual DOM markers or per-aircraft React
  components.
- Prefer MapLibre style expressions over recomputing styles in JS. Expressions
  evaluate on the GPU and keep the update path cheap.
- Source updates are throttled with `requestAnimationFrame` and coalesced, target
  about 4 Hz regardless of incoming message rate
- Every layer, source, image, and event handler added to the map must be removed
  on unmount, and re-registered after a style change

## Project structure

```
src/
  config.ts        single reader of import.meta.env
  api/             REST clients (rest.ts, airframes.ts)
  ws/              SkySpyClient, message types, useSkySpy hook
  store/           aircraftStore, trailBuffer, selectors. Pure, no React
  map/             FlightMap, layers, style and icon config
  ui/              panels, status, legend, modals
  types/           shared type definitions
  assets/          SVG icons
mock/              dev-only mock WebSocket server (plain Node ESM)
docs/fixtures/     captured SkySpy frames used as fixtures
```

- Test files sit next to their source, for example `aircraftStore.test.ts`
- Keep `store/` free of React and map imports. If it needs either to be
  testable, the design is wrong.

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
- **Errors name the variable, never its value.** `VITE_SKYSPY_TOKEN` must not
  appear in any error message, log line, or thrown string.
- `.env` is gitignored. `.env.example` holds placeholders only, never a real
  host or token.

## Data access and API boundaries

- The app talks to SkySpy directly. There is no backend of our own.
- **WebSocket auth is settled: the token travels via `Sec-WebSocket-Protocol`,**
  passed as the `WebSocket` constructor's second argument. No query-string
  fallback, not in development either, because query strings leak tokens into
  server logs.
- REST clients return a discriminated result (`found` / `missing` / `error`) and
  never throw into render
- Transport code owns transport only. It does not interpret domain semantics,
  hold domain state, or touch the map.

## Error handling

- Distinguish failure modes that look alike. Disconnected, connected-but-silent,
  and auth-rejected must be separately visible to the user.
- A malformed frame is logged and skipped, never fatal
- Absent values render as a dash, never as `0` or an empty label. A missing
  squawk must not read as squawk 0.
- Expected-empty outcomes (no airframe record, no photo) use neutral styling, not
  error styling

## Testing

The test gate is **off** until a `test` command is declared in the Commands
section of `AGENTS.md`. Feature 1 installs Vitest and declares it, which turns
the gate on from that point forward.

- **What to test:** pure logic where a wrong answer is possible. Parsers,
  validators, the aircraft store, the trail buffer, backoff timing, config
  parsing, type-to-icon mapping.
- **What not to test:** the rendered map (jsdom cannot run WebGL) and
  integration-level surfaces. Verify those with the dev server, a screenshot, and
  the build. Extract the logic behind them into pure functions so it is still
  covered.
- **The gate:** once the test command exists, a step that adds in-scope logic
  ships a passing test in the same reviewable diff, green before approval, before
  any checkpoint commit, and before `/complete` merges.
- An empty suite must fail, not pass, so "no tests ran" never reads as "passed"
- Stack binding: Vitest, React Testing Library, `vi.useFakeTimers()` for
  timer-dependent logic (backoff, staleness, throttling), and an injectable fake
  WebSocket rather than mocking the global

## Browser verification

- Browser automation is separately opt-in through `/browser-tests`. None is
  configured, so do not add a runner mid-feature.
- Until then, UI claims ride on the dev server, screenshots, and the build
- The mock server (`npm run mock`, added by feature 4) is the primary way to
  exercise live behaviour and failure modes without a SkySpy instance

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
  workaround, why a value is what it is, or a link to a spec. The confirmed
  subprotocol handshake shape is a good example: record what was tested.
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

> TODO. No form input or user-supplied data exists yet. The app is read-only over
> a live feed. Revisit if a filter, search, or settings surface is ever added.

## Accessibility

> TODO beyond the basics until feature 11. Established now: visible keyboard
> focus on all controls, Esc closes overlays, colour is never the only signal,
> and the map canvas limitation is documented rather than hidden.
