# Current Feature

Feature 1 - Project scaffold

## Status

In Progress

Spec: blueprint/context/current-feature.md. Build plan item 1 of 15.
Branch feature/project-scaffold, not created yet.

## Goals

- Vite + React + TypeScript app overlaid onto this repository
- ESLint + Prettier, Vitest with one passing test
- One verify script: typecheck, tests, build
- Validated env config in src/config.ts, with .env.example
- Commands section of AGENTS.md updated to the real commands

## Notes

- No application code exists yet. Everything so far is planning and workflow setup.
- Auth transport is settled: token via Sec-WebSocket-Protocol, no query-string fallback.
- Blueprint files are committed (not local-only). Adapters in use: claude + codex.
- Nothing has been pushed. No remote is configured.

## History

- Project setup and boilerplate cleanup
- Researched the SkySpy WebSocket and REST API, wrote docs/flight-map-plan.md
- Adopted Flightradar24 as the UX reference; moved the selected-aircraft trail into v1
- Planned v2 aircraft identity and photos from /api/v1/airframes/{icao_hex}/
- Wrote 15 feature specs to context/features/
- Filled blueprint/project-plan.md and blueprint/build-plan.md, then ran /overview
- Ran /feature: spec for feature 1 written to blueprint/context/current-feature.md
- Replaced 221 em dashes, en dashes and ellipses across 19 generated markdown files
- Recomputed the overview plan fingerprint after that punctuation pass
- Created root .gitignore before any git operation
- Ran /onboard: kept Efficient review style, chose to commit Blueprint files
- Created the initial commit chore: scaffold application on master
