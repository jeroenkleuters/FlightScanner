# Fix: Default view ignores the bounding box

**Type:** Fix

**Status:** verified

**Branch:** `fix/default-view-ignores-the-bounding-box`

## The problem

Two separate things are wrong with the Vercel deployment. Only one of them is a
code defect, and they need to be kept apart.

### 1. The map opens nowhere near the traffic (this fix)

`src/config.ts` declares `DEFAULT_CENTER = { lat: 0, lon: 0 }` and
`DEFAULT_ZOOM = 6`, while `DEFAULT_BOUNDING_BOX` is hard-coded to
`50.5, 3.0, 53.8, 7.3` - the Netherlands. The polled region and the default view
are two unrelated constants that happen to sit in the same file.

`VITE_DEFAULT_CENTER=52.3676,4.9041` only papers over it locally, and it lives
in `.env`, which is gitignored. Nothing carries it to Vercel, so a deployment
with no `VITE_` variables set opens at latitude 0, longitude 0 - the Gulf of
Guinea, about 5,800 km from the only box the app ever queries. The aircraft are
fetched correctly and drawn correctly, off-screen.

This is a real defect rather than a missing setting: the app polls one fixed box
that the camera can never change, so an out-of-the-box view that does not show
that box is simply wrong. It should not be possible to configure it into
correctness.

### 2. The backend is unreachable, and that is not a code defect

Every path on every alias of the Vercel project answers `302` to
`https://vercel.com/sso-api?...`, including the production alias:

| URL | Result |
| --- | --- |
| `.../api/opensky/states?lamin=...` | 302 to Vercel SSO |
| `.../api/health` | 302 to Vercel SSO |
| `.../` | 302 to Vercel SSO |
| `flightscanner-jeroenkleuters-9584s-projects.vercel.app/api/health` | 302 to Vercel SSO |
| `flightscanner-git-master-...vercel.app/api/health` | 302 to Vercel SSO |

That is Vercel **Deployment Protection** (Vercel Authentication), a project
setting. The functions never run, so nothing in this repository can fix it and
no build step here should try. Turning it off, or issuing a protection-bypass
token, is a dashboard action and belongs to `/release`.

Ruled out while diagnosing, so nobody re-checks them:

- The OpenSky credentials in `.env` are valid: the real token endpoint returns
  `200` with a token, both as-is and de-quoted.
- `.env` is gitignored and untracked, so no credential is committed.
- `vercel.json`, both function entrypoints, and the non-`/api/` rewrite all read
  correctly.

**The proxy's actual health on Vercel is therefore still unverified.** Protection
blocked every request, so a second, real backend fault could be hiding behind it.
Finding out requires reaching a function once, which needs the setting changed
first.

## The fix

Derive the default view from the box the app actually polls, and keep the
environment variables as overrides rather than as the only correct answer.

- Compute the default centre from `DEFAULT_BOUNDING_BOX` rather than declaring
  an unrelated constant, so changing the box moves the camera with it and the
  two can never drift apart again.
- Set a default zoom that frames that box rather than the current 6.
- `VITE_DEFAULT_CENTER` and `VITE_DEFAULT_ZOOM` keep working exactly as they do
  now, and still win when set.

Must not break:

- `src/config.ts` stays the only reader of `import.meta.env`.
- The existing parser behaviour, error messages, and validation ranges are
  unchanged; this only changes what the fallbacks are.
- `src/config.test.ts` pins `DEFAULT_CENTER` and `DEFAULT_ZOOM`, and
  `vite.config.ts` pins `VITE_DEFAULT_CENTER=0,0` and `VITE_DEFAULT_ZOOM=6` for
  the test environment. Both are deliberate and must keep passing, updated only
  where they assert the old fallback values.

Out of scope: the Vercel protection setting, any deploy, and any change to the
bounding box itself.

## Build steps

- [x] 1. **Derive the default view from the polled box.**
  In `src/config.ts`, replace the standalone `DEFAULT_CENTER` constant with the
  centre of `DEFAULT_BOUNDING_BOX`, and set `DEFAULT_ZOOM` to a value that frames
  that box at a typical window size. Keep both exported under their current
  names so nothing else has to change. Update `src/config.test.ts` where it
  asserts the old values, and add a test tying the two together: the default
  centre must fall inside `DEFAULT_BOUNDING_BOX`.
  **Done when:** `npm run verify` passes, and a test fails if someone moves the
  box without moving the camera.

## Verify

1. `npm run verify` passes.
2. `npm run mock` and `npm run dev`, then open http://localhost:5173 **with
   `VITE_DEFAULT_CENTER` and `VITE_DEFAULT_ZOOM` commented out of `.env`**: the
   map opens over the Netherlands with aircraft in view, not on empty ocean.
3. Restore the two variables and reload: the map honours them, proving the
   override path still works.
4. Not part of this fix, and yours to do: in the Vercel dashboard, Settings ->
   Deployment Protection, disable Vercel Authentication (or add a bypass), then
   re-test `/api/health`. It must return the health payload rather than a 302,
   before the deployed backend can be called working.

## Verification state

`npm run verify` (typecheck, 342 tests in 23 files, build) and `npm run lint`
both pass. Four new tests cover the default view.

The regression guard was checked by reintroducing the bug rather than assumed:
setting `DEFAULT_CENTER` back to a literal `{ lat: 0, lon: 0 }` failed both
"opens inside the box the app actually polls" and "sits at the middle of the
box", and restoring the derivation passed them again.

Verify steps 2 and 3 were then observed in a browser, by reading the running
map's own camera rather than trusting the build. Rather than edit the
developer's `.env`, a second dev server was started with `VITE_DEFAULT_CENTER`
and `VITE_DEFAULT_ZOOM` blanked in the process environment, which Vite gives
precedence over `.env` and which `optionalString` treats as absent - the same
state a Vercel build with no `VITE_` variables produces.

| Case | `map.getCenter()` / `getZoom()` |
| --- | --- |
| Defaults, overrides blanked | **52.15, 5.15 at zoom 7** - exactly `centreOf(DEFAULT_BOUNDING_BOX)` |
| With the developer's `.env` | 52.3676, 4.9041 at zoom 7 - the override still wins |

A screenshot of the defaults case shows the Netherlands filling the viewport
with 28 aircraft and the legend in place. Before this change the same case
opened at 0, 0 and zoom 6. No console errors in either run.

Step 4 is the Vercel dashboard action and remains the user's. It is not done,
and nothing here should be read as evidence that the deployed backend works.


<!-- blueprint:completion {"schemaVersion":1,"specBytes":6701,"specSha256":"389bab3247b8239fba00ae08646470c892fc0c95606e7f58e7bf89e70fcf661d","branch":"refs/heads/fix/default-view-ignores-the-bounding-box","head":"9e3b033ba9ced021152b5247c835c047b7ff2503","baseRef":"refs/heads/master","baseCommit":"9e3b033ba9ced021152b5247c835c047b7ff2503","sourceTree":"cc95e348d21c3b92a1dbe6b16a5e7ee14a92fb25","absentOptional":[]} -->
