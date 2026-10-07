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
import { seedDemo } from "../../engine/market/demo";
import { importStatic, type StaticData } from "../../engine/market/static-data";
test("stage 9: full saved regional dataset, local filter latency and renderer responsiveness", async () => {
  test.skip(
    process.env.EVE_BENCHMARK !== "1" || !existsSync(".cache/benchmark.sqlite"),
    "Opt-in saved public snapshot, see scripts/benchmark.ts",
  );
  const directory = mkdtempSync(join(tmpdir(), "eve-perf-"));
  copyFileSync(".cache/benchmark.sqlite", join(directory, "demo.sqlite"));
  const store = new Store(
    join(directory, "demo.sqlite"),
    resolve("db/migrations"),
  );
  seedDemo(store);
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
      EVE_DEMO: "1",
      EVE_USER_DATA: directory,
    },
  });
  try {
    const page = await app.firstWindow();
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
    expect(uiFilterMs).toBeLessThanOrEqual(300);
    expect(metrics.filterMs).toBeLessThanOrEqual(300);
    expect(metrics.maxRendererGapMs).toBeLessThan(1000);
    await page.screenshot({ path: "test-results/real-regional-market.png" });
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
