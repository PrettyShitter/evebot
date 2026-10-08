import { allocateMoney, D } from "../accounting/money";

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
  return knownBpcCopies(listing)?.[0] ?? null;
}

/**
 * Return included BPCs only when every possible blueprint item has exact
 * public attributes. Extra non-blueprint items are allowed but never credited
 * as revenue; estimates still require payment of the full contract price.
 */
export function knownBpcCopies<T extends PublicBlueprintContractListing>(
  listing: T,
): T["items"] | null {
  const possibleBlueprints = listing.items.filter(
    (item) => item.isBlueprintCopy !== false,
  );
  if (possibleBlueprints.length === 0) return null;
  if (
    possibleBlueprints.some(
      (item) =>
        !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1 ||
        item.isBlueprintCopy !== true ||
        item.materialEfficiency === null ||
        item.timeEfficiency === null ||
        item.runs === null ||
        item.runs <= 0 ||
        !Number.isSafeInteger(item.runs * item.quantity),
    )
  )
    return null;
  return possibleBlueprints;
}

export function groupKnownBpcCopies<T extends PublicBlueprintContractListing>(
  listing: T,
) {
  const copies = knownBpcCopies(listing);
  if (!copies) return null;
  const bundleRuns = copies.reduce((total, item) => total + item.runs! * item.quantity, 0);
  const groups = new Map<
    string,
    { item: (typeof copies)[number]; copies: number; runs: number }
  >();
  for (const item of copies) {
    const key = [item.typeId, item.materialEfficiency, item.timeEfficiency, item.runs].join(":");
    const group = groups.get(key);
    if (group) {
      group.copies += item.quantity;
      group.runs += item.runs! * item.quantity;
    } else groups.set(key, { item, copies: item.quantity, runs: item.runs! * item.quantity });
  }
  return { bundleRuns, groups: [...groups.values()] };
}

/** Split whole-contract cost over BPC runs while retaining every cent. */
export function allocateBpcBundleCost(
  contractPrice: string,
  bundleRuns: number,
  projectRuns: number,
) {
  if (
    !validMoney(contractPrice) ||
    !Number.isSafeInteger(bundleRuns) || bundleRuns <= 0 ||
    !Number.isSafeInteger(projectRuns) || projectRuns <= 0 ||
    projectRuns > bundleRuns
  )
    return null;
  return allocateMoney(contractPrice, [String(projectRuns), String(bundleRuns - projectRuns)])[0]!;
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

/** Join completed contracts to each uniquely matched BPC in a known bundle. */
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
    const listingCopies = knownBpcCopies(listing);
    if (!listingCopies || listingCopies.some((item) => item.quantity !== 1) ||
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
    const items = knownBpcCopies(listing)!;
    const matched = items.map((item) => {
      const blueprintMatches = ownedBlueprints.filter((blueprint) =>
        blueprint.quantity === 1 && (!item.itemId || blueprint.itemId === item.itemId) && blueprint.typeId === item.typeId &&
        blueprint.locationId === listing.locationId &&
        blueprint.materialEfficiency === item.materialEfficiency &&
        blueprint.timeEfficiency === item.timeEfficiency && blueprint.runs === item.runs,
      );
      return blueprintMatches.length === 1
        ? { item, blueprint: blueprintMatches[0]! }
        : null;
    });
    if (matched.some((entry) => entry === null)) continue;
    const exactMatches = matched as {
      item: (typeof items)[number];
      blueprint: OwnedBlueprintAcquisitionCandidate;
    }[];
    if (new Set(exactMatches.map((entry) => entry.blueprint.itemId)).size !== exactMatches.length) continue;
    const allocatedPrices = allocateMoney(
      contract.price,
      exactMatches.map((entry) => String(entry.item.runs)),
    );
    for (const [index, entry] of exactMatches.entries())
      candidates.push({
        blueprintItemId: entry.blueprint.itemId,
        contractId,
        price: allocatedPrices[index]!,
        acquisitionRuns: entry.item.runs!,
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
