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
import { syncRegion, latestOrders } from "./market/snapshots";
import { syncHistory } from "./history/history";
export class MarketService {
  readonly client = new EsiClient();
  readonly scheduler = new Scheduler();
  data: StaticData | null;
  status = "Рынок ещё не загружен";
  constructor(
    private store: Store,
    resources: string,
    readonly demo: boolean,
  ) {
    this.data = readStatic(store);
    if (!this.data && !demo) {
      this.data = JSON.parse(
        readFileSync(join(resources, "static-data.json"), "utf8"),
      ) as StaticData;
      importStatic(store, this.data);
    }
    if (this.data && !demo) {
      const narrowed = withSearchZone(this.data);
      if (
        JSON.stringify(narrowed.zone) !== JSON.stringify(this.data.zone) ||
        narrowed.stations.length !== this.data.stations.length
      ) {
        importStatic(store, narrowed);
      }
      this.data = narrowed;
    }
    store.sql
      .prepare(
        "UPDATE market_snapshot_runs SET status='interrupted' WHERE status='loading'",
      )
      .run();
  }
  scan() {
    if (this.demo) return;
    if (!this.data) throw Error("Справочник отсутствует");
    for (const region of this.data.regions)
      this.scheduler.schedule("market:" + region, 2, Date.now(), async () => {
        this.status = "Загрузка рынка региона " + region;
        try {
          const r = await syncRegion(this.store, this.client, region);
          this.status = "Рынок обновлён; история загружается отдельно";
          this.queueHistory(region);
          return r.expires;
        } catch (e) {
          this.status = e instanceof Error ? e.message : "Ошибка рынка";
          throw e;
        }
      });
  }
  private queueHistory(region: string) {
    const types = new Set(
      latestOrders(this.store, [region]).orders.map((o) => o.type_id),
    );
    for (const type of types)
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
      const data = await downloadSde();
      importStatic(this.store, data);
      this.data = data;
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
