import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  withSearchZone,
  type StaticData,
} from "../../engine/market/static-data";
import { excludedMarketTypeIds } from "../../engine/market/classification";
import { Graph, CENTERS } from "../../engine/routes/graph";
import { extractSde } from "../../engine/market/static-data";
import { zipSync, strToU8 } from "fflate";
it("official bundled SDE resolves exact centers and only their NPC stations", () => {
  const source = JSON.parse(
    readFileSync("resources/static-data.json", "utf8"),
  ) as StaticData;
  const data = withSearchZone(source);
  const g = new Graph(data.systems);
  expect(CENTERS.map((c) => g.systems.get(c)?.name)).toEqual([
    "Jita",
    "Amarr",
    "Dodixie",
    "Rens",
  ]);
  const zone = new Set(CENTERS);
  expect([...zone].sort()).toEqual([...data.zone].sort());
  expect(data.regions).toHaveLength(4);
  expect(data.stations.length).toBe(34);
  expect(data.stations.every((s) => zone.has(s.systemId))).toBe(true);
  expect(new Set(data.stations.map((s) => s.id)).size).toBe(
    data.stations.length,
  );
  expect(data.stations.find((s) => s.id === "60003760")?.name).toContain(
    "Caldari Navy",
  );
  expect(data.types.find((t) => t.id === "587")?.volume).toBe("2500");
  expect(data.types.some((t) => t.id === "44992")).toBe(false);
  expect(data.manufacturing?.length).toBeGreaterThan(4500);
  expect(data.reprocessing?.length).toBeGreaterThan(9000);
  expect(data.alphaSkillCaps?.Amarr["3380"]).toBe(5);
  expect(
    data.manufacturing?.find((recipe) => recipe.blueprintTypeId === "683"),
  ).toMatchObject({
    products: [{ typeId: "582", quantity: 1 }],
    baseTimeSeconds: 6000,
  });
  expect(
    data.reprocessing?.find((recipe) => recipe.typeId === "18")?.materials,
  ).toEqual([
    { typeId: "34", quantity: 175 },
    { typeId: "36", quantity: 70 },
  ]);
});

it("classifies SDE minerals, ordinary and compressed ore for early exclusion", () => {
  const source = JSON.parse(
    readFileSync("resources/static-data.json", "utf8"),
  ) as StaticData;
  const excluded = excludedMarketTypeIds(source);

  expect(excluded.has("34")).toBe(true); // Tritanium
  expect(excluded.has("1230")).toBe(true); // Veldspar
  expect(excluded.has("62516")).toBe(true); // Compressed Veldspar
  expect(excluded.has("16262")).toBe(false); // Clear Icicle
  expect(excluded.has("16272")).toBe(false); // Heavy Water
});

it("extracts manufacturing recipes, Alpha caps and reprocessing materials without reactions", () => {
  const jsonl = (rows: unknown[]) =>
    strToU8(rows.map((row) => JSON.stringify(row)).join("\n"));
  const archive = zipSync({
    "_sde.jsonl": jsonl([{ _key: "sde", buildNumber: 3586130 }]),
    "mapSolarSystems.jsonl": jsonl([
      { _key: 30000142, name: { en: "Jita" }, regionID: 10000002, securityStatus: 0.9 },
    ]),
    "mapStargates.jsonl": jsonl([]),
    "npcStations.jsonl": jsonl([
      { _key: 60003760, solarSystemID: 30000142, ownerID: 1000035 },
    ]),
    "types.jsonl": jsonl([
      { _key: 123456789, name: { en: "Large ID" }, groupID: 462, marketGroupID: 64, published: true, portionSize: 1, packagedVolume: 3 },
      { _key: 123456788, name: { en: "Ore" }, groupID: 462, marketGroupID: 64, published: true, portionSize: 100, packagedVolume: 1 },
      { _key: 123456787, name: { en: "Ice" }, groupID: 465, marketGroupID: 64, published: true, portionSize: 100, packagedVolume: 1 },
      { _key: 123456786, name: { en: "Other item" }, groupID: 25, marketGroupID: 64, published: true, portionSize: 1, packagedVolume: 1 },
    ]),
    "groups.jsonl": jsonl([
      { _key: 25, categoryID: 6, name: { en: "Ships" } },
      { _key: 462, categoryID: 25, name: { en: "Veldspar" } },
      { _key: 465, categoryID: 25, name: { en: "Ice" } },
    ]),
    "npcCorporations.jsonl": jsonl([]),
    "marketGroups.jsonl": jsonl([
      { _key: 64, name: { en: "Ships" } },
    ]),
    "industryActivities.jsonl": jsonl([{ _key: 1, name: "Manufacturing" }]),
    "blueprints.jsonl": jsonl([
      {
        _key: 987654321,
        blueprintTypeID: 987654321,
        maxProductionLimit: 30,
        activities: {
          manufacturing: {
            materials: [{ typeID: 123456789, quantity: 24000 }],
            products: [{ typeID: 123456788, quantity: 1 }],
            skills: [{ typeID: 3380, level: 1 }],
            time: 6000,
          },
          reaction: {
            materials: [{ typeID: 555, quantity: 5 }],
            products: [{ typeID: 556, quantity: 1 }],
            time: 10800,
          },
        },
      },
      {
        _key: 1234,
        blueprintTypeID: 1234,
        maxProductionLimit: 100,
        activities: {
          reaction: {
            materials: [{ typeID: 55, quantity: 5 }],
            products: [{ typeID: 56, quantity: 1 }],
            time: 100,
          },
        },
      },
    ]),
    "typeMaterials.jsonl": jsonl([
      {
        _key: 123456789,
        materials: [{ materialTypeID: 34, quantity: 175 }],
      },
      { _key: 123456788, materials: [{ materialTypeID: 34, quantity: 175 }] },
      { _key: 123456787, materials: [{ materialTypeID: 16272, quantity: 100 }] },
      { _key: 123456786, materials: [{ materialTypeID: 34, quantity: 5 }] },
    ]),
    "cloneGrades.jsonl": jsonl([
      {
        _key: 4,
        name: "Alpha Amarr",
        skills: [{ typeID: 3380, level: 3 }],
      },
      {
        _key: 16,
        name: "Omega",
        skills: [{ typeID: 3380, level: 5 }],
      },
    ]),
  });

  const data = extractSde(archive);
  expect(data.version).toBe("3586130");
  expect(data.manufacturing).toEqual([
    {
      blueprintTypeId: "987654321",
      maxProductionLimit: 30,
      materials: [{ typeId: "123456789", quantity: 24000 }],
      products: [{ typeId: "123456788", quantity: 1 }],
      skills: [{ typeId: "3380", level: 1 }],
      baseTimeSeconds: 6000,
    },
  ]);
  expect(data.reprocessing).toEqual([
    {
      typeId: "123456789",
      outputRounding: "ceil",
      materials: [{ typeId: "34", quantity: 175 }],
    },
    { typeId: "123456788", outputRounding: "ceil", materials: [{ typeId: "34", quantity: 175 }] },
    { typeId: "123456787", outputRounding: "nearest", materials: [{ typeId: "16272", quantity: 100 }] },
    { typeId: "123456786", outputRounding: "floor", materials: [{ typeId: "34", quantity: 5 }] },
  ]);
  expect(data.alphaSkillCaps).toEqual({ Amarr: { "3380": 3 } });
});

