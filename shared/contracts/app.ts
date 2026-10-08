import { z } from "zod";
import type {
  basketTotals,
  Opportunity,
} from "../../engine/market/opportunities";
import type { DealView } from "../../engine/portfolio/trades";
export const PRODUCTION_SCOPES = [
  "esi-wallet.read_character_wallet.v1",
  "esi-skills.read_skills.v1",
  "esi-skills.read_skillqueue.v1",
  "esi-characters.read_standings.v1",
  "esi-markets.read_character_orders.v1",
  "esi-assets.read_assets.v1",
  "esi-characters.read_blueprints.v1",
  "esi-industry.read_character_jobs.v1",
  "esi-contracts.read_character_contracts.v1",
] as const;
export const OPTIONAL_STRUCTURE_SCOPES = [
  "esi-markets.structure_markets.v1",
  "esi-search.search_structures.v1",
] as const;
export const settingsSchema = z
  .object({
    clientId: z.string().max(200),
    minProfit: z.string().regex(/^\d+(\.\d{1,2})?$/),
    minTripProfit: z.string().regex(/^\d+(\.\d{1,2})?$/),
    minROI: z.number().min(0).max(10000),
    roiEnabled: z.boolean(),
    maxTypeShare: z.number().min(0.01).max(1),
    notificationThreshold: z.string().regex(/^\d+(\.\d{1,2})?$/),
    sound: z.boolean(),
    relistPerDay: z.number().int().min(0).max(24),
    sort: z.enum(["buy", "sell", "best"]),
  })
  .strict();
