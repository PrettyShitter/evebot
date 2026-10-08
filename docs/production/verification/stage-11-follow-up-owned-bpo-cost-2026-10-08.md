# Stage 11 follow-up — owned BPO acquisition cost

Date: 2026-10-08 (Asia/Ho_Chi_Minh). Adds explicit wallet-transaction confirmation for BPOs already present in the character's assets. This closes the cost attribution gap for direct wallet purchases; it does not close the full production-tab acceptance matrix.

## Behavior

- The Production tab lists owned BPOs at the supported Jita/Perimeter NPC hubs and presents compatible personal wallet purchases by type, station, quantity and time.
- ESI transactions do not identify the blueprint item ID, so the app requires the user to select the exact purchase. The selected transaction is unique per BPO and cannot be reused for another blueprint.
- The confirmed amount is saved as blueprint capital. It does not inflate the current cash required to run a batch, while first-cycle profit and first-cycle ROI include the already-paid purchase price.
- Contract purchases and purchases that cannot be matched to an exact wallet transaction remain unconfirmed and are not guessed.

## Verification

| Check | Result |
|---|---|
| `pnpm exec vitest run tests/integration/production-sync.test.ts` | PASS — isolated SQLite/worker fixture confirms exact wallet purchase matching, cost persistence, first-cycle ROI accounting and transaction uniqueness. |
| `pnpm typecheck` | PASS. |
| `pnpm verify:all` | PASS — lint, typecheck, 94 unit/integration tests, build and standard desktop E2E; 3 opt-in tests are skipped by this aggregate command. |
| `pnpm test:e2e:live` | PASS — development Electron with live public ESI and isolated profile. |
| `pnpm exec electron-builder --mac dir --arm64 --publish never` + `pnpm test:e2e:packaged:mac` | PASS — rebuilt arm64 macOS app and exercised it against live public ESI in an isolated profile. Ad-hoc signed; notarization is unavailable without a Developer ID. |

## Remaining boundary

The transaction-to-item association is an explicit user choice because ESI provides no item ID on wallet purchases. Private ESI data and in-game production previews still require an authorized production-scoped character and user-provided game examples. See the live gaps in [requirements-matrix.md](../requirements-matrix.md).