import { Store } from "../../db/store";
import { MarketService } from "../../engine/service";
import { importStatic, readStatic } from "../../engine/market/static-data";
it("existing five-jump cache is narrowed on startup without deleting selected deals", () => {
  const data = JSON.parse(
    readFileSync("resources/static-data.json", "utf8"),
  ) as StaticData;
  const graph = new Graph(data.systems),
    oldZone = graph.zone(CENTERS, 5),
    newZone = new Set(CENTERS);
  const outside = [...oldZone].find((id) => !newZone.has(id))!;
  const old = {
    ...data,
    schemaVersion: 1,
    reprocessing: data.reprocessing?.map(({ outputRounding: _rounding, ...recipe }) => recipe),
    zone: [...oldZone],
    stations: [
      ...data.stations.filter((s) => s.systemId !== "30002510"),
      { ...data.stations[0], id: "999999999", systemId: outside },
    ],
  };
  const store = new Store(":memory:", "db/migrations");
  try {
    importStatic(store, old);
    store.sql
      .prepare(
        "INSERT INTO deals(id,source,destination,status,seller_id,forecast,created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        "kept",
        "999999999",
        "60003760",
        "SELECTED",
        "1",
        "[]",
        "2026-10-02T00:00:00Z",
      );
    const service = new MarketService(store, "resources", false);
    expect(service.data?.schemaVersion).toBe(2);
    expect(service.data?.reprocessing?.find((recipe) => recipe.typeId === "1230")?.outputRounding).toBe("ceil");
    expect(service.data?.zone.length).toBe(4);
    expect(service.data?.stations.length).toBe(34);
    expect(service.data?.regions.length).toBe(4);
    expect(service.data?.stations.some((s) => s.id === "999999999")).toBe(
      false,
    );
    expect(readStatic(store)?.zone.length).toBe(4);
    expect(readStatic(store)?.schemaVersion).toBe(2);
    expect(store.sql.prepare("SELECT id FROM deals").get()).toEqual({
      id: "kept",
    });
  } finally {
    store.close();
  }
});
it("startup respects still-valid persisted market snapshot expiry", () => {
  const data = JSON.parse(
    readFileSync("resources/static-data.json", "utf8"),
  ) as StaticData;
  const store = new Store(":memory:", "db/migrations");
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  try {
    importStatic(store, data);
    for (const region of data.regions)
      store.sql
        .prepare("INSERT INTO market_snapshot_runs VALUES (?,?,?,?,?,?,?,?)")
        .run(
          `snapshot-${region}`,
          region,
          new Date().toISOString(),
          new Date().toISOString(),
          new Date().toISOString(),
          expiresAt,
          "complete",
          1,
        );
    const service = new MarketService(store, "resources", false);
    service.scan();
    expect(service.scheduler.status).toHaveLength(data.regions.length);
    expect(service.scheduler.status.every((job) => job.due >= Date.now())).toBe(
      true,
    );
    expect(
      service.scheduler.status.every((job) => job.due <= Date.parse(expiresAt)),
    ).toBe(true);
    service.scan(true);
    expect(service.scheduler.status.every((job) => job.due <= Date.now())).toBe(
      true,
    );
  } finally {
    store.close();
  }
});
