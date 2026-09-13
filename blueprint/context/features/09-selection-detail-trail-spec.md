# Feature: Selection, detail panel, and trail

**From build-plan:** feature 09
**Build attempt:** 1
**Branch:** feature/09-selection-detail-trail

Source: `blueprint/project-plan.md` §7.

## Goal

Click an aircraft and get the Flightradar24 moment: it highlights, the rest dim,
a trail draws behind it, and a side panel shows live telemetry that ticks as it
flies.

## Design reference

FR24's selection interaction - highlight, fleet dim, growing trail, left detail
sidebar, hover tooltip. Our own palette and assets.

## In scope

- Click to select, Esc or click-away to deselect
- Selected aircraft highlighted; others dimmed
- Trail line from a client-side position buffer, selected aircraft only
- `AircraftDetailPanel` with live telemetry
- Hover tooltip with callsign

## Out of scope

- Airframe identity, registration, operator, photo (features 12-14) - but the
  panel must leave room for them
- Whole-fleet trails: needs history the store does not keep and multiplies render
  cost
- Following or auto-centring on the selected aircraft

## Build loop

Implement all steps, then one review packet.

## Build steps

- [ ] **Add selection state** holding one `hex` or null, in React state (this
  changes rarely, unlike positions). Clicking the symbol layer selects; clicking
  empty map or pressing Esc deselects.
  **Done when:** clicking an aircraft sets selection, and Esc or empty-map click
  clears it.
- [ ] **Style the selection.** Selected aircraft get a distinct colour and larger
  icon; all others drop opacity so the selection reads immediately.
  **Done when:** the selected aircraft is unmistakable at a glance and dimming
  does not make the rest invisible.
- [ ] **Add `store/trailBuffer.ts`.** A ring buffer of ~200 positions for a
  single hex, appended when the selected aircraft's position changes, cleared on
  deselect or when selection changes. Kept **separate from the aircraft store**
  so the trail costs nothing when nothing is selected and history cannot grow
  unbounded across a long session.
  **Done when:** unit tests cover append, the ring cap discarding oldest points,
  and clear-on-deselect.
- [ ] **Add `map/TrailLayer.tsx`,** a line layer rendering the buffer as a
  LineString beneath the aircraft symbol layer, so icons always sit on top.
  **Done when:** selecting an aircraft draws a trail that grows as it flies and
  disappears on deselect.
- [ ] **Add `ui/AircraftDetailPanel.tsx`.** Callsign (trimmed), hex,
  altitude, ground speed, heading, squawk, vertical rate, distance, and a
  last-seen age that counts up. Every field handles absent data with a dash, not
  a zero or a blank - a missing squawk must not read as squawk 0. Structure the
  panel with an empty identity slot **above** the telemetry block for features
  13-14.
  **Done when:** selecting an aircraft shows telemetry that updates live, absent
  fields render as dashes, and the identity slot exists.
- [ ] **Keep the panel live and handle disappearance.** The panel follows updates
  for the selected hex. If that aircraft is removed or goes stale while selected,
  the panel says so explicitly rather than freezing on last values or vanishing.
  **Done when:** the mock removing a selected aircraft produces a clear
  "signal lost" state rather than silent stale numbers.
- [ ] **Add a hover tooltip** showing the callsign, with a pointer cursor over
  aircraft.
  **Done when:** hovering shows the callsign and the cursor indicates
  clickability.

## Files / areas

- `src/store/trailBuffer.ts`, `src/store/trailBuffer.test.ts`
- `src/map/TrailLayer.tsx`, `src/map/AircraftLayer.tsx` (click, hover, styling)
- `src/ui/AircraftDetailPanel.tsx`
- `src/App.tsx` - selection state and layout

## Data / contracts

Selection is by `hex`. It survives updates and reconnects; if the aircraft is
gone after a reconnect, the panel shows signal-lost rather than clearing
silently.

The trail is **client-side only** - OpenSky provides no position history, so the
trail starts empty at selection and grows from that moment. This must not be
presented as full flight history.

Panel layout is a contract with features 13-14: identity block above, telemetry
below, so adding identity does not restructure the panel.

## Testing

- Unit: `trailBuffer` append, cap, clear, and selection change.
- RTL: panel renders each field; absent fields show dashes; signal-lost state
  appears when the aircraft is removed.
- Manual: select, watch the trail grow, deselect, confirm it clears.

## Notes for the AI

- Selection state belongs in React; positions do not. Do not move the aircraft
  store into React state to make selection easier.
- Only the selected aircraft's positions are buffered. Buffering the fleet is
  explicitly out of scope.
- The trail buffer must be cleared on selection change, not merged - a trail
  jumping between two aircraft is a confusing bug.
- Reserve panel space with a fixed layout so features 13-14 do not cause reflow
  later.
