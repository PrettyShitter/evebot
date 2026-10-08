import { test, expect, _electron as electron } from "@playwright/test";
import {
  mkdtempSync,
  rmSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../../db/store";
import { importStatic, type StaticData } from "../../engine/market/static-data";
import { Portfolio } from "../../engine/portfolio/repository";
test("stage 9: full saved regional dataset, local filter latency and renderer responsiveness", async () => {
  test.skip(
    process.env.EVE_BENCHMARK !== "1" || !existsSync(".cache/benchmark.sqlite"),
    "Opt-in saved public snapshot, see scripts/benchmark.ts",
  );
  const directory = mkdtempSync(join(tmpdir(), "eve-perf-"));
  copyFileSync(".cache/benchmark.sqlite", join(directory, "portfolio.sqlite"));
  const store = new Store(
    join(directory, "portfolio.sqlite"),
    resolve("db/migrations"),
  );
  importStatic(
    store,
    JSON.parse(
      readFileSync("resources/static-data.json", "utf8"),
    ) as StaticData,
  );
  store.saveSettings({
    ...store.getSettings(),
    minProfit: "0",
    minROI: 0,
    roiEnabled: false,
  });
  const observedAt = new Date().toISOString();
  const portfolio = new Portfolio(store);
  portfolio.connect("90000001", "Benchmark Main", true);
  portfolio.connect("90000002", "Benchmark Buyer Two", false);
  portfolio.connect("90000003", "Benchmark Buyer Three", false);
  portfolio.importWallets(
    ["600000000", "250000000", "150000000"].map((balance, index) => ({
      id: String(90000001 + index),
      balance,
      transactions: [],
      journal: [],
      modified: observedAt,
      expires: 0,
    })),
    [],
    observedAt,
  );
  store.sql.prepare(
    "INSERT INTO sync_cursors(key,value) VALUES ('seller-profile',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(JSON.stringify({
    race: "Gallente",
    skills: ["16622", "3446", "16597"].map((skill_id) => ({
      skill_id,
      trained_skill_level: 5,
      active_skill_level: 5,
    })),
    standings: [],
    queue: [],
    at: observedAt,
  }));
  const snapshot = store.sql.prepare(
    "SELECT id FROM market_snapshot_runs WHERE region_id='10000002' AND status='complete' AND id NOT LIKE 'demo-%' ORDER BY completed_at DESC LIMIT 1",
  ).get() as { id: string } | undefined;
  if (!snapshot) throw Error("Benchmark fixture has no complete The Forge market snapshot");
  store.sql.prepare("UPDATE market_snapshot_runs SET modified_at=?,expires_at=? WHERE id=?")
    .run(observedAt, new Date(Date.now() + 60 * 60 * 1000).toISOString(), snapshot.id);
  store.sql.prepare(
    `INSERT INTO production_character_profiles(character_id,race,clone_profile,skills_payload,standings_payload,skill_queue_payload,observed_at,source)
     VALUES ('90000001','Gallente','alpha',?,?,? ,?,'manual')`,
  ).run(
    JSON.stringify([{ skill_id: "3380", trained_skill_level: 5, active_skill_level: 5 }]),
    JSON.stringify([]),
    JSON.stringify([]),
    observedAt,
  );
  store.sql.prepare(
    `INSERT INTO production_facility_profiles(location_id,name,system_id,facility_kind,services_payload,industry_tax,access_status,profile_source,evidence,observed_at)
     VALUES ('60003760','Jita IV benchmark facility','30000142','npc_station','["manufacturing"]','0.0025','confirmed','manual','Synthetic QA profile',?)`,
  ).run(observedAt);
  store.sql.prepare(
    "INSERT INTO production_blueprint_instances(item_id,character_id,blueprint_type_id,location_id,location_flag,quantity,material_efficiency,time_efficiency,runs,observed_at,source) VALUES ('benchmark-rifter-bpo','90000001','691','60003760','Hangar',1,10,20,-1,?,'manual')",
  ).run(observedAt);
  store.sql.prepare("INSERT INTO production_system_indices(system_id,activity,cost_index,observed_at) VALUES ('30000142','manufacturing','0.01',?) ON CONFLICT(system_id,activity) DO UPDATE SET cost_index=excluded.cost_index,observed_at=excluded.observed_at")
    .run(observedAt);
  const adjustedPrices = new Map([["34", "3.6"], ["35", "15.5"], ["36", "45"], ["37", "152"], ["587", "200000"]]);
  const adjustedInsert = store.sql.prepare("INSERT INTO production_adjusted_prices(type_id,adjusted_price,observed_at) VALUES (?,?,?) ON CONFLICT(type_id) DO UPDATE SET adjusted_price=excluded.adjusted_price,observed_at=excluded.observed_at");
  for (const [typeId, price] of adjustedPrices) adjustedInsert.run(typeId, price, observedAt);
  const orderInsert = store.sql.prepare("INSERT INTO market_orders(generation,id,type_id,location_id,payload) VALUES (?,?,?,?,?)");
  const benchmarkOrders = [
    { typeId: "587", buy: true, price: "750000", quantity: 100, locationId: "60003757" },
    { typeId: "587", buy: false, price: "500000", quantity: 100, locationId: "60003760" },
    ...[["34", "1"], ["35", "2"], ["36", "3"], ["37", "4"]].map(([typeId, price]) => ({ typeId, buy: false, price, quantity: 10_000_000, locationId: "60003760" })),
  ];
  for (const [index, order] of benchmarkOrders.entries()) {
    const orderId = `benchmark-production-${index}`;
    orderInsert.run(snapshot.id, orderId, order.typeId, order.locationId, JSON.stringify({
      order_id: orderId,
      type_id: order.typeId,
      location_id: order.locationId,
      system_id: "30000142",
      price: order.price,
      is_buy_order: order.buy,
      volume_remain: order.quantity,
      volume_total: order.quantity,
      min_volume: 1,
      range: "station",
      duration: 90,
      issued: observedAt,
    }));
  }
  store.sql
    .prepare("DELETE FROM market_snapshot_runs WHERE id LIKE 'demo-%'")
    .run();
  store.sql.prepare("DELETE FROM regional_history").run();
  store.close();
  const app = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      EVE_OFFLINE: "1",
      EVE_DEMO: "0",
      EVE_USER_DATA: directory,
    },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText("Локальный портфель")).toBeVisible();
    await expect(page.getByText("DEMO", { exact: true })).toHaveCount(0);
    // A visible table header must not count as a market result.
    await expect(page.locator("button.market-row.data-row").first()).toBeVisible({
      timeout: 25000,
    });
    const initialRows = await page.locator("button.market-row.data-row").count();
    expect(initialRows).toBeGreaterThan(0);
    const uiStarted = await page.evaluate(() => performance.now());
    const roiFilter = page.getByLabel("Минимальный ROI");
    await roiFilter.fill("30");
    await roiFilter.blur();
    await expect(page.locator(".caption").filter({ hasText: "ROI от 30%" })).toBeVisible();
    const uiFilterMs =
      (await page.evaluate(() => performance.now())) - uiStarted;
    const metrics = await page.evaluate(async () => {
      const gaps: number[] = [];
      let last = performance.now();
      const timer = setInterval(() => {
        const now = performance.now();
        gaps.push(now - last);
        last = now;
      }, 16);
      const stateStarted = performance.now();
      const s = await window.eve.request({ kind: "state" });
      const stateMs = performance.now() - stateStarted;
      const stateJsonBytes = new Blob([JSON.stringify(s)]).size;
      const started = performance.now();
      const result = await window.eve.request({
        kind: "settings.save",
        value: {
          ...s.settings,
          minProfit: "1000000",
          roiEnabled: true,
          minROI: 30,
        },
      });
      const filterMs = performance.now() - started;
      // Trigger a full market recomputation while the renderer continues running.
      await window.eve.request({
        kind: "settings.save",
        value: {
          ...result.settings,
          relistPerDay:
            result.settings.relistPerDay === 24
              ? 23
              : result.settings.relistPerDay + 1,
        },
      });
      clearInterval(timer);
      return {
        filterMs,
        stateMs,
        stateJsonBytes,
        maxRendererGapMs: Math.max(...gaps),
        offersBefore: s.opportunities.length,
        offersAfter: result.opportunities.length,
        productionOffers: s.production.offers.length,
        productionCandidates: s.production.offers.map((offer) => offer.itemName),
        productionReadiness: {
          main: s.characters.find((character) => character.isSeller)?.id ?? null,
          manufacturingRecipes: s.production.manufacturingRecipes,
          facilityOptions: s.production.facilityOptions.map((facility) => facility.id),
          facilityProfiles: s.production.facilityProfiles.map((facility) => ({ id: facility.id, services: facility.services, accessStatus: facility.accessStatus })),
          blueprints: s.production.manufacturingOutputs.length,
          marketBpoCandidatesScanned: s.production.marketBpoCandidatesScanned,
          marketBpoCandidatesTotal: s.production.marketBpoCandidatesTotal,
          marketBpoScanComplete: s.production.marketBpoScanComplete,
        },
      };
    });
    const stateTimings = readFileSync(
      join(directory, "benchmark-state.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, number>);
    writeFileSync(
      "docs/verification/renderer-benchmark.json",
      JSON.stringify(
        { at: new Date().toISOString(), uiFilterMs, stateTimings, ...metrics },
        null,
        2,
      ),
    );
    console.log("Regional market benchmark", {
      uiFilterMs,
      stateTimings,
      ...metrics,
    });
    expect(initialRows).toBeGreaterThan(0);
    expect(metrics.offersAfter).toBeGreaterThanOrEqual(0);
    expect(metrics.productionOffers).toBeGreaterThan(0);
    expect(metrics.productionCandidates).toContain("Rifter");
    expect(metrics.productionReadiness.marketBpoCandidatesTotal).toBeGreaterThan(40);
    expect(metrics.productionReadiness.marketBpoCandidatesScanned).toBeGreaterThan(0);
    expect(metrics.productionReadiness.marketBpoScanComplete).toBe(false);
    expect(uiFilterMs).toBeLessThanOrEqual(300);
    expect(metrics.filterMs).toBeLessThanOrEqual(300);
    expect(metrics.maxRendererGapMs).toBeLessThan(1000);
    await page.screenshot({ path: "test-results/real-regional-market.png" });
    await page.getByRole("tab", { name: "Производство" }).click();
    await expect(page.locator('[aria-label="Производственные предложения"]').getByText("Rifter").first()).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "В фоне анализируются рыночные BPO" })).toBeVisible();
    await page.locator('[aria-label="Производственные предложения"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/production-large-market-benchmark.png" });
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
