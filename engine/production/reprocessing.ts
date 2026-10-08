import { D, isk, sum } from "../accounting/money";
import { fill, pnl, type Level } from "../market/depth";
import { listingFee, rates } from "../market/fees";
import type { ReprocessingRecipe } from "../market/static-data";
import type { SellerProfile } from "../market/fees";
import { isFreshTimestamp } from "./freshness";

export interface ReprocessingEstimate {
  status: "ready" | "review";
  reasons: string[];
  inputTypeId: string;
  portionSize: number;
  inputQuantity: number;
  consumedQuantity: number;
  residualQuantity: number;
  portions: number;
  yieldPercent: string;
  inputsCost: string | null;
  inputSources: { locationId: string; locationName: string; quantity: number; totalCost: string }[];
  reprocessingTax: string | null;
  totalCost: string | null;
  reprocessingTaxRate: string | null;
  outputs: { typeId: string; typeName: string; quantity: number; sellFilled: number; buyGross: string | null; askPrice: string | null }[];
  immediate: { filledOutputs: number; outputCount: number; gross: string; tax: string; netProfit: string | null; roi: string | null };
  sellOrder: { gross: string | null; listingFees: string | null; netProfit: string | null; roi: string | null };
  fees: { salesTaxRate: string; brokerFeeRate: string };
  observedAt: string;
}

/**
 * Models an NPC/structure preview using the final yield visible in-game. The
 * yield is an explicit facility input so unknown skills, rigs, structure
 * bonuses, standings and facility tax never silently become zero.
 */
