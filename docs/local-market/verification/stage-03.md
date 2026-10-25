# Stage 03 — background collector and ESI cache

Status: **PARTIAL PASS**. Packaged macOS testing now confirms close-to-tray, successful engine-worker state requests while hidden, show-from-tray, and persisted settings after relaunch. Live ESI collection while hidden, suspend/resume, and post-crash recovery still need separate verification.

## Changes

- `MarketService` owns the only public market scheduler/client in the engine worker. It is independent of renderer visibility; hiding the window leaves the engine worker alive. Explicit app quit terminates it; suspend/resume pauses and staggers queued requests.
- Added compressed `esi_response_cache` storage in `market-cache.sqlite` for public ESI responses only. The cache stores ETag, Last-Modified, Expires/max-age, page count, and gzip-compressed response JSON; stored bodies are capped at 128 MiB and metadata at 20,000 endpoint/page entries. Eviction drops the oldest bodies but retains validators; if ESI then answers 304 without a local body, the client retries once without validators to obtain the representation. Character-authenticated responses are memory-only and are never written to this shared cache.
- Version-1 market caches upgrade to schema version 2 when opened by the writer. Read-only calculator connections require the migrated version.
- On full regional 304 coverage, the collector updates expiry on the already published generation and deletes its empty staging row. It does not publish duplicate order payloads or rewrite observations. If any page changes, all page bodies are available (or fetched unconditionally after body eviction) before a new generation is published.
- Existing staging behavior still validates every page count and shared `Last-Modified`, rejects duplicate order IDs, leaves the prior complete generation visible on any failed page, and publishes only after all pages and observations have been persisted.
- Station observation upserts and the transition of a new market generation to `complete` now share one SQLite transaction. An observation write failure rolls back the partial observation batch and leaves the prior published generation intact.

## Verification

```text
pnpm vitest run tests/integration/sync.test.ts tests/integration/market-cache-migration.test.ts
PASS — 2 files, 13 tests
pnpm typecheck
PASS
pnpm lint
PASS
pnpm build
PASS
pnpm test:e2e
PASS — 4 passed, 1 opt-in benchmark skipped
pnpm dist:mac
PASS — packaged arm64 macOS app and installers built; ad-hoc signature only, not notarized
node scripts/packaged-smoke.mjs 'release/mac-arm64/EVE Trader.app/Contents/MacOS/EVE Trader'
PASS — hide-to-tray, state IPC while hidden, show, relaunch persistence
pnpm test:unit
PASS — 24 files, 115 tests
pnpm test:integration
PASS — 16 files, 44 tests
```

New fixtures use a new `EsiClient` instance against the same SQLite cache to simulate a process restart, verify that `If-None-Match` is sent, ESI returns 304, no second complete generation is created, and the original market order remains queryable. An injected station-write failure confirms observations roll back together with the publish state. Existing fixtures cover bounded pagination, mixed/failed page behavior, `Retry-After`, cache expiry and scheduler retry limits.

The packaged smoke evidence is saved in `docs/verification/packaged-darwin.json` and its screenshot. This is a disposable DEMO database and proves the app and worker remain responsive while the window is hidden; it does not prove live ESI refresh continues while hidden.

The official ESI guidance says not to refresh before `Expires`, describes ETag/If-None-Match 304 handling, and requires validating common `Last-Modified` across a paginated resource. ESI rate limits use route-group/user buckets where present and `Retry-After` on 429; error limits use separate `X-ESI-Error-Limit-*` headers. The app currently applies a shared conservative backoff rather than independently scheduling route buckets. Sources: [ESI Best Practices](https://developers.eveonline.com/docs/services/esi/best-practices/), [ESI Rate Limiting](https://developers.eveonline.com/docs/services/esi/rate-limiting/).

## Remaining gate

- If required, add a disposable-database live-market smoke that observes a public market refresh completing while the window remains hidden. Do not use the user's portfolio for this test.
- Add measured route-bucket scheduling using observed `X-Ratelimit-Group` headers; the current global backoff is safe but conservative when ESI rate-limits a single route.
- Perform read-only live ESI smoke only if the connected install is available; mock fixtures do not count as live validation.
- Add crash injection during multi-page fetch and process restart, then verify the old complete generation remains available and stale-state metadata remains visible.
