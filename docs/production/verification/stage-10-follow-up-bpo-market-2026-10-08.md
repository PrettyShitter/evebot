# Stage 10 follow-up — market BPO acquisition economics

Date: 2026-10-08 (Asia/Ho_Chi_Minh). Adds bounded BPO buy candidates to Production opportunities; does not close the full production-tab acceptance matrix.

## Behavior

- The scanner matches market sell orders for manufacturing BPOs at confirmed Jita/Perimeter NPC facilities and checks Alpha skill eligibility, material depth, output demand, facility index, tax and available capital.
- It evaluates at most 300 lowest-priced candidates per coherent market snapshot and reports when the limit was reached. It does not claim full BPO-market coverage beyond that bound.
- The offer separates recurring batch economics from the full BPO purchase: first-cycle net result/ROI use full cash needed, while payback is the number of identical profitable batches required to recover BPO price.
- A market BPO is explicitly marked as not owned. Quote, pin and start paths require the player to buy it in EVE and sync assets/blueprints before the project can be created.

## Verification

| Check | Result |
|---|---|
| `pnpm exec vitest run tests/integration/production-sync.test.ts` | PASS — isolated worker/SQLite fixture discovers a market BPO, includes its full purchase price and first-cycle metrics, and keeps it non-executable before ownership sync. |
| `pnpm exec vitest run tests/unit/production-manufacturing.test.ts` | PASS — first-cycle cash/ROI, BPC acquisition accounting and reusable BPO payback are covered. |
| `pnpm verify:all` | PASS — lint, typecheck, 94 unit/integration tests, build, and 3 standard desktop E2E tests; 3 opt-in tests skipped by this aggregate command. |
| `pnpm test:e2e:live` | PASS — dev Electron uses public live ESI in an isolated profile, without SSO or GitHub updates. |
| `pnpm exec electron-builder --mac dir --arm64 --publish never` + `pnpm test:e2e:packaged:mac` | PASS — rebuilt and launched the actual arm64 macOS app with public live ESI in an isolated profile. Ad-hoc signed and not notarized. |
| `pnpm typecheck` | PASS |

## Remaining boundary

Only single market BPO sell orders are used; market BPO candidates are capped and cheapest-first, not globally profit-ranked before planning. BPOs in public contract bundles and structure-specific production economics remain unsupported. Live private character and in-game fee/yield checks still need the character's ESI scopes and in-game examples.
