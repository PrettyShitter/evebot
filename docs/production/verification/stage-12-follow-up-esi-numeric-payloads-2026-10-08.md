# Stage 12 follow-up — ESI numeric payload compatibility

Date: 2026-10-08 (Asia/Ho_Chi_Minh). Aligns production ESI parsers with the numeric JSON fields in CCP's live OpenAPI payloads while preserving 64-bit IDs as decimal strings.

## Behavior

- Shared ESI IDs, decimals and integer quantities accept exact `lossless-json` numeric values as well as existing string fixtures.
- Production ESI adapters validate the parsed response body directly instead of serializing it into a second JSON document. Facility tax, cost index, public contracts/items, industry-job costs and prices are normalized into the app's string-money model.
- Public contract item `item_id` is retained and used to identify a purchased BPC when ESI exposes it; a mismatched ID cannot silently fall back to a similar blueprint.

## Verification

| Check | Result |
|---|---|
| Focused unit/integration parser tests | PASS — numeric public facility/system/contract/item fields and exact BPC association; production sync and existing wallet sync covered. |
| `pnpm typecheck` | PASS. |
| `pnpm test:e2e:live` | PASS — non-DEMO Electron fetched and rendered live public ESI data in a temporary profile without GitHub updates or SSO. |
| `pnpm exec electron-builder --mac dir --arm64 --publish never` + `pnpm test:e2e:packaged:mac` | PASS — rebuilt and launched the actual arm64 macOS app against live public ESI using an isolated profile. Ad-hoc signed; notarization is unavailable without a Developer ID. |

## Remaining boundary

Private character responses and in-game production/reprocessing previews still need the main character's consented scopes and known game examples. See [requirements-matrix.md](../requirements-matrix.md).
