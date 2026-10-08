import { D } from "../accounting/money";
import { fill, type Level } from "../market/depth";

export interface ProjectBuySource {
  locationId: string;
  locationName: string;
  quantity: number;
  unitPrice: string;
}

/** Return the location-aware cheapest refill ladder without treating stale books as a quote. */
export function quoteProjectBuySources(
  levels: (Level & { locationId: string; locationName: string })[],
  quantity: number,
  marketFresh: boolean,
): { filled: number; total: string; sources: ProjectBuySource[] } {
  if (!Number.isSafeInteger(quantity) || quantity < 0)
    throw Error("Некорректное количество для закупки проекта");
  if (!marketFresh || quantity === 0) return { filled: 0, total: "0.00", sources: [] };
  const quote = fill(levels, quantity, "buy");
  const grouped = new Map<string, { locationName: string; quantity: number; value: string }>();
  for (const level of quote.fills) {
    const locationId = level.locationId ?? "";
    const locationName = level.locationName ?? `Объект ${locationId}`;
    const prior = grouped.get(locationId) ?? {
      locationName,
      quantity: 0,
      value: "0",
    };
    grouped.set(locationId, {
      locationName: prior.locationName,
      quantity: prior.quantity + level.quantity,
      value: D(prior.value).plus(level.value).toFixed(2),
    });
  }
  return {
    filled: quote.filled,
    total: quote.total,
    sources: [...grouped].map(([locationId, source]) => ({
      locationId,
      locationName: source.locationName,
      quantity: source.quantity,
      unitPrice: D(source.value).div(source.quantity).toFixed(2),
    })),
  };
}
