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
