# Stage 8 follow-up — market UI latency, live ESI, and packaged macOS QA

Date: 2026-10-08 (Asia/Ho_Chi_Minh). This report covers the current source tree and does not claim private-account or final release acceptance.

## Change and diagnosis

The previous performance test could pass after finding only the table header; it did not require any real opportunity rows. It also launched the previously built `dist` app, so edits to the worker were not represented until a build ran. The benchmark now seeds the full saved ESI snapshot before starting its timer, requires an actual opportunity button, and records worker state-section timings. It retains the 300 ms interaction limit.

Market filter changes repeatedly caused the expensive Production summary to be rebuilt even though the filter did not change production data. State responses now reuse that summary for up to five seconds, invalidate it for production, wallet, character, market, and static-data changes, and check SQLite `PRAGMA data_version` so writes made by another connection cannot leave the summary stale. Production actions still rebuild the summary before returning their result.

## Verification

| Check | Result |
|---|---|
| `pnpm verify:all` | PASS — eslint, typecheck, 99 unit tests, 37 integration tests, production build, and 3 standard E2E tests. Three opt-in tests are skipped by the default command. |
| `EVE_BENCHMARK=1 pnpm exec playwright test tests/e2e/performance.spec.ts --repeat-each=3` | PASS — all three fresh-build runs contained actual offer rows from a saved regional snapshot of 404,495 orders (328,233 orders across 34 Jita/Perimeter stations). ROI UI update: 74.6, 127.0, 75.9 ms; worker filter response: 17.2, 20.4, 17.8 ms; renderer timer gap: 23.3, 28.8, 25.0 ms. Eight candidates before the ROI filter; three after ROI 30%. |
| Cold/warm calculation | PASS — cold state initialization took 5.3–6.0 s including roughly 1.4–1.9 s for the Production summary and 3.5–4.2 s for the full regional scan; subsequent cached state responses were about 2–9 ms inside the worker. A deliberate full rescan ran in a worker while renderer timer gaps stayed below 34 ms. |
| `pnpm test:e2e:live` | PASS — current non-DEMO Electron loaded public Tranquility ESI, checked Jita/Perimeter facilities, system indices, contract coverage, filters, and facility-evidence gate (18.4 s). At 1280×800 and 1440×900, the page had no horizontal overflow. Isolated temporary profile; no GitHub updater or user-account writes. |
| `pnpm exec electron-builder --mac dir --arm64 --publish never` | PASS — current macOS arm64 app bundle generated under `release/mac-arm64`. Ad-hoc signed; notarization unavailable without Developer ID. |
| `EVE_PACKAGED_TEST=1 pnpm exec playwright test tests/e2e/production-packaged.spec.ts` | PASS — freshly packaged app launched in an isolated profile, loaded public ESI, and captured 1280×800 and 1440×900 screenshots (18.0 s); neither viewport had horizontal overflow. |
| Installed user app and database | Left untouched. DEV and packaged tests used fresh temporary profiles. |

Screenshots: [packaged 1280×800](../../../test-results/production-packaged-1280x800.png), [packaged 1440×900](../../../test-results/production-packaged-1440x900.png), [live DEV 1280×800](../../../test-results/production-live-1280x800.png), [live DEV 1440×900](../../../test-results/production-live-1440x900.png). The live public state has populated public contracts and facility/index data, but no private character inventory or project data.

## Remaining acceptance gates

Private ESI profile QA remains blocked because the main character has not yet been reauthorized for the production read scopes. The app cannot honestly validate the user's actual skills, Alpha state, assets, blueprints, jobs, or personal contracts until those scopes are approved. In-game manufacturing/reprocessing fee and yield comparisons also need user-provided game-preview evidence. Multi-BPC contract-bundle cost allocation, procurement/transport duration, Windows smoke, and notarized distribution remain open. No real ISK was spent and no jobs were started.
