# Stage 8 follow-up — market UI latency, live ESI, and packaged macOS QA

Date: 2026-10-08 (Asia/Ho_Chi_Minh). This report covers the current source tree and does not claim private-account or final release acceptance.

## Change and diagnosis

The previous performance test could pass after finding only the table header; it did not require any real opportunity rows. It also launched the previously built `dist` app, so edits to the worker were not represented until a build ran. The benchmark now seeds the full saved ESI snapshot before starting its timer, requires an actual opportunity button, and records worker state-section timings. It retains the 300 ms interaction limit.

Market filter changes repeatedly caused the expensive Production summary to be rebuilt even though the filter did not change production data. State responses now reuse that summary for up to five seconds, invalidate it for production, wallet, character, market, and static-data changes, and check SQLite `PRAGMA data_version` so writes made by another connection cannot leave the summary stale. Production actions still rebuild the summary before returning their result.

## Verification

| Check | Result |
|---|---|
| `pnpm verify:all` | PASS — eslint, typecheck, 100 default Vitest tests, 38 unit tests, production build, and 4 standard E2E tests. Three opt-in tests are skipped by the default command. |
| `EVE_BENCHMARK=1 pnpm exec playwright test tests/e2e/performance.spec.ts --repeat-each=3` | PASS — all three runs contained actual offer rows from a saved regional snapshot of 404,495 orders (328,233 orders across 34 Jita/Perimeter stations). ROI UI update: 43.0, 61.4, 64.3 ms; worker filter response: 9.3, 9.9, 10.0 ms; renderer timer gap: 17.2–18.1 ms. Cold-state total: 2.1–2.4 s; full market rescan: 1.4–1.6 s. Warm cached reads: 1–4 ms. |
| `pnpm test:e2e:live` | PASS — current non-DEMO Electron loaded public Tranquility ESI, checked Jita/Perimeter facilities, system indices, contract coverage, filters, and facility-evidence gate (16.3 s). Isolated temporary profile; no GitHub updater or user-account writes. |
| `pnpm exec electron-builder --mac dir --arm64 --publish never` | PASS — current macOS arm64 app bundle generated under `release/mac-arm64`. Ad-hoc signed; notarization unavailable without Developer ID. |
| `pnpm test:e2e:packaged:mac` | PASS — freshly packaged app launched in an isolated profile and loaded public ESI (14.6 s). |
| v11→v12 populated SQLite migration | PASS — old trade and production contract preserved; BPC confirmation validation, cascade, integrity and foreign keys verified on a disposable database. |
| BPC contract detail confirmation | PASS — exact item confirmation, evidence/timestamp persistence, stale/mismatched item rejection, ESI-over-manual conflict handling, and `quantity=-2` single-copy normalization are covered by unit/integration and desktop restart E2E. |
| Installed user app and database | Left untouched. DEV and packaged tests used fresh temporary profiles. |

Screenshots: [packaged 1280×800](../../../test-results/production-packaged-1280x800.png), [packaged 1440×900](../../../test-results/production-packaged-1440x900.png), [live DEV 1280×800](../../../test-results/production-live-1280x800.png), [live DEV 1440×900](../../../test-results/production-live-1440x900.png). The live public state has populated public contracts and facility/index data, but no private character inventory or project data.

## Remaining acceptance gates

Private ESI profile QA remains blocked because the main character has not yet been reauthorized for the production read scopes. The app cannot honestly validate the user's actual skills, Alpha state, assets, blueprints, jobs, or personal contracts until those scopes are approved. In-game manufacturing/reprocessing fee and yield comparisons also need user-provided game-preview evidence. Real-account multi-copy matching, procurement/transport duration, Windows smoke, and notarized distribution remain open. No real ISK was spent and no jobs were started.
