import { it, expect } from "vitest";
import { resolve } from "node:path";
import { Store } from "../../db/store";
import { seedDemo } from "../../engine/market/demo";
import { demoScan } from "../fixtures/demo-scan";
import { Trades } from "../../engine/portfolio/trades";
import { readStatic } from "../../engine/market/static-data";
import {
  Alerts,
  retain,
  analysisExport,
  saveFeatures,
} from "../../engine/background/maintenance";
import { Scheduler } from "../../engine/esi/scheduler";
it("stage 8: threshold, dedup and cooldown do not announce unchanged snapshots", () => {
  const s = new Store(":memory:", resolve("db/migrations"));
  try {
    seedDemo(s);
    const offers = demoScan(s);
    let now = 0;
    const a = new Alerts(() => now, 1000);
    expect(a.select(offers, "999999999999")).toHaveLength(0);
    expect(a.select(offers, "0").length).toBeGreaterThan(0);
    now = 2000;
    expect(a.select(offers, "0")).toHaveLength(0);
    const changed = structuredClone(offers);
    for (const o of changed) {
      o.buy.result.profit = "999999999";
      o.sell.profit = "999999999";
    }
    expect(a.select(changed, "0").length).toBeGreaterThan(0);
  } finally {
    s.close();
  }
});
it("stage 8: retention preserves financial records and exports separate immutable features/outcomes without credentials", () => {
  const s = new Store(":memory:", resolve("db/migrations"));
  try {
    seedDemo(s);
    const offers = demoScan(s);
    new Trades(s, () => readStatic(s)).accept("deal", [offers[0]]);
    saveFeatures(s, offers);
    const before = s.sql.prepare("SELECT forecast FROM deals").get();
    s.sql
      .prepare("INSERT INTO sync_cursors VALUES (?,?)")
      .run("secret-token", "NEVER_EXPORT");
    retain(s, Date.parse("2030-01-01"));
    const exported = analysisExport(s);
    expect(exported.deals[0].outcome).toBe("unfinished");
    expect(JSON.stringify(exported)).not.toContain("NEVER_EXPORT");
    expect(s.sql.prepare("SELECT forecast FROM deals").get()).toEqual(before);
    expect(s.sql.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(s.sql.pragma("foreign_key_check")).toEqual([]);
    expect(exported.features).toHaveLength(0);
    expect(exported.deals[0].forecast[0].features).toBeDefined();
  } finally {
    s.close();
  }
});
it("stage 8: resume staggers due work instead of releasing all jobs", async () => {
  let clock = 1000;
  const scheduler = new Scheduler(
    () => clock,
    () => 0,
    2,
  );
  let calls = 0;
  for (let i = 0; i < 20; i++)
    scheduler.schedule(String(i), 2, 0, async () => {
      calls++;
      return clock + 60000;
    });
  scheduler.suspend();
  await scheduler.tick();
  expect(calls).toBe(0);
  clock += 60000;
  scheduler.resume();
  await scheduler.tick();
  expect(calls).toBe(1);
  clock += 1000;
  await scheduler.tick();
  expect(calls).toBe(2);
});
