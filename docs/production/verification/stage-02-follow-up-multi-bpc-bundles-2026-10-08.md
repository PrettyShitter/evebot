# Stage 2 follow-up — multi-copy BPC contract bundles

Date: 2026-10-08 (Asia/Ho_Chi_Minh).

## Behavior

- Public bundles with multiple BPCs can be quoted when every blueprint item's copy flag, quantity, type, ME, TE, and positive run count are known. Copies with the same blueprint type and attributes are grouped; unrelated included items do not receive speculative resale value.
- A quote for a BPC group prorates its used-run acquisition cost across all known BPC runs in the contract. Accepting the contract still requires the whole listed price, which remains the cash requirement in the estimate.
- Completed personal-contract reconciliation allocates the full public contract price across uniquely matched owned BPC copies by original run count. Ambiguous, duplicate, unknown, or incomplete matches are left unmatched rather than guessed.
- The UI identifies how many equivalent copies are in the bundle and how many runs the bundle contains, and explains the difference between total cash required and the run cost applied to the quote.

## Verification

| Check | Result |
|---|---|
| BPC acquisition unit tests | PASS — 8 tests, including three-copy cost allocation and unique completed-contract matching. |
| Production sync integration | PASS — bundle contract quote retains full 30,000 ISK cash requirement, allocates 5,000 ISK to a one-run quote, and imports three unique 10,000 ISK copy costs. |
| `pnpm verify:all` | PASS — 100 unit tests, 37 integration tests, build, and 3 desktop E2E tests. |
| Public live ESI and packaged macOS smoke | PASS — both DEV and packaged app loaded current public ESI using isolated profiles. |

The arithmetic and ESI data path are verified against fixtures. Private character matching and actual in-game industry fee/yield previews remain unverified until the account grants the required scopes and a real game preview is compared. This follow-up does not mark Production as fully accepted or release-ready.
