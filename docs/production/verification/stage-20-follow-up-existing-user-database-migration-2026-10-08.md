# Stage 20 follow-up — existing install database migration

Date: 2026-10-08 (Asia/Ho_Chi_Minh). Tested code: `22796b9`.

## Verification method

The currently installed EVE Trader database was inspected read-only. It uses SQLite schema v2 and contains 3 characters, 6 deals, 39 deal events, 346 wallet transactions, 674 wallet journal rows, 2 purchase lots and 1 sale allocation. The source database and its WAL were not changed.

A consistent SQLite backup was made in a temporary directory. The exact `Store` migration code then migrated that copy from v2 to v12 and created the normal pre-migration rollback copy. Both copies were checked independently.

## Results

| Check | Result |
|---|---|
| Migration v2 → v12 | PASS — `scopes` column exists; all checked source row counts are unchanged. |
| Migrated database `PRAGMA integrity_check` | PASS — `ok`. |
| Migrated database `PRAGMA foreign_key_check` | PASS — no rows. |
| Pre-migration rollback copy integrity | PASS — `ok`; version remains v2 and all checked counts match the source. |
| Original installed database after test | PASS — still v2 with the same checked counts. |

The temporary migration copies and compiled helper were removed after verification. This proves SQLite migration compatibility for the currently installed schema and dataset size. It does not install the new app, perform private ESI requests, or certify the user's live production-account permissions.
