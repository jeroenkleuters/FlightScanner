# Fixtures

Real captured API responses, committed so tests and the mock server replay
something the live API actually returned rather than something invented.

## opensky-states-nl.json

- **Source:** `GET https://opensky-network.org/api/states/all`
- **Bounding box:** `lamin=50.5 lomin=3.0 lamax=53.8 lomax=7.3`, roughly the
  Netherlands and the Belgian and German border regions
- **Captured:** 2026-09-13, anonymously, no credentials
- **Contents:** 149 state vectors, one snapshot

State vectors are positional arrays, not objects:

```text
[icao24, callsign, origin_country, time_position, last_contact, lon, lat,
 baro_alt, on_ground, velocity, true_track, vertical_rate, sensors, geo_alt,
 squawk, spi, position_source]
```

Note that `lon` comes before `lat`, which is the reverse of how the rest of this
project orders them. Real aircraft in this capture have null fields, so it
exercises the guarded reads rather than a tidy happy path.
