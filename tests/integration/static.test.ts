import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { StaticData } from "../../engine/market/static-data";
import { Graph, CENTERS } from "../../engine/routes/graph";
it("official bundled SDE resolves exact centers, three-jump cross-region NPC universe and ship volume", () => {
  const data = JSON.parse(
    readFileSync("resources/static-data.json", "utf8"),
  ) as StaticData;
  const g = new Graph(data.systems);
  expect(CENTERS.map((c) => g.systems.get(c)?.name)).toEqual([
    "Jita",
    "Amarr",
    "Dodixie",
  ]);
  const zone = g.zone(CENTERS);
  expect([...zone].sort()).toEqual([...data.zone].sort());
  expect(data.regions.length).toBeGreaterThan(3);
  expect(data.stations.every((s) => zone.has(s.systemId))).toBe(true);
  expect(new Set(data.stations.map((s) => s.id)).size).toBe(
    data.stations.length,
  );
  expect(data.stations.find((s) => s.id === "60003760")?.name).toContain(
    "Caldari Navy",
  );
  expect(data.types.find((t) => t.id === "587")?.volume).toBe("2500");
  expect(data.types.some((t) => t.id === "44992")).toBe(false);
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
    newZone = graph.zone(CENTERS);
  const outside = [...oldZone].find((id) => !newZone.has(id))!;
  const old = {
    ...data,
    zone: [...oldZone],
    stations: [
      ...data.stations,
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
    expect(service.data?.zone.length).toBe(159);
    expect(service.data?.stations.length).toBe(637);
    expect(service.data?.regions.length).toBe(11);
    expect(service.data?.stations.some((s) => s.id === "999999999")).toBe(
      false,
    );
    expect(readStatic(store)?.zone.length).toBe(159);
    expect(store.sql.prepare("SELECT id FROM deals").get()).toEqual({
      id: "kept",
    });
  } finally {
    store.close();
  }
});
