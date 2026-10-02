import {
  Alerts,
  retain,
  analysisExport,
  saveFeatures,
} from "./background/maintenance";
import { writeFileSync } from "node:fs";
import { Reconciler } from "./accounting/reconcile";
import { demoOperations } from "./accounting/demo-operations";
import { Worker, parentPort, workerData } from "node:worker_threads";
import { join } from "node:path";
import { statSync, existsSync } from "node:fs";
import { Store } from "../db/store";
import { MarketService } from "./service";
import { seedDemo, DEMO_TIME } from "./market/demo";
import { Trades, selectQuantity } from "./portfolio/trades";
import {
  scanOpportunities,
  filterOpportunities,
  basketTotals,
  type Opportunity,
} from "./market/opportunities";
import { latestOrders, latestSnapshots } from "./market/snapshots";
import { stationProfile, type ProfileData } from "./portfolio/profile";
import type { HistoryDay } from "../shared/contracts/esi";
import { Portfolio } from "./portfolio/repository";
import { ownSellOrders, replaceActiveOrders } from "./portfolio/orders";
import type { WalletData } from "./portfolio/sync";
import { requestSchema, type AppState } from "../shared/contracts/app";
const config = workerData as {
  directory: string;
  migrations: string;
  resources: string;
  demo: boolean;
  offline?: boolean;
};
const path = join(
  config.directory,
  config.demo ? "demo.sqlite" : "portfolio.sqlite",
);
const store = new Store(path, config.migrations);
if (config.demo) seedDemo(store);
const portfolio = new Portfolio(store);
const market = new MarketService(store, config.resources, config.demo);
setInterval(() => void market.scheduler.tick(), 1000).unref();
if (!config.demo && !config.offline) market.scan();
const alerts = new Alerts();
let notifications: AppState["notifications"] = [];
setInterval(() => retain(store), 3600000).unref();
const trades = new Trades(store, () => market.data);
const reconciler = new Reconciler(store, () => market.data);
let cached: Opportunity[] = [];
let prepared: Opportunity[] = [];
let signature = "";
let filterSignature = "";
function filtered() {
  const settings = store.getSettings();
  const key = JSON.stringify(settings);
  if (key !== filterSignature) {
    filterSignature = key;
    cached = filterOpportunities(prepared, settings);
    saveFeatures(store, cached);
    notifications = [
      ...notifications,
      ...alerts.select(cached, settings.notificationThreshold),
    ].slice(-20);
  }
  return cached;
}
let calculationBusy = false;
let calculationAt = 0;
let calculationError = "";
let calculationWorker: Worker | undefined;
let calculationTimer: NodeJS.Timeout | undefined;
function liveCandidates() {
  if (!market.data) return [];
  const snapshots = latestSnapshots(store, market.data.regions);
  const budget = portfolio.currentBudget();
  const settings = store.getSettings();
  const structural = {
    ...settings,
    minProfit: settings.minProfit,
    minTripProfit: "0",
    roiEnabled: false,
    minROI: 0,
    sort: "best" as const,
    notificationThreshold: "0",
    sound: false,
  };
  const key = JSON.stringify([
    snapshots.map((s) => s.id),
    store.sql
      .prepare("SELECT value FROM sync_cursors WHERE key='history-revision'")
      .get(),
    structural,
    budget,
    [...trades.exposures()],
    store.sql.prepare("SELECT count(*) n FROM sale_allocations").get(),
    store.sql
      .prepare("SELECT value FROM sync_cursors WHERE key='seller-profile'")
      .get(),
  ]);
  const retryReady =
    calculationError === "" || Date.now() - calculationAt > 30000;
  if (
    !calculationBusy &&
    retryReady &&
    (key !== signature || filterSignature !== JSON.stringify(settings))
  ) {
    calculationBusy = true;
    calculationError = "";
    if (!calculationWorker) {
      calculationWorker = new Worker(join(__dirname, "calculator.cjs"), {
        workerData: config,
      });
      calculationWorker.on(
        "message",
        (message: {
          result?: {
            key: string;
            filtered: Opportunity[];
            filterSignature: string;
          };
          error?: string;
        }) => {
          clearTimeout(calculationTimer);
          calculationTimer = undefined;
          calculationBusy = false;
          calculationAt = Date.now();
          if (message.result) {
            cached = message.result.filtered;
            signature = message.result.key;
            filterSignature = message.result.filterSignature;
            saveFeatures(store, cached);
            notifications = [
              ...notifications,
              ...alerts.select(
                cached,
                store.getSettings().notificationThreshold,
              ),
            ].slice(-20);
          } else {
            calculationError = "Не удалось рассчитать рынок. Повторяем расчёт.";
          }
        },
      );
      calculationWorker.on("error", () => {
        clearTimeout(calculationTimer);
        calculationTimer = undefined;
        calculationBusy = false;
        calculationAt = Date.now();
        calculationError = "Расчёт рынка остановился. Повторяем расчёт.";
        calculationWorker = undefined;
      });
    }
    const worker = calculationWorker;
    calculationTimer = setTimeout(() => {
      if (calculationWorker !== worker || !calculationBusy) return;
      calculationBusy = false;
      calculationAt = Date.now();
      calculationError = "Расчёт рынка превысил лимит времени. Повторим через 30 секунд.";
      calculationWorker = undefined;
      void worker?.terminate();
    }, 120000).unref();
    calculationWorker.postMessage({
      kind:
        key === signature && filterSignature !== JSON.stringify(settings)
          ? "filter"
          : "calculate",
    });
  }
  // Do not allow an old budget, profile or market generation to be traded.
  if (key !== signature || filterSignature !== JSON.stringify(settings))
    return [];
  return cached;
}
function candidates() {
  if (!config.demo) return liveCandidates();
  if (!market.data) return [];
  const snapshots = latestSnapshots(store, market.data.regions);
  const budget = portfolio.currentBudget();
  const settings = store.getSettings();
  const structural = {
    ...settings,
    minProfit: settings.minProfit,
    minTripProfit: "0",
    roiEnabled: false,
    minROI: 0,
    sort: "best" as const,
    notificationThreshold: "0",
    sound: false,
  };
  const key = JSON.stringify([
    snapshots.map((s) => s.id),
    store.sql
      .prepare("SELECT value FROM sync_cursors WHERE key='history-revision'")
      .get(),
    structural,
    budget,
    [...trades.exposures()],
    store.sql.prepare("SELECT count(*) n FROM sale_allocations").get(),
    store.sql
      .prepare("SELECT value FROM sync_cursors WHERE key='seller-profile'")
      .get(),
  ]);
  if (key === signature) return filtered();
  signature = key;
  const snapshot = latestOrders(
    store,
    market.data.regions,
    new Set(market.data.stations.map((station) => station.id)),
  );
  const raw = store.sql
    .prepare("SELECT value FROM sync_cursors WHERE key='seller-profile'")
    .get() as { value: string } | undefined;
  const profile = raw ? (JSON.parse(raw.value) as ProfileData) : null;
  const reservedDepth = trades.reservedDepth();
  const at = config.demo ? DEMO_TIME : new Date().toISOString();
  const since = new Date(Date.parse(at) - 7 * 86400000).toISOString();
  const local = new Map<
    string,
    { observations: number; confirmedSales: number }
  >();
  for (const row of store.sql
    .prepare(
      "SELECT o.station_id,o.type_id,count(*) n FROM station_observations o WHERE o.at>=? AND o.at<=? AND EXISTS (SELECT 1 FROM market_snapshot_runs r WHERE r.id=json_extract(o.payload,'$.generation') AND r.status='complete') GROUP BY o.station_id,o.type_id",
    )
    .all(since, at) as { station_id: string; type_id: string; n: number }[])
    local.set(row.type_id + ":" + row.station_id, {
      observations: row.n,
      confirmedSales: 0,
    });
  for (const row of store.sql
    .prepare(
      "SELECT l.type_id,d.destination,sum(a.quantity) n FROM sale_allocations a JOIN purchase_lots l ON l.id=a.lot_id JOIN deals d ON d.id=l.deal_id JOIN wallet_transactions t ON t.character_id=a.seller_id AND t.id=a.transaction_id WHERE json_extract(t.payload,'$.date')>=? AND json_extract(t.payload,'$.date')<=? GROUP BY l.type_id,d.destination",
    )
    .all(since, at) as { type_id: string; destination: string; n: number }[]) {
    const key = row.type_id + ":" + row.destination;
    local.set(key, {
      observations: local.get(key)?.observations ?? 0,
      confirmedSales: row.n / 7,
    });
  }
  prepared = scanOpportunities({
    data: market.data,
    orders: snapshot.orders.map((o) => ({
      ...o,
      volume_remain: Math.max(
        0,
        o.volume_remain - (reservedDepth.get(o.order_id) ?? 0),
      ),
    })),
    settings: structural,
    available: budget.available,
    pool: budget.pool,
    exposures: trades.exposures(),
    profile: (station) =>
      config.demo
        ? {
            accounting: 5,
            brokerRelations: 5,
            advancedBrokerRelations: 5,
            factionStanding: "0",
            corporationStanding: "0",
          }
        : profile
          ? stationProfile(profile, station)
          : null,
    history: (type, region) =>
      (
        store.sql
          .prepare(
            "SELECT payload FROM regional_history WHERE type_id=? AND region_id=?",
          )
          .all(type, region) as { payload: string }[]
      ).map((r) => JSON.parse(r.payload) as HistoryDay),
    local: (type, station) =>
      local.get(type + ":" + station) ?? { observations: 0, confirmedSales: 0 },
    at,
    snapshotIds: snapshots.map((s) => s.id),
  });
  filterSignature = "";
  return filtered();
}
let preview: Opportunity | null = null;
let basket: AppState["basket"] = null;
function selected(items: { id: string; quantity: number }[]) {
  const current = candidates();
  return items.map((item) => {
    const o = current.find((x) => x.id === item.id);
    if (!o) throw Error("Предложение больше не соответствует фильтрам");
    return selectQuantity(o, item.quantity);
  });
}
function state(): AppState {
  const b = portfolio.currentBudget();
  return {
    demo: config.demo,
    ownSellOrders: ownSellOrders(store),
    notifications,
    review: reconciler.review(),
    systemNames: Object.fromEntries(
      (market.data?.systems ?? []).map((s) => [s.id, s.name]),
    ),
    preview,
    basket,
    settings: store.getSettings(),
    characters: portfolio.characters(),
    opportunities: candidates(),
    deals: trades.list(),
    available: b.available,
    wallet: b.wallet,
    reserved: b.reserved,
    mainBalance:
      portfolio.characters().find((c) => c.isSeller)?.balance ?? null,
    sync: config.demo
      ? "DEMO · воспроизводимые данные"
      : portfolio.characters().length === 3
        ? "Синхронизация по кешу ESI · " +
          market.summary().loadedRegions +
          "/" +
          market.summary().regions +
          " регионов"
        : "Подключите три персонажа",
    market: {
      ...market.summary(),
      status: calculationBusy
        ? "Расчёт торговых возможностей… Рынок и кошельки доступны."
        : calculationError || market.status,
    },
    databaseSize: existsSync(path) ? statSync(path).size : 0,
  };
}
parentPort!.on(
  "message",
  async (message: {
    id: string;
    request: unknown;
    backupPath?: string;
    internal?:
      | { kind: "connected"; id: string; name: string; seller: boolean }
      | { kind: "wallets"; wallets: WalletData[]; profile?: ProfileData }
      | { kind: "suspend" | "resume" };
  }) => {
    try {
      if (message.internal?.kind === "suspend") market.scheduler.suspend();
      if (message.internal?.kind === "resume") market.scheduler.resume();
      if (message.internal?.kind === "connected")
        portfolio.connect(
          message.internal.id,
          message.internal.name,
          message.internal.seller,
        );
      if (message.internal?.kind === "wallets") {
        const wallets = message.internal.wallets;
        store.sql.transaction(() => {
          portfolio.importWallets(wallets);
          for (const w of wallets)
            if (w.orders !== undefined)
              replaceActiveOrders(store, w.id, w.orders);
          for (const w of wallets)
            for (const [state, rows] of [
              ["active", w.orders ?? []],
              ["history", w.orderHistory ?? []],
            ] as const)
              for (const order of rows) {
                const parsed = order as { order_id?: string };
                if (!parsed.order_id)
                  throw Error("ESI: у ордера отсутствует ID");
                store.sql
                  .prepare(
                    "INSERT INTO character_orders VALUES (?,?,?,?,?) ON CONFLICT(character_id,id,state) DO UPDATE SET payload=excluded.payload,available_at=excluded.available_at",
                  )
                  .run(
                    w.id,
                    String(parsed.order_id),
                    state,
                    JSON.stringify(order),
                    new Date().toISOString(),
                  );
              }
          reconciler.run();
        })();
        if (message.internal.profile)
          store.sql
            .prepare(
              "INSERT INTO sync_cursors VALUES ('seller-profile',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            )
            .run(JSON.stringify(message.internal.profile));
      }
      const request = requestSchema.parse(message.request);
      if (request.kind === "character.disconnect")
        portfolio.disconnect(request.id);
      if (request.kind === "quote")
        preview = selected([{ id: request.id, quantity: request.quantity }])[0];
      if (request.kind === "basket.preview" || request.kind === "basket.copy") {
        const items = selected(request.items);
        if (new Set(items.map((o) => o.type.id)).size !== items.length)
          throw Error("Товар уже в корзине");
        basket = {
          items,
          totals: basketTotals(items),
          multibuy: items
            .map((o) => o.type.englishName + " " + o.quantity)
            .join("\n"),
        };
      }
      if (
        request.kind === "deal.accept" &&
        !store.sql.prepare("SELECT id FROM deals WHERE id=?").get(request.id)
      ) {
        const current = candidates();
        const items = request.items.map((item) => {
          const o = current.find((x) => x.id === item.id);
          if (!o) throw Error("Предложение больше не соответствует фильтрам");
          return selectQuantity(o, item.quantity);
        });
        if (
          !config.demo &&
          latestOrders(
            store,
            market.data?.regions ?? [],
            new Set(market.data?.stations.map((station) => station.id) ?? []),
          ).snapshots.some((s) => Date.parse(s.expiresAt) < Date.now())
        )
          throw Error("Снимок устарел. Дождитесь обновления рынка.");
        trades.accept(request.id, items, request.parentId);
      }
      if (request.kind === "deal.reconcile") reconciler.run(request.id);
      if (request.kind === "purchase.bind") {
        reconciler.bindPurchase(
          request.characterId,
          request.transactionId,
          request.dealId,
        );
        reconciler.run();
      }
      if (request.kind === "transfer.confirm") {
        reconciler.confirmTransfer(request.lotId);
        reconciler.run();
      }
      if (request.kind === "expense.bind") {
        reconciler.attachExpense(
          request.dealId,
          request.characterId,
          request.journalId,
          request.amount,
        );
        reconciler.run();
      }
      if (request.kind === "expenses.confirm") {
        reconciler.confirmExpenses(request.id);
        reconciler.run();
      }
      if (request.kind === "demo.operations") {
        if (!config.demo) throw Error("Только DEMO");
        const d = trades.list().find((d) => d.id === request.id);
        if (!d) throw Error("Сделка не найдена");
        demoOperations(store, d);
        reconciler.run();
      }
      if (request.kind === "deal.cancel") trades.cancel(request.id);
      if (request.kind === "deal.route") trades.route(request.id, request.mode);
      if (request.kind === "market.sync") market.scan(true);
      if (request.kind === "static.update")
        void market.updateStatic().catch(() => {});
      if (request.kind === "settings.save") store.saveSettings(request.value);
      if (request.kind === "export" && message.backupPath)
        writeFileSync(
          message.backupPath,
          JSON.stringify(analysisExport(store), null, 2),
        );
      if (request.kind === "backup" && message.backupPath)
        await store.backup(message.backupPath);
      parentPort!.postMessage({ id: message.id, value: state() });
    } catch (error) {
      parentPort!.postMessage({
        id: message.id,
        error: error instanceof Error ? error.message : "Ошибка движка",
      });
    }
  },
);