export type Settings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: Settings = {
  clientId: "",
  minProfit: "1000000",
  minTripProfit: "0",
  minROI: 0,
  roiEnabled: true,
  maxTypeShare: 1,
  notificationThreshold: "10000000",
  sound: false,
  relistPerDay: 2,
  sort: "best",
};
import type { Reconciler } from "../../engine/accounting/reconcile";
export const requestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("state") }).strict(),
  z.object({ kind: z.literal("update.check") }).strict(),
  z.object({ kind: z.literal("update.download") }).strict(),
  z.object({ kind: z.literal("update.install") }).strict(),
  z
    .object({
      kind: z.literal("clipboard.copy"),
      text: z.string().min(1).max(200),
    })
    .strict(),
  z
    .object({
      kind: z.literal("purchase.bind"),
      characterId: z.string(),
      transactionId: z.string(),
      dealId: z.string(),
    })
    .strict(),
  z.object({ kind: z.literal("transfer.confirm"), lotId: z.string() }).strict(),
  z
    .object({
      kind: z.literal("expense.bind"),
      dealId: z.string(),
      characterId: z.string(),
      journalId: z.string(),
      amount: z
        .string()
        .regex(/^\d+(\.\d{1,2})?$/)
        .optional(),
    })
    .strict(),
  z.object({ kind: z.literal("expenses.confirm"), id: z.string() }).strict(),
  z.object({ kind: z.literal("demo.operations"), id: z.string() }).strict(),
  z.object({ kind: z.literal("deal.reconcile"), id: z.string() }).strict(),
  z
    .object({
      kind: z.literal("quote"),
      id: z.string(),
      quantity: z.number().int().positive().safe(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("basket.preview"),
      items: z.array(
        z.object({
          id: z.string(),
          quantity: z.number().int().positive().safe(),
        }),
      ),
    })
    .strict(),
  z
    .object({
      kind: z.literal("basket.copy"),
      items: z.array(
        z.object({
          id: z.string(),
          quantity: z.number().int().positive().safe(),
        }),
      ),
    })
    .strict(),
  z
    .object({
      kind: z.literal("deal.accept"),
      id: z.uuid(),
      items: z
        .array(
          z
            .object({
              id: z.string(),
              quantity: z.number().int().positive().safe(),
            })
            .strict(),
        )
        .min(1),
      parentId: z.string().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("deal.cancel"), id: z.string() }).strict(),
  z
    .object({
      kind: z.literal("deal.route"),
      id: z.string(),
      mode: z.enum(["highsec", "lowsec"]),
    })
    .strict(),
  z.object({ kind: z.literal("market.sync") }).strict(),
  z.object({ kind: z.literal("production.sync") }).strict(),
  z.object({
    kind: z.literal("production.contract.blueprint.confirm"),
    contractId: z.string().regex(/^\d+$/),
    recordId: z.string().regex(/^\d+$/),
    blueprintTypeId: z.string().regex(/^\d+$/),
    materialEfficiency: z.number().int().min(0).max(10),
    timeEfficiency: z.number().int().min(0).max(20),
    runs: z.number().int().positive().max(1_000_000).safe(),
    evidence: z.string().trim().min(8).max(500),
  }).strict(),
  z.object({
    kind: z.literal("production.blueprint.cost.confirm"),
    blueprintItemId: z.string().regex(/^\d+$/),
    transactionId: z.string().regex(/^\d+$/),
  }).strict(),
  z.object({
    kind: z.literal("production.offer.quote"),
    blueprintItemId: z.string().regex(/^\d+$/),
    facilityId: z.string().regex(/^\d+$/),
    runs: z.number().int().positive().safe(),
  }).strict(),
  z.object({
    kind: z.literal("production.reprocessing.quote"),
    facilityId: z.string().regex(/^\d+$/),
    typeId: z.string().regex(/^\d+$/),
    inputQuantity: z.number().int().positive().safe(),
  }).strict(),
  z
    .object({
      kind: z.literal("production.facility.save"),
      locationId: z.string().regex(/^\d+$/),
      services: z.array(z.enum(["manufacturing", "reprocessing"])).min(1),
      accessConfirmed: z.boolean(),
      taxRate: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
      reprocessingTaxRate: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
      reprocessingYieldPercent: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
      outputTypeId: z.string().regex(/^\d+$/).optional(),
      systemCostMultiplier: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
      materialBonusPercent: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
      timeBonusPercent: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
      brokerFeePercent: z.string().regex(/^\d+(\.\d{1,6})?$/).optional(),
      evidence: z.string().trim().min(8).max(500),
    })
    .strict(),
  z.object({
    kind: z.literal("production.project.pin"),
    projectId: z.string().uuid(),
    offerId: z.string(),
  }).strict(),
  z.object({
    kind: z.literal("production.project.start"),
    projectId: z.string().uuid(),
  }).strict(),
  z.object({
    kind: z.literal("production.project.cancel"),
    projectId: z.string().uuid(),
  }).strict(),
  z.object({
    kind: z.literal("production.purchase.allocate"),
    projectId: z.string().uuid(),
    characterId: z.string().regex(/^\d+$/),
    transactionId: z.string().regex(/^\d+$/),
    quantity: z.number().int().positive(),
  }).strict(),
  z.object({
    kind: z.literal("production.job.bind"),
    projectId: z.string().uuid(),
    jobId: z.string().regex(/^\d+$/),
    nodeId: z.string().uuid().optional(),
  }).strict(),
  z.object({
    kind: z.literal("production.sale.allocate"),
    projectId: z.string().uuid(),
    transactionId: z.string().regex(/^\d+$/),
    outputLotId: z.string().uuid(),
    quantity: z.number().int().positive(),
    actionId: z.string().uuid(),
  }).strict(),
  z.object({
    kind: z.literal("production.reprocessing.confirm"),
    projectId: z.string().uuid(),
    consumedInput: z.number().int().positive(),
    actualFee: z.string().regex(/^\d+(\.\d{1,2})?$/),
    outputs: z.array(z.object({ typeId: z.string().regex(/^\d+$/), quantity: z.number().int().nonnegative() }).strict()).min(1),
    evidence: z.string().trim().min(8).max(500),
    actionId: z.string().uuid(),
  }).strict(),
  z.object({ kind: z.literal("static.update") }).strict(),
  z
    .object({
      kind: z.literal("character.connect"),
      seller: z.boolean(),
      expectedId: z.string().regex(/^\d+$/).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("character.disconnect"),
      id: z.string().regex(/^\d+$/),
    })
    .strict(),
  z.object({ kind: z.literal("wallet.sync") }).strict(),
  z
    .object({ kind: z.literal("settings.save"), value: settingsSchema })
    .strict(),
  z.object({ kind: z.literal("export") }).strict(),
  z.object({ kind: z.literal("backup") }).strict(),
  z.object({ kind: z.literal("restore") }).strict(),
  z.object({ kind: z.literal("demo.enable") }).strict(),
  z.object({ kind: z.literal("demo.disable") }).strict(),
]);
export type AppRequest = z.infer<typeof requestSchema>;
export interface CharacterView {
  id: string;
  name: string;
  status: string;
  isSeller: boolean;
  balance: string | null;
  scopes: string[];
}
export interface AppState {
  production: {
    status: string;
    syncing: boolean;
    syncError: string | null;
    mainBalance: string | null;
    spendableCapital: string | null;
    reservedCapital: string;
    tradeReservedCapital: string;
    capitalCommitmentConflict: boolean;
    mainCharacterId: string | null;
    race: string | null;
    alphaUsableSkills: number;
    alphaCappedSkills: number;
    profileAt: string | null;
    missingScopes: string[];
    optionalMissingScopes: string[];
    structureMarketCoverage: {
      structureId: string;
      structureName: string;
      systemId: string;
      state: "not_checked" | "available" | "stale" | "forbidden" | "capped" | "failed" | "missing_scope";
      orderCount: number;
      pages: number;
      observedAt: string | null;
      message: string | null;
    }[];
    assets: number;
    blueprints: number;
    blueprintAcquisitions: {
      blueprintItemId: string;
      typeId: string;
      typeName: string;
      locationId: string;
      locationName: string;
      observedAt: string;
      status: "needs_confirmation" | "confirmed";
      acquisitionPrice: string | null;
      transactionId: string | null;
      candidateTransactions: {
        transactionId: string;
        date: string;
        unitPrice: string;
        quantity: number;
        locationId: string;
      }[];
    }[];
    jobs: number;
    availableJobs: {
      jobId: string;
      blueprintId: string;
      blueprintTypeId: string;
      facilityId: string;
      productTypeId: string | null;
      runs: number;
      status: string;
      startAt: string;
      endAt: string;
      cost: string | null;
    }[];
    contracts: number;
    facilities: number;
    systemIndices: number;
    adjustedPrices: number;
    contractCoverage: { candidateContracts: number; fetchedContracts: number; capped: boolean; complete: boolean; itemErrors: number };
    blueprintContracts: {
      contractId: string;
      title: string;
      locationId: string;
      locationName: string;
      price: string;
      expiresAt: string;
      blueprintOnly: boolean;
      includedItemCount: number;
      manufacturingEligibility: "candidate" | "mixed_contract" | "multiple_copies" | "unknown_attributes" | "unknown_recipe";
      blueprints: { recordId: string; typeId: string; typeName: string; quantity: number; materialEfficiency: number | null; timeEfficiency: number | null; runs: number | null; attributesKnown: boolean; attributesSource: "esi" | "manual" | "conflict" | "unknown"; confirmedAt: string | null; evidence: string | null }[];
    }[];
    syncedAt: string | null;
    publicSyncedAt: string | null;
    manufacturingRecipes: number;
    reprocessingTypes: number;
    sdeVersion: string | null;
    facilityOptions: { id: string; name: string; systemId: string; kind: "npc_station" | "structure" }[];
    facilityProfiles: {
      id: string;
      name: string;
      systemId: string;
      kind: "npc_station" | "structure";
      services: string[];
      taxRate: string | null;
      reprocessingTaxRate: string | null;
      reprocessingYieldPercent: string | null;
      accessStatus: "unknown" | "confirmed" | "unavailable";
      observedAt: string;
      evidence: string | null;
      structureProductProfiles: {
        outputTypeId: string;
        outputName: string;
        systemCostMultiplier: string;
        materialBonusPercent: number;
        timeBonusPercent: number;
        brokerFeeRate: string;
        observedAt: string;
      }[];
    }[];
    manufacturingOutputs: { id: string; name: string }[];
    offers: {
      id: string;
      itemName: string;
      itemEnglishName: string;
      blueprintTypeName: string;
      blueprintSource: { kind: "owned" | "market_bpo"; purchaseOrderId: string | null; purchasePrice: string | null };
      facilityName: string;
      systemId: string;
      runs: number;
      maxRuns: number;
      estimate: import("../../engine/production/manufacturing").ManufacturingEstimate;
      chainPlan: import("../../engine/production/chain-planner").ChainPlan;
      chainExecutable: boolean;
      marketSignal: import("../../engine/production/market-signal").ProductionMarketSignal;
      observedAt: string;
    }[];
    marketBpoCandidatesScanned: number;
    marketBpoCandidatesTotal: number;
    marketBpoScanComplete: boolean;
    contractCandidatesScanned: number;
    contractCandidatesTotal: number;
    contractScanComplete: boolean;
    contractOffers: {
      id: string;
      contractId: string;
      contractTitle: string;
      contractPrice: string;
      blueprintOnly: boolean;
      includedItemCount: number;
      expiresAt: string;
      pickupLocation: string;
      itemName: string;
      itemEnglishName: string;
      blueprintTypeName: string;
      blueprintCopies: number;
      bundleRuns: number;
      facilityName: string;
      systemId: string;
      runs: number;
      estimate: import("../../engine/production/manufacturing").ManufacturingEstimate;
      chainPlan: import("../../engine/production/chain-planner").ChainPlan;
      marketSignal: import("../../engine/production/market-signal").ProductionMarketSignal;
      contractObservedAt: string;
      observedAt: string;
    }[];
    reprocessingOffers: {
      id: string;
      itemName: string;
      facilityId: string;
      facilityName: string;
      systemId: string;
      maxInputQuantity: number;
      estimate: import("../../engine/production/reprocessing").ReprocessingEstimate;
      marketSignals: { typeId: string; itemName: string; signal: import("../../engine/production/market-signal").ProductionMarketSignal }[];
    }[];
    projects: {
      id: string;
      kind: "manufacturing" | "reprocessing";
      status: "pinned" | "planning" | "purchasing" | "partially_ready" | "in_production" | "ready_for_sale" | "partially_sold" | "reconciling" | "completed" | "cancelled" | "needs_review";
      itemName: string;
      outputQuantity: number;
      expectedCost: string;
      currentExpectedCost: string | null;
      currentCostObservedAt: string | null;
      currentMarketFresh: boolean;
      currentExpectedProfit: { immediate: string | null; sellOrder: string | null };
      expectedProfit: string | null;
      outputTypeId: string | null;
      blueprintItemId: string | null;
      blueprintTypeId: string | null;
      facilityId: string | null;
      runs: number;
      updatedAt: string;
      offerId: string;
      manufacturingNodes: { id: string; blueprintItemId: string; blueprintTypeId: string; outputTypeId: string; outputQuantity: number; outputName: string; runs: number; status: string; isFinal: boolean; canStart: boolean; timeSeconds: number | null }[];
      productionSchedule: {
        status: "ready" | "review";
        reasons: string[];
        availableSlots: number;
        occupiedSlots: number;
        calendarSeconds: number | null;
        waitingForPurchases: boolean;
      } | null;
      materials: { typeId: string; typeName: string; required: number; purchased: number; existingLotQuantity: number; actualCost: string; currentBuyRequired: number; currentBuyFilled: number; currentBuySources: { locationId: string; locationName: string; quantity: number; unitPrice: string }[] }[];
      inventoryAllocations: { sourceLotId: string; sourceProjectId: string; sourceProjectName: string; typeId: string; typeName: string; quantity: number; consumedQuantity: number; unitCost: string; status: "reserved" | "consumed" }[];
      purchases: { characterId: string; transactionId: string; typeId: string; typeName: string; date: string; quantity: number; available: number; unitPrice: string; locationId: string; locationName: string }[];
      boundJobs: { jobId: string; status: string; startAt: string; endAt: string; runs: number; cost: string | null }[];
      outputLots: { id: string; typeId: string; typeName: string; quantity: number; remaining: number; reserved: number; available: number; unitCost: string; createdAt: string; isFinal: boolean }[];
      sales: { transactionId: string; outputLotId: string; quantity: number; net: string; date: string }[];
      saleCandidates: { transactionId: string; typeId: string; typeName: string; date: string; transactionQuantity: number; available: number; unitPrice: string; netTotal: string }[];
      realizedProfit: string | null;
      plannedOutputs: { typeId: string; typeName: string; quantity: number }[];
      plannedInputQuantity: number | null;
      reprocessingPortionSize: number | null;
    }[];
  };
  ownSellOrders?: ReturnType<
    typeof import("../../engine/portfolio/orders").ownSellOrders
  >;
  update?: import("./update").UpdateView;
  demo: boolean;
  devBuild: boolean;
  notifications: { id: string; name: string; profit: string; at: string }[];
  review: ReturnType<Reconciler["review"]>;
  systemNames: Record<string, string>;
  preview: Opportunity | null;
  basket: {
    items: Opportunity[];
    totals: ReturnType<typeof basketTotals>;
    multibuy: string;
  } | null;
  settings: Settings;
  characters: CharacterView[];
  deals: DealView[];
  opportunities: Opportunity[];
  available: string;
  wallet: string;
  reserved: string;
  mainBalance: string | null;
  sync: string;
  databaseSize: number;
  market: {
    version: string | null;
    systems: number;
    stations: number;
    regions: number;
    loadedRegions: number;
    historyPairs: number;
    status: string;
    calculation: {
      busy: boolean;
      phase: string;
      processed: number;
      total: number;
      startedAt: number;
      revision: number;
    };
  };
}
export interface Bridge {
  request: (request: AppRequest) => Promise<AppState>;
}
