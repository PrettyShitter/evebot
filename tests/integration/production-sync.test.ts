import { it, expect } from "vitest";
import { build } from "esbuild";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { Store } from "../../db/store";
import type { AppState } from "../../shared/contracts/app";
import type {
  OwnProductionData,
  PublicProductionData,
} from "../../engine/production/esi";
import type { ProfileData } from "../../engine/portfolio/profile";

it("stage 1: imports a complete production snapshot atomically and keeps the previous one on invalid refresh", async () => {
  mkdirSync(".cache", { recursive: true });
  const dir = mkdtempSync(resolve(".cache/production-sync-"));
  const dbPath = join(dir, "portfolio.sqlite");
  const db = new Store(dbPath, resolve("db/migrations"));
  db.sql
    .prepare("INSERT INTO characters(id,name,status,is_seller,balance) VALUES (?,?,?,1,?)")
    .run("9001", "Main", "connected", "1000000.00");
  db.sql
    .prepare("INSERT INTO deals(id,source,destination,status,seller_id,forecast,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("keep-trade", "600", "601", "OPEN", "9001", "[]", "2026-10-08T00:00:00Z");
  const marketAt = new Date().toISOString();
  const marketExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  db.sql.prepare("INSERT INTO market_snapshot_runs VALUES (?,?,?,?,?,?,?,?)")
    .run("production-fixture", "10000002", marketAt, marketAt, marketAt, marketExpiry, "complete", 1);
  db.sql.prepare("INSERT INTO wallet_transactions VALUES (?,?,?,?,?)")
    .run("esi", "9001", "99001", JSON.stringify({
      transaction_id: "99001", date: marketAt, type_id: "683", location_id: "60003760",
      quantity: 1, unit_price: "250000", is_buy: true, is_personal: true,
      client_id: "9001", journal_ref_id: "99002",
    }), marketAt);
  const marketLevels = [
    ...[
      ["34", 64000], ["35", 12000], ["36", 5000], ["37", 1000],
    ].map(([type, quantity]) => ({
      order_id: `ask-${type}`, type_id: type as string, location_id: "60003760", system_id: "30000142",
      price: "1", is_buy_order: false, volume_remain: quantity as number, volume_total: quantity as number,
      min_volume: 1, range: "station" as const, duration: 90, issued: marketAt,
    })),
    {
      order_id: "bid-582", type_id: "582", location_id: "60003760", system_id: "30000142",
      price: "100000", is_buy_order: true, volume_remain: 1, volume_total: 1,
      min_volume: 1, range: "station" as const, duration: 90, issued: marketAt,
    },
    {
      order_id: "ask-bpo-684", type_id: "684", location_id: "60003760", system_id: "30000142",
      price: "200000", is_buy_order: false, volume_remain: 1, volume_total: 1,
      min_volume: 1, range: "station" as const, duration: 90, issued: marketAt,
    },
    {
      order_id: "bid-583", type_id: "583", location_id: "60003760", system_id: "30000142",
      price: "100000000", is_buy_order: true, volume_remain: 1, volume_total: 1,
      min_volume: 1, range: "station" as const, duration: 90, issued: marketAt,
    },
  ];
  for (const order of marketLevels) {
    const target = ["34", "35", "36", "37"].includes(order.type_id) ? "production_market_orders" : "market_orders";
    const idColumn = target === "market_orders" ? order.order_id : order.order_id;
    const insert = target === "market_orders"
      ? db.sql.prepare("INSERT INTO market_orders VALUES (?,?,?,?,?)")
      : db.sql.prepare("INSERT INTO production_market_orders VALUES (?,?,?,?,?)");
    insert.run("production-fixture", idColumn, order.type_id, order.location_id, JSON.stringify(order));
  }
  db.close();
  await build({
    entryPoints: {
      worker: "engine/worker.ts",
      calculator: "engine/calculator.ts",
    },
    outdir: dir,
    outExtension: { ".js": ".cjs" },
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["better-sqlite3"],
  });
  const worker = new Worker(join(dir, "worker.cjs"), {
    workerData: {
      directory: dir,
      migrations: resolve("db/migrations"),
      resources: resolve("resources"),
      demo: false,
      offline: true,
    },
  });
  const at = new Date().toISOString();
  const own: OwnProductionData = {
    at,
    assets: [
      {
        item_id: "9100",
        type_id: "34",
        location_id: "60003760",
        location_type: "station",
        location_flag: "Hangar",
        quantity: 20,
        is_singleton: false,
      },
    ],
    blueprints: [
      {
        item_id: "9101",
        type_id: "683",
        location_id: "60003760",
        location_flag: "Hangar",
        quantity: -1,
        material_efficiency: 0,
        time_efficiency: 0,
        runs: -1,
      },
      {
        item_id: "9102",
        type_id: "683",
        location_id: "60003760",
        location_flag: "Hangar",
        quantity: 1,
        material_efficiency: 0,
        time_efficiency: 0,
        runs: 2,
      },
    ],
    jobs: [],
    contracts: [{
      contract_id: "88003", issuer_id: "9002", issuer_corporation_id: "9003",
      acceptor_id: "9001", assignee_id: "0", start_location_id: "60003760",
      end_location_id: "60003760", type: "item_exchange", status: "finished",
      title: "Known single BPC", date_issued: at, date_expired: "2027-10-08T00:00:00Z",
      price: "1000",
    }],
  };
  const profile: ProfileData = {
    race: "Minmatar",
    skills: [{ skill_id: "3380", trained_skill_level: 3, active_skill_level: 3 }],
    standings: [],
    queue: [],
    at,
  };
  const publicData: PublicProductionData = {
    at,
    facilities: [
      {
        id: "60003760",
        ownerId: "1000035",
        regionId: "10000002",
        systemId: "30000142",
        typeId: "1529",
        tax: null,
      },
      {
        id: "90000000001",
        ownerId: "9001",
        regionId: "10000002",
        systemId: "30000142",
        typeId: "35832",
        tax: "0.1",
      },
    ],
    systemIndices: new Map([
      ["30000142", [{ activity: "manufacturing", costIndex: "0.0123" }]],
    ]),
    adjustedPrices: new Map([["34", "2.5"], ["35", "1"], ["36", "1"], ["37", "1"]]),
    publicBlueprintContracts: [{
      contractId: "88001",
      regionId: "10000002",
      locationId: "60003760",
      price: "1000",
      expiresAt: "2027-10-08T00:00:00Z",
      title: "Integration BPC",
      blueprintOnly: true,
      includedItemCount: 1,
      items: [{ recordId: "88002", typeId: "683", quantity: 1, isBlueprintCopy: true, materialEfficiency: null, timeEfficiency: null, runs: null }],
    }, {
      contractId: "88003",
      regionId: "10000002",
      locationId: "60003760",
      price: "1000",
      expiresAt: "2027-10-08T00:00:00Z",
      title: "Known single BPC",
      blueprintOnly: true,
      includedItemCount: 1,
      items: [{ recordId: "88004", itemId: "9102", typeId: "683", quantity: 1, isBlueprintCopy: true, materialEfficiency: 0, timeEfficiency: 0, runs: 2 }],
    }, {
      contractId: "88005",
      regionId: "10000002",
      locationId: "60003760",
      price: "2000",
      expiresAt: "2027-10-08T00:00:00Z",
      title: "Mixed bundle with one BPC",
      blueprintOnly: false,
      includedItemCount: 2,
      items: [{ recordId: "88006", typeId: "683", quantity: 1, isBlueprintCopy: true, materialEfficiency: 0, timeEfficiency: 0, runs: 2 }],
    }, {
      contractId: "88006",
      regionId: "10000002",
      locationId: "60003760",
      price: "30000",
      expiresAt: "2027-10-08T00:00:00Z",
      title: "Three-copy BPC bundle",
      blueprintOnly: true,
      includedItemCount: 3,
      items: ["88007", "88008", "88009"].map((recordId) => ({
        recordId, typeId: "683", quantity: 1, isBlueprintCopy: true,
        materialEfficiency: 0, timeEfficiency: 0, runs: 2,
      })),
    }],
    contractCoverage: { candidateContracts: 4, fetchedContracts: 4, capped: false, complete: true, itemErrors: 0 },
  };
  const acquiredContractRemovedFromPublic: PublicProductionData = {
    ...publicData,
    publicBlueprintContracts: [],
  };
  const beforeBpcPurchase: OwnProductionData = {
    ...own,
    blueprints: own.blueprints.filter((blueprint) => blueprint.item_id === "9101"),
    contracts: [],
  };
  const request = async (
    internal: unknown,
    appRequest: unknown = { kind: "state" },
  ) => {
    const response = once(worker, "message");
    worker.postMessage({ id: "sync", request: appRequest, internal });
    const [result] = await response;
    return result as { value?: AppState; error?: string };
  };
  try {
    const first = await request({
      kind: "production-data",
      characterId: "9001",
      profile,
      own: beforeBpcPurchase,
      publicData,
      structureMarkets: [{
        structureId: "90000000001", systemId: "30000142", state: "available",
        pages: 1, observedAt: at, message: null,
        orders: [{
          order_id: "99001", type_id: "34", location_id: "90000000001", system_id: "30000142",
          price: "2.5", is_buy_order: false, volume_remain: 20, volume_total: 20,
          min_volume: 1, range: "station", duration: 90, issued: at,
        }],
      }],
    });
    expect(first.error).toBeUndefined();
    expect(first.value?.production).toMatchObject({
      mainCharacterId: "9001",
      race: "Minmatar",
      assets: 1,
      blueprints: 1,
      facilities: 2,
      structureMarketCoverage: [expect.objectContaining({
        structureId: "90000000001", state: "available", orderCount: 1, pages: 1,
      })],
      systemIndices: 1,
      blueprintContracts: expect.arrayContaining([expect.objectContaining({
        contractId: "88001", title: "Integration BPC", blueprintOnly: true,
        includedItemCount: 1, manufacturingEligibility: "unknown_attributes",
        blueprints: [expect.objectContaining({ typeId: "683", attributesKnown: false })],
      }), expect.objectContaining({ contractId: "88003", manufacturingEligibility: "candidate" }),
      expect.objectContaining({ contractId: "88005", blueprintOnly: false, includedItemCount: 2, manufacturingEligibility: "candidate" }),
      expect.objectContaining({ contractId: "88006", blueprintOnly: true, includedItemCount: 3, manufacturingEligibility: "candidate", blueprints: expect.arrayContaining([expect.objectContaining({ recordId: "88007", quantity: 1, attributesKnown: true })]) })]),
    });
    const confirmedPublicBpc = await request(undefined, {
      kind: "production.contract.blueprint.confirm",
      contractId: "88001",
      recordId: "88002",
      blueprintTypeId: "683",
      materialEfficiency: 0,
      timeEfficiency: 0,
      runs: 2,
      evidence: "Проверено в контракте в EVE",
    });
    expect(confirmedPublicBpc.error).toBeUndefined();
    expect(confirmedPublicBpc.value?.production.blueprintContracts).toContainEqual(expect.objectContaining({
      contractId: "88001",
      manufacturingEligibility: "candidate",
      blueprints: [expect.objectContaining({
        recordId: "88002", attributesKnown: true, attributesSource: "manual",
        materialEfficiency: 0, timeEfficiency: 0, runs: 2,
        confirmedAt: expect.any(String), evidence: "Проверено в контракте в EVE",
      })],
    }));
    const staleTestDb = new Store(dbPath, resolve("db/migrations"));
    staleTestDb.sql.prepare("UPDATE production_contract_sources SET observed_at=? WHERE contract_id=?")
      .run(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), "88001");
    const stalePublicBpc = await request(undefined, {
      kind: "production.contract.blueprint.confirm",
      contractId: "88001",
      recordId: "88002",
      blueprintTypeId: "683",
      materialEfficiency: 1,
      timeEfficiency: 0,
      runs: 2,
      evidence: "Повторно сверено в клиенте EVE",
    });
    expect(stalePublicBpc.error).toContain("старше часа");
    staleTestDb.sql.prepare("UPDATE production_contract_sources SET observed_at=? WHERE contract_id=?").run(at, "88001");
    staleTestDb.close();
    const mismatchedPublicBpc = await request(undefined, {
      kind: "production.contract.blueprint.confirm",
      contractId: "88001",
      recordId: "99999",
      blueprintTypeId: "683",
      materialEfficiency: 0,
      timeEfficiency: 0,
      runs: 2,
      evidence: "Проверено в контракте в EVE",
    });
    expect(mismatchedPublicBpc.error).toContain("не совпадает");
    const publicDataConflict: PublicProductionData = {
      ...publicData,
      publicBlueprintContracts: publicData.publicBlueprintContracts.map((contract) => contract.contractId === "88001"
        ? { ...contract, items: contract.items.map((item) => ({ ...item, materialEfficiency: 1, timeEfficiency: 0, runs: 2 })) }
        : contract),
    };
    const conflictedPublicBpc = await request({
      kind: "production-data", characterId: "9001", profile, own: beforeBpcPurchase, publicData: publicDataConflict,
    });
    expect(conflictedPublicBpc.value?.production.blueprintContracts).toContainEqual(expect.objectContaining({
      contractId: "88001",
      blueprints: [expect.objectContaining({
        materialEfficiency: 1, attributesSource: "conflict", evidence: "Проверено в контракте в EVE",
      })],
    }));
    const accessLost = await request({
      kind: "production-data", characterId: "9001", profile, own, publicData: acquiredContractRemovedFromPublic,
      structureMarkets: [{
        structureId: "90000000001", systemId: "30000142", state: "forbidden",
        pages: 0, observedAt: at, message: "ESI 403", orders: [],
      }],
    });
    expect(accessLost.value?.production.structureMarketCoverage).toContainEqual(
      expect.objectContaining({ structureId: "90000000001", state: "forbidden", orderCount: 1, message: "ESI 403" }),
    );
    const structureDb = new Store(dbPath, resolve("db/migrations"));
    expect(structureDb.sql.prepare("SELECT count(*) n FROM production_structure_market_orders WHERE structure_id='90000000001'").get()).toEqual({ n: 1 });
    structureDb.close();
    await request({
      kind: "production-data", characterId: "9001", profile, own, publicData,
      structureMarkets: [{
        structureId: "90000000001", systemId: "30000142", state: "available",
        pages: 1, observedAt: at, message: null,
        orders: [{ order_id: "99001", type_id: "34", location_id: "90000000001", system_id: "30000142",
          price: "2.5", is_buy_order: false, volume_remain: 20, volume_total: 20,
          min_volume: 1, range: "station", duration: 90, issued: at }],
      }],
    });
    const sourceDb = new Store(dbPath, resolve("db/migrations"));
    expect(sourceDb.sql.prepare("SELECT source_kind,source_id,runs,status FROM blueprint_sources WHERE source_id='9101'").get()).toEqual({
      source_kind: "owned", source_id: "9101", runs: -1, status: "available",
    });
    expect(sourceDb.sql.prepare("SELECT contract_id,price,acquisition_runs FROM blueprint_sources WHERE source_id='9102'").get()).toEqual({
      contract_id: "88003", price: "1000.00", acquisition_runs: 2,
    });
    sourceDb.close();

    const completedContractRemovedFromPublicListings = await request({
      kind: "production-data", characterId: "9001", profile, own,
      publicData: { ...publicData, publicBlueprintContracts: [] },
      structureMarkets: [{
        structureId: "90000000001", systemId: "30000142", state: "available",
        pages: 1, observedAt: at, message: null,
        orders: [{ order_id: "99001", type_id: "34", location_id: "90000000001", system_id: "30000142",
          price: "2.5", is_buy_order: false, volume_remain: 20, volume_total: 20,
          min_volume: 1, range: "station", duration: 90, issued: at }],
      }],
    });
    expect(completedContractRemovedFromPublicListings.error).toBeUndefined();
    const retainedAcquisition = new Store(dbPath, resolve("db/migrations"));
    expect(retainedAcquisition.sql.prepare("SELECT contract_id,price,acquisition_runs FROM blueprint_sources WHERE source_id='9102'").get()).toEqual({
      contract_id: "88003", price: "1000.00", acquisition_runs: 2,
    });
    retainedAcquisition.close();

    const publicOnly = await request({ kind: "public-production", publicData });
    expect(publicOnly.error).toBeUndefined();
    expect(publicOnly.value?.production).toMatchObject({
      facilities: 2,
      systemIndices: 1,
      publicSyncedAt: expect.any(String),
    });

    const scopesFromToken = await request({
      kind: "production-scopes",
      characterId: "9001",
      scopes: [
        "esi-wallet.read_character_wallet.v1",
        "esi-skills.read_skills.v1",
        "esi-skills.read_skillqueue.v1",
        "esi-characters.read_standings.v1",
        "esi-markets.read_character_orders.v1",
        "esi-assets.read_assets.v1",
        "esi-contracts.read_character_contracts.v1",
      ],
    });
    expect(scopesFromToken.value?.production.missingScopes).toEqual([
      "esi-characters.read_blueprints.v1",
      "esi-industry.read_character_jobs.v1",
    ]);

    const confirmedNpc = await request(undefined, {
      kind: "production.facility.save",
      locationId: "60003760",
      services: ["manufacturing"],
      accessConfirmed: true,
      evidence: "Fixture-only confirmed manufacturing profile",
    });
    expect(confirmedNpc.error).toBeUndefined();
    expect(confirmedNpc.value?.production.contractOffers).toHaveLength(4);
    expect(confirmedNpc.value?.production.contractOffers).toContainEqual(expect.objectContaining({
      contractId: "88001", contractPrice: "1000", blueprintCopies: 1, bundleRuns: 2,
    }));
    expect(confirmedNpc.value?.production.contractOffers.find((offer) => offer.contractId === "88003")).toMatchObject({
      contractId: "88003",
      runs: 1,
      contractPrice: "1000",
      marketSignal: {
        regionName: "The Forge",
        history: { week: null, month: null, quarter: null },
        currentHub: { bidQuantity: 1 },
        trendAdjustment: null,
      },
      estimate: {
        blueprintAcquisitionCost: "500.00",
        blueprintPurchaseCashCost: "1000.00",
        materialsCost: "30750.00",
        totalCost: expect.any(String),
        cashRequired: expect.any(String),
        immediate: { netProfit: expect.any(String) },
        firstCycleProfit: { immediate: expect.any(String) },
      },
    });
    expect(confirmedNpc.value?.production.contractOffers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        contractId: "88005",
        blueprintOnly: false,
        includedItemCount: 2,
        contractPrice: "2000",
        estimate: expect.objectContaining({
          blueprintPurchaseCashCost: "2000.00",
          cashRequired: expect.any(String),
        }),
      }),
      expect.objectContaining({
        contractId: "88006",
        contractPrice: "30000",
        blueprintCopies: 3,
        bundleRuns: 6,
        runs: 1,
        estimate: expect.objectContaining({
          blueprintAcquisitionCost: "5000.00",
          blueprintPurchaseCashCost: "30000.00",
        }),
      }),
    ]));
    expect(Number(confirmedNpc.value?.production.contractOffers[0]?.estimate.totalCost)).toBeGreaterThan(30500);
    expect(Number(confirmedNpc.value?.production.contractOffers[0]?.estimate.cashRequired) - Number(confirmedNpc.value?.production.contractOffers[0]?.estimate.totalCost)).toBeCloseTo(500, 2);
    expect(Number(confirmedNpc.value?.production.contractOffers[0]?.estimate.firstCycleProfit.immediate))
      .toBeCloseTo(Number(confirmedNpc.value?.production.contractOffers[0]?.estimate.immediate.netProfit) - 500, 2);
    expect(confirmedNpc.value?.production.offers).toContainEqual(expect.objectContaining({
      estimate: expect.objectContaining({
        blueprintItemId: "9102",
        blueprintAcquisitionCost: "500.00",
      }),
    }));
    const bpoBeforeCostReview = confirmedNpc.value?.production.blueprintAcquisitions.find((source) => source.blueprintItemId === "9101");
    expect(bpoBeforeCostReview).toMatchObject({
      status: "needs_confirmation",
      candidateTransactions: [{ transactionId: "99001", unitPrice: "250000", locationId: "60003760" }],
    });
    const confirmedBpoCost = await request(undefined, {
      kind: "production.blueprint.cost.confirm",
      blueprintItemId: "9101",
      transactionId: "99001",
    });
    expect(confirmedBpoCost.error).toBeUndefined();
    expect(confirmedBpoCost.value?.production.blueprintAcquisitions.find((source) => source.blueprintItemId === "9101"))
      .toMatchObject({ status: "confirmed", acquisitionPrice: "250000.00" });
    const confirmedBpoOffer = confirmedBpoCost.value?.production.offers.find((offer) => offer.estimate.blueprintItemId === "9101");
    expect(confirmedBpoOffer?.estimate.blueprintPurchaseCashCost).toBe("250000.00");
    expect(confirmedBpoOffer?.estimate.firstCycleProfit.immediate).toBeTruthy();
    expect(Number(confirmedBpoOffer?.estimate.firstCycleProfit.immediate))
      .toBeCloseTo(Number(confirmedBpoOffer?.estimate.immediate.netProfit) - 250000, 2);
    expect(confirmedBpoOffer?.estimate.firstCycleRoi.immediate).toBeTruthy();
    expect((await request(undefined, {
      kind: "production.blueprint.cost.confirm",
      blueprintItemId: "9102",
      transactionId: "99001",
    })).error).toContain("BPO");
    let marketBpoState = confirmedNpc.value;
    let marketBpoOffer = marketBpoState?.production.offers.find((offer) => offer.blueprintTypeName === "Condor Blueprint");
    for (let attempt = 0; !marketBpoOffer && attempt < 3; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1_050));
      marketBpoState = (await request(undefined)).value;
      marketBpoOffer = marketBpoState?.production.offers.find((offer) => offer.blueprintTypeName === "Condor Blueprint");
    }
    expect(marketBpoState?.production.marketBpoCandidatesScanned).toBeGreaterThan(0);
    expect(marketBpoState?.production.marketBpoCandidatesTotal).toBeGreaterThan(0);
    expect(marketBpoOffer).toMatchObject({
      blueprintSource: { kind: "market_bpo", purchaseOrderId: "ask-bpo-684", purchasePrice: "200000" },
      chainExecutable: false,
      estimate: {
        blueprintPurchaseCashCost: "200000.00",
        firstCycleProfit: { immediate: expect.any(String) },
        firstCycleRoi: { immediate: expect.any(String) },
        blueprintPaybackBatches: { immediate: expect.any(Number) },
      },
    });
    expect((await request(undefined, {
      kind: "production.project.pin",
      projectId: "00000000-0000-4000-8000-000000000099",
      offerId: marketBpoOffer!.id,
    })).error).toContain("купите BPO");
    const acquiredBlueprintOffer = confirmedNpc.value?.production.offers.find((offer) => offer.estimate.blueprintItemId === "9102");
    expect(acquiredBlueprintOffer?.estimate.totalCost).toBeTruthy();
    expect(Number(acquiredBlueprintOffer?.estimate.totalCost) - Number(acquiredBlueprintOffer?.estimate.cashRequired)).toBeCloseTo(500, 2);

    const sourceProjectId = "00000000-0000-4000-8000-000000000040";
    const sourceNodeId = "00000000-0000-4000-8000-000000000041";
    const sourceLotId = "00000000-0000-4000-8000-000000000042";
    const inventoryDb = new Store(dbPath, resolve("db/migrations"));
    try {
      inventoryDb.sql.prepare("INSERT INTO production_projects(id,status,created_at,updated_at,payload) VALUES (?,'completed',?,?,?)")
        .run(sourceProjectId, at, at, JSON.stringify({
          offerId: "fixture-surplus-source", itemName: "Fixture surplus source", projectKind: "manufacturing",
          facilityId: "60003760", outputQuantity: 1, expectedCost: "0.50", expectedProfit: "0.00",
          estimate: acquiredBlueprintOffer!.estimate,
        }));
      inventoryDb.sql.prepare("INSERT INTO project_nodes(id,project_id,node_key,node_type,status,payload) VALUES (?,?,?,'manufacturing','complete',?)")
        .run(sourceNodeId, sourceProjectId, "fixture-surplus", JSON.stringify({ facilityId: "60003760", isFinal: false }));
      inventoryDb.sql.prepare("INSERT INTO project_output_lots(id,project_id,node_id,type_id,quantity,remaining,unit_cost,source_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(sourceLotId, sourceProjectId, sourceNodeId, "34", 1, 1, "0.50000000", "fixture-surplus", at);
    } finally { inventoryDb.close(); }

    const inventoryQuote = await request(undefined);
    const inventoryRootOffer = inventoryQuote.value?.production.offers.find((offer) => offer.estimate.blueprintItemId === "9101");
    const inventoryPurchase = inventoryRootOffer?.chainPlan.actions.find((action) => action.kind === "purchase" && action.typeId === "34");
    expect(inventoryPurchase?.sources).toContainEqual(expect.objectContaining({
      inventoryLotId: sourceLotId, quantity: 1, locationId: "60003760",
      locationName: "Jita IV - Moon 4 - Caldari Navy Assembly Plant",
    }));
    expect(inventoryPurchase?.sources).toContainEqual(expect.objectContaining({
      id: "ask-34", locationId: "60003760", locationName: "Jita IV - Moon 4 - Caldari Navy Assembly Plant",
    }));
    expect(inventoryRootOffer?.estimate.totalCost && inventoryRootOffer.estimate.cashRequired).toBeTruthy();
    expect(Number(inventoryRootOffer!.estimate.totalCost) - Number(inventoryRootOffer!.estimate.cashRequired)).toBeCloseTo(0.5, 2);

    const firstInventoryProject = "00000000-0000-4000-8000-000000000043";
    expect((await request(undefined, { kind: "production.project.pin", projectId: firstInventoryProject, offerId: inventoryRootOffer!.id })).error).toBeUndefined();
    expect((await request(undefined, { kind: "production.project.start", projectId: firstInventoryProject })).error).toBeUndefined();
    const reservedInventory = new Store(dbPath, resolve("db/migrations"));
    try {
      expect(reservedInventory.sql.prepare("SELECT project_id,quantity,consumed_quantity,status FROM project_lot_allocations WHERE source_lot_id=?").get(sourceLotId)).toEqual({
        project_id: firstInventoryProject, quantity: 1, consumed_quantity: 0, status: "reserved",
      });
    } finally { reservedInventory.close(); }
    const secondInventoryQuote = await request(undefined);
    const secondInventoryOffer = secondInventoryQuote.value?.production.offers.find((offer) => offer.estimate.blueprintItemId === "9102");
    expect(secondInventoryOffer?.chainPlan.actions.flatMap((action) => action.sources ?? []).some((source) => source.inventoryLotId === sourceLotId)).toBe(false);
    expect((await request(undefined, { kind: "production.project.cancel", projectId: firstInventoryProject })).error).toBeUndefined();
    const releasedInventoryQuote = await request(undefined);
    const releasedInventoryOffer = releasedInventoryQuote.value?.production.offers.find((offer) => offer.estimate.blueprintItemId === "9102");
    expect(releasedInventoryOffer?.chainPlan.actions.flatMap((action) => action.sources ?? []).some((source) => source.inventoryLotId === sourceLotId)).toBe(true);

    const consumingProjectId = "00000000-0000-4000-8000-000000000044";
    expect((await request(undefined, { kind: "production.project.pin", projectId: consumingProjectId, offerId: releasedInventoryOffer!.id })).error).toBeUndefined();
    expect((await request(undefined, { kind: "production.project.start", projectId: consumingProjectId })).error).toBeUndefined();
    const consumingDb = new Store(dbPath, resolve("db/migrations"));
    let consumingNode!: { id: string; payload: string };
    try {
      consumingNode = consumingDb.sql.prepare("SELECT id,payload FROM project_nodes WHERE project_id=? AND node_type='manufacturing' ORDER BY rowid LIMIT 1")
        .get(consumingProjectId) as { id: string; payload: string };
      const marketPurchaseNodes = consumingDb.sql.prepare("SELECT id,payload FROM project_nodes WHERE project_id=? AND node_type='purchase' AND json_extract(payload,'$.sourceLotId') IS NULL")
        .all(consumingProjectId) as { id: string; payload: string }[];
      for (const purchaseNode of marketPurchaseNodes) {
        const detail = JSON.parse(purchaseNode.payload) as { typeId: string; required: number; estimate: string };
        consumingDb.sql.prepare("INSERT INTO project_purchase_allocations(project_id,source,source_id,type_id,quantity,actual_cost,allocated_at) VALUES (?,'wallet_transaction',?,?,?, ?,?)")
          .run(consumingProjectId, `fixture:${detail.typeId}`, detail.typeId, detail.required, detail.estimate, at);
      }
    } finally { consumingDb.close(); }
    const consumingDetail = JSON.parse(consumingNode.payload) as { blueprintItemId: string; blueprintTypeId: string; outputTypeId: string; runs: number; facilityId: string };
    const startedProjectDb = new Store(dbPath, resolve("db/migrations"));
    let consumingStartedAt: { startedAt: string };
    try {
      consumingStartedAt = JSON.parse((startedProjectDb.sql.prepare("SELECT payload FROM production_projects WHERE id=?").get(consumingProjectId) as { payload: string }).payload) as { startedAt: string };
    } finally { startedProjectDb.close(); }
    const deliveredInventoryJob: OwnProductionData["jobs"][number] = {
      job_id: "93001", installer_id: "9001", facility_id: consumingDetail.facilityId, station_id: consumingDetail.facilityId,
      activity_id: 1, blueprint_id: consumingDetail.blueprintItemId, blueprint_type_id: consumingDetail.blueprintTypeId,
      blueprint_location_id: consumingDetail.facilityId, output_location_id: consumingDetail.facilityId,
      runs: consumingDetail.runs, status: "delivered", duration: 60,
      start_date: consumingStartedAt.startedAt, end_date: new Date(Date.now() + 1000).toISOString(),
      product_type_id: consumingDetail.outputTypeId, cost: "0.00",
    };
    const importedInventoryJob = await request({ kind: "production-data", characterId: "9001", profile, own: { ...own, jobs: [deliveredInventoryJob] }, publicData });
    expect(importedInventoryJob.error).toBeUndefined();
    expect((await request(undefined, { kind: "production.job.bind", projectId: consumingProjectId, nodeId: consumingNode.id, jobId: "93001" })).error).toBeUndefined();
    const consumedLotDb = new Store(dbPath, resolve("db/migrations"));
    try {
      expect(consumedLotDb.sql.prepare("SELECT remaining FROM project_output_lots WHERE id=?").get(sourceLotId)).toEqual({ remaining: 0 });
      expect(consumedLotDb.sql.prepare("SELECT consumed_quantity,status FROM project_lot_allocations WHERE project_id=? AND source_lot_id=?").get(consumingProjectId, sourceLotId)).toEqual({
        consumed_quantity: 1, status: "consumed",
      });
    } finally { consumedLotDb.close(); }

    const facility = await request(undefined, {
      kind: "production.facility.save",
      locationId: "60000361",
      services: ["manufacturing", "reprocessing"],
      accessConfirmed: true,
      reprocessingYieldPercent: "50",
      reprocessingTaxRate: "0",
      evidence: "Проверено в Structure Browser",
    });
    expect(facility.error).toBeUndefined();
    expect(facility.value?.production.facilityProfiles).toContainEqual(
      expect.objectContaining({
        id: "60000361",
        accessStatus: "confirmed",
        services: ["manufacturing", "reprocessing"],
        taxRate: "0.0025",
        reprocessingYieldPercent: "0.50000000",
        reprocessingTaxRate: "0.00000000",
      }),
    );
    const refreshAfterManualProfile = await request({ kind: "public-production", publicData });
    expect(refreshAfterManualProfile.error).toBeUndefined();
    expect(refreshAfterManualProfile.value?.production.facilityProfiles).toContainEqual(
      expect.objectContaining({
        id: "60000361",
        accessStatus: "confirmed",
        services: ["manufacturing", "reprocessing"],
        taxRate: "0.0025",
        reprocessingYieldPercent: "0.50000000",
        reprocessingTaxRate: "0.00000000",
      }),
    );
    const structureFacility = await request(undefined, {
      kind: "production.facility.save",
      locationId: "90000000001",
      services: ["manufacturing"],
      accessConfirmed: true,
      taxRate: "0.1",
      outputTypeId: "582",
      systemCostMultiplier: "1",
      materialBonusPercent: "0",
      timeBonusPercent: "0",
      brokerFeePercent: "0.5",
      evidence: "Рынок и услуга проверены в игре",
    });
    expect(structureFacility.error).toBeUndefined();
    expect(structureFacility.value?.production.facilityProfiles).toContainEqual(
      expect.objectContaining({
        id: "90000000001",
        structureProductProfiles: [expect.objectContaining({
          outputTypeId: "582",
          systemCostMultiplier: "1",
          materialBonusPercent: 0,
          timeBonusPercent: 0,
          brokerFeeRate: "0.00500000",
        })],
      }),
    );
    expect(structureFacility.value?.production.structureMarketCoverage).toContainEqual(
      expect.objectContaining({ structureId: "90000000001", state: "available", orderCount: 1 }),
    );

    const projectId = "00000000-0000-4000-8000-000000000001";
    const transactionId = "987654321";
    const structureTransactionId = "987654323";
    const projectStartedAt = "2026-10-08T00:00:00.000Z";
    const projectPayload = {
      offerId: "fixture-offer",
      itemName: "Fixture Product",
      itemEnglishName: "Fixture Product",
      blueprintTypeName: "Fixture Blueprint",
      facilityName: "Jita IV",
      systemId: "30000142",
      runs: 1,
      outputQuantity: 5,
      expectedCost: "65.00",
      cashRequired: "55.00",
      expectedProfit: "100.00",
      startedAt: projectStartedAt,
      estimate: {
        blueprintItemId: "9102",
        blueprintTypeId: "683",
        runs: 1,
        outputTypeId: "35",
        facilityId: "60003760",
        blueprintAcquisitionCost: "10.00",
        cashRequired: "55.00",
        materials: [{ typeId: "34", typeName: "Tritanium", quantity: 5, totalCost: "50.00" }],
      },
    };
    const projectDb = new Store(dbPath, resolve("db/migrations"));
    try {
      projectDb.sql.prepare("INSERT INTO production_projects(id,status,created_at,updated_at,payload) VALUES (?,'purchasing',?,?,?)")
        .run(projectId, at, at, JSON.stringify(projectPayload));
      projectDb.sql.prepare("INSERT INTO production_reservations(id,project_id,kind,amount,created_at) VALUES (?,?, 'purchase', ?, ?)")
        .run("00000000-0000-4000-8000-000000000002", projectId, "55.00", at);
      projectDb.sql.prepare("INSERT INTO project_nodes(id,project_id,node_key,node_type,status,payload) VALUES (?,?,?,'purchase','needed',?)")
        .run("00000000-0000-4000-8000-000000000003", projectId, "purchase:34", JSON.stringify({ typeId: "34", required: 5 }));
      projectDb.sql.prepare("INSERT INTO project_nodes(id,project_id,node_key,node_type,status,payload) VALUES (?,?,?,'manufacturing','planned',?)")
        .run("00000000-0000-4000-8000-000000000013", projectId, "manufacturing:9102", JSON.stringify({ blueprintItemId: "9102", runs: 1, outputTypeId: "35", outputQuantity: 5, expectedFee: "5.00", blueprintAcquisitionCost: "10.00" }));
      projectDb.sql.prepare("INSERT INTO project_edges(project_id,from_node,to_node,type_id,quantity) VALUES (?,?,?,?,?)")
        .run(projectId, "00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000013", "34", 5);
      projectDb.sql.prepare("INSERT INTO wallet_transactions VALUES (?,?,?,?,?)")
        .run("esi", "9001", transactionId, JSON.stringify({
          transaction_id: transactionId,
          date: "2026-10-08T00:10:00Z",
          type_id: "34",
          location_id: "60000361",
          quantity: 10,
          unit_price: "10.00",
          is_buy: true,
          is_personal: true,
          client_id: "9002",
          journal_ref_id: "9003",
        }), at);
      projectDb.sql.prepare("INSERT INTO wallet_transactions VALUES (?,?,?,?,?)")
        .run("esi", "9001", structureTransactionId, JSON.stringify({
          transaction_id: structureTransactionId,
          date: "2026-10-08T00:11:00Z",
          type_id: "34",
          location_id: "90000000001",
          quantity: 10,
          unit_price: "11.00",
          is_buy: true,
          is_personal: true,
          client_id: "9002",
          journal_ref_id: "9004",
        }), at);
    } finally {
      projectDb.close();
    }
    const firstAllocation = await request(undefined, {
      kind: "production.purchase.allocate",
      projectId,
      characterId: "9001",
      transactionId,
      quantity: 3,
    });
    expect(firstAllocation.error).toBeUndefined();
    expect(firstAllocation.value?.production.projects).toContainEqual(expect.objectContaining({
      id: projectId,
      status: "partially_ready",
      materials: [expect.objectContaining({ typeId: "34", required: 5, purchased: 3, actualCost: "30.00" })],
    }));
    const purchaseCandidates = firstAllocation.value?.production.projects.find((project) => project.id === projectId)?.purchases ?? [];
    expect(purchaseCandidates.find((purchase) => purchase.transactionId === transactionId)).toMatchObject({
      available: 7, locationName: "Jita IV - Moon 6 - Ytiri Storage",
    });
    expect(purchaseCandidates.find((purchase) => purchase.transactionId === structureTransactionId)).toMatchObject({
      available: 10, locationName: "Объект 90000000001",
    });
    const overAllocation = await request(undefined, {
      kind: "production.purchase.allocate",
      projectId,
      characterId: "9001",
      transactionId,
      quantity: 3,
    });
    expect(overAllocation.error).toContain("превышает оставшуюся потребность");
    const tradeDb = new Store(dbPath, resolve("db/migrations"));
    try {
      tradeDb.sql.prepare("INSERT INTO purchase_lots VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .run("trade-purchase", "keep-trade", "34", "9001", transactionId, "2026-10-08T00:10:00Z", 4, 4, "10.00", "60000361", "confirmed");
    } finally {
      tradeDb.close();
    }
    const finalAllocation = await request(undefined, {
      kind: "production.purchase.allocate",
      projectId,
      characterId: "9001",
      transactionId: structureTransactionId,
      quantity: 2,
    });
    expect(finalAllocation.error).toBeUndefined();
    expect(finalAllocation.value?.production.projects.find((project) => project.id === projectId)?.materials).toEqual([
      expect.objectContaining({ typeId: "34", required: 5, purchased: 5, actualCost: "52.00" }),
    ]);
    expect(finalAllocation.value?.production.projects.find((project) => project.id === projectId)?.currentExpectedProfit)
      .toEqual({ immediate: null, sellOrder: null });
    const projectCheck = new Store(dbPath, resolve("db/migrations"));
    try {
      expect(projectCheck.sql.prepare("SELECT amount FROM production_reservations WHERE project_id=?").get(projectId)).toEqual({ amount: "3.00" });
    } finally {
      projectCheck.close();
    }

    const jobDb = new Store(dbPath, resolve("db/migrations"));
    try {
      jobDb.sql.prepare("INSERT INTO production_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .run("9001", "9102", "60003760", 1, "9102", "683", 1, "active",
          "2026-10-08T00:15:00Z", "2026-10-08T00:20:00Z", "2026-10-08T00:21:00Z",
          JSON.stringify({ job_id: "9102", activity_id: 1, blueprint_id: "9102", blueprint_type_id: "683",
            facility_id: "60003760", product_type_id: "35", runs: 1, status: "active",
            start_date: "2026-10-08T00:15:00Z", end_date: "2026-10-08T00:20:00Z", cost: "5.00" }));
    } finally {
      jobDb.close();
    }
    const bound = await request(undefined, { kind: "production.job.bind", projectId, jobId: "9102" });
    expect(bound.error).toBeUndefined();
    expect(bound.value?.production.projects.find((project) => project.id === projectId)).toMatchObject({
      status: "in_production", outputLots: [],
    });
    const duplicateJobDb = new Store(dbPath, resolve("db/migrations"));
    try {
      duplicateJobDb.sql.prepare("INSERT INTO production_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .run("9001", "9103", "60003760", 1, "9101", "683", 1, "active",
          "2026-10-08T00:16:00Z", "2026-10-08T00:21:00Z", "2026-10-08T00:22:00Z",
          JSON.stringify({ job_id: "9103", activity_id: 1, blueprint_id: "9101", blueprint_type_id: "683",
            facility_id: "60003760", product_type_id: "35", runs: 1, status: "active",
            start_date: "2026-10-08T00:16:00Z", end_date: "2026-10-08T00:21:00Z", cost: "5.00" }));
    } finally {
      duplicateJobDb.close();
    }
    const duplicateJob = await request(undefined, { kind: "production.job.bind", projectId, jobId: "9103" });
    expect(duplicateJob.error).toContain("удвоила бы выпуск");
    const deliveredJob: OwnProductionData["jobs"][number] = {
      job_id: "9102", installer_id: "9001", facility_id: "60003760", station_id: "60003760",
      activity_id: 1, blueprint_id: "9102", blueprint_type_id: "683", blueprint_location_id: "60003760",
      output_location_id: "60003760", runs: 1, status: "delivered", duration: 300,
      start_date: "2026-10-08T00:15:00Z", end_date: "2026-10-08T00:20:00Z", product_type_id: "35",
    };
    const deliveredWithoutFee = await request({ kind: "production-data", characterId: "9001", profile,
      own: { ...own, jobs: [deliveredJob] }, publicData });
    expect(deliveredWithoutFee.error).toBeUndefined();
    expect(deliveredWithoutFee.value?.production.projects.find((project) => project.id === projectId)).toMatchObject({
      status: "reconciling", outputLots: [],
      boundJobs: [expect.objectContaining({ jobId: "9102", status: "delivered", cost: null })],
    });
    const deliveredSync = await request({ kind: "production-data", characterId: "9001", profile,
      own: { ...own, jobs: [{ ...deliveredJob, cost: "5.00" }] }, publicData });
    expect(deliveredSync.error).toBeUndefined();
    expect(deliveredSync.value?.production.projects.find((project) => project.id === projectId)).toMatchObject({
      status: "ready_for_sale",
      boundJobs: [expect.objectContaining({ jobId: "9102", status: "delivered", cost: "5.00" })],
      outputLots: [expect.objectContaining({ typeId: "35", quantity: 5, remaining: 5, unitCost: "13.40000000" })],
      realizedProfit: null,
    });

    const saleDb = new Store(dbPath, resolve("db/migrations"));
    try {
      saleDb.sql.prepare("INSERT INTO wallet_transactions VALUES (?,?,?,?,?)")
        .run("esi", "9001", "987654322", JSON.stringify({ transaction_id: "987654322", date: "2026-10-08T00:30:00Z",
          type_id: "35", location_id: "60003760", quantity: 5, unit_price: "20.00", is_buy: false,
          is_personal: true, client_id: "9002", journal_ref_id: "9004" }), at);
      saleDb.sql.prepare("INSERT INTO wallet_journal VALUES (?,?,?,?)")
        .run("9001", "9004", JSON.stringify({ id: "9004", date: "2026-10-08T00:30:00Z",
          ref_type: "market_transaction", amount: "90.00", balance: "1000.00" }), at);
    } finally {
      saleDb.close();
    }
    const beforeSale = await request(undefined);
    const lotId = beforeSale.value!.production.projects.find((project) => project.id === projectId)!.outputLots[0]!.id;
    expect(beforeSale.value?.production.projects.find((project) => project.id === projectId)?.saleCandidates)
      .toContainEqual(expect.objectContaining({ transactionId: "987654322", available: 5, netTotal: "90.00" }));
    const saleAction = "00000000-0000-4000-8000-000000000010";
    const lotReservationProject = "00000000-0000-4000-8000-000000000050";
    const lotReservationNode = "00000000-0000-4000-8000-000000000051";
    const lotReservationDb = new Store(dbPath, resolve("db/migrations"));
    try {
      lotReservationDb.sql.prepare("INSERT INTO production_projects(id,status,created_at,updated_at,payload) VALUES (?,'purchasing',?,?,?)")
        .run(lotReservationProject, at, at, JSON.stringify({ ...projectPayload, offerId: "fixture-consumer", startedAt: at }));
      lotReservationDb.sql.prepare("INSERT INTO project_nodes(id,project_id,node_key,node_type,status,payload) VALUES (?,?,?,'purchase','ready',?)")
        .run(lotReservationNode, lotReservationProject, "inventory:reserved-sale-test", JSON.stringify({
          typeId: "35", sourceLotId: lotId, quantity: 2, unitCost: "13.00",
        }));
      lotReservationDb.sql.prepare("INSERT INTO project_lot_allocations(id,source_lot_id,project_id,node_id,quantity,status,allocated_at) VALUES (?,?,?,?,?,'reserved',?)")
        .run("00000000-0000-4000-8000-000000000052", lotId, lotReservationProject, lotReservationNode, 2, at);
    } finally { lotReservationDb.close(); }
    const reservedSale = await request(undefined, { kind: "production.sale.allocate", projectId,
      outputLotId: lotId, transactionId: "987654322", quantity: 4,
      actionId: "00000000-0000-4000-8000-000000000053" });
    expect(reservedSale.error).toContain("Можно распределить не больше 3");
    expect((await request(undefined, { kind: "production.project.cancel", projectId: lotReservationProject })).error).toBeUndefined();
    const partialSale = await request(undefined, { kind: "production.sale.allocate", projectId,
      outputLotId: lotId, transactionId: "987654322", quantity: 2, actionId: saleAction });
    expect(partialSale.error).toBeUndefined();
    expect(partialSale.value?.production.projects.find((project) => project.id === projectId)).toMatchObject({
      status: "partially_sold", realizedProfit: "9.20",
      outputLots: [expect.objectContaining({ quantity: 5, remaining: 3 })],
      sales: [expect.objectContaining({ transactionId: "987654322", quantity: 2, net: "36.00" })],
    });
    const retriedSale = await request(undefined, { kind: "production.sale.allocate", projectId,
      outputLotId: lotId, transactionId: "987654322", quantity: 2, actionId: saleAction });
    expect(retriedSale.error).toBeUndefined();
    expect(retriedSale.value?.production.projects.find((project) => project.id === projectId)?.outputLots[0]?.remaining).toBe(3);
    const finalSale = await request(undefined, { kind: "production.sale.allocate", projectId,
      outputLotId: lotId, transactionId: "987654322", quantity: 3,
      actionId: "00000000-0000-4000-8000-000000000011" });
    expect(finalSale.error).toBeUndefined();
    expect(finalSale.value?.production.projects.find((project) => project.id === projectId)).toMatchObject({
      status: "completed", realizedProfit: "23.00", outputLots: [expect.objectContaining({ remaining: 0 })],
      sales: [expect.objectContaining({ transactionId: "987654322", quantity: 5, net: "90.00" })],
    });

    const chainProjectId = "00000000-0000-4000-8000-000000000030";
    const componentNodeId = "00000000-0000-4000-8000-000000000031";
    const finalNodeId = "00000000-0000-4000-8000-000000000032";
    const chainDb = new Store(dbPath, resolve("db/migrations"));
    try {
      chainDb.sql.prepare("INSERT INTO production_projects(id,status,created_at,updated_at,payload) VALUES (?,'partially_ready',?,?,?)")
        .run(chainProjectId, at, at, JSON.stringify({ ...projectPayload, offerId: "fixture-chain", startedAt: at }));
      chainDb.sql.prepare("INSERT INTO project_nodes(id,project_id,node_key,node_type,status,payload) VALUES (?,?,?,'manufacturing','planned',?)")
        .run(componentNodeId, chainProjectId, "make:component", JSON.stringify({ actionId: "make:component", blueprintItemId: "9201", blueprintTypeId: "9200", outputTypeId: "34", outputQuantity: 6, requiredOutput: 5, runs: 1, facilityId: "60003760", isFinal: false, inputMaterials: [], expectedFee: "3.00" }));
      chainDb.sql.prepare("INSERT INTO project_nodes(id,project_id,node_key,node_type,status,payload) VALUES (?,?,?,'manufacturing','planned',?)")
        .run(finalNodeId, chainProjectId, "make:final", JSON.stringify({ actionId: "make:final", blueprintItemId: "9101", blueprintTypeId: "683", outputTypeId: "35", outputQuantity: 5, runs: 1, facilityId: "60003760", isFinal: true, inputMaterials: [{ typeId: "34", typeName: "Tritanium", quantity: 5 }], expectedFee: "7.00" }));
      chainDb.sql.prepare("INSERT INTO project_edges(project_id,from_node,to_node,type_id,quantity) VALUES (?,?,?,?,?)")
        .run(chainProjectId, componentNodeId, finalNodeId, "34", 5);
    } finally { chainDb.close(); }
    const chainComponentStart = new Date(Date.parse(at) + 60_000).toISOString();
    const chainComponentEnd = new Date(Date.parse(chainComponentStart) + 5 * 60_000).toISOString();
    const chainFinalStart = new Date(Date.parse(at) + 10 * 60_000).toISOString();
    const chainFinalEnd = new Date(Date.parse(chainFinalStart) + 5 * 60_000).toISOString();
    const componentActive: OwnProductionData["jobs"][number] = {
      job_id: "9202", installer_id: "9001", facility_id: "60003760", station_id: "60003760",
      activity_id: 1, blueprint_id: "9201", blueprint_type_id: "9200", blueprint_location_id: "60003760",
      output_location_id: "60003760", runs: 1, status: "active", duration: 300,
      start_date: chainComponentStart, end_date: chainComponentEnd, product_type_id: "34", cost: "3.00",
    };
    const finalActive: OwnProductionData["jobs"][number] = {
      ...deliveredJob, job_id: "9203", status: "active", blueprint_id: "9101", blueprint_type_id: "683",
      start_date: chainFinalStart, end_date: chainFinalEnd, product_type_id: "35", cost: "7.00",
    };
    const chainActiveSync = await request({ kind: "production-data", characterId: "9001", profile,
      own: { ...own, jobs: [componentActive, finalActive] }, publicData });
    expect(chainActiveSync.error).toBeUndefined();
    const componentBound = await request(undefined, { kind: "production.job.bind", projectId: chainProjectId, nodeId: componentNodeId, jobId: "9202" });
    expect(componentBound.error).toBeUndefined();
    const componentDeliveredSync = await request({ kind: "production-data", characterId: "9001", profile,
      own: { ...own, jobs: [{ ...componentActive, status: "delivered" }, finalActive] }, publicData });
    expect(componentDeliveredSync.error).toBeUndefined();
    expect(componentDeliveredSync.value?.production.projects.find((project) => project.id === chainProjectId)).toMatchObject({
      status: "in_production", outputLots: [expect.objectContaining({ typeId: "34", quantity: 6, remaining: 1, isFinal: false, unitCost: "0.50000000" })],
      manufacturingNodes: [expect.objectContaining({ id: componentNodeId, status: "complete" }), expect.objectContaining({ id: finalNodeId, canStart: true })],
    });
    const finalBound = await request(undefined, { kind: "production.job.bind", projectId: chainProjectId, nodeId: finalNodeId, jobId: "9203" });
    expect(finalBound.error).toBeUndefined();
    const completeChainSync = await request({ kind: "production-data", characterId: "9001", profile,
      own: { ...own, jobs: [{ ...componentActive, status: "delivered" }, { ...finalActive, status: "delivered" }] }, publicData });
    expect(completeChainSync.error).toBeUndefined();
    expect(completeChainSync.value?.production.projects.find((project) => project.id === chainProjectId)).toMatchObject({
      status: "ready_for_sale", outputLots: expect.arrayContaining([
        expect.objectContaining({ typeId: "35", quantity: 5, unitCost: "1.90000000", isFinal: true }),
        expect.objectContaining({ typeId: "34", quantity: 6, remaining: 1, isFinal: false, unitCost: "0.50000000" }),
      ]),
      manufacturingNodes: [expect.objectContaining({ status: "complete" }), expect.objectContaining({ status: "complete", isFinal: true })],
    });
    const leftoverComponent = completeChainSync.value!.production.projects.find((project) => project.id === chainProjectId)!.outputLots.find((lot) => !lot.isFinal)!;
    const componentSale = await request(undefined, { kind: "production.sale.allocate", projectId: chainProjectId,
      outputLotId: leftoverComponent.id, transactionId: "987654322", quantity: 1,
      actionId: "00000000-0000-4000-8000-000000000034" });
    expect(componentSale.error).toContain("Промежуточный компонент");

    const reprocessingProjectId = "00000000-0000-4000-8000-000000000020";
    const reprocessingNodeId = "00000000-0000-4000-8000-000000000021";
    const reprocessingDb = new Store(dbPath, resolve("db/migrations"));
    try {
      reprocessingDb.sql.prepare("INSERT INTO production_projects(id,status,created_at,updated_at,payload) VALUES (?,'partially_ready',?,?,?)")
        .run(reprocessingProjectId, at, at, JSON.stringify({
          offerId: "fixture-reprocessing", projectKind: "reprocessing", facilityId: "60003760",
          itemName: "Fixture input", facilityName: "Jita IV", systemId: "30000142",
          outputQuantity: 15, expectedCost: "110.00", expectedProfit: "50.00", startedAt: at,
          estimate: {
            status: "ready", reasons: [], inputTypeId: "34", portionSize: 10, inputQuantity: 20,
            consumedQuantity: 20, residualQuantity: 0, portions: 2, yieldPercent: "50",
            inputsCost: "100.00", reprocessingTax: "0.00", totalCost: "100.00", reprocessingTaxRate: "0",
            outputs: [
              { typeId: "35", typeName: "Output A", quantity: 10, sellFilled: 10, buyGross: "200.00", askPrice: "25" },
              { typeId: "36", typeName: "Output B", quantity: 5, sellFilled: 5, buyGross: "100.00", askPrice: "25" },
            ],
            immediate: { filledOutputs: 2, outputCount: 2, gross: "300.00", tax: "0.00", netProfit: "190.00", roi: "1.9" },
            sellOrder: { gross: "375.00", listingFees: "1.00", netProfit: "263.00", roi: "2.63" },
            observedAt: at,
          },
        }));
      reprocessingDb.sql.prepare("INSERT INTO project_nodes(id,project_id,node_key,node_type,status,payload) VALUES (?,?,?,'reprocessing','planned',?)")
        .run(reprocessingNodeId, reprocessingProjectId, "reprocessing:34", JSON.stringify({ inputTypeId: "34", inputQuantity: 20 }));
      reprocessingDb.sql.prepare("INSERT INTO project_purchase_allocations(project_id,source,source_id,type_id,quantity,actual_cost,allocated_at) VALUES (?,'wallet_transaction','9001:987654321','34',20,'100.00',?)")
        .run(reprocessingProjectId, at);
    } finally {
      reprocessingDb.close();
    }
    const reprocessingActionId = "00000000-0000-4000-8000-000000000022";
    const confirmedReprocessing = await request(undefined, {
      kind: "production.reprocessing.confirm", projectId: reprocessingProjectId,
      consumedInput: 10, actualFee: "10.00",
      outputs: [{ typeId: "35", quantity: 4 }, { typeId: "36", quantity: 2 }],
      evidence: "Reprocess result copied from EVE test fixture", actionId: reprocessingActionId,
    });
    expect(confirmedReprocessing.error).toBeUndefined();
    expect(confirmedReprocessing.value?.production.projects.find((project) => project.id === reprocessingProjectId)).toMatchObject({
      kind: "reprocessing", status: "ready_for_sale", realizedProfit: null,
      outputLots: [
        expect.objectContaining({ typeId: "35", quantity: 4, remaining: 4 }),
        expect.objectContaining({ typeId: "36", quantity: 2, remaining: 2 }),
        expect.objectContaining({ typeId: "34", quantity: 10, remaining: 10 }),
      ],
    });
    const repeatedReprocessing = await request(undefined, {
      kind: "production.reprocessing.confirm", projectId: reprocessingProjectId,
      consumedInput: 10, actualFee: "10.00",
      outputs: [{ typeId: "35", quantity: 4 }, { typeId: "36", quantity: 2 }],
      evidence: "Reprocess result copied from EVE test fixture", actionId: reprocessingActionId,
    });
    expect(repeatedReprocessing.error).toBeUndefined();
    expect(repeatedReprocessing.value?.production.projects.find((project) => project.id === reprocessingProjectId)?.outputLots).toHaveLength(3);

    const invalid = {
      ...own,
      assets: [own.assets[0], own.assets[0]],
    };
    const failed = await request({
      kind: "production-data",
      characterId: "9001",
      profile: { ...profile, race: "Amarr" },
      own: invalid,
      publicData,
    });
    expect(failed.error).toBeTruthy();
  } finally {
    await worker.terminate();
  }

  const check = new Store(dbPath, resolve("db/migrations"));
  try {
    expect(
      check.sql.prepare("SELECT race FROM production_character_profiles").get(),
    ).toEqual({ race: "Minmatar" });
    expect(check.sql.prepare("SELECT count(*) n FROM production_assets").get()).toEqual({ n: 1 });
    expect(check.sql.prepare("SELECT id FROM deals").get()).toEqual({ id: "keep-trade" });
    expect(check.sql.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(check.sql.pragma("foreign_key_check")).toEqual([]);
  } finally {
    check.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);
