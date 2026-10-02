import { D, isk, sum, allocateMoney } from "./money";
export interface Lot {
  id: string;
  quantity: number;
  unitCost: string;
  acquiredAt: string;
}
export function fifo(
  lots: Lot[],
  quantity: number,
  unitPrice: string,
  taxRate: string,
) {
  if (!Number.isSafeInteger(quantity) || quantity <= 0)
    throw Error("Некорректное количество");
  let left = quantity;
  const allocations: { lotId: string; quantity: number; cost: string }[] = [];
  const remaining = structuredClone(lots).sort((a, b) =>
    a.acquiredAt.localeCompare(b.acquiredAt),
  );
  for (const lot of remaining) {
    const q = Math.min(left, lot.quantity);
    if (q) {
      allocations.push({
        lotId: lot.id,
        quantity: q,
        cost: isk(D(lot.unitCost).mul(q)),
      });
      lot.quantity -= q;
      left -= q;
    }
    if (!left) break;
  }
  if (left)
    throw Error("NEEDS_REVIEW: отсутствует подтверждённая себестоимость");
  const revenue = isk(D(unitPrice).mul(quantity));
  const tax = isk(D(revenue).mul(taxRate));
  const cost = isk(sum(allocations.map((a) => a.cost)));
  return {
    allocations,
    remaining,
    cost,
    revenue,
    tax,
    profit: isk(D(revenue).minus(cost).minus(tax)),
    taxAllocations: allocateMoney(
      tax,
      allocations.map((a) => String(a.quantity)),
    ),
  };
}
