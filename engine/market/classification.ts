import type { ItemType, StaticData } from "./static-data";

// SDE market-group roots: Minerals, Standard Ores, Moon Ores, and Unrefined
// Minerals. Compressed variants inherit their ore's market-group ancestry.
// Ice products and ice ores are intentionally left searchable.
const EXCLUDED_MARKET_GROUPS = new Set(["1857", "54", "2395", "3784"]);
const EXCLUDED_TYPE_GROUPS = new Set(["18", "967", "4932"]);

export function excludedMarketTypeIds(data: StaticData): Set<string> {
  const groups = new Map(data.marketGroups.map((group) => [group.id, group]));
  const excluded = new Set<string>();
  for (const type of data.types)
    if (isExcludedMarketType(type, groups)) excluded.add(type.id);
  return excluded;
}

function isExcludedMarketType(
  type: ItemType,
  groups: Map<string, StaticData["marketGroups"][number]>,
) {
  if (EXCLUDED_TYPE_GROUPS.has(type.groupId)) return true;
  const visited = new Set<string>();
  let groupId: string | null = type.marketGroupId;
  while (groupId && !visited.has(groupId)) {
    if (EXCLUDED_MARKET_GROUPS.has(groupId)) return true;
    visited.add(groupId);
    groupId = groups.get(groupId)?.parentId ?? null;
  }
  return false;
}
