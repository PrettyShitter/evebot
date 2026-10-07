# Stage 13 follow-up — rank BPC contract offers by actual first-cycle cash

Date: 2026-10-08 (Asia/Ho_Chi_Minh). Contract opportunities now use the whole contract payment when filtering capital and ranking the first batch.

## Behavior

- The contract section's maximum-investment filter uses full `cashRequired`, including the complete contract price and manufacturing inputs.
- Minimum-profit, ROI and sorting use first-cycle profit/ROI after buying the whole contract. The UI distinguishes this from the amortized operating result of the batch.
- Worker-side truncation also sorts contract opportunities on first-cycle profit before retaining the bounded list.

## Verification

| Check | Result |
|---|---|
| `pnpm typecheck`, `pnpm lint`, focused production integration/unit tests | PASS. |
| `pnpm verify:all` | PASS — lint, typecheck, 96 tests, build and standard desktop E2E; 3 opt-in tests skipped. |
| `pnpm test:e2e:live` | PASS — live public ESI in non-DEMO development Electron and an isolated profile. |
| arm64 `electron-builder --mac dir` + `pnpm test:e2e:packaged:mac` | PASS — current packaged app launched and fetched live public ESI in an isolated profile. |

## Remaining boundary

Mixed and multi-blueprint contract bundles still need a whole-bundle acquisition/cost-allocation design before they can be recommended. Private character QA and in-game fee/yield confirmation still require user-consented ESI scopes and game examples.
