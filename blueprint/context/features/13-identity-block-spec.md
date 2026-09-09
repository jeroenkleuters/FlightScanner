# Feature: Identity block in the detail panel

**From build-plan:** feature 13
**Build attempt:** 1
**Branch:** feature/13-identity-block

Source: `docs/flight-map-plan.md` §9, Step 13.

## Goal

Selecting an aircraft shows what it actually is - registration, type, operator,
country, age - above the live telemetry, with honest states while loading and
when no record exists.

## In scope

- Identity block in `AircraftDetailPanel`, filling the slot reserved in feature 09
- Fetch triggered by selection, via feature 12's cache
- Skeleton, loaded, and no-data states
- Military badge and country indicator

## Out of scope

- The photo (feature 14) - the media fields are fetched but not rendered here
- Map styling from identity data (feature 15)
- Route or origin/destination: no SkySpy endpoint provides it

## Build loop

Implement all steps, then one review packet.

## Build steps

- [ ] **Trigger the fetch on selection.** When selection changes to a hex,
  request it from the airframe cache. Deselecting must not cancel a completed
  fetch's cache entry - the result stays cached for reselect.
  **Done when:** selecting an aircraft issues one request and reselecting it
  issues none.
- [ ] **Add `ui/AircraftIdentity.tsx`** rendering registration, `type_name` (with
  `type_code` as secondary), operator, country, and age. Absent fields are
  omitted entirely rather than shown as empty rows - a panel of blank labels
  looks broken.
  **Done when:** a fully populated response renders all fields, and a sparse one
  renders only what exists without gaps.
- [ ] **Add the loading skeleton.** While pending, show a skeleton occupying the
  block's final height. **Telemetry keeps streaming underneath throughout** - a
  slow or failed identity lookup must never interrupt the live data that already
  works.
  **Done when:** during a slow fetch the skeleton shows, telemetry continues
  updating, and no layout jump occurs when the result lands.
- [ ] **Add the no-data state.** For a cached miss, show a plain "no airframe
  data on file" line. This is a normal outcome, not an error: it must not use
  error styling, warning colours, or an alarming icon.
  **Done when:** a 404 renders as a calm neutral line and the panel stays useful
  with telemetry alone.
- [ ] **Add an error state distinct from no-data,** with a retry affordance, for
  the `error` result only.
  **Done when:** a network failure shows a retry that works, while a 404 shows no
  retry.
- [ ] **Add the military badge and country indicator.** Show a badge when
  `is_military` is true; show country from `country`/`country_code`. Absent
  `is_military` means unknown, not false - do not render a "civil" badge from
  missing data.
  **Done when:** military aircraft are badged and aircraft with unknown status
  carry no badge either way.

## Files / areas

- `src/ui/AircraftIdentity.tsx`, `src/ui/AircraftIdentity.test.tsx`
- `src/ui/AircraftDetailPanel.tsx` - fills the reserved slot
- `src/App.tsx` - selection triggers the cache request

## Data / contracts

The panel layout contract from feature 09 holds: identity above, telemetry below.
This feature fills the reserved slot; it does not restructure the panel.

Every field is optional. Registration, type, and operator are the most valuable
and the most often present; airframe hours and dates are frequently absent.

Telemetry and identity are independent. Identity failure degrades one block,
never the panel.

## Testing

- RTL: full response renders all fields; sparse response omits missing ones;
  pending shows skeleton; missing shows the neutral line with no retry; error
  shows retry; military badge appears only when `is_military` is true.
- Manual: select several aircraft including one with no record; confirm no layout
  jump and uninterrupted telemetry.

## Notes for the AI

- Reserve the block's height before content arrives. Feature 14 adds an image
  above this; both must land without reflow.
- Do not fetch from inside the identity component's render. Selection triggers
  the cache; the component reads cache state.
- "No airframe data" is common and expected. Styling it as a failure will make a
  normal condition look like a bug.
