# Stage 17 follow-up — keep market BPO analysis incremental

Date: 2026-10-08 (Asia/Ho_Chi_Minh). A saved regional snapshot exposed a startup stall: 4,867 recipes and 328,233 hub orders produced hundreds of eligible market-BPO roots, and full chain optimization ran synchronously as part of the first app state. The renderer stayed on “Подготовка портфеля…” beyond 25 seconds.

## Changes

- Reuse immutable per-facility material ask books across run-count estimates instead of rebuilding them for every chain planner invocation.
- Return owned-blueprint results first. Then evaluate one of the 40 cheapest eligible market BPOs per regular app-state refresh and merge each result into the existing list. The UI shows candidates checked, total shortlist size, completion, and whether eligible BPOs remain outside the 40-item shortlist.
- Bound each market-BPO quote to four batch-size breakpoints. Owned-blueprint optimization retains its existing deeper run-count search.
- Exercise the production path in the full regional benchmark by seeding a confirmed Jita facility, fresh profile, owned Rifter BPO, and executable Rifter orders into an isolated copy of the saved database. The test verifies the offer is calculated and visible in the actual Electron renderer.

## Verification

| Check | Result |
|---|---|
| Full saved-market Electron benchmark, 3 repeats | PASS — 404,495 regional orders, including 328,239 Jita/Perimeter orders; 4,867 recipes; production Rifter offer visible. Initial state/trade scan 3.2–3.6 s; subsequent state evaluated another market BPO in 2.2–2.4 s; renderer timer gap 18–19 ms; local ROI filter update 45–60 ms. |
| `pnpm verify:all` | PASS — lint, typecheck, 21 integration files / 105 tests, 13 unit files / 38 tests, build, and 4 desktop E2E tests. The saved-market, live-ESI, and packaged E2E tests are opt-in and were run separately. |
| `pnpm test:e2e:live` | PASS — isolated non-demo Electron app against public ESI (16.1 s). |
| macOS arm64 `electron-builder --mac dir --publish never` + `pnpm test:e2e:packaged:mac` | PASS — packaged non-demo app against public ESI (20.9 s); ad-hoc signed, not notarized. |

## Remaining acceptance limits

The calculation remains partial while the 40-item market-BPO shortlist is evaluated and it deliberately leaves higher-priced eligible BPOs untested. Private assets, blueprints, jobs, wallet reconciliation, the user's actual industry/reprocessing preview, and Developer ID signing/notarization remain unverified. The main character must authorize the documented read-only production scopes before those account-specific checks can run.
