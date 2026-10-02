import { useState } from "react";
import type { AppState } from "../shared/contracts/app";
import type { DealView } from "../engine/portfolio/trades";
import type { Request } from "./MarketView";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { money } from "./lib/format";
export function ReviewPanel({
  state,
  deal,
  request,
  busy,
}: {
  state: AppState;
  deal: DealView;
  request: Request;
  busy: boolean;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const purchases = state.review.purchases.filter(
    (p) =>
      p.tx.date >= deal.createdAt &&
      deal.forecast.some(
        (o) => o.type.id === p.tx.type_id && o.source.id === p.tx.location_id,
      ),
  );
  const transfers = state.review.transfers.filter((t) => t.deal_id === deal.id);
  const expenses = state.review.expenses.filter(
    (e) => e.characterId === deal.sellerId && e.journal.date >= deal.createdAt,
  );
  return (
    <div className="space-y-3">
      <h3 className="font-medium">Сверка исходных операций</h3>
      <p className="caption">
        Привязывайте только покупки этой сделки. Подтверждение передачи
        означает, что партия действительно доступна основному продавцу. Расход
        можно распределить частично между сделками.
      </p>
      {state.demo && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void request({ kind: "demo.operations", id: deal.id })}
        >
          DEMO: загрузить покупки и продажи
        </Button>
      )}
      {purchases.map((p) => (
        <div
          className="extra-row"
          key={p.characterId + ":" + p.tx.transaction_id}
        >
          <span className="text-sm">
            Покупка #{p.tx.transaction_id} · {p.tx.quantity} шт. ×{" "}
            {money(p.tx.unit_price, 2)} ISK ·{" "}
            {state.characters.find((c) => c.id === p.characterId)?.name}
          </span>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void request({
                kind: "purchase.bind",
                dealId: deal.id,
                characterId: p.characterId,
                transactionId: p.tx.transaction_id,
              })
            }
          >
            Это покупка сделки
          </Button>
        </div>
      ))}
      {transfers.map((t) => (
        <div className="extra-row" key={t.id}>
          <span className="text-sm">
            Партия альта: {t.quantity} шт. Передача не подтверждена.
          </span>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void request({ kind: "transfer.confirm", lotId: t.id })
            }
          >
            Передано основе
          </Button>
        </div>
      ))}
      {expenses.map((e) => (
        <div className="extra-row" key={e.journal.id}>
          <span className="text-sm">
            {e.journal.ref_type} #{e.journal.id} ·{" "}
            {money(e.journal.amount ?? "0", 2)} ISK
          </span>
          <Input
            aria-label={"Часть расхода " + e.journal.id}
            className="max-w-36"
            placeholder="Полная сумма"
            value={amounts[e.journal.id] ?? ""}
            onChange={(event) =>
              setAmounts({ ...amounts, [e.journal.id]: event.target.value })
            }
          />
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void request({
                kind: "expense.bind",
                dealId: deal.id,
                characterId: e.characterId,
                journalId: e.journal.id,
                ...(amounts[e.journal.id]
                  ? { amount: amounts[e.journal.id] }
                  : {}),
              })
            }
          >
            Привязать расход
          </Button>
        </div>
      ))}
      {deal.result.sold > 0 && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void request({ kind: "expenses.confirm", id: deal.id })
          }
        >
          Все расходы сделки сопоставлены
        </Button>
      )}
      <div className="cart-summary">
        <span>
          Себестоимость проданного
          <strong>{money(deal.result.cost, 2)} ISK</strong>
        </span>
        <span>
          Выручка<strong>{money(deal.result.revenue, 2)} ISK</strong>
        </span>
        <span>
          Распределённые расходы
          <strong>{money(deal.result.fees, 2)} ISK</strong>
        </span>
      </div>
    </div>
  );
}
