# Stage 08 follow-up: live filter and packaged QA

Date: 2026-10-08. Scope: production live E2E filter assertions, structure-estimate reason clarity, full regression and current macOS arm64 packaged app.

## Changes

- The live E2E test now reads the native `<option disabled>` property directly. Playwright's generic disabled assertion treated a disabled `<option>` as enabled even though the rendered DOM property was `true`.
- The test verifies the slot-hour sort is unavailable for reprocessing and becomes available again for manufacturing.
- Structure manufacturing remains gated and now reports one precise reason for the unimplemented structure fee/bonus model.
- The Production UI now discloses a conflict between CCP Viridian's 0.25% Alpha industry surcharge and the February 2026 Alpha support page's 2% value. The estimate is explicitly labeled unverified until compared with the in-game Industry window.
- Scope coverage now includes wallet, skills, skill queue, standings and character orders in addition to assets, blueprints, jobs and contracts. The exact missing scope IDs are shown in the tab and asserted by the live E2E test.

## Verification

| Command | Result |
|---|---|
| `pnpm test:e2e:live` | PASS; 1 test, live public ESI through a non-demo local Electron app; scope diagnostics and Alpha-tax uncertainty are asserted |
| `pnpm exec vitest run tests/integration/production-sync.test.ts` | PASS; 1 test confirms token-scope coverage reporting |
| `pnpm verify:all` | PASS; eslint, typecheck, 97 default Vitest tests, 37 explicit unit tests, build and standard E2E (3 passed; 3 opt-in tests skipped) |
| `pnpm exec electron-builder --mac dir --arm64 --publish never` | PASS; artifact at `release/mac-arm64/EVE Trader.app`; ad-hoc signing, notarization unavailable without Developer ID |
| `pnpm test:e2e:packaged:mac` | PASS; packaged app starts and reads live public ESI without GitHub |
| `git diff --check` | PASS |

## Limits

This verifies public ESI and UI behavior, not private character data. Private ESI checks remain blocked until the main character grants the production scopes in `SSO_SETUP.md`. Structure fee/rig models and in-game fee/reprocessing comparisons remain open acceptance items; no fixture is presented as live game evidence. CCP's current support article and expansion notes conflict on the Alpha tax; the UI surfaces that conflict rather than hiding it.
