import {
  Alerts,
  retain,
  analysisExport,
  saveFeatures,
} from "./background/maintenance";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Reconciler } from "./accounting/reconcile";
import { D, isk } from "./accounting/money";
import { estimateCurrentProjectCost, estimateCurrentProjectProfit, resolveManufacturingExecutionCost } from "./production/project-cost";
import { quoteProjectBuySources } from "./production/project-sourcing";
import { demoOperations } from "./accounting/demo-operations";
import { Worker, parentPort, workerData } from "node:worker_threads";
import { join } from "node:path";
import { statSync, existsSync } from "node:fs";
import { Store } from "../db/store";
import { MarketService } from "./service";
import type { StaticData, Station } from "./market/static-data";
import { effectiveAlphaSkills, manufacturingJobSlots, missingManufacturingSkills } from "./production/skills";
import { productionMarketSignal } from "./production/market-signal";
import { blueprintCapitalMetrics, estimateManufacturing, jobMaterialQuantity, manufacturingTimeSeconds, manufacturingValueAndFee } from "./production/manufacturing";
import type { ManufacturingEstimate } from "./production/manufacturing";
import { planMakeBuyChain, scheduleChainPlan } from "./production/chain-planner";
import type { ChainPlan, ChainRecipe } from "./production/chain-planner";
import { listingFee } from "./market/fees";
import { pnl } from "./market/depth";
import { estimateReprocessing } from "./production/reprocessing";
import { isFreshTimestamp, isUnexpiredTimestamp } from "./production/freshness";
import { availableBlueprintRuns, canReserveBlueprintRuns } from "./production/blueprints";
import { allocateBpcBundleCost, allocateBlueprintAcquisitionCost, groupKnownBpcCopies, knownBpcCopies, matchCompletedBlueprintContractAcquisitions } from "./production/contract-acquisition";
import { Graph } from "./routes/graph";
import { seedDemo, DEMO_TIME } from "./market/demo";
import { Trades, selectQuantity } from "./portfolio/trades";
import {
  scanOpportunities,
  filterOpportunities,
  basketTotals,
  type Opportunity,
} from "./market/opportunities";
import { latestOrders, latestProductionOrders, latestSnapshots } from "./market/snapshots";
import { stationProfile, type ProfileData } from "./portfolio/profile";
import { transactionSchema, type HistoryDay, type Order } from "../shared/contracts/esi";
import { Portfolio } from "./portfolio/repository";
import { shouldStartMarketCalculation } from "./market/calculation-gate";
import { ownSellOrders, replaceActiveOrders } from "./portfolio/orders";
import { journalSchema, type WalletData } from "./portfolio/sync";
import type {
  OwnProductionData,
  PublicProductionData,
  StructureMarketSync,
} from "./production/esi";
import {
  requestSchema,
  type AppRequest,
  type AppState,
  PRODUCTION_SCOPES,
  OPTIONAL_STRUCTURE_SCOPES,
} from "../shared/contracts/app";
const config = workerData as {
  directory: string;
  migrations: string;
  resources: string;
  demo: boolean;
  devBuild?: boolean;
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
const bundledStatic = JSON.parse(
  readFileSync(join(config.resources, "static-data.json"), "utf8"),
) as StaticData;
// The database, migrations, and static market data are ready. Notify the
// updater before starting live market work, which can take much longer.
parentPort!.postMessage({ kind: "ready" });
setInterval(() => void market.scheduler.tick(), 1000).unref();
if (!config.demo && !config.offline) market.scan();
const alerts = new Alerts();
let notifications: AppState["notifications"] = [];
setInterval(() => retain(store), 3600000).unref();
const trades = new Trades(store, () => market.data);
const reconciler = new Reconciler(store, () => market.data);
function contractSyncDetails(data: PublicProductionData) {
  return {
    candidateContracts: data.contractCoverage.candidateContracts,
    fetchedContracts: data.contractCoverage.fetchedContracts,
    contractCoverageCapped: data.contractCoverage.capped,
    contractCoverageComplete: data.contractCoverage.complete,
    contractItemErrors: data.contractCoverage.itemErrors,
  };
}
function persistPublicBlueprintContracts(publicData: PublicProductionData) {
  if (!publicData.contractCoverage.complete) return;
  const observedAt = publicData.at;
  store.sql.transaction(() => {
    store.sql.prepare("UPDATE production_contract_sources SET coverage_status='unavailable' WHERE region_id IN ('10000002')").run();
    store.sql.prepare("UPDATE blueprint_sources SET status='unavailable' WHERE source_kind='contract' AND id NOT IN (SELECT blueprint_source_id FROM blueprint_run_allocations)").run();
    const contractInsert = store.sql.prepare(
      "INSERT INTO production_contract_sources(contract_id,region_id,location_id,contract_type,status,price,expires_at,items_payload,observed_at,coverage_status) VALUES (?,? ,?,'item_exchange','outstanding',?,?,?,?, 'available') ON CONFLICT(contract_id) DO UPDATE SET location_id=excluded.location_id,status=excluded.status,price=excluded.price,expires_at=excluded.expires_at,items_payload=excluded.items_payload,observed_at=excluded.observed_at,coverage_status='available'",
    );
    const blueprintInsert = store.sql.prepare(
      "INSERT INTO blueprint_sources(id,source_kind,source_id,contract_id,blueprint_type_id,location_id,quantity,material_efficiency,time_efficiency,runs,price,status,observed_at,payload) VALUES (?,'contract',?,?,?,?,?,?,?,?,?,'available',?,?) ON CONFLICT(source_kind,source_id) DO UPDATE SET contract_id=excluded.contract_id,blueprint_type_id=excluded.blueprint_type_id,location_id=excluded.location_id,quantity=excluded.quantity,material_efficiency=excluded.material_efficiency,time_efficiency=excluded.time_efficiency,runs=excluded.runs,price=excluded.price,status='available',observed_at=excluded.observed_at,payload=excluded.payload",
    );
    for (const contract of publicData.publicBlueprintContracts) {
      contractInsert.run(
        contract.contractId,
        contract.regionId,
        contract.locationId,
        contract.price,
        contract.expiresAt,
        JSON.stringify({
          title: contract.title,
          blueprintOnly: contract.blueprintOnly,
          includedItemCount: contract.includedItemCount,
          items: contract.items,
        }),
        observedAt,
      );
      for (const item of contract.items) {
        const sourceId = `${contract.contractId}:${item.recordId}`;
        blueprintInsert.run(
          sourceId,
          sourceId,
          contract.contractId,
          item.typeId,
          contract.locationId,
          item.quantity,
          item.materialEfficiency,
          item.timeEfficiency,
          item.runs,
          contract.price,
          observedAt,
          JSON.stringify(item),
        );
      }
    }
  })();
}
function applyPublicBlueprintConfirmations(
  contractId: string,
  items: PublicProductionData["publicBlueprintContracts"][number]["items"],
) {
  const confirmations = store.sql.prepare(
    "SELECT record_id,blueprint_type_id,material_efficiency,time_efficiency,runs,evidence,confirmed_at FROM production_contract_blueprint_confirmations WHERE contract_id=?",
  ).all(contractId) as {
    record_id: string;
    blueprint_type_id: string;
    material_efficiency: number;
    time_efficiency: number;
    runs: number;
    evidence: string;
    confirmed_at: string;
  }[];
  const byRecordId = new Map(confirmations.map((row) => [row.record_id, row]));
  return items.map((item) => {
    const confirmation = byRecordId.get(item.recordId);
    if (!confirmation || item.typeId !== confirmation.blueprint_type_id || item.isBlueprintCopy !== true)
      return { ...item, attributesSource: item.isBlueprintCopy === true && item.materialEfficiency !== null && item.timeEfficiency !== null && item.runs !== null ? "esi" as const : "unknown" as const, confirmedAt: null, evidence: null };
    const hasEsiAttributes = item.materialEfficiency !== null && item.timeEfficiency !== null && item.runs !== null;
    if (hasEsiAttributes) {
      const conflict = item.materialEfficiency !== confirmation.material_efficiency ||
        item.timeEfficiency !== confirmation.time_efficiency || item.runs !== confirmation.runs;
      return { ...item, attributesSource: conflict ? "conflict" as const : "esi" as const, confirmedAt: confirmation.confirmed_at, evidence: confirmation.evidence };
    }
    return {
      ...item,
      materialEfficiency: confirmation.material_efficiency,
      timeEfficiency: confirmation.time_efficiency,
      runs: confirmation.runs,
      attributesSource: "manual" as const,
      confirmedAt: confirmation.confirmed_at,
      evidence: confirmation.evidence,
    };
  });
}
function confirmPublicContractBlueprint(request: Extract<AppRequest, { kind: "production.contract.blueprint.confirm" }>) {
  const contract = store.sql.prepare(
    "SELECT location_id,expires_at,items_payload,observed_at,coverage_status FROM production_contract_sources WHERE contract_id=?",
  ).get(request.contractId) as { location_id: string | null; expires_at: string | null; items_payload: string | null; observed_at: string; coverage_status: string } | undefined;
  if (!contract || contract.coverage_status !== "available" || !contract.location_id)
    throw Error("Контракт больше не подтверждён текущим снимком ESI. Обновите данные контрактов.");
  if (!isUnexpiredTimestamp(contract.expires_at))
    throw Error("Срок контракта истёк; обновите список перед подтверждением.");
  if (!isFreshTimestamp(contract.observed_at, 60 * 60 * 1000))
    throw Error("Снимок контракта старше часа, некорректен или датирован будущим. Обновите данные перед подтверждением.");
  const payload = JSON.parse(contract.items_payload ?? "{}") as {
    items?: PublicProductionData["publicBlueprintContracts"][number]["items"];
  };
  const item = payload.items?.find((entry) => entry.recordId === request.recordId);
  if (!item || item.typeId !== request.blueprintTypeId || item.quantity < 1 || item.isBlueprintCopy !== true)
    throw Error("Копия не совпадает с текущей записью контракта или количество некорректно.");
  if (!(market.data?.manufacturing ?? bundledStatic.manufacturing ?? []).some((recipe) => recipe.blueprintTypeId === item.typeId))
    throw Error("Для этой копии нет рецепта производства в текущем SDE.");
  const confirmedAt = new Date().toISOString();
  store.sql.prepare(
    `INSERT INTO production_contract_blueprint_confirmations(contract_id,record_id,blueprint_type_id,material_efficiency,time_efficiency,runs,evidence,confirmed_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(contract_id,record_id) DO UPDATE SET blueprint_type_id=excluded.blueprint_type_id,
       material_efficiency=excluded.material_efficiency,time_efficiency=excluded.time_efficiency,
       runs=excluded.runs,evidence=excluded.evidence,confirmed_at=excluded.confirmed_at`,
  ).run(request.contractId, request.recordId, request.blueprintTypeId, request.materialEfficiency,
    request.timeEfficiency, request.runs, request.evidence, confirmedAt);
}
let cached: Opportunity[] = [];
let prepared: Opportunity[] = [];
let preparedReady = false;
let signature = "";
let filterSignature = "";
function filtered() {
  const settings = store.getSettings();
  const key = JSON.stringify(settings);
  if (key !== filterSignature) {
    filterSignature = key;
    if (preparedReady) cached = filterOpportunities(prepared, settings);
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
let scanFloor = "0";
let calculationProgress = {
  busy: false,
  phase: "Ожидание данных",
  processed: 0,
  total: 0,
  startedAt: 0,
  revision: 0,
};
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
  const filterKeys = new Set([
    "minProfit",
    "minROI",
    "roiEnabled",
    "sort",
    "notificationThreshold",
    "sound",
  ]);
  const baseSettings = Object.fromEntries(
    Object.entries(structural).filter(([name]) => !filterKeys.has(name)),
  );
  const key = JSON.stringify([
    snapshots.map((s) => s.id),
    baseSettings,
    budget,
    [...trades.exposures()],
    store.sql.prepare("SELECT count(*) n FROM sale_allocations").get(),
    store.sql
      .prepare("SELECT value FROM sync_cursors WHERE key='seller-profile'")
      .get(),
    market.data.version,
    market.data.stations.map((station) => station.id),
  ]);
  const retryReady =
    calculationError === "" || Date.now() - calculationAt > 30000;
  const lowerProfitFloor = Number(settings.minProfit) < Number(scanFloor);
  const mustCalculate = key !== signature || lowerProfitFloor;
  filtered();
  // Region scans publish snapshots one at a time. Wait for the whole due batch
  // so each region does not trigger its own expensive full-market pass.
  if (
    shouldStartMarketCalculation({
      needsCalculation: mustCalculate,
      busy: calculationBusy,
      retryReady,
      hasPreparedOffers: preparedReady,
      marketSyncPending: market.hasPendingMarketSync(),
    })
  ) {
    calculationBusy = true;
    calculationError = "";
    calculationProgress = {
      ...calculationProgress,
      busy: true,
      phase: mustCalculate
        ? "Подготовка стаканов выбранных хабов"
        : "Применение фильтров",
      processed: 0,
      total: 0,
      startedAt: Date.now(),
    };
    if (!calculationWorker) {
      calculationWorker = new Worker(join(__dirname, "calculator.cjs"), {
        workerData: config,
      });
      calculationWorker.on(
        "message",
        (message: {
          result?: {
            key: string;
            offers: Opportunity[];
            scanFloor: string;
          };
          progress?: { phase: string; processed: number; total: number };
          error?: string;
        }) => {
          if (message.progress) {
            calculationProgress = {
              ...calculationProgress,
              ...message.progress,
              startedAt:
                calculationProgress.startedAt ||
                (message.progress.total > 0 ? Date.now() : 0),
            };
            return;
          }
          if (!message.result && !message.error) return;
          clearTimeout(calculationTimer);
          calculationTimer = undefined;
          calculationBusy = false;
          calculationAt = Date.now();
          if (message.result) {
            prepared = message.result.offers;
            preparedReady = true;
            signature = message.result.key;
            filterSignature = "";
            scanFloor = message.result.scanFloor ?? scanFloor;
            cached = filtered();
            calculationProgress = {
              ...calculationProgress,
              phase: "Обновлено",
              processed: calculationProgress.total,
              busy: false,
              revision: calculationProgress.revision + 1,
            };
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
            calculationProgress = {
              ...calculationProgress,
              busy: false,
              phase: "Ошибка расчёта",
            };
          }
        },
      );
      calculationWorker.on("error", () => {
        clearTimeout(calculationTimer);
        calculationTimer = undefined;
        calculationBusy = false;
        calculationAt = Date.now();
        calculationError = "Расчёт рынка остановился. Повторяем расчёт.";
        calculationProgress = {
          ...calculationProgress,
          busy: false,
          phase: "Ошибка расчёта",
        };
        calculationWorker = undefined;
      });
    }
    const worker = calculationWorker;
    calculationTimer = setTimeout(() => {
      if (calculationWorker !== worker || !calculationBusy) return;
      calculationBusy = false;
      calculationAt = Date.now();
      calculationError =
        "Расчёт рынка превысил лимит времени. Повторим через 30 секунд.";
      calculationProgress = {
        ...calculationProgress,
        busy: false,
        phase: "Превышено время расчёта",
      };
      calculationWorker = undefined;
      void worker?.terminate();
    }, 120000).unref();
    calculationWorker.postMessage({ kind: "calculate" });
  }
  // Keep the last completed offers visible while the next snapshot is analyzed.
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
  const filterKeys = new Set([
    "minProfit",
    "minROI",
    "roiEnabled",
    "sort",
    "notificationThreshold",
    "sound",
  ]);
  const baseSettings = Object.fromEntries(
    Object.entries(structural).filter(([name]) => !filterKeys.has(name)),
  );
  const key = JSON.stringify([
    snapshots.map((s) => s.id),
    baseSettings,
    budget,
    [...trades.exposures()],
    store.sql.prepare("SELECT count(*) n FROM sale_allocations").get(),
    store.sql
      .prepare("SELECT value FROM sync_cursors WHERE key='seller-profile'")
      .get(),
    market.data.version,
    market.data.stations.map((station) => station.id),
  ]);
  const lowerProfitFloor = Number(settings.minProfit) < Number(scanFloor);
  if (key === signature && !lowerProfitFloor) return filtered();
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
  const hubStationIds = market.data.stations.map((station) => station.id);
  for (const row of store.sql
    .prepare(
      `SELECT o.station_id,o.type_id,count(*) n FROM station_observations o WHERE o.at>=? AND o.at<=? AND o.station_id IN (${hubStationIds.map(() => "?").join(",")}) AND EXISTS (SELECT 1 FROM market_snapshot_runs r WHERE r.id=json_extract(o.payload,'$.generation') AND r.status='complete') GROUP BY o.station_id,o.type_id`,
    )
    .all(since, at, ...hubStationIds) as {
    station_id: string;
    type_id: string;
    n: number;
  }[])
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
  preparedReady = true;
  scanFloor = settings.minProfit;
  filterSignature = "";
  calculationProgress = {
    ...calculationProgress,
    phase: "Обновлено",
    processed: calculationProgress.total,
    revision: calculationProgress.revision + 1,
  };
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
let productionOfferCacheKey = "";
let productionOfferCache: Pick<AppState["production"], "offers" | "contractOffers" | "marketBpoCandidatesScanned" | "marketBpoCandidatesTotal" | "marketBpoScanComplete" | "contractCandidatesScanned" | "contractCandidatesTotal" | "contractScanComplete"> = { offers: [], contractOffers: [], marketBpoCandidatesScanned: 0, marketBpoCandidatesTotal: 0, marketBpoScanComplete: true, contractCandidatesScanned: 0, contractCandidatesTotal: 0, contractScanComplete: true };
let productionMarketBpoProgress = 0;
let productionMarketBpoTotal = 0;
let productionMarketBpoScanKey = "";
let productionContractProgress = 0;
let productionContractTotal = 0;
const productionQuoteHandlers = new Map<string, { maxRuns: number; estimateAt: (runs: number) => ManufacturingEstimate }>();
const productionRequestedRuns = new Map<string, number>();
let reprocessingOfferCacheKey = "";
let reprocessingOfferCache: AppState["production"]["reprocessingOffers"] = [];
const reprocessingQuoteHandlers = new Map<string, { maxInputQuantity: number; portionSize: number; estimateAt: (quantity: number) => ReturnType<typeof estimateReprocessing> }>();
const reprocessingRequestedInputs = new Map<string, number>();
let productionMarketCacheKey = "";
let productionMarketCache: ReturnType<typeof latestOrders> | null = null;
function productionMarketOrders(regions: string[], locations: ReadonlySet<string>) {
  const snapshots = latestSnapshots(store, regions);
  const structureSources = store.sql.prepare(
    "SELECT structure_id,observed_at FROM production_structure_market_sync WHERE state='available' ORDER BY structure_id",
  ).all() as { structure_id: string; observed_at: string }[];
  const key = JSON.stringify([regions, snapshots.map((snapshot) => snapshot.id), [...locations].sort(), structureSources]);
  if (productionMarketCache && productionMarketCacheKey === key) return productionMarketCache;
  productionMarketCacheKey = key;
  const regular = latestProductionOrders(store, regions, locations);
  const locationIds = [...locations];
  const structureOrders: Order[] = [];
  if (locationIds.length) {
    const rows = store.sql.prepare(
      `SELECT o.payload FROM production_structure_market_orders o
       JOIN production_structure_market_sync s ON s.structure_id=o.structure_id
       JOIN production_facility_profiles f ON f.location_id=o.structure_id
       WHERE s.state='available' AND f.access_status='confirmed'
       AND datetime(s.observed_at)>=datetime('now','-15 minutes')
       AND o.location_id IN (${locationIds.map(() => "?").join(",")})`,
    ).all(...locationIds) as { payload: string }[];
    structureOrders.push(...rows.map((row) => JSON.parse(row.payload) as Order));
  }
  productionMarketCache = { ...regular, orders: [...regular.orders, ...structureOrders] };
  return productionMarketCache;
}
function productionCapital(main: AppState["characters"][number] | undefined) {
  const productionReserved = (store.sql.prepare("SELECT amount FROM production_reservations WHERE paid=0").all() as { amount: string }[])
    .reduce((total, row) => total.plus(row.amount), D(0));
  const tradeReserved = (store.sql.prepare("SELECT amount FROM budget_reservations WHERE paid=0").all() as { amount: string }[])
    .reduce((total, row) => total.plus(row.amount), D(0));
  const balance = main?.balance ? D(main.balance) : null;
  const spendable = balance ? balance.minus(productionReserved) : null;
  return {
    mainBalance: main?.balance ?? null,
    productionReserved: productionReserved.toFixed(2),
    tradeReserved: tradeReserved.toFixed(2),
    spendable: spendable?.gt(0) ? spendable.toFixed(2) : "0.00",
    commitmentConflict: Boolean(balance && productionReserved.plus(tradeReserved).gt(balance)),
  };
}
function manufacturingOffers(
  productionStatic: StaticData,
  main: AppState["characters"][number] | undefined,
): Pick<AppState["production"], "offers" | "contractOffers" | "marketBpoCandidatesScanned" | "marketBpoCandidatesTotal" | "marketBpoScanComplete" | "contractCandidatesScanned" | "contractCandidatesTotal" | "contractScanComplete"> {
  const empty = { offers: [], contractOffers: [], marketBpoCandidatesScanned: 0, marketBpoCandidatesTotal: 0, marketBpoScanComplete: true, contractCandidatesScanned: 0, contractCandidatesTotal: 0, contractScanComplete: true };
  if (!main || !market.data) return empty;
  const hubSystems = new Set(["30000142", "30000144"]);
  const hubStations = productionStatic.stations.filter((station) =>
    hubSystems.has(station.systemId),
  );
  const facilityRows = store.sql
    .prepare(
      "SELECT location_id,name,system_id,facility_kind,services_payload,industry_tax,access_status,observed_at FROM production_facility_profiles WHERE access_status='confirmed'",
    )
    .all() as {
    location_id: string;
    name: string;
    system_id: string;
    facility_kind: "npc_station" | "structure";
    services_payload: string;
    industry_tax: string | null;
    access_status: "confirmed";
    observed_at: string;
  }[];
  const profiles = facilityRows
    .map((row) => {
      const knownStation = hubStations.find((station) => station.id === row.location_id);
      const system = productionStatic.systems.find((candidate) => candidate.id === row.system_id);
      const station: Station | null = knownStation ?? (row.facility_kind === "structure" && system
        ? { id: row.location_id, name: row.name, systemId: row.system_id, regionId: system.regionId, ownerId: "", factionId: null }
        : null);
      return { row, station };
    })
    .filter((x): x is typeof x & { station: Station } => !!x.station)
    .filter((x) => hubSystems.has(x.station.systemId))
    .filter((x) => (JSON.parse(x.row.services_payload) as string[]).includes("manufacturing"))
    .filter((x) => isFreshTimestamp(x.row.observed_at, 30 * 24 * 60 * 60 * 1000));
  if (!profiles.length) return empty;

  const profileRow = store.sql
    .prepare("SELECT race,skills_payload,standings_payload,skill_queue_payload,observed_at FROM production_character_profiles WHERE character_id=?")
    .get(main.id) as {
    race: string | null;
    skills_payload: string;
    standings_payload: string;
    skill_queue_payload: string;
    observed_at: string;
  } | undefined;
  if (!profileRow) return empty;
  const profile: ProfileData = {
    race: profileRow.race,
    skills: JSON.parse(profileRow.skills_payload) as ProfileData["skills"],
    standings: JSON.parse(profileRow.standings_payload) as ProfileData["standings"],
    queue: JSON.parse(profileRow.skill_queue_payload) as ProfileData["queue"],
    at: profileRow.observed_at,
  };
  if (!isFreshTimestamp(profile.at, 30 * 24 * 60 * 60 * 1000)) return empty;
  // ESI can keep skill levels stale until the character next logs in. A
  // completed queue entry above the reported trained level proves this profile
  // cannot certify current Alpha eligibility.
  if (profile.queue.some((entry) =>
    !!entry.finish_date && Date.parse(entry.finish_date) <= Date.parse(profile.at) &&
    entry.finished_level > (profile.skills.find((skill) => skill.skill_id === entry.skill_id)?.trained_skill_level ?? 0)))
    return empty;
  const blueprints = store.sql
    .prepare(`SELECT b.item_id,b.blueprint_type_id,b.location_id,b.material_efficiency,b.time_efficiency,b.runs,b.observed_at,
                     s.price AS acquisition_cost,s.acquisition_runs
              FROM production_blueprint_instances b
              LEFT JOIN blueprint_sources s ON s.source_kind='owned' AND s.source_id=b.item_id
              WHERE b.character_id=?`)
    .all(main.id) as {
    item_id: string;
    blueprint_type_id: string;
    location_id: string;
    material_efficiency: number;
    time_efficiency: number;
    runs: number;
    observed_at: string;
    acquisition_cost: string | null;
    acquisition_runs: number | null;
    }[];
  const contractRows = store.sql.prepare(
    "SELECT contract_id,location_id,price,expires_at,items_payload,observed_at FROM production_contract_sources WHERE coverage_status='available' AND expires_at>? AND observed_at>? ORDER BY contract_id",
  ).all(new Date().toISOString(), new Date(Date.now() - 60 * 60 * 1000).toISOString()) as {
    contract_id: string; location_id: string | null; price: string; expires_at: string | null;
    items_payload: string | null; observed_at: string;
  }[];
  const contractBlueprints = contractRows.flatMap((contract) => {
    const payload = JSON.parse(contract.items_payload ?? "{}") as {
      title?: string; blueprintOnly?: boolean; includedItemCount?: number; items?: PublicProductionData["publicBlueprintContracts"][number]["items"];
    };
    const items = applyPublicBlueprintConfirmations(contract.contract_id, payload.items ?? []);
    const bundle = groupKnownBpcCopies({
      contractId: contract.contract_id,
      locationId: contract.location_id ?? "",
      price: contract.price,
      blueprintOnly: payload.blueprintOnly === true,
      items,
    });
    if (!bundle) return [];
    return bundle.groups.map((group) => ({
      contract,
      title: payload.title ?? "Публичный контракт",
      item: group.item,
      copies: group.copies,
      groupRuns: group.runs,
      bundleRuns: bundle.bundleRuns,
    }));
  });
  if (!blueprints.length && !contractBlueprints.length) return empty;
  if (blueprints.some((blueprint) => !isFreshTimestamp(blueprint.observed_at, 7 * 24 * 60 * 60 * 1000))) return empty;
  const activeBlueprintAllocations = store.sql.prepare(
    `SELECT a.blueprint_source_id,sum(a.runs) AS runs,count(*) AS allocations
     FROM blueprint_run_allocations a JOIN production_projects p ON p.id=a.project_id
     WHERE p.status NOT IN ('cancelled','completed') GROUP BY a.blueprint_source_id`,
  ).all() as { blueprint_source_id: string; runs: number; allocations: number }[];
  const allocatedBlueprints = new Map(activeBlueprintAllocations.map((row) => [row.blueprint_source_id, row]));

  const regions = [...new Set(hubStations.map((station) => station.regionId))];
  const structureLocations = facilityRows
    .filter((row) => row.facility_kind === "structure" && hubSystems.has(row.system_id))
    .map((row) => row.location_id);
  const allowedLocations = new Set([...hubStations.map((station) => station.id), ...structureLocations]);
  const marketData = productionMarketOrders(regions, allowedLocations);
  if (!marketData.complete) return empty;
  const now = Date.now();
  if (marketData.snapshots.some((snapshot) => !isUnexpiredTimestamp(snapshot.expiresAt, now))) return empty;
  const staleBefore = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const adjustedObserved = store.sql.prepare("SELECT max(observed_at) observed FROM production_adjusted_prices").get() as { observed: string | null };
  const indexObserved = store.sql.prepare("SELECT max(observed_at) observed FROM production_system_indices WHERE activity='manufacturing'").get() as { observed: string | null };
  const effectiveSkills = effectiveAlphaSkills(profile, productionStatic);
  const availableManufacturingSlots = manufacturingJobSlots(effectiveSkills, productionStatic);
  const activeManufacturingJobs = (store.sql.prepare(
    "SELECT payload FROM production_jobs WHERE character_id=?",
  ).all(main.id) as { payload: string }[])
    .map(({ payload }) => JSON.parse(payload) as {
      blueprint_id: string; activity_id: number; status: string; end_date: string;
    })
    .filter((job) => job.activity_id === 1 && ["active", "paused"].includes(job.status))
    .map((job) => ({ blueprintId: job.blueprint_id, status: job.status, endAt: job.end_date }));
  const projectOutputLots = store.sql.prepare(
    `SELECT l.id,l.project_id,l.type_id,l.remaining,l.unit_cost,
            coalesce(json_extract(n.payload,'$.facilityId'),json_extract(p.payload,'$.facilityId')) AS location_id,
            l.remaining-coalesce((SELECT sum(a.quantity-a.consumed_quantity) FROM project_lot_allocations a
                                  WHERE a.source_lot_id=l.id AND a.status='reserved'),0) AS available
     FROM project_output_lots l
     JOIN production_projects p ON p.id=l.project_id
     LEFT JOIN project_nodes n ON n.id=l.node_id
     WHERE p.status<>'cancelled' AND l.remaining>0
     ORDER BY l.created_at,l.id`,
  ).all() as { id: string; project_id: string; type_id: string; remaining: number; unit_cost: string; location_id: string | null; available: number }[];
  if (!adjustedObserved.observed || adjustedObserved.observed < staleBefore ||
      !indexObserved.observed || indexObserved.observed < staleBefore) return empty;
  const reservationAmounts = store.sql.prepare("SELECT amount FROM production_reservations WHERE paid=0").all() as { amount: string }[];
    const reservedCapital = reservationAmounts.reduce((total, row) => total.plus(row.amount), D(0));
  const availableBalance = D(main.balance ?? "0").minus(reservedCapital);
  const profileKey = JSON.stringify([
    marketData.snapshots.map((snapshot) => snapshot.id),
    profileRow.observed_at,
    profiles.map(({ row }) => [row.location_id, row.observed_at]),
    (store.sql.prepare(
      `SELECT location_id,output_type_id,system_cost_multiplier,material_bonus_percent,time_bonus_percent,broker_fee_rate,observed_at
       FROM production_structure_product_profiles ORDER BY location_id,output_type_id`,
    ).all() as { location_id: string; output_type_id: string; system_cost_multiplier: string; material_bonus_percent: number; time_bonus_percent: number; broker_fee_rate: string; observed_at: string }[])
      .map((modifier) => [modifier.location_id, modifier.output_type_id, modifier.system_cost_multiplier, modifier.material_bonus_percent, modifier.time_bonus_percent, modifier.broker_fee_rate, modifier.observed_at]),
    blueprints.map((blueprint) => [blueprint.item_id, blueprint.observed_at, blueprint.acquisition_cost, blueprint.acquisition_runs]),
    contractBlueprints.map(({ contract, item, copies, groupRuns, bundleRuns }) => [contract.contract_id, contract.observed_at, contract.price, contract.location_id, item.recordId, item.typeId, item.materialEfficiency, item.timeEfficiency, item.runs, copies, groupRuns, bundleRuns]),
    activeBlueprintAllocations.map((allocation) => [allocation.blueprint_source_id, allocation.runs, allocation.allocations]),
    projectOutputLots.map((lot) => [lot.id, lot.available, lot.unit_cost, lot.location_id]),
    profileRow.race,
    main.balance,
    reservedCapital.toFixed(2),
    adjustedObserved.observed,
    indexObserved.observed,
    store.sql.prepare("SELECT value FROM sync_cursors WHERE key='history-revision'").get(),
    availableManufacturingSlots,
    activeManufacturingJobs.map((job) => [
      job.blueprintId,
      job.status,
      Number.isFinite(Date.parse(job.endAt))
        ? Math.max(0, Math.ceil((Date.parse(job.endAt) - Date.now()) / 60_000))
        : job.endAt,
    ]),
  ]);
  const marketBpoScanKey = JSON.stringify([
    marketData.snapshots.map((snapshot) => snapshot.id),
    profileRow.observed_at,
    profileRow.race,
    profiles.map(({ row }) => [row.location_id, row.observed_at]),
    blueprints.map((blueprint) => [blueprint.item_id, blueprint.observed_at, blueprint.acquisition_cost, blueprint.acquisition_runs]),
    contractBlueprints.map(({ contract, item }) => [contract.contract_id, contract.observed_at, contract.location_id, item.recordId, item.typeId]),
    main.balance,
    reservedCapital.toFixed(2),
    adjustedObserved.observed,
    indexObserved.observed,
    store.sql.prepare("SELECT value FROM sync_cursors WHERE key='history-revision'").get(),
  ]);
  const reuseProfileCache = productionOfferCacheKey === profileKey;
  const resumingMarketBpoScan = productionMarketBpoScanKey === marketBpoScanKey;
  if (reuseProfileCache && resumingMarketBpoScan && productionMarketBpoProgress >= productionMarketBpoTotal && productionContractProgress >= productionContractTotal)
    return productionOfferCache;
  if (!resumingMarketBpoScan) {
    productionMarketBpoProgress = 0;
    productionMarketBpoTotal = 0;
    productionContractProgress = 0;
    productionContractTotal = contractBlueprints.length;
    productionMarketBpoScanKey = marketBpoScanKey;
  }
  productionQuoteHandlers.clear();

  const systemById = new Map(productionStatic.systems.map((system) => [system.id, system]));
  const graph = new Graph(productionStatic.systems);
  const typeById = new Map(productionStatic.types.map((type) => [type.id, type]));
  const recipeByBlueprint = new Map(
    (productionStatic.manufacturing ?? []).map((recipe) => [recipe.blueprintTypeId, recipe]),
  );
  const recipeIds = new Set([
    ...blueprints.map((blueprint) => blueprint.blueprint_type_id),
    ...contractBlueprints.map(({ item }) => item.typeId),
  ]);
  const recipes = [...recipeIds].map((id) => recipeByBlueprint.get(id)).filter((recipe) => !!recipe);
  // Include inputs recursively for every recipe backed by an owned/contract BPO or BPC.
  const availableRecipeIds = new Set(recipeIds);
  const recipeByOutput = new Map<string, (typeof recipes)[number][]>();
  for (const recipe of recipes) for (const product of recipe.products) {
    const rows = recipeByOutput.get(product.typeId) ?? [];
    rows.push(recipe);
    recipeByOutput.set(product.typeId, rows);
  }
  const neededTypeIds = new Set<string>();
  // BPOs are sold on the regional market under their blueprint type ID. Include
  // the catalog here so acquisition candidates are drawn from the same coherent
  // Jita/Perimeter snapshot as material and product orders.
  for (const recipe of productionStatic.manufacturing ?? []) {
    neededTypeIds.add(recipe.blueprintTypeId);
    for (const material of recipe.materials) neededTypeIds.add(material.typeId);
    for (const product of recipe.products) neededTypeIds.add(product.typeId);
  }
  const queue = recipes.flatMap((recipe) => recipe.materials.map((material) => material.typeId));
  while (queue.length) {
    const typeId = queue.pop()!;
    if (neededTypeIds.has(typeId)) continue;
    neededTypeIds.add(typeId);
    for (const child of recipeByOutput.get(typeId) ?? [])
      if (availableRecipeIds.has(child.blueprintTypeId))
        for (const material of child.materials) queue.push(material.typeId);
  }
  for (const recipe of recipes) for (const product of recipe.products) neededTypeIds.add(product.typeId);
  const orderByType = new Map<string, Order[]>();
  for (const order of marketData.orders) {
    if (!neededTypeIds.has(order.type_id)) continue;
    const list = orderByType.get(order.type_id) ?? [];
    list.push(order);
    orderByType.set(order.type_id, list);
  }
  const adjustedPrices = new Map(
    (store.sql.prepare("SELECT type_id,adjusted_price FROM production_adjusted_prices").all() as { type_id: string; adjusted_price: string }[])
      .map((row) => [row.type_id, row.adjusted_price]),
  );
  const indices = new Map(
    (store.sql.prepare("SELECT system_id,cost_index FROM production_system_indices WHERE activity='manufacturing'").all() as { system_id: string; cost_index: string }[])
      .map((row) => [row.system_id, row.cost_index]),
  );
  const structureProductProfiles = store.sql.prepare(
    `SELECT location_id,output_type_id,system_cost_multiplier,material_bonus_percent,time_bonus_percent,broker_fee_rate,observed_at
     FROM production_structure_product_profiles`,
  ).all() as {
    location_id: string;
    output_type_id: string;
    system_cost_multiplier: string;
    material_bonus_percent: number;
    time_bonus_percent: number;
    broker_fee_rate: string;
    observed_at: string;
  }[];
  const structureModifiers = new Map(structureProductProfiles.map((modifier) =>
    [`${modifier.location_id}:${modifier.output_type_id}`, isFreshTimestamp(modifier.observed_at, 7 * 24 * 60 * 60 * 1000) ? modifier : undefined] as const,
  ));
  const skillLevels = new Map(effectiveSkills.map((skill) => [skill.typeId, skill.usableLevel]));
  const skill = (id: string) => skillLevels.get(id) ?? 0;
  const nameOf = (id: string) => typeById.get(id)?.name ?? `Type ${id}`;
  const balance = availableBalance.gt(0) ? availableBalance.toFixed(2) : "0.00";
  const offers: AppState["production"]["offers"] = [];
  const contractOffers: AppState["production"]["contractOffers"] = [];
  const sourcingLocationNames = new Map([
    ...hubStations.map((station) => [station.id, station.name] as const),
    ...facilityRows.filter((row) => structureLocations.includes(row.location_id)).map((row) => [row.location_id, row.name] as const),
  ]);
  const historyByTypeRegion = new Map<string, HistoryDay[]>();
  const historyFor = (typeId: string, regionId: string) => {
    const key = `${typeId}:${regionId}`;
    let rows = historyByTypeRegion.get(key);
    if (!rows) {
      rows = (store.sql.prepare(
        "SELECT payload FROM regional_history WHERE type_id=? AND region_id=? ORDER BY date DESC LIMIT 90",
      ).all(typeId, regionId) as { payload: string }[])
        .map((row) => JSON.parse(row.payload) as HistoryDay);
      historyByTypeRegion.set(key, rows);
    }
    return rows;
  };
  const regionName = (regionId: string) =>
    regionId === "10000002" ? "The Forge" : `Region ${regionId}`;
  const orderLevels = (typeId: string, side: "supply" | "demand", station: Station) => {
    const system = systemById.get(station.systemId);
    if (!system) return [];
    return (orderByType.get(typeId) ?? [])
      .filter((order) => side === "supply"
        ? !order.is_buy_order && order.location_id === station.id
        : order.is_buy_order && graph.buyApplies({
            locationId: order.location_id,
            systemId: order.system_id,
            regionId: systemById.get(order.system_id)?.regionId ?? "",
            range: order.range,
          }, station))
      .map((order) => ({
        id: order.order_id,
        price: order.price,
        quantity: order.volume_remain,
        minVolume: order.min_volume,
        locationId: order.location_id,
        locationName: sourcingLocationNames.get(order.location_id) ?? `Структура ${order.location_id}`,
      }));
  };
  const supplyLevels = (typeId: string) => (orderByType.get(typeId) ?? [])
    .filter((order) => !order.is_buy_order && allowedLocations.has(order.location_id))
    .map((order) => ({
      id: order.order_id,
      price: order.price,
      quantity: order.volume_remain,
      minVolume: order.min_volume,
      locationId: order.location_id,
      locationName: sourcingLocationNames.get(order.location_id) ?? `Структура ${order.location_id}`,
    }));
  const chainSupplyLevels = (typeId: string, station: Station) => [
    ...supplyLevels(typeId),
    ...projectOutputLots
      .filter((lot) => lot.type_id === typeId && lot.location_id === station.id && lot.available > 0)
      .map((lot) => ({
        id: `project-lot:${lot.id}`,
        inventoryLotId: lot.id,
        price: lot.unit_cost,
        quantity: lot.available,
        locationId: station.id,
        locationName: station.name,
      })),
  ];
  // The material book is invariant across run-count estimates. Building it in
  // estimateWithChain used to rescan every relevant type for every candidate
  // run count (up to 96 per blueprint), which stalled startup on a full hub
  // snapshot. Keep one immutable ask map per facility for this calculation.
  const chainAsksByStation = new Map<string, Map<string, ReturnType<typeof chainSupplyLevels>>>();
  const chainAsksAt = (station: Station) => {
    let asks = chainAsksByStation.get(station.id);
    if (!asks) {
      asks = new Map([...neededTypeIds].map((typeId) => [typeId, chainSupplyLevels(typeId, station)]));
      chainAsksByStation.set(station.id, asks);
    }
    return asks;
  };
  const rootBlueprintCandidates: (typeof blueprints[number] & {
    sourceKind: "owned" | "market_bpo";
    purchaseOrderId: string | null;
    purchaseCashCost: string | null;
  })[] = blueprints.map((blueprint) => ({
    ...blueprint,
    sourceKind: "owned" as const,
    purchaseOrderId: null,
    purchaseCashCost: blueprint.runs === -1 ? blueprint.acquisition_cost : null,
  }));
  const ownedAt = (blueprintTypeId: string, locationId: string) =>
    blueprints.some((blueprint) => blueprint.blueprint_type_id === blueprintTypeId && blueprint.location_id === locationId) ||
    contractBlueprints.some(({ contract, item }) => item.typeId === blueprintTypeId && contract.location_id === locationId);
  const marketBpoListings: { recipe: NonNullable<typeof productionStatic.manufacturing>[number]; station: (typeof hubStations)[number]; order: Order }[] = [];
  for (const { station } of profiles) {
    for (const recipe of productionStatic.manufacturing ?? []) {
      if (ownedAt(recipe.blueprintTypeId, station.id) || missingManufacturingSkills(recipe.skills, effectiveSkills).length) continue;
      const output = recipe.products[0];
      if (!output || !orderLevels(output.typeId, "demand", station)
        .some((level) => level.quantity >= output.quantity && level.minVolume <= output.quantity)) continue;
      const order = (orderByType.get(recipe.blueprintTypeId) ?? [])
        .filter((candidate) => !candidate.is_buy_order && candidate.location_id === station.id && candidate.volume_remain > 0 && candidate.min_volume <= 1)
        .sort((left, right) => D(left.price).comparedTo(right.price))[0];
      if (!order) continue;
      marketBpoListings.push({ recipe, station, order });
    }
  }
  marketBpoListings.sort((left, right) => D(left.order.price).comparedTo(right.order.price));
  // Evaluate every feasible market BPO. Progress is incremental so the initial
  // app state can show owned-blueprint offers before this full scan completes.
  const boundedMarketBpos = marketBpoListings;
  productionMarketBpoTotal = boundedMarketBpos.length;
  // Return the owned-blueprint results immediately, then score a small batch
  // on each app-state refresh. This keeps the market tab responsive while every
  // eligible acquisition source is evaluated in the background.
  const marketBpoBatchSize = 32;
  const selectedMarketBpos = resumingMarketBpoScan && productionMarketBpoProgress < boundedMarketBpos.length
    ? boundedMarketBpos.slice(productionMarketBpoProgress, productionMarketBpoProgress + marketBpoBatchSize)
    : [];
  for (const { recipe, station, order } of selectedMarketBpos) {
      rootBlueprintCandidates.push({
        item_id: `market-bpo:${recipe.blueprintTypeId}:${station.id}:${order.order_id}`,
        blueprint_type_id: recipe.blueprintTypeId,
        location_id: station.id,
        material_efficiency: 0,
        time_efficiency: 0,
        runs: -1,
        observed_at: marketData.snapshots.map((snapshot) => snapshot.modifiedAt).sort().at(-1) ?? new Date().toISOString(),
        acquisition_cost: null,
        acquisition_runs: null,
        sourceKind: "market_bpo",
        purchaseOrderId: order.order_id,
        purchaseCashCost: order.price,
      });
  }
  const marketBpoCandidateCount = resumingMarketBpoScan
    ? Math.min(productionMarketBpoProgress + selectedMarketBpos.length, boundedMarketBpos.length)
    : 0;
  const contractBatchSize = 8;
  const selectedContractBlueprints = resumingMarketBpoScan && productionContractProgress < contractBlueprints.length
    ? contractBlueprints.slice(productionContractProgress, productionContractProgress + contractBatchSize)
    : [];
  const chainRecipesAt = (station: Station, forcedRoot: ChainRecipe): ChainRecipe[] => {
    // A structure's rig modifiers are output-specific. Until the exact modifiers
    // for every intermediate product are confirmed, buy chain components instead
    // of silently pricing them with NPC-station assumptions.
    if (profiles.some(({ row }) => row.location_id === station.id && row.facility_kind === "structure"))
      return [forcedRoot];
    const children: ChainRecipe[] = [];
    for (const blueprint of blueprints) {
      if (blueprint.location_id !== station.id) continue;
      const recipe = recipeByBlueprint.get(blueprint.blueprint_type_id);
      if (!recipe || recipe.products.length !== 1 || missingManufacturingSkills(recipe.skills, effectiveSkills).length) continue;
      const output = recipe.products[0]!;
      const allocated = allocatedBlueprints.get(blueprint.item_id);
      const freeRuns = availableBlueprintRuns(blueprint.runs, allocated?.runs ? [allocated.runs] : [], recipe.maxProductionLimit);
      if (freeRuns <= 0) continue;
      children.push({
        id: `blueprint:${blueprint.item_id}`,
        blueprintId: blueprint.item_id,
        outputTypeId: output.typeId,
        outputPerRun: output.quantity,
        maxRuns: Math.min(recipe.maxProductionLimit, freeRuns === -1 ? recipe.maxProductionLimit : freeRuns),
        availableRuns: freeRuns,
        reusableBlueprint: blueprint.runs === -1,
        facilityId: station.id,
        timeSecondsForRuns: (runs) => manufacturingTimeSeconds(recipe, runs, blueprint.time_efficiency, effectiveSkills),
        fixedCostForRuns: (runs) => manufacturingValueAndFee(recipe, runs, adjustedPrices, indices.get(station.systemId) ?? null)?.installationFee ?? null,
        materialsForRuns: (runs) => recipe.materials.map((material) => ({
          typeId: material.typeId,
          quantity: jobMaterialQuantity(material, runs, blueprint.material_efficiency),
        })),
      });
    }
    return [forcedRoot, ...children];
  };
  const estimateWithChain = (direct: ManufacturingEstimate, recipe: NonNullable<typeof recipes[number]>, station: Station, rootBlueprintItemId: string, blueprintAcquisitionCost: string | null = null, blueprintAcquisitionAlreadyPaid = false, blueprintPurchaseCashCost: string | null = null, blueprintReusable = false): { estimate: ManufacturingEstimate; plan: ChainPlan } => {
    const rootId = `forced-root:${rootBlueprintItemId}`;
    const root: ChainRecipe = {
      id: rootId, blueprintId: rootBlueprintItemId, outputTypeId: direct.outputTypeId, outputPerRun: direct.outputQuantity,
      maxRuns: 1, availableRuns: 1, reusableBlueprint: false, facilityId: station.id,
      timeSecondsForRuns: () => direct.timeSeconds,
      fixedCostForRuns: () => direct.installationFee === null ? null : D(direct.installationFee).plus(blueprintAcquisitionCost ?? "0").toFixed(2),
      materialsForRuns: () => direct.materials.map((material) => ({ typeId: material.typeId, quantity: material.quantity })),
    };
    const plan = planMakeBuyChain({
      targetTypeId: direct.outputTypeId,
      targetQuantity: direct.outputQuantity,
      recipes: chainRecipesAt(station, root),
      asksByType: chainAsksAt(station),
      forceTargetRecipeId: rootId,
      maxSearchStates: 2_500,
    });
    const namedPlan: ChainPlan = {
      ...plan,
      actions: plan.actions.map((action) => ({
        ...action,
        typeName: nameOf(action.typeId),
        facilityName: action.facilityId ? sourcingLocationNames.get(action.facilityId) ?? action.facilityId : null,
      })),
    };
    const scheduledPlan = scheduleChainPlan({
      plan: namedPlan,
      availableSlots: availableManufacturingSlots,
      activeJobs: activeManufacturingJobs,
    });
    if (scheduledPlan.status !== "ready" || scheduledPlan.schedule?.status !== "ready" || scheduledPlan.totalCost === null || direct.installationFee === null) {
      const reviewEstimate: ManufacturingEstimate = {
        ...direct,
        status: "review",
        totalCost: null,
        cashRequired: null,
        materialsCost: null,
        immediate: { ...direct.immediate, netProfit: null, roi: null },
        sellOrder: { ...direct.sellOrder, netProfit: null, roi: null },
        firstCycleProfit: { immediate: null, sellOrder: null },
        firstCycleRoi: { immediate: null, sellOrder: null },
        blueprintPaybackBatches: { immediate: null, sellOrder: null },
        reasons: [...direct.reasons, "Полная цепочка make/buy не подтверждена; прибыль и себестоимость прямой закупки не являются итоговой оценкой."],
        warnings: [...direct.warnings, ...scheduledPlan.reasons, ...(scheduledPlan.schedule?.reasons ?? [])],
      };
      return { estimate: reviewEstimate, plan: scheduledPlan };
    }
    const materialPurchases = namedPlan.actions.filter((action) => action.kind === "purchase").reduce((total, action) => total.plus(action.cost), D(0));
    const allocatedInventoryCost = namedPlan.actions
      .flatMap((action) => action.kind === "purchase" ? action.sources ?? [] : [])
      .filter((source) => source.inventoryLotId)
      .reduce((total, source) => total.plus(D(source.unitCost).mul(source.quantity)), D(0));
    const totalCost = scheduledPlan.totalCost;
    const immediate = direct.immediate.filled === direct.outputQuantity
      ? pnl(totalCost, direct.immediate.gross, direct.fees.salesTaxRate)
      : null;
    const sellListing = direct.sellOrder.gross === null ? null : listingFee(direct.sellOrder.gross, direct.fees.brokerFeeRate);
    const passive = direct.sellOrder.gross !== null && sellListing !== null
      ? pnl(totalCost, direct.sellOrder.gross, direct.fees.salesTaxRate, sellListing)
      : null;
    const cashRequired = isk(D(totalCost)
      .minus(allocatedInventoryCost)
      .minus(blueprintAcquisitionAlreadyPaid ? blueprintAcquisitionCost ?? "0" : "0")
      .plus(!blueprintAcquisitionAlreadyPaid
        ? D(blueprintPurchaseCashCost ?? blueprintAcquisitionCost ?? "0").minus(blueprintAcquisitionCost ?? "0")
        : "0"));
    const reasons = direct.reasons.filter((reason) => !reason.startsWith("Недостаточная sell-глубина по материалам:") && reason !== "Полная себестоимость пока не рассчитана");
    const capital = blueprintCapitalMetrics(
      blueprintReusable,
      direct.blueprintAcquisitionCost,
      direct.blueprintPurchaseCashCost,
      immediate?.profit ?? null,
      passive?.profit ?? null,
      cashRequired,
      blueprintAcquisitionAlreadyPaid,
    );
    const estimate: ManufacturingEstimate = {
      ...direct,
      status: reasons.length ? "review" : "ready",
      reasons,
      materialsCost: isk(materialPurchases),
      totalCost,
      blueprintPurchaseCashCost: capital.purchaseCashCost,
      firstCycleProfit: capital.firstCycleProfit,
      firstCycleRoi: capital.firstCycleRoi,
      blueprintPaybackBatches: capital.paybackBatches,
      cashRequired,
      timeSeconds: direct.timeSeconds,
      immediate: { ...direct.immediate, netProfit: immediate?.profit ?? null, roi: immediate?.roi ?? null },
      sellOrder: { ...direct.sellOrder, netProfit: passive?.profit ?? null, roi: passive?.roi ?? null },
      warnings: [...direct.warnings.filter((warning) => !warning.includes("материал")), "Себестоимость включает покупки и изготовление компонентов по полному плану цепочки."],
    };
    return { estimate, plan: scheduledPlan };
  };
  for (const blueprint of rootBlueprintCandidates) {
    const recipe = recipeByBlueprint.get(blueprint.blueprint_type_id);
    if (!recipe) continue;
    const allocation = allocatedBlueprints.get(blueprint.item_id);
    const allocationRuns = allocation?.runs ? [allocation.runs] : [];
    const freeRuns = availableBlueprintRuns(blueprint.runs, allocationRuns, recipe.maxProductionLimit);
    if (freeRuns === 0) continue;
    const output = recipe.products[0];
    if (!output) continue;
    for (const { row, station } of profiles) {
      if (blueprint.location_id !== station.id) continue;
      const demand = orderLevels(output.typeId, "demand", station);
      if (!demand.length) continue;
      const demandQuantity = demand.reduce((total, order) => total + order.quantity, 0);
      const maxRuns = Math.min(
        recipe.maxProductionLimit,
        freeRuns === -1 ? recipe.maxProductionLimit : freeRuns,
        Math.floor(demandQuantity / output.quantity),
      );
      if (!maxRuns) continue;
      const supplyTypeIds = new Set([...recipe.materials, ...recipe.products].map((material) => material.typeId));
      const supply = new Map([...supplyTypeIds].map((typeId) => [typeId, supplyLevels(typeId)]));
      // Exit prices are executable only at this facility. Material acquisition may
      // use other confirmed hub books, but that requires manual hauling.
      supply.set(output.typeId, orderLevels(output.typeId, "supply", station));
      const demandMap = new Map([[output.typeId, demand]]);
      const costIndex = indices.get(station.systemId) ?? null;
      const structureModifier = row.facility_kind === "structure"
        ? structureModifiers.get(`${station.id}:${output.typeId}`)
        : undefined;
      const directEstimateAt = (runs: number): ManufacturingEstimate => estimateManufacturing({
        recipe,
        runs,
        blueprint: {
          itemId: blueprint.item_id,
          materialEfficiency: blueprint.material_efficiency,
          timeEfficiency: blueprint.time_efficiency,
          remainingRuns: blueprint.runs,
          locationId: blueprint.location_id,
        },
        blueprintAcquisitionCost: allocateBlueprintAcquisitionCost(
          blueprint.acquisition_cost,
          blueprint.acquisition_runs,
          runs,
        ),
        blueprintPurchaseCashCost: blueprint.purchaseCashCost,
        blueprintAcquisitionAlreadyPaid: blueprint.sourceKind === "owned",
        facility: {
          id: station.id,
          kind: row.facility_kind,
          accessStatus: row.access_status,
          services: JSON.parse(row.services_payload) as string[],
          taxRate: row.industry_tax,
          costIndex,
          ...(row.facility_kind === "structure" ? {
            systemCostMultiplier: structureModifier?.system_cost_multiplier ?? null,
            materialBonusPercent: structureModifier?.material_bonus_percent ?? null,
            timeBonusPercent: structureModifier?.time_bonus_percent ?? null,
            brokerFeeRate: structureModifier?.broker_fee_rate ?? null,
          } : {}),
        },
        skills: effectiveSkills,
        supply,
        demand: demandMap,
        adjustedPrices,
        materialNames: new Map(recipe.materials.map((material) => [material.typeId, nameOf(material.typeId)])),
        seller: {
          accounting: skill("16622"),
          brokerRelations: skill("3446"),
          advancedBrokerRelations: skill("16597"),
          factionStanding: profile.standings.find((standing) =>
            standing.from_type === "faction" && standing.from_id === station.factionId)?.standing ?? "0",
          corporationStanding: profile.standings.find((standing) =>
            standing.from_type === "npc_corp" && standing.from_id === station.ownerId)?.standing ?? "0",
        },
      });
      const chainCache = new Map<number, { estimate: ManufacturingEstimate; plan: ChainPlan }>();
      const planAt = (runs: number) => {
        const cached = chainCache.get(runs);
        if (cached) return cached;
        const acquisitionCost = allocateBlueprintAcquisitionCost(
          blueprint.acquisition_cost,
          blueprint.acquisition_runs,
          runs,
        );
        const result = estimateWithChain(
          directEstimateAt(runs), recipe, station, blueprint.item_id, acquisitionCost,
          blueprint.sourceKind === "owned", blueprint.purchaseCashCost, blueprint.runs === -1,
        );
        chainCache.set(runs, result);
        return result;
      };
      const estimateAt = (runs: number) => planAt(runs).estimate;
      // Run count is bounded by physical blueprint and sell depth. Evaluate only
      // market-depth breakpoints so chain optimization stays bounded on large markets.
      const low = maxRuns;
      const quoteKey = `${blueprint.item_id}:${station.id}`;
      if (blueprint.sourceKind === "owned")
        productionQuoteHandlers.set(quoteKey, { maxRuns: low, estimateAt });
      const candidates = new Set<number>([1, low]);
      const addRunBoundary = (boundary: number) => {
        for (const runCount of [boundary - 1, boundary, boundary + 1])
          if (runCount >= 1 && runCount <= low) candidates.add(runCount);
      };
      for (const material of recipe.materials) {
        let cumulative = 0;
        const materialBonus = row.facility_kind === "structure"
          ? structureModifier?.material_bonus_percent ?? 0
          : 0;
        for (const level of supply.get(material.typeId) ?? []) {
          cumulative += level.quantity;
          let minRun = 0;
          let maxRun = low;
          while (minRun < maxRun) {
            const mid = Math.ceil((minRun + maxRun) / 2);
            const required = jobMaterialQuantity(material, mid, blueprint.material_efficiency, materialBonus);
            if (required <= cumulative) minRun = mid;
            else maxRun = mid - 1;
          }
          addRunBoundary(minRun);
        }
      }
      let cumulativeOutput = 0;
      for (const level of demand) {
        cumulativeOutput += level.quantity;
        let minRun = 0;
        let maxRun = low;
        while (minRun < maxRun) {
          const mid = Math.ceil((minRun + maxRun) / 2);
          if (output.quantity * mid <= cumulativeOutput) minRun = mid;
          else maxRun = mid - 1;
        }
        addRunBoundary(minRun);
      }
      const profitScore = (candidate: ManufacturingEstimate) => {
        const immediateValue = blueprint.sourceKind === "market_bpo" ? candidate.firstCycleProfit.immediate : candidate.immediate.netProfit;
        const sellValue = blueprint.sourceKind === "market_bpo" ? candidate.firstCycleProfit.sellOrder : candidate.sellOrder.netProfit;
        const immediate = immediateValue === null ? D(-1) : D(immediateValue);
        const sell = sellValue === null ? D(-1) : D(sellValue);
        return immediate.gt(sell) ? immediate : sell;
      };
      let estimate: ManufacturingEstimate | null = null;
      let bestProfit = D(0);
      for (const runCount of candidates) {
        const candidate = estimateAt(runCount);
        if (candidate.status !== "ready" || candidate.cashRequired === null || D(candidate.cashRequired).gt(balance)) continue;
        const score = profitScore(candidate);
        if (score.gt(bestProfit)) { bestProfit = score; estimate = candidate; }
      }
      // Do not hide a structure recipe just because one of its confirmed
      // product-specific inputs is absent. Surface a review-only one-run quote
      // so the card can explain exactly what the player still needs to verify.
      if (!estimate && row.facility_kind === "structure") estimate = estimateAt(1);
      if (!estimate) continue;
      const selectedRuns = productionRequestedRuns.get(quoteKey) ?? estimate.runs;
      if (selectedRuns <= low) {
        const requestedEstimate = estimateAt(selectedRuns);
        if (requestedEstimate.status === "ready" && requestedEstimate.cashRequired !== null && D(requestedEstimate.cashRequired).lte(balance))
          estimate = requestedEstimate;
      }
      const productName = nameOf(output.typeId);
      const marketSignal = productionMarketSignal({
        history: historyFor(output.typeId, station.regionId),
        asOf: new Date().toISOString(),
        regionName: regionName(station.regionId),
        outputQuantity: estimate.outputQuantity,
        bids: orderLevels(output.typeId, "demand", station),
        asks: orderLevels(output.typeId, "supply", station),
      });
      offers.push({
        id: `${blueprint.item_id}:${station.id}:${estimate.runs}`,
        itemName: productName,
        itemEnglishName: typeById.get(output.typeId)?.englishName ?? productName,
        blueprintTypeName: nameOf(blueprint.blueprint_type_id),
        blueprintSource: {
          kind: blueprint.sourceKind,
          purchaseOrderId: blueprint.purchaseOrderId,
          purchasePrice: blueprint.purchaseCashCost,
        },
        facilityName: row.name,
        systemId: station.systemId,
        runs: estimate.runs,
        maxRuns: low,
        estimate,
        chainPlan: chainCache.get(estimate.runs)?.plan ?? planAt(estimate.runs).plan,
        chainExecutable: blueprint.sourceKind === "owned" && chainCache.get(estimate.runs)?.plan.status === "ready",
        marketSignal,
        observedAt: marketData.snapshots.map((snapshot) => snapshot.modifiedAt).sort().at(-1) ?? row.observed_at,
      });
    }
  }
  for (const candidate of selectedContractBlueprints) {
    const { contract, item } = candidate;
    const recipe = recipeByBlueprint.get(item.typeId);
    const station = hubStations.find((entry) => entry.id === contract.location_id);
    const profileAtStation = profiles.find((entry) => entry.station.id === station?.id);
    if (!recipe || !station || !profileAtStation || item.runs === null || item.materialEfficiency === null || item.timeEfficiency === null) continue;
    const output = recipe.products[0];
    if (!output || item.runs > recipe.maxProductionLimit) continue;
    const demand = orderLevels(output.typeId, "demand", station);
    if (!demand.length) continue;
    const demandQuantity = demand.reduce((total, order) => total + order.quantity, 0);
    const maxRuns = Math.min(item.runs, recipe.maxProductionLimit, Math.floor(demandQuantity / output.quantity));
    if (!maxRuns) continue;
    const supplyTypeIds = new Set([...recipe.materials, ...recipe.products].map((material) => material.typeId));
    const supply = new Map([...supplyTypeIds].map((typeId) => [typeId, supplyLevels(typeId)]));
    const demandMap = new Map([[output.typeId, demand]]);
    const costIndex = indices.get(station.systemId) ?? null;
    const estimateAt = (runs: number) => estimateManufacturing({
      recipe,
      runs,
      blueprint: {
        itemId: item.recordId,
        materialEfficiency: item.materialEfficiency!,
        timeEfficiency: item.timeEfficiency!,
        remainingRuns: item.runs!,
        locationId: contract.location_id!,
      },
      blueprintAcquisitionCost: allocateBpcBundleCost(contract.price, candidate.bundleRuns, runs),
      blueprintPurchaseCashCost: contract.price,
      facility: {
        id: station.id,
        kind: "npc_station",
        accessStatus: profileAtStation.row.access_status,
        services: JSON.parse(profileAtStation.row.services_payload) as string[],
        taxRate: profileAtStation.row.industry_tax,
        costIndex,
      },
      skills: effectiveSkills,
      supply,
      demand: demandMap,
      adjustedPrices,
      materialNames: new Map(recipe.materials.map((material) => [material.typeId, nameOf(material.typeId)])),
      seller: {
        accounting: skill("16622"),
        brokerRelations: skill("3446"),
        advancedBrokerRelations: skill("16597"),
        factionStanding: profile.standings.find((standing) => standing.from_type === "faction" && standing.from_id === station.factionId)?.standing ?? "0",
        corporationStanding: profile.standings.find((standing) => standing.from_type === "npc_corp" && standing.from_id === station.ownerId)?.standing ?? "0",
      },
    });
    let low = 0;
    let high = maxRuns;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      const estimate = estimateAt(mid);
      if (estimate.status === "ready" && estimate.cashRequired !== null && D(estimate.cashRequired).lte(balance)) low = mid;
      else high = mid - 1;
    }
    if (!low) continue;
    const runCandidates = new Set<number>([1, low]);
    const addBoundary = (boundary: number) => {
      for (const runCount of [boundary - 1, boundary, boundary + 1])
        if (runCount >= 1 && runCount <= low) runCandidates.add(runCount);
    };
    for (const material of recipe.materials) {
      let cumulative = 0;
      for (const level of supply.get(material.typeId) ?? []) {
        cumulative += level.quantity;
        let minRuns = 0;
        let maxCandidateRuns = low;
        while (minRuns < maxCandidateRuns) {
          const mid = Math.ceil((minRuns + maxCandidateRuns) / 2);
          const required = estimateAt(mid).materials.find((row) => row.typeId === material.typeId)?.quantity ?? Infinity;
          if (required <= cumulative) minRuns = mid;
          else maxCandidateRuns = mid - 1;
        }
        addBoundary(minRuns);
      }
    }
    let cumulativeDemand = 0;
    for (const level of demand) {
      cumulativeDemand += level.quantity;
      let minRuns = 0;
      let maxCandidateRuns = low;
      while (minRuns < maxCandidateRuns) {
        const mid = Math.ceil((minRuns + maxCandidateRuns) / 2);
        if (estimateAt(mid).outputQuantity <= cumulativeDemand) minRuns = mid;
        else maxCandidateRuns = mid - 1;
      }
      addBoundary(minRuns);
    }
    let best: ManufacturingEstimate | null = null;
    let bestProfit = D(0);
    for (const runCount of runCandidates) {
      const estimate = estimateAt(runCount);
      if (estimate.status !== "ready" || !estimate.cashRequired || D(estimate.cashRequired).gt(balance)) continue;
      const instant = estimate.immediate.netProfit === null ? D(-1) : D(estimate.immediate.netProfit);
      const passive = estimate.sellOrder.netProfit === null ? D(-1) : D(estimate.sellOrder.netProfit);
      const score = instant.gt(passive) ? instant : passive;
      if (score.gt(bestProfit)) { best = estimate; bestProfit = score; }
    }
    if (!best) continue;
    const allocatedBlueprintCost = allocateBpcBundleCost(contract.price, candidate.bundleRuns, best.runs);
    const chain = estimateWithChain(best, recipe, station, item.recordId, allocatedBlueprintCost, false, contract.price);
    const finalEstimate = chain.estimate;
    const outputName = nameOf(output.typeId);
    const payload = JSON.parse(contract.items_payload ?? "{}") as {
      title?: string; blueprintOnly?: boolean; includedItemCount?: number;
    };
    contractOffers.push({
      id: `${contract.contract_id}:${item.recordId}:${station.id}:${best.runs}`,
      contractId: contract.contract_id,
      contractTitle: candidate.title || payload.title || "Публичный контракт",
      contractPrice: contract.price,
      blueprintOnly: payload.blueprintOnly === true,
      includedItemCount: payload.includedItemCount ?? 1,
      expiresAt: contract.expires_at ?? "",
      pickupLocation: station.name,
      itemName: outputName,
      itemEnglishName: typeById.get(output.typeId)?.englishName ?? outputName,
      blueprintTypeName: nameOf(item.typeId),
      blueprintCopies: candidate.copies,
      bundleRuns: candidate.bundleRuns,
      facilityName: profileAtStation.row.name,
      systemId: station.systemId,
      runs: finalEstimate.runs,
      estimate: finalEstimate,
      chainPlan: chain.plan,
      marketSignal: productionMarketSignal({
        history: historyFor(output.typeId, station.regionId),
        asOf: new Date().toISOString(),
        regionName: regionName(station.regionId),
        outputQuantity: finalEstimate.outputQuantity,
        bids: demand,
        asks: orderLevels(output.typeId, "supply", station),
      }),
      contractObservedAt: contract.observed_at,
      observedAt: marketData.snapshots.map((snapshot) => snapshot.modifiedAt).sort().at(-1) ?? contract.observed_at,
    });
  }
  const offerScore = (estimate: ManufacturingEstimate, marketBpo: boolean) => {
    const immediateValue = marketBpo ? estimate.firstCycleProfit.immediate : estimate.immediate.netProfit;
    const sellValue = marketBpo ? estimate.firstCycleProfit.sellOrder : estimate.sellOrder.netProfit;
    const immediate = immediateValue === null ? D(-1) : D(immediateValue);
    const sell = sellValue === null ? D(-1) : D(sellValue);
    return immediate.gt(sell) ? immediate : sell;
  };
  offers.sort((a, b) => offerScore(b.estimate, b.blueprintSource.kind === "market_bpo")
    .comparedTo(offerScore(a.estimate, a.blueprintSource.kind === "market_bpo")));
  contractOffers.sort((a, b) => offerScore(b.estimate, true).comparedTo(offerScore(a.estimate, true)));
  productionMarketBpoProgress = resumingMarketBpoScan
    ? Math.min(productionMarketBpoProgress + selectedMarketBpos.length, boundedMarketBpos.length)
    : 0;
  productionContractProgress = resumingMarketBpoScan
    ? Math.min(productionContractProgress + selectedContractBlueprints.length, contractBlueprints.length)
    : 0;
  const mergedOffers = new Map<string, AppState["production"]["offers"][number]>();
  const mergedContractOffers = new Map<string, AppState["production"]["contractOffers"][number]>();
  if (resumingMarketBpoScan)
    for (const offer of productionOfferCache.offers) mergedOffers.set(offer.id, offer);
  if (resumingMarketBpoScan)
    for (const offer of productionOfferCache.contractOffers) mergedContractOffers.set(offer.id, offer);
  for (const offer of offers) mergedOffers.set(offer.id, offer);
  for (const offer of contractOffers) mergedContractOffers.set(offer.id, offer);
  productionOfferCacheKey = profileKey;
  productionOfferCache = {
    offers: [...mergedOffers.values()].sort((a, b) => offerScore(b.estimate, b.blueprintSource.kind === "market_bpo")
      .comparedTo(offerScore(a.estimate, a.blueprintSource.kind === "market_bpo"))).slice(0, 100),
    contractOffers: [...mergedContractOffers.values()].sort((a, b) => offerScore(b.estimate, true)
      .comparedTo(offerScore(a.estimate, true))).slice(0, 100),
    marketBpoCandidatesScanned: marketBpoCandidateCount,
    marketBpoCandidatesTotal: boundedMarketBpos.length,
    marketBpoScanComplete: productionMarketBpoProgress >= boundedMarketBpos.length,
    contractCandidatesScanned: productionContractProgress,
    contractCandidatesTotal: contractBlueprints.length,
    contractScanComplete: productionContractProgress >= contractBlueprints.length,
  };
  return productionOfferCache;
}
function reprocessingOffers(
  productionStatic: StaticData,
  main: AppState["characters"][number] | undefined,
): AppState["production"]["reprocessingOffers"] {
  if (!main || !market.data) return [];
  const hubSystems = new Set(["30000142", "30000144"]);
  const hubStations = productionStatic.stations.filter((station) => hubSystems.has(station.systemId));
  const profiles = (store.sql.prepare(
    "SELECT location_id,name,system_id,services_payload,access_status,reprocessing_yield_bonus,reprocessing_tax,observed_at FROM production_facility_profiles WHERE facility_kind='npc_station' AND access_status='confirmed'",
  ).all() as { location_id: string; name: string; system_id: string; services_payload: string; access_status: "confirmed"; reprocessing_yield_bonus: string | null; reprocessing_tax: string | null; observed_at: string }[])
    .map((row) => ({ row, station: hubStations.find((station) => station.id === row.location_id) }))
    .filter((entry): entry is typeof entry & { station: (typeof hubStations)[number] } => !!entry.station)
    .filter((entry) => isFreshTimestamp(entry.row.observed_at, 30 * 24 * 60 * 60 * 1000))
    .filter((entry) => (JSON.parse(entry.row.services_payload) as string[]).includes("reprocessing"));
  if (!profiles.length) return [];
  const profileRow = store.sql.prepare(
    "SELECT race,skills_payload,standings_payload,skill_queue_payload,observed_at FROM production_character_profiles WHERE character_id=?",
  ).get(main.id) as { race: string | null; skills_payload: string; standings_payload: string; skill_queue_payload: string; observed_at: string } | undefined;
  if (!profileRow) return [];
  const profile: ProfileData = {
    race: profileRow.race,
    skills: JSON.parse(profileRow.skills_payload) as ProfileData["skills"],
    standings: JSON.parse(profileRow.standings_payload) as ProfileData["standings"],
    queue: JSON.parse(profileRow.skill_queue_payload) as ProfileData["queue"],
    at: profileRow.observed_at,
  };
  if (!isFreshTimestamp(profile.at, 30 * 24 * 60 * 60 * 1000)) return [];
  if (profile.queue.some((entry) =>
    !!entry.finish_date && Date.parse(entry.finish_date) <= Date.parse(profile.at) &&
    entry.finished_level > (profile.skills.find((skill) => skill.skill_id === entry.skill_id)?.trained_skill_level ?? 0))) return [];
  const skillLevels = new Map(effectiveAlphaSkills(profile, productionStatic).map((skill) => [skill.typeId, skill.usableLevel]));
  const sellerFor = (station: (typeof hubStations)[number]) => ({
    accounting: skillLevels.get("16622") ?? 0,
    brokerRelations: skillLevels.get("3446") ?? 0,
    advancedBrokerRelations: skillLevels.get("16597") ?? 0,
    factionStanding: profile.standings.find((standing) => standing.from_type === "faction" && standing.from_id === station.factionId)?.standing ?? "0",
    corporationStanding: profile.standings.find((standing) => standing.from_type === "npc_corp" && standing.from_id === station.ownerId)?.standing ?? "0",
  });
  const regions = [...new Set(profiles.map((entry) => entry.station.regionId))];
  const confirmedStructures = store.sql.prepare(
    "SELECT location_id,name FROM production_facility_profiles WHERE facility_kind='structure' AND access_status='confirmed' AND system_id IN ('30000142','30000144')",
  ).all() as { location_id: string; name: string }[];
  const sourcingLocations = new Set([...hubStations.map((station) => station.id), ...confirmedStructures.map((row) => row.location_id)]);
  const sourcingNames = new Map([
    ...hubStations.map((station) => [station.id, station.name] as const),
    ...confirmedStructures.map((row) => [row.location_id, row.name] as const),
  ]);
  const marketData = productionMarketOrders(regions, sourcingLocations);
  if (!marketData.complete || marketData.snapshots.some((snapshot) => !isUnexpiredTimestamp(snapshot.expiresAt))) return [];
  const reservationAmounts = store.sql.prepare("SELECT amount FROM production_reservations WHERE paid=0").all() as { amount: string }[];
  const cacheKey = JSON.stringify([
    marketData.snapshots.map((snapshot) => snapshot.id), profileRow.observed_at,
    profiles.map((entry) => [entry.row.location_id, entry.row.observed_at, entry.row.reprocessing_yield_bonus, entry.row.reprocessing_tax]),
    main.balance, reservationAmounts, productionStatic.version,
    store.sql.prepare("SELECT value FROM sync_cursors WHERE key='history-revision'").get(),
  ]);
  if (cacheKey === reprocessingOfferCacheKey) return reprocessingOfferCache;
  reprocessingQuoteHandlers.clear();
  const systemById = new Map(productionStatic.systems.map((system) => [system.id, system]));
  const graph = new Graph(productionStatic.systems);
  const typeById = new Map(productionStatic.types.map((type) => [type.id, type]));
  const recipes = new Map((productionStatic.reprocessing ?? []).map((recipe) => [recipe.typeId, recipe]));
  const orders = new Map<string, Order[]>();
  for (const order of marketData.orders) {
    const list = orders.get(order.type_id) ?? [];
    list.push(order);
    orders.set(order.type_id, list);
  }
  const balance = D(main.balance ?? "0");
  const reserved = reservationAmounts.reduce((total, row) => total.plus(row.amount), D(0));
  const availableBalance = balance.minus(reserved);
  const budget = availableBalance.gt(0) ? availableBalance.toFixed(2) : "0.00";
  const adjustedPrices = new Map(
    (store.sql.prepare("SELECT type_id,adjusted_price FROM production_adjusted_prices").all() as { type_id: string; adjusted_price: string }[])
      .map((row) => [row.type_id, row.adjusted_price]),
  );
  const typeName = (id: string) => typeById.get(id)?.name ?? `Type ${id}`;
  const offers: AppState["production"]["reprocessingOffers"] = [];
  const reprocessingHistory = new Map<string, HistoryDay[]>();
  const historyFor = (typeId: string, regionId: string) => {
    const key = `${typeId}:${regionId}`;
    let rows = reprocessingHistory.get(key);
    if (!rows) {
      rows = (store.sql.prepare(
        "SELECT payload FROM regional_history WHERE type_id=? AND region_id=? ORDER BY date DESC LIMIT 90",
      ).all(typeId, regionId) as { payload: string }[])
        .map((entry) => JSON.parse(entry.payload) as HistoryDay);
      reprocessingHistory.set(key, rows);
    }
    return rows;
  };
  for (const { row, station } of profiles) {
    if (!row.reprocessing_yield_bonus) continue;
    const levelFor = (id: string, side: "supply" | "demand", sourceAll = false) => {
      const system = systemById.get(station.systemId);
      if (!system) return [];
      return (orders.get(id) ?? []).filter((order) => side === "supply"
        ? !order.is_buy_order && (sourceAll ? sourcingLocations.has(order.location_id) : order.location_id === station.id)
        : order.is_buy_order && graph.buyApplies({
            locationId: order.location_id,
            systemId: order.system_id,
            regionId: systemById.get(order.system_id)?.regionId ?? "",
            range: order.range,
          }, station)).map((order) => ({
            id: order.order_id,
            price: order.price,
            quantity: order.volume_remain,
            minVolume: order.min_volume,
            locationId: order.location_id,
            locationName: sourcingNames.get(order.location_id) ?? `Структура ${order.location_id}`,
          }));
    };
    for (const [inputTypeId, recipe] of recipes) {
      const item = typeById.get(inputTypeId);
      if (!item?.portionSize) continue;
      const supply = levelFor(inputTypeId, "supply", true);
      if (!supply.length) continue;
      const maxPortions = Math.floor(supply.reduce((n, level) => n + level.quantity, 0) / item.portionSize);
      if (!maxPortions) continue;
      const demand = new Map(recipe.materials.map((material) => [material.typeId, levelFor(material.typeId, "demand")]));
      const asks = new Map(recipe.materials.map((material) => [material.typeId, levelFor(material.typeId, "supply")]));
      const quoteKey = `${station.id}:${inputTypeId}`;
      const estimateAt = (inputQuantity: number) => estimateReprocessing({
        recipe,
        portionSize: item.portionSize!,
        inputQuantity,
        yieldPercent: D(row.reprocessing_yield_bonus!).mul(100).toFixed(6),
        evidenceAt: row.observed_at,
        reprocessingTaxRate: row.reprocessing_tax,
        adjustedPrices,
        supply,
        demand,
        asks,
        seller: sellerFor(station),
        observedAt: marketData.snapshots.map((snapshot) => snapshot.modifiedAt).sort().at(-1) ?? row.observed_at,
        typeNames: new Map(recipe.materials.map((material) => [material.typeId, typeName(material.typeId)])),
      });
      reprocessingQuoteHandlers.set(quoteKey, { maxInputQuantity: maxPortions * item.portionSize, portionSize: item.portionSize, estimateAt });
      const candidates = new Set<number>([1, maxPortions]);
      const addBoundary = (boundary: number) => {
        for (const candidate of [boundary - 1, boundary, boundary + 1])
          if (candidate >= 1 && candidate <= maxPortions) candidates.add(candidate);
      };
      let cumulativeInput = 0;
      for (const level of supply) {
        cumulativeInput += level.quantity;
        addBoundary(Math.floor(cumulativeInput / item.portionSize));
      }
      const yieldRate = D(row.reprocessing_yield_bonus);
      for (const material of recipe.materials) {
        let cumulativeDemand = 0;
        for (const level of demand.get(material.typeId) ?? []) {
          cumulativeDemand += level.quantity;
          let low = 0;
          let high = maxPortions;
          while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            const produced = D(material.quantity).mul(mid).mul(yieldRate).floor().toNumber();
            if (produced <= cumulativeDemand) low = mid;
            else high = mid - 1;
          }
          addBoundary(low);
        }
      }
      let best: ReturnType<typeof estimateReprocessing> | null = null;
      let bestProfit = D(0);
      for (const portions of candidates) {
        const estimate = estimateAt(portions * item.portionSize);
        if (estimate.status !== "ready" || !estimate.totalCost || D(estimate.totalCost).gt(budget)) continue;
        const immediateProfit = estimate.immediate.netProfit === null ? D(-1) : D(estimate.immediate.netProfit);
        const sellProfit = estimate.sellOrder.netProfit === null ? D(-1) : D(estimate.sellOrder.netProfit);
        const profit = immediateProfit.gt(sellProfit) ? immediateProfit : sellProfit;
        if (profit.gt(bestProfit)) { best = estimate; bestProfit = profit; }
      }
      if (!best) continue;
      const requestedInput = reprocessingRequestedInputs.get(quoteKey);
      if (requestedInput !== undefined && requestedInput <= maxPortions * item.portionSize) {
        const requestedEstimate = estimateAt(requestedInput);
        if (requestedEstimate.status === "ready" && requestedEstimate.totalCost !== null && D(requestedEstimate.totalCost).lte(budget))
          best = requestedEstimate;
      }
      offers.push({
        id: `${station.id}:${inputTypeId}:${best.inputQuantity}`,
        itemName: typeName(inputTypeId),
        facilityId: station.id,
        facilityName: row.name,
        systemId: station.systemId,
        maxInputQuantity: maxPortions * item.portionSize,
        estimate: best,
        marketSignals: best.outputs.filter((output) => output.quantity > 0).map((output) => {
          return {
            typeId: output.typeId,
            itemName: output.typeName,
            signal: productionMarketSignal({
              history: historyFor(output.typeId, station.regionId),
              asOf: new Date().toISOString(),
              regionName: station.regionId === "10000002" ? "The Forge" : `Region ${station.regionId}`,
              outputQuantity: output.quantity,
              bids: levelFor(output.typeId, "demand"),
              asks: levelFor(output.typeId, "supply"),
            }),
          };
        }),
      });
    }
  }
  const score = (estimate: (typeof offers)[number]["estimate"]) => {
    const immediate = estimate.immediate.netProfit === null ? D(-1) : D(estimate.immediate.netProfit);
    const sell = estimate.sellOrder.netProfit === null ? D(-1) : D(estimate.sellOrder.netProfit);
    return immediate.gt(sell) ? immediate : sell;
  };
  offers.sort((a, b) => score(b.estimate).comparedTo(score(a.estimate)));
  reprocessingOfferCacheKey = cacheKey;
  reprocessingOfferCache = offers.slice(0, 100);
  return reprocessingOfferCache;
}
function productionSummary(): AppState["production"] {
  const productionStatic = config.demo ? bundledStatic : market.data ?? bundledStatic;
  const typeById = new Map(productionStatic.types.map((type) => [type.id, type]));
  const main = portfolio.characters().find((character) => character.isSeller);
  const capital = productionCapital(main);
  const profile = main
    ? (store.sql
        .prepare(
          "SELECT race,skills_payload,observed_at FROM production_character_profiles WHERE character_id=?",
        )
        .get(main.id) as
        | { race: string | null; skills_payload: string; observed_at: string }
        | undefined)
    : undefined;
  const alphaSkills = profile
    ? effectiveAlphaSkills(
        {
          race: profile.race,
          skills: JSON.parse(profile.skills_payload) as ProfileData["skills"],
        },
        productionStatic,
      )
    : [];
  const synced = store.sql
    .prepare(
      "SELECT completed_at FROM production_sync_runs WHERE status='complete' ORDER BY completed_at DESC LIMIT 1",
    )
    .get() as { completed_at: string } | undefined;
  const publicSynced = store.sql
    .prepare(
      "SELECT completed_at FROM production_sync_runs WHERE status IN ('complete','public_complete') ORDER BY completed_at DESC LIMIT 1",
    )
    .get() as { completed_at: string } | undefined;
  const ownSynced = store.sql
    .prepare(
      "SELECT completed_at FROM production_sync_runs WHERE status='complete' AND character_id IS NOT NULL ORDER BY completed_at DESC LIMIT 1",
    )
    .get() as { completed_at: string } | undefined;
  const missingScopes = main
    ? PRODUCTION_SCOPES.filter((scope) => !main.scopes.includes(scope))
    : [...PRODUCTION_SCOPES];
  const optionalMissingScopes = main
    ? OPTIONAL_STRUCTURE_SCOPES.filter((scope) => !main.scopes.includes(scope))
    : [...OPTIONAL_STRUCTURE_SCOPES];
  const status = !main
    ? "Подключите основного персонажа"
    : missingScopes.length
      ? "Основе нужно разрешить дополнительные read-only ESI scopes"
      : !profile
        ? "Нажмите «Обновить данные ESI» для первой синхронизации"
        : "Данные основы и публичные отраслевые сведения синхронизированы";
  const count = (table: string, characterId?: string) =>
    (
      (characterId
        ? store.sql
            .prepare(`SELECT count(*) n FROM ${table} WHERE character_id=?`)
            .get(characterId)
        : store.sql.prepare(`SELECT count(*) n FROM ${table}`).get()) as {
        n: number;
      }
    ).n;
  const npcFacilityOptions = productionStatic.stations
    .filter((station) => ["30000142", "30000144"].includes(station.systemId))
    .map((station) => ({
      id: station.id,
      name: station.name,
      systemId: station.systemId,
      kind: "npc_station" as const,
    }));
  const structureFacilityOptions = store.sql
    .prepare(
      "SELECT location_id,name,system_id FROM production_facility_profiles WHERE facility_kind='structure'",
    )
    .all() as { location_id: string; name: string; system_id: string }[];
  const facilityProfiles = store.sql
    .prepare(
      "SELECT location_id,name,system_id,facility_kind,services_payload,industry_tax,reprocessing_tax,reprocessing_yield_bonus,access_status,profile_source,observed_at,evidence FROM production_facility_profiles ORDER BY name",
    )
    .all() as {
    location_id: string;
    name: string;
    system_id: string;
    facility_kind: "npc_station" | "structure" | "unknown";
    services_payload: string;
    industry_tax: string | null;
    reprocessing_tax: string | null;
    reprocessing_yield_bonus: string | null;
    access_status: "unknown" | "confirmed" | "unavailable";
    profile_source: "esi" | "manual";
    observed_at: string;
      evidence: string | null;
    }[];
  const structureModifierRows = store.sql.prepare(
    `SELECT location_id,output_type_id,system_cost_multiplier,material_bonus_percent,time_bonus_percent,broker_fee_rate,observed_at
     FROM production_structure_product_profiles ORDER BY location_id,output_type_id`,
  ).all() as {
    location_id: string;
    output_type_id: string;
    system_cost_multiplier: string;
    material_bonus_percent: number;
    time_bonus_percent: number;
    broker_fee_rate: string;
    observed_at: string;
  }[];
  const structureModifiersByLocation = new Map<string, typeof structureModifierRows>();
  for (const modifier of structureModifierRows) {
    const rows = structureModifiersByLocation.get(modifier.location_id) ?? [];
    rows.push(modifier);
    structureModifiersByLocation.set(modifier.location_id, rows);
  }
  const manufacturingOutputs = [...new Set((productionStatic.manufacturing ?? []).flatMap((recipe) =>
    recipe.products.map((product) => product.typeId),
  ))].map((id) => ({ id, name: typeById.get(id)?.name ?? `Type ${id}` }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const contractCoverageRow = store.sql.prepare(
    "SELECT details FROM production_sync_runs WHERE status IN ('complete','public_complete') ORDER BY completed_at DESC LIMIT 1",
  ).get() as { details: string } | undefined;
  const coverageDetails = contractCoverageRow ? JSON.parse(contractCoverageRow.details) as Record<string, unknown> : {};
  const blueprintContracts = (store.sql.prepare(
    "SELECT contract_id,location_id,price,expires_at,items_payload FROM production_contract_sources WHERE coverage_status='available' AND expires_at>? ORDER BY CAST(price AS REAL) ASC LIMIT 100",
  ).all(new Date().toISOString()) as { contract_id: string; location_id: string | null; price: string; expires_at: string | null; items_payload: string | null }[])
    .map((contract) => {
      const payload = JSON.parse(contract.items_payload ?? "{}") as {
        title?: string;
        blueprintOnly?: boolean;
        includedItemCount?: number;
        items?: PublicProductionData["publicBlueprintContracts"][number]["items"];
      };
      const items = applyPublicBlueprintConfirmations(contract.contract_id, payload.items ?? []);
      const blueprints = items.map((item) => ({
        recordId: item.recordId,
        typeId: item.typeId,
        typeName: typeById.get(item.typeId)?.name ?? `Type ${item.typeId}`,
        quantity: item.quantity < 1 ? 1 : item.quantity,
        materialEfficiency: item.materialEfficiency,
        timeEfficiency: item.timeEfficiency,
        runs: item.runs,
        attributesKnown: item.isBlueprintCopy === true && item.materialEfficiency !== null && item.timeEfficiency !== null && item.runs !== null && item.runs > 0,
        attributesSource: item.attributesSource,
        confirmedAt: item.confirmedAt,
        evidence: item.evidence,
      }));
      const blueprintOnly = payload.blueprintOnly === true;
      const knownCopies = knownBpcCopies({
        contractId: contract.contract_id,
        locationId: contract.location_id ?? "",
        price: contract.price,
        blueprintOnly,
        items,
      });
      const manufacturingEligibility: AppState["production"]["blueprintContracts"][number]["manufacturingEligibility"] = !knownCopies
        ? "unknown_attributes"
        : knownCopies.some((item) =>
            (productionStatic.manufacturing ?? []).some((recipe) => recipe.blueprintTypeId === item.typeId),
          )
          ? "candidate"
          : "unknown_recipe";
      return {
        contractId: contract.contract_id,
        title: payload.title ?? "Публичный контракт",
        locationId: contract.location_id ?? "",
        locationName: productionStatic.stations.find((station) => station.id === contract.location_id)?.name ?? `Объект ${contract.location_id ?? "?"}`,
        price: contract.price,
        expiresAt: contract.expires_at ?? "",
        blueprintOnly,
        includedItemCount: payload.includedItemCount ?? 0,
        manufacturingEligibility,
        blueprints,
      };
    });
  const availableJobs = main
    ? (store.sql.prepare("SELECT job_id,payload FROM production_jobs WHERE character_id=? ORDER BY start_at DESC").all(main.id) as { job_id: string; payload: string }[])
        .map(({ job_id, payload }) => {
          const job = JSON.parse(payload) as {
            blueprint_id: string; blueprint_type_id: string; facility_id: string;
            product_type_id?: string; runs: number; status: string;
            start_date: string; end_date: string; cost?: string;
          };
          return {
            jobId: job_id, blueprintId: job.blueprint_id,
            blueprintTypeId: job.blueprint_type_id, facilityId: job.facility_id,
            productTypeId: job.product_type_id ?? null, runs: job.runs,
            status: job.status, startAt: job.start_date, endAt: job.end_date,
            cost: job.cost ?? null,
          };
        })
    : [];
  const productionHubs = productionStatic.stations.filter((station) => ["30000142", "30000144"].includes(station.systemId));
  const confirmedStructureLocations = (store.sql.prepare(
    `SELECT location_id,name,system_id FROM production_facility_profiles
     WHERE facility_kind='structure' AND access_status='confirmed'
       AND system_id IN ('30000142','30000144')`,
  ).all() as { location_id: string; name: string; system_id: string }[]);
  const confirmedStructureNames = new Map(confirmedStructureLocations.map((row) => [row.location_id, row.name]));
  const projectMarketLocations = new Set([
    ...productionHubs.map((station) => station.id),
    ...confirmedStructureLocations.map((structure) => structure.location_id),
  ]);
  const projectMarket = productionMarketOrders(
    [...new Set(productionHubs.map((station) => station.regionId))],
    projectMarketLocations,
  );
  const projectMarketFresh = projectMarket.complete && projectMarket.snapshots.length > 0 &&
    projectMarket.snapshots.every((snapshot) => isUnexpiredTimestamp(snapshot.expiresAt));
  const projectMarketAt = projectMarketFresh
    ? projectMarket.snapshots.map((snapshot) => snapshot.modifiedAt).sort().at(-1) ?? null
    : null;
  const projectAsksByType = new Map<string, ({ id: string; price: string; quantity: number; minVolume: number } & { locationId: string; locationName: string })[]>();
  const projectBidsByType = new Map<string, ({ id: string; price: string; quantity: number; minVolume: number } & { locationId: string; locationName: string })[]>();
  for (const order of projectMarket.orders) {
    if (!projectMarketLocations.has(order.location_id)) continue;
    if (order.is_buy_order) {
      const levels = projectBidsByType.get(order.type_id) ?? [];
      levels.push({
        id: order.order_id, price: order.price, quantity: order.volume_remain, minVolume: order.min_volume,
        locationId: order.location_id,
        locationName: productionStatic.stations.find((station) => station.id === order.location_id)?.name ?? confirmedStructureNames.get(order.location_id) ?? `Объект ${order.location_id}`,
      });
      projectBidsByType.set(order.type_id, levels);
      continue;
    }
    const levels = projectAsksByType.get(order.type_id) ?? [];
    levels.push({
      id: order.order_id, price: order.price, quantity: order.volume_remain, minVolume: order.min_volume,
      locationId: order.location_id,
      locationName: productionStatic.stations.find((station) => station.id === order.location_id)?.name ?? confirmedStructureNames.get(order.location_id) ?? `Объект ${order.location_id}`,
    });
    projectAsksByType.set(order.type_id, levels);
  }
  const projects = (store.sql
    .prepare("SELECT id,status,updated_at,payload FROM production_projects ORDER BY updated_at DESC")
    .all() as { id: string; status: AppState["production"]["projects"][number]["status"]; updated_at: string; payload: string }[])
    .map((project) => {
      const payload = JSON.parse(project.payload) as {
        offerId: string;
        itemName: string;
        projectKind?: "manufacturing" | "reprocessing";
        facilityId?: string;
        bpoAcquisition?: {
          blueprintTypeId: string;
          locationId: string;
          expectedPrice: string;
          pinnedAt: string;
        };
        outputQuantity: number;
        expectedCost: string;
        expectedProfit: string | null;
        chainPlan?: ChainPlan;
        startedAt?: string;
        estimate: ManufacturingEstimate | import("./production/reprocessing").ReprocessingEstimate;
      };
      const allocations = store.sql.prepare(
        "SELECT type_id,quantity,actual_cost FROM project_purchase_allocations WHERE project_id=?",
      ).all(project.id) as { type_id: string; quantity: number; actual_cost: string }[];
      const allocatedByType = new Map<string, { quantity: number; actualCost: string }>();
      for (const row of allocations) {
        const prior = allocatedByType.get(row.type_id) ?? { quantity: 0, actualCost: "0" };
        allocatedByType.set(row.type_id, {
          quantity: prior.quantity + row.quantity,
          actualCost: D(prior.actualCost).plus(row.actual_cost).toFixed(2),
        });
      }
      const inventoryRows = store.sql.prepare(
        `SELECT a.source_lot_id,a.quantity,a.consumed_quantity,a.status,a.node_id,
                l.type_id,l.unit_cost,l.project_id AS source_project_id,
                json_extract(source_project.payload,'$.itemName') AS source_project_name
         FROM project_lot_allocations a JOIN project_output_lots l ON l.id=a.source_lot_id
         JOIN production_projects source_project ON source_project.id=l.project_id
         WHERE a.project_id=? AND a.status IN ('reserved','consumed')`,
      ).all(project.id) as { source_lot_id: string; quantity: number; consumed_quantity: number; status: "reserved" | "consumed"; node_id: string; type_id: string; unit_cost: string; source_project_id: string; source_project_name: string | null }[];
      const inventoryByType = new Map<string, { quantity: number; actualCost: ReturnType<typeof D> }>();
      for (const row of inventoryRows) {
        const prior = inventoryByType.get(row.type_id) ?? { quantity: 0, actualCost: D(0) };
        inventoryByType.set(row.type_id, {
          quantity: prior.quantity + row.quantity,
          actualCost: prior.actualCost.plus(D(row.unit_cost).mul(row.quantity)),
        });
      }
      const isReprocessing = payload.projectKind === "reprocessing";
      const reprocessingEstimate = isReprocessing
        ? payload.estimate as import("./production/reprocessing").ReprocessingEstimate
        : null;
      const manufacturingEstimate = isReprocessing ? null : payload.estimate as ManufacturingEstimate;
      const requiredMaterials = isReprocessing
        ? [{ typeId: reprocessingEstimate!.inputTypeId, typeName: payload.itemName, quantity: reprocessingEstimate!.inputQuantity }]
        : payload.chainPlan?.status === "ready"
          ? [...payload.chainPlan.actions.filter((action) => action.kind === "purchase").reduce((map, action) => {
              const current = map.get(action.typeId) ?? { typeId: action.typeId, typeName: productionStatic.types.find((type) => type.id === action.typeId)?.name ?? `Type ${action.typeId}`, quantity: 0 };
              current.quantity += action.quantity;
              map.set(action.typeId, current);
              return map;
            }, new Map<string, { typeId: string; typeName: string; quantity: number }>()).values()]
          : manufacturingEstimate!.materials;
      const materials = requiredMaterials.map((material) => {
        const allocated = allocatedByType.get(material.typeId);
        const fromInventory = inventoryByType.get(material.typeId);
        const covered = (allocated?.quantity ?? 0) + (fromInventory?.quantity ?? 0);
        const missing = Math.max(0, material.quantity - covered);
        const refill = quoteProjectBuySources(
          projectAsksByType.get(material.typeId) ?? [],
          missing,
          projectMarketFresh,
        );
        return {
          typeId: material.typeId,
          typeName: material.typeName,
          required: material.quantity,
          purchased: covered,
          existingLotQuantity: fromInventory?.quantity ?? 0,
          actualCost: D(allocated?.actualCost ?? "0.00").plus(fromInventory?.actualCost ?? "0").toFixed(2),
          currentBuyRequired: missing,
          currentBuyFilled: refill.filled,
          currentBuySources: refill.sources,
        };
      });
      const boundJobs = store.sql.prepare(
        `SELECT l.node_id,l.job_id,l.source_status,j.payload FROM project_job_links l
         LEFT JOIN production_jobs j ON j.character_id=l.character_id AND j.job_id=l.job_id
         WHERE l.project_id=? ORDER BY l.observed_at`,
      ).all(project.id) as { node_id: string; job_id: string; source_status: string; payload: string | null }[];
      const boundJobViews = boundJobs.map((row) => {
        const job = row.payload ? JSON.parse(row.payload) as { status?: string; start_date?: string; end_date?: string; runs?: number; cost?: string } : {};
        return { nodeId: row.node_id, jobId: row.job_id, status: job.status ?? row.source_status,
          startAt: job.start_date ?? "", endAt: job.end_date ?? "", runs: job.runs ?? 0,
          cost: job.cost ?? null };
      });
      const manufacturingNodeRows = store.sql.prepare(
        "SELECT id,status,payload FROM project_nodes WHERE project_id=? AND node_type='manufacturing' ORDER BY rowid",
      ).all(project.id) as { id: string; status: string; payload: string }[];
      const projectFacilityId = payload.facilityId ?? ("facilityId" in payload.estimate ? payload.estimate.facilityId : null);
      const bpoAcquisition: AppState["production"]["projects"][number]["bpoAcquisition"] =
        project.status !== "pinned" || !payload.bpoAcquisition
          ? null
          : (() => {
              const acquisition = payload.bpoAcquisition!;
              const candidates = store.sql.prepare(
                `SELECT b.item_id,s.price,c.confirmed_at
                 FROM production_blueprint_instances b
                 JOIN blueprint_sources s ON s.source_kind='owned' AND s.source_id=b.item_id
                 LEFT JOIN blueprint_acquisition_confirmations c ON c.blueprint_item_id=b.item_id
                 WHERE b.character_id=? AND b.blueprint_type_id=? AND b.location_id=? AND b.runs=-1
                   AND b.observed_at>=? AND s.status='available'`,
              ).all(main?.id ?? "", acquisition.blueprintTypeId, acquisition.locationId, acquisition.pinnedAt) as
                { item_id: string; price: string | null; confirmed_at: string | null }[];
              const walletPurchase = store.sql.prepare(
                `SELECT 1 FROM wallet_transactions WHERE character_id=? AND json_extract(payload,'$.type_id')=?
                   AND json_extract(payload,'$.location_id')=? AND json_extract(payload,'$.is_buy')=1
                   AND json_extract(payload,'$.is_personal')=1 AND json_extract(payload,'$.date')>=? LIMIT 1`,
              ).get(main?.id ?? "", acquisition.blueprintTypeId, acquisition.locationId, acquisition.pinnedAt);
              const confirmed = candidates.filter((candidate) => candidate.price !== null && candidate.confirmed_at !== null && candidate.confirmed_at >= acquisition.pinnedAt);
              const status = confirmed.length > 1
                ? "ambiguous"
                : confirmed.length === 1
                  ? "ready"
                  : candidates.length > 0
                    ? "price_confirmation_required"
                    : walletPurchase
                      ? "sync_required"
                    : "purchase_required";
              return {
                blueprintTypeId: acquisition.blueprintTypeId,
                blueprintTypeName: productionStatic.types.find((type) => type.id === acquisition.blueprintTypeId)?.name ?? `Type ${acquisition.blueprintTypeId}`,
                locationId: acquisition.locationId,
                locationName: productionStatic.stations.find((station) => station.id === acquisition.locationId)?.name ?? `Объект ${acquisition.locationId}`,
                expectedPrice: acquisition.expectedPrice,
                status,
              };
            })();
      const currentExecutionFee: string | null = isReprocessing
        ? (() => {
            const confirmation = store.sql.prepare("SELECT payload FROM reprocessing_confirmations WHERE project_id=? ORDER BY confirmed_at DESC LIMIT 1")
              .get(project.id) as { payload: string } | undefined;
            return confirmation
              ? (JSON.parse(confirmation.payload) as { actualFee?: string }).actualFee ?? null
              : reprocessingEstimate?.reprocessingTax ?? null;
          })()
        : (() => {
            if (manufacturingNodeRows.length) {
              let fees = D(0);
              for (const node of manufacturingNodeRows) {
                const detail = JSON.parse(node.payload) as { expectedFee?: string; blueprintAcquisitionCost?: string };
                const job = boundJobViews.find((candidate) => candidate.nodeId === node.id);
                if (job?.status === "delivered" && job.cost === null) return null;
                fees = fees.plus(job?.cost ?? detail.expectedFee ?? "0")
                  .plus(detail.blueprintAcquisitionCost ?? "0");
              }
              return fees.toFixed(2);
            }
            return resolveManufacturingExecutionCost(boundJobViews, manufacturingEstimate?.installationFee ?? null);
          })();
      const currentExpectedCost = estimateCurrentProjectCost({
        materials,
        asksByType: projectAsksByType,
        executionFee: currentExecutionFee,
        marketFresh: projectMarketFresh,
      });
      const completeCurrentMaterialQuote = currentExpectedCost !== null;
      const projectOutputs = reprocessingEstimate
        ? [
            ...reprocessingEstimate.outputs.map((output) => ({ typeId: output.typeId, quantity: output.quantity })),
            ...(reprocessingEstimate.residualQuantity > 0
              ? [{ typeId: reprocessingEstimate.inputTypeId, quantity: reprocessingEstimate.residualQuantity }]
              : []),
          ]
        : [{ typeId: manufacturingEstimate!.outputTypeId, quantity: payload.outputQuantity }];
      const sellerFees = reprocessingEstimate?.fees ?? manufacturingEstimate?.fees;
      const currentExpectedProfit = estimateCurrentProjectProfit({
        outputs: projectOutputs,
        asksByType: projectAsksByType,
        demandByType: projectBidsByType,
        totalCost: currentExpectedCost,
        salesTaxRate: sellerFees?.salesTaxRate ?? null,
        brokerFeeRate: sellerFees?.brokerFeeRate ?? null,
        marketFresh: projectMarketFresh,
      });
      const outputLots = (store.sql.prepare(
        `SELECT l.id,l.type_id,l.quantity,l.remaining,l.unit_cost,l.created_at,t.name,
                coalesce((SELECT sum(a.quantity-a.consumed_quantity) FROM project_lot_allocations a
                          WHERE a.source_lot_id=l.id AND a.status='reserved'),0) AS reserved,
                coalesce(json_extract(n.payload,'$.isFinal'),1) is_final
         FROM project_output_lots l LEFT JOIN item_types t ON t.id=l.type_id
         LEFT JOIN project_nodes n ON n.id=l.node_id
         WHERE l.project_id=? ORDER BY l.created_at`,
      ).all(project.id) as { id: string; type_id: string; quantity: number; remaining: number; unit_cost: string; created_at: string; name: string | null; reserved: number; is_final: number }[])
        .map((lot) => ({ id: lot.id, typeId: lot.type_id, typeName: lot.name ?? `Type ${lot.type_id}`,
          quantity: lot.quantity, remaining: lot.remaining, reserved: lot.reserved, available: Math.max(0, lot.remaining - lot.reserved),
          unitCost: lot.unit_cost, createdAt: lot.created_at, isFinal: lot.is_final === 1 }));
      const manufacturingNodes = manufacturingNodeRows.map((node) => {
          const detail = JSON.parse(node.payload) as { blueprintItemId?: string; blueprintTypeId?: string; outputTypeId?: string; outputQuantity?: number; runs?: number; isFinal?: boolean; plannedTimeSeconds?: number | null };
          const incoming = store.sql.prepare(
            `SELECT from_node,quantity FROM project_edges WHERE project_id=? AND to_node=?`,
          ).all(project.id, node.id) as { from_node: string; quantity: number }[];
          const canStart = incoming.every((edge) => {
            const dependency = store.sql.prepare("SELECT node_type,status,payload FROM project_nodes WHERE id=?").get(edge.from_node) as { node_type: string; status: string; payload: string } | undefined;
            if (!dependency) return false;
            if (dependency.node_type === "manufacturing") return dependency.status === "complete";
            if (dependency.node_type !== "purchase") return false;
            const purchase = JSON.parse(dependency.payload) as { typeId: string; required: number };
            if ("sourceLotId" in purchase) return dependency.status === "ready";
            const acquired = allocatedByType.get(purchase.typeId)?.quantity ?? 0;
            const totalRequired = (store.sql.prepare(
              "SELECT coalesce(sum(quantity),0) quantity FROM project_edges WHERE project_id=? AND from_node=?",
            ).get(project.id, edge.from_node) as { quantity: number }).quantity;
            return acquired >= totalRequired && dependency.status === "ready";
          });
          return { id: node.id, blueprintItemId: detail.blueprintItemId ?? "", blueprintTypeId: detail.blueprintTypeId ?? "",
            outputTypeId: detail.outputTypeId ?? "", outputQuantity: detail.outputQuantity ?? 0,
            outputName: productionStatic.types.find((type) => type.id === detail.outputTypeId)?.name ?? `Type ${detail.outputTypeId ?? "?"}`, runs: detail.runs ?? 0,
            status: node.status, isFinal: detail.isFinal ?? true, canStart,
            timeSeconds: detail.plannedTimeSeconds ?? null };
        });
      const projectSchedule: AppState["production"]["projects"][number]["productionSchedule"] =
        isReprocessing || manufacturingNodeRows.length === 0 ? null : (() => {
          const now = new Date().toISOString();
          const fixedCompletion: Record<string, string> = {};
          const actions: ChainPlan["actions"] = [];
          const dependenciesByAction: Record<string, string[]> = {};
          const incomingManufacturing = new Map<string, string[]>();
          const incomingRows = store.sql.prepare(
            `SELECT e.from_node,e.to_node FROM project_edges e JOIN project_nodes n ON n.id=e.from_node
             WHERE e.project_id=? AND n.node_type='manufacturing'`,
          ).all(project.id) as { from_node: string; to_node: string }[];
          for (const edge of incomingRows) {
            const list = incomingManufacturing.get(edge.to_node) ?? [];
            list.push(edge.from_node);
            incomingManufacturing.set(edge.to_node, list);
          }
          const boundByNode = new Map(boundJobViews.map((job) => [job.nodeId, job]));
          let invalidNode = false;
          for (const node of manufacturingNodeRows) {
            const detail = JSON.parse(node.payload) as {
              blueprintItemId?: string; outputTypeId?: string; outputQuantity?: number;
              runs?: number; expectedFee?: string; plannedTimeSeconds?: number | null;
            };
            const bound = boundByNode.get(node.id);
            if (node.status === "complete" || bound?.status === "delivered" || bound?.status === "ready") {
              fixedCompletion[node.id] = now;
              continue;
            }
            if (node.status === "needs_review" || ["cancelled", "reverted"].includes(bound?.status ?? "")) {
              invalidNode = true;
              continue;
            }
            if (bound && ["active", "paused"].includes(bound.status)) {
              fixedCompletion[node.id] = bound.endAt;
              continue;
            }
            actions.push({
              id: node.id, kind: "manufacturing", typeId: detail.outputTypeId ?? "unknown",
              quantity: detail.outputQuantity ?? 0, cost: detail.expectedFee ?? "0",
              facilityId: projectFacilityId, recipeId: `project:${node.id}`,
              blueprintId: detail.blueprintItemId ?? null, runs: detail.runs ?? null,
              parents: [], timeSeconds: detail.plannedTimeSeconds ?? null,
            });
            dependenciesByAction[node.id] = incomingManufacturing.get(node.id) ?? [];
          }
          const purchaseRows = store.sql.prepare(
            "SELECT status FROM project_nodes WHERE project_id=? AND node_type='purchase'",
          ).all(project.id) as { status: string }[];
          const waitingForPurchases = purchaseRows.some((row) => row.status !== "ready");
          if (invalidNode || !profile) return {
            status: "review", reasons: [invalidNode ? "Этап проекта требует сверки; срок не подтверждён" : "Нет профиля навыков основы для расчёта слотов"],
            availableSlots: profile ? manufacturingJobSlots(alphaSkills, productionStatic) : 0,
            occupiedSlots: availableJobs.filter((job) => job.status === "active" || job.status === "paused").length, calendarSeconds: null,
            waitingForPurchases,
          };
          const plan: ChainPlan = {
            status: "ready", reasons: [], targetTypeId: manufacturingEstimate?.outputTypeId ?? "unknown",
            targetQuantity: payload.outputQuantity, totalCost: payload.expectedCost,
            productionSeconds: null, slotSeconds: actions.reduce((total, action) => total + (action.timeSeconds ?? 0), 0),
            schedule: null, actions, searchStates: 0,
          };
          const scheduled = scheduleChainPlan({
            plan,
            availableSlots: manufacturingJobSlots(alphaSkills, productionStatic),
            activeJobs: availableJobs.filter((job) => job.status === "active" || job.status === "paused")
              .map((job) => ({ blueprintId: job.blueprintId, status: job.status, endAt: job.endAt })),
            dependenciesByAction,
            completedActions: fixedCompletion,
          });
          return {
            status: scheduled.schedule?.status ?? "review",
            reasons: scheduled.schedule?.reasons ?? ["Не удалось построить расписание проекта"],
            availableSlots: scheduled.schedule?.availableSlots ?? manufacturingJobSlots(alphaSkills, productionStatic),
            occupiedSlots: scheduled.schedule?.occupiedSlots ?? availableJobs.filter((job) => job.status === "active" || job.status === "paused").length,
            calendarSeconds: scheduled.schedule?.calendarSeconds ?? null,
            waitingForPurchases,
          };
        })();
      const sales = (store.sql.prepare(
        `SELECT s.transaction_id,s.output_lot_id,s.quantity,s.net,t.payload
         FROM project_sales_allocations s JOIN wallet_transactions t
           ON t.character_id=s.character_id AND t.id=s.transaction_id
         JOIN project_output_lots l ON l.id=s.output_lot_id WHERE l.project_id=? ORDER BY s.observed_at`,
      ).all(project.id) as { transaction_id: string; output_lot_id: string; quantity: number; net: string; payload: string }[])
        .map((sale) => ({ transactionId: sale.transaction_id, outputLotId: sale.output_lot_id,
          quantity: sale.quantity, net: sale.net,
          date: transactionSchema.parse(JSON.parse(sale.payload)).date }));
      const saleCandidates: AppState["production"]["projects"][number]["saleCandidates"] = [];
      const soldTypes = [...new Set(outputLots.filter((lot) => lot.isFinal && lot.remaining > 0).map((lot) => lot.typeId))];
      if (main && payload.startedAt && soldTypes.length && project.status !== "cancelled") {
        const stationIds = productionStatic.stations.filter((station) =>
          ["30000142", "30000144"].includes(station.systemId)).map((station) => station.id);
        const transactions = store.sql.prepare(
          `SELECT payload FROM wallet_transactions WHERE character_id=?
           AND json_extract(payload,'$.is_buy')=0 AND json_extract(payload,'$.is_personal')=1
           AND json_extract(payload,'$.date')>=? AND json_extract(payload,'$.type_id') IN (${soldTypes.map(() => "?").join(",")})
           ORDER BY imported_at DESC LIMIT 500`,
        ).all(main.id, payload.startedAt, ...soldTypes) as { payload: string }[];
        const names = new Map(productionStatic.types.map((type) => [type.id, type.name]));
        for (const row of transactions) {
          const parsed = transactionSchema.safeParse(JSON.parse(row.payload));
          if (!parsed.success) continue;
          const tx = parsed.data;
          if (tx.is_buy || !tx.is_personal || tx.date < payload.startedAt ||
              !soldTypes.includes(tx.type_id) || !stationIds.includes(tx.location_id)) continue;
          if (!outputLots.some((lot) => lot.typeId === tx.type_id && lot.remaining > 0 && tx.date >= lot.createdAt)) continue;
          const journalRaw = store.sql.prepare("SELECT payload FROM wallet_journal WHERE character_id=? AND id=?")
            .get(main.id, tx.journal_ref_id) as { payload: string } | undefined;
          if (!journalRaw) continue;
          const journal = journalSchema.safeParse(JSON.parse(journalRaw.payload));
          if (!journal.success || journal.data.ref_type !== "market_transaction" || !journal.data.amount || D(journal.data.amount).lte(0)) continue;
          const tradeAllocated = (store.sql.prepare(
            "SELECT coalesce(sum(quantity),0) quantity FROM sale_allocations WHERE seller_id=? AND transaction_id=?",
          ).get(main.id, tx.transaction_id) as { quantity: number }).quantity;
          const productionAllocated = (store.sql.prepare(
            "SELECT coalesce(sum(quantity),0) quantity FROM project_sales_allocations WHERE character_id=? AND transaction_id=?",
          ).get(main.id, tx.transaction_id) as { quantity: number }).quantity;
          const available = Math.max(0, tx.quantity - tradeAllocated - productionAllocated);
          if (available <= 0) continue;
          saleCandidates.push({ transactionId: tx.transaction_id, typeId: tx.type_id,
            typeName: names.get(tx.type_id) ?? `Type ${tx.type_id}`, date: tx.date,
            transactionQuantity: tx.quantity, available, unitPrice: tx.unit_price,
            netTotal: journal.data.amount });
        }
      }
      const confirmedReprocessing = Boolean(store.sql.prepare("SELECT 1 FROM reprocessing_confirmations WHERE project_id=? LIMIT 1")
        .get(project.id));
      const executionCostsConfirmed = isReprocessing
        ? confirmedReprocessing
        : manufacturingNodes.length > 0 && manufacturingNodes.every((node) => node.status === "complete") &&
          boundJobViews.length === manufacturingNodes.length && boundJobViews.every((job) => job.status === "delivered" && job.cost !== null);
      const realizedProfit = outputLots.length > 0 && sales.length > 0 && executionCostsConfirmed
        ? D(sales.reduce((total, sale) => total.plus(sale.net), D(0)))
            .minus(sales.reduce((total, sale) => {
              const lot = outputLots.find((item) => item.id === sale.outputLotId);
              return total.plus(lot ? D(lot.unitCost).mul(sale.quantity) : 0);
            }, D(0))).toFixed(2)
        : null;
      const missingTypes = new Set(materials.filter((material) => material.required > material.purchased).map((material) => material.typeId));
      const purchases: AppState["production"]["projects"][number]["purchases"] = [];
      if (main && payload.startedAt && projectFacilityId && project.status !== "cancelled" && missingTypes.size) {
        const purchaseLocationIds = [...projectMarketLocations];
        const transactions = store.sql.prepare(
          `SELECT character_id,payload FROM wallet_transactions WHERE character_id=?
           AND json_extract(payload,'$.is_buy')=1 AND json_extract(payload,'$.is_personal')=1
           AND json_extract(payload,'$.date')>=? AND json_extract(payload,'$.location_id') IN (${purchaseLocationIds.map(() => "?").join(",")})
           AND json_extract(payload,'$.type_id') IN (${[...missingTypes].map(() => "?").join(",")})
           ORDER BY imported_at DESC LIMIT 500`,
        ).all(main.id, payload.startedAt, ...purchaseLocationIds, ...missingTypes) as { character_id: string; payload: string }[];
        const typeNames = new Map(productionStatic.types.map((type) => [type.id, type.name]));
        for (const row of transactions) {
          const transaction = transactionSchema.safeParse(JSON.parse(row.payload));
          if (!transaction.success) continue;
          const tx = transaction.data;
          if (!tx.is_buy || !tx.is_personal || tx.date < payload.startedAt ||
              !projectMarketLocations.has(tx.location_id) || !missingTypes.has(tx.type_id)) continue;
          const tradeAllocated = (store.sql.prepare(
            "SELECT coalesce(sum(quantity),0) quantity FROM purchase_lots WHERE buyer_id=? AND transaction_id=?",
          ).get(main.id, tx.transaction_id) as { quantity: number }).quantity;
          const productionAllocated = (store.sql.prepare(
            "SELECT coalesce(sum(quantity),0) quantity FROM project_purchase_allocations WHERE source='wallet_transaction' AND source_id=?",
          ).get(`${main.id}:${tx.transaction_id}`) as { quantity: number }).quantity;
          const available = Math.max(0, tx.quantity - tradeAllocated - productionAllocated);
          if (!available) continue;
          purchases.push({
            characterId: main.id,
            transactionId: tx.transaction_id,
            typeId: tx.type_id,
            typeName: typeNames.get(tx.type_id) ?? `Type ${tx.type_id}`,
            date: tx.date,
            quantity: tx.quantity,
            available,
            unitPrice: tx.unit_price,
            locationId: tx.location_id,
            locationName: productionStatic.stations.find((station) => station.id === tx.location_id)?.name ?? confirmedStructureNames.get(tx.location_id) ?? `Объект ${tx.location_id}`,
          });
        }
      }
      return {
        id: project.id,
        status: project.status,
        itemName: payload.itemName,
        outputQuantity: payload.outputQuantity,
        expectedCost: payload.expectedCost,
        currentExpectedCost,
        currentCostObservedAt: completeCurrentMaterialQuote ? projectMarketAt : null,
        currentMarketFresh: projectMarketFresh,
        currentExpectedProfit,
        expectedProfit: payload.expectedProfit,
        kind: isReprocessing ? "reprocessing" as const : "manufacturing" as const,
        outputTypeId: manufacturingEstimate?.outputTypeId ?? null,
        blueprintItemId: manufacturingEstimate?.blueprintItemId ?? null,
        blueprintTypeId: manufacturingEstimate?.blueprintTypeId ?? null,
        facilityId: payload.facilityId ?? manufacturingEstimate?.facilityId ?? null,
        runs: manufacturingEstimate?.runs ?? 0,
        updatedAt: project.updated_at,
        offerId: payload.offerId,
        bpoAcquisition,
        manufacturingNodes,
        productionSchedule: projectSchedule,
        materials,
        inventoryAllocations: inventoryRows.map((row) => ({
          sourceLotId: row.source_lot_id,
          sourceProjectId: row.source_project_id,
          sourceProjectName: row.source_project_name ?? `Проект ${row.source_project_id}`,
          typeId: row.type_id,
          typeName: productionStatic.types.find((type) => type.id === row.type_id)?.name ?? `Type ${row.type_id}`,
          quantity: row.quantity,
          consumedQuantity: row.consumed_quantity,
          unitCost: row.unit_cost,
          status: row.status,
        })),
        purchases,
        boundJobs: boundJobViews,
        outputLots,
        sales,
        saleCandidates,
        realizedProfit,
        plannedOutputs: reprocessingEstimate
          ? reprocessingEstimate.outputs.map((output) => ({ typeId: output.typeId, typeName: output.typeName, quantity: output.quantity }))
          : [{ typeId: manufacturingEstimate!.outputTypeId, typeName: payload.itemName, quantity: payload.outputQuantity }],
        plannedInputQuantity: reprocessingEstimate?.inputQuantity ?? null,
        reprocessingPortionSize: reprocessingEstimate?.portionSize ?? null,
      };
    });
  const structureMarketCoverage = (store.sql.prepare(
    `SELECT f.location_id,f.name,f.system_id,s.state,s.order_count,s.pages,s.observed_at,s.message
     FROM production_facility_profiles f LEFT JOIN production_structure_market_sync s
       ON s.structure_id=f.location_id
     WHERE f.facility_kind='structure' AND f.system_id IN ('30000142','30000144')
     ORDER BY f.name`,
  ).all() as {
    location_id: string; name: string; system_id: string; state: AppState["production"]["structureMarketCoverage"][number]["state"] | null;
    order_count: number | null; pages: number | null; observed_at: string | null; message: string | null;
  }[]).map((row) => ({
    structureId: row.location_id,
    structureName: row.name,
    systemId: row.system_id,
    state: row.state === "available" && !isFreshTimestamp(row.observed_at, 15 * 60 * 1000)
      ? "stale" as const
      : row.state ?? (optionalMissingScopes.includes("esi-markets.structure_markets.v1") ? "missing_scope" as const : "not_checked" as const),
    orderCount: row.order_count ?? 0,
    pages: row.pages ?? 0,
    observedAt: row.observed_at,
    message: row.message ?? (row.state === null ? "Профиль доступа к структуре нужно подтвердить" : null),
  }));
  const blueprintAcquisitions: AppState["production"]["blueprintAcquisitions"] = main
    ? (store.sql.prepare(
        `SELECT b.item_id,b.blueprint_type_id AS type_id,b.location_id,b.observed_at,
                c.transaction_id AS acquisition_transaction_id,c.price AS confirmed_price
         FROM production_blueprint_instances b
         LEFT JOIN blueprint_acquisition_confirmations c ON c.blueprint_item_id=b.item_id
         WHERE b.character_id=? AND b.runs=-1 AND b.location_id IS NOT NULL
         ORDER BY b.blueprint_type_id,b.item_id`,
      ).all(main.id) as {
        item_id: string; type_id: string; location_id: string; observed_at: string;
        acquisition_transaction_id: string | null; confirmed_price: string | null;
      }[]).filter((row) => {
        const station = productionStatic.stations.find((item) => item.id === row.location_id);
        return !!station && ["30000142", "30000144"].includes(station.systemId);
      }).map((row) => {
        const usedByOtherBlueprint = (id: string) => !!store.sql.prepare(
          "SELECT 1 FROM blueprint_acquisition_confirmations WHERE character_id=? AND transaction_id=? AND blueprint_item_id<>?",
        ).get(main.id, id, row.item_id);
        const candidates = row.acquisition_transaction_id ? [] : (store.sql.prepare(
          "SELECT id,payload FROM wallet_transactions WHERE character_id=? ORDER BY imported_at DESC LIMIT 1000",
        ).all(main.id) as { id: string; payload: string }[]).flatMap((entry) => {
          let payload: unknown;
          try { payload = JSON.parse(entry.payload); } catch { return []; }
          const parsed = transactionSchema.safeParse(payload);
          if (!parsed.success) return [];
          const transaction = parsed.data;
          if (transaction.transaction_id !== entry.id || !transaction.is_buy || !transaction.is_personal ||
              transaction.type_id !== row.type_id || transaction.location_id !== row.location_id ||
              transaction.quantity !== 1 || usedByOtherBlueprint(transaction.transaction_id)) return [];
          return [{ transactionId: transaction.transaction_id, date: transaction.date,
            unitPrice: transaction.unit_price, quantity: transaction.quantity, locationId: transaction.location_id }];
        }).slice(0, 10);
        return {
          blueprintItemId: row.item_id,
          typeId: row.type_id,
          typeName: productionStatic.types.find((item) => item.id === row.type_id)?.name ?? `Type ${row.type_id}`,
          locationId: row.location_id,
          locationName: productionStatic.stations.find((item) => item.id === row.location_id)?.name ?? row.location_id,
          observedAt: row.observed_at,
          status: row.acquisition_transaction_id ? "confirmed" as const : "needs_confirmation" as const,
          acquisitionPrice: row.confirmed_price,
          transactionId: row.acquisition_transaction_id,
          candidateTransactions: candidates,
        };
      })
    : [];
  const manufacturing = manufacturingOffers(productionStatic, main);
  return {
    status,
    syncing: false,
    syncError: null,
    mainBalance: capital.mainBalance,
    spendableCapital: capital.spendable,
    reservedCapital: capital.productionReserved,
    tradeReservedCapital: capital.tradeReserved,
    capitalCommitmentConflict: capital.commitmentConflict,
    mainCharacterId: main?.id ?? null,
    race: profile?.race ?? null,
    alphaUsableSkills: alphaSkills.filter((skill) => skill.usableLevel > 0).length,
    alphaCappedSkills: alphaSkills.filter(
      (skill) => skill.activeLevel > skill.usableLevel,
    ).length,
    profileAt: profile?.observed_at ?? null,
    missingScopes,
    optionalMissingScopes,
    structureMarketCoverage,
    assets: main ? count("production_assets", main.id) : 0,
    blueprints: main ? count("production_blueprint_instances", main.id) : 0,
    blueprintAcquisitions,
    jobs: main ? count("production_jobs", main.id) : 0,
    availableJobs,
    contracts: main ? count("production_character_contracts", main.id) : 0,
    facilities: count("production_facility_profiles"),
    systemIndices: count("production_system_indices"),
    adjustedPrices: count("production_adjusted_prices"),
    contractCoverage: {
      candidateContracts: Number(coverageDetails.candidateContracts ?? 0),
      fetchedContracts: Number(coverageDetails.fetchedContracts ?? 0),
      capped: Boolean(coverageDetails.contractCoverageCapped ?? false),
      complete: Boolean(coverageDetails.contractCoverageComplete ?? false),
      itemErrors: Number(coverageDetails.contractItemErrors ?? 0),
    },
    blueprintContracts,
    syncedAt: ownSynced?.completed_at ?? (synced?.completed_at ?? null),
    publicSyncedAt: publicSynced?.completed_at ?? null,
    manufacturingRecipes: productionStatic.manufacturing?.length ?? 0,
    reprocessingTypes: productionStatic.reprocessing?.length ?? 0,
    sdeVersion: productionStatic.version,
    facilityOptions: [
      ...npcFacilityOptions,
      ...structureFacilityOptions.map((facility) => ({
        id: facility.location_id,
        name: facility.name,
        systemId: facility.system_id,
        kind: "structure" as const,
      })),
    ],
    facilityProfiles: facilityProfiles.map((facility) => ({
      id: facility.location_id,
      name: facility.name,
      systemId: facility.system_id,
      kind: facility.facility_kind === "unknown" ? "structure" : facility.facility_kind,
      profileSource: facility.profile_source,
      services: JSON.parse(facility.services_payload) as string[],
      taxRate: facility.industry_tax,
      reprocessingTaxRate: facility.reprocessing_tax,
      reprocessingYieldPercent: facility.reprocessing_yield_bonus,
      accessStatus: facility.access_status,
      observedAt: facility.observed_at,
      evidence: facility.evidence,
      structureProductProfiles: (structureModifiersByLocation.get(facility.location_id) ?? []).map((modifier) => ({
        outputTypeId: modifier.output_type_id,
        outputName: typeById.get(modifier.output_type_id)?.name ?? `Type ${modifier.output_type_id}`,
        systemCostMultiplier: modifier.system_cost_multiplier,
        materialBonusPercent: modifier.material_bonus_percent,
        timeBonusPercent: modifier.time_bonus_percent,
        brokerFeeRate: modifier.broker_fee_rate,
        observedAt: modifier.observed_at,
      })),
    })),
    manufacturingOutputs,
    offers: manufacturing.offers,
    marketBpoCandidatesScanned: manufacturing.marketBpoCandidatesScanned,
    marketBpoCandidatesTotal: manufacturing.marketBpoCandidatesTotal,
    marketBpoScanComplete: manufacturing.marketBpoScanComplete,
    contractCandidatesScanned: manufacturing.contractCandidatesScanned,
    contractCandidatesTotal: manufacturing.contractCandidatesTotal,
    contractScanComplete: manufacturing.contractScanComplete,
    contractOffers: manufacturing.contractOffers,
    reprocessingOffers: reprocessingOffers(productionStatic, main),
    projects,
  };
}
let stateProductionCache:
  | {
      value: AppState["production"];
      validUntil: number;
      databaseVersion: number;
    }
  | undefined;
function productionSummaryForState() {
  const databaseVersion = store.sql.pragma("data_version", { simple: true }) as number;
  if (
    stateProductionCache &&
    stateProductionCache.validUntil > Date.now() &&
    stateProductionCache.databaseVersion === databaseVersion
  )
    return stateProductionCache.value;
  const value = productionSummary();
  stateProductionCache = {
    value,
    validUntil: Date.now() + 1_000,
    databaseVersion,
  };
  return value;
}
function invalidateProductionState() {
  stateProductionCache = undefined;
}
function state(): AppState {
  const benchmark = process.env.EVE_BENCHMARK === "1";
  const stateStarted = benchmark ? performance.now() : 0;
  const b = portfolio.currentBudget();
  const productionStarted = benchmark ? performance.now() : 0;
  const production = productionSummaryForState();
  const opportunitiesStarted = benchmark ? performance.now() : 0;
  const opportunities = candidates();
  const detailStarted = benchmark ? performance.now() : 0;
  const result: AppState = {
    production,
    devBuild: config.devBuild ?? false,
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
    opportunities,
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
      calculation: calculationProgress,
      status: calculationBusy
        ? "Расчёт торговых возможностей… Рынок и кошельки доступны."
        : calculationError || market.status,
    },
    databaseSize: existsSync(path) ? statSync(path).size : 0,
  };
  if (benchmark)
    appendFileSync(
      join(config.directory, "benchmark-state.jsonl"),
      JSON.stringify({
        productionMs: opportunitiesStarted - productionStarted,
        opportunitiesMs: detailStarted - opportunitiesStarted,
        detailMs: performance.now() - detailStarted,
        totalMs: performance.now() - stateStarted,
        offerCount: opportunities.length,
        productionOfferCount: production.offers.length,
      }) + "\n",
    );
  return result;
}
function pinProductionOffer(projectId: string, offerId: string) {
  if (config.demo) throw Error("Закрепление производства недоступно в DEMO");
  const summary = productionSummary();
  const offer = summary.offers.find((item) => item.id === offerId);
  if (!offer) {
    const reprocessing = summary.reprocessingOffers.find((item) => item.id === offerId);
    if (!reprocessing || reprocessing.estimate.status !== "ready" || !reprocessing.estimate.totalCost)
      throw Error("Предложение устарело или требует уточнения параметров");
    const now = new Date().toISOString();
    const estimate = reprocessing.estimate;
    const outputQuantity = estimate.outputs.reduce((total, output) => total + output.quantity, 0);
    const payload = {
      offerId, projectKind: "reprocessing", itemName: reprocessing.itemName,
      facilityId: reprocessing.facilityId, facilityName: reprocessing.facilityName,
      systemId: reprocessing.systemId, inputQuantity: estimate.inputQuantity,
      outputQuantity, expectedCost: estimate.totalCost,
      expectedProfit: estimate.immediate.netProfit, estimate,
      source: "market-estimate",
    };
    const staticData = market.data ?? bundledStatic;
    const station = staticData.stations.find((item) => item.id === reprocessing.facilityId);
    const snapshot = station ? latestSnapshots(store, [station.regionId])[0] : undefined;
    const snapshotId = randomUUID();
    const main = portfolio.characters().find((character) => character.isSeller);
    const profileAt = main
      ? (store.sql.prepare("SELECT observed_at FROM production_character_profiles WHERE character_id=?").get(main.id) as { observed_at: string } | undefined)?.observed_at ?? null
      : null;
    store.sql.transaction(() => {
      store.sql.prepare("INSERT INTO calculation_snapshots VALUES (?,?,?,?,?,?,?,?,?)")
        .run(snapshotId, now, JSON.stringify(snapshot ? [snapshot.id] : []), staticData.version,
          profileAt, JSON.stringify([reprocessing.facilityId]),
          JSON.stringify({ fullMarketSnapshot: !!snapshot, source: "hub-filtered regional ESI" }),
          JSON.stringify(payload), "production-reprocessing-v1");
      store.sql.prepare("INSERT INTO production_projects(id,status,created_at,updated_at,payload) VALUES (?,'pinned',?,?,?) ON CONFLICT(id) DO NOTHING")
        .run(projectId, now, now, JSON.stringify({ ...payload, snapshotId }));
      store.sql.prepare("INSERT INTO project_plan_versions VALUES (?,1,?,?,?) ON CONFLICT(project_id,version) DO NOTHING")
        .run(projectId, now, snapshotId, JSON.stringify(payload));
    })();
    return;
  }
  if (offer.blueprintSource.kind === "market_bpo") {
    if (offer.estimate.status !== "ready" || offer.chainPlan.status !== "ready" || !offer.estimate.blueprintTypeId || !offer.estimate.facilityId)
      throw Error("Рыночный BPO нельзя закрепить: полная цепочка производства не подтверждена");
    const staticData = market.data ?? bundledStatic;
    const pinnedAt = new Date().toISOString();
    const station = staticData.stations.find((item) => item.id === offer.estimate.facilityId);
    const snapshot = station ? latestSnapshots(store, [station.regionId])[0] : undefined;
    const snapshotId = randomUUID();
    const main = portfolio.characters().find((character) => character.isSeller);
    const profileAt = main
      ? (store.sql.prepare("SELECT observed_at FROM production_character_profiles WHERE character_id=?").get(main.id) as { observed_at: string } | undefined)?.observed_at ?? null
      : null;
    const payload = {
      offerId: offer.id, projectKind: "manufacturing", facilityId: offer.estimate.facilityId,
      itemName: offer.itemName, itemEnglishName: offer.itemEnglishName,
      blueprintTypeName: offer.blueprintTypeName, systemId: offer.systemId,
      runs: offer.runs, outputQuantity: offer.estimate.outputQuantity,
      expectedCost: offer.estimate.totalCost ?? offer.estimate.cashRequired ?? "0",
      cashRequired: offer.estimate.cashRequired, expectedProfit: offer.estimate.firstCycleProfit.immediate,
      estimate: offer.estimate, chainPlan: offer.chainPlan, source: "market-bpo-estimate",
      bpoAcquisition: {
        blueprintTypeId: offer.estimate.blueprintTypeId,
        locationId: offer.estimate.facilityId,
        expectedPrice: offer.blueprintSource.purchasePrice ?? offer.estimate.blueprintPurchaseCashCost ?? "0",
        purchaseOrderId: offer.blueprintSource.purchaseOrderId,
        pinnedAt,
      },
    };
    store.sql.transaction(() => {
      store.sql.prepare("INSERT INTO calculation_snapshots VALUES (?,?,?,?,?,?,?,?,?)")
        .run(snapshotId, pinnedAt, JSON.stringify(snapshot ? [snapshot.id] : []), staticData.version,
          profileAt, JSON.stringify([offer.estimate.facilityId]),
          JSON.stringify({ fullMarketSnapshot: !!snapshot, source: "market BPO acquisition plan" }),
          JSON.stringify(payload), offer.estimate.formulaVersion);
      store.sql.prepare("INSERT INTO production_projects(id,status,created_at,updated_at,payload) VALUES (?,'pinned',?,?,?) ON CONFLICT(id) DO NOTHING")
        .run(projectId, pinnedAt, pinnedAt, JSON.stringify({ ...payload, snapshotId }));
      store.sql.prepare("INSERT INTO project_plan_versions VALUES (?,1,?,?,?) ON CONFLICT(project_id,version) DO NOTHING")
        .run(projectId, pinnedAt, snapshotId, JSON.stringify(payload));
    })();
    return;
  }
  if (offer.blueprintSource.kind !== "owned")
    throw Error("Нужен принадлежащий основе чертёж или доступное предложение BPO");
  const now = new Date().toISOString();
  const payload = {
    offerId: offer.id, projectKind: "manufacturing", facilityId: offer.estimate.facilityId,
    itemName: offer.itemName, itemEnglishName: offer.itemEnglishName,
    blueprintTypeName: offer.blueprintTypeName, facilityName: offer.facilityName,
    systemId: offer.systemId, runs: offer.runs, outputQuantity: offer.estimate.outputQuantity,
    expectedCost: offer.estimate.totalCost, cashRequired: offer.estimate.cashRequired,
    expectedProfit: offer.estimate.immediate.netProfit,
    estimate: offer.estimate, chainPlan: offer.chainPlan, source: "market-estimate",
  };
  const staticData = market.data ?? bundledStatic;
  const station = staticData.stations.find((item) => item.systemId === offer.systemId);
  const snapshot = station ? latestSnapshots(store, [station.regionId])[0] : undefined;
  const snapshotId = randomUUID();
  const main = portfolio.characters().find((character) => character.isSeller);
  const profileAt = main
    ? (store.sql.prepare("SELECT observed_at FROM production_character_profiles WHERE character_id=?").get(main.id) as { observed_at: string } | undefined)?.observed_at ?? null
    : null;
  store.sql.transaction(() => {
    store.sql.prepare("INSERT INTO calculation_snapshots VALUES (?,?,?,?,?,?,?,?,?)")
      .run(snapshotId, now, JSON.stringify(snapshot ? [snapshot.id] : []), staticData.version,
        profileAt, JSON.stringify([offer.estimate.facilityId]),
        JSON.stringify({ fullMarketSnapshot: !!snapshot, source: "hub-filtered regional ESI" }),
        JSON.stringify(payload), offer.estimate.formulaVersion);
    store.sql.prepare("INSERT INTO production_projects(id,status,created_at,updated_at,payload) VALUES (?,'pinned',?,?,?) ON CONFLICT(id) DO NOTHING")
      .run(projectId, now, now, JSON.stringify({ ...payload, snapshotId }));
    store.sql.prepare("INSERT INTO project_plan_versions VALUES (?,1,?,?,?) ON CONFLICT(project_id,version) DO NOTHING")
      .run(projectId, now, snapshotId, JSON.stringify(payload));
  })();
}

function quoteProductionOffer(blueprintItemId: string, facilityId: string, runs: number) {
  productionSummary();
  const quoteKey = `${blueprintItemId}:${facilityId}`;
  const handler = productionQuoteHandlers.get(quoteKey);
  if (!handler) throw Error("Предложение устарело. Сначала обновите данные ESI и расчёт");
  if (runs > handler.maxRuns)
    throw Error(`Доступно не более ${handler.maxRuns} прогонов с учётом рынка, бюджета и blueprint`);
  const estimate = handler.estimateAt(runs);
  if (estimate.status !== "ready" || !estimate.totalCost)
    throw Error(estimate.reasons.join("; ") || "Для этого количества нет полного покрытия рынка");
  const main = portfolio.characters().find((character) => character.isSeller);
  const reserved = (store.sql.prepare("SELECT amount FROM production_reservations WHERE paid=0").all() as { amount: string }[])
    .reduce((total, row) => total.plus(row.amount), D(0));
  const available = D(main?.balance ?? "0").minus(reserved);
  if (D(estimate.cashRequired ?? estimate.totalCost).gt(available))
    throw Error(`Для партии сейчас нужно ${estimate.cashRequired ?? estimate.totalCost} ISK, доступно ${available.gt(0) ? available.toFixed(2) : "0.00"} ISK`);
  productionRequestedRuns.set(quoteKey, runs);
  productionOfferCacheKey = "";
  productionSummary();
}

function quoteReprocessingOffer(facilityId: string, typeId: string, inputQuantity: number) {
  if (inputQuantity <= 0) throw Error("Введите положительное количество входных предметов");
  productionSummary();
  const quoteKey = `${facilityId}:${typeId}`;
  const handler = reprocessingQuoteHandlers.get(quoteKey);
  if (!handler) throw Error("Предложение устарело. Обновите производственные данные");
  if (inputQuantity > handler.maxInputQuantity)
    throw Error(`В текущем стакане доступно не более ${handler.maxInputQuantity} входных предметов`);
  if (inputQuantity % handler.portionSize !== 0)
    throw Error("Количество должно состоять из целого числа полных порций переработки");
  const estimate = handler.estimateAt(inputQuantity);
  if (estimate.status !== "ready" || !estimate.totalCost)
    throw Error(estimate.reasons.join("; ") || "Не хватает полного покрытия стакана для выбранного количества");
  const main = portfolio.characters().find((character) => character.isSeller);
  const reserved = (store.sql.prepare("SELECT amount FROM production_reservations WHERE paid=0").all() as { amount: string }[])
    .reduce((total, row) => total.plus(row.amount), D(0));
  const available = D(main?.balance ?? "0").minus(reserved);
  if (D(estimate.totalCost).gt(available))
    throw Error(`Для партии нужно ${estimate.totalCost} ISK, доступно ${available.gt(0) ? available.toFixed(2) : "0.00"} ISK`);
  reprocessingRequestedInputs.set(quoteKey, inputQuantity);
  reprocessingOfferCacheKey = "";
  productionSummary();
}

function startChainedManufacturingProject(
  projectId: string,
  pinnedPayload: string,
  offer: AppState["production"]["offers"][number],
) {
  const chain = offer.chainPlan;
  if (chain.status !== "ready" || chain.schedule?.status !== "ready" || chain.totalCost === null || offer.estimate.status !== "ready")
    throw Error(chain.reasons.join("; ") || "Цепочка производства требует проверки");
  const main = portfolio.characters().find((character) => character.isSeller);
  if (!main?.balance) throw Error("Сначала синхронизируйте баланс основного персонажа");
  const reservations = (store.sql.prepare("SELECT amount FROM production_reservations WHERE paid=0").all() as { amount: string }[])
    .reduce((total, row) => total.plus(row.amount), D(0));
  const available = D(main.balance).minus(reservations);
  const cashRequired = offer.estimate.cashRequired ?? chain.totalCost;
  if (D(cashRequired).gt(available))
    throw Error(`Для проекта сейчас нужно ${offer.estimate.cashRequired ?? chain.totalCost} ISK, доступно после резервов ${available.toFixed(2)} ISK`);

  const productionStatic = market.data ?? bundledStatic;
  const recipesByBlueprint = new Map((productionStatic.manufacturing ?? []).map((recipe) => [recipe.blueprintTypeId, recipe]));
  const rootId = `forced-root:${offer.estimate.blueprintItemId}`;
  const actionById = new Map(chain.actions.map((action) => [action.id, action]));
  const manufacturingActions = chain.actions.filter((action) => action.kind === "manufacturing");
  if (!manufacturingActions.some((action) => action.recipeId === rootId))
    throw Error("В полной цепочке отсутствует конечный производственный этап");

  const actionBlueprint = new Map<string, { source: { id: string; runs: number | null; blueprint_type_id: string; material_efficiency: number | null }; recipe: NonNullable<ReturnType<typeof recipesByBlueprint.get>> }>();
  const plannedRunsBySource = new Map<string, number>();
  for (const action of manufacturingActions) {
    const blueprintItemId = action.recipeId === rootId
      ? offer.estimate.blueprintItemId
      : action.recipeId?.startsWith("blueprint:") ? action.recipeId.slice("blueprint:".length) : null;
    if (!blueprintItemId || action.runs === null) throw Error(`Неизвестный чертёж для этапа ${action.id}`);
    const source = store.sql.prepare(
      "SELECT id,runs,blueprint_type_id,material_efficiency FROM blueprint_sources WHERE source_kind='owned' AND source_id=? AND status='available'",
    ).get(blueprintItemId) as { id: string; runs: number | null; blueprint_type_id: string; material_efficiency: number | null } | undefined;
    const recipe = source ? recipesByBlueprint.get(source.blueprint_type_id) : undefined;
    if (!source || !recipe || source.material_efficiency === null)
      throw Error(`Чертёж ${blueprintItemId} больше не подтверждён синхронизацией ESI`);
    const plannedRuns = plannedRunsBySource.get(source.id) ?? 0;
    const used = store.sql.prepare(
      `SELECT a.runs,p.status FROM blueprint_run_allocations a JOIN production_projects p ON p.id=a.project_id
       WHERE a.blueprint_source_id=? AND p.status NOT IN ('cancelled','completed')`,
    ).all(source.id) as { runs: number; status: string }[];
    if (source.runs === -1 && used.length) throw Error(`BPO ${blueprintItemId} уже закреплён за другим активным проектом`);
    if (source.runs !== -1 && used.reduce((sum, allocation) => sum + allocation.runs, 0) + plannedRuns + action.runs > (source.runs ?? 0))
      throw Error(`Оставшихся прогонов BPC ${blueprintItemId} недостаточно`);
    plannedRunsBySource.set(source.id, plannedRuns + action.runs);
    actionBlueprint.set(action.id, { source, recipe });
  }

  const requirements = new Map<string, { typeId: string; quantity: number; typeName: string }[]>();
  for (const action of manufacturingActions) {
    if (action.recipeId === rootId) {
      requirements.set(action.id, offer.estimate.materials.map((material) => ({
        typeId: material.typeId, quantity: material.quantity, typeName: material.typeName,
      })));
      continue;
    }
    const details = actionBlueprint.get(action.id)!;
    requirements.set(action.id, details.recipe.materials.map((material) => ({
      typeId: material.typeId,
      quantity: jobMaterialQuantity(material, action.runs!, details.source.material_efficiency!),
      typeName: productionStatic.types.find((type) => type.id === material.typeId)?.name ?? `Type ${material.typeId}`,
    })));
  }
  const purchaseRequirements = new Map<string, { quantity: number; cost: ReturnType<typeof D> }>();
  const station = productionStatic.stations.find((item) => item.systemId === offer.systemId);
  for (const action of chain.actions) if (action.kind === "purchase") {
    for (const source of action.sources ?? [{ id: action.id, quantity: action.quantity, unitCost: D(action.cost).div(action.quantity).toFixed(8) }]) {
      if (source.inventoryLotId) {
        const lot = store.sql.prepare(
          `SELECT l.type_id,l.unit_cost,l.remaining,
                  coalesce(json_extract(n.payload,'$.facilityId'),json_extract(p.payload,'$.facilityId')) AS location_id,
                  l.remaining-coalesce((SELECT sum(a.quantity-a.consumed_quantity) FROM project_lot_allocations a
                                        WHERE a.source_lot_id=l.id AND a.status='reserved'),0) available
           FROM project_output_lots l JOIN production_projects p ON p.id=l.project_id
           LEFT JOIN project_nodes n ON n.id=l.node_id WHERE l.id=?`,
        ).get(source.inventoryLotId) as { type_id: string; unit_cost: string; remaining: number; location_id: string; available: number } | undefined;
        if (!lot || lot.type_id !== action.typeId || lot.location_id !== offer.estimate.facilityId || source.quantity > lot.available)
          throw Error("Промежуточный остаток уже распределён или перемещён; обновите предложение");
        if (D(lot.unit_cost).toFixed(8) !== D(source.unitCost).toFixed(8))
          throw Error("Себестоимость промежуточного остатка изменилась; обновите предложение");
        continue;
      }
      const current = purchaseRequirements.get(action.typeId) ?? { quantity: 0, cost: D(0) };
      current.quantity += source.quantity;
      current.cost = current.cost.plus(D(source.unitCost).mul(source.quantity));
      purchaseRequirements.set(action.typeId, current);
    }
  }
  const now = new Date().toISOString();
  const snapshotId = randomUUID();
  const snapshot = station ? latestSnapshots(store, [station.regionId])[0] : undefined;
  const profileAt = (store.sql.prepare("SELECT observed_at FROM production_character_profiles WHERE character_id=?").get(main.id) as { observed_at: string } | undefined)?.observed_at ?? null;
  const payload = {
    ...JSON.parse(pinnedPayload) as Record<string, unknown>,
    estimate: offer.estimate, chainPlan: chain, expectedCost: chain.totalCost, cashRequired,
    expectedProfit: offer.estimate.immediate.netProfit, outputQuantity: offer.estimate.outputQuantity,
    startedAt: now, startSnapshotId: snapshotId, finalActionId: rootId,
  };
  store.sql.transaction(() => {
    store.sql.prepare("INSERT INTO calculation_snapshots VALUES (?,?,?,?,?,?,?,?,?)")
      .run(snapshotId, now, JSON.stringify(snapshot ? [snapshot.id] : []), productionStatic.version,
        profileAt, JSON.stringify([...new Set(manufacturingActions.map((action) => action.facilityId))]),
        JSON.stringify({ fullMarketSnapshot: !!snapshot, freshRecheck: true, chainSearchStates: chain.searchStates }),
        JSON.stringify(payload), offer.estimate.formulaVersion);
    store.sql.prepare("INSERT INTO project_plan_versions VALUES (?,2,?,?,?) ON CONFLICT(project_id,version) DO NOTHING")
      .run(projectId, now, snapshotId, JSON.stringify(payload));
    store.sql.prepare("UPDATE production_projects SET status='purchasing',updated_at=?,payload=? WHERE id=? AND status='pinned'")
      .run(now, JSON.stringify(payload), projectId);
    store.sql.prepare("INSERT INTO production_reservations(id,project_id,type_id,kind,amount,quantity,paid,created_at) VALUES (?,?,NULL,'purchase',?,NULL,0,?)")
      .run(randomUUID(), projectId, cashRequired, now);

    const nodeIds = new Map<string, string>();
    for (const action of manufacturingActions) {
      const item = actionBlueprint.get(action.id)!;
      const nodeId = randomUUID();
      nodeIds.set(action.id, nodeId);
      const blueprintItemId = action.recipeId === rootId ? offer.estimate.blueprintItemId : action.recipeId!.slice("blueprint:".length);
      const requiredOutput = action.parents
        .reduce((sum, consumerId) => sum + ((requirements.get(consumerId) ?? []).find((material) => material.typeId === action.typeId)?.quantity ?? 0), 0);
      store.sql.prepare("INSERT INTO project_nodes(id,project_id,node_key,node_type,status,payload) VALUES (?,?,?,'manufacturing','planned',?)")
        .run(nodeId, projectId, `manufacturing:${action.id}`, JSON.stringify({
          actionId: action.id, blueprintItemId, blueprintSourceId: item.source.id,
          blueprintTypeId: item.source.blueprint_type_id, outputTypeId: action.typeId,
          outputQuantity: action.quantity, requiredOutput: requiredOutput || action.quantity, runs: action.runs, facilityId: action.facilityId,
          isFinal: action.id === rootId, inputMaterials: requirements.get(action.id) ?? [],
          expectedFee: action.id === rootId
            ? D(action.cost).minus(offer.estimate.blueprintAcquisitionCost ?? "0").toFixed(2)
            : action.cost,
          blueprintAcquisitionCost: action.id === rootId ? offer.estimate.blueprintAcquisitionCost ?? "0.00" : "0.00",
          plannedTimeSeconds: action.timeSeconds,
        }));
      store.sql.prepare("INSERT INTO blueprint_run_allocations(id,blueprint_source_id,project_id,node_id,runs,created_at) VALUES (?,?,?,?,?,?)")
        .run(randomUUID(), item.source.id, projectId, nodeId, action.runs, now);
    }
    for (const [typeId, item] of purchaseRequirements) {
      const nodeId = randomUUID();
      nodeIds.set(`purchase:${typeId}`, nodeId);
      store.sql.prepare("INSERT INTO project_nodes(id,project_id,node_key,node_type,status,payload) VALUES (?,?,?,'purchase','needed',?)")
        .run(nodeId, projectId, `purchase:${typeId}`, JSON.stringify({ typeId, required: item.quantity, estimate: item.cost.toFixed(2) }));
    }
    const edgeInsert = store.sql.prepare("INSERT INTO project_edges(project_id,from_node,to_node,type_id,quantity) VALUES (?,?,?,?,?)");
    for (const action of chain.actions) {
      const parents = action.parents.flatMap((parentActionId) => {
        const consumer = actionById.get(parentActionId);
        if (!consumer || consumer.kind !== "manufacturing") return [];
        const quantity = (requirements.get(parentActionId) ?? []).find((material) => material.typeId === action.typeId)?.quantity ?? 0;
        return quantity > 0 ? [{ parentActionId, quantity }] : [];
      });
      if (action.kind === "manufacturing") {
        const fromId = nodeIds.get(action.id);
        for (const parent of parents) {
          const toId = nodeIds.get(parent.parentActionId);
          if (fromId && toId) edgeInsert.run(projectId, fromId, toId, action.typeId, parent.quantity);
        }
        continue;
      }

      const sources = action.sources ?? [{ id: action.id, quantity: action.quantity, unitCost: D(action.cost).div(action.quantity).toFixed(8) }];
      let parentIndex = 0;
      let parentRemaining = parents[0]?.quantity ?? 0;
      for (const source of sources) {
        let sourceRemaining = source.quantity;
        let sourceNodeId: string;
        if (source.inventoryLotId) {
          sourceNodeId = randomUUID();
          const lot = store.sql.prepare(
            `SELECT l.project_id,l.type_id,l.unit_cost,
                    coalesce(json_extract(n.payload,'$.facilityId'),json_extract(p.payload,'$.facilityId')) AS location_id,
                    l.remaining-coalesce((SELECT sum(a.quantity-a.consumed_quantity) FROM project_lot_allocations a
                                          WHERE a.source_lot_id=l.id AND a.status='reserved'),0) available
             FROM project_output_lots l JOIN production_projects p ON p.id=l.project_id
             LEFT JOIN project_nodes n ON n.id=l.node_id WHERE l.id=?`,
          ).get(source.inventoryLotId) as { project_id: string; type_id: string; unit_cost: string; location_id: string; available: number } | undefined;
          if (!lot || lot.type_id !== action.typeId || lot.location_id !== offer.estimate.facilityId || source.quantity > lot.available)
            throw Error("Промежуточный остаток уже распределён или перемещён; обновите предложение");
          store.sql.prepare("INSERT INTO project_nodes(id,project_id,node_key,node_type,status,payload) VALUES (?,?,?,'purchase','ready',?)")
            .run(sourceNodeId, projectId, `inventory:${action.id}:${source.inventoryLotId}`, JSON.stringify({
              typeId: action.typeId, quantity: source.quantity, unitCost: source.unitCost,
              sourceLotId: source.inventoryLotId, sourceProjectId: lot.project_id, locationId: lot.location_id,
            }));
          store.sql.prepare("INSERT INTO project_lot_allocations(id,source_lot_id,project_id,node_id,quantity,status,allocated_at) VALUES (?,?,?,?,?,'reserved',?)")
            .run(randomUUID(), source.inventoryLotId, projectId, sourceNodeId, source.quantity, now);
        } else {
          const marketNodeId = nodeIds.get(`purchase:${action.typeId}`);
          if (!marketNodeId) throw Error("Не найден узел рыночной закупки в плане проекта");
          sourceNodeId = marketNodeId;
        }

        while (sourceRemaining > 0 && parentIndex < parents.length) {
          if (parentRemaining <= 0) {
            parentIndex++;
            parentRemaining = parents[parentIndex]?.quantity ?? 0;
            continue;
          }
          const allocated = Math.min(sourceRemaining, parentRemaining);
          const targetId = nodeIds.get(parents[parentIndex]!.parentActionId);
          if (!targetId) throw Error("Не найден этап-потребитель материала в цепочке");
          edgeInsert.run(projectId, sourceNodeId, targetId, action.typeId, allocated);
          sourceRemaining -= allocated;
          parentRemaining -= allocated;
        }
        if (sourceRemaining > 0) throw Error("План источников превышает потребность цепочки; обновите предложение");
      }
    }
  })();
}

function confirmBlueprintAcquisitionCost(blueprintItemId: string, transactionId: string) {
  if (config.demo) throw Error("Подтверждение цены чертежа недоступно в DEMO");
  const main = portfolio.characters().find((character) => character.isSeller);
  if (!main) throw Error("Не подключён основной персонаж");
  const blueprint = store.sql.prepare(
    `SELECT b.item_id,b.blueprint_type_id AS type_id,b.location_id,b.runs
     FROM production_blueprint_instances b
     JOIN blueprint_sources s ON s.source_kind='owned' AND s.source_id=b.item_id
     WHERE b.character_id=? AND b.item_id=?`,
  ).get(main.id, blueprintItemId) as {
    item_id: string; type_id: string; location_id: string; runs: number;
  } | undefined;
  if (!blueprint) throw Error("BPO не найден в последней синхронизации основы");
  if (blueprint.runs !== -1) throw Error("Подтверждение цены через кошелёк доступно только для BPO");
  const transactionRow = store.sql.prepare(
    "SELECT payload FROM wallet_transactions WHERE character_id=? AND id=? ORDER BY imported_at DESC LIMIT 1",
  ).get(main.id, transactionId) as { payload: string } | undefined;
  const transaction = transactionRow ? transactionSchema.safeParse(JSON.parse(transactionRow.payload)) : null;
  if (!transaction?.success) throw Error("Покупка не найдена в синхронизированной истории кошелька основы");
  const purchase = transaction.data;
  if (!purchase.is_buy || !purchase.is_personal || purchase.type_id !== blueprint.type_id ||
      purchase.location_id !== blueprint.location_id || purchase.quantity !== 1 || !D(purchase.unit_price).gt(0))
    throw Error("Покупка должна совпадать с типом, станцией и одним предметом выбранного BPO");
  const previous = store.sql.prepare(
    "SELECT blueprint_item_id,price FROM blueprint_acquisition_confirmations WHERE character_id=? AND transaction_id=?",
  ).get(main.id, transactionId) as { blueprint_item_id: string; price: string } | undefined;
  if (previous && previous.blueprint_item_id !== blueprintItemId)
    throw Error("Эта покупка уже сопоставлена с другим BPO");
  const price = isk(D(purchase.unit_price).mul(purchase.quantity));
  const now = new Date().toISOString();
  store.sql.transaction(() => {
    store.sql.prepare(
      "INSERT INTO blueprint_acquisition_confirmations(blueprint_item_id,character_id,transaction_id,price,confirmed_at) VALUES (?,?,?,?,?) ON CONFLICT(blueprint_item_id) DO UPDATE SET character_id=excluded.character_id,transaction_id=excluded.transaction_id,price=excluded.price,confirmed_at=excluded.confirmed_at",
    ).run(blueprintItemId, main.id, transactionId, price, now);
    store.sql.prepare(
      "UPDATE blueprint_sources SET price=?,status='available',observed_at=?,payload=json_set(payload,'$.acquisitionTransactionId',?) WHERE source_kind='owned' AND source_id=?",
    ).run(price, now, transactionId, blueprintItemId);
  })();
  productionOfferCacheKey = "";
}

function startProductionProject(projectId: string) {
  if (config.demo) throw Error("Запуск проекта недоступен в DEMO");
  const project = store.sql.prepare("SELECT status,payload FROM production_projects WHERE id=?").get(projectId) as { status: string; payload: string } | undefined;
  if (!project) throw Error("Закреплённый проект не найден");
  if (project.status !== "pinned") return;
  const pinned = JSON.parse(project.payload) as {
    offerId: string; projectKind?: string; facilityId?: string;
    bpoAcquisition?: { blueprintTypeId: string; locationId: string; pinnedAt: string };
  };
  if (pinned.bpoAcquisition) {
    const acquired = store.sql.prepare(
      `SELECT b.item_id,c.price,c.confirmed_at
       FROM production_blueprint_instances b
       JOIN blueprint_sources s ON s.source_kind='owned' AND s.source_id=b.item_id AND s.status='available'
       JOIN blueprint_acquisition_confirmations c ON c.blueprint_item_id=b.item_id
       WHERE b.character_id=? AND b.blueprint_type_id=? AND b.location_id=? AND b.runs=-1
         AND b.observed_at>=? AND c.confirmed_at>=?
       ORDER BY c.confirmed_at DESC,b.item_id`,
    ).all(portfolio.characters().find((character) => character.isSeller)?.id ?? "",
      pinned.bpoAcquisition.blueprintTypeId, pinned.bpoAcquisition.locationId,
      pinned.bpoAcquisition.pinnedAt, pinned.bpoAcquisition.pinnedAt) as
        { item_id: string; price: string; confirmed_at: string }[];
    if (acquired.length !== 1)
      throw Error(acquired.length > 1
        ? "Найдено несколько купленных BPO этого типа. Оставьте один подтверждённый оригинал для проекта или закрепите план заново"
        : "Для старта купите BPO, синхронизируйте чертежи и подтвердите его цену по истории кошелька основы");
    const offer = productionSummary().offers.find((candidate) =>
      candidate.blueprintSource.kind === "owned" && candidate.estimate.blueprintItemId === acquired[0]!.item_id &&
      candidate.estimate.facilityId === pinned.bpoAcquisition!.locationId);
    if (!offer || !offer.chainExecutable)
      throw Error("Купленный BPO синхронизирован, но его план пока не готов. Обновите рынок и профиль производства");
    startChainedManufacturingProject(projectId, project.payload, offer);
    return;
  }
  if (pinned.projectKind === "reprocessing") {
    const offer = productionSummary().reprocessingOffers.find((item) => item.id === pinned.offerId);
    if (!offer || offer.estimate.status !== "ready" || !offer.estimate.totalCost)
      throw Error("Рынок или профиль переработки изменился. Обновите расчёт перед началом проекта");
    const main = portfolio.characters().find((character) => character.isSeller);
    if (!main?.balance) throw Error("Сначала синхронизируйте баланс основного персонажа");
    const reservations = store.sql.prepare("SELECT amount FROM production_reservations WHERE paid=0").all() as { amount: string }[];
    const available = D(main.balance).minus(reservations.reduce((total, row) => total.plus(row.amount), D(0)));
    if (D(offer.estimate.totalCost).gt(available))
      throw Error(`Для проекта нужно ${offer.estimate.totalCost} ISK, доступно после резервов ${available.toFixed(2)} ISK`);
    const staticData = market.data ?? bundledStatic;
    const station = staticData.stations.find((item) => item.id === offer.facilityId);
    const snapshot = station ? latestSnapshots(store, [station.regionId])[0] : undefined;
    const snapshotId = randomUUID();
    const now = new Date().toISOString();
    const payload = { ...JSON.parse(project.payload), estimate: offer.estimate,
      expectedCost: offer.estimate.totalCost, cashRequired: offer.estimate.totalCost,
      expectedProfit: offer.estimate.immediate.netProfit,
      startedAt: now, startSnapshotId: snapshotId };
    const profileAt = (store.sql.prepare("SELECT observed_at FROM production_character_profiles WHERE character_id=?").get(main.id) as { observed_at: string } | undefined)?.observed_at ?? null;
    store.sql.transaction(() => {
      store.sql.prepare("INSERT INTO calculation_snapshots VALUES (?,?,?,?,?,?,?,?,?)")
        .run(snapshotId, now, JSON.stringify(snapshot ? [snapshot.id] : []), staticData.version,
          profileAt, JSON.stringify([offer.facilityId]), JSON.stringify({ fullMarketSnapshot: !!snapshot, freshRecheck: true }),
          JSON.stringify(payload), "production-reprocessing-v1");
      store.sql.prepare("INSERT INTO project_plan_versions VALUES (?,2,?,?,?) ON CONFLICT(project_id,version) DO NOTHING")
        .run(projectId, now, snapshotId, JSON.stringify(payload));
      store.sql.prepare("UPDATE production_projects SET status='purchasing',updated_at=?,payload=? WHERE id=? AND status='pinned'")
        .run(now, JSON.stringify(payload), projectId);
      store.sql.prepare("INSERT INTO production_reservations(id,project_id,type_id,kind,amount,quantity,paid,created_at) VALUES (?,?,NULL,'purchase',?,NULL,0,?)")
        .run(randomUUID(), projectId, offer.estimate.totalCost, now);
      const nodeId = randomUUID();
      store.sql.prepare("INSERT INTO project_nodes(id,project_id,node_key,node_type,status,payload) VALUES (?,?,?,'reprocessing','planned',?)")
        .run(nodeId, projectId, `reprocessing:${offer.estimate.inputTypeId}`, JSON.stringify({ inputTypeId: offer.estimate.inputTypeId,
          inputQuantity: offer.estimate.inputQuantity, outputs: offer.estimate.outputs.map(({ typeId, quantity }) => ({ typeId, quantity })) }));
      const purchaseNode = randomUUID();
      store.sql.prepare("INSERT INTO project_nodes(id,project_id,node_key,node_type,status,payload) VALUES (?,?,?,'purchase','needed',?)")
        .run(purchaseNode, projectId, `purchase:${offer.estimate.inputTypeId}`, JSON.stringify({ typeId: offer.estimate.inputTypeId,
          required: offer.estimate.inputQuantity, estimate: offer.estimate.inputsCost }));
      store.sql.prepare("INSERT INTO project_edges(project_id,from_node,to_node,type_id,quantity) VALUES (?,?,?,?,?)")
        .run(projectId, purchaseNode, nodeId, offer.estimate.inputTypeId, offer.estimate.inputQuantity);
    })();
    return;
  }
  const offer = productionSummary().offers.find((item) => item.id === pinned.offerId);
  if (!offer || offer.estimate.status !== "ready" || !offer.estimate.totalCost)
    throw Error("Рынок или исходные данные изменились. Обновите расчёт перед началом проекта");
  if (offer.chainPlan?.status === "ready") {
    startChainedManufacturingProject(projectId, project.payload, offer);
    return;
  }
  const main = portfolio.characters().find((character) => character.isSeller);
  if (!main?.balance) throw Error("Сначала синхронизируйте баланс основного персонажа");
  const reservations = store.sql.prepare("SELECT amount FROM production_reservations WHERE paid=0").all() as { amount: string }[];
  const available = D(main.balance).minus(reservations.reduce((total, row) => total.plus(row.amount), D(0)));
  if (D(offer.estimate.cashRequired ?? offer.estimate.totalCost).gt(available))
    throw Error(`Для проекта сейчас нужно ${offer.estimate.cashRequired ?? offer.estimate.totalCost} ISK, доступно после резервов ${available.toFixed(2)} ISK`);
  const blueprintSource = store.sql.prepare(
    "SELECT id,quantity,runs FROM blueprint_sources WHERE source_kind='owned' AND source_id=? AND status='available'",
  ).get(offer.estimate.blueprintItemId) as { id: string; quantity: number; runs: number | null } | undefined;
  if (!blueprintSource) throw Error("Чертёж больше не найден в синхронизации ESI");
  const blueprintAllocations = store.sql.prepare(
    `SELECT a.runs FROM blueprint_run_allocations a JOIN production_projects p ON p.id=a.project_id
     WHERE a.blueprint_source_id=? AND p.status NOT IN ('cancelled','completed')`,
  ).all(blueprintSource.id) as { runs: number }[];
  if (blueprintSource.runs === -1 && blueprintAllocations.length)
    throw Error("Этот BPO уже назначен другому активному проекту");
  if (blueprintSource.runs !== -1 && !canReserveBlueprintRuns(
    blueprintSource.runs ?? 0,
    blueprintAllocations.map((row) => row.runs),
    offer.runs,
  ))
    throw Error("Оставшихся прогонов BPC недостаточно; обновите предложение");
  const staticData = market.data ?? bundledStatic;
  const station = staticData.stations.find((item) => item.systemId === offer.systemId);
  const snapshot = station ? latestSnapshots(store, [station.regionId])[0] : undefined;
  const snapshotId = randomUUID();
  const now = new Date().toISOString();
  const payload = { ...JSON.parse(project.payload), estimate: offer.estimate,
    expectedCost: offer.estimate.totalCost, cashRequired: offer.estimate.cashRequired ?? offer.estimate.totalCost,
    expectedProfit: offer.estimate.immediate.netProfit,
    startedAt: now, startSnapshotId: snapshotId };
  const profileAt = (store.sql.prepare("SELECT observed_at FROM production_character_profiles WHERE character_id=?").get(main.id) as { observed_at: string } | undefined)?.observed_at ?? null;
  store.sql.transaction(() => {
    store.sql.prepare("INSERT INTO calculation_snapshots VALUES (?,?,?,?,?,?,?,?,?)")
      .run(snapshotId, now, JSON.stringify(snapshot ? [snapshot.id] : []), staticData.version,
        profileAt, JSON.stringify([offer.estimate.facilityId]),
        JSON.stringify({ fullMarketSnapshot: !!snapshot, freshRecheck: true }), JSON.stringify(payload),
        offer.estimate.formulaVersion);
    store.sql.prepare("INSERT INTO project_plan_versions VALUES (?,2,?,?,?) ON CONFLICT(project_id,version) DO NOTHING")
      .run(projectId, now, snapshotId, JSON.stringify(payload));
    store.sql.prepare("UPDATE production_projects SET status='purchasing',updated_at=?,payload=? WHERE id=? AND status='pinned'")
      .run(now, JSON.stringify(payload), projectId);
    store.sql.prepare("INSERT INTO production_reservations(id,project_id,type_id,kind,amount,quantity,paid,created_at) VALUES (?,?,NULL,'purchase',?,NULL,0,?)")
      .run(randomUUID(), projectId, offer.estimate.cashRequired ?? offer.estimate.totalCost, now);
    const manufacturingNodeId = randomUUID();
    store.sql.prepare("INSERT INTO project_nodes(id,project_id,node_key,node_type,status,payload) VALUES (?,?,?,'manufacturing','planned',?)")
        .run(manufacturingNodeId, projectId, `manufacturing:${offer.estimate.blueprintItemId}`, JSON.stringify({ blueprintItemId: offer.estimate.blueprintItemId, runs: offer.runs, outputTypeId: offer.estimate.outputTypeId, outputQuantity: offer.estimate.outputQuantity, plannedTimeSeconds: offer.estimate.timeSeconds }));
    for (const material of offer.estimate.materials) {
      const purchaseNodeId = randomUUID();
      store.sql.prepare("INSERT INTO project_nodes(id,project_id,node_key,node_type,status,payload) VALUES (?,?,?,'purchase','needed',?)")
        .run(purchaseNodeId, projectId, `purchase:${material.typeId}`, JSON.stringify({ typeId: material.typeId, required: material.quantity, estimate: material.totalCost }));
      store.sql.prepare("INSERT INTO project_edges(project_id,from_node,to_node,type_id,quantity) VALUES (?,?,?,?,?)")
        .run(projectId, purchaseNodeId, manufacturingNodeId, material.typeId, material.quantity);
    }
    store.sql.prepare("INSERT INTO blueprint_run_allocations(id,blueprint_source_id,project_id,node_id,runs,created_at) VALUES (?,?,?,?,?,?)")
      .run(randomUUID(), blueprintSource.id, projectId, manufacturingNodeId, offer.runs, now);
  })();
}

function cancelProductionProject(projectId: string) {
  if (config.demo) throw Error("Отмена проекта недоступна в DEMO");
  const now = new Date().toISOString();
  store.sql.transaction(() => {
    store.sql.prepare("UPDATE production_projects SET status='cancelled',updated_at=? WHERE id=? AND status NOT IN ('completed','cancelled')")
      .run(now, projectId);
    store.sql.prepare("DELETE FROM production_reservations WHERE project_id=? AND paid=0").run(projectId);
    store.sql.prepare("UPDATE project_lot_allocations SET status='released' WHERE project_id=? AND status='reserved'").run(projectId);
  })();
}

function allocateProductionPurchase(request: {
  projectId: string;
  characterId: string;
  transactionId: string;
  quantity: number;
}) {
  const main = portfolio.characters().find((character) => character.isSeller);
  if (!main || main.id !== request.characterId)
    throw Error("Покупки производства учитываются только с основного персонажа");
  const project = store.sql.prepare("SELECT status,payload FROM production_projects WHERE id=?")
    .get(request.projectId) as { status: string; payload: string } | undefined;
  if (!project || !["purchasing", "partially_ready"].includes(project.status))
    throw Error("Проект не принимает покупки");
  const payload = JSON.parse(project.payload) as {
    projectKind?: "manufacturing" | "reprocessing";
    facilityId?: string;
    startedAt?: string;
    chainPlan?: ChainPlan;
    expectedCost: string;
    cashRequired?: string;
    estimate: ManufacturingEstimate | import("./production/reprocessing").ReprocessingEstimate;
  };
  const raw = store.sql.prepare("SELECT payload FROM wallet_transactions WHERE character_id=? AND id=?")
    .get(main.id, request.transactionId) as { payload: string } | undefined;
  if (!raw) throw Error("Покупка не найдена в истории кошелька основы");
  const parsed = transactionSchema.parse(JSON.parse(raw.payload));
  if (!parsed.is_buy || !parsed.is_personal || !payload.startedAt || parsed.date < payload.startedAt)
    throw Error("Можно учитывать только личную покупку после начала проекта");
  const productionStatic = market.data ?? bundledStatic;
  const hubSystemIds = new Set(["30000142", "30000144"]);
  const npcHubPurchase = productionStatic.stations.some((station) =>
    station.id === parsed.location_id && hubSystemIds.has(station.systemId),
  );
  const structureHubPurchase = store.sql.prepare(
    `SELECT 1 FROM production_facility_profiles
     WHERE location_id=? AND facility_kind='structure' AND access_status='confirmed'
       AND system_id IN ('30000142','30000144') LIMIT 1`,
  ).get(parsed.location_id);
  if (!npcHubPurchase && !structureHubPurchase)
    throw Error("Учитывать можно покупки только на доступных площадках Jita/Perimeter");
  const requiredMaterials = payload.projectKind === "reprocessing"
    ? (() => {
        const estimate = payload.estimate as import("./production/reprocessing").ReprocessingEstimate;
        return [{ typeId: estimate.inputTypeId, quantity: estimate.inputQuantity }];
      })()
    : payload.chainPlan?.status === "ready"
      ? [...payload.chainPlan.actions.filter((action) => action.kind === "purchase").reduce((map, action) => {
          const item = map.get(action.typeId) ?? { typeId: action.typeId, quantity: 0, typeName: action.typeName ?? `Type ${action.typeId}` };
          item.quantity += action.quantity;
          map.set(action.typeId, item);
          return map;
        }, new Map<string, { typeId: string; quantity: number; typeName: string }>()).values()]
      : (payload.estimate as ManufacturingEstimate).materials;
  const material = requiredMaterials.find((item) => item.typeId === parsed.type_id);
  if (!material) throw Error("Тип предмета не требуется этому проекту");
  const allocatedForMaterial = store.sql.prepare(
    "SELECT quantity FROM project_purchase_allocations WHERE project_id=? AND type_id=?",
  ).all(request.projectId, parsed.type_id) as { quantity: number }[];
  const allocatedFromLots = store.sql.prepare(
    `SELECT coalesce(sum(a.quantity),0) quantity FROM project_lot_allocations a
     JOIN project_output_lots l ON l.id=a.source_lot_id
     WHERE a.project_id=? AND l.type_id=? AND a.status IN ('reserved','consumed')`,
  ).get(request.projectId, parsed.type_id) as { quantity: number };
  const alreadyForProject = allocatedForMaterial.reduce((total, row) => total + row.quantity, 0) + allocatedFromLots.quantity;
  if (alreadyForProject + request.quantity > material.quantity)
    throw Error("Количество превышает оставшуюся потребность проекта");
  const tradeAllocated = (store.sql.prepare(
    "SELECT coalesce(sum(quantity),0) quantity FROM purchase_lots WHERE buyer_id=? AND transaction_id=?",
  ).get(main.id, parsed.transaction_id) as { quantity: number }).quantity;
  const allocationKey = `${main.id}:${parsed.transaction_id}`;
  const productionAllocated = (store.sql.prepare(
    "SELECT coalesce(sum(quantity),0) quantity FROM project_purchase_allocations WHERE source='wallet_transaction' AND source_id=?",
  ).get(allocationKey) as { quantity: number }).quantity;
  if (request.quantity > parsed.quantity - tradeAllocated - productionAllocated)
    throw Error("Эта транзакция уже распределена в другую сделку или проект");
  const actualCost = D(parsed.unit_price).mul(request.quantity).toFixed(2);
  const now = new Date().toISOString();
  store.sql.transaction(() => {
    const priorAllocation = store.sql.prepare(
      "SELECT quantity,actual_cost FROM project_purchase_allocations WHERE project_id=? AND source='wallet_transaction' AND source_id=? AND type_id=?",
    ).get(request.projectId, allocationKey, parsed.type_id) as { quantity: number; actual_cost: string } | undefined;
    if (priorAllocation)
      store.sql.prepare("UPDATE project_purchase_allocations SET quantity=?,actual_cost=?,allocated_at=? WHERE project_id=? AND source='wallet_transaction' AND source_id=? AND type_id=?")
        .run(priorAllocation.quantity + request.quantity, D(priorAllocation.actual_cost).plus(actualCost).toFixed(2), now, request.projectId, allocationKey, parsed.type_id);
    else
      store.sql.prepare(
        "INSERT INTO project_purchase_allocations(project_id,source,source_id,type_id,quantity,actual_cost,allocated_at) VALUES (?,'wallet_transaction',?,?,?,?,?)",
      ).run(request.projectId, allocationKey, parsed.type_id, request.quantity, actualCost, now);
    const allocations = store.sql.prepare(
      "SELECT quantity,actual_cost FROM project_purchase_allocations WHERE project_id=?",
    ).all(request.projectId) as { quantity: number; actual_cost: string }[];
    const actualTotal = allocations.reduce((total, row) => total.plus(row.actual_cost), D(0));
    const remaining = D(payload.cashRequired ?? payload.expectedCost).minus(actualTotal);
    store.sql.prepare("UPDATE production_reservations SET amount=?,paid=? WHERE project_id=? AND kind='purchase'")
      .run(remaining.gt(0) ? remaining.toFixed(2) : "0.00", remaining.lte(0) ? 1 : 0, request.projectId);
    const refreshed = store.sql.prepare(
      "SELECT type_id,quantity FROM project_purchase_allocations WHERE project_id=?",
    ).all(request.projectId) as { type_id: string; quantity: number }[];
    const totals = new Map<string, number>();
    for (const row of refreshed) totals.set(row.type_id, (totals.get(row.type_id) ?? 0) + row.quantity);
    let any = false;
    for (const required of requiredMaterials) {
      const quantity = totals.get(required.typeId) ?? 0;
      any ||= quantity > 0;
      const node = store.sql.prepare("SELECT id,payload FROM project_nodes WHERE project_id=? AND node_key=?")
        .get(request.projectId, `purchase:${required.typeId}`) as { id: string; payload: string } | undefined;
      if (node) {
        const nodePayload = JSON.parse(node.payload) as Record<string, unknown>;
        store.sql.prepare("UPDATE project_nodes SET status=?,payload=? WHERE id=?")
          .run(quantity >= required.quantity ? "ready" : quantity ? "partial" : "needed",
            JSON.stringify({ ...nodePayload, acquired: quantity }), node.id);
      }
    }
    const status = any ? "partially_ready" : "purchasing";
    store.sql.prepare("UPDATE production_projects SET status=?,updated_at=? WHERE id=?")
      .run(status, now, request.projectId);
  })();
}

function confirmProductionReprocessing(request: {
  projectId: string; consumedInput: number; actualFee: string;
  outputs: { typeId: string; quantity: number }[]; evidence: string; actionId: string;
}) {
  if (config.demo) throw Error("Сверка переработки недоступна в DEMO");
  const requestPayload = JSON.stringify(request);
  const receipt = store.sql.prepare("SELECT request_payload FROM production_action_receipts WHERE action_id=?")
    .get(request.actionId) as { request_payload: string } | undefined;
  if (receipt) {
    if (receipt.request_payload !== requestPayload) throw Error("Ключ сверки уже использован для другой операции");
    return;
  }
  const project = store.sql.prepare("SELECT status,payload FROM production_projects WHERE id=?")
    .get(request.projectId) as { status: string; payload: string } | undefined;
  if (!project || project.status !== "partially_ready") throw Error("Проект не готов к ручной сверке переработки");
  const payload = JSON.parse(project.payload) as {
    projectKind?: string; expectedCost: string; estimate: import("./production/reprocessing").ReprocessingEstimate;
  };
  if (payload.projectKind !== "reprocessing" || payload.estimate.status !== "ready")
    throw Error("Этот проект не содержит подтверждённого расчёта reprocessing");
  const estimate = payload.estimate;
  if (request.consumedInput > estimate.inputQuantity || request.consumedInput % estimate.portionSize !== 0)
    throw Error(`Можно подтвердить не больше ${estimate.inputQuantity} шт. целыми порциями по ${estimate.portionSize}`);
  const uniqueOutputTypes = new Set(request.outputs.map((output) => output.typeId));
  const expectedOutputTypes = new Set(estimate.outputs.map((output) => output.typeId));
  if (uniqueOutputTypes.size !== request.outputs.length || uniqueOutputTypes.size !== expectedOutputTypes.size ||
      [...uniqueOutputTypes].some((typeId) => !expectedOutputTypes.has(typeId)))
    throw Error("Укажите фактическое количество для каждого и только каждого материала выхода из Reprocess preview");
  const inputAllocations = store.sql.prepare("SELECT quantity,actual_cost FROM project_purchase_allocations WHERE project_id=? AND type_id=?")
    .all(request.projectId, estimate.inputTypeId) as { quantity: number; actual_cost: string }[];
  const purchased = inputAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0);
  const actualInputSpend = inputAllocations.reduce((sum, allocation) => sum.plus(allocation.actual_cost), D(0));
  if (purchased < estimate.inputQuantity || request.consumedInput > purchased)
    throw Error("Сначала полностью распределите покупку входного материала проекта");
  const outputs = request.outputs.map((actual) => {
    const forecast = estimate.outputs.find((item) => item.typeId === actual.typeId)!;
    const referencePrice = forecast.quantity > 0 && forecast.buyGross
      ? D(forecast.buyGross).div(forecast.quantity)
      : forecast.askPrice ? D(forecast.askPrice) : null;
    if (actual.quantity > 0 && (!referencePrice || !referencePrice.gt(0)))
      throw Error(`Нет надёжной цены распределения себестоимости для выхода ${actual.typeId}`);
    return { ...actual, forecast, weight: referencePrice ? referencePrice.mul(actual.quantity) : D(0) };
  });
  if (!outputs.some((output) => output.quantity > 0) && request.consumedInput > 0)
    throw Error("Для переработанного входа не указан ни один фактический выход");
  const consumedCost = purchased > 0
    ? actualInputSpend.mul(request.consumedInput).div(purchased).toDecimalPlaces(2)
    : D(0);
  const residualQuantity = purchased - request.consumedInput;
  const residualCost = actualInputSpend.minus(consumedCost);
  const costForOutputs = consumedCost.plus(request.actualFee);
  const totalWeight = outputs.reduce((sum, output) => sum.plus(output.weight), D(0));
  if (outputs.some((output) => output.quantity > 0) && !totalWeight.gt(0))
    throw Error("Невозможно распределить фактическую себестоимость между выходами");
  const now = new Date().toISOString();
  store.sql.transaction(() => {
    const confirmationPayload = JSON.stringify({
      consumedInput: request.consumedInput, purchased, residualQuantity,
      residualCost: residualCost.toFixed(2), actualFee: request.actualFee,
      outputs: request.outputs, evidence: request.evidence,
    });
    store.sql.prepare("INSERT INTO reprocessing_confirmations(id,project_id,node_id,confirmed_at,source,payload) VALUES (?,?,?,?, 'manual', ?)")
      .run(request.actionId, request.projectId,
        (store.sql.prepare("SELECT id FROM project_nodes WHERE project_id=? AND node_type='reprocessing' LIMIT 1").get(request.projectId) as { id: string }).id,
        now, confirmationPayload);
    store.sql.prepare("INSERT INTO project_cost_events(id,project_id,source,source_id,event_type,amount,occurred_at,observed_at,payload) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(randomUUID(), request.projectId, "manual_reprocessing", request.actionId, "reprocessing_fee",
        request.actualFee, now, now, JSON.stringify({ evidence: request.evidence }));
    const node = store.sql.prepare("SELECT id FROM project_nodes WHERE project_id=? AND node_type='reprocessing' LIMIT 1")
      .get(request.projectId) as { id: string };
    let remainingCost = costForOutputs;
    const positive = outputs.filter((output) => output.quantity > 0);
    for (let index = 0; index < positive.length; index++) {
      const output = positive[index]!;
      const allocatedCost = index === positive.length - 1
        ? remainingCost
        : costForOutputs.mul(output.weight).div(totalWeight).toDecimalPlaces(2);
      remainingCost = remainingCost.minus(allocatedCost);
      const unitCost = allocatedCost.div(output.quantity).toFixed(8);
      store.sql.prepare("INSERT INTO project_output_lots(id,project_id,node_id,type_id,quantity,remaining,unit_cost,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(randomUUID(), request.projectId, node.id, output.typeId, output.quantity, output.quantity,
          unitCost, `${request.actionId}:${output.typeId}`, now);
    }
    if (residualQuantity > 0) {
      store.sql.prepare("INSERT INTO project_output_lots(id,project_id,node_id,type_id,quantity,remaining,unit_cost,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(randomUUID(), request.projectId, node.id, estimate.inputTypeId, residualQuantity,
          residualQuantity, residualCost.div(residualQuantity).toFixed(8), `${request.actionId}:residual`, now);
    }
    store.sql.prepare("UPDATE project_nodes SET status='complete',payload=json_set(payload,'$.confirmationId',?,'$.confirmation',json(?)) WHERE id=?")
      .run(request.actionId, confirmationPayload, node.id);
    store.sql.prepare("UPDATE production_reservations SET amount='0',paid=1 WHERE project_id=? AND paid=0").run(request.projectId);
    store.sql.prepare("INSERT INTO production_action_receipts(action_id,action_kind,request_payload,created_at) VALUES (?,'reprocessing.confirm',?,?)")
      .run(request.actionId, requestPayload, now);
    store.sql.prepare("UPDATE production_projects SET status='ready_for_sale',updated_at=? WHERE id=?")
      .run(now, request.projectId);
  })();
}

function reconcileBoundProductionJobs(characterId: string) {
  const links = store.sql.prepare(
    `SELECT l.project_id,l.node_id,l.job_id,p.status AS project_status,p.payload AS project_payload,
            j.payload AS job_payload
     FROM project_job_links l JOIN production_projects p ON p.id=l.project_id
     LEFT JOIN production_jobs j ON j.character_id=l.character_id AND j.job_id=l.job_id
     WHERE l.character_id=?`,
  ).all(characterId) as { project_id: string; node_id: string; job_id: string; project_status: string; project_payload: string; job_payload: string | null }[];
  for (const link of links) {
    if (!link.job_payload || ["cancelled", "completed"].includes(link.project_status)) continue;
    const job = JSON.parse(link.job_payload) as { status: string; end_date: string; cost?: string };
    const now = new Date().toISOString();
    store.sql.prepare("UPDATE project_job_links SET source_status=?,observed_at=?,payload=? WHERE character_id=? AND job_id=?")
      .run(job.status, now, link.job_payload, characterId, link.job_id);
    if (["cancelled", "reverted"].includes(job.status)) {
      store.sql.prepare("UPDATE project_nodes SET status='needs_review' WHERE id=?").run(link.node_id);
      store.sql.prepare("UPDATE production_projects SET status='needs_review',updated_at=? WHERE id=?")
        .run(now, link.project_id);
      continue;
    }
    if (job.status !== "delivered") {
      const nodeStatus = job.status === "ready" ? "ready" : "in_production";
      store.sql.prepare("UPDATE project_nodes SET status=? WHERE id=?").run(nodeStatus, link.node_id);
      if (!["partially_sold", "reconciling"].includes(link.project_status))
        store.sql.prepare("UPDATE production_projects SET status='in_production',updated_at=? WHERE id=?")
          .run(now, link.project_id);
      continue;
    }
    if (job.cost === undefined || job.cost === null) {
      store.sql.prepare("UPDATE project_nodes SET status='needs_review' WHERE id=?").run(link.node_id);
      store.sql.prepare("UPDATE production_projects SET status='reconciling',updated_at=? WHERE id=?")
        .run(now, link.project_id);
      continue;
    }
    const projectPayload = JSON.parse(link.project_payload) as { outputQuantity: number; estimate: ManufacturingEstimate };
    const nodeInfo = store.sql.prepare("SELECT payload FROM project_nodes WHERE id=?").get(link.node_id) as { payload: string } | undefined;
    const nodeDetail = nodeInfo ? JSON.parse(nodeInfo.payload) as {
      isFinal?: boolean; outputTypeId?: string; outputQuantity?: number; requiredOutput?: number;
      blueprintAcquisitionCost?: string;
      blueprintItemId?: string; runs?: number;
    } : {};
    const isFinalNode = nodeDetail.isFinal ?? true;
    const existingOutput = store.sql.prepare("SELECT 1 FROM project_output_lots WHERE project_id=? AND node_id=? AND source_id=?")
      .get(link.project_id, link.node_id, link.job_id);
    if (existingOutput) continue;
    const inputEdges = store.sql.prepare(
      `SELECT e.type_id,e.quantity,n.id source_node_id,n.node_type,n.payload
       FROM project_edges e JOIN project_nodes n ON n.id=e.from_node
       WHERE e.project_id=? AND e.to_node=?`,
    ).all(link.project_id, link.node_id) as { type_id: string; quantity: number; source_node_id: string; node_type: string; payload: string }[];
    let inputCost = D(0);
    const inventoryConsumptions: { allocationId: string; lotId: string; quantity: number }[] = [];
    for (const edge of inputEdges) {
      const edgePayload = JSON.parse(edge.payload) as { sourceLotId?: string; unitCost?: string };
      if (edge.node_type === "purchase" && edgePayload.sourceLotId) {
        const source = edgePayload;
        const allocation = store.sql.prepare(
          `SELECT id,quantity,consumed_quantity FROM project_lot_allocations
           WHERE project_id=? AND node_id=? AND status='reserved'`,
        ).get(link.project_id, edge.source_node_id) as { id: string; quantity: number; consumed_quantity: number } | undefined;
        if (!allocation || !source.sourceLotId || !source.unitCost ||
            edge.quantity > allocation.quantity - allocation.consumed_quantity) {
          store.sql.prepare("UPDATE project_nodes SET status='needs_review' WHERE id=?").run(link.node_id);
          store.sql.prepare("UPDATE production_projects SET status='needs_review',updated_at=? WHERE id=?").run(now, link.project_id);
          inputCost = D(-1);
          break;
        }
        inventoryConsumptions.push({ allocationId: allocation.id, lotId: source.sourceLotId, quantity: edge.quantity });
        inputCost = inputCost.plus(D(source.unitCost).mul(edge.quantity));
      } else if (edge.node_type === "purchase") {
        const allocatedRows = store.sql.prepare("SELECT quantity,actual_cost FROM project_purchase_allocations WHERE project_id=? AND type_id=?")
          .all(link.project_id, edge.type_id) as { quantity: number; actual_cost: string }[];
        const allocated = allocatedRows.reduce((total, row) => ({
          quantity: total.quantity + row.quantity,
          cost: total.cost.plus(row.actual_cost),
        }), { quantity: 0, cost: D(0) });
        if (allocated.quantity < edge.quantity) {
          store.sql.prepare("UPDATE project_nodes SET status='needs_review' WHERE id=?").run(link.node_id);
          store.sql.prepare("UPDATE production_projects SET status='needs_review',updated_at=? WHERE id=?").run(now, link.project_id);
          inputCost = D(-1);
          break;
        }
        inputCost = inputCost.plus(allocated.cost.div(allocated.quantity).mul(edge.quantity));
      } else if (edge.node_type === "manufacturing") {
        const component = store.sql.prepare("SELECT unit_cost,quantity FROM project_output_lots WHERE project_id=? AND node_id=? AND type_id=?")
          .get(link.project_id, edge.source_node_id, edge.type_id) as { unit_cost: string; quantity: number } | undefined;
        if (!component || component.quantity < edge.quantity) {
          store.sql.prepare("UPDATE project_nodes SET status='needs_review' WHERE id=?").run(link.node_id);
          store.sql.prepare("UPDATE production_projects SET status='needs_review',updated_at=? WHERE id=?").run(now, link.project_id);
          inputCost = D(-1);
          break;
        }
        inputCost = inputCost.plus(D(component.unit_cost).mul(edge.quantity));
      }
    }
    if (inputCost.isNegative()) continue;
    const producedQuantity = nodeDetail.outputQuantity ?? projectPayload.outputQuantity;
    const requiredOutput = Math.min(producedQuantity, nodeDetail.requiredOutput ?? producedQuantity);
    if (producedQuantity <= 0) {
      store.sql.prepare("UPDATE project_nodes SET status='needs_review' WHERE id=?").run(link.node_id);
      store.sql.prepare("UPDATE production_projects SET status='needs_review',updated_at=? WHERE id=?").run(now, link.project_id);
      continue;
    }
    const actualCost = inputCost.plus(job.cost!).plus(nodeDetail.blueprintAcquisitionCost ?? "0");
    const unitCost = actualCost.div(producedQuantity).toFixed(8);
    const availableSurplus = isFinalNode ? producedQuantity : Math.max(0, producedQuantity - requiredOutput);
    store.sql.transaction(() => {
      for (const consumption of inventoryConsumptions) {
        const lotUpdate = store.sql.prepare("UPDATE project_output_lots SET remaining=remaining-? WHERE id=? AND remaining>=?")
          .run(consumption.quantity, consumption.lotId, consumption.quantity);
        if (lotUpdate.changes !== 1) throw Error("Зарезервированный остаток изменился; этап требует сверки");
        const allocationUpdate = store.sql.prepare(
          `UPDATE project_lot_allocations
           SET consumed_quantity=consumed_quantity+?,
               status=CASE WHEN consumed_quantity+? >= quantity THEN 'consumed' ELSE 'reserved' END,
               consumed_at=? WHERE id=? AND status='reserved' AND consumed_quantity+?<=quantity`,
        ).run(consumption.quantity, consumption.quantity, now, consumption.allocationId, consumption.quantity);
        if (allocationUpdate.changes !== 1) throw Error("Учёт потребления остатка изменился; этап требует сверки");
      }
      store.sql.prepare("UPDATE project_nodes SET status='complete',payload=json_set(payload,'$.actualCost',?,'$.unitCost',?) WHERE id=?")
        .run(actualCost.toFixed(2), unitCost, link.node_id);
      store.sql.prepare("INSERT INTO project_output_lots(id,project_id,node_id,type_id,quantity,remaining,unit_cost,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(randomUUID(), link.project_id, link.node_id, nodeDetail.outputTypeId ?? projectPayload.estimate.outputTypeId,
          producedQuantity, availableSurplus, unitCost, link.job_id, job.end_date);
      if (job.cost !== undefined) {
        store.sql.prepare("INSERT OR IGNORE INTO project_cost_events(id,project_id,source,source_id,event_type,amount,occurred_at,observed_at,payload) VALUES (?,?,?,?,?,?,?,?,?)")
          .run(randomUUID(), link.project_id, "esi_industry_job", link.job_id, "industry_fee", job.cost, job.end_date, now, link.job_payload);
      }
      if (nodeDetail.blueprintAcquisitionCost && D(nodeDetail.blueprintAcquisitionCost).gt(0)) {
        store.sql.prepare("INSERT OR IGNORE INTO project_cost_events(id,project_id,source,source_id,event_type,amount,occurred_at,observed_at,payload) VALUES (?,?,?,?,?,?,?,?,?)")
          .run(randomUUID(), link.project_id, "blueprint_contract", `${link.project_id}:${link.node_id}`, "blueprint_acquisition_allocation",
            nodeDetail.blueprintAcquisitionCost, job.end_date, now, JSON.stringify({ blueprintId: nodeDetail.blueprintItemId ?? null, runs: nodeDetail.runs ?? null }));
      }
      const unfinished = (store.sql.prepare("SELECT count(*) count FROM project_nodes WHERE project_id=? AND node_type='manufacturing' AND status<>'complete'")
        .get(link.project_id) as { count: number }).count;
      if (!unfinished && isFinalNode) {
        store.sql.prepare("UPDATE production_reservations SET amount='0',paid=1 WHERE project_id=? AND paid=0")
          .run(link.project_id);
        if (!["partially_sold", "completed"].includes(link.project_status))
          store.sql.prepare("UPDATE production_projects SET status='ready_for_sale',updated_at=? WHERE id=?")
            .run(now, link.project_id);
      } else {
        store.sql.prepare("UPDATE production_projects SET status='in_production',updated_at=? WHERE id=?")
          .run(now, link.project_id);
      }
    })();
  }
}

function bindProductionJob(projectId: string, jobId: string, requestedNodeId?: string) {
  if (config.demo) throw Error("Сверка задания производства недоступна в DEMO");
  const main = portfolio.characters().find((character) => character.isSeller);
  if (!main) throw Error("Сначала подключите основного персонажа");
  const project = store.sql.prepare("SELECT status,payload FROM production_projects WHERE id=?").get(projectId) as
    { status: string; payload: string } | undefined;
  if (!project || !["purchasing", "partially_ready", "in_production"].includes(project.status))
    throw Error("Проект не ожидает производственного задания");
  const payload = JSON.parse(project.payload) as { startedAt?: string; estimate: ManufacturingEstimate; outputQuantity: number };
  const jobRow = store.sql.prepare("SELECT payload FROM production_jobs WHERE character_id=? AND job_id=?")
    .get(main.id, jobId) as { payload: string } | undefined;
  if (!jobRow) throw Error("Задание не найдено в последней синхронизации ESI основы");
  const job = JSON.parse(jobRow.payload) as {
    job_id: string; activity_id: number; blueprint_id: string; blueprint_type_id: string;
    facility_id: string; product_type_id?: string; runs: number; status: string;
    start_date: string; end_date: string; cost?: string;
  };
  if (["cancelled", "reverted"].includes(job.status)) throw Error("Отменённое или отозванное задание нельзя связать с проектом");
  const existing = store.sql.prepare("SELECT project_id FROM project_job_links WHERE character_id=? AND job_id=?")
    .get(main.id, jobId) as { project_id: string } | undefined;
  if (existing) throw Error(existing.project_id === projectId ? "Задание уже связано с этим проектом" : "Задание уже распределено в другой проект");
  if (!payload.startedAt || job.start_date < payload.startedAt)
    throw Error("Задание началось до запуска проекта и не может быть учтено как его выпуск");
  const node = requestedNodeId
    ? store.sql.prepare("SELECT id,status,payload FROM project_nodes WHERE project_id=? AND id=? AND node_type='manufacturing'").get(projectId, requestedNodeId)
    : store.sql.prepare("SELECT n.id,n.status,n.payload FROM project_nodes n LEFT JOIN project_job_links l ON l.node_id=n.id WHERE n.project_id=? AND n.node_type='manufacturing' AND l.node_id IS NULL ORDER BY n.rowid LIMIT 1").get(projectId);
  const typedNode = node as { id: string; status: string; payload: string } | undefined;
  if (!typedNode) throw Error("К проекту уже привязаны все производственные задания; повторная привязка удвоила бы выпуск");
  if (typedNode.status === "complete") throw Error("Этот производственный этап уже завершён");
  const alreadyBoundToNode = store.sql.prepare("SELECT job_id FROM project_job_links WHERE project_id=? AND node_id=? LIMIT 1")
    .get(projectId, typedNode.id) as { job_id: string } | undefined;
  if (alreadyBoundToNode) throw Error("К этому этапу уже привязано задание; повторная привязка удвоила бы выпуск");
  const detail = JSON.parse(typedNode.payload) as { blueprintItemId?: string; blueprintTypeId?: string; outputTypeId?: string; outputQuantity?: number; runs?: number; facilityId?: string; inputMaterials?: { typeId: string; quantity: number; typeName: string }[] };
  const rootEstimate = payload.estimate;
  const expectedBlueprintId = detail.blueprintItemId ?? rootEstimate.blueprintItemId;
  const expectedBlueprintTypeId = detail.blueprintTypeId ?? rootEstimate.blueprintTypeId;
  const expectedFacilityId = detail.facilityId ?? rootEstimate.facilityId;
  const expectedOutputTypeId = detail.outputTypeId ?? rootEstimate.outputTypeId;
  const expectedRuns = detail.runs ?? rootEstimate.runs;
  if (job.activity_id !== 1 || job.blueprint_id !== expectedBlueprintId ||
      job.blueprint_type_id !== expectedBlueprintTypeId || job.product_type_id !== expectedOutputTypeId || job.runs !== expectedRuns)
    throw Error("Задание ESI не совпадает с чертежом, продуктом или прогонами выбранного этапа");
  if (job.facility_id !== expectedFacilityId)
    throw Error("Задание ESI запущено не на площадке выбранного производственного этапа");
  const allocated = store.sql.prepare("SELECT type_id,sum(quantity) quantity FROM project_purchase_allocations WHERE project_id=? GROUP BY type_id")
    .all(projectId) as { type_id: string; quantity: number }[];
  const quantityByType = new Map(allocated.map((row) => [row.type_id, row.quantity]));
  const inputRequirements = detail.inputMaterials ?? rootEstimate.materials;
  const missing = inputRequirements.filter((material) => {
    const buyRequirement = (store.sql.prepare(
      `SELECT coalesce(sum(e.quantity),0) quantity FROM project_edges e JOIN project_nodes n ON n.id=e.from_node
       WHERE e.project_id=? AND e.type_id=? AND n.node_type='purchase'
         AND json_extract(n.payload,'$.sourceLotId') IS NULL`,
    ).get(projectId, material.typeId) as { quantity: number }).quantity;
    if (!buyRequirement) return false;
    return (quantityByType.get(material.typeId) ?? 0) < buyRequirement;
  });
  if (missing.length) throw Error("Сначала обеспечьте материалы этапа: " + missing.map((material) => material.typeName).join(", "));
  const dependencies = store.sql.prepare(
    `SELECT n.status FROM project_edges e JOIN project_nodes n ON n.id=e.from_node
     WHERE e.project_id=? AND e.to_node=? AND n.node_type='manufacturing'`,
  ).all(projectId, typedNode.id) as { status: string }[];
  if (dependencies.some((dependency) => dependency.status !== "complete"))
    throw Error("Сначала завершите предыдущие производственные этапы цепочки");
  const now = new Date().toISOString();
  store.sql.prepare("INSERT INTO project_job_links(project_id,node_id,character_id,job_id,source_status,observed_at,payload) VALUES (?,?,?,?,?,?,?)")
    .run(projectId, typedNode.id, main.id, jobId, job.status, now, jobRow.payload);
  reconcileBoundProductionJobs(main.id);
}

function allocateProductionSale(request: {
  projectId: string; transactionId: string; outputLotId: string; quantity: number; actionId: string;
}) {
  if (config.demo) throw Error("Сверка продаж производства недоступна в DEMO");
  const requestPayload = JSON.stringify(request);
  const priorAction = store.sql.prepare("SELECT request_payload FROM production_action_receipts WHERE action_id=?")
    .get(request.actionId) as { request_payload: string } | undefined;
  if (priorAction) {
    if (priorAction.request_payload !== requestPayload) throw Error("Ключ сверки уже использован для другой операции");
    return;
  }
  const main = portfolio.characters().find((character) => character.isSeller);
  if (!main) throw Error("Сначала подключите основного персонажа");
  const lot = store.sql.prepare(
    `SELECT l.type_id,l.remaining,l.unit_cost,l.created_at,p.status,
            coalesce(json_extract(n.payload,'$.isFinal'),1) is_final,
            coalesce((SELECT sum(a.quantity-a.consumed_quantity) FROM project_lot_allocations a
                      WHERE a.source_lot_id=l.id AND a.status='reserved'),0) reserved
     FROM project_output_lots l JOIN production_projects p ON p.id=l.project_id
     LEFT JOIN project_nodes n ON n.id=l.node_id WHERE l.id=? AND l.project_id=?`,
  ).get(request.outputLotId, request.projectId) as { type_id: string; remaining: number; reserved: number; unit_cost: string; created_at: string; status: string; is_final: number } | undefined;
  if (!lot || lot.remaining <= 0) throw Error("Остаток выпуска проекта не найден");
  if (lot.is_final !== 1) throw Error("Промежуточный компонент проекта нельзя отметить как проданный; он зарезервирован для последующих этапов");
  const raw = store.sql.prepare("SELECT payload FROM wallet_transactions WHERE character_id=? AND id=?")
    .get(main.id, request.transactionId) as { payload: string } | undefined;
  if (!raw) throw Error("Продажа не найдена в истории кошелька основы; синхронизируйте ESI");
  const tx = transactionSchema.parse(JSON.parse(raw.payload));
  if (tx.is_buy || !tx.is_personal || tx.type_id !== lot.type_id || tx.date < lot.created_at)
    throw Error("Транзакция не является личной продажей этого продукта после выпуска проекта");
  const targetStations = new Set((market.data?.stations ?? bundledStatic.stations)
    .filter((station) => ["30000142", "30000144"].includes(station.systemId)).map((station) => station.id));
  if (!targetStations.has(tx.location_id)) throw Error("Продажа была не в Jita/Perimeter");
  const journalRaw = store.sql.prepare("SELECT payload FROM wallet_journal WHERE character_id=? AND id=?")
    .get(main.id, tx.journal_ref_id) as { payload: string } | undefined;
  if (!journalRaw) throw Error("Поступление после комиссии ещё не найдено в ESI journal; повторите синхронизацию");
  const journal = journalSchema.parse(JSON.parse(journalRaw.payload));
  if (journal.ref_type !== "market_transaction" || !journal.amount || D(journal.amount).lte(0))
    throw Error("Не найдено положительное поступление ISK по этой рыночной продаже");
  const previousTradeSales = (store.sql.prepare("SELECT coalesce(sum(quantity),0) quantity FROM sale_allocations WHERE seller_id=? AND transaction_id=?")
    .get(main.id, tx.transaction_id) as { quantity: number }).quantity;
  const previousProductionSales = store.sql.prepare("SELECT coalesce(sum(quantity),0) quantity FROM project_sales_allocations WHERE character_id=? AND transaction_id=?")
    .get(main.id, tx.transaction_id) as { quantity: number };
  const available = tx.quantity - previousTradeSales - previousProductionSales.quantity;
  const unreservedRemaining = Math.max(0, lot.remaining - lot.reserved);
  if (request.quantity > unreservedRemaining || request.quantity > available)
    throw Error(`Можно распределить не больше ${Math.max(0, Math.min(unreservedRemaining, available))} шт.`);
  const priorNet = store.sql.prepare("SELECT net FROM project_sales_allocations WHERE character_id=? AND transaction_id=?")
    .all(main.id, tx.transaction_id) as { net: string }[];
  const netAlreadyAllocated = priorNet.reduce((total, row) => total.plus(row.net), D(0));
  const tradeNetAllocated = D(journal.amount).mul(previousTradeSales).div(tx.quantity).toDecimalPlaces(2);
  const lastPart = request.quantity === available;
  const net = lastPart
    ? D(journal.amount).minus(tradeNetAllocated).minus(netAlreadyAllocated).toFixed(2)
    : D(journal.amount).mul(request.quantity).div(tx.quantity).toDecimalPlaces(2).toFixed(2);
  if (D(net).lte(0)) throw Error("Чистое поступление по выбранной части продажи равно нулю");
  const now = new Date().toISOString();
  store.sql.transaction(() => {
    const update = store.sql.prepare(
      `UPDATE project_output_lots SET remaining=remaining-?
       WHERE id=? AND remaining-coalesce((SELECT sum(a.quantity-a.consumed_quantity) FROM project_lot_allocations a
                                         WHERE a.source_lot_id=project_output_lots.id AND a.status='reserved'),0)>=?`,
    ).run(request.quantity, request.outputLotId, request.quantity);
    if (update.changes !== 1) throw Error("Остаток выпуска изменился; обновите список продаж");
    const priorAllocation = store.sql.prepare("SELECT quantity,gross,net FROM project_sales_allocations WHERE character_id=? AND transaction_id=? AND output_lot_id=?")
      .get(main.id, tx.transaction_id, request.outputLotId) as { quantity: number; gross: string; net: string } | undefined;
    if (priorAllocation) {
      store.sql.prepare("UPDATE project_sales_allocations SET quantity=?,gross=?,net=?,observed_at=? WHERE character_id=? AND transaction_id=? AND output_lot_id=?")
        .run(priorAllocation.quantity + request.quantity,
          D(priorAllocation.gross).plus(D(tx.unit_price).mul(request.quantity)).toFixed(2),
          D(priorAllocation.net).plus(net).toFixed(2), now, main.id, tx.transaction_id, request.outputLotId);
    } else {
      store.sql.prepare("INSERT INTO project_sales_allocations(output_lot_id,character_id,transaction_id,quantity,gross,net,observed_at) VALUES (?,?,?,?,?,?,?)")
        .run(request.outputLotId, main.id, tx.transaction_id, request.quantity,
          D(tx.unit_price).mul(request.quantity).toFixed(2), net, now);
    }
    store.sql.prepare("INSERT INTO production_action_receipts(action_id,action_kind,request_payload,created_at) VALUES (?,'sale.allocate',?,?)")
      .run(request.actionId, requestPayload, now);
    const remaining = store.sql.prepare("SELECT coalesce(sum(remaining),0) quantity FROM project_output_lots WHERE project_id=?")
      .get(request.projectId) as { quantity: number };
    const missingJobCosts = store.sql.prepare(
      "SELECT count(*) count FROM project_job_links WHERE project_id=? AND json_extract(payload,'$.cost') IS NULL",
    ).get(request.projectId) as { count: number };
    const status = remaining.quantity > 0 ? "partially_sold" : missingJobCosts.count ? "reconciling" : "completed";
    store.sql.prepare("UPDATE production_projects SET status=?,updated_at=? WHERE id=?")
      .run(status, now, request.projectId);
  })();
}

parentPort!.on(
  "message",
  async (message: {
    id: string;
    request: unknown;
    backupPath?: string;
    internal?:
      | {
          kind: "connected";
          id: string;
          name: string;
          seller: boolean;
          scopes: string[];
        }
      | {
          kind: "wallets";
          wallets: WalletData[];
          profile?: ProfileData;
          scopes?: Record<string, string[]>;
        }
      | {
          kind: "production-data";
          characterId: string;
          profile: ProfileData;
          own: OwnProductionData;
          publicData: PublicProductionData;
          structureMarkets: StructureMarketSync[];
        }
      | { kind: "production-scopes"; characterId: string; scopes: string[] }
      | { kind: "public-production"; publicData: PublicProductionData }
      | { kind: "suspend" | "resume" };
  }) => {
    try {
      if (
        message.internal &&
        message.internal.kind !== "suspend" &&
        message.internal.kind !== "resume"
      )
        invalidateProductionState();
      if (message.internal?.kind === "suspend") market.scheduler.suspend();
      if (message.internal?.kind === "resume") market.scheduler.resume();
      if (message.internal?.kind === "public-production") {
        const { publicData } = message.internal;
        const observedAt = publicData.at;
        store.sql.transaction(() => {
          const stationNames = new Map(
            (market.data?.stations ?? bundledStatic.stations).map((station) => [
              station.id,
              station.name,
            ]),
          );
          const facilityInsert = store.sql.prepare(
            `INSERT INTO production_facility_profiles(location_id,name,system_id,facility_kind,services_payload,industry_tax,access_status,profile_source,observed_at)
             VALUES (?,?,?,?,'[]',?,'unknown','esi',?)
             ON CONFLICT(location_id) DO UPDATE SET system_id=excluded.system_id,industry_tax=CASE WHEN production_facility_profiles.profile_source='manual' THEN production_facility_profiles.industry_tax ELSE excluded.industry_tax END,profile_source=production_facility_profiles.profile_source,observed_at=CASE WHEN production_facility_profiles.profile_source='manual' THEN production_facility_profiles.observed_at ELSE excluded.observed_at END`,
          );
          for (const row of publicData.facilities)
            facilityInsert.run(
              row.id,
              stationNames.get(row.id) ?? `Объект ${row.id}`,
              row.systemId,
              stationNames.has(row.id) ? "npc_station" : "structure",
              row.tax,
              observedAt,
            );
          store.sql.prepare("DELETE FROM production_system_indices").run();
          const indexInsert = store.sql.prepare(
            "INSERT INTO production_system_indices VALUES (?,?,?,?)",
          );
          for (const [systemId, entries] of publicData.systemIndices)
            for (const entry of entries)
              indexInsert.run(systemId, entry.activity, entry.costIndex, observedAt);
          store.sql.prepare("DELETE FROM production_adjusted_prices").run();
          const priceInsert = store.sql.prepare(
            "INSERT INTO production_adjusted_prices VALUES (?,?,?)",
          );
          for (const [typeId, price] of publicData.adjustedPrices)
            priceInsert.run(typeId, price, observedAt);
          store.sql
            .prepare(
              "INSERT INTO production_sync_runs(id,character_id,started_at,completed_at,status,details) VALUES (?,NULL,?,?,?,?)",
            )
            .run(
              crypto.randomUUID(),
              observedAt,
              new Date().toISOString(),
              "public_complete",
              JSON.stringify({
                facilities: publicData.facilities.length,
                systems: publicData.systemIndices.size,
                ...contractSyncDetails(publicData),
              }),
          );
        })();
        persistPublicBlueprintContracts(publicData);
      }
      if (message.internal?.kind === "production-scopes") {
        store.sql
          .prepare("UPDATE characters SET scopes=? WHERE id=?")
          .run(JSON.stringify(message.internal.scopes), message.internal.characterId);
      }
      if (message.internal?.kind === "connected")
        portfolio.connect(
          message.internal.id,
          message.internal.name,
          message.internal.seller,
          message.internal.scopes,
        );
      if (message.internal?.kind === "wallets") {
        const wallets = message.internal.wallets;
        store.sql.transaction(() => {
          portfolio.importWallets(wallets);
          for (const [characterId, scopes] of Object.entries(
            message.internal?.kind === "wallets"
              ? (message.internal.scopes ?? {})
              : {},
          ))
            store.sql
              .prepare("UPDATE characters SET scopes=? WHERE id=?")
              .run(JSON.stringify(scopes), characterId);
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
      if (message.internal?.kind === "production-data") {
        const { characterId, profile, own, publicData, structureMarkets = [] } = message.internal;
        const persistedContractRows = store.sql.prepare(
          "SELECT contract_id,location_id,price,items_payload FROM production_contract_sources WHERE location_id IS NOT NULL",
        ).all() as { contract_id: string; location_id: string; price: string; items_payload: string | null }[];
        const publicContractListings = new Map(persistedContractRows.flatMap((row) => {
          try {
            const payload = JSON.parse(row.items_payload ?? "{}") as {
              blueprintOnly?: boolean;
              items?: PublicProductionData["publicBlueprintContracts"][number]["items"];
            };
            return payload.items
              ? [[row.contract_id, {
                  contractId: row.contract_id,
                  locationId: row.location_id,
                  price: row.price,
                  blueprintOnly: payload.blueprintOnly === true,
                  items: applyPublicBlueprintConfirmations(row.contract_id, payload.items),
                }] as const]
              : [];
          } catch {
            return [];
          }
        }));
        for (const contract of publicData.publicBlueprintContracts)
          publicContractListings.set(contract.contractId, {
            contractId: contract.contractId,
            locationId: contract.locationId,
            price: contract.price,
            blueprintOnly: contract.blueprintOnly,
            items: applyPublicBlueprintConfirmations(contract.contractId, contract.items),
          });
        const acquiredBlueprints = matchCompletedBlueprintContractAcquisitions(
          characterId,
          own.contracts.map((contract) => ({
            contractId: contract.contract_id,
            type: contract.type,
            status: contract.status,
            acceptorId: contract.acceptor_id ?? null,
            locationId: contract.start_location_id,
            price: contract.price,
          })),
          [...publicContractListings.values()],
          own.blueprints.map((blueprint) => ({
            itemId: blueprint.item_id,
            typeId: blueprint.type_id,
            locationId: blueprint.location_id,
            quantity: blueprint.quantity,
            materialEfficiency: blueprint.material_efficiency,
            timeEfficiency: blueprint.time_efficiency,
            runs: blueprint.runs,
          })),
        );
        const acquisitionByBlueprint = new Map(acquiredBlueprints.map((entry) => [entry.blueprintItemId, entry]));
        const observedAt = own.at;
        const publicAt = publicData.at;
        store.sql.transaction(() => {
          store.sql
            .prepare(
              `INSERT INTO production_character_profiles(character_id,race,clone_profile,skills_payload,standings_payload,skill_queue_payload,observed_at,source)
               VALUES (?,?, 'alpha', ?,?,?,?,'esi')
               ON CONFLICT(character_id) DO UPDATE SET race=excluded.race,skills_payload=excluded.skills_payload,standings_payload=excluded.standings_payload,skill_queue_payload=excluded.skill_queue_payload,observed_at=excluded.observed_at,source='esi'`,
            )
            .run(
              characterId,
              profile.race,
              JSON.stringify(profile.skills),
              JSON.stringify(profile.standings),
              JSON.stringify(profile.queue),
              profile.at,
            );

          store.sql
            .prepare("DELETE FROM production_assets WHERE character_id=?")
            .run(characterId);
          const assetInsert = store.sql.prepare(
            "INSERT INTO production_assets VALUES (?,?,?,?,?,?,?,?,?)",
          );
          for (const row of own.assets)
            assetInsert.run(
              characterId,
              row.item_id,
              row.type_id,
              row.location_id,
              row.location_type,
              row.location_flag,
              row.quantity,
              observedAt,
              JSON.stringify(row),
            );

          store.sql
            .prepare("DELETE FROM production_blueprint_instances WHERE character_id=?")
            .run(characterId);
          store.sql.prepare("UPDATE blueprint_sources SET status='unavailable' WHERE source_kind='owned'").run();
          const blueprintInsert = store.sql.prepare(
            "INSERT INTO production_blueprint_instances VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          );
          const blueprintSourceInsert = store.sql.prepare(
            `INSERT INTO blueprint_sources(id,source_kind,source_id,blueprint_type_id,location_id,quantity,material_efficiency,time_efficiency,runs,status,observed_at,payload)
             VALUES (?,'owned',?,?,?,?,?,?,?,'available',?,?)
             ON CONFLICT(source_kind,source_id) DO UPDATE SET blueprint_type_id=excluded.blueprint_type_id,location_id=excluded.location_id,quantity=excluded.quantity,material_efficiency=excluded.material_efficiency,time_efficiency=excluded.time_efficiency,runs=excluded.runs,status='available',observed_at=excluded.observed_at,payload=excluded.payload`,
          );
          const acquiredBlueprintSourceUpsert = store.sql.prepare(
            `INSERT INTO blueprint_sources(id,source_kind,source_id,contract_id,blueprint_type_id,location_id,quantity,material_efficiency,time_efficiency,runs,price,status,observed_at,payload,acquisition_runs)
             VALUES (?,'owned',?,?,?,?,?,?,?,?,?,'available',?,?,?)
             ON CONFLICT(source_kind,source_id) DO UPDATE SET blueprint_type_id=excluded.blueprint_type_id,location_id=excluded.location_id,quantity=excluded.quantity,material_efficiency=excluded.material_efficiency,time_efficiency=excluded.time_efficiency,runs=excluded.runs,status='available',observed_at=excluded.observed_at,payload=excluded.payload,contract_id=COALESCE(excluded.contract_id,blueprint_sources.contract_id),price=COALESCE(excluded.price,blueprint_sources.price),acquisition_runs=COALESCE(excluded.acquisition_runs,blueprint_sources.acquisition_runs)`,
          );
          for (const row of own.blueprints)
          {
            blueprintInsert.run(
              row.item_id,
              characterId,
              row.type_id,
              row.location_id,
              row.location_flag,
              row.quantity,
              row.material_efficiency,
              row.time_efficiency,
              row.runs,
              observedAt,
              "esi",
            );
            const acquisition = acquisitionByBlueprint.get(row.item_id);
            if (acquisition) {
              acquiredBlueprintSourceUpsert.run(
                row.item_id, row.item_id, acquisition.contractId, row.type_id,
                row.location_id, row.quantity, row.material_efficiency,
                row.time_efficiency, row.runs, acquisition.price, observedAt,
                JSON.stringify(row), acquisition.acquisitionRuns,
              );
            } else {
              blueprintSourceInsert.run(
                row.item_id,
                row.item_id,
                row.type_id,
                row.location_id,
                1,
                row.material_efficiency,
                row.time_efficiency,
                row.runs,
                observedAt,
                JSON.stringify(row),
              );
            }
          }

          store.sql
            .prepare("DELETE FROM production_jobs WHERE character_id=?")
            .run(characterId);
          const jobInsert = store.sql.prepare(
            "INSERT INTO production_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          );
          for (const row of own.jobs)
            jobInsert.run(
              characterId,
              row.job_id,
              row.facility_id,
              row.activity_id,
              row.blueprint_id,
              row.blueprint_type_id,
              row.runs,
              row.status,
              row.start_date,
              row.end_date,
              observedAt,
              JSON.stringify(row),
            );

          store.sql
            .prepare("DELETE FROM production_character_contracts WHERE character_id=?")
            .run(characterId);
          const contractInsert = store.sql.prepare(
            "INSERT INTO production_character_contracts VALUES (?,?,?,?,?,?,?,?,?)",
          );
          for (const row of own.contracts)
            contractInsert.run(
              characterId,
              row.contract_id,
              row.type,
              row.status,
              row.start_location_id,
              row.price,
              row.date_expired,
              observedAt,
              JSON.stringify(row),
            );

          const stationNames = new Map(
            (market.data?.stations ?? []).map((station) => [
              station.id,
              station.name,
            ]),
          );
          const facilityInsert = store.sql.prepare(
            `INSERT INTO production_facility_profiles(location_id,name,system_id,facility_kind,services_payload,industry_tax,access_status,profile_source,observed_at)
             VALUES (?,?,?,?,'[]',?,'unknown','esi',?)
             ON CONFLICT(location_id) DO UPDATE SET system_id=excluded.system_id,industry_tax=CASE WHEN production_facility_profiles.profile_source='manual' THEN production_facility_profiles.industry_tax ELSE excluded.industry_tax END,profile_source=production_facility_profiles.profile_source,observed_at=CASE WHEN production_facility_profiles.profile_source='manual' THEN production_facility_profiles.observed_at ELSE excluded.observed_at END`,
          );
          for (const row of publicData.facilities)
            facilityInsert.run(
              row.id,
              stationNames.get(row.id) ?? `Объект ${row.id}`,
              row.systemId,
              stationNames.has(row.id) ? "npc_station" : "structure",
              row.tax,
              publicAt,
            );
          const structureSyncInsert = store.sql.prepare(
            `INSERT INTO production_structure_market_sync(structure_id,system_id,state,pages,order_count,observed_at,message)
             VALUES (?,?,?,?,?,?,?) ON CONFLICT(structure_id) DO UPDATE SET
               system_id=excluded.system_id,state=excluded.state,pages=excluded.pages,
               order_count=CASE WHEN excluded.state='available' THEN excluded.order_count ELSE production_structure_market_sync.order_count END,
               observed_at=excluded.observed_at,message=excluded.message`,
          );
          const replaceStructureOrders = store.sql.prepare(
            "DELETE FROM production_structure_market_orders WHERE structure_id=?",
          );
          const structureOrderInsert = store.sql.prepare(
            "INSERT INTO production_structure_market_orders(structure_id,order_id,type_id,location_id,payload,observed_at) VALUES (?,?,?,?,?,?)",
          );
          for (const source of structureMarkets) {
            const priorOrders = source.state === "available" ? source.orders.length : Number((store.sql.prepare(
              "SELECT count(*) n FROM production_structure_market_orders WHERE structure_id=?",
            ).get(source.structureId) as { n: number }).n);
            structureSyncInsert.run(source.structureId, source.systemId, source.state,
              source.pages, priorOrders, source.observedAt, source.message);
            if (source.state === "available") {
              replaceStructureOrders.run(source.structureId);
              for (const order of source.orders)
                structureOrderInsert.run(source.structureId, order.order_id, order.type_id,
                  order.location_id, JSON.stringify(order), source.observedAt);
            }
          }
          store.sql.prepare("DELETE FROM production_system_indices").run();
          const indexInsert = store.sql.prepare(
            "INSERT INTO production_system_indices VALUES (?,?,?,?)",
          );
          for (const [systemId, entries] of publicData.systemIndices)
            for (const entry of entries)
              indexInsert.run(systemId, entry.activity, entry.costIndex, publicAt);
          store.sql.prepare("DELETE FROM production_adjusted_prices").run();
          const priceInsert = store.sql.prepare(
            "INSERT INTO production_adjusted_prices VALUES (?,?,?)",
          );
          for (const [typeId, price] of publicData.adjustedPrices)
            priceInsert.run(typeId, price, publicAt);

          store.sql
            .prepare(
              "INSERT INTO production_sync_runs(id,character_id,started_at,completed_at,status,details) VALUES (?,?,?,?,?,?)",
            )
            .run(
              crypto.randomUUID(),
              characterId,
              observedAt,
              new Date().toISOString(),
              "complete",
              JSON.stringify({
                assets: own.assets.length,
                blueprints: own.blueprints.length,
                jobs: own.jobs.length,
                contracts: own.contracts.length,
                facilities: publicData.facilities.length,
                systems: publicData.systemIndices.size,
                ...contractSyncDetails(publicData),
              }),
          );
        })();
        persistPublicBlueprintContracts(publicData);
        reconcileBoundProductionJobs(characterId);
      }
      const request = requestSchema.parse(message.request);
      if (
        request.kind.startsWith("production.") ||
        request.kind === "wallet.sync" ||
        request.kind === "character.connect" ||
        request.kind === "character.disconnect" ||
        request.kind === "market.sync" ||
        request.kind === "static.update"
      )
        invalidateProductionState();
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
        // Keep accepting an offer that was already shown to the user while a
        // background scan is running. A selected offer is a forecast, not an
        // order execution, so an expired snapshot must not prevent recording
        // the plan; actual fills are reconciled from wallet transactions.
        const current = candidates();
        const items = request.items.map((item) => {
          const o =
            current.find((x) => x.id === item.id) ??
            cached.find((x) => x.id === item.id) ??
            (() => {
              const saved = store.sql
                .prepare(
                  "SELECT payload FROM opportunities WHERE json_extract(payload,'$.id')=? ORDER BY at DESC LIMIT 1",
                )
                .get(item.id) as { payload: string } | undefined;
              return saved ? (JSON.parse(saved.payload) as Opportunity) : null;
            })();
          if (!o) throw Error("Предложение больше не соответствует фильтрам");
          return selectQuantity(o, item.quantity);
        });
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
      if (request.kind === "production.facility.register") {
        const structureId = BigInt(request.locationId);
        if (structureId <= 0n || structureId > 9_223_372_036_854_775_807n)
          throw Error("ID структуры должен быть положительным EVE ID не больше 64-bit signed limit");
        const productionStatic = config.demo ? bundledStatic : market.data ?? bundledStatic;
        if (productionStatic.stations.some((station) => station.id === request.locationId))
          throw Error("Этот ID принадлежит известной станции. Выберите её из списка площадок.");
        const existing = store.sql.prepare(
          "SELECT system_id,facility_kind FROM production_facility_profiles WHERE location_id=?",
        ).get(request.locationId) as { system_id: string; facility_kind: string } | undefined;
        if (existing) {
          if (existing.facility_kind !== "structure" || existing.system_id !== request.systemId)
            throw Error("Этот ID уже зарегистрирован в другой системе или как другой тип площадки.");
        } else {
          store.sql.prepare(
            `INSERT INTO production_facility_profiles(location_id,name,system_id,facility_kind,services_payload,access_status,profile_source,evidence,observed_at)
             VALUES(?,?,?,'structure','[]','unknown','manual','Ручной кандидат; проверьте расположение, доступ и услуги в игре.',?)`,
          ).run(request.locationId, request.name, request.systemId, new Date().toISOString());
        }
      }
      if (request.kind === "production.facility.save") {
        const productionStatic = config.demo
          ? bundledStatic
          : market.data ?? bundledStatic;
        const npc = productionStatic.stations.find(
          (station) => station.id === request.locationId,
        );
        const existing = store.sql
          .prepare(
            "SELECT name,system_id,facility_kind,industry_tax,reprocessing_tax,reprocessing_yield_bonus FROM production_facility_profiles WHERE location_id=?",
          )
          .get(request.locationId) as
          | { name: string; system_id: string; facility_kind: string; industry_tax: string | null; reprocessing_tax: string | null; reprocessing_yield_bonus: string | null }
          | undefined;
        const structure = existing?.facility_kind === "structure" ? existing : undefined;
        const facility = npc
          ? {
              name: npc.name,
              systemId: npc.systemId,
              kind: "npc_station" as const,
            }
          : structure
            ? {
                name: structure.name,
                systemId: structure.system_id,
                kind: "structure" as const,
              }
            : null;
        if (!facility || !["30000142", "30000144"].includes(facility.systemId))
          throw Error("Выберите NPC-станцию или найденную ESI структуру в Jita/Perimeter");
        let reprocessingYield: string | null = existing?.reprocessing_yield_bonus ?? null;
        let reprocessingTax: string | null = existing?.reprocessing_tax ?? null;
        if (request.services.includes("reprocessing")) {
          if (!request.reprocessingYieldPercent)
            throw Error("Для переработки укажите итоговый выход из игрового Reprocess preview");
          const yieldPercent = D(request.reprocessingYieldPercent);
          if (!yieldPercent.gt(0) || yieldPercent.gt(100))
            throw Error("Итоговый выход должен быть больше 0 и не выше 100 процентов");
          reprocessingYield = yieldPercent.div(100).toFixed(8);
          if (!request.reprocessingTaxRate)
            throw Error("Для переработки укажите подтверждённый налог площадки в процентах");
          const tax = D(request.reprocessingTaxRate);
          if (tax.lt(0) || tax.gt(100))
            throw Error("Налог переработки должен быть от 0 до 100 процентов");
          reprocessingTax = tax.div(100).toFixed(8);
        }
        let industryTax: string | null = facility.kind === "npc_station" ? "0.0025" : existing?.industry_tax ?? null;
        if (facility.kind === "structure" && request.services.includes("manufacturing")) {
          if (!request.taxRate)
            throw Error("Для структуры укажите налог услуги из её профиля");
          const rate = D(request.taxRate);
          if (rate.lt(0) || rate.gt(10))
            throw Error("Налог структуры должен быть от 0 до 10 процентов");
          industryTax = rate.div(100).toFixed(6);
          if (!request.outputTypeId || !request.systemCostMultiplier || !request.materialBonusPercent || !request.timeBonusPercent || !request.brokerFeePercent)
            throw Error("Для структуры укажите изделие и подтверждённые system cost, material/time bonuses и sell fee");
          if (!(productionStatic.manufacturing ?? []).some((recipe) => recipe.products.some((product) => product.typeId === request.outputTypeId)))
            throw Error("Изделие отсутствует в manufacturing-рецептах SDE");
          const multiplier = D(request.systemCostMultiplier);
          const materialBonus = D(request.materialBonusPercent);
          const timeBonus = D(request.timeBonusPercent);
          const brokerFee = D(request.brokerFeePercent);
          if (multiplier.lt(0) || multiplier.gt(2)) throw Error("Множитель system cost index должен быть от 0 до 2");
          if (materialBonus.lt(0) || materialBonus.gt(100) || timeBonus.lt(0) || timeBonus.gt(100))
            throw Error("Бонусы материалов и времени должны быть от 0 до 100 процентов");
          if (brokerFee.lt(0) || brokerFee.gt(100)) throw Error("Комиссия sell-ордера должна быть от 0 до 100 процентов");
        }
        store.sql
          .prepare(
            `INSERT INTO production_facility_profiles(location_id,name,system_id,facility_kind,services_payload,industry_tax,reprocessing_tax,reprocessing_yield_bonus,access_status,profile_source,evidence,observed_at)
             VALUES (?,?,?,?,?,?,?,?,?,'manual',?,?)
             ON CONFLICT(location_id) DO UPDATE SET name=excluded.name,system_id=excluded.system_id,facility_kind=excluded.facility_kind,services_payload=excluded.services_payload,industry_tax=excluded.industry_tax,reprocessing_tax=excluded.reprocessing_tax,reprocessing_yield_bonus=excluded.reprocessing_yield_bonus,access_status=excluded.access_status,profile_source='manual',evidence=excluded.evidence,observed_at=excluded.observed_at`,
          )
          .run(
            request.locationId,
            facility.name,
            facility.systemId,
            facility.kind,
            JSON.stringify(request.services),
            industryTax,
            reprocessingTax,
            reprocessingYield,
            request.accessConfirmed ? "confirmed" : "unknown",
            request.evidence,
            new Date().toISOString(),
          );
        if (facility.kind === "structure" && request.services.includes("manufacturing")) {
          const observedAt = new Date().toISOString();
          store.sql.prepare(
            `INSERT INTO production_structure_product_profiles(location_id,output_type_id,system_cost_multiplier,material_bonus_percent,time_bonus_percent,broker_fee_rate,evidence,observed_at)
             VALUES (?,?,?,?,?,?,?,?)
             ON CONFLICT(location_id,output_type_id) DO UPDATE SET
               system_cost_multiplier=excluded.system_cost_multiplier,material_bonus_percent=excluded.material_bonus_percent,
               time_bonus_percent=excluded.time_bonus_percent,broker_fee_rate=excluded.broker_fee_rate,
               evidence=excluded.evidence,observed_at=excluded.observed_at`,
          ).run(
            request.locationId,
            request.outputTypeId,
            request.systemCostMultiplier,
            D(request.materialBonusPercent!).toNumber(),
            D(request.timeBonusPercent!).toNumber(),
            D(request.brokerFeePercent!).div(100).toFixed(8),
            request.evidence,
            observedAt,
          );
        }
      }
      if (request.kind === "production.offer.quote")
        quoteProductionOffer(request.blueprintItemId, request.facilityId, request.runs);
      if (request.kind === "production.contract.blueprint.confirm")
        confirmPublicContractBlueprint(request);
      if (request.kind === "production.blueprint.cost.confirm")
        confirmBlueprintAcquisitionCost(request.blueprintItemId, request.transactionId);
      if (request.kind === "production.reprocessing.quote")
        quoteReprocessingOffer(request.facilityId, request.typeId, request.inputQuantity);
      if (request.kind === "production.project.pin")
        pinProductionOffer(request.projectId, request.offerId);
      if (request.kind === "production.project.start")
        startProductionProject(request.projectId);
      if (request.kind === "production.project.cancel")
        cancelProductionProject(request.projectId);
      if (request.kind === "production.purchase.allocate")
        allocateProductionPurchase(request);
      if (request.kind === "production.job.bind")
        bindProductionJob(request.projectId, request.jobId, request.nodeId);
      if (request.kind === "production.sale.allocate")
        allocateProductionSale(request);
      if (request.kind === "production.reprocessing.confirm")
        confirmProductionReprocessing(request);
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
