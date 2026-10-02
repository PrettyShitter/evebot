import { it, expect } from "vitest";
import { liquidity } from "../../engine/liquidity/model";
it("own confirmed station sales can support bounded sell demand, stale history cannot", () => {
  const at = "2026-10-02T10:00:00Z";
  const days = Array.from({ length: 10 }, (_, i) => ({
    date: new Date(Date.parse(at) - (i + 1) * 86400000)
      .toISOString()
      .slice(0, 10),
    average: "100",
    highest: "100",
    lowest: "100",
    volume: 1000,
    order_count: 50,
  }));
  const local = {
    bidQuantity: 0,
    competitorQuantity: 0,
    observations: 3,
    confirmedSales: 10,
  };
  // 2% of regional median * 3 days = 60; own 10/day * 3 days = 30.
  expect(liquidity(days, at, local, "100").sellQuantity).toBe(30);
  expect(
    liquidity(days, "2026-11-01T10:00:00Z", local, "100").sellQuantity,
  ).toBe(0);
  expect(
    liquidity(days, at, { ...local, confirmedSales: 0 }, "100").sellQuantity,
  ).toBe(0);
});
