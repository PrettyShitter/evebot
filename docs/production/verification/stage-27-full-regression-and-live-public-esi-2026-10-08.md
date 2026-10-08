# Stage 27 follow-up — full regression, live public ESI, and CI

Date: 2026-10-08 (Asia/Ho_Chi_Minh). Source: `86d1942806fb5d3ff4cebdbf99fc1df47c4716bc` (`codex/production-tab`).

## Verification

| Check | Result |
|---|---|
| `pnpm verify:all all` | PASS: lint, typecheck, 110 unit tests, 38 integration tests, production build, and 4 desktop E2E tests. The runner intentionally skips the opt-in performance, live-ESI, and packaged-app E2E tests; they are run separately. |
| `pnpm test:e2e:live` | PASS: a non-DEMO Electron dev build fetched live public ESI data and rendered the Production tab without GitHub update checks or SSO; 17.6 s. |
| GitHub Actions, run `37725709883` | PASS on `macos-15` and `windows-latest`, including each platform's package and smoke workflow. |
| `git diff --check` | PASS. |

The public live test used the dev build and an isolated test profile. It did not access or modify the installed app's local database or game account.

## Remaining live acceptance

- The Production dev SSO request is open in Chrome with `Eth Goblyn` selected and awaits the user pressing `AUTHORIZE`. The scopes are read-only, covering wallet, skills/queue, standings, assets, blueprints, industry jobs, personal contracts, structure market and structure search. The consent step was not submitted by the app.
- After consent, validate actual private assets, BPO/BPCs, jobs, contract matching, wallet allocations and multi-character purchase/main-character sale reconciliation in the Production UI. Existing installed-app connections do not imply that this separate dev OAuth request has completed.
- Compare manufacturing fees and reprocessing yield/tax to the in-game Industry and Reprocess previews. No game purchases or production actions were performed.
- The current local macOS package is ad-hoc signed and cannot be notarized without Developer ID credentials. CI packaging/smoke passed on both macOS and Windows, but notarized distribution is still unavailable.

Accordingly, automated regression, live public-market access, and both CI packaging paths pass. Private-account and in-game formula acceptance remain open; this is not a claim of final release readiness.
