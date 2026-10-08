# Stage 26 follow-up — pin and start a market BPO plan

Date: 2026-10-08 (Asia/Ho_Chi_Minh). Validated on the current source, non-DEMO live-ESI Electron app, and local macOS arm64 package.

Source commit: `e75a96ead987cad4eaae4adec07fc34fab21f8a7`.

## Change

- A feasible market-BPO production offer can now be pinned before the blueprint is bought. The pinned plan keeps its market offer snapshot and shows the BPO purchase price and acquisition state.
- Starting remains disabled until the app has synchronized exactly one matching BPO at the selected facility and its price has been explicitly paired with a main-character wallet transaction.
- Start resolves the synchronized physical blueprint's current owned offer and performs the normal fresh quote, capital check, chain planning, blueprint reservation, and project start. Missing or ambiguous acquisition evidence produces a clear review message.

## Verification

| Check | Result |
|---|---|
| `pnpm exec vitest run tests/integration/production-sync.test.ts` | PASS: market BPO offer pins, pre-acquisition start is rejected, a later synchronized BPO plus wallet-price confirmation unlocks start, and the started project enters purchasing. |
| `pnpm typecheck` | PASS. |
| `pnpm lint` | PASS. |
| `pnpm verify:all all` | PASS: 110 unit tests, 38 integration tests, build, and 4 standard desktop E2E tests. Three opt-in tests skipped by the aggregate runner and were run separately. |
| `pnpm test:e2e:live` | PASS: non-DEMO Electron fetched public ESI and rendered the current Production UI (13.6 s). |
| `pnpm exec electron-builder --mac dir --arm64 --publish never` | PASS: created local ad-hoc-signed arm64 app; notarization unavailable on this machine. |
| `pnpm test:e2e:packaged:mac` | PASS: freshly packaged app launched and read public ESI without GitHub updater or SSO (15.6 s). |
| `EVE_BENCHMARK=1 pnpm exec playwright test tests/e2e/performance.spec.ts` | PASS: all 643 BPO candidates and 24 BPC groups scanned in 34.0 s; 13 ms filter, 13.3 ms state request, 17.6 ms maximum renderer gap. |
| `git diff --check` | PASS. |

Automated integration uses fixture ESI payloads and synthetic wallet history; live ESI and packaged tests validate public market startup, not private account acquisition. The actual user's private SSO scopes and in-game fee/yield previews remain unverified. If multiple matching BPOs are synchronized for the same pinned purchase, the project stays gated for review instead of guessing which physical item belongs to it.