export function estimateReprocessing(input: {
  recipe: ReprocessingRecipe;
  portionSize: number;
  inputQuantity: number;
  yieldPercent: string | null;
  evidenceAt: string | null;
  supply: Level[];
  demand: Map<string, Level[]>;
  asks: Map<string, Level[]>;
  seller: SellerProfile;
  observedAt: string;
  typeNames?: Map<string, string>;
  reprocessingTaxRate: string | null;
  adjustedPrices: Map<string, string>;
}): ReprocessingEstimate {
  if (!Number.isSafeInteger(input.inputQuantity) || input.inputQuantity <= 0)
    throw Error("Количество для переработки должно быть положительным целым числом");
  if (!Number.isSafeInteger(input.portionSize) || input.portionSize <= 0)
    throw Error("В SDE отсутствует корректный portion size");
  const reasons: string[] = [];
  const portions = Math.floor(input.inputQuantity / input.portionSize);
  const consumedQuantity = portions * input.portionSize;
  const residualQuantity = input.inputQuantity - consumedQuantity;
  if (portions <= 0) reasons.push("Недостаточно предметов для одной полной порции");
  if (!input.yieldPercent || !input.evidenceAt)
    reasons.push("Не подтверждён итоговый выход из Reprocess preview на этой площадке");
  if (input.reprocessingTaxRate === null)
    reasons.push("Не подтверждена ставка налога переработки для этой площадки");
  const yieldRate = input.yieldPercent ? D(input.yieldPercent).div(100) : D(0);
  if (yieldRate.lt(0) || yieldRate.gt(1)) reasons.push("Итоговый выход должен быть от 0 до 100 процентов");
  if (input.yieldPercent && input.evidenceAt && !isFreshTimestamp(input.evidenceAt, 30 * 24 * 60 * 60 * 1000))
    reasons.push("Дата подтверждения выхода некорректна, слишком старая или находится в будущем; обновите Reprocess preview");
  const purchase = fill(input.supply, consumedQuantity, "buy");
  const inputSources = new Map<string, { locationId: string; locationName: string; quantity: number; total: ReturnType<typeof D> }>();
  for (const level of purchase.fills) {
    if (!level.locationId || !level.locationName) continue;
    const current = inputSources.get(level.locationId) ?? {
      locationId: level.locationId,
      locationName: level.locationName,
      quantity: 0,
      total: D(0),
    };
    current.quantity += level.quantity;
    current.total = current.total.plus(level.value);
    inputSources.set(level.locationId, current);
  }
  if (purchase.filled < consumedQuantity)
    reasons.push(`Недостаточно sell-глубины входного предмета: ${purchase.filled}/${consumedQuantity}`);
  const outputs = input.recipe.materials.map((material) => {
    const rawQuantity = D(material.quantity).mul(portions).mul(yieldRate);
    const quantity = input.recipe.outputRounding === "ceil"
      ? rawQuantity.ceil().toNumber()
      : input.recipe.outputRounding === "nearest"
        ? rawQuantity.round().toNumber()
        : rawQuantity.floor().toNumber();
    const sale = fill(input.demand.get(material.typeId) ?? [], quantity, "sell");
    const asks = input.asks.get(material.typeId) ?? [];
    const askPrice = asks.length
      ? asks.reduce((best, level) => D(level.price).lt(best) ? level.price : best, asks[0]!.price)
      : null;
    if (quantity > 0 && sale.filled < quantity)
      reasons.push(`Недостаточная buy-глубина выхода ${material.typeId}: ${sale.filled}/${quantity}`);
    if (quantity > 0 && !askPrice)
      reasons.push(`Нет sell-цены для выхода ${material.typeId}`);
    return {
      typeId: material.typeId,
      typeName: input.typeNames?.get(material.typeId) ?? `Type ${material.typeId}`,
      quantity,
      sellFilled: sale.filled,
      buyGross: quantity > 0 && sale.filled === quantity ? sale.total : null,
      askPrice,
    };
  });
  const missingTaxPrices = outputs.filter((output) => output.quantity > 0 && !input.adjustedPrices.has(output.typeId));
  if (missingTaxPrices.length)
    reasons.push("Нет adjusted prices для расчёта налога переработки: " + missingTaxPrices.map((output) => output.typeId).join(", "));
  const taxRate = input.reprocessingTaxRate === null ? null : D(input.reprocessingTaxRate);
  if (taxRate && (taxRate.lt(0) || taxRate.gt(1))) reasons.push("Ставка налога переработки должна быть от 0 до 100 процентов");
  const reprocessingTax = taxRate && !missingTaxPrices.length
    ? isk(sum(outputs.map((output) => output.quantity
      ? D(output.quantity).mul(input.adjustedPrices.get(output.typeId)!).mul(taxRate)
      : D(0))))
    : null;
  const fee = rates(input.seller);
  const outputsReady = outputs.every((output) => output.quantity === 0 || output.buyGross !== null);
  const inputsCost = purchase.filled === consumedQuantity ? purchase.total : null;
  const totalCost = inputsCost !== null && reprocessingTax !== null
    ? isk(D(inputsCost).plus(reprocessingTax))
    : null;
  const immediateGross = outputsReady ? isk(sum(outputs.map((output) => output.buyGross ?? "0"))) : "0.00";
  const immediate = totalCost !== null && outputsReady
    ? pnl(totalCost, immediateGross, fee.tax.toFixed())
    : null;
  const sellGross = outputs.every((output) => output.quantity === 0 || output.askPrice !== null)
    ? isk(sum(outputs.map((output) => output.quantity ? D(output.askPrice!).mul(output.quantity) : D(0))))
    : null;
  const listingFees = sellGross === null
    ? null
    : isk(sum(outputs.map((output) => output.quantity
        ? listingFee(isk(D(output.askPrice!).mul(output.quantity)), fee.broker)
        : "0")));
  const sellOrder = totalCost !== null && sellGross && listingFees
    ? pnl(totalCost, sellGross, fee.tax.toFixed(), listingFees)
    : null;
  if (!outputs.length) reasons.push("В SDE не найдены выходные материалы");
  return {
    status: reasons.length ? "review" : "ready",
    reasons,
    inputTypeId: input.recipe.typeId,
    portionSize: input.portionSize,
    inputQuantity: input.inputQuantity,
    consumedQuantity,
    residualQuantity,
    portions,
    yieldPercent: input.yieldPercent ?? "0",
    inputsCost,
    inputSources: [...inputSources.values()].map((source) => ({
      locationId: source.locationId,
      locationName: source.locationName,
      quantity: source.quantity,
      totalCost: isk(source.total),
    })),
    reprocessingTax,
    totalCost,
    reprocessingTaxRate: input.reprocessingTaxRate,
    outputs,
    immediate: {
      filledOutputs: outputs.filter((output) => output.quantity === 0 || output.buyGross !== null).length,
      outputCount: outputs.length,
      gross: immediateGross,
      tax: immediate?.tax ?? "0.00",
      netProfit: immediate?.profit ?? null,
      roi: immediate?.roi ?? null,
    },
    sellOrder: {
      gross: sellGross,
      listingFees,
      netProfit: sellOrder?.profit ?? null,
      roi: sellOrder?.roi ?? null,
    },
    fees: { salesTaxRate: fee.tax.toFixed(6), brokerFeeRate: fee.broker.toFixed(6) },
    observedAt: input.observedAt,
  };
}
