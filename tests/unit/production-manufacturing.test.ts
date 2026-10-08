import { describe, expect, it } from "vitest";
import { estimateManufacturing, jobMaterialQuantity } from "../../engine/production/manufacturing";
import type { ManufacturingBlueprint } from "../../engine/market/static-data";

const recipe: ManufacturingBlueprint = {
  blueprintTypeId: "1000",
  maxProductionLimit: 100,
  materials: [
    { typeId: "2000", quantity: 10 },
    { typeId: "2001", quantity: 1 },
  ],
  products: [{ typeId: "3000", quantity: 5 }],
  skills: [{ typeId: "3380", level: 1 }],
  baseTimeSeconds: 1000,
};
const input = {
  recipe,
  runs: 2,
  blueprint: {
    itemId: "4000",
    materialEfficiency: 10,
    timeEfficiency: 4,
    remainingRuns: -1,
    locationId: "5000",
  },
  facility: {
    id: "5000",
    kind: "npc_station" as const,
    accessStatus: "confirmed" as const,
    services: ["manufacturing"],
    taxRate: "0.0025",
    costIndex: "0.01",
  },
  skills: [
    { typeId: "3380", trainedLevel: 5, activeLevel: 3, alphaCap: 3, usableLevel: 3 },
    { typeId: "3388", trainedLevel: 0, activeLevel: 0, alphaCap: 0, usableLevel: 0 },
  ],
  supply: new Map([
    ["2000", [{ id: "a1", price: "100", quantity: 10 }, { id: "a2", price: "120", quantity: 10 }]],
    ["2001", [{ id: "b1", price: "500", quantity: 2 }]],
    ["3000", [{ id: "c1", price: "90", quantity: 10 }]],
  ]),
  demand: new Map([
    ["3000", [{ id: "d1", price: "500", quantity: 6 }, { id: "d2", price: "400", quantity: 4 }]],
  ]),
  adjustedPrices: new Map([
    ["2000", "20"],
    ["2001", "100"],
  ]),
  seller: {
    accounting: 0,
    brokerRelations: 0,
    advancedBrokerRelations: 0,
    factionStanding: "0",
    corporationStanding: "0",
  },
};

