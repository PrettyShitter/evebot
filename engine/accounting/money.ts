import Decimal from "decimal.js";
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export { Decimal };
export const D = (v: Decimal.Value) => new Decimal(v);
export const sum = (v: Decimal.Value[]) =>
  v.reduce<Decimal>((a, b) => a.plus(b), D(0));
export const isk = (v: Decimal.Value) => D(v).toFixed(2);
export function cents(v: string): string {
  if (!D(v).times(100).isInteger())
    throw Error("Деньги должны иметь точность 0.01 ISK");
  return D(v).times(100).toFixed(0);
}
export const fromCents = (v: string) => D(v).div(100).toFixed(2);
export function allocateMoney(total: string, weights: string[]): string[] {
  if (weights.length === 0) {
    if (!D(total).isZero()) throw Error("Нет получателей");
    return [];
  }
  const w = sum(weights);
  if (w.lte(0) || weights.some((x) => D(x).lt(0)))
    throw Error("Некорректные веса");
  const sign = D(total).isNegative() ? -1 : 1;
  const units = D(cents(total)).abs();
  const parts = weights.map((v, i) => {
    const exact = units.mul(v).div(w);
    return { i, n: exact.floor(), remainder: exact.minus(exact.floor()) };
  });
  const left = units.minus(sum(parts.map((x) => x.n))).toNumber();
  const priority = [...parts].sort(
    (a, b) => b.remainder.comparedTo(a.remainder) || a.i - b.i,
  );
  for (let i = 0; i < left; i++) priority[i].n = priority[i].n.plus(1);
  return parts.map((x) => x.n.mul(sign).div(100).toFixed(2));
}
