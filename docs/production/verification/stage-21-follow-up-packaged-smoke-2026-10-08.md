# Stage 21 follow-up: packaged macOS smoke-test lifecycle

Date: 2026-10-08 (Asia/Ho_Chi_Minh)

## Finding

GitHub Actions run `37719105544` on `d692757` passed `pnpm verify:all` and both platform builds; Windows packaged smoke passed. The macOS packaged smoke reached the tray hide/show assertions and timed out after three minutes while asking Playwright to evaluate `app.quit()` directly. The local packaged app did not reproduce the timeout.

## Change

The smoke test now schedules graceful `app.quit()` on the next event-loop turn, after the Playwright evaluation can return. This preserves the app's normal `before-quit` cleanup and keeps the restart/persistence assertion intact. Added progress messages around tray close, show, quit, and restart to make any future hang identifiable.

## Verification

| Check | Result |
|---|---|
| `node scripts/packaged-smoke.mjs` before the change, local macOS arm64 package | PASS; tray hide/show, quit, restart, saved settings |
| `node scripts/packaged-smoke.mjs` after the change, local macOS arm64 package | PASS; tray hide/show, graceful quit, restart, saved settings |
| `pnpm verify:all` after the change | PASS; lint, typecheck, 106 integration, 38 unit, 4 E2E; 3 dedicated live/performance/package tests are intentionally separate |
| `pnpm test:e2e:live` on current source | PASS; public ESI, non-DEMO Electron, isolated profile, 16.1 s |
| GitHub Actions retry after this change | Pending |

## Remaining acceptance gate

The installed user database and three existing character links were not modified. Private ESI validation and in-game Industry/Reprocess comparison still require the primary character's consent to the read-only production scopes and user-provided game-preview values. The current branch's dev app is open with public ESI data in `/tmp/eve-trader-production-dev`; it is isolated from the installed profile.
