import { z } from "zod";
import type { Store } from "../../db/store";
import { EsiClient } from "../esi/client";
import { historySchema, type HistoryDay } from "../../shared/contracts/esi";
import { D, Decimal, sum } from "../accounting/money";

const DAY_MS = 86_400_000;
export interface CompletedWeekRange {
  /** Inclusive UTC date, D-7. */
  start: string;
  /** Exclusive UTC date, D. */
  end: string;
}

export function completedWeekRange(asOf: string | number): CompletedWeekRange {
  const date = new Date(asOf);
  if (!Number.isFinite(date.getTime())) throw Error("Некорректная дата истории");
  const end = date.toISOString().slice(0, 10);
  return {
    start: new Date(Date.parse(`${end}T00:00:00.000Z`) - 7 * DAY_MS)
      .toISOString()
      .slice(0, 10),
    end,
  };
}

export function completedWeekRows(days: HistoryDay[], asOf: string | number) {
  const { start, end } = completedWeekRange(asOf);
  return days.filter((day) => day.date >= start && day.date < end);
}

/** Weekly-only history model. Missing dates remain unknown; they are not zero-volume days. */
export function summarizeCompletedWeek(days: HistoryDay[], asOf: string | number) {
  const { start, end } = completedWeekRange(asOf);
  const rows = completedWeekRows(days, asOf);
  if (!rows.length) return null;
  const median = (values: string[]) => {
    const sorted = values.map(D).sort((a, b) => a.comparedTo(b));
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]!
      : sorted[middle - 1]!.plus(sorted[middle]!).div(2);
  };
  const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const totalVolume = rows.reduce((total, day) => total.plus(day.volume), D(0));
  const firstHalf = ordered.filter((day) => day.date < new Date(
    Date.parse(`${start}T00:00:00.000Z`) + 3 * DAY_MS,
  ).toISOString().slice(0, 10));
  const secondHalf = ordered.filter((day) => !firstHalf.includes(day));
  const firstVolume = firstHalf.reduce((total, day) => total.plus(day.volume), D(0));
  const secondVolume = secondHalf.reduce((total, day) => total.plus(day.volume), D(0));
  const medianPrice = median(rows.map((day) => day.average));
  const low = rows.map((day) => D(day.lowest)).reduce((a, b) => Decimal.min(a, b));
  const high = rows.map((day) => D(day.highest)).reduce((a, b) => Decimal.max(a, b));
  return {
    version: "weekly_v1" as const,
    startDate: start,
    endDateExclusive: end,
    observedDays: rows.length,
    missingDays: 7 - rows.length,
    activeDays: rows.filter((day) => day.volume > 0).length,
    weeklyVolume: totalVolume.toFixed(),
    medianDailyVolume: median(rows.map((day) => String(day.volume))).toFixed(),
    medianDailyPrice: medianPrice.toFixed(),
    weightedPrice: totalVolume.isZero()
      ? null
      : sum(rows.map((day) => D(day.average).mul(day.volume)))
          .div(totalVolume)
          .toFixed(),
    rangePercent: medianPrice.gt(0) ? high.minus(low).div(medianPrice).toFixed() : null,
    priceChange:
      ordered.length > 1 && D(ordered[0]!.average).gt(0)
        ? D(ordered.at(-1)!.average).div(ordered[0]!.average).minus(1).toFixed()
        : null,
    volumeChange:
      firstHalf.length >= 2 && secondHalf.length >= 2 && firstVolume.gt(0)
        ? secondVolume.div(secondHalf.length)
            .div(firstVolume.div(firstHalf.length))
            .minus(1)
            .toFixed()
        : null,
  };
}
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
  clock: () => number = Date.now,
) {
  const r = await client.get(`/markets/${region}/history?type_id=${type}`);
  const rows = z.array(historySchema).parse(r.body);
  const observedAt = clock();
  const { start, end } = completedWeekRange(observedAt);
  const now = new Date(observedAt).toISOString();
  store.market.transaction(() => {
    const historyConflictKey = store.market === store.sql
      ? "type_id,region_id,date"
      : "region_id,type_id,date";
    const insert = store.market.prepare(
      `INSERT INTO regional_history(type_id,region_id,date,payload,available_at) VALUES (?,?,?,?,?) ON CONFLICT(${historyConflictKey}) DO UPDATE SET payload=excluded.payload,available_at=excluded.available_at`,
    );
    for (const h of rows)
      if (h.date >= start && h.date < end)
        insert.run(type, region, h.date, JSON.stringify(h), now);
    const cursorTable = store.market === store.sql
      ? "sync_cursors"
      : "market_sync_cursors";
    store.market
      .prepare(
        `INSERT INTO ${cursorTable} VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      )
      .run("history-revision", now);
  })();
  return r.expires;
}
