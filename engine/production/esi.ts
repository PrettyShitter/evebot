import { z } from "zod";
import { EsiError, type EsiClient } from "../esi/client";
import { id, type Order } from "../../shared/contracts/esi";

const int = z.preprocess(
  (value) => {
    const exact = value && typeof value === "object" && "isLosslessNumber" in value &&
      value.isLosslessNumber === true && "value" in value && typeof value.value === "string"
      ? value.value
      : value;
    return typeof exact === "string" && /^-?\d+$/.test(exact) ? Number(exact) : exact;
  },
  z.number().int().safe(),
);
const positiveId = id;
const nonNegativeId = z.preprocess((value) => {
  if (value && typeof value === "object" && "isLosslessNumber" in value &&
      value.isLosslessNumber === true && "value" in value && typeof value.value === "string")
    return value.value;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : value;
}, z.string().regex(/^\d+$/));
const numeric = z.preprocess((value) => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  if (value && typeof value === "object" && "toString" in value)
    return Number(String(value));
  return value;
}, z.number().finite().nonnegative());
const decimalText = z.preprocess((value) => {
  if (value && typeof value === "object" && "isLosslessNumber" in value &&
      value.isLosslessNumber === true && "value" in value && typeof value.value === "string")
    return value.value;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : value;
}, z.string().regex(/^\d+(\.\d+)?$/));

export const assetSchema = z.object({
  item_id: positiveId,
  type_id: positiveId,
  location_id: positiveId,
  location_type: z.string(),
  location_flag: z.string(),
  quantity: int,
  is_singleton: z.boolean(),
  is_blueprint_copy: z.boolean().optional(),
});
export const blueprintInstanceSchema = z.object({
  item_id: positiveId,
  type_id: positiveId,
  location_id: positiveId,
  location_flag: z.string(),
  quantity: int,
  material_efficiency: int,
  time_efficiency: int,
  runs: int,
});
export const industryJobSchema = z.object({
  job_id: positiveId,
  installer_id: positiveId,
  facility_id: positiveId,
  station_id: positiveId.optional(),
  activity_id: int,
  blueprint_id: positiveId,
  blueprint_type_id: positiveId,
  blueprint_location_id: positiveId,
  output_location_id: positiveId,
  runs: int,
  status: z.string(),
  duration: int,
  start_date: z.iso.datetime(),
  end_date: z.iso.datetime(),
  product_type_id: positiveId.optional(),
  cost: decimalText.optional(),
});
export const characterContractSchema = z.object({
  contract_id: positiveId,
  issuer_id: positiveId,
  issuer_corporation_id: positiveId,
  acceptor_id: nonNegativeId.optional(),
  assignee_id: nonNegativeId,
  start_location_id: positiveId,
  end_location_id: positiveId,
  type: z.string(),
  status: z.string(),
  title: z.string(),
  date_issued: z.iso.datetime(),
  date_expired: z.iso.datetime(),
  price: decimalText,
});
export interface OwnProductionData {
  assets: z.infer<typeof assetSchema>[];
  blueprints: z.infer<typeof blueprintInstanceSchema>[];
  jobs: z.infer<typeof industryJobSchema>[];
  contracts: z.infer<typeof characterContractSchema>[];
  at: string;
}

const structureOrderSchema = z.object({
  order_id: id,
  type_id: id,
  location_id: id,
  price: z.preprocess((value) => String(value), z.string().regex(/^\d+(\.\d+)?$/)),
  is_buy_order: z.boolean(),
  volume_remain: int,
  volume_total: int,
  min_volume: int,
  range: z.enum(["station", "region", "solarsystem", "1", "2", "3", "4", "5", "10", "20", "30", "40"]),
  duration: int,
  issued: z.iso.datetime(),
});

export interface StructureMarketSource {
  structureId: string;
  systemId: string;
  state: "available" | "forbidden" | "capped" | "failed";
  pages: number;
  observedAt: string;
  message: string | null;
  orders: Order[];
}
export type StructureMarketSync = StructureMarketSource | {
  structureId: string;
  systemId: string;
  state: "missing_scope";
  pages: 0;
  observedAt: string;
  message: string;
  orders: [];
};

