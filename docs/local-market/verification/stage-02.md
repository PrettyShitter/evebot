# Stage 02 — split databases and migration recovery

Status: **PARTIAL PASS**. The app now opens market data from a separate `market-cache.sqlite`; final destructive recovery/crash cases and packaged startup still need verification.

## Implemented in this increment

- Added `market-cache.sqlite` schema for reference data, published market generations/orders, weekly regional history, seven-day observations, derived opportunities, model metadata, and market-only sync cursors.
- The cache schema is now version 2 and adds a bounded persistent public-ESI response cache (compressed bodies, validators, expiry, page count); opening an existing version-1 market cache upgrades it in place.
- Added an offline migration routine that takes a SQLite online backup (including committed WAL state), validates the backup, builds a separate `.tmp` cache, copies only the latest completed generation per region and completed-week history, omits old derived scores, validates counts/integrity/foreign keys, and atomically renames the completed cache into place.
- The source portfolio is opened read-only while making a consistent online backup, then a unique pre-migration backup and JSON manifest are retained. Only after the new cache passes integrity checks, a separate idempotent transaction detaches the reconstructible market tables from the active portfolio; it preserves the finance/deal ledger and archive. Migration checks available disk space before beginning and leaves an incomplete temp cache safe to discard and rebuild.
- First launch shows a migration window and runs backup/copy/verification in a dedicated worker, not the renderer or Electron main event loop. Once the new cache passes integrity checks, the worker drops and recreates only duplicate market-cache tables in the portfolio; it retains SDE reference tables, all deals, wallet evidence, allocations, settings, and the retired production archive. A durable marker makes this step idempotent.
- The collector, market services, calculator, feature store and retention now use the separate cache connection. The calculator opens it read-only. `portfolio.sqlite` remains the only writer for wallet/deal/FIFO data. Restoring a portfolio parks the old disposable cache and rebuilds it from the restored portfolio; an unusable cache is preserved aside and rebuilt.
- `Trades.accept()` stores the full immutable forecast JSON with deal lines/reservations in one portfolio transaction. The migration test deletes the separate cache after migration and confirms the durable deal, wallet transaction, purchase lot, reservations and production project archive remain.

## Checks run

```text
pnpm vitest run tests/integration/market-cache-migration.test.ts tests/integration/weekly-history-sync.test.ts tests/unit/weekly-history.test.ts
PASS — 3 files, 6 tests
pnpm test:unit                                           PASS — 24 files, 115 tests
pnpm test:integration                                    PASS — 16 files, 42 tests
pnpm lint                                               PASS
pnpm typecheck                                          PASS
pnpm build                                              PASS
pnpm test:e2e                                           PASS — 4 passed; 1 opt-in benchmark skipped
```

An additional copy-only migration used a consistent backup of the available 3.1-GiB user database. It migrated 12 latest complete generations and 605,988 orders into a 313,503,744-byte cache. The current completed-week history and seven-day observations were both absent in the source, so the new cache correctly contained zero rows for them. Financial/deal/archive-table SHA-256 digests matched before and after the detached-cache cleanup; the source file's size and modification time were unchanged. The target passed full `integrity_check` and `foreign_key_check` (0 failures). The temporary QA copies were removed after recording these results.

The migration fixture injects a failure after building the temp cache, confirms no final cache is published, retries successfully, verifies seven-day dates and SQLite integrity/FKs, checks idempotent re-entry, and confirms the original deal/ledger and market rows are unchanged. A separate test verifies insufficient free space fails before producing a backup.

## Remaining before gate

- Exercise first-launch migration in a packaged Electron build, plus restore and offline cache-rebuild UX. The migration routine itself was exercised on a large user-database copy; the actual user's file was not migrated or rewritten.
- Expand fault injection to crash after backup, during copy, after atomic publish, and during portfolio cache detachment; test deliberate cache deletion/rebuild from the detached portfolio.
- Validate cold/warm launch and app-update backup/restore behavior with the split database. No live ESI requests were made during this database migration test.
