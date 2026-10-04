import { unzipSync, strFromU8 } from "fflate";
import { z } from "zod";
import { CENTERS, type System } from "../routes/graph";
import { packagedVolume } from "./volume";
import type { Store } from "../../db/store";
export interface Station {
  id: string;
  name: string;
  systemId: string;
  regionId: string;
  ownerId: string;
  factionId: string | null;
}
export interface ItemType {
  id: string;
  name: string;
  englishName: string;
  groupId: string;
  marketGroupId: string;
  volume: string | null;
}
export interface StaticData {
  version: string;
  npcStationIds?: string[];
  systems: System[];
  stations: Station[];
  types: ItemType[];
  zone: string[];
  regions: string[];
  marketGroups: { id: string; name: string; parentId: string | null }[];
}
// Recompute the configured search universe for persisted data from older releases.
// Retain the full graph and NPC-origin index for routes and ranged buy orders.
export function withSearchZone(data: StaticData): StaticData {
  // Market scanning is limited to the configured hub solar systems. Keep the full
  // graph so route calculation and buy-order range checks still work globally.
  const zone = new Set(CENTERS);
  const stations = data.stations.filter((s) => zone.has(s.systemId));
  return {
    ...data,
    zone: [...zone],
    stations,
    regions: [...new Set(stations.map((s) => s.regionId))],
  };
}
const named = z.object({ en: z.string(), ru: z.string().optional() });
const sysSchema = z.object({
  _key: z.number().int(),
  name: named,
  regionID: z.number().int(),
  securityStatus: z.number(),
});
const gateSchema = z.object({
  solarSystemID: z.number().int(),
  destination: z.object({ solarSystemID: z.number().int() }),
});
const stationSchema = z.object({
  _key: z.number().int(),
  solarSystemID: z.number().int(),
  ownerID: z.number().int(),
});
const typeSchema = z.object({
  _key: z.number().int(),
  name: named,
  groupID: z.number().int(),
  marketGroupID: z.number().int().optional(),
  packagedVolume: z.number().optional(),
  volume: z.number().optional(),
  published: z.boolean(),
});
export function extractSde(zip: Uint8Array): StaticData {
  const needed = new Set([
    "_sde.jsonl",
    "mapSolarSystems.jsonl",
    "mapStargates.jsonl",
    "npcStations.jsonl",
    "types.jsonl",
    "groups.jsonl",
    "npcCorporations.jsonl",
    "marketGroups.jsonl",
  ]);
  const files = unzipSync(zip, { filter: (f) => needed.has(f.name) });
  const records = (name: string): unknown[] => {
    if (!files[name]) throw Error("В SDE отсутствует " + name);
    return strFromU8(files[name])
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  };
  const meta = z
    .object({ buildNumber: z.number() })
    .parse(records("_sde.jsonl")[0]);
  const systems = records("mapSolarSystems.jsonl").map((row) => {
    const x = sysSchema.parse(row);
    return {
      id: String(x._key),
      name: x.name.en,
      regionId: String(x.regionID),
      security: x.securityStatus,
      neighbors: [] as string[],
    };
  });
  const byId = new Map(systems.map((s) => [s.id, s]));
  for (const row of records("mapStargates.jsonl")) {
    const g = gateSchema.parse(row);
    const a = byId.get(String(g.solarSystemID)),
      b = byId.get(String(g.destination.solarSystemID));
    if (a && b) {
      if (!a.neighbors.includes(b.id)) a.neighbors.push(b.id);
      if (!b.neighbors.includes(a.id)) b.neighbors.push(a.id);
    }
  }
  const zone = new Set(CENTERS);
  const corporations = new Map(
    records("npcCorporations.jsonl").map((row) => {
      const c = z
        .object({ _key: z.number(), factionID: z.number().optional() })
        .parse(row);
      return [String(c._key), c.factionID ? String(c.factionID) : null];
    }),
  );
  const stations = records("npcStations.jsonl")
    .map((row) => stationSchema.parse(row))
    .filter((s) => zone.has(String(s.solarSystemID)))
    .map((s) => ({
      id: String(s._key),
      name: `NPC-станция ${s._key}`,
      systemId: String(s.solarSystemID),
      regionId: byId.get(String(s.solarSystemID))!.regionId,
      ownerId: String(s.ownerID),
      factionId: corporations.get(String(s.ownerID)) ?? null,
    }));
  const shipGroups = new Set(
    records("groups.jsonl")
      .map((row) =>
        z.object({ _key: z.number(), categoryID: z.number() }).parse(row),
      )
      .filter((g) => g.categoryID === 6)
      .map((g) => g._key),
  );
  const types = records("types.jsonl")
    .map((row) => typeSchema.parse(row))
    .filter((t) => t.published && t.marketGroupID && t._key !== 44992)
    .map((t) => ({
      id: String(t._key),
      name: t.name.ru ?? t.name.en,
      englishName: t.name.en,
      groupId: String(t.groupID),
      marketGroupId: String(t.marketGroupID),
      volume: packagedVolume(
        {
          packagedVolume:
            t.packagedVolume === undefined
              ? undefined
              : String(t.packagedVolume),
          volume: t.volume === undefined ? undefined : String(t.volume),
        },
        shipGroups.has(t.groupID),
      ),
    }));
  const marketGroups = records("marketGroups.jsonl").map((row) => {
    const g = z
      .object({
        _key: z.number(),
        name: named,
        parentGroupID: z.number().optional(),
      })
      .parse(row);
    return {
      id: String(g._key),
      name: g.name.ru ?? g.name.en,
      parentId: g.parentGroupID ? String(g.parentGroupID) : null,
    };
  });
  return {
    version: String(meta.buildNumber),
    npcStationIds: records("npcStations.jsonl").map((r) =>
      String(stationSchema.parse(r)._key),
    ),
    systems,
    stations,
    types,
    zone: [...zone],
    regions: [...new Set(stations.map((s) => s.regionId))],
    marketGroups,
  };
}
export async function downloadSde(): Promise<StaticData> {
  const response = await fetch(
    "https://developers.eveonline.com/static-data/eve-online-static-data-latest-jsonl.zip",
    { signal: AbortSignal.timeout(180000) },
  );
  if (!response.ok) throw Error("SDE: " + response.status);
  const data = extractSde(new Uint8Array(await response.arrayBuffer()));
  for (let i = 0; i < data.stations.length; i += 500) {
    const batch = data.stations.slice(i, i + 500);
    const r = await fetch(
      "https://esi.evetech.net/universe/names?compatibility_date=2026-08-18",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "EVE-Trader/0.1 (static station names)",
        },
        body: JSON.stringify(batch.map((s) => Number(s.id))),
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!r.ok) throw Error("Не удалось разрешить названия NPC-станций");
    const names = z
      .array(z.object({ id: z.number().int().safe(), name: z.string() }))
      .parse(await r.json());
    const map = new Map(names.map((n) => [String(n.id), n.name]));
    for (const s of batch) s.name = map.get(s.id) ?? s.name;
  }
  return data;
}
export function importStatic(store: Store, data: StaticData) {
  store.sql.transaction(() => {
    // Update rows in place so older deal references remain resolvable.
    const sys = store.sql.prepare(
      "INSERT INTO systems VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,region_id=excluded.region_id,security=excluded.security",
    );
    for (const s of data.systems) sys.run(s.id, s.name, s.regionId, s.security);
    store.sql.prepare("DELETE FROM stargates").run();
    const gate = store.sql.prepare(
      "INSERT OR IGNORE INTO stargates VALUES (?,?)",
    );
    for (const s of data.systems)
      for (const n of s.neighbors) gate.run(s.id, n);
    const station = store.sql.prepare(
      "INSERT INTO stations VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,system_id=excluded.system_id,owner_id=excluded.owner_id,region_id=excluded.region_id",
    );
    for (const s of data.stations)
      station.run(s.id, s.name, s.systemId, s.ownerId, s.regionId);
    const type = store.sql.prepare(
      "INSERT INTO item_types VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,english_name=excluded.english_name,group_id=excluded.group_id,market_group_id=excluded.market_group_id,volume=excluded.volume,payload=excluded.payload",
    );
    for (const t of data.types)
      type.run(
        t.id,
        t.name,
        t.englishName,
        t.groupId,
        t.marketGroupId,
        t.volume,
        JSON.stringify(t),
      );
    store.sql
      .prepare(
        "INSERT INTO sync_cursors VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run("static", JSON.stringify(data));
  })();
}
export function readStatic(store: Store): StaticData | null {
  const r = store.sql
    .prepare("SELECT value FROM sync_cursors WHERE key=?")
    .get("static") as { value: string } | undefined;
  return r ? JSON.parse(r.value) : null;
}
