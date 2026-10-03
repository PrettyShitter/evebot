import { ReviewPanel } from "./ReviewPanel";
import { useState } from "react";
import { Button } from "./components/ui/button";
import { MapPin, ArrowRight, ChevronDown, CheckCircle2 } from "lucide-react";
import type { AppState } from "../shared/contracts/app";
import type { Request } from "./MarketView";
import { money, signClass, roi } from "./lib/format";
import Decimal from "decimal.js";
const labels: Record<string, string> = {
  SELECTED: "Закупка выбрана",
  PURCHASE_PARTIAL: "Куплено частично",
  PURCHASED: "Куплено",
  SALE_PARTIAL: "Продано частично",
  RECONCILING: "Сверяем операции",
  CLOSED: "Закрыта",
  CANCELLED: "Отменена",
  NEEDS_REVIEW: "Нужна проверка",
};
export function DealsView({
  state,
  request,
  closed = false,
  busy,
}: {
  state: AppState;
  request: Request;
  closed?: boolean;
  busy: boolean;
}) {
  const [since, setSince] = useState("");
  const [showCancelled, setShowCancelled] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const deals = state.deals.filter((d) =>
    closed
      ? d.status === "CLOSED" && (!since || d.createdAt.slice(0, 10) >= since)
      : d.status !== "CLOSED" && (showCancelled || d.status !== "CANCELLED"),
  );
  if (
    !deals.length &&
    !since &&
    !showCancelled &&
    !state.deals.some((d) => d.status === "CANCELLED")
  )
    return (
      <section className="panel empty">
        <CheckCircle2 size={32} className="mx-auto text-muted-foreground" />
        <h2>
          {closed
            ? "История начинается с первой сделки"
            : "Текущих сделок пока нет"}
        </h2>
        <p>
          {closed
            ? "Здесь будут только закрытые сделки с подтверждённой себестоимостью, продажами и расходами."
            : "Выбранные закупки появятся здесь вместе с резервом, маршрутом и результатами сверки."}
        </p>
      </section>
    );
  return (
    <div className="space-y-4">
      {closed ? (
        <label className="caption">
          Сделки, созданные начиная с{" "}
          <input
            aria-label="Период закрытых сделок"
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
          />
        </label>
      ) : (
        <label className="caption">
          <input
            type="checkbox"
            checked={showCancelled}
            onChange={(e) => setShowCancelled(e.target.checked)}
          />{" "}
          Показать отменённые
        </label>
      )}
      {closed && (
        <div className="panel">
          Подтверждённая прибыль за всё время:{" "}
          <strong className="numeric">
            {money(
              deals
                .reduce(
                  (sum, d) => sum.plus(d.result.profit ?? 0),
                  new Decimal(0),
                )
                .toFixed(2),
              2,
            )}{" "}
            ISK
          </strong>
        </div>
      )}
      {deals.map((d) => {
        const first = d.forecast[0];
        const path = d.routeMode === "highsec" ? d.highsec : d.lowsec;
        const extra = state.opportunities.filter(
          (o) =>
            d.routeMode === "highsec" &&
            d.highsec?.slice(1, -1).includes(o.source.systemId) &&
            o.destination.systemId === first.destination.systemId,
        );
        return (
          <section className="panel" key={d.id}>
            <div className="flex justify-between items-start gap-4">
              <div>
                <div className="caption mb-2">
                  {d.parentId
                    ? "Дополнительная сделка · независимый учёт"
                    : "Торговая сделка"}{" "}
                  · {new Date(d.createdAt).toLocaleString("ru-RU")}
                </div>
                <h2 className="text-base flex items-center gap-2">
                  <MapPin size={16} />
                  {first.source.name.split(" - ")[0]}
                  <ArrowRight size={14} />
                  {first.destination.name.split(" - ")[0]}
                </h2>
                <p className="caption mt-2">
                  {d.forecast
                    .map((o) => `${o.type.name} × ${money(String(o.quantity))}`)
                    .join(" · ")}
                </p>
              </div>
              <span className="badge">
                {d.result.ready && d.status !== "CLOSED"
                  ? "Готово к закрытию"
                  : (labels[d.status] ?? d.status)}
              </span>
            </div>
            <div className="cart-summary">
              <span>
                Закупка по прогнозу
                <strong>
                  {money(
                    d.forecast
                      .reduce(
                        (s, o) => s.plus(o.purchase.total),
                        new Decimal(0),
                      )
                      .toFixed(2),
                  )}{" "}
                  ISK
                </strong>
              </span>
              <span>
                Куплено / продано
                <strong>
                  {d.result.purchased} / {d.result.sold}
                </strong>
              </span>
              <span>
                Остаток<strong>{d.result.remaining} шт.</strong>
              </span>
              <span>
                Поступило после налога
                <strong>{money(d.result.netProceeds, 2)} ISK</strong>
                {d.result.netProceeds === null && "Ожидает сверки продажи"}
              </span>
              <span>
                Фактическая прибыль
                <strong className={signClass(d.result.profit)}>
                  {money(d.result.profit, 2)} ISK
                </strong>
                {d.result.profit === null
                  ? "Ожидает подтверждения расходов"
                  : "ROI " + roi(d.result.roi)}
              </span>
            </div>
            <div className="actions">
              <Button
                variant="outline"
                onClick={() => setExpanded(expanded === d.id ? null : d.id)}
              >
                <ChevronDown size={15} />
                Маршрут и подробности
              </Button>
              {!closed && d.status !== "CANCELLED" && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void request({ kind: "deal.reconcile", id: d.id })
                  }
                >
                  ПРОДАЛ
                </Button>
              )}
              {d.status === "SELECTED" && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void request({ kind: "deal.cancel", id: d.id })
                  }
                >
                  Отменить закупку
                </Button>
              )}
            </div>
            {expanded === d.id && (
              <div className="border-t border-border mt-5 pt-5 space-y-4">
                <p className="text-sm">
                  {first.source.name}
                  <br />→ {first.destination.name}
                </p>
                <div className="actions">
                  <Button
                    variant={d.routeMode === "highsec" ? "default" : "outline"}
                    onClick={() =>
                      void request({
                        kind: "deal.route",
                        id: d.id,
                        mode: "highsec",
                      })
                    }
                  >
                    Только хайсек ·{" "}
                    {d.highsec ? d.highsec.length - 1 : "нет пути"}
                  </Button>
                  <Button
                    variant={d.routeMode === "lowsec" ? "default" : "outline"}
                    onClick={() =>
                      void request({
                        kind: "deal.route",
                        id: d.id,
                        mode: "lowsec",
                      })
                    }
                  >
                    Кратчайший с лоусеками ·{" "}
                    {d.lowsec ? d.lowsec.length - 1 : "нет пути"}
                  </Button>
                </div>
                <p className="caption">
                  {path
                    ? path.map((id) => state.systemNames[id] ?? id).join(" → ")
                    : "Маршрут невозможен в выбранном режиме. Нули и временные пути не используются."}
                </p>
                {!closed && (
                  <div>
                    <h3 className="font-medium text-sm">
                      Дополнительные закупки по пути
                    </h3>
                    {extra.length ? (
                      extra.map((o) => (
                        <div key={o.id} className="extra-row">
                          <div className="text-sm">
                            {o.type.name} · {o.source.name}
                            <div className="caption">
                              Продажа: {o.destination.name} · отдельная сделка
                            </div>
                          </div>
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              void request({
                                kind: "deal.accept",
                                id: crypto.randomUUID(),
                                items: [{ id: o.id, quantity: o.quantity }],
                                parentId: d.id,
                              })
                            }
                          >
                            Взять дополнительную сделку
                          </Button>
                        </div>
                      ))
                    ) : (
                      <p className="caption mt-2">
                        {d.routeMode === "lowsec"
                          ? "Допзакупки показываются только на хайсек-маршруте."
                          : "Подходящих закупок в промежуточных системах маршрута нет."}
                      </p>
                    )}
                  </div>
                )}
                <ReviewPanel
                  state={state}
                  deal={d}
                  request={request}
                  busy={busy}
                />
                <details>
                  <summary className="text-sm">
                    История событий и сверки
                  </summary>
                  {d.events.map((e, i) => (
                    <p className="caption mt-2" key={i}>
                      {new Date(e.at).toLocaleString("ru-RU")} · {e.kind} ·{" "}
                      {e.payload}
                    </p>
                  ))}
                </details>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
