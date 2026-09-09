# Feature: Airframes API client and cache

**From build-plan:** feature 12
**Build attempt:** 1
**Branch:** feature/12-airframes-client-cache

Source: `docs/flight-map-plan.md` §9, Step 12. First feature of v2.

## Goal

Fetch aircraft identity - registration, type, operator, photo URLs - for a single
selected aircraft, cached for the session, with misses handled as a normal
outcome rather than an error.

## In scope

- `api/airframes.ts`: typed `GET /api/v1/airframes/{icao_hex}/`
- `store/airframeCache.ts`: per-hex cache with pending, loaded, missing states
- In-flight request deduplication
- Full unit coverage

## Out of scope

- Any UI (features 13-14)
- Prefetching for the fleet - explicitly excluded, see Data / contracts
- The separate `/photos/` endpoint unless the probe proves it necessary

## Build loop

Implement all steps, then one review packet.

## Build steps

- [ ] **Add the `AirframeInfo` type** covering the documented response: identity
  (`icao_hex`, `registration`, `type_code`, `type_name`), airframe
  (`manufacturer`, `model`, `serial_number`, `year_built`, `age_years`,
  `first_flight_date`, `delivery_date`, `airframe_hours`), operator (`operator`,
  `operator_icao`, `operator_callsign`, `owner`, `country`, `country_code`),
  classification (`category`, `is_military`), media (`photo_url`,
  `photo_thumbnail_url`, `photo_photographer`, `photo_source`), and provenance
  (`cached_at`, `fetch_failed`). Every field optional except `icao_hex`.
  **Done when:** the type compiles and parses a real captured response.
- [ ] **Add `api/airframes.ts`** with `fetchAirframe(hex)` returning a
  discriminated result: `found`, `missing` (HTTP 404), or `error` (network or
  5xx). It never throws. Sends the auth header when a token is configured.
  **Done when:** unit tests cover all three outcomes against a mocked fetch.
- [ ] **Add `store/airframeCache.ts`.** A `Map<hex, CacheEntry>` where an entry
  is `pending`, `loaded`, or `missing`. `request(hex)` returns a cached entry
  immediately or starts a fetch. **Cache misses too** - without that, reselecting
  an aircraft with no airframe record refetches a known 404 every time.
  **Done when:** a second request for a loaded or missing hex issues no network
  call.
- [ ] **Add in-flight deduplication.** Concurrent requests for the same hex share
  one promise, so rapid reselect cannot fire duplicates.
  **Done when:** three overlapping requests for one hex produce exactly one fetch.
- [ ] **Add a retry path for `error` only.** A transient network failure may be
  retried on reselect; `missing` never retries. Distinguishing these is the whole
  point of the three-state result.
  **Done when:** an errored entry refetches on reselect and a missing one does
  not.
- [ ] **Treat `fetch_failed: true` as missing-with-retry.** SkySpy sets it when
  its own upstream enrichment failed, which is transient in a way a 404 is not.
  **Done when:** a response with `fetch_failed` is not cached as a permanent
  miss.

## Files / areas

- `src/api/airframes.ts`, `src/api/airframes.test.ts`
- `src/store/airframeCache.ts`, `src/store/airframeCache.test.ts`
- `src/types/airframe.ts`

## Data / contracts

**Use `/api/v1/airframes/{icao_hex}/` alone.** Its media fields already carry the
photo, so also calling `/airframes/{icao}/photos/` doubles requests for the same
image. Add the photos endpoint only if the live instance turns out to populate it
when the parent does not - check once, then pick one.

**Lazy, per-selection only.** Nothing is fetched for the fleet. Identity is only
ever displayed one aircraft at a time, and fetching for hundreds of live aircraft
would hammer the server for data nobody sees.

404 is a normal outcome. Military, private, and newly-registered aircraft are
routinely absent.

The cache is session-scoped in memory. No persistence in this feature.

## Testing

- `fetchAirframe`: found, 404, network error, 5xx, auth header present when
  configured.
- Cache: hit avoids refetch; miss is cached; error retries on reselect;
  `fetch_failed` is not a permanent miss; concurrent requests dedupe to one fetch.

## Notes for the AI

- No UI in this feature. It ends with a tested client and cache and nothing
  visible - that is intentional and keeps feature 13 a pure presentation step.
- Do not wire fetching into the map layer. The only trigger is selection, added
  in feature 13.
- Feature 03's probe recorded whether this instance actually populates airframe
  data. Re-read `docs/fixtures/NOTES.md` before starting; if enrichment is
  unavailable, raise it before building features 13-15 on top.
