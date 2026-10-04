import { importStatic, type StaticData } from "./static-data";
import type { Store } from "../../db/store";
import { Portfolio } from "../portfolio/repository";
export const DEMO_TIME = "2026-10-02T10:00:00Z";
export function seedDemo(store: Store) {
  if (
    store.sql
      .prepare("SELECT key FROM sync_cursors WHERE key='demo-seeded'")
      .get()
  )
    return;
  const data: StaticData = {
    version: "DEMO-1",
    systems: [
      {
        id: "30000142",
        name: "Jita",
        regionId: "10000002",
        security: 0.9,
        neighbors: ["30000144"],
      },
      {
        id: "30000144",
        name: "Perimeter",
        regionId: "10000002",
        security: 0.95,
        neighbors: ["30000142", "30002187"],
      },
      {
        id: "30002187",
        name: "Amarr",
        regionId: "10000043",
        security: 1,
        neighbors: ["30000144", "30002659"],
      },
      {
        id: "30002659",
        name: "Dodixie",
        regionId: "10000032",
        security: 0.87,
        neighbors: ["30002187"],
      },
    ],
    zone: ["30000142", "30000144", "30002187", "30002659"],
    regions: ["10000002", "10000043", "10000032"],
    marketGroups: [],
    stations: [
      {
        id: "60003760",
        name: "Jita IV - Moon 4 - Caldari Navy Assembly Plant",
        systemId: "30000142",
        regionId: "10000002",
        ownerId: "1000035",
        factionId: "500001",
      },
      {
        id: "60008494",
        name: "Amarr VIII (Oris) - Emperor Family Academy",
        systemId: "30002187",
        regionId: "10000043",
        ownerId: "1000086",
        factionId: "500003",
      },
      {
        id: "60011866",
        name: "Dodixie IX - Moon 20 - Federation Navy Assembly Plant",
        systemId: "30002659",
        regionId: "10000032",
        ownerId: "1000120",
        factionId: "500004",
      },
      {
        id: "60000001",
        name: "DEMO Perimeter NPC Station",
        systemId: "30000144",
        regionId: "10000002",
        ownerId: "1000035",
        factionId: "500001",
      },
    ],
    types: [
      {
        id: "587",
        name: "Rifter",
        englishName: "Rifter",
        groupId: "25",
        marketGroupId: "64",
        volume: "2500",
      },
      {
        id: "2046",
        name: "Damage Control I",
        englishName: "Damage Control I",
        groupId: "60",
        marketGroupId: "615",
        volume: "5",
      },
    ],
  };
  importStatic(store, data);
  const p = new Portfolio(store);
  p.connect("90000001", "Aurora · основа", true);
  p.connect("90000002", "Vega · покупатель", false);
  p.connect("90000003", "Nova · покупатель", false);
  p.importWallets(
    ["600000000", "250000000", "150000000"].map((balance, i) => ({
      id: String(90000001 + i),
      balance,
      transactions: [],
      journal: [],
      modified: DEMO_TIME,
      expires: 0,
    })),
    [],
    DEMO_TIME,
  );
  store.saveSettings({
    ...store.getSettings(),
    minProfit: "100000",
    minTripProfit: "1000000",
  });
  let orderId = 1;
  for (const region of data.regions) {
    const gen = "demo-" + region;
    store.sql
      .prepare("INSERT INTO market_snapshot_runs VALUES (?,?,?,?,?,?,?,?)")
      .run(
        gen,
        region,
        DEMO_TIME,
        DEMO_TIME,
        DEMO_TIME,
        "2099-01-01T00:00:00Z",
        "complete",
        1,
      );
    for (const station of data.stations.filter((s) => s.regionId === region))
      for (const type of data.types) {
        const base = type.id === "587" ? 300000 : 4;
        const factor =
          station.id === "60003760"
            ? 1
            : station.id === "60000001"
              ? 0.9
              : station.id === "60008494"
                ? 1.6
                : 1.35;
        for (const buy of [false, true]) {
          const order = {
            order_id: String(orderId++),
            type_id: type.id,
            location_id: station.id,
            system_id: station.systemId,
            price: String(base * factor * (buy ? 0.9 : 1)),
            is_buy_order: buy,
            volume_remain: type.id === "587" ? 500 : 50000000,
            volume_total: type.id === "587" ? 500 : 50000000,
            min_volume: 1,
            range: "station",
            duration: 90,
            issued: DEMO_TIME,
          };
          store.sql
            .prepare("INSERT INTO market_orders VALUES (?,?,?,?,?)")
            .run(
              gen,
              order.order_id,
              type.id,
              station.id,
              JSON.stringify(order),
            );
        }
      }
  }
  for (const type of data.types)
    for (const region of data.regions)
      for (let day = 1; day <= 30; day++) {
        const date = new Date(Date.parse(DEMO_TIME) - day * 86400000)
          .toISOString()
          .slice(0, 10);
        const avg = type.id === "587" ? "450000" : "6";
        store.sql
          .prepare("INSERT INTO regional_history VALUES (?,?,?,?,?)")
          .run(
            type.id,
            region,
            date,
            JSON.stringify({
              date,
              average: avg,
              highest: avg,
              lowest: avg,
              volume: type.id === "587" ? 1000 : 100000000,
              order_count: 1000,
            }),
            DEMO_TIME,
          );
      }
  store.sql
    .prepare("INSERT INTO sync_cursors VALUES (?,?)")
    .run("demo-seeded", "true");
}
