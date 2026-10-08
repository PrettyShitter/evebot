# Stage 24 follow-up — stable offer ordering during market refresh

Date: 2026-10-08 (Asia/Ho_Chi_Minh). Validated from the current `codex/production-tab` working tree.

## Change

- The production opportunity list now detects a new completed public market snapshot and displays an explicit `Есть обновления рынка и предложений` notice with `Показать обновления`.
- Until the user applies the refresh, existing offer rows retain their prior order and newly discovered offers append after them. Detail rows remain keyed by stable offer IDs, so expanded sections stay open.
- Applying the refresh switches to the latest sorted order. `preserveOfferOrder` is covered for reorder and append behavior.

## Verification

| Check | Result |
|---|---|
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm exec vitest run tests/unit/production-order.test.ts` | PASS: two ordering cases. |
| Production contract desktop E2E | PASS. |
| `pnpm test:e2e:live` | PASS: non-demo Electron performed two public ESI refreshes, displayed and applied the market update in UI (13.9 s). |
| Live update banner visual review | PASS: captured and inspected at 1280×800; notice and apply action are visible above the production sections without horizontal overflow. |

The live test uses an isolated profile and does not exercise private character data. The main-character OAuth consent screen is open in DEV with `Eth Goblyn` selected; final authorization was left to the user. No installed-app data was changed.
