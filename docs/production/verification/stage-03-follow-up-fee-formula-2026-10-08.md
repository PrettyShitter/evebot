# Stage 3 follow-up — current manufacturing fee formula

Date: 2026-10-08 (Asia/Ho_Chi_Minh). This follow-up fixes a stale SCC rate found during live-requirement review; it does not close the entire stage.

## Finding and change

Manufacturing quotes used a 0.25% SCC surcharge, which CCP raised to 4% in the 2024 Version 21.06 patch. This understated NPC Alpha manufacturing fees by 3.75% of EIV, potentially overstating profit. The estimator now applies CCP's NPC formula using system index + 0.25% NPC tax + 4% SCC + 0.25% Alpha tax. Formula version is bumped so cached estimates are not mistaken for current results. Jita and Perimeter are outside the Exordium-only additional fee rule.

## Verification

| Check | Result |
|---|---|
| Regression test before fix | FAIL as expected: fixture EIV 600/index 1% calculated 10.50 ISK instead of expected 33.00 ISK. |
| `pnpm exec vitest run tests/unit/production-manufacturing.test.ts` | PASS — 8 tests; fee, total cost, and net profit assertions use the corrected amount. |
| `pnpm exec vitest run tests/integration/production-sync.test.ts -t "imports a complete production snapshot"` | PASS — token scopes are persisted and only actually missing OAuth permissions remain in AppState. |
| `pnpm typecheck` | PASS |
| `git diff --check` | PASS |

Formula sources: [CCP Viridian notes](https://www.eveonline.com/de/news/view/viridian-expansion-notes), [CCP Version 21.06 patch notes](https://www.eveonline.com/news/view/patch-notes-version-21-06). The fee formula is fixture-verified, but still needs comparison with an in-game installation preview on the user's account; no job was installed for QA.

## Gate

This closes a current-fee constant defect only. Reprocessing model checks, live private ESI and game-preview comparisons remain open.
