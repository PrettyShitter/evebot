import { describe, expect, it } from "vitest";
import { EsiClient } from "../../engine/esi/client";
import { fetchOwnProductionData, fetchPublicProductionData, fetchStructureMarkets } from "../../engine/production/esi";

function response(body: unknown, pages = 1) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      Expires: new Date(Date.now() + 600_000).toUTCString(),
      "X-Pages": String(pages),
    },
  });
}

describe("production ESI adapters", () => {
  it("loads paginated read-only character records and preserves BPO/BPC instance IDs", async () => {
    const requests: { path: string; authorization: string | null }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push({
        path: url.pathname + url.search,
        authorization: new Headers(init?.headers).get("Authorization"),
      });
      if (url.pathname.endsWith("/assets/"))
        return response(
          url.searchParams.get("page") === "1"
            ? [
                {
                  item_id: 9007199254740993n.toString(),
                  type_id: 1234567890123456789n.toString(),
                  location_id: "60003760",
                  location_type: "station",
                  location_flag: "Hangar",
                  quantity: 12,
                  is_singleton: false,
                },
              ]
            : [],
          2,
        );
      if (url.pathname.endsWith("/blueprints/"))
        return response([
          {
            item_id: "9007199254740995",
            type_id: "683",
            location_id: "60003760",
            location_flag: "Hangar",
            quantity: -1,
            material_efficiency: 0,
            time_efficiency: 0,
            runs: -1,
          },
          {
            item_id: "9007199254740996",
            type_id: "683",
            location_id: "60003760",
            location_flag: "Hangar",
            quantity: -2,
            material_efficiency: 10,
            time_efficiency: 20,
            runs: 80,
          },
        ]);
      if (url.pathname.endsWith("/industry/jobs/"))
        return response([
          {
            job_id: "9007199254740997",
            installer_id: "9001",
            facility_id: "60003760",
            activity_id: 1,
            blueprint_id: "9007199254740995",
            blueprint_type_id: "683",
            blueprint_location_id: "60003760",
            output_location_id: "60003760",
            runs: 1,
            status: "active",
            duration: 6000,
            start_date: "2026-10-08T00:00:00Z",
            end_date: "2026-10-08T01:40:00Z",
            cost: "123.45",
          },
        ]);
      if (url.pathname.endsWith("/contracts/"))
        return response([
          {
            contract_id: "9007199254740998",
            issuer_id: "9001",
            issuer_corporation_id: "1000001",
            acceptor_id: 0,
            assignee_id: 0,
            start_location_id: "60003760",
            end_location_id: "60003760",
            type: "item_exchange",
            status: "outstanding",
            title: "BPC bundle",
            date_issued: "2026-10-07T00:00:00Z",
            date_expired: "2026-10-14T00:00:00Z",
            price: "30000000.00",
          },
        ]);
      throw Error(`Unexpected ESI path ${url.pathname}`);
    };
    const client = new EsiClient(fetcher);
    const data = await fetchOwnProductionData(client, "9001", "read-only");

    expect(data.assets).toHaveLength(1);
    expect(data.assets[0].item_id).toBe("9007199254740993");
    expect(data.blueprints.map((blueprint) => blueprint.runs)).toEqual([-1, 80]);
    expect(data.blueprints.map((blueprint) => blueprint.item_id)).toEqual([
      "9007199254740995",
      "9007199254740996",
    ]);
    expect(data.jobs[0].job_id).toBe("9007199254740997");
    expect(data.contracts[0].acceptor_id).toBe("0");
    expect(requests).toHaveLength(5);
    expect(requests.every((request) => request.authorization === "Bearer read-only")).toBe(true);
    expect(
      requests.some((request) => request.path.includes("/assets/?page=2")),
    ).toBe(true);
    expect(
      requests.some((request) => request.path.includes("include_completed=true&page=1")),
    ).toBe(true);
  });

  it("parses ESI numeric personal-contract prices without losing decimal precision", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/assets/")) return response([]);
      if (url.pathname.endsWith("/blueprints/")) return response([]);
      if (url.pathname.endsWith("/industry/jobs/")) return response([]);
      if (url.pathname.endsWith("/contracts/"))
        return response([
          {
            contract_id: "990001",
            issuer_id: "9001",
            issuer_corporation_id: "1000001",
            acceptor_id: 9001,
            assignee_id: 9001,
            start_location_id: "60003760",
            end_location_id: "60003760",
            type: "item_exchange",
            status: "finished",
            title: "BPC purchase",
            date_issued: "2026-10-07T00:00:00Z",
            date_expired: "2026-10-14T00:00:00Z",
            price: 123456789012.34,
          },
        ]);
      throw Error(`Unexpected ESI path ${url.pathname}`);
    };

    const data = await fetchOwnProductionData(new EsiClient(fetcher), "9001", "token");

    expect(data.contracts[0]?.price).toBe("123456789012.34");
  });

  it("limits public facility and industry-index data to Jita and Perimeter, retaining unknown tax", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/industry/facilities/"))
        return response([
          {
            facility_id: 60003760,
            owner_id: 1000035,
            region_id: 10000002,
            solar_system_id: 30000142,
            type_id: 1529,
            tax: 0.0,
          },
          {
            facility_id: 90000000001,
            owner_id: 9001,
            region_id: 10000002,
            solar_system_id: 30000144,
            type_id: 35832,
          },
          {
            facility_id: 60000001,
            owner_id: 1000001,
            region_id: 10000002,
            solar_system_id: 30000143,
            type_id: 1529,
          },
        ]);
      if (url.pathname.endsWith("/industry/systems/"))
        return response([
          {
            solar_system_id: 30000142,
            cost_indices: [{ activity: "manufacturing", cost_index: 0.0123 }],
          },
          {
            solar_system_id: 30000144,
            cost_indices: [{ activity: "manufacturing", cost_index: 0.0045 }],
          },
          {
            solar_system_id: 30000143,
            cost_indices: [{ activity: "manufacturing", cost_index: 0.99 }],
          },
        ]);
      if (url.pathname.endsWith("/markets/prices/"))
        return response([
          { type_id: 34, adjusted_price: 2.34, average_price: 3.0 },
          { type_id: 35, average_price: 7.0 },
        ]);
      if (url.pathname === "/contracts/public/10000002/")
        return response([
          {
            contract_id: 9901, issuer_id: 9001, issuer_corporation_id: 1000001,
            type: "item_exchange", date_issued: "2026-10-08T00:00:00Z",
            date_expired: "2027-10-08T00:00:00Z", start_location_id: 60003760,
            title: "Known copy bundle", price: 123456.78,
          },
          {
            contract_id: 9902, issuer_id: 9001, issuer_corporation_id: 1000001,
            type: "auction", date_issued: "2026-10-08T00:00:00Z",
            date_expired: "2027-10-08T00:00:00Z", start_location_id: 60003760,
            title: "Auction", price: 1,
          },
          {
            contract_id: 9903, issuer_id: 9001, issuer_corporation_id: 1000001,
            type: "item_exchange", date_issued: "2026-10-08T00:00:00Z",
            date_expired: "2027-10-08T00:00:00Z", start_location_id: 90000000002,
            title: "Out of scope", price: 1,
          },
        ]);
      if (url.pathname === "/contracts/public/items/9901/")
        return response([
          { record_id: 9911, item_id: 99001, type_id: 683, quantity: 2, is_included: true, is_blueprint_copy: true, material_efficiency: 8, time_efficiency: 15, runs: 40 },
          { record_id: 9914, item_id: 99002, type_id: 683, quantity: -2, is_included: true, is_blueprint_copy: true, material_efficiency: 0, time_efficiency: 0, runs: 20 },
          { record_id: 9912, type_id: 34, quantity: 100, is_included: true },
          { record_id: 9913, type_id: 683, quantity: 1, is_included: false, is_blueprint_copy: true, material_efficiency: 10, time_efficiency: 20, runs: 100 },
        ]);
      throw Error(`Unexpected ESI path ${url.pathname}`);
    };
    const result = await fetchPublicProductionData(
      new EsiClient(fetcher),
      new Set(["30000142", "30000144"]),
    );

    expect(result.facilities).toHaveLength(2);
    expect(result.facilities.find((facility) => facility.systemId === "30000144")?.tax).toBeNull();
    expect([...result.systemIndices.keys()].sort()).toEqual([
      "30000142",
      "30000144",
    ]);
    expect(result.adjustedPrices.get("34")).toBe("2.34");
    expect(result.adjustedPrices.has("35")).toBe(false);
    expect(result.contractCoverage).toEqual({ candidateContracts: 1, fetchedContracts: 1, capped: false, complete: true, itemErrors: 0 });
    expect(result.publicBlueprintContracts).toEqual([{
      contractId: "9901",
      regionId: "10000002",
      locationId: "60003760",
      price: "123456.78",
      expiresAt: "2027-10-08T00:00:00Z",
      title: "Known copy bundle",
      blueprintOnly: false,
      includedItemCount: 3,
      items: [{
        recordId: "9911", itemId: "99001", typeId: "683", quantity: 2, isBlueprintCopy: true,
        materialEfficiency: 8, timeEfficiency: 15, runs: 40,
      }, {
        recordId: "9914", itemId: "99002", typeId: "683", quantity: 1, isBlueprintCopy: true,
        materialEfficiency: 0, timeEfficiency: 0, runs: 20,
      }],
    }]);
  });

  it("loads private structure orders page by page and derives the system from the confirmed profile", async () => {
    const paths: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      paths.push(url.pathname + url.search);
      return new Response(url.searchParams.get("page") === "1"
        ? '[{"order_id":9007199254740993,"type_id":34,"location_id":90000000001,"price":2.5,"is_buy_order":false,"volume_remain":12,"volume_total":20,"min_volume":1,"range":"station","duration":90,"issued":"2026-10-08T00:00:00Z"}]'
        : "[]", { status: 200, headers: { Expires: new Date(Date.now() + 600_000).toUTCString(), "X-Pages": "2" } });
    };
    const result = await fetchStructureMarkets(new EsiClient(fetcher), "token", "9001", [
      { id: "90000000001", systemId: "30000142" },
    ]);
    expect(paths).toEqual([
      "/markets/structures/90000000001?page=1&compatibility_date=2026-08-18",
      "/markets/structures/90000000001?page=2&compatibility_date=2026-08-18",
    ]);
    expect(result[0]).toMatchObject({ state: "available", pages: 2, orders: [{
      order_id: "9007199254740993", type_id: "34", location_id: "90000000001",
      system_id: "30000142", price: "2.5", volume_remain: 12,
    }] });
  });

  it("distinguishes forbidden structure access and refuses to return a capped partial snapshot as available", async () => {
    const forbiddenClient = new EsiClient(async () => new Response("{}", { status: 403 }));
    const forbidden = await fetchStructureMarkets(forbiddenClient, "token", "9001", [
      { id: "90000000001", systemId: "30000142" },
    ]);
    expect(forbidden[0]).toMatchObject({ state: "forbidden", orders: [], message: expect.stringContaining("403") });

    const cappedClient = new EsiClient(async () => response([{
      order_id: "9001", type_id: "34", location_id: "90000000001", price: 2,
      is_buy_order: false, volume_remain: 1, volume_total: 1, min_volume: 1,
      range: "station", duration: 90, issued: "2026-10-08T00:00:00Z",
    }], 2));
    const capped = await fetchStructureMarkets(cappedClient, "token", "9001", [
      { id: "90000000001", systemId: "30000142" },
    ], 1);
    expect(capped[0]).toMatchObject({ state: "capped", pages: 1 });
  });
});
