import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  parseExact,
  parseOrders,
  orderSchema,
} from "../../shared/contracts/esi";
import { D, allocateMoney, cents, sum } from "../../engine/accounting/money";
import {
  fill,
  quote,
  pnl,
  cargo,
  profitableQuantity,
} from "../../engine/market/depth";
import { fifo } from "../../engine/accounting/fifo";
import {
  budget,
  typeCapacity,
  WalletBarrier,
} from "../../engine/portfolio/budget";
import { Graph, securityClass, isAdditional } from "../../engine/routes/graph";
import {
  rates,
  listingFee,
  relistFee,
  tickBelow,
} from "../../engine/market/fees";
const supply = [
  { id: "a", quantity: 10, price: "100" },
  { id: "b", quantity: 20, price: "120" },
];
const demand = [
  { id: "c", quantity: 15, price: "150" },
  { id: "d", quantity: 15, price: "130" },
];
describe("stage 0: exact contracts and mandatory mechanics", () => {
  it("preserves large EVE IDs and decimal lexemes", () => {
    expect(parseExact('{"id":9223372036854775807,"money":0.10}')).toEqual({
      id: "9223372036854775807",
      money: "0.10",
    });
    expect(cents("9007199254740993.12")).toBe("900719925474099312");
    expect(() => cents(".001")).toThrow();
  });
  it("validates real-shaped ESI order and rejects malformed/unsafe quantities", () => {
    const raw =
      '[{"order_id":9223372036854775807,"type_id":34,"location_id":60003760,"system_id":30000142,"price":0.01,"is_buy_order":false,"volume_remain":10,"volume_total":20,"min_volume":1,"range":"region","duration":90,"issued":"2026-10-02T00:00:00Z"}]';
    const [o] = parseOrders(raw);
    expect(o.order_id).toBe("9223372036854775807");
    expect(o.price).toBe("0.01");
    expect(o.volume_remain).toBe(10);
    expect(
      orderSchema.safeParse({ ...o, volume_remain: "9007199254740993" })
        .success,
    ).toBe(false);
  });
  it("fixture 1: depth-weighted purchase and sell proceeds", () => {
    const q = quote(supply, demand, 20, ".10");
    expect(q.purchase.total).toBe("2200.00");
    expect(q.sale.total).toBe("2900.00");
    expect(q.result.profit).toBe("410.00");
  });
  it("instant purchase consumes sell orders only, cheapest ask first", () => {
    const asks = [
      { id: "expensive-ask", quantity: 3, price: "74400000" },
      { id: "cheap-ask", quantity: 1, price: "70000000" },
    ];
    const bid = [{ id: "best-buy-order", quantity: 100, price: "15330000" }];
    const purchase = quote(asks, bid, 2, ".01").purchase;
    expect(purchase.fills.map((x) => x.price)).toEqual([
      "70000000",
      "74400000",
    ]);
    expect(purchase.total).toBe("144400000.00");
  });
  it("fixture 2: partial demand never claims full ROI; minimum execution volume", () => {
    const q = quote(
      supply,
      [{ id: "c", quantity: 12, price: "150" }],
      20,
      ".10",
    );
    expect(q.sale.filled).toBe(12);
    expect(q.sale.remaining).toBe(8);
    expect(q.fullROI).toBe(null);
    expect(
      fill([{ id: "m", quantity: 20, price: "150", minVolume: 10 }], 5, "sell")
        .filled,
    ).toBe(0);
  });
  it("shares one order depth across destination quotes", () => {
    const used = new Map<string, number>();
    expect(fill(demand, 20, "sell", used).filled).toBe(20);
    expect(fill(demand, 20, "sell", used).filled).toBe(10);
  });
  it("fixture 3: sell profit and explicit ROI denominator", () => {
    const p = pnl("1000", "1500", ".1", "30", "20");
    expect(p.profit).toBe("300.00");
    expect(p.roi).toBe(D(300).div(1050).toFixed(8));
    expect(D(pnl("2000", "1500", ".1").profit).lt(0)).toBe(true);
  });
  it("does not average a bad marginal tail into a recommendation", () =>
    expect(profitableQuantity(supply, demand, "10000", ".1", ".1")).toBe(15));
  it("fixture 4: FIFO retains unsold cost", () => {
    const r = fifo(
      [
        { id: "1", quantity: 10, unitCost: "100", acquiredAt: "2026-01-01" },
        { id: "2", quantity: 10, unitCost: "120", acquiredAt: "2026-01-02" },
      ],
      12,
      "150",
      ".1",
    );
    expect(r.cost).toBe("1240.00");
    expect(r.revenue).toBe("1800.00");
    expect(r.tax).toBe("180.00");
    expect(r.profit).toBe("380.00");
    expect(r.remaining[1].quantity).toBe(8);
    expect(D(r.remaining[1].unitCost).mul(8).toFixed(2)).toBe("960.00");
    expect(() => fifo([], 1, "150", ".1")).toThrow("NEEDS_REVIEW");
  });
  it.each([
    ["1", "2"],
    ["2", "1"],
  ])(
    "fixture 5: transfer import order %s %s does not inflate wallet",
    (first, second) => {
      const barrier = new WalletBarrier(
        ["1", "2", "3"],
        ["1000000000", "0", "0"],
      );
      const balances: Record<string, string> = {
        "1": "700000000",
        "2": "300000000",
        "3": "0",
      };
      barrier.stage(first, balances[first]);
      expect(barrier.current().wallet).toBe("1000000000.00");
      barrier.stage(second, balances[second]);
      barrier.stage("3", "0");
      expect(barrier.commit(false)).toBe(false);
      expect(barrier.commit(true)).toBe(true);
      expect(barrier.current().wallet).toBe("1000000000.00");
      expect(budget(["1000000000"], ["150000000"], []).available).toBe(
        "650000000.00",
      );
      expect(budget(["850000000"], [], []).available).toBe("680000000.00");
    },
  );
  it("fixture 6: cap includes unsold and reserved without double counting", () =>
    expect(typeCapacity("800000000", ".2", "100000000", "20000000")).toBe(
      "40000000.00",
    ));
  it("fixture 7: cubic metres with unknown propagation", () => {
    expect(
      cargo([
        { quantity: 10, volume: "5" },
        { quantity: 3, volume: "12.5" },
      ]),
    ).toBe("87.5");
    expect(cargo([{ quantity: 1, volume: null }])).toBeNull();
  });
  it("production fees, minimums, four-significant-digit ticks", () => {
    const r = rates({
      accounting: 5,
      brokerRelations: 5,
      advancedBrokerRelations: 5,
      factionStanding: "0",
      corporationStanding: "0",
    });
    expect(r.tax.toFixed()).toBe("0.03375");
    expect(r.broker.toFixed()).toBe("0.015");
    expect(listingFee("100", r.broker)).toBe("100.00");
    expect(relistFee("2000000", "1950000", ".03", ".6")).toBe("23400.00");
    expect(tickBelow("1000000")).toBe("999900");
    expect(tickBelow("10")).toBe("9.99");
  });
  it("security classification uses CCP raw thresholds", () => {
    expect(securityClass(0.44999)).toBe("lowsec");
    expect(securityClass(0.45)).toBe("highsec");
    expect(securityClass(0.000001)).toBe("lowsec");
    expect(securityClass(0)).toBe("nullsec");
  });
  it("fixtures 8–9: zones, routes and independent extra stop eligibility", () => {
    const g = new Graph([
      { id: "A", name: "A", regionId: "R", security: 1, neighbors: ["L", "C"] },
      {
        id: "L",
        name: "L",
        regionId: "R",
        security: 0.2,
        neighbors: ["A", "B"],
      },
      {
        id: "C",
        name: "C",
        regionId: "R",
        security: 0.7,
        neighbors: ["A", "D"],
      },
      {
        id: "D",
        name: "D",
        regionId: "R2",
        security: 0.8,
        neighbors: ["C", "B"],
      },
      {
        id: "B",
        name: "B",
        regionId: "R2",
        security: 0.9,
        neighbors: ["D", "L"],
      },
      { id: "N", name: "N", regionId: "R", security: 0, neighbors: [] },
    ]);
    expect(g.route("A", "B", "highsec")).toEqual(["A", "C", "D", "B"]);
    expect(g.route("A", "B", "lowsec")).toEqual(["A", "L", "B"]);
    expect(g.route("A", "N", "lowsec")).toBe(null);
    const path = g.route("A", "B", "highsec");
    expect(isAdditional(path, "highsec", g.zone(["A", "B"]), "C", "B")).toBe(
      true,
    );
    expect(isAdditional(path, "lowsec", g.zone(["A"]), "C", "B")).toBe(false);
    expect(isAdditional(path, "highsec", new Set(["A"]), "C", "B")).toBe(false);
    expect(isAdditional(path, "highsec", g.zone(["A"]), "C", "A")).toBe(false);
    expect(
      g.buyApplies(
        { locationId: "S1", systemId: "A", regionId: "R", range: "region" },
        { id: "S2", systemId: "C", regionId: "R" },
      ),
    ).toBe(true);
    expect(
      g.buyApplies(
        { locationId: "S1", systemId: "A", regionId: "R", range: "region" },
        { id: "S2", systemId: "B", regionId: "R2" },
      ),
    ).toBe(false);
  });
  it("BFS includes three edges across region but not fourth; union deduplicates", () => {
    const graph = new Graph(
      Array.from({ length: 8 }, (_, i) => ({
        id: String(i),
        name: String(i),
        regionId: i < 3 ? "R1" : "R2",
        security: 1,
        neighbors: [i - 1, i + 1].filter((n) => n >= 0 && n < 8).map(String),
      })),
    );
    expect([...graph.zone(["0"])]).toEqual(["0", "1", "2", "3"]);
    expect(graph.zone(["0", "1"]).size).toBe(5);
  });
  it("property: allocation sums exactly, signed cents conserved", () =>
    fc.assert(
      fc.property(
        fc.integer({ min: -10000000, max: 10000000 }),
        fc.array(fc.integer({ min: 1, max: 10000 }), {
          minLength: 1,
          maxLength: 20,
        }),
        (n, weights) => {
          const total = D(n).div(100).toFixed(2);
          expect(
            sum(allocateMoney(total, weights.map(String))).toFixed(2),
          ).toBe(total);
        },
      ),
      { seed: 20261002 },
    ));
  it("property: fill never exceeds demand, supply, budget never negative", () =>
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10000 }),
        fc.integer({ min: 0, max: 10000 }),
        (q, available) => {
          const f = fill(
            [{ id: "x", price: "1.23", quantity: available }],
            q,
            "buy",
          );
          expect(f.filled).toBe(Math.min(q, available));
          expect(
            D(budget(["100"], [String(available)], []).available).gte(0),
          ).toBe(true);
        },
      ),
      { seed: 20261002 },
    ));
});
