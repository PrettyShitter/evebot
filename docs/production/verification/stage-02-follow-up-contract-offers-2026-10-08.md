# Stage 2 follow-up — first-cycle quotes for single BPC contracts

Date: 2026-10-08 (Asia/Ho_Chi_Minh). Stage 2 remains partial.

## Changes

- A public contract is eligible for a production quote only while its listing observation is under one hour old, its pickup location is a confirmed NPC manufacturing station in Jita/Perimeter, and it contains exactly one known BPC for a recipe in SDE. Mixed-item bundles, multiple copies, unknown ME/TE/runs, and unknown recipes stay out of priced contract offers.
- The estimate allocates the contract purchase price across the BPC's known original runs for project cost and profit, while `cashRequired` includes the **entire** contract price before purchase. The UI shows both values and contract/market observation times; the contract is still accepted manually in EVE.
- When a completed personal item-exchange contract can be uniquely joined to one owned BPC by contract ID, location, type, ME, TE, and runs, the app retains the full acquisition price and original run count—even after the listing disappears from public ESI. Each project includes only the price share for its runs in PnL, excludes that already-paid amount from launch cash, and includes it in actual output-lot cost after job delivery. Ambiguous matches are ignored rather than guessed.
- Output sell orders are included in the market inputs. A complete immediate-sale path can be recommended when passive sell pricing is unavailable, with the unavailable route marked as a warning. If neither route covers the batch, the quote remains under review.
- Contract payment is linked only when the ESI completed-contract record and retained public listing produce a unique BPC match. There is no manual recovery path when the public listing is gone before the app has cached it or ESI evidence is ambiguous. Residual runs retain their proportional cost share.

## Verification

| Command | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| Contract-cost unit and worker integration tests | PASS — full contract cash stays separate from per-run cost; completed contract still matches after the public listing is removed; actual job cost and partial sale PnL include the allocated BPC share |
| `pnpm vitest run` | PASS — 29 files, 104 tests at initial stage; later follow-up coverage is recorded in its current test run |
| `pnpm test:e2e` | PASS — 3 passed; the opt-in live ESI and performance cases skipped by default |
| `pnpm test:e2e:live` | PASS — fresh dev Electron, public ESI sync, Production UI and explicit facility-confirmation gate; no false game evidence persisted |
| `git diff --check` | PASS |

The integration fixture constructs a current Jita regional market snapshot, one known two-run BPC contract, Alpha skill data, and a confirmed manufacturing profile. It verifies a one-run offer allocates half of the 1,000 ISK contract price to PnL while retaining the full 1,000 ISK in required launch cash. Another worker path imports the finished contract, removes it from the current public listing, retains its price/run evidence, and reconciles allocated BPC cost into actual output-lot PnL. Fixture numbers validate code flow, not live in-game fee mechanics.

## Gate

The contract quote remains limited to the narrow, unambiguous single-BPC case. There is no manual recovery path if the listing was never cached, BPO acquisition economics and BPC bundles remain unsupported, and recursive chain/structure fee profiles plus private-account/game-preview QA remain open. This does not close Stage 2 or authorize release.
