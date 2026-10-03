import { describe, expect, it } from "vitest";
import type { Order } from "../../shared/contracts/esi";
import { changedOrderTypes, indexOrderVersions } from "../../engine/market/order-diff";

const order = (id: string, type: string, price: string): Order => ({
  order_id: id,
  type_id: type,
  location_id: "10",
  system_id: "20",
  price,
  is_buy_order: false,
  volume_remain: 5,
  volume_total: 5,
  min_volume: 1,
  range: "station",
  duration: 90,
  issued: "2026-10-02T00:00:00Z",
});

describe("changed market order types", () => {
  it("returns only types whose order depth or price changed", () => {
    const prior = indexOrderVersions([
      order("1", "100", "10"),
      order("2", "200", "20"),
    ]);
    const current = indexOrderVersions([
      order("1", "100", "11"),
      order("3", "300", "30"),
    ]);
    expect(changedOrderTypes(prior, current)).toEqual(
      new Set(["100", "200", "300"]),
    );
  });

  it("does not flag a new snapshot when the order book is identical", () => {
    const rows = [order("1", "100", "10")];
    expect(changedOrderTypes(indexOrderVersions(rows), indexOrderVersions(rows)))
      .toEqual(new Set());
  });
});
