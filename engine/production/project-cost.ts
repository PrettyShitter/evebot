import { D, isk } from "../accounting/money";
import { fill, pnl, type Level } from "../market/depth";
import { listingFee } from "../market/fees";

export interface ProjectMaterialCost {
  typeId: string;
  required: number;
  purchased: number;
  actualCost: string;
}

/** A linked job set is complete only when every job exposes its charged cost. */
export function resolveManufacturingExecutionCost(
  jobs: { cost: string | null }[],
  forecastFee: string | null,
): string | null {
  if (!jobs.length) return forecastFee;
  if (jobs.some((job) => job.cost === null)) return null;
  return jobs.reduce((total, job) => total.plus(job.cost!), D(0)).toFixed(2);
}

/** Actual purchases replace their forecast; only the still-missing quantity uses current asks. */
export function estimateCurrentProjectCost(input: {
  materials: ProjectMaterialCost[];
  asksByType: Map<string, Level[]>;
  executionFee: string | null;
  marketFresh: boolean;
}): string | null {
  if (input.executionFee === null) return null;
  let total = D(input.executionFee);
  for (const material of input.materials) {
    total = total.plus(material.actualCost);
    const missing = Math.max(0, material.required - material.purchased);
    if (!missing) continue;
    if (!input.marketFresh) return null;
    const quote = fill(input.asksByType.get(material.typeId) ?? [], missing, "buy");
    if (quote.filled < missing) return null;
    total = total.plus(quote.total);
  }
  return isk(total);
}

/** Current route forecasts are valid only when the whole batch has live depth. */
export function estimateCurrentProjectProfit(input: {
  outputs: { typeId: string; quantity: number }[];
  asksByType: Map<string, Level[]>;
  demandByType: Map<string, Level[]>;
  totalCost: string | null;
  salesTaxRate: string | null;
  brokerFeeRate: string | null;
  marketFresh: boolean;
}): { immediate: string | null; sellOrder: string | null } {
  if (!input.marketFresh || input.totalCost === null ||
      input.salesTaxRate === null || input.brokerFeeRate === null) {
    return { immediate: null, sellOrder: null };
  }
  const outputs = input.outputs.filter((output) => output.quantity > 0);
  if (!outputs.length) return { immediate: null, sellOrder: null };

  let immediateGross = D(0);
  let immediateComplete = true;
  for (const output of outputs) {
    const sale = fill(input.demandByType.get(output.typeId) ?? [], output.quantity, "sell");
    if (sale.filled !== output.quantity) immediateComplete = false;
    immediateGross = immediateGross.plus(sale.total);
  }

  let sellGross = D(0);
  let totalListingFees = D(0);
  let sellComplete = true;
  for (const output of outputs) {
    const asks = input.asksByType.get(output.typeId) ?? [];
    const best = asks.reduce<string | null>((price, level) =>
      price === null || D(level.price).lt(price) ? level.price : price, null);
    if (best === null) {
      sellComplete = false;
      continue;
    }
    const gross = isk(D(best).mul(output.quantity));
    sellGross = sellGross.plus(gross);
    totalListingFees = totalListingFees.plus(listingFee(gross, input.brokerFeeRate));
  }
  return {
    immediate: immediateComplete
      ? pnl(input.totalCost, isk(immediateGross), input.salesTaxRate).profit
      : null,
    sellOrder: sellComplete
      ? pnl(input.totalCost, isk(sellGross), input.salesTaxRate, isk(totalListingFees)).profit
      : null,
  };
}
