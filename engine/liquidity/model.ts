import type { HistoryDay } from "../../shared/contracts/esi";
import { summarize } from "../history/history";
import { D, Decimal } from "../accounting/money";
export const LIQUIDITY_VERSION = "rules-1";
export function liquidity(
  days: HistoryDay[],
  asOf: string,
  local: {
    bidQuantity: number;
    competitorQuantity: number;
    observations: number;
    confirmedSales: number;
  },
  targetPrice: string,
) {
  const h = summarize(days, 30, asOf);
  const newest = days
    .filter((d) => d.date <= asOf.slice(0, 10))
    .map((d) => d.date)
    .sort()
    .at(-1);
  const stale = !newest || Date.parse(asOf) - Date.parse(newest) > 3 * 86400000;
  const reasons: string[] = [];
  let sellQuantity = 0;
  if (stale) reasons.push("История устарела");
  else if (!h || h.observedDays < 7 || h.activeDays < 5)
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
    confidence: sellQuantity ? "estimated" : "insufficient",
    observations: local.observations,
  };
}
