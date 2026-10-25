# Stage 04 — weekly history model

Status: **PARTIAL PASS**. New reads and writes use the seven completed UTC calendar days and `weekly_v1`; retention runs against `market-cache.sqlite`. The old history remains only in the retained pre-migration backup, not in the active cache tables.

## Changes

- `syncHistory()` accepts an injectable clock, keeps only D−7 through D−1 from the full ESI response, excludes D, and advances a history revision after a successful response.
- Cache maintenance deletes history before the UTC week boundary, bounds station observations to seven days, and expires derived features/offers after a short retention.
- The shared weekly summary records observed/missing/active days, weekly volume, median daily volume and price, volume-weighted price, weekly price range, and half-week price/volume movement. Missing dates stay missing; they are not synthesized as zero.
- Liquidity and candidate ranking consume `weekly_v1`; old 30/90-day windows were removed from the active opportunity calculation and market labels.
- The calculator scopes station observations, sale observations, regional history, and its cached result key to the same completed UTC week. The main and calculator workers now use the same cache-key layout, including the weekly range and history revision. A mismatch had caused the main worker to launch the same calculation again on each state poll.
- Added deterministic fake-clock tests for UTC boundaries, missing days, independent expected values, and long ESI responses.

## Verification

```text
pnpm test:unit                                           PASS — 24 files, 115 tests
pnpm test:integration                                    PASS — 16 files, 44 tests (latest regression run includes stage 03 cache changes)
pnpm lint                                               PASS
pnpm typecheck                                          PASS
pnpm build                                              PASS
pnpm test:e2e                                           PASS — 4 tests; 1 opt-in performance benchmark skipped
pnpm vitest run tests/integration/worker-calculation.test.ts PASS — 0.2 s after key fix
```

The isolated worker test previously remained in “preparing” and repeatedly spawned a completed calculation because the parent and calculation worker produced different keys. After aligning the key, the same test passes in 0.2 seconds. This is a deterministic fixture result, not a live ESI measurement.

## Remaining gate

- The current user database was copied through SQLite backup and the copy passed full integrity checks, migration, portfolio-detachment, and ledger digest comparison. The real file was never opened for write, vacuumed, or migrated. The full `quick_check` on the original file remains unverified.
- No current-week source history existed in the copied database; coverage remains unknown/empty until fresh ESI history arrives.
