import { z } from "zod";
import type { Store } from "../../db/store";
import { EsiClient } from "../esi/client";
import { historySchema, type HistoryDay } from "../../shared/contracts/esi";
import { D, sum } from "../accounting/money";
export function summarize(
  days: HistoryDay[],
  window: 7 | 30 | 90,
  asOf: string,
) {
  const end = new Date(asOf).getTime();
  const rows = days.filter((d) => {
    const age = end - new Date(d.date + "T00:00:00Z").getTime();
    return age >= 0 && age < window * 86400000;
  });
  if (!rows.length) return null;
  const median = (values: string[]) => {
    const a = values.map(D).sort((x, y) => x.comparedTo(y));
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : a[mid - 1].plus(a[mid]).div(2);
  };
  const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  return {
    observedDays: rows.length,
    missingDays: window - rows.length,
    activeDays: rows.filter((d) => d.volume > 0).length,
    medianDailyVolume: median(rows.map((d) => String(d.volume))).toFixed(),
    medianDailyPrice: median(rows.map((d) => d.average)).toFixed(),
    weightedPrice: sum(rows.map((d) => d.volume)).isZero()
      ? null
      : sum(rows.map((d) => D(d.average).mul(d.volume)))
          .div(sum(rows.map((d) => d.volume)))
          .toFixed(),
    priceChange:
      ordered.length > 1 && D(ordered[0].average).gt(0)
        ? D(ordered.at(-1)!.average).div(ordered[0].average).minus(1).toFixed()
        : null,
  };
}
export async function syncHistory(
  store: Store,
  client: EsiClient,
  type: string,
  region: string,
) {
  const r = await client.get(`/markets/${region}/history?type_id=${type}`);
  const rows = z.array(historySchema).parse(r.body);
  const now = new Date().toISOString();
  store.sql.transaction(() => {
    const insert = store.sql.prepare(
      "INSERT INTO regional_history VALUES (?,?,?,?,?) ON CONFLICT(type_id,region_id,date) DO UPDATE SET payload=excluded.payload,available_at=excluded.available_at",
    );
    for (const h of rows)
      insert.run(type, region, h.date, JSON.stringify(h), now);
    store.sql
      .prepare(
        "INSERT INTO sync_cursors VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run("history-revision", now);
  })();
  return r.expires;
}
