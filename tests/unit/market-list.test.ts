import { describe, expect, it } from "vitest";
import { mergeOfferRows } from "../../renderer/market-list";

const offer = (id: string, at: string) => ({
  id,
  at,
  quantity: 5,
  availableQuantity: 8,
  sellPrice: "120",
  purchase: { total: "500", fills: [{ price: "100" }] },
  buy: { result: { profit: "100" }, fullROI: "0.2" },
  sell: { profit: "90", roi: "0.18" },
  liquidity: { sellQuantity: 10, reasons: [] },
});

describe("market list background updates", () => {
  it("keeps visible rows during a scan, then updates, appends and prunes once complete", () => {
    const old = offer("old", "1"),
      unchanged = offer("same", "1");
    const whileLoading = mergeOfferRows(
      [old, unchanged],
      [offer("same", "2")],
      false,
    );
    expect(whileLoading).toEqual([old, unchanged]);
    expect(whileLoading[0]).toBe(old);
    expect(whileLoading[1]).toBe(unchanged);

    const updated = { ...offer("same", "2"), quantity: 4 },
      added = offer("new", "2");
    const complete = mergeOfferRows(
      whileLoading,
      [updated, added],
      true,
    );
    expect(complete).toEqual([updated, added]);
    expect(complete[0]).toBe(updated);
  });

  it("returns the existing rows unchanged during idle state polling", () => {
    const rows = [offer("one", "1")];
    expect(mergeOfferRows(rows, [offer("one", "2")], false)).toBe(rows);
  });
});
