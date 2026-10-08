# Stage 29 follow-up — ESI race ID and private profile sync

Date: 2026-10-08 (Asia/Ho_Chi_Minh).

## Issue and fix

Private sync failed in the live dev app with `Invalid input: expected string, received undefined` at `race`. The public character endpoint returns numeric `race_id`; it does not return the UI-ready `race` name. The ESI OpenAPI schema documents `race_id` as an integer field ([CCP ESI OpenAPI](https://esi.evetech.net/meta/openapi.json?compatibility_date=2026-08-18)). The profile importer now accepts that API shape and maps the four empire race IDs used by Alpha skill caps. Unknown or absent IDs stay `null`, so they cannot incorrectly apply race-specific caps or block importing the other profile data.

Added `tests/unit/portfolio-profile.test.ts`, which reproduced the exact live error before the fix and now asserts `race_id: 1` maps to `Amarr`. Added an opt-in private live E2E test that uses a locally authorized non-demo profile without printing its contents or modifying EVE state.

## Verification

| Check                                            | Result                                                                                                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Regression test before fix                       | FAILS with the same Zod `race` error seen in the live app.                                                                                                        |
| Regression test after fix and `pnpm typecheck`   | PASS.                                                                                                                                                             |
| `pnpm verify:all all`                            | PASS — lint, typecheck, 112 unit tests, 38 integration tests, build and 4 standard desktop E2E tests. Four opt-in E2E tests were skipped by the aggregate runner. |
| Authorized private ESI sync in non-demo Electron | PASS — repeatable opt-in test completed in 16.2 s; private production profile updated, Alpha skills were nonzero, and the race validation error did not recur. |
| `pnpm test:e2e:live`                             | PASS — public live ESI and production UI, 13.6 s.                                                                                                                 |
| `pnpm test:e2e:packaged:mac`                     | PASS — packaged non-demo app and public live ESI, 16.9 s.                                                                                                         |
| GitHub Actions at `b7fe707`                     | PASS — [run `37728021174`](https://github.com/PrettyShitter/evebot/actions/runs/37728021174) completed on macOS and Windows, including full verification, packaging, and packaged smoke. |

To repeat the private-profile check with a locally authorized dev profile, run `EVE_PRIVATE_LIVE_TEST=1 EVE_PRIVATE_USER_DATA=/path/to/local/profile pnpm exec playwright test tests/e2e/production-private-live.spec.ts`. The test syncs ESI data into that local profile database; it performs no in-game actions.

## Still open

The feature is not fully accepted yet. Compare manufacturing tax and reprocessing output against the user's in-game Industry/Reprocess preview. Real structure access and structure order feeds also need a profile the user has verified in-game. Private project reconciliation is now reachable after sync, but contracts and ambiguous journal allocations still require account-specific review. The installed app remains 0.1.29: a real update to 0.1.30 rolled back when the market calculation exceeded the updater's startup health window. The database was restored; the fix and retest are tracked in [stage 30](./stage-30-in-app-update-slow-start-rollback-qa-2026-10-08.md). The custom updater verifies a signed release manifest and does not require Developer ID; a clean browser install remains ad-hoc signed and may be blocked by Gatekeeper.
