import { parentPort, workerData } from "node:worker_threads";
import { join } from "node:path";
import { Store } from "../db/store";
import { readStatic } from "./market/static-data";
import { scanOpportunities, filterOpportunities } from "./market/opportunities";
import { latestOrders, latestSnapshots } from "./market/snapshots";
import { stationProfile, type ProfileData } from "./portfolio/profile";
import { Portfolio } from "./portfolio/repository";
import { Trades } from "./portfolio/trades";
import { DEMO_TIME } from "./market/demo";
import type { HistoryDay } from "../shared/contracts/esi";
const config = workerData as {
  directory: string;
  migrations: string;
  demo: boolean;
};
const store = new Store(
  join(config.directory, config.demo ? "demo.sqlite" : "portfolio.sqlite"),
  config.migrations,
  { readonly: true },
);
const market = { data: readStatic(store) };
const portfolio = new Portfolio(store);
const trades = new Trades(store, () => market.data);
function calculate() {
  if (!market.data) throw Error("Static data unavailable");
  const snapshots = latestSnapshots(store, market.data.regions);
  const budget = portfolio.currentBudget();
  const settings = store.getSettings();
  const structural = {
    ...settings,
    minProfit: "0",
    minTripProfit: "0",
    roiEnabled: false,
    minROI: 0,
    sort: "best" as const,
    notificationThreshold: "0",
    sound: false,
  };
  const key = JSON.stringify([
    snapshots.map((s) => s.id),
    store.sql
      .prepare("SELECT value FROM sync_cursors WHERE key='history-revision'")
      .get(),
    structural,
    budget,
    [...trades.exposures()],
    store.sql.prepare("SELECT count(*) n FROM sale_allocations").get(),
    store.sql
      .prepare("SELECT value FROM sync_cursors WHERE key='seller-profile'")
      .get(),
  ]);
  const snapshot = latestOrders(
    store,
    market.data.regions,
    new Set(market.data.stations.map((station) => station.id)),
  );
  const raw = store.sql
    .prepare("SELECT value FROM sync_cursors WHERE key='seller-profile'")
    .get() as { value: string } | undefined;
  const profile = raw ? (JSON.parse(raw.value) as ProfileData) : null;
  const reservedDepth = trades.reservedDepth();
  const at = config.demo ? DEMO_TIME : new Date().toISOString();
  const since = new Date(Date.parse(at) - 7 * 86400000).toISOString();
  const local = new Map<
    string,
    { observations: number; confirmedSales: number }
  >();
  for (const row of store.sql
    .prepare(
      "SELECT o.station_id,o.type_id,count(*) n FROM station_observations o WHERE o.at>=? AND o.at<=? AND EXISTS (SELECT 1 FROM market_snapshot_runs r WHERE r.id=json_extract(o.payload,'$.generation') AND r.status='complete') GROUP BY o.station_id,o.type_id",
    )
    .all(since, at) as { station_id: string; type_id: string; n: number }[])
    local.set(row.type_id + ":" + row.station_id, {
      observations: row.n,
      confirmedSales: 0,
    });
  for (const row of store.sql
    .prepare(
      "SELECT l.type_id,d.destination,sum(a.quantity) n FROM sale_allocations a JOIN purchase_lots l ON l.id=a.lot_id JOIN deals d ON d.id=l.deal_id JOIN wallet_transactions t ON t.character_id=a.seller_id AND t.id=a.transaction_id WHERE json_extract(t.payload,'$.date')>=? AND json_extract(t.payload,'$.date')<=? GROUP BY l.type_id,d.destination",
    )
    .all(since, at) as { type_id: string; destination: string; n: number }[]) {
    const key = row.type_id + ":" + row.destination;
    local.set(key, {
      observations: local.get(key)?.observations ?? 0,
      confirmedSales: row.n / 7,
    });
  }
  const prepared = scanOpportunities({
    data: market.data,
    orders: snapshot.orders.map((o) => ({
      ...o,
      volume_remain: Math.max(
        0,
        o.volume_remain - (reservedDepth.get(o.order_id) ?? 0),
      ),
    })),
    settings: structural,
    available: budget.available,
    pool: budget.pool,
    exposures: trades.exposures(),
    profile: (station) =>
      config.demo
        ? {
            accounting: 5,
            brokerRelations: 5,
            advancedBrokerRelations: 5,
            factionStanding: "0",
            corporationStanding: "0",
          }
        : profile
          ? stationProfile(profile, station)
          : null,
    history: (type, region) =>
      (
        store.sql
          .prepare(
            "SELECT payload FROM regional_history WHERE type_id=? AND region_id=?",
          )
          .all(type, region) as { payload: string }[]
      ).map((r) => JSON.parse(r.payload) as HistoryDay),
    local: (type, station) =>
      local.get(type + ":" + station) ?? { observations: 0, confirmedSales: 0 },
    at,
    snapshotIds: snapshots.map((s) => s.id),
  });
  return { key, offers: prepared };
}

let previous: ReturnType<typeof calculate> | undefined;
parentPort!.on("message", (message: { kind: string }) => {
  try {
    const result = store.sql.transaction(() => {
      if (message.kind !== "filter" || !previous) {
        market.data = readStatic(store);
        previous = calculate();
      }
      const settings = store.getSettings();
      return {
        key: previous.key,
        filtered: filterOpportunities(previous.offers, settings),
        filterSignature: JSON.stringify(settings),
      };
    })();
    parentPort!.postMessage({ result });
  } catch {
    parentPort!.postMessage({ error: "Market calculation failed" });
  }
});
