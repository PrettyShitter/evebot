import { it, expect } from "vitest";
import { build } from "esbuild";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { Store } from "../../db/store";
import { seedDemo } from "../../engine/market/demo";
import type { AppState } from "../../shared/contracts/app";
it("live engine responds while a separate readonly calculator runs and recomputes filters", async () => {
  mkdirSync(".cache", { recursive: true });
  const dir = mkdtempSync(resolve(".cache/worker-test-"));
  const db = new Store(join(dir, "portfolio.sqlite"), resolve("db/migrations"));
  seedDemo(db);
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
    for (let i = 0; i < 100 && !state.opportunities.length; i++) {
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
    expect(state.market.calculation.busy).toBe(true);
    expect(state.market.calculation.phase).toBe("Применение фильтров");
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
      if (!state.market.status.includes("Расчёт")) break;
    }
    expect(state.opportunities).toHaveLength(0);
    expect(state.market.status).not.toContain("Расчёт");
    expect(state.market.calculation.revision).toBeGreaterThan(beforeFilter);
  } finally {
    await worker.terminate();
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);
