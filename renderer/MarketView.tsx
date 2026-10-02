import { useEffect, useMemo, useRef, useState } from "react";
import { useTable } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./components/ui/dialog";
import {
  ShoppingBasket,
  ArrowUpRight,
  RefreshCw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { AppState, AppRequest, Settings } from "../shared/contracts/app";
import type { Opportunity } from "../engine/market/opportunities";
import { money, roi, signClass } from "./lib/format";
export type Request = (r: AppRequest) => Promise<AppState | undefined>;
export function MarketView({
  state,
  request,
  busy,
}: {
  state: AppState;
  request: Request;
  busy: boolean;
}) {
  const [rows, setRows] = useState(state.opportunities),
    [chosen, setChosen] = useState<Opportunity | null>(null),
    [quantity, setQuantity] = useState("1"),
    [cart, setCart] = useState<{ id: string; quantity: number }[]>([]),
    [filters, setFilters] = useState(false),
    [acceptId, setAcceptId] = useState(() => crypto.randomUUID()),
    [message, setMessage] = useState("");
  const parent = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (rows.length === 0 && state.opportunities.length)
      setRows(state.opportunities);
  }, [state.opportunities, rows.length]);
  const currentIds = useMemo(
    () => new Set(state.opportunities.map((o) => o.id)),
    [state.opportunities],
  );
  const columns = useMemo(
    () => [{ id: "type", accessorFn: (o: Opportunity) => o.type.name }],
    [],
  );
  const table = useTable({ data: rows, columns, features: {} });
  const model = table.getRowModel().rows;
  const virtual = useVirtualizer({
    count: model.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 106,
    overscan: 8,
  });
  const changed =
    rows.map((o) => o.id + o.quantity + o.sell.profit).join("|") !==
    state.opportunities.map((o) => o.id + o.quantity + o.sell.profit).join("|");
  async function settings(patch: Partial<Settings>) {
    const s = await request({
      kind: "settings.save",
      value: { ...state.settings, ...patch },
    });
    if (s) setRows(s.opportunities);
  }
  async function show(o: Opportunity) {
    setChosen(o);
    setQuantity(String(o.quantity));
    await request({ kind: "quote", id: o.id, quantity: o.quantity });
  }
  async function copyName(name: string) {
    try {
      await request({ kind: "clipboard.copy", text: name });
      setMessage(`Скопировано: ${name}`);
    } catch (error) {
      setMessage(`Не удалось скопировать название: ${String(error)}`);
    }
  }
  const preview = state.preview?.id === chosen?.id ? state.preview : chosen;
  async function add() {
    if (!chosen || !preview) return;
    const next = [
      ...cart.filter((x) => x.id !== chosen.id),
      { id: chosen.id, quantity: preview.quantity },
    ];
    const s = await request({ kind: "basket.preview", items: next });
    if (s) {
      setCart(next);
      setChosen(null);
      setAcceptId(crypto.randomUUID());
    }
  }
  return (
    <>
      <div className="market-toolbar">
        <div className="actions">
          <Button
            variant="secondary"
            onClick={() => void settings({ sort: "buy", roiEnabled: false })}
          >
            Быстрый оборот
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              void settings({ sort: "best", roiEnabled: true, minROI: 30 })
            }
          >
            Высокий ROI
          </Button>
          <Button
            variant="secondary"
            onClick={() => void settings({ sort: "best", roiEnabled: false })}
          >
            Крупная прибыль
          </Button>
          <Button variant="ghost" onClick={() => setFilters(!filters)}>
            <SlidersHorizontal size={15} />
            Все фильтры
          </Button>
        </div>
        <Button
          variant="outline"
          disabled={busy || state.demo}
          onClick={() => void request({ kind: "market.sync" })}
        >
          <RefreshCw size={14} />
          Сканировать
        </Button>
      </div>
      <div className="caption mt-3 mb-5">
        {rows.length} предложений · прибыль ≥ {money(state.settings.minProfit)}{" "}
        ISK · ROI{" "}
        {state.settings.roiEnabled
          ? "≥ " + state.settings.minROI + "%"
          : "выключен"}{" "}
        · сортировка:{" "}
        {state.settings.sort === "buy"
          ? "buy"
          : state.settings.sort === "sell"
            ? "sell"
            : "лучший результат"}{" "}
        · лимит товара {state.settings.maxTypeShare * 100}%
      </div>
      {filters && (
        <div className="panel filters">
          <label className="field">
            Прибыль позиции, ISK
            <Input
              aria-label="Фильтр прибыль"
              defaultValue={state.settings.minProfit}
              onBlur={(e) => void settings({ minProfit: e.target.value })}
            />
          </label>
          <label className="field">
            ROI, %
            <Input
              aria-label="Фильтр ROI"
              type="number"
              defaultValue={state.settings.minROI}
              onBlur={(e) =>
                void settings({
                  minROI: Number(e.target.value),
                  roiEnabled: true,
                })
              }
            />
          </label>
          <label className="field">
            Прибыль рейса, ISK
            <Input
              defaultValue={state.settings.minTripProfit}
              onBlur={(e) => void settings({ minTripProfit: e.target.value })}
            />
          </label>
          <label className="field">
            Лимит одного типа, %
            <Input
              type="number"
              min="1"
              max="100"
              defaultValue={state.settings.maxTypeShare * 100}
              onBlur={(e) =>
                void settings({ maxTypeShare: Number(e.target.value) / 100 })
              }
            />
          </label>
          <div className="actions">
            <Button
              variant="outline"
              onClick={() => void settings({ sort: "buy" })}
            >
              По buy
            </Button>
            <Button
              variant="outline"
              onClick={() => void settings({ sort: "sell" })}
            >
              По sell
            </Button>
            <Button
              variant="ghost"
              onClick={() => void settings({ roiEnabled: false })}
            >
              Выключить ROI
            </Button>
          </div>
        </div>
      )}
      <section className="market-panel">
        <div className="table-intro">
          <span>
            Прибыль за партию после налогов и комиссий · перевозка не включена
          </span>
          {changed && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRows(state.opportunities)}
            >
              Есть обновления
            </Button>
          )}
        </div>
        <div className="market-row table-header" role="row">
          <span>Товар / направление</span>
          <span className="numeric">Партия / объём</span>
          <span className="numeric">Закупка, ISK</span>
          <span className="numeric">Прибыль сразу, ISK</span>
          <span className="numeric">Прибыль sell, ISK</span>
          <span>Спрос</span>
        </div>
        <div
          ref={parent}
          className="virtual-table"
          role="table"
          aria-label="Торговые возможности"
        >
          <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
            {virtual.getVirtualItems().map((v) => {
              const o = model[v.index].original;
              return (
                <button
                  className="market-row data-row"
                  disabled={busy || !currentIds.has(o.id)}
                  key={o.id}
                  onClick={() => void show(o)}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: v.size,
                    transform: `translateY(${v.start}px)`,
                  }}
                  aria-label={`${o.type.name}: ${o.source.name} → ${o.destination.name}`}
                >
                  <span>
                    <strong
                      className="cursor-copy hover:underline"
                      title="Нажмите, чтобы скопировать название"
                      onClick={(event) => {
                        event.stopPropagation();
                        void copyName(o.type.name);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          void copyName(o.type.name);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      {o.type.name}
                    </strong>
                    <small>
                      {o.source.name.split(" - ")[0]} <ArrowUpRight size={11} />{" "}
                      {o.destination.name.split(" - ")[0]}
                    </small>
                  </span>
                  <span className="numeric">
                    {money(String(o.quantity))} шт.
                    <small>{money(o.volume, 2)} м³</small>
                  </span>
                  <span className="numeric">
                    {money(o.purchase.total)}
                    <small>
                      от {money(o.purchase.fills[0]?.price ?? null, 2)} ISK/шт.
                    </small>
                  </span>
                  <span className={"numeric " + signClass(o.buy.result.profit)}>
                    {money(o.buy.result.profit)}
                    <small>
                      ROI{" "}
                      {o.buy.fullROI === null
                        ? `${o.buy.sale.filled}/${o.quantity} · частично`
                        : roi(o.buy.fullROI)}{" "}
                      {o.rankedBy === "buy" ? "↑" : ""}
                    </small>
                  </span>
                  <span
                    className={
                      "numeric " +
                      signClass(
                        o.liquidity.sellQuantity >= o.quantity
                          ? o.sell.profit
                          : null,
                      )
                    }
                  >
                    {o.liquidity.sellQuantity >= o.quantity
                      ? money(o.sell.profit)
                      : "—"}
                    <small>
                      {o.liquidity.sellQuantity >= o.quantity
                        ? `ROI ${roi(o.sell.roi)} · прогноз`
                        : "Недостаточно спроса"}{" "}
                      {o.rankedBy === "sell" ? "↑" : ""}
                    </small>
                    <small>
                      Sell от {money(o.destinationAsks?.[0]?.price ?? null, 2)}{" "}
                      / шт.
                    </small>
                  </span>
                  <span className="caption">
                    {o.buy.fullROI !== null
                      ? "Buy покрывает 100%"
                      : o.liquidity.reasons[0]}
                    <small>
                      {o.liquidity.sellQuantity >= o.quantity
                        ? "Sell: прогноз на партию"
                        : o.liquidity.sellQuantity > 0
                          ? `Sell: до ${money(String(o.liquidity.sellQuantity))} шт.`
                          : "Sell: мало данных"}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
          {!rows.length && (
            <div className="empty">
              <h2>
                {state.market.status.startsWith("Расчёт")
                  ? "Рассчитываем торговые возможности…"
                  : "Подходящих предложений пока нет"}
              </h2>
              <p>
                Проверьте бюджет, свежесть рынка и профиль продавца. Фильтры
                могут исключать все доступные партии.
              </p>
            </div>
          )}
        </div>
      </section>
      <p className="caption mt-3">
        SDE {state.market.version} · {state.market.systems} систем ·{" "}
        {state.market.stations} станций · регионы {state.market.loadedRegions}/
        {state.market.regions} · история {state.market.historyPairs}{" "}
        товар/регион. {state.market.status}
      </p>
      <details className="panel mt-5">
        <summary>Мои sell-ордера · {state.ownSellOrders?.length ?? 0}</summary>
        <p className="caption my-3">
          Активные ордера подключённого продавца по последней сверке кошельков.
          Личные продажи вне приложения также включены.
        </p>
        {state.ownSellOrders?.length ? (
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="owned-orders" aria-label="Мои sell-ордера">
              <thead>
                <tr>
                  <th>Товар / станция</th>
                  <th>Цена, ISK/шт.</th>
                  <th>Осталось, шт.</th>
                  <th>Обновлено</th>
                </tr>
              </thead>
              <tbody>
                {state.ownSellOrders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      {order.type}
                      <small className="block caption">
                        {order.station} · {order.character}
                      </small>
                    </td>
                    <td>{money(order.price, 2)}</td>
                    <td>{money(String(order.remaining))}</td>
                    <td>{new Date(order.updatedAt).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>
            Активные sell-ордера не загружены или отсутствуют. Нажмите «Сверить
            кошельки» в настройках.
          </p>
        )}
      </details>
      {cart.length > 0 && state.basket && (
        <section className="panel mt-5">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="font-medium flex gap-2">
                <ShoppingBasket size={18} />
                Корзина · {state.basket.totals.positions} поз.
              </h2>
              <p className="caption mt-2">
                {state.basket.items[0].source.name} →{" "}
                {state.basket.items[0].destination.name}
              </p>
            </div>
            <Button
              variant="ghost"
              aria-label="Очистить корзину"
              onClick={() => {
                setCart([]);
                void request({ kind: "basket.preview", items: [] });
              }}
            >
              <X size={16} />
            </Button>
          </div>
          <div className="cart-summary">
            <span>
              Закупка<strong>{money(state.basket.totals.cost)} ISK</strong>
            </span>
            <span>
              Объём<strong>{money(state.basket.totals.volume, 2)} м³</strong>
            </span>
            <span>
              Buy {state.basket.totals.buyComplete ? "" : "частично"}
              <strong className={signClass(state.basket.totals.buyProfit)}>
                {money(state.basket.totals.buyProfit)}
              </strong>
            </span>
            <span>
              Sell · прогноз
              <strong className={signClass(state.basket.totals.sellProfit)}>
                {money(state.basket.totals.sellProfit)}
              </strong>
            </span>
          </div>
          <div className="actions">
            <Button
              disabled={busy}
              onClick={async () => {
                const s = await request({
                  kind: "deal.accept",
                  id: acceptId,
                  items: cart,
                });
                if (s) {
                  setCart([]);
                  setMessage(
                    "Сделка добавлена в текущие. Бюджет зарезервирован.",
                  );
                }
              }}
            >
              Взять сделку
            </Button>
            <Button
              variant="outline"
              onClick={() => void request({ kind: "basket.copy", items: cart })}
            >
              Копировать для мультибая
            </Button>
            <span className="caption">
              Порог рейса: {money(state.settings.minTripProfit)} ISK.
              Проверяется при принятии.
            </span>
          </div>
        </section>
      )}
      {message && (
        <p role="status" className="positive mt-3">
          {message}
        </p>
      )}
      <Dialog
        open={!!chosen}
        onOpenChange={(open) => {
          if (!open) setChosen(null);
        }}
      >
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{chosen?.type.name}</DialogTitle>
            <DialogDescription>
              Расчёт партии, комиссии и основания оценки спроса
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <>
              <p className="text-sm">
                {preview.source.name}
                <br />→ {preview.destination.name}
              </p>
              <section
                className="panel space-y-2"
                aria-label="Sell-ордера в месте продажи"
              >
                <h3>Sell-ордера в месте продажи</h3>
                <p className="caption">
                  Текущие предложения продавцов на станции назначения. Это не
                  исполненные продажи.
                </p>
                {preview.destinationAsks?.length ? (
                  <div className="order-depth">
                    <div>
                      <strong>Цена, ISK/шт.</strong>
                      <strong>Осталось, шт.</strong>
                    </div>
                    {preview.destinationAsks.slice(0, 10).map((level) => (
                      <div key={level.id}>
                        <span>{money(level.price, 2)}</span>
                        <span>{money(String(level.quantity))}</span>
                      </div>
                    ))}
                    <p className="caption">
                      Показаны первые{" "}
                      {Math.min(10, preview.destinationAsks.length)} из{" "}
                      {preview.destinationAsks.length} ордеров.
                    </p>
                  </div>
                ) : (
                  <p>Sell-ордеров на этой станции в снимке нет.</p>
                )}
                <p>
                  Цена вашего ордера для расчёта:{" "}
                  <strong>{money(preview.sellPrice, 2)} ISK/шт.</strong>
                </p>
              </section>
              <label className="field">
                Количество в партии
                <Input
                  aria-label="Количество в партии"
                  type="number"
                  min="1"
                  max={preview.maximum}
                  value={quantity}
                  onChange={(e) => {
                    setQuantity(e.target.value);
                    const q = Number(e.target.value);
                    if (Number.isSafeInteger(q) && q > 0)
                      void request({
                        kind: "quote",
                        id: preview.id,
                        quantity: q,
                      });
                  }}
                />
              </label>
              <div className="cart-summary">
                <span>
                  Закупка
                  <strong data-testid="quote-cost">
                    {money(preview.purchase.total, 2)} ISK
                  </strong>
                </span>
                <span>
                  Объём
                  <strong data-testid="quote-volume">
                    {money(preview.volume, 2)} м³
                  </strong>
                </span>
                <span>
                  Продать сразу
                  <strong className={signClass(preview.buy.result.profit)}>
                    {money(preview.buy.result.profit, 2)}
                  </strong>
                  {preview.buy.sale.filled}/{preview.quantity} шт. · ROI{" "}
                  {roi(preview.buy.fullROI)}
                </span>
                <span>
                  Выставить ордер
                  <strong className={signClass(preview.sell.profit)}>
                    {money(preview.sell.profit, 2)}
                  </strong>
                  ROI {roi(preview.sell.roi)} · прогноз
                </span>
              </div>
              <div className="text-sm space-y-2">
                <p>
                  Налог продажи: {money(preview.sell.tax, 2)} · выставление:{" "}
                  {money(preview.sell.listing, 2)} · изменения цены:{" "}
                  {money(preview.sell.relisting, 2)} ISK
                </p>
                <p>
                  Стресс −5%:{" "}
                  <span className={signClass(preview.stress5.profit)}>
                    {money(preview.stress5.profit)}
                  </span>{" "}
                  · −10%:{" "}
                  <span className={signClass(preview.stress10.profit)}>
                    {money(preview.stress10.profit)}
                  </span>{" "}
                  ISK
                </p>
                <p className="caption">
                  ROI = чистая прибыль / (закупка + размещение + изменения).
                  Перевозка не входит в v1.
                </p>
                <p>{preview.liquidity.reasons.join(" · ")}</p>
                <p className="caption">
                  Регион {preview.destination.regionId} · медиана дневного
                  оборота{" "}
                  {preview.liquidity.history?.medianDailyVolume ?? "неизвестна"}{" "}
                  · наблюдаемых дней{" "}
                  {preview.liquidity.history?.observedDays ?? 0}/30. Это не
                  оборот станции.
                </p>
                <details>
                  <summary>Региональная история 7 / 30 / 90 дней</summary>
                  {Object.entries(preview.historyWindows ?? {}).map(
                    ([window, h]) => (
                      <p key={window}>
                        {window === "week"
                          ? "7"
                          : window === "month"
                            ? "30"
                            : "90"}{" "}
                        дней:{" "}
                        {h
                          ? `данные за ${h.observedDays} дней, пропуски ${h.missingDays}, медиана объёма ${h.medianDailyVolume}, цены ${h.medianDailyPrice} ISK`
                          : "нет данных"}
                      </p>
                    ),
                  )}
                </details>
                <details>
                  <summary>Использованные уровни закупки</summary>
                  {preview.purchase.fills.map((f) => (
                    <p key={f.id} className="numeric">
                      {money(String(f.quantity))} × {money(f.price, 2)} ={" "}
                      {money(f.value, 2)} ISK
                    </p>
                  ))}
                </details>
              </div>
              <Button
                disabled={busy || Number(quantity) !== preview.quantity}
                onClick={() => void add()}
              >
                Добавить в корзину
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
