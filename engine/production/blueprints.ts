/** Return runs available to a new plan. A BPO is reusable but cannot be started
 * in parallel; BPC runs are consumable across active projects. */
export function availableBlueprintRuns(
  remainingRuns: number,
  activeAllocations: readonly number[],
  maxProductionLimit: number,
): number {
  if (!Number.isSafeInteger(maxProductionLimit) || maxProductionLimit <= 0)
    throw Error("Некорректный production limit чертежа");
  if (remainingRuns === -1)
    return activeAllocations.length ? 0 : maxProductionLimit;
  if (!Number.isSafeInteger(remainingRuns) || remainingRuns < 0)
    throw Error("Некорректное количество прогонов чертежа");
  const allocated = activeAllocations.reduce((total, runs) => {
    if (!Number.isSafeInteger(runs) || runs <= 0)
      throw Error("Некорректный резерв прогонов чертежа");
    return total + runs;
  }, 0);
  return Math.max(0, remainingRuns - allocated);
}

export function canReserveBlueprintRuns(
  remainingRuns: number,
  activeAllocations: readonly number[],
  requestedRuns: number,
): boolean {
  if (!Number.isSafeInteger(requestedRuns) || requestedRuns <= 0) return false;
  return availableBlueprintRuns(remainingRuns, activeAllocations, Number.MAX_SAFE_INTEGER) >= requestedRuns;
}
