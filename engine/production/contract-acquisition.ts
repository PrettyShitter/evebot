import { D } from "../accounting/money";

export interface CompletedCharacterContract {
  contractId: string;
  type: string;
  status: string;
  acceptorId: string | null;
  locationId: string;
  price: string;
}

export interface PublicBlueprintContractListing {
  contractId: string;
  locationId: string;
  price: string;
  blueprintOnly: boolean;
  items: {
    itemId?: string;
    typeId: string;
    quantity: number;
    isBlueprintCopy: boolean | null;
    materialEfficiency: number | null;
    timeEfficiency: number | null;
    runs: number | null;
  }[];
}

/**
 * Return the only blueprint that can be costed from a contract listing.
 * For mixed bundles the caller must charge the full contract price and must
 * not credit unmodeled extra items as revenue.
 */
export function singleKnownBpc<T extends PublicBlueprintContractListing>(
  listing: T,
): T["items"][number] | null {
  if (listing.items.length !== 1) return null;
  const item = listing.items[0]!;
  if (item.quantity !== 1 || item.isBlueprintCopy !== true ||
      item.materialEfficiency === null || item.timeEfficiency === null ||
      item.runs === null || item.runs <= 0) return null;
  return item;
}

export interface OwnedBlueprintAcquisitionCandidate {
  itemId: string;
  typeId: string;
  locationId: string;
  quantity: number;
  materialEfficiency: number;
  timeEfficiency: number;
  runs: number;
}

export interface BlueprintContractAcquisition {
  blueprintItemId: string;
  contractId: string;
  price: string;
  acquisitionRuns: number;
}

const validMoney = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value);

/**
 * Join only completed, personally accepted, single-BPC public contracts to a
 * unique matching owned blueprint. Ambiguous or partial evidence is ignored.
 */
export function matchCompletedBlueprintContractAcquisitions(
  characterId: string,
  characterContracts: CompletedCharacterContract[],
  publicListings: PublicBlueprintContractListing[],
  ownedBlueprints: OwnedBlueprintAcquisitionCandidate[],
): BlueprintContractAcquisition[] {
  if (!/^\d+$/.test(characterId)) return [];

  const completed = new Map<string, CompletedCharacterContract[]>();
  for (const contract of characterContracts) {
    if (contract.type !== "item_exchange" || contract.status !== "finished" ||
        contract.acceptorId !== characterId || !validMoney(contract.price) ||
        !D(contract.price).gt(0)) continue;
    const list = completed.get(contract.contractId) ?? [];
    list.push(contract);
    completed.set(contract.contractId, list);
  }

  const listings = new Map<string, PublicBlueprintContractListing[]>();
  for (const listing of publicListings) {
    if (!singleKnownBpc(listing) ||
        !validMoney(listing.price) || !D(listing.price).gt(0)) continue;
    const list = listings.get(listing.contractId) ?? [];
    list.push(listing);
    listings.set(listing.contractId, list);
  }

  const candidates: BlueprintContractAcquisition[] = [];
  for (const [contractId, matches] of completed) {
    const listingMatches = listings.get(contractId) ?? [];
    if (matches.length !== 1 || listingMatches.length !== 1) continue;
    const contract = matches[0]!;
    const listing = listingMatches[0]!;
    if (contract.locationId !== listing.locationId || !D(contract.price).eq(listing.price)) continue;
    const item = listing.items[0]!;
    const blueprintMatches = ownedBlueprints.filter((blueprint) =>
      blueprint.quantity === 1 && (!item.itemId || blueprint.itemId === item.itemId) && blueprint.typeId === item.typeId &&
      blueprint.locationId === listing.locationId &&
      blueprint.materialEfficiency === item.materialEfficiency &&
      blueprint.timeEfficiency === item.timeEfficiency && blueprint.runs === item.runs,
    );
    if (blueprintMatches.length !== 1) continue;
    candidates.push({
      blueprintItemId: blueprintMatches[0]!.itemId,
      contractId,
      price: contract.price,
      acquisitionRuns: item.runs!,
    });
  }

  const usesByBlueprint = new Map<string, number>();
  for (const candidate of candidates)
    usesByBlueprint.set(candidate.blueprintItemId, (usesByBlueprint.get(candidate.blueprintItemId) ?? 0) + 1);
  return candidates.filter((candidate) => usesByBlueprint.get(candidate.blueprintItemId) === 1);
}

/** Allocate a BPC's purchase cost evenly across its known original runs. */
export function allocateBlueprintAcquisitionCost(
  totalPrice: string | null,
  acquisitionRuns: number | null,
  projectRuns: number,
): string | null {
  if (totalPrice === null || acquisitionRuns === null || !validMoney(totalPrice) ||
      Number(totalPrice) <= 0 || !Number.isSafeInteger(acquisitionRuns) ||
      acquisitionRuns <= 0 || !Number.isSafeInteger(projectRuns) ||
      projectRuns <= 0 || projectRuns > acquisitionRuns) return null;
  return D(totalPrice).mul(projectRuns).div(acquisitionRuns).toDecimalPlaces(2).toFixed(2);
}
