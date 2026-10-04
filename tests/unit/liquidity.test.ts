import { it, expect } from "vitest";
import { liquidity } from "../../engine/liquidity/model";
it("own confirmed station sales can support bounded sell demand, stale history cannot", () => {
  const at = "2026-10-02T10:00:00Z";
  const days = Array.from({ length: 10 }, (_, i) => ({
    date: new Date(Date.parse(at) - i * 86400000).toISOString().slice(0, 10),
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
it("separates regional history from local depth and flags fragile price books", () => {
  const at = "2026-10-02T10:00:00Z";
  const days = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.parse(at) - i * 86400000)
      .toISOString()
      .slice(0, 10),
    average: "100",
    highest: "105",
    lowest: "95",
    volume: 1000,
    order_count: 50,
  }));
  const result = liquidity(
    days,
    at,
    {
      bidQuantity: 4,
      competitorQuantity: 7,
      observations: 3,
      confirmedSales: 1,
      localAskQuantity: 20,
      largestAskQuantity: 15,
      bestBid: "80",
      bestAsk: "110",
    },
    "130",
  );
  expect(result.regional.activeDays).toBe(30);
  expect(result.local.bidQuantity).toBe(4);
  expect(result.riskFlags).toContain(
    "Цена выше региональной медианы более чем на 25%",
  );
  expect(result.riskFlags).toContain(
    "Более половины локального sell-стакана — один ордер",
  );
  expect(result.riskFlags).toContain(
    "Широкий спред между лучшими локальными ордерами (>30%)",
  );
});
