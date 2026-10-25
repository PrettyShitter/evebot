import { it, expect } from "vitest";
import { build } from "esbuild";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { Store } from "../../db/store";
import { seedDemo } from "../../engine/market/demo";
import { completedWeekRange } from "../../engine/history/history";
import type { AppState } from "../../shared/contracts/app";
it("live engine filters ready offers instantly while recalculating structural changes in a worker", async () => {
  mkdirSync(".cache", { recursive: true });
  const dir = mkdtempSync(resolve(".cache/worker-test-"));
  const db = new Store(join(dir, "portfolio.sqlite"), resolve("db/migrations"));
  seedDemo(db);
  // The worker runs against wall-clock UTC, so move only this isolated fixture
  // into its active completed week; the packaged demo remains pinned to DEMO_TIME.
  const range = completedWeekRange(Date.now());
  const historyPairs = db.sql.prepare(
    "SELECT DISTINCT type_id,region_id FROM regional_history",
  ).all() as { type_id: string; region_id: string }[];
  const historySources = historyPairs.flatMap((pair) => {
    const source = db.sql.prepare(
      "SELECT payload,available_at FROM regional_history WHERE type_id=? AND region_id=? ORDER BY date DESC LIMIT 1",
    ).get(pair.type_id, pair.region_id) as { payload: string; available_at: string } | undefined;
    return source ? [{ ...pair, ...source }] : [];
  });
  const historyInsert = db.sql.prepare(
    "INSERT INTO regional_history(type_id,region_id,date,payload,available_at) VALUES (?,?,?,?,?)",
  );
  db.sql.prepare("DELETE FROM regional_history").run();
  for (const source of historySources) {
    const payload = JSON.parse(source.payload) as { date: string };
    for (let day = 0; day < 7; day++) {
      const date = new Date(Date.parse(`${range.start}T00:00:00Z`) + day * 86_400_000)
        .toISOString().slice(0, 10);
      historyInsert.run(
        source.type_id,
        source.region_id,
        date,
        JSON.stringify({ ...payload, date }),
        source.available_at,
      );
    }
  }
  db.sql.prepare("INSERT INTO sync_cursors VALUES ('seller-profile',?)").run(
    JSON.stringify({
      skills: [],
      standings: [],
      queue: [],
      at: new Date().toISOString(),
    }),
  );
  db.close();
  await build({
    entryPoints: {
      worker: "engine/worker.ts",
      calculator: "engine/calculator.ts",
    },
    outdir: dir,
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["better-sqlite3"],
  });
  const worker = new Worker(join(dir, "worker.cjs"), {
    workerData: {
      directory: dir,
      migrations: resolve("db/migrations"),
      resources: resolve("resources"),
      demo: false,
      offline: true,
    },
  });
  const [ready] = await once(worker, "message");
  expect(ready).toEqual({ kind: "ready" });
  const request = async (request: unknown) => {
    const response = once(worker, "message");
    worker.postMessage({ id: "test", request });
    const [result] = await response;
    if (result.error) throw Error(result.error);
    return result.value as AppState;
  };
  try {
    const first = await request({ kind: "state" });
    expect(first.market.status).toContain("Расчёт");
    let state = first;
    for (
      let i = 0;
      i < 100 &&
      (!state.opportunities.length ||
        state.market.calculation.total === 0 ||
        state.market.calculation.busy);
      i++
    ) {
      await new Promise((r) => setTimeout(r, 20));
      state = await request({ kind: "state" });
    }
    expect(state.opportunities.length).toBeGreaterThan(0);
    expect(state.market.calculation.total).toBeGreaterThan(0);
    expect(state.market.calculation.processed).toBe(
      state.market.calculation.total,
    );
    const beforeFilter = state.market.calculation.revision;
    state = await request({
      kind: "settings.save",
      value: {
        ...state.settings,
        sort: state.settings.sort === "best" ? "buy" : "best",
      },
    });
    expect(state.market.calculation.busy).toBe(false);
    expect(state.market.calculation.revision).toBe(beforeFilter);
    expect(state.opportunities.length).toBeGreaterThan(0);
    const shownOffer = state.opportunities[0];
    const selectedState = await request({
      kind: "deal.accept",
      id: "5d3775d5-9b66-4a67-a728-92784fb44836",
      items: [{ id: shownOffer.id, quantity: shownOffer.quantity }],
    });
    expect(
      selectedState.deals.some(
        (deal) => deal.id === "5d3775d5-9b66-4a67-a728-92784fb44836",
      ),
    ).toBe(true);
    state = await request({
      kind: "settings.save",
      value: { ...state.settings, minProfit: "999999999999" },
    });
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 20));
      state = await request({ kind: "state" });
      if (
        !state.market.status.includes("Расчёт") &&
        state.market.calculation.revision > beforeFilter
      )
        break;
    }
    expect(state.opportunities).toHaveLength(0);
    expect(state.market.status).not.toContain("Расчёт");
    expect(state.market.calculation.revision).toBeGreaterThan(beforeFilter);
  } finally {
    await worker.terminate();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
