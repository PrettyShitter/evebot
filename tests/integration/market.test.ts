import { it, expect } from "vitest";
import { resolve } from "node:path";
import { Store } from "../../db/store";
import { seedDemo, DEMO_TIME } from "../../engine/market/demo";
import { readStatic } from "../../engine/market/static-data";
import { basketTotals } from "../../engine/market/opportunities";
import { Portfolio } from "../../engine/portfolio/repository";
import { Trades, selectQuantity } from "../../engine/portfolio/trades";
import { liquidity } from "../../engine/liquidity/model";
import { D } from "../../engine/accounting/money";
import type { HistoryDay } from "../../shared/contracts/esi";
import { demoScan } from "../fixtures/demo-scan";

it("stage 4: candidates reproducible, scenario metrics, quantity, basket/reserve idempotency", () => {
  const s = new Store(":memory:", resolve("db/migrations"));
  try {
    seedDemo(s);
    const data = readStatic(s)!;
    const first = demoScan(s),
      second = demoScan(s);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(
      first.every(
        (o) => Number(o.profitPerDay) >= 0 && o.seller.accounting >= 0,
      ),
    ).toBe(true);
    expect(
      first.every((o) => o.volume !== null && D(o.volume).lte(100000)),
    ).toBe(true);
    const full = first[0],
      half = selectQuantity(full, Math.floor(full.quantity / 2));
    expect(D(half.purchase.total).lt(full.purchase.total)).toBe(true);
    expect(
      D(half.volume!).eq(D(full.volume!).mul(half.quantity).div(full.quantity)),
    ).toBe(true);
    const totals = basketTotals([full]);
    expect(totals.cost).toBe(full.purchase.total);
    const trades = new Trades(s, () => data);
    const before = new Portfolio(s).currentBudget().available;
    trades.accept("accepted", [full]);
    trades.accept("accepted", [full]);
    expect(trades.list()).toHaveLength(1);
    expect(D(new Portfolio(s).currentBudget().available).lt(before)).toBe(true);
    expect(
      demoScan(s)
        .filter((o) => o.type.id === full.type.id)
        .every((o) =>
          D(o.purchase.total)
            .plus(trades.exposures().get(o.type.id) ?? 0)
            .lte("160000000"),
        ),
    ).toBe(true);
    trades.cancel("accepted");
    expect(new Portfolio(s).currentBudget().available).toBe(before);
  } finally {
    s.close();
  }
});
it("fixture 10: regional activity alone or inflated lone ask does not prove station sell demand", () => {
  const days: HistoryDay[] = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.parse(DEMO_TIME) - (i + 1) * 86400000)
      .toISOString()
      .slice(0, 10),
    volume: 1000000,
    order_count: 100,
    average: "100",
    lowest: "90",
    highest: "110",
  }));
  expect(
    liquidity(
      days,
      DEMO_TIME,
      {
        bidQuantity: 0,
        competitorQuantity: 0,
        observations: 5,
        confirmedSales: 0,
      },
      "100",
    ).sellQuantity,
  ).toBe(0);
  expect(
    liquidity(
      days,
      DEMO_TIME,
      {
        bidQuantity: 100,
        competitorQuantity: 0,
        observations: 5,
        confirmedSales: 0,
      },
      "1000",
    ).sellQuantity,
  ).toBe(0);
  expect(
    liquidity(
      [],
      DEMO_TIME,
      {
        bidQuantity: 100,
        competitorQuantity: 0,
        observations: 0,
        confirmedSales: 0,
      },
      "100",
    ).reasons,
  ).toContain("Есть текущие покупатели");
});
