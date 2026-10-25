import { D } from "../engine/accounting/money";

export interface OfferRow {
  id: string;
  at: string;
  rankingScore?: string;
  rankedBy?: "buy" | "sell";
  quantity: number;
  availableQuantity: number;
  sellPrice: string;
  purchase: { total: string; fills: { price: string }[] };
  buy: { result: { profit: string }; fullROI: string | null };
  sell: { profit: string; roi: string | null };
  liquidity: { sellQuantity: number; reasons: string[] };
}

function sortOffersByProfit<T extends OfferRow>(offers: T[]): T[] {
  const profit = (offer: T) =>
    D(offer.rankedBy === "sell" ? offer.sell.profit : offer.buy.result.profit);
  return [...offers].sort(
    (left, right) =>
      D(right.rankingScore ?? "0").comparedTo(left.rankingScore ?? "0") ||
      profit(right).comparedTo(profit(left)) ||
      left.id.localeCompare(right.id),
  );
}

// Preserve mounted rows during background scans, update rows in place, and
// append only genuinely new IDs. Missing rows are pruned after a full scan.
export function mergeOfferRows<T extends OfferRow>(
  current: T[],
  incoming: T[],
  completed: boolean,
  criteriaChanged = false,
): T[] {
  if (criteriaChanged) return sortOffersByProfit(incoming);
  const latest = new Map(incoming.map((offer) => [offer.id, offer]));
  const seen = new Set<string>();
  const next = current.flatMap((old) => {
    const fresh = latest.get(old.id);
    if (!fresh) return completed ? [] : [old];
    seen.add(old.id);
    return [
      old.quantity === fresh.quantity &&
      old.availableQuantity === fresh.availableQuantity &&
      old.sellPrice === fresh.sellPrice &&
      old.purchase.total === fresh.purchase.total &&
      old.purchase.fills[0]?.price === fresh.purchase.fills[0]?.price &&
      old.buy.result.profit === fresh.buy.result.profit &&
      old.buy.fullROI === fresh.buy.fullROI &&
      old.sell.profit === fresh.sell.profit &&
      old.sell.roi === fresh.sell.roi &&
      old.rankingScore === fresh.rankingScore &&
      old.rankedBy === fresh.rankedBy &&
      old.liquidity.sellQuantity === fresh.liquidity.sellQuantity &&
      old.liquidity.reasons.join("|") === fresh.liquidity.reasons.join("|")
        ? old
        : fresh,
    ];
  });
  for (const offer of incoming)
    if (!seen.has(offer.id)) next.push(offer);
  const sorted = sortOffersByProfit(next);
  if (sorted.length === current.length && sorted.every((row, i) => row === current[i]))
    return current;
  return sorted;
}
