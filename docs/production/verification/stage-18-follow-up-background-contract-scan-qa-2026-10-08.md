# Stage 18 follow-up — background BPC contract scan and packaged QA

Date: 2026-10-08 (Asia/Ho_Chi_Minh).

## Changes

- Public BPC contract candidates now use batches of eight groups per app-state refresh, alongside the 32-candidate market-BPO batch. Previously calculated offers are retained while the scan continues.
- The Production tab displays BPC scan progress separately from the market-BPO progress and distinguishes an empty, still-scanning list from a completed scan with no eligible contracts.
- The full-market Electron benchmark now seeds 24 known BPC contract groups and waits for both scanners to finish, exercising the same incremental state refresh path as the app.
- The integration test waits for the one-second production-summary cache to expire between refreshes before asserting that background work advances.

## Verification

| Check | Result |
|---|---|
| `pnpm verify:all` | PASS — lint, typecheck, 105 integration tests, 38 unit tests, build, and 4 regular desktop E2E tests. The performance and live-ESI specs are opt-in and are run separately below. |
| `EVE_BENCHMARK=1 pnpm exec playwright test tests/e2e/performance.spec.ts` | PASS — 643/643 eligible market BPOs and 24/24 synthetic BPC groups scanned in 33.7 s; 26 production offers; filter request 13 ms; maximum renderer timer gap 16.8 ms. The fixture uses a saved market snapshot and synthetic local account data. |
| `pnpm test:e2e:live` | PASS — non-DEMO Electron application fetched live public ESI data without GitHub updates or private character authorization (13.2 s). |
| macOS arm64 `electron-builder --mac dir --arm64 --publish never` + `pnpm test:e2e:packaged:mac` | PASS — packaged non-DEMO application fetched live public ESI data (12.4 s). The bundle is ad-hoc signed, not notarized. |
| `node scripts/packaged-smoke.mjs` | PASS — packaged bundle integrity, startup, worker/native SQLite/migrations, settings write, tray hide/show, and restart persistence. |

## Remaining acceptance limits

Public ESI and the packaged macOS flows are verified. Private character ESI and in-game production/reprocessing formulas still cannot be certified from public market data: this environment has no current main-character authorization with the required scopes and no matching in-game Industry or Reprocess preview. Developer ID signing/notarization also remains unavailable because the user has no Apple Developer ID. The completed benchmark is fixture-backed; it does not stand in for those account-specific acceptance checks.
