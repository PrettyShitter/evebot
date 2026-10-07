import { describe, expect, it } from "vitest";
import { productionMarketSignal } from "../../engine/production/market-signal";
import type { HistoryDay } from "../../shared/contracts/esi";

const asOf = "2026-10-08T12:00:00.000Z";

describe("production market signals", () => {
  it("keeps regional activity distinct from the current hub book and flags concentrated asks", () => {
    const history: HistoryDay[] = Array.from({ length: 90 }, (_, index) => {
      const date = new Date(Date.parse(asOf) - index * 86_400_000).toISOString().slice(0, 10);
      return {
        date,
        average: index < 7 ? "120" : "100",
        highest: "130",
        lowest: "90",
        volume: index < 7 ? 200 : 100,
        order_count: 10,
      };
    });
    const signal = productionMarketSignal({
      history,
      asOf,
      regionName: "The Forge",
      outputQuantity: 500,
      bids: [{ id: "hub-bid", price: "90", quantity: 40 }],
      asks: [
        { id: "hub-ask-a", price: "100", quantity: 80 },
        { id: "hub-ask-b", price: "110", quantity: 20 },
      ],
    });

    expect(signal.regionName).toBe("The Forge");
    expect(signal.history.week?.activeDays).toBe(7);
    expect(signal.history.month?.medianDailyVolume).toBe("100");
    expect(signal.currentHub).toMatchObject({
      bidQuantity: 40,
      askQuantity: 100,
      bestBid: "90",
      bestAsk: "100",
      largestAskShare: 0.8,
    });
    expect(signal.liquidity.riskFlags).toContain("Более половины локального sell-стакана — один ордер");
    expect(signal.trendAdjustment).not.toBeNull();
    expect(signal.expectedSellDays).toBe(5);
  });

  it("marks missing history as unknown while still reporting current hub depth", () => {
    const signal = productionMarketSignal({
      history: [],
      asOf,
      regionName: "The Forge",
      outputQuantity: 10,
      bids: [{ id: "bid", price: "20", quantity: 2 }],
      asks: [],
    });

    expect(signal.history.month).toBeNull();
    expect(signal.trendAdjustment).toBeNull();
    expect(signal.expectedSellDays).toBeNull();
    expect(signal.currentHub.bidQuantity).toBe(2);
    expect(signal.liquidity.confidence).toBe("низкая");
  });
});
