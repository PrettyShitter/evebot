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
    s.sql.prepare("UPDATE characters SET status='syncing'").run();
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
    expect(t.list()[0].result.purchased).toBe(20);
    expect(
      t
        .list()[0]
        .events.filter((event) => event.kind === "purchase.auto-bound"),
    ).toHaveLength(2);
    expect(r.review().transfers).toHaveLength(1);
    insert("90000001", tx("3", 12, "150", false));
    r.run("deal");
    expect(t.list()[0].result.sold).toBe(0);
    r.confirmTransfer(r.review().transfers[0].id);
    r.run("deal");
    expect(t.list()[0].status).toBe("RECONCILING");
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
    expect(closed.result.netProceeds).toBe("2700.00");
    expect(closed.result.profit).toBe("500.00");
    r.run("deal");
    expect(t.list()[0].result.profit).toBe("500.00");
    s.sql.prepare("INSERT INTO wallet_journal VALUES (?,?,?,?)").run(
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
    expect(t.list()[0].result.netProceeds).toBe("2700.00");
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

it("manually reconciles wallet operations completed before the deal was selected", () => {
  const s = new Store(":memory:", resolve("db/migrations"));
  try {
    seedDemo(s);
    s.saveSettings({ ...s.getSettings(), minTripProfit: "0" });
    const data = readStatic(s)!;
    const t = new Trades(s, () => data),
      r = new Reconciler(s, () => data);
    const opportunity = selectQuantity(
      demoScan(s).find((o) => o.type.id === "587")!,
      1,
    );
    s.sql.prepare("UPDATE characters SET status='syncing'").run();
    const transaction = (
      id: string,
      date: string,
      price: string,
      buy: boolean,
    ) => ({
      transaction_id: id,
      date,
      type_id: "587",
      location_id: buy ? opportunity.source.id : opportunity.destination.id,
      quantity: 1,
      unit_price: price,
      is_buy: buy,
      is_personal: true,
      client_id: "999",
      journal_ref_id: id + "0",
    });
    const insert = (v: ReturnType<typeof transaction>) =>
      s.sql
        .prepare("INSERT INTO wallet_transactions VALUES (?,?,?,?,?)")
        .run("esi", "90000001", v.transaction_id, JSON.stringify(v), v.date);
    const buyAt = new Date(Date.now() - 120_000).toISOString();
    const sellAt = new Date(Date.now() - 60_000).toISOString();
    insert(transaction("1001", buyAt, "100", true));
    insert(transaction("1002", sellAt, "150", false));
    const journal = {
      id: "2001",
      date: sellAt,
      ref_type: "transaction_tax",
      amount: "-15",
    };
    s.sql
      .prepare("INSERT INTO wallet_journal VALUES (?,?,?,?)")
      .run("90000001", journal.id, JSON.stringify(journal), sellAt);

    t.accept("historical-deal", [opportunity]);
    r.run();
    expect(t.list()[0].result.purchased).toBe(0);

    expect(() =>
      r.bindPurchase("90000001", "1001", "historical-deal"),
    ).not.toThrow();
    r.run("historical-deal");
    expect(t.list()[0].result.purchased).toBe(1);
    expect(t.list()[0].result.sold).toBe(1);
    expect(t.list()[0].saleTransactions).toEqual([
      { transactionId: "1002", date: sellAt, quantity: 1 },
    ]);
    expect(t.list()[0].status).toBe("NEEDS_REVIEW");
    expect(r.expenses()).toHaveLength(1);
    r.attachExpense("historical-deal", "90000001", journal.id);
    r.confirmExpenses("historical-deal");
    r.run();
    expect(t.list()[0].status).toBe("CLOSED");
    expect(t.list()[0].result.profit).toBe("35.00");
  } finally {
    s.close();
  }
});

it("allocates only the remaining deal quantity from alt purchases and sells only from the main character", () => {
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
    s.sql.prepare("UPDATE characters SET status='syncing'").run();
    t.accept("partial-alt-purchase", [opportunity]);
    const at = new Date(Date.now() + 1000).toISOString();
    const transaction = (
      id: string,
      quantity: number,
      buy: boolean,
      unitPrice = "100",
    ) => ({
      transaction_id: id,
      date: at,
      type_id: "587",
      location_id: buy ? opportunity.source.id : opportunity.destination.id,
      quantity,
      unit_price: unitPrice,
      is_buy: buy,
      is_personal: true,
      client_id: "999",
      journal_ref_id: id + "0",
    });
    const insert = (characterId: string, tx: ReturnType<typeof transaction>) =>
      s.sql
        .prepare("INSERT INTO wallet_transactions VALUES (?,?,?,?,?)")
        .run("esi", characterId, tx.transaction_id, JSON.stringify(tx), at);

    // The second ESI transaction is larger than the selected deal's remainder.
    insert("90000002", transaction("101", 10, true));
    insert("90000003", transaction("102", 15, true, "110"));
    r.run();
    const deal = t.list()[0];
    expect(deal.result.purchased).toBe(20);
    expect(
      s.sql
        .prepare("SELECT quantity FROM purchase_lots ORDER BY transaction_id")
        .all(),
    ).toEqual([{ quantity: 10 }, { quantity: 10 }]);
    const partial = deal.events.find(
      (event) =>
        event.kind === "purchase.matched" &&
        (JSON.parse(event.payload) as { transactionId?: string })
          .transactionId === "102",
    );
    expect(JSON.parse(partial!.payload)).toMatchObject({
      quantity: 10,
      transactionQuantity: 15,
      unassignedQuantity: 5,
    });

    for (const lot of r.review().transfers) r.confirmTransfer(lot.id);
    insert("90000002", transaction("103", 20, false, "150"));
    insert("90000001", transaction("104", 20, false, "150"));
    r.run();
    expect(t.list()[0].result.sold).toBe(20);
    expect(t.list()[0].result.cost).toBe("2100.00");
    expect([
      ...new Set(
        t.list()[0].saleTransactions.map((sale) => sale.transactionId),
      ),
    ]).toEqual(["104"]);
  } finally {
    s.close();
  }
});
