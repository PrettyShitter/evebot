import { D, isk, sum, type Decimal } from "../accounting/money";
import { fill, type Level, pnl } from "../market/depth";
import type { ManufacturingBlueprint, ProductionMaterial } from "../market/static-data";
import { listingFee, rates } from "../market/fees";
import type { EffectiveSkill } from "./skills";
import { missingManufacturingSkills } from "./skills";

export interface ManufacturingInput {
  recipe: ManufacturingBlueprint;
  runs: number;
  blueprint: {
    itemId: string;
    materialEfficiency: number;
    timeEfficiency: number;
    remainingRuns: number;
    locationId: string;
  };
  blueprintAcquisitionCost?: string | null;
  /** Full contract/BPO cash price when this project still has to acquire it. */
  blueprintPurchaseCashCost?: string | null;
  blueprintAcquisitionAlreadyPaid?: boolean;
  facility: {
    id: string;
    kind: "npc_station" | "structure";
    accessStatus: "unknown" | "confirmed" | "unavailable";
    services: string[];
    taxRate: string | null;
    costIndex: string | null;
    /** Effective factor multiplying the system cost index; structures require a confirmed product-specific factor. */
    systemCostMultiplier?: string | null;
    /** Effective structure/rig material reduction for the selected output type. */
    materialBonusPercent?: number | null;
    /** Effective structure/rig time reduction for the selected output type. */
    timeBonusPercent?: number | null;
    /** Explicit structure listing fee as a decimal fraction; null means unknown. */
    brokerFeeRate?: string | null;
  };
  skills: EffectiveSkill[];
  supply: Map<string, Level[]>;
  demand: Map<string, Level[]>;
  adjustedPrices: Map<string, string>;
  materialNames?: Map<string, string>;
  seller: {
    accounting: number;
    brokerRelations: number;
    advancedBrokerRelations: number;
    factionStanding: string;
    corporationStanding: string;
  };
}

export interface ManufacturingEstimate {
  status: "ready" | "review";
  reasons: string[];
  warnings: string[];
  blueprintTypeId: string;
  blueprintItemId: string;
  facilityId: string;
  runs: number;
  outputTypeId: string;
  outputQuantity: number;
  materials: {
    typeId: string;
    typeName: string;
    quantity: number;
    averageUnitPrice: string | null;
    totalCost: string | null;
    filled: number;
    sources: { locationId: string; locationName: string; quantity: number; totalCost: string }[];
  }[];
  materialsCost: string | null;
  estimatedItemValue: string | null;
  installationFee: string | null;
  blueprintAcquisitionCost: string | null;
  /** Full cash needed to acquire the blueprint, separate from cost consumed by this batch. */
  blueprintPurchaseCashCost: string | null;
  /** First batch result after accounting for the entire blueprint purchase outlay. */
  firstCycleProfit: { immediate: string | null; sellOrder: string | null };
  /** First-cycle profit divided by the full cash needed to start, including blueprint acquisition. */
  firstCycleRoi: { immediate: string | null; sellOrder: string | null };
  /** Identical positive-profit batches needed to recover a reusable BPO purchase. */
  blueprintPaybackBatches: { immediate: number | null; sellOrder: number | null };
  totalCost: string | null;
  /** Cash still needed now; excludes a blueprint acquisition paid before this project. */
  cashRequired: string | null;
  immediate: {
    filled: number;
    gross: string;
    netProfit: string | null;
    roi: string | null;
  };
  sellOrder: {
    unitPrice: string | null;
    gross: string | null;
    netProfit: string | null;
    roi: string | null;
  };
  fees: {
    accountingLevel: number;
    brokerRelationsLevel: number;
    advancedBrokerRelationsLevel: number;
    factionStanding: string;
    corporationStanding: string;
    salesTaxRate: string;
    brokerFeeRate: string;
  };
  timeSeconds: number | null;
  formulaVersion: "ccp-current-support-alpha-2pct-npc-v3" | "ccp-current-support-alpha-2pct-upwell-profile-v2";
}

