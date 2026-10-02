import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  withSearchZone,
  type StaticData,
} from "../../engine/market/static-data";
import { Graph, CENTERS } from "../../engine/routes/graph";
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
  ]);
  const zone = new Set(CENTERS);
  expect([...zone].sort()).toEqual([...data.zone].sort());
  expect(data.regions).toHaveLength(3);
  expect(data.stations.length).toBe(26);
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
    newZone = new Set(CENTERS);
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
    expect(service.data?.zone.length).toBe(3);
    expect(service.data?.stations.length).toBe(26);
    expect(service.data?.regions.length).toBe(3);
    expect(service.data?.stations.some((s) => s.id === "999999999")).toBe(
      false,
    );
    expect(readStatic(store)?.zone.length).toBe(3);
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
    expect(service.scheduler.status).toHaveLength(3);
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
