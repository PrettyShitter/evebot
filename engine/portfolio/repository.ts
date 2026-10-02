import { randomUUID } from "node:crypto";
import type { Store } from "../../db/store";
import { budget } from "./budget";
import { D, sum, Decimal } from "../accounting/money";
import type { WalletData } from "./sync";
import type { CharacterView } from "../../shared/contracts/app";
export class Portfolio {
  constructor(private store: Store) {}
  characters(): CharacterView[] {
    return (
      this.store.sql
        .prepare("SELECT * FROM characters ORDER BY is_seller DESC,id")
        .all() as {
        id: string;
        name: string;
        status: string;
        is_seller: number;
        balance: string | null;
      }[]
    ).map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      isSeller: !!c.is_seller,
      balance: c.balance,
    }));
  }
  connect(id: string, name: string, seller: boolean) {
    this.store.sql.transaction(() => {
      const exists = this.store.sql
        .prepare("SELECT id FROM characters WHERE id=?")
        .get(id);
      if (!exists && this.characters().length >= 3)
        throw Error("Подключены все три персонажа");
      if (seller)
        this.store.sql.prepare("UPDATE characters SET is_seller=0").run();
      this.store.sql
        .prepare(
          "INSERT INTO characters(id,name,status,is_seller) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,status=excluded.status,is_seller=excluded.is_seller",
        )
        .run(id, name, "connected", seller ? 1 : 0);
    })();
  }
  disconnect(id: string) {
    this.store.sql
      .prepare("UPDATE characters SET status='revoked' WHERE id=?")
      .run(id);
  }
  currentBudget() {
    const row = this.store.sql
      .prepare(
        "SELECT balances FROM wallet_snapshots WHERE reconciled=1 ORDER BY rowid DESC LIMIT 1",
      )
      .get() as { balances: string } | undefined;
    const r = this.store.sql
      .prepare("SELECT amount,kind FROM budget_reservations WHERE paid=0")
      .all() as { amount: string; kind: string }[];
    const confirmed = row
      ? Object.values(JSON.parse(row.balances) as Record<string, string>)
      : [];
    const visible = this.characters();
    const safe =
      visible.length === 3 && visible.every((c) => c.balance !== null)
        ? [
            Decimal.min(
              sum(confirmed),
              sum(visible.map((c) => c.balance!)),
            ).toFixed(),
          ]
        : confirmed;
    return budget(
      safe,
      r.filter((x) => x.kind === "purchase").map((x) => x.amount),
      r.filter((x) => x.kind === "fee").map((x) => x.amount),
    );
  }
  importWallets(
    wallets: WalletData[],
    paidReservations: string[] = [],
    now = new Date().toISOString(),
  ) {
    const characters = this.characters();
    if (
      wallets.length !== 3 ||
      new Set(wallets.map((x) => x.id)).size !== 3 ||
      characters.some((c) => !wallets.some((w) => w.id === c.id))
    )
      throw Error("Нужны все три кошелька");
    return this.store.sql.transaction(() => {
      const old = this.store.sql
        .prepare(
          "SELECT balances,captured_at FROM wallet_snapshots WHERE reconciled=1 ORDER BY rowid DESC LIMIT 1",
        )
        .get() as { balances: string; captured_at: string } | undefined;
      const ids = new Set(wallets.map((w) => w.id));
      let consistent = true;
      const reasons: string[] = [];
      // Match internal cash transfers by parties, amount and time; ambiguity blocks increases.
      const transfers = wallets.flatMap((w) =>
        w.journal
          .filter(
            (j) =>
              j.ref_type === "player_donation" &&
              j.first_party_id &&
              j.second_party_id &&
              ids.has(j.first_party_id) &&
              ids.has(j.second_party_id),
          )
          .map((j) => ({ owner: w.id, j })),
      );
      for (const t of transfers) {
        const matches = transfers.filter(
          (o) =>
            o.owner !== t.owner &&
            o.j.first_party_id === t.j.first_party_id &&
            o.j.second_party_id === t.j.second_party_id &&
            o.j.date === t.j.date &&
            D(o.j.amount ?? "0").eq(D(t.j.amount ?? "0").neg()),
        );
        if (matches.length !== 1) {
          consistent = false;
          reasons.push("Внутренний перевод ожидает вторую сторону");
        }
      }
      if (old) {
        const prior = JSON.parse(old.balances) as Record<string, string>;
        for (const w of wallets) {
          const cursor = this.store.sql
            .prepare("SELECT value FROM sync_cursors WHERE key=?")
            .get("journal:" + w.id) as { value: string } | undefined;
          const fresh = w.journal.filter(
            (j) => !cursor || BigInt(j.id) > BigInt(cursor.value),
          );
          if (
            !D(w.balance)
              .minus(prior[w.id] ?? "0")
              .eq(sum(fresh.map((j) => j.amount ?? "0")))
          ) {
            consistent = false;
            reasons.push("Баланс и журнал получены из разных снимков");
          }
        }
      }
      for (const w of wallets) {
        for (const t of w.transactions)
          this.store.sql
            .prepare(
              "INSERT OR IGNORE INTO wallet_transactions VALUES (?,?,?,?,?)",
            )
            .run("esi", w.id, t.transaction_id, JSON.stringify(t), now);
        for (const j of w.journal)
          this.store.sql
            .prepare("INSERT OR IGNORE INTO wallet_journal VALUES (?,?,?,?)")
            .run(w.id, j.id, JSON.stringify(j), now);
        this.store.sql
          .prepare(
            "UPDATE characters SET balance=?,updated_at=?,status=? WHERE id=?",
          )
          .run(w.balance, now, consistent ? "connected" : "syncing", w.id);
      }
      if (consistent) {
        for (const reservation of paidReservations) {
          const r = this.store.sql
            .prepare("SELECT * FROM budget_reservations WHERE id=? AND paid=0")
            .get(reservation);
          if (!r) throw Error("Неизвестный неоплаченный резерв");
          this.store.sql
            .prepare("UPDATE budget_reservations SET paid=1 WHERE id=?")
            .run(reservation);
        }
        for (const w of wallets) {
          const max = w.journal.reduce(
            (a, j) => (BigInt(j.id) > BigInt(a) ? j.id : a),
            "0",
          );
          this.store.sql
            .prepare(
              "INSERT INTO sync_cursors VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            )
            .run("journal:" + w.id, max);
        }
        this.store.sql
          .prepare("INSERT INTO wallet_snapshots VALUES (?,?,?,1)")
          .run(
            randomUUID(),
            now,
            JSON.stringify(
              Object.fromEntries(wallets.map((w) => [w.id, w.balance])),
            ),
          );
      }
      return {
        consistent,
        reasons: [...new Set(reasons)],
        budget: this.currentBudget(),
      };
    })();
  }
}
