import { randomUUID } from "node:crypto";
import type { Store } from "../../db/store";
import { Portfolio } from "./repository";
import { fill } from "../market/depth";
import { D, sum, isk } from "../accounting/money";
import {
  basketTotals,
  type Opportunity,
  calculateOpportunity,
} from "../market/opportunities";
import { Graph, type RouteMode, isAdditional } from "../routes/graph";
import type { StaticData } from "../market/static-data";
export interface DealView {
  id: string;
  source: string;
  destination: string;
  status: string;
  sellerId: string;
  createdAt: string;
  parentId: string | null;
  routeMode: RouteMode;
  forecast: Opportunity[];
  highsec: string[] | null;
  lowsec: string[] | null;
  events: { at: string; kind: string; payload: string }[];
  result: {
    profit: string | null;
    roi: string | null;
    cost: string;
    revenue: string;
    fees: string;
    sold: number;
    purchased: number;
    remaining: number;
    ready: boolean;
  };
}
export class Trades {
  constructor(
    private store: Store,
    private data: () => StaticData | null,
  ) {}
  reservedDepth() {
    const used = new Map<string, number>();
    for (const row of this.store.sql
      .prepare(
        "SELECT id,forecast FROM deals WHERE status NOT IN ('CLOSED','CANCELLED')",
      )
      .all() as { id: string; forecast: string }[]) {
      for (const o of JSON.parse(row.forecast) as Opportunity[]) {
        const purchased = (
          this.store.sql
            .prepare(
              "SELECT coalesce(sum(quantity),0) n FROM purchase_lots WHERE deal_id=? AND type_id=?",
            )
            .get(row.id, o.type.id) as { n: number }
        ).n;
        const sold = (
          this.store.sql
            .prepare(
              "SELECT coalesce(sum(a.quantity),0) n FROM sale_allocations a JOIN purchase_lots l ON l.id=a.lot_id WHERE l.deal_id=? AND l.type_id=?",
            )
            .get(row.id, o.type.id) as { n: number }
        ).n;
        for (const f of fill(
          o.supply,
          Math.max(0, o.quantity - purchased),
          "buy",
        ).fills)
          used.set(f.id, (used.get(f.id) ?? 0) + f.quantity);
        if (o.rankedBy === "buy")
          for (const f of fill(o.demand, Math.max(0, o.quantity - sold), "sell")
            .fills)
            used.set(f.id, (used.get(f.id) ?? 0) + f.quantity);
      }
    }
    return used;
  }
  exposures() {
    const map = new Map<string, string>();
    for (const row of this.store.sql
      .prepare(
        "SELECT type_id,remaining,unit_cost FROM purchase_lots WHERE remaining>0",
      )
      .all() as { type_id: string; remaining: number; unit_cost: string }[])
      map.set(
        row.type_id,
        isk(
          D(map.get(row.type_id) ?? 0).plus(
            D(row.unit_cost).mul(row.remaining),
          ),
        ),
      );
    for (const row of this.store.sql
      .prepare(
        "SELECT type_id,amount FROM budget_reservations WHERE paid=0 AND kind='purchase'",
      )
      .all() as { type_id: string; amount: string }[])
      map.set(row.type_id, isk(D(map.get(row.type_id) ?? 0).plus(row.amount)));
    return map;
  }
  accept(id: string, items: Opportunity[], parentId?: string) {
    return this.store.sql.transaction(() => {
      if (this.store.sql.prepare("SELECT id FROM deals WHERE id=?").get(id))
        return id;
      if (!items.length) throw Error("Корзина пуста");
      const portfolio = new Portfolio(this.store);
      const seller = portfolio.characters().find((c) => c.isSeller);
      if (!seller) throw Error("Не выбран основной продавец");
      if (
        portfolio.characters().length !== 3 ||
        portfolio.characters().some((c) => c.status !== "connected")
      )
        throw Error("Сначала согласуйте все три кошелька");
      const totals = basketTotals(items);
      const fees = sum(
        items.filter((o) => o.rankedBy === "sell").map((o) => o.sell.listing),
      );
      if (D(totals.cost).plus(fees).gt(portfolio.currentBudget().available))
        throw Error("Недостаточно доступного бюджета");
      const exposures = this.exposures();
      const byType = new Map<string, string>();
      for (const o of items) {
        byType.set(
          o.type.id,
          isk(D(byType.get(o.type.id) ?? 0).plus(o.purchase.total)),
        );
        if (o.quantity > o.maximum || o.purchase.filled !== o.quantity)
          throw Error("Партия превышает доступную глубину");
      }
      for (const [type, cost] of byType)
        if (
          D(cost)
            .plus(exposures.get(type) ?? 0)
            .gt(
              D(portfolio.currentBudget().pool).mul(
                this.store.getSettings().maxTypeShare,
              ),
            )
        )
          throw Error("Превышен лимит одного товара");
      const settings = this.store.getSettings();
      for (const o of items) {
        const result = o.rankedBy === "buy" ? o.buy.result : o.sell;
        const roi = o.rankedBy === "buy" ? o.buy.fullROI : o.sell.roi;
        if (
          roi === null ||
          D(result.profit).lt(settings.minProfit) ||
          (settings.roiEnabled && D(roi).lt(D(settings.minROI).div(100)))
        )
          throw Error(
            "Выбранное количество больше не проходит фильтры прибыли/ROI",
          );
      }
      const routeProfit = sum(
        items.map((o) =>
          o.rankedBy === "buy" ? o.buy.result.profit : o.sell.profit,
        ),
      );
      if (routeProfit.lt(settings.minTripProfit))
        throw Error("Не достигнут минимальный профит рейса");
      if (parentId) {
        const parent = this.list().find((d) => d.id === parentId);
        if (
          !parent ||
          !isAdditional(
            parent.highsec,
            parent.routeMode,
            new Set(this.data()?.zone ?? []),
            items[0].source.systemId,
            items[0].destination.systemId,
          )
        )
          throw Error(
            "Допзакупка не находится на хайсек-маршруте к системе назначения",
          );
      }
      const now = new Date().toISOString();
      this.store.sql
        .prepare("INSERT INTO deals VALUES (?,?,?,?,?,?,?,?,?)")
        .run(
          id,
          items[0].source.id,
          items[0].destination.id,
          "SELECTED",
          seller.id,
          JSON.stringify(items),
          now,
          parentId ?? null,
          "highsec",
        );
      for (const item of items) {
        this.store.sql
          .prepare("INSERT INTO deal_lines VALUES (?,?,?,?,?)")
          .run(randomUUID(), id, item.type.id, item.quantity, item.type.name);
        this.store.sql
          .prepare("INSERT INTO budget_reservations VALUES (?,?,?,?,?,0)")
          .run(
            id + ":" + item.type.id + ":purchase",
            id,
            item.type.id,
            "purchase",
            item.purchase.total,
          );
        if (item.rankedBy === "sell")
          this.store.sql
            .prepare("INSERT INTO budget_reservations VALUES (?,?,?,?,?,0)")
            .run(
              id + ":" + item.type.id + ":fee",
              id,
              item.type.id,
              "fee",
              item.sell.listing,
            );
      }
      this.event(id, "selected", {
        forecastAt: items[0].at,
        sellerId: seller.id,
      });
      return id;
    })();
  }
  cancel(id: string) {
    this.store.sql.transaction(() => {
      const lot = this.store.sql
        .prepare("SELECT id FROM purchase_lots WHERE deal_id=?")
        .get(id);
      if (lot) throw Error("Купленную партию нельзя отменить как некупленную");
      const d = this.store.sql
        .prepare("SELECT status FROM deals WHERE id=?")
        .get(id) as { status: string } | undefined;
      if (!d || d.status === "CLOSED")
        throw Error("Сделка не найдена или закрыта");
      this.store.sql
        .prepare("UPDATE deals SET status='CANCELLED' WHERE id=?")
        .run(id);
      this.store.sql
        .prepare("DELETE FROM budget_reservations WHERE deal_id=?")
        .run(id);
      this.event(id, "cancelled", {});
    })();
  }
  route(id: string, mode: RouteMode) {
    this.store.sql
      .prepare("UPDATE deals SET route_mode=? WHERE id=?")
      .run(mode, id);
    this.event(id, "route.changed", { mode });
  }
  event(id: string, kind: string, payload: unknown) {
    this.store.sql
      .prepare("INSERT INTO deal_events VALUES (?,?,?,?,?)")
      .run(
        randomUUID(),
        id,
        new Date().toISOString(),
        kind,
        JSON.stringify(payload),
      );
  }
  list(): DealView[] {
    const graph = this.data() ? new Graph(this.data()!.systems) : null;
    return (
      this.store.sql
        .prepare("SELECT * FROM deals ORDER BY created_at DESC,rowid DESC")
        .all() as {
        id: string;
        source: string;
        destination: string;
        status: string;
        seller_id: string;
        created_at: string;
        parent_id: string | null;
        route_mode: RouteMode;
        forecast: string;
      }[]
    ).map((d) => {
      const forecast = JSON.parse(d.forecast) as Opportunity[];
      const from = forecast[0]?.source.systemId,
        to = forecast[0]?.destination.systemId;
      const lots = this.store.sql
        .prepare("SELECT quantity,remaining FROM purchase_lots WHERE deal_id=?")
        .all(d.id) as { quantity: number; remaining: number }[];
      const sales = this.store.sql
        .prepare(
          "SELECT a.* FROM sale_allocations a JOIN purchase_lots l ON l.id=a.lot_id WHERE l.deal_id=?",
        )
        .all(d.id) as {
        quantity: number;
        cost: string;
        proceeds: string;
        tax: string | null;
      }[];
      const fees = this.store.sql
        .prepare("SELECT amount FROM fee_allocations WHERE deal_id=?")
        .all(d.id) as { amount: string }[];
      const cost = sum(sales.map((s) => s.cost)),
        revenue = sum(sales.map((s) => s.proceeds)),
        fee = sum(fees.map((f) => f.amount));
      const purchased = lots.reduce((s, l) => s + l.quantity, 0),
        remaining = lots.reduce((s, l) => s + l.remaining, 0),
        sold = sales.reduce((s, l) => s + l.quantity, 0);
      const exact = !!sales.length && sales.every((s) => s.tax !== null);
      return {
        id: d.id,
        source: d.source,
        destination: d.destination,
        status: d.status,
        sellerId: d.seller_id,
        createdAt: d.created_at,
        parentId: d.parent_id,
        routeMode: d.route_mode,
        forecast,
        highsec:
          from && to ? (graph?.route(from, to, "highsec") ?? null) : null,
        lowsec: from && to ? (graph?.route(from, to, "lowsec") ?? null) : null,
        events: this.store.sql
          .prepare(
            "SELECT at,kind,payload FROM deal_events WHERE deal_id=? ORDER BY at",
          )
          .all(d.id) as { at: string; kind: string; payload: string }[],
        result: {
          roi:
            exact && cost.plus(fee).gt(0)
              ? revenue.minus(cost).minus(fee).div(cost.plus(fee)).toFixed(8)
              : null,
          cost: isk(cost),
          revenue: isk(revenue),
          fees: isk(fee),
          profit: exact
            ? isk(
                revenue
                  .minus(cost)
                  .minus(fee)
                  .minus(sum(sales.map((s) => s.tax ?? 0))),
              )
            : null,
          sold,
          purchased,
          remaining,
          ready:
            purchased === forecast.reduce((s, o) => s + o.quantity, 0) &&
            purchased > 0 &&
            remaining === 0 &&
            sold === purchased,
        },
      };
    });
  }
}
export function selectQuantity(opportunity: Opportunity, quantity: number) {
  if (
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    quantity > opportunity.maximum
  )
    throw Error("Количество вне доступной партии");
  return calculateOpportunity(opportunity, quantity);
}
