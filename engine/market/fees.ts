import { D, isk, Decimal } from "../accounting/money";
export const FORMULA_VERSION = "npc-2026-10-02-v1";
export interface SellerProfile {
  accounting: number;
  brokerRelations: number;
  advancedBrokerRelations: number;
  factionStanding: string;
  corporationStanding: string;
}
export function rates(p: SellerProfile) {
  for (const l of [p.accounting, p.brokerRelations, p.advancedBrokerRelations])
    if (!Number.isInteger(l) || l < 0 || l > 5)
      throw Error("Уровень навыка 0–5");
  for (const s of [p.factionStanding, p.corporationStanding])
    if (D(s).abs().gt(10)) throw Error("Standings вне диапазона");
  return {
    tax: D(".075").mul(D(1).minus(D(".11").mul(p.accounting))),
    broker: D(".03")
      .minus(D(".003").mul(p.brokerRelations))
      .minus(D(".0003").mul(p.factionStanding))
      .minus(D(".0002").mul(p.corporationStanding)),
    discount: D(".50").plus(D(".06").mul(p.advancedBrokerRelations)),
  };
}
export const listingFee = (gross: string, rate: Decimal.Value) =>
  isk(Decimal.max(100, D(gross).mul(rate)));
export function relistFee(
  oldGross: string,
  newGross: string,
  broker: Decimal.Value,
  discount: Decimal.Value,
) {
  return isk(
    Decimal.max(
      100,
      Decimal.max(0, D(newGross).minus(oldGross).mul(broker)).plus(
        D(1).minus(discount).mul(broker).mul(newGross),
      ),
    ),
  );
}
export function tickBelow(price: string): string {
  const p = D(price);
  if (p.lte(".01")) return ".01";
  const power = p.e - 3;
  let tick = Decimal.max(".01", D(10).pow(power));
  if (p.eq(D(10).pow(p.e))) tick = Decimal.max(".01", tick.div(10));
  return p
    .minus(tick)
    .toSignificantDigits(4, Decimal.ROUND_FLOOR)
    .toFixed(Math.max(0, Math.min(2, -tick.e)));
}
