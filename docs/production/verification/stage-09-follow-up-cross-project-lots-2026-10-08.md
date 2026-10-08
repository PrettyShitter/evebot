# Stage 9 follow-up — cross-project output lot allocation

Date: 2026-10-08 (Asia/Ho_Chi_Minh). This closes cross-project reservation for costed output lots in the manufacturing make/buy planner; it does not close the full production-tab acceptance matrix.

## Behavior added

- Unreserved output lots at the exact selected facility compete with current sell orders at their carried unit cost. Quotes include their cost in PnL and subtract already-paid inventory from launch cash.
- Starting a project transactionally reserves lot quantity and creates explicit material edges. A second project cannot quote or reserve the same units while the first reservation is active.
- Cancelling a project releases only its unconsumed lot reservation. Delivered jobs consume the reserved quantity once, reduce the source lot, and carry the source unit cost into the new output lot.
- Sale allocation now excludes reserved units from a final lot. Project cards show lot availability, reserved quantities, and the source project/cost for allocations.

## Verification

| Check | Result |
|---|---|
| Regression-first planner test | PASS — initially failed because purchase actions discarded the source lot identity; passes after source levels are preserved. |
| `pnpm exec vitest run tests/unit/production-chain-planner.test.ts` | PASS — 7 tests, including choosing a costed output lot over a more expensive market order while preserving provenance. |
| `pnpm exec vitest run tests/integration/production-sync.test.ts` | PASS — one worker integration scenario now reserves a lot, rejects a second project's reuse, releases on cancellation, consumes it through a delivered ESI job, and blocks selling reserved output. |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `git diff --check` | PASS |

The migration is additive at schema version 9 and retains existing project and output-lot rows. The test uses an isolated SQLite profile and synthetic wallet/job fixtures; it does not imply live private ESI validation or in-game execution.

## Remaining acceptance gates

Live private character data and fee/yield comparison still require the user's production scopes and in-game preview examples. Procurement and hauling time are not estimated, and cross-system/facility lot transport is intentionally excluded from this same-facility quote.
