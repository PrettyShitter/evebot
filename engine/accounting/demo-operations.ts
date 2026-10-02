import type { Store } from "../../db/store";
import type { DealView } from "../portfolio/trades";
import { D } from "./money";
// Called only behind the worker's DEMO guard; no network writes.
export function demoOperations(store: Store, deal: DealView) {
  const now = new Date(Date.now() + 1000).toISOString();
  let index = 0;
  for (const o of deal.forecast) {
    const key =
      BigInt("8000000000000000") +
      BigInt(deal.createdAt.replace(/\D/g, "").slice(-12)) * 100n +
      BigInt(index++ * 10);
    const buy = {
      transaction_id: String(key),
      date: now,
      type_id: o.type.id,
      location_id: o.source.id,
      quantity: o.quantity,
      unit_price: D(o.purchase.total).div(o.quantity).toFixed(2),
      is_buy: true,
      is_personal: true,
      client_id: "999",
      journal_ref_id: String(key + 1n),
    };
    const sale = {
      ...buy,
      transaction_id: String(key + 2n),
      location_id: o.destination.id,
      unit_price: D(buy.unit_price).mul("1.5").toFixed(2),
      is_buy: false,
      journal_ref_id: String(key + 3n),
    };
    for (const tx of [buy, sale])
      store.sql
        .prepare("INSERT OR IGNORE INTO wallet_transactions VALUES (?,?,?,?,?)")
        .run("demo", deal.sellerId, tx.transaction_id, JSON.stringify(tx), now);
    const tax = {
      id: String(key + 4n),
      date: now,
      ref_type: "transaction_tax",
      amount: D(sale.unit_price).mul(sale.quantity).mul("-.05").toFixed(2),
      context_id_type: "market_transaction_id",
      context_id: sale.transaction_id,
    };
    store.sql
      .prepare("INSERT OR IGNORE INTO wallet_journal VALUES (?,?,?,?)")
      .run(deal.sellerId, tax.id, JSON.stringify(tax), now);
  }
}
