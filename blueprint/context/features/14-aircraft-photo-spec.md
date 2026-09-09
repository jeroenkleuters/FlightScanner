# Feature: Aircraft photo

**From build-plan:** feature 14
**Build attempt:** 1
**Branch:** feature/14-aircraft-photo

Source: `docs/flight-map-plan.md` §9, Step 14.

## Goal

Show a photo of the selected aircraft with proper attribution - the last piece of
the Flightradar24-style detail panel.

## In scope

- Photo rendered from `photo_url` / `photo_thumbnail_url`
- Mandatory photographer and source attribution
- Fixed aspect ratio reserved before load
- Lazy loading and an error fallback
- Click to enlarge

## Out of scope

- Hosting, proxying, or caching images ourselves
- Photo galleries or multiple images per aircraft
- Uploading or editing photos

## Build loop

Implement all steps, then one review packet.

## Build steps

- [ ] **Add `ui/AircraftPhoto.tsx`** rendering `photo_thumbnail_url` in the panel
  (full `photo_url` for the enlarged view), inside a container with a **fixed
  aspect ratio reserved before the image loads**, so the panel never reflows when
  it lands.
  **Done when:** a photo appears in the panel with zero layout shift on load.
- [ ] **Render attribution with every photo.** `photo_photographer` and
  `photo_source` display visibly alongside the image. If the photographer is
  absent, show the source; **if neither exists, do not show the photo at all.**
  These images come from third parties - Planespotters and others - under their
  own licensing, and an uncredited photo is not shippable.
  **Done when:** every rendered photo carries a visible credit, and a photo with
  no attribution data is not displayed.
- [ ] **Add lazy loading and referrer policy.** `loading="lazy"`, an appropriate
  `referrerpolicy`, and `alt` text naming the aircraft type and registration.
  **Done when:** the image loads lazily and has meaningful alt text.
- [ ] **Add the error fallback.** On load failure, show a neutral placeholder
  with the aircraft type - never a broken image icon. Images load direct from
  third-party hosts rather than through SkySpy, so some will block hotlinking;
  this is the most likely thing to quietly not work.
  **Done when:** pointing the URL at an unreachable host shows the placeholder,
  and a real captured URL is verified to actually load in a browser.
- [ ] **Add the no-photo state.** When both URLs are null - common - show the
  same neutral placeholder with no error styling.
  **Done when:** an aircraft with no photo renders calmly with the rest of the
  panel intact.
- [ ] **Add click to enlarge.** Clicking opens the full `photo_url` in a modal
  with attribution repeated, closable by Esc, backdrop click, and a close button,
  with focus trapped while open and returned on close.
  **Done when:** the modal opens, shows attribution, and is fully keyboard
  operable.

## Files / areas

- `src/ui/AircraftPhoto.tsx`, `src/ui/AircraftPhoto.test.tsx`
- `src/ui/PhotoModal.tsx`
- `src/ui/AircraftDetailPanel.tsx` - photo above the identity block

## Data / contracts

Photo fields come from feature 12's already-cached `AirframeInfo`. **This feature
issues no network requests of its own** beyond the browser loading the image.

`photo_url`, `photo_thumbnail_url`, `photo_photographer`, and `photo_source` are
all nullable and frequently null.

**Attribution is mandatory, not decorative.** No credit, no photo. This is a
licensing constraint from the upstream sources, not a design preference.

Images are third-party hosted, not proxied by SkySpy. We depend on their
availability and cannot guarantee it - hence the required fallback.

## Testing

- RTL: photo renders with attribution; missing photographer falls back to source;
  neither present means no photo rendered; load error shows the placeholder; both
  URLs null shows the placeholder; modal opens, traps focus, closes on Esc.
- Manual: verify a real captured `photo_url` actually loads in a browser - the
  hotlinking risk cannot be caught by mocked tests.

## Notes for the AI

- Verify real photo URLs early in this feature, before building the modal. If
  hotlinking is blocked, the whole feature needs rethinking (a proxy), and that
  is better known on day one.
- Never render an image without its credit, including in the modal.
- Reserve the aspect ratio with CSS before load. Reflow when an image arrives is
  exactly the jump features 09 and 13 were structured to avoid.

## Open questions

- Click to enlarge: modal (specified above) or link out to the source page? The
  modal keeps users in the app; linking out gives the photographer traffic, which
  some sources' terms prefer. Confirm against the actual source's requirements.
