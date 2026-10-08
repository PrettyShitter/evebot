# Stage 28 follow-up — Alpha skill gate and verification report accuracy

Date: 2026-10-08 (Asia/Ho_Chi_Minh). Working tree is based on commit `448f1f8885ea9dd88a368a598ab8004823a304bc`.

## Changes

- Added an explicit acceptance regression for a character with trained skill V, active skill III and Alpha cap III, plus a recipe that requires an Omega-only skill. The calculation must use III and reject the blocked recipe requirement.
- Fixed the stage verifier's generated status text: local runs no longer claim that Windows package smoke is blocked just because the local host is macOS. Cross-platform smoke is explicitly delegated to the matching GitHub Actions job, and private SSO is separately marked blocked pending user consent.
- Rechecked CCP's current published Alpha tax: the February 2026 Alpha/Omega support page says the additional Industry tax is 2%. The 0.25% Alpha value comes from older Viridian-era rules. Manufacturing still needs the user's facility-specific in-game preview for final acceptance.

## Verification

| Check | Result |
|---|---|
| `pnpm exec vitest run tests/unit/production-skills.test.ts` | PASS — 3 tests, including the new Alpha/active/Omega-only case. |
| `pnpm typecheck` | PASS. |
| `pnpm verify:all all` | PASS — lint, typecheck, 111 unit tests, 38 integration tests, build, and 4 desktop E2E tests. Three opt-in E2E tests were skipped by the aggregate runner and are run separately. |
| `pnpm test:e2e:live` | PASS on the product code at the previous source commit — non-DEMO dev Electron used public live ESI in 17.6 s. The current changes only affect QA coverage and report generation. |
| GitHub Actions at source head `448f1f8` | PASS for `macos-15` and `windows-latest`, including packaging and packaged smoke. New QA-only changes in this report still need their own CI run. |

## Remaining acceptance

The dev SSO screen is still waiting for the user to press `AUTHORIZE`. After it completes, validate the real private profile, assets, blueprints, jobs, contracts and wallet allocations in the dev UI. Manufacturing and reprocessing calculations also need comparison with the user's actual Industry and Reprocess preview. These cannot be proven by fixtures or public market requests.

Sources: [CCP Alpha and Omega Clone](https://support.eveonline.com/hc/en-us/articles/213020969-Alpha-and-Omega-Clone), [CCP Manufacturing](https://support.eveonline.com/hc/en-us/articles/203210292-Manufacturing), [Viridian expansion tax changes](https://www.eveonline.com/de/news/view/viridian-expansion-notes).
