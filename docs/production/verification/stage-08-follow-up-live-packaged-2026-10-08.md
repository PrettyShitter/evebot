# Stage 8 follow-up — live ESI and packaged macOS QA

Date: 2026-10-08 (Asia/Ho_Chi_Minh). This report adds public live-ESI and packaged macOS evidence; it does not claim private-account or full release acceptance.

## Checks

| Check | Result |
|---|---|
| `pnpm verify:all` | PASS — lint, typecheck, unit suite 93 tests, integration suite 37 tests, production build, and 3 normal E2E tests. The performance benchmark and opt-in live ESI cases are intentionally skipped by this command. |
| Contract-acquisition regression | PASS — 20 targeted unit/integration assertions cover unique completed-contract matching, cached listing removal, full contract cash vs per-run cost, and actual output-lot cost/partial-sale PnL. |
| `pnpm test:e2e:live` | PASS — non-DEMO Electron built from current source loaded public Tranquility ESI, verified facilities, system indices, contracts panel, filters and facility-evidence gate (11.3 s). |
| `pnpm exec electron-builder --mac dir --arm64 --publish never` | PASS — regenerated `release/mac-arm64/EVE Trader.app` from the current source; ad-hoc signed and not notarized. |
| `pnpm test:e2e:packaged:mac` | PASS — launched the freshly regenerated `.app` with a separate temporary profile, GitHub updater disabled, loaded public ESI and captured 1280×800 and 1440×900 screenshots (17.8 s). |
| `EVE_BENCHMARK=1 pnpm exec playwright test tests/e2e/performance.spec.ts` | PASS — demo-fixture renderer/filter responsiveness: UI filter 225 ms, worker filter 173 ms, max renderer timer gap 18.2 ms. The fixture had 0 trade offers before/after, so this validates responsiveness only and does not benchmark populated Production offers. |
| Installed user app / database | PASS for non-interference — the installed app remained open and its 2.8 GB database was not changed by these tests. |
| Contract purchase accounting | PASS in fixtures — a finished personal contract joined to its cached public listing and owned BPC retains price/runs after the listing disappears. Full contract ISK is launch cash; used runs receive their proportional cost in project PnL. Ambiguous/uncached cases stay unmatched. |
| Numeric ESI contract price | PASS — regression test confirms lossless parsing of ESI's numeric contract price into an exact decimal string. |
| Private character profile, blueprints, jobs, assets; in-game preview comparison | BLOCKED — the current main-character token does not grant the four new production read-only scopes. The app now refreshes the displayed scope list from the encrypted token and offers a reconnect action. No EVE purchase or manufacturing job was performed. |

Screenshots: [packaged 1280×800](../../../test-results/production-packaged-1280x800.png), [packaged 1440×900](../../../test-results/production-packaged-1440x900.png), [live source 1280×800](../../../test-results/production-live-1280x800.png), [live source 1440×900](../../../test-results/production-live-1440x900.png). These are public-only empty project states; they do not replace populated private-account visual QA.

## Known live gate

In the app, reconnect the main character and approve the read-only scopes `esi-assets.read_assets.v1`, `esi-characters.read_blueprints.v1`, `esi-industry.read_character_jobs.v1`, and `esi-contracts.read_character_contracts.v1`. Then run “Обновить данные ESI”. Private ESI QA can continue only after that consented refresh succeeds. Structure market access remains optional and requires its separate scope and actual in-game access.
