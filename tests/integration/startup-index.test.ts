import { expect, it } from "vitest";
import { resolve } from "node:path";
import { Store } from "../../db/store";

it("uses targeted indexes for the market queries used during startup", () => {
  const store = new Store(":memory:", resolve("db/migrations"));
  try {
    const stationPlan = store.sql
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT o.station_id,o.type_id,count(*) n
         FROM station_observations o
         WHERE o.at>=? AND o.at<=? AND o.station_id IN (?,?)
           AND EXISTS (
             SELECT 1 FROM market_snapshot_runs r
             WHERE r.id=json_extract(o.payload,'$.generation') AND r.status='complete'
           )
         GROUP BY o.station_id,o.type_id`,
      )
      .all("2026-10-04", "2026-10-11", "60003760", "60004588") as {
      detail: string;
    }[];
    const marketPlan = store.sql
      .prepare(
        "EXPLAIN QUERY PLAN SELECT payload FROM market_orders WHERE generation=? AND location_id IN (?,?)",
      )
      .all("snapshot", "60003760", "60004588") as { detail: string }[];
    const productionPlan = store.sql
      .prepare(
        "EXPLAIN QUERY PLAN SELECT payload FROM production_market_orders WHERE generation=? AND location_id IN (?,?)",
      )
      .all("snapshot", "60003760", "60004588") as { detail: string }[];

    expect(stationPlan.map((row) => row.detail).join("\n")).toMatch(
      /SEARCH o USING.*station_observations_station_at_type/,
    );
    expect(marketPlan.map((row) => row.detail).join("\n")).toMatch(
      /SEARCH market_orders USING.*market_orders_generation_location/,
    );
    expect(productionPlan.map((row) => row.detail).join("\n")).toMatch(
      /SEARCH production_market_orders USING.*production_market_orders_generation_location/,
    );
  } finally {
    store.close();
  }
});
