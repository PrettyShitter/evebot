# Stage 4 follow-up — bounded make/buy DAG engine

Date: 2026-10-08 (Asia/Ho_Chi_Minh). Stage 4 remains partial.

## Changes

- Added a pure make/buy planner that explores complete market-buy and manufacturing alternatives across a dependency graph.
- Search branches share order depth and BPC run budgets. Repeated material requirements are aggregated, extra output from rounded runs is retained as reusable surplus, and one purchase action can have multiple parents.
- The planner permits a limited BPC to cover part of a need while the remaining quantity is bought. Manufacturing cycles cannot recursively create their own input; the external market remains an allowed source.
- A configurable search-state ceiling returns `review` with no cost or actions, so an unproven partial search cannot appear as an optimal ready plan.
- Owned-blueprint and eligible single-BPC offers now call the planner. Chain-adjusted all-in costs and profit are returned with named actions; the final owned recipe is forced to production while components keep buy/make choices.
- The renderer exposes the selected actions and allows pinning a fully validated make/buy plan; incomplete/review plans cannot be presented as profitable estimates.
- Multi-node project execution is now wired: start snapshots the DAG, aggregates leaf buys into purchase nodes, reserves each physical BPC/BPO run allocation, and creates dependency edges. ESI job binding targets a selected node and refuses to bind dependent manufacturing before its producing nodes complete. Final saleable output appears after all nodes deliver.
- Delivered intermediate nodes now retain costed surplus as non-saleable lots; child actual costs roll into the next node's cost per unit, preventing both double charging and loss of excess runs.

## Verification

| Command | Result |
|---|---|
| `pnpm vitest run tests/unit/production-chain-planner.test.ts` | PASS — 1 file, 6 tests |
| `pnpm vitest run tests/integration/production-sync.test.ts` | PASS — includes a two-step component→final project, dependency-gated ESI jobs, exact final cost allocation, costed intermediate surplus, and rejection of component sale |
| `pnpm typecheck` | PASS after integration |

Covered: complete recursive cost comparison including fixed job fees, common-input aggregation across branches, shared order depth, cycle prevention, partial BPC plus market sourcing, incomplete depth/run exhaustion, and forced final production. The public-ESI Electron smoke test passes; private ESI and live in-game job validation remain unavailable without user-authorized data.

## Gate

The planner and project execution are connected, but bounded search can return review and batch candidate selection is limited to market-depth breakpoints. Sharing surplus lots with another project, complete contract/BPO economics, production-slot scheduling and current market trend scoring remain open. Do not treat Stage 4 as complete or release the tab.
