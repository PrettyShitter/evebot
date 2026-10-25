import { expect, it } from "vitest";
import { Store } from "../../db/store";
import { EsiClient } from "../../engine/esi/client";
import { syncHistory } from "../../engine/history/history";

it("does not persist dates outside the seven completed UTC days from a long ESI response", async () => {
  const store = new Store(":memory:", "db/migrations");
  const at = Date.parse("2026-10-24T12:00:00.000Z");
  const dates = [
    "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-20",
    "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24",
  ];
  const client = new EsiClient(async () => new Response(
    JSON.stringify(dates.map((date) => ({
      date,
      volume: 10,
      order_count: 1,
      average: 100,
      lowest: 90,
      highest: 110,
    }))),
    {
      status: 200,
      headers: {
        Expires: new Date(at + 60_000).toUTCString(),
        ETag: '"week-fixture"',
        "X-Pages": "1",
      },
    },
  ));

  try {
    await syncHistory(store, client, "34", "10000002", () => at);
    const stored = store.sql
      .prepare("SELECT date FROM regional_history ORDER BY date")
      .all() as { date: string }[];
    expect(stored.map((row) => row.date)).toEqual([
      "2026-10-17", "2026-10-18", "2026-10-20", "2026-10-21",
      "2026-10-22", "2026-10-23",
    ]);
    expect(
      store.sql.prepare("SELECT value FROM sync_cursors WHERE key='history-revision'").get(),
    ).toEqual({ value: new Date(at).toISOString() });
  } finally {
    store.close();
  }
});
