import { parentPort, workerData } from "node:worker_threads";
import { join } from "node:path";
import { Store } from "../db/store";
import { readStatic } from "./market/static-data";
import { scanOpportunities } from "./market/opportunities";
import { latestOrders, latestSnapshots } from "./market/snapshots";
import { stationProfile, type ProfileData } from "./portfolio/profile";
import { Portfolio } from "./portfolio/repository";
import { Trades } from "./portfolio/trades";
import { DEMO_TIME } from "./market/demo";
import {
  changedOrderTypes,
  indexOrderVersions,
  type OrderVersion,
} from "./market/order-diff";
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
interface CalculationResult {
  key: string;
  scopeKey: string;
  floor: string;
  orderVersions: Map<string, OrderVersion>;
  offers: ReturnType<typeof scanOpportunities>;
}
function calculate(prior?: CalculationResult): CalculationResult {
  if (!market.data) throw Error("Static data unavailable");
  const snapshots = latestSnapshots(store, market.data.regions);
  const budget = portfolio.currentBudget();
  const settings = store.getSettings();
  const structural = {
    ...settings,
    // The scan floor bounds expensive scoring. Lowering it triggers a new scan;
    // raising it and changing ROI are applied to prepared opportunities.
    minProfit: settings.minProfit,
    minTripProfit: "0",
    roiEnabled: false,
    minROI: 0,
    sort: "best" as const,
    notificationThreshold: "0",
    sound: false,
  };
  const filters = new Set([
    "minProfit",
    "minROI",
    "roiEnabled",
    "sort",
    "notificationThreshold",
    "sound",
  ]);
  const baseSettings = Object.fromEntries(
    Object.entries(structural).filter(([key]) => !filters.has(key)),
  );
  const snapshotIds = snapshots.map((s) => s.id);
  const exposures = [...trades.exposures()];
  const allocationCount = store.sql
    .prepare("SELECT count(*) n FROM sale_allocations")
    .get();
  const sellerProfile = store.sql
    .prepare("SELECT value FROM sync_cursors WHERE key='seller-profile'")
    .get();
  const scopeParts = [
    baseSettings,
    budget,
    exposures,
    allocationCount,
    sellerProfile,
    market.data.version,
    market.data.stations.map((station) => station.id),
  ];
  const scopeKey = JSON.stringify(scopeParts);
  const key = JSON.stringify([snapshotIds, ...scopeParts]);
  const snapshot = latestOrders(
    store,
    market.data.regions,
    new Set(market.data.stations.map((station) => station.id)),
  );
  const orderVersions = indexOrderVersions(snapshot.orders);
  const canIncrement =
    prior !== undefined &&
    prior.scopeKey === scopeKey &&
    Number(settings.minProfit) >= Number(prior.floor);
  const dirtyTypes = canIncrement
    ? changedOrderTypes(prior.orderVersions, orderVersions)
    : null;
  const at = config.demo ? DEMO_TIME : new Date().toISOString();
  if (dirtyTypes?.size === 0 && prior) {
    return {
      key,
      scopeKey,
      floor: prior.floor,
      orderVersions,
      offers: prior.offers.map((offer) => ({
        ...offer,
        at,
        features: {
          ...offer.features,
          eventTime: at,
          availableAt: at,
          snapshotIds,
        },
      })),
    };
  }
  const raw = store.sql
    .prepare("SELECT value FROM sync_cursors WHERE key='seller-profile'")
    .get() as { value: string } | undefined;
  const profile = raw ? (JSON.parse(raw.value) as ProfileData) : null;
  const reservedDepth = trades.reservedDepth();
  const since = new Date(Date.parse(at) - 7 * 86400000).toISOString();
  const local = new Map<
    string,
    { observations: number; confirmedSales: number }
  >();
  const stationIds = market.data.stations.map((station) => station.id);
  for (const row of store.sql
    .prepare(
      `SELECT o.station_id,o.type_id,count(*) n FROM station_observations o WHERE o.at>=? AND o.at<=? AND o.station_id IN (${stationIds.map(() => "?").join(",")}) AND EXISTS (SELECT 1 FROM market_snapshot_runs r WHERE r.id=json_extract(o.payload,'$.generation') AND r.status='complete') GROUP BY o.station_id,o.type_id`,
    )
    .all(since, at, ...stationIds) as {
    station_id: string;
    type_id: string;
    n: number;
  }[])
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
  const scanOrders = snapshot.orders
    .filter((order) => !dirtyTypes || dirtyTypes.has(order.type_id))
    .map((o) => ({
      ...o,
      volume_remain: Math.max(
        0,
        o.volume_remain - (reservedDepth.get(o.order_id) ?? 0),
      ),
    }));
  const prepared = scanOpportunities({
    data: market.data,
    orders: scanOrders,
    settings: structural,
    available: budget.available,
    pool: budget.pool,
    exposures: new Map(exposures),
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
    snapshotIds,
    onProgress: (progress) => parentPort!.postMessage({ progress }),
  });
  return {
    key,
    scopeKey,
    floor: settings.minProfit,
    orderVersions,
    offers: dirtyTypes && prior
      ? [...prior.offers.filter((offer) => !dirtyTypes.has(offer.type.id)), ...prepared]
      : prepared,
  };
}

let previous: CalculationResult | undefined;
parentPort!.on("message", (message: { kind: string }) => {
  try {
    const result = store.sql.transaction(() => {
      if (message.kind !== "filter" || !previous) {
        market.data = readStatic(store);
        previous = calculate(previous);
      }
      return {
        key: previous.key,
        offers: previous.offers,
        scanFloor: previous.floor,
      };
    })();
    parentPort!.postMessage({ result });
  } catch {
    parentPort!.postMessage({ error: "Market calculation failed" });
  }
});
