import { describe, expect, it } from "vitest";
import { preserveOfferOrder } from "../../renderer/production-order";

describe("preserve offer order while market updates await acknowledgement", () => {
  it("keeps existing rows stable and appends newly discovered offers in their fresh sort order", () => {
    const freshSort = [
      { id: "new-best", profit: 100 },
      { id: "second", profit: 80 },
      { id: "first", profit: 60 },
      { id: "new-next", profit: 40 },
    ];
    expect(preserveOfferOrder(freshSort, ["first", "second"])).toEqual([
      { id: "first", profit: 60 },
      { id: "second", profit: 80 },
      { id: "new-best", profit: 100 },
      { id: "new-next", profit: 40 },
    ]);
  });

  it("preserves the requested sort order when there was no previous list", () => {
    expect(preserveOfferOrder([{ id: "higher" }, { id: "lower" }], [])).toEqual([
      { id: "higher" },
      { id: "lower" },
    ]);
  });
});
