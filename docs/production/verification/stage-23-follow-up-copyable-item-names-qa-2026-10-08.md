# Stage 23 follow-up — copyable game item names

Date: 2026-10-08 (Asia/Ho_Chi_Minh). Validated from the current `codex/production-tab` working tree.

## Change

Production now exposes every rendered game item name as a keyboard-focusable copy button with the standard success toast, including BPC contract and blueprint names, market blueprint names, regional reprocessing outputs, structure product profiles, and wallet purchase history. This closes the remaining static UI audit gaps found against the TZ's item-name copy requirement.

## Verification

| Check | Result |
|---|---|
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm verify:all all` | PASS: 108 unit tests, 38 integration tests, build, and 4 regular desktop E2E tests; three opt-in tests skipped by this command. |
| `pnpm test:e2e:live` | PASS: isolated non-demo Electron app loaded current public ESI without GitHub updater or SSO (10.3 s). |
| Production contract UI E2E | PASS: copy action and success toast verified in Electron UI; unknown attributes remain explicitly review-gated after confirmation. |

Private character views, structure market access, and comparison against the user's live in-game manufacturing/reprocessing previews remain unverified until the user authorizes the main character's read-only scopes and provides the game preview values. The normal installed app profile was not changed.
