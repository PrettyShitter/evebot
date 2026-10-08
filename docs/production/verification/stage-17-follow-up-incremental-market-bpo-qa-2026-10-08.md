# Stage 17 follow-up — keep market BPO analysis incremental

Date: 2026-10-08 (Asia/Ho_Chi_Minh). A saved regional snapshot exposed a startup stall: 4,867 recipes and 328,233 hub orders produced hundreds of eligible market-BPO roots, and full chain optimization ran synchronously as part of the first app state. The renderer stayed on “Подготовка портфеля…” beyond 25 seconds.

## Changes

- Reuse immutable per-facility material ask books across run-count estimates instead of rebuilding them for every chain planner invocation.
- Calculate material-depth run boundaries directly with the exact rounded material formula. The previous implementation repeatedly constructed complete estimates during binary search for every market order tier; this was the dominant source of the scan delay.
- Return owned-blueprint results first. Then evaluate 32 eligible market BPOs per regular app-state refresh, merging results without discarding earlier offers. No candidate shortlist cap remains; the UI reports the full discovered count and progress.
- Score every distinct run count around all material and output market-depth breakpoints. The existing planner's search-state guard still returns review if a dependency chain itself is too complex to verify.
- Exercise the production path in the non-DEMO Electron app with an isolated copy of the saved public market database plus synthetic local wallet/profile/facility/blueprint and market orders. This verifies the normal production path without touching the user's account or app database; the separate packaged test exercises live public ESI.

## Verification

| Check | Result |
|---|---|
| Full saved-market non-DEMO Electron benchmark, 3 repeats | PASS — 404,495 regional orders, including 328,239 Jita/Perimeter orders; 4,867 recipes; 644 eligible market BPOs; 26 production offers including Rifter. Cold production summary 0.58–0.65 s; a later refresh evaluated 32 BPOs in 195–226 ms; renderer timer gap 17–18 ms; local ROI filter update 44–57 ms. |
| `pnpm verify:all` | PASS — lint, typecheck, 21 integration files / 105 tests, 13 unit files / 38 tests, build, and 4 desktop E2E tests. Saved-market, live-ESI, and packaged E2E are opt-in and run separately. |
| `pnpm test:e2e:live` | PASS — isolated non-DEMO Electron app against public ESI (13.2 s). |
| macOS arm64 `electron-builder --mac dir --publish never` + `pnpm test:e2e:packaged:mac` | PASS — packaged non-DEMO app against public ESI (20.9 s); ad-hoc signed, not notarized. |

The isolated production UI capture is [saved here](./screenshots/stage-17-production-non-demo.png). It shows the regular non-DEMO portfolio surface and calculated offers; its wallet and character data are synthetic test fixtures.

## Remaining acceptance limits

Market BPO evaluation completes incrementally while the app's normal state refresh runs; a 644-candidate snapshot takes about 21 refresh cycles at the current three-second interval. Private assets, blueprints, jobs, wallet reconciliation, the user's actual industry/reprocessing preview, and Developer ID signing/notarization remain unverified. The main character must authorize the documented read-only production scopes before those account-specific checks can run.
