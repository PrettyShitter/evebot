import type { HistoryDay } from "../../shared/contracts/esi";
import { D } from "../accounting/money";
import { summarize } from "../history/history";
import { liquidity } from "../liquidity/model";
import type { Level } from "../market/depth";

/** Keeps region-wide history separate from the selected hub's live order book. */
export function productionMarketSignal(input: {
  history: HistoryDay[];
  asOf: string;
  regionName: string;
  outputQuantity: number;
  bids: Level[];
  asks: Level[];
}) {
  const { history, asOf } = input;
  const week = summarize(history, 7, asOf);
  const month = summarize(history, 30, asOf);
  const quarter = summarize(history, 90, asOf);
  const newestDate = history
    .filter((day) => day.date <= asOf.slice(0, 10))
    .map((day) => day.date)
    .sort()
    .at(-1) ?? null;
  const bestBid = input.bids.reduce<string | null>(
    (best, level) => best === null || D(level.price).gt(best) ? level.price : best,
    null,
  );
  const bestAsk = input.asks.reduce<string | null>(
    (best, level) => best === null || D(level.price).lt(best) ? level.price : best,
    null,
  );
  const bidQuantity = input.bids.reduce((total, level) => total + level.quantity, 0);
  const askQuantity = input.asks.reduce((total, level) => total + level.quantity, 0);
  const largestAskQuantity = Math.max(0, ...input.asks.map((level) => level.quantity));
  const marketLiquidity = liquidity(
    history,
    asOf,
    {
      bidQuantity,
      competitorQuantity: input.asks
        .filter((level) => bestAsk !== null && D(level.price).lte(bestAsk))
        .reduce((total, level) => total + level.quantity, 0),
      observations: 0,
      confirmedSales: 0,
      localAskQuantity: askQuantity,
      largestAskQuantity,
      bestBid: bestBid ?? undefined,
      bestAsk: bestAsk ?? undefined,
    },
    bestAsk ?? bestBid ?? "0",
  );
  const volumeRatio = week?.medianDailyVolume && month?.medianDailyVolume && D(month.medianDailyVolume).gt(0)
    ? D(week.medianDailyVolume).div(month.medianDailyVolume).toNumber()
    : null;
  const priceChange = month?.priceChange === null || month?.priceChange === undefined
    ? null
    : Number(month.priceChange);
  const trendAdjustment = volumeRatio === null || priceChange === null
    ? null
    : Math.round((Math.max(0.6, Math.min(1.2, 0.8 + volumeRatio * 0.2)) *
      Math.max(0.75, Math.min(1.1, 1 + priceChange * 0.5)) - 1) * 100);
  const medianDailyVolume = month?.medianDailyVolume ? D(month.medianDailyVolume) : null;
  const expectedSellDays = medianDailyVolume?.gt(0)
    ? D(input.outputQuantity).div(medianDailyVolume).toNumber()
    : null;
  return {
    regionName: input.regionName,
    newestDate,
    history: { week, month, quarter },
    currentHub: {
      bidQuantity,
      askQuantity,
      bestBid,
      bestAsk,
      largestAskShare: askQuantity ? largestAskQuantity / askQuantity : null,
      spreadPercent: bestBid && bestAsk && D(bestBid).gt(0)
        ? D(bestAsk).div(bestBid).minus(1).mul(100).toNumber()
        : null,
    },
    liquidity: marketLiquidity,
    trendAdjustment,
    expectedSellDays,
  };
}

export type ProductionMarketSignal = ReturnType<typeof productionMarketSignal>;