export function manufacturingValueAndFee(
  recipe: ManufacturingBlueprint,
  runs: number,
  adjustedPrices: Map<string, string>,
  costIndex: string | null,
  modifiers: { facilityTax: string; systemCostMultiplier: string } = {
    facilityTax: NPC_FACILITY_TAX.toString(),
    systemCostMultiplier: "1",
  },
): { eiv: string; installationFee: string } | null {
  if (!costIndex || recipe.materials.some((material) => !adjustedPrices.has(material.typeId))) return null;
  const facilityTax = D(modifiers.facilityTax);
  const systemCostMultiplier = D(modifiers.systemCostMultiplier);
  if (facilityTax.lt(0) || facilityTax.gt("0.1") || systemCostMultiplier.lt(0) || systemCostMultiplier.gt(2)) return null;
  const eiv = isk(sum(recipe.materials.map((material) =>
    D(adjustedPrices.get(material.typeId)!).mul(material.quantity).mul(runs))));
  return {
    eiv,
    installationFee: isk(D(eiv).mul(D(costIndex).mul(systemCostMultiplier).plus(facilityTax).plus(SCC_SURCHARGE).plus(ALPHA_SURCHARGE))),
  };
}

export function manufacturingTimeSeconds(
  recipe: ManufacturingBlueprint,
  runs: number,
  timeEfficiency: number,
  skills: EffectiveSkill[],
  facilityTimeBonusPercent = 0,
): number | null {
  if (recipe.baseTimeSeconds === null) return null;
  if (!Number.isFinite(facilityTimeBonusPercent) || facilityTimeBonusPercent < 0 || facilityTimeBonusPercent > 100)
    throw Error("Бонус времени площадки должен быть от 0 до 100 процентов");
  const levels = new Map(skills.map((skill) => [skill.typeId, skill.usableLevel]));
  return Math.ceil(recipe.baseTimeSeconds * runs *
    (1 - Math.min(20, Math.max(0, timeEfficiency)) / 100) *
    (1 - (levels.get("3380") ?? 0) * 0.04) *
    (1 - (levels.get("3388") ?? 0) * 0.03) *
    (1 - facilityTimeBonusPercent / 100));
}

export function blueprintCapitalMetrics(
  reusable: boolean,
  acquisitionCost: string | null,
  purchaseCashCost: string | null,
  immediateProfit: string | null,
  sellOrderProfit: string | null,
  cashRequired: string | null,
  purchaseAlreadyPaid: boolean,
) {
  const purchase = purchaseCashCost === null ? null : D(purchaseCashCost);
  const consumed = acquisitionCost === null ? D(0) : D(acquisitionCost);
  const remainingOutlay = purchase === null || purchase.lte(consumed) ? D(0) : purchase.minus(consumed);
  const firstCycle = (profit: string | null) => profit === null
    ? null
    : isk(D(profit).minus(remainingOutlay));
  const firstCycleRoi = (profit: string | null) => {
    const firstCycleResult = firstCycle(profit);
    const firstCycleInvestment = cashRequired === null
      ? null
      : D(cashRequired).plus(purchaseAlreadyPaid ? remainingOutlay : "0");
    return firstCycleResult === null || firstCycleInvestment === null || !firstCycleInvestment.gt(0)
      ? null
      : D(firstCycleResult).div(firstCycleInvestment).toFixed(6);
  };
  const payback = (profit: string | null) => {
    if (!reusable || purchase === null || !purchase.gt(0) || profit === null || !D(profit).gt(0)) return null;
    return Math.ceil(purchase.div(profit).toNumber());
  };
  return {
    purchaseCashCost: purchase === null ? null : isk(purchase),
    firstCycleProfit: { immediate: firstCycle(immediateProfit), sellOrder: firstCycle(sellOrderProfit) },
    firstCycleRoi: { immediate: firstCycleRoi(immediateProfit), sellOrder: firstCycleRoi(sellOrderProfit) },
    paybackBatches: { immediate: payback(immediateProfit), sellOrder: payback(sellOrderProfit) },
  };
}

