# Stage 4 follow-up — purchase source locations

Date: 2026-10-08 (Asia/Ho_Chi_Minh). This report verifies the current working tree after adding purchase provenance to chain actions.

## Change

- Each market or project-inventory fill now retains its location ID and display name in the make/buy plan.
- Both production offer detail views show every purchase source, location, quantity, and unit cost. Multi-station buys are visible as separate lines instead of one unexplained combined total.
- The integration fixture now fixes its project start time before the dated purchase transactions. This prevents the scenario from becoming invalid when wall-clock time advances beyond the previously hard-coded project-start minute.

## Verification

| Check | Result |
|---|---|
| `pnpm verify:all` | PASS — lint, typecheck, 101 default tests, 38 unit tests, integration suite, production build, and 4 standard E2E tests. Three opt-in tests are skipped by the default command. |
| `pnpm exec vitest run tests/unit/production-chain-planner.test.ts` | PASS — purchase sources retain location data. |
| `pnpm exec vitest run tests/integration/production-sync.test.ts` | PASS — fixture confirms market and project-lot location provenance in the full planning response; purchase allocation and accounting regression also pass. |
| `pnpm test:e2e:live` | PASS — non-DEMO Electron refreshed current public Tranquility ESI in an isolated profile, without GitHub updater or private-account writes. |
| `pnpm exec electron-builder --mac dir --arm64 --publish never` | PASS — arm64 bundle built from this working tree; ad-hoc signed, not notarized. |
| `pnpm test:e2e:packaged:mac` | PASS — freshly packaged app launched with an isolated profile and loaded public ESI. |
| Installed app and user database | Not modified by these checks. |

## Remaining acceptance gates

This change closes the missing source-location detail but does not make the full production tab fully accepted. Private character skills/assets/blueprints/jobs/contracts and structure markets still need a successful consented ESI sync. Manufacturing fees and reprocessing output/tax still need comparison with the user's in-game previews. Windows smoke, notarized distribution, and live private-account project reconciliation remain open. No real ISK was spent and no industry job was started.
