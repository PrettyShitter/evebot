import type { Order, HistoryDay } from "../../shared/contracts/esi";
import type { StaticData, Station, ItemType } from "./static-data";
import { Graph } from "../routes/graph";
import { D, Decimal, isk, sum } from "../accounting/money";
import {
  fill,
  quote,
  profitableQuantity,
  pnl,
  type Level,
  cargo,
} from "./depth";
import {
  rates,
  listingFee,
  relistFee,
  tickBelow,
  FORMULA_VERSION,
  type SellerProfile,
} from "./fees";
import { summarize } from "../history/history";
import { liquidity } from "../liquidity/model";
import type { Settings } from "../../shared/contracts/app";
export interface Opportunity {
  id: string;
  type: ItemType;
  source: Station;
  destination: Station;
  quantity: number;
  maximum: number;
  supply: Level[];
  demand: Level[];
  purchase: ReturnType<typeof fill>;
  buy: ReturnType<typeof quote>;
  sell: ReturnType<typeof pnl>;
  sellPrice: string;
  destinationAsks?: Level[];
  volume: string | null;
  liquidity: ReturnType<typeof liquidity>;
  historyWindows: {
    week: ReturnType<typeof summarize>;
    month: ReturnType<typeof summarize>;
    quarter: ReturnType<typeof summarize>;
  };
  feeRate: string;
  taxRate: string;
  relistDiscount: string;
  relistCount: number;
  rankedBy: "buy" | "sell";
  at: string;
  formulaVersion: string;
  features: {
    eventTime: string;
    availableAt: string;
    snapshotIds: string[];
    settings: Settings;
  };
  stress5: ReturnType<typeof pnl>;
  stress10: ReturnType<typeof pnl>;
}
export function calculateOpportunity(
  base: Omit<
    Opportunity,
    "purchase" | "buy" | "sell" | "volume" | "stress5" | "stress10"
  >,
  quantity: number,
): Opportunity {
  const purchase = fill(base.supply, quantity, "buy");
  const buy = quote(base.supply, base.demand, quantity, base.taxRate);
  const revenue = D(base.sellPrice).mul(quantity);
  const listing = listingFee(revenue.toFixed(), base.feeRate);
  const relisting = isk(
    D(
      relistFee(
        revenue.toFixed(),
        revenue.toFixed(),
        base.feeRate,
        base.relistDiscount,
      ),
    ).mul(base.relistCount),
  );
  const sell = pnl(
    purchase.total,
    revenue.toFixed(),
    base.taxRate,
    listing,
    relisting,
  );
  const stress = (mult: string) =>
    pnl(
      purchase.total,
      revenue.mul(mult).toFixed(),
      base.taxRate,
      listing,
      relisting,
    );
  return {
    ...base,
    quantity,
    purchase,
    buy,
    sell,
    volume: cargo([{ quantity, volume: base.type.volume }]),
    stress5: stress(".95"),
    stress10: stress(".90"),
  };
}
export interface ScanInputs {
  data: StaticData;
  orders: Order[];
  settings: Settings;
  available: string;
  pool: string;
  exposures: Map<string, string>;
  profile: (station: Station) => SellerProfile | null;
  history: (type: string, region: string) => HistoryDay[];
  local?: (
    type: string,
    station: string,
  ) => { observations: number; confirmedSales: number };
  at: string;
  snapshotIds: string[];
}
export function scanOpportunities(input: ScanInputs): Opportunity[] {
  const { data, orders, settings } = input;
  const graph = new Graph(data.systems),
    stations = new Map(data.stations.map((s) => [s.id, s])),
    types = new Map(data.types.map((t) => [t.id, t]));
  const asks = new Map<string, Map<string, Level[]>>(),
    bids = new Map<string, Map<string, Level[]>>();
  const reachCache = new Map<string, string[]>();
  const npcIds = new Set(data.npcStationIds ?? data.stations.map((s) => s.id));
  for (const o of orders) {
    if (!types.has(o.type_id) || o.volume_remain <= 0) continue;
    const level: Level = Object.freeze({
      id: o.order_id,
      price: o.price,
      quantity: o.volume_remain,
      minVolume: o.min_volume,
    });
    const index = o.is_buy_order ? bids : asks;
    let byLocation = index.get(o.type_id);
    if (!byLocation) {
      byLocation = new Map();
      index.set(o.type_id, byLocation);
    }
    if (!o.is_buy_order) {
      if (stations.has(o.location_id)) {
        const list = byLocation.get(o.location_id) ?? [];
        list.push(level);
        byLocation.set(o.location_id, list);
      }
      continue;
    }
    // NPC-origin market only. Player structures are outside v1, even if their buy range spans NPC stations.
    if (
      !(data.npcStationIds
        ? npcIds.has(o.location_id)
        : stations.has(o.location_id))
    )
      continue;
    const system = graph.systems.get(o.system_id);
    if (!system) continue;
    const key =
      o.system_id +
      ":" +
      o.range +
      ":" +
      (o.range === "station" ? o.location_id : "");
    let destinations = reachCache.get(key);
    if (!destinations) {
      const nearby =
        o.range === "region"
          ? null
          : o.range === "station" || o.range === "solarsystem"
            ? new Set([o.system_id])
            : graph.zone([o.system_id], Number(o.range));
      destinations = data.stations
        .filter(
          (s) =>
            s.regionId === system.regionId &&
            (o.range === "station"
              ? s.id === o.location_id
              : o.range === "region"
                ? true
                : nearby!.has(s.systemId)),
        )
        .map((s) => s.id);
      reachCache.set(key, destinations);
    }
    for (const station of destinations) {
      const list = byLocation.get(station) ?? [];
      list.push(level);
      byLocation.set(station, list);
    }
  }
  for (const index of [asks, bids])
    for (const locations of index.values())
      for (const levels of locations.values()) Object.freeze(levels);
  const histories = new Map<string, HistoryDay[]>();
  const profiles = new Map(data.stations.map((s) => [s.id, input.profile(s)]));
  const windows = new Map<string, Opportunity["historyWindows"]>();
  const result: Opportunity[] = [];
  const maxCargoVolume = D("100000");
  for (const [typeId, sources] of asks) {
    const type = types.get(typeId)!;
    // Do not recommend items with unknown/oversized packaged volume. Cap every
    // proposed lot as well, so a stack cannot exceed the hauling limit.
    if (
      !type.volume ||
      D(type.volume).lte(0) ||
      D(type.volume).gt(maxCargoVolume)
    )
      continue;
    const cargoLimit = maxCargoVolume.div(type.volume).floor().toNumber();
    if (!Number.isSafeInteger(cargoLimit) || cargoLimit < 1) continue;
    const typeBudget = Decimal.max(
      0,
      D(input.pool)
        .mul(settings.maxTypeShare)
        .minus(input.exposures.get(typeId) ?? 0),
    );
    const allowance = Decimal.min(input.available, typeBudget);
    if (allowance.lte(0)) continue;
    const destinations = new Set([
      ...sources.keys(),
      ...(bids.get(typeId)?.keys() ?? []),
    ]);
    const bestAsks = new Map(
      [...sources].map(([id, levels]) => [
        id,
        Decimal.min(...levels.map((l) => D(l.price))),
      ]),
    );
    const bestBids = new Map(
      [...(bids.get(typeId) ?? [])].map(([id, levels]) => [
        id,
        Decimal.max(...levels.map((l) => D(l.price))),
      ]),
    );
    const liquidities = new Map<string, ReturnType<typeof liquidity>>();
    const termsByDestination = new Map<
      string,
      {
        demand: Level[];
        targetAsks: Level[];
        bestBid: Decimal;
        bestAsk: Decimal;
        fee: ReturnType<typeof rates>;
        target: string;
        sellRate: Decimal;
      } | null
    >();
    const minimumReturn = D(1).plus(
      settings.roiEnabled ? String(settings.minROI / 100) : "0",
    );
    for (const [sourceId, supply] of sources) {
      const source = stations.get(sourceId)!;
      const lowest = bestAsks.get(sourceId)!;
      if (lowest.lte(0)) continue;
      for (const destinationId of destinations) {
        if (sourceId === destinationId) continue;
        const destination = stations.get(destinationId)!;
        let terms = termsByDestination.get(destinationId);
        if (terms === undefined) {
          const profile = profiles.get(destinationId);
          if (!profile) {
            termsByDestination.set(destinationId, null);
            continue;
          }
          const fee = rates(profile);
          const bestBid = bestBids.get(destinationId) ?? D(0);
          const bestAsk = bestAsks.get(destinationId) ?? D(0);
          const sellRate = fee.tax.plus(fee.broker).plus(
            D(1)
              .minus(fee.discount)
              .mul(fee.broker)
              .mul(settings.relistPerDay * 3),
          );
          terms = {
            demand: bids.get(typeId)?.get(destinationId) ?? [],
            targetAsks: sources.get(destinationId) ?? [],
            bestBid,
            bestAsk,
            fee,
            target: bestAsk.gt(0)
              ? tickBelow(bestAsk.toFixed())
              : bestBid.toFixed(),
            sellRate,
          };
          termsByDestination.set(destinationId, terms);
        }
        if (!terms) continue;
        const { demand, targetAsks, bestBid, fee, target, sellRate } =
          terms;
        const requiredNetPrice = lowest.mul(minimumReturn);
        const buyPossible = bestBid
          .mul(D(1).minus(fee.tax))
          .gte(requiredNetPrice);
        const sellPossible = D(target)
          .mul(D(1).minus(sellRate))
          .gte(requiredNetPrice);
        // Skip route pairs before history, liquidity, and depth calculations
        // unless at least one executable price can meet the configured ROI.
        if (!buyPossible && !sellPossible) continue;
        const buyQ = buyPossible
          ? profitableQuantity(
              supply,
              demand,
              allowance.toFixed(),
              fee.tax.toFixed(),
              settings.roiEnabled ? String(settings.minROI / 100) : "0",
            )
          : 0;
        if (!buyQ && !sellPossible) continue;
        const localBidQty = demand.reduce((s, l) => s + l.quantity, 0);
        const historyKey = typeId + ":" + destination.regionId;
        if (!histories.has(historyKey))
          histories.set(
            historyKey,
            input.history(typeId, destination.regionId),
          );
        const history = histories.get(historyKey)!;
        const l =
          liquidities.get(destinationId) ??
          liquidity(
            history,
            input.at,
            {
              bidQuantity: localBidQty,
              competitorQuantity: targetAsks
                .filter((a) => D(a.price).lte(target))
                .reduce((s, a) => s + a.quantity, 0),
              observations:
                input.local?.(typeId, destination.id).observations ?? 0,
              confirmedSales:
                input.local?.(typeId, destination.id).confirmedSales ?? 0,
            },
            target,
          );
        liquidities.set(destinationId, l);
        if (!windows.has(historyKey))
          windows.set(historyKey, {
            week: summarize(history, 7, input.at),
            month: summarize(history, 30, input.at),
            quarter: summarize(history, 90, input.at),
          });
        const sellQ =
          sellPossible && l.sellQuantity
            ? profitableQuantity(
                supply,
                [{ id: "forecast", price: target, quantity: l.sellQuantity }],
                allowance.toFixed(),
                sellRate.toFixed(),
                settings.roiEnabled ? String(settings.minROI / 100) : "0",
              )
            : 0;
        let quantity = Math.min(cargoLimit, Math.max(buyQ, sellQ));
        if (quantity <= 0) continue;
        const base = {
          id: [typeId, sourceId, destinationId].join(":"),
          type,
          source,
          destination,
          quantity,
          maximum: quantity,
          supply,
          demand,
          sellPrice: target,
          destinationAsks: [...targetAsks].sort((a, b) =>
            D(a.price).comparedTo(b.price),
          ),
          liquidity: l,
          historyWindows: windows.get(historyKey)!,
          feeRate: fee.broker.toFixed(),
          taxRate: fee.tax.toFixed(),
          relistDiscount: fee.discount.toFixed(),
          relistCount: settings.relistPerDay * 3,
          rankedBy: "buy" as const,
          at: input.at,
          formulaVersion: FORMULA_VERSION,
          features: {
            eventTime: input.at,
            availableAt: input.at,
            snapshotIds: input.snapshotIds,
            settings: { ...settings },
          },
        };
        let o = calculateOpportunity(base, quantity);
        // Exact cost + upfront listing reserve must fit as well as acquisition alone.
        if (D(o.purchase.total).plus(o.sell.listing).gt(allowance)) {
          quantity = Math.max(
            0,
            Math.floor(
              quantity *
                allowance
                  .div(D(o.purchase.total).plus(o.sell.listing))
                  .toNumber(),
            ) - 1,
          );
          if (!quantity) continue;
          o = calculateOpportunity({ ...base, maximum: quantity }, quantity);
        }
        const buyEligible =
          o.buy.fullROI !== null &&
          D(o.buy.result.profit).gte(settings.minProfit) &&
          (!settings.roiEnabled ||
            D(o.buy.fullROI).gte(D(settings.minROI).div(100)));
        const sellEligible =
          l.sellQuantity >= quantity &&
          D(o.sell.profit).gte(settings.minProfit) &&
          (!settings.roiEnabled ||
            D(o.sell.roi ?? 0).gte(D(settings.minROI).div(100)));
        if (!buyEligible && !sellEligible) continue;
        if (
          (settings.sort === "buy" && !buyEligible) ||
          (settings.sort === "sell" && !sellEligible)
        )
          continue;
        o.rankedBy =
          settings.sort === "sell" ||
          (settings.sort === "best" &&
            sellEligible &&
            (!buyEligible || D(o.sell.profit).gt(o.buy.result.profit)))
            ? "sell"
            : "buy";
        result.push(o);
      }
    }
  }
  return result.sort(
    (a, b) =>
      D(b.rankedBy === "buy" ? b.buy.result.profit : b.sell.profit).comparedTo(
        a.rankedBy === "buy" ? a.buy.result.profit : a.sell.profit,
      ) || a.id.localeCompare(b.id),
  );
}
export function basketTotals(items: Opportunity[]) {
  if (
    items.length &&
    items.some(
      (o) =>
        o.source.id !== items[0].source.id ||
        o.destination.id !== items[0].destination.id,
    )
  )
    throw Error("Корзина должна иметь одну пару станций");
  const used = new Map<string, number>();
  const buyResults = items.map((o) => {
    const sell = fill(o.demand, o.quantity, "sell", used);
    return {
      covered: sell.filled === o.quantity,
      profit: pnl(
        fill(o.supply, sell.filled, "buy").total,
        sell.total,
        o.taxRate,
      ).profit,
    };
  });
  return {
    cost: isk(sum(items.map((o) => o.purchase.total))),
    listing: isk(sum(items.map((o) => o.sell.listing))),
    sellProfit: isk(sum(items.map((o) => o.sell.profit))),
    buyProfit: isk(sum(buyResults.map((r) => r.profit))),
    buyComplete: buyResults.every((r) => r.covered),
    volume: cargo(
      items.map((o) => ({ quantity: o.quantity, volume: o.type.volume })),
    ),
    positions: items.length,
  };
}

