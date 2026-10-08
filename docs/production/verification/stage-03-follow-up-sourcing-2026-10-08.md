# Stage 3 follow-up — cross-location material sourcing

Date: 2026-10-08 (Asia/Ho_Chi_Minh). This follow-up does not close Stage 3 or the production tab.

## Changes

- Manufacturing input sell depth now combines Jita and Perimeter NPC station books with fresh, manually confirmed structure books that are available through the private ESI structure-market endpoint.
- Reprocessing input sell depth uses the same eligible hub locations; its estimate reports the source split.
- The manufacturing UI exposes each material's source locations and quantities; the reprocessing card shows locations, quantities, and spend so the user can see where input must be purchased.
- The manufacturing facility and output market checks remain tied to the selected facility/hub. Sourcing elsewhere assumes the user transports the materials; hauling cost and time are not estimated.
- Unconfirmed structures and stale or unavailable structure books are excluded from available depth.

## Verification

| Command | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm vitest run` | PASS — 29 files, 102 tests |
| `pnpm test:e2e` | PASS — 3 passed; live and performance tests are opt-in/data-dependent and skipped by default |
| `pnpm test:e2e:live` | PASS — rebuilt and launched non-DEMO Electron, queried public ESI, exercised Production UI and verified the facility confirmation gate. No in-game access evidence was fabricated or saved. |

## Gate

This changes the material cost coverage but does not complete recursive make/buy planning, blueprint acquisition economics, formula validation against game previews, or private-account/live in-game checks. The tab remains **not ready for final release**.
