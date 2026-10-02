import { it, expect } from "vitest";
import { resolve } from "node:path";
import { Store } from "../../db/store";
import { seedDemo } from "../../engine/market/demo";
import { readStatic } from "../../engine/market/static-data";
import { demoScan } from "../fixtures/demo-scan";
import { Trades, selectQuantity } from "../../engine/portfolio/trades";
import { Reconciler } from "../../engine/accounting/reconcile";
import { D } from "../../engine/accounting/money";
it("stage 7: explicit buy binding, alt delivery review, partial FIFO, button, exact expenses and late revision", () => {
  const s = new Store(":memory:", resolve("db/migrations"));
  try {
    seedDemo(s);
    s.saveSettings({ ...s.getSettings(), minTripProfit: "0" });
    const data = readStatic(s)!;
    const t = new Trades(s, () => data),
      r = new Reconciler(s, () => data);
    const opportunity = selectQuantity(
      demoScan(s).find((o) => o.type.id === "587")!,
      20,
    );
    t.accept("deal", [opportunity]);
    const now = new Date(Date.now() + 1000).toISOString();
    const tx = (id: string, q: number, price: string, buy: boolean) => ({
      transaction_id: id,
      date: now,
      type_id: "587",
      location_id: buy ? opportunity.source.id : opportunity.destination.id,
      quantity: q,
      unit_price: price,
      is_buy: buy,
      is_personal: true,
      client_id: "999",
      journal_ref_id: id + "0",
    });
    const insert = (char: string, v: ReturnType<typeof tx>) =>
      s.sql
        .prepare("INSERT OR IGNORE INTO wallet_transactions VALUES (?,?,?,?,?)")
        .run("esi", char, v.transaction_id, JSON.stringify(v), now);
    insert("90000002", tx("1", 10, "100", true));
    insert("90000001", tx("2", 10, "120", true));
    r.run();
    expect(t.list()[0].result.purchased).toBe(0);
    expect(t.list()[0].status).toBe("NEEDS_REVIEW");
    r.bindPurchase("90000002", "1", "deal");
    r.bindPurchase("90000001", "2", "deal");
    insert("90000001", tx("3", 12, "150", false));
    r.run("deal");
    expect(t.list()[0].result.sold).toBe(0);
    r.confirmTransfer(r.review().transfers[0].id);
    r.run("deal");
    expect(t.list()[0].status).toBe("SALE_PARTIAL");
    expect(t.list()[0].result.cost).toBe("1240.00");
    expect(t.list()[0].result.remaining).toBe(8);
    const journal = (id: string, amount: string) => ({
      id,
      date: now,
      ref_type: "transaction_tax",
      amount,
      context_id: "3",
      context_id_type: "market_transaction_id",
    });
    s.sql
      .prepare("INSERT INTO wallet_journal VALUES (?,?,?,?)")
      .run("90000001", "91", JSON.stringify(journal("91", "-180")), now);
    r.run();
    r.confirmExpenses("deal");
    r.run();
    expect(t.list()[0].status).not.toBe("CLOSED");
    insert("90000001", tx("4", 8, "150", false));
    s.sql
      .prepare("INSERT INTO wallet_journal VALUES (?,?,?,?)")
      .run(
        "90000001",
        "92",
        JSON.stringify({ ...journal("92", "-120"), context_id: "4" }),
        now,
      );
    r.run();
    expect(t.list()[0].status).toBe("NEEDS_REVIEW");
    r.confirmExpenses("deal");
    r.run("deal");
    const closed = t.list()[0];
    expect(closed.status).toBe("CLOSED");
    expect(closed.result.cost).toBe("2200.00");
    expect(closed.result.revenue).toBe("3000.00");
    expect(closed.result.profit).toBe("500.00");
    r.run("deal");
    expect(t.list()[0].result.profit).toBe("500.00");
    s.sql
      .prepare("INSERT INTO wallet_journal VALUES (?,?,?,?)")
      .run(
        "90000001",
        "93",
        JSON.stringify({
          ...journal("93", "-20"),
          ref_type: "brokers_fee",
          context_id: "4",
        }),
        now,
      );
    r.run();
    expect(t.list()[0].status).toBe("NEEDS_REVIEW");
    r.confirmExpenses("deal");
    r.run();
    expect(t.list()[0].result.profit).toBe("480.00");
    expect(
      D(t.list()[0].result.revenue)
        .minus(t.list()[0].result.cost)
        .minus(t.list()[0].result.fees)
        .toFixed(2),
    ).toBe("480.00");
  } finally {
    s.close();
  }
});