/** Fetch only manually configured structures with confirmed local access. */
export async function fetchStructureMarkets(
  client: EsiClient,
  token: string,
  characterId: string,
  structures: { id: string; systemId: string }[],
  maxPages = 100,
): Promise<StructureMarketSource[]> {
  const sources: StructureMarketSource[] = [];
  for (const structure of structures) {
    const observedAt = new Date().toISOString();
    const orders: Order[] = [];
    let totalPages = 1;
    let pages = 0;
    let state: StructureMarketSource["state"] = "available";
    let message: string | null = null;
    try {
      for (let page = 1; page <= totalPages; page++) {
        if (page > maxPages) {
          state = "capped";
          message = `Пагинация превышает лимит ${maxPages} страниц; снимок не заменён`;
          break;
        }
        const response = await client.get(
          `/markets/structures/${structure.id}?page=${page}`,
          token,
          characterId,
        );
        const rows = z.array(structureOrderSchema).parse(response.body);
        totalPages = response.pages;
        pages += 1;
        orders.push(...rows.map((row) => ({ ...row, system_id: structure.systemId })));
      }
    } catch (error) {
      state = error instanceof EsiError && error.status === 403 ? "forbidden" : "failed";
      message = error instanceof Error ? error.message : "Не удалось загрузить рынок структуры";
      if (error instanceof EsiError && error.status === 403)
        message = "Персонажу недоступен рынок этой структуры (ESI 403)";
    }
    sources.push({ structureId: structure.id, systemId: structure.systemId, state, pages, observedAt, message, orders });
  }
  return sources;
}

async function pages<T>(
  client: EsiClient,
  path: string,
  token: string,
  characterId: string,
  schema: z.ZodType<T>,
) {
  const output: T[] = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page++) {
    const result = await client.get(
      `${path}${path.includes("?") ? "&" : "?"}page=${page}`,
      token,
      characterId,
    );
    const rows = z.array(schema).parse(result.body);
    totalPages = result.pages;
    output.push(...rows);
  }
  return output;
}

export async function fetchOwnProductionData(
  client: EsiClient,
  characterId: string,
  token: string,
): Promise<OwnProductionData> {
  const [assets, blueprints, jobs, contracts] = await Promise.all([
    pages(
      client,
      `/characters/${characterId}/assets/`,
      token,
      characterId,
      assetSchema,
    ),
    pages(
      client,
      `/characters/${characterId}/blueprints/`,
      token,
      characterId,
      blueprintInstanceSchema,
    ),
    pages(
      client,
      `/characters/${characterId}/industry/jobs/?include_completed=true`,
      token,
      characterId,
      industryJobSchema,
    ),
    pages(
      client,
      `/characters/${characterId}/contracts/`,
      token,
      characterId,
      characterContractSchema,
    ),
  ]);
  return { assets, blueprints, jobs, contracts, at: new Date().toISOString() };
}

export interface PublicProductionData {
  facilities: {
    id: string;
    ownerId: string;
    regionId: string;
    systemId: string;
    typeId: string;
    tax: string | null;
  }[];
  systemIndices: Map<
    string,
    { activity: string; costIndex: string }[]
  >;
  adjustedPrices: Map<string, string>;
  publicBlueprintContracts: {
    contractId: string;
    regionId: string;
    locationId: string;
    price: string;
    expiresAt: string;
    title: string;
    blueprintOnly: boolean;
    includedItemCount: number;
    items: {
      recordId: string;
      itemId?: string;
      typeId: string;
      quantity: number;
      isBlueprintCopy: boolean | null;
      materialEfficiency: number | null;
      timeEfficiency: number | null;
      runs: number | null;
    }[];
  }[];
  contractCoverage: { candidateContracts: number; fetchedContracts: number; capped: boolean; complete: boolean; itemErrors: number };
  at: string;
}
const facilitySchema = z.object({
  facility_id: positiveId,
  owner_id: positiveId,
  region_id: positiveId,
  solar_system_id: positiveId,
  type_id: positiveId,
  tax: numeric.nullable().optional(),
});
const systemIndexSchema = z.object({
  solar_system_id: positiveId,
  cost_indices: z.array(
    z.object({ activity: z.string(), cost_index: numeric }),
  ),
});
const marketPriceSchema = z.object({
  type_id: positiveId,
  adjusted_price: numeric.optional(),
  average_price: numeric.optional(),
});

