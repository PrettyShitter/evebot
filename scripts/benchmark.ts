import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { cpus, totalmem, platform, arch } from "node:os";
import { Store } from "../db/store";
import { EsiClient } from "../engine/esi/client";
import { syncRegion, latestOrders } from "../engine/market/snapshots";
import {
  scanOpportunities,
  filterOpportunities,
} from "../engine/market/opportunities";
import type { StaticData } from "../engine/market/static-data";
import { DEFAULT_SETTINGS } from "../shared/contracts/app";
import type { Order } from "../shared/contracts/esi";
mkdirSync(".cache", { recursive: true });
const path = ".cache/the-forge-orders.json";
if (!existsSync(path)) {
  const db = new Store(".cache/benchmark.sqlite", "db/migrations");
  try {
    console.log("Downloading complete public The Forge snapshot");
    await syncRegion(db, new EsiClient(), "10000002");
    writeFileSync(path, JSON.stringify(latestOrders(db, ["10000002"])));
  } finally {
    db.close();
  }
}
const saved = JSON.parse(readFileSync(path, "utf8")) as {
  orders: Order[];
  snapshots: { id: string; modifiedAt: string }[];
};
const data = JSON.parse(
  readFileSync("resources/static-data.json", "utf8"),
) as StaticData;
const start = performance.now();
const offers = scanOpportunities({
  data,
  orders: saved.orders,
  settings: { ...DEFAULT_SETTINGS, minProfit: "0", minTripProfit: "0" },
  available: "800000000",
  pool: "800000000",
  exposures: new Map(),
  profile: () => ({
    accounting: 5,
    brokerRelations: 5,
    advancedBrokerRelations: 5,
    factionStanding: "0",
    corporationStanding: "0",
  }),
  history: () => [],
  at: new Date().toISOString(),
  snapshotIds: saved.snapshots.map((s) => s.id),
});
const scanMs = performance.now() - start;
const filterStart = performance.now();
filterOpportunities(offers, {
  ...DEFAULT_SETTINGS,
  minProfit: "1000000",
  roiEnabled: true,
  minROI: 30,
});
const filterMs = performance.now() - filterStart;
const result = {
  at: new Date().toISOString(),
  machine: {
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0].model,
    ramGiB: totalmem() / 1024 ** 3,
  },
  dataset: {
    file: path,
    region: "10000002",
    orders: saved.orders.length,
    snapshot: saved.snapshots,
  },
  zoneStations: data.stations.length,
  types: data.types.length,
  offers: offers.length,
  scanMs,
  filterMs,
  rssMiB: process.memoryUsage().rss / 1024 ** 2,
  peakRssMiB: process.resourceUsage().maxRSS / 1024,
  scope:
    "One complete real regional snapshot, buy analysis; no fabricated regional history. Synthetic seller level 5 and 800m ISK budget. Filter benchmark recomputes quantity, fees and ROI against prepared ladders; renderer latency measured separately.",
};
writeFileSync(
  "docs/verification/benchmark.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
