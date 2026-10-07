import { describe, expect, it } from "vitest";
import {
  allocateBlueprintAcquisitionCost,
  matchCompletedBlueprintContractAcquisitions,
  singleKnownBpc,
} from "../../engine/production/contract-acquisition";

describe("completed public blueprint contract acquisition matching", () => {
  const contract = {
    contractId: "7001",
    type: "item_exchange",
    status: "finished",
    acceptorId: "9001",
    locationId: "60003760",
    price: "1200000.00",
  };
  const listing = {
    contractId: "7001",
    locationId: "60003760",
    price: "1200000.00",
    blueprintOnly: true,
    items: [{ typeId: "683", quantity: 1, isBlueprintCopy: true, materialEfficiency: 8, timeEfficiency: 12, runs: 40 }],
  };
  const blueprint = {
    itemId: "8001", typeId: "683", locationId: "60003760", quantity: 1,
    materialEfficiency: 8, timeEfficiency: 12, runs: 40,
  };

  it("matches a finished contract to its unique BPC and retains full price and original runs", () => {
    expect(matchCompletedBlueprintContractAcquisitions("9001", [contract], [listing], [blueprint]))
      .toEqual([{ blueprintItemId: "8001", contractId: "7001", price: "1200000.00", acquisitionRuns: 40 }]);
  });

  it("allows one known BPC in a mixed bundle while retaining the full bundle price", () => {
    const mixed = { ...listing, blueprintOnly: false };
    expect(singleKnownBpc(mixed)).toEqual(mixed.items[0]);
    expect(matchCompletedBlueprintContractAcquisitions("9001", [contract], [mixed], [blueprint]))
      .toEqual([{ blueprintItemId: "8001", contractId: "7001", price: "1200000.00", acquisitionRuns: 40 }]);
    expect(singleKnownBpc({ ...mixed, items: [mixed.items[0]!, { ...mixed.items[0]!, typeId: "684" }] })).toBeNull();
  });

  it("does not match unaccepted, unfinished, mismatched or ambiguous records", () => {
    expect(matchCompletedBlueprintContractAcquisitions("9001", [{ ...contract, status: "in_progress" }], [listing], [blueprint])).toEqual([]);
    expect(matchCompletedBlueprintContractAcquisitions("9001", [{ ...contract, acceptorId: "9002" }], [listing], [blueprint])).toEqual([]);
    expect(matchCompletedBlueprintContractAcquisitions("9001", [contract], [listing], [{ ...blueprint, itemId: "8002" }, blueprint])).toEqual([]);
    expect(matchCompletedBlueprintContractAcquisitions("9001", [contract], [listing, { ...listing }], [blueprint])).toEqual([]);
    expect(matchCompletedBlueprintContractAcquisitions("9001", [contract], [{ ...listing, items: [{ ...listing.items[0]!, runs: null }] }], [blueprint])).toEqual([]);
  });

  it("uses the public contract item ID when ESI supplies it and rejects a different owned item", () => {
    const exactListing = { ...listing, items: [{ ...listing.items[0]!, itemId: "8001" }] };
    expect(matchCompletedBlueprintContractAcquisitions("9001", [contract], [exactListing], [blueprint]))
      .toEqual([{ blueprintItemId: "8001", contractId: "7001", price: "1200000.00", acquisitionRuns: 40 }]);
    expect(matchCompletedBlueprintContractAcquisitions("9001", [contract], [exactListing], [{ ...blueprint, itemId: "8002" }]))
      .toEqual([]);
  });

  it("compares ESI contract prices numerically despite different decimal formatting", () => {
    expect(matchCompletedBlueprintContractAcquisitions(
      "9001", [{ ...contract, price: "1200000" }], [listing], [blueprint],
    )).toHaveLength(1);
  });
});

describe("BPC purchase cost per allocated run", () => {
  it("keeps the purchase price across partial projects without assigning it twice", () => {
    expect(allocateBlueprintAcquisitionCost("1200000.00", 40, 10)).toBe("300000.00");
    expect(allocateBlueprintAcquisitionCost("1200000.00", 40, 30)).toBe("900000.00");
    expect(allocateBlueprintAcquisitionCost("1200000.00", 40, 40)).toBe("1200000.00");
  });

  it("refuses unknown prices and impossible run allocations", () => {
    expect(allocateBlueprintAcquisitionCost(null, 40, 10)).toBeNull();
    expect(allocateBlueprintAcquisitionCost("1200000.00", null, 10)).toBeNull();
    expect(allocateBlueprintAcquisitionCost("1200000.00", 40, 41)).toBeNull();
    expect(allocateBlueprintAcquisitionCost("9007199254740993.00", 2, 1)).toBe("4503599627370496.50");
  });
});
