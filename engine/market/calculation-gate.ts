export function shouldStartMarketCalculation(input: {
  needsCalculation: boolean;
  busy: boolean;
  retryReady: boolean;
  hasPreparedOffers: boolean;
  marketSyncPending: boolean;
}) {
  return (
    input.needsCalculation &&
    !input.busy &&
    input.retryReady &&
    (!input.hasPreparedOffers || !input.marketSyncPending)
  );
}
