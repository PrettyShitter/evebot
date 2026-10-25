import type { HistoryDay } from "../../shared/contracts/esi";
import { completedWeekRows, summarizeCompletedWeek } from "../history/history";
import { D, Decimal } from "../accounting/money";
export const LIQUIDITY_VERSION = "weekly_v1";
export function liquidity(
  days: HistoryDay[],
  asOf: string,
  local: {
    bidQuantity: number;
    competitorQuantity: number;
    observations: number;
    confirmedSales: number;
    localAskQuantity?: number;
    largestAskQuantity?: number;
    bestBid?: string;
    bestAsk?: string;
  },
  targetPrice: string,
) {
  const h = summarizeCompletedWeek(days, asOf);
  const completedRows = completedWeekRows(days, asOf);
  const newest = completedRows
    .map((d) => d.date)
    .sort()
    .at(-1);
  const stale = !newest || Date.parse(asOf) - Date.parse(newest + "T00:00:00Z") > 3 * 86400000;
  const ageDays = newest
    ? Math.max(
        0,
        (Date.parse(asOf) - Date.parse(newest + "T00:00:00Z")) / 86400000,
      )
    : null;
  const reasons: string[] = [];
  const riskFlags: string[] = [];
  if (h && D(targetPrice).gt(D(h.medianDailyPrice).mul("1.25")))
    riskFlags.push("Цена выше региональной медианы более чем на 25%");
  if (
    local.localAskQuantity &&
    local.largestAskQuantity &&
    local.largestAskQuantity / local.localAskQuantity >= 0.5
  )
    riskFlags.push("Более половины локального sell-стакана — один ордер");
  if (
    local.bestBid &&
    local.bestAsk &&
    D(local.bestBid).gt(0) &&
    D(local.bestAsk).div(local.bestBid).minus(1).gt(".30")
  )
    riskFlags.push("Широкий спред между лучшими локальными ордерами (>30%)");
  if (
    local.bidQuantity > 0 &&
    local.bidQuantity < Math.max(1, local.confirmedSales * 3)
  )
    riskFlags.push("Тонкий локальный buy-стакан");
  let sellQuantity = 0;
  if (stale) reasons.push("История устарела");
  else if (!h || h.observedDays < 5 || h.activeDays < 4)
    reasons.push("Недостаточно истории");
  else if (local.bidQuantity <= 0 && local.confirmedSales <= 0)
    reasons.push("Нет станционных признаков спроса");
  else if (D(targetPrice).gt(D(h.medianDailyPrice).mul("1.25")))
    reasons.push("Цена выше обычного диапазона");
  else {
    const regional = D(h.medianDailyVolume).mul(".02").mul(3).floor();
    const localBound = Math.max(local.bidQuantity, local.confirmedSales * 3);
    sellQuantity = Decimal.max(
      0,
      Decimal.min(regional, localBound).minus(local.competitorQuantity),
    )
      .floor()
      .toNumber();
    if (!sellQuantity) reasons.push("Высокая конкуренция");
    else reasons.push("Спрос оценочный · до 3 дней");
  }
  if (local.bidQuantity > 0) reasons.push("Есть текущие покупатели");
  return {
    version: LIQUIDITY_VERSION,
    history: h,
    sellQuantity,
    reasons,
    confidence:
      !sellQuantity || stale || (h?.activeDays ?? 0) < 4 || (h?.observedDays ?? 0) < 5
        ? "низкая"
        : ageDays !== null &&
            ageDays <= 1 &&
            h?.observedDays === 7 &&
            (h?.activeDays ?? 0) >= 6 &&
            local.observations >= 3
          ? "высокая"
          : "средняя",
    observations: local.observations,
    regional: {
      newestDate: newest ?? null,
      ageDays,
      observedDays: h?.observedDays ?? 0,
      activeDays: h?.activeDays ?? 0,
      medianDailyVolume: h?.medianDailyVolume ?? null,
      medianDailyPrice: h?.medianDailyPrice ?? null,
      priceChange: h?.priceChange ?? null,
      weeklyVolume: h?.weeklyVolume ?? null,
      rangePercent: h?.rangePercent ?? null,
      volumeChange: h?.volumeChange ?? null,
    },
    local: {
      bidQuantity: local.bidQuantity,
      askQuantity: local.localAskQuantity ?? 0,
      largestAskQuantity: local.largestAskQuantity ?? 0,
      competitorQuantity: local.competitorQuantity,
      observations: local.observations,
    },
    riskFlags,
  };
}
