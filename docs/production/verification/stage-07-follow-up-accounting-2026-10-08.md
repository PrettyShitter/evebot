# Stage 7 follow-up — linked job fee reconciliation

Date: 2026-10-08 (Asia/Ho_Chi_Minh). Stage 7 remains partial.

## Changes

- A manufacturing project's current expected cost now uses the forecast installation fee only before any job is linked. Once linked jobs exist, every linked job must expose its charged cost; missing one keeps the total unknown instead of summing a partial amount.
- A delivered job without a fee leaves the project in `reconciling` and does not create an output lot with an understated unit cost. A later ESI sync that includes the fee resumes lot creation.
- A manufacturing project accepts only one matching job. Binding a second full-run job is rejected because the current project model represents one batch and duplicating the full output would overstate both inventory and profit.
- The existing UI already explains that profit remains hidden while ESI expense reconciliation is incomplete.
- Projects now display a separate current-market profit forecast for immediate buy depth and passive sell orders, using the revised current cost and seller taxes/fees. Multi-output reprocessing forecasts require complete coverage for every non-zero output; stale markets and partial depth return no amount.

## Verification

| Command | Result |
|---|---|
| `pnpm vitest run tests/unit/production-project-cost.test.ts tests/unit/production-reprocessing.test.ts tests/integration/production-sync.test.ts` | PASS — 3 files, 11 tests |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm vitest run` | PASS — 29 files, 106 tests |
| `pnpm test:e2e` | PASS — 3 passed; live ESI and performance cases skipped by default |
| `EVE_BENCHMARK=1 pnpm exec playwright test tests/e2e/performance.spec.ts` | PASS — 106 ms UI filter, 66 ms filter request, 18 ms max renderer gap; this older saved-market fixture returned 0 offers, so this is responsiveness evidence only |
| `pnpm test:e2e:live` | PASS — current source dev Electron with public ESI (28 sec) |
| `git diff --check` | PASS |

The integration fixture covers binding a matching job, rejecting a second job, remaining in reconciliation when its fee is absent, then importing the fee and generating one correctly costed output lot. Unit tests cover current profit through both exits, negative results after fees, and unavailable results when depth is incomplete. These fixtures are not private-account or in-game evidence.

## Gate

This closes fee visibility, duplicate-output prevention, and current market profit forecasts for the one-batch workflow. Recursive jobs, multi-node projects, manual manufacturing-fee evidence when ESI omits a fee, private live ESI verification, and end-to-end real game evidence remain open. Stage 7 is not complete and the tab is not release-ready.
