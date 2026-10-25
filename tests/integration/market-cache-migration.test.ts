import { expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { Store } from "../../db/store";
import { migrateMarketCache, retireLegacyMarketData } from "../../db/market-cache";
import { seedDemo } from "../../engine/market/demo";
import { readStatic } from "../../engine/market/static-data";
import { latestSnapshots } from "../../engine/market/snapshots";
import { EsiClient } from "../../engine/esi/client";
import { syncHistory } from "../../engine/history/history";

it("migrates a verified weekly cache from a consistent backup and retries after interruption", async () => {
  const directory = mkdtempSync(resolve(".cache/market-cache-migration-"));
  const portfolioPath = join(directory, "portfolio.sqlite");
  const cachePath = join(directory, "market-cache.sqlite");
  const now = Date.parse("2026-10-24T12:00:00.000Z");
  const source = new Store(portfolioPath, resolve("db/migrations"));
  seedDemo(source);
  const historyInsert = source.sql.prepare(
    "INSERT INTO regional_history VALUES (?,?,?,?,?)",
  );
  for (let day = 17; day <= 23; day++) {
    const date = `2026-10-${day}`;
    historyInsert.run(
      "34",
      "10000002",
      date,
      JSON.stringify({ date, volume: 100, average: "10", lowest: "9", highest: "11", order_count: 2 }),
      "2026-10-24T00:00:00.000Z",
    );
  }
  source.sql.prepare("INSERT INTO deals VALUES (?,?,?,?,?,?,?,?,?)").run(
    "preserved-trade",
    "source",
    "destination",
    "SELECTED",
    "90000001",
    JSON.stringify([{ id: "evidence-1", snapshotIds: ["demo-10000002"], price: "100" }]),
    "2026-10-01T00:00:00.000Z",
    null,
    "highsec",
  );
  source.sql
    .prepare("INSERT INTO deal_lines VALUES (?,?,?,?,?)")
    .run("line-1", "preserved-trade", "34", 2, "Tritanium");
  source.sql
    .prepare("INSERT INTO budget_reservations VALUES (?,?,?,?,?,?)")
    .run("reservation-1", "preserved-trade", "34", "purchase", "200", 1);
  source.sql
    .prepare("INSERT INTO wallet_transactions VALUES (?,?,?,?,?)")
    .run("market", "90000002", "tx-1", JSON.stringify({ amount: "-200", date: "2026-10-01T00:00:00Z" }), "2026-10-01T00:00:00Z");
  source.sql
    .prepare("INSERT INTO purchase_lots VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run("lot-1", "preserved-trade", "34", "90000002", "tx-1", "2026-10-01T00:00:00Z", 2, 2, "100", "60003760", "confirmed");
  const before = {
    deal: source.sql.prepare("SELECT * FROM deals WHERE id=?").get("preserved-trade"),
    lines: source.sql.prepare("SELECT * FROM deal_lines WHERE deal_id=?").all("preserved-trade"),
    reservations: source.sql.prepare("SELECT * FROM budget_reservations WHERE deal_id=?").all("preserved-trade"),
    transactions: source.sql.prepare("SELECT * FROM wallet_transactions WHERE id=?").all("tx-1"),
    lots: source.sql.prepare("SELECT * FROM purchase_lots WHERE deal_id=?").all("preserved-trade"),
  };
  source.close();

  try {
    await expect(
      migrateMarketCache(portfolioPath, cachePath, {
        now,
        minimumFreeBytes: 0,
        failAfterCopy: true,
      }),
    ).rejects.toThrow("Тестовый сбой после сборки временного кеша");
    expect(existsSync(cachePath)).toBe(false);
    expect(existsSync(cachePath + ".tmp")).toBe(true);

    const migrated = await migrateMarketCache(portfolioPath, cachePath, {
      now,
      minimumFreeBytes: 0,
    });
    expect(migrated.status).toBe("migrated");
    expect(existsSync(migrated.backupPath!)).toBe(true);
    expect(existsSync(migrated.manifestPath)).toBe(true);
    expect(migrated.counts.generations).toBeGreaterThan(0);
    expect(migrated.counts.orders).toBeGreaterThan(0);
    expect(migrated.counts.types).toBeGreaterThan(0);

    const splitStore = new Store(portfolioPath, resolve("db/migrations"), {
      marketCachePath: cachePath,
    });
    try {
      expect(splitStore.sql).not.toBe(splitStore.market);
      expect(readStatic(splitStore)?.version).toBe("DEMO-1");
      expect(latestSnapshots(splitStore, ["10000002"]).length).toBe(1);
      expect(splitStore.sql.prepare("SELECT id FROM deals WHERE id=?").get("preserved-trade")).toBeDefined();
      const historyClient = new EsiClient(async () => new Response(JSON.stringify([{
        date: "2026-10-23",
        volume: 100,
        order_count: 2,
        average: 10,
        lowest: 9,
        highest: 11,
      }]), { status: 200, headers: { Expires: "Sat, 24 Oct 2026 12:01:00 GMT", "X-Pages": "1" } }));
      await syncHistory(splitStore, historyClient, "34", "10000002", () => now);
      expect(splitStore.market.prepare("SELECT value FROM market_sync_cursors WHERE key='history-revision'").get()).toEqual({ value: new Date(now).toISOString() });
    } finally {
      splitStore.close();
    }

    expect(retireLegacyMarketData(portfolioPath, cachePath)).toBe(true);
    expect(retireLegacyMarketData(portfolioPath, cachePath)).toBe(false);
    const retired = new Store(portfolioPath, resolve("db/migrations"), { readonly: true });
    try {
      expect(retired.sql.prepare("SELECT count(*) n FROM market_orders").get()).toEqual({ n: 0 });
      expect(retired.sql.prepare("SELECT count(*) n FROM regional_history").get()).toEqual({ n: 0 });
      expect(retired.sql.prepare("SELECT count(*) n FROM production_projects").get()).toEqual({ n: 0 });
      expect(retired.sql.prepare("SELECT * FROM deals WHERE id=?").get("preserved-trade")).toEqual(before.deal);
      expect(retired.sql.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(retired.sql.pragma("foreign_key_check")).toEqual([]);
    } finally {
      retired.close();
    }

    const cache = new Database(cachePath, { readonly: true });
    try {
      const dates = cache
        .prepare("SELECT min(date) first,max(date) last,count(*) n FROM regional_history")
        .get() as { first: string; last: string; n: number };
      expect(dates.first).toBe("2026-10-17");
      expect(dates.last).toBe("2026-10-23");
      expect(dates.n).toBeGreaterThan(0);
      expect(
        cache
          .prepare("SELECT count(*) n FROM opportunities")
          .get(),
      ).toEqual({ n: 0 });
      expect(cache.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(cache.pragma("foreign_key_check")).toEqual([]);
    } finally {
      cache.close();
    }

    const idempotent = await migrateMarketCache(portfolioPath, cachePath, {
      now,
      minimumFreeBytes: 0,
    });
    expect(idempotent.status).toBe("already_migrated");
    rmSync(cachePath);

    const unchanged = new Store(portfolioPath, resolve("db/migrations"), { readonly: true });
    try {
      expect(unchanged.sql.prepare("SELECT * FROM deals WHERE id=?").get("preserved-trade")).toEqual(before.deal);
      expect(unchanged.sql.prepare("SELECT * FROM deal_lines WHERE deal_id=?").all("preserved-trade")).toEqual(before.lines);
      expect(unchanged.sql.prepare("SELECT * FROM budget_reservations WHERE deal_id=?").all("preserved-trade")).toEqual(before.reservations);
      expect(unchanged.sql.prepare("SELECT * FROM wallet_transactions WHERE id=?").all("tx-1")).toEqual(before.transactions);
      expect(unchanged.sql.prepare("SELECT * FROM purchase_lots WHERE deal_id=?").all("preserved-trade")).toEqual(before.lots);
      expect(unchanged.sql.prepare("SELECT * FROM sync_cursors WHERE key='market-cache-detached'").get()).toEqual({ key: "market-cache-detached", value: "true" });
    } finally {
      unchanged.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("fails before writing a backup if disk reserve is insufficient", async () => {
  const directory = mkdtempSync(resolve(".cache/market-cache-space-"));
  const portfolioPath = join(directory, "portfolio.sqlite");
  const source = new Store(portfolioPath, resolve("db/migrations"));
  source.close();
  try {
    await expect(
      migrateMarketCache(portfolioPath, join(directory, "market-cache.sqlite"), {
        minimumFreeBytes: Number.MAX_SAFE_INTEGER,
      }),
    ).rejects.toThrow("Недостаточно свободного места");
    expect(readdirSync(directory).some((name) => name.includes("before-market-cache"))).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
