import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../shared/contracts/app";
import { scanOpportunities } from "../../engine/market/opportunities";
import type { ScanInputs } from "../../engine/market/opportunities";

function inputs(minProfit: string, history: ScanInputs["history"]): ScanInputs {
  const station = (id: string, systemId: string) => ({
    id,
    name: id,
    systemId,
    regionId: "30000001",
    ownerId: "1",
    factionId: null,
  });
  return {
    data: {
      version: "test",
      npcStationIds: ["100", "101"],
      systems: [
        {
          id: "200",
          name: "A",
          regionId: "30000001",
          security: 1,
          neighbors: ["201"],
        },
        {
          id: "201",
          name: "B",
          regionId: "30000001",
          security: 1,
          neighbors: ["200"],
        },
      ],
      stations: [station("100", "200"), station("101", "201")],
      types: [
        {
          id: "42",
          name: "Test item",
          englishName: "Test item",
          groupId: "1",
          marketGroupId: "1",
          volume: "1",
        },
      ],
      zone: ["200", "201"],
      regions: ["30000001"],
      marketGroups: [],
    },
    orders: [
      {
        order_id: "1",
        type_id: "42",
        location_id: "100",
        system_id: "200",
        price: "100",
        is_buy_order: false,
        volume_remain: 10,
        volume_total: 10,
        min_volume: 1,
        range: "station",
        duration: 90,
        issued: "2026-10-02T00:00:00Z",
      },
      {
        order_id: "2",
        type_id: "42",
        location_id: "101",
        system_id: "201",
        price: "110",
        is_buy_order: true,
        volume_remain: 10,
        volume_total: 10,
        min_volume: 1,
        range: "station",
        duration: 90,
        issued: "2026-10-02T00:00:00Z",
      },
    ],
    settings: { ...DEFAULT_SETTINGS, minProfit },
    available: "100000",
    pool: "100000",
    exposures: new Map(),
    profile: () => ({
      accounting: 5,
      brokerRelations: 5,
      advancedBrokerRelations: 5,
      factionStanding: "0",
      corporationStanding: "0",
    }),
    history,
    at: "2026-10-02T00:00:00Z",
    snapshotIds: ["test"],
  };
}

describe("scanOpportunities minimum-profit pruning", () => {
  it("skips liquidity and history work when even the optimistic profit cannot meet the floor", () => {
    const history = vi.fn(() => []);
    const result = scanOpportunities(inputs("10000000", history));

    expect(result).toEqual([]);
    expect(history).not.toHaveBeenCalled();
  });

  it("retains profitable candidates below the configured floor", () => {
    const history = vi.fn(() => []);
    const progress = vi.fn();
    const result = scanOpportunities({
      ...inputs("0", history),
      onProgress: progress,
    });

    expect(result).toHaveLength(1);
    expect(result[0].availableQuantity).toBe(10);
    expect(history).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenLastCalledWith({
      phase: "Расчёт цен и доступного объёма по товарам",
      processed: 1,
      total: 1,
    });
  });
});

it("skips mineral and ore market groups before scoring while retaining ice products", () => {
  const base = inputs(
    "0",
    vi.fn(() => []),
  );
  const oreTypes = [
    {
      id: "34",
      name: "Tritanium",
      englishName: "Tritanium",
      groupId: "18",
      marketGroupId: "1857",
      volume: ".01",
    },
    {
      id: "1230",
      name: "Veldspar",
      englishName: "Veldspar",
      groupId: "462",
      marketGroupId: "518",
      volume: ".1",
    },
    {
      id: "62516",
      name: "Compressed Veldspar",
      englishName: "Compressed Veldspar",
      groupId: "462",
      marketGroupId: "518",
      volume: ".001",
    },
    {
      id: "1000",
      name: "Moon Ore",
      englishName: "Moon Ore",
      groupId: "123",
      marketGroupId: "2396",
      volume: ".1",
    },
    {
      id: "900",
      name: "Ice Product",
      englishName: "Ice Product",
      groupId: "423",
      marketGroupId: "1033",
      volume: "1",
    },
  ];
  const withOrders = oreTypes.flatMap((type, index) => {
    const [ask, bid] = base.orders;
    return [
      { ...ask, order_id: String(10 + index * 2), type_id: type.id },
      { ...bid, order_id: String(11 + index * 2), type_id: type.id },
    ];
  });
  const history = vi.fn((_type: string, _region: string) => []);
  const result = scanOpportunities({
    ...base,
    data: {
      ...base.data,
      types: [...base.data.types, ...oreTypes],
      marketGroups: [
        { id: "1857", name: "Minerals", parentId: null },
        { id: "54", name: "Standard Ores", parentId: null },
        { id: "518", name: "Veldspar", parentId: "54" },
        { id: "2395", name: "Moon Ores", parentId: null },
        { id: "2396", name: "Moon Ore", parentId: "2395" },
        { id: "1033", name: "Ice Products", parentId: null },
      ],
    },
    orders: [...base.orders, ...withOrders],
    history,
  });

  expect(result.map((offer) => offer.type.id).sort()).toEqual(["42", "900"]);
  expect(history).toHaveBeenCalledTimes(2);
  expect(
    history.mock.calls.some(([type]) =>
      ["34", "1230", "62516", "1000"].includes(type),
    ),
  ).toBe(false);
});
