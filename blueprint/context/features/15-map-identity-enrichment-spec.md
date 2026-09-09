# Feature: Map enrichment from identity data

**From build-plan:** feature 15
**Build attempt:** 1
**Branch:** feature/15-map-identity-enrichment

Source: `docs/flight-map-plan.md` §9, Step 15. Optional; closes the last visible
gap to Flightradar24's icon variety.

## Goal

Use already-cached airframe data to vary the map itself: different silhouettes
per aircraft type, and a distinct treatment for military aircraft.

## Design reference

FR24 renders visibly different shapes for a heavy, a regional jet, a light
aircraft, and a helicopter. Matching that is the last conspicuous difference
between our map and theirs.

## In scope

- A small set of silhouettes: heavy, narrowbody, regional/turboprop, light,
  helicopter, and a default
- `type_code` → silhouette mapping
- Distinct colour or badge for `is_military`
- Cache-only: never triggers a fetch from the map

## Out of scope

- Fetching identity for the fleet - explicitly excluded, see Data / contracts
- Exact per-model artwork
- Airline liveries or operator colouring

## Build loop

Implement all steps, then one review packet.

## Build steps

- [ ] **Add the silhouette set:** six SVGs (heavy, narrowbody, regional, light,
  helicopter, default), consistent in weight and nose-up orientation so rotation
  behaves identically across all of them.
  **Done when:** all six register with the map and render at consistent visual
  weight.
- [ ] **Add `map/typeToIcon.ts`,** a pure `type_code` → icon-name function with a
  documented mapping table (e.g. B77*/A35* → heavy, B738/A320 → narrowbody, DH8*
  /AT* → regional, C172 → light, EC*/R44 → helicopter) and a default for unknown
  or absent codes.
  **Done when:** unit tests cover each category, an unknown code, and an absent
  code, all resolving to something sensible.
- [ ] **Feed cached identity into the GeoJSON projection.** When
  `toGeoJSON()` builds a feature, look up the airframe cache for that hex and
  attach `icon` and `isMilitary` **only if already cached**. A cache miss yields
  the default icon and triggers **no fetch**.
  **Done when:** selected-then-deselected aircraft keep their specific
  silhouette, unselected aircraft show the default, and network activity is zero
  while panning.
- [ ] **Bind the symbol layer's `icon-image` to the feature's `icon` property,**
  extending feature 08's style rather than replacing it - the altitude ramp,
  zoom sizing, labels, and stale fading all still apply.
  **Done when:** aircraft with cached types render their silhouette while
  retaining altitude colour, sizing, labels, and fading.
- [ ] **Add the military treatment:** a distinct colour from feature 08's
  exported palette, applied when `isMilitary` is true. Absent data means unknown,
  not civil.
  **Done when:** a known military aircraft is visually distinct and unknown-status
  aircraft render normally.
- [ ] **Re-run the load test** at 2000 aircraft with a partly populated cache.
  Multiple icon images and a per-feature cache lookup both add cost to the
  throttled update path.
  **Done when:** panning and zooming stay smooth at 2000 aircraft, with measured
  numbers recorded if they regressed against feature 07.

## Files / areas

- `src/map/typeToIcon.ts`, `src/map/typeToIcon.test.ts`
- `src/assets/aircraft-*.svg`
- `src/store/selectors.ts` - cache lookup in the projection
- `src/map/aircraftStyle.ts` - `icon-image` binding, military colour

## Data / contracts

**Cache-only, strictly.** The map layer must never trigger an airframe fetch.
Identity is fetched on selection (feature 13) and only opportunistically reused
here. Fetching per visible aircraft would issue hundreds of requests on every pan
- the exact behaviour features 12-13 were designed to avoid.

The visible consequence is that silhouettes appear gradually as the user selects
aircraft, rather than all at once. That is intended and worth stating in the
README: the map becomes more detailed the more it is used.

Extend feature 08's palette rather than introducing new colour values.

## Testing

- Unit: `typeToIcon` for each category, unknown code, absent code.
- Unit: the GeoJSON projection attaches icon and military flags for cached
  aircraft and defaults for uncached ones, with no fetch invoked.
- Manual: select several aircraft of different types, deselect, confirm
  silhouettes persist; confirm no network requests while panning.
- Manual: 2000-aircraft load test.

## Notes for the AI

- Keep the mapping table small and readable. Exhaustive ICAO type coverage is not
  the goal; recognisable categories are.
- All silhouettes must share a nose-up orientation and similar bounding box, or
  rotation and sizing will look inconsistent between types.
- If the load test regresses, the cache lookup inside the projection is the first
  suspect - consider denormalising icon and military flags into the aircraft
  record when identity is cached, rather than looking them up per projection.
