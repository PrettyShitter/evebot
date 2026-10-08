# Stage 25 follow-up — full automated and live public-ESI QA

Date: 2026-10-08 (Asia/Ho_Chi_Minh). Validated on the current `codex/production-tab` source and macOS arm64 package.

## Verification

| Check | Result |
|---|---|
| `pnpm verify:all all` | PASS: lint, typecheck, 110 unit tests, 38 integration tests, build, and 4 standard Electron E2E tests. Three opt-in tests are skipped by the aggregate runner and are listed below. |
| `pnpm test:e2e:live` | PASS: non-DEMO Electron fetched current public ESI data and exercised the production screen, including market refresh; 10.8 s. |
| `pnpm test:e2e:packaged:mac` | PASS: packaged macOS arm64 app launched and fetched public ESI without GitHub updater or SSO; 10.4 s. |
| `EVE_BENCHMARK=1 pnpm exec playwright test tests/e2e/performance.spec.ts` | PASS: 404,495 saved regional orders, 4,867 manufacturing recipes, 643 BPO candidates and 24 synthetic BPC groups. Full incremental scan completed in 33.7 s; filter 12.7 ms; state request 13 ms; maximum renderer timer gap 17.5 ms. |
| `git diff --check` | PASS. |

The benchmark runs in an isolated SQLite profile with a saved public market snapshot and synthetic local profile data. It does not represent private account data or validate in-game manufacturing/reprocessing previews. The public live-ESI tests do not need or write to the user's EVE account.

## Remaining acceptance gates

- Live private ESI for the main character is still blocked pending user authorization of the requested read-only production scopes. The DEV EVE SSO page has `Eth Goblyn` selected and is waiting at the `AUTHORIZE` button; authorization was not submitted by the app.
- Compare manufacturing fee and reprocessing yield/tax estimates with actual EVE Industry and Reprocess previews. No game actions or purchases were performed.
- Windows packaged smoke cannot run on this macOS host. The current macOS package is ad-hoc signed and not notarized.

These gates mean this QA validates public market behavior, local production calculations with saved/synthetic data, UI responsiveness, and the macOS package, but does not constitute final release acceptance for the user's private account.
