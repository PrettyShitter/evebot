import { Store } from "../../db/store";
import { DEMO_TIME } from "../../engine/market/demo";
import { readStatic } from "../../engine/market/static-data";
import { latestOrders } from "../../engine/market/snapshots";
import { scanOpportunities } from "../../engine/market/opportunities";
import { Portfolio } from "../../engine/portfolio/repository";
import { Trades } from "../../engine/portfolio/trades";
import type { HistoryDay } from "../../shared/contracts/esi";
export function demoScan(store: Store) {
  const data = readStatic(store)!;
  const b = new Portfolio(store).currentBudget();
  return scanOpportunities({
    data,
    orders: latestOrders(store, data.regions).orders,
    settings: store.getSettings(),
    available: b.available,
    pool: b.pool,
    exposures: new Trades(store, () => data).exposures(),
    profile: () => ({
      accounting: 5,
      brokerRelations: 5,
      advancedBrokerRelations: 5,
      corporationStanding: "0",
      factionStanding: "0",
    }),
    history: (type, region) =>
      (
        store.sql
          .prepare(
            "SELECT payload FROM regional_history WHERE type_id=? AND region_id=?",
          )
          .all(type, region) as { payload: string }[]
      ).map((r) => JSON.parse(r.payload) as HistoryDay),
    at: DEMO_TIME,
    snapshotIds: ["demo"],
  });
}
