# Stage 31 — update while the market worker is busy

## Installed-app reproduction

The installed 0.1.29 application discovered and downloaded 0.1.31. Its restart action then waited for all pending engine requests before asking the worker to back up SQLite. The live account's market calculation occupied that worker; the state request timed out and the update did not start. The installed bundle remained 0.1.29 and the previous update result stayed `failed` for 0.1.30.

## Fix

The update path now waits only for wallet and production ESI syncs, which can still be writing data from the main process. It terminates the market worker, rejects outstanding UI requests with an update-in-progress message, and backs up both live and DEMO databases from the main process using SQLite's backup API. SQLite rolls back any uncommitted worker transaction on termination. If snapshotting fails, the app starts a fresh worker and leaves the update available to retry.

## Verification

- `pnpm verify:all`: PASS, 112 unit, 38 integration, and 4 desktop E2E; 4 opt-in live/performance/packaged tests skipped.
- macOS arm64 package and packaged smoke: pending.
- GitHub CI and release publication: pending.
- Second real update in `/Applications/EVE Trader.app` from installed 0.1.29: pending.
