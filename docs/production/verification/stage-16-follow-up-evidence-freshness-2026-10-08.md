# Stage 16 follow-up — reject invalid production evidence timestamps

Date: 2026-10-08 (Asia/Ho_Chi_Minh). Production estimates must not treat malformed timestamp comparisons (`Date.parse` returning `NaN`) as fresh evidence. Added shared freshness checks that reject malformed, stale, and more-than-five-minutes-future observations; market snapshot expiry checks also require a valid, unexpired timestamp.

## Changes

- Applied freshness checks to manual Reprocess preview evidence, character and facility profiles, owned blueprint snapshots, output-specific structure modifiers, public contract confirmation, facility/structure-market status, and production market snapshot expiry.
- Reprocess estimates move to review when their evidence timestamp is invalid, older than 30 days, or implausibly future-dated.
- Made the long production-sync integration scenario time-relative. Its prior fixed job start times eventually fell before the dynamically created project. The output-lot assertion now checks required records without assuming an order the specification does not require.
- Extended the desktop BPC confirmation E2E test to click-copy a blueprint name, assert the copy confirmation, and verify the separate attribute-confirmation form stays available.

## Verification

| Check | Result |
|---|---|
| Focused production freshness, Reprocess, and worker sync tests | PASS — 3 test files / 10 tests. |
| `pnpm verify:all` | PASS — lint, typecheck, integration suite (21 files / 105 tests), unit suite (13 files / 38 tests), build, 4 desktop E2E tests including copy-and-confirm behavior; 3 opt-in E2E tests skipped by this command. |
| `pnpm test:e2e:live` | PASS — dev Electron with isolated profile and public live ESI (16.0 s). |
| `pnpm exec electron-builder --mac dir --arm64 --publish never` | PASS — rebuilt current macOS arm64 app; ad-hoc signed, not notarized. |
| `pnpm test:e2e:packaged:mac` | PASS — rebuilt app exercised public live ESI in a temporary profile (17.8 s). |
| `git diff --check` | PASS. |

All live tests use temporary profiles and public ESI. They do not alter the installed app, its database, character tokens, or in-game state.

## Remaining acceptance limits

The main character still needs to approve the production scopes listed in `SSO_SETUP.md` before private assets, blueprints, jobs, and wallet reconciliation can be validated. Manufacturing fees and Reprocess yield/tax still need comparison with actual in-game previews. See the [requirements matrix](../requirements-matrix.md) for the rest of the open release gates.
