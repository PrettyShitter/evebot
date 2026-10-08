# Stage 15 follow-up — Alpha manufacturing tax and current-app QA

Date: 2026-10-08 (Asia/Ho_Chi_Minh). The manufacturing estimator follows CCP's February 2026 support article's 2% additional Alpha industry tax, instead of the older 0.25% value in the 2023 Viridian changes. CCP's current [Alpha and Omega support article](https://support.eveonline.com/hc/en-us/articles/213020969-Alpha-and-Omega-Clone) explicitly says the additional industry tax is 2%; its current [Manufacturing article](https://support.eveonline.com/hc/en-us/articles/203210292-Manufacturing) confirms facility cost is part of starting a job. This establishes the current published baseline, while the user's actual Industry preview is still needed to validate the character and facility-specific total.

## Changes

- Updated NPC and configured Upwell formula identifiers and recalculated manufacturing estimates with the 2% Alpha surcharge.
- Updated formula fixtures, the fee uncertainty notice, ESI research notes, and the requirements matrix.
- Updated the live-E2E text assertion to match the revised notice.

## Verification

| Check | Result |
|---|---|
| `pnpm verify:all` | PASS — lint, TypeScript, integration suite (20 files / 101 tests), unit suite (13 files / 38 tests), build, and 4 desktop E2E tests; 3 opt-in tests are skipped by this command. |
| `pnpm test:e2e:live` | PASS — development Electron app in an isolated profile loaded current public ESI and exercised the production controls (16.3 s). |
| `pnpm exec electron-builder --mac dir --arm64 --publish never` | PASS — rebuilt the macOS arm64 app from this working tree. Ad-hoc signed, not notarized because no Developer ID is configured. |
| `pnpm test:e2e:packaged:mac` | PASS — the freshly built `.app` launched in a temporary profile and fetched live public ESI (15.3 s). |
| `git diff --check` | PASS. |

The development and packaged tests use isolated temporary profiles. The installed user app, its database, SSO session, and character tokens were not changed. The live tests exercise public ESI only; they do not create, modify, or cancel in-game jobs or orders.

## Still required for full acceptance

Private production ESI remains unverified until the main character is reauthorized for the scopes listed in `SSO_SETUP.md` (assets, blueprints, industry jobs, contracts, skills/skill queue, standings, and wallet). Then compare the estimator's fee with an actual Industry preview and validate job, material, and wallet reconciliation against known character activity. Reprocessing also needs an in-game preview. These checks require the user to approve the expanded ESI access and provide the game-side examples; public ESI and a packaged smoke cannot substitute for them.
