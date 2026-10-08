import { describe, expect, it } from "vitest";
import { quoteProjectBuySources } from "../../engine/production/project-sourcing";

describe("project refill sourcing", () => {
  it("splits the cheapest executable purchase across stations and structures", () => {
    const result = quoteProjectBuySources([
      { id: "jita-1", price: "2", quantity: 10, locationId: "60000361", locationName: "Jita" },
      { id: "perimeter-1", price: "1", quantity: 5, locationId: "90000000001", locationName: "Perimeter structure" },
      { id: "jita-2", price: "3", quantity: 10, locationId: "60003760", locationName: "Jita 4-4" },
    ], 12, true);

    expect(result).toEqual({
      filled: 12,
      total: "19.00",
      sources: [
        { locationId: "90000000001", locationName: "Perimeter structure", quantity: 5, unitPrice: "1.00" },
        { locationId: "60000361", locationName: "Jita", quantity: 7, unitPrice: "2.00" },
      ],
    });
  });

  it("does not present a current quote from stale data", () => {
    expect(quoteProjectBuySources([
      { id: "ask", price: "1", quantity: 10, locationId: "60000361", locationName: "Jita" },
    ], 4, false)).toEqual({ filled: 0, total: "0.00", sources: [] });
  });
});
