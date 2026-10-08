# Stage 22 follow-up — SDE reprocessing output rounding

Date: 2026-10-08 (Asia/Ho_Chi_Minh). Validated from the working tree based on `efb6231`.

## Change

- SDE extraction classifies ore inputs for ceiling and ice inputs for nearest-integer rounding; other items retain floor rounding. New asteroid-category groups that cannot be positively identified as ore or ice are marked `unknown` and require Reprocess preview review instead of being silently treated as ore.
- The estimator applies the SDE rule independently to each output material. Static-data schema revision 3 makes an app with the same official SDE build replace its older cached recipes with the newly tagged bundle; a startup integration test confirms the local SQLite catalogue is upgraded and existing selected deals remain intact.
- Refreshed the bundled official SDE (build `3586130`, calculation schema 3): 4,867 manufacturing recipes, 9,566 reprocessing compositions, and 19,719 published market types. Spot checks: Veldspar `1230` and compressed Veldspar `62516` are `ceil`; Clear Icicle `16262` and ice asteroid resource `49789` are `nearest`; unclassified crystallite `50015` is `unknown` and stays in review.
- CCP's [Reprocess all the things!](https://www.eveonline.com/ru/news/view/reprocess-all-the-things) documents ore output rounded up and ice output rounded to the closest integer. The app still requires an in-game preview comparison for the user's particular facility, yield, and tax as required by the acceptance test.

## Verification

| Check | Result |
|---|---|
| Regression test before the fix | FAIL as expected: a 1.5-unit ore yield was floored to 1. |
| `pnpm verify:all all` | PASS: ESLint, TypeScript, 107 integration tests, 38 unit tests, build, and 4 regular desktop E2E tests. Three opt-in tests (performance, live public ESI, packaged app) are skipped by this command. |
| Rounding unit and SDE extraction tests | PASS: covers ceiling, nearest integer including a `.5` tie, floor, known ice resources outside the Ice group, and unknown categories staying in review. |
| `pnpm test:e2e:live` | PASS: non-demo Electron reads current public ESI without GitHub updater or SSO (13.6 s). |
| Current-tree macOS arm64 app bundle | PASS: `pnpm build && pnpm exec electron-builder --mac dir --arm64 --publish never`; local ad-hoc signature, no notarization. |
| `pnpm test:e2e:packaged:mac` after rebuilding the bundle | PASS: packaged non-demo app reads public ESI and passes 1280×800 / 1440×900 layout and alert checks (15.2 s). |
| `git diff --check` | PASS. |

The production dev window remains isolated from `/Applications/EVE Trader.app` and the user's saved database. Its current profile has no connected character and lacks the nine primary read-only production scopes. Therefore private assets/jobs and comparison against the user's Industry/Reprocess previews remain BLOCKED until the primary character is reauthorized by the user and the game-side preview values are supplied. No private account data or wallet operations were changed.

The local package was built and exercised, but it is ad-hoc signed and not notarized; it is not a public auto-update release artifact.
