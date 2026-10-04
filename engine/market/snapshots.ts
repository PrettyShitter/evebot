import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "../../db/store";
import { EsiClient } from "../esi/client";
import { orderSchema, type Order } from "../../shared/contracts/esi";
export async function syncRegion(
  store: Store,
  client: EsiClient,
  region: string,
  clock: () => number = Date.now,
  allowedLocations?: ReadonlySet<string>,
  excludedTypes?: ReadonlySet<string>,
) {
  const id = randomUUID(),
    start = new Date(clock()).toISOString();
  store.sql
    .prepare("INSERT INTO market_snapshot_runs VALUES (?,?,?,?,?,?,?,?)")
    .run(id, region, start, null, null, null, "loading", 0);
  try {
    const first = await client.get(
      `/markets/${region}/orders?order_type=all&page=1`,
    );
    const orders: Order[] = [];
    let expiry = first.expires;
    const seen = new Set<string>();
    const acceptPage = (page: Awaited<ReturnType<EsiClient["get"]>>) => {
      if (page.pages !== first.pages || page.modified !== first.modified)
        throw Error("Страницы рынка относятся к разным поколениям");
      for (const order of z.array(orderSchema).parse(page.body)) {
        if (seen.has(order.order_id))
          throw Error("Дубли ордеров между страницами");
        seen.add(order.order_id);
        if (excludedTypes?.has(order.type_id)) continue;
        orders.push(order);
      }
      expiry = Math.min(expiry, page.expires);
    };
    acceptPage(first);
    // Region order books can span hundreds of pages. Fetch a small bounded
    // window concurrently so a cold start does not take one RTT per page.
    const pageConcurrency = 8;
    for (let start = 2; start <= first.pages; start += pageConcurrency) {
      const pages = await Promise.all(
        Array.from(
          { length: Math.min(pageConcurrency, first.pages - start + 1) },
          (_, index) =>
            client.get(
              `/markets/${region}/orders?order_type=all&page=${start + index}`,
            ),
        ),
      );
      for (const page of pages) acceptPage(page);
    }
    if (!first.modified) throw Error("ESI не сообщил время снимка");
    const npc = new Set(
      (
        store.sql
          .prepare("SELECT id FROM stations WHERE region_id=?")
          .all(region) as { id: string }[]
      ).map((s) => s.id),
    );
    const observed = new Map<
      string,
      {
        station: string;
        type: string;
        askQuantity: number;
        bidQuantity: number;
        orders: number;
      }
    >();

    // Keep the engine worker responsive while a large region snapshot is
    // persisted. The generation remains `loading` until every batch and its
    // station observations have been written, so readers keep using the last
    // complete snapshot.
    const insertOrders = store.sql.transaction((batch: Order[]) => {
      const insert = store.sql.prepare(
        "INSERT INTO market_orders VALUES (?,?,?,?,?)",
      );
      for (const o of batch) {
        if (allowedLocations && !allowedLocations.has(o.location_id)) continue;
        insert.run(id, o.order_id, o.type_id, o.location_id, JSON.stringify(o));
        if (!npc.has(o.location_id)) continue;
        const key = o.location_id + ":" + o.type_id;
        const item = observed.get(key) ?? {
          station: o.location_id,
          type: o.type_id,
          askQuantity: 0,
          bidQuantity: 0,
          orders: 0,
        };
        if (o.is_buy_order) item.bidQuantity += o.volume_remain;
        else item.askQuantity += o.volume_remain;
        item.orders++;
        observed.set(key, item);
      }
    });
    const batchSize = 1000;
    for (let offset = 0; offset < orders.length; offset += batchSize) {
      insertOrders(orders.slice(offset, offset + batchSize));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    const observationRows = [...observed.entries()];
    const insertObservations = store.sql.transaction(
      (batch: (typeof observationRows)[number][]) => {
        const observation = store.sql.prepare(
          "INSERT INTO station_observations VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET at=excluded.at,payload=excluded.payload",
        );
        for (const [key, value] of batch)
          observation.run(
            key + ":" + start.slice(0, 10),
            value.station,
            value.type,
            start,
            JSON.stringify({
              ...value,
              generation: id,
              meaning: "daily_latest_order_snapshot_not_executed_trades",
            }),
          );
      },
    );
    for (let offset = 0; offset < observationRows.length; offset += batchSize) {
      insertObservations(observationRows.slice(offset, offset + batchSize));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    store.sql
      .prepare(
        "UPDATE market_snapshot_runs SET completed_at=?,modified_at=?,expires_at=?,status=?,pages=? WHERE id=?",
      )
      .run(
        new Date(clock()).toISOString(),
        first.modified,
        new Date(expiry).toISOString(),
        "complete",
        first.pages,
        id,
      );

    const keep = (
      store.sql
        .prepare(
          "SELECT id FROM market_snapshot_runs WHERE region_id=? AND status='complete' ORDER BY completed_at DESC,rowid DESC LIMIT 2",
        )
        .all(region) as { id: string }[]
    ).map((r) => r.id);
    if (keep.length === 2) {
      try {
        const obsolete = store.sql
          .prepare(
            "SELECT id FROM market_snapshot_runs WHERE region_id=? AND status='complete' AND id NOT IN (?,?)",
          )
          .all(region, keep[0], keep[1]) as { id: string }[];
        const deleteBatch = store.sql.prepare(
          "DELETE FROM market_orders WHERE generation=? AND id IN (SELECT id FROM market_orders WHERE generation=? LIMIT ?)",
        );
        for (const old of obsolete) {
          let deleted: number;
          do {
            deleted = deleteBatch.run(old.id, old.id, batchSize).changes;
            if (deleted)
              await new Promise<void>((resolve) => setImmediate(resolve));
          } while (deleted === batchSize);
          store.sql
            .prepare("DELETE FROM market_snapshot_runs WHERE id=?")
            .run(old.id);
        }
      } catch {
        // Retention is best-effort. The just-completed generation is already
        // valid and must remain available if pruning an old one fails.
      }
    }
    return { id, count: orders.length, expires: expiry };
  } catch (error) {
    const deleteBatch = store.sql.prepare(
      "DELETE FROM market_orders WHERE generation=? AND id IN (SELECT id FROM market_orders WHERE generation=? LIMIT 1000)",
    );
    while (deleteBatch.run(id, id).changes === 1000)
      await new Promise<void>((resolve) => setImmediate(resolve));
    store.sql
      .prepare("UPDATE market_snapshot_runs SET status='failed' WHERE id=?")
      .run(id);
    throw error;
  }
}
export function latestSnapshots(store: Store, regions: string[]) {
  const snapshots: {
    region: string;
    id: string;
    expiresAt: string;
    modifiedAt: string;
  }[] = [];
  for (const region of regions) {
    const row = store.sql
      .prepare(
        "SELECT id,expires_at,modified_at FROM market_snapshot_runs WHERE region_id=? AND status='complete' ORDER BY completed_at DESC,rowid DESC LIMIT 1",
      )
      .get(region) as
      { id: string; expires_at: string; modified_at: string } | undefined;
    if (row)
      snapshots.push({
        region,
        id: row.id,
        expiresAt: row.expires_at,
        modifiedAt: row.modified_at,
      });
  }
  return snapshots;
}
export function latestOrders(
  store: Store,
  regions: string[],
  allowedLocations?: ReadonlySet<string>,
) {
  const snapshots = latestSnapshots(store, regions);
  const orders: Order[] = [];
  const locations = allowedLocations ? [...allowedLocations] : null;
  if (locations?.length === 0)
    return { orders, snapshots, complete: snapshots.length === regions.length };
  const statement = locations
    ? store.sql.prepare(
        `SELECT payload FROM market_orders WHERE generation=? AND location_id IN (${locations.map(() => "?").join(",")})`,
      )
    : store.sql.prepare("SELECT payload FROM market_orders WHERE generation=?");
  for (const row of snapshots)
    for (const o of statement.all(row.id, ...(locations ?? [])) as {
      payload: string;
    }[])
      orders.push(JSON.parse(o.payload));
  return { orders, snapshots, complete: snapshots.length === regions.length };
}
