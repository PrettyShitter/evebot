/** Keep existing offer rows in their last visible order while fresh market data is pending. */
export function preserveOfferOrder<T extends { id: string }>(
  offers: readonly T[],
  priorOrder: readonly string[],
): T[] {
  const position = new Map(priorOrder.map((id, index) => [id, index]));
  return [...offers].sort((left, right) =>
    (position.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
    (position.get(right.id) ?? Number.MAX_SAFE_INTEGER),
  );
}
