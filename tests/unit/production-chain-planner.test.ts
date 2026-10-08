import { describe, expect, it } from "vitest";
import { planMakeBuyChain, type ChainRecipe } from "../../engine/production/chain-planner";
import type { Level } from "../../engine/market/depth";

const recipe = (input: Partial<ChainRecipe> & Pick<ChainRecipe, "id" | "outputTypeId" | "materialsForRuns">): ChainRecipe => ({
  outputPerRun: 1,
  maxRuns: 10,
  availableRuns: 10,
  reusableBlueprint: false,
  facilityId: "jita",
  timeSecondsForRuns: (runs) => runs * 10,
  fixedCostForRuns: () => "0.00",
  ...input,
});
const levels = (...orders: [string, string, string, number][]): Map<string, Level[]> => new Map(
  [...new Set(orders.map(([typeId]) => typeId))].map((typeId) => [typeId,
    orders.filter(([id]) => id === typeId).map(([, key, price, quantity]) => ({ id: key, price, quantity }))]),
);

describe("make/buy chain planner", () => {
  it("compares full recursively sourced cost, including fixed job fees", () => {
    const result = planMakeBuyChain({
      targetTypeId: "A",
      targetQuantity: 2,
      recipes: [
        recipe({ id: "A-blueprint", outputTypeId: "A", materialsForRuns: (runs) => [{ typeId: "B", quantity: runs }] }),
        recipe({ id: "B-blueprint", outputTypeId: "B", materialsForRuns: (runs) => [{ typeId: "C", quantity: runs }], fixedCostForRuns: (runs) => (runs * 10).toFixed(2) }),
      ],
      asksByType: levels(["B", "b1", "100.00", 10], ["C", "c1", "5.00", 10]),
    });
    expect(result.status).toBe("ready");
    expect(result.totalCost).toBe("30.00");
    expect(result.actions.filter((action) => action.kind === "manufacturing").map((action) => action.typeId)).toEqual(["A", "B"]);
    expect(result.slotSeconds).toBe(40);
  });

  it("aggregates a common input into one purchase action and shares order depth", () => {
    const result = planMakeBuyChain({
      targetTypeId: "ROOT",
      targetQuantity: 1,
      recipes: [
        recipe({ id: "root", outputTypeId: "ROOT", materialsForRuns: () => [
          { typeId: "LEFT", quantity: 1 }, { typeId: "RIGHT", quantity: 1 },
        ] }),
        recipe({ id: "left", outputTypeId: "LEFT", materialsForRuns: () => [{ typeId: "COMMON", quantity: 5 }] }),
        recipe({ id: "right", outputTypeId: "RIGHT", materialsForRuns: () => [{ typeId: "COMMON", quantity: 5 }] }),
      ],
      asksByType: levels(["COMMON", "c1", "1.00", 7], ["COMMON", "c2", "2.00", 3]),
    });
    expect(result.status).toBe("ready");
    expect(result.totalCost).toBe("13.00");
    const common = result.actions.filter((action) => action.kind === "purchase" && action.typeId === "COMMON");
    expect(common).toHaveLength(1);
    expect(common[0]).toMatchObject({ quantity: 10, cost: "13.00", parents: expect.arrayContaining([expect.any(String)]) });
  });

  it("breaks manufacturing cycles by buying an external leaf and never double-counts the loop", () => {
    const result = planMakeBuyChain({
      targetTypeId: "A",
      targetQuantity: 1,
      recipes: [
        recipe({ id: "recipe-a", outputTypeId: "A", materialsForRuns: () => [{ typeId: "B", quantity: 1 }] }),
        recipe({ id: "recipe-b", outputTypeId: "B", materialsForRuns: () => [{ typeId: "A", quantity: 1 }] }),
      ],
      asksByType: levels(["B", "b1", "7.00", 1]),
    });
    expect(result.status).toBe("ready");
    expect(result.totalCost).toBe("7.00");
    expect(result.actions.filter((action) => action.kind === "manufacturing")).toHaveLength(1);
  });

  it("rejects incomplete depth and exhausted BPC runs without fabricating a complete plan", () => {
    expect(planMakeBuyChain({
      targetTypeId: "A", targetQuantity: 2,
      recipes: [], asksByType: levels(["A", "a1", "1.00", 1]),
    })).toMatchObject({ status: "review", totalCost: null, actions: [] });
    expect(planMakeBuyChain({
      targetTypeId: "A", targetQuantity: 2,
      recipes: [recipe({ id: "copy", outputTypeId: "A", availableRuns: 1, materialsForRuns: () => [{ typeId: "RAW", quantity: 1 }] })],
      asksByType: levels(["RAW", "r1", "1.00", 1]),
    })).toMatchObject({ status: "review", totalCost: null, actions: [] });
  });

  it("combines a limited BPC with market purchases for the remainder", () => {
    const result = planMakeBuyChain({
      targetTypeId: "A", targetQuantity: 5,
      recipes: [recipe({
        id: "limited-copy", outputTypeId: "A", availableRuns: 3,
        materialsForRuns: (runs) => [{ typeId: "RAW", quantity: runs }],
        fixedCostForRuns: (runs) => runs.toFixed(2),
      })],
      asksByType: levels(["A", "a1", "10.00", 5], ["RAW", "raw1", "2.00", 3]),
    });
    expect(result.status).toBe("ready");
    expect(result.totalCost).toBe("29.00");
    expect(result.actions).toContainEqual(expect.objectContaining({ kind: "manufacturing", typeId: "A", runs: 3, quantity: 3 }));
    expect(result.actions).toContainEqual(expect.objectContaining({ kind: "purchase", typeId: "A", quantity: 2, cost: "20.00" }));
  });

  it("forces an owned final blueprint while still choosing make or buy for its inputs", () => {
    const result = planMakeBuyChain({
      targetTypeId: "FINAL", targetQuantity: 1, forceTargetRecipeId: "owned-final",
      recipes: [
        recipe({ id: "owned-final", outputTypeId: "FINAL", materialsForRuns: () => [{ typeId: "COMPONENT", quantity: 1 }] }),
        recipe({ id: "component-copy", outputTypeId: "COMPONENT", materialsForRuns: () => [{ typeId: "RAW", quantity: 1 }], fixedCostForRuns: () => "1.00" }),
      ],
      asksByType: levels(["FINAL", "f1", "0.01", 1], ["COMPONENT", "c1", "5.00", 1], ["RAW", "r1", "1.00", 1]),
    });
    expect(result.status).toBe("ready");
    expect(result.totalCost).toBe("2.00");
    expect(result.actions.some((action) => action.kind === "purchase" && action.typeId === "FINAL")).toBe(false);
    expect(result.actions.filter((action) => action.kind === "manufacturing").map((action) => action.typeId)).toEqual(["FINAL", "COMPONENT"]);
  });

  it("preserves the source lot when costed project surplus wins the buy comparison", () => {
    const result = planMakeBuyChain({
      targetTypeId: "FINAL",
      targetQuantity: 1,
      forceTargetRecipeId: "owned-final",
      recipes: [recipe({
        id: "owned-final",
        outputTypeId: "FINAL",
        materialsForRuns: () => [{ typeId: "COMPONENT", quantity: 1 }],
      })],
      asksByType: new Map([[
        "COMPONENT",
        [
          { id: "inventory:lot-1", price: "3.50", quantity: 1, inventoryLotId: "lot-1" },
          { id: "market:ask-1", price: "5.00", quantity: 1 },
        ],
      ]]),
    });

    expect(result.status).toBe("ready");
    expect(result.totalCost).toBe("3.50");
    expect(result.actions).toContainEqual(expect.objectContaining({
      kind: "purchase",
      typeId: "COMPONENT",
      quantity: 1,
      sources: [expect.objectContaining({ id: "inventory:lot-1", quantity: 1, inventoryLotId: "lot-1" })],
    }));
  });

  it("retains station provenance for every market fill in a purchase action", () => {
    const result = planMakeBuyChain({
      targetTypeId: "RAW",
      targetQuantity: 3,
      recipes: [],
      asksByType: new Map([["RAW", [
        { id: "jita-order", price: "2.00", quantity: 2, locationId: "60003760", locationName: "Jita IV" },
        { id: "perimeter-order", price: "3.00", quantity: 1, locationId: "60003764", locationName: "Perimeter III" },
      ]]]),
    });

    expect(result.status).toBe("ready");
    expect(result.actions[0]?.sources).toEqual([
      expect.objectContaining({ id: "jita-order", quantity: 2, unitCost: "2.00", locationId: "60003760", locationName: "Jita IV" }),
      expect.objectContaining({ id: "perimeter-order", quantity: 1, unitCost: "3.00", locationId: "60003764", locationName: "Perimeter III" }),
    ]);
  });
});