// Reuses prepared opportunities when only the visible profit/ROI/sort filters change.
// Quantity is recomputed against the same ladders so a high ROI can select a smaller lot.
export function filterOpportunities(
  offers: Opportunity[],
  settings: Settings,
): Opportunity[] {
  const result: Opportunity[] = [];
  for (const base of offers) {
    const minimum = settings.roiEnabled
      ? D(settings.minROI).div(100).toFixed()
      : "0";
    const buyQ = profitableQuantity(
      base.supply,
      base.demand,
      base.purchase.total,
      base.taxRate,
      minimum,
    );
    const sellRate = D(base.taxRate)
      .plus(base.feeRate)
      .plus(
        D(1).minus(base.relistDiscount).mul(base.feeRate).mul(base.relistCount),
      );
    const sellQ = base.liquidity.sellQuantity
      ? profitableQuantity(
          base.supply,
          [
            {
              id: "forecast",
              price: base.sellPrice,
              quantity: base.liquidity.sellQuantity,
            },
          ],
          base.purchase.total,
          sellRate.toFixed(),
          minimum,
        )
      : 0;
    const quantity = Math.min(
      base.maximum,
      settings.sort === "buy"
        ? buyQ
        : settings.sort === "sell"
          ? sellQ
          : Math.max(buyQ, sellQ),
    );
    if (!quantity) continue;
    const o = calculateOpportunity(
      {
        ...base,
        maximum: quantity,
        features: { ...base.features, settings: { ...settings } },
      },
      quantity,
    );
    const buy =
      o.buy.fullROI !== null &&
      D(o.buy.result.profit).gte(settings.minProfit) &&
      D(o.buy.fullROI).gte(minimum);
    const sell =
      o.liquidity.sellQuantity >= quantity &&
      D(o.sell.profit).gte(settings.minProfit) &&
      D(o.sell.roi ?? "-1").gte(minimum);
    if (
      (!buy && !sell) ||
      (settings.sort === "buy" && !buy) ||
      (settings.sort === "sell" && !sell)
    )
      continue;
    o.rankedBy =
      settings.sort === "sell" ||
      (settings.sort === "best" &&
        sell &&
        (!buy || D(o.sell.profit).gt(o.buy.result.profit)))
        ? "sell"
        : "buy";
    result.push(o);
  }
  return result.sort(
    (a, b) =>
      D(b.rankedBy === "buy" ? b.buy.result.profit : b.sell.profit).comparedTo(
        a.rankedBy === "buy" ? a.buy.result.profit : a.sell.profit,
      ) || a.id.localeCompare(b.id),
  );
}
