import { it, expect } from "vitest";
import { Store } from "../../db/store";
import { seedDemo } from "../../engine/market/demo";
import {
  ownSellOrders,
  replaceActiveOrders,
} from "../../engine/portfolio/orders";
it("active sell orders show price/remaining and disappear after an authoritative empty snapshot", () => {
  const store = new Store(":memory:", "db/migrations");
  try {
    seedDemo(store);
    const seller = (
      store.sql
        .prepare("SELECT id FROM characters WHERE is_seller=1")
        .get() as { id: string }
    ).id;
    store.sql.transaction(() =>
      replaceActiveOrders(store, seller, [
        {
          order_id: "sell",
          type_id: "587",
          location_id: "60003760",
          price: "123456.78",
          volume_remain: 42,
        },
        {
          order_id: "buy",
          type_id: "587",
          location_id: "60003760",
          price: "1",
          volume_remain: 42,
          is_buy_order: true,
        },
      ]),
    )();
    expect(ownSellOrders(store)).toMatchObject([
      { id: "sell", price: "123456.78", remaining: 42 },
    ]);
    store.sql.transaction(() => replaceActiveOrders(store, seller, []))();
    expect(ownSellOrders(store)).toEqual([]);
  } finally {
    store.close();
  }
});
