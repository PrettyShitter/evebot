import { D, isk, sum, Decimal } from "../accounting/money";
export interface Level {
  id: string;
  price: string;
  quantity: number;
  minVolume?: number;
}
// Only frozen ladders can be cached: mutable callers must observe later edits.
const ordered = new WeakMap<
  Level[],
  Partial<Record<"buy" | "sell", Level[]>>
>();
function sortedLevels(levels: Level[], side: "buy" | "sell") {
  const immutable = Object.isFrozen(levels) && levels.every(Object.isFrozen);
  const cached = immutable ? ordered.get(levels)?.[side] : undefined;
  if (cached) return cached;
  const sorted = [...levels].sort(
    (a, b) =>
      D(a.price).comparedTo(b.price) * (side === "buy" ? 1 : -1) ||
      a.id.localeCompare(b.id),
  );
  if (immutable)
    ordered.set(levels, { ...ordered.get(levels), [side]: sorted });
  return sorted;
}
export interface Fill {
  id: string;
  price: string;
  quantity: number;
  value: string;
}
export function fill(
  levels: Level[],
  quantity: number,
  side: "buy" | "sell",
  used: Map<string, number> = new Map(),
) {
  if (!Number.isSafeInteger(quantity) || quantity < 0)
    throw Error("Некорректное количество");
  let remaining = quantity;
  const fills: Fill[] = [];
  const sorted = sortedLevels(levels, side);
  for (const l of sorted) {
    if (!remaining) break;
    const available = Math.max(0, l.quantity - (used.get(l.id) || 0));
    const q = Math.min(remaining, available);
    if (!q || q < Math.min(l.minVolume ?? 1, l.quantity)) continue;
    fills.push({ ...l, quantity: q, value: isk(D(l.price).mul(q)) });
    used.set(l.id, (used.get(l.id) || 0) + q);
    remaining -= q;
  }
  return {
    fills,
    filled: quantity - remaining,
    remaining,
    total: isk(sum(fills.map((x) => x.value))),
  };
}
export function pnl(
  cost: string,
  revenue: string,
  taxRate: string,
  listing = "0",
  relisting = "0",
) {
  const tax = isk(D(revenue).mul(taxRate));
  const expenses = D(listing).plus(relisting);
  const profit = D(revenue).minus(cost).minus(tax).minus(expenses);
  const capital = D(cost).plus(expenses);
  return {
    cost: isk(cost),
    revenue: isk(revenue),
    tax,
    listing: isk(listing),
    relisting: isk(relisting),
    profit: isk(profit),
    roi: capital.gt(0) ? profit.div(capital).toFixed(8) : null,
  };
}
export function quote(
  supply: Level[],
  demand: Level[],
  quantity: number,
  taxRate: string,
) {
  const purchase = fill(supply, quantity, "buy");
  const sale = fill(demand, purchase.filled, "sell");
  const soldCost = fill(supply, sale.filled, "buy").total;
  return {
    purchase,
    sale,
    result: pnl(soldCost, sale.total, taxRate),
    fullROI:
      sale.filled === quantity && purchase.filled === quantity
        ? pnl(purchase.total, sale.total, taxRate).roi
        : null,
  };
}
export function cargo(
  lines: { quantity: number; volume: string | null }[],
): string | null {
  return lines.some((x) => x.volume === null)
    ? null
    : sum(lines.map((x) => D(x.volume!).mul(x.quantity))).toFixed();
}
// Stops at the first non-profitable marginal price block; no expensive tail hidden by averaging.
export function profitableQuantity(
  supply: Level[],
  demand: Level[],
  budget: string,
  taxRate: string,
  minROI: string,
) {
  const asks = sortedLevels(supply, "buy");
  const bids = sortedLevels(demand, "sell");
  let ai = 0,
    bi = 0,
    aq = 0,
    bq = 0,
    q = 0,
    cost = D(0);
  while (ai < asks.length && bi < bids.length) {
    const a = asks[ai],
      b = bids[bi];
    if (
      D(b.price)
        .mul(D(1).minus(taxRate))
        .lt(D(a.price).mul(D(1).plus(minROI)))
    )
      break;
    const n = Math.min(
      a.quantity - aq,
      b.quantity - bq,
      Decimal.max(0, D(budget).minus(cost).div(a.price).floor()).toNumber(),
    );
    if (!n) break;
    // Only accept a bid if the complete block available across supply meets its minimum.
    if (bq === 0 && n < Math.min(b.minVolume ?? 1, b.quantity)) {
      const possible =
        asks
          .slice(ai)
          .filter((x) =>
            D(b.price)
              .mul(D(1).minus(taxRate))
              .gte(D(x.price).mul(D(1).plus(minROI))),
          )
          .reduce((s, x) => s + x.quantity, 0) - aq;
      if (possible < Math.min(b.minVolume ?? 1, b.quantity)) {
        bi++;
        continue;
      }
    }
    q += n;
    cost = cost.plus(D(a.price).mul(n));
    aq += n;
    bq += n;
    if (aq === a.quantity) {
      ai++;
      aq = 0;
    }
    if (bq === b.quantity) {
      bi++;
      bq = 0;
    }
  }
  // The executable quote is authoritative for minimum-volume constraints.
  return fill(bids, q, "sell").filled;
}
