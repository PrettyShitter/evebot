import { it, expect } from "vitest";
import { Store } from "../../db/store";
import { resolve } from "node:path";
import { EsiClient } from "../../engine/esi/client";
import { syncRegion, latestOrders } from "../../engine/market/snapshots";
import { Scheduler } from "../../engine/esi/scheduler";
import { summarize } from "../../engine/history/history";
const order = (id: number) => ({
  order_id: id,
  type_id: 34,
  location_id: 60003760,
  system_id: 30000142,
  price: 1.23,
  is_buy_order: false,
  volume_remain: 10,
  volume_total: 10,
  min_volume: 1,
  range: "region",
  duration: 90,
  issued: "2026-10-02T00:00:00Z",
});
it("stage 3: atomic generations, failed page leaves previous data intact", async () => {
  const s = new Store(":memory:", resolve("db/migrations"));
  let fail = false;
  let clock = 0;
  const client = new EsiClient(
    async (input) => {
      const page = new URL(String(input)).searchParams.get("page");
      if (fail && page === "2") return new Response("", { status: 503 });
      return new Response(
        JSON.stringify([
          {
            ...order(page === "1" ? 1 : 2),
            location_id: page === "1" ? 60003760 : 60003761,
          },
        ]),
        {
          headers: {
            "X-Pages": "2",
            "Last-Modified": "Fri, 02 Oct 2026 00:00:00 GMT",
            "Cache-Control": "max-age=1",
          },
        },
      );
    },
    () => clock,
  );
  try {
    await syncRegion(s, client, "1", () => clock);
    expect(latestOrders(s, ["1"]).orders).toHaveLength(2);
    expect(latestOrders(s, ["1"], new Set(["60003760"])).orders).toHaveLength(
      1,
    );
    expect(latestOrders(s, ["1"], new Set(["60003760"])).complete).toBe(true);
    clock = 2000;
    fail = true;
    await expect(syncRegion(s, client, "1", () => clock)).rejects.toThrow();
    expect(latestOrders(s, ["1"]).orders).toHaveLength(2);
    expect(latestOrders(s, ["1", "2"]).complete).toBe(false);
  } finally {
    s.close();
  }
});
it("yields between market-order batches while preserving atomic generations", async () => {
  const s = new Store(":memory:", resolve("db/migrations"));
  const bulk = Array.from({ length: 2500 }, (_, index) => ({
    ...order(index + 1),
    type_id: String(5000 + index),
    location_id: String(60000000 + index),
  }));
  bulk.push({ ...order(3001), type_id: "8000", location_id: "69999999" });
  const client = new EsiClient(
    async () =>
      new Response(JSON.stringify(bulk), {
        headers: {
          "X-Pages": "1",
          "Last-Modified": "Fri, 02 Oct 2026 00:00:00 GMT",
          "Cache-Control": "max-age=1",
        },
      }),
  );
  try {
    const insertStation = s.sql.prepare(
      "INSERT INTO stations VALUES (?,?,?,?,?)",
    );
    s.sql
      .prepare("INSERT INTO systems VALUES (?,?,?,?)")
      .run("30000142", "Test system", "1", 0.9);
    const allowed = new Set<string>();
    for (let index = 0; index < 2500; index++) {
      const id = String(60000000 + index);
      allowed.add(id);
      insertStation.run(id, "Test station", "30000142", "1", "1");
    }
    const initial = new EsiClient(
      async () =>
        new Response(JSON.stringify([order(3000)]), {
          headers: {
            "X-Pages": "1",
            "Last-Modified": "Fri, 02 Oct 2026 00:00:00 GMT",
            "Cache-Control": "max-age=1",
          },
        }),
    );
    await syncRegion(s, initial, "1");
    let timerRan = false;
    let visibleDuringSync = 0;
    const timer = new Promise<void>((resolve) =>
      setTimeout(() => {
        visibleDuringSync = latestOrders(s, ["1"]).orders.length;
        timerRan = true;
        resolve();
      }, 0),
    );
    const sync = syncRegion(s, client, "1", Date.now, allowed);
    await timer;
    expect(timerRan).toBe(true);
    expect(visibleDuringSync).toBe(1);
    expect((await sync).count).toBe(2501);
    expect(latestOrders(s, ["1"]).orders).toHaveLength(2500);
    expect(
      (
        s.sql.prepare("SELECT count(*) n FROM station_observations").get() as {
          n: number;
        }
      ).n,
    ).toBe(2500);
  } finally {
    s.close();
  }
});
it("cache expiry, 304 no new content, rate limit retry header", async () => {
  let now = 0,
    calls = 0;
  const client = new EsiClient(
    async () => {
      calls++;
      if (calls === 3)
        return new Response("", {
          status: 429,
          headers: { "Retry-After": "30" },
        });
      return calls === 1
        ? new Response("[1]", {
            headers: { ETag: "x", "Cache-Control": "max-age=10" },
          })
        : new Response(null, {
            status: 304,
            headers: { "Cache-Control": "max-age=10" },
          });
    },
    () => now,
  );
  const a = await client.get("/status");
  expect(await client.get("/status")).toBe(a);
  expect(calls).toBe(1);
  now = 11000;
  expect((await client.get("/status")).body).toEqual(["1"]);
  now = 22000;
  await expect(client.get("/status")).rejects.toMatchObject({
    status: 429,
    retryAt: 52000,
  });
  await expect(client.get("/other")).rejects.toMatchObject({ status: 429 });
  expect(calls).toBe(3);
});
it("scheduler priorities, bounded concurrency, jittered resume and finite retries", async () => {
  let now = 0;
  const seen: string[] = [];
  const q = new Scheduler(
    () => now,
    () => 0,
    1,
  );
  q.schedule("history", 4, 0, async () => {
    seen.push("history");
    return 10000;
  });
  q.schedule("wallet", 0, 0, async () => {
    seen.push("wallet");
    return 10000;
  });
  await q.tick();
  expect(seen).toEqual(["wallet"]);
  q.suspend();
  await q.tick();
  expect(seen).toHaveLength(1);
  q.resume();
  await q.tick();
  expect(seen).toEqual(["wallet", "history"]);
  const retries = new Scheduler(
    () => now,
    () => 0,
    1,
  );
  let attempts = 0;
  retries.schedule("broken", 0, 0, async () => {
    attempts++;
    throw Error("503");
  });
  for (let i = 0; i < 5; i++) {
    now += 400000;
    await retries.tick();
  }
  expect(attempts).toBe(5);
  expect(retries.status.some((j) => j.key === "broken")).toBe(false);
});
it("history missing is unknown and observed days are not fabricated", () => {
  expect(summarize([], 30, "2026-10-02T00:00:00Z")).toBeNull();
  const r = summarize(
    [
      {
        date: "2026-10-01",
        volume: 10,
        order_count: 2,
        average: "20",
        lowest: "19",
        highest: "21",
      },
    ],
    7,
    "2026-10-02T00:00:00Z",
  );
  expect(r?.missingDays).toBe(6);
  expect(r?.medianDailyVolume).toBe("10");
});
