import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "../db/store";
import { EsiClient } from "./esi/client";
import { Scheduler } from "./esi/scheduler";
import {
  downloadSde,
  importStatic,
  readStatic,
  withSearchZone,
  type StaticData,
} from "./market/static-data";
import { syncRegion, latestSnapshots } from "./market/snapshots";
import { syncHistory } from "./history/history";
import { excludedMarketTypeIds } from "./market/classification";
import { CENTERS } from "./routes/graph";
export class MarketService {
  readonly client = new EsiClient();
  readonly scheduler = new Scheduler();
  data: StaticData | null;
  private searchLocations = new Set<string>();
  status = "Рынок ещё не загружен";
  constructor(
    private store: Store,
    resources: string,
    readonly demo: boolean,
  ) {
    const persisted = readStatic(store);
    this.data = persisted;
    if (!demo) {
      const bundled = JSON.parse(
        readFileSync(join(resources, "static-data.json"), "utf8"),
      ) as StaticData;
      const hasNewerBundle =
        Number.isFinite(Number(bundled.version)) &&
        Number.isFinite(Number(persisted?.version)) &&
        Number(bundled.version) > Number(persisted?.version);
      if (!persisted || hasNewerBundle) this.data = bundled;
      else if (
        CENTERS.every((center) =>
          persisted.systems.some((s) => s.id === center),
        )
      ) {
        // A release can change the selected hubs without changing the SDE build.
        // Backfill their bundled NPC stations into an older persisted catalogue.
        const stations = new Map(persisted.stations.map((s) => [s.id, s]));
        for (const station of bundled.stations)
          if (!stations.has(station.id)) stations.set(station.id, station);
        this.data = { ...persisted, stations: [...stations.values()] };
      } else this.data = persisted;
    }
    if (this.data && !demo) {
      const narrowed = withSearchZone(this.data);
      if (
        JSON.stringify(narrowed.zone) !== JSON.stringify(this.data.zone) ||
        JSON.stringify(narrowed.stations) !== JSON.stringify(this.data.stations)
      ) {
        importStatic(store, narrowed);
      }
      this.data = narrowed;
    }
    this.searchLocations = new Set(this.data?.stations.map((s) => s.id) ?? []);
    store.sql
      .prepare(
        "UPDATE market_snapshot_runs SET status='interrupted' WHERE status='loading'",
      )
      .run();
  }
  scan(force = false) {
    if (this.demo) return;
    if (!this.data) throw Error("Справочник отсутствует");
    const excludedTypes = excludedMarketTypeIds(this.data);
    const snapshots = new Map(
      latestSnapshots(this.store, this.data.regions).map((snapshot) => [
        snapshot.region,
        snapshot,
      ]),
    );
    for (const region of this.data.regions)
      this.scheduler.schedule(
        "market:" + region,
        2,
        force
          ? Date.now()
          : Math.max(
              Date.now(),
              Date.parse(snapshots.get(region)?.expiresAt ?? "") || 0,
            ),
        async () => {
          this.status = "Загрузка рынка региона " + region;
          try {
            const r = await syncRegion(
              this.store,
              this.client,
              region,
              Date.now,
              this.searchLocations,
              excludedTypes,
            );
            this.status = "Рынок обновлён; история загружается отдельно";
            this.queueHistory(region);
            return r.expires;
          } catch (e) {
            this.status = e instanceof Error ? e.message : "Ошибка рынка";
            throw e;
          }
        },
      );
  }
  hasPendingMarketSync() {
    return this.scheduler.hasDuePrefix("market:");
  }
  private queueHistory(region: string) {
    const generation = latestSnapshots(this.store, [region])[0];
    if (!generation) return;
    const types = new Set(
      (
        this.store.sql
          .prepare(
            "SELECT DISTINCT type_id FROM market_orders WHERE generation=?",
          )
          .all(generation.id) as { type_id: string }[]
      ).map((row) => row.type_id),
    );
    const excluded = this.data ? excludedMarketTypeIds(this.data) : new Set();
    for (const type of types)
      if (!excluded.has(type))
        this.scheduler.schedule(
          "history:" + region + ":" + type,
          3,
          Date.now(),
          () => syncHistory(this.store, this.client, type, region),
        );
  }
  async updateStatic() {
    if (this.demo) throw Error("Обновление SDE недоступно в DEMO");
    this.status = "Загрузка официального SDE…";
    try {
      const data = withSearchZone(await downloadSde());
      importStatic(this.store, data);
      this.data = data;
      this.searchLocations = new Set(data.stations.map((s) => s.id));
      this.status = "SDE " + data.version + " обновлён";
      this.scan();
    } catch (e) {
      this.status = "Не удалось обновить SDE; сохранён предыдущий справочник";
      throw e;
    }
  }
  summary() {
    const regions = this.data?.regions ?? [];
    const r = this.store.sql
      .prepare(
        "SELECT region_id,count(*) n FROM market_snapshot_runs WHERE status='complete' GROUP BY region_id",
      )
      .all() as { region_id: string; n: number }[];
    const completed = regions.filter((id) =>
      r.some((x) => x.region_id === id),
    ).length;
    return {
      version: this.data?.version ?? null,
      systems: this.data?.zone.length ?? 0,
      stations: this.data?.stations.length ?? 0,
      regions: regions.length,
      loadedRegions: completed,
      historyPairs: (
        this.store.sql
          .prepare(
            "SELECT count(*) n FROM (SELECT DISTINCT type_id,region_id FROM regional_history)",
          )
          .get() as { n: number }
      ).n,
      status: this.status,
    };
  }
}