describe("manufacturing estimator", () => {
  it("rounds ME materials for the full job, honors one-per-run inputs and computes the current NPC Alpha fee", () => {
    const estimate = estimateManufacturing(input);
    expect(estimate.materials.map(({ typeId, quantity, totalCost }) => ({ typeId, quantity, totalCost }))).toEqual([
      { typeId: "2000", quantity: 18, totalCost: "1960.00" },
      { typeId: "2001", quantity: 2, totalCost: "1000.00" },
    ]);
    expect(estimate.materialsCost).toBe("2960.00");
    // EIV uses ME 0 inputs (20*20 + 2*100 = 600), not the reduced shopping list.
    expect(estimate.estimatedItemValue).toBe("600.00");
    expect(estimate.installationFee).toBe("43.50");
    expect(estimate.totalCost).toBe("3003.50");
    expect(estimate.outputQuantity).toBe(10);
    expect(estimate.immediate.filled).toBe(10);
    expect(estimate.immediate.gross).toBe("4600.00");
    expect(estimate.immediate.netProfit).toBe("1251.50");
    expect(estimate.timeSeconds).toBe(1690);
    expect(estimate.status).toBe("ready");
  });

  it("allocates a previously purchased BPC over its original runs without charging it again as launch cash", () => {
    const estimate = estimateManufacturing({
      ...input,
      blueprintAcquisitionCost: "1200000.00",
      blueprintAcquisitionAlreadyPaid: true,
    });
    expect(estimate.blueprintAcquisitionCost).toBe("1200000.00");
    expect(estimate.totalCost).toBe("1203003.50");
    expect(estimate.cashRequired).toBe("3003.50");
    expect(estimate.immediate.netProfit).toBe("-1198748.50");
  });

  it("keeps full contract cash separate from the cost allocated to a partial BPC run batch", () => {
    const estimate = estimateManufacturing({
      ...input,
      blueprintAcquisitionCost: "300000.00",
      blueprintPurchaseCashCost: "1200000.00",
    });
    expect(estimate.blueprintAcquisitionCost).toBe("300000.00");
    expect(estimate.totalCost).toBe("303003.50");
    expect(estimate.cashRequired).toBe("1203003.50");
    expect(estimate.blueprintPurchaseCashCost).toBe("1200000.00");
    expect(estimate.firstCycleProfit.immediate).toBe("-1198748.50");
    expect(Number(estimate.firstCycleRoi.immediate)).toBeCloseTo(-1198748.5 / 1203003.5, 5);
    expect(estimate.blueprintPaybackBatches.immediate).toBeNull();
  });

  it("separates the first BPO batch from repeat economics and calculates conservative payback", () => {
    const estimate = estimateManufacturing({
      ...input,
      blueprintPurchaseCashCost: "1200000.00",
    });
    expect(estimate.totalCost).toBe("3003.50");
    expect(estimate.cashRequired).toBe("1203003.50");
    expect(estimate.immediate.netProfit).toBe("1251.50");
    expect(estimate.firstCycleProfit.immediate).toBe("-1198748.50");
    expect(estimate.blueprintPaybackBatches.immediate).toBe(959);
  });

  it("does not use zero tax or omitted structure bonuses as a profitable estimate", () => {
    const estimate = estimateManufacturing({
      ...input,
      facility: { ...input.facility, kind: "structure", taxRate: null },
    });
    expect(estimate.status).toBe("review");
    expect(estimate.installationFee).toBeNull();
    expect(estimate.totalCost).toBeNull();
    expect(estimate.reasons).toContain("Не подтверждены налог и применимые к этому изделию бонусы структуры из окна Industry");
  });

  it("uses explicit product-specific structure cost, material and time modifiers", () => {
    const estimate = estimateManufacturing({
      ...input,
      facility: {
        ...input.facility,
        kind: "structure",
        taxRate: "0.01",
        systemCostMultiplier: "0.5",
        materialBonusPercent: 10,
        timeBonusPercent: 5,
        brokerFeeRate: "0.01",
      },
    });
    expect(estimate.materials.map((material) => material.quantity)).toEqual([17, 2]);
    expect(estimate.materialsCost).toBe("2840.00");
    expect(estimate.estimatedItemValue).toBe("600.00");
    expect(estimate.installationFee).toBe("45.00");
    expect(estimate.totalCost).toBe("2885.00");
    expect(estimate.timeSeconds).toBe(1606);
    expect(estimate.formulaVersion).toBe("ccp-current-support-alpha-2pct-upwell-profile-v2");
    expect(estimate.fees.brokerFeeRate).toBe("0.010000");
    expect(estimate.status).toBe("ready");
  });

  it("keeps partial buy depth separate from full-batch profit and reports missing materials", () => {
    const estimate = estimateManufacturing({
      ...input,
      supply: new Map([
        ["2000", [{ id: "a1", price: "100", quantity: 2 }]],
        ["2001", [{ id: "b1", price: "500", quantity: 2 }]],
        ["3000", [{ id: "c1", price: "90", quantity: 10 }]],
      ]),
      demand: new Map([["3000", [{ id: "d1", price: "500", quantity: 2 }]]]),
    });
    expect(estimate.materialsCost).toBeNull();
    expect(estimate.immediate.filled).toBe(2);
    expect(estimate.immediate.netProfit).toBeNull();
    expect(estimate.status).toBe("review");
  });

  it("keeps a fully executable instant-sale quote ready when only the passive ask forecast is missing", () => {
    const estimate = estimateManufacturing({
      ...input,
      supply: new Map([
        ["2000", [{ id: "a1", price: "100", quantity: 20 }]],
        ["2001", [{ id: "b1", price: "500", quantity: 2 }]],
      ]),
    });
    expect(estimate.status).toBe("ready");
    expect(estimate.immediate.netProfit).not.toBeNull();
    expect(estimate.sellOrder.netProfit).toBeNull();
    expect(estimate.warnings).toContain("Нет активных sell-ордеров, поэтому пассивный прогноз недоступен");
  });

  it("does not ME-reduce materials whose base requirement is one per run", () => {
    expect(jobMaterialQuantity({ typeId: "1", quantity: 1 }, 80, 10)).toBe(80);
  });

  it("prices materials across several confirmed hub sources and reports the exact split", () => {
    const estimate = estimateManufacturing({
      ...input,
      supply: new Map([
        ["2000", [
          { id: "jita", price: "100", quantity: 8, locationId: "6001", locationName: "Jita IV" },
          { id: "perimeter", price: "110", quantity: 10, locationId: "6002", locationName: "Perimeter" },
        ]],
        ["2001", [{ id: "b1", price: "500", quantity: 2 }]],
        ["3000", [{ id: "c1", price: "90", quantity: 10 }]],
      ]),
    });

    expect(estimate.materials[0]?.totalCost).toBe("1900.00");
    expect(estimate.materials[0]?.sources).toEqual([
      { locationId: "6001", locationName: "Jita IV", quantity: 8, totalCost: "800.00" },
      { locationId: "6002", locationName: "Perimeter", quantity: 10, totalCost: "1100.00" },
    ]);
  });

  it("counts a whole blueprint-contract price in first-cycle capital and realized margin", () => {
    const estimate = estimateManufacturing({ ...input, blueprintAcquisitionCost: "10000" });
    expect(estimate.blueprintAcquisitionCost).toBe("10000.00");
    expect(estimate.materialsCost).toBe("2960.00");
    expect(estimate.installationFee).toBe("43.50");
    expect(estimate.totalCost).toBe("13003.50");
    expect(estimate.immediate.netProfit).toBe("-8748.50");
  });

  it("re-evaluates every cost and output when the requested run count changes", () => {
    const oneRun = estimateManufacturing({ ...input, runs: 1 });
    const fourRuns = estimateManufacturing({ ...input, runs: 4 });
    expect(oneRun.outputQuantity).toBe(5);
    expect(oneRun.materials[0]?.quantity).toBe(9);
    expect(fourRuns.outputQuantity).toBe(20);
    expect(fourRuns.materials[0]?.quantity).toBe(36);
    expect(fourRuns.totalCost).toBeNull();
    expect(fourRuns.materials[0]?.filled).toBeLessThan(fourRuns.materials[0]?.quantity ?? 0);
    expect(fourRuns.immediate.filled).toBe(10);
    expect(fourRuns.immediate.netProfit).toBeNull();
    expect(fourRuns.status).toBe("review");
  });
});