export async function fetchPublicProductionData(
  client: EsiClient,
  targetSystems: Set<string>,
  targetLocationIds: Set<string> = new Set(),
  targetRegionIds: Set<string> = new Set(["10000002"]),
): Promise<PublicProductionData> {
  const [facilitiesResponse, systemsResponse, pricesResponse] = await Promise.all([
    client.get("/industry/facilities/"),
    client.get("/industry/systems/"),
    client.get("/markets/prices/"),
  ]);
  const facilities = z
    .array(facilitySchema)
    .parse(facilitiesResponse.body)
    .filter((facility) => targetSystems.has(facility.solar_system_id))
    .map((facility) => ({
      id: facility.facility_id,
      ownerId: facility.owner_id,
      regionId: facility.region_id,
      systemId: facility.solar_system_id,
      typeId: facility.type_id,
      tax: facility.tax === undefined || facility.tax === null ? null : String(facility.tax),
    }));
  const indices = z
    .array(systemIndexSchema)
    .parse(systemsResponse.body)
    .filter((system) => targetSystems.has(system.solar_system_id));
  const adjustedPrices = z
    .array(marketPriceSchema)
    .parse(pricesResponse.body)
    .flatMap((price) =>
      price.adjusted_price === undefined
        ? []
        : [[price.type_id, String(price.adjusted_price)] as const],
    );
  const contractSchema = z.object({
    contract_id: positiveId,
    issuer_id: positiveId,
    issuer_corporation_id: positiveId,
    type: z.enum(["unknown", "item_exchange", "auction", "courier", "loan"]),
    date_issued: z.iso.datetime(),
    date_expired: z.iso.datetime(),
    price: numeric.optional(),
    start_location_id: positiveId.optional(),
    title: z.string().optional().default(""),
  });
  const contractItemSchema = z.object({
    record_id: positiveId,
    item_id: positiveId.optional(),
    type_id: positiveId,
    quantity: int,
    is_included: z.boolean(),
    is_blueprint_copy: z.boolean().optional(),
    material_efficiency: int.optional(),
    time_efficiency: int.optional(),
    runs: int.optional(),
  });
  const contractListings: z.infer<typeof contractSchema>[] = [];
  let contractListError = false;
  let contractPagesCapped = false;
  try {
    for (const regionId of new Set([...facilities.map((facility) => facility.regionId), ...targetRegionIds])) {
      let pages = 1;
      for (let page = 1; page <= pages; page++) {
        if (page > 10) { contractPagesCapped = true; break; }
        const response = await client.get(`/contracts/public/${regionId}/?page=${page}`);
        const rows = z.array(contractSchema).parse(response.body);
        pages = response.pages;
        contractListings.push(...rows);
      }
    }
  } catch {
    // Contract discovery is supplementary. An ESI outage must not block price,
    // facility and character synchronization from the same manual refresh.
    contractListError = true;
  }
  const targetLocations = new Set([...facilities.map((facility) => facility.id), ...targetLocationIds]);
  const candidates = contractListings.filter((contract) =>
    contract.type === "item_exchange" &&
    contract.start_location_id && targetLocations.has(contract.start_location_id) &&
    contract.price !== undefined && contract.price > 0 &&
    Date.parse(contract.date_expired) > Date.now(),
  );
  const contractLimit = 40;
  const selectedCandidates = candidates.slice(0, contractLimit);
  const publicBlueprintContracts: PublicProductionData["publicBlueprintContracts"] = [];
  let contractItemErrors = 0;
  for (let offset = 0; offset < selectedCandidates.length; offset += 5) {
    const batch = selectedCandidates.slice(offset, offset + 5);
    const items = await Promise.allSettled(batch.map(async (contract) => {
      const response = await client.get(`/contracts/public/items/${contract.contract_id}/`);
      return { contract, items: z.array(contractItemSchema).parse(response.body) };
    }));
    for (const result of items) {
      if (result.status === "rejected") { contractItemErrors++; continue; }
      const { contract, items } = result.value;
      const includedItems = items.filter((item) => item.is_included);
      const includedBlueprints = includedItems.filter((item) => item.is_blueprint_copy === true);
      if (!includedBlueprints.length) continue;
      publicBlueprintContracts.push({
        contractId: contract.contract_id,
        regionId: "10000002",
        locationId: contract.start_location_id!,
        price: String(contract.price),
        expiresAt: contract.date_expired,
        title: contract.title,
        blueprintOnly: includedItems.every((item) => item.is_blueprint_copy === true),
        includedItemCount: includedItems.length,
        items: includedBlueprints.map((item) => ({
          recordId: item.record_id,
          ...(item.item_id ? { itemId: item.item_id } : {}),
          typeId: item.type_id,
          // ESI's contract quantity sentinel -2 identifies one blueprint
          // copy; represent it as one physical BPC in our run accounting.
          quantity: item.is_blueprint_copy === true && item.quantity === -2 ? 1 : item.quantity,
          isBlueprintCopy: item.is_blueprint_copy ?? null,
          materialEfficiency: item.material_efficiency ?? null,
          timeEfficiency: item.time_efficiency ?? null,
          runs: item.runs ?? null,
        })),
      });
    }
  }
  return {
    facilities,
    systemIndices: new Map(
      indices.map((system) => [
        system.solar_system_id,
        system.cost_indices.map((index) => ({
          activity: index.activity,
          costIndex: String(index.cost_index),
        })),
      ]),
    ),
    adjustedPrices: new Map(adjustedPrices),
    publicBlueprintContracts,
    contractCoverage: {
      candidateContracts: candidates.length,
      fetchedContracts: selectedCandidates.length,
      capped: candidates.length > contractLimit || contractPagesCapped,
      complete: !contractListError,
      itemErrors: contractItemErrors,
    },
    at: new Date().toISOString(),
  };
}
