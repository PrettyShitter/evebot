import { describe, expect, it } from "vitest";
import { estimateReprocessing } from "../../engine/production/reprocessing";

const fixture = {
  recipe: {
    typeId: "100",
    materials: [
      { typeId: "200", quantity: 100 },
      { typeId: "201", quantity: 20 },
    ],
  },
  portionSize: 100,
  inputQuantity: 250,
  yieldPercent: "50",
  evidenceAt: new Date().toISOString(),
  reprocessingTaxRate: "0",
  adjustedPrices: new Map([["200", "1"], ["201", "1"]]),
  supply: [{ id: "s1", price: "2", quantity: 250 }],
  demand: new Map([
    ["200", [{ id: "b1", price: "6", quantity: 100 }]],
    ["201", [{ id: "b2", price: "4", quantity: 20 }]],
  ]),
  asks: new Map([
    ["200", [{ id: "a1", price: "8", quantity: 100 }]],
    ["201", [{ id: "a2", price: "5", quantity: 20 }]],
  ]),
  seller: {
    accounting: 0,
    brokerRelations: 0,
    advancedBrokerRelations: 0,
    factionStanding: "0",
    corporationStanding: "0",
  },
  observedAt: new Date().toISOString(),
};

describe("reprocessing estimator", () => {
  it("keeps incomplete portions and prices every output in both market modes", () => {
    const result = estimateReprocessing(fixture);
    expect(result).toMatchObject({
      status: "ready",
      consumedQuantity: 200,
      residualQuantity: 50,
      portions: 2,
      inputsCost: "400.00",
      outputs: [
        { typeId: "200", quantity: 100, buyGross: "600.00" },
        { typeId: "201", quantity: 20, buyGross: "80.00" },
      ],
      immediate: { gross: "680.00", tax: "51.00", netProfit: "229.00" },
      sellOrder: { gross: "900.00", listingFees: "200.00", netProfit: "232.50" },
    });
  });

  it("applies the EVE output rounding rule for ore, ice, and other reprocessable items", () => {
    const estimate = (outputRounding: "ceil" | "nearest" | "floor", yieldPercent = "40") =>
      estimateReprocessing({
        ...fixture,
        recipe: { ...fixture.recipe, outputRounding, materials: [{ typeId: "200", quantity: 3 }] },
        inputQuantity: 100,
        yieldPercent,
        supply: [{ id: "s1", price: "2", quantity: 100 }],
        demand: new Map([["200", [{ id: "b1", price: "1", quantity: 10 }]]]),
        asks: new Map([["200", [{ id: "a1", price: "1", quantity: 10 }]]]),
      });

    expect(estimate("ceil").outputs[0]?.quantity).toBe(2);
    expect(estimate("nearest").outputs[0]?.quantity).toBe(1);
    expect(estimate("floor").outputs[0]?.quantity).toBe(1);
    expect(estimate("nearest", "50").outputs[0]?.quantity).toBe(2);
  });

  it("keeps unclassified asteroid materials in review instead of asserting a rounding rule", () => {
    const result = estimateReprocessing({
      ...fixture,
      recipe: { ...fixture.recipe, outputRounding: "unknown" },
    });
    expect(result.status).toBe("review");
    expect(result.reasons).toContain("Неизвестное округление выхода для типа 100; сверьте Reprocess preview");
  });

  it("keeps unknown preview yield and partial depth in review", () => {
    const result = estimateReprocessing({
      ...fixture,
      yieldPercent: null,
      evidenceAt: null,
      supply: [{ id: "s1", price: "2", quantity: 100 }],
      demand: new Map([["200", [{ id: "b1", price: "6", quantity: 10 }]]]),
    });
    expect(result.status).toBe("review");
    expect(result.inputsCost).toBeNull();
    expect(result.immediate.netProfit).toBeNull();
    expect(result.reasons).toContain("Не подтверждён итоговый выход из Reprocess preview на этой площадке");
  });

  it("does not trust malformed, stale, or future-dated game preview evidence", () => {
    const dates = [
      "not-a-date",
      new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    ];
    for (const evidenceAt of dates) {
      const result = estimateReprocessing({ ...fixture, evidenceAt });
      expect(result.status).toBe("review");
      expect(result.reasons).toContain("Дата подтверждения выхода некорректна, слишком старая или находится в будущем; обновите Reprocess preview");
    }
  });

  it("deducts the configured fee from adjusted output value and reviews an unknown fee", () => {
    const taxed = estimateReprocessing({
      ...fixture,
      reprocessingTaxRate: "0.05",
      adjustedPrices: new Map([["200", "2"], ["201", "10"]]),
    });
    expect(taxed.reprocessingTax).toBe("20.00");
    expect(taxed.totalCost).toBe("420.00");
    expect(taxed.immediate.netProfit).toBe("209.00");

    const unknown = estimateReprocessing({ ...fixture, reprocessingTaxRate: null });
    expect(unknown.status).toBe("review");
    expect(unknown.totalCost).toBeNull();
    expect(unknown.reasons).toContain("Не подтверждена ставка налога переработки для этой площадки");
  });

  it("prices reprocessing input from multiple hub locations and reports the source split", () => {
    const result = estimateReprocessing({
      ...fixture,
      supply: [
        { id: "jita-input", price: "2", quantity: 120, locationId: "6001", locationName: "Jita IV" },
        { id: "perimeter-input", price: "3", quantity: 80, locationId: "6002", locationName: "Perimeter" },
      ],
    });
    expect(result.inputsCost).toBe("480.00");
    expect(result.inputSources).toEqual([
      { locationId: "6001", locationName: "Jita IV", quantity: 120, totalCost: "240.00" },
      { locationId: "6002", locationName: "Perimeter", quantity: 80, totalCost: "240.00" },
    ]);
  });

  it("recomputes whole portions, material cost, output volume, and fees for a changed batch", () => {
    const small = estimateReprocessing({
      ...fixture,
      inputQuantity: 100,
      supply: [{ id: "s1", price: "2", quantity: 300 }],
      demand: new Map([
        ["200", [{ id: "b1", price: "6", quantity: 300 }]],
        ["201", [{ id: "b2", price: "4", quantity: 60 }]],
      ]),
      asks: new Map([
        ["200", [{ id: "a1", price: "8", quantity: 300 }]],
        ["201", [{ id: "a2", price: "5", quantity: 60 }]],
      ]),
    });
    const large = estimateReprocessing({
      ...fixture,
      inputQuantity: 200,
      supply: [{ id: "s1", price: "2", quantity: 300 }],
      demand: new Map([
        ["200", [{ id: "b1", price: "6", quantity: 300 }]],
        ["201", [{ id: "b2", price: "4", quantity: 60 }]],
      ]),
      asks: new Map([
        ["200", [{ id: "a1", price: "8", quantity: 300 }]],
        ["201", [{ id: "a2", price: "5", quantity: 60 }]],
      ]),
    });
    expect(small).toMatchObject({ inputQuantity: 100, inputsCost: "200.00", portions: 1 });
    expect(large).toMatchObject({ inputQuantity: 200, inputsCost: "400.00", portions: 2 });
    expect(large.outputs.map((output) => output.quantity)).toEqual([100, 20]);
    expect(Number(large.immediate.gross)).toBeGreaterThan(Number(small.immediate.gross));
  });
});
