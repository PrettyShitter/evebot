import { describe, expect, it } from "vitest";
import {
  estimateCurrentProjectCost,
  estimateCurrentProjectProfit,
  resolveManufacturingExecutionCost,
} from "../../engine/production/project-cost";

describe("current production project cost", () => {
  it("uses a forecast only before jobs are linked and requires every linked job fee for an actual total", () => {
    expect(resolveManufacturingExecutionCost([], "50.00")).toBe("50.00");
    expect(resolveManufacturingExecutionCost([{ cost: "25.00" }, { cost: null }], "50.00")).toBeNull();
    expect(resolveManufacturingExecutionCost([{ cost: "25.00" }, { cost: "30.00" }], "50.00")).toBe("55.00");
  });

  it("replaces a forecast by actual purchased cost and quotes only missing units", () => {
    const cost = estimateCurrentProjectCost({
      materials: [{ typeId: "34", required: 20, purchased: 10, actualCost: "1200.00" }],
      asksByType: new Map([["34", [
        { id: "a", price: "100.00", quantity: 5 },
        { id: "b", price: "120.00", quantity: 5 },
      ]]]),
      executionFee: "50.00",
      marketFresh: true,
    });
    expect(cost).toBe("2350.00");
  });

  it("does not invent a current total when the remaining sell depth is incomplete or stale", () => {
    const input = {
      materials: [{ typeId: "34", required: 20, purchased: 10, actualCost: "1200.00" }],
      asksByType: new Map([["34", [{ id: "a", price: "100.00", quantity: 5 }]]]),
      executionFee: "50.00",
      marketFresh: true,
    };
    expect(estimateCurrentProjectCost(input)).toBeNull();
    expect(estimateCurrentProjectCost({ ...input, marketFresh: false })).toBeNull();
  });

  it("keeps all actual costs when the project has no missing materials", () => {
    expect(estimateCurrentProjectCost({
      materials: [{ typeId: "34", required: 10, purchased: 10, actualCost: "1200.00" }],
      asksByType: new Map(),
      executionFee: "50.00",
      marketFresh: false,
    })).toBe("1250.00");
  });

  it("quotes current profit through both exits only when every output has full depth", () => {
    const result = estimateCurrentProjectProfit({
      outputs: [{ typeId: "100", quantity: 10 }, { typeId: "200", quantity: 5 }],
      asksByType: new Map([
        ["100", [{ id: "a1", price: "10", quantity: 10 }]],
        ["200", [{ id: "a2", price: "20", quantity: 5 }]],
      ]),
      demandByType: new Map([
        ["100", [{ id: "b1", price: "10", quantity: 10 }]],
        ["200", [{ id: "b2", price: "20", quantity: 5 }]],
      ]),
      totalCost: "100.00",
      salesTaxRate: "0.075",
      brokerFeeRate: "0.01",
      marketFresh: true,
    });
    expect(result).toEqual({ immediate: "85.00", sellOrder: "-115.00" });
    expect(estimateCurrentProjectProfit({
      outputs: [{ typeId: "100", quantity: 10 }, { typeId: "200", quantity: 5 }],
      asksByType: new Map([["100", [{ id: "a1", price: "10", quantity: 10 }]]]),
      demandByType: new Map([["100", [{ id: "b1", price: "10", quantity: 10 }]]]),
      totalCost: "100.00", salesTaxRate: "0.075", brokerFeeRate: "0.01", marketFresh: true,
    })).toEqual({ immediate: null, sellOrder: null });
  });
});
