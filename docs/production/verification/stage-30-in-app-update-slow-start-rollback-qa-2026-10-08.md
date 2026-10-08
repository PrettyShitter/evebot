# Stage 30 follow-up — in-app update slow-start rollback

## Reproduction in the installed application

- Installed version `0.1.29` found the published `0.1.30` release and downloaded its signed update manifest and archive from GitHub.
- The update helper backed up the local portfolio database and launched the replacement app. The real account has three connected characters and a large saved market database.
- The app's health marker was written only after the first full market state request returned. That request remained in the market calculation and timed out; the helper's 60-second health window expired and restored the previous app and database.
- Verified that `/Applications/EVE Trader.app` remained `0.1.29` and the updater recorded `failed` for `0.1.30`. The prior app and its database were restored; no portfolio data was lost.

## Fix

- The engine now emits a `ready` message after opening/migrating SQLite and loading bundled static data, before starting live market work.
- When an update launches with its token, the main process acknowledges health after the window is loaded and the worker reports database readiness, before requesting the potentially long initial market state.
- The updater helper allows up to 180 seconds for the replacement process to initialize the local database, preserving rollback for actual boot failures while tolerating slower migrations.
- Worker integration tests assert the readiness message, and the packaged macOS smoke launches with an update token and verifies the versioned healthy marker.

## Verification

- `pnpm lint` and `pnpm typecheck` pass.
- Worker calculation and production sync integration tests pass.
- Local arm64 macOS package builds; packaged smoke passes with code-signature integrity, healthy update acknowledgement, SQLite startup, tray behavior, and restart persistence.
- GitHub macOS/Windows CI and a second install through the actual installed app are pending for version `0.1.31`.
