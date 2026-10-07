# Stage 3 follow-up — reprocessing cost inputs

Date: 2026-10-08 (Asia/Ho_Chi_Minh). This is a follow-up to the partial Stage 3 estimator; it does not close the stage.

## Changes

- Facility profiles now require an explicitly entered effective reprocessing tax rate when Reprocessing is selected. The value is stored independently from the manufacturing industry tax and shown in the saved profile.
- Reprocessing estimate includes a fee estimate from output quantities, ESI adjusted prices, and the confirmed rate. If any required adjusted output price or rate is unknown, the estimate remains `review` and cannot be offered as ready.
- Budget checks and the max-batch-cost UI filter now use total investment (input purchases plus estimated reprocessing tax), not only input purchases.
- This does not claim the tax formula or rounding model matches the game. No in-game Reprocess preview fixture was available; an effective rate and final yield must be copied from the user's facility/game evidence.

## Verification

| Command | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test:unit` | PASS — 14 files, 54 tests |
| `pnpm test:integration` | PASS — 13 files, 37 tests |
| `pnpm test:e2e` | PASS — 3 tests; 2 opt-in/data-dependent tests skipped by default |
| `pnpm build` | PASS as part of the live test command |
| `pnpm test:e2e:live` | PASS — fresh non-DEMO Electron profile; public ESI market facilities, system indices, and public contract list loaded; UI controls and the explicit facility-confirmation gate exercised (no in-game access proof saved) |
| Private ESI account actions / in-game formula comparison | BLOCKED — isolated test has no consented user SSO session or in-game preview evidence |

## Gate

Stage 3 remains **partial** pending independently checked game formulas and confirmed profile fixtures. Production tab overall remains **not ready**; see the requirements matrix for open stages.
