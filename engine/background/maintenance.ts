import { createHash } from "node:crypto";
import type { Store } from "../../db/store";
import type { Opportunity } from "../market/opportunities";
import { D } from "../accounting/money";
export class Alerts {
  private seen = new Map<string, { signature: string; at: number }>();
  constructor(
    private clock: () => number = Date.now,
    private cooldown = 900000,
  ) {}
  select(offers: Opportunity[], threshold: string) {
    const result: { id: string; name: string; profit: string; at: string }[] =
      [];
    for (const o of offers) {
      const profit = o.rankedBy === "buy" ? o.buy.result.profit : o.sell.profit;
      if (D(profit).lt(threshold)) continue;
      const key = o.id + ":" + o.rankedBy;
      const signature = [o.quantity, profit, o.sellPrice].join(":");
      const prior = this.seen.get(key);
      if (
        prior &&
        (prior.signature === signature ||
          this.clock() - prior.at < this.cooldown)
      )
        continue;
      this.seen.set(key, { signature, at: this.clock() });
      result.push({
        id: key + ":" + this.clock(),
        name: o.type.name,
        profit,
        at: new Date(this.clock()).toISOString(),
      });
    }
    return result;
  }
}
export function retain(store: Store, now = Date.now()) {
  const cutoff = new Date(now - 7 * 86400000).toISOString();
  return store.sql.transaction(() => {
    // Forecasts contain their own immutable inputs: cached order generations are disposable.
    const result = store.sql
      .prepare(
        "DELETE FROM market_snapshot_runs WHERE started_at<? AND id NOT IN (SELECT id FROM market_snapshot_runs r WHERE status='complete' AND completed_at=(SELECT max(completed_at) FROM market_snapshot_runs x WHERE x.region_id=r.region_id AND x.status='complete'))",
      )
      .run(cutoff);
    store.sql
      .prepare("DELETE FROM station_observations WHERE at<?")
      .run(new Date(now - 90 * 86400000).toISOString());
    store.sql
      .prepare("DELETE FROM opportunity_features WHERE available_at<?")
      .run(new Date(now - 90 * 86400000).toISOString());
    store.sql
      .prepare("DELETE FROM opportunities WHERE at<?")
      .run(new Date(now - 90 * 86400000).toISOString());
    store.sql.pragma("optimize");
    return result.changes;
  })();
}
export function analysisExport(store: Store) {
  const deals = store.sql
    .prepare("SELECT * FROM deals ORDER BY created_at,id")
    .all() as {
    id: string;
    status: string;
    forecast: string;
    created_at: string;
  }[];
  return {
    format: "eve-trader-analysis-v1",
    exportedAt: new Date().toISOString(),
    sourceTransactions: store.sql
      .prepare("SELECT * FROM wallet_transactions")
      .all(),
    sourceJournal: store.sql.prepare("SELECT * FROM wallet_journal").all(),
    characterOrders: store.sql.prepare("SELECT * FROM character_orders").all(),
    deals: deals.map((d) => ({
      ...d,
      forecast: JSON.parse(d.forecast),
      outcome:
        d.status === "CLOSED"
          ? "confirmed_closed"
          : d.status === "CANCELLED"
            ? "cancelled"
            : "unfinished",
      lots: store.sql
        .prepare("SELECT * FROM purchase_lots WHERE deal_id=?")
        .all(d.id),
      sales: store.sql
        .prepare(
          "SELECT a.* FROM sale_allocations a JOIN purchase_lots l ON l.id=a.lot_id WHERE l.deal_id=?",
        )
        .all(d.id),
      expenses: store.sql
        .prepare("SELECT * FROM fee_allocations WHERE deal_id=?")
        .all(d.id),
      events: store.sql
        .prepare("SELECT * FROM deal_events WHERE deal_id=? ORDER BY at,rowid")
        .all(d.id),
    })),
    features: store.sql
      .prepare("SELECT * FROM opportunity_features ORDER BY available_at")
      .all(),
    models: store.sql.prepare("SELECT * FROM model_versions").all(),
  };
}
export function saveFeatures(store: Store, offers: Opportunity[]) {
  const insert = store.sql.prepare(
    "INSERT OR IGNORE INTO opportunities VALUES (?,?,?)",
  );
  const features = store.sql.prepare(
    "INSERT OR IGNORE INTO opportunity_features VALUES (?,?,?,?,?)",
  );
  store.sql.transaction(() => {
    for (const o of offers) {
      const id = createHash("sha256")
        .update(
          JSON.stringify([
            o.id,
            o.features.snapshotIds,
            o.features.settings,
            o.quantity,
            o.buy,
            o.sell,
            o.historyWindows,
          ]),
        )
        .digest("hex");
      insert.run(id, o.at, JSON.stringify(o));
      features.run(
        id,
        id,
        o.features.eventTime,
        o.features.availableAt,
        JSON.stringify({
          type: o.type.id,
          source: o.source.id,
          destination: o.destination.id,
          liquidity: o.liquidity,
          quantity: o.quantity,
          buy: o.buy,
          sell: o.sell,
          settings: o.features.settings,
          formula: o.formulaVersion,
        }),
      );
      store.sql
        .prepare("INSERT OR IGNORE INTO model_versions VALUES (?,?)")
        .run(
          o.formulaVersion,
          JSON.stringify({ formula: o.formulaVersion, liquidity: "rules-v1" }),
        );
    }
  })();
}
