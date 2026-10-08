# Stage 2 follow-up — multi-copy BPC contract bundles

Date: 2026-10-08 (Asia/Ho_Chi_Minh).

## Behavior

- Public bundles with multiple BPCs can be quoted when every blueprint item's copy flag, quantity, type, ME, TE, and positive run count are known. Copies with the same blueprint type and attributes are grouped; unrelated included items do not receive speculative resale value.
- A quote for a BPC group prorates its used-run acquisition cost across all known BPC runs in the contract. Accepting the contract still requires the whole listed price, which remains the cash requirement in the estimate.
- Completed personal-contract reconciliation allocates the full public contract price across uniquely matched owned BPC copies by original run count. Ambiguous, duplicate, unknown, or incomplete matches are left unmatched rather than guessed.
- The UI identifies how many equivalent copies are in the bundle and how many runs the bundle contains, and explains the difference between total cash required and the run cost applied to the quote.
- When ESI omits a public copy's ME/TE/runs, the user can record the values checked on that exact current contract item. Confirmation stores a reason and time, applies only while the listing is still current, and persists across app restarts. Later complete ESI values win; conflicts are shown and calculations use ESI.
- The public contract `quantity = -2` BPC sentinel is normalized to one physical copy before run sufficiency and manual confirmation checks; it is not treated as negative inventory.

## Verification

| Check | Result |
|---|---|
| BPC acquisition unit tests | PASS — 8 tests, including three-copy cost allocation and unique completed-contract matching. |
| Production sync integration | PASS — bundle contract quote retains full 30,000 ISK cash requirement, allocates 5,000 ISK to a one-run quote, and imports three unique 10,000 ISK copy costs. |
| Manual attribute confirmation integration | PASS — unknown item becomes eligible after exact record confirmation; stale snapshots and record-ID mismatches are rejected; a later ESI disagreement is shown without using the manual value. |
| Confirmed contract quote path | PASS — manually confirmed unknown BPC creates a fresh production contract offer with the full contract cash requirement. |
| Desktop UI + restart E2E | PASS — fields, validation, saved evidence, refreshed card, and persistence across a second Electron process. |
| Public item parser sentinel fixture | PASS — a `quantity = -2`, `is_blueprint_copy = true` ESI item is exposed as one BPC with its ME/TE/runs intact. |
| v11→v12 populated SQLite migration | PASS — existing deal and contract survived; confirmation bounds, source cascade, integrity and foreign keys verified on a disposable copy. |
| `pnpm verify:all` | PASS — lint, typecheck, 100 default Vitest tests, 38 unit tests, build, and 4 desktop E2E tests; three opt-in cases skipped. |
| `pnpm test:e2e:live` | PASS — current DEV Electron fetched live public ESI in 16.3 s using an isolated profile. |
| arm64 package + `pnpm test:e2e:packaged:mac` | PASS — current `.app` built and loaded live public ESI in 14.6 s using an isolated profile; ad-hoc signed, not notarized. |

The arithmetic and ESI data path are verified against fixtures. Private character matching and actual in-game industry fee/yield previews remain unverified until the account grants the required scopes and a real game preview is compared. This follow-up does not mark Production as fully accepted or release-ready.
