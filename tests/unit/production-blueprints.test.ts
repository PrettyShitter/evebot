import { describe, expect, it } from "vitest";
import { availableBlueprintRuns, canReserveBlueprintRuns } from "../../engine/production/blueprints";

describe("blueprint run reservations", () => {
  it("subtracts active BPC runs and never offers more than remain", () => {
    expect(availableBlueprintRuns(80, [20, 20], 100)).toBe(40);
    expect(canReserveBlueprintRuns(80, [20, 20], 40)).toBe(true);
    expect(canReserveBlueprintRuns(80, [20, 20], 41)).toBe(false);
    expect(availableBlueprintRuns(80, [20, 60], 100)).toBe(0);
  });

  it("locks a BPO only while another active job holds it, then reuses it", () => {
    expect(availableBlueprintRuns(-1, [], 100)).toBe(100);
    expect(availableBlueprintRuns(-1, [1], 100)).toBe(0);
    expect(availableBlueprintRuns(-1, [], 100)).toBe(100);
  });

  it("rejects invalid run reservations", () => {
    expect(() => availableBlueprintRuns(-2, [], 100)).toThrow();
    expect(() => availableBlueprintRuns(5, [0], 100)).toThrow();
    expect(canReserveBlueprintRuns(5, [], 0)).toBe(false);
  });
});
