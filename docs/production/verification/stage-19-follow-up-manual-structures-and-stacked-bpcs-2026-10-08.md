# Stage 19 follow-up — manual structure candidates and stacked BPCs

Date: 2026-10-08 (Asia/Ho_Chi_Minh).

## Changes

- Added a structure registration form for a user-provided EVE location ID, in-game name and Jita/Perimeter system. Registration validates positive signed-64-bit IDs, rejects known NPC station IDs and conflicting existing profiles, and stores a manually sourced candidate with unknown access and no assumed services or taxes.
- Registration selects the new candidate for review, but does not confirm access or trigger structure-market synchronization. The existing profile editor still requires explicit in-game evidence before confirming service/access; only confirmed profiles are eligible for structure market reads.
- BPC contracts can now represent multiple identical copies in one ESI item stack. Run coverage multiplies the confirmed per-copy runs by stack quantity. Manual ME/TE/runs confirmation applies only to that current record. Completed private-contract reconciliation remains one-to-one by owned item ID and rejects stacked public items when ownership cannot be matched uniquely.

## Verification

| Check | Result |
|---|---|
| Manual structure flow regression | RED before implementation: live non-DEMO Electron E2E timed out waiting for the missing structure-ID field. GREEN after implementation: the user can add/select a structure candidate; zero ID is rejected; candidate is explicitly unverified; profile confirmation stays disabled; the candidate does not appear in structure-market coverage. |
| BPC stack arithmetic regression | RED before implementation: `groupKnownBpcCopies()` returned `null` for one record with 3 copies and 20 runs each. GREEN after implementation: 3 copies produce 60 bundle runs and group runs. |
| BPC manual confirmation UI | PASS — isolated Electron UI confirms and persists unknown ME/TE/runs for a 3-copy stack across app restart. |
| `pnpm verify:all` | PASS — lint, typecheck, 106 integration tests, 38 unit tests, build and 4 regular desktop E2E tests. Live and saved-market E2E are run separately. |
| `pnpm test:e2e:live` | PASS — non-DEMO dev Electron fetched public ESI and completed the isolated manual structure candidate flow (19.3 s). |
| macOS arm64 package + `pnpm test:e2e:packaged:mac` | PASS — rebuilt package fetched public ESI (18.4 s). |
| `node scripts/packaged-smoke.mjs` | PASS — app signature integrity, launch, worker/SQLite/migrations, settings, tray hide/show and restart persistence. Ad-hoc signature only; not Apple notarization. |

## Remaining acceptance limits

No test pretends a real structure's service access or taxes were confirmed. Private character scopes, a current structure grant, actual station/structure Industry previews, Reprocess previews, and the user's live project-ledger examples still require the main character and game UI. The local package is not suitable for an auto-update release without Developer ID signing/notarization.
