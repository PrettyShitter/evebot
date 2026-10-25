import { z } from "zod";
import type { Store } from "../../db/store";
const orderSchema = z.object({
  type_id: z.coerce.string(),
  location_id: z.coerce.string(),
  price: z.coerce.string().regex(/^\d+(\.\d+)?$/),
  volume_remain: z.coerce.number().int().nonnegative(),
  is_buy_order: z.boolean().optional().default(false),
});
export function ownSellOrders(store: Store) {
  const rows = store.sql
    .prepare(
      `SELECT o.id,o.payload,o.available_at,c.name character_name FROM character_orders o
    JOIN characters c ON c.id=o.character_id
    WHERE o.state='active' ORDER BY o.available_at DESC,o.id`,
    )
    .all() as {
    id: string;
    payload: string;
    available_at: string;
    character_name: string;
  }[];
  const types = new Map(
    (store.market.prepare("SELECT id,name FROM item_types").all() as { id: string; name: string }[])
      .map((row) => [row.id, row.name]),
  );
  const stations = new Map(
    (store.market.prepare("SELECT id,name FROM stations").all() as { id: string; name: string }[])
      .map((row) => [row.id, row.name]),
  );
  return rows.flatMap((row) => {
    const parsed = orderSchema.safeParse(JSON.parse(row.payload));
    if (
      !parsed.success ||
      parsed.data.is_buy_order ||
      !parsed.data.volume_remain
    )
      return [];
    const order = parsed.data;
    return [
      {
        id: row.id,
        character: row.character_name,
        type: types.get(order.type_id) ?? `Type ${order.type_id}`,
        station: stations.get(order.location_id) ?? `Location ${order.location_id}`,
        price: order.price,
        remaining: order.volume_remain,
        updatedAt: row.available_at,
      },
    ];
  });
}
export function replaceActiveOrders(
  store: Store,
  character: string,
  orders: unknown[],
) {
  store.sql
    .prepare(
      "DELETE FROM character_orders WHERE character_id=? AND state='active'",
    )
    .run(character);
  const insert = store.sql.prepare(
    "INSERT INTO character_orders VALUES (?,?,'active',?,?)",
  );
  for (const raw of orders) {
    const order = z.object({ order_id: z.coerce.string() }).parse(raw);
    insert.run(
      character,
      order.order_id,
      JSON.stringify(raw),
      new Date().toISOString(),
    );
  }
}