const FORMULA_VERSION = "ccp-current-support-alpha-2pct-npc-v3" as const;
const NPC_FACILITY_TAX = D("0.0025");
const SCC_SURCHARGE = D("0.04");
// CCP's current Alpha/Omega support page (updated 2026-02-04) lists an
// additional 2% Alpha industry tax. This supersedes the older 0.25% value
// in Viridian release notes until an in-game Industry preview is available.
const ALPHA_SURCHARGE = D("0.02");

/**
 * Conservative single-step manufacturing quote. It only marks an estimate ready
 * when inputs, blueprint, skills, NPC facility profile, EIV and system index are
 * all known. Existing inventory is never subtracted from material purchases.
 */
export function estimateManufacturing(input: ManufacturingInput): ManufacturingEstimate {
  const { recipe, runs, blueprint, facility } = input;
  if (!Number.isSafeInteger(runs) || runs <= 0)
    throw Error("Количество прогонов должно быть положительным целым числом");
  if (runs > recipe.maxProductionLimit)
    throw Error("Количество прогонов превышает предел blueprint");
  const output = recipe.products[0];
  if (!output) throw Error("У рецепта не указан результат");
  const reasons: string[] = [];
  if (blueprint.remainingRuns !== -1 && runs > blueprint.remainingRuns)
    reasons.push("В BPC недостаточно оставшихся прогонов");
  if (blueprint.locationId !== facility.id)
    reasons.push("Чертёж и материалы должны находиться на выбранной площадке");
  if (facility.accessStatus !== "confirmed")
    reasons.push("Доступ к площадке не подтверждён в игре");
  if (!facility.services.includes("manufacturing"))
    reasons.push("Для площадки не подтверждена услуга Manufacturing");
  if (facility.kind === "structure") {
    if (!facility.taxRate || !facility.systemCostMultiplier || facility.materialBonusPercent === null || facility.materialBonusPercent === undefined || facility.timeBonusPercent === null || facility.timeBonusPercent === undefined)
      reasons.push("Не подтверждены налог и применимые к этому изделию бонусы структуры из окна Industry");
    else if (facility.taxRate !== null && (D(facility.taxRate).lt(0) || D(facility.taxRate).gt("0.1")))
      reasons.push("Налог структуры должен быть от 0 до 10 процентов");
    if (facility.brokerFeeRate === null || facility.brokerFeeRate === undefined)
      reasons.push("Не подтверждена комиссия sell-ордера структуры");
    else if (D(facility.brokerFeeRate).lt(0) || D(facility.brokerFeeRate).gt(1))
      reasons.push("Комиссия sell-ордера структуры должна быть от 0 до 100 процентов");
  }
  const missingSkills = missingManufacturingSkills(recipe.skills, input.skills);
  if (missingSkills.length)
    reasons.push(
      "Alpha-скиллы не покрывают требования: " +
        missingSkills.map((skill) => `${skill.typeId} ${skill.level}`).join(", "),
    );
  const materials = recipe.materials.map((material) => {
    const quantity = jobMaterialQuantity(
      material,
      runs,
      blueprint.materialEfficiency,
      facility.kind === "structure" ? facility.materialBonusPercent ?? 0 : 0,
    );
    const levels = input.supply.get(material.typeId) ?? [];
    const purchase = fill(levels, quantity, "buy");
    const sourceTotals = new Map<string, { locationId: string; locationName: string; quantity: number; total: Decimal }>();
    for (const level of purchase.fills) {
      if (!level.locationId || !level.locationName) continue;
      const current = sourceTotals.get(level.locationId) ?? {
        locationId: level.locationId,
        locationName: level.locationName,
        quantity: 0,
        total: D(0),
      };
      current.quantity += level.quantity;
      current.total = current.total.plus(level.value);
      sourceTotals.set(level.locationId, current);
    }
    return {
      typeId: material.typeId,
      typeName: input.materialNames?.get(material.typeId) ?? `Type ${material.typeId}`,
      quantity,
      averageUnitPrice: purchase.filled === quantity && quantity > 0
        ? D(purchase.total).div(quantity).toFixed(2)
        : null,
      totalCost: purchase.filled === quantity ? purchase.total : null,
      filled: purchase.filled,
      sources: [...sourceTotals.values()].map((source) => ({
        locationId: source.locationId,
        locationName: source.locationName,
        quantity: source.quantity,
        totalCost: isk(source.total),
      })),
    };
  });
  const shortMaterials = materials.filter((material) => material.filled < material.quantity);
  if (shortMaterials.length)
    reasons.push(
      "Недостаточная sell-глубина по материалам: " +
        shortMaterials.map((material) => `${material.typeId} ${material.filled}/${material.quantity}`).join(", "),
    );
  const missingAdjustedPrice = recipe.materials.filter(
    (material) => !input.adjustedPrices.has(material.typeId),
  );
  if (missingAdjustedPrice.length)
    reasons.push(
      "Нет adjusted price ESI для EIV: " +
        missingAdjustedPrice.map((material) => material.typeId).join(", "),
    );
  if (!facility.costIndex) reasons.push("Нет актуального manufacturing cost index");

  let eiv: string | null = null;
  let installationFee: string | null = null;
  if (!missingAdjustedPrice.length && facility.costIndex && (
    facility.kind === "npc_station" ||
    (facility.taxRate !== null && !!facility.systemCostMultiplier)
  )) {
    const valueAndFee = manufacturingValueAndFee(
      recipe,
      runs,
      input.adjustedPrices,
      facility.costIndex,
      facility.kind === "npc_station"
        ? undefined
        : { facilityTax: facility.taxRate!, systemCostMultiplier: facility.systemCostMultiplier! },
    );
    eiv = valueAndFee?.eiv ?? null;
    installationFee = valueAndFee?.installationFee ?? null;
  }
  const materialsCost = shortMaterials.length
    ? null
    : isk(sum(materials.map((material) => material.totalCost!)));
  const blueprintAcquisitionCost = input.blueprintAcquisitionCost === null || input.blueprintAcquisitionCost === undefined
    ? null
    : isk(input.blueprintAcquisitionCost);
  const operatingCost = materialsCost && installationFee
    ? D(materialsCost).plus(installationFee)
    : null;
  const totalCost = operatingCost
    ? isk(operatingCost.plus(blueprintAcquisitionCost ?? "0"))
    : null;
  const cashRequired = operatingCost
    ? isk(operatingCost.plus(input.blueprintAcquisitionAlreadyPaid
      ? "0"
      : input.blueprintPurchaseCashCost ?? blueprintAcquisitionCost ?? "0"))
    : null;
  const outputQuantity = output.quantity * runs;
  const demand = input.demand.get(output.typeId) ?? [];
  const immediateFill = fill(demand, outputQuantity, "sell");
  const calculatedFee = rates(input.seller);
  const fee = facility.kind === "structure" && facility.brokerFeeRate !== null && facility.brokerFeeRate !== undefined
    ? { ...calculatedFee, broker: D(facility.brokerFeeRate) }
    : calculatedFee;
  const immediateRevenue = immediateFill.total;
  const immediateProfit = totalCost && immediateFill.filled === outputQuantity
    ? pnl(totalCost, immediateRevenue, fee.tax.toFixed()).profit
    : null;
  const immediateRoi = totalCost && immediateFill.filled === outputQuantity
    ? pnl(totalCost, immediateRevenue, fee.tax.toFixed()).roi
    : null;
  const asks = input.supply.get(output.typeId) ?? [];
  const bestAsk = asks.length
    ? asks.reduce((best, level) => D(level.price).lt(best) ? level.price : best, asks[0]!.price)
    : null;
  const sellGross = bestAsk ? isk(D(bestAsk).mul(outputQuantity)) : null;
  const sellListingFee = sellGross ? listingFee(sellGross, fee.broker) : null;
  const sellProfit = totalCost && sellGross && sellListingFee
    ? pnl(totalCost, sellGross, fee.tax.toFixed(), sellListingFee).profit
    : null;
  const sellRoi = totalCost && sellGross && sellListingFee
    ? pnl(totalCost, sellGross, fee.tax.toFixed(), sellListingFee).roi
    : null;
  const warnings: string[] = [];
  const immediateAvailable = totalCost !== null && immediateFill.filled === outputQuantity && immediateProfit !== null;
  const passiveAvailable = totalCost !== null && sellGross !== null && sellProfit !== null;
  if (!immediateAvailable) warnings.push("Немедленная продажа не покрывает всю партию активными buy-ордерами");
  if (!passiveAvailable) warnings.push("Нет активных sell-ордеров, поэтому пассивный прогноз недоступен");
  if (!immediateAvailable && !passiveAvailable) reasons.push("Для партии не найдено ни одного полного сценария продажи");
  if (totalCost === null) reasons.push("Полная себестоимость пока не рассчитана");
  const timeSeconds = facility.kind === "structure" && facility.timeBonusPercent == null
    ? null
    : manufacturingTimeSeconds(recipe, runs, blueprint.timeEfficiency, input.skills, facility.timeBonusPercent ?? 0);
  if (recipe.baseTimeSeconds === null) reasons.push("В SDE нет базового времени рецепта");
  else if (timeSeconds === null) reasons.push("Не подтверждён применимый к этому изделию бонус времени структуры");
  const capital = blueprintCapitalMetrics(
    blueprint.remainingRuns === -1,
    blueprintAcquisitionCost,
    input.blueprintPurchaseCashCost ?? null,
    immediateProfit,
    sellProfit,
    cashRequired,
    input.blueprintAcquisitionAlreadyPaid ?? false,
  );
  return {
    status: reasons.length ? "review" : "ready",
    reasons,
    warnings,
    blueprintTypeId: input.recipe.blueprintTypeId,
    blueprintItemId: blueprint.itemId,
    facilityId: facility.id,
    runs,
    outputTypeId: output.typeId,
    outputQuantity,
    materials,
    materialsCost,
    estimatedItemValue: eiv,
    installationFee,
    blueprintAcquisitionCost,
    blueprintPurchaseCashCost: capital.purchaseCashCost,
    firstCycleProfit: capital.firstCycleProfit,
    firstCycleRoi: capital.firstCycleRoi,
    blueprintPaybackBatches: capital.paybackBatches,
    totalCost,
    cashRequired,
    immediate: {
      filled: immediateFill.filled,
      gross: immediateRevenue,
      netProfit: immediateProfit,
      roi: immediateRoi,
    },
    sellOrder: {
      unitPrice: bestAsk,
      gross: sellGross,
      netProfit: sellProfit,
      roi: sellRoi,
    },
    fees: {
      accountingLevel: input.seller.accounting,
      brokerRelationsLevel: input.seller.brokerRelations,
      advancedBrokerRelationsLevel: input.seller.advancedBrokerRelations,
      factionStanding: input.seller.factionStanding,
      corporationStanding: input.seller.corporationStanding,
      salesTaxRate: fee.tax.toFixed(6),
      brokerFeeRate: fee.broker.toFixed(6),
    },
    timeSeconds,
    formulaVersion: facility.kind === "npc_station" ? FORMULA_VERSION : "ccp-current-support-alpha-2pct-upwell-profile-v2",
  };
}

/** CCP rounds job material requirements up to whole units and preserves 1/run inputs. */
export function jobMaterialQuantity(
  material: ProductionMaterial,
  runs: number,
  materialEfficiency: number,
  facilityMaterialBonusPercent = 0,
): number {
  if (!Number.isInteger(materialEfficiency) || materialEfficiency < 0 || materialEfficiency > 10)
    throw Error("ME blueprint должен быть от 0 до 100");
  if (!Number.isFinite(facilityMaterialBonusPercent) || facilityMaterialBonusPercent < 0 || facilityMaterialBonusPercent > 100)
    throw Error("Бонус материалов площадки должен быть от 0 до 100 процентов");
  const base = material.quantity * runs;
  if (material.quantity === 1) return base;
  return Math.max(runs, Math.ceil(base * (1 - materialEfficiency / 100) * (1 - facilityMaterialBonusPercent / 100)));
}
