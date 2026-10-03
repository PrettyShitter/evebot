import { randomUUID, createHash } from "node:crypto";
import type { Store } from "../../db/store";
import { transactionSchema } from "../../shared/contracts/esi";
import { journalSchema } from "../portfolio/sync";
import { Trades } from "../portfolio/trades";
import type { StaticData } from "../market/static-data";
import { D, isk, sum, allocateMoney } from "./money";
import { fifo } from "./fifo";
import type { Opportunity } from "../market/opportunities";
interface RawTransaction {
  characterId: string;
  tx: ReturnType<typeof transactionSchema.parse>;
}
interface LotRow {
  id: string;
  deal_id: string;
  type_id: string;
  buyer_id: string;
  transaction_id: string;
  acquired_at: string;
  quantity: number;
  remaining: number;
  unit_cost: string;
  location_id: string;
  eligibility: string;
}
const EXPENSE_TYPES = new Set(["transaction_tax", "brokers_fee"]);
export class Reconciler {
  private trades: Trades;
  constructor(
    private store: Store,
    data: () => StaticData | null,
  ) {
    this.trades = new Trades(store, data);
  }
  private transactions(): RawTransaction[] {
    return (
      this.store.sql
        .prepare(
          "SELECT character_id,payload FROM wallet_transactions ORDER BY imported_at,id",
        )
        .all() as { character_id: string; payload: string }[]
    )
      .map((r) => ({
        characterId: r.character_id,
        tx: transactionSchema.parse(JSON.parse(r.payload)),
      }))
      .sort(
        (a, b) =>
          a.tx.date.localeCompare(b.tx.date) ||
          (BigInt(a.tx.transaction_id) < BigInt(b.tx.transaction_id) ? -1 : 1),
      );
  }
  expenses() {
    return (
      this.store.sql
        .prepare("SELECT character_id,payload FROM wallet_journal")
        .all() as { character_id: string; payload: string }[]
    )
      .map((r) => ({
        characterId: r.character_id,
        journal: journalSchema.parse(JSON.parse(r.payload)),
      }))
      .filter(
        (r) =>
          EXPENSE_TYPES.has(r.journal.ref_type) &&
          D(r.journal.amount ?? 0).lt(0),
      );
  }
  private issue(deal: string, reason: string) {
    const last = this.store.sql
      .prepare(
        "SELECT payload FROM deal_events WHERE deal_id=? AND kind=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(deal, "review") as { payload: string } | undefined;
    if (last?.payload !== JSON.stringify({ reason }))
      this.trades.event(deal, "review", { reason });
    this.store.sql
      .prepare("UPDATE deals SET status='NEEDS_REVIEW' WHERE id=?")
      .run(deal);
  }
  confirmTransfer(lotId: string) {
    const lot = this.store.sql
      .prepare("SELECT deal_id FROM purchase_lots WHERE id=?")
      .get(lotId) as { deal_id: string } | undefined;
    if (!lot) throw Error("Партия не найдена");
    this.store.sql
      .prepare("UPDATE purchase_lots SET eligibility='confirmed' WHERE id=?")
      .run(lotId);
    this.trades.event(lot.deal_id, "transfer.user-confirmed", { lotId });
  }
  bindPurchase(
    characterId: string,
    transactionId: string,
    dealId: string,
    source: "user" | "auto" = "user",
  ) {
    const raw = this.transactions().find(
      (r) =>
        r.characterId === characterId && r.tx.transaction_id === transactionId,
    );
    const deal = this.trades.list().find((d) => d.id === dealId);
    if (!raw?.tx.is_buy || !raw.tx.is_personal || !deal)
      throw Error("Не найдена личная покупка");
    if (raw.tx.date < deal.createdAt)
      throw Error("Покупка совершена до выбора этой сделки");
    const line = deal.forecast.find(
      (o) => o.type.id === raw.tx.type_id && o.source.id === raw.tx.location_id,
    );
    if (!line) throw Error("Тип или станция покупки не совпадают");
    this.store.sql.transaction(() => {
      this.addLot(raw, dealId, deal.sellerId, line);
      this.trades.event(
        dealId,
        source === "auto" ? "purchase.auto-bound" : "purchase.user-bound",
        {
          characterId,
          transactionId,
        },
      );
    })();
  }
  private addLot(
    raw: RawTransaction,
    dealId: string,
    sellerId: string,
    line: Opportunity,
  ) {
    const { tx, characterId } = raw;
    const already = this.store.sql
      .prepare(
        "SELECT id FROM purchase_lots WHERE buyer_id=? AND transaction_id=?",
      )
      .get(characterId, tx.transaction_id);
    if (already) return;
    const acquired = (
      this.store.sql
        .prepare(
          "SELECT coalesce(sum(quantity),0) n FROM purchase_lots WHERE deal_id=? AND type_id=?",
        )
        .get(dealId, tx.type_id) as { n: number }
    ).n;
    if (acquired + tx.quantity > line.quantity)
      throw Error("Покупка превышает остаток выбранной партии");
    this.store.sql
      .prepare("INSERT INTO purchase_lots VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        dealId,
        tx.type_id,
        characterId,
        tx.transaction_id,
        tx.date,
        tx.quantity,
        tx.quantity,
        tx.unit_price,
        tx.location_id,
        characterId === sellerId ? "confirmed" : "review",
      );
    this.trades.event(dealId, "purchase.matched", {
      characterId,
      transactionId: tx.transaction_id,
      quantity: tx.quantity,
    });
  }
  private releasePaidReservations() {
    for (const d of this.trades.list()) {
      for (const line of d.forecast) {
        const lots = this.store.sql
          .prepare("SELECT * FROM purchase_lots WHERE deal_id=? AND type_id=?")
          .all(d.id, line.type.id) as LotRow[];
        let paid = 0;
        for (const lot of lots) {
          const tx = this.transactions().find(
            (r) =>
              r.characterId === lot.buyer_id &&
              r.tx.transaction_id === lot.transaction_id,
          )?.tx;
          const cursor = this.store.sql
            .prepare("SELECT value FROM sync_cursors WHERE key=?")
            .get("journal:" + lot.buyer_id) as { value: string } | undefined;
          if (
            !tx ||
            !cursor ||
            BigInt(tx.journal_ref_id) > BigInt(cursor.value)
          )
            continue;
          const raw = this.store.sql
            .prepare(
              "SELECT payload FROM wallet_journal WHERE character_id=? AND id=?",
            )
            .get(lot.buyer_id, tx.journal_ref_id) as
            { payload: string } | undefined;
          const journal = raw
            ? journalSchema.parse(JSON.parse(raw.payload))
            : null;
          if (
            journal &&
            D(journal.amount ?? 0).eq(D(tx.unit_price).mul(tx.quantity).neg())
          )
            paid += lot.quantity;
        }
        const remaining = isk(
          D(line.purchase.total)
            .mul(Math.max(0, line.quantity - paid))
            .div(line.quantity),
        );
        this.store.sql
          .prepare(
            "UPDATE budget_reservations SET amount=?,paid=? WHERE deal_id=? AND type_id=? AND kind='purchase'",
          )
          .run(remaining, paid >= line.quantity ? 1 : 0, d.id, line.type.id);
      }
      const cursor = this.store.sql
        .prepare("SELECT value FROM sync_cursors WHERE key=?")
        .get("journal:" + d.sellerId) as { value: string } | undefined;
      const provenFees = cursor
        ? sum(
            (
              this.store.sql
                .prepare(
                  "SELECT f.amount,j.payload,f.journal_id FROM fee_allocations f JOIN wallet_journal j ON j.character_id=f.character_id AND j.id=f.journal_id WHERE f.deal_id=?",
                )
                .all(d.id) as {
                amount: string;
                payload: string;
                journal_id: string;
              }[]
            )
              .filter(
                (f) =>
                  BigInt(f.journal_id) <= BigInt(cursor.value) &&
                  journalSchema.parse(JSON.parse(f.payload)).ref_type ===
                    "brokers_fee",
              )
              .map((f) => f.amount),
          )
        : D(0);
      const reserved = d.forecast.filter((o) => o.rankedBy === "sell");
      const total = sum(reserved.map((o) => o.sell.listing));
      if (total.gt(0)) {
        const paid = allocateMoney(
          provenFees.gt(total) ? total.toFixed(2) : provenFees.toFixed(2),
          reserved.map((o) => o.sell.listing),
        );
        reserved.forEach((o, i) =>
          this.store.sql
            .prepare(
              "UPDATE budget_reservations SET amount=?,paid=? WHERE deal_id=? AND type_id=? AND kind='fee'",
            )
            .run(
              isk(D(o.sell.listing).minus(paid[i])),
              D(paid[i]).gte(o.sell.listing) ? 1 : 0,
              d.id,
              o.type.id,
            ),
        );
      }
    }
  }
  attachExpense(
    dealId: string,
    characterId: string,
    journalId: string,
    amount?: string,
  ) {
    const e = this.expenses().find(
      (e) => e.characterId === characterId && e.journal.id === journalId,
    );
    const deal = this.trades.list().find((d) => d.id === dealId);
    if (!e || !deal || deal.sellerId !== characterId)
      throw Error("Расход основного продавца не найден");
    const value = amount ?? D(e.journal.amount!).abs().toFixed(2);
    const existing = this.store.sql
      .prepare(
        "SELECT id FROM fee_allocations WHERE deal_id=? AND character_id=? AND journal_id=?",
      )
      .get(dealId, characterId, journalId);
    if (existing) return;
    const used = sum(
      (
        this.store.sql
          .prepare(
            "SELECT amount FROM fee_allocations WHERE character_id=? AND journal_id=?",
          )
          .all(characterId, journalId) as { amount: string }[]
      ).map((r) => r.amount),
    );
    if (D(value).lte(0) || used.plus(value).gt(D(e.journal.amount!).abs()))
      throw Error("Распределение превышает исходный расход");
    this.store.sql
      .prepare("INSERT INTO fee_allocations VALUES (?,?,?,?,?,1)")
      .run(randomUUID(), dealId, journalId, characterId, value);
    this.trades.event(dealId, "expense.allocated", {
      journalId,
      amount: value,
      source: "wallet_journal",
    });
  }
  private evidenceKey(id: string) {
    const rows = this.store.sql
      .prepare(
        "SELECT a.transaction_id,a.quantity,a.cost,a.proceeds FROM sale_allocations a JOIN purchase_lots l ON l.id=a.lot_id WHERE l.deal_id=? ORDER BY a.id",
      )
      .all(id);
    const fees = this.store.sql
      .prepare(
        "SELECT journal_id,amount FROM fee_allocations WHERE deal_id=? ORDER BY id",
      )
      .all(id);
    return createHash("sha256")
      .update(JSON.stringify([rows, fees]))
      .digest("hex");
  }
  confirmExpenses(id: string) {
    const deal = this.trades.list().find((d) => d.id === id);
    if (!deal || !deal.result.sold) throw Error("Продажи пока не найдены");
    const allocated = this.store.sql
      .prepare("SELECT journal_id FROM fee_allocations WHERE deal_id=?")
      .all(id) as { journal_id: string }[];
    if (
      !allocated.some((a) =>
        this.expenses().some(
          (e) =>
            e.characterId === deal.sellerId &&
            e.journal.id === a.journal_id &&
            e.journal.ref_type === "transaction_tax",
        ),
      )
    )
      throw Error("Сначала сопоставьте налог продажи из журнала");
    const key = this.evidenceKey(id);
    this.store.sql
      .prepare(
        "INSERT INTO sync_cursors VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run("expenses-confirmed:" + id, key);
    this.trades.event(id, "expenses.user-confirmed", { evidence: key });
  }
  run(closeId?: string) {
    return this.store.sql.transaction(() => {
      if (closeId) {
        const d = this.trades.list().find((d) => d.id === closeId);
        if (!d) throw Error("Сделка не найдена");
        if (d.status === "CANCELLED") throw Error("Сделка отменена");
        this.store.sql
          .prepare(
            "INSERT INTO sync_cursors VALUES (?,?) ON CONFLICT(key) DO NOTHING",
          )
          .run("close-requested:" + closeId, "true");
      }
      const raw = this.transactions();
      const reviews = new Set<string>();
      for (const r of raw.filter((r) => r.tx.is_buy && r.tx.is_personal)) {
        if (
          this.store.sql
            .prepare(
              "SELECT id FROM purchase_lots WHERE buyer_id=? AND transaction_id=?",
            )
            .get(r.characterId, r.tx.transaction_id)
        )
          continue;
        const matches = this.trades.list().filter((d) => {
          if (["CANCELLED", "CLOSED"].includes(d.status)) return false;
          const line = d.forecast.find(
            (l) =>
              l.type.id === r.tx.type_id && l.source.id === r.tx.location_id,
          );
          if (!line || r.tx.date < d.createdAt) return false;
          const acquired = (
            this.store.sql
              .prepare(
                "SELECT coalesce(sum(quantity),0) n FROM purchase_lots WHERE deal_id=? AND type_id=?",
              )
              .get(d.id, r.tx.type_id) as { n: number }
          ).n;
          return acquired + r.tx.quantity <= line.quantity;
        });
        if (matches.length === 1) {
          this.bindPurchase(
            r.characterId,
            r.tx.transaction_id,
            matches[0].id,
            "auto",
          );
          continue;
        }
        // A transaction matching more than one deal needs explicit review.
        for (const d of matches) {
          reviews.add(d.id);
          this.issue(
            d.id,
            `Покупка ${r.tx.transaction_id} подходит нескольким сделкам; выберите её вручную`,
          );
        }
      }
      this.releasePaidReservations();
      for (const r of raw.filter((r) => !r.tx.is_buy && r.tx.is_personal)) {
        const already = (
          this.store.sql
            .prepare(
              "SELECT coalesce(sum(quantity),0) n FROM sale_allocations WHERE seller_id=? AND transaction_id=?",
            )
            .get(r.characterId, r.tx.transaction_id) as { n: number }
        ).n;
        if (already === r.tx.quantity) continue;
        if (already)
          throw Error(
            "Частично записанная транзакция: требуется восстановление",
          );
        const all = this.store.sql
          .prepare(
            "SELECT l.* FROM purchase_lots l JOIN deals d ON d.id=l.deal_id WHERE l.type_id=? AND l.remaining>0 AND l.acquired_at<=? AND d.seller_id=? AND d.destination=? AND d.status!='CANCELLED' ORDER BY l.acquired_at,length(l.transaction_id),l.transaction_id",
          )
          .all(
            r.tx.type_id,
            r.tx.date,
            r.characterId,
            r.tx.location_id,
          ) as LotRow[];
        if (!all.length) {
          for (const d of this.trades
            .list()
            .filter(
              (d) =>
                !["CLOSED", "CANCELLED"].includes(d.status) &&
                d.sellerId === r.characterId &&
                d.destination === r.tx.location_id &&
                d.createdAt <= r.tx.date &&
                d.forecast.some((o) => o.type.id === r.tx.type_id),
            )) {
            reviews.add(d.id);
            this.issue(
              d.id,
              "Продажа найдена, но подтверждённая исходная партия отсутствует. Личный/старый товар не получает нулевую себестоимость.",
            );
          }
          continue;
        }
        if (all.some((l) => l.eligibility !== "confirmed")) {
          for (const l of all) {
            reviews.add(l.deal_id);
            this.issue(
              l.deal_id,
              "Подтвердите передачу партии основному продавцу",
            );
          }
          continue;
        }
        if (all.reduce((s, l) => s + l.remaining, 0) < r.tx.quantity) {
          for (const l of all) {
            reviews.add(l.deal_id);
            this.issue(
              l.deal_id,
              "Продажа включает товар без подтверждённой себестоимости",
            );
          }
          continue;
        }
        const result = fifo(
          all.map((l) => ({
            id: l.id,
            quantity: l.remaining,
            unitCost: l.unit_cost,
            acquiredAt: l.acquired_at,
          })),
          r.tx.quantity,
          r.tx.unit_price,
          "0",
        );
        const proceeds = allocateMoney(
          result.revenue,
          result.allocations.map((a) => String(a.quantity)),
        );
        result.allocations.forEach((a, i) => {
          this.store.sql
            .prepare("INSERT INTO sale_allocations VALUES (?,?,?,?,?,?,?,NULL)")
            .run(
              randomUUID(),
              a.lotId,
              r.characterId,
              r.tx.transaction_id,
              a.quantity,
              proceeds[i],
              a.cost,
            );
          this.store.sql
            .prepare(
              "UPDATE purchase_lots SET remaining=remaining-? WHERE id=?",
            )
            .run(a.quantity, a.lotId);
        });
      }
      // Auto-allocate only when an explicit API context uniquely identifies a sale transaction in the market_transaction_id namespace.
      for (const e of this.expenses()) {
        if (
          !e.journal.context_id ||
          e.journal.context_id_type !== "market_transaction_id"
        )
          continue;
        const linked = raw.filter(
          (r) =>
            r.characterId === e.characterId &&
            !r.tx.is_buy &&
            r.tx.transaction_id === e.journal.context_id,
        );
        const ids = new Set(
          linked.flatMap((r) =>
            (
              this.store.sql
                .prepare(
                  "SELECT DISTINCT l.deal_id FROM sale_allocations a JOIN purchase_lots l ON l.id=a.lot_id WHERE a.seller_id=? AND a.transaction_id=?",
                )
                .all(r.characterId, r.tx.transaction_id) as {
                deal_id: string;
              }[]
            ).map((x) => x.deal_id),
          ),
        );
        if (ids.size === 1)
          this.attachExpense([...ids][0], e.characterId, e.journal.id);
      }
      this.releasePaidReservations();
      for (const d of this.trades.list()) {
        if (d.status === "CANCELLED" || reviews.has(d.id)) continue;
        const lots = this.store.sql
          .prepare("SELECT * FROM purchase_lots WHERE deal_id=?")
          .all(d.id) as LotRow[];
        const expected = d.forecast.reduce((s, o) => s + o.quantity, 0),
          purchased = lots.reduce((s, l) => s + l.quantity, 0),
          remaining = lots.reduce((s, l) => s + l.remaining, 0);
        let status =
          purchased === 0
            ? "SELECTED"
            : purchased < expected
              ? "PURCHASE_PARTIAL"
              : remaining < purchased
                ? "SALE_PARTIAL"
                : "PURCHASED";
        const requested = this.store.sql
          .prepare("SELECT value FROM sync_cursors WHERE key=?")
          .get("close-requested:" + d.id);
        const confirmed = this.store.sql
          .prepare("SELECT value FROM sync_cursors WHERE key=?")
          .get("expenses-confirmed:" + d.id) as { value: string } | undefined;
        if (requested && (purchased < expected || remaining > 0))
          status = "RECONCILING";
        const exact = confirmed?.value === this.evidenceKey(d.id);
        this.store.sql
          .prepare(
            "UPDATE sale_allocations SET tax=? WHERE lot_id IN (SELECT id FROM purchase_lots WHERE deal_id=?)",
          )
          .run(exact ? "0.00" : null, d.id);
        if (requested && purchased === expected && remaining === 0) {
          if (exact) {
            status = "CLOSED";
            this.store.sql
              .prepare("UPDATE budget_reservations SET paid=1 WHERE deal_id=?")
              .run(d.id);
          } else {
            status = "NEEDS_REVIEW";
            this.issue(
              d.id,
              "Продажи найдены. Сопоставьте налог и брокерские расходы, затем подтвердите полноту расходов",
            );
          }
        }
        if (d.status === "CLOSED" && !exact) {
          status = "NEEDS_REVIEW";
          this.trades.event(d.id, "result.revision", {
            reason: "Поступили новые расходы или продажи",
          });
        }
        this.store.sql
          .prepare("UPDATE deals SET status=? WHERE id=?")
          .run(status, d.id);
      }
      for (const d of this.trades.list()) {
        const value = JSON.stringify({ status: d.status, ...d.result });
        const key = "result-version:" + d.id;
        const prior = this.store.sql
          .prepare("SELECT value FROM sync_cursors WHERE key=?")
          .get(key) as { value: string } | undefined;
        if (prior?.value !== value) {
          const revision =
            (
              this.store.sql
                .prepare(
                  "SELECT count(*) n FROM deal_events WHERE deal_id=? AND kind='result.snapshot'",
                )
                .get(d.id) as { n: number }
            ).n + 1;
          this.trades.event(d.id, "result.snapshot", {
            revision,
            ...JSON.parse(value),
          });
          this.store.sql
            .prepare(
              "INSERT INTO sync_cursors VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            )
            .run(key, value);
        }
      }
      if (closeId)
        this.store.sql
          .prepare("INSERT INTO reconciliation_runs VALUES (?,?,?,?,?)")
          .run(
            randomUUID(),
            closeId,
            new Date().toISOString(),
            this.trades.list().find((d) => d.id === closeId)!.status,
            JSON.stringify({ source: "imported_wallet_operations" }),
          );
      return this.trades.list();
    })();
  }
  review() {
    return {
      purchases: this.transactions().filter(
        (r) =>
          r.tx.is_buy &&
          r.tx.is_personal &&
          !this.store.sql
            .prepare(
              "SELECT id FROM purchase_lots WHERE buyer_id=? AND transaction_id=?",
            )
            .get(r.characterId, r.tx.transaction_id),
      ),
      transfers: this.store.sql
        .prepare(
          "SELECT id,deal_id,buyer_id,type_id,quantity FROM purchase_lots WHERE eligibility='review'",
        )
        .all() as {
        id: string;
        deal_id: string;
        buyer_id: string;
        type_id: string;
        quantity: number;
      }[],
      expenses: this.expenses(),
    };
  }
}
