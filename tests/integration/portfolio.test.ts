import { it, expect } from "vitest";
import { Store } from "../../db/store";
import { Portfolio } from "../../engine/portfolio/repository";
import { resolve } from "node:path";
import type { WalletData, Journal } from "../../engine/portfolio/sync";
const wallet = (
  id: string,
  balance: string,
  journal: Journal[] = [],
): WalletData => ({
  id,
  balance,
  journal,
  transactions: [],
  modified: "2026-10-02T00:00:00Z",
  expires: 0,
});
it("stage 2: imports, incomplete internal transfer, consistent budget, reservation acknowledgement in one transaction", () => {
  const s = new Store(":memory:", resolve("db/migrations"));
  const p = new Portfolio(s);
  try {
    for (const id of ["1", "2", "3"]) p.connect(id, id, id === "1");
    const initial = [
      wallet("1", "1000000000"),
      wallet("2", "0"),
      wallet("3", "0"),
    ];
    expect(p.importWallets(initial).consistent).toBe(true);
    const transfer: Journal = {
      id: "1",
      date: "2026-10-02T01:00:00Z",
      ref_type: "player_donation",
      amount: "-300000000",
      first_party_id: "1",
      second_party_id: "2",
    };
    const sender = wallet("1", "700000000", [transfer]),
      receiver = wallet("2", "300000000", [
        { ...transfer, amount: "300000000" },
      ]);
    expect(p.importWallets([initial[0], receiver, initial[2]]).consistent).toBe(
      false,
    );
    expect(p.currentBudget().wallet).toBe("1000000000.00");
    expect(p.importWallets([sender, initial[1], initial[2]]).consistent).toBe(
      false,
    );
    expect(p.importWallets([sender, receiver, initial[2]]).consistent).toBe(
      true,
    );
    expect(p.importWallets([sender, receiver, initial[2]]).consistent).toBe(
      true,
    );
    expect(
      s.sql.prepare("SELECT count(*) n FROM wallet_journal").get(),
    ).toEqual({ n: 2 });
    s.sql
      .prepare(
        "INSERT INTO deals(id,source,destination,status,seller_id,forecast,created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run("d", "A", "B", "SELECTED", "1", "{}", "2026-10-02");
    s.sql
      .prepare("INSERT INTO budget_reservations VALUES (?,?,?,?,?,?)")
      .run("r", "d", "34", "purchase", "150000000", 0);
    expect(p.currentBudget().available).toBe("650000000.00");
    const paid = wallet("1", "550000000", [
      transfer,
      {
        id: "2",
        date: "2026-10-02T02:00:00Z",
        ref_type: "market_transaction",
        amount: "-150000000",
      },
    ]);
    expect(
      p.importWallets([paid, receiver, initial[2]], ["r"]).budget.available,
    ).toBe("680000000.00");
    expect(p.importWallets([paid, receiver, initial[2]]).budget.available).toBe(
      "680000000.00",
    );
    p.disconnect("2");
    expect(s.sql.prepare("SELECT count(*) n FROM deals").get()).toEqual({
      n: 1,
    });
  } finally {
    s.close();
  }
});
it("missing character cannot publish a new cash snapshot", () => {
  const s = new Store(":memory:", resolve("db/migrations"));
  try {
    const p = new Portfolio(s);
    expect(() => p.importWallets([wallet("1", "1")])).toThrow("три");
    expect(p.currentBudget().available).toBe("0.00");
  } finally {
    s.close();
  }
});
