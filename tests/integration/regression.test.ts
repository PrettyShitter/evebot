import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../../db/store";
import { seedDemo } from "../../engine/market/demo";
import { readStatic } from "../../engine/market/static-data";
import { Trades, selectQuantity } from "../../engine/portfolio/trades";
import { Portfolio } from "../../engine/portfolio/repository";
import { Reconciler } from "../../engine/accounting/reconcile";
import { demoScan } from "../fixtures/demo-scan";
import type { WalletData, Journal } from "../../engine/portfolio/sync";
for (const buyer of ["90000001", "90000002"])
  it(
    "stage 9: two types, " +
      (buyer === "90000002" ? "alt after internal transfer" : "main directly") +
      ", restart, exact 1700 ISK outcome",
    () => {
      const directory = mkdtempSync(join(tmpdir(), "eve-regression-"));
      const path = join(directory, "portfolio.sqlite");
      let s = new Store(path, resolve("db/migrations"));
      try {
        seedDemo(s);
        s.saveSettings({
          ...s.getSettings(),
          sort: "buy",
          minProfit: "0",
          minTripProfit: "0",
        });
        let trades = new Trades(s, () => readStatic(s)),
          r = new Reconciler(s, () => readStatic(s));
        const p = new Portfolio(s);
        const offers = demoScan(s);
        const ship = offers.find((o) => o.type.id === "587")!;
        const mineral = offers.find(
          (o) =>
            o.type.id === "34" &&
            o.source.id === ship.source.id &&
            o.destination.id === ship.destination.id,
        )!;
        trades.accept("multi", [
          selectQuantity(ship, 20),
          selectQuantity(mineral, 1000),
        ]);
        const at = new Date(Date.now() + 1000).toISOString();
        const wallets: WalletData[] = [
          "600000000",
          "250000000",
          "150000000",
        ].map((balance, i) => ({
          id: String(90000001 + i),
          balance,
          transactions: [],
          journal: [],
          modified: at,
          expires: 0,
        }));
        if (buyer === "90000002") {
          const transfer: Journal = {
            id: "1",
            date: at,
            ref_type: "player_donation",
            first_party_id: "90000001",
            second_party_id: buyer,
            amount: "-300000000",
          };
          wallets[0].balance = "300000000";
          wallets[0].journal = [transfer];
          wallets[1].balance = "550000000";
          wallets[1].journal = [{ ...transfer, amount: "300000000" }];
          expect(p.importWallets(wallets).consistent).toBe(true);
          expect(p.currentBudget().wallet).toBe("1000000000.00");
        }
        const w = wallets.find((w) => w.id === buyer)!;
        for (const [index, type, q, price] of [
          [0, "587", 20, "100"],
          [1, "34", 1000, "2"],
        ] as const) {
          const id = String(100 + index);
          w.transactions.push({
            transaction_id: id,
            type_id: type,
            quantity: q,
            unit_price: price,
            date: at,
            location_id: ship.source.id,
            is_buy: true,
            is_personal: true,
            client_id: "999",
            journal_ref_id: String(2 + index),
          });
          w.journal.push({
            id: String(2 + index),
            date: at,
            ref_type: "market_transaction",
            amount: "-2000",
          });
        }
        w.balance = String(BigInt(w.balance) - 4000n);
        expect(p.importWallets(wallets).consistent).toBe(true);
        r.bindPurchase(buyer, "100", "multi");
        r.bindPurchase(buyer, "101", "multi");
        for (const lot of r.review().transfers) r.confirmTransfer(lot.id);
        r.run();
        expect(p.currentBudget().available).toBe("799996800.00");
        trades.route("multi", "lowsec");
        s.close();
        s = new Store(path, resolve("db/migrations"));
        trades = new Trades(s, () => readStatic(s));
        r = new Reconciler(s, () => readStatic(s));
        expect(trades.list()[0].routeMode).toBe("lowsec");
        for (const [id, type, q, price, tax] of [
          ["200", "587", 12, "150", "90"],
          ["201", "587", 8, "150", "60"],
          ["202", "34", 1000, "3", "150"],
        ] as const) {
          const tx = {
            transaction_id: id,
            type_id: type,
            quantity: q,
            unit_price: price,
            date: at,
            location_id: ship.destination.id,
            is_buy: false,
            is_personal: true,
            client_id: "999",
            journal_ref_id: id + "0",
          };
          s.sql
            .prepare("INSERT INTO wallet_transactions VALUES (?,?,?,?,?)")
            .run("esi", "90000001", id, JSON.stringify(tx), at);
          s.sql
            .prepare("INSERT INTO wallet_journal VALUES (?,?,?,?)")
            .run(
              "90000001",
              id + "1",
              JSON.stringify({
                id: id + "1",
                date: at,
                ref_type: "transaction_tax",
                amount: "-" + tax,
                context_id: id,
                context_id_type: "market_transaction_id",
              }),
              at,
            );
          r.run();
          if (id === "200") {
            expect(trades.list()[0].result.remaining).toBe(1008);
            expect(trades.list()[0].status).toBe("SALE_PARTIAL");
          }
        }
        expect(trades.list()[0].result.ready).toBe(true);
        expect(trades.list()[0].status).not.toBe("CLOSED");
        r.confirmExpenses("multi");
        r.run("multi");
        r.run("multi");
        expect(trades.list()[0].result).toMatchObject({
          cost: "4000.00",
          revenue: "6000.00",
          fees: "300.00",
          profit: "1700.00",
          remaining: 0,
        });
        expect(trades.list()[0].status).toBe("CLOSED");
        expect(s.sql.pragma("integrity_check", { simple: true })).toBe("ok");
        expect(s.sql.pragma("foreign_key_check")).toEqual([]);
      } finally {
        s.close();
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
