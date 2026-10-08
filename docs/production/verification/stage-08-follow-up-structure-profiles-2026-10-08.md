# Stage 08 follow-up: product-specific structure manufacturing

Date: 2026-10-08. Scope: save and apply manually confirmed Upwell manufacturing parameters by output type, keep missing/stale data in review, and verify the production tab in non-DEMO Electron and the packaged macOS app.

## Changes

- Public Production synchronization now starts automatically in non-DEMO mode, including when there is no connected character. If the initial three-wallet sync fails, public Production sync still follows it. The tab displays whether ESI is syncing, when public data was last updated, or the latest error.
- A contract with exactly one known BPC remains eligible when it also contains other included items. The estimate charges the full bundle price, conservatively gives no resale credit for unmodeled extras, and shows the bundle size. Multi-BPC contracts remain excluded until their run and cost allocations are modeled.
- Added SQLite migration 011 with a `production_structure_product_profiles` table keyed by structure and output type. It records the system-cost multiplier, effective material/time reductions, sell-order fee, evidence, and observation time.
- Extended the facility profile form with a searchable SDE product picker and explicit structure tax/bonus/fee inputs. Structure values are validated and are not guessed from public ESI. Saving a structure profile preserves existing reprocessing values.
- Manufacturing estimates now accept structure-specific parameters, use output sell orders at the selected facility, and leave the quote in review when its profile is missing or older than seven days. Structure chain intermediates remain buy-only unless separately modeled; NPC bonuses are never inherited.
- Removed duplicate read-only scopes from the seller OAuth request. A live EVE SSO character-selection URL confirmed that the request now contains each required and optional scope once.
- Added persistent-profile and structure fee calculation assertions; raised database migration tests to schema version 11.

## Verification

| Command | Result |
|---|---|
| `pnpm verify:all` | PASS; eslint, typecheck, 98 default Vitest tests, 37 explicit unit tests, build, and standard E2E (3 passed; 3 opt-in skipped) |
| `pnpm test:e2e:live` | PASS; non-DEMO Electron fetched public ESI automatically on launch in 24.6 seconds, then exercised filters, facility-profile gates, and layout without SSO or GitHub |
| `pnpm exec electron-builder --mac dir --arm64 --publish never` | PASS; local arm64 app packaged with ad-hoc signing; notarization unavailable without Developer ID |
| `pnpm test:e2e:packaged:mac` | PASS; packaged app fetched live public ESI without GitHub or DEMO mode (15.7 seconds) |
| `pnpm test:integration` after mixed-contract coverage | PASS; 13 files / 37 tests, including full bundle cash cost and single-BPC eligibility |
| OAuth request inspection | PASS; no duplicate scope IDs in the live SSO request; the selected main character is waiting at the user authorization step |
| `git diff --check` | PASS |

## Limits

The live runs used isolated app profiles and public ESI. One earlier auto-start assertion timed out because background errors were hidden and startup progress was not exposed; this was corrected with visible sync status/error state, and the rerun passed. Private character scopes, accessible structure books, and the user's in-game Industry and sell-order fee previews are still unverified. The structure calculation path is implemented and fixture-tested, but it cannot be called validated for this character until those real inputs are synchronized and compared in game. Forecast timing still excludes procurement, hauling, delivery, and passive sale wait.
